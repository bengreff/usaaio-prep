// Drag b and a: the projection of b onto the line through a, and the residual, with numbers.
import { svg, el, frame, fmt, clamp, arrow } from './_lib.js';

export function mount(host, params = {}) {
  frame(host, 'Projection onto a line');
  let a = Array.isArray(params.a) ? params.a.slice(0, 2) : [3, 1];
  let b = Array.isArray(params.b) ? params.b.slice(0, 2) : [1.5, 3];
  const R = 5, S = 380, pad = 10;
  const sc = (S - 2 * pad) / (2 * R);
  const X = (x) => pad + (x + R) * sc, Y = (y) => pad + (R - y) * sc;
  const pic = svg('svg', { viewBox: `0 0 ${S} ${S}`, style: 'flex:0 1 400px;min-width:260px', role: 'group', 'aria-label': 'Projection plane. Focus a handle and use the arrow keys to move it.' });
  const read = el('div', { class: 'readout', 'aria-live': 'polite', style: 'flex:1 1 240px' });
  const wrap = el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start' }, pic, read);
  host.append(wrap, el('div', { class: 'small muted', style: 'margin-top:6px' }, 'Drag the tips of a and b, or focus one with Tab and use the arrow keys (Shift for bigger steps).'));

  const layer = svg('g');
  pic.append(layer);
  const handles = {};
  function handle(name, color) {
    const g = svg('g', { class: 'w-handle', tabindex: '0', role: 'slider', 'aria-label': `Tip of vector ${name}` },
      svg('circle', { class: 'ring', r: 11, fill: 'transparent', stroke: 'transparent' }),
      svg('circle', { r: 6, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    g.addEventListener('keydown', (e) => {
      const v = name === 'a' ? a : b;
      const st = e.shiftKey ? 0.5 : 0.1;
      const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
      if (!mv) return;
      e.preventDefault();
      v[0] = clamp(+(v[0] + mv[0]).toFixed(2), -R, R); v[1] = clamp(+(v[1] + mv[1]).toFixed(2), -R, R);
      if (name === 'a' && Math.hypot(...a) < 0.2) { v[0] -= mv[0]; v[1] -= mv[1]; }
      draw();
    });
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.focus();
      const move = (ev) => {
        const pt = pic.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
        const q = pt.matrixTransform(pic.getScreenCTM().inverse());
        const v = name === 'a' ? a : b;
        const nx = clamp((q.x - pad) / sc - R, -R, R), ny = clamp(R - (q.y - pad) / sc, -R, R);
        if (name === 'a' && Math.hypot(nx, ny) < 0.2) return;
        v[0] = Math.round(nx * 10) / 10; v[1] = Math.round(ny * 10) / 10;
        draw();
      };
      const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
    });
    handles[name] = g;
    return g;
  }
  const hA = handle('a', 'var(--c1)'), hB = handle('b', 'var(--c2)');

  function draw() {
    layer.replaceChildren();
    for (let i = -R; i <= R; i++) {
      layer.append(svg('line', { class: i === 0 ? 'w-axis' : 'w-grid', x1: X(i), x2: X(i), y1: Y(-R), y2: Y(R) }));
      layer.append(svg('line', { class: i === 0 ? 'w-axis' : 'w-grid', y1: Y(i), y2: Y(i), x1: X(-R), x2: X(R) }));
    }
    const aa = a[0] * a[0] + a[1] * a[1], ab = a[0] * b[0] + a[1] * b[1];
    const c = ab / aa, p = [c * a[0], c * a[1]], r = [b[0] - p[0], b[1] - p[1]];
    const na = Math.sqrt(aa), u = [a[0] / na, a[1] / na];
    // the line through a
    layer.append(svg('line', { x1: X(-u[0] * 8), y1: Y(-u[1] * 8), x2: X(u[0] * 8), y2: Y(u[1] * 8), stroke: 'var(--c1)', 'stroke-width': 1, 'stroke-dasharray': '2 5', opacity: 0.8 }));
    // right-angle marker at p
    const nr = Math.hypot(r[0], r[1]);
    if (nr > 0.25) {
      const s = 0.28, ur = [r[0] / nr, r[1] / nr];
      const k = c >= 0 ? -1 : 1;
      const q1 = [p[0] + k * u[0] * s, p[1] + k * u[1] * s], q2 = [q1[0] + ur[0] * s, q1[1] + ur[1] * s], q3 = [p[0] + ur[0] * s, p[1] + ur[1] * s];
      layer.append(svg('polyline', { points: [q1, q2, q3].map((q) => `${X(q[0])},${Y(q[1])}`).join(' '), fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.2 }));
    }
    layer.append(arrow(X(0), Y(0), X(a[0]), Y(a[1]), 'var(--c1)'));
    layer.append(arrow(X(0), Y(0), X(b[0]), Y(b[1]), 'var(--c2)'));
    layer.append(arrow(X(0), Y(0), X(p[0]), Y(p[1]), 'var(--c3)', { width: 4 }));
    layer.append(svg('line', { x1: X(p[0]), y1: Y(p[1]), x2: X(b[0]), y2: Y(b[1]), stroke: 'var(--c4)', 'stroke-width': 2.2, 'stroke-dasharray': '6 4' }));
    const lab = (v, t, color, dx = 8, dy = -8) => layer.append(svg('text', { x: X(v[0]) + dx, y: Y(v[1]) + dy, fill: color, 'font-size': 14, 'font-weight': 700, 'font-family': 'var(--font-ui)' }, t));
    lab(a, 'a', 'var(--c1)'); lab(b, 'b', 'var(--c2)'); lab(p, 'p', 'var(--c3)', 8, 16);
    lab([(p[0] + b[0]) / 2, (p[1] + b[1]) / 2], 'r', 'var(--c4)', 6, 4);
    hA.setAttribute('transform', `translate(${X(a[0])},${Y(a[1])})`);
    hB.setAttribute('transform', `translate(${X(b[0])},${Y(b[1])})`);
    hA.setAttribute('aria-valuetext', `a = (${fmt(a[0], 1)}, ${fmt(a[1], 1)})`);
    hB.setAttribute('aria-valuetext', `b = (${fmt(b[0], 1)}, ${fmt(b[1], 1)})`);
    layer.append(hA, hB);
    const dot = a[0] * r[0] + a[1] * r[1];
    read.innerHTML = [
      `<span style="color:var(--c1)">a</span> = (${fmt(a[0], 1)}, ${fmt(a[1], 1)})`,
      `<span style="color:var(--c2)">b</span> = (${fmt(b[0], 1)}, ${fmt(b[1], 1)})`,
      `a<sup>T</sup>b = <b>${fmt(ab)}</b>, a<sup>T</sup>a = <b>${fmt(aa)}</b>`,
      `coefficient a<sup>T</sup>b / a<sup>T</sup>a = <b>${fmt(c, 3)}</b>`,
      `<span style="color:var(--c3)">p</span> = coefficient &middot; a = (<b>${fmt(p[0])}</b>, <b>${fmt(p[1])}</b>)`,
      `<span style="color:var(--c4)">r</span> = b - p = (<b>${fmt(r[0])}</b>, <b>${fmt(r[1])}</b>)`,
      `a<sup>T</sup>r = <b>${fmt(dot, 3)}</b> (always 0: r is orthogonal to a)`,
      `|r| = <b>${fmt(nr, 3)}</b>, the distance from b to the line`,
    ].map((x) => `<div>${x}</div>`).join('');
  }
  draw();
}
