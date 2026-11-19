// Code lab: problem list and the problem workspace (statement | editor + results). The workspace is reused by
// mock Part 2, where it saves to the mock and never shows hidden-test feedback.
import { h, clear, clock, debounce, confirmDialog, toast, store, plural } from '../ui.js';
import { activity } from '../time.js';
import { get, post, meta, download } from '../api.js';
import { mdBlock, highlightPython } from '../md.js';
import { makeEditor } from '../editor.js';
import { blockDone, continueButton, getSession } from '../session.js';
import { reportLink } from '../report.js';

export async function render(el, r) {
  if (r.name === 'problem') {
    const P = await get('problem/' + encodeURIComponent(r.args[0]));
    el.dataset.title = P.meta.title || P.id;
    el.classList.add('wide');
    const ws = workspace(el, P, {});
    return () => ws.destroy();
  }
  el.dataset.title = 'Code lab';
  const [data, m] = await Promise.all([get('problems'), meta()]);
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Code lab'),
    h('p', { class: 'sub' }, 'Part 2 practice: the same import bans, hidden tests and time limits as the contest grader. No autocomplete, like the exam.'))));
  if (!data.problems.length) {
    el.append(h('div', { class: 'panel empty' }, h('h2', null, 'No problems yet'), h('p', null, 'Problems arrive with the units.')));
    return;
  }
  const solved = data.problems.filter((p) => p.solved).length;
  el.append(h('p', { class: 'muted' }, `${solved} of ${plural(data.problems.length, 'problem')} solved.`));
  const byUnit = new Map();
  for (const p of data.problems) { if (!byUnit.has(p.unit)) byUnit.set(p.unit, []); byUnit.get(p.unit).push(p); }
  for (const [uid, ps] of byUnit) {
    const u = m.curriculum.units.find((x) => x.id === uid);
    el.append(h('section', { class: 'prob-group' },
      h('h2', null, h('span', { class: 'unit-id' }, uid.toUpperCase()), u ? u.title : uid),
      h('table', { class: 'prob-table' },
        h('thead', null, h('tr', null, ['Problem', 'Status', 'Difficulty', 'Target'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, ps.map((p) => h('tr', null,
          h('td', null, h('a', { href: `#/problem/${p.id}` }, p.title || p.id),
            p.source && p.source !== 'original' ? h('span', { class: 'chip accent', style: { marginLeft: '8px' } }, p.source.startsWith('official') ? 'Official sample' : p.source) : null),
          h('td', null, p.solved ? h('span', { class: 'chip ok' }, 'Solved') : p.attempted ? h('span', { class: 'chip warn' }, 'Attempted') : h('span', { class: 'chip muted' }, 'New')),
          h('td', null, diffDots(p.difficulty)),
          h('td', { class: 'muted' }, p.minutes ? `${p.minutes} min` : '')))))));
  }
}

export function diffDots(d) {
  return h('span', { class: 'diff', role: 'img', 'aria-label': `Difficulty ${d} of 5`, title: `Difficulty ${d} of 5` },
    [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= d ? 'on' : '' })));
}

const testName = (n) => n.replace(/^test_/, '').replace(/_/g, ' ');

