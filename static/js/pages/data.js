// Your progress data (public build only): where it is kept, export, import, and the warning that clearing site
// data erases it. The file format is the local study site's data/progress.json.
import { h, toast, confirmDialog, plural } from '../ui.js';
import { invalidateMeta } from '../api.js';
import * as S from '../local/store.js';

export async function render(el) {
  el.dataset.title = 'Your progress data';
  const mode = await S.storageMode();
  let persisted = null;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* not supported */ }
  const where = { indexeddb: 'this browser\'s IndexedDB storage, with a copy in localStorage', localstorage: 'this browser\'s localStorage',
    memory: 'memory only: this browser blocks site storage, so progress is lost when you close the tab' }[mode];
  const P = JSON.parse(await S.exportText());
  const n = (o) => Object.keys(o || {}).length;

  const exportBtn = h('button', { class: 'btn primary', type: 'button', 'data-t': 'export', onclick: async () => {
    const text = await S.exportText();
    const d = new Date();
    const name = `usaaio-progress-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Saved ${name}.`, 'ok');
  } }, 'Export progress');
  const file = h('input', { type: 'file', accept: '.json,application/json', 'data-t': 'import-file', 'aria-label': 'Progress file to import' });
  const importBtn = h('button', { class: 'btn', type: 'button', 'data-t': 'import', onclick: () => file.click() }, 'Import progress');
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    let parsed;
    try { parsed = S.parseImport(await f.text()); } catch (e) { toast(e.message, 'error', 8000); return; }
    const okGo = await confirmDialog({ title: 'Replace your progress?', ok: 'Replace', danger: true,
      body: `This replaces everything saved in this browser with the file's progress: ${parsed.summary}. Export first if you want to keep what is here.` });
    if (!okGo) return;
    await S.replaceAll(parsed.progress);
    invalidateMeta();
    toast('Progress imported.', 'ok');
    location.hash = '#/progress';
  });

  el.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Your progress data'),
      h('p', { class: 'sub' }, 'Saved in this browser only. Export it to keep a copy or to move to another browser.'))),
    h('div', { class: 'panel error-panel', role: 'note', 'data-t': 'clear-warning' },
      h('h2', null, 'Clearing site data erases your progress'),
      h('p', null, 'Your answers, times and scores live only in this browser on this device. Clearing browsing data for this site, using a private window, or some cleanup tools delete them for good. Export a copy now and then.')),
    h('div', { class: 'grid-2', style: { marginTop: '16px' } },
      h('div', { class: 'panel' },
        h('h2', null, 'Export'),
        h('p', null, `Downloads one JSON file with everything: ${plural(Object.values(P.lessons || {}).filter((r) => r.done).length, 'lesson')} done, ${plural(n(P.items), 'question')} answered, ${plural(n(P.cards), 'card')} seen, ${plural(n(P.problems), 'problem')} tried, ${n(P.mocks)} mocks and quizzes.`),
        exportBtn),
      h('div', { class: 'panel' },
        h('h2', null, 'Import'),
        h('p', null, 'Choose a file exported from this site. A data/progress.json from the local version of the study site also works. Importing replaces what is saved here.'),
        importBtn, file)),
    h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('h2', null, 'Where it is kept'),
      h('p', { 'data-t': 'storage-mode' }, `Right now: ${where}.`),
      persisted === null ? null : h('p', { class: 'muted small' }, persisted
        ? 'The browser has marked this site\'s storage as persistent, so it will not clear it on its own when space runs low.'
        : 'The browser may clear this site\'s storage on its own if the disk gets very full and you have not visited for a while. Exporting protects you against that too.')));
}
