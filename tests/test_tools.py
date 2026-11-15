"""Tests for the Python tools. Run from the repo root:  python -m unittest discover tests -v"""
import datetime
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "scripts", "tools")
INFO_REL = "need for the website to work/info.json"


def site(i, **kw):
    d = {"url": f"https://site{i}.example/", "name": f"Site {i}", "section": "Anime Streaming", "nsfw": False,
         "tags": ["Online"], "avoid": False, "avoid_reason": "", "rank": i, "emoji": "", "pricing": ""}
    d.update(kw)
    return d


def run(script, args=(), cwd=None, env=None):
    e = dict(os.environ)
    e.pop("DISCORD_WEBHOOK_URL", None)
    e.update(env or {})
    return subprocess.run([sys.executable, os.path.join(TOOLS, script), *args], cwd=cwd, env=e, capture_output=True, text=True)


class Server:
    """Tiny local HTTP server; handler(path, method, body) -> (status, obj, headers)."""
    def __init__(self, handler):
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass

            def _go(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n).decode() if n else ""
                status, obj, hdrs = handler(self.path, self.command, body)
                self.send_response(status)
                for k, v in (hdrs or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                if obj is not None:
                    self.wfile.write(json.dumps(obj).encode() if not isinstance(obj, bytes) else obj)
            do_GET = do_POST = do_PUT = _go

        self.srv = socketserver.TCPServer(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.port}"

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


class Tmp(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.d, "need for the website to work"))
        os.makedirs(os.path.join(self.d, "scripts"))

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def write(self, rel, data):
        p = os.path.join(self.d, rel)
        with open(p, "w", encoding="utf-8") as f:
            f.write(data if isinstance(data, str) else json.dumps(data, indent=2, ensure_ascii=False))
        return p


class NotifyTests(Tmp):
    def test_diff_flags_sanitising_and_nsfw(self):
        before = [site(i) for i in range(5)]
        after = [dict(s) for s in before]
        after[1]["avoid"], after[1]["avoid_reason"] = True, "bad [x](http://e) @everyone"
        after += [site(10, name="New @everyone [a](http://b)"), site(11, nsfw=True, name="Adult One"), site(12, avoid=True, avoid_reason="phishing")]
        del after[0]
        b, a = self.write("b.json", before), self.write("a.json", after)
        r = run("discord_notify.py", ["--before", b, "--after", a, "--source", "Test", "--dry-run"])
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertIn("Flagged as risky (2)", out)          # one flagged old + one new-but-flagged
        self.assertIn("Sites removed (1)", out)
        self.assertIn("1 adult site", out)
        self.assertNotIn("Adult One", out)
        self.assertNotIn("](http://e)", out)
        self.assertIn('"parse": []', out)

    def test_no_before_list_stays_silent(self):
        a = self.write("a.json", [site(1)])
        r = run("discord_notify.py", ["--before", os.path.join(self.d, "missing.json"), "--after", a, "--dry-run"])
        self.assertIn("skipping", r.stdout)

    def test_missing_secret_is_not_an_error(self):
        b, a = self.write("b.json", [site(1)]), self.write("a.json", [site(1), site(2)])
        r = run("discord_notify.py", ["--before", b, "--after", a])
        self.assertEqual(r.returncode, 0)
        self.assertIn("not set", r.stdout)

    def test_alerts_channel_is_used_when_set(self):
        sys.path.insert(0, TOOLS)
        import discord_notify
        used = []
        orig = discord_notify.post
        discord_notify.post = lambda hook, payload: used.append(hook) or True
        try:
            env = {"DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/1/main", "DISCORD_WEBHOOK_URL_ALERTS": "https://discord.com/api/webhooks/2/alerts"}
            old = {k: os.environ.get(k) for k in env}
            os.environ.update(env)
            try:
                discord_notify.send_all([{"embeds": []}], "feed")
                discord_notify.send_all([{"embeds": []}], "alerts")
                del os.environ["DISCORD_WEBHOOK_URL_ALERTS"]
                discord_notify.send_all([{"embeds": []}], "alerts")        # falls back to the main one
            finally:
                for k, v in old.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
        finally:
            discord_notify.post = orig
        self.assertEqual(used, ["https://discord.com/api/webhooks/1/main", "https://discord.com/api/webhooks/2/alerts", "https://discord.com/api/webhooks/1/main"])


