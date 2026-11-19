// Progress: time (total, this week against the weekly target from Settings, minutes by activity), progress checks (projected Part 1
// score over time), per-unit mastery with unit quiz bests, mock history.
import { h, fmtPoints, fmtDate, plural, TRACKS } from '../ui.js';
import { get, meta } from '../api.js';

const QUIZ_PASS = 0.7;
const projected = (pct) => Math.round(150 * pct);

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of kids) if (c) el.append(c);
  return el;
}

function isoWeekStart(key) {
  const [y, w] = key.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  return mon;
}
function weekKey(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  return `${y}-W${String(Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

function weeksChart(weeks, target) {
  // the last 12 weeks ending this week, zeros included
  const keys = [];
  const d = new Date();
  for (let i = 11; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - 7 * i); keys.push(weekKey(x)); }
  const vals = keys.map((k) => weeks[k] || 0);
  const W = 520, H = 210, L = 30, B = 26, T = 10, maxY = Math.max(6, Math.ceil(target * 1.5), Math.ceil(Math.max(...vals) + 0.5));
  const y = (v) => T + (H - T - B) * (1 - v / maxY);
  const bw = (W - L - 8) / keys.length;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Study hours per week for the last 12 weeks: ${vals.map((v) => v.toFixed(1)).join(', ')}. Target ${target} hours.` });
  svg.append(s('rect', { x: L, y: y(target), width: W - L - 8, height: y(0) - y(target), fill: 'var(--ok-soft)', opacity: 0.55 }));
  svg.append(s('line', { x1: L, x2: W - 8, y1: y(target), y2: y(target), stroke: 'var(--ok)', 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }));
  svg.append(s('text', { x: W - 12, y: y(target) - 6, 'text-anchor': 'end' }, document.createTextNode(`target ${target} h`)));
  for (let v = 0; v <= maxY; v += maxY > 8 ? 2 : 1) {
    svg.append(s('line', { x1: L, x2: W - 8, y1: y(v), y2: y(v), stroke: 'var(--border)', 'stroke-width': v === 0 ? 1.2 : 0.8 }));
    svg.append(s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, document.createTextNode(String(v))));
  }
  keys.forEach((k, i) => {
    const v = vals[i];
    const x = L + i * bw + bw * 0.18;
    const inBand = v >= target;
    if (v > 0) svg.append(s('rect', { x, y: y(v), width: bw * 0.64, height: y(0) - y(v), rx: 3, fill: inBand ? 'var(--ok)' : 'var(--accent)' },
      s('title', {}, document.createTextNode(`${k}: ${v.toFixed(1)} h`))));
    const mon = isoWeekStart(k);
    if (i % 2 === 1 || i === keys.length - 1) svg.append(s('text', { x: x + bw * 0.32, y: H - 8, 'text-anchor': 'middle' },
      document.createTextNode(i === keys.length - 1 ? 'this wk' : mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))));
  });
  return h('div', { class: 'chart' }, svg);
}

