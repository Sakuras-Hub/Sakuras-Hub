# Site Monitor Worker — Setup Guide

The monitor panel on the site no longer pings sites from each visitor's
browser. This Worker probes them server-side on a rolling cron sweep, caches
results in Cloudflare KV, and the page just polls one lightweight endpoint.

Files in this folder:
- `worker.js` — the Worker (sweep + probe + `GET /status`)
- `wrangler.toml` — deploy config (cron trigger, KV binding)

---

## 1. Prerequisites

- Node.js 18+ (LTS recommended), npm available
- A Cloudflare account (free tier is enough) — https://dash.cloudflare.com/sign-up

## 2. One-time login

```
npx wrangler login
```

Opens a browser; approve the access request.

## 3. Create the KV namespace

```
npx wrangler kv namespace create MONITOR_KV
```

This prints an `id`. Open `wrangler.toml` and replace
`PASTE_KV_NAMESPACE_ID_HERE` with that id.

(Optional, for dev builds: `npx wrangler kv namespace create MONITOR_KV --preview`
and paste the result into the `preview_id` line.)

## 4. Deploy

```
npx wrangler deploy
```

Wrangler prints the worker's URL, e.g.
`https://sakura-monitor.<your-subdomain>.workers.dev`.

Verify it works:

```
curl https://sakura-monitor.<your-subdomain>.workers.dev/status
```

For the first ~30 seconds after a fresh deploy it returns `503` with
`"no data yet"` — the cron sweep fills in as it goes. After one full pass,
all sites have statuses.

## 5. Wire the page to the worker

Open `scripts/monitor.js` in the site and set the API endpoint(s).
The default is already:

```js
var MONITOR_API_URLS = ['https://sakura-monitor.<your-subdomain>.workers.dev/status'];
```

For sharded deployments, list every shard:

```js
var MONITOR_API_URLS = [
  'https://sakura-monitor.<your-subdomain>.workers.dev/status',   // shard 0
  'https://sakura-monitor-shard1.<your-subdomain>.workers.dev/status' // shard 1
];
```

`MONITOR_API_URL` (single string) is still honored as a fallback.

Commit and push the page files. GitHub Pages redeploys automatically.

## 6. How it works

- Cron `*/2 * * * *` (every 2 minutes): probe the next chunk of 20 sites.
  5 in parallel, 7s timeout each, so a tick finishes well under the 30s
  wall-clock limit. A full sweep of 5,811 sites takes ~9.7 hours.
- Classification:
  - `up` — HTTP 2xx/3xx
  - `blocked` — 401/403/451, a Cloudflare challenge (`cf-mitigated`)
  - `down` — any other 4xx/5xx
  - `unreachable` — connection-level failure (timeout, DNS/TLS error)
- Hysteresis (`CONFIRM_COUNT=3`): a site only flips to a non-up status
  after 3 consecutive non-up probes (marked `flapping` in between). Once
  confirmed dead for `REMOVE_AFTER_DAYS=21` days, it moves to
  `state.removed[]` and is hidden from the monitor list entirely.
  Removed entries older than 90 days are pruned.
- Provenance / de-listing: the monitor page hides sites that are confirmed
  dead for over 3 weeks, which keeps the list honest without manual edits.
- State lives in ONE KV key (`state`): `{updated, cursor, map, removed}`.
  One KV read + one KV write per tick, with a sliding 7-day TTL. No guard
  flags, no per-site keys, no deletes — a crashed tick just re-probes the
  same chunk next time (idempotent merge).
- The site list auto-refreshes from `info.json` (max once per 6 hours),
  cached under a second KV key (`sites`).
- Sharding (optional): set `SHARD_COUNT` and `SHARD_INDEX` env vars (or
  wrangler `[vars]`) to split sites across multiple workers using a
  deterministic FNV-1a hash on the site slug. Each shard writes its own
  `state` key and `/status` includes `shard: {index, count}`. The page
  aggregates all shards via `MONITOR_API_URLS`.

## 7. Adding / removing sites

Edit `info.json`, commit, push. The worker picks the change up on its next
list refresh (≤ 6h) — no worker changes or redeploys needed. The blocklist
(`scripts/dead_sites.txt`) prevents known-dead sites from being re-added by
the merge updater.

## 8. Free-tier budget (Cloudflare pricing docs, 2026)

| Limit (free)          | Our usage                          |
|-----------------------|------------------------------------|
| Requests 100k/day     | ~10k/day (cron)                    |
| Subrequests 50/req    | ≤ 41/tick (20 sites × 1 retry + list refresh) |
| KV reads 100k/day     | ~1,500/day (2 keys/tick × 720 ticks) |
| KV writes 1k/day      | ~720/day (1 state write/tick)      |
| KV deletes 1k/day     | 0 (no deletes by design)           |
| Cron min interval 1m  | `*/2` — 720 ticks/day              |

The 48-fetch cap per tick keeps every tick under the 50-subrequest limit
with headroom; timing worst case is 4 rounds × 7s = 28s < 30s. The design
scales past 10,000 sites via sharding, still one write per shard per tick.

## 9. Troubleshooting

- Monitor panel shows "Monitor API not configured — see SETUP.md":
  `MONITOR_API_URLS` is empty in `scripts/monitor.js`.
- `/status` returns 503 "no data yet": the first sweep hasn't run yet
  (wait up to ~2 min after deploy).
- Statuses look stale: reopen the panel or hit "⟳ Re-check".
- Anything weird: `npx wrangler tail` streams worker logs live.
- Reset: KV is the only state. Delete the `state` key in the KV namespace
  (dashboard or `wrangler kv key delete`) and the worker starts fresh on
  the next cron tick.