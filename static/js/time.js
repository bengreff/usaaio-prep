// Active study time. One second counts when the tab is visible and Ben interacted in the last 2 minutes
// (ui.isActive). Seconds belong to the hash route they were spent on and go to POST /api/time {seconds, route}:
// about every 60 s, on every route change, and when the tab is hidden or closed (fetch keepalive).
// Pages show live totals as (last server value) + pending(route), so an on-screen timer equals what the server
// records once the pending seconds are posted.
import { isActive } from './ui.js';
import { post } from './api.js';

const MAX_POST = 120;   // the server caps one post at 120 s
const EVERY = 60;       // seconds between posts while active

let route = location.hash;
let unsent = 0;         // seconds on `route` not posted yet
const inflight = {};    // route -> seconds posted, no answer yet
let sinceSend = 0;
let paused = false;
const tickFns = new Set();
const savedFns = new Set();

function send(keepalive = false) {
  sinceSend = 0;
  if (unsent <= 0) return Promise.resolve(null);
  const n = Math.min(unsent, MAX_POST);
  const r = route;
  unsent -= n;
  inflight[r] = (inflight[r] || 0) + n;
  return post('time', { seconds: n, route: r }, keepalive ? { keepalive: true } : undefined).then((resp) => {
    inflight[r] -= n;
    for (const fn of savedFns) { try { fn({ route: r, seconds: n, resp }); } catch (e) { /* a page's listener */ } }
    return resp;
  }, () => {
    inflight[r] -= n;
    // server down: keep the seconds for the next post if Ben is still on that page
    if (r === route) unsent = Math.min(unsent + n, MAX_POST);
    return null;
  });
}

function routeChanged() {
  if (location.hash === route) return;
  send();               // posts the old route's seconds under the old route
  route = location.hash;
  paused = false;
}

function tick() {
  routeChanged();       // also catches history.replaceState, which fires no hashchange
  if (!paused && isActive()) unsent += 1;
  if (++sinceSend >= EVERY && unsent > 0) send();
  for (const fn of tickFns) { try { fn(); } catch (e) { /* a page's listener */ } }
}

setInterval(tick, 1000);
// registered when this module loads, before the router's listener, so the old route is flushed first
window.addEventListener('hashchange', routeChanged);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(true); });
window.addEventListener('pagehide', () => send(true));

export const activity = {
  /** The route seconds are currently counted for (location.hash). */
  route: () => route,
  /** Seconds on route r that the server has not confirmed yet (unsent plus in flight). */
  pending(r = route) { return (r === route ? unsent : 0) + Math.max(0, inflight[r] || 0); },
  /** True when the current second would count. */
  counting: () => !paused && isActive(),
  /** Pause counting for the current route (the code lab's Pause button). Leaving the route unpauses. */
  setPaused(v) { paused = !!v; },
  /** Post the pending seconds now; resolves with the server's answer (or null). */
  flush: () => send(),
  /** Called every second after counting. Returns an unsubscribe function. */
  onTick(fn) { tickFns.add(fn); return () => tickFns.delete(fn); },
  /** Called with {route, seconds, resp} after each successful post. Returns an unsubscribe function. */
  onSaved(fn) { savedFns.add(fn); return () => savedFns.delete(fn); },
};

/** "under 1 min", "7 min", "1 h 05 min" */
export function fmtMinutes(sec) {
  if (sec < 60) return 'under 1 min';
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
