// Shared helpers for the lesson widgets. SVG drawn with CSS variables, so both themes work without redraws.
const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  for (const c of kids) if (c !== null && c !== undefined) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

export function frame(host, title) {
  host.classList.add('widget');
  host.replaceChildren(el('div', { class: 'widget-title' }, title));
  return host;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rand) {
  const u = Math.max(1e-12, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function fmt(x, d = 2) {
  if (!isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'nan';
  if (Math.abs(x) >= 1e5) return x.toExponential(1);
  const s = x.toFixed(d);
  return s === '-' + (0).toFixed(d) ? (0).toFixed(d) : s;
}

// Line with a filled arrowhead, colored by a CSS variable name.
export function arrow(x1, y1, x2, y2, color, { width = 2.5, dash = null, head = 10 } = {}) {
  const g = svg('g');
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 1e-6) return g;
  const ux = dx / len, uy = dy / len;
  const hx = x2 - ux * head, hy = y2 - uy * head;
  g.append(svg('line', { x1, y1, x2: len > head ? hx : x2, y2: len > head ? hy : y2, stroke: color, 'stroke-width': width, 'stroke-dasharray': dash, 'stroke-linecap': 'round' }));
  if (len > head * 0.8) {
    const px = -uy * head * 0.45, py = ux * head * 0.45;
    g.append(svg('polygon', { points: `${x2},${y2} ${hx + px},${hy + py} ${hx - px},${hy - py}`, fill: color }));
  }
  return g;
}

export function tex(src) {
  try { return window.katex ? katex.renderToString(src, { throwOnError: false, strict: 'ignore' }) : src; } catch (e) { return src; }
}
