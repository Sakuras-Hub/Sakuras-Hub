# Sakura's Hub: what every file is

Upload everything in this folder to the root of the repo (same level as `.github`).
Do NOT rename the `need for the website to work` folder: the Cloudflare worker and
the updater read `info.json` from that exact path on GitHub.

## Website (root)
| File | What it is |
|---|---|
| `index.html` | The hub: four buttons and the Discord / Telegram links |
| `directory.html` | The directory: sites, Guides and Monitor tabs, "Last updated" date |
| `products.html` | Products page |
| `about.html` | About Me, including the Custom work section |
| `donate.html` | Support page with wallet addresses and QR codes |
| `disclaimer.html` | Disclaimer and privacy page (linked in every footer). Update the date on it when you change it |
| `faq.html` | Common questions (broken links, favorites, privacy, custom work). Edit the answers in the file |
| `manifest.webmanifest` | Lets visitors install the site as an app. Icons are in `assets/` |
| `404.html` | "Page not found" page (GitHub Pages and Vercel both use it automatically) |
| `assets/` | Site icons and the Inter font |
| `errors/` | Spare error pages (400 401 403 405 408 410 429 500-504), only for Apache / nginx hosting |
| `preview.png` | Image shown when the link is shared |
| `robots.txt`, `sitemap.xml` | Search engine files |
| `.nojekyll` | Only matters on GitHub Pages. Safe to leave |
| `vercel.json`, `.vercelignore` | Vercel settings (see Deploying on Vercel) |

## Data
| Path | What it is |
|---|---|
| `need for the website to work/info.json` | The master list of sites (about 6,500). The daily job adds to it, the weekly job removes dead ones, and the Cloudflare worker reads it. This folder name must stay as it is |
| `status/status.json` | Saved snapshot of site up/down checks. Shown on the Monitor tab when the worker can't be reached |
| `script-hub-data/` | Data for the Script Hub on the Products page: `main_script.json` (the script), `supported_games.json`, `supported_executors.json`, `changelog.json`, plus `vouches.json` and `notes.md` (old, unused). **The Products page reads these files live from GitHub, so edits show up without redeploying.** It tries `script-hub-data/` first, then the old `need for the website to work/` folder, then a copy pasted into `products.html` if GitHub can't be reached. Point any bot or script that edits these files at `script-hub-data/` |

## Automation (GitHub Actions, `.github/workflows/`)
| File | What it does |
|---|---|
| `update-links.yml` | Every day at 06:00 UTC runs `scripts/updater.py --merge` to add new sites to `info.json` |
| `prune-dead.yml` | Every Monday at 04:00 UTC asks the monitor worker which sites are dead, removes them from `info.json` and adds them to `scripts/dead_sites.txt` |

## Scripts (`scripts/`)
| Path | What it does |
|---|---|
| `updater.py` | Used by the daily job. Pulls new sites from outside lists and merges them into `info.json` |
| `dead_sites.txt` | Blocklist of dead sites so they don't come back. Must stay next to `updater.py` |
| `tools/` | Manual helpers, not used by the automation: `set-site-address.py` (changes the site address everywhere), `inject-monitor.py` and `inject-vouches.py` (paste code into `directory.html`; run from the repo root) and `fetch_vouches.py` |
| `page-code/` | Code the inject tools paste into the page: `monitor.js` (monitor panel), `vouches.js`, `dpad.js` (gamepad navigation) |

