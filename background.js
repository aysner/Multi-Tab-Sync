// Multi-Tab Sync – Service Worker.
// Verwaltet die Sync-Gruppe, injiziert das Content-Script, routet Events
// zwischen den Tabs und steuert den Präzisionsmodus (chrome.debugger).

const DEFAULT_STATE = {
  enabled: false,
  tabIds: [],
  opts: {
    scroll: true,
    click: true,
    keys: true,
    nav: true,
    scrollMode: 'absolute', // 'absolute' | 'relative'
    precision: false,
  },
};

const CATEGORY = { scroll: 'scroll', click: 'click', focus: 'click', key: 'keys', input: 'keys', change: 'keys' };

// Nach einem Replay in Tab X werden Events aus X kurz ignoriert, damit die
// Folge-Events des Replays (Scroll, Fokus, Eingabe) nicht zurückgespiegelt werden.
const REPLAY_QUIET_MS = 250;
const NAV_DELAY_MS = 400;
const CDP_VERSION = '1.3';

const lastReplay = new Map(); // tabId -> Zeitpunkt des zuletzt abgeschlossenen Replays
const inFlight = new Map();   // tabId -> Anzahl laufender/wartender Replays
const queues = new Map();     // tabId -> Promise (Replays pro Tab serialisieren)
const attachedTabs = new Set();
let leaderTabId = null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
function normalize(s) {
  return { ...DEFAULT_STATE, ...s, opts: { ...DEFAULT_STATE.opts, ...(s?.opts || {}) }, tabIds: s?.tabIds || [] };
}

let state = DEFAULT_STATE;
const ready = chrome.storage.session.get(['state', 'leader']).then((r) => {
  state = normalize(r.state);
  leaderTabId = r.leader ?? null;
});

async function getState() {
  await ready;
  return state;
}

async function updateState(mutate) {
  const next = structuredClone(await getState());
  mutate(next);
  state = normalize(next);
  await chrome.storage.session.set({ state });
}

function setLeader(tabId) {
  if (leaderTabId === tabId) return;
  leaderTabId = tabId;
  chrome.storage.session.set({ leader: tabId });
}

async function setTabError(tabId, message) {
  const { tabErrors = {} } = await chrome.storage.session.get('tabErrors');
  if (message) tabErrors[tabId] = message;
  else if (tabId in tabErrors) delete tabErrors[tabId];
  else return;
  await chrome.storage.session.set({ tabErrors });
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'session' || !changes.state) return;
  await ready;
  state = normalize(changes.state.newValue);
  reconcile(changes.state.oldValue ? normalize(changes.state.oldValue) : DEFAULT_STATE, state);
});

// Gleicht Injektion und Debugger-Verbindungen an den neuen State an.
async function reconcile(prev, next) {
  const prevActive = prev.enabled ? prev.tabIds : [];
  const nextActive = next.enabled ? next.tabIds : [];
  for (const t of nextActive) if (!prevActive.includes(t)) inject(t);
  for (const t of prevActive) if (!nextActive.includes(t)) teardownTab(t);

  const prevDbg = prev.enabled && prev.opts.precision ? prev.tabIds : [];
  const nextDbg = next.enabled && next.opts.precision ? next.tabIds : [];
  for (const t of nextDbg) if (!prevDbg.includes(t)) attachDebugger(t).catch(() => {});
  for (const t of prevDbg) if (!nextDbg.includes(t)) detachDebugger(t);

  updateBadge(next);
}

function updateBadge(s) {
  const n = s.tabIds.length;
  chrome.action.setBadgeText({ text: s.enabled && n ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: s.opts.precision ? '#c2410c' : '#15803d' });
  chrome.action.setTitle({
    title: s.enabled ? `Multi-Tab Sync: aktiv (${n} Tabs${s.opts.precision ? ', Präzisionsmodus' : ''})` : 'Multi-Tab Sync: aus',
  });
}

// ---------------------------------------------------------------------------
// Content-Script
// ---------------------------------------------------------------------------
async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    await setTabError(tabId, null);
  } catch (err) {
    await setTabError(tabId, err.message || String(err));
  }
}

function teardownTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'mts:teardown' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Präzisionsmodus (Chrome DevTools Protocol)
// ---------------------------------------------------------------------------
async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
  } catch (err) {
    // Nach einem Neustart des Service Workers sind wir evtl. noch verbunden
    if (!/already attached/i.test(err.message)) {
      await setTabError(tabId, `Präzisionsmodus: ${err.message}`);
      throw err;
    }
  }
  attachedTabs.add(tabId);
  // Seite verhält sich, als hätte sie den Fokus – wichtig für Tastatur-Events
  // in Fenstern, die gerade nicht aktiv sind.
  await cdp(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
}

