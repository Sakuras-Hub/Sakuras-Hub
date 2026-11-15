"""Build one plain HTML page per directory category, plus a sections index.

Why: the directory page loads its list with JavaScript, so search engines see
very little of it. These pages are ordinary HTML lists (no JavaScript needed),
so every category can be found and indexed. Each page links to the live
directory for search, favorites and uptime status.

Run from the repo root (the daily and weekly workflows run it for you):
    python scripts/tools/build-sections.py

What goes on the pages:
    - NOT adult sites, NOT sites flagged "avoid", NOT reddit links
      (the same rules the directory uses for its default view)
    - the same grouping the directory uses, so ?cat= links match

The output is the same every run unless info.json changes, so it never
creates empty commits. It writes:
    sections/index.html and sections/<category>.html
    the <!-- sections:start --> ... <!-- sections:end --> block in sitemap.xml
"""
import html
import json
import os
import re
import shutil
import sys
from urllib.parse import urlparse

INFO = "need for the website to work/info.json"
OUT_DIR = "sections"

# ---------------------------------------------------------------- site address
with open("index.html", encoding="utf-8") as f:
    m = re.search(r'<link rel="canonical" href="([^"]+)"', f.read())
if not m:
    sys.exit("Could not find the canonical link in index.html")
BASE = m.group(1).rstrip("/") + "/"   # e.g. https://example.com/ (always ends with /)

# ---------------------------------------------------------------- grouping rules (read from directory.html)
with open("directory.html", encoding="utf-8") as f:
    DIR = f.read()


def js_pairs(name):
    block = re.search(r"var %s\s*=\s*\{(.*?)\n\};" % name, DIR, re.S)
    if not block:
        sys.exit(f"Could not read {name} from directory.html")
    return dict(re.findall(r"'([^']+)'\s*:\s*'([^']*)'", block.group(1)))


SECTION_MAP = js_pairs("SECTION_MAP")
SECTION_NORMALIZE = js_pairs("SECTION_NORMALIZE")
cat_block = re.search(r"var CAT_META\s*=\s*\{(.*?)\n\};", DIR, re.S)
CAT_META = {
    k: (label, emoji)
    for k, label, emoji in re.findall(r"'([^']+)':\s*\{\s*label:\s*'([^']*)',\s*emoji:\s*'([^']*)'\s*\}", cat_block.group(1))
}


def label_for(section):
    section = SECTION_NORMALIZE.get(section, section)
    key = SECTION_MAP.get(section) or section.lower()
    if key in CAT_META:
        return CAT_META[key]
    return (section, "🔗")


def slug_of(label):
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


# ---------------------------------------------------------------- data
with open(INFO, encoding="utf-8") as f:
    sites = json.load(f)

groups = {}      # slug -> {"label":..., "emoji":..., "sites":[...], "all_adult": bool}
for s in sites:
    url = s.get("url") or ""
    if not url or "reddit.com" in url.lower():
        continue
    label, emoji = label_for(s.get("section") or "Other")
    g = groups.setdefault(slug_of(label), {"label": label, "emoji": emoji, "sites": [], "adult": 0, "total": 0})
    g["total"] += 1
    if s.get("nsfw"):
        g["adult"] += 1
        continue
    if s.get("avoid"):
        continue
    g["sites"].append(s)

# a category made only of adult sites gets no page
pages = {k: g for k, g in groups.items() if g["sites"] and g["adult"] < g["total"]}


def esc(x):
    return html.escape(str(x or ""), quote=True)


def host_of(url):
    try:
        return (urlparse(url).hostname or "").removeprefix("www.")
    except Exception:
        return ""


def safe_url(url):
    p = urlparse(url)
    return url if p.scheme in ("http", "https") and p.netloc else ""


# ---------------------------------------------------------------- templates
CSS = """
@font-face{font-family:'Inter';font-style:normal;font-weight:400 800;font-display:swap;src:url(../assets/fonts/inter-latin.woff2) format('woff2')}
:root{color-scheme:dark light;--bg:#06060d;--surface:#171326;--text:#e8eaf6;--muted:#9e94c0;--accent:#ff9ec4;--border:rgba(158,148,192,.22)}
@media (prefers-color-scheme:light){:root{--bg:#f7f5fb;--surface:#ffffff;--text:#1d1830;--muted:#6a5f8c;--accent:#c01f75;--border:rgba(80,60,140,.18)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:400 16px/1.6 'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
a{color:var(--accent)}
header.top{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;justify-content:space-between;max-width:960px;margin:0 auto;padding:18px 20px}
header.top .brand{font-weight:800;text-decoration:none;color:var(--text)}
header.top nav{display:flex;gap:16px;flex-wrap:wrap;font-size:.92rem}
main{max-width:960px;margin:0 auto;padding:8px 20px 56px}
h1{font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.2;margin:8px 0 6px}
.sub{color:var(--muted);margin:0 0 18px;max-width:70ch}
.cta{display:inline-block;margin:4px 0 22px;padding:10px 18px;border-radius:999px;background:var(--accent);color:#16101f;font-weight:700;text-decoration:none}
ul.sites{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
ul.sites li{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:9px 12px;min-width:0}
ul.sites a{font-weight:600;text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ul.sites a:hover{text-decoration:underline}
ul.sites .host{display:block;color:var(--muted);font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ul.cats{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
ul.cats li a{display:flex;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 14px;text-decoration:none;color:var(--text);font-weight:600}
ul.cats li a span{color:var(--muted);font-weight:400}
footer{max-width:960px;margin:0 auto;padding:0 20px 40px;color:var(--muted);font-size:.85rem}
"""


