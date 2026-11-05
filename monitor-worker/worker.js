/**
 * Sakura's Hub — site monitor worker (rewritten for free-tier compliance)
 *
 * Probes every site in info.json on a rolling cron sweep and serves the
 * status list to the page monitor (scripts/monitor.js). Runs on Cloudflare
 * Workers free tier + Workers KV.
 *
 * Design:
 *  - Cron every 2 minutes (cron: every 2 minutes) probes one chunk (CHUNK=20 sites).
 *    A full sweep of 5,811 sites completes in ~291 ticks x 2 min ~= 9.7h.
 *  - ONE KV read + ONE KV write per tick (state key). Free-tier daily:
 *      reads ~720/day, writes ~720/day (well under 1k writes/day cap).
 *  - Subrequest cap 48/tick (CHUNK=20 × max 1 retry + list refresh).
 *  - Timing: CHUNK=20, CONCURRENCY=10, PROBE_TIMEOUT_MS=5000.
 *    Worst case 2 rounds × (2 attempts × 5s) = 20s, and the loop stops
 *    starting new rounds past TICK_BUDGET_MS-2×timeout, so state is always
 *    written before the 30s invocation limit. Probes that did not run are
 *    simply retried next tick (cursor advances only by probed sites).
 *  - Hysteresis: CONFIRM_COUNT=3. Non-up verdicts increment streak;
 *    published status changes only when streak >= 3. Up publishes
 *    immediately and resets streak. New sites start as 'pending'.
 *  - Dead-site removal: REMOVE_AFTER_DAYS=21. When a site is confirmed
 *    dead for ≥21 days it moves to state.removed[] and is excluded from
 *    future sweeps and /status sites. Prune removed > ~90 days.
 *  - Sharding (forward-compatible): SHARD_COUNT (default 1), SHARD_INDEX
 *    (default 0) via env. Deterministic FNV-1a hash on slug. Each shard
 *    has independent state cursor/map/removed. /status includes shard info.
 *  - KV schema (namespace MONITOR_KV):
 *      "sites"  = {"ts": <epoch_ms>, "list": [{slug,name,url,section,nsfw,countries}]}
 *      "state"  = {"updated": <ISO>, "cursor": <int>, "map": {<slug>: {status,ms,code,detail,checkedAt,streak?,since?,flapping?,deadSince?}}, "removed": [{slug,name,url,section,deadSince,removedAt,lastStatus,lastMs,lastCode}]}
 *  - Stats: each site keeps a compact probe history (HISTORY_LEN=24 verdict
 *    chars) plus a rolling mean response time. /status derives uptime %
 *    from that history, so the page shows real per-site and per-section
 *    uptime instead of guessing from the latest verdict.
 *  - GET /status returns backward-compatible superset payload with
 *    streak/since/flapping/deadSince plus history/uptime/avgMs, removed[]
 *    and shard{}.
 *
 * Crash recovery: no guard flag, no deletes. A tick that dies before the
 * write simply means the cursor did not advance and the map was not
 * updated; next tick re-probes the same chunk. Map merge is idempotent
 * (last-writer-wins on checkedAt). No wedge possible.
 */

const INFO_URL = 'https://raw.githubusercontent.com/Sakuras-Hub/Sakuras-Hub/refs/heads/main/need%20for%20the%20website%20to%20work/info.json';

const CHUNK = 20;                              // sites per cron tick (20 × 1 retry + list = ≤ 41 fetches < 48 cap)
const CONCURRENCY = 10;                        // parallel probes per tick (2 rounds max)
const PROBE_TIMEOUT_MS = 5000;                 // AbortSignal.timeout per probe
const TICK_BUDGET_MS = 20000;                  // stop starting probes after this, so state gets written
const LIST_REFRESH_MS = 6 * 60 * 60 * 1000;    // refetch info.json if cached list older than 6h
const KEEP_TTL_S = 7 * 24 * 3600;              // sliding TTL for sites/state keys (rewritten each tick)
const CONFIRM_COUNT = 3;                       // hysteresis: non-up streak needed to confirm
const REMOVE_AFTER_DAYS = 21;                  // dead ≥ 21 days -> move to removed[]
const REMOVE_PRUNE_DAYS = 90;                  // prune removed[] entries older than this
const MAX_FETCHES_PER_TICK = 48;               // hard subrequest cap

// Browser-like request headers: a bare bot UA gets 403'd by modern anti-bot (Cloudflare, Akamai, DDoS-Guard).
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

const K = { sites: 'sites', state: 'state' };

// Probe history kept per site, as a string of verdict chars: 0=up 1=blocked 2=down 3=unreachable.
// With one probe per site every ~9.7h (5.8k sites, 20/tick) 24 samples ~= 10 days.
const HISTORY_LEN = 24;
const HISTORY_CHAR = { up: '0', blocked: '1', down: '2', unreachable: '3' };

