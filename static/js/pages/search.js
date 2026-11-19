// Search (#/search?q=...): lesson titles and text, glossary terms and problem titles. The index is
// GET search_index (local: the server builds it from content/; public: data/search.json made at build time), loaded
// once per page load and searched here. "/" anywhere opens this page (app.js).
import { h, esc, debounce } from '../ui.js';
import { get } from '../api.js';

let cache = null;
function entries() {
  if (!cache) {
    cache = get('search_index')
      .then((r) => r.entries.map((e) => ({ ...e, lt: e.t.toLowerCase(), lx: (e.x || '').toLowerCase() })))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

function hits(text, tok, cap = 5) {
  let n = 0, i = text.indexOf(tok);
  while (i >= 0 && n < cap) { n += 1; i = text.indexOf(tok, i + tok.length); }
  return n;
}

/** Ranked matches: every word of the query must appear in the title or the text. */
export function search(list, q, limit = 60) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const whole = toks.join(' ');
  const out = [];
  for (const e of list) {
    let score = 0, ok = true;
    for (const t of toks) {
      const inT = e.lt.includes(t);
      const n = hits(e.lx, t);
      if (!inT && !n) { ok = false; break; }
      score += (inT ? (e.lt.startsWith(t) ? 30 : 15) : 0) + n;
    }
    if (!ok) continue;
    if (e.lt === whole) score += 60;
    else if (e.lt.includes(whole) && toks.length > 1) score += 20;
    score += e.k === 'term' ? 6 : e.k === 'problem' ? 3 : 0;
    out.push({ e, score });
  }
  out.sort((a, b) => b.score - a.score || a.e.t.localeCompare(b.e.t));
  return out.slice(0, limit);
}

function snippet(e, toks) {
  if (!e.x) return '';
  const first = toks.map((t) => e.lx.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const at = first === undefined ? 0 : first;
  const start = Math.max(0, at - 70);
  let s = e.x.slice(start, start + 220);
  if (start > 0) s = '... ' + s.replace(/^\S*\s/, '');
  if (start + 220 < e.x.length) s = s.replace(/\s\S*$/, '') + ' ...';
  let html = esc(s);
  const rx = toks.filter((t) => t.length > 1).map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (rx.length) html = html.replace(new RegExp(`(${rx.join('|')})`, 'gi'), '<mark>$1</mark>');
  return html;
}

const KIND = { lesson: 'Lesson', term: 'Glossary', problem: 'Problem' };
const href = (e) => (e.k === 'lesson' ? `#/lesson/${e.id}` : e.k === 'term' ? `#/glossary?term=${encodeURIComponent(e.id)}` : `#/problem/${e.id}`);

export async function render(el, r) {
  el.dataset.title = 'Search';
  const input = h('input', { type: 'search', id: 'search-q', class: 'search-input', placeholder: 'Search lessons, terms and problems',
    'aria-label': 'Search lessons, glossary terms and problems', autocomplete: 'off', spellcheck: 'false', value: r.query.q || '', 'data-t': 'search-input' });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite', 'data-t': 'search-status' });
  const list = h('ol', { class: 'search-results', 'data-t': 'search-results' });
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Search'),
    h('p', { class: 'sub' }, 'Lesson text and titles, glossary terms and coding problems. Press / on any page to come here.'))),
  h('div', { class: 'panel search-panel' }, h('form', { role: 'search', onsubmit: (e) => { e.preventDefault(); const a = list.querySelector('a'); if (a) a.click(); } }, input), status, list));
  let all;
  try { all = await entries(); } catch (e) { status.textContent = 'The search index did not load: ' + e.message; return; }
  const run = () => {
    const q = input.value.trim();
    history.replaceState(null, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
    list.replaceChildren();
    if (!q) { status.textContent = `${all.length} entries: ${all.filter((e) => e.k === 'lesson').length} lessons, ${all.filter((e) => e.k === 'term').length} terms, ${all.filter((e) => e.k === 'problem').length} problems.`; return; }
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const res = search(all, q);
    status.textContent = res.length ? `${res.length === 60 ? 'Top 60' : res.length} result${res.length === 1 ? '' : 's'}` : 'No results. Try fewer or shorter words.';
    for (const { e } of res) {
      list.append(h('li', null, h('a', { class: 'search-hit', href: href(e), 'data-kind': e.k },
        h('span', { class: 'search-top' }, h('span', { class: `chip ${e.k === 'term' ? 'accent' : e.k === 'problem' ? 'warn' : ''}` }, KIND[e.k]),
          h('span', { class: 'search-title' }, e.t), e.u ? h('span', { class: 'unit-id' }, e.u.toUpperCase()) : null),
        e.x ? h('span', { class: 'search-snip', html: snippet(e, toks) }) : null)));
    }
  };
  input.addEventListener('input', debounce(run, 120));
  run();
  requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
}
