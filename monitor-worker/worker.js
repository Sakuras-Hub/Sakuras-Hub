/**
 * Sakura's Hub: site monitor worker (v3)
 *
 * Probes every site in info.json on a rolling cron sweep, serves the results
 * to the page (/status, /summary), reports its own health (/health) and can
 * post confirmed changes to Discord. Runs on the Cloudflare Workers free tier
 * with Workers KV.
 *
 * What it does each tick (cron every 2 minutes, ONE KV read pair + ONE KV write):
 *   1. Re-checks sites that just failed once or twice (every ~4 minutes), so a
 *      dead site is confirmed in about 10 minutes instead of about 29 hours.
 *   2. Re-checks a few confirmed-dead sites (hourly) so recoveries show up fast.
 *   3. Fills the rest of the chunk with the rolling sweep (about 10 hours for a
 *      full pass of ~6,000 sites).
 *
 * Verdicts: up | blocked (401/403/451/challenge) | down | unreachable.
 *   - Confirmation needs CONFIRM_COUNT failures in a row (no flapping alerts).
 *   - A page that is a tiny "this domain is for sale" parking page counts as down.
 *   - A site that redirects to a different domain (confirmed on 2 checks in a
 *     row) is reported as "moved". It stays "up" because it still answers.
 *   - "blocked" means the server answered but refused the bot. That never
 *     counts toward the 21-day dead timer (v2 did, which could remove live
 *     sites that sit behind bot protection).
 *   - Dead for REMOVE_AFTER_DAYS -> moved to removed[]; the weekly GitHub job
 *     double-checks them from another network before it deletes anything.
 *
 * Endpoints (all GET, CORS open):
 *   /status   full per-site results (cached 60 s at the edge)
 *   /summary  small counts for the home-page badge (+ stale flag)
 *   /health   is the monitor itself alive? (used by the GitHub heartbeat)
 *
 * Self-care:
 *   - Orphan cleanup: results for sites no longer in info.json are dropped.
 *   - If info.json cannot be fetched the old list keeps working, the failure
 *     is recorded (see /health) and retried every 10 minutes, not every tick.
 *   - Subrequests are counted for real. A tick stays under the free-tier cap
 *     of 50 (default budget 46 plus one Discord post).
 *
 * Discord feed (optional): set the DISCORD_WEBHOOK_URL secret.
 *   Posts: went down, back online, moved, dead for 21+ days, daily digest.
 *   New / removed / risky-flagged sites are posted by the GitHub Actions.
 *   Adult sites are only counted unless NOTIFY_SHOW_NSFW=1.
 *
 * Reports: POST /report {url, reason, note} from the directory's flag button posts
 *   to Discord. Only sites that are really in the list are accepted. Limits: 3 per
 *   IP per 10 minutes (best effort) and REPORT_DAILY_CAP per day in total (one KV
 *   write per accepted report, so well inside the free tier). Optional env:
 *   ALLOWED_ORIGINS="https://yoursite.com,https://other.com" (browser check).
 *
 * Suggestions: POST /suggest {url, name, section, note} from the "Suggest a site" form
 *   posts to Discord for you to review. The address must be a normal public http(s)
 *   site that is not already listed. Limits: 3 per IP per 10 minutes and
 *   SUGGEST_DAILY_CAP per day in total (one KV write each).
 *
 * Two Discord channels (optional): DISCORD_WEBHOOK_URL_ALERTS receives monitor
 *   events and reports; if it is not set they go to DISCORD_WEBHOOK_URL.
 *
 * Optional env vars: SHARD_COUNT / SHARD_INDEX (split the list over several
 *   workers), CHUNK (sites per tick, default 20; raise only on a paid plan
 *   together with SUBREQUEST_LIMIT), DETECT_PARKED=0, NOTIFY_MOVED=0.
 *
 * KV (MONITOR_KV):
 *   "sites" = {ts, list:[{slug,name,url,section,nsfw,countries}]}
 *   "state" = {updated, cursor, map:{slug:{status,ms,code,detail,checkedAt,h,avgMs,msN,
 *             streak?,since?,flapping?,deadSince?,mv?}}, removed:[...], listError?, listErrorAt?}
 *
 * Crash recovery: no guard flag, no deletes. A tick that dies before the write
 * changes nothing; the next tick redoes it.
 */

const INFO_URL = 'https://raw.githubusercontent.com/Sakuras-Hub/Sakuras-Hub/refs/heads/main/need%20for%20the%20website%20to%20work/info.json';

