// Pure port of server.py's planning, SRS, practice, progress and mock logic (public build). No DOM, no storage:
// every function takes the content catalog C (content.js), the progress state P (the server's progress.json shape)
// and a clock, so tests/parity.mjs can run it in Node against the Python server. Keep it line-for-line with
// server.py; the comments name the Python function each block ports.

// ------------------------------------------------------------------------------------------------ Python helpers
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);                      // Python str/number ordering
export function cmpTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xv = typeof x === 'boolean' ? +x : x, yv = typeof y === 'boolean' ? +y : y;
    const c = cmp(xv, yv);
    if (c) return c;
  }
  return 0;
}
export const sortBy = (arr, key) => arr.map((v, i) => [key(v), i, v]).sort((a, b) => cmpTuple(a[0], b[0]) || a[1] - b[1]).map((x) => x[2]);

// round(x): ties to even, like Python 3
export function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
// round(x, n) on the exact binary value, ties to even (Python's float rounding), returned as the nearest double
export function pyRoundN(x, n) {
  if (!isFinite(x)) return x;
  const s = x.toFixed(n);                          // exact-value rounding; at an exact tie it goes away from zero
  if (!isExactTie(x, n)) return Number(s);
  const scaled = BigInt(s.replace('.', '').replace('-', ''));
  const even = scaled % 2n === 0n ? scaled : scaled - 1n;
  const v = Number(`${even}e-${n}`);
  return x < 0 ? -v : v;
}
function isExactTie(x, n) {                        // is x * 10^n exactly k + 1/2 ?
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & ((1n << 52n) - 1n);
  let e;
  if (expBits === 0) e = -1074; else { mant |= 1n << 52n; e = expBits - 1075; }
  if (mant === 0n) return false;
  // value = mant * 2^e ; tie iff mant * 10^n * 2 * 2^e is an odd integer
  if (e >= 0) return false;
  const num = mant * 10n ** BigInt(n) * 2n, den = 1n << BigInt(-e);
  return num % den === 0n && (num / den) % 2n === 1n;
}

export function zfill(s, w) {
  s = String(s);
  const sign = s[0] === '-' || s[0] === '+' ? s[0] : '';
  const body = sign ? s.slice(1) : s;
  return body.length + sign.length >= w ? s : sign + body.padStart(w - sign.length, '0');
}

