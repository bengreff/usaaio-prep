// API recall cards: type the line, it runs and is checked by behavior. Missed cards come back once at the end.
import { h, clear, plural, store, toast } from '../ui.js';
import { get, post, meta, qs } from '../api.js';
import { mdInline, highlightPython } from '../md.js';
import { makeEditor } from '../editor.js';
import { blockDone, continueButton } from '../session.js';
import { reportLink } from '../report.js';

export async function render(el, r) {
  el.dataset.title = 'Cards';
  const q = r.query;
  if (q.ids || q.unit || q.lesson || q.due) {
    const data = await get('cards' + qs({ ids: q.ids, unit: q.unit, lesson: q.lesson, due: q.due, n: q.n || 15 }));
    let sub = 'Syntax drill';
    if (q.lesson || q.unit) {
      const m = await meta();
      const u = m.curriculum.units.find((x) => x.id === (q.unit || (q.lesson || '').split('-')[0]));
      const l = u && q.lesson ? u.lessons.find((x) => x.id === q.lesson) : null;
      sub = [u ? `${u.id.toUpperCase()} ${u.title}` : null, l ? l.title : null].filter(Boolean).join(' · ');
    }
    return runCards(el, data.cards, { sub, session: !!q.ids });
  }
  return chooser(el);
}

async function chooser(el) {
  const [m, prog, due] = await Promise.all([meta(), get('progress'), get('cards?due=1&n=200')]);
  const units = prog.units.filter((u) => u.cards_total > 0);
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Cards'),
    h('p', { class: 'sub' }, 'Write the line from memory. It runs, and any correct way counts. Five minutes a day fixes "I know it but not the syntax".'))));
  if (!units.length) {
    el.append(h('div', { class: 'panel empty' }, h('h2', null, 'No cards yet'), h('p', null, 'Cards arrive with the code lessons.')));
    return;
  }
  el.append(h('div', { class: 'panel' }, h('div', { class: 'row' },
    h('div', null, h('h2', { style: { margin: 0 } }, `${plural(due.cards.length, 'card')} due`),
      h('p', { class: 'muted', style: { margin: '2px 0 0' } }, 'Cards you have seen come back on a spaced schedule: 1, 3, 7, 16, 35 days.')),
    h('span', { class: 'spacer' }),
    h('a', { class: `btn ${due.cards.length ? 'primary' : ''}`, href: '#/cards?due=1', 'aria-disabled': due.cards.length ? null : 'true' }, 'Drill due cards'))));
  const last = store('usaaio-cards') || {};
  const unitSel = h('select', { id: 'c-unit' }, units.map((u) => h('option', { value: u.id, selected: last.unit === u.id || null },
    `${u.id.toUpperCase()} ${u.title} (${u.cards_total}, ${u.cards_mastered} mastered)`)));
  const lessonSel = h('select', { id: 'c-lesson' });
  const fill = () => {
    const u = m.curriculum.units.find((x) => x.id === unitSel.value);
    clear(lessonSel).append(h('option', { value: '' }, 'All lessons'));
    for (const l of (u?.lessons || []).filter((x) => x.ready)) lessonSel.append(h('option', { value: l.id }, l.title));
  };
  unitSel.addEventListener('change', fill);
  fill();
  el.append(h('div', { class: 'panel' }, h('h2', null, 'Drill a unit or lesson'),
    h('div', { class: 'chooser' }, h('label', { class: 'field' }, 'Unit', unitSel), h('label', { class: 'field' }, 'Lesson', lessonSel),
      h('button', { class: 'btn primary', type: 'button', 'data-t': 'cards-start', onclick: () => {
        store('usaaio-cards', { unit: unitSel.value });
        location.hash = '#/cards' + qs({ unit: lessonSel.value ? '' : unitSel.value, lesson: lessonSel.value, n: 20 });
      } }, 'Start'))));
}

