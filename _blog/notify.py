#!/usr/bin/env python3
"""Email a published post to newsletter subscribers.

  python3 _blog/notify.py <slug> --test you@example.com   send only to yourself first
  python3 _blog/notify.py <slug> --dry-run                count recipients, send nothing
  python3 _blog/notify.py <slug>                          send to all confirmed subscribers
  python3 _blog/notify.py <slug> --retry-failed           resend only to addresses that failed
  python3 _blog/notify.py <slug> --print-payload          show what would be sent, no network

Needs NEWSLETTER_BROADCAST_TOKEN in the environment (the worker's BROADCAST_TOKEN secret).
Run it AFTER the post is live, so the link in the email works. A post can only be sent once;
the worker refuses a second send unless you pass --force.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = os.environ.get("NEWSLETTER_ENDPOINT", "https://furyengi.cv/api/newsletter/broadcast")


def build_payload(slug):
    folder = ROOT / "_blog" / "posts" / slug
    if not (folder / "meta.json").exists():
        sys.exit(f"No such post: _blog/posts/{slug}/meta.json")
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    return {
        "slug": slug,
        "title": meta["title"],
        "description": meta["description"],
        "url": f"https://blog.furyengi.cv/{slug}/",
        "image": f"https://furyengi.cv/{meta['cover']}",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slug")
    parser.add_argument("--test", metavar="EMAIL", help="send only to this address")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--force", action="store_true", help="send again even if this post was already sent")
    parser.add_argument("--print-payload", action="store_true")
    args = parser.parse_args()

    payload = build_payload(args.slug)
    if args.test:
        payload["test"] = args.test
    if args.dry_run:
        payload["dryRun"] = True
    if args.retry_failed:
        payload["retryFailed"] = True
    if args.force:
        payload["force"] = True

    if args.print_payload:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return

    token = os.environ.get("NEWSLETTER_BROADCAST_TOKEN")
    if not token:
        sys.exit("Set NEWSLETTER_BROADCAST_TOKEN (the worker's BROADCAST_TOKEN secret).")

    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "furyengi-notify/1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            status, body = response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read().decode("utf-8")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach {ENDPOINT}: {error.reason}")

    try:
        print(json.dumps(json.loads(body), indent=2))
    except ValueError:
        print(body)
    sys.exit(0 if 200 <= status < 300 else 1)


if __name__ == "__main__":
    main()
