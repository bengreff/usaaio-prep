// Entry: router, theme, heartbeat, glossary tooltips.
import { h, clear, errorBox, loading, toast } from './ui.js';
import { meta } from './api.js';
import './time.js';
import { setGlossary, glossaryEntry, renderInline } from './md.js';
import { renderBar } from './session.js';

const PAGES = {
  today: () => import('./pages/today.js'),
  learn: () => import('./pages/learn.js'),
  lesson: () => import('./pages/lesson.js'),
  practice: () => import('./pages/practice.js'),
  review: () => import('./pages/practice.js'),
  cards: () => import('./pages/cards.js'),
  code: () => import('./pages/code.js'),
  problem: () => import('./pages/code.js'),
  mock: () => import('./pages/mock.js'),
  quiz: () => import('./pages/quiz.js'),
  check: () => import('./pages/quiz.js'),
  progress: () => import('./pages/progress.js'),
  settings: () => import('./pages/settings.js'),
  search: () => import('./pages/search.js'),
  glossary: () => import('./pages/glossary.js'),
  summary: () => import('./pages/summary.js'),
  placement: () => import('./pages/placement.js'),
};
const NAV_OF = { lesson: 'learn', review: 'practice', problem: 'code', quiz: 'learn', check: 'progress', glossary: 'learn', summary: 'learn', placement: 'learn' };
const TITLES = { today: 'Today', learn: 'Learn', lesson: 'Lesson', practice: 'Practice', review: 'Review', cards: 'Cards',
  code: 'Code lab', problem: 'Problem', mock: 'Mock exam', quiz: 'Unit quiz', check: 'Progress check', progress: 'Progress',
  settings: 'Settings', search: 'Search', glossary: 'Glossary', summary: 'Summary sheet', placement: 'Placement quiz' };

// Pages that exist only in the public (browser-only) build.
if (window.STATIC_MODE) {
  Object.assign(PAGES, { about: () => import('./pages/about.js'), data: () => import('./pages/data.js') });
  Object.assign(TITLES, { about: 'About', data: 'Your progress data' });
}

const main = document.getElementById('main');
let cleanup = null;
let renderSeq = 0;
let routed = false;   // a page was shown before (route changes move focus to main)

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'today', args: parts.slice(1), query: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  const seq = ++renderSeq;
  const r = parseHash();
  if (cleanup) { try { await cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
  document.body.dataset.ready = '';
  document.body.dataset.page = r.name;
  const navName = NAV_OF[r.name] || r.name;
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === navName) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  renderBar();
  hideTip();
  closeNav();
  const load = PAGES[r.name];
  clear(main);
  main.className = '';
  if (!load) {
    main.append(h('div', { class: 'page' }, errorBox(new Error(`There is no page called "${r.name}".`)), h('p', null, h('a', { href: '#/today' }, 'Go to Today'))));
    document.body.dataset.ready = r.name;
    return;
  }
  const slow = setTimeout(() => { if (seq === renderSeq && !main.firstChild) main.append(loading()); }, 120);
  try {
    let mod;
    try { mod = await load(); } catch (e) {
      throw new Error('This page\'s code failed to load from the local server. Reload the page (Cmd+R).');
    }
    const container = h('div', { class: 'page' });
    const ret = await mod.render(container, r);
    clearTimeout(slow);
    if (seq !== renderSeq) { if (typeof ret === 'function') ret(); return; }
    clear(main);
    main.appendChild(container);
    cleanup = typeof ret === 'function' ? ret : null;
    // keyboard and screen reader users start the new page at its top, not on the link they used
    // (not on the first page of a visit: Tab should start at the skip link)
    const act = document.activeElement;
    if (routed && (!act || act === document.body || act.closest('.topbar'))) main.focus({ preventScroll: true });
    routed = true;
    document.title = `${container.dataset.title || TITLES[r.name] || 'Study'} · ${window.STATIC_MODE ? 'USAAIO Prep' : 'USAAIO'}`;
    window.scrollTo(0, 0);
  } catch (e) {
    clearTimeout(slow);
    if (seq !== renderSeq) return;
    clear(main);
    main.append(h('div', { class: 'page' }, errorBox(e, route)));
  }
  renderBar();
  document.body.dataset.ready = r.name;
}

