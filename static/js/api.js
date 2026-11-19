// Thin wrapper over the local JSON API. Every POST carries X-Study: 1 (the server's CSRF guard).

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const DOWN = 'The study server is not responding. It stops by itself after 2 hours idle: start it again with ~/usaaio/site/start, then reload this page.';

// Public (browser-only) build: index.html sets window.STATIC_MODE and the same calls go to a client-side backend
// (static/js/local/backend.js) that implements API.md in the browser. The local site never loads it.
let localBackend = null;
async function localRequest(path, opts) {
  if (!localBackend) localBackend = await import('./local/backend.js');
  const body = opts.body ? JSON.parse(opts.body) : {};
  const { status, data } = await localBackend.handle(opts.method || 'GET', path, body);
  if (status >= 400) throw new ApiError((data && data.error) || `Error ${status} for ${path.split('?')[0]}.`, status);
  return data;
}

async function request(path, opts = {}) {
  if (window.STATIC_MODE) return localRequest(path, opts);
  let res;
  try {
    res = await fetch('/api/' + path, opts);
  } catch (e) {
    // one retry: a busy local server can drop a connection under a burst of parallel requests
    await new Promise((ok) => setTimeout(ok, 300));
    try { res = await fetch('/api/' + path, opts); } catch (e2) { throw new ApiError(DOWN, 0); }
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `The server answered ${res.status} for ${path.split('?')[0]}.`;
    throw new ApiError(msg, res.status);
  }
  if (data === null) throw new ApiError(`The server sent an unreadable answer for ${path.split('?')[0]}.`, res.status);
  return data;
}

export const get = (path) => request(path, { headers: { Accept: 'application/json' } });

// extra: fetch options such as {keepalive: true} (time posts sent while the tab closes)
export const post = (path, body = {}, extra = {}) => request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Study': '1' },
  body: JSON.stringify(body),
  ...extra,
});

// Download a file the API serves (the Colab notebook): a plain link locally, a generated file in the public build.
export async function download(path, filename) {
  let href = '/api/' + path, blobUrl = null;
  if (window.STATIC_MODE) {
    if (!localBackend) localBackend = await import('./local/backend.js');
    const { status, data } = await localBackend.handle('GET', path, {});
    if (status >= 400) throw new ApiError((data && data.error) || `Error ${status}`, status);
    href = blobUrl = URL.createObjectURL(new Blob([data.text], { type: data.type || 'application/octet-stream' }));
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

// Meta (curriculum + glossary) is needed by many pages; cache it and refresh after changes.
let metaCache = null;
export async function meta(fresh = false) {
  if (!metaCache || fresh) metaCache = await get('meta');
  return metaCache;
}
export function invalidateMeta() { metaCache = null; }

export function lessonInfo(m, lid) {
  for (const u of m.curriculum.units) {
    for (const l of u.lessons) if (l.id === lid) return { ...l, unit: u };
  }
  return null;
}
export function unitInfo(m, uid) {
  return m.curriculum.units.find((u) => u.id === uid) || null;
}