function detachDebugger(tabId) {
  attachedTabs.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
}

function cdp(tabId, method, params) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
  if (tabId == null) return;
  attachedTabs.delete(tabId);
  // Nutzer hat in der gelben Leiste "Abbrechen" geklickt -> Präzisionsmodus aus,
  // sonst würde die Leiste beim nächsten Event sofort wieder erscheinen.
  if (reason === 'canceled_by_user') {
    updateState((s) => { s.opts.precision = false; });
  }
});

function cdpModifiers(m = {}) {
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
}

const EDIT_COMMANDS = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo', y: 'redo' };

async function preciseClick(tabId, ev) {
  const pt = await chrome.tabs.sendMessage(tabId, { type: 'mts:locate', event: ev }, { frameId: 0 }).catch(() => null);
  // Verdeckte Tabs rendern nicht -> CDP-Hit-Test wäre veraltet; dann Standard-Replay
  if (!pt || !pt.visible) return false;
  try {
    await attachDebugger(tabId);
    const base = { x: pt.x, y: pt.y, modifiers: cdpModifiers(ev.mods) };
    const clickCount = ev.detail || 1;
    await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
    await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', buttons: 1, clickCount });
    await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', buttons: 0, clickCount });
    return true;
  } catch {
    return false;
  }
}