class ScreenTests(Tmp):
    def server(self, bad=("bad",), status=200):
        seen = []

        def h(path, method, body):
            seen.append(json.loads(body))
            if status != 200:
                return status, {"error": "x"}, {}
            urls = [e["url"] for e in json.loads(body)["threatInfo"]["threatEntries"]]
            m = [{"threatType": "MALWARE", "threat": {"url": u}} for u in urls if any(b in u for b in bad)]
            return 200, ({"matches": m} if m else {}), {"Content-Type": "application/json"}
        s = Server(h)
        s.seen = seen
        return s

    def env(self, s, key="k"):
        e = {"INFO_JSON": os.path.join(self.d, INFO_REL), "SAFE_BROWSING_URL": s.base + "/v4/threatMatches:find"}
        if key:
            e["SAFE_BROWSING_API_KEY"] = key
        return e

    def test_new_only_flags_new_bad_sites_and_keeps_format(self):
        s = self.server()
        try:
            old = [site(1), site(2, url="https://bad-old.example/")]
            new = old + [site(3, url="https://bad-new.example/"), site(4)]
            b = self.write("before.json", old)
            self.write(INFO_REL, new)
            r = run("screen_sites.py", ["--new-only", "--before", b], env=self.env(s))
            self.assertEqual(r.returncode, 0, r.stderr)
            data = json.load(open(os.path.join(self.d, INFO_REL), encoding="utf-8"))
            by = {x["name"]: x for x in data}
            self.assertTrue(by["Site 3"]["avoid"])
            self.assertTrue(by["Site 3"]["avoid_reason"].startswith("Google Safe Browsing:"))
            self.assertFalse(by["Site 2"]["avoid"], "old sites are not screened in --new-only mode")
            self.assertFalse(by["Site 4"]["avoid"])
            raw = open(os.path.join(self.d, INFO_REL), encoding="utf-8").read()
            self.assertEqual(raw, json.dumps(data, indent=2, ensure_ascii=False), "same file format as the updater")
            sent = [e["url"] for req in s.seen for e in req["threatInfo"]["threatEntries"]]
            self.assertEqual(sorted(sent), ["https://bad-new.example/", "https://site4.example/"])
        finally:
            s.close()

    def test_all_mode_clears_only_its_own_flags(self):
        s = self.server(bad=("bad",))
        try:
            self.write(INFO_REL, [
                site(1, url="https://bad-now.example/"),
                site(2, avoid=True, avoid_reason="Google Safe Browsing: malware"),     # clean again -> cleared
                site(3, avoid=True, avoid_reason="Cryptominer-flagged (FMHY)"),         # manual -> untouched
            ])
            r = run("screen_sites.py", ["--all"], env=self.env(s))
            data = json.load(open(os.path.join(self.d, INFO_REL), encoding="utf-8"))
            self.assertTrue(data[0]["avoid"])
            self.assertFalse(data[1]["avoid"])
            self.assertEqual(data[1]["avoid_reason"], "")
            self.assertTrue(data[2]["avoid"])
            self.assertEqual(data[2]["avoid_reason"], "Cryptominer-flagged (FMHY)")
        finally:
            s.close()

    def test_api_error_changes_nothing(self):
        s = self.server(status=500)
        try:
            self.write(INFO_REL, [site(1, avoid=True, avoid_reason="Google Safe Browsing: malware"), site(2)])
            before = open(os.path.join(self.d, INFO_REL), encoding="utf-8").read()
            r = run("screen_sites.py", ["--all"], env=self.env(s))
            self.assertEqual(r.returncode, 0)
            self.assertEqual(open(os.path.join(self.d, INFO_REL), encoding="utf-8").read(), before)
        finally:
            s.close()

    def test_no_key_is_a_noop(self):
        s = self.server()
        try:
            self.write(INFO_REL, [site(1)])
            r = run("screen_sites.py", ["--all"], env=self.env(s, key=""))
            self.assertEqual(r.returncode, 0)
            self.assertIn("not set", r.stdout)
            self.assertEqual(s.seen, [])
        finally:
            s.close()

    def test_batches_of_500(self):
        s = self.server(bad=())
        try:
            self.write(INFO_REL, [site(i) for i in range(1203)])
            run("screen_sites.py", ["--all"], env=self.env(s))
            self.assertEqual([len(r["threatInfo"]["threatEntries"]) for r in s.seen], [500, 500, 203])
        finally:
            s.close()