function mockChart(mocks) {
  const pts = mocks.filter((m) => m.max).map((m) => ({ v: (m.score / m.max) * 150, m }));
  if (pts.length < 2) return null;
  const W = 520, H = 170, L = 34, B = 22, T = 10;
  const y = (v) => T + (H - T - B) * (1 - v / 150);
  const x = (i) => L + 10 + (i * (W - L - 30)) / Math.max(1, pts.length - 1);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Part 1 mock scores scaled to 150: ${pts.map((p) => p.v.toFixed(0)).join(', ')}` });
  for (const v of [0, 50, 100, 150]) {
    svg.append(s('line', { x1: L, x2: W - 8, y1: y(v), y2: y(v), stroke: 'var(--border)' }));
    svg.append(s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, document.createTextNode(String(v))));
  }
  svg.append(s('polyline', { points: pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
  pts.forEach((p, i) => svg.append(s('circle', { cx: x(i), cy: y(p.v), r: 4, fill: 'var(--accent)' }, s('title', {}, document.createTextNode(`${fmtDate(p.m.started)}: ${p.v.toFixed(0)}`)))));
  return h('div', { class: 'chart' }, svg);
}

// Projected Part 1 score at each progress check, oldest first. Points are evenly spaced (one per check) and each
// carries its date; y is the full 0-150 range so a change is never exaggerated.
function checksChart(checks) {
  const pts = checks.map((c) => ({ v: projected(c.pct), c }));
  const W = 520, H = 200, L = 34, R = 16, T = 18, B = 30;
  const y = (v) => T + (H - T - B) * (1 - v / 150);
  const x = (i) => pts.length === 1 ? (L + W - R) / 2 : L + 18 + (i * (W - L - R - 36)) / (pts.length - 1);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'checks-chart',
    'aria-label': `Projected Part 1 score at each progress check, out of 150: ${pts.map((p) => `${fmtDate(p.c.date)}: ${p.v}`).join('; ')}.` });
  for (const v of [0, 50, 100, 150]) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: v === 150 ? 'var(--border-strong)' : 'var(--border)',
      'stroke-width': v === 0 ? 1.2 : 1, 'stroke-dasharray': v === 150 ? '4 4' : null }));
    svg.append(s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, document.createTextNode(String(v))));
  }
  svg.append(s('text', { x: W - R, y: y(150) - 5, 'text-anchor': 'end' }, document.createTextNode('150 = every Part 1 question right')));
  if (pts.length > 1) svg.append(s('polyline', { points: pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  const every = Math.ceil(pts.length / 7);
  pts.forEach((p, i) => {
    const last = i === pts.length - 1;
    const tip = `${fmtDate(p.c.date)}: ${p.v} / 150 projected (${fmtPoints(p.c.score)} / ${fmtPoints(p.c.max)} on the check)`;
    svg.append(s('g', { class: 'pt' },
      s('circle', { cx: x(i), cy: y(p.v), r: 12, fill: 'transparent' }),
      s('circle', { cx: x(i), cy: y(p.v), r: 4, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2 }),
      s('title', {}, document.createTextNode(tip))));
    if (last || pts.length <= 6) {
      svg.append(s('text', { x: x(i), y: y(p.v) - 10, 'text-anchor': 'middle', class: last ? 'val strong' : 'val' }, document.createTextNode(String(p.v))));
    }
    if (i % every === 0 || last) {
      svg.append(s('text', { x: x(i), y: H - 9, 'text-anchor': 'middle' },
        document.createTextNode(new Date(p.c.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))));
    }
  });
  return h('div', { class: 'chart' }, svg);
}

// Minutes by activity: the server's per-route kinds folded into the six Ben asked about (plus other pages).
const ACTIVITY = [['Lessons', ['lesson']], ['Problems', ['problem']], ['Cards', ['cards']], ['Practice', ['practice', 'review']],
  ['Quizzes and checks', ['quiz', 'check']], ['Mocks', ['mock']], ['Other pages', ['other']]];
function activityTable(t) {
  const all = t.by_kind_minutes || {}, wk = t.this_week_by_kind_minutes || {};
  const rows = ACTIVITY.map(([label, ks]) => ({ label, all: ks.reduce((a, k) => a + (all[k] || 0), 0), wk: ks.reduce((a, k) => a + (wk[k] || 0), 0) }))
    .filter((r) => r.all > 0 || r.label !== 'Other pages');
  const max = Math.max(1, ...rows.map((r) => r.all));
  const split = rows.reduce((a, r) => a + r.all, 0);
  const unsplit = Math.round(t.total_hours * 60) - split;
  const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
  return [h('table', { class: 'ttable', 'data-t': 'activity' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Activity'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Share')),
      h('th', { scope: 'col', class: 'num' }, 'All time'), h('th', { scope: 'col', class: 'num' }, 'This week'))),
    h('tbody', null, rows.map((r) => h('tr', null, h('th', { scope: 'row' }, r.label),
      h('td', { class: 'tbar' }, h('div', { class: 'bar', role: 'img', 'aria-label': `${r.all} minutes` }, h('span', { style: { width: (r.all / max) * 100 + '%' } }))),
      h('td', { class: 'num' }, r.all ? fmt(r.all) : h('span', { class: 'muted' }, '0')),
      h('td', { class: 'num' }, r.wk ? fmt(r.wk) : h('span', { class: 'muted' }, '0')))))),
  unsplit > 1 ? h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, `${fmt(unsplit)} more is in the total but not split by activity (recorded before the split started on Nov 18, or rounding).`) : null];
}

// Unit quiz best against the 70% pass mark (the tick on the bar).
function quizMetric(u) {
  const b = u.quiz_best;
  if (!b) return h('small', { class: 'muted' }, u.items_total && u.lessons_ready ? 'Not taken' : '-');
  const pct = Math.round(b.pct * 100), pass = b.pct >= QUIZ_PASS - 1e-9;
  return h('div', { class: 'metric qmetric', title: `Best ${fmtPoints(b.score)} / ${fmtPoints(b.max)} on ${fmtDate(b.date)}; pass mark 70%` },
    h('div', { class: `bar ${pass ? 'ok' : 'warn'}`, role: 'img', 'aria-label': `Best unit quiz ${pct}%, ${pass ? 'passed' : 'below the 70% pass mark'}` },
      h('span', { style: { width: pct + '%' } }), h('i', { class: 'pass-tick', style: { left: '70%' } })),
    h('small', { 'data-t': `pq-${u.id}` }, `${pct}%`));
}

function metric(n, d, label, cls = '') {
  const pct = d ? Math.round((n / d) * 100) : 0;
  return h('div', { class: 'metric', title: label },
    h('div', { class: `bar ${cls}`, role: 'img', 'aria-label': label }, h('span', { style: { width: pct + '%' } })),
    h('small', null, d ? `${n}/${d}` : '-'));
}

export async function render(el) {
  el.dataset.title = 'Progress';
  const [p, m] = await Promise.all([get('progress'), meta()]);
  const target = Number(m.settings?.weekly_hours) || 3;   // Settings: weekly hours target
  const t = p.time || { total_hours: Object.values(p.weeks).reduce((a, b) => a + b, 0), this_week_hours: p.weeks[weekKey(new Date())] || 0, by_kind_minutes: {}, this_week_by_kind_minutes: {}, days_studied: 0 };
  const thisWeek = t.this_week_hours;
  const r1 = p.units.filter((u) => u.round === 'R1');
  const lessonsDone = r1.reduce((a, u) => a + u.lessons_done, 0), lessonsTotal = r1.reduce((a, u) => a + u.lessons_total, 0);
  const seen = p.units.reduce((a, u) => a + u.items_seen, 0);
  const accW = p.units.filter((u) => u.item_accuracy != null);
  const acc = accW.length ? accW.reduce((a, u) => a + u.item_accuracy * u.items_seen, 0) / Math.max(1, accW.reduce((a, u) => a + u.items_seen, 0)) : null;
  const checks = p.checks || [];
  const lastCheck = checks.length ? checks[checks.length - 1] : null;

  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Progress'),
    h('p', { class: 'sub' }, `${p.days_to_round1} days to Round 1.`))));
  el.append(h('div', { class: 'stat-row five' },
    h('div', { class: 'panel stat' }, h('b', { 'data-t': 'week-hours' }, thisWeek.toFixed(1) + ' h'), h('span', null, `this week (target ${target} h)`)),
    h('div', { class: 'panel stat' }, h('b', { 'data-t': 'total-hours' }, t.total_hours.toFixed(1) + ' h'), h('span', null, `in total, ${plural(t.days_studied || 0, 'day')} of 5+ min`)),
    h('div', { class: 'panel stat' }, h('b', null, `${lessonsDone}/${lessonsTotal}`), h('span', null, 'Round 1 lessons done')),
    h('div', { class: 'panel stat' }, h('b', null, lastCheck ? `${projected(lastCheck.pct)}` : '-'), h('span', null, lastCheck ? 'projected Part 1 of 150, last check' : 'projected Part 1: no check yet')),
    h('div', { class: 'panel stat' }, h('b', null, acc == null ? '-' : Math.round(acc * 100) + '%'), h('span', null, `question accuracy (${seen} seen)`))));

  // time: this week against the band, the weekly chart, minutes by activity
  const band = h('div', { class: 'weekbar', style: { marginTop: '0', marginBottom: '14px' } },
    h('div', { class: 'row small', style: { justifyContent: 'space-between', marginBottom: '6px' } },
      h('span', null, 'This week'), h('span', { class: 'muted' }, `${thisWeek.toFixed(1)} h of a ${target} h target${thisWeek < target ? `: ${(target - thisWeek).toFixed(1)} h to go` : ': reached'}`)),
    h('div', { class: 'bar ok', role: 'img', 'aria-label': `${thisWeek.toFixed(1)} hours this week; target ${target} hours` },
      h('span', { style: { width: Math.min(100, (thisWeek / Math.max(target * 1.5, thisWeek)) * 100) + '%' } }),
      h('div', { class: 'band target', style: { left: Math.min(100, (target / Math.max(target * 1.5, thisWeek)) * 100) + '%', width: '2px' } })));
  const noTime = !t.total_hours && !Object.keys(t.by_kind_minutes || {}).length;
  el.append(h('div', { class: 'grid-2' },
    h('div', { class: 'panel' }, h('h2', null, 'Hours per week'), band, weeksChart(p.weeks, target)),
    h('div', { class: 'panel' }, h('h2', null, 'Time by activity'),
      noTime ? h('p', { class: 'muted' }, 'No study time recorded yet. Time counts while this tab is visible and you have used the page in the last 2 minutes.')
        : activityTable(t))));

  // progress checks and mocks
  const checkBtn = h('a', { class: `btn ${checks.length ? '' : 'primary'}`, href: '#/check', 'data-t': 'check-start-link' }, 'Take a progress check');
  let checksBody;
  if (!checks.length) {
    checksBody = [h('p', { class: 'muted', 'data-t': 'checks-empty' }, 'No progress checks yet. Each one is 12 mixed questions from the units you have studied; your percent projects a Part 1 score out of 150. One every two weeks shows the trend.'), checkBtn];
  } else {
    const prev = checks.length > 1 ? checks[checks.length - 2] : null;
    const d = prev ? projected(lastCheck.pct) - projected(prev.pct) : null;
    checksBody = [
      h('p', { class: 'check-latest' }, h('b', { 'data-t': 'latest-projected' }, String(projected(lastCheck.pct))), h('span', null, ' / 150 projected'),
        d !== null ? h('span', { class: `chip ${d > 0 ? 'ok' : d < 0 ? 'bad' : 'muted'}`, style: { marginLeft: '10px' } }, d === 0 ? 'no change' : `${d > 0 ? '+' : '-'}${Math.abs(d)} since the check before`) : null),
      checksChart(checks),
      h('p', { class: 'muted small' }, 'Projected = 150 × your percent on the check, rounded. Checks use exam scoring (7.5 / 0 / 1.5).'),
      h('div', { class: 'row' }, checkBtn, h('span', { class: 'muted small' }, `${plural(checks.length, 'check')}; last ${fmtDate(lastCheck.date)}`)),
    ];
  }
  el.append(h('div', { class: 'grid-2', style: { marginTop: '16px' } },
    h('div', { class: 'panel', 'data-t': 'checks-panel' }, h('h2', null, 'Progress checks'), checksBody),
    h('div', { class: 'panel' }, h('h2', null, 'Mock exams'),
      p.mocks.length ? [mockChart(p.mocks), h('table', { class: 'mock-table' },
        h('thead', null, h('tr', null, ['Date', 'Kind', 'Score'].map((x) => h('th', null, x)))),
        h('tbody', null, p.mocks.slice().reverse().map((m) => h('tr', null, h('td', null, h('a', { href: `#/mock/${m.id}` }, fmtDate(m.started))),
          h('td', null, m.kind === 'full' ? 'Full' : m.kind === 'part1' ? 'Part 1' : 'Part 2'),
          h('td', null, m.max ? `${fmtPoints(m.score)} / ${fmtPoints(m.max)}` : 'graded'))))
      )] : [h('p', { class: 'muted' }, 'No finished mocks yet. Take the first one after a few units.'), h('a', { class: 'btn', href: '#/mock' }, 'Mock exams')])));

  const rows = [];
  for (const round of ['R1', 'R2']) {
    const us = p.units.filter((u) => u.round === round);
    if (!us.length) continue;
    rows.push(h('tr', { class: 'round-row' }, h('td', { colspan: '7' }, round === 'R1' ? 'Round 1' : 'Round 2 and beyond')));
    for (const u of us) {
      rows.push(h('tr', null,
        h('td', null, h('span', { class: 'unit-id' }, u.id.toUpperCase()), ' ', u.title),
        h('td', { class: 'muted' }, TRACKS[u.track] || u.track),
        h('td', null, metric(u.lessons_done, u.lessons_total, `${u.lessons_done} of ${u.lessons_total} lessons done (${u.lessons_ready} written)`, 'ok')),
        h('td', null, u.item_accuracy == null ? h('small', { class: 'muted' }, u.items_total ? `0/${u.items_total} seen` : '-')
          : metric(Math.round(u.item_accuracy * u.items_seen), u.items_seen, `${Math.round(u.item_accuracy * 100)}% right of ${u.items_seen} seen`)),
        h('td', null, quizMetric(u)),
        h('td', null, metric(u.cards_mastered, u.cards_total, `${u.cards_mastered} of ${u.cards_total} cards mastered`)),
        h('td', null, metric(u.problems_solved, u.problems_total, `${u.problems_solved} of ${u.problems_total} problems solved`, 'ok'))));
    }
  }
  el.append(h('div', { class: 'panel', style: { marginTop: '16px' } }, h('h2', null, 'By unit'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'ptable' },
      h('thead', null, h('tr', null, ['Unit', 'Track', 'Lessons', 'Questions right', h('span', null, 'Unit quiz ', h('span', { class: 'th-note' }, '(pass 70%)')), 'Cards mastered', 'Problems solved'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows)))));
}
