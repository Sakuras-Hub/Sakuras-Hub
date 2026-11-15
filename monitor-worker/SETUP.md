# Site Monitor Worker: Setup Guide

The monitor panel on the site no longer pings sites from each visitor's
browser. This Worker probes them server-side on a rolling cron sweep, caches
results in Cloudflare KV, and the page just polls one lightweight endpoint.

Files in this folder:
- `worker.js`: the Worker (sweep + probe + `GET /status`)
- `wrangler.toml`: deploy config (cron trigger, KV binding)

---

## 1. Prerequisites

- Node.js 18+ (LTS recommended), npm available
- A Cloudflare account (free tier is enough), https://dash.cloudflare.com/sign-up

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

Run this again whenever `worker.js` changes. The hub's live status badge
uses the `/summary` route and stays hidden until the worker is redeployed.

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
`"no data yet"`, the cron sweep fills in as it goes. After one full pass,
all sites have statuses.

## 5. Wire the page to the worker

Open `scripts/page-code/monitor.js` in the site and set the API endpoint(s).
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
  10 in parallel, 5s timeout each, with a 20s budget per tick. A tick that
  runs long stops starting new probe rounds and still writes state, so the
  cursor can never wedge on one slow chunk (it only advances past sites that
  were actually probed). A full sweep of ~6,300 sites takes ~10.5 hours, and
  each site keeps its last 24 probe verdicts.
- Classification:
  - `up`: HTTP 2xx/3xx
  - `blocked`: 401/403/451, a Cloudflare challenge (`cf-mitigated`)
  - `down`: any other 4xx/5xx
  - `unreachable`: connection-level failure (timeout, DNS/TLS error)
- Hysteresis (`CONFIRM_COUNT=3`): a site only flips to a non-up status
  after 3 consecutive non-up probes (marked `flapping` in between). Once
  confirmed dead for `REMOVE_AFTER_DAYS=21` days, it moves to
  `state.removed[]` and is hidden from the monitor list entirely.
  Removed entries older than 90 days are pruned.
- Provenance / de-listing: the monitor page hides sites that are confirmed
  dead for over 3 weeks, which keeps the list honest without manual edits.
- Stats: every site also carries a compact probe history (`h`, 24 verdict
  chars: `0`=up `1`=blocked `2`=down `3`=unreachable) and a rolling mean
  response time (`avgMs`). `/status` derives `uptime: {pct, up, total}` per
  site and exposes `historyWindow`, so the panel can show a real uptime
  column, per-site sparkline and section-health table instead of guessing
  from the latest check. They ride along with the state key, no extra KV
  reads or writes.
- State lives in ONE KV key (`state`): `{updated, cursor, map, removed}`.
  One KV read + one KV write per tick, with a sliding 7-day TTL. No guard
  flags, no per-site keys, no deletes, a crashed tick just re-probes the
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
list refresh (≤ 6h), no worker changes or redeploys needed. The blocklist
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
| Cron min interval 1m  | `*/2`, 720 ticks/day              |

The 48-fetch cap per tick keeps every tick under the 50-subrequest limit
with headroom; timing worst case is 4 rounds × 7s = 28s < 30s. The design
scales past 10,000 sites via sharding, still one write per shard per tick.

## 9. Troubleshooting

- Monitor panel shows "Monitor API not configured, see SETUP.md":
  `MONITOR_API_URLS` is empty in `scripts/page-code/monitor.js`.
- `/status` returns 503 "no data yet": the first sweep hasn't run yet
  (wait up to ~2 min after deploy).
- Statuses look stale: reopen the panel or hit "⟳ Re-check".
- Anything weird: `npx wrangler tail` streams worker logs live.
- Reset: KV is the only state. Delete the `state` key in the KV namespace
  (dashboard or `wrangler kv key delete`) and the worker starts fresh on
  the next cron tick.

Quick check for the hub badge:

```
curl https://sakura-monitor.<your-subdomain>.workers.dev/summary
```


## Discord feed (optional)

The worker can post confirmed changes to a Discord channel: a site went down, a site came back, a site has been dead long enough to be queued for removal, and one status digest a day (12:00 UTC).

1. In Discord: channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL.
2. From this folder run `npx wrangler secret put DISCORD_WEBHOOK_URL` and paste the address.
3. `npx wrangler deploy`.

Treat the address like a password. Do not put it in any file in the repo. If it leaks, delete the webhook in Discord and make a new one.
Adult sites are only counted, not named. New, removed and risky-flagged sites are posted by the GitHub Actions, not by the worker (see SITE-GUIDE.md).


## What changed in v3 (this version)
- **Fast detection.** A site that fails a check is re-checked every ~4 minutes, so a dead site is confirmed in under 10 minutes (was about 29 hours). Confirmed-dead sites are re-checked hourly, so recoveries show up within about an hour.
- **Blocked is not dead.** A site that answers 403 / 401 / a bot challenge is alive. It no longer counts toward the 21-day removal timer.
- **Parked and moved sites.** A tiny "this domain is for sale" page counts as down. A site that redirects to another domain is reported once as *moved* (it stays up). Turn off with `DETECT_PARKED=0` / `NOTIFY_MOVED=0`.
- **`/health`** says whether the monitor itself is working. `/summary` carries a `stale` flag. `/status` is cached for 60 seconds at the edge.
- **Self-cleaning.** Results for sites no longer in info.json are dropped. If info.json can't be read, the old list keeps working and `/health` shows the problem.
- **Real subrequest counting**, so a tick never goes over the free-tier limit of 50.

Deploy: `npx wrangler deploy` from this folder (your KV data and history carry over). Then open `https://YOUR-WORKER.workers.dev/health`. After a few minutes it should say `"ok": true`.

### Splitting the work over more workers (only if you outgrow one)
Deploy a second copy under another name with its own KV namespace and set `SHARD_COUNT = "2"` in one and `SHARD_INDEX = "0"` / `"1"` in each. Each worker then watches half the sites. On a paid Workers plan you can also raise `CHUNK` (and `SUBREQUEST_LIMIT`, e.g. 1000) to probe more sites per run.


## Reports and a second channel
- `POST /report` takes `{url, reason, note}` from the directory's flag button and posts it to Discord. It needs the webhook secret above. Optional: `ALLOWED_ORIGINS` (comma-separated site addresses allowed to submit).
- `npx wrangler secret put DISCORD_WEBHOOK_URL_ALERTS` sends monitor alerts and reports to a separate channel. Skip it to keep everything in one channel.
- Reports use at most 100 KV writes a day (one per accepted report), on top of the ~720 the monitor uses, so the free tier's ~1,000 writes a day is still enough.

- `POST /suggest` takes `{url, name, section, note}` from the "Suggest a site" form and posts it to Discord. At most 50 a day (one KV write each), so the free tier's ~1,000 writes a day still holds (about 720 + 100 + 50). Redeploy with `npx wrangler deploy` to turn it on.