class LighthouseTests(Tmp):
    def fixture(self, name, perf, a11y, bp=0.95, seo=1.0):
        return self.write(name, {"finalUrl": "https://site.test/" + name, "categories": {
            "performance": {"score": perf}, "accessibility": {"score": a11y}, "best-practices": {"score": bp}, "seo": {"score": seo}},
            "audits": {"largest-contentful-paint": {"displayValue": "2.1 s"}, "total-blocking-time": {"displayValue": "120 ms"},
                       "cumulative-layout-shift": {"displayValue": "0.01"}}})

    def test_good_and_bad_scores(self):
        good = self.fixture("good.json", 0.9, 0.97)
        bad = self.fixture("bad.json", 0.41, 0.97)
        r = run("lighthouse_report.py", [good, "--dry-run"])
        self.assertIn("Weekly site check", r.stdout)
        self.assertNotIn("below the limit", r.stdout)
        self.assertIn("LCP 2.1 s", r.stdout)
        r = run("lighthouse_report.py", [good, bad, "--dry-run"])
        self.assertIn("below the limit", r.stdout)
        self.assertIn("Speed 41 ⚠️", r.stdout)
        self.assertIn("Speed 90", r.stdout)

    def test_unreadable_file_is_reported_not_fatal(self):
        p = self.write("broken.json", "{not json")
        r = run("lighthouse_report.py", [p, "--dry-run"])
        self.assertEqual(r.returncode, 0)
        self.assertIn("could not be read", r.stdout)


class AddSiteTests(Tmp):
    def add(self, *args):
        return run("add_site.py", list(args), env={"INFO_JSON": os.path.join(self.d, INFO_REL)})

    def test_add_refuse_duplicate_and_bad_section(self):
        self.write(INFO_REL, [site(1, rank=3), site(2, rank=7), site(3, section="Music", rank=2)])
        r = self.add("newsite.org", "New Site", "anime streaming")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        raw = open(os.path.join(self.d, INFO_REL), encoding="utf-8").read()
        data = json.loads(raw)
        new = data[-1]
        self.assertEqual((new["url"], new["section"], new["rank"], new["nsfw"], new["avoid"]), ("https://newsite.org", "Anime Streaming", 8, False, False))
        self.assertEqual(raw, json.dumps(data, indent=2, ensure_ascii=False), "same file format as the updater")
        self.assertEqual(self.add("https://www.NewSite.org/", "Again", "Music").returncode, 1)
        bad = self.add("other.com", "Other", "Nope")
        self.assertEqual(bad.returncode, 1)
        self.assertIn("Music", bad.stdout)
        self.assertEqual(len(json.load(open(os.path.join(self.d, INFO_REL), encoding="utf-8"))), 4)
        self.assertEqual(self.add("not an address", "X", "Music").returncode, 1)
        r = self.add("adultone.com", "Adult", "Music", "--nsfw", "--tags", "Online,Free")
        last = json.load(open(os.path.join(self.d, INFO_REL), encoding="utf-8"))[-1]
        self.assertTrue(last["nsfw"])
        self.assertEqual(last["tags"], ["Online", "Free"])


