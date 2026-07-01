import json
import urllib.request
import urllib.error
import re
import sys
import io
import os
import ssl
import time
import datetime
from urllib.parse import urlparse
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

TBCPL_MAIN_URL = "https://raw.githubusercontent.com/N3rdmade/TBCPL/main/public/links.json"
SAKURAS_INFO_URL = "https://raw.githubusercontent.com/Sakuras-Hub/Sakuras-Hub/refs/heads/main/need%20for%20the%20website%20to%20work/info.json"
MERGE_PATH = "need for the website to work/info.json"
TBCPL_RAW_BASE = "https://raw.githubusercontent.com/N3rdmade/TBCPL/main/public"
EVERYTHINGMOE_BASE = "https://everythingmoe.com/section"

REGION_FILES = [
    "Region-Links/links.BRAZIL.json", "Region-Links/links.EGYPT.json",
    "Region-Links/links.FINLAND.json", "Region-Links/links.FRANCE.json",
    "Region-Links/links.GERMANY.json", "Region-Links/links.INDIA.json",
    "Region-Links/links.ITALY.json", "Region-Links/links.JAPAN.json",
    "Region-Links/links.KURDISTAN.json", "Region-Links/links.NETHERLANDS.json",
    "Region-Links/links.POLAND.json", "Region-Links/links.PORTUGAL.json",
    "Region-Links/links.RUSSIA.json", "Region-Links/links.SOUTHKOREA.json",
    "Region-Links/links.SPAIN.json",
]

EXCLUDED_CATEGORY_IDS = {"paid"}

EXCLUDED_KEYWORDS = [
    "crunchyroll", "funimation", "hidive", "netflix", "disney",
    "hulu", "hbomax", "paramount", "peacock", "amazon prime",
    "apple tv", "mgm+", "amc+", "shudder", "viki", "legal", "paid",
]

EXCLUDED_DOMAINS = [
    "crunchyroll.com", "funimation.com", "hidive.com", "netflix.com",
    "disneyplus.com", "disney.com", "hulu.com", "hbomax.com",
    "paramountplus.com", "paramount.com", "peacocktv.com", "amazon.com",
    "tv.apple.com", "apple.com", "mgmplus.com", "amcplus.com",
    "shudder.com", "viki.com",
    "youtube.com", "youtu.be",
]

EXCLUDED_URL_PATTERNS = [r"tbcpl\.lol/site-request", r"example\.com"]

TBCPL_SECTION_MAP = {
    "movies":  ("Movies & TV Streaming", "movies-tv", "Movies, TV, Streaming, Free, HD"),
    "anime":   ("Anime Streaming", "anime", "Anime, Streaming, Sub, Dub, Free, HD"),
    "manga":   ("Manga Reading", "manga", "Manga, Reading, Free"),
    "livetv":  ("Live TV & Sports", "live-tv", "Live TV, Sports, Streaming, Free"),
    "apps":    ("Apps", "apps", "Apps, Free, Android, Streaming"),
}

