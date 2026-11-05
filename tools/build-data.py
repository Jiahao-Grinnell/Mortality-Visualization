#!/usr/bin/env python3
"""Rebuild data/mortality-data.js from data/mortality.csv.

This is the ONLY step needed when new data arrives. Replace the CSV, run:

    python3 tools/build-data.py

The CSV must have these five columns, with a header row:

    year,cause,sex,race,rate

  year   integer
  cause  machine label, e.g. Circulatory_system  (display names live in
         assets/chart.js — add new causes to CAUSE_LABELS there)
  sex    All_Genders | Female | Male
  race   All_Races | White | Black | Other
  rate   deaths per 100,000 people

Causes, years, genders and races are read from the file, so new categories or
new years need no code change beyond adding a display label for a new cause.
"""

import csv
import json
import os
import sys
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "data", "mortality.csv")
OUT = os.path.join(ROOT, "data", "mortality-data.js")

# Fixed display order; anything in the data but not listed is appended.
SEX_ORDER = ["All_Genders", "Female", "Male"]
RACE_ORDER = ["All_Races", "White", "Black", "Other"]


def ordered(found, preferred):
    out = [v for v in preferred if v in found]
    out += sorted(v for v in found if v not in preferred)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    out = sys.argv[2] if len(sys.argv) > 2 else OUT

    with open(src, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    required = {"year", "cause", "sex", "race", "rate"}
    if not rows:
        sys.exit("error: %s has no data rows" % src)
    missing_cols = required - set(rows[0].keys())
    if missing_cols:
        sys.exit("error: %s is missing column(s): %s" % (src, ", ".join(sorted(missing_cols))))

    years = sorted({int(r["year"]) for r in rows})
    causes = sorted({r["cause"] for r in rows})
    sexes = ordered({r["sex"] for r in rows}, SEX_ORDER)
    races = ordered({r["race"] for r in rows}, RACE_ORDER)
    idx = {y: i for i, y in enumerate(years)}

    series = collections.defaultdict(lambda: [None] * len(years))
    for r in rows:
        raw = (r["rate"] or "").strip()
        if raw == "":
            continue                      # blank cell -> gap in the line
        series["%s|%s|%s" % (r["cause"], r["sex"], r["race"])][idx[int(r["year"])]] = \
            round(float(raw), 6)

    expected = len(causes) * len(sexes) * len(races)
    gaps = sum(1 for v in series.values() for x in v if x is None)

    payload = {
        "years": years, "causes": causes, "sexes": sexes, "races": races,
        "series": {k: series[k] for k in sorted(series)},
    }

    with open(out, "w", encoding="utf-8") as f:
        f.write("/* Auto-generated from data/mortality.csv - do not hand-edit.\n")
        f.write("   Rebuild with: python3 tools/build-data.py */\n")
        f.write("window.MORTALITY_DATA = ")
        json.dump(payload, f, separators=(",", ":"))
        f.write(";\n")

    print("wrote %s" % os.path.relpath(out, ROOT))
    print("  years   %d  (%d-%d)" % (len(years), years[0], years[-1]))
    print("  causes  %d" % len(causes))
    print("  series  %d of %d possible combinations" % (len(series), expected))
    if gaps:
        print("  NOTE: %d missing values -> those lines will show gaps" % gaps)
    print("\nNow run: python3 tools/check-data.py")


if __name__ == "__main__":
    main()
