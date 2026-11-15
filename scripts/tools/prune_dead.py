"""Remove dead sites from info.json, with a second opinion.

The Cloudflare worker lists sites that have been dead for 21+ days
(/status -> removed[]). Before deleting any of them this script checks each one
again from this machine (GitHub's network, not Cloudflare's). Only sites that are
dead from here too are removed and added to the blocklist.

A site is kept if:
  - the worker's last verdict was "blocked" (the server answered, it just refused the bot)
  - it answers from here with anything except 404, 410 or a 5xx error
    (401, 403, 429 and redirects all mean "alive, just guarded")

    python scripts/tools/prune_dead.py                # from the repo root
    MONITOR_API_URL=... python scripts/tools/prune_dead.py

Exit code 0 on success (even when nothing is pruned), 1 if the worker cannot be read.
"""
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

MONITOR_API_URL = os.environ.get("MONITOR_API_URL", "https://sakura-monitor.fadded-market.workers.dev/status")
INFO_JSON = os.environ.get("INFO_JSON", "need for the website to work/info.json")
BLOCKLIST = os.environ.get("BLOCKLIST", "scripts/dead_sites.txt")
CHECK_TIMEOUT = 15
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")


def norm(url):
    return (url or "").strip().lower().rstrip("/")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def alive_from_here(url):
    """(alive: bool, why: str). Alive = the server answered with something other than gone/error."""
    ctx = ssl.create_default_context()
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=ctx))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.8",
                                               "Accept-Language": "en-US,en;q=0.9"})
    try:
        with opener.open(req, timeout=CHECK_TIMEOUT) as r:
            return True, f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        if e.code in (404, 410) or e.code >= 500:
            return False, f"HTTP {e.code}"
        return True, f"HTTP {e.code}"            # 3xx / 401 / 403 / 429 ...: it is there
    except (urllib.error.URLError, socket.timeout, ssl.SSLError, ConnectionError, OSError) as e:
        return False, type(getattr(e, "reason", e)).__name__
    except Exception as e:                        # anything odd: do not delete on a hunch
        return True, f"unchecked ({type(e).__name__})"


def fetch_removed():
    req = urllib.request.Request(MONITOR_API_URL, headers={"User-Agent": "SakurasHub-prune/2.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("removed") or []


def main():
    try:
        removed = fetch_removed()
    except Exception as exc:
        print(f"ERROR: failed to fetch {MONITOR_API_URL}: {exc}")
        return 1

    candidates, kept_blocked = [], 0
    for e in removed:
        if not e.get("url"):
            continue
        if e.get("lastStatus") == "blocked":
            kept_blocked += 1
            continue
        candidates.append(e)

    with ThreadPoolExecutor(max_workers=12) as pool:
        verdicts = list(pool.map(lambda e: alive_from_here(e["url"]), candidates))

    confirmed, rescued = [], []
    for e, (alive, why) in zip(candidates, verdicts):
        (rescued if alive else confirmed).append((e, why))
    for e, why in rescued:
        print(f"keeping {e['url']}: still answers from here ({why})")

    dead_urls = {norm(e["url"]) for e, _ in confirmed}
    dead_slugs = {e.get("slug") for e, _ in confirmed if e.get("slug")}

    with open(INFO_JSON, "r", encoding="utf-8") as fh:
        entries = json.load(fh)
    before = len(entries)
    kept = [x for x in entries if norm(x.get("url")) not in dead_urls and x.get("slug") not in dead_slugs]
    pruned = before - len(kept)

    block = []
    if os.path.exists(BLOCKLIST):
        with open(BLOCKLIST, "r", encoding="utf-8") as fh:
            block = [norm(line) for line in fh.read().splitlines() if line.strip()]
    seen = set(block)
    for url in sorted(dead_urls):
        if url and url not in seen:
            seen.add(url)
            block.append(url)

    if pruned:
        with open(INFO_JSON, "w", encoding="utf-8") as fh:
            json.dump(kept, fh, indent=2, ensure_ascii=False)   # same format as the updater (no trailing newline)
    with open(BLOCKLIST, "w", encoding="utf-8") as fh:
        fh.write("\n".join(block) + ("\n" if block else ""))

    print(f"worker listed {len(removed)} dead sites: {kept_blocked} skipped (only blocked), "
          f"{len(rescued)} still alive from here, {len(confirmed)} confirmed dead.")
    print(f"pruned {pruned} (was {before}, now {len(kept)}), blocklist now {len(block)} urls")
    return 0


if __name__ == "__main__":
    sys.exit(main())
