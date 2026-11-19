// Two overlapping score distributions and a threshold: live confusion matrix, precision, recall, F1.
import { svg, el, frame, fmt, mulberry32, normal } from './_lib.js';

export function mount(host, params = {}) {
  frame(host, 'Threshold, confusion matrix, precision and recall');
  const nPos = params.pos || 40, nNeg = params.neg || 60, sep = params.sep ?? 2;
  const rand = mulberry32(params.seed || 7);
  const pts = [];
  for (let i = 0; i < nPos; i++) pts.push({ y: 1, s: sep / 2 + normal(rand) });
  for (let i = 0; i < nNeg; i++) pts.push({ y: 0, s: -sep / 2 + normal(rand) });
  let t = typeof params.t === 'number' ? params.t : 0.5;
  const W = 600, H = 250, L = 20, Rr = 20, lo = -4, hi = 4, bin = 0.25, mid = 128;
  const sx = (v) => L + ((v - lo) / (hi - lo)) * (W - L - Rr);
  const slider = el('input', { type: 'range', min: '-3', max: '3', step: '0.05', value: String(t), 'aria-label': 'Threshold' });
  const tOut = el('b', { class: 'mono' });
  const pic = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const table = el('div');
  const metrics = el('div', { class: 'readout', 'aria-live': 'polite' });
  host.append(el('div', { class: 'controls' }, el('label', null, 'threshold', slider, tOut),
    el('span', { class: 'small muted' }, 'Predict positive when score is at least the threshold.')),
  pic, el('div', { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;margin-top:6px' }, table, metrics));
  slider.addEventListener('input', () => { t = +slider.value; draw(); });

  // stack dots per bin: positives grow up from the midline, negatives grow down
  const stacks = new Map();
  for (const p of pts) {
    const b = Math.floor((Math.max(lo, Math.min(hi - 1e-9, p.s)) - lo) / bin);
    const key = `${p.y}:${b}`;
    const n = stacks.get(key) || 0;
    stacks.set(key, n + 1);
    p.bx = lo + (b + 0.5) * bin;
    p.k = n;
  }
  const r = 5.2, gap = 11;

  function draw() {
    tOut.textContent = t.toFixed(2);
    pic.replaceChildren();
    pic.append(svg('rect', { x: sx(t), y: 6, width: Math.max(0, sx(hi) - sx(t)), height: H - 34, fill: 'var(--accent-soft)' }));
    pic.append(svg('text', { class: 'w-text', x: Math.min(sx(t) + 6, W - 120), y: 20 }, 'predicted positive'));
    pic.append(svg('text', { class: 'w-text', x: Math.max(sx(t) - 6, 110), y: 20, 'text-anchor': 'end' }, 'predicted negative'));
    pic.append(svg('line', { class: 'w-axis', x1: L, x2: W - Rr, y1: mid, y2: mid }));
    for (let v = -4; v <= 4; v += 2) pic.append(svg('text', { class: 'w-text', x: sx(v), y: H - 10, 'text-anchor': 'middle' }, String(v)));
    pic.append(svg('text', { class: 'w-text', x: L, y: mid - 8 }, 'actual positive'), svg('text', { class: 'w-text', x: L, y: mid + 18 }, 'actual negative'));
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const p of pts) {
      const predPos = p.s >= t;
      const kind = p.y ? (predPos ? 'tp' : 'fn') : (predPos ? 'fp' : 'tn');
      if (kind === 'tp') tp++; else if (kind === 'fp') fp++; else if (kind === 'fn') fn++; else tn++;
      const color = { tp: 'var(--ok)', fn: 'var(--bad)', fp: 'var(--c5)', tn: 'var(--muted)' }[kind];
      const cx = sx(p.bx), cy = p.y ? mid - 8 - p.k * gap : mid + 26 + p.k * gap;
      if (p.y) pic.append(svg('circle', { cx, cy, r, fill: color }));
      else pic.append(svg('rect', { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, rx: 1.5, fill: 'none', stroke: color, 'stroke-width': 2 }));
    }
    pic.append(svg('line', { x1: sx(t), x2: sx(t), y1: 6, y2: H - 28, stroke: 'var(--accent)', 'stroke-width': 2.5 }));
    pic.setAttribute('aria-label', `Scores of ${nPos} positives (circles) and ${nNeg} negatives (squares) with threshold ${t.toFixed(2)}: TP ${tp}, FP ${fp}, FN ${fn}, TN ${tn}.`);
    const prec = tp + fp ? tp / (tp + fp) : NaN, rec = tp / (tp + fn), f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : NaN;
    const acc = (tp + tn) / pts.length, fpr = fp / (fp + tn);
    const sw = (c, txt) => `<span style="color:${c};font-weight:700">${txt}</span>`;
    table.innerHTML = `<table class="matrix" aria-label="Confusion matrix"><tr><th></th><th>predicted +</th><th>predicted -</th></tr>
      <tr><th>actual +</th><td>${sw('var(--ok)', 'TP ' + tp)}</td><td>${sw('var(--bad)', 'FN ' + fn)}</td></tr>
      <tr><th>actual -</th><td>${sw('var(--c5)', 'FP ' + fp)}</td><td>${sw('var(--muted)', 'TN ' + tn)}</td></tr></table>`;
    metrics.innerHTML = [
      `precision = TP / (TP + FP) = ${tp}/${tp + fp} = <b>${isNaN(prec) ? 'undefined' : fmt(prec, 3)}</b>`,
      `recall = TP / (TP + FN) = ${tp}/${tp + fn} = <b>${fmt(rec, 3)}</b>`,
      `F1 = 2PR / (P + R) = <b>${isNaN(f1) ? 'undefined' : fmt(f1, 3)}</b>`,
      `accuracy = (TP + TN) / ${pts.length} = <b>${fmt(acc, 3)}</b>`,
      `false positive rate = FP / (FP + TN) = <b>${fmt(fpr, 3)}</b>`,
      `<span class="muted">Raise the threshold: precision tends up, recall down.</span>`,
    ].map((x) => `<div>${x}</div>`).join('');
  }
  draw();
}
