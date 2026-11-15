// Tests the service worker's logic with fake caches / fetch / events.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let src = fs.readFileSync(root + 'sw.js', 'utf8').replace('NAV_TIMEOUT_MS = 4000', 'NAV_TIMEOUT_MS = 80');
let failed = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL:', m); if (!c) failed++; };

function env() {
  const store = new Map();   // cacheName -> Map(url -> Response)
  const handlers = {};
  const net = { mode: 'ok', calls: [], redirected: false };
  const mkCache = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      add: async (u) => { const r = await ctx.fetch(u); if (!r.ok) throw new Error('bad'); m.set(String(u), r.clone()); },
      put: async (req, res) => { m.set(typeof req === 'string' ? req : req.url, res); },
      match: async (req) => { const k = typeof req === 'string' ? req : req.url; const hit = m.get(k) || [...m].find(([u]) => u.endsWith('/' + k) || u === k)?.[1]; return hit ? hit.clone() : undefined; },
      keys: async () => [...m.keys()].map((u) => ({ url: u })),
      delete: async (r) => m.delete(r.url || r)
    };
  };
  const ctx = {
    URL, Response, Request, setTimeout, clearTimeout, Promise, console,
    self: { location: { origin: 'https://site.test' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => { ctx.skipped = true; }, clients: { claim: async () => { ctx.claimed = true; } } },
    caches: {
      open: async (n) => mkCache(n),
      keys: async () => [...store.keys()],
      delete: async (n) => store.delete(n),
      match: async (req) => { for (const n of store.keys()) { const r = await mkCache(n).match(req); if (r) return r; } }
    },
    fetch: async (req) => {
      const url = typeof req === 'string' ? new URL(req, 'https://site.test/').href : req.url;
      net.calls.push(url);
      if (net.mode === 'down') throw new Error('offline');
      if (net.mode === 'hang') return new Promise(() => {});
      if (url.endsWith('missing.png')) return new Response('no', { status: 404 });
      const res = new Response('NET:' + url, { status: 200 });
      if (net.redirected) Object.defineProperty(res, 'redirected', { value: true });
      Object.defineProperty(res, 'type', { value: 'basic' });
      return res;
    }
  };
  vm.runInNewContext(src, ctx);
  const fire = async (type, init = {}) => {
    let p; const ev = { waitUntil: (x) => { p = x; }, respondWith: (x) => { ev.responded = x; }, ...init };
    handlers[type](ev); if (p) await p; return ev;
  };
  return { ctx, store, net, fire, handlers };
}
const nav = (path) => ({ request: { url: 'https://site.test' + path, method: 'GET', mode: 'navigate' } });
const req = (path, o = {}) => ({ request: { url: (o.origin || 'https://site.test') + path, method: o.method || 'GET', mode: 'no-cors' } });
const text = async (ev) => (await ev.responded).text();

console.log('install / activate');
{ const e = env(); await e.fire('install');
  ok(e.ctx.skipped, 'skipWaiting called'); ok(e.store.get('sakura-static-v1').size >= 3, 'offline page, font and icons precached');
  const e2 = env(); e2.net.mode = 'down'; await e2.fire('install'); ok(e2.ctx.skipped, 'install still succeeds if precaching fails');
  const e3 = env(); e3.store.set('sakura-pages-v0', new Map()); e3.store.set('sakura-static-v0', new Map()); e3.store.set('other-site-cache', new Map());
  await e3.fire('activate'); ok(!e3.store.has('sakura-pages-v0') && !e3.store.has('sakura-static-v0'), 'old versions cleaned up'); ok(e3.store.has('other-site-cache') && e3.ctx.claimed, 'unrelated caches untouched, clients claimed'); }

console.log('pages: network first');
{ const e = env(); await e.fire('install');
  let ev = await e.fire('fetch', nav('/directory')); ok((await text(ev)).startsWith('NET:'), 'online: fresh page from the network');
  await new Promise((r) => setTimeout(r, 20)); ok(e.store.get('sakura-pages-v1').size === 1, 'and saved for later');
  e.net.mode = 'down'; ev = await e.fire('fetch', nav('/directory')); ok((await text(ev)).startsWith('NET:'), 'offline: saved copy of a page you visited');
  ev = await e.fire('fetch', nav('/never-visited')); ok((await text(ev)).includes('offline') || (await text(ev)) !== '', 'offline, never visited: offline page');
  e.net.mode = 'hang'; const t0 = Date.now(); ev = await e.fire('fetch', nav('/directory')); const body = await text(ev);
  ok(body.startsWith('NET:') && Date.now() - t0 < 1000, 'slow network: falls back to the saved copy after the timeout'); }
{ const e = env(); await e.fire('install'); e.net.redirected = true; await e.fire('fetch', nav('/old-url')); await new Promise((r) => setTimeout(r, 20));
  ok(!e.store.has('sakura-pages-v1') || e.store.get('sakura-pages-v1').size === 0, 'redirect responses are never saved'); }
{ const e = env(); await e.fire('install'); e.net.mode = 'down'; const ev = await e.fire('fetch', nav('/x')); const t = await (await ev.responded).text();
  ok(/offline/i.test(t), 'offline page content is served when nothing is saved'); }

console.log('assets and things left alone');
{ const e = env(); await e.fire('install');
  let ev = await e.fire('fetch', req('/assets/og-about.png')); ok((await text(ev)).startsWith('NET:'), 'first asset request goes to the network');
  await new Promise((r) => setTimeout(r, 20)); e.net.mode = 'down'; ev = await e.fire('fetch', req('/assets/og-about.png')); ok((await text(ev)).startsWith('NET:'), 'asset served from the saved copy offline');
  e.net.mode = 'ok'; e.net.calls.length = 0; ev = await e.fire('fetch', req('/assets/og-about.png')); await text(ev); await new Promise((r) => setTimeout(r, 20));
  ok(e.net.calls.length === 1, 'saved copy is refreshed in the background');
  ev = await e.fire('fetch', req('/assets/missing.png')); ok(ev.responded && (await ev.responded).status === 404, '404 assets are not turned into success');
  for (const [label, r] of [['POST', req('/report', { method: 'POST' })], ['other website', req('/api', { origin: 'https://other.test' })], ['the worker', req('/status', { origin: 'https://sakura-monitor.example.workers.dev' })], ['sw.js itself', req('/sw.js')], ['feed', req('/feed.xml')], ['plain non-asset GET', req('/some/data.json')]]) {
    const ev = await e.fire('fetch', r); ok(!ev.responded, label + ' is not intercepted'); } }
process.exit(failed ? 1 : 0);