class FeedTests(Tmp):
    def test_feed_adds_only_clean_new_sites_and_is_idempotent(self):
        shutil.copy(os.path.join(ROOT, "index.html"), self.d)
        old = [site(1)]
        new = old + [site(2), site(3, nsfw=True), site(4, avoid=True, avoid_reason="x"), site(5, name="A & B <c>")]
        b, a = self.write("b.json", old), self.write("a.json", new)
        r = run("build-feed.py", ["--before", b, "--after", a], cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        feed = open(os.path.join(self.d, "feed.xml"), encoding="utf-8").read()
        import xml.dom.minidom
        xml.dom.minidom.parseString(feed.encode("utf-8"))           # valid XML (the & and <> were escaped)
        self.assertIn("Site 2", feed)
        self.assertIn("A &amp; B &lt;c&gt;", feed)
        self.assertNotIn("Site 3", feed)
        self.assertNotIn("Site 4", feed)
        r2 = run("build-feed.py", ["--before", b, "--after", a], cwd=self.d)
        again = open(os.path.join(self.d, "feed.xml"), encoding="utf-8").read()
        self.assertEqual(feed.count("<entry>"), again.count("<entry>"), "running twice does not duplicate entries")
        self.assertEqual(feed, again)


class SectionTests(Tmp):
    def test_pages_skip_adult_and_flagged_and_are_stable(self):
        for f in ("index.html", "directory.html", "sitemap.xml"):
            shutil.copy(os.path.join(ROOT, f), self.d)
        data = [site(1), site(2, nsfw=True, name="AdultSite"), site(3, avoid=True, avoid_reason="x", name="RiskySite"),
                site(4, section="Hentai", nsfw=True, name="OnlyAdult")]
        self.write(INFO_REL, data)
        r = run("build-sections.py", cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        files = os.listdir(os.path.join(self.d, "sections"))
        self.assertIn("anime.html", files)
        page = open(os.path.join(self.d, "sections", "anime.html"), encoding="utf-8").read()
        self.assertIn("Site 1", page)
        self.assertNotIn("AdultSite", page)
        self.assertNotIn("RiskySite", page)
        self.assertNotIn("OnlyAdult", "".join(open(os.path.join(self.d, "sections", f), encoding="utf-8").read() for f in files))
        self.assertIn('rel="nofollow noopener noreferrer"', page)
        first = open(os.path.join(self.d, "sitemap.xml"), encoding="utf-8").read()
        run("build-sections.py", cwd=self.d)
        self.assertEqual(first, open(os.path.join(self.d, "sitemap.xml"), encoding="utf-8").read())


class PruneTests(Tmp):
    def test_second_opinion(self):
        def h(path, method, body):
            code = {"/ok": 200, "/guarded": 403, "/gone": 404, "/err": 503, "/ratelimit": 429}.get(path, 200)
            return code, b"x", {}
        s = Server(h)
        try:
            names = ["ok", "guarded", "gone", "err", "ratelimit", "keepme"]
            info = [{"url": f"{s.base}/{n}", "name": n, "slug": n} for n in names] + [{"url": "https://fine.example/", "name": "fine", "slug": "f"}]
            self.write(INFO_REL, info)
            removed = [{"url": f"{s.base}/{n}", "slug": n, "lastStatus": "down"} for n in names[:5]] + [{"url": f"{s.base}/keepme", "slug": "keepme", "lastStatus": "blocked"}]
            wp = self.write("worker.json", {"removed": removed})
            env = {"MONITOR_API_URL": "file://" + wp, "INFO_JSON": os.path.join(self.d, INFO_REL), "BLOCKLIST": os.path.join(self.d, "scripts", "dead_sites.txt")}
            r = run("prune_dead.py", env=env)
            self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
            left = [x["name"] for x in json.load(open(os.path.join(self.d, INFO_REL), encoding="utf-8"))]
            self.assertEqual(sorted(left), sorted(["ok", "guarded", "ratelimit", "keepme", "fine"]))
            raw = open(os.path.join(self.d, INFO_REL), encoding="utf-8").read()
            self.assertFalse(raw.endswith("\n"), "same format as the updater (no trailing newline)")
            block = open(os.path.join(self.d, "scripts", "dead_sites.txt")).read().split()
            self.assertEqual(sorted(block), sorted([f"{s.base}/err", f"{s.base}/gone"]))
        finally:
            s.close()

    def test_worker_unreachable_fails_loudly(self):
        self.write(INFO_REL, [site(1)])
        env = {"MONITOR_API_URL": "file://" + os.path.join(self.d, "nope.json"), "INFO_JSON": os.path.join(self.d, INFO_REL),
               "BLOCKLIST": os.path.join(self.d, "scripts", "dead_sites.txt")}
        self.assertEqual(run("prune_dead.py", env=env).returncode, 1)


class SiteCheckTests(unittest.TestCase):
    def run_check(self, status):
        s = Server(lambda path, m, b: (status, b"<html>hi</html>", {}))
        try:
            env = {"SITE_URL": s.base + "/", "HEALTH_URL": s.base + "/health", "GITHUB_API_URL": s.base}
            return run("heartbeat.py", ["--dry-run"], env=env)
        finally:
            s.close()

    def test_site_down_is_reported(self):
        r = self.run_check(503)
        self.assertIn("is not answering", r.stdout)

    def test_site_up_is_quiet(self):
        r = self.run_check(200)
        self.assertNotIn("is not answering", r.stdout)


class HeartbeatTests(unittest.TestCase):
    def go(self, health, wfstate, age_h):
        puts = []

        def h(path, method, body):
            if path == "/health":
                return health[0], health[1], {"Content-Type": "application/json"}
            if method == "PUT":
                puts.append(path)
                return 204, None, {}
            if "/runs" in path:
                t = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=age_h)).strftime("%Y-%m-%dT%H:%M:%SZ")
                return 200, {"workflow_runs": [{"created_at": t}]}, {"Content-Type": "application/json"}
            return 200, {"state": wfstate}, {"Content-Type": "application/json"}
        s = Server(h)
        try:
            env = {"HEALTH_URL": s.base + "/health", "GITHUB_API_URL": s.base, "GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": "t"}
            r = run("heartbeat.py", ["--dry-run"], env=env)
        finally:
            s.close()
        return r, puts

    def test_all_good(self):
        r, puts = self.go((200, {"ok": True, "problems": []}), "active", 5)
        self.assertIn("All good", r.stdout)
        self.assertEqual(puts, [])

    def test_everything_wrong_and_auto_reenable(self):
        r, puts = self.go((503, {"ok": False, "problems": ["no check has finished for 95 minutes"]}), "disabled_inactivity", 50)
        self.assertIn("no check has finished for 95 minutes", r.stdout)
        self.assertIn("has not succeeded for 50 hours", r.stdout)
        self.assertEqual(len(puts), 2)
        self.assertTrue(all(p.endswith("/enable") for p in puts))


if __name__ == "__main__":
    unittest.main()