export function renderGrade(r, { mode }) {
  const box = h('div', { 'data-t': 'grade' });
  const tests = r.tests || [];
  const passed = tests.filter((t) => t.passed).length;
  const staticBad = (r.static || []).filter((s) => !s.ok);
  let cls = 'neutral', text;
  if (r.error && !tests.length) { cls = 'bad'; text = mode === 'submit' ? 'Submission failed before the tests ran.' : 'The code failed before the examples ran.'; }
  else if (mode === 'submit') {
    if (r.ok) { cls = 'ok'; text = `Accepted. All ${tests.length} tests passed and every rule is met.`; }
    else { cls = 'bad'; text = `Not accepted: ${passed} of ${tests.length} tests passed${staticBad.length ? ', and a rule check failed' : ''}.`; }
  } else {
    cls = passed === tests.length && !staticBad.length ? 'ok' : 'bad';
    text = `Examples: ${passed} of ${tests.length} passed${staticBad.length ? '; a rule check failed' : ''}.${passed === tests.length && !staticBad.length ? ' Submit to run the hidden tests.' : ''}`;
  }
  box.append(h('div', { class: `res-summary ${cls}` }, text));
  if (r.error) box.append(h('div', { class: 'res-error' }, r.error));
  if (r.static?.length) {
    box.append(h('div', { class: 'res-h' }, 'Rule checks'), h('ul', { class: 'checks' }, r.static.map((s) =>
      h('li', null, h('span', { class: `pf ${s.ok ? 'ok' : 'bad'}` }, s.ok ? 'PASS' : 'FAIL'), h('span', null, s.msg), h('span')))));
  }
  if (tests.length) {
    box.append(h('div', { class: 'res-h' }, mode === 'submit' ? 'Tests' : 'Example tests'), h('ul', { class: 'checks' }, tests.map((t) =>
      h('li', null, h('span', { class: `pf ${t.passed ? 'ok' : 'bad'}` }, t.passed ? 'PASS' : 'FAIL'),
        h('span', null, h('span', { class: 't-name' }, testName(t.name)), t.visible ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, 'example') : null,
          t.msg && !t.passed ? h('span', { class: 't-msg' }, t.msg) : null),
        h('span', { class: 't-sec' }, t.seconds != null ? `${t.seconds.toFixed(2)} s` : '')))));
  }
  if (r.stdout) box.append(h('div', { class: 'res-h' }, 'Printed output'), h('pre', { class: 'res-pre' }, r.stdout));
  if (r.warnings?.length) box.append(h('div', { class: 'res-h' }, 'Warnings'), h('pre', { class: 'res-pre' }, r.warnings.join('\n')));
  return box;
}

// Hints (problems/<pid>/hints.json): "Hint 1 of N" buttons that open one at a time. Opening one records it
// (state.hints = how many were opened); hints already opened show again on the next visit.
function hintsBox(P) {
  const hints = P.hints || [];
  if (!hints.length) return null;
  const list = h('div', { class: 'hint-list' });
  const btnRow = h('div', { class: 'row' });
  const box = h('section', { class: 'hints', 'data-t': 'hints', 'aria-label': 'Hints' }, h('div', { class: 'res-h' }, 'Hints'), list, btnRow);
  let opened = Math.min(P.state?.hints || 0, hints.length);
  const show = (k, text) => list.append(h('div', { class: 'hint', 'data-t': 'hint' }, h('div', { class: 'label' }, `Hint ${k} of ${hints.length}`), mdBlock(text)));
  for (let k = 1; k <= opened; k++) show(k, hints[k - 1]);
  const draw = () => {
    clear(btnRow);
    if (opened >= hints.length) { btnRow.append(h('span', { class: 'muted small' }, opened === 1 ? 'That is the only hint.' : 'No more hints. The reference solution unlocks after a submit.')); return; }
    const b = h('button', { class: 'btn small', type: 'button', 'data-t': 'hint-next', onclick: async () => {
      b.disabled = true;
      try {
        const r = await post(`problem/${P.id}/hint`, { n: opened + 1 });
        opened += 1;
        show(opened, r.hint);
        draw();
      } catch (e) { b.disabled = false; toast('Could not open the hint: ' + e.message, 'error'); }
    } }, `Hint ${opened + 1} of ${hints.length}`);
    btnRow.append(b, opened ? null : h('span', { class: 'muted small' }, 'Try for a while first. Hints open one at a time.'));
  };
  draw();
  return box;
}

// Public build, problems graded in the browser: browser timing is approximate, so link the problem's Colab notebook
// (same grader, real time limits).
function timeInColab(P) {
  const S = window.STATIC_MODE;
  if (!S || P.colab || !S.colab_base || !(S.notebooks || []).includes(P.id)) return null;
  return h('p', { class: 'colab-time small', 'data-t': 'colab-time' },
    h('a', { href: `${S.colab_base}${P.id}.ipynb`, target: '_blank', rel: 'noopener', 'data-t': 'colab-time-link' }, 'Time it in Colab'),
    ': the browser runs Python slower than Colab and its timing varies, so time limits here are approximate. The notebook has the same grader with the real limits.');
}

