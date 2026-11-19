// Glossary: every term, its definition, and the lesson that introduces it. #/glossary?term=<key> jumps to one term.
import { h } from '../ui.js';
import { meta, lessonInfo } from '../api.js';
import { renderInline } from '../md.js';

const slug = (k) => 'term-' + k.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

export async function render(el, r) {
  el.dataset.title = 'Glossary';
  const m = await meta();
  const entries = Object.entries(m.glossary || {}).sort((a, b) => a[1].term.localeCompare(b[1].term, 'en', { sensitivity: 'base' }));
  const filter = h('input', { type: 'search', id: 'gl-filter', placeholder: 'Filter terms', 'aria-label': 'Filter terms', autocomplete: 'off', spellcheck: 'false' });
  const count = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const list = h('dl', { class: 'glossary-list', 'data-t': 'glossary' });
  const letters = new Map();
  for (const [k, v] of entries) {
    const L = (v.term[0] || '#').toUpperCase().replace(/[^A-Z]/, '#');
    if (!letters.has(L)) { letters.set(L, h('div', { class: 'gl-letter', id: 'gl-' + L }, L)); list.append(letters.get(L)); }
    const l = v.lesson ? lessonInfo(m, v.lesson) : null;
    const dt = h('dt', { id: slug(k), 'data-term': k }, h('span', { html: renderInline(v.term) }));
    const dd = h('dd', { 'data-term': k }, h('div', { html: renderInline(v.def) }),
      l ? h('div', { class: 'gl-lesson small' }, 'Introduced in ', l.ready ? h('a', { href: `#/lesson/${l.id}` }, l.title) : h('span', null, `${l.title} (coming soon)`),
        h('span', { class: 'muted' }, ` · ${l.unit.id.toUpperCase()}`)) : null);
    dt.dataset.letter = dd.dataset.letter = L;
    list.append(dt, dd);
  }
  const apply = () => {
    const q = filter.value.trim().toLowerCase();
    let n = 0;
    const shownLetters = new Set();
    for (const node of list.querySelectorAll('dt, dd')) {
      const k = node.dataset.term;
      const v = m.glossary[k];
      const hit = !q || k.includes(q) || String(v.def).toLowerCase().includes(q);
      node.hidden = !hit;
      if (hit && node.tagName === 'DT') { n += 1; shownLetters.add(node.dataset.letter); }
    }
    for (const [L, div] of letters) div.hidden = !shownLetters.has(L);
    count.textContent = q ? `${n} of ${entries.length} terms` : `${entries.length} terms`;
  };
  filter.addEventListener('input', apply);
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Glossary'),
    h('p', { class: 'sub' }, 'Every term the lessons define, with the lesson that introduces it.')),
  h('div', { class: 'row' }, filter, count)),
  h('nav', { class: 'gl-jump', 'aria-label': 'Jump to letter' }, [...letters.keys()].map((L) => h('a', { href: '#gl-' + L, onclick: (e) => { e.preventDefault(); letters.get(L).scrollIntoView(); } }, L))),
  h('div', { class: 'panel' }, list));
  apply();
  if (r.query.term) {
    const t = el.querySelector('#' + CSS.escape(slug(String(r.query.term).toLowerCase())));
    if (t) requestAnimationFrame(() => { t.scrollIntoView({ block: 'center' }); t.classList.add('gl-hit'); t.nextElementSibling?.classList.add('gl-hit'); });
  }
}
