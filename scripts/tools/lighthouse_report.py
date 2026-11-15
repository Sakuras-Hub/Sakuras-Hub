"""Turn Lighthouse results into a short Discord report.

Lighthouse (Google's page checker) is run by .github/workflows/lighthouse.yml against your live site.
This script reads the JSON files it wrote and posts one summary: scores for performance,
accessibility, best practices and SEO, plus the main speed numbers, with a warning sign
next to anything below the limits.

    python scripts/tools/lighthouse_report.py lh-*.json            # post to Discord (alerts channel)
    python scripts/tools/lighthouse_report.py lh-*.json --dry-run  # just print it

Scores are 0-100. Limits (change them below): performance 60, others 90.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import discord_notify  # noqa: E402

LIMITS = {"performance": 60, "accessibility": 90, "best-practices": 90, "seo": 90}
LABELS = {"performance": "Speed", "accessibility": "Accessibility", "best-practices": "Best practices", "seo": "SEO"}
METRICS = [("largest-contentful-paint", "LCP"), ("total-blocking-time", "TBT"), ("cumulative-layout-shift", "CLS")]


def summarise(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    cats = d.get("categories", {})
    scores = {k: round((cats.get(k, {}).get("score") or 0) * 100) for k in LIMITS}
    audits = d.get("audits", {})
    metrics = {short: audits.get(key, {}).get("displayValue", "") for key, short in METRICS}
    return d.get("finalUrl") or d.get("requestedUrl") or path, scores, metrics


def build(paths):
    lines, worst = [], False
    for p in paths:
        try:
            url, scores, metrics = summarise(p)
        except Exception as e:
            lines.append(f"• {p}: could not be read ({type(e).__name__})")
            worst = True
            continue
        bits = []
        for k, lim in LIMITS.items():
            low = scores[k] < lim
            worst = worst or low
            bits.append(f"{LABELS[k]} {scores[k]}{' ⚠️' if low else ''}")
        m = " · ".join(f"{k} {v}" for k, v in metrics.items() if v)
        lines.append(f"**{url}**\n" + " · ".join(bits) + (f"\n{m}" if m else ""))
    return "\n\n".join(lines), worst


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1
    text, worst = build(args)
    payload = {
        "username": "Sakura’s Hub",
        "allowed_mentions": {"parse": []},
        "embeds": [{
            "title": ("⚠️ Weekly site check: something is below the limit" if worst else "✅ Weekly site check"),
            "description": text[:3900],
            "color": discord_notify.COLORS["risky"] if worst else discord_notify.COLORS["added"],
            "footer": {"text": "Lighthouse, mobile. Limits: speed 60, others 90"},
        }],
    }
    if "--dry-run" in sys.argv:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    return discord_notify.send_all([payload], "alerts")


if __name__ == "__main__":
    sys.exit(main())
