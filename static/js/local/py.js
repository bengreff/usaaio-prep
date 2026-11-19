// Public build: runs Python in a Web Worker with Pyodide (pinned in window.STATIC_MODE.pyodide). Nothing loads
// until the first job. Jobs run one at a time. There is no way to interrupt WebAssembly Python from outside
// without SharedArrayBuffer (GitHub Pages cannot send the headers it needs), so Stop and every time limit terminate
// the worker; the next job starts a new one (the browser has cached Pyodide by then).

const listeners = new Set();
/** Status for the page: {state: 'loading'|'packages'|'running'|'idle'|'error', text, job} */
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function status(s) { for (const fn of listeners) { try { fn(s); } catch (e) { /* listener */ } } }

let worker = null, seq = 0, queue = Promise.resolve(), active = null, loadedOnce = false;
const pyFiles = {};

async function files() {
  if (pyFiles['runner.py']) return pyFiles;
  const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`could not load ${url}`); return r.text(); };
  const base = new URL('py/', document.baseURI);
  const [g, hs, sn, rn] = await Promise.all([get(new URL('grade.py', base)), get(new URL('harness.py', base)),
    get(new URL('snippet.py', base)), get(new URL('./runner.py', import.meta.url))]);
  Object.assign(pyFiles, { 'grade.py': g, 'harness.py': hs, 'snippet.py': sn, 'runner.py': rn });
  return pyFiles;
}

async function ensureWorker() {
  if (worker) return worker;
  const cfg = window.STATIC_MODE.pyodide;
  const w = new Worker(new URL('./pyworker.js', import.meta.url));
  w.postMessage({ type: 'init', cfg: { indexURL: cfg.indexURL, files: await files(), dataURL: new URL('data/units/', document.baseURI).href } });
  worker = w;
  return w;
}

function kill() {
  if (worker) { worker.terminate(); worker = null; }
}

/** Stop the running job (the Stop button). */
export function stop() {
  if (active) active.stop('Stopped. Python restarts on the next run.');
}
export const busy = () => !!active;

/**
 * Run a job. kind: 'snippet' | 'grade'. payload as runner.py expects.
 * opts.limit: seconds of running time (after loading) before the worker is stopped;
 * opts.testLimit: seconds per grader test (grade jobs); opts.onEvent(ev) for grader progress.
 * Resolves with the runner's JSON, or {timedOut|stopped|loadFailed: true, error, events} when cut short.
 */
export function run(kind, payload, opts = {}) {
  const job = queue.then(() => runNow(kind, payload, opts));
  queue = job.catch(() => {});
  return job;
}

function runNow(kind, payload, opts) {
  return new Promise((resolve) => {
    const id = ++seq;
    const events = [];
    let timer = null, done = false, phase = 'loading', w = null;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (w) { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); }
      active = null;
      status({ state: 'idle' });
      resolve(val);
    };
    const cut = (why, extra = {}) => { kill(); finish({ ...extra, events, error: why }); };
    active = { stop: (why) => cut(why, { stopped: true }) };
    const arm = (secs, why, extra) => { clearTimeout(timer); timer = setTimeout(() => cut(why, extra), secs * 1000); };
    function onErr(e) { cut(loadError(e.message), { loadFailed: true }); }
    function onMsg(e) {
      const m = e.data;
      if (m.type === 'fatal') { cut(loadError(m.error), { loadFailed: true }); return; }
      if (m.type === 'status' && m.text === 'ready') { loadedOnce = true; return; }
      if (m.id !== id) return;
      if (m.type === 'packages') { status({ state: 'packages', text: m.text }); return; }
      if (m.type === 'started') {
        phase = 'running';
        clearTimeout(timer);
        status({ state: 'running', text: kind === 'grade' ? 'Grading' : 'Running' });
        if (opts.limit) arm(opts.limit, `stopped after ${opts.limit} s (infinite loop?)`, { timedOut: true });
        return;
      }
      if (m.type === 'event') {
        events.push(m.data);
        if (opts.onEvent) opts.onEvent(m.data);
        if (opts.testLimit && (m.data.ev === 'test' || m.data.ev === 'import')) {
          arm(opts.testLimit, m.data.ev === 'import' ? 'import' : 'test', { timedOut: true, during: m.data });
        } else if (opts.testLimit && m.data.ev === 'done') clearTimeout(timer);
        return;
      }
      if (m.type === 'result') {
        if (m.error === 'python-load-failed') { cut(loadError(), { loadFailed: true }); return; }
        finish(m.result);
      }
    }
    status({ state: loadedOnce && worker ? 'running' : 'loading', text: loadedOnce && worker ? 'Running' : 'Loading Python' });
    ensureWorker().then((wk) => {
      if (done) return;
      w = wk;
      w.addEventListener('message', onMsg);
      w.addEventListener('error', onErr);
      // loading Pyodide and packages gets a generous limit of its own (a slow connection on the first run)
      arm(180, loadError('it took longer than 3 minutes'), { loadFailed: true });
      w.postMessage({ type: 'job', id, kind, payload });
    }, (e) => cut(loadError(e.message), { loadFailed: true }));
  });
}

function loadError(detail) {
  const v = window.STATIC_MODE?.pyodide?.version || '';
  return `Python (Pyodide ${v}) could not be loaded from cdn.jsdelivr.net${detail ? ` (${detail})` : ''}. Python runs in your browser and downloads about 30 MB the first time; check your connection and try again.`;
}
