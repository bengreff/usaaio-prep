// About (public build only): who made this, that it is not affiliated with USAAIO, how progress is stored, what
// runs in the browser and what runs in Colab, library versions, licenses.
import { h } from '../ui.js';

export async function render(el) {
  el.dataset.title = 'About';
  const S = window.STATIC_MODE || {};
  const py = S.pyodide || { packages: {} };
  const colab = S.colab_versions || {};
  const repo = S.owner && S.repo ? `https://github.com/${S.owner}/${S.repo}` : null;
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  const rows = [['Python', 'python'], ['NumPy', 'numpy'], ['pandas', 'pandas'], ['scikit-learn', 'scikit-learn'], ['SciPy', 'scipy'],
    ['Matplotlib', 'matplotlib'], ['PyTorch', 'torch']];
  el.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'About'),
      h('p', { class: 'sub' }, 'A free study site for Round 1 of the USA AI Olympiad.'))),
    h('div', { class: 'panel', 'data-t': 'not-affiliated' },
      h('h2', null, 'Not an official site'),
      h('p', null, 'USAAIO Prep is an independent study site. It is not affiliated with or endorsed by USAAIO (the USA AI Olympiad). ',
        'For the rules, dates and official materials, go to ', ext('https://usaaio.org', 'usaaio.org'), '.'),
      h('p', null, 'The lessons, questions and coding problems here are original, or adapted from past contests and labelled as such. The official problems and samples themselves are not included in this public version.')),
    h('div', { class: 'grid-2', style: { marginTop: '16px' } },
      h('div', { class: 'panel' },
        h('h2', null, 'Where your progress is kept'),
        h('p', null, 'Only in this browser, on this device. There are no accounts and nothing is sent to a server: answers, times and scores are saved in the browser\'s storage (IndexedDB, with a copy in localStorage).'),
        h('p', null, h('strong', null, 'Clearing site data erases your progress. '), 'So does a private window when you close it. Export a copy now and then, and import it to move to another browser.'),
        h('p', null, h('a', { class: 'btn', href: '#/data' }, 'Export or import progress'))),
      h('div', { class: 'panel' },
        h('h2', null, 'No tracking'),
        h('p', null, 'No analytics, no cookies, no ads. The page loads only its own files. The one outside request is Python: the first time you run code, your browser downloads Pyodide from cdn.jsdelivr.net (about 30 MB, then cached).'),
        h('p', { class: 'muted small' }, 'A content security policy in the page blocks every other connection.'))),
    h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('h2', null, 'What runs where'),
      h('ul', null,
        h('li', null, h('strong', null, 'In your browser: '), `Python ${py.packages.python || ''} with NumPy, pandas, scikit-learn, SciPy and Matplotlib, through `,
          ext('https://pyodide.org', `Pyodide ${py.version || ''}`), '. Try-it blocks, syntax cards, help() and the graders of the NumPy and pandas problems run here, in a background worker. Stop (or a time limit) restarts Python.'),
        h('li', null, h('strong', null, 'Recorded: '), 'PyTorch does not run in the browser. Lesson examples that use it show the output recorded when the site was built, with a button to copy the code into Colab.'),
        h('li', null, h('strong', null, 'Self-marked: '), 'PyTorch syntax cards are checked by comparing your text with the answer (spacing and quote style do not matter). If it differs, you compare and mark it right or wrong; the mark sets when the card comes back.'),
        h('li', null, h('strong', null, 'In Google Colab: '), 'coding problems that need PyTorch open as a Colab notebook with the statement, the starter code and a grader cell that runs every test. Then you mark the problem solved here. Colab is where the real exam runs, so this is also practice for the submission flow.')),
      h('p', null, 'Time limits in the browser are approximate: WebAssembly Python is slower than Colab, so each limit is scaled up. Colab\'s timing is what counts in the exam.'),
      h('div', { class: 'table-wrap', style: { margin: '8px 0 0' } }, h('table', { class: 'mock-table', 'data-t': 'versions' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Library'), h('th', { scope: 'col' }, 'In the browser (Pyodide)'), h('th', { scope: 'col' }, 'Colab, as the lessons assume'))),
        h('tbody', null, rows.map(([label, k]) => h('tr', null, h('td', null, label),
          h('td', { class: 'mono' }, k === 'torch' ? 'not available' : (py.packages[k] || '-')), h('td', { class: 'mono' }, colab[k] || '-')))))),
      h('p', { 'data-t': 'wasm-differences' }, h('strong', null, 'Two differences you will notice in the browser. '),
        'Integer arrays default to ', h('code', null, 'int32'), ' here (WebAssembly is a 32-bit platform), where Colab and the exam use ', h('code', null, 'int64'),
        '. And NumPy cannot warn about overflow or division by zero here (WebAssembly has no floating-point error flags), so warnings such as "overflow encountered in exp" do not appear; the result still shows inf or nan.'),
      h('p', { class: 'muted small' }, 'The browser versions are close to Colab\'s but not identical, so a printed number or dtype can differ slightly. This site stays on pandas 2.x on purpose: pandas 3 (in newer Pyodide releases) changes how string columns and copies work.')),
    h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('h2', null, 'Answers in the page files'),
      h('p', null, 'Everything runs in your browser, so the answers, solutions and test code are in the files the site downloads. They are lightly scrambled so you do not see them by accident while poking around. That is not security: anyone can unscramble them, and doing so only takes away your practice.')),
    h('div', { class: 'panel', style: { marginTop: '16px' } },
      h('h2', null, 'Licenses'),
      h('p', null, 'The site bundles ', ext('https://katex.org', 'KaTeX'), ' 0.16 (MIT), ', ext('https://marked.js.org', 'marked'), ' 12 (MIT) and ',
        ext('https://codemirror.net/5/', 'CodeMirror'), ' 5 (MIT), and loads ', ext('https://pyodide.org', 'Pyodide'), ' (MPL-2.0) from jsDelivr. ',
        'The full texts are in ', h('a', { href: 'LICENSES.md' }, 'LICENSES.md'), '.'),
      repo ? h('p', null, 'Source: ', ext(repo, repo.replace('https://', '')), '.') : null,
      S.build ? h('p', { class: 'muted small' }, `Built ${S.build}.`) : null));
}
