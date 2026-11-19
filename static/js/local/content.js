// Public build: the content the server reads from content/ comes from static JSON made by tools/build_public.py.
// data/index.json (curriculum, glossary, a small catalog of items/cards/problems) loads at start; each unit's
// bundle (lessons, full items, cards, problems, recorded outputs) loads the first time a page needs it.
// Answers, solutions, card checks and graders are XOR + base64 in the files ("_s"), so reading them does not spoil
// anything by accident. That is not security: anyone can decode them.

const KEY = new TextEncoder().encode('usaaio-prep: answers are lightly hidden, not secret');

let loader = async (path) => {
  const res = await fetch(new URL('data/' + path, document.baseURI));
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status}). Reload the page.`);
  return res.json();
};
/** Tests (Node) read the files from disk instead of fetching them. */
export function setLoader(fn) { loader = fn; index = null; bundles.clear(); search = null; }

export function decode(s) {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ KEY[i % KEY.length];
  return JSON.parse(new TextDecoder().decode(bytes));
}

let index = null;
const bundles = new Map();

export async function catalog() {
  if (index) return index;
  const raw = await loader('index.json');
  const C = {
    raw, site: raw.site, curriculum: raw.curriculum, released: new Set(raw.released), ready: new Set(raw.ready),
    glossary: raw.glossary, trackOrder: raw.track_order, round1: raw.round1, leitner: raw.leitner,
    quizN: raw.quiz_n, checkN: raw.check_n, r2Order: raw.r2_order || [], summaries: raw.summaries || [],
    placement: raw.placement || [],
    items: new Map(), unitItems: new Map(), cards: new Map(), problems: new Map(),
  };
  for (const [id, unit, lesson, difficulty, type] of raw.items) {
    const it = { id, unit, lesson, difficulty, type };
    C.items.set(id, it);
    if (!C.unitItems.has(unit)) C.unitItems.set(unit, []);
    C.unitItems.get(unit).push(it);
  }
  for (const [id, unit, lesson] of raw.cards) C.cards.set(id, { id, unit, lesson });
  for (const p of raw.problems) {
    C.problems.set(p.id, { id: p.id, unit: p.unit, colab: !!p.colab,
      meta: { title: p.title, minutes: p.minutes, difficulty: p.difficulty, lesson: p.lesson, tags: p.tags, source: p.source } });
  }
  index = C;
  return C;
}

export async function unit(uid) {
  if (!bundles.has(uid)) {
    const C = await catalog();
    if (!C.raw.units_with_bundle.includes(uid)) bundles.set(uid, Promise.resolve(null));
    else {
      const pr = loader(`units/${uid}.json`).then((b) => {
        b.itemById = new Map(b.items.map((it) => [it.id, it]));
        b.cardById = new Map(b.cards.map((c) => [c.id, c]));
        return b;
      });
      pr.catch(() => bundles.delete(uid));   // a failed load can be retried
      bundles.set(uid, pr);
    }
  }
  return bundles.get(uid);
}

const strip = (o) => { const { _s, ...rest } = o; return rest; };

/** Public item (what the server's public_item() returns). */
export async function publicItem(id) {
  const C = await catalog();
  const c = C.items.get(id);
  if (!c) return null;
  const b = await unit(c.unit);
  const it = b && b.itemById.get(id);
  return it ? strip(it) : null;
}
/** Item with answer, solution and why_wrong. */
export async function fullItem(id) {
  const C = await catalog();
  const c = C.items.get(id);
  if (!c) return null;
  const b = await unit(c.unit);
  const it = b && b.itemById.get(id);
  return it ? { ...strip(it), ...decode(it._s) } : null;
}
export async function publicItems(ids) {
  const C = await catalog();
  await Promise.all([...new Set(ids.map((i) => C.items.get(i)?.unit).filter(Boolean))].map(unit));
  return Promise.all(ids.map(publicItem));
}
/** Every item of a unit (public fields), in file order. */
export async function unitItemsPublic(uid) {
  const b = await unit(uid);
  return b ? b.items.map(strip) : [];
}

export async function publicCard(id) {
  const C = await catalog();
  const c = C.cards.get(id);
  if (!c) return null;
  const b = await unit(c.unit);
  const card = b && b.cardById.get(id);
  if (!card) return null;
  const { _s, colab, ...pub } = card;
  return pub;
}
export async function fullCard(id) {
  const C = await catalog();
  const c = C.cards.get(id);
  if (!c) return null;
  const b = await unit(c.unit);
  const card = b && b.cardById.get(id);
  return card ? { ...strip(card), ...decode(card._s) } : null;
}

export async function problem(pid) {
  const C = await catalog();
  const p = C.problems.get(pid);
  if (!p) return null;
  const b = await unit(p.unit);
  const pr = b && b.problems[pid];
  if (!pr) return null;
  return { id: pid, unit: p.unit, meta: pr.meta, statement: pr.statement, starter: pr.starter, colab: !!pr.colab,
    hints: pr.hints || [], secret: () => decode(pr._s) };
}

/** A unit's summary sheet (markdown), or null. */
export async function summary(uid) {
  const b = await unit(uid);
  return (b && b.summary) || null;
}

let search = null;
/** Search entries (data/search.json, made at build time with server.py's make_search_index). */
export async function searchIndex() {
  if (!search) search = loader('search.json').then((x) => x.entries).catch((e) => { search = null; throw e; });
  return search;
}

export async function lessonMarkdown(lid, uid) {
  const b = await unit(uid);
  return b && lid in b.lessons ? b.lessons[lid] : null;
}

/** Recorded output of a try block that needs PyTorch: {result} by the SHA-256 of its code, or null. */
export async function recorded(hash) {
  const C = await catalog();
  const uid = (C.raw.recorded_units || {})[hash];
  if (!uid) return null;
  const b = await unit(uid);
  return b && b.recorded ? b.recorded[hash] ?? null : null;
}
