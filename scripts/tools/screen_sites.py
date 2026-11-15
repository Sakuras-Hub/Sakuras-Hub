"""Screen sites against Google Safe Browsing and flag the dangerous ones.

A site that Safe Browsing lists for malware, phishing, unwanted software or a
harmful app gets  "avoid": true  and a reason in info.json. The directory then
shows it with a warning, and the Discord feed posts it as "Flagged as risky".
Nothing is deleted.

    python scripts/tools/screen_sites.py --new-only --before old.json   # only sites not in old.json
    python scripts/tools/screen_sites.py --all                          # the whole list

--all also removes flags that THIS tool set earlier (reason starts with
"Google Safe Browsing:") when the site is clean again. Flags you or the source
lists set by hand are never touched.

Needs a free API key in the SAFE_BROWSING_API_KEY environment variable
(GitHub secret). Without a key this prints a note and does nothing, so the
workflows keep working. If the API errors, nothing is flagged or unflagged.

Get a key: Google Cloud Console > create a project > enable "Safe Browsing API"
> Credentials > Create API key. Safe Browsing is free for non-commercial use;
see https://developers.google.com/safe-browsing/v4/usage-limits
"""
import json
import os
import sys
import urllib.error
import urllib.request

INFO_JSON = os.environ.get("INFO_JSON", "need for the website to work/info.json")
API_URL = os.environ.get("SAFE_BROWSING_URL", "https://safebrowsing.googleapis.com/v4/threatMatches:find")
BATCH = 500                      # the API allows up to 500 URLs per request
PREFIX = "Google Safe Browsing:"
LABELS = {
    "MALWARE": "malware",
    "SOCIAL_ENGINEERING": "phishing or deceptive site",
    "UNWANTED_SOFTWARE": "unwanted software",
    "POTENTIALLY_HARMFUL_APPLICATION": "harmful app",
}


def norm(url):
    u = (url or "").strip().lower()
    for p in ("https://", "http://"):
        if u.startswith(p):
            u = u[len(p):]
    if u.startswith("www."):
        u = u[4:]
    return u.rstrip("/")


def check_batch(urls, key):
    """Return {url: [threat types]} for the URLs Safe Browsing lists. Raises on API trouble."""
    body = {
        "client": {"clientId": "sakuras-hub", "clientVersion": "1.0"},
        "threatInfo": {
            "threatTypes": list(LABELS),
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": u} for u in urls],
        },
    }
    req = urllib.request.Request(
        f"{API_URL}?key={key}", data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "SakurasHub-screen/1.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8") or "{}")
    hits = {}
    for m in data.get("matches", []):
        hits.setdefault(m.get("threat", {}).get("url"), []).append(m.get("threatType"))
    return hits


def main():
    args = sys.argv[1:]
    key = os.environ.get("SAFE_BROWSING_API_KEY", "").strip()
    if not key:
        print("SAFE_BROWSING_API_KEY is not set; skipping the safety screening.")
        return 0
    if "--all" not in args and "--new-only" not in args:
        print(__doc__)
        return 1

    with open(INFO_JSON, encoding="utf-8") as f:
        sites = json.load(f)

    if "--new-only" in args:
        before_path = args[args.index("--before") + 1] if "--before" in args else ""
        try:
            with open(before_path, encoding="utf-8") as f:
                old = {norm(s.get("url")) for s in json.load(f)}
        except Exception:
            print("No usable 'before' list; skipping so a first run does not screen everything.")
            return 0
        targets = [s for s in sites if norm(s.get("url")) not in old]
    else:
        targets = list(sites)

    targets = [s for s in targets if str(s.get("url", "")).startswith(("http://", "https://"))]
    if not targets:
        print("Nothing to screen.")
        return 0

    hits, ok_urls = {}, set()
    for i in range(0, len(targets), BATCH):
        part = [s["url"] for s in targets[i:i + BATCH]]
        try:
            hits.update(check_batch(part, key))
            ok_urls.update(part)
        except (urllib.error.URLError, OSError, ValueError) as e:
            print(f"Safe Browsing request failed ({type(e).__name__}); leaving those {len(part)} sites unchanged.")

    flagged = unflagged = 0
    for s in targets:
        u = s["url"]
        if u not in ok_urls:
            continue                         # no answer: never change anything on a failed lookup
        if u in hits:
            kinds = sorted({LABELS.get(t, str(t).lower()) for t in hits[u]})
            if not s.get("avoid"):
                s["avoid"] = True
                s["avoid_reason"] = f"{PREFIX} {', '.join(kinds)}"
                flagged += 1
                print(f"flagged: {s.get('name')} ({u}): {', '.join(kinds)}")
        elif "--all" in args and s.get("avoid") and str(s.get("avoid_reason", "")).startswith(PREFIX):
            s["avoid"] = False
            s["avoid_reason"] = ""
            unflagged += 1
            print(f"cleared: {s.get('name')} ({u}) is clean again")

    if flagged or unflagged:
        with open(INFO_JSON, "w", encoding="utf-8") as f:
            json.dump(sites, f, indent=2, ensure_ascii=False)     # same format as the updater
    print(f"Screened {len(ok_urls)} of {len(targets)} sites: {flagged} flagged, {unflagged} cleared.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
