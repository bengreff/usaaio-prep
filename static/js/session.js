// Today's session: walks through the plan's blocks in order. Kept in localStorage so a closed lid resumes it.
import { h, clear, store } from './ui.js';

const KEY = 'usaaio-session';
const KIND = { cards: 'Cards', review: 'Review', lesson: 'Lesson', problem: 'Problem', practice: 'Practice', quiz: 'Unit quiz', check: 'Progress check' };

function todayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

export function getSession() {
  const s = store(KEY);
  if (!s || s.date !== todayStr() || !Array.isArray(s.blocks)) return null;
  return s;
}
function save(s) { store(KEY, s); renderBar(); }

export function startSession(plan) {
  const s = { date: todayStr(), minutes: plan.minutes, blocks: plan.blocks, done: plan.blocks.map(() => false), i: 0, started: Date.now() };
  save(s);
  location.hash = blockRoute(s.blocks[0]);
}

export function endSession() { store(KEY, null); renderBar(); }

export function blockRoute(b) {
  switch (b.kind) {
    case 'cards': return `#/cards?ids=${encodeURIComponent(b.ids.join(','))}`;
    case 'review': return `#/review?ids=${encodeURIComponent(b.ids.join(','))}`;
    case 'lesson': return `#/lesson/${b.id}`;
    case 'problem': return `#/problem/${b.id}`;
    case 'practice': return `#/practice?unit=${b.unit}&n=${b.n}&start=1`;
    case 'quiz': return `#/quiz/${b.unit}`;
    case 'check': return '#/check';
    default: return '#/today';
  }
}

export function blockLabel(b) { return KIND[b.kind] || b.kind; }

export function sessionComplete(s = getSession()) { return !!s && s.done.every(Boolean); }

// Pages report finished work; it counts when it matches the session block now in progress.
export function blockDone(kind, id) {
  const s = getSession();
  if (!s) return;
  const b = s.blocks[s.i];
  const bid = b && (b.id || (b.kind === 'quiz' ? b.unit : null));
  if (!b || b.kind !== kind || (bid && id && bid !== id)) return;
  s.done[s.i] = true;
  save(s);
}

export function goNext() {
  const s = getSession();
  if (!s) return;
  s.done[s.i] = true;
  const nxt = s.done.findIndex((d) => !d);
  if (nxt === -1) { save(s); location.hash = '#/today'; return; }
  s.i = nxt;
  save(s);
  location.hash = blockRoute(s.blocks[nxt]);
}

export function goTo(k) {
  const s = getSession();
  if (!s || !s.blocks[k]) return;
  s.i = k;
  save(s);
  location.hash = blockRoute(s.blocks[k]);
}

function onCurrentBlock(s) {
  const b = s.blocks[s.i];
  if (!b) return false;
  const here = decodeURIComponent(location.hash), want = decodeURIComponent(blockRoute(b));
  // a quiz or check block's start page opens the running quiz at <route>/<mock id>
  return here === want || ((b.kind === 'quiz' || b.kind === 'check') && here.startsWith(want + '/'));
}

// The button shown at the end of a finished block ("Next: Lesson ...").
export function continueButton() {
  const s = getSession();
  if (!s) return null;
  const rest = s.done.map((d, k) => (!d && k !== s.i ? k : -1)).filter((k) => k >= 0);
  const nextK = rest.find((k) => k > s.i) ?? rest[0];
  const label = nextK === undefined ? 'Finish session' : `Next: ${blockLabel(s.blocks[nextK])}, ${s.blocks[nextK].title}`;
  return h('button', { class: 'btn primary session-next', type: 'button', onclick: goNext }, label);
}

export function renderBar() {
  const bar = document.getElementById('session-bar');
  const s = getSession();
  if (!s || !s.blocks.length) { bar.hidden = true; clear(bar); document.body.classList.remove('in-session'); return; }
  document.body.classList.add('in-session');
  bar.hidden = false;
  clear(bar);
  const nDone = s.done.filter(Boolean).length;
  const complete = nDone === s.blocks.length;
  const here = onCurrentBlock(s);
  const steps = h('ol', { class: 'session-steps', 'aria-label': 'Session blocks' }, s.blocks.map((b, k) =>
    h('li', null, h('button', {
      type: 'button', class: `step ${s.done[k] ? 'done' : ''} ${k === s.i && !complete ? 'current' : ''}`,
      'aria-current': k === s.i && !complete ? 'step' : null, title: `${blockLabel(b)}: ${b.title} (${b.minutes} min)`,
      onclick: () => goTo(k),
    }, h('span', { class: 'step-n', 'aria-hidden': 'true' }, s.done[k] ? '' : String(k + 1)), blockLabel(b)))));
  const pct = Math.round((nDone / s.blocks.length) * 100);
  const progress = h('div', { class: 'session-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Session progress' },
    h('div', { class: 'session-progress-fill', style: { width: pct + '%' } }));
  const cur = s.blocks[s.i];
  const actions = h('div', { class: 'session-actions' });
  if (complete) {
    actions.append(h('span', { class: 'session-done' }, 'Session complete'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { endSession(); location.hash = '#/today'; } }, 'Close'));
  } else {
    if (!here) actions.append(h('a', { class: 'btn small', href: blockRoute(cur) }, `Back to ${blockLabel(cur).toLowerCase()}`));
    actions.append(h('button', { class: `btn small ${s.done[s.i] ? 'primary' : ''}`, type: 'button', onclick: goNext, 'data-t': 'session-next' },
      s.done[s.i] ? 'Next block' : 'Skip to next'),
    h('button', { class: 'btn small ghost', type: 'button', onclick: () => { endSession(); location.hash = '#/today'; } }, 'End'));
  }
  bar.append(h('div', { class: 'session-inner' },
    h('span', { class: 'session-label' }, 'Session'), steps, progress, actions));
}