const DEFAULT_CHUNK = 20;                      // probes per tick
const CONCURRENCY = 10;                        // parallel probes
const PROBE_TIMEOUT_MS = 5000;                 // per attempt
const TICK_BUDGET_MS = 20000;                  // stop starting probes after this so state is always written
const LIST_REFRESH_MS = 6 * 60 * 60 * 1000;    // refetch info.json if the cached list is older
const LIST_RETRY_MS = 10 * 60 * 1000;          // after a failed refetch wait this long
const KEEP_TTL_S = 7 * 24 * 3600;              // sliding TTL for KV keys (rewritten every tick)
const CONFIRM_COUNT = 3;                       // failures in a row needed to confirm
const REMOVE_AFTER_DAYS = 21;                  // dead this long -> removed[]
const REMOVE_PRUNE_DAYS = 90;                  // forget removed[] entries after this
const DEFAULT_SUBREQUEST_LIMIT = 50;           // Workers free tier
const SUBREQUEST_RESERVE = 4;                  // kept back for the list refetch + Discord
const RECHECK_GAP_MS = 4 * 60 * 1000;          // re-probe a freshly failing site after this
const RECHECK_MAX = 5;                         // per tick
const RECOVERY_GAP_MS = 60 * 60 * 1000;        // re-probe a confirmed-dead site after this
const RECOVERY_MAX = 3;                        // per tick
const STALE_MS = 30 * 60 * 1000;               // no finished tick for this long = stale
const PARKED_MAX_BYTES = 12288;                // only tiny pages can be parking pages
const STATUS_CACHE_S = 60;
const VERSION = 3;

// Browser-like headers: a bare bot UA gets 403'd by modern anti-bot (Cloudflare, Akamai, DDoS-Guard).
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

const K = { sites: 'sites', state: 'state' };

// Probe history per site as verdict chars: 0=up 1=blocked 2=down 3=unreachable.
const HISTORY_LEN = 24;
const HISTORY_CHAR = { up: '0', blocked: '1', down: '2', unreachable: '3' };

// ---------------------------------------------------------------------------
// Small pure helpers (exported so they can be tested)
// ---------------------------------------------------------------------------

/** Stable per-site key: normalized URL (host + path). */
export function siteSlug(url) {
  if (!url) return '';
  return String(url).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/** Deterministic 32-bit FNV-1a hash for sharding. */
export function siteHash(slug) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function inMyShard(slug, shardCount, shardIndex) {
  if (shardCount <= 1) return true;
  return (siteHash(slug) % shardCount) === shardIndex;
}

/** Classify an HTTP status into the 4-state model. */
export function classifyStatus(status, headers) {
  if (status >= 200 && status <= 399) return 'up';
  if (status === 401 || status === 403 || status === 451) return 'blocked';
  if (headers && headers.get && headers.get('cf-mitigated')) return 'blocked';
  return 'down';
}

export function pushHistory(prev, verdict) {
  const h = String(prev || '') + (HISTORY_CHAR[verdict] || '2');
  return h.length > HISTORY_LEN ? h.slice(h.length - HISTORY_LEN) : h;
}

export function rollMeanMs(prevAvg, prevN, ms) {
  if (ms == null || !isFinite(ms)) return { avgMs: prevAvg == null ? null : prevAvg, msN: prevN || 0 };
  const n = Math.min(prevN || 0, HISTORY_LEN - 1);
  const avg = prevAvg == null || !n ? Math.round(ms) : Math.round((prevAvg * n + ms) / (n + 1));
  return { avgMs: avg, msN: n + 1 };
}

export function uptimeOf(entry) {
  const h = (entry && entry.h) || '';
  if (!h) return null;
  let up = 0;
  for (let i = 0; i < h.length; i++) if (h[i] === '0') up++;
  return { pct: Math.round((up / h.length) * 1000) / 10, up, total: h.length };
}

/**
 * If a redirect leaves the site for a different domain, return the new host.
 * Same site (http->https, www, subdomains) and login / consent redirects return null.
 */
export function movedHost(from, location) {
  if (!location) return null;
  let a, b;
  try { a = new URL(from); b = new URL(location, from); } catch (e) { return null; }
  if (b.protocol !== 'http:' && b.protocol !== 'https:') return null;
  const ha = a.hostname.replace(/^www\./, '').toLowerCase();
  const hb = b.hostname.replace(/^www\./, '').toLowerCase();
  if (!hb || ha === hb || hb.endsWith('.' + ha) || ha.endsWith('.' + hb)) return null;
  if (/^(login|accounts?|auth|sso|consent|signin|id)\./.test(hb)) return null;
  if (/\/(login|signin|consent|captcha|cdn-cgi)(\/|$|\?)/i.test(b.pathname)) return null;
  return hb;
}

const PARKED_RE = /(this domain (name )?(is|may be) for sale|domain (name )?is for sale|domain for sale|buy this domain|this domain is parked|domain parking|sedoparking|hugedomains|parkingcrew|afternic|is available for purchase|godaddy\.com\/forsale|dan\.com\/buy)/i;

/** True for a small, complete page that matches a domain-parking phrase. */
export function looksParked(text, complete) {
  return !!complete && PARKED_RE.test(String(text || ''));
}

/** Read at most `max` bytes of a response body. Returns {text, complete} or null. */
async function readHead(res, max) {
  if (!res.body || !res.body.getReader) return null;
  const reader = res.body.getReader();
  const parts = [];
  let bytes = 0, complete = false;
  try {
    while (bytes <= max) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      parts.push(value);
      bytes += value.byteLength;
    }
  } catch (e) {
    return null;
  } finally {
    try { reader.cancel().catch(() => {}); } catch (e) { /* ignore */ }
  }
  const all = new Uint8Array(bytes);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.byteLength; }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(all), complete: complete && bytes <= max };
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/** One probe attempt. `budget.used` counts real subrequests. */
async function probeOnce(url, budget, detectParked) {
  const t0 = performance.now();
  budget.used++;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: HEADERS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    const ms = Math.round(performance.now() - t0);
    const out = { status: classifyStatus(res.status, res.headers), ms, code: res.status, detail: 'HTTP ' + res.status };

    if (res.status >= 300 && res.status < 400) {
      const to = movedHost(url, res.headers.get('location'));
      if (to) out.movedTo = to;
    }
    if (res.status === 200 && detectParked) {
      const head = await readHead(res, PARKED_MAX_BYTES);
      if (head && looksParked(head.text, head.complete)) {
        out.status = 'down';
        out.detail = 'parked domain';
        out.parked = true;
      }
    } else if (res.body && res.body.cancel) {
      res.body.cancel().catch(() => {});
    }
    return out;
  } catch (err) {
    const detail = err && err.name ? err.name + (err.message ? ': ' + err.message : '') : String(err);
    return { status: 'unreachable', ms: null, code: null, detail };
  }
}

