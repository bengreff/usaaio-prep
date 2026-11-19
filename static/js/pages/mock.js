// Mock exams in the official layout: question map, flag for review, server-timed clock, answers saved as you go.
// The same Part 1 runner serves unit quizzes (#/quiz/<unit>/<id>) and progress checks (#/check/<id>), which add a
// pass mark or a projected Part 1 score to the results.
import { h, clear, clock, confirmDialog, toast, fmtPoints, fmtDate, store, plural } from '../ui.js';
import { get, post, meta, lessonInfo, unitInfo } from '../api.js';
import { itemView, itemReview } from '../item.js';
import { workspace, renderGrade } from './code.js';
import { blockDone, continueButton, getSession } from '../session.js';

export const QUIZ_PASS = 0.7;   // unit quiz pass mark (server: plan_today)
export const QUIZ_N = 10, CHECK_N = 12;
const EXAM_KINDS = new Set(['part1', 'part2', 'full']);

// The page that shows a mock (a view or a /api/mocks entry).
export function mockRoute(m) {
  if (m.kind === 'unit') return `#/quiz/${m.unit}/${m.id}`;
  if (m.kind === 'check') return `#/check/${m.id}`;
  if (m.kind === 'placement') return `#/placement/${m.id}`;
  return `#/mock/${m.id}`;
}
export const projected = (pct) => Math.round(150 * pct);

const KINDS = {
  part1: { label: 'Part 1', dur: '60 min', desc: '20 questions, closed book. Multiple choice or a three-digit integer. Right 7.5, wrong 0, blank 1.5.' },
  part2: { label: 'Part 2', dur: '75 min', desc: 'Coding problems with hidden tests and the contest bans. Results only at the end, like the real grader.' },
  full: { label: 'Full Round 1', dur: '2 h 30', desc: 'Part 1 (60 min), a 15 minute break, then Part 2 (75 min), with the official timing.' },
};

export async function render(el, r) {
  el.dataset.title = 'Mock exam';
  if (r.args[0]) return runMock(el, r.args[0], r);
  return startPage(el);
}

async function startPage(el) {
  const { mocks } = await get('mocks');
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Mock exam'),
    h('p', { class: 'sub' }, 'Timed by the server clock. Leaving the page does not stop the clock, just like the real exam.'))));
  const start = async (kind) => {
    const ok = await confirmDialog({ title: `Start a ${KINDS[kind].label} mock?`, body: `The ${KINDS[kind].dur} timer starts now. Find a quiet spot and close other tabs.`, ok: 'Start the clock' });
    if (!ok) return;
    try {
      const v = await post('mock/start', { kind });
      location.hash = `#/mock/${v.id}`;
    } catch (e) { toast('Could not start: ' + e.message, 'error', 7000); }
  };
  el.append(h('div', { class: 'mock-start' }, Object.entries(KINDS).map(([k, d]) => h('div', { class: 'panel mock-opt' },
    h('h3', null, d.label), h('div', { class: 'dur' }, d.dur), h('p', null, d.desc),
    h('button', { class: `btn ${k === 'full' ? 'primary' : ''}`, type: 'button', 'data-t': `mock-${k}`, onclick: () => start(k) }, `Start ${d.label}`)))));
  // unit quizzes and progress checks have their own pages (Learn, Progress)
  const list = mocks.filter((m) => EXAM_KINDS.has(m.kind)).sort((a, b) => (b.started || '').localeCompare(a.started || ''));
  el.append(h('div', { class: 'panel', style: { marginTop: '18px' } }, h('h2', null, 'History'),
    list.length ? h('table', { class: 'mock-table' },
      h('thead', null, h('tr', null, ['Started', 'Kind', 'Score', ''].map((t) => h('th', null, t)))),
      h('tbody', null, list.map((m) => h('tr', null,
        h('td', null, fmtDate(m.started)), h('td', null, KINDS[m.kind]?.label || m.kind),
        h('td', null, m.finished ? (m.max ? `${fmtPoints(m.score)} / ${fmtPoints(m.max)}` : 'Part 2 only') : h('span', { class: 'chip warn' }, 'In progress')),
        h('td', null, h('a', { href: `#/mock/${m.id}` }, m.finished ? 'Results' : 'Resume'))))))
      : h('p', { class: 'muted' }, 'No mocks yet. Take the first one after a few units, then one every two weeks.')));
}

