// NumPy broadcasting, one axis at a time from the right.
import { el, frame } from './_lib.js';

const tup = (s) => (s.length === 1 ? `(${s[0]},)` : `(${s.join(', ')})`);
const np = (s) => (s.length === 1 ? `(${s[0]},)` : `(${s.join(',')})`);
function parse(text) {
  const t = text.replace(/[()\[\]\s]/g, '');
  if (!t) return [];
  const parts = t.split(',').filter((x) => x !== '');
  if (!parts.every((x) => /^\d+$/.test(x))) return null;
  return parts.map(Number);
}

export function mount(host, params = {}) {
  frame(host, 'Broadcasting, step by step');
  let a = Array.isArray(params.a) ? params.a.slice() : [4, 1];
  let b = Array.isArray(params.b) ? params.b.slice() : [3];
  let step = 0;
  const inA = el('input', { type: 'text', value: a.join(', '), 'aria-label': 'Shape of a', spellcheck: 'false' });
  const inB = el('input', { type: 'text', value: b.join(', '), 'aria-label': 'Shape of b', spellcheck: 'false' });
  const stepBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Next axis');
  const allBtn = el('button', { class: 'btn small', type: 'button' }, 'Show all');
  const resetBtn = el('button', { class: 'btn small ghost', type: 'button' }, 'Reset');
  const grid = el('div', { class: 'bc-grid', role: 'table', 'aria-label': 'Shapes aligned from the right' });
  const log = el('ol', { class: 'bc-log', 'aria-live': 'polite' });
  const verdict = el('div', { class: 'bc-verdict', 'aria-live': 'polite' });
  host.append(
    el('div', { class: 'controls' }, el('label', null, 'a.shape', inA), el('label', null, 'b.shape', inB), stepBtn, allBtn, resetBtn),
    grid, log, verdict,
    el('style', null, `.bc-grid{display:grid;gap:6px;margin:12px 0 8px;justify-content:start;align-items:center}
      .bc-cell{min-width:44px;height:36px;display:grid;place-items:center;border:1.5px solid var(--border-strong);border-radius:7px;font-family:var(--font-mono);font-size:.95rem;background:var(--surface)}
      .bc-cell.implied{border-style:dashed;color:var(--muted)}.bc-cell.none{border-color:transparent;background:transparent}.bc-cell.todo{border-style:dashed;color:var(--muted);background:transparent}
      .bc-cell.active{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.bc-cell.stretch{background:var(--accent-soft);color:var(--accent)}
      .bc-cell.res{background:var(--ok-soft);border-color:var(--ok-line);color:var(--ok);font-weight:700}.bc-cell.bad{background:var(--bad-soft);border-color:var(--bad);color:var(--bad)}
      .bc-rowlabel{font-family:var(--font-mono);color:var(--text-2);padding-right:8px;font-size:.88rem}
      .bc-log{margin:6px 0;padding-left:1.3em;color:var(--text-2);font-size:.9rem}.bc-log li{margin:2px 0}
      .bc-verdict{font-weight:650;min-height:1.4em}.bc-verdict.ok{color:var(--ok)}.bc-verdict.bad{color:var(--bad)}`));

  function analyze() {
    const n = Math.max(a.length, b.length);
    const cols = [];
    for (let i = 1; i <= n; i++) {
      const da = a.length - i >= 0 ? a[a.length - i] : null;
      const db = b.length - i >= 0 ? b[b.length - i] : null;
      const xa = da ?? 1, xb = db ?? 1;
      let res = null, why;
      const ax = `axis ${-i}`;
      if (da === null) { res = xb; why = `${ax}: a has no axis here, so it counts as 1; the result takes b's ${xb}.`; }
      else if (db === null) { res = xa; why = `${ax}: b has no axis here, so it counts as 1; the result takes a's ${xa}.`; }
      else if (xa === xb) { res = xa; why = `${ax}: ${xa} and ${xb} are equal, keep ${xa}.`; }
      else if (xa === 1) { res = xb; why = `${ax}: a has 1, b has ${xb}; a stretches to ${xb}.`; }
      else if (xb === 1) { res = xa; why = `${ax}: a has ${xa}, b has 1; b stretches to ${xa}.`; }
      else { why = `${ax}: ${xa} and ${xb} differ and neither is 1.`; }
      cols.push({ da, db, res, why });
      if (res === null) break;
    }
    return { n, cols };
  }

  function draw() {
    const { n, cols } = analyze();
    const shown = cols.slice(0, step);
    grid.style.gridTemplateColumns = `auto repeat(${n}, 44px)`;
    grid.replaceChildren();
    const row = (label, vals, kind) => {
      grid.append(el('div', { class: 'bc-rowlabel', role: 'rowheader' }, label));
      for (let c = 0; c < n; c++) {
        const i = n - c; // 1-based from the right
        const info = cols[i - 1];
        const done = i <= step;
        const active = i === step;
        let v, cls = 'bc-cell';
        if (kind === 'res') {
          const reached = info || i <= cols.length;
          v = done && info ? (info.res ?? '?') : (i > cols.length ? '' : '?');
          cls += done && info ? (info.res === null ? ' bad' : ' res') : (i > cols.length ? ' none' : ' todo');
        } else {
          const arr = kind === 'a' ? a : b;
          const idx = arr.length - i;
          v = idx >= 0 ? arr[idx] : (done ? 1 : '');
          if (idx < 0) cls += done ? ' implied' : ' none';
          if (active) cls += ' active';
          if (done && info && info.res !== null && idx >= 0 && arr[idx] === 1 && info.res !== 1) cls += ' stretch';
          if (done && info && info.res === null) cls += ' bad';
        }
        grid.append(el('div', { class: cls, role: 'cell' }, String(v)));
      }
    };
    row('a', a, 'a');
    row('b', b, 'b');
    row('result', null, 'res');
    log.replaceChildren(...shown.map((c) => el('li', null, c.why)));
    const failed = shown.find((c) => c.res === null);
    const finished = step >= cols.length;
    verdict.className = 'bc-verdict';
    if (failed) {
      verdict.classList.add('bad');
      verdict.textContent = `ValueError: operands could not be broadcast together with shapes ${np(a)} ${np(b)}`;
    } else if (finished) {
      verdict.classList.add('ok');
      verdict.textContent = `Result shape ${tup(cols.map((c) => c.res).reverse())}`;
    } else verdict.textContent = '';
    stepBtn.disabled = finished;
    allBtn.disabled = finished;
  }
  const reread = () => {
    const pa = parse(inA.value), pb = parse(inB.value);
    inA.setAttribute('aria-invalid', pa ? 'false' : 'true');
    inB.setAttribute('aria-invalid', pb ? 'false' : 'true');
    if (!pa || !pb) { verdict.className = 'bc-verdict bad'; verdict.textContent = 'Shapes are lists of whole numbers, like 4, 1'; return; }
    a = pa; b = pb; step = 0; draw();
  };
  inA.addEventListener('change', reread);
  inB.addEventListener('change', reread);
  inA.addEventListener('keydown', (e) => { if (e.key === 'Enter') reread(); });
  inB.addEventListener('keydown', (e) => { if (e.key === 'Enter') reread(); });
  stepBtn.addEventListener('click', () => { step += 1; draw(); });
  allBtn.addEventListener('click', () => { step = analyze().cols.length; draw(); });
  resetBtn.addEventListener('click', () => { step = 0; draw(); });
  draw();
}
