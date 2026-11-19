// Public build: the local server's JSON API (API.md) implemented in the browser. api.js sends every request here
// when window.STATIC_MODE is set. Same endpoints, response shapes, status codes and error texts as server.py;
// planning logic lives in logic.js, content in content.js, progress in store.js, Python in py.js (Pyodide).
// Differences from the server, all because PyTorch does not run in the browser:
// - try blocks that import torch return the output recorded at build time ({recorded: true});
// - cards that need torch are compared as text; a mismatch asks the student to self-mark (POST card/selfmark);
// - problems that need torch are solved in Colab (P.colab, POST problem/<pid>/selfmark) and mock Part 2 skips them.
import * as Cn from './content.js';
import * as S from './store.js';
import * as L from './logic.js';

let clk = L.realClock();
let pyMod = null;
const py = async () => {
  if (!pyMod) { pyMod = await import('./py.js'); await import('./pystatus.js'); }
  return pyMod;
};
/** Tests: a fixed clock and a Python stand-in. */
export function _setForTest({ clock, python } = {}) { if (clock) clk = clock; if (python) pyMod = python; }

const EXEC_LIMIT = 30;          // seconds of running time for a try block or card (the server allows 15 natively)
const TEST_ALLOWANCE = 3;       // per-test hard limit = test_timeout_s x this (worker restart; catches infinite loops)

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const ok = (data) => ({ status: 200, data });
const fail = (status, msg) => { throw new HttpError(status, msg); };
const int = (v, d) => { const n = parseInt(v ?? d, 10); if (Number.isNaN(n)) fail(500, `ValueError: invalid literal for int(): '${v}'`); return n; };

export async function handle(method, path, body) {
  const u = new URL(path, 'http://local/');
  const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').map(decodeURIComponent);
  const q = {};
  for (const [k, v] of u.searchParams) if (v !== '' && !(k in q)) q[k] = v;   // parse_qs: blanks dropped, first wins
  try {
    return method === 'GET' ? await GET(parts, q) : await POST(parts, body || {});
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, data: { error: e.message } };
    return { status: 500, data: { error: `${e && e.name ? e.name : 'Error'}: ${e && e.message ? e.message : e}` } };
  }
}

