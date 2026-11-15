"""Add one site to info.json by hand (for example after a visitor suggestion).

    python scripts/tools/add_site.py https://example.com "Example" "Anime Streaming"
    python scripts/tools/add_site.py example.com "Example" "Anime Streaming" --nsfw --tags "Online,Free"

- Refuses addresses that are already in the list (www. and trailing slashes are ignored).
- The section must already exist. Run with a wrong one to see the list.
- The new entry goes last in its section (rank = highest rank + 1).
- The file keeps the exact format the daily updater writes.

Then commit and push: the change is announced in Discord and the section pages are rebuilt
by the next daily run (or run scripts/tools/build-sections.py yourself).
"""
import json
import os
import sys

INFO_JSON = os.environ.get("INFO_JSON", "need for the website to work/info.json")


def norm(url):
    u = (url or "").strip().lower()
    for p in ("https://", "http://"):
        if u.startswith(p):
            u = u[len(p):]
    if u.startswith("www."):
        u = u[4:]
    return u.rstrip("/")


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    flags = [a for a in argv if a.startswith("--")]
    tags = ["Online"]
    if "--tags" in argv:
        i = argv.index("--tags")
        tags = [t.strip() for t in argv[i + 1].split(",") if t.strip()]
        args = [a for a in args if a != argv[i + 1]]
    if len(args) != 3:
        print(__doc__)
        return 1
    url, name, section = args
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    if " " in url or "." not in url:
        print(f"'{url}' does not look like a website address.")
        return 1

    with open(INFO_JSON, encoding="utf-8") as f:
        sites = json.load(f)
    if any(norm(s.get("url")) == norm(url) for s in sites):
        print(f"{url} is already in the list.")
        return 1

    sections = sorted({s.get("section") for s in sites if s.get("section")})
    match = next((s for s in sections if s.lower() == section.lower()), None)
    if not match:
        print(f"Unknown section '{section}'. Existing sections:")
        for s in sections:
            print("  -", s)
        return 1

    rank = max((s.get("rank") or 0 for s in sites if s.get("section") == match), default=0) + 1
    sites.append({
        "url": url, "name": name.strip(), "section": match, "nsfw": "--nsfw" in flags, "tags": tags,
        "avoid": False, "avoid_reason": "", "rank": rank, "emoji": "", "pricing": "",
    })
    with open(INFO_JSON, "w", encoding="utf-8") as f:
        json.dump(sites, f, indent=2, ensure_ascii=False)      # same format as the updater
    print(f"Added {name} to {match} (rank {rank}). Now {len(sites)} sites. Commit and push.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
