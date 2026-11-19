// Learn map: every unit, Round 1 then Round 2+, by track; lesson status, minutes, priority, and each released
// unit's quiz (best score; opens after the unit's first lesson, recommended once every written lesson is done).
import { h, store, PRIORITY, TRACKS } from '../ui.js';
import { get, meta } from '../api.js';

const QUIZ_PASS = 0.7;

const TRACK_SEQ = ['theory', 'code', 'exam'];

export async function render(el) {
  el.dataset.title = 'Learn';
  const [m, prog] = await Promise.all([meta(true), get('progress').catch(() => null)]);
  const units = m.curriculum.units;
  const pu = Object.fromEntries((prog?.units || []).map((u) => [u.id, u]));
  let filter = store('usaaio-learn-filter') || 'all';
  const summaries = new Set(m.summaries || []);
  const testedOut = new Set(m.settings?.tested_out || []);

  const order = (track) => {
    const ids = m.track_order?.[track] || [];
    const inTrack = units.filter((u) => u.track === track);
    return inTrack.sort((a, b) => {
      const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      return (ia < 0 ? 1e3 + units.indexOf(a) : ia) - (ib < 0 ? 1e3 + units.indexOf(b) : ib);
    });
  };

  const all = units.flatMap((u) => u.lessons);
  const r1 = units.filter((u) => u.round === 'R1').flatMap((u) => u.lessons);
  const body = h('div');
  const segBtns = [['all', 'All tracks'], ['theory', 'Theory'], ['code', 'Code'], ['exam', 'Exam']].map(([k, label]) =>
    h('button', { type: 'button', 'aria-pressed': k === filter ? 'true' : 'false', onclick: () => {
      filter = k; store('usaaio-learn-filter', k);
      segBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === k ? 'true' : 'false'));
      draw();
    }, 'data-k': k }, label));

  el.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Learn'),
        h('p', { class: 'sub' }, `${units.length} units, ${all.length} lessons. Round 1 has ${r1.length} lessons; ${r1.filter((l) => l.done).length} done, ${r1.filter((l) => l.ready).length} written.`)),
      h('div', { class: 'row' },
        h('a', { class: 'btn small ghost', href: '#/glossary', 'data-t': 'glossary-link' }, 'Glossary'),
        m.features?.placement ? h('a', { class: 'btn small ghost', href: '#/placement', 'data-t': 'placement-link' }, 'Placement quiz') : null,
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter by track' }, segBtns))),
    h('div', { class: 'legend', style: { marginBottom: '6px' } },
      h('span', null, h('i', { class: 'st done' }), 'Done'),
      h('span', null, h('i', { class: 'st' }), 'Ready'),
      h('span', null, h('i', { class: 'st coming' }), 'Coming soon'),
      h('span', null, h('span', { class: 'prio p1' }, PRIORITY[1]), 'scores most on Round 1'),
      h('span', null, h('span', { class: 'prio p3' }, PRIORITY[3]), 'skip if short on time')),
    body);

  // The quiz row: only for released units that have questions (progress counts items of released units only).
  function quizRow(u, done, ready) {
    const p = pu[u.id];
    if (!p || !p.items_total || !ready) return null;
    const best = p.quiz_best;
    const passed = best && best.pct >= QUIZ_PASS - 1e-9;
    const readyDone = u.lessons.filter((l) => l.ready && l.done).length;
    const recommended = readyDone === ready && !passed;
    return h('div', { class: 'unit-quiz' },
      h('span', { class: 'uq-label' }, 'Unit quiz'),
      best ? h('span', { class: `chip ${passed ? 'ok' : 'warn'}`, 'data-t': `quiz-best-${u.id}`, title: `Best ${best.score} / ${best.max}; pass mark 70%` },
        `Best ${Math.round(best.pct * 100)}%${passed ? ', passed' : ''}`)
        : h('span', { class: 'muted small' }, done ? 'Not taken yet' : 'Opens after your first lesson here'),
      recommended ? h('span', { class: 'chip accent' }, 'Recommended') : null,
      h('span', { class: 'spacer' }),
      done ? h('a', { class: `btn small ${recommended ? 'primary' : ''}`, href: `#/quiz/${u.id}`, 'data-t': `unit-quiz-${u.id}` }, 'Unit quiz')
        : h('button', { class: 'btn small', type: 'button', disabled: true, 'data-t': `unit-quiz-${u.id}`, title: 'Finish a lesson in this unit first' }, 'Unit quiz'));
  }

  function unitCard(u, openByDefault) {
    const done = u.lessons.filter((l) => l.done).length;
    const ready = u.lessons.filter((l) => l.ready).length;
    const best = pu[u.id]?.quiz_best;
    const det = h('details', { class: 'unit', id: 'unit-' + u.id, open: openByDefault || null },
      h('summary', null,
        h('div', { class: 'unit-top' }, h('span', { class: 'unit-id' }, u.id.toUpperCase()), h('span', { class: 'unit-title' }, u.title),
          h('span', { class: 'unit-count' }, `${done}/${u.lessons.length} done${best ? `, quiz ${Math.round(best.pct * 100)}%` : ''}`),
          testedOut.has(u.id) ? h('span', { class: 'chip ok', 'data-t': `tested-out-${u.id}`, title: 'From the placement quiz. Undo in Settings.' }, 'Tested out') : null),
        h('div', { class: 'unit-summary' }, u.summary || ''),
        h('div', { class: 'bar ok', role: 'img', 'aria-label': `${done} of ${u.lessons.length} lessons done, ${ready} ready` },
          h('span', { style: { width: (u.lessons.length ? (done / u.lessons.length) * 100 : 0) + '%' } }))),
      h('ul', { class: 'lessons' }, u.lessons.map((l) => {
        const st = l.done ? 'done' : l.ready ? 'ready' : 'coming';
        return h('li', { class: `lesson-row ${st}` },
          h('span', { class: 'st', title: st === 'done' ? 'Done' : st === 'ready' ? 'Ready' : 'Coming soon', 'aria-hidden': 'true' }),
          h('div', null,
            l.ready ? h('a', { href: `#/lesson/${l.id}` }, l.title) : h('span', { class: 'lt' }, l.title),
            h('span', { class: 'sr-only' }, st === 'done' ? ' (done)' : st === 'ready' ? ' (ready)' : ' (coming soon)'),
            l.goals ? h('div', { class: 'goals' }, l.goals) : null),
          h('div', { class: 'lm' },
            st === 'coming' ? h('span', null, 'Soon') : null,
            h('span', null, `${l.minutes} min`),
            h('span', { class: `prio p${l.priority}`, title: 'Priority for Round 1' }, PRIORITY[l.priority] || 'P' + l.priority)));
      })),
      quizRow(u, done, ready),
      summaries.has(u.id) ? h('div', { class: 'unit-quiz' }, h('span', { class: 'uq-label' }, 'Summary sheet'),
        h('span', { class: 'muted small' }, 'The unit on one or two printed pages'), h('span', { class: 'spacer' }),
        h('a', { class: 'btn small', href: `#/summary/${u.id}`, 'data-t': `summary-${u.id}` }, 'Open')) : null);
    return det;
  }

  function draw() {
    body.replaceChildren();
    const [ey, em, ed] = String(m.settings?.exam_date || '2027-02-19').split('-').map(Number);
    const examDay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    for (const [round, title, sub] of [['R1', 'Round 1', `${examDay}. Part 1: 20 questions in 60 min. Part 2: 75 min of coding.`],
      ['R2', 'Round 2 and beyond', 'After Round 1. Opens early only if you are ahead.']]) {
      const inRound = units.filter((u) => u.round === round);
      if (!inRound.length) continue;
      body.append(h('h2', { class: 'round-h' }, title), h('p', { class: 'round-sub' }, sub));
      for (const track of TRACK_SEQ) {
        if (filter !== 'all' && filter !== track) continue;
        const us = order(track).filter((u) => u.round === round);
        if (!us.length) continue;
        body.append(h('div', { class: 'track-h' }, `${TRACKS[track]} track`),
          h('div', { class: 'units' }, us.map((u) => unitCard(u, round === 'R1'))));
      }
    }
  }
  draw();
}
