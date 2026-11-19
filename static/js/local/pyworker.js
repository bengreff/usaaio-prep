// Public build: the Python worker. Loads Pyodide from the pinned jsDelivr URL on the first job, writes the harness
// files and runner.py into its file system, then runs one job at a time and posts the JSON result back.
// The page (py.js) enforces time limits by terminating this worker; it posts progress events so the page knows
// which grader test is running.
/* global loadPyodide */
let pyodide = null;
let runner = null;
let current = null;
let dataURL = '';
const unitFiles = new Map();   // uid -> promise: the unit's data files, fetched once into /usaaio/data/<uid>/

function post(msg) { self.postMessage(msg); }
self.usaaioEmit = (s) => { if (current !== null) post({ id: current, type: 'event', data: JSON.parse(s) }); };

async function init(cfg) {
  post({ type: 'status', text: 'loading' });
  importScripts(cfg.indexURL + 'pyodide.js');
  pyodide = await loadPyodide({ indexURL: cfg.indexURL, stdout: () => {}, stderr: () => {} });
  dataURL = cfg.dataURL || '';
  pyodide.FS.mkdirTree('/usaaio/py');
  for (const [name, src] of Object.entries(cfg.files)) pyodide.FS.writeFile('/usaaio/py/' + name, src);
  pyodide.runPython('import sys\nsys.path.insert(0, "/usaaio/py")');
  // the harness imports numpy at module level
  await pyodide.loadPackage(['numpy'], { messageCallback: () => {}, errorCallback: () => {} });
  runner = pyodide.pyimport('runner');
  post({ type: 'status', text: 'ready' });
}

// A lesson's data files (the bundle's "files", served from data/units/<uid>/files/): fetched once per worker and
// kept in /usaaio/data/<uid>/; runner.py copies them into a fresh working folder for each run.
function loadUnitFiles(uid, list) {
  if (!unitFiles.has(uid)) {
    const pr = Promise.all(list.map(async (rel) => {
      const url = dataURL + encodeURIComponent(uid) + '/files/' + rel.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`could not load the lesson's data file ${rel} (${res.status})`);
      const path = `/usaaio/data/${uid}/${rel}`;
      pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      pyodide.FS.writeFile(path, new Uint8Array(await res.arrayBuffer()));
    }));
    pr.catch(() => unitFiles.delete(uid));   // a failed load is retried on the next run
    unitFiles.set(uid, pr);
  }
  return unitFiles.get(uid);
}

let initDone = null;
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    initDone = init(msg.cfg).catch((err) => { post({ type: 'fatal', error: String(err && err.message ? err.message : err) }); throw err; });
    return;
  }
  if (msg.type !== 'job') return;
  try { await initDone; } catch (err) { post({ id: msg.id, type: 'result', error: 'python-load-failed' }); return; }
  current = msg.id;
  try {
    const p = msg.payload;
    const src = [p.code, p.setup, p.check, p.grader, p.help ? 'import numpy' : '', p.help && /^(pd\.|pandas)/.test(p.help) ? 'import pandas' : ''].filter(Boolean).join('\n');
    const loaded = [];
    await pyodide.loadPackagesFromImports(src, { messageCallback: (m) => { if (/^Loading /.test(m)) loaded.push(m); post({ id: msg.id, type: 'packages', text: m }); }, errorCallback: () => {} });
    if (p.unit && p.files && p.files.length) await loadUnitFiles(p.unit, p.files);
    post({ id: msg.id, type: 'started' });
    let out;
    if (msg.kind === 'grade') out = runner.run_grade(JSON.stringify(p), self.usaaioEmit);
    else out = runner.run_snippet(JSON.stringify(p));
    post({ id: msg.id, type: 'result', result: JSON.parse(out) });
  } catch (err) {
    post({ id: msg.id, type: 'result', result: { ok: false, stdout: '', images: [], result_repr: null, static: [], tests: [],
      error: 'Python runner error: ' + String(err && err.message ? err.message : err).split('\n').slice(-3).join(' ') } });
  } finally {
    current = null;
  }
};
