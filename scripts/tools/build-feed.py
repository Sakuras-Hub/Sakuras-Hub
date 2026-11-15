"""Keep an Atom feed (feed.xml) of newly added sites.

The daily update runs this with the list from before and after the update:
    python scripts/tools/build-feed.py --before old.json --after "need for the website to work/info.json"
New sites (not adult, not flagged as risky) are added to scripts/recent-additions.json with
today's date, and feed.xml is rewritten from the newest 100. Run with no arguments to just
rebuild feed.xml from the saved list.

The feed only changes when something was added, so it never makes an empty commit.
"""
import datetime
import html
import json
import os
import re
import sys

STORE = "scripts/recent-additions.json"
FEED = "feed.xml"
KEEP = 100


def norm(url):
    u = (url or "").strip().lower()
    for p in ("https://", "http://"):
        if u.startswith(p):
            u = u[len(p):]
    if u.startswith("www."):
        u = u[4:]
    return u.rstrip("/")


def load_list(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("sites", []) if isinstance(data, dict) else data


def main():
    a = sys.argv[1:]
    with open("index.html", encoding="utf-8") as f:
        base = re.search(r'<link rel="canonical" href="([^"]+)"', f.read()).group(1).rstrip("/") + "/"

    items = []
    if os.path.exists(STORE):
        with open(STORE, encoding="utf-8") as f:
            items = json.load(f)

    if "--before" in a and "--after" in a:
        try:
            before = {norm(s.get("url")) for s in load_list(a[a.index("--before") + 1])}
            after = load_list(a[a.index("--after") + 1])
        except Exception as e:
            print(f"Could not read the lists ({type(e).__name__}); feed unchanged.")
            before, after = None, []
        if before:
            today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
            known = {norm(i["url"]) for i in items}
            fresh = []
            for s in after:
                k = norm(s.get("url"))
                if not k or k in before or k in known or s.get("nsfw") or s.get("avoid") or "reddit.com" in k:
                    continue
                if not str(s.get("url", "")).startswith(("http://", "https://")):
                    continue
                fresh.append({"url": s["url"], "name": s.get("name") or k, "section": s.get("section") or "", "date": today})
            items = (fresh + items)[:KEEP]
            print(f"{len(fresh)} new site(s) added to the feed.")
            with open(STORE, "w", encoding="utf-8", newline="\n") as f:
                json.dump(items, f, indent=2, ensure_ascii=False)
                f.write("\n")

    e = html.escape
    updated = (max(i["date"] for i in items) if items else "2026-01-01") + "T00:00:00Z"
    out = ['<?xml version="1.0" encoding="utf-8"?>',
           '<feed xmlns="http://www.w3.org/2005/Atom">',
           '  <title>Sakura’s Hub: new sites</title>',
           '  <subtitle>Sites added to the directory, newest first.</subtitle>',
           f'  <link rel="self" type="application/atom+xml" href="{e(base)}feed.xml"/>',
           f'  <link rel="alternate" type="text/html" href="{e(base)}directory"/>',
           f'  <id>{e(base)}feed.xml</id>',
           f'  <updated>{updated}</updated>']
    for i in items:
        out += ['  <entry>',
                f'    <title>{e(i["name"])}</title>',
                f'    <link rel="alternate" href="{e(i["url"], quote=True)}"/>',
                f'    <id>{e(base)}new/{e(norm(i["url"]), quote=True)}</id>',
                f'    <updated>{i["date"]}T00:00:00Z</updated>',
                f'    <summary>New in {e(i["section"] or "the directory")}. Open the directory for search and live status.</summary>',
                '  </entry>']
    out.append('</feed>')
    with open(FEED, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")
    print(f"feed.xml has {len(items)} entries.")


if __name__ == "__main__":
    main()
