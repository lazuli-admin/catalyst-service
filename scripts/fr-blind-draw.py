#!/usr/bin/env python3
"""fr-blind-draw.py — draw a blind sample of Federal Register documents.

Purpose: build a document pool from the federalregister.gov API and draw a
random sample for blind labeling fixtures.

Method: mirrors catalyst-design/pool2.py exactly — same base URL, same field
list, same parameter order (per_page=100, page, order=oldest,
publication_date gte/lte, then extra params, then fields[]), same per-agency
loop over the 7 agency slugs with types RULE, PRORULE, NOTICE, PRESDOCU,
then a separate all-PRESDOCU query. Pool is concatenated in that order and
duplicates are kept in the raw pool.

After building the pool: any document_numbers present in --exclude files
(prior sample JSONs, lists of objects with document_number) are removed,
then the remainder is deduped by document_number keeping the first
occurrence (matches sample 2's method: "removed the 200 document_numbers in
fr-blind-labels.json and any duplicates"). Then
random.Random(seed).sample(remaining, n) is drawn.

Example:
  python3 scripts/fr-blind-draw.py --seed 7 --n 200 \
    --exclude test/fixtures/fr-blind-1.json \
    --exclude test/fixtures/fr-blind-2.json \
    --out /tmp/fr-blind-3-unlabeled.json

Note: sample 2 was drawn with seed 7 excluding fr-blind-1. The drawn rows
still need labeling (relevant/borderline/reason) before use as a fixture.

Use --pool-cache FILE to save the raw pool JSON (write) or reuse it
instead of refetching (read).
"""

import argparse
import json
import random
import sys
import urllib.parse
import urllib.request

B = "https://www.federalregister.gov/api/v1/documents.json"
F = ["document_number", "title", "abstract", "type", "agencies",
     "publication_date", "effective_on", "comments_close_on", "dates",
     "raw_text_url"]

AGENCIES = [
    "industry-and-security-bureau",
    "federal-communications-commission",
    "securities-and-exchange-commission",
    "federal-trade-commission",
    "trade-representative-office-of-united-states",
    "international-trade-administration",
    "u-s-customs-and-border-protection",
]


def q(params, start, end):
    out = []
    page = 1
    while True:
        p = [("per_page", "100"), ("page", str(page)), ("order", "oldest"),
             ("conditions[publication_date][gte]", start),
             ("conditions[publication_date][lte]", end)] \
            + params + [("fields[]", f) for f in F]
        with urllib.request.urlopen(B + "?" + urllib.parse.urlencode(p)) as r:
            d = json.load(r)
        out += d.get("results", [])
        if not d.get("next_page_url"):
            break
        page += 1
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--start", default="2025-11-01")
    ap.add_argument("--end", default="2026-10-31")
    ap.add_argument("--exclude", action="append", default=[],
                    metavar="FILE",
                    help="prior sample JSON (list of objects with document_number); repeatable")
    ap.add_argument("--pool-cache", metavar="FILE",
                    help="save raw pool JSON to FILE; load from it if it exists")
    ap.add_argument("--out", default=None, help="output JSON path (default stdout)")
    args = ap.parse_args()

    pool = None
    if args.pool_cache:
        try:
            with open(args.pool_cache) as f:
                pool = json.load(f)
        except FileNotFoundError:
            pass
    if pool is None:
        T = [("conditions[type][]", t) for t in ["RULE", "PRORULE", "NOTICE", "PRESDOCU"]]
        pool = []
        ct = {}
        for a in AGENCIES:
            r = q([("conditions[agencies][]", a)] + T, args.start, args.end)
            ct[a] = len(r)
            pool += r
        r = q([("conditions[type][]", "PRESDOCU")], args.start, args.end)
        ct["PRESDOCU"] = len(r)
        pool += r
        print(f"pool per-agency counts: {ct}", file=sys.stderr)
        if args.pool_cache:
            with open(args.pool_cache, "w") as f:
                json.dump(pool, f)

    excluded = set()
    for path in args.exclude:
        with open(path) as f:
            excluded.update(doc["document_number"] for doc in json.load(f))

    remaining, seen = [], set()
    for doc in pool:
        dn = doc.get("document_number")
        if dn in excluded or dn in seen:
            continue
        seen.add(dn)
        remaining.append(doc)

    print(f"pool={len(pool)} excluded={len(excluded)} remaining={len(remaining)}", file=sys.stderr)

    drawn = random.Random(args.seed).sample(remaining, args.n)
    data = json.dumps(drawn, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(data + "\n")
        print(f"wrote {len(drawn)} docs to {args.out}", file=sys.stderr)
    else:
        print(data)


if __name__ == "__main__":
    main()