/** Probe one site; retry once on transient trouble if the budget allows. */
async function probeSite(url, budget, detectParked) {
  const first = await probeOnce(url, budget, detectParked);
  if (budget.used >= budget.max) return first;
  const transient =
    first.status === 'unreachable' ||
    (first.code !== null && first.code >= 500) ||
    first.code === 429;
  if (!transient) return first;
  const second = await probeOnce(url, budget, detectParked);
  return (second.status === 'up' || second.status === 'down' || second.status === 'blocked') ? second : first;
}

// ---------------------------------------------------------------------------
// Site list
// ---------------------------------------------------------------------------

/**
 * Cached info.json list. Refetches when older than LIST_REFRESH_MS.
 * Returns {list, attempted, error}. Never throws; never returns a worse list than it had.
 */
async function ensureSiteList(env, state, budget, nowMs) {
  const cached = await env.MONITOR_KV.get(K.sites, 'json');
  const fresh = cached && cached.list && cached.ts && nowMs - cached.ts < LIST_REFRESH_MS;
  if (fresh) return { list: cached.list, attempted: false, error: null };

  const lastFail = state && state.listErrorAt ? new Date(state.listErrorAt).getTime() : 0;
  if (cached && cached.list && lastFail && nowMs - lastFail < LIST_RETRY_MS) {
    return { list: cached.list, attempted: false, error: null };
  }
  try {
    budget.used++;
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
    if (!list.length) throw new Error('info.json had no sites');
    await env.MONITOR_KV.put(K.sites, JSON.stringify({ ts: nowMs, list }), { expirationTtl: KEEP_TTL_S });
    return { list, attempted: true, error: null };
  } catch (err) {
    return { list: cached && cached.list ? cached.list : [], attempted: true, error: String((err && err.message) || err).slice(0, 120) };
  }
}

// ---------------------------------------------------------------------------
// Discord feed
// ---------------------------------------------------------------------------
const DISCORD_TIMEOUT_MS = 4000;
const DIGEST_UTC_HOUR = 12;                    // one status digest a day, 12:00 UTC
const NOTIFY_COLORS = { down: 0xff5f6d, up: 0x3ecf8e, moved: 0xf0b429, removed: 0x9e94c0, digest: 0xb98cff };
const MD_ESCAPE = new Set(['\\', '*', '_', '`', '~', '|']);
const MD_LOOKALIKE = { '[': '‹', ']': '›', '(': '﹙', ')': '﹚', '<': '‹', '>': '›' };

/** Make scraped text safe inside a Discord embed (no markdown, links or odd tags). */
export function mdSafe(text, limit) {
  let t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (limit && t.length > limit) t = t.slice(0, limit - 1) + '…';
  let out = '';
  for (const ch of t) out += MD_ESCAPE.has(ch) ? '\\' + ch : (MD_LOOKALIKE[ch] || ch);
  return out;
}

function mdLink(site) {
  const url = String(site.url || '').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
  return '[' + mdSafe(site.name || url, 60) + '](' + url + ')';
}

