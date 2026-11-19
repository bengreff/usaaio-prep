// Lesson reader: the lesson dialect rendered for long, comfortable reading.
import { h, clear, toast, PRIORITY, plural } from '../ui.js';
import { activity, fmtMinutes } from '../time.js';
import { get, post, meta, lessonInfo, invalidateMeta } from '../api.js';
import { parseLesson, mdBlock, setGlossary } from '../md.js';
import { makeEditor } from '../editor.js';
import { itemView } from '../item.js';
import { blockDone, continueButton, getSession } from '../session.js';
import { reportLink } from '../report.js';

const CALLOUT = { note: 'Note', tip: 'Exam tip', warn: 'Common mistake', example: 'Worked example', deeper: 'Deeper' };
const WIDGETS = new Set(['broadcast', 'gd', 'projection', 'confusion', 'conv', 'kmeans']);

// Public build: code that imports a module Pyodide lacks (PyTorch) cannot run here; its output was recorded at build
// time. Same import rule as backend.js colabCode().
function recordedOnly(code) {
  const S = window.STATIC_MODE;
  if (!S) return false;
  const mods = new Set();
  for (const m of String(code).matchAll(/^\s*(?:import\s+([\w.]+(?:\s*,\s*[\w.]+)*)|from\s+([\w.]+)\s+import)/gm)) {
    (m[1] ? m[1].split(',') : [m[2]]).forEach((x) => mods.add(x.trim().split('.')[0]));
  }
  return (S.colab_modules || ['torch']).some((x) => mods.has(x) && !String(code).includes(`${x}.py`));
}

function recordedCell(code) {
  const out = h('div', { class: 'try-out', hidden: true, 'aria-live': 'polite' });
  const showBtn = h('button', { class: 'btn small primary', type: 'button', 'data-t': 'show-output', 'aria-expanded': 'false' }, 'Show output');
  const copyBtn = h('button', { class: 'btn small ghost', type: 'button', 'data-t': 'copy-code', onclick: () => {
    navigator.clipboard.writeText(code).then(() => toast('Code copied. Paste it into a Colab cell to run it.', 'ok'), () => toast('Copy failed: select the code and copy it.', 'error'));
  } }, 'Copy');
  const edHost = h('div');
  const box = h('div', { class: 'try recorded-try', 'data-t': 'recorded-try' },
    h('div', { class: 'try-bar' }, h('span', { class: 'label' }, 'PyTorch example'),
      h('span', { class: 'muted small try-note' }, 'Runs in Colab, not in the browser'), h('span', { class: 'spacer' }), copyBtn, showBtn),
    edHost, out);
  const cm = makeEditor(edHost, { value: code, readOnly: true, label: 'PyTorch example (read only)' });
  let loaded = false;
  showBtn.addEventListener('click', async () => {
    if (loaded) { out.hidden = !out.hidden; showBtn.textContent = out.hidden ? 'Show output' : 'Hide output'; showBtn.setAttribute('aria-expanded', String(!out.hidden)); return; }
    showBtn.disabled = true;
    out.hidden = false;
    clear(out).append(h('div', { class: 'loading', style: { padding: '4px 0', justifyContent: 'flex-start' } }, h('span', { class: 'spinner' }), 'Loading the recorded output'));
    try {
      const r = await post('exec', { code });
      clear(out).append(h('div', { class: 'row', 'data-t': 'recorded' }, h('span', { class: 'chip accent' }, 'Recorded output'),
        h('span', { class: 'muted small' }, 'Recorded in Colab-matched Python when the site was built.')));
      if (r.stdout) out.append(h('div', { class: 'out-label' }, 'Output'), h('pre', null, r.stdout.replace(/\n$/, '')));
      if (r.result_repr && !(r.stdout || '').includes(r.result_repr)) out.append(h('div', { class: 'out-label' }, 'Value'), h('pre', null, r.result_repr));
      if (r.error) out.append(h('div', { class: 'out-label' }, 'Error'), h('pre', { class: 'err' }, r.error));
      for (const img of r.images || []) out.append(h('img', { src: 'data:image/png;base64,' + img, alt: 'Figure from the code above (recorded)' }));
      if (!r.stdout && !r.result_repr && !r.error && !(r.images || []).length) out.append(h('div', { class: 'none' }, 'This example prints nothing.'));
      loaded = true;
      showBtn.textContent = 'Hide output';
      showBtn.setAttribute('aria-expanded', 'true');
    } catch (e) {
      clear(out).append(h('pre', { class: 'err' }, e.message));
    } finally { showBtn.disabled = false; }
  });
  box.cm = cm;
  return box;
}

