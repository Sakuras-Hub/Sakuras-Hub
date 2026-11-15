"""Change the site address used in canonical links, share previews, sitemap and robots.txt.

Run from the repo root, as many times as you like:
    python scripts/tools/set-site-address.py https://your-site.vercel.app
"""
import glob
import re
import sys

if len(sys.argv) != 2 or not sys.argv[1].startswith("http"):
    sys.exit("Usage: python scripts/tools/set-site-address.py https://your-site.vercel.app")

new = sys.argv[1].rstrip("/") + "/"

# The current address is the canonical link on the home page.
with open("index.html", encoding="utf-8") as f:
    match = re.search(r'<link rel="canonical" href="([^"]+)"', f.read())
if not match:
    sys.exit("Could not find the canonical link in index.html")
old = match.group(1)

files = glob.glob("*.html") + glob.glob("errors/*.html") + glob.glob("sections/*.html") + ["sitemap.xml", "robots.txt", "feed.xml"]
changed = 0
for path in files:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if old in text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text.replace(old, new))
        changed += 1
print(f"Changed {old} to {new} in {changed} files")