// ------------------------------------------------------------------------------------------------ helpers
const colabCode = (code, C) => {
  const mods = new Set();
  for (const m of String(code).matchAll(/^\s*(?:import\s+([\w.]+(?:\s*,\s*[\w.]+)*)|from\s+([\w.]+)\s+import)/gm)) {
    (m[1] ? m[1].split(',') : [m[2]]).forEach((x) => mods.add(x.trim().split('.')[0]));
  }
  return (C.site.colab_modules || ['torch']).some((x) => mods.has(x) && !String(code).includes(`${x}.py`));
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const normCode = (s) => String(s || '').replace(/\s+/g, '').replace(/"/g, "'");

async function runSnippet(payload) {
  const P = await py();
  const r = await P.run('snippet', payload, { limit: EXEC_LIMIT });
  if (r.timedOut) return { ok: false, stdout: '', images: [], result_repr: null, error: `TimeoutError: ran longer than ${EXEC_LIMIT} s in the browser (an infinite loop?). Python restarts on the next run.` };
  if (r.stopped || r.loadFailed) return { ok: false, stdout: '', images: [], result_repr: null, error: r.error };
  return r;
}

async function grade(pid, code, mode) {
  const pr = await Cn.problem(pid);
  if (!pr) return { ok: false, error: 'unknown problem' };
  if (pr.colab) {
    return { ok: false, static: [], tests: [], stdout: '',
      error: 'This problem uses PyTorch, which does not run in the browser. Open it in Colab (the panel on the left): the notebook has a grader cell that runs every test.' };
  }
  const sec = pr.secret();
  const per = Number(pr.meta.test_timeout_s ?? 20);
  const limit = Math.round(per * TEST_ALLOWANCE);
  const P = await py();
  const r = await P.run('grade', { pid, meta: pr.meta, mode, code, grader: sec.grader, files: sec.files || {} }, { testLimit: limit });
  if (r.loadFailed || r.stopped) return { ok: false, error: r.error, static: [], tests: [] };
  if (!r.timedOut) return r;
  // a test (or the import) ran past its limit: the worker was restarted; rebuild the result from its progress events
  const ev = r.events || [];
  const staticRes = ev.find((e) => e.ev === 'static')?.static || [];
  const doneRecs = ev.filter((e) => e.ev === 'done').map((e) => e.rec);
  const list = ev.find((e) => e.ev === 'tests')?.tests || [];
  if (r.during?.ev === 'import') {
    return { ok: false, static: staticRes, tests: [], stdout: '', error: `importing your file took over ${limit} s in the browser (Python was restarted)` };
  }
  const tests = [...doneRecs];
  for (const t of list) {
    if (tests.some((x) => x.name === t.name)) continue;
    if (t.name === r.during?.name) tests.push({ ...t, passed: false, seconds: limit, msg: `took longer than ${limit} s in the browser (infinite loop, or far too slow); Python was restarted` });
    else tests.push({ ...t, passed: false, seconds: 0, msg: 'not run: an earlier test ran out of time and Python was restarted' });
  }
  return { ok: false, static: staticRes, tests, stdout: '', error: null };
}

function mockList(P) {
  return Object.entries(P.mocks).map(([k, m]) => ({ id: k, kind: m.kind, unit: m.unit ?? null, started: m.started,
    part1_ends: m.part1_ends ?? null, part2_ends: m.part2_ends ?? null, finished: m.finished, score: m.score ?? null, max: m.max ?? null }));
}

async function mockView(C, P, mid) {
  const m = P.mocks[mid];
  if (!m) return null;
  const out = { id: mid, kind: m.kind, unit: m.unit ?? null, units: m.units ?? null, finished: m.finished, answers: m.answers,
    codes: m.codes, part1_ends: m.part1_ends ?? null, part2_ends: m.part2_ends ?? null, now: clk.epoch() };
  out.items = await Cn.publicItems((m.items || []).filter((i) => C.items.has(i)));
  out.problems = (m.problems || []).filter((pid) => C.problems.has(pid)).map((pid) => {
    const meta = C.problems.get(pid).meta;
    return { id: pid, title: meta.title ?? null, minutes: meta.minutes ?? null };
  });
  if (m.finished) out.result = m.result ?? null;
  return out;
}

function notebookCell(kind, src, meta = {}) {
  const lines = src.split(/(?<=\n)/);
  const c = { cell_type: kind, metadata: meta, source: lines };
  if (kind === 'code') Object.assign(c, { execution_count: null, outputs: [] });
  return c;
}

async function colabNotebook(C, pr, code) {
  if (pr.colab || (C.site.notebooks || []).includes(pr.id)) {   // the built notebook (with its grader cell), with this student's code
    const res = await fetch(new URL(`notebooks/${pr.id}.ipynb`, document.baseURI));
    if (!res.ok) fail(404, 'notebook not found');
    const nb = await res.json();
    const cell = nb.cells.find((c) => c.cell_type === 'code' && c.source.join('').startsWith('%%writefile'));
    if (cell) cell.source = (cell.source[0] + code).split(/(?<=\n)/);
    return JSON.stringify(nb, null, 1);
  }
  // colab_notebook() in server.py
  const meta = pr.meta, mod = meta.module_name || 'submission';
  const cells = [
    notebookCell('markdown', `# ${meta.title || pr.id}\n\n${pr.statement}`),
    notebookCell('markdown', 'Run the next cell to write your solution file. Edit your code there, then re-run it.'),
    notebookCell('code', `%%writefile ${mod}.py\n${code}`),
    notebookCell('markdown', 'Import it the way the grader does and try it. Restart the runtime or use reload after editing.'),
    notebookCell('code', `import importlib\nimport ${mod} as submission\nimportlib.reload(submission)\n# Try the example from the statement here, e.g. submission.${meta.entry || 'f'}(...)`),
  ];
  return JSON.stringify({ cells, metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } },
    nbformat: 4, nbformat_minor: 5 }, null, 1);
}

