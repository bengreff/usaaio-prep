// Practice sets (choose unit/lesson/difficulty) and review blocks (given item ids). One question at a time.
import { h, clear, fmtPoints, plural, store } from '../ui.js';
import { get, meta, qs } from '../api.js';
import { itemView } from '../item.js';
import { blockDone, continueButton } from '../session.js';
import { renderInline } from '../md.js';

export async function render(el, r) {
  const review = r.name === 'review';
  el.dataset.title = review ? 'Review' : 'Practice';
  const q = r.query;
  if (review) {
    const ids = (q.ids || '').split(',').filter(Boolean);
    const data = await get('items' + qs({ ids: ids.join(',') }));
    return runSet(el, data.items, { title: 'Review', mode: 'review', sub: 'Questions you missed or that are due again.', kind: 'review' });
  }
  if (q.start) {
    const data = await get('practice' + qs({ unit: q.unit, lesson: q.lesson, n: q.n || 10, min_diff: q.min_diff || 1, all: q.all }));
    const m = await meta();
    const u = m.curriculum.units.find((x) => x.id === q.unit);
    const l = u && q.lesson ? u.lessons.find((x) => x.id === q.lesson) : null;
    return runSet(el, data.items, { title: 'Practice', mode: 'practice', kind: 'practice',
      sub: [u ? `${u.id.toUpperCase()} ${u.title}` : 'All units', l ? l.title : null, q.min_diff > 1 ? `difficulty ${q.min_diff}+` : null].filter(Boolean).join(' · ') });
  }
  return chooser(el);
}

async function chooser(el) {
  const [m, prog] = await Promise.all([meta(), get('progress')]);
  const counts = Object.fromEntries(prog.units.map((u) => [u.id, u]));
  const last = store('usaaio-practice') || {};
  const units = m.curriculum.units.filter((u) => (counts[u.id]?.items_total || 0) > 0);
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Practice'),
    h('p', { class: 'sub' }, 'Part 1 style questions with instant feedback. Unseen questions come first, then your weakest.'))));
  if (!units.length) {
    el.append(h('div', { class: 'panel empty' }, h('h2', null, 'No questions yet'),
      h('p', null, 'Questions arrive with the lessons. Check back after the first units land.')));
    return;
  }
  const unitSel = h('select', { id: 'p-unit' }, h('option', { value: '' }, 'All units'),
    units.map((u) => h('option', { value: u.id, selected: last.unit === u.id || null }, `${u.id.toUpperCase()} ${u.title} (${counts[u.id].items_total})`)));
  const lessonSel = h('select', { id: 'p-lesson' });
  const diffSel = h('select', { id: 'p-diff' }, [[1, 'Any'], [2, '2+ (Round 1 easy)'], [3, '3+ (typical Round 1)'], [4, '4+ (hard)']].map(([v, t]) =>
    h('option', { value: v, selected: String(last.min_diff) === String(v) || null }, t)));
  const nSel = h('select', { id: 'p-n' }, [5, 10, 15, 20].map((v) => h('option', { value: v, selected: (last.n || 10) === v || null }, String(v))));
  const fillLessons = () => {
    const u = units.find((x) => x.id === unitSel.value);
    clear(lessonSel).append(h('option', { value: '' }, 'Any lesson'));
    if (u) for (const l of u.lessons.filter((x) => x.ready)) lessonSel.append(h('option', { value: l.id }, l.title));
    lessonSel.disabled = !u;
  };
  unitSel.addEventListener('change', fillLessons);
  fillLessons();
  const go = () => {
    const p = { unit: unitSel.value, lesson: lessonSel.value, min_diff: +diffSel.value, n: +nSel.value };
    store('usaaio-practice', p);
    location.hash = '#/practice' + qs({ ...p, start: 1 });
  };
  el.append(h('div', { class: 'panel' },
    h('div', { class: 'chooser' },
      h('label', { class: 'field' }, 'Unit', unitSel),
      h('label', { class: 'field' }, 'Lesson', lessonSel),
      h('label', { class: 'field' }, 'Difficulty', diffSel),
      h('label', { class: 'field' }, 'Questions', nSel),
      h('button', { class: 'btn primary', type: 'button', onclick: go, 'data-t': 'practice-start' }, 'Start practice'))),
  h('div', { class: 'panel' }, h('h2', null, 'How Part 1 is scored'),
    h('p', null, '20 questions in 60 minutes. Right 7.5, wrong 0, blank 1.5. A blind guess among five averages 1.5, the same as a blank, so guess whenever you can rule out at least one choice.')));
}

