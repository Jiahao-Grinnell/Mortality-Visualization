# US Mortality by Cause of Death, Race, and Gender — DASIL

A rebuild of the DASIL visualization at
`https://dasil.sites.grinnell.edu/visualizations/Mortality/`.

Plain HTML, CSS and JavaScript. **No frameworks, no build step, no CDN, no
external requests of any kind.** The chart is hand-written SVG. Everything the
page needs is in this folder, which is why it will still work in ten years.

---

## What to upload

Replace the contents of `/visualizations/Mortality/` on the web server with
these four items, keeping the folder structure:

```
Mortality.html
assets/style.css
assets/chart.js
data/mortality-data.js
```

That's about 150 KB in total. Keep the filename `Mortality.html` — the
WordPress page at
`/united-states-mortality-by-cause-of-death-race-and-gender/` points an iframe
at it, so nothing in WordPress needs to change.

**Do not upload** `tools/`, `reference/`, `.claude/`, `data/mortality.csv` or
this README. They are development files. (Uploading them is harmless, just
untidy — except that `data/mortality.csv` is the raw input, not what the page
reads.)

To preview locally, just double-click `Mortality.html`. The data is a `.js`
file rather than a CSV precisely so that works without a web server.

---

## Updating the data

1. Replace `data/mortality.csv`. Required columns, with a header row:

   | column | values |
   |---|---|
   | `year`  | integer |
   | `cause` | machine label, e.g. `Circulatory_system` |
   | `sex`   | `All_Genders`, `Female`, `Male` |
   | `race`  | `All_Races`, `White`, `Black`, `Other` |
   | `rate`  | deaths per 100,000 people |

2. Rebuild and check:

   ```bash
   python3 tools/build-data.py
   python3 tools/check-data.py
   ```

3. If the new data has causes that weren't there before, add display names for
   them in `CAUSE_LABELS` near the top of `assets/chart.js`. Without an entry
   the page falls back to the machine label with underscores replaced by
   spaces, which is readable but not polished.

New years, new genders and new race categories need **no** code change — the
page reads them from the data.

---

## Open questions for your supervisor

Two things could not be determined from the old page and are flagged in the
"About these numbers" section on the page itself:

1. **What are the units, and are the rates age-adjusted?** The old
   visualization had no axis label. The page currently says "deaths per 100,000
   people", which is the usual convention for this source but is unverified.
   If this is wrong, fix the `y-label` text in `Mortality.html` and the
   `caption` text in `renderTable()` in `assets/chart.js`.

2. **Will the new data extend past 2009 or add categories?** If the shape is
   the same and only the years change, updating is just step 1 above.

---

## Known problems in the legacy data

`tools/check-data.py` currently reports two failures on the data recovered from
the old page. These are faults in the source extract, not in the code:

- **Impossible aggregates.** In 1999, 2004 and 2009, many "All races" and
  "All genders" values fall outside the range of the components they summarise
  (87 of 486 and 142 of 648 cells respectively). For example,
  `Circulatory_system / Female / All_Races / 1999` is 1.134 while its White,
  Black and Other components are 42.3, 40.5 and 36.6. The aggregate is off by
  a factor of roughly 37. The individual race and gender series look fine.
- **A discontinuity at 1999.** 50 of 52 implausible year-on-year jumps fall in
  1994→1999, which is when the US switched from ICD-9 to ICD-10 cause-of-death
  coding. This is expected reclassification rather than a data error, and the
  chart marks the boundary, but it means comparisons spanning 1999 need care.

Re-run `tools/check-data.py` once the corrected data arrives — the goal is for
it to exit 0.

---

## What changed from the old version

| | Old | New |
|---|---|---|
| Libraries | jQuery 1.6.2, jQuery UI 1.8, D3 v2/3, Rickshaw | none |
| File requests | ~30, several from third-party CDNs over `http://` | 3, all local |
| Broken assets | logo and lab link pointed at the dead `dasil.grinnell.edu` | fixed |
| Responsive | no — fixed 900×500 chart in a 1200×810 iframe | yes, down to phone width |
| Headers | two stacked (WordPress + one inside the iframe) | one; the page's own header hides itself when embedded |
| Picking series | 50 radio buttons and a 216-entry legend | three dropdowns, removable chips, preset comparisons |
| Default view | stacked area with cardinal smoothing — misleading for rates | lines, one cause across race groups |
| Axis units | unlabelled | labelled, with the uncertainty stated |
| Accessibility | labels not linked to inputs, color-only, no keyboard support | keyboard crosshair, live region, data table, legend |
| Data | hardcoded into the HTML | separate generated file, rebuilt from CSV |

### Things that were deliberately removed

The old page had area/bar/line/scatter renderers, stack/stream/pct/value
offsets, cardinal/linear/step interpolation, and a smoothing slider. These were
demo controls from the Rickshaw charting library rather than deliberate design,
and most of them misrepresent this data: stacking mortality *rates* across
overlapping categories (`All_Races` + `White` + `Black`) double-counts, and
cardinal smoothing invents curvature between five-year observations that the
data does not support.

They are replaced by one control that genuinely matters here — a linear/log
toggle for the vertical axis, since rates span roughly 0.1 to 400 per 100,000
and a linear axis flattens everything below the largest series.

---

## Notes for whoever maintains this next

- **Series colors are a validated colorblind-safe palette and the ORDER is the
  safety mechanism.** Don't reorder or substitute `--series-1` … `--series-8` in
  `assets/style.css` without re-checking the contrast and colorblind separation.
  The eight-series cap exists for the same reason: a ninth generated hue is not
  reliably distinguishable from an existing one.
- Colors follow the series, not its position, so removing one never repaints the
  others.
- Grinnell crimson is used only for page chrome (rules, links, buttons) and
  never as a series color, so it can't be mistaken for data.
- Direct end-labels are dropped automatically past four series and on narrow
  screens, where they collide and stop being readable; the legend takes over.
- Series names reach the DOM via `textContent`, never `innerHTML`, since they
  originate in a data file.