/** "3d 4h" / "5h" / "under an hour" between an ISO time and now. */
export function agoText(iso, nowMs) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!isFinite(t)) return '';
  const mins = Math.max(0, Math.round(((nowMs || Date.now()) - t) / 60000));
  if (mins < 60) return 'under an hour';
  const hours = Math.floor(mins / 60);
  if (hours < 48) return hours + 'h';
  return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
}

/**
 * Turn the events from one tick into one Discord message (or null).
 * events: [{kind:'down'|'up'|'moved'|'removed', site, status?, code?, detail?, parked?, to?, since?}]
 * digest: optional {total, up, down, blocked, unreachable, pending}
 */
export function buildDiscordPayload(events, digest, env, nowMs) {
  const showNsfw = !!(env && (env.NOTIFY_SHOW_NSFW === '1' || env.NOTIFY_SHOW_NSFW === 'true'));
  const embeds = [];
  const groups = [
    ['down', '🔻 Went down (confirmed)'],
    ['up', '💚 Back online'],
    ['moved', '↪️ Moved to a new address'],
    ['removed', '🪦 Dead for ' + REMOVE_AFTER_DAYS + '+ days: queued for removal']
  ];
  for (const [kind, title] of groups) {
    const list = (events || []).filter((e) => e.kind === kind);
    if (!list.length) continue;
    let hidden = 0;
    const lines = [];
    for (const e of list) {
      if (e.site.nsfw && !showNsfw) { hidden++; continue; }
      let line = '• ' + mdLink(e.site);
      if (e.site.section) line += ' · ' + mdSafe(e.site.section, 40);
      if (kind === 'down') {
        if (e.parked) line += ' · parked domain';
        else line += ' · ' + (e.code ? 'HTTP ' + e.code : mdSafe(e.status === 'unreachable' ? 'unreachable' : (e.detail || 'down'), 40));
      } else if (kind === 'up' && e.since) {
        const d = agoText(e.since, nowMs);
        if (d) line += ' · was down ' + d;
      } else if (kind === 'moved' && e.to) {
        line += ' · now redirects to ' + mdSafe(e.to, 60);
      } else if (kind === 'removed' && e.since) {
        const d = agoText(e.since, nowMs);
        if (d) line += ' · down for ' + d;
      }
      lines.push(line);
    }
    if (hidden) lines.push('+ ' + hidden + ' adult site' + (hidden === 1 ? '' : 's') + ' (names hidden)');
    let desc = lines.join('\n');
    if (desc.length > 3800) desc = desc.slice(0, 3790).replace(/\n[^\n]*$/, '') + '\n…and more';
    embeds.push({ title: title + ' (' + list.length + ')', description: desc, color: NOTIFY_COLORS[kind] });
  }
  if (digest) {
    const n = (x) => Number(x || 0).toLocaleString('en-US');
    embeds.push({
      title: '📊 Daily status',
      description:
        '**' + n(digest.up) + '** up · **' + n(digest.down) + '** down · **' + n(digest.blocked) + '** blocked · **' +
        n(digest.unreachable) + '** unreachable' + (digest.pending ? ' · ' + n(digest.pending) + ' not checked yet' : '') +
        '\n' + n(digest.total) + ' sites monitored',
      color: NOTIFY_COLORS.digest
    });
  }
  if (!embeds.length) return null;
  embeds[embeds.length - 1].timestamp = new Date(nowMs || Date.now()).toISOString();
  embeds[embeds.length - 1].footer = { text: 'Live monitor' };
  return {
    username: 'Sakura’s Hub',
    allowed_mentions: { parse: [] },          // scraped names can never ping anyone
    embeds
  };
}

/** Post to the webhook. Never throws: Discord trouble must not stop monitoring. */
function pickWebhook(env) {
  return (env && (env.DISCORD_WEBHOOK_URL_ALERTS || env.DISCORD_WEBHOOK_URL)) || '';
}

async function notifyDiscord(env, events, digest) {
  const url = pickWebhook(env);
  if (!url || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return;
  const payload = buildDiscordPayload(events, digest, env);
  if (!payload) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS)
    });
    if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
  } catch (err) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Reports from the directory's flag button
// ---------------------------------------------------------------------------
const REPORT_REASONS = {
  down: 'Broken or down',
  scam: 'Scam, malware or unsafe',
  wrong: 'Wrong name, category or info',
  other: 'Something else'
};
const REPORT_DAILY_CAP = 100;                  // accepted reports per UTC day, all visitors
const REPORT_IP_MAX = 3;                       // per IP ...
const REPORT_IP_WINDOW_MS = 10 * 60 * 1000;    // ... per 10 minutes (per worker instance: best effort)
const REPORT_MAX_BODY = 2000;
const ipHits = new Map();