## Cloudflare worker (`monitor-worker/`)
| File | What it does |
|---|---|
| `worker.js` | Checks the sites every 2 minutes in small batches and serves results at `/status` and a small `/summary` (used by the hub's status badge) |
| `wrangler.toml` | Worker settings (cron schedule, storage) |
| `SETUP.md` | Step-by-step deploy guide |

Deploy or update it with `npx wrangler deploy` from inside `monitor-worker/`. The hub's "sites up" badge only appears after this deploy.

## Deploying on Vercel
1. Go to vercel.com, choose **Add New > Project** and import the `Sakuras-Hub` repo.
2. Set **Framework Preset** to **Other**. Leave Build Command, Output Directory and Install Command empty.
3. Click **Deploy**. Every push to `main` redeploys the site.
4. Run `python scripts/tools/set-site-address.py https://your-address` once you know the final address (the `.vercel.app` one or your own domain), then commit. This updates the canonical links, share previews, `sitemap.xml` and `robots.txt`.

How the repo is set up for it:
- `vercel.json` turns on clean addresses, so `yoursite.com/directory`, `/products`, `/about` and `/donate` open the right page (the `.html` versions redirect to them). It also adds security headers, caches `assets/` for a week, and skips a redeploy when a push only touches data or scripts (the daily `info.json` update does not rebuild the site).
- `.vercelignore` keeps `scripts/`, `monitor-worker/`, the data folders and `.github/` out of the deployed site. They stay in GitHub.
- `404.html` is used automatically for any missing page. Vercel does not let a static site customize other error codes, so the pages in `errors/` only matter on a host you control.
- The Cloudflare worker allows any website to read its `/status`, so the Monitor tab works on Vercel without changes.

## Testing on your computer (no publishing)
Open the site from a small local server, not by double-clicking the HTML files.

### Linux (CachyOS / Arch)
Quick test with Python (already installed):
```
cd ~/path/to/Sakuras-Hub
python -m http.server 8000
```
Open `http://localhost:8000`. Use `/directory.html` style addresses, and the custom 404 page won't show.

Closest to Vercel, with clean addresses like `/directory` and the custom 404 page:
```
sudo pacman -S nodejs npm
cd ~/path/to/Sakuras-Hub
npx serve .
```
Open `http://localhost:3000`.

Exact Vercel behavior (asks you to log in once, publishes nothing):
```
npx vercel dev
```

### Windows
Install Node from nodejs.org, or run `winget install OpenJS.NodeJS.LTS`. Then open the `Sakuras-Hub` folder in File Explorer, click the address bar, type `cmd` and press Enter:
```
npx serve .
```
Open `http://localhost:3000`.

No Node? If Python is installed, run `py -m http.server 8000` and open `http://localhost:8000`.

### Stop the server
Press Ctrl+C in the window.

### What to check
- Every page opens from the hub buttons and the footer links.
- `/directory`, `/products`, `/about`, `/donate`, `/disclaimer` open (with `serve` or `vercel dev`).
- A made-up address like `/nope` shows the custom 404 page (with `serve` or `vercel dev`).
- The Directory Monitor tab shows live numbers.
- The Script Hub tab loads, and the Copy button on the Donate page copies an address.

## Things to edit by hand
- **Directory "Last updated"**: in `directory.html` search `Last updated`; change the text AND `datetime="YYYY-MM-DD"`. Also update `lastmod` in `sitemap.xml`.
- **Wallet addresses**: `donate.html`. The QR codes and Copy buttons read the address text, so edit only the text.
- **Monitor address**: `MONITOR_API_URL` in `directory.html` and `scripts/page-code/monitor.js` use `https://sakura-monitor.fadded-market.workers.dev/status`. Change both if you ever move the worker.
- **Site address**: pages and `sitemap.xml` use `https://sakuras-hub.github.io/Sakuras-Hub/` until you run `set-site-address.py`.

## Preview images

`preview.png` is the hub's share image. `assets/og-*.png` are the share images for the other pages (Discord and Telegram show them in link previews).

## Cleaning the Directory list

The daily updater only adds new sites. Categories were cleaned by hand in `need for the website to work/info.json`. Streaming categories hold streaming sites only. Tools, guides and downloads sit in their own categories. Sites you never want back go in `scripts/dead_sites.txt`.


## Discord feed (everything that happens to the directory)
One channel shows all of it. Set it up once:
1. Make a webhook in Discord (channel settings > Integrations > Webhooks).
2. GitHub repo > Settings > Secrets and variables > Actions > New repository secret. Name: `DISCORD_WEBHOOK_URL`, value: the webhook address.
3. Worker: `cd monitor-worker && npx wrangler secret put DISCORD_WEBHOOK_URL`, then `npx wrangler deploy`.
4. Optional: add a repository *variable* `SITE_BASE_URL` (your final site address) so the links in posts are right.

| What | Posted by |
|---|---|
| New sites, removed sites, sites flagged / un-flagged as risky, renamed or moved sites | GitHub Actions (daily update, weekly cleanup, and `notify-changes.yml` for edits you push by hand) |
| A site went down, came back, dead for 21 days, daily status digest | The Cloudflare worker |
| A job failed | The GitHub job that failed |

Adult sites are only counted, never named (add `--show-nsfw` in the workflow, or set the `DISCORD_SHOW_NSFW=1` env var, to change that). Posts cannot ping anyone. Never put the webhook address in a file in the repo.

## New directory features
`scripts/page-code/extras.js` and `extras.css` hold: typo-tolerant search (Fuse.js, `assets/vendor/`), Ctrl/Cmd+K quick search, Recently visited, shareable links (`directory?cat=manga&q=fire`) and a one-time safety tip. After editing them run `python scripts/tools/inject-extras.py`.

## Section pages (for search engines)
`python scripts/tools/build-sections.py` writes `sections/*.html` (plain HTML lists, no adult or flagged sites) and adds them to `sitemap.xml`. The daily and weekly jobs run it for you. After you change the site address run `set-site-address.py` and then `build-sections.py`.

## Other tools
`scripts/tools/optimize-images.py` shrinks share-preview images. `scripts/tools/discord_notify.py` is the Discord poster (try it with `--dry-run`). Fuse.js is Apache-2.0 licensed (`assets/vendor/fuse.LICENSE.txt`).

## Security headers
`vercel.json` enforces a safe subset of a Content-Security-Policy and sends the full policy as *Report-Only*. After deploying, open each page with the browser console open: if you see "Content Security Policy" warnings, a host is missing from the list. When there are none, rename the header `Content-Security-Policy-Report-Only` to `Content-Security-Policy` and add `script-src`, `connect-src` etc. to the enforced one.


## Staying hands-off (what watches what)
| Job | Runs | What it does |
|---|---|---|
| Cloudflare worker | every 2 min | checks sites, flags down / back / moved / parked, serves `/status` `/summary` `/health` |
| `update-links.yml` | daily 06:00 UTC | pulls new sites from the source lists, rebuilds `sections/`, posts to Discord |
| `prune-dead.yml` | weekly, Monday | takes the worker's 21-day-dead list, **re-checks each from GitHub's network**, removes only the ones dead from both |
| `heartbeat.yml` | every 6 hours | alerts Discord if the worker stalls or the daily update is late, and turns scheduled jobs back on if GitHub switched them off |
| `notify-changes.yml` | when you push edits to info.json | posts your manual changes to Discord |

One-time cleanup: older monitors treated bot-protected ("blocked") sites as dead after 21 days, so some live sites may be on `scripts/dead_sites.txt`. On your own computer run `python scripts/tools/recheck_blocklist.py` to list them and `--apply` to take them off.


## Added in the last round
**Visitor reports.** The flag button on each card opens a small form. It sends the report to the worker (`POST /report`), which posts it to Discord. Limits: 3 per person per 10 minutes, 100 a day in total, only sites that are really in the list, spam trap field, adult site names hidden. If the worker can't take it, the page falls back to the old "copy and open a Discord ticket" way. To allow reports only from your own site, set `ALLOWED_ORIGINS` (e.g. `https://yoursite.com`) on the worker.

**Malware and phishing screening (optional).** Daily, new sites are checked against Google Safe Browsing; weekly, the whole list is. Dangerous ones get the "avoid" warning and are posted to Discord as risky. Nothing is deleted, and flags you set by hand are never changed. It needs a free API key: Google Cloud Console > new project > enable "Safe Browsing API" > Credentials > API key. Add it as the repository secret `SAFE_BROWSING_API_KEY`. Without it this step does nothing.

**New-sites feed.** `feed.xml` (Atom) lists newly added sites. It is linked from the home page and directory, and fills up from the next daily update.

**Two Discord channels (optional).** Add a second webhook as the secret `DISCORD_WEBHOOK_URL_ALERTS` (and, for the worker, `npx wrangler secret put DISCORD_WEBHOOK_URL_ALERTS`). Then new / removed / risky sites go to the main channel, and monitor alerts, visitor reports, job failures and heartbeat warnings go to the second one. Without it, everything goes to the main channel.

**Tests.** `tests/` holds automatic tests. GitHub runs them on every push (Actions tab > Tests). A red cross means something you changed broke a feature.

**Dependabot.** `.github/dependabot.yml` opens a pull request monthly when an Action you use has a new version.

### Turn on in GitHub settings (one-time, can't be done from a file)
Repo > Settings > Code security: enable **Secret scanning** and **Push protection**. If a webhook address or key is ever committed by accident, GitHub warns or blocks it.


## The last round of additions
**Suggest a site.** The directory has a "+ Suggest a site" button (also in Ctrl+K and when a search finds nothing). It posts to Discord for you to review. The address is shown as plain text, never a clickable link. Only public web addresses are accepted, and sites already in the list are answered with "already listed". Limits: 3 per person per 10 minutes, 50 a day. To add one you approve: `python scripts/tools/add_site.py example.com "Example" "Anime Streaming"` (wrong section? it lists the real ones), then commit and push.

**Offline support.** `sw.js` (service worker) and `offline.html`. Pages: network first, saved copy only if the network fails or takes 4+ seconds, then a friendly offline page. Images, icons and fonts: saved copy first, refreshed in the background. Everything else (the site list, monitor, Discord, other websites) is untouched. To make every visitor drop old files after a big change, bump `VERSION` at the top of `sw.js`.

**Speed.** Cards that are off screen are skipped by the browser when drawing (`content-visibility`). This is invisible when it works and ignored by browsers that don't support it. Not measured in a real browser here: the weekly Lighthouse check will tell you.

**Weekly Lighthouse check.** `lighthouse.yml` opens your live site in real Chrome every Sunday and posts speed, accessibility, best practices and SEO scores to Discord (alerts channel), with a warning sign below the limits. It needs the `SITE_URL` variable. Full reports are kept as a download on the workflow run.

**Accessibility tests.** `tests/a11y.test.mjs` scans every page with axe-core on every push. It cannot judge colour contrast (that needs a real browser; Lighthouse covers it).

**Update flow for new sites at a glance:** visitor suggests > Discord > you run `add_site.py` > push > Discord post, section page and feed update, safety screening.