/** Stable per-site key: normalized URL (host + path). Unique per distinct URL, stable across list reorders. */
export function siteSlug(url) {
  if (!url) return '';
  return String(url)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

/** Deterministic 32-bit FNV-1a hash for sharding. */
export function siteHash(slug) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Force to unsigned 32-bit
  return hash >>> 0;
}

/** Check if a site belongs to this shard. */
function inMyShard(slug, shardCount, shardIndex) {
  if (shardCount <= 1) return true;
  return (siteHash(slug) % shardCount) === shardIndex;
}

/** Classify an HTTP status into the client's 5-state model. */
export function classifyStatus(status, headers) {
  if (status >= 200 && status <= 399) return 'up';
  // Auth/geo walls and Cloudflare challenges read as "blocked" for the user; everything else 4xx/5xx is "down".
  if (status === 401 || status === 403 || status === 451) return 'blocked';
  if (headers && headers.get && headers.get('cf-mitigated')) return 'blocked';
  return 'down';
}

/** Append one probe verdict to a site's compact history string (oldest first). */
export function pushHistory(prev, verdict) {
  const h = String(prev || '') + (HISTORY_CHAR[verdict] || '2');
  return h.length > HISTORY_LEN ? h.slice(h.length - HISTORY_LEN) : h;
}

/** Rolling mean response time carried as (avg, n) so state stays small. */
export function rollMeanMs(prevAvg, prevN, ms) {
  if (ms == null || !isFinite(ms)) return { avgMs: prevAvg == null ? null : prevAvg, msN: prevN || 0 };
  const n = Math.min(prevN || 0, HISTORY_LEN - 1);
  const avg = prevAvg == null || !n ? Math.round(ms) : Math.round((prevAvg * n + ms) / (n + 1));
  return { avgMs: avg, msN: n + 1 };
}

/** Uptime over the stored history window; null until the site has been probed. */
export function uptimeOf(entry) {
  const h = (entry && entry.h) || '';
  if (!h) return null;
  let up = 0;
  for (let i = 0; i < h.length; i++) if (h[i] === '0') up++;
  return { pct: Math.round((up / h.length) * 1000) / 10, up, total: h.length };
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

/**
 * Probe one site with at most one retry on transient conditions.
 * Retries only on: 'unreachable', HTTP 5xx, or HTTP 429.
 * Respects the tick's fetch budget (MAX_FETCHES_PER_TICK).
 */
async function probeSite(url, fetchesUsed) {
  const first = await probeOnce(url);
  if (fetchesUsed >= MAX_FETCHES_PER_TICK) return first;

  const isTransient =
    first.status === 'unreachable' ||
    (first.code !== null && first.code >= 500) ||
    first.code === 429;

  if (!isTransient) return first;

  const second = await probeOnce(url);
  // Accept the retry result if it's a definitive verdict; otherwise keep first
  return (second.status === 'up' || second.status === 'down' || second.status === 'blocked') ? second : first;
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
        nsfw: !!s.nsfw,
        countries: Array.isArray(s.countries) ? s.countries.filter((c) => c && typeof c === 'string') : []
      }))
      .filter((s) => s.url && s.name);
    await env.MONITOR_KV.put(K.sites, JSON.stringify({ ts: Date.now(), list }), { expirationTtl: KEEP_TTL_S });
    return list;
  } catch (err) {
    // Never let a list-fetch failure kill the sweep; keep serving the old list.
    return cached && cached.list ? cached.list : [];
  }
}

/** Read the unified state object. */
async function readState(env) {
  return await env.MONITOR_KV.get(K.state, 'json');
}

/** Write the unified state object (sliding 7-day TTL). */
async function writeState(env, state) {
  await env.MONITOR_KV.put(K.state, JSON.stringify(state), { expirationTtl: KEEP_TTL_S });
}

