#!/usr/bin/env python3
"""Sanity-check data/mortality.csv before publishing.

    python3 tools/check-data.py

Catches the kinds of problems that are invisible in a chart but wrong in the
data. Run it whenever the CSV changes. Exits non-zero if a check fails, so it
can gate a publish.

Checks:
  1. Every cause x sex x race combination has a value for every year.
  2. No negative rates.
  3. "All races" lies within the range of White / Black / Other, and
     "All genders" within the range of Female / Male. An aggregate that falls
     outside its own components is arithmetically impossible.
  4. Flags implausible year-on-year jumps, which usually mean a coding change
     (ICD-9 -> ICD-10 in 1999) rather than a real change in mortality.

Check 3 currently FAILS on the legacy 1999/2004/2009 data recovered from the
old page. That is a genuine fault in the source extract, not in this tool.
"""

import csv
import os
import sys
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "data", "mortality.csv")

TOTAL_RACE, PART_RACES = "All_Races", ("White", "Black", "Other")
TOTAL_SEX, PART_SEXES = "All_Genders", ("Female", "Male")
TOL = 0.02          # 2% slack for rounding in the published figures
JUMP = 5.0          # ratio that counts as "implausible" year on year


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    with open(src, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    V, years, causes = {}, set(), set()
    sexes, races = set(), set()
    for r in rows:
        y = int(r["year"])
        V[(r["cause"], r["sex"], r["race"], y)] = float(r["rate"])
        years.add(y); causes.add(r["cause"]); sexes.add(r["sex"]); races.add(r["race"])
    years = sorted(years); causes = sorted(causes)
    sexes = sorted(sexes); races = sorted(races)

    print("%d rows | %d causes x %d genders x %d races x %d years"
          % (len(rows), len(causes), len(sexes), len(races), len(years)))

    failures = 0

    # 1. completeness
    missing = [(c, s, r, y) for c in causes for s in sexes for r in races for y in years
               if (c, s, r, y) not in V]
    if missing:
        failures += 1
        print("\nFAIL  %d missing cells, e.g. %s" % (len(missing), missing[:3]))
    else:
        print("\nPASS  every combination has a value for every year")

    # 2. negatives
    neg = [k for k, v in V.items() if v < 0]
    if neg:
        failures += 1
        print("FAIL  %d negative rates, e.g. %s" % (len(neg), neg[:3]))
    else:
        print("PASS  no negative rates")

    # 3. aggregates inside their components
    def check_aggregate(label, total_key, parts, build):
        bad = []
        for c in causes:
            for other in (sexes if label == "race" else races):
                for y in years:
                    try:
                        tot = V[build(c, other, total_key, y)]
                        comp = [V[build(c, other, p, y)] for p in parts]
                    except KeyError:
                        continue
                    if tot > max(comp) * (1 + TOL) or tot < min(comp) * (1 - TOL):
                        bad.append((c, other, y, tot, comp))
        total_cells = len(causes) * len(sexes if label == "race" else races) * len(years)
        if bad:
            by_year = collections.Counter(b[2] for b in bad)
            print("FAIL  '%s' outside its components in %d of %d cells"
                  % (total_key, len(bad), total_cells))
            print("        by year: %s" % dict(sorted(by_year.items())))
            for c, o, y, tot, comp in bad[:3]:
                print("        %s / %s / %d: total=%.3f vs %s"
                      % (c, o, y, tot, ", ".join("%.3f" % x for x in comp)))
            return 1
        print("PASS  '%s' always lies within its components" % total_key)
        return 0

    if TOTAL_RACE in races and all(p in races for p in PART_RACES):
        failures += check_aggregate("race", TOTAL_RACE, PART_RACES,
                                    lambda c, s, r, y: (c, s, r, y))
    if TOTAL_SEX in sexes and all(p in sexes for p in PART_SEXES):
        failures += check_aggregate("sex", TOTAL_SEX, PART_SEXES,
                                    lambda c, r, s, y: (c, s, r, y))

    # 4. implausible jumps (warning only)
    jumps = []
    for c in causes:
        for s in sexes:
            for r in races:
                for a, b in zip(years, years[1:]):
                    va, vb = V.get((c, s, r, a)), V.get((c, s, r, b))
                    if va and vb and va > 0.05:
                        ratio = vb / va
                        if ratio >= JUMP or ratio <= 1 / JUMP:
                            jumps.append((ratio, c, s, r, a, b))
    if jumps:
        jumps.sort(key=lambda t: -t[0])
        by_period = collections.Counter("%d->%d" % (j[4], j[5]) for j in jumps)
        print("\nWARN  %d series change by %gx or more between adjacent years"
              % (len(jumps), JUMP))
        print("        by period: %s" % dict(by_period))
        for ratio, c, s, r, a, b in jumps[:3]:
            print("        x%-7.1f %s / %s / %s  %d->%d" % (ratio, c, s, r, a, b))
        print("        Check these against a coding change before publishing.")
    else:
        print("\nPASS  no implausible year-on-year jumps")

    print("\n%s" % ("ALL CHECKS PASS" if failures == 0 else "%d CHECK(S) FAILED" % failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