function reportRow(P) {
  const rep = reportLink('problem', P.id);
  return rep ? h('p', { class: 'report-row' }, rep) : null;
}

// P: GET /api/problem/<pid>. opts.mock: {mid, code, remaining(): seconds, onSave(code)}
export function workspace(el, P, opts = {}) {
  const mock = opts.mock || null;
  const M = P.meta || {};
  let state = { ...(P.state || {}) };
  // Practice timer = the server's accumulated active seconds on this problem (state.active, across sessions) plus
  // what the heartbeat has not posted yet. It counts by the heartbeat's rule (tab visible, used in the last
  // 2 minutes, not paused), so the time shown is the time the server records.
  const myRoute = activity.route();
  let base = state.active || 0;
  const total = () => base + (mock ? 0 : activity.pending(myRoute));
  let submitMark = total();

  // ---- left: statement
  const restrict = h('div', { class: 'restrict' },
    h('span', { class: 'chip accent' }, `Imports: ${(M.allowed_imports || []).join(', ') || 'none'}`),
    M.banned?.length ? h('span', { class: 'chip bad', title: 'Names and attributes the grader rejects' }, `Banned: ${M.banned.join(', ')}`) : null,
    M.ban_loops ? h('span', { class: 'chip bad' }, 'No loops') : null,
    M.minutes ? h('span', { class: 'chip' }, `Target ${M.minutes} min`) : null,
    M.module_name ? h('span', { class: 'chip muted' }, `${M.module_name}.py`) : null);
  const left = h('section', { class: 'ws-left', 'aria-label': 'Problem statement' },
    h('p', { class: 'narrow-note', 'data-t': 'narrow-note' }, 'Coding is easiest on a laptop. Everything here works on a phone, but the editor is cramped.'),
    h('div', { class: 'eyebrow' }, mock ? 'Mock exam, Part 2' : h('a', { href: '#/code', style: { color: 'inherit', textDecoration: 'none' } }, `Code lab · ${P.unit.toUpperCase()}`)),
    h('h1', null, M.title || P.id), restrict, mdBlock(P.statement),
    mock ? null : hintsBox(P), mock ? null : timeInColab(P), mock ? null : reportRow(P));

  // ---- right: toolbar, editor, results
  const runBtn = h('button', { class: 'btn', type: 'button', 'data-t': 'run', title: 'Run the example tests (Cmd+Enter)' }, 'Run examples', h('span', { class: 'kbd-hint' }, '⌘↵'));
  const submitBtn = h('button', { class: 'btn primary', type: 'button', 'data-t': 'submit', title: 'Run every test, including hidden ones (Shift+Cmd+Enter)' }, 'Submit');
  const timerEl = h('span', { class: 'ws-timer', 'aria-label': 'Timer', role: 'timer' }, '00:00');
  const saveEl = h('span', { class: 'save-state', 'aria-live': 'polite' }, '');
  const colabBtn = h('button', { class: 'btn ghost', type: 'button', title: 'Download a Colab notebook that writes your .py' }, 'Export to Colab');
  const resetBtn = h('button', { class: 'btn ghost', type: 'button', title: 'Replace your code with the starter' }, 'Reset');
  const pauseBtn = h('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': 'false' }, 'Pause');
  const toolbar = h('div', { class: 'ws-toolbar' }, runBtn, mock ? null : submitBtn, h('span', { class: 'spacer' }),
    saveEl, timerEl, mock ? null : pauseBtn, mock ? null : colabBtn, resetBtn);
  const edHost = h('div', { class: 'ws-editor' });

  const tabsDef = mock ? [['results', 'Results'], ['help', 'help()']] : [['results', 'Results'], ['help', 'help()'], ['ref', 'Reference']];
  const panels = {};
  const tabBtns = tabsDef.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': k, onclick: () => selectTab(k) }, label));
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tabBtns);
  for (const [k] of tabsDef) panels[k] = h('div', { class: 'tab-panel', role: 'tabpanel', hidden: true, 'data-panel': k });
  function selectTab(k) {
    tabBtns.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === k ? 'true' : 'false'));
    Object.entries(panels).forEach(([kk, p]) => { p.hidden = kk !== k; });
  }
  const bottom = h('div', { class: 'ws-bottom' }, tabs, ...Object.values(panels));
  const right = h('section', { class: 'ws-right', 'aria-label': 'Editor' }, toolbar, edHost, bottom);
  const wsEl = h('div', { class: 'ws' }, left, right);
  el.append(wsEl);

  panels.results.append(h('p', { class: 'muted' }, mock
    ? 'Run checks your code on the examples from the statement. Hidden tests run when the mock ends.'
    : 'Run checks the examples from the statement. Submit runs every test, including hidden ones, plus the import and ban checks.'));

  // help() box
  const helpIn = h('input', { type: 'text', placeholder: 'np.where', 'aria-label': 'Name to look up with help()', spellcheck: 'false', autocomplete: 'off' });
  const helpOut = h('pre', { class: 'help-out' });
  const helpGo = async () => {
    const expr = helpIn.value.trim().replace(/^help\((.*)\)$/, '$1');
    if (!expr) return;
    helpOut.textContent = 'Looking up ' + expr + '...';
    try { helpOut.textContent = (await post('help', { expr })).text || '(no help text)'; } catch (e) { helpOut.textContent = e.message; }
  };
  helpIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') helpGo(); });
  panels.help.append(h('div', { class: 'help-row' }, h('span', { class: 'mono', style: { alignSelf: 'center' } }, 'help('), helpIn,
    h('span', { class: 'mono', style: { alignSelf: 'center' } }, ')'), h('button', { class: 'btn small', type: 'button', onclick: helpGo }, 'Look up')),
  h('p', { class: 'muted small' }, 'Colab allows help() during the exam. np, pd, torch, nn and F are imported.'), helpOut);

  // reference (after a submit)
  if (!mock) drawRef();
  function drawRef() {
    const p = clear(panels.ref);
    if (state.revealed) { loadRef(); return; }
    if (!state.submits) { p.append(h('p', { class: 'muted' }, 'Submit once to unlock the reference solution. Give it the full target time first.')); return; }
    p.append(h('p', { class: 'muted' }, 'The reference shows one way that passes every test and every ban.'),
      h('button', { class: 'btn', type: 'button', 'data-t': 'reveal', onclick: async () => {
        const ok = await confirmDialog({ title: 'Show the reference solution?', body: 'Seeing it marks this problem as revealed. Try once more first if you are close.', ok: 'Show it' });
        if (!ok) return;
        try { await post(`problem/${P.id}/reveal`); state.revealed = true; loadRef(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Show reference solution'));
  }
  async function loadRef() {
    const p = clear(panels.ref);
    try {
      const { code } = await get(`problem/${P.id}/solution`);
      p.append(h('div', { class: 'ref-code' }, h('p', { class: 'muted small' }, 'Reference solution'),
        h('pre', { class: 'code-block cm-s-study' }, h('code', { html: highlightPython(code) }))));
    } catch (e) { p.append(h('p', { class: 'muted' }, e.message)); }
  }
  selectTab('results');

  // editor
  const initial = mock ? (mock.code || P.starter) : (P.saved ?? P.starter);
  const save = debounce(async (code) => {
    saveEl.textContent = 'Saving';
    saveEl.classList.remove('bad');
    try {
      if (mock) await mock.onSave(code);
      else await post(`problem/${P.id}/save`, { code });
      saveEl.textContent = mock ? 'Saved to mock' : 'Saved';
    } catch (e) {
      saveEl.textContent = 'Not saved';
      saveEl.classList.add('bad');
      saveEl.title = e.message;
    }
  }, 800);
  const cm = makeEditor(edHost, { value: initial, onRun: () => run('run'), onSubmit: mock ? null : () => run('submit'),
    onChange: (code) => { saveEl.textContent = 'Editing'; save(code); }, label: 'Your solution' });
  saveEl.textContent = mock ? (mock.code ? 'Saved to mock' : '') : (P.saved ? 'Saved' : 'Starter code');

  let busy = false;
  async function run(mode) {
    if (busy) return;
    busy = true;
    runBtn.disabled = submitBtn.disabled = true;
    const code = cm.getValue();
    selectTab('results');
    clear(panels.results).append(h('div', { class: 'loading', style: { justifyContent: 'flex-start', padding: '8px 0' } }, h('span', { class: 'spinner' }),
      mode === 'submit' ? 'Running every test' : 'Running the examples'));
    try {
      save.flush(code);
      const body = mode === 'submit' ? { code, seconds: Math.max(0, total() - submitMark) } : (mock ? { code, mock: mock.mid } : { code });
      const r = await post(`problem/${P.id}/${mode}`, body);
      clear(panels.results).append(renderGrade(r, { mode }));
      if (mode === 'submit') {
        submitMark = total();
        state.submits = (state.submits || 0) + 1;
        if (r.ok) state.solved = true;
        drawRef();
        blockDone('problem', P.id);
        const c = getSession() ? continueButton() : null;
        if (c) panels.results.append(h('div', { class: 'row', style: { marginTop: '12px' } }, c));
      }
      if (!mock) saveEl.textContent = 'Saved';
    } catch (e) {
      clear(panels.results).append(h('div', { class: 'res-error' }, e.message));
    } finally {
      busy = false;
      runBtn.disabled = submitBtn.disabled = false;
    }
  }
  runBtn.addEventListener('click', () => run('run'));
  submitBtn.addEventListener('click', () => run('submit'));
  resetBtn.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Reset to the starter code?', body: 'Your current code will be replaced.', ok: 'Reset', danger: true })) cm.setValue(P.starter);
  });
  colabBtn.addEventListener('click', async () => {
    try {
      save.flush(cm.getValue());
      await post(`problem/${P.id}/save`, { code: cm.getValue() });
      await download(`problem/${P.id}/colab.ipynb`, `${P.id}.ipynb`);
      toast('Notebook downloaded. Open colab.research.google.com, File, Upload notebook.', 'ok', 6000);
    } catch (e) { toast('Export failed: ' + e.message, 'error'); }
  });

  // timer: count up (practice, from the server's total) or down to the mock deadline
  let paused = false;
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    activity.setPaused(paused);
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    drawTimer();
  });
  function drawTimer() {
    const t = total();
    timerEl.textContent = clock(t) + (M.minutes ? ` / ${M.minutes}:00` : '');
    timerEl.classList.toggle('over', !!M.minutes && t > M.minutes * 60);
    const idle = !activity.counting();
    timerEl.classList.toggle('idle', idle);
    timerEl.title = paused ? 'Paused' : idle ? 'Not counting: the tab is hidden or the page was not used for 2 minutes' : 'Active time on this problem, all sessions';
  }
  let tick = null, offTick = () => {}, offSaved = () => {};
  if (mock) {
    tick = setInterval(() => {
      const rem = mock.remaining();
      timerEl.textContent = clock(rem) + ' left';
      timerEl.classList.toggle('low', rem < 300);
    }, 1000);
  } else {
    store(`usaaio-ptimer-${P.id}`, null); // the old browser-only timer
    offTick = activity.onTick(drawTimer);
    offSaved = activity.onSaved(({ route, resp }) => {
      if (route === myRoute && resp && resp.problem_seconds != null) { base = Math.max(base, resp.problem_seconds); drawTimer(); }
    });
    drawTimer();
  }
  requestAnimationFrame(() => { cm.refresh(); cm.focus(); });
  if (P.colab) {
    runBtn.hidden = submitBtn.hidden = true;
    import('../local/colab_panel.js').then((mod) => mod.mount(left, P, {
      getCode: () => cm.getValue(), mock: !!mock, results: panels.results,
      onState: (st) => { state = { ...state, ...st }; if (!mock) drawRef(); if (st.submits) blockDone('problem', P.id); },
    }));
  }

  return {
    cm,
    getCode: () => cm.getValue(),
    flush: () => save.flush(cm.getValue()),
    destroy() {
      clearInterval(tick);
      offTick();
      offSaved();
      if (paused) activity.setPaused(false);
      save.flush(cm.getValue());
    },
  };
}
