// Multi-Tab Sync – content script.
// Wird vom Service Worker in jeden Frame der Sync-Tabs injiziert.
// Erfasst echte Nutzer-Events (isTrusted) und spielt Events aus anderen Tabs nach.

(() => {
  if (window.__multiTabSync) return;

  const ac = new AbortController();
  const { signal } = ac;

  // ---------------------------------------------------------------------------
  // Frame-Identifikation: Frame-IDs unterscheiden sich zwischen Tabs, daher
  // ordnen wir Frames über Verschachtelungstiefe + Pfad zu.
  // ---------------------------------------------------------------------------
  const FRAME_KEY = (() => {
    if (window === window.top) return 'top';
    let depth = 0;
    let w = window;
    while (w !== w.top) { depth++; w = w.parent; }
    return `${depth}:${location.pathname}`;
  })();

  // ---------------------------------------------------------------------------
  // Selektoren (inkl. Shadow DOM, getrennt durch " >>> ")
  // ---------------------------------------------------------------------------
  const SHADOW_SEP = ' >>> ';
  const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];

  function isStableId(id) {
    if (!id) return false;
    // Generierte IDs (React useId, Ember, Hashes, lange Zahlen) überspringen
    return !/^\d|:|^(ember|react|radix|headlessui|mui|rc-|cdk-|mat-)|\d{4,}|[a-f0-9]{8,}/i.test(id);
  }

  function segment(el) {
    const tag = el.localName;
    for (const attr of TEST_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return { sel: `${tag}[${attr}="${CSS.escape(v)}"]`, anchor: true };
    }
    if (isStableId(el.id)) return { sel: `#${CSS.escape(el.id)}`, anchor: true };
    const name = el.getAttribute('name');
    if (name && /^(input|select|textarea|button|form)$/.test(tag)) {
      return { sel: `${tag}[name="${CSS.escape(name)}"]`, anchor: true };
    }
    const parent = el.parentElement;
    if (!parent) return { sel: tag, anchor: false };
    const same = Array.from(parent.children).filter((c) => c.localName === tag);
    if (same.length > 1) return { sel: `${tag}:nth-of-type(${same.indexOf(el) + 1})`, anchor: false };
    return { sel: tag, anchor: false };
  }

  function pathWithinRoot(el) {
    const root = el.getRootNode();
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      const seg = segment(cur);
      parts.unshift(seg.sel);
      if (seg.anchor) {
        try {
          if (root.querySelectorAll(parts.join(' > ')).length === 1) break;
        } catch { /* ungültiger Selektor -> weiter nach oben */ }
      }
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    const segs = [];
    let cur = el;
    for (;;) {
      segs.unshift(pathWithinRoot(cur));
      const root = cur.getRootNode();
      if (root instanceof ShadowRoot) cur = root.host;
      else break;
    }
    return segs.join(SHADOW_SEP);
  }

  function resolveSelector(sel) {
    if (!sel) return null;
    let root = document;
    let el = null;
    for (const part of sel.split(SHADOW_SEP)) {
      if (!root) return null;
      try { el = root.querySelector(part); } catch { return null; }
      if (!el) return null;
      root = el.shadowRoot;
    }
    return el;
  }

  function elementAtViewportRatio(vx, vy) {
    if (vx == null || vy == null) return null;
    let el = document.elementFromPoint(vx * innerWidth, vy * innerHeight);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(vx * innerWidth, vy * innerHeight);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function eventTarget(e) {
    const path = e.composedPath();
    return path.length ? path[0] : e.target;
  }

  function mods(e) {
    return { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };
  }

  function isSensitive(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === 'password') return true;
    const ac = (el.autocomplete || '').toLowerCase();
    return ac.includes('one-time-code') || ac.startsWith('cc-') || ac.includes(' cc-');
  }

  function isEditable(el) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
  }

  // ---------------------------------------------------------------------------
  // Senden
  // ---------------------------------------------------------------------------
  function send(event) {
    event.frame = FRAME_KEY;
    try {
      chrome.runtime.sendMessage({ type: 'mts:event', event }).catch(() => {});
    } catch {
      // Extension wurde neu geladen -> dieser Script-Kontext ist tot
      teardown();
    }
  }

  // ---------------------------------------------------------------------------
  // Capture: Scroll
  // ---------------------------------------------------------------------------
  const lastApplied = new Map(); // key -> {x, y, t} zuletzt nachgespielte Position
  const pendingScroll = new Set();
  let scrollRaf = 0;

  function scrollMetrics(target) {
    if (target === null) {
      const se = document.scrollingElement || document.documentElement;
      return {
        x: window.scrollX, y: window.scrollY,
        maxX: se.scrollWidth - window.innerWidth, maxY: se.scrollHeight - window.innerHeight,
      };
    }
    return {
      x: target.scrollLeft, y: target.scrollTop,
      maxX: target.scrollWidth - target.clientWidth, maxY: target.scrollHeight - target.clientHeight,
    };
  }

  function flushScroll() {
    scrollRaf = 0;
    for (const target of pendingScroll) {
      const sel = target === null ? null : selectorFor(target);
      if (target !== null && !sel) continue;
      const key = sel || '';
      const m = scrollMetrics(target);
      const last = lastApplied.get(key);
      if (last && performance.now() - last.t < 500 && Math.abs(last.x - m.x) <= 1 && Math.abs(last.y - m.y) <= 1) {
        continue; // Echo unseres eigenen Replays
      }
      send({
        kind: 'scroll', sel,
        x: m.x, y: m.y,
        rx: m.maxX > 0 ? m.x / m.maxX : 0,
        ry: m.maxY > 0 ? m.y / m.maxY : 0,
      });
    }
    pendingScroll.clear();
  }

  function onScroll(e) {
    const t = e.target;
    const target = (t === document || t === document.documentElement || t === document.scrollingElement || t === document.body && document.scrollingElement === document.body) ? null : t;
    if (target !== null && target.nodeType !== Node.ELEMENT_NODE) return;
    pendingScroll.add(target);
    if (!scrollRaf) scrollRaf = requestAnimationFrame(flushScroll);
  }

  // ---------------------------------------------------------------------------
  // Capture: Klick / Fokus
  // ---------------------------------------------------------------------------
  let lastClick = { el: null, t: 0 };

  function onClick(e) {
    if (!e.isTrusted || e.button !== 0) return;
    const el = eventTarget(e);
    if (!(el instanceof Element)) return;

    // Klick auf <label> erzeugt einen zweiten Klick auf das zugehörige Control.
    // Der wird im Ziel-Tab ohnehin durch den Label-Klick ausgelöst -> überspringen.
    const now = performance.now();
    if (lastClick.el instanceof HTMLLabelElement && lastClick.el.control === el && now - lastClick.t < 100) return;
    lastClick = { el: el.closest('label') || el, t: now };

    // Ausstehende Scroll-Events zuerst senden, damit das Ziel vor dem Klick
    // dieselbe Scroll-Position hat (sonst trifft der Klick daneben).
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); flushScroll(); }

    const r = el.getBoundingClientRect();
    send({
      kind: 'click',
      sel: selectorFor(el),
      vx: e.clientX / innerWidth,
      vy: e.clientY / innerHeight,
      ox: r.width ? (e.clientX - r.left) / r.width : 0.5,
      oy: r.height ? (e.clientY - r.top) / r.height : 0.5,
      detail: e.detail || 1,
      mods: mods(e),
    });
  }

  function onFocusIn(e) {
    if (!e.isTrusted) return;
    const el = eventTarget(e);
    if (!(el instanceof Element)) return;
    send({ kind: 'focus', sel: selectorFor(el) });
  }

  // ---------------------------------------------------------------------------
  // Capture: Tastatur / Eingaben
  // ---------------------------------------------------------------------------
  function onKey(e) {
    if (!e.isTrusted || e.isComposing) return;
    const el = eventTarget(e);
    if (isSensitive(el)) return;
    send({
      kind: 'key',
      type: e.type,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      location: e.location,
      repeat: e.repeat,
      mods: mods(e),
      editable: isEditable(el),
    });
  }

  function onInput(e) {
    if (!e.isTrusted) return;
    const el = eventTarget(e);
    if (isSensitive(el)) return;
    const sel = selectorFor(el);
    if (!sel) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file')) return;
      send({ kind: 'input', sel, value: el.value });
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      const host = el.closest('[contenteditable]:not([contenteditable="false"])') || el;
      send({ kind: 'input', sel: selectorFor(host), html: host.innerHTML });
    }
  }

  function onChange(e) {
    if (!e.isTrusted) return;
    const el = eventTarget(e);
    if (isSensitive(el)) return;
    if (el instanceof HTMLInputElement && el.type === 'file') return;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    send({ kind: 'change', sel: selectorFor(el), value: el.value, checked: el.checked, inputType: el.type });
  }

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------
  function resolveTarget(ev) {
    return resolveSelector(ev.sel) || elementAtViewportRatio(ev.vx, ev.vy);
  }

  function ensureVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      return el.getBoundingClientRect();
    }
    return r;
  }

  function pointFor(el, ev) {
    const r = ensureVisible(el);
    return {
      x: r.left + r.width * (ev.ox ?? 0.5),
      y: r.top + r.height * (ev.oy ?? 0.5),
    };
  }

  function replayScroll(ev) {
    const target = ev.sel ? resolveSelector(ev.sel) : null;
    if (ev.sel && !target) return;
    const m = scrollMetrics(target);
    const x = ev.mode === 'relative' ? ev.rx * Math.max(0, m.maxX) : ev.x;
    const y = ev.mode === 'relative' ? ev.ry * Math.max(0, m.maxY) : ev.y;
    (target || window).scrollTo({ left: x, top: y, behavior: 'instant' });
    // tatsächlich erreichte Position merken (kann durch Seitenlänge begrenzt sein)
    const after = scrollMetrics(target);
    lastApplied.set(ev.sel || '', { x: after.x, y: after.y, t: performance.now() });
  }

  const FOCUSABLE = 'input,textarea,select,button,a[href],area[href],summary,[tabindex],[contenteditable]:not([contenteditable="false"])';

  function replayClick(ev) {
    const el = resolveTarget(ev);
    if (!el) return;
    const { x, y } = pointFor(el, ev);
    const m = ev.mods || {};
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x + window.screenX, screenY: y + window.screenY,
      button: 0, detail: ev.detail || 1,
      altKey: !!m.alt, ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift,
    };
    const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...ptr, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    const focusable = el.closest(FOCUSABLE);
    if (focusable && typeof focusable.focus === 'function') focusable.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, ...ptr, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    if (ev.detail === 2) el.dispatchEvent(new MouseEvent('dblclick', { ...base, buttons: 0 }));
  }

  function replayFocus(ev) {
    const el = resolveSelector(ev.sel);
    if (el && typeof el.focus === 'function' && deepActiveElement() !== el) el.focus({ preventScroll: true });
  }

  function replayKey(ev) {
    const target = deepActiveElement() || document.body;
    if (!target || isSensitive(target)) return;
    const m = ev.mods || {};
    const kev = new KeyboardEvent(ev.type, {
      key: ev.key, code: ev.code, keyCode: ev.keyCode, which: ev.keyCode,
      location: ev.location, repeat: ev.repeat,
      altKey: !!m.alt, ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift,
      bubbles: true, cancelable: true, composed: true, view: window,
    });
    const notCancelled = target.dispatchEvent(kev);
    // Standardaktion "Enter im Formularfeld -> absenden" nachbilden
    if (notCancelled && ev.type === 'keydown' && ev.key === 'Enter' && !m.ctrl && !m.alt && !m.meta &&
        target instanceof HTMLInputElement && target.form) {
      target.form.requestSubmit();
    }
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  function replayInput(ev) {
    const el = resolveSelector(ev.sel);
    if (!el || isSensitive(el)) return;
    if (ev.html != null) {
      if (el.innerHTML === ev.html) return;
      el.innerHTML = ev.html;
    } else {
      if (el.value === ev.value) return;
      setNativeValue(el, ev.value);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  }

  function replayChange(ev) {
    const el = resolveSelector(ev.sel);
    if (!el || isSensitive(el)) return;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      // Ein Klick feuert input+change wie im Original; überspringen, wenn der
      // Klick-Replay den Zustand schon hergestellt hat.
      if (el.checked !== ev.checked) el.click();
      return;
    }
    if (el.value !== ev.value) {
      setNativeValue(el, ev.value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const REPLAY = {
    scroll: replayScroll,
    click: replayClick,
    focus: replayFocus,
    key: replayKey,
    input: replayInput,
    change: replayChange,
  };

  // Für den Präzisionsmodus: Zielkoordinaten im Top-Frame-Viewport ermitteln
  function locate(ev) {
    const el = resolveTarget(ev);
    if (!el) return null;
    const p = pointFor(el, ev);
    return { x: p.x, y: p.y, visible: document.visibilityState === 'visible' };
  }

  // ---------------------------------------------------------------------------
  // Nachrichten vom Service Worker
  // ---------------------------------------------------------------------------
  function onMessage(msg, _sender, sendResponse) {
    switch (msg?.type) {
      case 'mts:replay':
        if (msg.event.frame === FRAME_KEY) {
          try { REPLAY[msg.event.kind]?.(msg.event); } catch (err) { console.debug('[Multi-Tab Sync] replay failed', err); }
        }
        return;
      case 'mts:locate':
        if (FRAME_KEY === 'top') sendResponse(locate(msg.event));
        return;
      case 'mts:ping':
        if (FRAME_KEY === 'top') sendResponse(true);
        return;
      case 'mts:teardown':
        teardown();
        return;
    }
  }

  function teardown() {
    ac.abort();
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* Kontext ungültig */ }
    delete window.__multiTabSync;
  }

  const capture = { capture: true, signal };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true, signal });
  document.addEventListener('click', onClick, capture);
  document.addEventListener('focusin', onFocusIn, capture);
  document.addEventListener('keydown', onKey, capture);
  document.addEventListener('keyup', onKey, capture);
  document.addEventListener('input', onInput, capture);
  document.addEventListener('change', onChange, capture);
  chrome.runtime.onMessage.addListener(onMessage);

  window.__multiTabSync = true;
})();
