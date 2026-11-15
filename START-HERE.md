# Start here

One page with everything to set up, in order. Do it once, then the site looks after itself.
(Longer explanations: `SITE-GUIDE.md` and `monitor-worker/SETUP.md`.)

## 1. Make a Discord webhook (2 minutes)
Discord > your channel > Edit channel > Integrations > Webhooks > New Webhook > Copy Webhook URL.
Treat it like a password. Never paste it into a file in this repo. Optional: make a second webhook in another channel for alerts.

## 2. Add the GitHub secrets and variables
Repo > Settings > Secrets and variables > Actions.

| Name | Type | Required? | What it is |
|---|---|---|---|
| `DISCORD_WEBHOOK_URL` | Secret | yes | main channel: new / removed / risky sites |
| `DISCORD_WEBHOOK_URL_ALERTS` | Secret | no | second channel: monitor alerts, reports, failures. Skip to use one channel |
| `SAFE_BROWSING_API_KEY` | Secret | no | free Google key; turns on malware / phishing screening (see SITE-GUIDE.md) |
| `SITE_URL` | Variable | no | your final website address; the heartbeat warns you if it goes down, and the weekly Lighthouse check uses it |
| `SITE_BASE_URL` | Variable | no | same address; makes the links inside Discord posts correct |

Also: Settings > Code security > turn on **Secret scanning** and **Push protection**.

## 3. Deploy the monitor worker
From the `monitor-worker/` folder on your computer:

    npx wrangler secret put DISCORD_WEBHOOK_URL          (paste the webhook)
    npx wrangler secret put DISCORD_WEBHOOK_URL_ALERTS   (optional, second webhook)
    npx wrangler deploy

Then open `https://sakura-monitor.fadded-market.workers.dev/health`. After a few minutes it should say `"ok": true`.
Optional worker setting: `ALLOWED_ORIGINS` = your site address, so only your site can send reports.

## 4. Pick your final website address, then run these once
    python scripts/tools/set-site-address.py https://your-final-address
    python scripts/tools/build-sections.py
    python scripts/tools/build-feed.py
Commit and push. Then submit `sitemap.xml` in Google Search Console and Bing Webmaster Tools so the new pages get indexed.

## 5. Try everything once by hand
Repo > Actions > pick each workflow > **Run workflow**: Update links, Prune dead sites, Heartbeat.
Check the Discord posts look right and the **Tests** workflow has a green tick.
Open the live site on your phone and on a computer with the browser console open. If you see "Content Security Policy" warnings, a host is missing from `vercel.json`. If there are none, rename the header `Content-Security-Policy-Report-Only` to `Content-Security-Policy` (see SITE-GUIDE.md).

## 6. One-time cleanup (on your own computer)
Older monitors could wrongly blacklist live sites that sit behind bot protection:

    python scripts/tools/recheck_blocklist.py            (lists them)
    python scripts/tools/recheck_blocklist.py --apply    (takes them off the blocklist)

## What runs by itself after that
| What | When | Result |
|---|---|---|
| Monitor worker | every 2 minutes | checks sites; Discord: down / back / moved / dead; daily status at 12:00 UTC |
| Update links | daily 06:00 UTC | new sites added and screened, section pages and feed rebuilt, Discord post |
| Prune dead sites | Mondays | removes sites dead for 21+ days that are dead from GitHub's network too, re-screens everything |
| Heartbeat | every 6 hours | warns you if the worker, the daily update or the website stops; re-enables jobs GitHub switches off |
| Lighthouse | Sundays | opens your live site in Chrome, posts speed / accessibility / SEO scores to Discord (needs `SITE_URL`) |
| Tests | every push | red cross = something you edited broke a feature |

## If something looks wrong
- **Discord is quiet.** Normal on days with no changes. Run the Heartbeat workflow by hand; it posts only if there is a problem.
- **A red cross on a workflow.** Open it in the Actions tab. You also get a Discord alert for failed update and cleanup jobs.
- **The Monitor tab is empty.** Open the worker's `/health` address. It lists what is wrong.
- **A visitor suggested a site you like.** Run `python scripts/tools/add_site.py example.com "Name" "Section"`, then commit and push.
- **You want a site gone or fixed.** Edit `need for the website to work/info.json` and push; the change is announced in Discord.