def head(title, desc, canonical, jsonld):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="theme-color" content="#06060d">
<link rel="canonical" href="{esc(canonical)}">
<link rel="manifest" href="../manifest.webmanifest">
<link rel="icon" href="../assets/icon-96.png" type="image/png" sizes="96x96">
<link rel="apple-touch-icon" href="../assets/icon-180.png" sizes="180x180">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Sakura’s Hub">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:image" content="{esc(BASE)}assets/og-directory.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{esc(BASE)}assets/og-directory.png">
<link rel="preload" href="../assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>{CSS}</style>
<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
</head>
<body>
<header class="top">
  <a class="brand" href="../">Sakura’s Hub</a>
  <nav aria-label="Main"><a href="../directory">Directory</a><a href="../products">Products</a><a href="../about">About</a><a href="../donate">Support</a></nav>
</header>
"""


FOOT = """
<footer>
  <p>Outbound links open other websites that Sakura’s Hub does not run. Read the <a href="../disclaimer">disclaimer</a> and use an ad blocker. Adult and flagged sites are not listed on this page.</p>
</footer>
</body>
</html>
"""


def page_for(slug, g):
    title = f"{g['label']} sites: free list with uptime checks · Sakura’s Hub"
    n = len(g["sites"])
    desc = (f"{n:,} {g['label'].lower()} sites, picked by hand and checked for uptime. "
            "Open the live directory to search, save favorites and see which sites are up.")[:300]
    canonical = f"{BASE}sections/{slug}"
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "CollectionPage", "name": f"{g['label']} sites", "description": desc, "url": canonical,
             "isPartOf": {"@type": "WebSite", "name": "Sakura’s Hub", "url": BASE}},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Sakura’s Hub", "item": BASE},
                {"@type": "ListItem", "position": 2, "name": "Sections", "item": f"{BASE}sections/"},
                {"@type": "ListItem", "position": 3, "name": g["label"], "item": canonical}]},
        ],
    }
    items = sorted(g["sites"], key=lambda s: (s.get("rank") or 10**9, str(s.get("name", "")).lower()))
    lis = []
    for s in items:
        u = safe_url(s["url"])
        if not u:
            continue
        lis.append(f'<li><a href="{esc(u)}" target="_blank" rel="nofollow noopener noreferrer">{esc(s.get("name") or host_of(u))}</a>'
                   f'<span class="host">{esc(host_of(u))}</span></li>')
    body = (f'<main>\n<h1>{esc(g["emoji"])} {esc(g["label"])} sites</h1>\n'
            f'<p class="sub">{n:,} sites, hand-picked and checked for uptime. The live directory adds search, favorites and up/down status.</p>\n'
            f'<a class="cta" href="../directory?cat={esc(slug)}">Open {esc(g["label"])} in the live directory</a>\n'
            f'<ul class="sites">\n' + "\n".join(lis) + '\n</ul>\n</main>')
    return head(title, desc, canonical, ld) + body + FOOT


def index_page():
    title = "All sections · Sakura’s Hub"
    desc = "Browse every category in Sakura’s Hub: streaming, reading, games, tools and privacy sites."
    canonical = f"{BASE}sections/"
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "All sections", "url": canonical,
          "isPartOf": {"@type": "WebSite", "name": "Sakura’s Hub", "url": BASE}}
    order = sorted(pages.items(), key=lambda kv: (-len(kv[1]["sites"]), kv[1]["label"].lower()))
    lis = "\n".join(
        f'<li><a href="{esc(k)}">{esc(g["emoji"])} {esc(g["label"])} <span>{len(g["sites"]):,}</span></a></li>' for k, g in order)
    body = (f'<main>\n<h1>All sections</h1>\n<p class="sub">Every category in the directory as a plain list. '
            f'For search, favorites and live status, use the <a href="../directory">full directory</a>.</p>\n'
            f'<ul class="cats">\n{lis}\n</ul>\n</main>')
    return head(title, desc, canonical, ld) + body + FOOT


# ---------------------------------------------------------------- write
if os.path.isdir(OUT_DIR):
    shutil.rmtree(OUT_DIR)
os.makedirs(OUT_DIR)
for slug, g in pages.items():
    with open(os.path.join(OUT_DIR, slug + ".html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(page_for(slug, g))
with open(os.path.join(OUT_DIR, "index.html"), "w", encoding="utf-8", newline="\n") as f:
    f.write(index_page())

# sitemap: keep everything outside the markers, rewrite what is inside
with open("sitemap.xml", encoding="utf-8") as f:
    sm = f.read()
entries = [f"  <url><loc>{BASE}sections/</loc></url>"] + [
    f"  <url><loc>{BASE}sections/{slug}</loc></url>" for slug in sorted(pages)]
block = "  <!-- sections:start -->\n" + "\n".join(entries) + "\n  <!-- sections:end -->\n"
if "<!-- sections:start -->" in sm:
    sm = re.sub(r"  <!-- sections:start -->.*?<!-- sections:end -->\n", lambda _: block, sm, flags=re.S)
else:
    sm = sm.replace("</urlset>", block + "</urlset>")
with open("sitemap.xml", "w", encoding="utf-8", newline="\n") as f:
    f.write(sm)

print(f"Built {len(pages)} section pages + index ({sum(len(g['sites']) for g in pages.values()):,} sites listed).")
