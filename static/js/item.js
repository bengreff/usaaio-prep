// Part 1 item: five A-E choice cards or a three-digit box, "Leave blank", then feedback and the worked solution.
// Modes: lesson | practice | review (instant feedback) and mock (no feedback, saves on change).
import { h, fmtPoints, toast } from './ui.js';
import { post } from './api.js';
import { mdBlock, mdInline } from './md.js';
import { reportLink } from './report.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const SOURCE = (s) => (!s || s === 'original') ? null : s.replace(/^official-2027-sample$/, 'Official 2027 sample')
  .replace(/^past-(\d{4})-R(\d)-P(\d+)$/, 'Past paper $1 R$2 P$3').replace(/^adapted-(\d{4})-R(\d)-P(\d+)$/, 'Adapted from $1 R$2 P$3');

export function itemView(item, opts = {}) {
  const mode = opts.mode || 'practice';
  const mock = mode === 'mock';
  let selected = mock ? (opts.value ?? null) : null;
  let answered = false;
  let shownAt = null;

  const head = h('div', { class: 'item-head' },
    h('span', { class: 'item-num' }, opts.number ? `Question ${opts.number}` : (item.type === 'mc' ? 'Multiple choice' : 'Integer answer')),
    opts.number ? h('span', { class: 'chip' }, item.type === 'mc' ? 'Multiple choice' : 'Integer 000-999') : null,
    !mock && item.difficulty ? h('span', { class: 'chip muted', title: 'Difficulty: 1 lesson check, 3 typical Round 1, 5 Round 2' }, `Difficulty ${item.difficulty}`) : null,
    !mock && SOURCE(item.source) ? h('span', { class: 'chip accent' }, SOURCE(item.source)) : null,
    opts.prior && opts.prior.seen ? h('span', { class: `chip ${opts.prior.last_ok ? 'ok' : 'bad'}` },
      `Last time: ${opts.prior.last_ok ? 'right' : 'missed'}`) : null);

  const stem = mdBlock(item.stem, 'prose item-stem');
  const root = h('section', { class: `item item-${item.type} mode-${mode}`, 'data-item': item.id, 'aria-label': opts.number ? `Question ${opts.number}` : 'Question' });
  root.append(head, stem);

  let choiceEls = [], input = null;
  const hint = h('span', { class: 'item-hint', 'aria-live': 'polite' });
  const checkBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => submit(currentAnswer()) }, 'Check answer');
  const blankBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => submit('') }, 'Leave blank');
  const clearBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => setAnswer(null, true) }, 'Clear answer');

  if (item.type === 'mc') {
    const group = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Answer choices' });
    (item.choices || []).slice(0, 5).forEach((c, k) => {
      const L = LETTERS[k];
      const el = h('button', { class: 'choice', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-letter': L, tabindex: '-1' },
        h('span', { class: 'choice-letter', 'aria-hidden': 'true' }, L),
        mdInline(c, 'span', 'choice-body'));
      el.setAttribute('aria-label', `Choice ${L}`);
      el.addEventListener('click', () => { if (!answered && !opts.locked) setAnswer(L, true); });
      choiceEls.push(el);
      group.appendChild(el);
    });
    group.addEventListener('keydown', (e) => {
      if (answered || opts.locked) return;
      const k = e.key.toUpperCase();
      const cur = Math.max(0, LETTERS.indexOf(selected ?? 'A'));
      let next = null;
      if (LETTERS.includes(k) && !e.metaKey && !e.ctrlKey && !e.altKey) next = LETTERS.indexOf(k);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (cur + 1) % choiceEls.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (cur + choiceEls.length - 1) % choiceEls.length;
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !mock && selected) { e.preventDefault(); submit(selected); return; }
      if (next !== null) { e.preventDefault(); setAnswer(LETTERS[next], true); choiceEls[next].focus(); }
    });
    root.appendChild(group);
  } else {
    const id = `int-${item.id}-${Math.random().toString(36).slice(2, 7)}`;
    input = h('input', { id, class: 'int-input', type: 'text', inputmode: 'numeric', maxlength: '3', autocomplete: 'off',
      spellcheck: 'false', placeholder: '000', 'aria-describedby': id + '-help', disabled: opts.locked || null });
    if (mock && selected) input.value = selected;
    input.addEventListener('input', () => {
      const v = input.value.replace(/\D/g, '').slice(0, 3);
      if (v !== input.value) input.value = v;
      if (v.length === 3) setAnswer(v, true);
      else if (v.length === 0) setAnswer(null, true);
      else { selected = null; checkBtn.disabled = true; hint.textContent = 'Three digits: for 27 type 027.'; if (mock) opts.onChange?.(null, { partial: true }); }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !mock) {
        e.preventDefault();
        if (input.value.length === 3) submit(input.value);
        else hint.textContent = input.value ? `Answers are three digits: enter ${input.value.padStart(3, '0')}.` : 'Type three digits, or press Leave blank.';
      }
    });
    root.appendChild(h('div', { class: 'int-answer' },
      h('label', { for: id }, 'Your answer'),
      h('div', { class: 'int-row' }, input, h('span', { id: id + '-help', class: 'int-help' }, 'Three digits, 000 to 999'))));
  }

  const actions = h('div', { class: 'item-actions' });
  if (mock) actions.append(clearBtn, hint);
  else actions.append(checkBtn, blankBtn, hint);
  root.appendChild(actions);
  const feedback = h('div', { class: 'item-feedback', hidden: true, 'aria-live': 'polite' });
  root.appendChild(feedback);

  function currentAnswer() { return selected; }

  function setAnswer(v, fromUser) {
    selected = v;
    choiceEls.forEach((el) => {
      const on = el.dataset.letter === v;
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.classList.toggle('selected', on);
      el.tabIndex = on || (!v && el.dataset.letter === 'A') ? 0 : -1;
    });
    if (input && v === null && fromUser && document.activeElement !== input) input.value = '';
    if (input && v && input.value !== v) input.value = v;
    checkBtn.disabled = !v;
    hint.textContent = '';
    if (mock && fromUser) opts.onChange?.(v);
  }
  setAnswer(selected, false);

  async function submit(answer) {
    if (answered) return;
    const seconds = shownAt ? Math.round((Date.now() - shownAt) / 1000) : 0;
    checkBtn.disabled = true; blankBtn.disabled = true;
    let r;
    try {
      r = await post('item/answer', { id: item.id, answer, mode, seconds });
    } catch (e) {
      checkBtn.disabled = !selected; blankBtn.disabled = false;
      toast('Could not check the answer: ' + e.message, 'error', 7000);
      return;
    }
    answered = true;
    showResult(r, answer);
    opts.onAnswered?.(r, answer);
  }

  function showResult(r, answer) {
    root.classList.add('answered', r.correct === true ? 'is-right' : r.correct === false ? 'is-wrong' : 'is-blank');
    choiceEls.forEach((el) => {
      el.disabled = true;
      el.classList.toggle('is-correct', el.dataset.letter === r.answer);
      el.classList.toggle('is-wrong', el.dataset.letter === answer && r.correct === false);
      if (el.dataset.letter === r.answer) el.appendChild(h('span', { class: 'choice-mark ok' }, 'Answer'));
      else if (el.dataset.letter === answer) el.appendChild(h('span', { class: 'choice-mark bad' }, 'Your choice'));
    });
    if (input) input.disabled = true;
    actions.hidden = true;
    const pts = `${r.points > 0 ? '+' : ''}${fmtPoints(r.points)} points`;
    const banner = r.correct === true
      ? h('div', { class: 'verdict ok' }, h('strong', null, 'Correct.'), ` ${pts}`)
      : r.correct === false
        ? h('div', { class: 'verdict bad' }, h('strong', null, 'Not right.'), ` ${pts}. The answer is `, h('strong', { class: 'mono' }, r.answer),
          item.type === 'int' ? `; you entered ${answer}.` : '.')
        : h('div', { class: 'verdict blank' }, h('strong', null, 'Left blank.'), ` ${pts}. The answer is `, h('strong', { class: 'mono' }, r.answer), '.');
    feedback.append(banner);
    if (r.correct === false && r.why_wrong) {
      feedback.append(h('div', { class: 'why-wrong' }, h('div', { class: 'label' }, `Why ${answer} is wrong`), mdBlock(r.why_wrong)));
    }
    if (r.correct === null && item.type === 'mc') {
      feedback.append(h('p', { class: 'coach' }, 'Blank scores 1.5. A blind guess among five also averages 1.5, so guess as soon as you can rule out one choice (7.5 / 4 = 1.875).'));
    }
    if (r.solution) feedback.append(h('div', { class: 'solution' }, h('div', { class: 'label' }, 'Worked solution'), mdBlock(r.solution)));
    const others = Object.entries(r.all_why_wrong || {}).filter(([L]) => L !== answer && L !== r.answer).sort();
    if (item.type === 'mc' && others.length) {
      feedback.append(h('details', { class: 'others' }, h('summary', null, 'Why the other choices are wrong'),
        h('dl', null, others.map(([L, why]) => [h('dt', null, L), h('dd', null, mdBlock(why))]))));
    }
    const rep = reportLink('item', item.id);
    if (rep) feedback.append(h('p', { class: 'report-row' }, rep));
    feedback.hidden = false;
  }

  // Start the clock when the item is first on screen.
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) { shownAt = shownAt || Date.now(); io.disconnect(); }
  });
  io.observe(root);

  root.focusFirst = () => (choiceEls.find((c) => c.tabIndex === 0) || input)?.focus();
  root.setLocked = (v) => { opts.locked = v; choiceEls.forEach((c) => { c.disabled = v; }); if (input) input.disabled = v; clearBtn.disabled = v; };
  root.showResult = showResult;
  return root;
}