EVERYTHINGMOE_SECTION_MAP = {
    "anime":    ("Anime Streaming", "anime", "Anime, Streaming, Sub, Dub, Free, HD"),
    "donghua":  ("Donghua Streaming", "anime", "Donghua, Anime, Streaming, Sub, Free, HD"),
    "manga":    ("Manga Reading", "manga", "Manga, Reading, Free"),
    "manhwa":   ("Manhwa Reading", "manhwa", "Manhwa, Manga, Reading, Free"),
    "novel":    ("Novel Reading", "novel", "Novel, Light Novel, Reading, Free"),
    "drama":    ("Asian Drama", "drama", "Drama, Asian Drama, Streaming, Free"),
    "game":     ("Games", "games", "Games, Visual Novel, Free"),
    "apps":     ("Apps", "apps", "Apps, Free, Android, Streaming"),
    "download": ("Download", "download", "Download, Anime, Manga, Torrent, DDL, Free"),
    "music":    ("Music", "music", "Music, Anime Music, OST, Free"),
    "schedule": ("Release Schedule", "schedule", "Schedule, Anime, Release, Calendar"),
    "database": ("Database/Tracker", "database", "Database, Tracker, Anime, Manga, Free"),
    "western":  ("Western Streaming", "western", "Western, Movies, TV, Streaming, Free"),
    "utils":    ("Misc Tools", "tools", "Tools, Extension, Utility, Free"),
    "quiz":     ("Quiz", "quiz", "Quiz, Trivia, Anime, Games"),
    "trend":    ("Rank/Trends", "trends", "Rank, Trends, Anime, Manga, Popular"),
    "wiki":     ("Wiki/Guides", "guides", "Wiki, Guide, Anime, Manga, Information"),
    "artboard": ("Art/Imageboards", "imageboards", "Art, Imageboard, Fan Art, Gallery"),
    "vtuber":   ("VTuber", "vtuber", "VTuber, Virtual YouTuber, Streaming"),
    "gacha":    ("Gacha Games", "gacha", "Gacha, Games, Mobile, Free"),
    "cosplay":  ("Cosplay", "cosplay", "Cosplay, Costume, Cosplay Shopping"),
    "amv":      ("AMV", "amv", "AMV, Anime Music Video, Fan Made, Video"),
    "forums":   ("Forums/Community", "forums", "Forums, Community, Discussion, Anime"),
}

