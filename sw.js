/* Sakura's Hub service worker: makes the site open fast and show a friendly page offline.
 *
 * Deliberately conservative so nobody gets stuck on an old version:
 *   - Pages (navigation): network first. If the network answers within a few seconds that
 *     answer is used (and saved). Only when the network fails or is slow is the saved copy used,
 *     then the offline page.
 *   - Images, icons and fonts under /assets/: saved copy first, refreshed in the background.
 *   - Everything else (the site list, the monitor, Discord, other websites, forms): untouched.
 *
 * To force every visitor onto fresh files after a big change, bump VERSION below.
 */
const VERSION = 'v1';
const STATIC = 'sakura-static-' + VERSION;
const PAGES = 'sakura-pages-' + VERSION;
const NAV_TIMEOUT_MS = 4000;
const MAX_PAGES = 40;
const PRECACHE = ['offline.html', 'assets/fonts/inter-latin.woff2', 'assets/icon-96.png', 'assets/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    // one at a time: a single missing file must not stop the worker from installing
    for (const url of PRECACHE) {
      try { await cache.add(url); } catch (e) { /* ignore */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC, PAGES]);
    for (const name of await caches.keys()) {
      if (name.startsWith('sakura-') && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function handleNavigation(request) {
  const pages = await caches.open(PAGES);
  try {
    const res = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
    // never save redirects or errors: a saved redirect cannot be served to a navigation
    if (res && res.ok && !res.redirected && res.type !== 'opaque') {
      pages.put(request, res.clone()).then(() => trim(pages, MAX_PAGES)).catch(() => {});
    }
    return res;
  } catch (e) {
    const saved = await pages.match(request, { ignoreSearch: true });
    if (saved) return saved;
    const offline = await caches.match('offline.html');
    if (offline) return offline;
    return new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function handleAsset(request) {
  const cache = await caches.open(STATIC);
  const saved = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (saved) return saved;
  const res = await refresh;
  return res || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;                 // other websites and the monitor: untouched
  if (/\/(sw\.js|feed\.xml)$/.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (/\/assets\//.test(url.pathname)) {
    event.respondWith(handleAsset(request));
  }
});