// ------------------------------------------------------------------------------------------------ GET
async function GET(parts, q) {
  const C = await Cn.catalog();
  const P = await S.load();
  const idx = L.lessonIndex(C);
  const days = L.daysBetween(clk.today(), C.round1);
  if (parts.length === 1 && parts[0] === 'meta') {
    const status = L.lessonStatus(C, P, idx);
    const cur = structuredClone(C.curriculum);
    for (const u of cur.units) for (const l of u.lessons) Object.assign(l, status[l.id]);
    return ok({ curriculum: cur, glossary: C.glossary, track_order: C.trackOrder, days_to_round1: L.daysBetween(clk.today(), L.examDate(C, P)),
      settings: L.settingsView(C, P), round_focus: L.roundFocus(C, P, clk, idx, status), r2_order: C.r2Order,
      summaries: C.summaries, features: { placement: C.placement.length > 0 } });
  }
  if (parts[0] === 'summary' && parts.length === 2) {
    const uid = parts[1];
    if (!C.summaries.includes(uid)) fail(404, 'no summary sheet for this unit');
    const u = C.curriculum.units.find((x) => x.id === uid);
    return ok({ unit: uid, title: u.title, round: u.round, markdown: await Cn.summary(uid) });
  }
  if (parts.length === 1 && parts[0] === 'search_index') return ok({ entries: await Cn.searchIndex() });
  if (parts[0] === 'lesson' && parts.length === 2) {
    const lid = parts[1];
    if (!(lid in idx)) fail(404, 'unknown lesson');
    const l = idx[lid];
    const md = C.released.has(l.unit) ? await Cn.lessonMarkdown(lid, l.unit) : null;
    const items = Object.fromEntries((await Cn.unitItemsPublic(l.unit)).map((it) => [it.id, it]));
    const ordered = C.curriculum.units.flatMap((u) => u.lessons.map((x) => x.id));
    const i = ordered.indexOf(lid);
    const answered = Object.fromEntries(Object.keys(items).filter((iid) => iid in P.items).map((iid) => [iid, P.items[iid]]));
    return ok({ ...l, markdown: md, items, answered, prev: i > 0 ? ordered[i - 1] : null, next: i + 1 < ordered.length ? ordered[i + 1] : null,
      done: !!(P.lessons[lid] || {}).done, active_seconds: (P.lessons[lid] || {}).active ?? 0,
      cards: [...C.cards.values()].filter((c) => c.unit === l.unit && c.lesson === lid).map((c) => c.id),
      problems: [...C.problems.values()].filter((p) => p.meta.lesson === lid).map((p) => p.id) });
  }
  if (parts.length === 1 && parts[0] === 'today') {
    return ok(L.planToday(C, P, int(q.minutes, P.settings.session_minutes), clk));
  }
  if (parts.length === 1 && parts[0] === 'practice') {
    const ids = L.practiceSet(C, P, { unit: q.unit || null, lesson: q.lesson || null, n: int(q.n, 10), minDiff: int(q.min_diff, 1), studiedOnly: q.all !== '1' });
    return ok({ items: await Cn.publicItems(ids) });
  }
  if (parts.length === 1 && parts[0] === 'items') {
    const ids = (q.ids || '').split(',').filter((i) => i && C.items.has(i));
    return ok({ items: await Cn.publicItems(ids) });
  }
  if (parts.length === 1 && parts[0] === 'cards') {
    let ids;
    if (q.ids) ids = q.ids.split(',').filter((i) => C.cards.has(i));
    else {
      ids = [...C.cards.values()].filter((c) => (!q.unit || c.unit === q.unit) && (!q.lesson || c.lesson === q.lesson)
        && (q.due !== '1' || (c.id in P.cards && L.isDue(P.cards[c.id], clk)))).map((c) => c.id).slice(0, int(q.n, 15));
    }
    const cards = [];
    for (const i of ids) cards.push({ ...(await Cn.publicCard(i)), state: P.cards[i] ?? null });
    return ok({ cards });
  }
  if (parts.length === 1 && parts[0] === 'problems') {
    return ok({ problems: [...C.problems.values()].map((p) => {
      const st = P.problems[p.id] || {};
      return { id: p.id, unit: p.unit, title: p.meta.title ?? null, minutes: p.meta.minutes ?? null, difficulty: p.meta.difficulty ?? null,
        lesson: p.meta.lesson ?? null, tags: p.meta.tags ?? [], source: p.meta.source ?? null, solved: !!st.solved, attempted: !!st.submits };
    }) });
  }
  if (parts[0] === 'problem' && parts.length >= 2) {
    const pid = parts[1];
    const pr = C.problems.has(pid) ? await Cn.problem(pid) : null;
    if (!pr) fail(404, 'unknown problem');
    const st = P.problems[pid] || {};
    if (parts.length === 2) {
      const { code, ...state } = st;
      const out = { id: pid, unit: pr.unit, meta: pr.meta, statement: pr.statement, starter: pr.starter, saved: st.code ?? null, state, hints: pr.hints };
      if (pr.colab) Object.assign(out, { colab: true, colab_url: `${C.site.colab_base}${pid}.ipynb`, notebook: `notebooks/${pid}.ipynb` });
      return ok(out);
    }
    if (parts[2] === 'solution') {
      if (!(st.submits || st.revealed)) fail(403, 'submit once (or press reveal) before viewing the reference');
      return ok({ code: pr.secret().ref });
    }
    if (parts[2] === 'colab.ipynb') {
      return ok({ text: await colabNotebook(C, pr, st.code || pr.starter), type: 'application/x-ipynb+json' });
    }
  }
  if (parts.length === 1 && parts[0] === 'progress') return ok(L.progressSummary(C, P, clk));
  if (parts[0] === 'mock' && parts.length === 2) {
    const v = await mockView(C, P, parts[1]);
    if (!v) fail(404, 'unknown mock');
    return ok(v);
  }
  if (parts.length === 1 && parts[0] === 'mocks') return ok({ mocks: mockList(P) });
  fail(404, 'unknown endpoint');
}