/** Best-effort per-IP limiter held in memory. Returns true if this request must be refused. */
export function ipRateLimited(ip, nowMs, ns) {
  const key = (ns ? ns + ':' : '') + (ip || 'unknown');
  const fresh = (ipHits.get(key) || []).filter((t) => nowMs - t < REPORT_IP_WINDOW_MS);
  if (fresh.length >= REPORT_IP_MAX) { ipHits.set(key, fresh); return true; }
  fresh.push(nowMs);
  ipHits.set(key, fresh);
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits) if (!v.some((t) => nowMs - t < REPORT_IP_WINDOW_MS)) ipHits.delete(k);
  }
  return false;
}
export function resetReportLimits() { ipHits.clear(); }

function reportOk(extra) { return json(Object.assign({ ok: true }, extra || {}), 200); }
function reportErr(status, error) { return json({ ok: false, error }, status); }

async function handleReport(request, env) {
  const nowMs = Date.now();
  const hook = pickWebhook(env);
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook)) return reportErr(503, 'reports are not enabled');

  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  if (allowed.length && origin && !allowed.includes(origin)) return reportErr(403, 'origin not allowed');

  let text = '';
  try { text = await request.text(); } catch (e) { return reportErr(400, 'bad request'); }
  if (text.length > REPORT_MAX_BODY) return reportErr(413, 'too large');
  let body;
  try { body = JSON.parse(text); } catch (e) { return reportErr(400, 'bad json'); }
  if (!body || typeof body !== 'object') return reportErr(400, 'bad json');

  if (body.website) return reportOk();                       // honeypot field: pretend success
  const url = typeof body.url === 'string' ? body.url.slice(0, 400) : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
  if (!url || !REPORT_REASONS[reason]) return reportErr(400, 'missing fields');

  const sitesRaw = await env.MONITOR_KV.get(K.sites, 'json');
  const slug = siteSlug(url);
  const site = ((sitesRaw && sitesRaw.list) || []).find((s) => s.slug === slug);
  if (!site) return reportErr(400, 'unknown site');

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ipRateLimited(ip, nowMs)) return reportErr(429, 'slow down');

  const dayKey = 'rpt:' + new Date(nowMs).toISOString().slice(0, 10);
  const used = parseInt((await env.MONITOR_KV.get(dayKey)) || '0', 10) || 0;
  if (used >= REPORT_DAILY_CAP) return reportErr(429, 'too many reports today');
  await env.MONITOR_KV.put(dayKey, String(used + 1), { expirationTtl: 2 * 24 * 3600 });

  const state = await env.MONITOR_KV.get(K.state, 'json');
  const entry = state && state.map && state.map[slug];
  const showNsfw = env.NOTIFY_SHOW_NSFW === '1' || env.NOTIFY_SHOW_NSFW === 'true';
  const who = (site.nsfw && !showNsfw)
    ? 'Adult site (name hidden): ' + mdSafe(slug, 80)
    : mdLink(site) + (site.section ? ' · ' + mdSafe(site.section, 40) : '');
  const fields = [{ name: 'Monitor says', value: entry ? mdSafe(entry.status + (entry.code ? ' (HTTP ' + entry.code + ')' : ''), 60) : 'not checked yet', inline: true }];
  if (note) fields.push({ name: 'Note from visitor', value: mdSafe(note, 200) });
  const payload = {
    username: 'Sakura’s Hub',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: '🚩 Report: ' + REPORT_REASONS[reason],
      description: who,
      fields,
      color: reason === 'scam' ? NOTIFY_COLORS.down : NOTIFY_COLORS.moved,
      timestamp: new Date(nowMs).toISOString(),
      footer: { text: 'Visitor report' }
    }]
  };
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS)
    });
    if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
    if (!res.ok) return reportErr(502, 'could not deliver');
  } catch (e) {
    return reportErr(502, 'could not deliver');
  }
  return reportOk();
}

// ---------------------------------------------------------------------------
// "Suggest a site" form
// ---------------------------------------------------------------------------
const SUGGEST_DAILY_CAP = 50;

