// Today: days to Round 1, the session plan sized to the minutes Ben has, and one button to start.
import { h, clear, errorBox, loading, plural } from '../ui.js';
import { get, post, meta, qs } from '../api.js';
import { getSession, startSession, endSession, blockLabel, blockRoute, sessionComplete, goTo } from '../session.js';

const BASE_MINUTES = [30, 45, 60];

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

export async function render(el) {
  el.dataset.title = 'Today';
  const [m, prog] = await Promise.all([meta(true), get('progress').catch(() => null)]);
  const setMin = Number(m.settings?.session_minutes) || 45;
  const MINUTES = [...new Set([...BASE_MINUTES, setMin])].sort((a, b) => a - b);
  let minutes = setMin;

  const weekHours = prog ? (prog.time?.this_week_hours ?? prog.weeks[isoWeek(new Date())] ?? 0) : 0;
  const lessonsReady = m.curriculum.units.reduce((a, u) => a + u.lessons.filter((l) => l.ready).length, 0);
  const lessonsDone = m.curriculum.units.reduce((a, u) => a + u.lessons.filter((l) => l.done).length, 0);
  const lessonsR1 = m.curriculum.units.filter((u) => u.round === 'R1').reduce((a, u) => a + u.lessons.length, 0);

  const examIso = m.settings?.exam_date || '2027-02-19';
  const [ey, em, ed] = examIso.split('-').map(Number);
  const roundDate = new Date(ey, em - 1, ed).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  // weekly hours target (Settings, default 3): the bar spans 1.5 x the target, the mark is the target
  const target = Number(m.settings?.weekly_hours) || 3;
  const span = Math.max(target * 1.5, weekHours);
  const fmtH = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const focus = m.round_focus?.focus || 'R1';
  const r2 = m.curriculum.units.filter((u) => u.round === 'R2');
  const r2Done = r2.reduce((a, u) => a + u.lessons.filter((l) => l.done).length, 0);
  const r2Ready = r2.reduce((a, u) => a + u.lessons.filter((l) => l.ready).length, 0);
  const r2Total = r2.reduce((a, u) => a + u.lessons.length, 0);
  const days = h('div', { class: 'panel days' },
    h('div', null,
      h('div', { class: 'eyebrow' }, 'USAAIO Round 1'),
      m.days_to_round1 >= 0
        ? [h('div', { class: 'days-n' }, String(m.days_to_round1)), h('div', { class: 'days-l' }, `days to go, ${roundDate}`)]
        : [h('div', { class: 'days-n' }, 'Done'), h('div', { class: 'days-l' }, `Round 1 was on ${roundDate}`)],
      h('div', { class: 'small', 'data-t': 'focus', style: { marginTop: '6px' } },
        h('span', { class: `chip ${focus === 'R2' ? 'accent' : ''}` }, focus === 'R2' ? 'Round 2 focus' : 'Round 1 focus'), ' ',
        h('a', { href: '#/settings', class: 'small' }, 'Settings'))),
    h('div', { class: 'weekbar' },
      h('div', { class: 'row small', style: { justifyContent: 'space-between', marginBottom: '6px' } },
        h('span', null, 'This week'), h('span', { class: 'muted', 'data-t': 'week-target' }, `${weekHours.toFixed(1)} h of a ${fmtH(target)} h target`)),
      h('div', { class: 'bar ok', role: 'img', 'aria-label': `${weekHours.toFixed(1)} hours this week; target ${fmtH(target)} hours` },
        h('span', { style: { width: Math.min(100, (weekHours / span) * 100) + '%' } }),
        h('div', { class: 'band target', style: { left: Math.min(100, (target / span) * 100) + '%', width: '2px' } })),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, focus === 'R2'
        ? `${r2Done} of ${r2Total} Round 2 lessons done, ${r2Ready} ready so far.`
        : `${lessonsDone} of ${lessonsR1} Round 1 lessons done, ${lessonsReady} written so far.`)));

  const planBox = h('div', { class: 'panel plan' });
  el.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Today'),
      h('p', { class: 'sub' }, 'Pick the time you have. The plan does the choosing.'))),
    h('div', { class: 'hero' }, planBox, days),
    h('div', { class: 'quick' },
      h('a', { href: '#/learn' }, h('span', { class: 'q-t' }, 'Learn map'), h('span', { class: 'q-d' }, 'Every unit to Round 1 and beyond')),
      h('a', { href: '#/code' }, h('span', { class: 'q-t' }, 'Code lab'), h('span', { class: 'q-d' }, 'Part 2 problems with graders')),
      h('a', { href: '#/mock' }, h('span', { class: 'q-t' }, 'Mock exam'), h('span', { class: 'q-d' }, 'Timed, contest layout')),
      h('a', { href: '#/progress' }, h('span', { class: 'q-t' }, 'Progress'), h('span', { class: 'q-d' }, 'Hours, quizzes, progress checks'))));

  async function loadPlan() {
    clear(planBox).append(loading('Planning today'));
    let plan;
    try {
      plan = await get('today' + qs({ minutes }));
    } catch (e) {
      clear(planBox).append(errorBox(e, loadPlan));
      return;
    }
    drawPlan(plan);
  }

  function drawPlan(plan) {
    clear(planBox);
    const s = getSession();
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Minutes available' }, MINUTES.map((mm) =>
      h('button', { type: 'button', 'aria-pressed': mm === minutes ? 'true' : 'false', onclick: async () => {
        if (mm === minutes) return;
        minutes = mm;
        post('settings', { session_minutes: mm }).catch(() => {});
        loadPlan();
      } }, `${mm} min`)));
    planBox.append(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } },
      h('h2', { style: { margin: 0 } }, s ? 'Session in progress' : 'Session plan'), s ? null : seg));

    if (s) {
      drawSession(s);
      return;
    }
    if (!plan.blocks.length) {
      planBox.append(h('div', { class: 'empty' },
        h('h2', null, 'Nothing to schedule yet'),
        h('p', null, 'No lessons are ready yet: they are still being written and appear on the Learn map as they land. Until then you can work on what exists.'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('a', { class: 'btn primary', href: '#/code' }, 'Open the Code lab'),
          h('a', { class: 'btn', href: '#/learn' }, 'See the syllabus'))));
      return;
    }
    const list = h('ol', { class: 'plan-list' }, plan.blocks.map((b, k) => h('li', { class: 'plan-item' },
      h('span', { class: 'plan-n' }, String(k + 1)),
      h('div', null, h('div', { class: 'plan-kind' }, blockLabel(b)), h('div', { class: 'plan-title' }, b.title),
        h('div', { class: 'plan-detail' }, detail(b))),
      h('span', { class: 'plan-min' }, `${b.minutes} min`))));
    const startBtn = h('button', { class: 'btn primary big', type: 'button', 'data-t': 'start-session', onclick: () => startSession(plan) }, 'Start session');
    planBox.append(list, h('div', { class: 'start-row' }, startBtn,
      h('span', { class: 'muted' }, `About ${plan.est_minutes} min, ${plural(plan.blocks.length, 'block')}`)));
  }

  function drawSession(s) {
    const done = sessionComplete(s);
    const list = h('ol', { class: 'plan-list' }, s.blocks.map((b, k) => h('li', { class: `plan-item ${s.done[k] ? 'done' : ''}` },
      h('span', { class: 'plan-n' }, s.done[k] ? '' : String(k + 1)),
      h('div', null, h('div', { class: 'plan-kind' }, blockLabel(b) + (s.done[k] ? ', done' : '')),
        h('a', { class: 'plan-title', href: blockRoute(b), onclick: (e) => { e.preventDefault(); goTo(k); } }, b.title),
        h('div', { class: 'plan-detail' }, detail(b))),
      h('span', { class: 'plan-min' }, `${b.minutes} min`))));
    const mins = Math.round((Date.now() - s.started) / 60000);
    planBox.append(
      done ? h('p', { class: 'verdict ok' }, h('strong', null, 'Session complete. '), `${mins} min since you started. Good work.`) : null,
      list,
      h('div', { class: 'start-row' },
        done
          ? h('button', { class: 'btn primary big', type: 'button', onclick: () => { endSession(); loadPlan(); } }, 'Plan another session')
          : h('button', { class: 'btn primary big', type: 'button', 'data-t': 'resume-session', onclick: () => goTo(s.done.findIndex((d) => !d)) },
            `Resume: block ${s.done.findIndex((d) => !d) + 1} of ${s.blocks.length}`),
        done ? null : h('button', { class: 'btn ghost', type: 'button', onclick: () => { endSession(); loadPlan(); } }, 'Discard session')));
  }

  function detail(b) {
    if (b.kind === 'cards') return `${plural(b.ids.length, 'card')}${b.detail ? ': ' + b.detail : ''}`;
    if (b.kind === 'review') return plural(b.ids.length, 'question');
    if (b.kind === 'lesson') return `${b.unit_title} (${b.track === 'theory' ? 'theory' : 'code'} track)`;
    if (b.kind === 'problem') return 'Part 2 style coding problem';
    if (b.kind === 'practice') return `${plural(b.n, 'question')}, instant feedback`;
    if (b.kind === 'quiz') return b.detail || '10 questions, exam scoring; 70% to pass';
    if (b.kind === 'check') return b.detail || '12 mixed questions; tracks your projected Part 1 score';
    return '';
  }

  const s = getSession();
  if (s) drawPlan({ blocks: s.blocks });
  else await loadPlan();
}
