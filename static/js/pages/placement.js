// Placement quiz (public build; on the local site only when meta.features.placement): a fixed paper the build picked
// (one or two questions per Round 1 content unit), run by the Part 1 runner in mock.js at #/placement/<mock id>.
// The results give each unit an advice (skip, skim or learn) and can mark the "skip" units as tested out:
// the Today planner then skips their lessons; practice and progress checks still use their questions.
import { h, toast, plural } from '../ui.js';
import { get, post, meta, invalidateMeta, unitInfo } from '../api.js';
import { runMock, mockRoute } from './mock.js';

export async function render(el, r) {
  if (r.args[0]) return runMock(el, r.args[0], r);
  el.dataset.title = 'Placement quiz';
  const [m, { mocks }] = await Promise.all([meta(true), get('mocks')]);
  el.append(h('div', { class: 'page-head' }, h('div', null,
    h('div', { class: 'eyebrow' }, 'Where to start'), h('h1', null, 'Placement quiz'),
    h('p', { class: 'sub' }, 'One or two questions from each Round 1 unit. The results say, unit by unit, what you can skip, skim or should learn.')),
  h('a', { class: 'btn', href: '#/learn' }, 'Learn map')));
  if (!m.features?.placement) {
    el.append(h('div', { class: 'panel empty' }, h('h2', null, 'No placement quiz here'),
      h('p', null, 'The placement quiz is part of the public course. On this site, start from Today.'), h('a', { class: 'btn', href: '#/today' }, 'Today')));
    return;
  }
  const mine = mocks.filter((x) => x.kind === 'placement').sort((a, b) => (b.started || '').localeCompare(a.started || ''));
  const open = mine.find((x) => !x.finished);
  const last = mine.find((x) => x.finished);
  let live = null;
  if (open) { try { const v = await get('mock/' + open.id); if (v.now < v.part1_ends) live = v; } catch (e) { /* none */ } }
  const out = m.settings?.tested_out || [];
  const panel = h('div', { class: 'panel quiz-start' },
    h('dl', { class: 'quiz-facts' },
      h('dt', null, 'Questions'), h('dd', null, 'About 20, difficulty 2 and 3, from units U01 to U12. 2 minutes each, on a clock.'),
      h('dt', null, 'Scoring'), h('dd', null, 'Right or not right. Leave a question blank if you do not know it: a guess that happens to be right would skip a unit you need.'),
      h('dt', null, 'Afterwards'), h('dd', null, 'Advice for each unit, and one button to mark the units you can skip as tested out. You can undo it any time in Settings.')),
    out.length ? h('p', { class: 'muted small', 'data-t': 'tested-out-now' }, `Tested out now: ${out.map((u) => u.toUpperCase()).join(', ')}. `, h('a', { href: '#/settings' }, 'Change in Settings')) : null);
  if (live) {
    panel.append(h('div', { class: 'verdict blank quiz-running' }, h('strong', null, 'A placement quiz is running: '),
      `${Math.ceil((live.part1_ends - live.now) / 60)} min left. `, h('a', { class: 'btn small primary', href: mockRoute(live) }, 'Resume')));
  } else {
    const btn = h('button', { class: 'btn primary big', type: 'button', 'data-t': 'placement-start', onclick: async () => {
      btn.disabled = true;
      try { const v = await post('mock/start', { kind: 'placement' }); location.hash = mockRoute(v); } catch (e) { btn.disabled = false; toast('Could not start: ' + e.message, 'error', 7000); }
    } }, last ? 'Take it again' : 'Start the placement quiz');
    panel.append(h('div', { class: 'start-row' }, btn, h('span', { class: 'muted' }, 'The clock starts when you press it.')));
  }
  if (last) panel.append(h('p', null, h('a', { href: mockRoute(last), 'data-t': 'placement-last' }, 'See your last result')));
  el.append(panel, h('p', { class: 'muted small', style: { marginTop: '14px' } },
    'Starting fresh? Skip this and begin with ', h('a', { href: '#/lesson/u00-l01' }, 'lesson 1'), ', which explains the contest and this site.'));
}

