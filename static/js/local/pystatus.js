// Public build: a status note while Python loads or runs in the browser, with a Stop button. Reuses the toast
// styles from app.css (bottom of the page).
import { onStatus, stop } from './py.js';

let el = null, shownAt = 0, hideTimer = null;

function ensure() {
  if (el) return el;
  const box = document.getElementById('toasts');
  el = document.createElement('div');
  el.className = 'toast toast-info';
  el.setAttribute('role', 'status');
  el.dataset.t = 'py-status';
  el.innerHTML = '<span class="py-text"></span> <button type="button" class="btn small" data-t="py-stop">Stop</button>';
  el.querySelector('button').addEventListener('click', () => stop());
  box.appendChild(el);
  return el;
}

const TEXT = {
  loading: 'Loading Python in your browser. The first run downloads about 30 MB from cdn.jsdelivr.net; after that it is cached.',
  running: 'Running Python in your browser',
};

onStatus((s) => {
  clearTimeout(hideTimer);
  if (s.state === 'idle' || s.state === 'error') {
    if (el) {
      const left = Math.max(0, 400 - (Date.now() - shownAt));
      hideTimer = setTimeout(() => { if (el) { el.remove(); el = null; } }, left);
    }
    return;
  }
  const e = ensure();
  shownAt = shownAt && e.isConnected ? shownAt : Date.now();
  let text = TEXT[s.state] || s.text || '';
  if (s.state === 'packages' && s.text) text = s.text.replace(/^Loading /, 'Loading Python packages: ').replace(/^Loaded /, 'Loaded ');
  if (s.state === 'running' && s.text) text = `${s.text} in your browser`;
  e.querySelector('.py-text').textContent = text;
});