// ------------------------------------------------------------------------------------------------ POST
async function POST(parts, body) {
  const C = await Cn.catalog();
  if (parts[0] === 'lesson' && parts.length === 3 && parts[2] === 'done') {
    const lid = parts[1];
    const secs = await S.update((P) => {
      const rec = P.lessons[lid] ??= {};
      rec.done = clk.nowIso();
      rec.seconds = Math.trunc(Number(rec.active || body.seconds || 0)) || 0;
      return rec.seconds;
    });
    await S.logAttempt({ kind: 'lesson_done', id: lid, seconds: secs });
    return ok({ ok: true });
  }
  if (parts.length === 2 && parts[0] === 'item' && parts[1] === 'answer') {
    const it = C.items.has(body.id) ? await Cn.fullItem(body.id) : null;
    if (!it) fail(404, 'unknown item');
    const ans = body.answer;
    const [pts, good] = L.scoreItem(it, ans);
    if (body.mode !== 'mock') {
      await S.update((P) => { L.srsUpdate(C, P.items[it.id] ??= {}, !!good, clk); });
      await S.logAttempt({ kind: 'item', id: it.id, answer: ans ?? null, correct: good, mode: body.mode ?? null, seconds: body.seconds ?? null });
    }
    const ww = it.type === 'mc' && good === false ? (it.why_wrong || {})[String(ans).toUpperCase()] ?? null : null;
    return ok({ correct: good, points: pts, answer: it.answer, solution: it.solution ?? null, why_wrong: ww, all_why_wrong: it.why_wrong || {} });
  }
  if (parts.length === 2 && parts[0] === 'card' && (parts[1] === 'answer' || parts[1] === 'selfmark')) {
    const c = C.cards.has(body.id) ? await Cn.fullCard(body.id) : null;
    if (!c) fail(404, 'unknown card');
    const reply = (good, r) => ({ correct: good, error: good ? null : r.error ?? null, stdout: r.stdout ?? '', answer: c.answer, alts: c.alts ?? [], note: c.note ?? '' });
    if (parts[1] === 'selfmark') {   // public build: a PyTorch card the student marked after comparing
      const good = !!body.correct;
      const st = await S.update((P) => { const s = P.cards[c.id] ??= {}; L.srsUpdate(C, s, good, clk); return s; });
      await S.logAttempt({ kind: 'card', id: c.id, code: '', correct: good, reveal: false, self_mark: true });
      return ok({ ok: true, state: st });
    }
    const reveal = !!body.reveal;
    const code = body.code ?? '';
    let r;
    if (reveal) r = { ok: false, error: 'revealed', stdout: '' };
    else if (c.colab) {
      const match = [c.answer, ...(c.alts || [])].some((a) => normCode(a) === normCode(code));
      if (!match) {
        await S.logAttempt({ kind: 'card', id: c.id, code, correct: null, reveal: false, self_mark: 'asked' });
        return ok({ ...reply(false, { error: null }), self_mark: true,
          self_mark_note: 'PyTorch does not run in the browser, so this card is checked by comparing text, and yours differs from the answer below. Compare them and mark it.' });
      }
      r = { ok: true, stdout: '' };
    } else r = await runSnippet({ setup: c.setup || '', code, check: c.check });
    const good = !!r.ok;
    await S.update((P) => { L.srsUpdate(C, P.cards[c.id] ??= {}, good, clk); });
    await S.logAttempt({ kind: 'card', id: c.id, code, correct: good, reveal });
    return ok(reply(good, r));
  }
  if (parts.length === 1 && parts[0] === 'exec') {
    const code = body.code ?? '';
    if (colabCode(code, C)) {
      const rec = await Cn.recorded(await sha256(code));
      if (rec) return ok({ ...rec, recorded: true, recorded_note: 'PyTorch does not run in the browser; this output was recorded when the site was built.' });
      return ok({ ok: false, stdout: '', images: [], result_repr: null, recorded: true, recorded_note: 'Edited PyTorch code',
        error: 'PyTorch does not run in the browser, and this code differs from the recorded example, so there is no output to show. Copy it into a Colab cell to run it, or press Reset to see the recorded output again.' });
    }
    // a lesson's unit with data files: they are copied into the run's working folder (runner.py, like snippet.py)
    const uid = typeof body.unit === 'string' && /^u\d\d$/.test(body.unit) ? body.unit : null;
    const files = uid ? ((await Cn.unit(uid))?.files || []) : [];
    const r = await runSnippet(files.length ? { code, unit: uid, files } : { code });
    if (/\bint32\b/.test(`${r.stdout || ''} ${r.result_repr || ''}`) && !/int32/.test(code)) {
      r.browser_note = 'In the browser NumPy integers default to int32 (WebAssembly is 32-bit). In Colab, and in the exam, they are int64.';
    }
    return ok(r);
  }
  if (parts.length === 1 && parts[0] === 'help') {
    const expr = String(body.expr ?? '').trim();
    if (!/^[A-Za-z_][\w.]*$/.test(expr)) fail(400, 'type a name like np.where or torch.nn.Linear');
    if (/^(torch|nn|F)(\.|$)/.test(expr)) {
      return ok({ text: `help(${expr}) needs PyTorch, which does not run in the browser. In Colab, help(${expr}) works (and Colab's help() was allowed in the 2026 exam). NumPy and pandas names work here, for example np.where or pd.merge.` });
    }
    const r = await runSnippet({ help: expr });
    return ok({ text: r.stdout || r.error || '' });
  }
  if (parts[0] === 'problem' && parts.length === 3) {
    const [, pid, action] = parts;
    const code = body.code ?? '';
    if (action === 'save') { await S.update((P) => { (P.problems[pid] ??= {}).code = code; }); return ok({ ok: true }); }
    if (action === 'reveal') { await S.update((P) => { (P.problems[pid] ??= {}).revealed = true; }); return ok({ ok: true }); }
    if (action === 'hint') {   // {n}: the student opened hint n (1-based); state keeps the most opened
      const pr = C.problems.has(pid) ? await Cn.problem(pid) : null;
      if (!pr) fail(404, 'unknown problem');
      const n = body.n;
      if (!Number.isInteger(n) || n < 1 || n > pr.hints.length) fail(400, 'no such hint');
      const used = await S.update((P) => { const st = P.problems[pid] ??= {}; st.hints = Math.max(st.hints ?? 0, n); return st.hints; });
      await S.logAttempt({ kind: 'hint', id: pid, n });
      return ok({ ok: true, hint: pr.hints[n - 1], hints: used });
    }
    if (action === 'selfmark') {   // public build: a Colab problem the student reports solved (or not)
      const st = await S.update((P) => {
        const s = P.problems[pid] ??= {};
        if (body.solved) { s.solved = s.solved || clk.nowIso(); s.self_reported = true; s.submits = (s.submits || 0) + 1; s.code = body.code ?? s.code; } else { delete s.solved; s.self_reported = false; }
        const { code: _c, ...rest } = s;
        return rest;
      });
      await S.logAttempt({ kind: 'problem', id: pid, ok: !!body.solved, self_reported: true });
      return ok({ ok: true, state: st });
    }
    if (action === 'run' || action === 'submit') {
      const r = await grade(pid, code, action);
      const pr = C.problems.get(pid);
      if (body.mock || !pr || pr.colab) return ok(r);   // a mock's run must not touch practice state
      await S.update((P) => {
        const st = P.problems[pid] ??= {};
        st.code = code;
        const k = action === 'run' ? 'runs' : 'submits';
        st[k] = (st[k] ?? 0) + 1;
        if (action === 'submit') {
          const passed = (r.tests || []).filter((t) => t.passed).length;
          st.best = Math.max(st.best ?? 0, passed);
          st.total = (r.tests || []).length;
          st.seconds = (st.seconds ?? 0) + (Math.trunc(Number(body.seconds ?? 0)) || 0);
          if (r.ok && !st.solved) st.solved = clk.nowIso();
        }
      });
      if (action === 'submit') {
        await S.logAttempt({ kind: 'problem', id: pid, ok: r.ok ?? null, passed: (r.tests || []).filter((t) => t.passed).length,
          total: (r.tests || []).length, error: r.error ?? null, static: (r.static || []).filter((s) => !s.ok).map((s) => s.msg), seconds: body.seconds ?? null });
      }
      return ok(r);
    }
  }
  if (parts.length === 2 && parts[0] === 'mock' && parts[1] === 'start') {
    const kind = body.kind ?? 'part1';
    if (!['part1', 'part2', 'full', 'unit', 'check', ...(C.placement.length ? ['placement'] : [])].includes(kind)) fail(400, 'unknown mock kind');
    if (kind === 'unit' && !C.released.has(body.unit)) fail(400, 'unit quiz needs a released unit');
    if (kind === 'unit' && ![...C.items.values()].some((it) => it.unit === body.unit && (it.difficulty ?? 1) >= 2)) fail(400, 'this unit has no quiz questions yet');
    const P0 = await S.load();
    const m = L.mockStart(C, P0, kind, body.unit ?? null, clk, { excludeProblem: (pid) => C.problems.get(pid)?.colab });
    const mid = await S.update((P) => {
      let id = L.newMockId();
      while (id in P.mocks) id = L.newMockId();
      P.mocks[id] = m;
      return id;
    });
    return ok(await mockView(C, await S.load(), mid));
  }
  if (parts[0] === 'mock' && parts.length === 3) {
    const [, mid, action] = parts;
    if (action === 'answer') {
      const res = await S.update((P) => {
        const m = P.mocks[mid];
        if (!m || m.finished) return false;
        if ('item' in body) m.answers[body.item] = body.answer ?? null;
        if ('problem' in body) m.codes[body.problem] = body.code ?? '';
        return true;
      });
      if (!res) fail(400, 'mock not running');
      return ok({ ok: true });
    }
    if (action === 'finish') return ok(await mockFinish(C, mid));
  }
  if (parts.length === 1 && parts[0] === 'time') {
    const secs = Math.max(0, Math.min(Math.trunc(Number(body.seconds ?? 0)) || 0, 120));
    const [kind, key] = L.activityOf(String(body.route ?? ''));
    return ok(await S.update((P) => {
      const d = clk.today();
      P.time[d] = (P.time[d] ?? 0) + secs;
      const day = P.activity[d] ??= {};
      day[kind] = (day[kind] ?? 0) + secs;
      if (kind === 'lesson' && key) { const rec = P.lessons[key] ??= {}; rec.active = (rec.active ?? 0) + secs; }
      else if (kind === 'problem' && key) { const rec = P.problems[key] ??= {}; rec.active = (rec.active ?? 0) + secs; }
      const out = { ok: true, today_seconds: P.time[d] };
      if (kind === 'lesson' && key) out.lesson_seconds = P.lessons[key].active;
      if (kind === 'problem' && key) out.problem_seconds = P.problems[key].active;
      return out;
    }));
  }
  if (parts.length === 1 && parts[0] === 'settings') {
    const [upd, bad] = L.cleanSettings(body);
    if (bad) fail(400, bad);
    return ok(await S.update((P) => { Object.assign(P.settings, upd); return L.settingsView(C, P); }));
  }
  fail(404, 'unknown endpoint');
}

