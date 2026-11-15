"""Post directory changes to a Discord channel.

Compares two copies of info.json (before and after a job ran) and posts what
changed: sites added, removed, flagged as risky, un-flagged, and updated.

    python scripts/tools/discord_notify.py --before old.json --after new.json \
        --source "Daily update" --commit-url https://github.com/.../commit/abc

Or post one plain message (used when a job fails):
    python scripts/tools/discord_notify.py --text "Daily update failed" --link https://...

The webhook address is read from the DISCORD_WEBHOOK_URL environment variable
(a GitHub secret). Problems (--text, or --channel alerts) go to
DISCORD_WEBHOOK_URL_ALERTS if that is set, so you can keep them in a separate channel. It is never stored in the repo. If it is missing, this
script prints a note and exits 0, so it can never break a workflow.

Options:
    --dry-run      print the messages instead of sending them
    --show-nsfw    list adult sites by name (default: only count them, so the
                   channel does not need to be age-restricted)

Posts at most MAX_MESSAGES messages per run; anything beyond that is
summarised with a link to the commit.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

MAX_MESSAGES = 6          # per run (Discord allows far more, but a feed should stay readable)
EMBEDS_PER_MESSAGE = 3
CHUNK_CHARS = 1800        # per embed description (Discord limit is 4096)
SITE_BASE = (os.environ.get("SITE_BASE_URL") or "https://sakuras-hub.github.io/Sakuras-Hub").rstrip("/")

COLORS = {
    "added": 0x3ECF8E,      # green
    "removed": 0xFF5F6D,    # red
    "risky": 0xF0B429,      # amber
    "cleared": 0x6EA8FF,    # blue
    "updated": 0xB98CFF,    # purple
}
TITLES = {
    "added": "🌸 New sites added",
    "removed": "🗑️ Sites removed",
    "risky": "⚠️ Flagged as risky",
    "cleared": "✅ No longer flagged",
    "updated": "✏️ Sites updated",
}
TRACKED_FIELDS = ["name", "section", "tags", "nsfw", "pricing", "countries"]


def norm(url):
    u = (url or "").strip().lower()
    for p in ("https://", "http://"):
        if u.startswith(p):
            u = u[len(p):]
    if u.startswith("www."):
        u = u[4:]
    return u.rstrip("/")


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    if isinstance(data, dict):
        data = data.get("sites", [])
    out = {}
    for s in data:
        if isinstance(s, dict) and s.get("url"):
            out[norm(s["url"])] = s
    return out


_ESCAPE = set("\\*_`~|")
_LOOKALIKE = {"[": "‹", "]": "›", "(": "﹙", ")": "﹚", "<": "‹", ">": "›"}


def clean(text, limit=80):
    """Make scraped text safe for a Discord embed: no markdown, links or odd tags."""
    t = " ".join(str(text or "").split())
    if len(t) > limit:
        t = t[: limit - 1] + "…"
    return "".join("\\" + ch if ch in _ESCAPE else _LOOKALIKE.get(ch, ch) for ch in t)


def link(site):
    url = str(site.get("url", "")).replace(")", "%29").replace("(", "%28").replace(" ", "%20")
    return f"[{clean(site.get('name') or url, 60)}]({url})"


def diff(before, after):
    added, removed, risky, cleared, updated = [], [], [], [], []
    for k, s in after.items():
        if k not in before:
            (risky if s.get("avoid") else added).append(s)     # a new site that arrives flagged is news as "risky"
            continue
        o = before[k]
        if bool(s.get("avoid")) and not bool(o.get("avoid")):
            risky.append(s)
        elif bool(o.get("avoid")) and not bool(s.get("avoid")):
            cleared.append(s)
        changes = []
        for f in TRACKED_FIELDS:
            a, b = o.get(f), s.get(f)
            if f in ("tags", "countries"):
                a, b = sorted(a or []), sorted(b or [])
            if (a or None) != (b or None):
                changes.append(f)
        if changes:
            updated.append((s, o, changes))
        elif bool(s.get("avoid")) and bool(o.get("avoid")) and (s.get("avoid_reason") or "") != (o.get("avoid_reason") or ""):
            updated.append((s, o, ["warning"]))
    for k, s in before.items():
        if k not in after:
            removed.append(s)
    return added, removed, risky, cleared, updated


def lines_for(kind, items, show_nsfw):
    """Return (lines, hidden_nsfw_count)."""
    lines, hidden = [], 0
    for it in items:
        s = it[0] if kind == "updated" else it
        if s.get("nsfw") and not show_nsfw:
            hidden += 1
            continue
        section = clean(s.get("section") or "", 40)
        if kind == "risky":
            reason = clean(s.get("avoid_reason") or "no reason given", 110)
            lines.append(f"• {link(s)} · {section}\n  ↳ {reason}")
        elif kind == "updated":
            _, old, changes = it
            what = []
            for c in changes:
                if c == "name":
                    what.append(f"renamed from {clean(old.get('name'), 40)}")
                elif c == "section":
                    what.append(f"moved from {clean(old.get('section'), 30)} to {section}")
                elif c == "warning":
                    what.append("warning text changed")
                else:
                    what.append(f"{c} changed")
            lines.append(f"• {link(s)} · " + ", ".join(what))
        else:
            lines.append(f"• {link(s)} · {section}")
    return lines, hidden


def chunk(lines):
    out, cur, size = [], [], 0
    for ln in lines:
        if cur and size + len(ln) + 1 > CHUNK_CHARS:
            out.append("\n".join(cur))
            cur, size = [], 0
        cur.append(ln[:CHUNK_CHARS])
        size += len(ln) + 1
    if cur:
        out.append("\n".join(cur))
    return out


def build_messages(added, removed, risky, cleared, updated, source, commit_url, show_nsfw, totals):
    embeds = []
    groups = [("added", added), ("risky", risky), ("removed", removed), ("cleared", cleared), ("updated", updated)]
    for kind, items in groups:
        if not items:
            continue
        lines, hidden = lines_for(kind, items, show_nsfw)
        pieces = chunk(lines) or []
        if hidden:
            note = f"+ {hidden} adult site{'s' if hidden != 1 else ''} (names hidden)"
            if pieces and len(pieces[-1]) + len(note) + 1 < 4000:
                pieces[-1] += "\n" + note
            else:
                pieces.append(note)
        for i, desc in enumerate(pieces):
            title = f"{TITLES[kind]} ({len(items)})" if i == 0 else f"{TITLES[kind]} (cont.)"
            embeds.append({"title": title, "description": desc, "color": COLORS[kind]})

    if not embeds:
        return []

    messages, i = [], 0
    while i < len(embeds):
        messages.append(embeds[i:i + EMBEDS_PER_MESSAGE])
        i += EMBEDS_PER_MESSAGE

    dropped = 0
    if len(messages) > MAX_MESSAGES:
        dropped = sum(len(m) for m in messages[MAX_MESSAGES:])
        messages = messages[:MAX_MESSAGES]

    footer_bits = [source]
    if totals:
        footer_bits.append(f"{totals:,} sites in the directory")
    footer = " · ".join(b for b in footer_bits if b)
    if dropped:
        tail = f"…and more changes not shown here."
        if commit_url:
            tail += f" [See the full change]({commit_url})"
        messages[-1].append({"description": tail, "color": 0x9E94C0})
    elif commit_url:
        messages[-1].append({"description": f"[View the change on GitHub]({commit_url})", "color": 0x9E94C0})
    messages[-1][-1]["footer"] = {"text": footer}
    messages[-1][-1]["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    payloads = []
    for n, embs in enumerate(messages):
        # Discord caps a message at 6000 characters across all embeds.
        total = sum(len(e.get("title", "")) + len(e.get("description", "")) for e in embs)
        while total > 5800 and len(embs) > 1:
            payloads.append(embs[:-1])
            embs = embs[-1:]
            total = sum(len(e.get("title", "")) + len(e.get("description", "")) for e in embs)
        payloads.append(embs)
    return [
        {
            "username": "Sakura’s Hub",
            "allowed_mentions": {"parse": []},       # scraped names can never ping anyone
            "embeds": embs,
            **({"content": f"**{source}** · {SITE_BASE}/directory"} if idx == 0 else {}),
        }
        for idx, embs in enumerate(payloads)
    ]


def post(webhook, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook + ("&" if "?" in webhook else "?") + "wait=false",
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "SakurasHub-notify/1.0"},
        method="POST",
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=15):
                return True
        except urllib.error.HTTPError as e:
            if e.code == 429:
                try:
                    wait = float(json.loads(e.read().decode("utf-8")).get("retry_after", 2))
                except Exception:
                    wait = 2.0
                time.sleep(min(wait, 10) + 0.25)
                continue
            print(f"Discord rejected the message: HTTP {e.code}", file=sys.stderr)
            return False
        except Exception as e:  # network hiccup
            print(f"Discord post failed ({e}); retrying", file=sys.stderr)
            time.sleep(1.5)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--before")
    ap.add_argument("--after")
    ap.add_argument("--text", help="post one plain message instead of a diff")
    ap.add_argument("--link", default="")
    ap.add_argument("--channel", choices=["feed", "alerts"], default=None,
                    help="feed = additions/removals/risky (default for diffs); alerts = problems (default for --text)")
    ap.add_argument("--source", default="Directory update")
    ap.add_argument("--commit-url", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--show-nsfw", action="store_true")
    args = ap.parse_args()

    if args.text:
        desc = clean(args.text, 500) + (f"\n[Open the run]({args.link})" if args.link else "")
        payloads = [{
            "username": "Sakura’s Hub",
            "allowed_mentions": {"parse": []},
            "embeds": [{"title": "⚠️ Automation problem", "description": desc, "color": COLORS["removed"]}],
        }]
        if args.dry_run:
            print(json.dumps(payloads[0], ensure_ascii=False, indent=2))
            return 0
        return send_all(payloads, args.channel or "alerts")

    if not args.before or not args.after:
        ap.error("--before and --after are required (or use --text)")
    before, after = load(args.before), load(args.after)
    if not before:
        print("No 'before' list found; skipping so a first run does not announce every site.")
        return 0
    added, removed, risky, cleared, updated = diff(before, after)
    print(f"added {len(added)}, removed {len(removed)}, flagged {len(risky)}, unflagged {len(cleared)}, updated {len(updated)}")

    payloads = build_messages(added, removed, risky, cleared, updated, args.source,
                              args.commit_url, args.show_nsfw or os.environ.get("DISCORD_SHOW_NSFW") == "1", len(after))
    if not payloads:
        print("Nothing to announce.")
        return 0
    if args.dry_run:
        for p in payloads:
            print(json.dumps(p, ensure_ascii=False, indent=2))
        return 0

    return send_all(payloads, args.channel or "feed")


def send_all(payloads, channel="feed"):
    """channel 'alerts' uses DISCORD_WEBHOOK_URL_ALERTS when set, otherwise the main webhook."""
    webhook = ""
    if channel == "alerts":
        webhook = os.environ.get("DISCORD_WEBHOOK_URL_ALERTS", "").strip()
    webhook = webhook or os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not webhook.startswith(("https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/")):
        print("DISCORD_WEBHOOK_URL is not set (or not a Discord webhook); skipping the Discord post.")
        return 0
    ok = True
    for n, p in enumerate(payloads):
        ok = post(webhook, p) and ok
        if n < len(payloads) - 1:
            time.sleep(1.2)       # stay well under Discord's rate limit
    print("Posted to Discord." if ok else "Some Discord posts failed (the job still succeeds).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