// Advice for one unit from its placement answers.
export function advise(n, right) {
  if (n >= 2 && right === n) return { rec: 'skip', reason: `${n === 2 ? 'Both' : `All ${n}`} right, including a typical Round 1 question. You can test out of this unit.` };
  if (right > 0 && n === 1) return { rec: 'skim', reason: 'Right, but one question is not enough to skip a unit. Skim the lessons and do their questions.' };
  if (right > 0) return { rec: 'skim', reason: `${right} of ${n} right. Skim the lessons and spend time where the questions feel hard.` };
  return { rec: 'learn', reason: n === 1 ? 'Not right. Work through the lessons.' : n === 2 ? 'Neither right. Work through the lessons.' : `None of ${n} right. Work through the lessons.` };
}
const LABEL = { skip: 'Skip', skim: 'Skim', learn: 'Learn' };
const CHIP = { skip: 'ok', skim: 'warn', learn: 'accent' };

// The results panel (called by mock.js for a finished placement quiz). p1: the scored questions.
export async function results(box, p1, m) {
  const byUnit = new Map();
  for (const x of p1) { const u = x.unit || x.id.slice(0, 3); const r = byUnit.get(u) || { n: 0, right: 0 }; r.n += 1; if (x.correct === true) r.right += 1; byUnit.set(u, r); }
  const rows = [...byUnit].sort((a, b) => a[0].localeCompare(b[0])).map(([uid, r]) => ({ uid, ...r, ...advise(r.n, r.right), unit: unitInfo(m, uid) }));
  const skip = rows.filter((r) => r.rec === 'skip').map((r) => r.uid);
  const right = p1.filter((x) => x.correct === true).length;
  const state = h('div', { class: 'row', 'data-t': 'testout-state' });
  let current = new Set((await meta(true)).settings?.tested_out || []);
  const save = async (list) => {
    await post('settings', { tested_out: [...list] });
    invalidateMeta();
    current = new Set(list);
    draw();
  };
  function draw() {
    state.replaceChildren();
    const marked = skip.filter((u) => current.has(u));
    if (!skip.length) { state.append(h('span', { class: 'muted' }, 'No unit is a clear skip this time. The planner keeps every unit in order.')); return; }
    if (marked.length === skip.length) {
      state.append(h('span', { class: 'verdict ok', style: { margin: 0 } }, h('strong', null, 'Tested out: '), skip.map((u) => u.toUpperCase()).join(', '), '. Today skips these lessons.'),
        h('button', { class: 'btn small', type: 'button', 'data-t': 'testout-undo', onclick: () => save([...current].filter((u) => !skip.includes(u))).then(() => toast('Undone. The planner includes those units again.', 'ok')) }, 'Undo'));
      return;
    }
    state.append(h('button', { class: 'btn primary', type: 'button', 'data-t': 'testout', onclick: () => save([...new Set([...current, ...skip])]).then(() => toast(`Marked ${plural(skip.length, 'unit')} as tested out.`, 'ok')) },
      `Mark ${plural(skip.length, 'unit')} as tested out`),
    h('span', { class: 'muted small' }, 'The planner skips their lessons; their questions still come up in practice and progress checks.'));
  }
  draw();
  box.replaceChildren(h('div', { class: 'panel', 'data-t': 'placement-results' },
    h('div', { class: 'score-pair' }, h('div', null, h('div', { class: 'res-h' }, 'Right'),
      h('div', { class: 'score-big' }, h('b', null, String(right)), h('span', null, `/ ${p1.length}`)))),
    h('h2', { style: { marginTop: '14px' } }, 'Advice by unit'),
    h('div', { class: 'table-wrap', style: { margin: '0 0 14px' } }, h('table', { class: 'mock-table placement-table' },
      h('thead', null, h('tr', null, ['Unit', 'Right', 'Advice', 'Why'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map((r) => h('tr', { 'data-unit': r.uid, 'data-rec': r.rec },
        h('td', null, h('span', { class: 'unit-id' }, r.uid.toUpperCase()), ' ', r.unit ? r.unit.title : ''),
        h('td', { class: 'num' }, `${r.right} / ${r.n}`),
        h('td', null, h('span', { class: `chip ${CHIP[r.rec]}` }, LABEL[r.rec])),
        h('td', { class: 'small' }, r.reason)))))),
    state,
    h('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Whatever the advice, read U00 (Start here) first: it covers the contest format, the scoring and how to use this site. ',
      h('a', { href: '#/today' }, 'Go to Today'), ' for your first session.')));
}
