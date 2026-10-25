// Multi-Tab Sync – Popup. Schreibt den State nach chrome.storage.session;
// der Service Worker reagiert darauf (Injektion, Debugger, Badge).

const DEFAULT_STATE = {
  enabled: false,
  tabIds: [],
  opts: { scroll: true, click: true, keys: true, nav: true, scrollMode: 'absolute', precision: false },
};

const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source|chrome-search):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;

const $ = (sel) => document.querySelector(sel);
let state = DEFAULT_STATE;
let tabErrors = {};
let renderSeq = 0;

function normalize(s) {
  return { ...DEFAULT_STATE, ...s, opts: { ...DEFAULT_STATE.opts, ...(s?.opts || {}) }, tabIds: s?.tabIds || [] };
}

async function save(mutate) {
  const next = structuredClone(state);
  mutate(next);
  state = normalize(next);
  await chrome.storage.session.set({ state });
  render();
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url || '';
  }
}

// Fehlende Berechtigungen erkennen, die Chrome dem Nutzer überlässt
async function accessProblem(tab) {
  const url = tab.url || tab.pendingUrl || '';
  if (url.startsWith('file:')) {
    return (await chrome.extension.isAllowedFileSchemeAccess()) ? null
      : 'Kein Dateizugriff: chrome://extensions → Multi-Tab Sync → Details → „Zugriff auf Datei-URLs zulassen“ aktivieren (oder ./test/serve.sh nutzen).';
  }
  let origin;
  try { origin = new URL(url).origin; } catch { return null; }
  if (!/^https?:/.test(origin)) return null;
  const ok = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  return ok ? null : 'Kein Websitezugriff: Rechtsklick aufs Extension-Icon → „Kann Websitedaten lesen und ändern“ → „Auf allen Websites“.';
}

async function renderTabs() {
  const tabs = await chrome.tabs.query({});
  const list = $('#tabs');
  const tpl = $('#tab-row');
  const seq = ++renderSeq;
  const rows = [];

  // Ausgewählte zuerst (in Gruppenreihenfolge), dann der Rest nach Fenster
  const selected = state.tabIds.map((id) => tabs.find((t) => t.id === id)).filter(Boolean);
  const rest = tabs.filter((t) => !state.tabIds.includes(t.id));
  let lastWindow = null;

  for (const tab of [...selected, ...rest]) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const cb = li.querySelector('input');
    const isSelected = state.tabIds.includes(tab.id);
    const restricted = RESTRICTED.test(tab.url || tab.pendingUrl || '');

    if (!isSelected && lastWindow !== null && tab.windowId !== lastWindow) li.classList.add('window-sep');
    if (!isSelected) lastWindow = tab.windowId;

    cb.checked = isSelected;
    cb.disabled = restricted && !isSelected;
    if (cb.disabled) li.classList.add('disabled');
    cb.addEventListener('change', () => save((s) => {
      s.tabIds = cb.checked ? [...s.tabIds, tab.id] : s.tabIds.filter((t) => t !== tab.id);
      // Ab zwei Tabs automatisch einschalten, damit man den Schalter nicht vergisst
      if (cb.checked && s.tabIds.length >= 2) s.enabled = true;
    }));

    const img = li.querySelector('.favicon');
    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
      img.src = tab.favIconUrl;
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    } else {
      img.style.visibility = 'hidden';
    }

    li.querySelector('.title').textContent = tab.title || '(ohne Titel)';
    li.querySelector('.url').textContent = hostOf(tab.url || tab.pendingUrl);

    const warn = li.querySelector('.warn');
    const error = restricted ? 'Auf dieser Seite dürfen Erweiterungen nicht laufen.'
      : isSelected ? (await accessProblem(tab)) || tabErrors[tab.id] : null;
    if (error) {
      warn.hidden = false;
      warn.title = error;
      if (isSelected) li.querySelector('.error').textContent = error;
    }
    rows.push(li);
  }
  if (seq !== renderSeq) return; // neuerer Render-Durchlauf läuft schon
  list.replaceChildren(...rows);

  const n = state.tabIds.length;
  $('#count').textContent = n ? `${n} ausgewählt` : 'mind. 2 auswählen';
  $('#tile').disabled = n < 1;
}

function render() {
  $('#enabled').checked = state.enabled;
  for (const el of document.querySelectorAll('[data-opt]')) {
    const v = state.opts[el.dataset.opt];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  renderTabs();
}

$('#enabled').addEventListener('change', (e) => save((s) => { s.enabled = e.target.checked; }));

for (const el of document.querySelectorAll('[data-opt]')) {
  el.addEventListener('change', () => save((s) => {
    s.opts[el.dataset.opt] = el.type === 'checkbox' ? el.checked : el.value;
  }));
}

$('#tile').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'mts:tile',
    screen: {
      left: screen.availLeft ?? 0,
      top: screen.availTop ?? 0,
      width: screen.availWidth,
      height: screen.availHeight,
    },
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes.state) state = normalize(changes.state.newValue);
  if (changes.tabErrors) tabErrors = changes.tabErrors.newValue || {};
  render();
});

chrome.storage.session.get(['state', 'tabErrors']).then((r) => {
  state = normalize(r.state);
  tabErrors = r.tabErrors || {};
  render();
});
