// Gradient descent on a quadratic: the learning rate decides between convergence, oscillation and divergence.
import { svg, el, frame, fmt, clamp, tex } from './_lib.js';

export function mount(host, params = {}) {
  frame(host, 'Gradient descent and the learning rate');
  let dim = params.dim === 2 ? 2 : 1;
  let lr = typeof params.lr === 'number' ? params.lr : 0.1;
  const steps = 20;
  const W = 560, H = 260;
  const slider = el('input', { type: 'range', min: '0.01', max: '1.2', step: '0.01', value: String(lr), 'aria-label': 'Learning rate' });
  const lrOut = el('b', { class: 'mono' }, '');
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Loss' },
    el('button', { type: 'button', 'data-d': '1' }, '1D'), el('button', { type: 'button', 'data-d': '2' }, '2D valley'));
  const pic = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const formula = el('div', { style: 'margin:4px 0;line-height:1.7' });
  const status = el('div', { class: 'status', 'aria-live': 'polite' });
  const readout = el('div', { class: 'readout' });
  host.append(el('div', { class: 'controls' }, seg, el('label', null, 'learning rate', slider, lrOut)), pic, status, formula, readout);

  seg.addEventListener('click', (e) => {
    const d = e.target.closest('button')?.dataset.d;
    if (!d) return;
    dim = +d;
    slider.max = dim === 1 ? '1.2' : '0.25';
    lr = clamp(lr, 0.01, +slider.max);
    if (dim === 2 && lr > 0.25) lr = 0.05;
    slider.value = String(lr);
    draw();
  });
  slider.addEventListener('input', () => { lr = +slider.value; draw(); });

  function classify(r) {
    const a = Math.abs(r);
    if (a < 1 - 1e-9) return r < 0 ? ['converges, but overshoots and zigzags', 'warn'] : ['converges smoothly', 'ok'];
    if (a <= 1 + 1e-9) return ['bounces between two points forever', 'warn'];
    return ['diverges: every step overshoots by more than it corrects', 'bad'];
  }

  function draw1() {
    // f(x) = x^2, f'(x) = 2x, so x_{t+1} = (1 - 2 lr) x_t
    const X = 6, Y = 40, L = 40, B = 26, T = 10;
    const sx = (x) => L + ((x + X) / (2 * X)) * (W - L - 10);
    const sy = (y) => T + (1 - clamp(y, 0, Y) / Y) * (H - T - B);
    pic.replaceChildren();
    pic.append(svg('line', { class: 'w-axis', x1: L, x2: W - 10, y1: sy(0), y2: sy(0) }), svg('line', { class: 'w-axis', x1: sx(0), x2: sx(0), y1: T, y2: H - B }));
    for (const x of [-6, -4, -2, 2, 4, 6]) pic.append(svg('text', { class: 'w-text', x: sx(x), y: H - 8, 'text-anchor': 'middle' }, String(x)));
    let d = '';
    for (let i = 0; i <= 200; i++) { const x = -X + (2 * X * i) / 200; d += `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(x * x).toFixed(1)}`; }
    pic.append(svg('path', { d, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 2 }));
    const r = 1 - 2 * lr;
    let x = 4.5;
    const xs = [x];
    for (let t = 0; t < steps; t++) { x = r * x; xs.push(x); }
    let path = '';
    xs.forEach((v, i) => { if (Math.abs(v) > 1e4) return; path += `${i ? 'L' : 'M'}${sx(clamp(v, -X * 1.05, X * 1.05)).toFixed(1)},${sy(v * v).toFixed(1)}`; });
    pic.append(svg('path', { d: path, fill: 'none', stroke: 'var(--c2)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    xs.forEach((v, i) => {
      if (Math.abs(v) > X * 1.05) return;
      pic.append(svg('circle', { cx: sx(v), cy: sy(v * v), r: i === 0 ? 5.5 : 4, fill: i === 0 ? 'var(--c1)' : 'var(--c2)', opacity: Math.max(0.35, 1 - i / (steps + 4)) }));
    });
    pic.setAttribute('aria-label', `Loss f(x) = x squared with ${steps} gradient steps from x = 4.5 at learning rate ${lr}`);
    const [msg, cls] = classify(r);
    status.className = `status ${cls}`;
    status.textContent = `lr = ${lr.toFixed(2)}: ${msg}.`;
    formula.innerHTML = `${tex(`x_{t+1} = x_t - \\eta f'(x_t) = (1 - 2\\eta)\\,x_t = ${fmt(r, 2)}\\,x_t`)}&nbsp;&nbsp; converges when ${tex('0 < \\eta < 1')}, zigzags when ${tex('\\eta > 0.5')}.`;
    readout.innerHTML = `start x = 4.50 &nbsp; after 5 steps x = <b>${fmt(xs[5], 3)}</b> &nbsp; after ${steps} steps x = <b>${fmt(xs[steps], 3)}</b>, loss <b>${fmt(xs[steps] ** 2, 3)}</b>`;
  }

  function draw2() {
    // f(x, y) = (x^2 + 10 y^2) / 2: gradient (x, 10 y); factors (1 - lr), (1 - 10 lr)
    const X = 6, Y = 3, L = 10, T = 10;
    const sx = (x) => L + ((x + X) / (2 * X)) * (W - 2 * L);
    const sy = (y) => T + (1 - (y + Y) / (2 * Y)) * (H - 2 * T);
    pic.replaceChildren();
    for (const c of [0.5, 2, 5, 10, 18]) {
      const rx = Math.sqrt(2 * c), ry = Math.sqrt((2 * c) / 10);
      pic.append(svg('ellipse', { cx: sx(0), cy: sy(0), rx: (rx / (2 * X)) * (W - 2 * L), ry: (ry / (2 * Y)) * (H - 2 * T), fill: 'none', stroke: 'var(--border-strong)', 'stroke-width': 1 }));
    }
    pic.append(svg('circle', { cx: sx(0), cy: sy(0), r: 3, fill: 'var(--muted)' }));
    let p = [-5.5, 1.6];
    const ps = [p];
    for (let t = 0; t < steps; t++) { p = [p[0] * (1 - lr), p[1] * (1 - 10 * lr)]; ps.push(p); }
    let d = '';
    ps.forEach((q, i) => { if (Math.abs(q[1]) > 50) return; d += `${i ? 'L' : 'M'}${sx(clamp(q[0], -X, X)).toFixed(1)},${sy(clamp(q[1], -Y * 1.1, Y * 1.1)).toFixed(1)}`; });
    pic.append(svg('path', { d, fill: 'none', stroke: 'var(--c2)', 'stroke-width': 1.8 }));
    ps.forEach((q, i) => { if (Math.abs(q[1]) <= Y * 1.05) pic.append(svg('circle', { cx: sx(q[0]), cy: sy(q[1]), r: i ? 3.5 : 5.5, fill: i ? 'var(--c2)' : 'var(--c1)' })); });
    pic.setAttribute('aria-label', `Contours of a narrow valley with gradient descent steps at learning rate ${lr}`);
    const r1 = 1 - lr, r2 = 1 - 10 * lr;
    const worst = Math.abs(r2) > Math.abs(r1) ? r2 : r1;
    const [msg, cls] = classify(worst);
    status.className = `status ${cls}`;
    status.textContent = `lr = ${lr.toFixed(2)}: ${msg}${Math.abs(r2) >= 1 ? ' along the steep y direction' : ''}.`;
    formula.innerHTML = `${tex('f(x,y) = \\tfrac12(x^2 + 10y^2)')}: each step multiplies x by ${tex(`1-\\eta = ${fmt(r1)}`)} and y by ${tex(`1-10\\eta = ${fmt(r2)}`)}. The steep direction sets the limit ${tex('\\eta < 0.2')}; the flat one sets the speed.`;
    readout.innerHTML = `after ${steps} steps (x, y) = (<b>${fmt(ps[steps][0], 3)}</b>, <b>${fmt(ps[steps][1], 3)}</b>)`;
  }

  function draw() {
    lrOut.textContent = lr.toFixed(2);
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.d === dim ? 'true' : 'false'));
    if (dim === 1) draw1(); else draw2();
  }
  draw();
}