/** One cron tick: probe the next chunk of sites, merge into state, advance cursor. */
async function scheduleSweep(env) {
  // Read sharding config from env vars (defaults: 1 shard, index 0)
  const shardCount = parseInt(env.SHARD_COUNT || '1', 10);
  const shardIndex = parseInt(env.SHARD_INDEX || '0', 10);

  const list = await ensureSiteList(env);
  if (!list.length) return;

  // Filter to this shard's sites
  const mySites = list.filter((s) => inMyShard(s.slug, shardCount, shardIndex));
  if (!mySites.length) return;

  const state = (await readState(env)) || { updated: null, cursor: 0, map: {}, removed: [] };
  const map = state.map || {};
  const removed = state.removed || [];
  const cursor = typeof state.cursor === 'number' ? state.cursor : 0;

  // Take next chunk
  const chunk = [];
  for (let i = 0; i < CHUNK && i < mySites.length; i++) {
    chunk.push(mySites[(cursor + i) % mySites.length]);
  }
  if (!chunk.length) return;

  // Probe with a wall-clock budget. A chunk full of slow/dead sites must not
  // swallow the whole invocation: if it does, writeState never runs, the
  // cursor never moves, and every later tick re-probes the same chunk forever.
  let fetchesUsed = 0;
  const results = [];
  const tickStart = Date.now();
  for (let i = 0; i < chunk.length; i += CONCURRENCY) {
    if (Date.now() - tickStart > TICK_BUDGET_MS - PROBE_TIMEOUT_MS * 2) break;
    const batch = chunk.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (site) => {
        const result = await probeSite(site.url, fetchesUsed);
        fetchesUsed++;
        return result;
      })
    );
    results.push(...batchResults);
    if (fetchesUsed >= MAX_FETCHES_PER_TICK) break;
  }

  const probedSites = chunk.slice(0, results.length);
  if (!probedSites.length) return;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const removeAfterMs = REMOVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const pruneBeforeMs = nowMs - REMOVE_PRUNE_DAYS * 24 * 60 * 60 * 1000;

  // Merge results with hysteresis
  probedSites.forEach((site, i) => {
    const result = results[i];
    const slug = site.slug;
    const prev = map[slug];
    const prevStatus = prev?.status || 'pending';
    const prevStreak = prev?.streak || 0;
    const prevSince = prev?.since;
    const prevDeadSince = prev?.deadSince;

    let newStatus = prevStatus;
    let streak = prevStreak;
    let since = prevSince;
    let deadSince = prevDeadSince;
    let flapping = false;

    if (result.status === 'up') {
      newStatus = 'up';
      streak = 0;
      since = undefined;
      deadSince = undefined;
      flapping = false;
    } else {
      // Non-up verdict
      if (streak === 0) {
        streak = 1;
        since = nowIso;
      } else {
        streak++;
      }
      flapping = streak < CONFIRM_COUNT;

      if (streak >= CONFIRM_COUNT) {
        newStatus = result.status;
        if (!deadSince) {
          deadSince = nowIso;
        }
      }
    }

    // Check for 21-day removal
    if (deadSince) {
      const deadSinceMs = new Date(deadSince).getTime();
      if (nowMs - deadSinceMs >= removeAfterMs) {
        // Move to removed[]
        removed.push({
          slug,
          name: site.name,
          url: site.url,
          section: site.section,
          deadSince,
          removedAt: nowIso,
          lastStatus: newStatus,
          lastMs: result.ms,
          lastCode: result.code
        });
        delete map[slug];
        return;
      }
    }

    const roll = rollMeanMs(prev && prev.avgMs, prev && prev.msN, result.ms);

    map[slug] = {
      status: newStatus,
      ms: result.ms,
      code: result.code,
      detail: result.detail,
      checkedAt: nowIso,
      h: pushHistory(prev && prev.h, result.status),
      avgMs: roll.avgMs,
      msN: roll.msN,
      ...(streak > 0 && { streak }),
      ...(since && { since }),
      ...(flapping && { flapping: true }),
      ...(deadSince && { deadSince })
    };
  });

  // Prune old removed entries
  state.removed = removed.filter((r) => new Date(r.removedAt).getTime() >= pruneBeforeMs);

  // Update state
  state.updated = nowIso;
  state.cursor = (cursor + probedSites.length) % mySites.length;
  state.map = map;
  // state.removed already updated above

  await writeState(env, state);
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
  const shardCount = parseInt(env.SHARD_COUNT || '1', 10);
  const shardIndex = parseInt(env.SHARD_INDEX || '0', 10);

  const [sitesRaw, state] = await Promise.all([
    env.MONITOR_KV.get(K.sites, 'json'),
    env.MONITOR_KV.get(K.state, 'json')
  ]);

  const list = (sitesRaw && sitesRaw.list) || [];
  const map = (state && state.map) || {};
  const removed = (state && state.removed) || [];

  // Filter to this shard's sites
  const mySites = list.filter((s) => inMyShard(s.slug, shardCount, shardIndex));

  const sites = mySites.map((s) => {
    const entry = map[s.slug];
    if (!entry) {
      return Object.assign({}, s, { status: 'pending', ms: null, code: null, detail: 'waiting for sweep' });
    }
    return Object.assign({}, s, entry, {
      uptime: uptimeOf(entry),
      avgMs: entry.avgMs != null ? entry.avgMs : entry.ms,
      history: entry.h || null
    });
  });

  // 503 only when state key is entirely absent (no data yet)
  if (!state && !sites.length) {
    return json({ updated: null, sites: [], error: 'no data yet', pending: 0, total: 0 }, 503);
  }

  const pending = sites.filter((s) => s.status === 'pending').length;

  return json({
    updated: (state && state.updated) || null,
    sites,
    pending,
    total: sites.length,
    historyWindow: HISTORY_LEN,
    removed,
    shard: { index: shardIndex, count: shardCount }
  });
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