def fetch_json(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [!] Failed to fetch {url}: {e}")
        return None

def fetch_html(url, timeout=30):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        print(f"  [!] Failed to fetch {url}: {e}")
        return None

def normalize_url(url):
    url = url.strip().rstrip("/")
    url = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    url = re.sub(r"^www\.", "", url, flags=re.IGNORECASE)
    url = url.lower()
    return url

def normalize_url_strict(url):
    url = normalize_url(url)
    url = re.sub(r"\?.*$", "", url)
    url = re.sub(r"/(home|discover|browse|explore|list|search|genre)$", "", url)
    return url

def normalize_name(name):
    return re.sub(r"[^a-zA-Z0-9]", "", name).lower()

def make_slug(name):
    return re.sub(r"[^a-zA-Z0-9]+", "", name).lower()

def is_paid_or_legal(site_name, site_url):
    name = site_name.lower()
    url = site_url.lower()
    for kw in EXCLUDED_KEYWORDS:
        if kw in name:
            return True
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    if domain.startswith("www."):
        domain = domain[4:]
    for excluded_domain in EXCLUDED_DOMAINS:
        if excluded_domain in domain or domain in excluded_domain:
            return True
    return False

def parse_everythingmoe_section(html, section_id):
    sites = {}
    section_name_lower = section_id.lower()

    section_map = EVERYTHINGMOE_SECTION_MAP.get(section_name_lower)
    if not section_map:
        return sites
    section, category, tags = section_map

    pattern = re.compile(
        r'<div[^>]*data-rank="(\d+)"[^>]*class="section-item[^"]*"(?:\s+[^>]*)?>'
        r'\s*\d+\.\s*<a[^>]*data-link="([^"]*)"[^>]*>'
        r'(?:<img[^>]*>\s*)?([^<]+)</a>'
    )

    licensed_items = set()
    lic_pattern = re.compile(
        r'<div[^>]*data-rank="(\d+)"[^>]*class="section-item[^"]*section-licensed[^"]*"'
    )
    for match in lic_pattern.finditer(html):
        licensed_items.add(match.group(1))

    for match in pattern.finditer(html):
        rank = match.group(1)
        url = match.group(2).strip()
        name = match.group(3).strip()

        if not url or not name:
            continue

        is_licensed = rank in licensed_items

        if is_licensed:
            continue

        if is_paid_or_legal(name, url):
            continue

        if any(re.search(p, url, re.IGNORECASE) for p in EXCLUDED_URL_PATTERNS):
            continue

        norm = normalize_url(url)
        if norm not in sites:
            slug = make_slug(name)
            sites[norm] = {
                "name": name,
                "url": url,
                "slug": slug,
                "section": section,
                "category": category,
                "pricing": "free*",
                "nsfw": False,
                "emoji": "",
                "tags": tags,
                "source": "EverythingMoe",
            }
    return sites

def extract_sites_from_tbcpl(data, region_name=None):
    sites = {}
    categories = data.get("categories", [])
    for cat in categories:
        cat_id = cat.get("id", "")
        if cat_id in EXCLUDED_CATEGORY_IDS:
            continue
        section, category, tags = TBCPL_SECTION_MAP.get(cat_id, ("Other", "other", "Free, Streaming"))
        for site in cat.get("sites", []):
            if not site.get("enabled", True):
                continue
            if is_paid_or_legal(site.get("name", ""), site.get("url", "")):
                continue
            url = site.get("url", "")
            if any(re.search(p, url, re.IGNORECASE) for p in EXCLUDED_URL_PATTERNS):
                continue
            if not url:
                continue
            norm = normalize_url(url)
            if norm not in sites:
                name = site["name"]
                slug = make_slug(name)
                sites[norm] = {
                    "name": name,
                    "url": site["url"],
                    "slug": slug,
                    "section": section,
                    "category": category,
                    "pricing": "free*",
                    "nsfw": False,
                    "emoji": "",
                    "tags": tags,
                    "source": f"TBCPL/{region_name or 'Global'}",
                }
    return sites

def extract_sites_from_sakuras(data):
    exact = {}
    strict = {}
    by_name = {}
    for entry in data:
        url = entry.get("url", "")
        name = entry.get("name", "")
        if not url:
            continue
        n1 = normalize_url(url)
        n2 = normalize_url_strict(url)
        exact[n1] = {"name": name, "url": url}
        if n2 not in strict:
            strict[n2] = {"name": name, "url": url}
        nname = normalize_name(name)
        if nname not in by_name:
            by_name[nname] = {"name": name, "url": url}
    return {"exact": exact, "strict": strict, "by_name": by_name}

GENERIC_HOSTING_DOMAINS = {
    "github.com", "gitlab.com", "codeberg.org", "bitbucket.org",
    "git.rebelonion.dev", "gitlab.com",
}

EV_SECTIONS = [
    "anime", "donghua", "manga", "manhwa", "novel", "drama", "game", "apps",
    "download", "music", "schedule", "database", "western", "utils", "quiz",
    "trend", "wiki", "artboard", "vtuber", "gacha", "cosplay", "amv", "forums",
]

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

DEAD_PHRASES = [
    b'service unavailable',
    b'no longer available',
    b'permanently closed',
    b'page not found',
    b'404 not found',
    b'this domain may be for sale',
    b'account suspended',
    b'account has been suspended',
    b'database connection error',
    b"site can't be reached",
    "site can\u2019t be reached".encode('utf-8'),
    b'this site is no longer',
    b'has shut down',
    b'has been discontinued',
    b'the resource requested could not be found',
    b'host error',
    b'this site is not available',
    b'website is not available',
    b'domain name expired',
]

def _body_looks_dead(body):
    if not body:
        return False
    lower = body.lower()
    for phrase in DEAD_PHRASES:
        if phrase in lower:
            return True
    return False

def try_get(url, name):
    t0 = time.time()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        code = resp.getcode()
        ms = round((time.time() - t0) * 1000)
        if 200 <= code < 400:
            chunk = resp.read(4096)
            if _body_looks_dead(chunk):
                return "dead", "HTTP 200 (dead page content)", name, ms
            return "ok", f"HTTP {code}", name, ms
        return "ok", f"HTTP {code}", name, ms

def check_url(entry):
    name = entry.get("name", "?")
    url = entry.get("url", "")
    if not url:
        return "skip", "", name, None
    t0 = time.time()

    def _do_head():
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, method="HEAD", headers=BROWSER_HEADERS)
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            code = resp.getcode()
            ms = round((time.time() - t0) * 1000)
            if 200 <= code < 400:
                return ("ok", f"HTTP {code}", name, ms)
            if code == 418:
                return ("ok", "HTTP 418 (teapot)", name, ms)
            return ("head_fail", f"HTTP {code}", name, ms)

    try:
        result = _do_head()
        if result[0] == "ok":
            return result
    except Exception:
        pass

    try:
        return try_get(url, name)
    except urllib.error.HTTPError as e2:
        ms = round((time.time() - t0) * 1000)
        return "ok", f"HTTP {e2.code}", name, ms
    except Exception as e2:
        err = str(e2).lower()
        ms = round((time.time() - t0) * 1000) if time.time() - t0 < 60 else None
        if 'connection refused' in err:
            return "dead", "Connection refused", name, ms
        if 'name or service not known' in err or 'nodename' in err or 'resolve' in err:
            return "dead", "DNS failure", name, ms
        if 'ssl' in err:
            return "ok", "SSL error", name, ms
        return "ok", "Unreachable", name, ms