async function mockFinish(C, mid) {
  const P0 = await S.load();
  const m0 = P0.mocks[mid];
  if (!m0 || m0.finished) return mockView(C, P0, mid);
  const full = {};
  for (const iid of m0.items || []) if (C.items.has(iid)) full[iid] = await Cn.fullItem(iid);
  const part2 = [];
  for (const pid of m0.problems || []) {   // grading runs before the state update (it can take a while)
    const code = m0.codes[pid] ?? '';
    const g = code.trim() ? await grade(pid, code, 'submit') : { ok: false, tests: [], static: [], error: 'no code' };
    const passed = (g.tests || []).filter((t) => t.passed).length;
    const n = Math.max(1, (g.tests || []).length);
    const staticOk = (g.static || []).every((s) => s.ok);
    part2.push({ id: pid, ok: g.ok ?? null, passed, total: (g.tests || []).length, fraction: staticOk ? passed / n : 0.0, grade: g });
  }
  const done = await S.update((P) => {
    const m = P.mocks[mid];
    if (!m || m.finished) return false;
    const res = { part1: [], part2 };
    let total = 0.0;
    for (const iid of m.items || []) {
      const it = full[iid];
      if (!it) continue;
      const given = m.answers[iid] ?? null;
      const [pts, good] = L.scoreItem(it, given);
      total += pts;
      res.part1.push({ id: iid, answer: it.answer, given, points: pts, correct: good, solution: it.solution ?? null, stem: it.stem,
        choices: it.choices ?? null, type: it.type, lesson: it.lesson ?? null, unit: it.unit ?? null, all_why_wrong: it.why_wrong || {},
        why_wrong: it.type === 'mc' && good === false ? (it.why_wrong || {})[String(given).toUpperCase()] ?? null : null });
      const st = P.items[iid] ??= {};
      if (good !== null) L.srsUpdate(C, st, good, clk);
    }
    m.finished = true;
    m.result = res;
    m.score = total;
    m.max = 7.5 * (m.items || []).length;
    return { score: total, max: m.max };
  });
  if (done) await S.logAttempt({ kind: 'mock', id: mid, score: done.score, max: done.max, part2: part2.map((r) => [r.id, r.passed, r.total]) });
  return mockView(C, await S.load(), mid);
}
