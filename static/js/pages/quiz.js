// Unit quizzes (#/quiz/<unit>) and progress checks (#/check): a start page, then the Part 1 runner from mock.js
// at #/quiz/<unit>/<mock id> or #/check/<mock id>. Session blocks of kind quiz/check open the start page.
import { h, fmtPoints, fmtDate, toast, plural, TRACKS } from '../ui.js';
import { get, post, meta, unitInfo } from '../api.js';
import { runMock, mockRoute, projected, QUIZ_PASS, QUIZ_N, CHECK_N } from './mock.js';

export async function render(el, r) {
  if (r.name === 'check') return r.args[0] ? runMock(el, r.args[0], r) : checkStart(el);
  if (r.args[1]) return runMock(el, r.args[1], r);
  if (r.args[0]) return quizStart(el, r.args[0]);
  location.replace('#/learn'); // the unit quizzes live on the Learn map
  return undefined;
}

// The newest unfinished quiz or check of this kind: {view, live} or null. An unfinished one past its end time is
// scored when it is opened (mock.js finishes it).
async function running(mocks, test) {
  const open = mocks.filter((x) => !x.finished && test(x)).sort((a, b) => (b.started || '').localeCompare(a.started || ''))[0];
  if (!open) return null;
  try {
    const view = await get('mock/' + open.id);
    return { view, live: view.now < view.part1_ends, left: Math.max(0, view.part1_ends - view.now) };
  } catch (e) { return null; }
}

function startButton(label, body, dataT) {
  const btn = h('button', { class: 'btn primary big', type: 'button', 'data-t': dataT, onclick: async () => {
    btn.disabled = true;
    try {
      const v = await post('mock/start', body);
      location.hash = mockRoute(v);
    } catch (e) {
      btn.disabled = false;
      toast('Could not start: ' + e.message, 'error', 7000);
    }
  } }, label);
  return btn;
}

function runningBox(run, what) {
  if (!run) return null;
  if (run.live) {
    return h('div', { class: 'verdict blank quiz-running' }, h('strong', null, `A ${what} is running: `),
      `${Math.ceil(run.left / 60)} min left on the clock. `,
      h('a', { class: 'btn small primary', href: mockRoute(run.view), 'data-t': 'quiz-resume' }, 'Resume'));
  }
  return h('p', { class: 'muted small' }, `Your last ${what} ran out of time before you finished it. `,
    h('a', { href: mockRoute(run.view) }, 'Score it and see the result'), '.');
}

const pctText = (x) => `${Math.round(x * 100)}%`;

async function quizStart(el, uid) {
  const [m, prog, { mocks }] = await Promise.all([meta(true), get('progress'), get('mocks')]);
  const u = unitInfo(m, uid);
  if (!u) throw new Error(`There is no unit called "${uid}".`);
  el.dataset.title = `Unit quiz: ${u.title}`;
  const pu = prog.units.find((x) => x.id === uid) || {};
  const ready = u.lessons.filter((l) => l.ready);
  const doneN = u.lessons.filter((l) => l.done).length;
  const best = pu.quiz_best;
  const passed = best && best.pct >= QUIZ_PASS - 1e-9;
  const mine = mocks.filter((x) => x.kind === 'unit' && x.unit === uid);
  const run = await running(mocks, (x) => x.kind === 'unit' && x.unit === uid);

  el.append(h('div', { class: 'page-head' }, h('div', null,
    h('div', { class: 'eyebrow' }, `${uid.toUpperCase()} · ${TRACKS[u.track] || u.track} track`),
    h('h1', null, `Unit quiz: ${u.title}`),
    h('p', { class: 'sub' }, `Up to ${QUIZ_N} questions from this unit, difficulty 2 and up, 3 minutes each on the server clock. Exam scoring: right 7.5, wrong 0, blank 1.5. Pass mark 70%.`)),
  h('a', { class: 'btn', href: '#/learn' }, 'Learn map')));

  const panel = h('div', { class: 'panel quiz-start' });
  el.append(panel);
  if (!pu.items_total) {
    panel.classList.add('empty');
    panel.append(h('h2', null, 'No quiz questions yet'), h('p', null, 'This unit has no Part 1 questions yet. They arrive with its lessons.'),
      h('a', { class: 'btn', href: '#/learn' }, 'Back to the map'));
    return;
  }
  const status = h('dl', { class: 'quiz-facts' },
    h('dt', null, 'Lessons done'), h('dd', null, `${doneN} of ${plural(ready.length, 'written lesson')}`,
      ready.length && doneN >= ready.length && !passed ? h('span', { class: 'chip accent', style: { marginLeft: '8px' } }, 'Recommended now') : null),
    h('dt', null, 'Best score'), h('dd', { 'data-t': 'quiz-best' }, best
      ? [`${pctText(best.pct)} (${fmtPoints(best.score)} / ${fmtPoints(best.max)}), ${fmtDate(best.date)} `,
        h('span', { class: `chip ${passed ? 'ok' : 'warn'}` }, passed ? 'Passed' : 'Not passed yet')]
      : h('span', { class: 'muted' }, 'Not taken yet')));
  panel.append(status);
  if (!doneN) {
    const first = ready[0];
    panel.append(h('p', { class: 'coach' }, 'The quiz asks about what you have studied. Finish a lesson in this unit first.'),
      h('div', { class: 'start-row' }, h('button', { class: 'btn primary big', type: 'button', disabled: true, 'data-t': 'quiz-start' }, 'Start the quiz'),
        first ? h('a', { class: 'btn', href: `#/lesson/${first.id}` }, `Open ${first.title}`) : null));
  } else {
    const rb = runningBox(run, 'quiz');
    if (rb) panel.append(rb);
    if (!run?.live) {
      panel.append(h('div', { class: 'start-row' }, startButton('Start the quiz', { kind: 'unit', unit: uid }, 'quiz-start'),
        h('span', { class: 'muted' }, 'The clock starts when you press it.')));
    }
  }
  el.append(historyPanel(mine.filter((x) => x.finished && x.max), (x) => [pctText(x.score / x.max),
    h('span', { class: `chip ${x.score / x.max >= QUIZ_PASS - 1e-9 ? 'ok' : 'warn'}` }, x.score / x.max >= QUIZ_PASS - 1e-9 ? 'Passed' : 'Not passed')],
  ['Date', 'Score', 'Percent', 'Result', ''], 'No quizzes on this unit yet.'));
}

