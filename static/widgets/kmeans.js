// k-means one half-step at a time: assign every point to its nearest center, then move each center to its mean.
import { svg, el, frame, fmt, mulberry32, normal } from './_lib.js';

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross'];

function marker(shape, x, y, r, color, filled = true) {
  const a = { fill: filled ? color : 'none', stroke: color, 'stroke-width': filled ? 0 : 2 };
  if (shape === 'circle') return svg('circle', { cx: x, cy: y, r, ...a });
  if (shape === 'square') return svg('rect', { x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8, ...a });
  if (shape === 'triangle') return svg('polygon', { points: `${x},${y - r * 1.1} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`, ...a });
  if (shape === 'diamond') return svg('polygon', { points: `${x},${y - r * 1.2} ${x + r},${y} ${x},${y + r * 1.2} ${x - r},${y}`, ...a });
  return svg('path', { d: `M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`, stroke: color, 'stroke-width': 2.4 });
}

export function mount(host, params = {}) {
  frame(host, 'k-means, step by step');
  let k = Math.min(5, Math.max(2, params.k || 3));
  let seed = params.seed || 3;
  const rand0 = mulberry32(11);
  const centers0 = [[2.2, 2.4], [7.4, 3.0], [4.4, 7.4]];
  const pts = [];
  centers0.forEach((c) => { for (let i = 0; i < 11; i++) pts.push([c[0] + 0.95 * normal(rand0), c[1] + 0.95 * normal(rand0)]); });
  let C, assign, phase, iter, done, ghosts;
  const W = 420, pad = 14, sc = (W - 2 * pad) / 10;
  const X = (x) => pad + x * sc, Y = (y) => W - pad - y * sc;
  const pic = svg('svg', { viewBox: `0 0 ${W} ${W}`, style: 'flex:0 1 400px;min-width:260px', role: 'img' });
  const stepBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Step');
  const runBtn = el('button', { class: 'btn small', type: 'button' }, 'Run to the end');
  const newBtn = el('button', { class: 'btn small ghost', type: 'button' }, 'New random start');
  const kSel = el('select', { 'aria-label': 'Number of clusters k' }, [2, 3, 4, 5].map((v) => el('option', { value: String(v), selected: v === k || null }, String(v))));
  const read = el('div', { class: 'readout', 'aria-live': 'polite', style: 'flex:1 1 240px' });
  host.append(el('div', { class: 'controls' }, el('label', null, 'k', kSel), stepBtn, runBtn, newBtn),
    el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start' }, pic, read));

  function reset() {
    const r = mulberry32(seed);
    const idx = [];
    while (idx.length < k) { const i = Math.floor(r() * pts.length); if (!idx.includes(i)) idx.push(i); }
    C = idx.map((i) => pts[i].slice());
    assign = pts.map(() => -1);
    phase = 'assign'; iter = 0; done = false; ghosts = [];
    draw();
  }
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
  const inertia = () => pts.reduce((s, p, i) => s + (assign[i] >= 0 ? d2(p, C[assign[i]]) : 0), 0);

  function step() {
    if (done) return;
    ghosts = [];
    if (phase === 'assign') {
      const next = pts.map((p) => { let b = 0; C.forEach((c, j) => { if (d2(p, c) < d2(p, C[b])) b = j; }); return b; });
      const changed = next.some((v, i) => v !== assign[i]);
      assign = next;
      iter += 1;
      if (!changed && iter > 1) done = true;
      phase = 'update';
    } else {
      ghosts = C.map((c) => c.slice());
      C = C.map((c, j) => {
        const mine = pts.filter((_, i) => assign[i] === j);
        return mine.length ? [mine.reduce((s, p) => s + p[0], 0) / mine.length, mine.reduce((s, p) => s + p[1], 0) / mine.length] : c;
      });
      phase = 'assign';
    }
    draw();
  }

  function draw() {
    pic.replaceChildren();
    for (let i = 0; i <= 10; i += 2) {
      pic.append(svg('line', { class: 'w-grid', x1: X(i), x2: X(i), y1: Y(0), y2: Y(10) }), svg('line', { class: 'w-grid', y1: Y(i), y2: Y(i), x1: X(0), x2: X(10) }));
    }
    const col = (j) => `var(--c${(j % 5) + 1})`;
    if (phase === 'update' && !done) pts.forEach((p, i) => pic.append(svg('line', { x1: X(p[0]), y1: Y(p[1]), x2: X(C[assign[i]][0]), y2: Y(C[assign[i]][1]), stroke: col(assign[i]), 'stroke-width': 1, opacity: 0.35 })));
    pts.forEach((p, i) => pic.append(assign[i] < 0 ? svg('circle', { cx: X(p[0]), cy: Y(p[1]), r: 4.5, fill: 'var(--muted)', opacity: 0.6 })
      : marker(SHAPES[assign[i]], X(p[0]), Y(p[1]), 4.6, col(assign[i]))));
    ghosts.forEach((g, j) => {
      pic.append(svg('line', { x1: X(g[0]), y1: Y(g[1]), x2: X(C[j][0]), y2: Y(C[j][1]), stroke: col(j), 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
      pic.append(svg('circle', { cx: X(g[0]), cy: Y(g[1]), r: 6, fill: 'none', stroke: col(j), 'stroke-dasharray': '2 2', opacity: 0.7 }));
    });
    C.forEach((c, j) => {
      pic.append(svg('circle', { cx: X(c[0]), cy: Y(c[1]), r: 11, fill: 'var(--surface)', stroke: col(j), 'stroke-width': 3 }));
      pic.append(marker(SHAPES[j], X(c[0]), Y(c[1]), 4.5, col(j)));
    });
    pic.setAttribute('aria-label', `${pts.length} points and ${k} centers, iteration ${iter}, ${done ? 'converged' : 'next: ' + phase}`);
    const sizes = C.map((_, j) => assign.filter((a) => a === j).length);
    read.innerHTML = [
      `<div class="status ${done ? 'ok' : ''}">${done ? `Converged after ${iter - 1} full iteration${iter - 1 === 1 ? '' : 's'}: no point changed cluster.` : `Next: ${phase === 'assign' ? '<b>assign</b> each point to its nearest center' : '<b>update</b> each center to the mean of its points'}`}</div>`,
      `<div>iteration ${iter}</div>`,
      assign[0] >= 0 ? `<div>inertia (sum of squared distances) = <b>${fmt(inertia(), 2)}</b></div>` : '<div>inertia: assign first</div>',
      assign[0] >= 0 ? `<div>cluster sizes: ${sizes.map((n, j) => `<span style="color:${col(j)};font-weight:700">${n}</span>`).join(', ')}</div>` : '',
      '<div class="muted" style="margin-top:6px">Each half-step can only lower the inertia, so k-means always stops, but a bad start can stop at a worse answer. Try a few random starts.</div>',
    ].join('');
    stepBtn.textContent = done ? 'Done' : phase === 'assign' ? 'Assign points' : 'Move centers';
    stepBtn.disabled = runBtn.disabled = done;
  }
  stepBtn.addEventListener('click', step);
  runBtn.addEventListener('click', () => { let g = 0; while (!done && g++ < 200) step(); });
  newBtn.addEventListener('click', () => { seed += 1; reset(); });
  kSel.addEventListener('change', () => { k = +kSel.value; reset(); });
  reset();
}
