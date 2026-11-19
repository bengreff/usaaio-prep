// Public build: the panel on a problem that needs PyTorch. The browser cannot run it, so the problem is solved in
// Google Colab with a notebook that has the statement, the starter code and a hidden grader cell. The student
// reports the result here ("Mark solved"), which counts like a solved problem.
import { h, toast } from '../ui.js';
import { post, download } from '../api.js';

export function mount(left, P, { getCode, onState, mock, results }) {
  let st = { ...(P.state || {}) };
  const status = h('span', { class: 'muted small', 'data-t': 'colab-status' });
  const markBtn = h('button', { class: 'btn', type: 'button', 'data-t': 'colab-mark' });
  const draw = () => {
    markBtn.textContent = st.solved ? 'Mark not solved' : 'Mark solved';
    status.textContent = st.solved ? 'You marked this problem solved.' : 'Not marked solved yet.';
  };
  markBtn.addEventListener('click', async () => {
    markBtn.disabled = true;
    try {
      const r = await post(`problem/${P.id}/selfmark`, { solved: !st.solved, code: getCode() });
      st = r.state;
      onState(r.state);
      draw();
      toast(st.solved ? 'Marked solved.' : 'Marked not solved.', 'ok');
    } catch (e) { toast('Could not save: ' + e.message, 'error', 7000); } finally { markBtn.disabled = false; }
  });
  const dl = h('button', { class: 'btn', type: 'button', 'data-t': 'colab-download', onclick: async () => {
    try {
      await post(`problem/${P.id}/save`, { code: getCode() });
      await download(`problem/${P.id}/colab.ipynb`, `${P.id}.ipynb`);
      toast('Notebook downloaded. In Colab: File, Upload notebook.', 'ok', 6000);
    } catch (e) { toast('Download failed: ' + e.message, 'error'); }
  } }, 'Download .ipynb');
  const panel = h('div', { class: 'panel', 'data-t': 'colab-panel', style: { margin: '14px 0' } },
    h('h3', { style: { marginTop: 0 } }, 'Solve this one in Colab'),
    h('p', null, 'This problem uses PyTorch, which does not run in the browser. Open it in Google Colab (free, with a Google account): ',
      'the notebook has this statement, the starter code in a %%writefile cell, and a grader cell that runs the example and the hidden tests and checks the import and ban rules.'),
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: P.colab_url, target: '_blank', rel: 'noopener', 'data-t': 'colab-open' }, 'Open in Colab'),
      dl, mock ? null : markBtn),
    h('p', { class: 'muted small', style: { marginBottom: 0 } },
      '"Download .ipynb" includes the code from the editor here. When the grader cell prints "Accepted", come back and mark the problem solved. ',
      mock ? '' : status));
  if (results) {
    results.replaceChildren(h('p', { class: 'muted' }, 'Run and Submit for this problem are in its Colab notebook: the grader cell runs the example and the hidden tests. The help() tab works for NumPy and pandas names only.'));
  }
  const after = left.querySelector('.restrict');
  if (after) after.after(panel); else left.prepend(panel);
  draw();
  return panel;
}