def dead_link_check():
    if not os.path.exists(MERGE_PATH):
        print(f"  [X] {MERGE_PATH} not found")
        return

    with open(MERGE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    print(f"  Loaded {len(data)} sites from {MERGE_PATH}")

    print(f"\n  Checking URLs (this may take a few minutes)...")
    results = {"ok": [], "dead": [], "blocked": [], "skip": []}

    with ThreadPoolExecutor(max_workers=20) as executor:
        fut_map = {executor.submit(check_url, entry): entry for entry in data}
        done = 0
        for fut in as_completed(fut_map):
            done += 1
            status, detail, name, ms = fut.result()
            entry = fut_map[fut]
            results.setdefault(status, []).append({**entry, "_check_detail": detail, "_check_ms": ms})
            if done % 50 == 0 or done == len(data):
                print(f"    Progress: {done}/{len(data)}")

    dead_count = len(results.get("dead", []))
    blocked_count = len(results.get("blocked", []))
    ok_count = len(results.get("ok", []))
    skip_count = len(results.get("skip", []))

    print(f"\n  {'=' * 50}")
    print(f"  Dead link check results:")
    print(f"  {'=' * 50}")
    print(f"    OK:       {ok_count}")
    print(f"    Dead:     {dead_count}")
    print(f"    Blocked:  {blocked_count}")
    print(f"    Skipped:  {skip_count}")

    dead_sites = results.get("dead", [])
    blocked_sites = results.get("blocked", [])

    if dead_sites:
        print(f"\n  Potentially dead sites:")
        dead_sites.sort(key=lambda s: (s.get("section", ""), s.get("rank", 0)))
        for s in dead_sites:
            print(f"    [Dead] {s.get('section','?'):25s} rank {s.get('rank',0):3d}  {s.get('name','?'):30s} {s.get('url','?'):50s} ({s.get('_check_detail','')})")

    if blocked_sites:
        print(f"\n  Blocked (might still be alive):")
        for s in blocked_sites:
            print(f"    [Blocked] {s.get('name','?'):30s} {s.get('url','?'):50s}")

    report = {
        "date": datetime.date.today().isoformat(),
        "total": len(data),
        "ok": ok_count,
        "dead": dead_count,
        "blocked": blocked_count,
        "skipped": skip_count,
        "dead_sites": [{"name": s["name"], "url": s["url"], "section": s["section"], "rank": s["rank"], "reason": s["_check_detail"]} for s in dead_sites],
        "blocked_sites": [{"name": s["name"], "url": s["url"], "section": s["section"], "rank": s["rank"]} for s in blocked_sites],
    }

    report_path = "dead_sites_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\n  Report saved to {report_path}")

    if dead_sites:
        dead_urls = {s["url"] for s in dead_sites}
        filtered = [e for e in data if e.get("url") not in dead_urls]
        filtered_path = "info-filtered.json"
        with open(filtered_path, "w", encoding="utf-8") as f:
            json.dump(filtered, f, indent=2, ensure_ascii=False)
        print(f"  Filtered info.json (dead sites removed) saved to {filtered_path}")
        print(f"  Would remove {dead_count} site(s)")
    else:
        print(f"\n  No dead sites found. All good!")

    print(f"\n  {'=' * 50}")

    return dead_count > 0