function runSet(el, items, { title, sub, mode, kind }) {
  el.append(h('div', { class: 'runner' }));
  const box = el.firstChild;
  if (!items.length) {
    const taughtOnly = mode === 'practice' && !/[?&]all=1/.test(location.hash);
    box.append(h('div', { class: 'panel empty' }, h('h2', null, 'No questions match'),
      h('p', null, taughtOnly
        ? 'Practice only uses questions from lessons you have finished. Finish a lesson in this unit first, or practice every question in it (some use material you have not reached yet).'
        : 'Try another unit, or a lower difficulty.'),
      taughtOnly ? h('a', { class: 'btn primary', href: location.hash + '&all=1', 'data-t': 'practice-all' }, 'Practice every question') : null,
      h('a', { class: 'btn', href: '#/practice' }, 'Choose again'), continueButton()));
    if (kind) blockDone(kind);
    return;
  }
  const results = [];
  let k = 0;
  const head = h('div', { class: 'runner-head' });
  const stage = h('div');
  box.append(h('div', { class: 'eyebrow' }, sub || ''), h('h1', null, title), head, stage);

  function drawHead() {
    const pts = results.reduce((a, x) => a + (x ? x.points : 0), 0);
    clear(head).append(
      h('span', { class: 'count' }, `Question ${Math.min(k + 1, items.length)} of ${items.length}`),
      h('div', { class: 'bar ok', role: 'progressbar', 'aria-valuenow': String(results.filter(Boolean).length), 'aria-valuemax': String(items.length), 'aria-label': 'Questions answered' },
        h('span', { style: { width: (results.filter(Boolean).length / items.length) * 100 + '%' } })),
      h('span', { class: 'muted' }, `${fmtPoints(pts)} / ${fmtPoints(7.5 * items.length)} points`));
  }

  function show() {
    drawHead();
    clear(stage);
    const it = items[k];
    const nextBtn = h('button', { class: 'btn primary', type: 'button', hidden: true, 'data-t': 'next-q',
      onclick: () => { k += 1; if (k < items.length) show(); else summary(); } }, k + 1 < items.length ? 'Next question' : 'See summary');
    const view = itemView(it, { mode, number: k + 1, onAnswered: (res, answer) => {
      results[k] = { ...res, given: answer };
      drawHead();
      nextBtn.hidden = false;
      nextBtn.focus({ preventScroll: true });
    } });
    stage.append(view, h('div', { class: 'runner-next' }, nextBtn));
    requestAnimationFrame(() => view.focusFirst?.());
  }

  function summary() {
    clear(head);
    clear(stage);
    const right = results.filter((x) => x.correct === true).length;
    const wrong = results.filter((x) => x.correct === false).length;
    const blank = results.filter((x) => x.correct === null).length;
    const pts = results.reduce((a, x) => a + x.points, 0);
    stage.append(h('div', { class: 'panel', 'data-t': 'summary' },
      h('div', { class: 'eyebrow' }, 'Set complete'),
      h('div', { class: 'summary-score' }, `${fmtPoints(pts)} / ${fmtPoints(7.5 * items.length)}`),
      h('div', { class: 'summary-stats' },
        h('div', null, h('b', null, String(right)), h('span', null, 'right')),
        h('div', null, h('b', null, String(wrong)), h('span', null, 'wrong')),
        h('div', null, h('b', null, String(blank)), h('span', null, 'blank')),
        h('div', null, h('b', null, `${Math.round((pts / (7.5 * items.length)) * 150)}`), h('span', null, 'scaled to 150'))),
      h('ul', { class: 'result-list' }, items.map((it, i) => {
        const x = results[i];
        return h('li', null,
          h('span', { class: `chip ${x.correct === true ? 'ok' : x.correct === false ? 'bad' : 'muted'}` }, x.correct === true ? 'Right' : x.correct === false ? 'Wrong' : 'Blank'),
          h('span', { class: 'stem-snip', html: renderInline(it.stem.split('\n')[0].slice(0, 220)) }),
          h('span', { class: 'muted small' }, `answer ${x.answer}`));
      })),
      h('div', { class: 'row', style: { marginTop: '16px' } },
        continueButton(),
        mode === 'practice' ? h('a', { class: 'btn', href: '#/practice' }, 'New set') : null,
        h('a', { class: 'btn ghost', href: '#/today' }, 'Today'))));
    if (kind) blockDone(kind);
  }
  show();
}
