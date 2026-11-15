"""Check that the automation is still alive, and tell Discord if it is not.

Checks:
  1. The Cloudflare worker answers /health and says it is fine (it has finished a
     check recently and can read info.json).
  2. The daily update workflow has succeeded in the last 36 hours.
  3. The website itself answers (SITE_URL, set as a repository variable; skipped if unset).
  4. The workflows that run on a schedule are still enabled. GitHub switches
     scheduled workflows off after about 60 days without repository activity;
     if that happened, this script turns them back on.

Run by .github/workflows/heartbeat.yml every 6 hours. It exits 0 either way, so
the job never shows a red cross just because it found a problem.

Environment (set by the workflow): MONITOR_API_URL, DISCORD_WEBHOOK_URL,
GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, SITE_URL (optional).
Try it without sending anything:   python scripts/tools/heartbeat.py --dry-run
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import discord_notify  # noqa: E402  (same folder)

MONITOR_API_URL = os.environ.get("MONITOR_API_URL", "https://sakura-monitor.fadded-market.workers.dev/status")
HEALTH_URL = os.environ.get("HEALTH_URL") or MONITOR_API_URL.rsplit("/", 1)[0] + "/health"
API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
REPO = os.environ.get("GITHUB_REPOSITORY", "")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
DAILY_WORKFLOWS = {"update-links.yml": 36}       # file -> max hours since last success
SCHEDULED_WORKFLOWS = ["update-links.yml", "prune-dead.yml"]
SITE_URL = os.environ.get("SITE_URL", "").strip()
UA = "SakurasHub-heartbeat/1.0"


def http(url, method="GET", data=None, headers=None, timeout=20):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8")
        return r.status, (json.loads(body) if body.strip().startswith(("{", "[")) else body)


def gh(path, method="GET"):
    return http(f"{API}{path}", method=method, headers={
        "Authorization": f"Bearer {TOKEN}", "X-GitHub-Api-Version": "2022-11-28",
        "Accept": "application/vnd.github+json"})


def check_worker():
    try:
        status, body = http(HEALTH_URL)
    except urllib.error.HTTPError as e:
        # /health answers 503 with a JSON body when something is wrong
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            return [f"The monitor worker answered HTTP {e.code} and no details."]
        return ["Monitor worker: " + p for p in (body.get("problems") or [f"HTTP {e.code}"])]
    except Exception as e:
        return [f"The monitor worker cannot be reached ({type(e).__name__}). Is it deployed?"]
    if isinstance(body, dict) and not body.get("ok", True):
        return ["Monitor worker: " + p for p in body.get("problems", ["unhealthy"])]
    return []


def check_site():
    """The public website answers with a normal page (retried once to ignore a blip)."""
    if not SITE_URL.startswith(("http://", "https://")):
        return []
    last = ""
    for _ in range(2):
        try:
            req = urllib.request.Request(SITE_URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status < 400:
                    return []
                last = f"HTTP {r.status}"
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except Exception as e:
            last = type(e).__name__
    return [f"The website {SITE_URL} is not answering ({last})."]


def check_workflows():
    problems, notes = [], []
    if not (REPO and TOKEN):
        return problems, ["Skipped the GitHub workflow checks (no token)."]
    for wf in SCHEDULED_WORKFLOWS:
        try:
            _, info = gh(f"/repos/{REPO}/actions/workflows/{wf}")
        except Exception as e:
            notes.append(f"Could not read workflow {wf}: {e}")
            continue
        state = info.get("state")
        if state and state != "active":
            try:
                gh(f"/repos/{REPO}/actions/workflows/{wf}/enable", method="PUT")
                problems.append(f"GitHub had switched off the scheduled job {wf} (state: {state}). I turned it back on.")
            except Exception:
                problems.append(f"The scheduled job {wf} is switched off (state: {state}) and I could not turn it back on. "
                                f"Open the Actions tab and enable it.")
    for wf, max_hours in DAILY_WORKFLOWS.items():
        try:
            _, runs = gh(f"/repos/{REPO}/actions/workflows/{wf}/runs?status=success&per_page=1")
        except Exception as e:
            notes.append(f"Could not read runs of {wf}: {e}")
            continue
        items = (runs or {}).get("workflow_runs") or []
        if not items:
            problems.append(f"{wf} has never succeeded.")
            continue
        created = datetime.datetime.strptime(items[0]["created_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        age_h = (datetime.datetime.now(datetime.timezone.utc) - created).total_seconds() / 3600
        if age_h > max_hours:
            problems.append(f"{wf} has not succeeded for {age_h:.0f} hours (it should run daily).")
    return problems, notes


def main():
    dry = "--dry-run" in sys.argv
    problems = check_worker() + check_site()
    wf_problems, notes = check_workflows()
    problems += wf_problems
    for n in notes:
        print("note:", n)
    if not problems:
        print("All good: worker healthy, site reachable, daily update on time.")
        return 0
    print("Problems found:")
    for p in problems:
        print(" -", p)
    text = "\n".join("• " + p for p in problems)
    payloads = [{
        "username": "Sakura’s Hub",
        "allowed_mentions": {"parse": []},
        "embeds": [{"title": "⚠️ Automation needs a look", "description": text[:1500],
                    "color": discord_notify.COLORS["risky"], "footer": {"text": "Heartbeat check, every 6 hours"}}],
    }]
    if dry:
        print(json.dumps(payloads[0], ensure_ascii=False, indent=2))
        return 0
    return discord_notify.send_all(payloads, "alerts")


if __name__ == "__main__":
    sys.exit(main())