/** A normal public web address: http(s), a real-looking domain, no IPs / localhost / odd characters. */
export function cleanSuggestedUrl(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 300 || /[\s`<>"'\\]/.test(text)) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;   // needs a dot; no IPv6
  if (/^\d+(\.\d+){3}$/.test(host)) return null;                                                    // IPv4
  if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(host)) return null;
  u.hash = '';
  return u.toString();
}

async function handleSuggest(request, env) {
  const nowMs = Date.now();
  const hook = pickWebhook(env);
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook)) return reportErr(503, 'suggestions are not enabled');

  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  if (allowed.length && origin && !allowed.includes(origin)) return reportErr(403, 'origin not allowed');

  let text = '';
  try { text = await request.text(); } catch (e) { return reportErr(400, 'bad request'); }
  if (text.length > REPORT_MAX_BODY) return reportErr(413, 'too large');
  let body;
  try { body = JSON.parse(text); } catch (e) { return reportErr(400, 'bad json'); }
  if (!body || typeof body !== 'object') return reportErr(400, 'bad json');
  if (body.website) return reportOk();                                   // honeypot

  const url = cleanSuggestedUrl(body.url);
  if (!url) return reportErr(400, 'that does not look like a website address');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const section = typeof body.section === 'string' ? body.section.trim().slice(0, 40) : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

  const sitesRaw = await env.MONITOR_KV.get(K.sites, 'json');
  const slug = siteSlug(url);
  const bare = slug.replace(/^www\./, '');
  const list = (sitesRaw && sitesRaw.list) || [];
  if (list.some((x) => x.slug === slug || x.slug.replace(/^www\./, '') === bare)) return reportOk({ exists: true });

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ipRateLimited(ip, nowMs, 'sug')) return reportErr(429, 'slow down');

  const dayKey = 'sug:' + new Date(nowMs).toISOString().slice(0, 10);
  const used = parseInt((await env.MONITOR_KV.get(dayKey)) || '0', 10) || 0;
  if (used >= SUGGEST_DAILY_CAP) return reportErr(429, 'too many suggestions today');
  await env.MONITOR_KV.put(dayKey, String(used + 1), { expirationTtl: 2 * 24 * 3600 });

  // The address is shown as plain code, never as a clickable link, so a trick link cannot be tapped by accident.
  const fields = [];
  if (name) fields.push({ name: 'Name', value: mdSafe(name, 80), inline: true });
  if (section) fields.push({ name: 'Category', value: mdSafe(section, 40), inline: true });
  if (note) fields.push({ name: 'Note from visitor', value: mdSafe(note, 200) });
  const payload = {
    username: 'Sakura’s Hub',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: '💡 Site suggestion',
      description: '`' + url.replace(/`/g, '') + '`',
      fields,
      color: NOTIFY_COLORS.up,
      timestamp: new Date(nowMs).toISOString(),
      footer: { text: 'Visitor suggestion. Check it before adding.' }
    }]
  };
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS)
    });
    if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
    if (!res.ok) return reportErr(502, 'could not deliver');
  } catch (e) {
    return reportErr(502, 'could not deliver');
  }
  return reportOk();
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/**
 * Pick sites to re-probe ahead of the sweep:
 *  - freshly failing (streak 1..CONFIRM_COUNT-1) and last checked >= RECHECK_GAP_MS ago
 *  - confirmed down/unreachable and last checked >= RECOVERY_GAP_MS ago
 * Oldest first. Returns an array of site objects.
 */
export function pickExtras(map, siteBySlug, nowMs, limits) {
  const lim = Object.assign({ recheck: RECHECK_MAX, recovery: RECOVERY_MAX }, limits || {});
  const flapping = [], recovery = [];
  for (const slug in map) {
    const site = siteBySlug.get(slug);
    if (!site) continue;
    const e = map[slug];
    const age = nowMs - new Date(e.checkedAt || 0).getTime();
    if (e.streak > 0 && e.streak < CONFIRM_COUNT) {
      if (age >= RECHECK_GAP_MS) flapping.push({ age, site });
    } else if ((e.status === 'down' || e.status === 'unreachable') && age >= RECOVERY_GAP_MS) {
      recovery.push({ age, site });
    }
  }
  flapping.sort((a, b) => b.age - a.age);
  recovery.sort((a, b) => b.age - a.age);
  return flapping.slice(0, lim.recheck).map((x) => x.site).concat(recovery.slice(0, lim.recovery).map((x) => x.site));
}

async function scheduleSweep(env, scheduledTime) {
  const shardCount = parseInt(env.SHARD_COUNT || '1', 10);
  const shardIndex = parseInt(env.SHARD_INDEX || '0', 10);
  const chunkSize = Math.max(5, Math.min(200, parseInt(env.CHUNK || String(DEFAULT_CHUNK), 10) || DEFAULT_CHUNK));
  const limit = parseInt(env.SUBREQUEST_LIMIT || String(DEFAULT_SUBREQUEST_LIMIT), 10) || DEFAULT_SUBREQUEST_LIMIT;
  const budget = { used: 0, max: limit - SUBREQUEST_RESERVE };
  const detectParked = env.DETECT_PARKED !== '0';
  const notifyMoved = env.NOTIFY_MOVED !== '0';
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const state = (await env.MONITOR_KV.get(K.state, 'json')) || { updated: null, cursor: 0, map: {}, removed: [] };
  const { list, attempted, error } = await ensureSiteList(env, state, budget, nowMs);
  if (attempted) {
    if (error) { state.listError = error; state.listErrorAt = nowIso; }
    else { delete state.listError; delete state.listErrorAt; }
  }
  if (!list.length) {
    if (attempted) await writeState(env, state);   // record the failure so /health can show it
    return;
  }

  const mySites = list.filter((s) => inMyShard(s.slug, shardCount, shardIndex));
  if (!mySites.length) return;
  const siteBySlug = new Map(mySites.map((s) => [s.slug, s]));

  const map = state.map || {};
  const removed = state.removed || [];
  const cursor = typeof state.cursor === 'number' ? state.cursor : 0;

  // Orphan cleanup: drop results for sites that left info.json.
  // Skipped if the list looks suspiciously short (a truncated download must not wipe history).
  const mapKeys = Object.keys(map);
  if (mapKeys.length < 100 || mySites.length >= mapKeys.length * 0.5) {
    for (const k of mapKeys) if (!siteBySlug.has(k)) delete map[k];
  }

  // Build this tick's chunk: re-checks first, then the rolling sweep.
  const extras = pickExtras(map, siteBySlug, nowMs);
  const sweepN = Math.min(Math.max(chunkSize - extras.length, 0), mySites.length);
  const sweep = [];
  for (let i = 0; i < sweepN; i++) sweep.push(mySites[(cursor + i) % mySites.length]);
  const chunk = extras.concat(sweep);
  if (!chunk.length) return;

  // Probe with a wall-clock budget so state always gets written.
  const results = [];
  const tickStart = Date.now();
  for (let i = 0; i < chunk.length; i += CONCURRENCY) {
    if (Date.now() - tickStart > TICK_BUDGET_MS - PROBE_TIMEOUT_MS * 2) break;
    if (budget.used >= budget.max) break;
    const batch = chunk.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((site) => probeSite(site.url, budget, detectParked)));
    results.push(...batchResults);
  }
  const probed = chunk.slice(0, results.length);
  if (!probed.length) return;

  const removeAfterMs = REMOVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const pruneBeforeMs = nowMs - REMOVE_PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const events = [];

  probed.forEach((site, i) => {
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
    } else {
      if (streak === 0) { streak = 1; since = nowIso; } else { streak++; }
      flapping = streak < CONFIRM_COUNT;
      if (streak >= CONFIRM_COUNT) {
        newStatus = result.status;
        if (result.status === 'blocked') {
          deadSince = undefined;            // it answered: alive, just refusing us. Never "dead".
        } else if (!deadSince) {
          deadSince = nowIso;
        }
      }
    }

    // Redirect to another domain: confirm on two checks in a row, announce once.
    let mv = prev && prev.mv;
    if (result.movedTo) {
      mv = (mv && mv.to === result.movedTo) ? { to: result.movedTo, n: mv.n + 1 } : { to: result.movedTo, n: 1 };
      if (mv.n === 2 && notifyMoved) events.push({ kind: 'moved', site, to: result.movedTo });
    } else if (result.status === 'up') {
      mv = undefined;
    }

    // Announce only confirmed changes. A site never seen up (prevStatus 'pending') stays silent.
    if (prevStatus === 'up' && (newStatus === 'down' || newStatus === 'unreachable')) {
      events.push({ kind: 'down', site, status: newStatus, code: result.code, detail: result.detail, parked: !!result.parked, since });
    } else if ((prevStatus === 'down' || prevStatus === 'unreachable') && newStatus === 'up') {
      events.push({ kind: 'up', site, since: prevDeadSince || prevSince });
    }

    // Dead long enough: queue for removal.
    if (deadSince && nowMs - new Date(deadSince).getTime() >= removeAfterMs) {
      removed.push({
        slug, name: site.name, url: site.url, section: site.section,
        deadSince, removedAt: nowIso, lastStatus: newStatus, lastMs: result.ms, lastCode: result.code
      });
      events.push({ kind: 'removed', site, since: deadSince });
      delete map[slug];
      return;
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
      ...(deadSince && { deadSince }),
      ...(mv && { mv })
    };
  });

  const sweepProbed = Math.max(0, results.length - extras.length);
  state.removed = removed.filter((r) => new Date(r.removedAt).getTime() >= pruneBeforeMs);
  state.updated = nowIso;
  state.cursor = (cursor + sweepProbed) % mySites.length;
  state.map = map;
  await writeState(env, state);

  // Discord feed (after the state is safely written).
  let digest = null;
  if (scheduledTime) {
    const when = new Date(scheduledTime);
    if (when.getUTCHours() === DIGEST_UTC_HOUR && when.getUTCMinutes() < 2) {
      digest = Object.assign({ total: mySites.length }, countStatuses(mySites, map));
    }
  }
  if (events.length || digest) await notifyDiscord(env, events, digest);
}

async function writeState(env, state) {
  await env.MONITOR_KV.put(K.state, JSON.stringify(state), { expirationTtl: KEEP_TTL_S });
}

function countStatuses(mySites, map) {
  const counts = { up: 0, down: 0, blocked: 0, unreachable: 0, pending: 0 };
  for (const s of mySites) {
    const st = (map[s.slug] && map[s.slug].status) || 'pending';
    counts[st] = (counts[st] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// HTTP side
// ---------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data, status, cacheSeconds) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      CORS,
      { 'Cache-Control': cacheSeconds ? 'public, max-age=' + cacheSeconds : 'no-store' }
    )
  });
}

/** Serve from the edge cache for `seconds`, ignoring ?_=cache-busters. Falls back to computing. */
async function edgeCached(request, ctx, seconds, produce) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (!cache) return produce();
  const u = new URL(request.url);
  const key = new Request(u.origin + u.pathname, { method: 'GET' });
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch (e) { /* fall through */ }
  const res = await produce();
  if (res.status === 200 && ctx && ctx.waitUntil) {
    try { ctx.waitUntil(cache.put(key, res.clone())); } catch (e) { /* ignore */ }
  }
  return res;
}

async function loadAll(env) {
  const shardCount = parseInt(env.SHARD_COUNT || '1', 10);
  const shardIndex = parseInt(env.SHARD_INDEX || '0', 10);
  const [sitesRaw, state] = await Promise.all([
    env.MONITOR_KV.get(K.sites, 'json'),
    env.MONITOR_KV.get(K.state, 'json')
  ]);
  const list = (sitesRaw && sitesRaw.list) || [];
  return { state, shardCount, shardIndex, mySites: list.filter((s) => inMyShard(s.slug, shardCount, shardIndex)) };
}

function ageInfo(state, nowMs) {
  const t = state && state.updated ? new Date(state.updated).getTime() : NaN;
  if (!isFinite(t)) return { ageMin: null, stale: true };
  const ms = Math.max(0, nowMs - t);
  return { ageMin: Math.round(ms / 60000), stale: ms > STALE_MS };
}

async function handleStatus(env) {
  const { state, shardCount, shardIndex, mySites } = await loadAll(env);
  const map = (state && state.map) || {};
  const removed = (state && state.removed) || [];

  const sites = mySites.map((s) => {
    const entry = map[s.slug];
    if (!entry) return Object.assign({}, s, { status: 'pending', ms: null, code: null, detail: 'waiting for sweep' });
    return Object.assign({}, s, entry, {
      uptime: uptimeOf(entry),
      avgMs: entry.avgMs != null ? entry.avgMs : entry.ms,
      history: entry.h || null
    });
  });

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
  }, 200, STATUS_CACHE_S);
}

// Small summary for the home-page badge.
async function handleSummary(env) {
  const { state, mySites } = await loadAll(env);
  const map = (state && state.map) || {};
  if (!state && !mySites.length) {
    return json({ updated: null, total: 0, up: 0, down: 0, blocked: 0, unreachable: 0, pending: 0, stale: true, error: 'no data yet' }, 503);
  }
  const counts = countStatuses(mySites, map);
  const age = ageInfo(state, Date.now());
  return json({
    updated: (state && state.updated) || null,
    total: mySites.length,
    up: counts.up, down: counts.down, blocked: counts.blocked,
    unreachable: counts.unreachable, pending: counts.pending,
    stale: age.stale, ageMin: age.ageMin
  }, 200, 120);
}

// Is the monitor itself healthy? Used by the GitHub heartbeat job.
async function handleHealth(env) {
  const { state, mySites } = await loadAll(env);
  const map = (state && state.map) || {};
  const age = ageInfo(state, Date.now());
  const counts = countStatuses(mySites, map);
  const problems = [];
  if (!state) problems.push('no data yet');
  else if (age.stale) problems.push('no check has finished for ' + (age.ageMin == null ? 'a long time' : age.ageMin + ' minutes'));
  if (state && state.listError) problems.push('could not read info.json: ' + state.listError);
  if (!mySites.length) problems.push('site list is empty');
  const body = {
    ok: problems.length === 0,
    problems,
    version: VERSION,
    updated: (state && state.updated) || null,
    ageMin: age.ageMin,
    total: mySites.length,
    counts,
    cursor: state ? state.cursor : null
  };
  return json(body, body.ok ? 200 : 503);
}

export default {
  async scheduled(event, env) {
    await scheduleSweep(env, event && event.scheduledTime);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET' && url.pathname === '/status') {
      return edgeCached(request, ctx, STATUS_CACHE_S, () => handleStatus(env));
    }
    if (request.method === 'POST' && url.pathname === '/report') return handleReport(request, env);
    if (request.method === 'POST' && url.pathname === '/suggest') return handleSuggest(request, env);
    if (request.method === 'GET' && url.pathname === '/summary') return handleSummary(env);
    if (request.method === 'GET' && url.pathname === '/health') return handleHealth(env);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Sakura monitor</title><h1>Sakura monitor worker</h1><p>OK. <code>/status</code> site results, <code>/summary</code> counts, <code>/health</code> monitor health, <code>POST /report</code> visitor reports, <code>POST /suggest</code> site suggestions.</p>',
        { status: 200, headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS) }
      );
    }
    return json({ error: 'not found' }, 404);
  }
};
