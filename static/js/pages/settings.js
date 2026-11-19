// Settings: exam date, weekly hours target, session length, round focus, and units tested out (placement quiz).
import { h, toast } from '../ui.js';
import { post, meta, invalidateMeta, unitInfo } from '../api.js';

const MINUTES = [20, 30, 45, 60, 90];

export async function render(el) {
  el.dataset.title = 'Settings';
  const m = await meta(true);
  const S = m.settings || {};
  const rf = m.round_focus || { focus: 'R1', auto: 'R1', override: null, reason: '' };
  const field = (label, input, help) => h('div', { class: 'set-field' }, h('label', { for: input.id }, label), input,
    help ? h('p', { class: 'muted small', id: input.id + '-help' }, help) : null);

  const date = h('input', { id: 'set-exam', type: 'date', value: S.exam_date || '2027-02-19', required: true, 'aria-describedby': 'set-exam-help' });
  const hours = h('input', { id: 'set-hours', type: 'number', min: '0.5', max: '40', step: '0.5', value: String(S.weekly_hours ?? 3), inputmode: 'decimal', 'aria-describedby': 'set-hours-help' });
  const mins = h('select', { id: 'set-minutes', 'aria-describedby': 'set-minutes-help' },
    [...new Set([...MINUTES, S.session_minutes || 45])].sort((a, b) => a - b).map((x) => h('option', { value: String(x), selected: x === (S.session_minutes || 45) || null }, `${x} minutes`)));
  const radios = [['auto', `Automatic (now ${rf.auto === 'R2' ? 'Round 2' : 'Round 1'}: ${rf.reason})`], ['R1', 'Round 1'], ['R2', 'Round 2']].map(([v, label]) =>
    h('label', { class: 'set-radio' }, h('input', { type: 'radio', name: 'focus', value: v, checked: (rf.override || 'auto') === v || null }), label));
  const focus = h('fieldset', { class: 'set-field', 'aria-describedby': 'set-focus-help' }, h('legend', null, 'Round focus'), ...radios,
    h('p', { class: 'muted small', id: 'set-focus-help' }, 'Which lessons the Today plan schedules. Automatic is Round 1 until the exam date has passed or every Round 1 lesson is done, then Round 2 (units U15 to U22).'));

  const saveBtn = h('button', { class: 'btn primary', type: 'submit', 'data-t': 'settings-save' }, 'Save settings');
  const form = h('form', { class: 'panel settings-form', 'data-t': 'settings-form', novalidate: true },
    h('h2', null, 'Your plan'),
    field('Exam date', date, 'The Round 1 date. The countdown and the Round 1 focus use it.'),
    field('Weekly hours target', hours, 'The bar on Today compares your week with this.'),
    field('Session length', mins, 'The plan on Today fills this many minutes by default.'),
    focus,
    h('div', { class: 'row' }, saveBtn, h('span', { class: 'muted small', 'aria-live': 'polite', 'data-t': 'settings-status' })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hv = Number(hours.value);
    if (!date.value) { toast('Pick an exam date.', 'error'); date.focus(); return; }
    if (!(hv >= 0.5 && hv <= 40)) { toast('Weekly hours: a number from 0.5 to 40.', 'error'); hours.focus(); return; }
    saveBtn.disabled = true;
    try {
      await post('settings', { exam_date: date.value, weekly_hours: hv, session_minutes: Number(mins.value),
        round_focus: form.querySelector('input[name=focus]:checked')?.value || 'auto' });
      invalidateMeta();
      const m2 = await meta(true);
      const cd = document.getElementById('countdown');
      if (cd) cd.textContent = countdownText(m2.days_to_round1);
      form.querySelector('[data-t=settings-status]').textContent = `Saved. Today plans ${m2.round_focus.focus === 'R2' ? 'Round 2' : 'Round 1'} lessons.`;
      toast('Settings saved.', 'ok');
    } catch (err) { toast('Could not save: ' + err.message, 'error', 7000); } finally { saveBtn.disabled = false; }
  });

  const outBox = h('div', { class: 'panel', 'data-t': 'tested-out' });
  function drawOut(list) {
    outBox.replaceChildren(h('h2', null, 'Units you tested out of'));
    if (!list.length) {
      outBox.append(h('p', { class: 'muted' }, m.features?.placement
        ? ['None. The ', h('a', { href: '#/placement' }, 'placement quiz'), ' can mark units you already know.']
        : 'None. The planner follows every unit in order.'));
      return;
    }
    outBox.append(h('p', { class: 'muted small' }, 'The Today plan skips these lessons. Their questions still come up in practice and progress checks.'),
      h('ul', { class: 'set-out' }, list.map((uid) => h('li', null, h('span', { class: 'unit-id' }, uid.toUpperCase()), ' ', unitInfo(m, uid)?.title || '',
        h('button', { class: 'btn small ghost', type: 'button', 'data-t': `undo-${uid}`, onclick: async () => {
          try {
            const r = await post('settings', { tested_out: list.filter((x) => x !== uid) });
            invalidateMeta();
            drawOut(r.tested_out || []);
            toast(`${uid.toUpperCase()} is back in the plan.`, 'ok');
          } catch (err) { toast('Could not save: ' + err.message, 'error'); }
        } }, 'Undo')))));
  }
  drawOut(S.tested_out || []);

  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings'),
    h('p', { class: 'sub' }, window.STATIC_MODE ? 'Saved in this browser with your progress.' : 'Saved with your progress.'))),
  form, outBox);
}

export function countdownText(days) {
  if (days > 0) return `${days} days to Round 1`;
  if (days === 0) return 'Round 1 is today';
  return 'Round 1 is done';
}