export function tryCell(code, unit) {
  if (recordedOnly(code)) return recordedCell(code);
  const out = h('div', { class: 'try-out', hidden: true, 'aria-live': 'polite' });
  const runBtn = h('button', { class: 'btn small primary', type: 'button', title: 'Run (Cmd+Enter)' }, 'Run', h('span', { class: 'kbd-hint' }, '⌘↵'));
  const resetBtn = h('button', { class: 'btn small ghost', type: 'button', title: 'Put the original code back' }, 'Reset');
  const edHost = h('div');
  const box = h('div', { class: 'try' },
    h('div', { class: 'try-bar' }, h('span', { class: 'label' }, 'Try it'), h('span', { class: 'spacer' }), resetBtn, runBtn),
    edHost, out);
  const cm = makeEditor(edHost, { value: code, onRun: run, label: 'Runnable Python example' });
  resetBtn.addEventListener('click', () => { cm.setValue(code); out.hidden = true; });
  runBtn.addEventListener('click', run);
  let busy = false;
  async function run() {
    if (busy) return;
    busy = true;
    runBtn.disabled = true;
    out.hidden = false;
    clear(out).append(h('div', { class: 'loading', style: { padding: '4px 0', justifyContent: 'flex-start' } }, h('span', { class: 'spinner' }), 'Running'));
    try {
      const r = await post('exec', { code: cm.getValue(), unit });   // unit: its data files are in the working folder
      clear(out);
      if (r.stdout) out.append(h('div', { class: 'out-label' }, 'Output'), h('pre', null, r.stdout.replace(/\n$/, '')));
      if (r.result_repr && !(r.stdout || '').includes(r.result_repr)) out.append(h('div', { class: 'out-label' }, 'Value'), h('pre', null, r.result_repr));
      if (r.error) out.append(h('div', { class: 'out-label' }, 'Error'), h('pre', { class: 'err' }, r.error));
      for (const img of r.images || []) out.append(h('img', { src: 'data:image/png;base64,' + img, alt: 'Figure from the code above' }));
      if (!out.firstChild) out.append(h('div', { class: 'none' }, 'Ran with no output.'));
      if (r.browser_note) out.append(h('p', { class: 'muted small', 'data-t': 'browser-note' }, r.browser_note));
      if (r.recorded) { // public build: PyTorch output recorded when the site was built
        const copy = h('button', { class: 'btn small ghost', type: 'button', 'data-t': 'copy-code', onclick: () => {
          navigator.clipboard.writeText(cm.getValue()).then(() => toast('Code copied. Paste it into a Colab cell to run it.', 'ok'), () => toast('Copy failed: select the code and copy it.', 'error'));
        } }, 'Copy code');
        out.prepend(h('div', { class: 'row', 'data-t': 'recorded' }, h('span', { class: 'chip accent' }, 'Recorded output'),
          h('span', { class: 'muted small' }, r.recorded_note || ''), h('span', { class: 'spacer' }), copy));
      }
    } catch (e) {
      clear(out).append(h('pre', { class: 'err' }, e.message));
    } finally {
      busy = false;
      runBtn.disabled = false;
    }
  }
  box.cm = cm;
  return box;
}

