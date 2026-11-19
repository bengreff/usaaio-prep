// "Report a mistake" (public build only): a small link that opens a prefilled GitHub issue in a new tab. Nothing is
// sent by the site; the student finishes and submits the issue on GitHub. The local site shows no link.
import { h } from './ui.js';

const KINDS = { lesson: 'Lesson', item: 'Question', card: 'Syntax card', problem: 'Problem', summary: 'Summary sheet' };

export function reportUrl(kind, id, extra = '') {
  const S = window.STATIC_MODE;
  if (!S || !S.owner || !S.repo) return null;
  const page = new URL(location.href);
  const title = `Mistake in ${(KINDS[kind] || kind).toLowerCase()} ${id}`;
  const body = [
    `${KINDS[kind] || kind}: ${id}`,
    `Page: ${page.href}`,
    extra ? extra : null,
    S.build ? `Site build: ${S.build}` : null,
    '',
    'What is wrong:',
    '',
    '',
    'What it should say (if you know):',
    '',
  ].filter((x) => x !== null).join('\n');
  return `https://github.com/${S.owner}/${S.repo}/issues/new?` + new URLSearchParams({ title, body }).toString();
}

/** The link element, or null on the local site. */
export function reportLink(kind, id, extra = '') {
  const href = reportUrl(kind, id, extra);
  if (!href) return null;
  return h('a', { class: 'report-link', href, target: '_blank', rel: 'noopener', 'data-t': 'report',
    title: 'Opens a prefilled issue on GitHub in a new tab. Nothing is sent until you submit it there.' }, 'Report a mistake');
}
