// Markdown + KaTeX + glossary terms, and the lesson directive parser.
// Math and [[terms]] are swapped for private-use placeholders before marked sees the text (so `_` and `\\`
// survive), code spans and fences are left untouched, then placeholders are restored as rendered HTML.
import { esc } from './ui.js';

const O = '', C = '';
const MACROS = {
  '\\R': '\\mathbb{R}', '\\E': '\\mathbb{E}', '\\Var': '\\operatorname{Var}', '\\Cov': '\\operatorname{Cov}',
  '\\argmin': '\\operatorname*{arg\\,min}', '\\argmax': '\\operatorname*{arg\\,max}',
};

marked.use({ gfm: true, breaks: false });

let glossary = {};
export function setGlossary(g) { glossary = g || {}; }
export function glossaryEntry(term) { return glossary[String(term).toLowerCase().trim()] || null; }

export function tex(src, display) {
  try {
    return katex.renderToString(src, { displayMode: !!display, throwOnError: false, strict: 'ignore', macros: { ...MACROS } });
  } catch (e) {
    return `<code class="math-error" title="${esc(e.message)}">${esc(src)}</code>`;
  }
}

// Split into [{code: bool, text}] so math/glossary processing skips fenced blocks and inline code.
function splitCode(src) {
  const segs = [];
  const lines = src.split('\n');
  let buf = '', fence = null;
  const push = (code) => { if (buf) segs.push({ code, text: buf }); buf = ''; };
  lines.forEach((line, k) => {
    const piece = line + (k < lines.length - 1 ? '\n' : '');
    const t = line.trim();
    if (fence) {
      buf += piece;
      if (t.startsWith(fence) && /^(`{3,}|~{3,})$/.test(t)) { fence = null; push(true); }
      return;
    }
    const m = t.match(/^(`{3,}|~{3,})/);
    if (m) { push(false); fence = m[1]; buf += piece; return; }
    buf += piece;
  });
  push(!!fence);
  // inline code spans inside the prose segments
  const out = [];
  for (const s of segs) {
    if (s.code) { out.push(s); continue; }
    const re = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
    let last = 0, m;
    while ((m = re.exec(s.text))) {
      if (m.index > last) out.push({ code: false, text: s.text.slice(last, m.index) });
      out.push({ code: true, text: m[0] });
      last = m.index + m[0].length;
    }
    if (last < s.text.length) out.push({ code: false, text: s.text.slice(last) });
  }
  return out;
}

function protect(src, store) {
  const ph = (v) => { store.push(v); return O + (store.length - 1) + C; };
  return splitCode(src).map((seg, i, arr) => {
    if (seg.code) return seg.text;
    let t = seg.text;
    t = t.replace(/\\\$/g, () => ph({ raw: '$' }));
    t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => ph({ tex: x, display: true }));
    t = t.replace(/\$(?!\s)((?:\\.|[^\\$\n]|\n(?!\s*\n))+?)\$(?!\d)/g, (m, x) => (/\s$/.test(x) ? m : ph({ tex: x, display: false })));
    t = t.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g, (_, term, shown) => ph({ gloss: term.trim(), shown: shown ?? term }));
    return t;
  }).join('');
}

function restore(html, store) {
  html = html.replace(new RegExp(`<p>${O}(\\d+)${C}</p>`, 'g'), (m, i) => {
    const v = store[+i];
    return v && v.display ? `<div class="math-block">${tex(v.tex, true)}</div>` : m;
  });
  return html.replace(new RegExp(`${O}(\\d+)${C}`, 'g'), (_, i) => {
    const v = store[+i];
    if (!v) return '';
    if (v.raw) return esc(v.raw);
    if (v.tex !== undefined) return tex(v.tex, v.display);
    if (v.gloss) {
      const entry = glossaryEntry(v.gloss);
      const shown = renderInline(v.shown);
      return entry
        ? `<span class="gloss" tabindex="0" data-term="${esc(v.gloss.toLowerCase())}">${shown}</span>`
        : `<span class="gloss-missing" title="Not in the glossary yet">${shown}</span>`;
    }
    return '';
  });
}

export function renderMarkdown(src) {
  const store = [];
  return restore(marked.parse(protect(String(src ?? ''), store)), store);
}

export function renderInline(src) {
  const store = [];
  return restore(marked.parseInline(protect(String(src ?? ''), store)), store);
}

// Python highlighting for static code blocks, using CodeMirror's own python mode (same colors as the editor).
export function highlightPython(text) {
  if (!window.CodeMirror || !CodeMirror.getMode) return esc(text);
  const mode = CodeMirror.getMode({ indentUnit: 4 }, 'python');
  const state = CodeMirror.startState(mode);
  let html = '';
  text.split('\n').forEach((line, li) => {
    if (li) html += '\n';
    if (!line && mode.blankLine) mode.blankLine(state);
    const stream = new CodeMirror.StringStream(line, 4);
    let guard = 0;
    while (!stream.eol() && guard++ < 2000) {
      const style = mode.token(stream, state);
      const tok = stream.current();
      if (!tok) { stream.next(); html += esc(stream.current()); stream.start = stream.pos; continue; }
      html += style ? `<span class="${style.split(' ').map((s) => 'cm-' + s).join(' ')}">${esc(tok)}</span>` : esc(tok);
      stream.start = stream.pos;
    }
  });
  return html;
}

