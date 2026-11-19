// Small DOM helpers shared by every page.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

export function plural(n, word, pl) { return `${n} ${n === 1 ? word : (pl || word + 's')}`; }

export function fmtPoints(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function toast(msg, kind = 'info', ms = 4000) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function loading(label = 'Loading') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
}

// A readable error panel with an optional retry. Never a blank page.
export function errorBox(err, retry) {
  const msg = err && err.message ? err.message : String(err);
  return h('div', { class: 'panel error-panel', role: 'alert' },
    h('h2', null, 'Something went wrong'),
    h('p', null, msg),
    retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again') : null);
}

// Modal confirm built on <dialog>. Resolves true/false.
export function confirmDialog({ title, body, ok = 'Continue', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, title),
      body ? (body instanceof Node ? body : h('p', null, body)) : null,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', value: 'cancel', 'data-act': 'cancel' }, cancel),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', 'data-act': 'ok' }, ok)));
    let done = false;
    const finish = (v) => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) finish(act === 'ok');
      else if (e.target === dlg) finish(false);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-act=ok]').focus();
  });
}

// Activity: "Ben interacted in the last 2 minutes and the tab is visible".
let lastInteraction = Date.now();
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) {
  window.addEventListener(ev, () => { lastInteraction = Date.now(); }, { passive: true, capture: true });
}
export function isActive() {
  return document.visibilityState === 'visible' && Date.now() - lastInteraction < 120000;
}

// Counts active seconds (visible + recent interaction) while a page is open.
export function activeTimer() {
  let secs = 0;
  const id = setInterval(() => { if (isActive()) secs += 1; }, 1000);
  return { get seconds() { return secs; }, reset() { secs = 0; }, stop() { clearInterval(id); } };
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.pending = () => t !== null;
  return d;
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage may be blocked; everything still works without it */ }
  return null;
}

export const PRIORITY = { 1: 'Core', 2: 'Useful', 3: 'Optional' };
export const TRACKS = { theory: 'Theory', code: 'Code', exam: 'Exam' };