export function widgetBlock(node) {
  const host = h('div', { class: 'widget', 'data-widget': node.name });
  if (node.err || !WIDGETS.has(node.name)) {
    host.append(h('p', { class: 'widget-error' }, node.err ? `Widget ${node.name}: ${node.err}.` : `Unknown widget "${node.name}".`));
    return host;
  }
  host.append(h('div', { class: 'loading', style: { padding: '12px 0' } }, h('span', { class: 'spinner' }), 'Loading figure'));
  import(`../../widgets/${node.name}.js`).then((mod) => {
    clear(host);
    mod.mount(host, node.params || {});
  }).catch((e) => {
    clear(host).append(h('p', { class: 'widget-error' }, `The ${node.name} figure failed to load: ${e.message}`));
  });
  return host;
}

export function renderNodes(nodes, ctx) {
  const frag = document.createDocumentFragment();
  for (const n of nodes) {
    if (n.type === 'md') frag.append(mdBlock(n.text));
    else if (n.type === 'try') frag.append(tryCell(n.code, ctx.unit));
    else if (n.type === 'widget') frag.append(widgetBlock(n));
    else if (n.type === 'check') {
      for (const id of n.ids) {
        const it = ctx.items?.[id];
        if (!it) { frag.append(h('p', { class: 'widget-error' }, `Question ${id} is missing.`)); continue; }
        frag.append(itemView(it, { mode: 'lesson', prior: ctx.answered?.[id], onAnswered: ctx.onAnswered }));
      }
    } else if (n.type === 'callout') {
      const kind = CALLOUT[n.kind] ? n.kind : 'note';
      const label = h('div', { class: 'callout-label' }, CALLOUT[n.kind] || n.kind, n.title ? h('span', { class: 't' }, n.title) : null);
      const inner = h('div', { class: 'callout-body' }, renderNodes(n.children, ctx));
      inner.querySelectorAll(':scope > .prose').forEach((p) => p.classList.add('in-callout'));
      if (kind === 'deeper') frag.append(h('details', { class: 'callout deeper' }, h('summary', null, label), inner));
      else frag.append(h('aside', { class: `callout ${kind}` }, label, inner));
    }
  }
  return frag;
}