// Read-only review of a finished item (mock and quiz results): stem, choices with marks, why the chosen letter is
// wrong, the solution, and (opts.lesson = {id, title}) the lesson the question comes from.
export function itemReview(r, number, opts = {}) {
  const root = h('section', { class: `item item-${r.type} answered ${r.correct === true ? 'is-right' : r.correct === false ? 'is-wrong' : 'is-blank'}` });
  root.append(h('div', { class: 'item-head' }, h('span', { class: 'item-num' }, `Question ${number}`),
    h('span', { class: `chip ${r.correct === true ? 'ok' : r.correct === false ? 'bad' : 'muted'}` },
      r.correct === true ? `Right, +${fmtPoints(r.points)}` : r.correct === false ? 'Wrong, 0' : `Blank, +${fmtPoints(r.points)}`)),
  mdBlock(r.stem, 'prose item-stem'));
  if (r.type === 'mc') {
    root.appendChild(h('div', { class: 'choices' }, (r.choices || []).map((c, k) => {
      const L = LETTERS[k];
      const el = h('div', { class: `choice static ${L === r.answer ? 'is-correct' : ''} ${L === r.given && r.correct === false ? 'is-wrong' : ''}` },
        h('span', { class: 'choice-letter' }, L), mdInline(c, 'span', 'choice-body'));
      if (L === r.answer) el.appendChild(h('span', { class: 'choice-mark ok' }, 'Answer'));
      else if (L === r.given) el.appendChild(h('span', { class: 'choice-mark bad' }, 'Your choice'));
      return el;
    })));
  } else {
    root.appendChild(h('p', { class: 'int-review' }, 'You entered ', h('strong', { class: 'mono' }, r.given || '(blank)'),
      '. The answer is ', h('strong', { class: 'mono' }, r.answer), '.'));
  }
  if (r.correct === false && r.why_wrong) {
    root.appendChild(h('div', { class: 'why-wrong' }, h('div', { class: 'label' }, `Why ${r.given} is wrong`), mdBlock(r.why_wrong)));
  }
  if (r.solution) root.appendChild(h('div', { class: 'solution' }, h('div', { class: 'label' }, 'Worked solution'), mdBlock(r.solution)));
  const others = Object.entries(r.all_why_wrong || {}).filter(([L]) => L !== r.given && L !== r.answer).sort();
  if (r.type === 'mc' && others.length) {
    root.appendChild(h('details', { class: 'others' }, h('summary', null, 'Why the other choices are wrong'),
      h('dl', null, others.map(([L, why]) => [h('dt', null, L), h('dd', null, mdBlock(why))]))));
  }
  if (opts.lesson) {
    root.appendChild(h('p', { class: 'review-lesson' }, 'From the lesson ', h('a', { href: `#/lesson/${opts.lesson.id}` }, opts.lesson.title)));
  }
  const rep = reportLink('item', r.id);
  if (rep) root.appendChild(h('p', { class: 'report-row' }, rep));
  return root;
}