// ---------------------------------------------------------------- theme
const THEMES = ['system', 'light', 'dark'];
const ICONS = {
  system: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/></g></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const btn = document.getElementById('theme-btn');
  btn.innerHTML = ICONS[t] + `<span class="sr-only">Theme: ${t}</span>`;
  btn.title = `Theme: ${t === 'system' ? 'follow the system' : t} (click to change)`;
  window.dispatchEvent(new CustomEvent('themechange'));
}
function initTheme() {
  let t = 'system';
  try { t = localStorage.getItem('usaaio-theme') || 'system'; } catch (e) { /* blocked */ }
  applyTheme(t);
  document.getElementById('theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || 'system';
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    try { if (next === 'system') localStorage.removeItem('usaaio-theme'); else localStorage.setItem('usaaio-theme', next); } catch (e) { /* blocked */ }
    applyTheme(next);
  });
}

// ---------------------------------------------------------------- glossary tooltip
const tip = document.getElementById('gloss-tip');
let tipFor = null, hideTimer = null;
function showTip(el) {
  const entry = glossaryEntry(el.dataset.term);
  if (!entry) return;
  clearTimeout(hideTimer);
  tipFor = el;
  tip.innerHTML = `<div class="gloss-term">${renderInline(entry.term)}</div><div class="gloss-def">${renderInline(entry.def)}</div>`;
  tip.hidden = false;
  tip.id = 'gloss-tip';
  el.setAttribute('aria-describedby', 'gloss-tip');
  const r = el.getBoundingClientRect();
  const tw = Math.min(360, window.innerWidth - 24);
  tip.style.maxWidth = tw + 'px';
  const left = Math.max(12, Math.min(r.left, window.innerWidth - tw - 12));
  tip.style.left = left + 'px';
  const th = tip.offsetHeight;
  const below = r.bottom + 8 + th < window.innerHeight;
  tip.style.top = (below ? r.bottom + 8 : r.top - th - 8) + window.scrollY + 'px';
}
function hideTip() {
  if (tipFor) tipFor.removeAttribute('aria-describedby');
  tipFor = null;
  tip.hidden = true;
}
document.addEventListener('mouseover', (e) => { const g = e.target.closest?.('.gloss'); if (g && g !== tipFor) showTip(g); });
document.addEventListener('mouseout', (e) => {
  const g = e.target.closest?.('.gloss');
  if (g && !g.contains(e.relatedTarget) && !tip.contains(e.relatedTarget)) hideTimer = setTimeout(hideTip, 150);
});
tip.addEventListener('mouseleave', () => { hideTimer = setTimeout(hideTip, 150); });
tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
document.addEventListener('focusin', (e) => { const g = e.target.closest?.('.gloss'); if (g) showTip(g); else if (tipFor) hideTip(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipFor) hideTip(); });

// ---------------------------------------------------------------- narrow screens: the nav collapses behind a Menu button
const navToggle = document.getElementById('nav-toggle');
function closeNav() {
  if (!navToggle || navToggle.getAttribute('aria-expanded') !== 'true') return;
  navToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('nav-open');
}
navToggle?.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') !== 'true';
  navToggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('nav-open', open);
  if (open) document.querySelector('#main-nav a')?.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') { closeNav(); navToggle.focus(); }
});

// ---------------------------------------------------------------- "/" opens search (not while typing)
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.closest?.('input, textarea, select, [contenteditable], .CodeMirror') || t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault();
  const box = document.getElementById('search-q');
  if (box) { box.focus(); box.select(); } else location.hash = '#/search';
});

// ---------------------------------------------------------------- heartbeat
// time.js counts active seconds per route and posts them to /api/time (every ~60 s, on route change, on tab hide).

// ---------------------------------------------------------------- start
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  toast(e.reason && e.reason.message ? e.reason.message : 'Something failed in the page.', 'error', 7000);
});
window.addEventListener('error', (e) => {
  if (e.message) toast('Page error: ' + e.message, 'error', 7000);
});

async function start() {
  try { sessionStorage.removeItem('usaaio-boot-retry'); } catch (e) { /* blocked */ }
  initTheme();
  try {
    const m = await meta();
    setGlossary(m.glossary);
    const cd = document.getElementById('countdown');
    const { countdownText } = await import('./pages/settings.js');
    cd.textContent = countdownText(m.days_to_round1);
    if (m.settings?.exam_date) cd.title = `Days until Round 1 (${m.settings.exam_date}; change it in Settings)`;
  } catch (e) { /* the page itself will show the error */ }
  if (window.STATIC_MODE) import('./local/sw_client.js').then((mod) => mod.register()).catch(() => { /* offline support is optional */ });
  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', '#/today');
  route();
}
start();

export { route };