async function preciseKey(tabId, ev) {
  const m = ev.mods || {};
  const printable = ev.key.length === 1 && !m.ctrl && !m.meta;
  const text = printable ? ev.key : ev.key === 'Enter' ? '\r' : undefined;
  const params = {
    key: ev.key,
    code: ev.code,
    windowsVirtualKeyCode: ev.keyCode,
    nativeVirtualKeyCode: ev.keyCode,
    location: ev.location,
    isKeypad: ev.location === 3,
    autoRepeat: !!ev.repeat,
    modifiers: cdpModifiers(m),
  };
  if (ev.type === 'keyup') {
    params.type = 'keyUp';
  } else {
    params.type = text ? 'keyDown' : 'rawKeyDown';
    if (text) { params.text = text; params.unmodifiedText = text; }
    // Strg/Cmd+C/V/X/A/Z lösen per CDP nur mit expliziten Editor-Kommandos etwas aus
    let cmd = (m.ctrl || m.meta) && EDIT_COMMANDS[ev.key.toLowerCase()];
    if (cmd === 'undo' && m.shift) cmd = 'redo';
    if (cmd) params.commands = [cmd];
  }
  try {
    await attachDebugger(tabId);
    await cdp(tabId, 'Input.dispatchKeyEvent', params);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event-Routing
// ---------------------------------------------------------------------------
async function handleEvent(ev, sender) {
  const s = await getState();
  const src = sender.tab?.id;
  if (!s.enabled || src == null || !s.tabIds.includes(src)) return;
  if (isQuiet(src)) return;
  if (!s.opts[CATEGORY[ev.kind]]) return;

  setLeader(src);
  if (ev.kind === 'scroll') ev.mode = s.opts.scrollMode;
  // Präzisionsmodus nur für Events aus dem Top-Frame (CDP-Koordinaten beziehen
  // sich auf den Haupt-Viewport); Events aus iframes laufen über das Content-Script.
  const precise = s.opts.precision && sender.frameId === 0;

  // Eingabe-Events werden auch im Präzisionsmodus gespiegelt: Hat das per CDP
  // getippte Zeichen den Wert schon gesetzt, ist das Replay ein No-op.
  for (const t of s.tabIds) {
    if (t === src) continue;
    enqueue(t, () => replayInto(t, ev, precise));
  }
}

function isQuiet(tabId) {
  return (inFlight.get(tabId) || 0) > 0 || Date.now() - (lastReplay.get(tabId) || 0) < REPLAY_QUIET_MS;
}

function enqueue(tabId, job) {
  inFlight.set(tabId, (inFlight.get(tabId) || 0) + 1);
  const prev = queues.get(tabId) || Promise.resolve();
  const next = prev
    .then(job)
    .catch((err) => console.debug('[Multi-Tab Sync] replay failed', tabId, err))
    .finally(() => {
      inFlight.set(tabId, inFlight.get(tabId) - 1);
      lastReplay.set(tabId, Date.now());
    });
  queues.set(tabId, next);
}

async function replayInto(tabId, ev, precise) {
  if (precise && ev.kind === 'click' && await preciseClick(tabId, ev)) return;
  if (precise && ev.kind === 'key' && await preciseKey(tabId, ev)) return;
  // Kein frameId: Nachricht geht an alle Frames, das passende Frame filtert per FRAME_KEY
  await chrome.tabs.sendMessage(tabId, { type: 'mts:replay', event: ev }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Navigations-Sync: gleicher Pfad, eigene Domain (staging.x.de/a -> www.x.de/a)
// ---------------------------------------------------------------------------
function pathOf(u) {
  return u.pathname + u.search + u.hash;
}

async function syncNavigation(srcTabId, url) {
  if (srcTabId !== leaderTabId || isQuiet(srcTabId)) return;
  let want;
  try { want = new URL(url); } catch { return; }
  if (!/^https?:$/.test(want.protocol)) return;

  // Kurz warten: Ein gespiegelter Link-Klick navigiert das Ziel meist ohnehin
  await new Promise((r) => setTimeout(r, NAV_DELAY_MS));
  const s = await getState();
  if (!s.enabled || !s.opts.nav) return;

  for (const t of s.tabIds) {
    if (t === srcTabId) continue;
    const tab = await chrome.tabs.get(t).catch(() => null);
    if (!tab) continue;
    let cur;
    try { cur = new URL(tab.pendingUrl || tab.url); } catch { continue; }
    if (!/^https?:$/.test(cur.protocol) || pathOf(cur) === pathOf(want)) continue;
    lastReplay.set(t, Date.now());
    chrome.tabs.update(t, { url: cur.origin + pathOf(want) }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tab-Lebenszyklus
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const s = await getState();
  if (!s.enabled || !s.tabIds.includes(tabId)) return;
  // Neues Dokument -> Content-Script erneut injizieren (Guard verhindert Doppelungen)
  if (info.status === 'complete') inject(tabId);
  if (info.url && s.opts.nav) syncNavigation(tabId, info.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  attachedTabs.delete(tabId);
  queues.delete(tabId);
  inFlight.delete(tabId);
  lastReplay.delete(tabId);
  const s = await getState();
  if (s.tabIds.includes(tabId)) await updateState((n) => { n.tabIds = n.tabIds.filter((t) => t !== tabId); });
  await setTabError(tabId, null);
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const s = await getState();
  if (!s.tabIds.includes(removedTabId)) return;
  await updateState((n) => { n.tabIds = n.tabIds.map((t) => (t === removedTabId ? addedTabId : t)); });
});

// Der Tab, mit dem der Nutzer gerade arbeitet, ist der "Leader" für den Navigations-Sync
async function leaderFromWindow(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  const s = await getState();
  if (tab && s.tabIds.includes(tab.id)) setLeader(tab.id);
}

chrome.windows.onFocusChanged.addListener(leaderFromWindow);
chrome.tabs.onActivated.addListener(({ windowId }) => leaderFromWindow(windowId));

// ---------------------------------------------------------------------------
// Fenster nebeneinander anordnen
// ---------------------------------------------------------------------------
async function tileTabs(screen) {
  const { tabIds } = await getState();
  const n = tabIds.length;
  if (!n) return;
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const width = Math.floor(screen.width / cols);
  const height = Math.floor(screen.height / rows);

  for (let i = 0; i < n; i++) {
    const tabId = tabIds[i];
    const bounds = {
      left: screen.left + (i % cols) * width,
      top: screen.top + Math.floor(i / cols) * height,
      width,
      height,
    };
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) continue;
    const win = await chrome.windows.get(tab.windowId, { populate: true });
    if (win.tabs.length === 1) {
      if (win.state !== 'normal') await chrome.windows.update(win.id, { state: 'normal' });
      await chrome.windows.update(win.id, bounds);
    } else {
      await chrome.windows.create({ tabId, ...bounds });
    }
  }
}

// ---------------------------------------------------------------------------
// Nachrichten & Tastenkürzel
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'mts:event':
      handleEvent(msg.event, sender);
      return;
    case 'mts:tile':
      tileTabs(msg.screen).then(() => sendResponse(true), (err) => sendResponse({ error: err.message }));
      return true;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'toggle-sync') {
    await updateState((s) => { s.enabled = !s.enabled; });
  } else if (command === 'toggle-tab') {
    const active = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!active) return;
    await updateState((s) => {
      const adding = !s.tabIds.includes(active.id);
      s.tabIds = adding ? [...s.tabIds, active.id] : s.tabIds.filter((t) => t !== active.id);
      if (adding && s.tabIds.length >= 2) s.enabled = true;
    });
  }
});

ready.then(() => updateBadge(state));