def generate_status_page():
    if os.path.exists(MERGE_PATH):
        with open(MERGE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"  Loaded {len(data)} sites from {MERGE_PATH}")
    else:
        data = fetch_json(SAKURAS_INFO_URL)
        if data is None:
            print(f"  [X] Could not fetch Sakuras-Hub info.json")
            return
        print(f"  Loaded {len(data)} sites from web")

    print(f"\n  Checking URLs...")
    results = {"ok": [], "dead": [], "blocked": [], "skip": []}

    with ThreadPoolExecutor(max_workers=20) as executor:
        fut_map = {executor.submit(check_url, entry): entry for entry in data}
        done = 0
        for fut in as_completed(fut_map):
            done += 1
            status, detail, name, ms = fut.result()
            entry = fut_map[fut]
            results.setdefault(status, []).append({**entry, "_check_detail": detail, "_check_ms": ms})
            if done % 100 == 0 or done == len(data):
                print(f"    Progress: {done}/{len(data)}")

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    ok_count = len(results.get("ok", []))
    dead_count = len(results.get("dead", []))
    blocked_count = len(results.get("blocked", []))
    skip_count = len(results.get("skip", []))

    all_sites = []
    total = 0
    for site in data:
        total += 1
        url = site.get("url", "")
        name = site.get("name", "")
        sec = site.get("section", "")
        rank = site.get("rank", 0)
        slug = site.get("slug", "")
        nsfw = site.get("nsfw", False)
        status_str = "unknown"
        detail_str = ""
        ms_val = None
        for s in ("ok", "dead", "blocked", "skip"):
            for item in results.get(s, []):
                if item.get("url") == url and item.get("name") == name:
                    status_str = s
                    detail_str = item.get("_check_detail", "")
                    ms_val = item.get("_check_ms")
                    break
            if status_str != "unknown":
                break
        all_sites.append((status_str, detail_str, name, url, sec, rank, slug, nsfw, ms_val))

    all_sites.sort(key=lambda x: (0 if x[0] == "dead" else 1 if x[0] == "blocked" else 2, x[4], x[5]))

    sections = sorted(set(s[4] for s in all_sites))
    section_counts = {}
    for sec in sections:
        sec_sites = [s for s in all_sites if s[4] == sec]
        up = sum(1 for s in sec_sites if s[0] == "ok")
        down = sum(1 for s in sec_sites if s[0] == "dead")
        blocked = sum(1 for s in sec_sites if s[0] == "blocked")
        section_counts[sec] = (len(sec_sites), up, down, blocked)

    rows_html = ""
    for status, detail, name, url, sec, rank, slug, nsfw, ms in all_sites:
        status_label = {"ok": "UP", "dead": "DOWN", "blocked": "Blocked", "skip": "Skipped", "unknown": "?"}[status]
        status_color = {"ok": "#2ea043", "dead": "#da3633", "blocked": "#d29922", "skip": "#8b949e", "unknown": "#8b949e"}[status]
        rows_html += f"""<tr>
  <td class="status-cell"><span class="dot" style="background:{status_color}"></span>{status_label}</td>
  <td class="name-cell"><a href="{url}" target="_blank" rel="noopener">{name}</a></td>
  <td class="url-cell"><a href="{url}" target="_blank" rel="noopener">{url[:80]}{'...' if len(url)>80 else ''}</a></td>
  <td class="sec-cell">{sec}</td>
  <td class="detail-cell">{detail}</td>
</tr>"""

    sections_html = ""
    for sec in sections:
        total_s, up_s, down_s, blocked_s = section_counts[sec]
        sections_html += f"""<tr>
  <td class="sec-name">{sec}</td>
  <td>{total_s}</td>
  <td class="up">{up_s}</td>
  <td class="down">{down_s}</td>
  <td class="blocked">{blocked_s}</td>
</tr>"""

    json_path = "status/status.json"
    status_data = {
        "updated": now,
        "total": total,
        "up": ok_count,
        "down": dead_count,
        "blocked": blocked_count,
        "skipped": skip_count,
        "sites": [{"status": s[0], "detail": s[1], "name": s[2], "url": s[3], "section": s[4], "rank": s[5], "slug": s[6], "nsfw": s[7], "ms": s[8]} for s in all_sites],
        "sections": {sec: {"total": t, "up": u, "down": d, "blocked": b} for sec, (t, u, d, b) in section_counts.items()},
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(status_data, f, indent=2, ensure_ascii=False)
    print(f"  Status data saved: {json_path}")
    print(f"  {ok_count} UP, {dead_count} DOWN, {blocked_count} BLOCKED, {skip_count} SKIPPED")

def main():
    status_mode = "--status" in sys.argv

    if status_mode:
        print("=" * 70)
        print("  Sakura's Hub Site Monitor")
        print("  Mode: STATUS (generates live status page)")
        print("=" * 70)
        generate_status_page()
        return

    check_mode = "--check" in sys.argv

    if check_mode:
        print("=" * 70)
        print("  Sakuras-Hub Dead Link Checker")
        print("  Mode: CHECK (scans all sites for dead links)")
        print("=" * 70)
        dead_link_check()
        return

    merge_mode = "--merge" in sys.argv

    print("=" * 70)
    print("  TBCPL + EverythingMoe -> Sakuras-Hub Missing Site Finder")
    if merge_mode:
        print("  Mode: MERGE (appends missing sites into local info.json)")
    else:
        print("  Output matches Sakuras-Hub info.json format")
    print("=" * 70)

    print("\n[1/4] Fetching TBCPL links...")
    all_tbcpl_sites = OrderedDict()

    main_data = fetch_json(TBCPL_MAIN_URL)
    if main_data:
        sites = extract_sites_from_tbcpl(main_data, "Global")
        all_tbcpl_sites.update(sites)
        print(f"  -> Main links.json: {len(sites)} free sites")
    else:
        print("  [!] Could not fetch main links.json")

    for region_file in REGION_FILES:
        region_data = fetch_json(f"{TBCPL_RAW_BASE}/{region_file}")
        if region_data:
            region_name = region_file.split(".")[1].replace(".json", "")
            sites = extract_sites_from_tbcpl(region_data, region_name)
            all_tbcpl_sites.update(sites)
            print(f"  -> {region_file}: {len(sites)} free sites")
        else:
            print(f"  [!] Could not fetch {region_file}")

    print(f"\n  Total unique free sites from TBCPL: {len(all_tbcpl_sites)}")

    print("\n[2/4] Fetching EverythingMoe sections...")
    all_ev_sites = OrderedDict()

    for sec_id in EV_SECTIONS:
        url = f"{EVERYTHINGMOE_BASE}/{sec_id}"
        html = fetch_html(url)
        if html is None:
            print(f"  [!] Could not fetch {sec_id}")
            continue
        sites = parse_everythingmoe_section(html, sec_id)
        all_ev_sites.update(sites)
        print(f"  -> {sec_id}: {len(sites)} free sites")

    print(f"\n  Total unique free sites from EverythingMoe: {len(all_ev_sites)}")

    all_source_sites = OrderedDict()
    all_source_sites.update(all_tbcpl_sites)
    all_source_sites.update(all_ev_sites)
    print(f"\n  Combined unique free sites (TBCPL + EverythingMoe): {len(all_source_sites)}")

    print("\n[3/4] Loading Sakuras-Hub info.json...")
    if merge_mode:
        if os.path.exists(MERGE_PATH):
            with open(MERGE_PATH, "r", encoding="utf-8") as f:
                sakuras_data = json.load(f)
            print(f"  -> {len(sakuras_data)} sites loaded from {MERGE_PATH}")
        else:
            print(f"  [!] {MERGE_PATH} not found. Falling back to web fetch.")
            sakuras_data = fetch_json(SAKURAS_INFO_URL)
            if sakuras_data is None:
                print("  [X] Fatal: Could not fetch Sakuras-Hub info.json")
                return
            print(f"  -> {len(sakuras_data)} sites loaded from web")
    else:
        sakuras_data = fetch_json(SAKURAS_INFO_URL)
        if sakuras_data is None:
            print("  [X] Fatal: Could not fetch Sakuras-Hub info.json")
            return
        print(f"  -> {len(sakuras_data)} sites currently in Sakuras-Hub")

    sakuras = extract_sites_from_sakuras(sakuras_data)
    sakuras_exact = sakuras["exact"]
    sakuras_strict = sakuras["strict"]
    sakuras_by_name = sakuras["by_name"]

    print("\n[4/4] Comparing and building missing sites in your format...")
    missing = []
    for norm_url, site_info in all_source_sites.items():
        name = site_info["name"]
        url = site_info["url"]

        already_in_sakuras = False

        if norm_url in sakuras_exact:
            already_in_sakuras = True

        if not already_in_sakuras:
            strict_url = normalize_url_strict(url)
            if strict_url in sakuras_strict:
                already_in_sakuras = True

        if not already_in_sakuras:
            nname = normalize_name(name)
            if nname in sakuras_by_name:
                existing = sakuras_by_name[nname]
                existing_domain = urlparse(existing["url"]).netloc.lower().lstrip("www.")
                this_domain = urlparse(url).netloc.lower().lstrip("www.")
                if existing_domain == this_domain:
                    already_in_sakuras = True

        if not already_in_sakuras:
            this_domain = urlparse(url).netloc.lower().lstrip("www.")
            if this_domain not in GENERIC_HOSTING_DOMAINS:
                for snorm, sentry in sakuras_exact.items():
                    sdomain = urlparse(sentry["url"]).netloc.lower().lstrip("www.")
                    if this_domain == sdomain and sdomain not in GENERIC_HOSTING_DOMAINS:
                        already_in_sakuras = True
                        break

        if not already_in_sakuras:
            already_in = any(normalize_url(m["url"]) == norm_url for m in missing)
            if not already_in:
                missing.append(site_info)

    missing.sort(key=lambda s: (s["section"], s["name"].lower()))

    used_slugs = {}
    ranked = []
    current_section = None
    rank = 1
    for site in missing:
        if site["section"] != current_section:
            current_section = site["section"]
            rank = 1
        else:
            rank += 1
        slug = site["slug"]
        if slug in used_slugs:
            used_slugs[slug] += 1
            slug = f"{slug}{used_slugs[slug]}"
        else:
            used_slugs[slug] = 1

        ranked.append({
            "rank": rank,
            "name": site["name"],
            "url": site["url"],
            "slug": slug,
            "section": site["section"],
            "category": site["category"],
            "pricing": site["pricing"],
            "nsfw": site["nsfw"],
            "emoji": site["emoji"],
            "tags": site["tags"],
        })

    if merge_mode and os.path.exists(MERGE_PATH):
        existing_slugs = {}
        max_ranks = {}
        for entry in sakuras_data:
            slug = entry.get("slug", "")
            if slug:
                existing_slugs[slug] = existing_slugs.get(slug, 0) + 1
            sec = entry.get("section", "")
            r = entry.get("rank", 0)
            if isinstance(r, int):
                max_ranks[sec] = max(max_ranks.get(sec, 0), r)

        for site in ranked:
            sec = site["section"]
            max_ranks[sec] = max_ranks.get(sec, 0) + 1
            site["rank"] = max_ranks[sec]

            slug = site["slug"]
            if slug in existing_slugs:
                existing_slugs[slug] += 1
                slug = f"{slug}{existing_slugs[slug]}"
                site["slug"] = slug
            else:
                existing_slugs[slug] = 1

            sakuras_data.append(site)

        sakuras_data.sort(key=lambda s: (s.get("section", ""), s.get("rank", 0) if isinstance(s.get("rank"), int) else 0))

        with open(MERGE_PATH, "w", encoding="utf-8") as f:
            json.dump(sakuras_data, f, indent=2, ensure_ascii=False)
        print(f"\n  Merged {len(ranked)} new entries into {MERGE_PATH}")
        print(f"  Total entries now: {len(sakuras_data)}")
    else:
        output_file = "missing_sites_from_tbcpl.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(ranked, f, indent=2, ensure_ascii=False)
        print(f"\n  Saved {len(ranked)} entries to {output_file}")

    print(f"\n  {'=' * 60}")
    print(f"  Summary by section:")
    print(f"  {'=' * 60}")
    sections = {}
    for site in ranked:
        sections.setdefault(site["section"], 0)
        sections[site["section"]] += 1
    for sec, count in sorted(sections.items()):
        print(f"    {sec:<30s} {count} missing")

    print(f"\n  Sample entry:")
    if ranked:
        print(json.dumps(ranked[0], indent=2))

    print("\n" + "=" * 70)
    print("  Done.")
    print("=" * 70)

if __name__ == "__main__":
    main()
