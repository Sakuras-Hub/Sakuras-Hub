/**
 * Sakura's Hub — site monitor worker
 *
 * Probes every site in info.json on a rolling cron sweep and serves the
 * status list to the page monitor (scripts/monitor.js). Runs on Cloudflare
 * Workers free tier + Workers KV.
 *
 * Design:
 *  - Cron every minute probes one chunk (CHUNK sites), so a full sweep of
 *    ~840 sites completes in ~22 minutes. Statuses live in ONE KV object
 *    rewritten on each tick (1 read + 1 write per tick — far below free
 *    limits: 100k reads/day, 1k writes/day).
 *  - Each probe is a single GET (headers-only, body never read) -> at most
 *    CHUNK subrequests per invocation, under the free 50/request cap.
 *  - GET /status joins the cached site list with the status map into the
 *    exact payload scripts/monitor.js expects:
 *      { updated: ISO, sites: [{slug,name,url,section,nsfw,status,ms,code,detail}], pending, total }
 *    where status is 'up' | 'down' | 'blocked' | 'unreachable' | 'pending'.
 *
 * KV schema (namespace MONITOR_KV):
 *  - "sites"    = {"ts": <epoch_ms>, "list": [{slug,name,url,section,nsfw}]}
 *  - "statuses" = {"updated": <ISO>, "map": {<url-slug>: {status,ms,code,detail,checkedAt}}}
 *  - "cursor"   = <stringified int index into list>
 *  - "sweeping" = "1" guard flag (TTL so a crashed tick can't wedge the sweep)
 */

const INFO_URL = 'https://raw.githubusercontent.com/Sakuras-Hub/Sakuras-Hub/refs/heads/main/need%20for%20the%20website%20to%20work/info.json';

const CHUNK = 40;                              // sites per cron tick (<= 50-subrequest free cap, 1 GET each)
const CONCURRENCY = 5;                         // parallel probes per tick (<= 8 rounds x ~6s <= 48s < 60s tick)
const PROBE_TIMEOUT_MS = 8000;                 // AbortSignal.timeout per probe (slow sites need headroom)
const LIST_REFRESH_MS = 6 * 60 * 60 * 1000;    // refetch info.json if the cached list is older than 6h
const SWEEP_GUARD_TTL_S = 600;                 // TTL for the "sweeping" guard flag
const KEEP_TTL_S = 7 * 24 * 3600;              // expiry safety net for sites/statuses keys
// Browser-like request headers: a bare bot UA gets 403'd by modern anti-bot (Cloudflare, Akamai, DDoS-Guard).
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

const K = { sites: 'sites', statuses: 'statuses', cursor: 'cursor', sweeping: 'sweeping' };

/** Stable per-site key: normalized URL (host + path). Unique per distinct URL, stable across list reorders. */
export function siteSlug(url) {
  if (!url) return '';
  return String(url)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

/** Classify an HTTP status into the client's 3-state model. */
export function classifyStatus(status, headers) {
  if (status >= 200 && status <= 399) return 'up';
  // Auth/geo walls and Cloudflare challenges read as "blocked" for the user; everything else 4xx/5xx is "down".
  if (status === 401 || status === 403 || status === 451) return 'blocked';
  if (headers && headers.get && headers.get('cf-mitigated')) return 'blocked';
  return 'down';
}

/** One probe attempt with the browser-like headers. */
async function probeOnce(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: HEADERS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    const ms = Math.round(performance.now() - t0);
    if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
    return { status: classifyStatus(res.status, res.headers), ms, code: res.status, detail: 'HTTP ' + res.status };
  } catch (err) {
    const detail = err && err.name ? err.name + (err.message ? ': ' + err.message : '') : String(err);
    return { status: 'unreachable', ms: null, code: null, detail };
  }
}

/** Probe one site; retries once when the first attempt is unreachable (transient timeouts are common). */
async function probeSite(url) {
  const first = await probeOnce(url);
  if (first.status !== 'unreachable') return first;
  const second = await probeOnce(url);
  return second.status === 'up' || second.status === 'down' || second.status === 'blocked' ? second : first;
}

