// Public build: registers the service worker (sw.js, made by the build) so the course works offline after a first
// visit. When a new build ships, the new worker waits; this shows a bar to reload into it (never a surprise reload,
// which could interrupt a quiz).
import { h } from '../ui.js';

let wantReload = false;

function offer(worker) {
  if (document.getElementById('sw-update')) return;
  const bar = h('div', { class: 'sw-update', id: 'sw-update', role: 'status', 'data-t': 'sw-update' },
    h('span', null, 'A new version of the course is ready.'),
    h('button', { class: 'btn small primary', type: 'button', 'data-t': 'sw-reload', onclick: () => { wantReload = true; worker.postMessage('skipWaiting'); } }, 'Reload'),
    h('button', { class: 'btn small ghost', type: 'button', onclick: () => bar.remove() }, 'Later'));
  document.body.append(bar);
}

export async function register() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return null;
  const reg = await navigator.serviceWorker.register('sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload) location.reload(); });
  // a waiting worker with a page already controlled = a new build is ready
  const check = () => { if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting); };
  const watch = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'installed') check(); });
  check();
  watch(reg.installing);
  reg.addEventListener('updatefound', () => { watch(reg.installing); setTimeout(check, 4000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().then(check, check); });
  window.__swReg = reg;   // tests: window.__swReg.update()
  return reg;
}
