// Unit summary sheet (#/summary/<unit>): content/units/<uid>/summary.md in the lesson dialect, laid out to print on
// one or two pages (app.css @media print).
import { h } from '../ui.js';
import { get, meta } from '../api.js';
import { parseLesson, setGlossary } from '../md.js';
import { renderNodes } from './lesson.js';
import { reportLink } from '../report.js';

export async function render(el, r) {
  const uid = r.args[0];
  const [S, m] = await Promise.all([get('summary/' + encodeURIComponent(uid || '')), meta()]);
  setGlossary(m.glossary);
  el.dataset.title = `Summary: ${S.title}`;
  el.classList.add('reader-wrap');
  const body = h('div', { class: 'lesson-body summary-body' });
  body.append(renderNodes(parseLesson(S.markdown), { items: {}, answered: {}, unit: uid }));
  const rep = reportLink('summary', uid);
  el.append(h('article', { class: 'reader summary-sheet', 'data-t': 'summary' },
    h('header', { class: 'lesson-head' },
      h('div', { class: 'eyebrow' }, h('a', { href: `#/learn`, style: { color: 'inherit', textDecoration: 'none' } }, `${uid.toUpperCase()} · Summary sheet`)),
      h('h1', null, S.title),
      h('div', { class: 'row no-print' }, h('button', { class: 'btn small', type: 'button', 'data-t': 'print', onclick: () => window.print() }, 'Print'),
        h('span', { class: 'muted small' }, 'Fits one or two pages.'))),
    body,
    rep ? h('p', { class: 'report-row no-print' }, rep) : null));
}