async function checkStart(el) {
  el.dataset.title = 'Progress check';
  const [m, prog, { mocks }] = await Promise.all([meta(true), get('progress'), get('mocks')]);
  const studied = m.curriculum.units.filter((u) => u.lessons.some((l) => l.done));
  const last = prog.checks?.length ? prog.checks[prog.checks.length - 1] : null;
  const run = await running(mocks, (x) => x.kind === 'check');
  const days = last ? Math.floor((Date.now() - new Date(last.date)) / 86400000) : null;

  el.append(h('div', { class: 'page-head' }, h('div', null,
    h('div', { class: 'eyebrow' }, 'Every two weeks'),
    h('h1', null, 'Progress check'),
    h('p', { class: 'sub' }, `${CHECK_N} mixed questions from every unit you have studied, 3 minutes each (${3 * CHECK_N} min). Exam scoring. Your percent projects a Part 1 score out of 150.`)),
  h('a', { class: 'btn', href: '#/progress' }, 'Progress')));
  const panel = h('div', { class: 'panel quiz-start' });
  el.append(panel);
  panel.append(h('dl', { class: 'quiz-facts' },
    h('dt', null, 'Covers'), h('dd', null, studied.length
      ? studied.map((u, k) => [k ? ', ' : '', h('span', { class: 'unit-id' }, u.id.toUpperCase()), ' ', u.title])
      : h('span', { class: 'muted' }, 'No lesson finished yet, so it draws from every released unit.')),
    h('dt', null, 'Last check'), h('dd', null, last
      ? `${projected(last.pct)} / 150 projected (${pctText(last.pct)}), ${fmtDate(last.date)}, ${days === 0 ? 'today' : plural(days, 'day') + ' ago'}`
      : h('span', { class: 'muted' }, 'None yet'))));
  if (last && days < 14 && !run?.live) {
    panel.append(h('p', { class: 'coach' }, `One check every 14 days is enough to see a trend; the plan on Today suggests the next one in ${plural(14 - days, 'day')}. You can take one now anyway.`));
  }
  const rb = runningBox(run, 'progress check');
  if (rb) panel.append(rb);
  if (!run?.live) {
    panel.append(h('div', { class: 'start-row' }, startButton('Start the progress check', { kind: 'check' }, 'check-start'),
      h('span', { class: 'muted' }, 'The clock starts when you press it.')));
  }
  el.append(historyPanel(mocks.filter((x) => x.kind === 'check' && x.finished && x.max), (x) => [`${projected(x.score / x.max)} / 150`],
    ['Date', 'Score', 'Projected Part 1', ''], 'No progress checks yet.'));
}

function historyPanel(list, cells, heads, emptyText) {
  list = list.slice().sort((a, b) => (b.started || '').localeCompare(a.started || ''));
  return h('div', { class: 'panel', style: { marginTop: '16px' } }, h('h2', null, 'History'),
    list.length ? h('div', { class: 'table-wrap', style: { margin: 0 } }, h('table', { class: 'mock-table', 'data-t': 'quiz-history' },
      h('thead', null, h('tr', null, heads.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, list.map((x) => h('tr', null,
        h('td', null, fmtDate(x.started)), h('td', null, `${fmtPoints(x.score)} / ${fmtPoints(x.max)}`),
        ...cells(x).map((c) => h('td', null, c)),
        h('td', null, h('a', { href: mockRoute(x) }, 'Results')))))))
      : h('p', { class: 'muted' }, emptyText));
}