function runCards(el, cards, { sub }) {
  const box = h('div', { class: 'runner' });
  el.append(box);
  if (!cards.length) {
    box.append(h('div', { class: 'panel empty' }, h('h2', null, 'No cards here'), h('p', null, 'Nothing is due right now.'),
      h('a', { class: 'btn', href: '#/cards' }, 'Choose cards'), continueButton()));
    blockDone('cards');
    return;
  }
  const queue = cards.map((c) => ({ card: c, retry: false }));
  const log = [];
  let k = 0;
  let cm = null;
  const head = h('div', { class: 'runner-head' });
  const stage = h('div');
  box.append(h('div', { class: 'eyebrow' }, sub), h('h1', null, 'Syntax cards'), head, stage);
  const firstTry = () => log.filter((x) => !x.retry);

  function drawHead() {
    const ok = firstTry().filter((x) => x.correct).length;
    clear(head).append(h('span', { class: 'count' }, `Card ${Math.min(k + 1, queue.length)} of ${queue.length}`),
      h('div', { class: 'bar ok', role: 'progressbar', 'aria-valuenow': String(k), 'aria-valuemax': String(queue.length), 'aria-label': 'Cards done' },
        h('span', { style: { width: (k / queue.length) * 100 + '%' } })),
      h('span', { class: 'muted' }, `${ok} right first time`));
  }

  function show() {
    drawHead();
    clear(stage);
    const { card, retry } = queue[k];
    const setupOpen = store('usaaio-setup-open') !== false;
    const setup = card.setup ? h('details', { class: 'card-setup', open: setupOpen || null },
      h('summary', null, 'Setup (already run)'), h('pre', { class: 'code-block cm-s-study' }, h('code', { html: highlightPython(card.setup) }))) : null;
    setup?.addEventListener('toggle', () => store('usaaio-setup-open', setup.open));
    const edHost = h('div', { class: 'card-input' });
    const result = h('div', { class: 'card-result', 'aria-live': 'polite' });
    const submitBtn = h('button', { class: 'btn primary', type: 'button', 'data-t': 'card-submit' }, 'Check');
    const idkBtn = h('button', { class: 'btn ghost', type: 'button', 'data-t': 'card-idk' }, "I don't know");
    const actions = h('div', { class: 'item-actions' }, submitBtn, idkBtn);
    const cardBox = h('div', { class: 'card-box', 'data-card': card.id },
      h('div', { class: 'item-head' }, h('span', { class: 'item-num' }, retry ? 'Again' : 'Write the code'),
        card.state?.box >= 3 ? h('span', { class: 'chip ok' }, 'Mastered') : card.state ? h('span', { class: 'chip muted' }, `Seen ${card.state.seen}x`) : h('span', { class: 'chip accent' }, 'New')),
      mdInline(card.prompt, 'div', 'card-prompt'), setup, edHost,
      h('div', { class: 'card-keys' }, h('kbd', null, 'Enter'), ' checks, ', h('kbd', null, 'Shift'), '+', h('kbd', null, 'Enter'), ' adds a line. Your last line\'s value is the answer.'),
      actions, result);
    stage.append(cardBox);
    let answered = false;
    cm = makeEditor(edHost, { value: '', minimal: true, label: 'Your code for this card',
      extraKeys: { Enter: () => submit(false), 'Shift-Enter': 'newlineAndIndent' } });
    requestAnimationFrame(() => cm.focus());

    async function submit(reveal) {
      if (answered) { next(); return; }
      const code = cm.getValue();
      if (!reveal && !code.trim()) { reveal = true; }
      submitBtn.disabled = idkBtn.disabled = true;
      let res;
      try {
        res = await post('card/answer', reveal ? { id: card.id, reveal: true } : { id: card.id, code });
      } catch (e) {
        submitBtn.disabled = idkBtn.disabled = false;
        toast('Could not check the card: ' + e.message, 'error', 7000);
        return;
      }
      answered = true;
      cm.setOption('readOnly', true);
      actions.hidden = true;
      log.push({ card, correct: res.correct, retry, reveal });
      if (!res.correct && !retry) queue.push({ card, retry: true });
      showResult(res, reveal);
    }

    function showResult(res, reveal) {
      cardBox.classList.add(res.correct ? 'is-right' : 'is-wrong');
      result.append(res.correct
        ? h('div', { class: 'verdict ok' }, h('strong', null, 'Correct.'), ' It ran and passed the check.')
        : res.self_mark
          ? h('div', { class: 'verdict blank' }, h('strong', null, 'Check it yourself.'), ' ', res.self_mark_note || '')
          : h('div', { class: `verdict ${reveal ? 'blank' : 'bad'}` }, h('strong', null, reveal ? 'Here it is.' : 'Not right.'), retry ? '' : ' This card comes back at the end.'));
      if (!res.correct && !reveal && res.error) result.append(h('div', { class: 'card-err' }, res.error));
      if (res.stdout) result.append(h('pre', { class: 'res-pre' }, res.stdout));
      result.append(h('div', { class: 'card-answer' }, h('div', { class: 'label' }, res.correct ? 'Model answer' : 'Answer'),
        h('pre', { class: 'code-block cm-s-study' }, h('code', { html: highlightPython(res.answer) }))));
      if (res.alts?.length) result.append(h('div', { class: 'card-alts' }, 'Also correct: ', res.alts.map((a, i) => [i ? ', ' : '', h('code', null, a)])));
      if (res.note) result.append(mdInline(res.note, 'p', 'card-alts'));
      const rep = reportLink('card', card.id);
      if (rep) result.append(h('p', { class: 'report-row' }, rep));
      const nextBtn = h('button', { class: 'btn primary', type: 'button', 'data-t': 'card-next', onclick: next }, k + 1 < queue.length ? 'Next card' : 'Finish');
      const nextRow = h('div', { class: 'runner-next' }, h('span', { class: 'muted small', style: { alignSelf: 'center' } }, 'Enter for next'), nextBtn);
      result.append(nextRow);
      nextBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } });
      if (res.self_mark) { selfMark(res, nextRow, nextBtn); return; }
      nextBtn.focus({ preventScroll: true });
    }

    // Public build, PyTorch cards: the typed code cannot run in the browser and did not match the reference text,
    // so the student compares and marks it. The mark updates the spaced-repetition box.
    function selfMark(res, nextRow, nextBtn) {
      nextRow.hidden = true;
      const entry = log[log.length - 1];
      const mark = async (ok) => {
        yes.disabled = no.disabled = true;
        try { await post('card/selfmark', { id: card.id, correct: ok }); } catch (e) {
          yes.disabled = no.disabled = false; toast('Could not save the mark: ' + e.message, 'error', 7000); return;
        }
        entry.correct = ok;
        if (ok && !retry) { const j = queue.findIndex((x, n) => n > k && x.card === card && x.retry); if (j >= 0) queue.splice(j, 1); }
        cardBox.classList.toggle('is-right', ok); cardBox.classList.toggle('is-wrong', !ok);
        row.replaceWith(h('div', { class: `verdict ${ok ? 'ok' : 'bad'}` }, h('strong', null, ok ? 'Marked right.' : 'Marked wrong.'),
          ok || retry ? '' : ' This card comes back at the end.'));
        nextBtn.textContent = k + 1 < queue.length ? 'Next card' : 'Finish';
        nextRow.hidden = false;
        nextBtn.focus({ preventScroll: true });
      };
      const yes = h('button', { class: 'btn primary', type: 'button', 'data-t': 'self-right', onclick: () => mark(true) }, 'I had it right');
      const no = h('button', { class: 'btn', type: 'button', 'data-t': 'self-wrong', onclick: () => mark(false) }, 'I got it wrong');
      const row = h('div', { class: 'item-actions', 'data-t': 'self-mark' }, yes, no);
      nextRow.before(row);
      yes.focus({ preventScroll: true });
    }
    submitBtn.addEventListener('click', () => submit(false));
    idkBtn.addEventListener('click', () => submit(true));
  }

  let advancing = false;
  function next() {
    if (advancing) return;
    advancing = true;
    setTimeout(() => { advancing = false; }, 150);
    k += 1;
    if (k < queue.length) show(); else summary();
  }

  function summary() {
    clear(head);
    clear(stage);
    const first = firstTry();
    const ok = first.filter((x) => x.correct).length;
    const missed = first.filter((x) => !x.correct);
    stage.append(h('div', { class: 'panel', 'data-t': 'cards-summary' },
      h('div', { class: 'eyebrow' }, 'Cards done'),
      h('div', { class: 'summary-score' }, `${ok} / ${first.length}`),
      h('p', { class: 'muted' }, 'right on the first try. Missed cards are due again tomorrow.'),
      missed.length ? h('div', null, h('h3', null, 'To remember'), h('ul', { class: 'result-list' }, missed.map((x) =>
        h('li', { style: { gridTemplateColumns: '1fr' } }, mdInline(x.card.prompt, 'span', 'stem-snip'))))) : null,
      h('div', { class: 'row', style: { marginTop: '16px' } }, continueButton(), h('a', { class: 'btn', href: '#/cards' }, 'More cards'))));
    blockDone('cards');
  }
  show();
}