// r: the router's parsed route this render is for (the hash may change while it loads).
export async function runMock(el, id, r) {
  const here = '#/' + [r.name, ...r.args].join('/');
  let v = await get('mock/' + id);
  if (decodeURIComponent(location.hash) !== here) return; // Ben has moved on while this loaded
  const canonical = mockRoute(v);
  if (here !== canonical) { location.replace(canonical); return; } // e.g. an old #/mock/<id> link to a unit quiz
  const m = await meta();
  const quiz = v.kind === 'unit' || v.kind === 'check' || v.kind === 'placement';
  const unit = v.kind === 'unit' ? unitInfo(m, v.unit) : null;
  const title = v.kind === 'unit' ? `Unit quiz: ${unit ? unit.title : v.unit}` : v.kind === 'check' ? 'Progress check'
    : v.kind === 'placement' ? 'Placement quiz' : null;
  if (title) el.dataset.title = title;
  const lessonOf = (lid) => { const l = lid ? lessonInfo(m, lid) : null; return l ? { id: l.id, title: l.title } : null; };
  let extra = { checks: null, best: null };
  let offset = v.now - Date.now() / 1000;
  const now = () => Date.now() / 1000 + offset;
  const flags = new Set(store(`usaaio-flags-${id}`) || []);
  const answers = { ...v.answers };
  const pending = new Map();
  let phase = null, cur = 0, ws = null, tick = null, finishing = false, retry = null;
  const p1Done = () => !!store(`usaaio-p1done-${id}`);
  const p2Early = () => !!store(`usaaio-p2early-${id}`);

  function phaseNow() {
    if (v.finished) return 'results';
    const t = now();
    if (v.kind === 'part1' || quiz) return t < v.part1_ends ? 'part1' : 'over';
    if (v.kind === 'part2') return t < v.part2_ends ? 'part2' : 'over';
    if (t < v.part1_ends && !p1Done()) return 'part1';
    if (t < v.part1_ends + 900 && !p2Early()) return 'break';
    return t < v.part2_ends ? 'part2' : 'over';
  }

  // answers are saved to the server as he goes; failures retry every 5 s
  const saved = h('div', { class: 'saved', 'aria-live': 'polite' }, h('span', { class: 'dot' }), h('span', { class: 't' }, 'All answers saved'));
  function setSaved(ok, text) { saved.classList.toggle('bad', !ok); saved.querySelector('.t').textContent = text; }
  async function flushPending() {
    for (const [iid, ans] of [...pending]) {
      try {
        await post(`mock/${id}/answer`, { item: iid, answer: ans });
        if (pending.get(iid) === ans) pending.delete(iid);
      } catch (e) {
        setSaved(false, 'Not saved yet, retrying');
        clearTimeout(retry);
        retry = setTimeout(flushPending, 5000);
        return;
      }
    }
    setSaved(true, `Saved at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`);
  }

  function draw() {
    if (quiz && !v.finished && !v.items.length) { drawEmpty(); return; }
    const p = phaseNow();
    if (p === phase && p !== 'part1') return;
    const prev = phase;
    phase = p;
    if (ws && p !== 'part2') { ws.destroy(); ws = null; }
    if (p === 'over') { finish(true); return; }
    if (p === 'results') { drawResults(); return; }
    if (p === 'part1' && prev === 'part1') return;
    clear(el);
    el.classList.add('wide');
    if (p === 'part1') drawPart1();
    else if (p === 'break') drawBreak();
    else if (p === 'part2') drawPart2();
  }

  function drawEmpty() {
    clearInterval(tick);
    phase = 'empty';
    clear(el).append(h('div', { class: 'panel empty' }, h('h2', null, 'No questions for this yet'),
      h('p', null, v.kind === 'unit' ? 'Unit quizzes use the unit\'s questions of difficulty 2 or more, and this unit has none yet. They arrive with its lessons.'
        : 'Progress checks use questions of difficulty 2 or more from the units you have studied, and there are none yet.'),
      h('a', { class: 'btn', href: v.kind === 'unit' ? '#/learn' : '#/progress' }, v.kind === 'unit' ? 'Back to Learn' : 'Back to Progress')));
  }

  // ------------------------------------------------ Part 1
  let clockEl, qmap, mainBox;
  const FINISH = {
    full: ['Finish Part 1', 'Finish Part 1?', 'Finish Part 1'], unit: ['Finish quiz', 'Finish the quiz?', 'Finish and score'],
    check: ['Finish check', 'Finish the progress check?', 'Finish and score'],
    placement: ['Finish quiz', 'Finish the placement quiz?', 'Finish and see the advice'],
  }[v.kind] || ['Finish exam', 'Finish the exam?', 'Finish and score'];
  function drawPart1() {
    clockEl = h('div', { class: 'exam-clock', role: 'timer', 'aria-label': 'Time left' }, '--:--');
    qmap = h('div', { class: 'qmap', role: 'group', 'aria-label': 'Question map' });
    mainBox = h('div', { class: 'exam-main' });
    const finishBtn = h('button', { class: 'btn primary', type: 'button', 'data-t': 'mock-finish', style: { width: '100%' }, onclick: async () => {
      const blank = v.items.filter((it) => !answers[it.id]).length;
      const body = `${blank ? plural(blank, 'question') + ' still blank (1.5 each). ' : ''}${flags.size ? plural(flags.size, 'question') + ' flagged. ' : ''}You cannot change answers after this.`;
      const ok = await confirmDialog({ title: FINISH[1], body, ok: FINISH[2] });
      if (!ok) return;
      if (v.kind === 'full') { await flushPending(); store(`usaaio-p1done-${id}`, true); phase = null; draw(); } else finish(false);
    } }, FINISH[0]);
    el.append(h('div', { class: 'exam' },
      h('aside', { class: 'exam-side', 'aria-label': quiz ? 'Quiz status' : 'Exam status' },
        quiz ? h('h1', { class: 'exam-title' }, title) : h('div', { class: 'exam-part' }, v.kind === 'full' ? 'Round 1 mock, Part 1' : 'Part 1 mock'),
        clockEl, saved,
        h('div', { class: 'small muted' }, `${v.items.length} questions`), qmap,
        h('div', { class: 'qmap-legend' }, h('span', null, h('i', { class: 'a' }), 'Answered'), h('span', null, h('i'), 'Not answered'),
          h('span', null, h('i', { class: 'f' }), 'Flagged for review')),
        finishBtn),
      mainBox));
    drawMap();
    drawQuestion();
  }
  function drawMap() {
    clear(qmap).append(...v.items.map((it, k) => h('button', {
      type: 'button', class: `${answers[it.id] ? 'answered' : ''} ${flags.has(it.id) ? 'flagged' : ''} ${k === cur ? 'current' : ''}`,
      'aria-label': `Question ${k + 1}${answers[it.id] ? ', answered' : ', not answered'}${flags.has(it.id) ? ', flagged' : ''}`,
      'aria-current': k === cur ? 'true' : null, onclick: () => { cur = k; drawMap(); drawQuestion(true); },
    }, String(k + 1))));
  }
  function drawQuestion(focus = false) {
    clear(mainBox);
    if (!v.items.length) { mainBox.append(h('div', { class: 'panel empty' }, h('h2', null, 'No questions available'), h('p', null, 'There are no Round 1 questions of difficulty 2 or more yet.'))); return; }
    const it = v.items[cur];
    const flagBtn = h('button', { class: 'btn flag-btn', type: 'button', 'aria-pressed': flags.has(it.id) ? 'true' : 'false', 'data-t': 'flag', onclick: () => {
      if (flags.has(it.id)) flags.delete(it.id); else flags.add(it.id);
      store(`usaaio-flags-${id}`, [...flags]);
      flagBtn.setAttribute('aria-pressed', flags.has(it.id) ? 'true' : 'false');
      flagBtn.textContent = flags.has(it.id) ? 'Flagged for review' : 'Flag for review';
      drawMap();
    } }, flags.has(it.id) ? 'Flagged for review' : 'Flag for review');
    const view = itemView(it, { mode: 'mock', number: cur + 1, value: answers[it.id] || null, onChange: (ans, o) => {
      if (o?.partial) return;
      if (ans) answers[it.id] = ans; else delete answers[it.id];
      pending.set(it.id, ans || null);
      setSaved(true, 'Saving');
      flushPending();
      drawMap();
    } });
    mainBox.append(view, h('div', { class: 'exam-nav' },
      h('button', { class: 'btn', type: 'button', disabled: cur === 0 || null, onclick: () => { cur -= 1; drawMap(); drawQuestion(true); } }, 'Previous'),
      flagBtn,
      h('button', { class: 'btn', type: 'button', 'data-t': 'mock-next', disabled: cur === v.items.length - 1 || null, onclick: () => { cur += 1; drawMap(); drawQuestion(true); } }, 'Next')));
    // focus the answer so A-E or the digits work straight away (no focus ring after a mouse click)
    if (focus) view.focusFirst();
  }

  // ------------------------------------------------ break
  let breakClock;
  function drawBreak() {
    breakClock = h('div', { class: 'exam-clock' }, '--:--');
    el.append(h('div', { class: 'break-box panel' }, h('div', { class: 'exam-part' }, 'Break'), breakClock,
      h('p', null, 'Part 1 is saved. Stand up, drink water. Part 2 starts by itself when the break ends.'),
      h('button', { class: 'btn', type: 'button', onclick: () => { store(`usaaio-p2early-${id}`, true); draw(); } }, 'Start Part 2 now (the unused break becomes extra time)')));
  }

  // ------------------------------------------------ Part 2
  let p2Clock, p2Cur = 0, p2Host;
  function drawPart2() {
    p2Clock = h('span', { class: 'ws-timer' }, '--:--');
    p2Host = h('div', { class: 'ws-host', style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
    const tabs = h('div', { class: 'p2-tabs', role: 'tablist' },
      h('span', { class: 'exam-part', style: { marginRight: '6px' } }, v.kind === 'full' ? 'Round 1 mock, Part 2' : 'Part 2 mock'),
      v.problems.map((p, k) => h('button', { class: 'btn small', type: 'button', role: 'tab', 'aria-selected': k === p2Cur ? 'true' : 'false',
        onclick: (e) => { p2Cur = k; tabs.querySelectorAll('[role=tab]').forEach((b, j) => b.setAttribute('aria-selected', j === k ? 'true' : 'false')); openProblem(); } },
      `Problem ${k + 1}`)),
      h('span', { class: 'spacer' }), p2Clock,
      h('button', { class: 'btn primary small', type: 'button', 'data-t': 'mock-finish', onclick: async () => {
        const ok = await confirmDialog({ title: 'Finish the exam?', body: 'Your saved code for each problem is graded now. You cannot change it after this.', ok: 'Finish and grade' });
        if (ok) finish(false);
      } }, 'Finish exam'));
    el.append(h('div', { class: 'mock-p2' }, tabs, p2Host));
    if (!v.problems.length) {
      p2Host.append(h('div', { class: 'page' }, h('div', { class: 'panel empty' }, h('h2', null, 'No Part 2 problems available'),
        h('p', null, 'Mocks use unsolved problems of difficulty 3 or more. Finish to see your Part 1 result.'))));
      return;
    }
    openProblem();
  }
  async function openProblem() {
    if (ws) { ws.destroy(); ws = null; }
    clear(p2Host);
    const pid = v.problems[p2Cur].id;
    let P;
    try { P = await get('problem/' + pid); } catch (e) { p2Host.append(h('p', { class: 'res-error' }, e.message)); return; }
    clear(p2Host);
    ws = workspace(p2Host, P, { mock: {
      mid: id, code: v.codes[pid],
      remaining: () => v.part2_ends - now(),
      onSave: async (code) => { v.codes[pid] = code; await post(`mock/${id}/answer`, { problem: pid, code }); },
    } });
  }

  // ------------------------------------------------ finish and results
  async function finish(auto) {
    if (finishing) return;
    finishing = true;
    if (ws) { ws.flush(); ws.destroy(); ws = null; }
    clearInterval(tick);
    clear(el);
    el.classList.remove('wide');
    el.append(h('div', { class: 'panel empty' }, h('div', { class: 'loading' }, h('span', { class: 'spinner' }),
      auto ? 'Time is up. Scoring your answers' : 'Scoring your answers'), v.problems?.length ? h('p', { class: 'muted' }, 'Grading Part 2 runs every hidden test; this can take a little while.') : null));
    try {
      await flushPending();
      await new Promise((r) => setTimeout(r, 50));
      v = await post(`mock/${id}/finish`);
      await enrich();
      phase = null;
      if (v.kind === 'unit') blockDone('quiz', v.unit);
      if (v.kind === 'check') blockDone('check');
      drawResults();
    } catch (e) {
      clear(el).append(h('div', { class: 'panel error-panel' }, h('h2', null, 'Could not finish the mock'), h('p', null, e.message),
        h('button', { class: 'btn', type: 'button', onclick: () => { finishing = false; finish(auto); } }, 'Try again')));
    }
  }

  // Results need two things the finish view lacks: why the chosen wrong letter is wrong (asked per item with
  // mode "mock", which records nothing) and, for quizzes, the lesson of each item (from the view's items).
  // BACKEND_REQUESTS.md #6 asks for both in mock_finish's result.
  async function enrich() {
    const p1 = v.result?.part1 || [];
    const byId = Object.fromEntries((v.items || []).map((it) => [it.id, it]));
    for (const x of p1) { x.lesson = x.lesson ?? byId[x.id]?.lesson ?? null; x.unit = x.unit ?? byId[x.id]?.unit ?? null; }
    const jobs = p1.filter((x) => x.type === 'mc' && x.correct === false && x.given && !x.why_wrong).map((x) =>
      post('item/answer', { id: x.id, answer: x.given, mode: 'mock' })
        .then((r) => { x.why_wrong = r.why_wrong; x.all_why_wrong = r.all_why_wrong; }).catch(() => { /* review still works */ }));
    if (quiz) {
      jobs.push(get('progress').then((pr) => {
        extra.checks = pr.checks || [];
        extra.best = pr.units.find((u) => u.id === v.unit)?.quiz_best || null;
      }).catch(() => { /* no comparison shown */ }));
    }
    await Promise.all(jobs);
  }

  function drawResults() {
    clearInterval(tick);
    clear(el);
    el.classList.remove('wide');
    const res = v.result || { part1: [], part2: [] };
    const p1 = res.part1 || [], p2 = res.part2 || [];
    if (quiz) {
      el.append(h('div', { class: 'page-head' }, h('div', null,
        h('div', { class: 'eyebrow' }, v.kind === 'unit' ? `${v.unit.toUpperCase()} · Results` : 'Results'), h('h1', null, title)),
      v.kind === 'placement' ? h('a', { class: 'btn', href: '#/learn' }, 'Learn map')
        : h('a', { class: 'btn', href: v.kind === 'unit' ? `#/quiz/${v.unit}` : '#/progress' }, v.kind === 'unit' ? 'Quiz page' : 'Progress')));
    } else {
      el.append(h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, `${KINDS[v.kind]?.label || v.kind} mock`),
        h('h1', null, 'Results')), h('a', { class: 'btn', href: '#/mock' }, 'All mocks')));
    }
    if (p1.length) {
      const score = p1.reduce((a, x) => a + x.points, 0), max = 7.5 * p1.length, pct = score / max;
      const right = p1.filter((x) => x.correct === true).length, wrong = p1.filter((x) => x.correct === false).length, blank = p1.filter((x) => x.correct === null).length;
      const stats = h('div', { class: 'summary-stats' }, h('div', null, h('b', null, String(right)), h('span', null, 'right')),
        h('div', null, h('b', null, String(wrong)), h('span', null, 'wrong')), h('div', null, h('b', null, String(blank)), h('span', null, 'blank')));
      const coach = wrong ? h('p', { class: 'coach' }, `Wrong answers cost ${fmtPoints(wrong * 1.5)} points against leaving them blank. Guess only when you can rule out a choice.`) : null;
      if (v.kind === 'unit') el.append(unitScore(p1, score, max, pct, stats, coach));
      else if (v.kind === 'check') el.append(checkScore(p1, score, max, pct, stats, coach));
      else if (v.kind === 'placement') {
        const box = h('div', { 'data-t': 'mock-score' }, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Working out the advice'));
        el.append(box);
        import('./placement.js').then((mod) => mod.results(box, p1, m)).catch((e) => { box.replaceChildren(h('p', { class: 'res-error' }, e.message)); });
      }
      else {
        el.append(h('div', { class: 'panel', 'data-t': 'mock-score' },
          h('h2', null, 'Part 1'),
          h('div', { class: 'score-big' }, h('b', null, fmtPoints(score)), h('span', null, `/ ${fmtPoints(max)}`)),
          p1.length !== 20 ? h('p', { class: 'muted small' }, `This mock had ${p1.length} questions (the question bank is still growing); a full paper has 20 for 150 points.`) : null,
          stats, coach));
      }
      el.append(h('div', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'table-wrap', style: { margin: 0 } }, h('table', { class: 'mock-table' },
        h('thead', null, h('tr', null, ['#', 'Result', 'Yours', 'Answer', 'Points'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, p1.map((x, k) => h('tr', null, h('td', null, h('a', { href: `#q${k + 1}`, onclick: (e) => { e.preventDefault(); document.getElementById(`q${k + 1}`)?.scrollIntoView({ behavior: 'smooth' }); } }, String(k + 1))),
          h('td', null, h('span', { class: `chip ${x.correct === true ? 'ok' : x.correct === false ? 'bad' : 'muted'}` }, x.correct === true ? 'Right' : x.correct === false ? 'Wrong' : 'Blank')),
          h('td', { class: 'mono' }, x.given || '-'), h('td', { class: 'mono' }, x.answer), h('td', null, fmtPoints(x.points)))))))));
      const all = h('div', { class: 'runner review-list' });
      p1.forEach((x, k) => { const r = itemReview(x, k + 1, { lesson: lessonOf(x.lesson) }); r.id = `q${k + 1}`; all.append(r); });
      el.append(h('h2', { style: { marginTop: '28px' } }, 'Every question with its solution'), all);
    } else if (quiz) {
      el.append(h('div', { class: 'panel empty' }, h('h2', null, 'No questions were scored'), h('p', null, 'This one had no questions.')));
    }
    if (v.problems?.length || p2.length) {
      el.append(h('h2', { style: { marginTop: '28px' } }, 'Part 2'));
      if (!p2.length) el.append(h('p', { class: 'muted' }, 'No Part 2 results.'));
      for (const x of p2) {
        const title = v.problems.find((p) => p.id === x.id)?.title || x.id;
        el.append(h('div', { class: 'panel', 'data-t': 'mock-p2-result' },
          h('div', { class: 'row' }, h('h3', { style: { margin: 0 } }, title), h('span', { class: 'spacer' }),
            h('span', { class: `chip ${x.ok ? 'ok' : 'bad'}` }, `${x.passed} / ${x.total} tests`), h('span', { class: 'chip' }, `${Math.round(x.fraction * 100)}% credit`)),
          x.grade ? renderGrade(x.grade, { mode: 'submit' }) : null,
          h('p', { style: { marginTop: '10px' } }, h('a', { href: `#/problem/${x.id}` }, 'Open in the Code lab'))));
      }
    }
  }

  // Missed (wrong or blank) items grouped by lesson, most missed first: [{id, title, n}]
  function missedLessons(p1) {
    const n = new Map();
    for (const x of p1) if (x.correct !== true && x.lesson) n.set(x.lesson, (n.get(x.lesson) || 0) + 1);
    return [...n].map(([lid, k]) => ({ ...lessonOf(lid), n: k })).filter((l) => l.id).sort((a, b) => b.n - a.n);
  }
  function reviewRow(p1, ...more) {
    const ls = missedLessons(p1);
    const row = h('div', { class: 'quiz-actions' },
      // in a session the "Next" button is the main action
      ls.length ? h('a', { class: `btn ${getSession() ? '' : 'primary'}`, href: `#/lesson/${ls[0].id}`, 'data-t': 'review-missed' }, 'Review missed lessons') : null,
      ...more, getSession() ? continueButton() : null);
    const list = ls.length ? h('p', { class: 'missed-lessons small', 'data-t': 'missed-lessons' }, 'Missed questions come from ',
      ls.map((l, k) => [k ? (k === ls.length - 1 ? ' and ' : ', ') : '', h('a', { href: `#/lesson/${l.id}` }, l.title), ` (${l.n})`]), '.') : null;
    const loose = p1.filter((x) => x.correct !== true && !x.lesson).length;
    const looseNote = loose && v.kind === 'unit'
      ? h('p', { class: 'missed-lessons small muted' }, `${plural(loose, 'missed question')} ${loose === 1 ? 'is' : 'are'} not tied to one lesson: `,
        h('a', { href: `#/practice?unit=${v.unit}&min_diff=2&start=1` }, 'practice this unit'), '.') : null;
    return [row, list, looseNote];
  }

  function unitScore(p1, score, max, pct, stats, coach) {
    const pass = pct >= QUIZ_PASS - 1e-9;
    const need = QUIZ_PASS * max;
    const pts = (x) => String(Math.round(x * 100) / 100); // 15.75, not 15.7 (pass marks are not multiples of 1.5)
    const retake = h('button', { class: 'btn', type: 'button', 'data-t': 'quiz-retake', onclick: async () => {
      retake.disabled = true;
      try { const nv = await post('mock/start', { kind: 'unit', unit: v.unit }); location.hash = mockRoute(nv); } catch (e) {
        retake.disabled = false; toast('Could not start a new quiz: ' + e.message, 'error', 7000);
      }
    } }, 'Retake');
    const best = extra.best;
    return h('div', { class: 'panel quiz-score', 'data-t': 'mock-score' },
      h('div', { class: 'score-pair' },
        h('div', null, h('div', { class: 'res-h' }, 'Score'), h('div', { class: 'score-big' }, h('b', null, fmtPoints(score)), h('span', null, `/ ${fmtPoints(max)}`))),
        h('div', null, h('div', { class: 'res-h' }, 'Percent'), h('div', { class: 'score-big' }, h('b', { 'data-t': 'quiz-pct' }, `${Math.round(pct * 100)}%`)))),
      h('p', { class: `verdict ${pass ? 'ok' : 'bad'}`, 'data-t': 'quiz-verdict' }, pass
        ? [h('strong', null, 'Passed.'), ` The pass mark is 70%, ${pts(need)} of ${pts(max)} points.`]
        : [h('strong', null, 'Not passed yet.'), ` The pass mark is 70%, ${pts(need)} of ${pts(max)} points: ${pts(need - score)} more.`]),
      p1.length !== QUIZ_N ? h('p', { class: 'muted small' }, `This quiz had ${plural(p1.length, 'question')}: the unit's question bank is still growing (a full quiz has ${QUIZ_N}).`) : null,
      best && Math.abs(best.pct - pct) > 1e-6 ? h('p', { class: 'muted small' }, `Your best on this unit: ${Math.round(best.pct * 100)}% (${fmtPoints(best.score)} / ${fmtPoints(best.max)}), ${fmtDate(best.date)}.`) : null,
      stats, coach, ...reviewRow(p1, retake));
  }

  function checkScore(p1, score, max, pct, stats, coach) {
    const proj = projected(pct);
    const cs = extra.checks || [];
    const i = cs.findIndex((c) => c.id === id);
    const prev = i > 0 ? cs[i - 1] : null;
    const delta = prev ? proj - projected(prev.pct) : null;
    const change = delta === null
      ? h('p', { class: 'muted small', 'data-t': 'check-change' }, i === 0 ? 'Your first progress check. The next one shows the change.' : '')
      : h('p', { class: 'check-change', 'data-t': 'check-change' }, delta === 0
        ? `Same as the last check (${projected(prev.pct)} on ${fmtDate(prev.date)}).`
        : [h('span', { class: `chip ${delta > 0 ? 'ok' : 'bad'}` }, `${delta > 0 ? '+' : '-'}${Math.abs(delta)}`),
          ` since the last check (${projected(prev.pct)} on ${fmtDate(prev.date)}).`]);
    // by unit
    const byUnit = new Map();
    for (const x of p1) { const u = x.unit || '?'; const r = byUnit.get(u) || { right: 0, n: 0 }; r.n += 1; if (x.correct === true) r.right += 1; byUnit.set(u, r); }
    const unitRows = [...byUnit].sort((a, b) => a[0].localeCompare(b[0])).map(([uid, r]) => h('tr', null,
      h('td', null, h('span', { class: 'unit-id' }, uid.toUpperCase()), ' ', unitInfo(m, uid)?.title || ''),
      h('td', { class: 'num' }, `${r.right} / ${r.n}`)));
    return h('div', { class: 'panel quiz-score', 'data-t': 'mock-score' },
      h('div', { class: 'score-pair' },
        h('div', null, h('div', { class: 'res-h' }, 'Projected Part 1 score'), h('div', { class: 'score-big' }, h('b', { 'data-t': 'check-projected' }, String(proj)), h('span', null, '/ 150'))),
        h('div', null, h('div', { class: 'res-h' }, 'This check'), h('div', { class: 'score-big small-score' }, h('b', null, fmtPoints(score)), h('span', null, `/ ${fmtPoints(max)}, ${Math.round(pct * 100)}%`)))),
      change,
      h('p', { class: 'muted small' }, `Projected = 150 × your percent here, rounded: 150 × ${Math.round(pct * 1000) / 10}% = ${proj}. A real Part 1 paper is 20 questions for 150 points; this check had ${p1.length}.`),
      stats, coach,
      byUnit.size > 1 ? h('table', { class: 'mock-table by-unit' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Unit'), h('th', { scope: 'col', class: 'num' }, 'Right'))),
        h('tbody', null, unitRows)) : null,
      ...reviewRow(p1, h('a', { class: 'btn', href: '#/progress' }, 'See the trend on Progress')));
  }

  // ------------------------------------------------ clock
  function onTick() {
    const p = phaseNow();
    if (p !== phase) { draw(); return; }
    const t = now();
    if (p === 'part1' && clockEl) {
      const rem = v.part1_ends - t;
      clockEl.textContent = clock(rem);
      clockEl.classList.toggle('low', rem < 300);
    } else if (p === 'break' && breakClock) breakClock.textContent = clock(v.part1_ends + 900 - t);
    else if (p === 'part2' && p2Clock) {
      const rem = v.part2_ends - t;
      p2Clock.textContent = clock(rem) + ' left';
      p2Clock.classList.toggle('low', rem < 300);
    }
  }
  if (v.finished) await enrich();
  draw();
  onTick();
  tick = setInterval(onTick, 1000);
  // resync with the server clock every 2 minutes
  const sync = setInterval(async () => {
    try { const nv = await get('mock/' + id); offset = nv.now - Date.now() / 1000; } catch (e) { /* keep the old offset */ }
  }, 120000);
  return () => { clearInterval(tick); clearInterval(sync); clearTimeout(retry); if (ws) ws.destroy(); if (pending.size) flushPending(); };
}