export async function render(el, r) {
  const lid = r.args[0];
  const [L, m, probs] = await Promise.all([get('lesson/' + encodeURIComponent(lid)), meta(), get('problems').catch(() => ({ problems: [] }))]);
  const ptitle = (pid) => probs.problems.find((p) => p.id === pid)?.title || pid;
  setGlossary(m.glossary);
  el.dataset.title = L.title;
  el.classList.add('reader-wrap');
  // time on this lesson = the server's accumulated active seconds + what the heartbeat has not posted yet
  const myRoute = activity.route();
  let base = L.active_seconds || 0;
  const total = () => base + activity.pending(myRoute);
  const timeEl = h('span', { class: 'lesson-time', 'data-t': 'lesson-time', title: 'Counts while this tab is visible and you have used the page in the last 2 minutes' });
  let shown = '';
  const drawTime = () => { const t = `Time on this lesson: ${fmtMinutes(total())}`; if (t !== shown) { shown = timeEl.textContent = t; } };
  drawTime();
  const offTick = activity.onTick(drawTime);
  const offSaved = activity.onSaved(({ route, resp }) => {
    if (route === myRoute && resp && resp.lesson_seconds != null) { base = Math.max(base, resp.lesson_seconds); drawTime(); }
  });
  const timer = { stop() { offTick(); offSaved(); } };
  const prevInfo = L.prev ? lessonInfo(m, L.prev) : null;
  const nextInfo = L.next ? lessonInfo(m, L.next) : null;

  const head = h('header', { class: 'lesson-head' },
    h('div', { class: 'eyebrow' }, h('a', { href: `#/learn`, style: { color: 'inherit', textDecoration: 'none' } }, `${L.unit.toUpperCase()} · ${L.unit_title}`)),
    h('h1', null, L.title),
    h('div', { class: 'lesson-meta' },
      h('span', null, `${L.minutes} min`),
      h('span', { class: `prio p${L.priority}` }, PRIORITY[L.priority] || ''),
      h('span', { class: 'chip' }, L.track === 'theory' ? 'Theory' : L.track === 'code' ? 'Code' : 'Exam'),
      L.done ? h('span', { class: 'chip ok' }, 'Done') : null,
      L.markdown ? timeEl : null),
    L.goals ? h('p', { class: 'lesson-goals' }, h('strong', null, 'Goals: '), L.goals) : null);

  const reader = h('article', { class: 'reader' }, head);
  if (!L.markdown) {
    reader.append(h('div', { class: 'panel empty' }, h('h2', null, 'This lesson is coming soon'),
      h('p', null, 'It is on the map, but the text is not written yet.'), h('a', { class: 'btn', href: '#/learn' }, 'Back to the map')));
    el.append(reader);
    return () => timer.stop();
  }

  const nodes = parseLesson(L.markdown);
  const body = h('div', { class: 'lesson-body' });
  body.append(renderNodes(nodes, { items: L.items, answered: L.answered, unit: L.unit }));
  reader.append(body);

  // footer: done, related cards and problems, prev/next
  let done = L.done;
  const doneBtn = h('button', { class: `btn ${done ? '' : 'primary'} big`, type: 'button', 'data-t': 'mark-done' }, done ? 'Done again' : 'Mark lesson done');
  const doneNote = h('span', { class: 'muted small' }, done ? 'You finished this lesson before. Marking again records today.' : 'Records the time you spent on this lesson.');
  const doneRow = h('div', { class: 'lesson-done-row' }, doneBtn, doneNote);
  doneBtn.addEventListener('click', async () => {
    doneBtn.disabled = true;
    try {
      // post the pending seconds first: the server stores its own active total, and the body's
      // seconds (its fallback) is then the same number
      await activity.flush();
      const secs = total();
      await post(`lesson/${lid}/done`, { seconds: secs });
      invalidateMeta();
      done = true;
      doneBtn.textContent = 'Done';
      doneBtn.classList.remove('primary');
      doneNote.textContent = secs < 60 ? 'Saved, under a minute recorded.' : `Saved, ${fmtMinutes(secs)} recorded.`;
      blockDone('lesson', lid);
      const cont = continueButton();
      if (cont && !doneRow.querySelector('.session-next')) doneRow.append(cont);
      toast('Lesson marked done.', 'ok');
    } catch (e) {
      toast('Could not save: ' + e.message, 'error', 7000);
    } finally {
      doneBtn.disabled = false;
    }
  });
  const links = h('div', { class: 'lesson-links' },
    L.cards?.length ? h('a', { class: 'btn', href: `#/cards?lesson=${lid}` }, `Drill ${plural(L.cards.length, 'syntax card')}`) : null,
    ...(L.problems || []).map((pid) => h('a', { class: 'btn', href: `#/problem/${pid}` }, `Problem: ${ptitle(pid)}`)),
    h('a', { class: 'btn', href: `#/practice?unit=${L.unit}&lesson=${lid}&start=1` }, 'Practice questions'));
  const pn = (info, dir, cls) => info && info.ready
    ? h('a', { href: `#/lesson/${info.id}`, class: cls }, h('span', { class: 'dir' }, dir), info.title)
    : h('span', { class: `disabled ${cls}` }, h('span', { class: 'dir' }, dir), info ? `${info.title} (coming soon)` : 'None');
  const rep = reportLink('lesson', lid);
  reader.append(h('footer', { class: 'lesson-foot' }, doneRow, links, rep ? h('p', { class: 'report-row' }, rep) : null,
    h('nav', { class: 'prevnext', 'aria-label': 'Lesson navigation' }, pn(prevInfo, 'Previous', 'prev'), pn(nextInfo, 'Next', 'next'))));

  if (getSession() && done) { const c = continueButton(); if (c) doneRow.append(c); }

  // reading progress bar
  const rp = h('div', { class: 'reading-progress', 'aria-hidden': 'true' });
  document.body.appendChild(rp);
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    rp.style.width = (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + '%';
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  el.append(reader);
  return () => { timer.stop(); rp.remove(); window.removeEventListener('scroll', onScroll); };
}
