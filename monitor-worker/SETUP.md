# Site Monitor Worker — Setup Guide

The monitor panel on the site no longer pings 840+ sites from each visitor's
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

For the first ~22 minutes after a fresh deploy it returns `503` with
`"no data yet"` — the cron sweep fills in as it goes. After one full pass,
all 840+ sites have statuses.

## 5. Wire the page to the worker

Open `scripts/monitor.js` in the site and set the API URL (currently an
empty string on line 2):

```js
var MONITOR_API_URL = ''; // e.g. 'https://monitor.YOUR-SUBDOMAIN.workers.dev/status' — see SETUP.md
```

becomes:

```js
var MONITOR_API_URL = 'https://sakura-monitor.<your-subdomain>.workers.dev/status';
```

Commit and push `scripts/monitor.js` (and `index.html`, which already has
the new monitor code). GitHub Pages redeploys automatically.

## 6. How it works

- Cron `* * * * *` (every minute): probe the next 40 sites. Each probe is a
  single GET — headers only, body never read — 6s timeout, 5 in parallel,
  so a tick finishes in well under a minute. A full sweep of ~840 sites
  takes ~22 minutes.
- Classification:
  - `up` — HTTP 2xx/3xx
  - `blocked` — 401/403/451, a Cloudflare challenge (`cf-mitigated`), or a
    connection-level failure (timeout, DNS/TLS error)
  - `down` — any other 4xx/5xx
- Results are kept in KV. The page's Monitor panel polls `GET /status`
  every 5 minutes while open; the "⟳ Re-check" button polls on demand.
- The site list auto-refreshes from `info.json` (max once per 6 hours).
  Statuses for removed sites are pruned automatically.

## 7. Adding / removing sites

Edit `info.json`, commit, push. The worker picks the change up on its next
list refresh (≤ 6h) — no worker changes or redeploys needed.

## 8. Free-tier budget (Cloudflare pricing docs, 2026)

| Limit (free)          | Our usage                          |
|-----------------------|------------------------------------|
| Requests 100k/day     | ~288/day (page polls)              |
| Subrequests 50/req    | ≤ 40/tick (one GET per site)       |
| KV reads 100k/day     | ~700/day                           |
| KV writes 1k/day      | ~44/day                            |
| KV deletes 1k/day     | ~1/day (guard flag)                |
| Cron min interval 1m  | used — `* * * * *`                 |

Plenty of headroom at 840 sites; the design scales past 1,000 sites without
changing anything.

## 9. Troubleshooting

- Monitor panel shows "Monitor API not configured — see SETUP.md":
  `MONITOR_API_URL` is still empty in `scripts/monitor.js`.
- `/status` returns 503 "no data yet": the first sweep hasn't finished
  (wait up to ~22 min after deploy).
- Statuses look stale: reopen the panel or hit "⟳ Re-check".
- Anything weird: `npx wrangler tail` streams worker logs live.
- Reset: KV is the only state. Delete the `statuses` and `sites` keys in
  the KV namespace (dashboard or `wrangler kv key delete`) and the worker
  starts fresh on the next cron tick.