/** Fetch + flatten info.json into the list, cached in KV; falls back to the old list on failure. */
async function ensureSiteList(env) {
  const cached = await env.MONITOR_KV.get(K.sites, 'json');
  if (cached && cached.list && cached.ts && Date.now() - cached.ts < LIST_REFRESH_MS) return cached.list;
  try {
    const res = await fetch(INFO_URL, { headers: HEADERS });
    if (!res.ok) throw new Error('info.json HTTP ' + res.status);
    const raw = await res.json();
    const base = Array.isArray(raw) ? raw : (raw && raw.sites) || [];
    const list = base
      .map((s) => ({
        slug: siteSlug(s.url),
        name: String(s.name || ''),
        url: String(s.url || ''),
        section: String(s.section || ''),
        nsfw: !!s.nsfw
      }))
      .filter((s) => s.url && s.name);
    await env.MONITOR_KV.put(K.sites, JSON.stringify({ ts: Date.now(), list }), { expirationTtl: KEEP_TTL_S });
    return list;
  } catch (err) {
    // Never let a list-fetch failure kill the sweep; keep serving the old list.
    return cached && cached.list ? cached.list : [];
  }
}

/** One cron tick: probe the next chunk of sites, merge into statuses, advance the cursor. */
async function scheduleSweep(env) {
  if (await env.MONITOR_KV.get(K.sweeping)) return; // previous tick still running — skip
  await env.MONITOR_KV.put(K.sweeping, '1', { expirationTtl: SWEEP_GUARD_TTL_S });
  try {
    const list = await ensureSiteList(env);
    if (!list.length) return;

    const cursorRaw = await env.MONITOR_KV.get(K.cursor);
    const cursor = cursorRaw != null ? parseInt(cursorRaw, 10) || 0 : 0;
    const chunk = [];
    for (let i = 0; i < CHUNK && i < list.length; i++) chunk.push(list[(cursor + i) % list.length]);

    const results = [];
    for (let i = 0; i < chunk.length; i += CONCURRENCY) {
      const batch = await Promise.all(chunk.slice(i, i + CONCURRENCY).map((s) => probeSite(s.url)));
      results.push(...batch);
    }

    const prev = (await env.MONITOR_KV.get(K.statuses, 'json')) || { updated: null, map: {} };
    // Prune stale slugs (sites removed from the list) while carrying over the rest.
    const slugs = new Set(list.map((s) => s.slug));
    const map = {};
    Object.keys(prev.map || {}).forEach((k) => {
      if (slugs.has(k)) map[k] = prev.map[k];
    });
    const checkedAt = new Date().toISOString();
    chunk.forEach((site, i) => {
      map[site.slug] = Object.assign({ checkedAt }, results[i]);
    });

    await env.MONITOR_KV.put(K.statuses, JSON.stringify({ updated: checkedAt, map }), { expirationTtl: KEEP_TTL_S });
    await env.MONITOR_KV.put(K.cursor, String((cursor + chunk.length) % list.length));
  } finally {
    await env.MONITOR_KV.delete(K.sweeping).catch(() => {});
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS)
  });
}

async function handleStatus(env) {
  const [sitesRaw, statuses] = await Promise.all([
    env.MONITOR_KV.get(K.sites, 'json'),
    env.MONITOR_KV.get(K.statuses, 'json')
  ]);
  const list = (sitesRaw && sitesRaw.list) || [];
  const map = (statuses && statuses.map) || {};
  const sites = list.map((s) =>
    Object.assign({}, s, map[s.slug] || { status: 'pending', ms: null, code: null, detail: 'waiting for sweep' })
  );
  if (!sites.length) return json({ updated: null, sites: [], error: 'no data yet — cron sweep has not run', pending: 0, total: 0 }, 503);
  const pending = sites.filter((s) => s.status === 'pending').length;
  return json({ updated: (statuses && statuses.updated) || null, sites, pending, total: sites.length });
}

export default {
  async scheduled(event, env) {
    await scheduleSweep(env);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET' && url.pathname === '/status') return handleStatus(env);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Sakura monitor</title><h1>Sakura monitor worker</h1><p>OK — <code>GET /status</code> returns the site-status payload.</p>',
        { status: 200, headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS) }
      );
    }
    return json({ error: 'not found' }, 404);
  }
};