export function shuffle(a, rand = Math.random) {   // random.shuffle
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ------------------------------------------------------------------------------------------------ clock
const p2 = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const isoLocal = (d) => `${isoDate(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
export function parseDate(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(dateStr, n) { const d = parseDate(dateStr); d.setDate(d.getDate() + n); return isoDate(d); }
export function daysBetween(a, b) {                // (date b - date a).days for 'YYYY-MM-DD' strings
  const ua = Date.UTC(...a.slice(0, 10).split('-').map((x, i) => (i === 1 ? x - 1 : +x)));
  const ub = Date.UTC(...b.slice(0, 10).split('-').map((x, i) => (i === 1 ? x - 1 : +x)));
  return Math.round((ub - ua) / 86400000);
}
export function isoWeek(dateStr) {                 // date.isocalendar() -> "YYYY-Www"
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yy = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(yy, 0, 1)) / 86400000 + 1) / 7);
  return `${yy}-W${p2(w)}`;
}
export function weekday(dateStr) { return (parseDate(dateStr).getDay() + 6) % 7; }   // Monday = 0

export function realClock() {
  return {
    now: () => new Date(),
    today() { return isoDate(new Date()); },
    nowIso() { return isoLocal(new Date()); },
    epoch() { return Date.now() / 1000; },
    // (datetime.now() - timedelta(days=n)).isoformat(): microseconds included
    minusDaysIso(n) { const d = new Date(Date.now() - n * 86400000); return `${isoLocal(d)}.${String(d.getMilliseconds()).padStart(3, '0')}000`; },
  };
}

// ------------------------------------------------------------------------------------------------ progress store
export function normalize(p) {                     // load_progress() defaults
  p = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  const def = { version: 1, lessons: {}, items: {}, cards: {}, problems: {}, mocks: {}, time: {}, activity: {}, settings: { session_minutes: 45 } };
  for (const [k, v] of Object.entries(def)) if (!(k in p)) p[k] = v;
  return p;
}

export function activityOf(route) {                // activity_of
  const r = String(route).replace(/^[#/]+|[#/]+$/g, '').split('?')[0];
  const parts = r.split('/');
  if (parts[0] === 'lesson' && parts.length > 1) return ['lesson', parts[1]];
  if (parts[0] === 'problem' && parts.length > 1) return ['problem', parts[1]];
  if (['cards', 'practice', 'review', 'mock', 'quiz', 'check'].includes(parts[0])) return [parts[0], null];
  return ['other', null];
}

export function srsUpdate(C, state, ok, clk) {     // srs_update
  const L = C.leitner;
  let box = state.box ?? 0;
  box = ok ? Math.min(box + 1, L.length - 1) : 1;
  state.box = box;
  state.due = addDays(clk.today(), L[box]);
  state.seen = (state.seen ?? 0) + 1;
  state.correct = (state.correct ?? 0) + (ok ? 1 : 0);
  state.last = clk.nowIso();
  state.last_ok = ok;
}

export const isDue = (state, clk) => (state.due ?? '9999') <= clk.today();     // is_due

export function scoreItem(it, ans) {               // score_item: [points, ok|null]
  if (ans === null || ans === undefined || ans === '' || ans === '-') return [1.5, null];
  const ok = it.type === 'mc' ? String(ans).trim().toUpperCase() === String(it.answer).toUpperCase()
    : zfill(String(ans).trim(), 3) === String(it.answer);
  return [ok ? 7.5 : 0.0, ok];
}

// ------------------------------------------------------------------------------------------------ settings
export function settingsView(C, P) {               // settings_view
  return { session_minutes: 45, exam_date: C.round1, weekly_hours: 3, round_focus: 'auto', tested_out: [], ...P.settings };
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v) => ISO_DATE.test(v) && (() => { const [y, m, d] = v.split('-').map(Number); const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; })();
export function examDate(C, P) {                   // exam_date (as 'YYYY-MM-DD')
  const v = String(P.settings.exam_date || C.round1);
  return validDate(v) ? v : C.round1;
}
export const testedOut = (P) => new Set(P.settings.tested_out || []);   // tested_out

export function roundFocus(C, P, clk, idx = null, status = null) {   // round_focus
  idx = idx || lessonIndex(C);
  status = status || lessonStatus(C, P, idx);
  const out = testedOut(P);
  const r1 = Object.entries(idx).filter(([, l]) => l.round === 'R1').map(([lid]) => lid);
  const allDone = r1.length > 0 && r1.every((lid) => status[lid].done || out.has(idx[lid].unit));
  const passed = clk.today() > examDate(C, P);
  const auto = passed || allDone ? 'R2' : 'R1';
  const ov = ['R1', 'R2'].includes(P.settings.round_focus) ? P.settings.round_focus : null;
  const reason = passed ? 'the Round 1 exam date has passed' : allDone ? 'every Round 1 lesson is done' : 'the Round 1 exam is ahead';
  return { focus: ov || auto, auto, override: ov, reason };
}

/** clean_settings: [updates, error or null]. */
export function cleanSettings(body) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('session_minutes')) out.session_minutes = body.session_minutes;
  if (has('theme')) out.theme = body.theme;
  if (has('exam_date')) {
    const v = String(body.exam_date ?? '');
    if (!validDate(v)) return [null, 'exam_date must be a date like 2027-02-19'];
    out.exam_date = v;
  }
  if (has('weekly_hours')) {
    const v = body.weekly_hours;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.5 || v > 40) return [null, 'weekly_hours must be a number from 0.5 to 40'];
    out.weekly_hours = v;
  }
  if (has('round_focus')) {
    if (!['auto', 'R1', 'R2'].includes(body.round_focus)) return [null, 'round_focus must be auto, R1 or R2'];
    out.round_focus = body.round_focus;
  }
  if (has('tested_out')) {
    const v = body.tested_out;
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && /^u\d\d$/.test(x))) return [null, 'tested_out must be a list of unit ids like u02'];
    out.tested_out = [...new Set(v)].sort(cmp);
  }
  return [out, null];
}

// ------------------------------------------------------------------------------------------------ content index
export function lessonIndex(C) {                   // lesson_index
  const idx = {};
  for (const u of C.curriculum.units) {
    u.lessons.forEach((l, i) => { idx[l.id] = { ...l, unit: u.id, unit_title: u.title, track: u.track, round: u.round, pos: i }; });
  }
  return idx;
}
export const lessonReady = (C, lid, uid) => C.released.has(uid) && C.ready.has(lid);   // lesson_ready

export function lessonStatus(C, P, idx) {          // lesson_status
  const out = {};
  for (const [lid, l] of Object.entries(idx)) out[lid] = { ready: lessonReady(C, lid, l.unit), done: lid in P.lessons && !!P.lessons[lid].done };
  return out;
}

function nextLesson(C, track, idx, status, orders = C.trackOrder) {   // next_lesson
  for (const uid of orders[track] || []) {
    const ls = sortBy(Object.entries(idx).filter(([, v]) => v.unit === uid), (kv) => [kv[1].pos]);
    for (const [lid] of ls) if (!status[lid].done) return status[lid].ready ? lid : null;
  }
  return null;
}

function recentTrackMinutes(P, idx, track, clk, days = 7) {   // recent_track_minutes
  const cutoff = clk.minusDaysIso(days);
  let s = 0;
  for (const [lid, rec] of Object.entries(P.lessons)) {
    if ((rec.done ?? '') >= cutoff && (idx[lid] || {}).track === track) s += (rec.seconds ?? 0) || idx[lid].minutes * 60;
  }
  return s / 60;
}

const unitItems = (C, uid) => C.unitItems.get(uid) || [];  // unit_items (catalog entries)

// ------------------------------------------------------------------------------------------------ plan_today
export function planToday(C, P, minutes, clk) {
  const idx = lessonIndex(C);
  const status = lessonStatus(C, P, idx);
  const items = C.items, cards = C.cards;
  const doneLessons = new Set(Object.entries(status).filter(([, s]) => s.done).map(([lid]) => lid));
  const blocks = [];
  let budget = minutes;
  // 1. cards: due first, then new cards from finished lessons
  const dueCards = Object.entries(P.cards).filter(([cid, st]) => cards.has(cid) && isDue(st, clk)).map(([cid]) => cid);
  const newCards = [...cards.values()].filter((c) => !(c.id in P.cards) && doneLessons.has(c.lesson)).map((c) => c.id);
  const nCards = Math.min(dueCards.length + newCards.length, minutes >= 40 ? 12 : 8);
  if (nCards) {
    const pick = [...dueCards, ...newCards].slice(0, nCards);
    const dueSet = new Set(dueCards);
    blocks.push({ kind: 'cards', title: 'Syntax cards', ids: pick, minutes: Math.max(2, pyRound(nCards * 0.4)),
      detail: `${pick.filter((c) => dueSet.has(c)).length} due, ${pick.filter((c) => !dueSet.has(c)).length} new` });
    budget -= blocks[blocks.length - 1].minutes;
  }
  // 2. missed items due for review
  let dueItems = Object.entries(P.items).filter(([iid, st]) => items.has(iid) && (st.box ?? 0) <= 3 && isDue(st, clk)
    && !(st.last_ok ?? true)).map(([iid]) => iid);
  const dueSet = new Set(dueItems);
  dueItems = dueItems.concat(Object.entries(P.items).filter(([iid, st]) => items.has(iid) && isDue(st, clk) && st.last_ok
    && !dueSet.has(iid)).map(([iid]) => iid));
  if (dueItems.length) {
    const pick = dueItems.slice(0, minutes >= 40 ? 5 : 3);
    blocks.push({ kind: 'review', title: 'Review questions you missed or are due', ids: pick, minutes: pyRound(pick.length * 1.5) });
    budget -= blocks[blocks.length - 1].minutes;
  }
  // 3a. a unit quiz once every ready lesson of a unit is done and the unit has no passed quiz (>= 70%)
  const finished = Object.values(P.mocks).filter((m) => m.finished && m.max);
  const passed = new Set(finished.filter((m) => m.kind === 'unit' && m.score / m.max >= 0.7).map((m) => m.unit ?? null));
  const allItems = [...items.values()];
  for (const u of C.curriculum.units) {
    const lids = u.lessons.filter((l) => status[l.id].ready).map((l) => l.id);
    if (C.released.has(u.id) && lids.length && lids.every((l) => status[l].done) && !passed.has(u.id)
        && u.id !== 'u14' && budget >= 20 && allItems.some((it) => it.unit === u.id)) {
      const nq = Math.min(C.quizN, allItems.filter((it) => it.unit === u.id && (it.difficulty ?? 1) >= 2).length);
      if (nq < 3) continue;
      blocks.push({ kind: 'quiz', unit: u.id, title: `Unit quiz: ${u.title}`, minutes: 3 * nq, detail: `${nq} questions, exam scoring; 70% to pass` });
      budget -= 3 * nq;
      break;
    }
  }
  // 3b. a progress check every 14 days once 6 lessons are done
  const checks = finished.filter((m) => m.kind === 'check').map((m) => m.started).sort(cmp);
  const last = checks.length ? checks[checks.length - 1].slice(0, 10) : null;
  if (doneLessons.size >= 6 && (last === null || daysBetween(last, clk.today()) >= 14) && budget >= 30) {
    blocks.push({ kind: 'check', title: 'Progress check', minutes: 3 * C.checkN, detail: '12 mixed questions from everything studied; tracks your projected Part 1 score' });
    budget -= 3 * C.checkN;
  }
  // 3. lessons: alternate tracks, the one with less recent time first (Round 2 focus: one sequence, r2_order).
  // Lessons of units the student tested out of (placement quiz) are skipped.
  const focus = roundFocus(C, P, clk, idx, status).focus;
  const out = testedOut(P);
  const lstatus = Object.fromEntries(Object.entries(status).map(([lid, s]) => [lid, { ...s, done: s.done || out.has(idx[lid].unit) }]));
  let order, orders;
  if (focus === 'R2') { order = ['r2']; orders = { r2: C.r2Order }; } else {
    order = sortBy(['code', 'theory'], (t) => [recentTrackMinutes(P, idx, t, clk)]);
    orders = C.trackOrder;
  }
  let added = 0;
  for (const track of [...order, ...order]) {
    if (budget < 8 || added >= 2) break;
    const lid = nextLesson(C, track, idx, lstatus, orders);
    if (lid && blocks.every((b) => b.id !== lid)) {
      const l = idx[lid];
      blocks.push({ kind: 'lesson', id: lid, title: l.title, unit: l.unit, unit_title: l.unit_title, minutes: l.minutes + 3, track: l.track });
      budget -= l.minutes + 3;
      lstatus[lid].done = true;
      added += 1;
    }
  }
  // 4. a coding problem from a finished lesson's unit, if time remains
  if (budget >= 12) {
    const unitsDone = new Set([...doneLessons].filter((lid) => lid in idx).map((lid) => idx[lid].unit));
    for (const pr of C.problems.values()) {
      const meta = pr.meta;
      const okLesson = doneLessons.has(meta.lesson) || ((meta.lesson ?? null) === null && unitsDone.has(pr.unit));
      if (okLesson && !(P.problems[pr.id] || {}).solved && (meta.minutes ?? 15) <= budget + 5) {
        blocks.push({ kind: 'problem', id: pr.id, title: meta.title ?? pr.id, minutes: meta.minutes ?? 15 });
        budget -= meta.minutes ?? 15;
        break;
      }
    }
  }
  // 5. otherwise a practice set from the most recent finished lesson
  if (budget >= 6 && doneLessons.size) {
    let recent = null;
    for (const lid of doneLessons) if (recent === null || (P.lessons[lid].done ?? '') > (P.lessons[recent].done ?? '')) recent = lid;
    const uid = recent in idx ? idx[recent].unit : null;
    if (uid && unitItems(C, uid).length) {
      const n = Math.max(3, Math.min(8, Math.floor(budget / 2)));
      blocks.push({ kind: 'practice', title: `Practice: ${idx[recent].unit_title}`, unit: uid, n, minutes: n * 2 });
    }
  }
  return { minutes, blocks, est_minutes: blocks.reduce((a, b) => a + b.minutes, 0), days_to_round1: daysBetween(clk.today(), examDate(C, P)), focus };
}

// ------------------------------------------------------------------------------------------------ practice
export function studiedFilter(C, P) {              // studied_filter
  const idx = lessonIndex(C);
  const done = new Set(Object.entries(P.lessons).filter(([, r]) => r.done).map(([lid]) => lid));
  const out = testedOut(P);
  const frac = {};
  for (const u of C.curriculum.units) {
    const ready = u.lessons.filter((l) => lessonReady(C, l.id, u.id)).map((l) => l.id);
    frac[u.id] = ready.length ? ready.filter((l) => done.has(l)).length / ready.length : 0.0;
  }
  return (it) => {
    if (out.has(it.unit)) return true;   // tested out (placement quiz)
    const lid = it.lesson;
    if (lid) return done.has(lid) || !(lid in idx);
    return (frac[it.unit] ?? 0.0) >= 0.5;
  };
}

export function practiceSet(C, P, { unit = null, lesson = null, n = 10, minDiff = 1, studiedOnly = true } = {}, rand) {
  const ok = studiedOnly && !lesson ? studiedFilter(C, P) : () => true;
  let pool = [...C.items.values()].filter((it) => (!unit || it.unit === unit) && (!lesson || it.lesson === lesson)
    && (it.difficulty ?? 1) >= minDiff && ok(it));
  shuffle(pool, rand);
  pool = sortBy(pool, (it) => [it.id in P.items, ((P.items[it.id] || {}).correct ?? 0) / Math.max(1, (P.items[it.id] || {}).seen ?? 1)]);
  return pool.slice(0, n).map((it) => it.id);
}

// ------------------------------------------------------------------------------------------------ progress_summary
export function progressSummary(C, P, clk) {
  const idx = lessonIndex(C);
  const status = lessonStatus(C, P, idx);
  const items = [...C.items.values()], cards = [...C.cards.values()], probs = [...C.problems.values()];
  const units = [];
  for (const u of C.curriculum.units) {
    const uid = u.id;
    const ls = u.lessons.map((l) => l.id);
    const its = items.filter((i) => i.unit === uid);
    const seen = its.filter((i) => i.id in P.items).map((i) => P.items[i.id]);
    const cs = cards.filter((c) => c.unit === uid);
    const cst = cs.filter((c) => c.id in P.cards).map((c) => P.cards[c.id]);
    const ps = probs.filter((p) => p.unit === uid).map((p) => p.id);
    const acc = seen.length ? seen.filter((s) => s.last_ok).length / seen.length : null;
    units.push({
      id: uid, title: u.title, track: u.track, round: u.round,
      lessons_total: ls.length, lessons_ready: ls.filter((l) => status[l].ready).length,
      lessons_done: ls.filter((l) => status[l].done).length,
      items_total: its.length, items_seen: seen.length, item_accuracy: acc,
      cards_total: cs.length, cards_seen: cst.length, cards_mastered: cst.filter((s) => (s.box ?? 0) >= 3).length,
      problems_total: ps.length, problems_solved: ps.filter((pid) => (P.problems[pid] || {}).solved).length,
    });
  }
  const weeks = {};
  for (const [d, s] of Object.entries(P.time)) { const k = isoWeek(d); weeks[k] = (weeks[k] ?? 0) + s; }
  const finished = Object.entries(P.mocks).filter(([, m]) => m.finished).map(([k, m]) => ({ ...m, id: k }));
  const mocks = finished.filter((m) => ['part1', 'part2', 'full'].includes(m.kind))
    .map((m) => ({ id: m.id, kind: m.kind, started: m.started, score: m.score ?? null, max: m.max ?? null }));
  const quizBest = {};
  for (const m of finished) {
    if (m.kind === 'unit' && m.max) {
      const pct = m.score / m.max;
      const key = m.unit ?? null;
      if (pct > ((quizBest[key] || {}).pct ?? -1)) quizBest[key] = { pct: pyRoundN(pct, 3), score: m.score, max: m.max, date: m.started };
    }
  }
  for (const u of units) u.quiz_best = quizBest[u.id] ?? null;
  const checks = sortBy(finished.filter((m) => m.kind === 'check' && m.max), (m) => [m.started]).map((m) => {
    const pct = m.score / m.max;
    return { id: m.id, date: m.started, score: m.score, max: m.max, pct: pyRoundN(pct, 3), projected_part1: pyRoundN(150 * pct, 1), units: m.units ?? [] };
  });
  const byKind = {}, byKindWeek = {};
  const today = clk.today();
  const weekStart = addDays(today, -weekday(today));
  for (const [d, kinds] of Object.entries(P.activity)) {
    for (const [k, v] of Object.entries(kinds)) {
      byKind[k] = (byKind[k] ?? 0) + v;
      if (d >= weekStart) byKindWeek[k] = (byKindWeek[k] ?? 0) + v;
    }
  }
  const total = Object.values(P.time).reduce((a, b) => a + b, 0);
  const mapVals = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
  return {
    units,
    weeks: Object.fromEntries(Object.keys(weeks).sort(cmp).map((k) => [k, pyRoundN(weeks[k] / 3600, 2)])),
    mocks: sortBy(mocks, (m) => [m.started]), checks,
    time: { total_hours: pyRoundN(total / 3600, 2),
      this_week_hours: pyRoundN(Object.entries(P.time).filter(([d]) => d >= weekStart).reduce((a, [, v]) => a + v, 0) / 3600, 2),
      by_kind_minutes: mapVals(byKind, (v) => pyRound(v / 60)),
      this_week_by_kind_minutes: mapVals(byKindWeek, (v) => pyRound(v / 60)),
      days_studied: Object.values(P.time).filter((v) => v >= 300).length },
    days_to_round1: daysBetween(today, examDate(C, P)),
  };
}

// ------------------------------------------------------------------------------------------------ mocks
function studiedUnits(P, idx) {                    // studied_units
  const s = new Set(Object.entries(P.lessons).filter(([lid, r]) => r.done && lid in idx).map(([lid]) => idx[lid].unit));
  const units = new Set(Object.values(idx).map((l) => l.unit));
  for (const u of testedOut(P)) if (units.has(u)) s.add(u);
  return s;
}

export function pickItems(pool, n, seen, rand) {   // pick_items
  shuffle(pool, rand);
  pool = sortBy(pool, (it) => [it.id in seen, -(it.difficulty ?? 2)]);
  const byUnit = new Map();
  for (const it of pool) { if (!byUnit.has(it.unit)) byUnit.set(it.unit, []); byUnit.get(it.unit).push(it); }
  const chosen = [];
  while (chosen.length < n && [...byUnit.values()].some((v) => v.length)) {
    for (const v of byUnit.values()) if (v.length && chosen.length < n) chosen.push(v.shift());
  }
  return sortBy(chosen, (it) => [it.difficulty ?? 2]);
}

// mock_start without the storage step: returns the new mock record. opts.excludeProblem(pid) drops problems the
// browser cannot grade (PyTorch ones) from Part 2.
export function mockStart(C, P, kind, unit, clk, { rand, excludeProblem = () => false } = {}) {
  const items = [...C.items.values()];
  const now = clk.epoch();
  const m = { kind, started: clk.nowIso(), answers: {}, codes: {}, finished: false };
  if (kind === 'unit') {
    const pool = items.filter((it) => it.unit === unit && (it.difficulty ?? 1) >= 2);
    const chosen = pickItems(pool, C.quizN, P.items, rand);
    Object.assign(m, { unit, items: chosen.map((it) => it.id), part1_ends: now + 3 * 60 * chosen.length });
  }
  if (kind === 'check') {
    let units = studiedUnits(P, lessonIndex(C));
    if (!units.size) units = new Set(C.curriculum.units.filter((u) => C.released.has(u.id)).map((u) => u.id));
    const ok = studiedFilter(C, P);
    let pool = items.filter((it) => units.has(it.unit) && (it.difficulty ?? 1) >= 2 && ok(it));
    if (pool.length < C.checkN) {
      pool = pool.concat(items.filter((it) => units.has(it.unit) && (it.difficulty ?? 1) >= 2 && !ok(it)).slice(0, C.checkN - pool.length));
    }
    const chosen = pickItems(pool, C.checkN, P.items, rand);
    Object.assign(m, { units: [...units].sort(cmp), items: chosen.map((it) => it.id), part1_ends: now + 3 * 60 * chosen.length });
  }
  if (kind === 'placement') {   // public build: the fixed placement paper the build picked, 2 minutes a question
    const ids = (C.placement || []).filter((i) => C.items.has(i));
    Object.assign(m, { items: ids, part1_ends: now + 2 * 60 * ids.length });
  }
  if (kind === 'part1' || kind === 'full') {
    const r1 = new Set(C.curriculum.units.filter((u) => u.round === 'R1').map((u) => u.id));
    let pool = items.filter((it) => r1.has(it.unit) && (it.difficulty ?? 1) >= 2);
    shuffle(pool, rand);
    pool = sortBy(pool, (it) => [it.id in P.items]);
    const byUnit = new Map();
    for (const it of pool) { if (!byUnit.has(it.unit)) byUnit.set(it.unit, []); byUnit.get(it.unit).push(it); }
    let chosen = [];
    while (chosen.length < 20 && [...byUnit.values()].some((v) => v.length)) {
      for (const v of byUnit.values()) if (v.length && chosen.length < 20) chosen.push(v.shift());
    }
    chosen = sortBy(chosen, (it) => [it.difficulty ?? 2]);
    m.items = chosen.map((it) => it.id);
    m.part1_ends = now + 60 * 60;
  }
  if (kind === 'part2' || kind === 'full') {
    const cands = [...C.problems.values()].filter((pr) => (pr.meta.difficulty ?? 1) >= 3 && !(P.problems[pr.id] || {}).solved
      && !excludeProblem(pr.id)).map((pr) => pr.id);
    shuffle(cands, rand);
    m.problems = cands.slice(0, 3);
    m.part2_ends = ((m.part1_ends ?? now) + (kind === 'full' ? 15 * 60 : 0)) + 75 * 60;
  }
  return m;
}

export function newMockId(rand = Math.random) {   // uuid.uuid4().hex[:10]
  let s = '';
  for (let i = 0; i < 10; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}
