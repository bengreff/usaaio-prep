// Convolution output size: o = floor((n + 2p - k) / s) + 1, with the sliding window drawn.
import { svg, el, frame, tex, clamp } from './_lib.js';

export function mount(host, params = {}) {
  frame(host, 'Convolution output size');
  const st = { n: params.n ?? 7, k: params.k ?? 3, p: params.p ?? 0, s: params.s ?? 1 };
  let j = 0;
  const num = (name, label, min, max) => {
    const i = el('input', { type: 'number', min: String(min), max: String(max), value: String(st[name]), 'aria-label': label });
    i.addEventListener('input', () => { const v = parseInt(i.value, 10); if (!isNaN(v)) { st[name] = clamp(v, min, max); j = 0; draw(); } });
    return el('label', null, label, i);
  };
  const prev = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Previous output position' }, 'Prev');
  const next = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Next output position' }, 'Next');
  const W = 600;
  const pic = svg('svg', { viewBox: `0 0 ${W} 170`, role: 'img' });
  const formula = el('div', { style: 'margin:8px 0 4px;font-size:1.02rem' });
  const note = el('div', { class: 'readout', 'aria-live': 'polite' });
  host.append(el('div', { class: 'controls' }, num('n', 'input n', 1, 24), num('k', 'kernel k', 1, 11), num('p', 'padding p', 0, 5), num('s', 'stride s', 1, 6), prev, next),
    formula, pic, note);
  prev.addEventListener('click', () => { j -= 1; draw(); });
  next.addEventListener('click', () => { j += 1; draw(); });

  function draw() {
    const { n, k, p, s } = st;
    const total = n + 2 * p;
    const o = total >= k ? Math.floor((total - k) / s) + 1 : 0;
    j = o ? ((j % o) + o) % o : 0;
    prev.disabled = next.disabled = o <= 1;
    formula.innerHTML = tex(`o = \\left\\lfloor \\frac{n + 2p - k}{s} \\right\\rfloor + 1 = \\left\\lfloor \\frac{${n} + ${2 * p} - ${k}}{${s}} \\right\\rfloor + 1 = ${o}`);
    const cell = Math.min(38, (W - 20) / Math.max(total, 1));
    const x0 = (W - cell * total) / 2;
    const oy = 118, iy = 22;
    pic.replaceChildren();
    pic.append(svg('text', { class: 'w-text', x: 4, y: iy - 6 }, 'input (padded)'), svg('text', { class: 'w-text', x: 4, y: oy - 6 }, `output (${o})`));
    for (let i = 0; i < total; i++) {
      const pad = i < p || i >= p + n;
      const inWin = o && i >= j * s && i < j * s + k;
      pic.append(svg('rect', { x: x0 + i * cell + 1, y: iy, width: cell - 2, height: cell - 2, rx: 4,
        fill: inWin ? 'var(--accent-soft)' : pad ? 'transparent' : 'var(--surface-2)', stroke: inWin ? 'var(--accent)' : 'var(--border-strong)',
        'stroke-dasharray': pad ? '3 3' : null, 'stroke-width': inWin ? 2 : 1 }));
      if (cell > 16) pic.append(svg('text', { class: 'w-text', x: x0 + i * cell + cell / 2, y: iy + cell / 2 + 4, 'text-anchor': 'middle' }, pad ? '0' : `x${i - p}`));
    }
    if (o) {
      const ox0 = (W - cell * o) / 2;
      for (let q = 0; q < o; q++) {
        pic.append(svg('rect', { x: ox0 + q * cell + 1, y: oy, width: cell - 2, height: cell - 2, rx: 4, fill: q === j ? 'var(--ok-soft)' : 'var(--surface-2)',
          stroke: q === j ? 'var(--ok)' : 'var(--border-strong)', 'stroke-width': q === j ? 2 : 1 }));
        if (cell > 16) pic.append(svg('text', { class: 'w-text', x: ox0 + q * cell + cell / 2, y: oy + cell / 2 + 4, 'text-anchor': 'middle' }, `y${q}`));
      }
      const wl = x0 + j * s * cell, wr = wl + k * cell, oc = ox0 + j * cell + cell / 2;
      pic.append(svg('path', { d: `M${wl + 2},${iy + cell} L${oc},${oy - 2} L${wr - 2},${iy + cell}`, fill: 'var(--accent-soft)', stroke: 'var(--accent)', 'stroke-width': 1.2, opacity: 0.7 }));
    }
    pic.setAttribute('aria-label', `Input of length ${n} with padding ${p}, kernel ${k}, stride ${s}; output length ${o}. Window ${j + 1} covers padded cells ${j * s} to ${j * s + k - 1}.`);
    const left = total >= k ? (total - k) % s : 0;
    const lines = [];
    if (!o) lines.push(`<span style="color:var(--bad)">The kernel (${k}) is longer than the padded input (${total}): no output.</span>`);
    else {
      lines.push(`window ${j + 1} of ${o} covers padded positions ${j * s} to ${j * s + k - 1}`);
      if (left) lines.push(`<span style="color:var(--warn)">The last ${left} padded cell${left > 1 ? 's are' : ' is'} never used: the floor drops a partial window.</span>`);
      if (s === 1 && p === (k - 1) / 2) lines.push('Same padding: p = (k - 1) / 2 with stride 1 keeps o = n.');
    }
    lines.push('<span class="muted">2D images: apply the formula to height and width separately.</span>');
    note.innerHTML = lines.map((x) => `<div>${x}</div>`).join('');
  }
  host.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') { j += 1; draw(); } else if (e.key === 'ArrowLeft') { j -= 1; draw(); }
  });
  draw();
}
