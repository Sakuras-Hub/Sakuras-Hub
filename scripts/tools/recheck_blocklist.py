"""Find sites on the dead-site blocklist that are actually alive.

Older versions of the monitor counted "blocked" (bot-protected) sites as dead, so
some live sites may have been removed and blocklisted. This checks every address in
scripts/dead_sites.txt from your own network and lists the ones that still answer.

    python scripts/tools/recheck_blocklist.py            # just list them
    python scripts/tools/recheck_blocklist.py --apply    # also take them off the blocklist

Taken-off sites are not added back by this script: the daily updater finds them again
from its source lists, and the monitor (v3) will no longer call them dead for being blocked.
Takes a few minutes for a long list. Run it from the repo root on a normal home connection.
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prune_dead  # noqa: E402

BLOCKLIST = prune_dead.BLOCKLIST


def main():
    apply = "--apply" in sys.argv
    with open(BLOCKLIST, encoding="utf-8") as f:
        urls = [l.strip() for l in f if l.strip()]
    full = [u if u.startswith("http") else "https://" + u for u in urls]
    print(f"Checking {len(full)} blocklisted addresses...")
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(prune_dead.alive_from_here, full))
    alive = [(u, why) for u, (ok, why) in zip(urls, results) if ok]
    for u, why in alive:
        print(f"  still answers: {u} ({why})")
    print(f"{len(alive)} of {len(urls)} blocklisted sites are alive.")
    if apply and alive:
        keep = set(u for u, _ in alive)
        with open(BLOCKLIST, "w", encoding="utf-8") as f:
            f.write("\n".join(u for u in urls if u not in keep) + "\n")
        print(f"Removed {len(alive)} from {BLOCKLIST}. Commit the change.")
    elif alive:
        print("Run again with --apply to take them off the blocklist.")


if __name__ == "__main__":
    main()