// After inserting rendered HTML: highlight code, wrap tables, open external links in a new tab.
export function enhance(root) {
  for (const code of root.querySelectorAll('pre > code')) {
    const pre = code.parentElement;
    pre.classList.add('code-block', 'cm-s-study');
    const lang = (code.className.match(/language-(\w+)/) || [])[1];
    if (!lang || lang === 'python' || lang === 'py') code.innerHTML = highlightPython(code.textContent.replace(/\n$/, ''));
  }
  for (const t of root.querySelectorAll('table')) {
    if (t.parentElement.classList.contains('table-wrap')) continue;
    const w = document.createElement('div');
    w.className = 'table-wrap';
    t.replaceWith(w);
    w.appendChild(t);
  }
  for (const a of root.querySelectorAll('a[href^="http"]')) { a.target = '_blank'; a.rel = 'noopener'; }
  for (const a of root.querySelectorAll('a[href^="data/units/"]')) a.download = '';   // public build: a lesson's data files
  return root;
}

export function mdBlock(src, cls = 'prose') {
  const div = document.createElement('div');
  div.className = cls;
  div.innerHTML = renderMarkdown(src);
  return enhance(div);
}

export function mdInline(src, tag = 'span', cls = '') {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.innerHTML = renderInline(src);
  return el;
}

// ---------------------------------------------------------------- lesson dialect
const SINGLE = new Set(['check', 'widget']);

function dedent(text) {
  const lines = text.split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return isFinite(ind) && ind > 0 ? lines.map((l) => l.slice(ind)).join('\n') : text;
}

// -> [{type:'md', text} | {type:'try', code} | {type:'check', ids} | {type:'widget', name, params, err}
//     | {type:'callout', kind, title, children}]
export function parseLesson(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  function parse(top) {
    const nodes = [];
    let buf = [], fence = null, joinNext = false;
    const addMd = (t, join) => { const last = nodes[nodes.length - 1]; if (join && last && last.type === 'md') last.text += '\n' + t; else nodes.push({ type: 'md', text: t }); };
    const flush = () => {
      const t = buf.join('\n'), last = nodes[nodes.length - 1];
      if (joinNext && buf.length && last && last.type === 'md') last.text += '\n' + t;   // keeps blank lines too
      else if (t.trim()) nodes.push({ type: 'md', text: t });
      buf = []; joinNext = false;
    };
    while (i < lines.length) {
      const line = lines[i], t = line.trim();
      if (fence) {
        buf.push(line); i++;
        if (t.startsWith(fence) && /^(`{3,}|~{3,})$/.test(t)) fence = null;
        continue;
      }
      const fm = t.match(/^(`{3,}|~{3,})/);
      if (fm) { fence = fm[1]; buf.push(line); i++; continue; }
      if (t === ':::') {
        i++;
        if (!top) { flush(); return nodes; }
        continue; // stray closer at top level
      }
      const m = t.match(/^:::(\w+)\s*(.*)$/);
      if (!m) { buf.push(line); i++; continue; }
      flush();
      i++;
      const kind = m[1].toLowerCase(), arg = m[2].trim();
      if (kind === 'try') {
        const code = [];
        while (i < lines.length && lines[i].trim() !== ':::') code.push(lines[i++]);
        i++;
        nodes.push({ type: 'try', code: dedent(code.join('\n')).replace(/\s+$/, '') });
      } else if (kind === 'check') {
        nodes.push({ type: 'check', ids: arg.split(/\s+/).filter(Boolean) });
      } else if (kind === 'widget') {
        const name = (arg.split(/\s+/)[0] || '').toLowerCase();
        const rest = arg.slice(name.length).trim();
        let params = {}, err = null;
        try { params = rest ? JSON.parse(rest) : {}; } catch (e) { err = 'widget parameters are not valid JSON'; }
        nodes.push({ type: 'widget', name, params, err });
      } else if (kind === 'local' || kind === 'public') {
        // :::local ... ::: shows only on the local site, :::public ... ::: only in the public build (which unwraps
        // or drops these blocks at build time anyway)
        // The text inside and around joins into one flow, as in the build's unwrapping (no paragraph break, one list).
        const kids = parse(false);
        if ((kind === 'public') === !!window.STATIC_MODE) for (const k of kids) { if (k.type === 'md') addMd(k.text, true); else nodes.push(k); }
        joinNext = true;
      } else if (!SINGLE.has(kind)) {
        nodes.push({ type: 'callout', kind, title: arg, children: parse(false) });
      }
    }
    flush();
    return nodes;
  }
  return parse(true);
}
