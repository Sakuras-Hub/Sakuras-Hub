// Proves the fast paths really come from the re-check logic: with 2,000 sites a normal
// sweep needs ~200 minutes per pass, so anything faster must be the re-checks.
import worker from '../monitor-worker/worker.js';
const MIN = 60000; let clock = Date.UTC(2026, 10, 13, 3, 0, 0); Date.now = () => clock;
const N = 2000;
const sites = Array.from({ length: N }, (_, i) => ({ url: `https://s${i}.example/`, name: `Site ${i}`, section: 'Misc', nsfw: false }));
const kv = new Map();
const env = { MONITOR_KV: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); }, put: async (k, v) => { kv.set(k, v); } }, DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x' };
const beh = {}; const posts = [];
globalThis.fetch = async (url, opt) => {
  url = String(url);
  if (url.includes('raw.githubusercontent')) return new Response(JSON.stringify(sites));
  if (url.includes('discord.com')) { posts.push(JSON.parse(opt.body)); return new Response(null, { status: 204 }); }
  return beh[new URL(url).hostname] === 'down' ? new Response('x', { status: 503 }) : new Response('ok');
};
const tick = async () => { clock += 2 * MIN; await worker.scheduled({ scheduledTime: clock }, env); };
let failed = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL:', m); if (!c) failed++; };
for (let i = 0; i < 101; i++) await tick();
let st = JSON.parse(kv.get('state'));
ok(Object.values(st.map).filter((e) => e.status === 'up').length === N, 'one full pass: all 2000 sites up');
const victim = (st.cursor - 5 + N) % N; beh[`s${victim}.example`] = 'down';
let t0 = null, n = 0;
while (!posts.length && n < 400) { await tick(); n++; const e = JSON.parse(kv.get('state')).map[`s${victim}.example`]; if (e && e.streak && t0 === null) t0 = clock; }
ok(posts.length === 1, 'a "down" post was sent');
ok((clock - t0) / MIN <= 12, `confirmed ${(clock - t0) / MIN} minutes after the first failed check (a sweep alone would need ~600)`);
beh[`s${victim}.example`] = 'up'; const before = posts.length; const r0 = clock; let k = 0;
while (posts.length === before && k < 400) { await tick(); k++; }
ok((clock - r0) / MIN <= 70, `recovery noticed after ${(clock - r0) / MIN} minutes (a sweep alone: up to 200)`);
process.exit(failed ? 1 : 0);
