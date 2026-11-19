// Public build: progress lives in this browser. The state object has exactly the shape of the local site's
// data/progress.json, so an export can be imported here or dropped into the local site, and the local site's
// progress.json can be imported here.
// Storage: IndexedDB (database "usaaio-prep", store "kv"), with a copy in localStorage; if both are blocked,
// memory only (lost on reload). Every save bumps a revision kept in localStorage so other tabs reload first.
import { normalize } from './logic.js';

const DB = 'usaaio-prep', STORE = 'kv', LS_COPY = 'usaaio-prep-progress', LS_REV = 'usaaio-prep-rev';
const MAX_ATTEMPTS = 5000;

let dbp = null, cache = null, cacheRev = -1, chain = Promise.resolve(), persisted = false, mode = null;
let memAttempts = [];

function idb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbp;
}
function idbGet(db, key) {
  return new Promise((resolve) => {
    try {
      const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      rq.onsuccess = () => resolve(rq.result ?? null);
      rq.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
function idbPut(db, key, value) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}
const lsGet = (k) => { try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (typeof localStorage !== 'undefined') { localStorage.setItem(k, v); return true; } } catch (e) { /* quota or blocked */ } return false; };

/** Where progress is kept: "indexeddb", "localstorage" or "memory". */
export async function storageMode() { await load(); return mode; }

async function readStored() {
  const db = await idb();
  const fromDb = db ? await idbGet(db, 'progress') : null;
  let fromLs = null;
  try { fromLs = JSON.parse(lsGet(LS_COPY) || 'null'); } catch (e) { fromLs = null; }
  mode = db ? 'indexeddb' : (typeof localStorage !== 'undefined' && lsSet('usaaio-prep-probe', '1') ? 'localstorage' : 'memory');
  const best = [fromDb, fromLs].filter((x) => x && x.progress).sort((a, b) => (b.rev || 0) - (a.rev || 0))[0];
  return best || null;
}

/** The current progress state (a fresh read if another tab saved since). */
export async function load() {
  const rev = +(lsGet(LS_REV) || 0);
  if (cache && (mode === 'memory' || rev === cacheRev)) return cache;
  const rec = await readStored();
  cache = normalize(rec ? rec.progress : {});
  cacheRev = rec ? Math.max(rec.rev || 0, rev) : rev;
  return cache;
}

async function write(p) {
  cacheRev = Math.max(cacheRev, +(lsGet(LS_REV) || 0)) + 1;
  const rec = { rev: cacheRev, saved: new Date().toISOString(), progress: p };
  lsSet(LS_REV, String(cacheRev));
  const json = JSON.stringify(rec);
  lsSet(LS_COPY, json);                 // synchronous copy: survives a tab closed mid-write
  const db = await idb();
  if (db) await idbPut(db, 'progress', JSON.parse(json));
  if (!persisted && typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    persisted = true;
    navigator.storage.persist().catch(() => {});
  }
}

/** Run fn(progress) and save, one update at a time (the server's LOCK). Resolves with fn's return value. */
export function update(fn) {
  const run = chain.then(async () => {
    const p = await load();
    const out = await fn(p);
    await write(p);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

/** Record one attempt (the server's attempts.jsonl), newest last, capped. */
export async function logAttempt(rec) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  rec.t = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const db = await idb();
  if (!db) { memAttempts.push(rec); memAttempts = memAttempts.slice(-MAX_ATTEMPTS); return; }
  const cur = (await idbGet(db, 'attempts')) || [];
  cur.push(rec);
  await idbPut(db, 'attempts', cur.slice(-MAX_ATTEMPTS));
}
export async function attempts() {
  const db = await idb();
  return db ? (await idbGet(db, 'attempts')) || [] : memAttempts.slice();
}

/** The progress file (JSON text), the same shape as the local site's data/progress.json. */
export async function exportText() {
  await chain;
  return JSON.stringify(await load(), null, 1);
}

/** Check and normalize an uploaded progress file. Returns {progress, summary} or throws a readable Error. */
export function parseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('That file is not JSON. Choose a progress file exported from this site, or data/progress.json from the local site.'); }
  if (obj && obj.progress && typeof obj.progress === 'object' && 'rev' in obj) obj = obj.progress;   // a raw storage record
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('That file does not look like a progress file.');
  const known = ['lessons', 'items', 'cards', 'problems', 'mocks', 'time', 'activity', 'settings'];
  if (!known.some((k) => k in obj)) throw new Error('That file has none of the progress sections (lessons, items, cards, problems, mocks, time).');
  for (const k of known) {
    if (k in obj && (typeof obj[k] !== 'object' || obj[k] === null || Array.isArray(obj[k]))) throw new Error(`The "${k}" section of that file is not valid.`);
  }
  const p = normalize(obj);
  const n = (o) => Object.keys(o).length;
  const pl = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const summary = `${pl(Object.values(p.lessons).filter((r) => r && r.done).length, 'lesson')} done, ${pl(n(p.items), 'question')} answered, ${pl(n(p.cards), 'card')} seen, ${pl(n(p.problems), 'problem')} tried, ${n(p.mocks)} mocks and quizzes, ${pl(n(p.time), 'day')} of study time`;
  return { progress: p, summary };
}

/** Replace all progress with an imported state. */
export function replaceAll(p) {
  return update((cur) => {
    for (const k of Object.keys(cur)) delete cur[k];
    Object.assign(cur, normalize(JSON.parse(JSON.stringify(p))));
  });
}

/** Tests: start from a given state in memory. */
export function _setForTest(p) { cache = normalize(p); cacheRev = Infinity; mode = 'memory'; }
