/* ==========================================================================
   DASIL — US Mortality by Cause of Death, Race, and Gender
   Plain JavaScript + hand-written SVG. No libraries, no build step, no CDN.

   Reads window.MORTALITY_DATA (see data/mortality-data.js).
   ========================================================================== */

(function () {
  "use strict";

  var DATA = window.MORTALITY_DATA;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var MAX_SERIES = 8; // palette ceiling — past 8 hues stop being distinguishable

  /* --- Display names -------------------------------------------------------
     The source data uses underscored machine labels. Nothing user-facing
     should ever show "Endocr_Nutr_Metab_Immunity". */

  var CAUSE_LABELS = {
    Blood_Diseases: "Blood diseases",
    Cancer: "Cancer",
    Circulatory_system: "Circulatory system",
    Congenital_anomalies: "Congenital anomalies",
    Digestive_System: "Digestive system",
    Endocr_Nutr_Metab_Immunity: "Endocrine, nutritional & metabolic",
    Genitourinary_system: "Genitourinary system",
    "Ill-defined_conditions": "Ill-defined conditions",
    Infection: "Infectious disease",
    Injury_and_poisoning: "Injury & poisoning",
    Mental_health: "Mental health",
    Muscles_and_Skeleton: "Musculoskeletal",
    Nervous_System: "Nervous system",
    Perinatal_conditions: "Perinatal conditions",
    Pregnancy_and_Childbirth: "Pregnancy & childbirth",
    Respiratory_System: "Respiratory system",
    Sense_Organs: "Sense organs",
    Skin_disease: "Skin disease"
  };
  var SEX_LABELS  = { All_Genders: "All genders", Female: "Female", Male: "Male" };
  var RACE_LABELS = { All_Races: "All races", White: "White", Black: "Black", Other: "Other" };

  function causeLabel(v) { return CAUSE_LABELS[v] || v.replace(/_/g, " "); }
  function sexLabel(v)   { return SEX_LABELS[v]  || v.replace(/_/g, " "); }
  function raceLabel(v)  { return RACE_LABELS[v] || v.replace(/_/g, " "); }

  /* --- State ---------------------------------------------------------------
     `slot` is the palette index and belongs to the ENTITY, not to its row
     position. Removing a series never repaints the survivors. */

  var state = {
    series: [],          // [{ cause, sex, race, slot }]
    scale: "linear",
    hoverIndex: null,
    showTable: false
  };

  var el = {};           // cached DOM nodes
  var layout = null;     // last computed render geometry (for hit-testing)

  /* --- Small helpers -------------------------------------------------------- */

  function svgEl(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function seriesKey(s) { return s.cause + "|" + s.sex + "|" + s.race; }

  function seriesValues(s) { return DATA.series[seriesKey(s)] || []; }

  function seriesColor(s) {
    return getComputedStyle(el.root).getPropertyValue("--series-" + (s.slot + 1)).trim();
  }

  function fullName(s) {
    return causeLabel(s.cause) + " · " + sexLabel(s.sex) + " · " + raceLabel(s.race);
  }

  // Shorten end-labels to just the dimensions that actually differ between the
  // selected series. With one cause on screen, "Female · Black" says it all.
  function shortName(s) {
    var list = state.series;
    if (list.length < 2) return fullName(s);
    var parts = [];
    if (list.some(function (o) { return o.cause !== list[0].cause; })) parts.push(causeLabel(s.cause));
    if (list.some(function (o) { return o.sex  !== list[0].sex;  })) parts.push(sexLabel(s.sex));
    if (list.some(function (o) { return o.race !== list[0].race; })) parts.push(raceLabel(s.race));
    return parts.length ? parts.join(" · ") : fullName(s);
  }

  function formatRate(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v >= 100) return v.toFixed(0);
    if (v >= 10)  return v.toFixed(1);
    if (v >= 1)   return v.toFixed(2);
    return v.toFixed(3);
  }

  function lowestFreeSlot() {
    var used = {};
    state.series.forEach(function (s) { used[s.slot] = true; });
    for (var i = 0; i < MAX_SERIES; i++) if (!used[i]) return i;
    return null;
  }

  /* --- Scales ---------------------------------------------------------------
     Written out rather than pulled from a library: a linear and a log scale
     over nine points is a dozen lines, and it keeps the page dependency-free. */

  // A "nice" tick step (1, 2, 5 × a power of ten) covering `span` in ~`count` steps.
  function niceStep(span, count) {
    if (!(span > 0)) return 1;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = (span / count) / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    return step;
  }

  function ticksBetween(min, max, step) {
    var out = [], v = Math.ceil(min / step - 1e-9) * step;
    // Guard against floating-point drift producing a runaway loop.
    for (var guard = 0; v <= max + step * 1e-6 && guard < 500; guard++, v += step) {
      out.push(Math.abs(v) < step * 1e-6 ? 0 : Math.round(v / step) * step);
    }
    return out;
  }

  // Ticks for a log axis. Tries 1-2-5 per decade first, then a finer set when a
  // narrow domain (say 14–26) contains too few of them. Never falls back to the
  // raw domain bounds — that printed ticks like "10.66" and "38.84".
  function logTicks(min, max) {
    var sets = [[1, 2, 5], [1, 1.5, 2, 3, 5, 7], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8]];
    var lo = Math.floor(Math.log(min) / Math.LN10);
    var hi = Math.ceil(Math.log(max) / Math.LN10);
    for (var s = 0; s < sets.length; s++) {
      var out = [];
      for (var e = lo; e <= hi; e++) {
        for (var i = 0; i < sets[s].length; i++) {
          var v = sets[s][i] * Math.pow(10, e);
          if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
        }
      }
      if (out.length >= 3) return out;
    }
    // Last resort: round steps across the domain, so labels stay readable.
    return ticksBetween(min, max, niceStep(max - min, 4));
  }

  function tickText(v) {
    if (v === 0) return "0";
    if (v >= 1000) return (v / 1000) + "K";
    if (v >= 1) return String(Math.round(v * 100) / 100);
    return String(Math.round(v * 1000) / 1000);
  }

  /* --- Render --------------------------------------------------------------- */

  function render() {
    renderLegend();
    renderChart();
    renderTable();
    syncControls();
  }

  function renderChart() {
    var wrap = el.chartWrap;
    var svg = el.svg;
    clear(svg);
    hideTooltip();

    if (!state.series.length) {
      svg.setAttribute("height", 0);
      svg.style.display = "none";
      el.empty.hidden = false;
      layout = null;
      return;
    }
    svg.style.display = "";
    el.empty.hidden = true;

    var width = Math.max(wrap.clientWidth || 640, 280);
    var narrow = width < 620;
    var height = narrow ? 380 : Math.round(Math.min(520, Math.max(380, width * 0.5)));

    // Right margin holds the direct end-labels. They are dropped when they stop
    // working: on narrow screens (no room), and past four series, where lines
    // converge and the labels pile into a stack that reads as noise and can no
    // longer be traced back to its line. The legend below carries identity in
    // those cases, and the table view carries the values.
    var showEndLabels = !narrow && state.series.length <= 4;
    var labelRoom = 0;
    if (showEndLabels) {
      var longest = 0;
      state.series.forEach(function (s) { longest = Math.max(longest, shortName(s).length); });
      labelRoom = Math.min(190, 24 + longest * 6.4);
    }

    var m = { top: 18, right: (showEndLabels ? labelRoom : 14), bottom: 34, left: 54 };
    var innerW = Math.max(60, width - m.left - m.right);
    var innerH = Math.max(80, height - m.top - m.bottom);

    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    var years = DATA.years;
    var x0 = years[0], x1 = years[years.length - 1];
    var xOf = function (yr) { return m.left + (yr - x0) / (x1 - x0) * innerW; };

    // --- y domain over the visible series only
    var vals = [];
    state.series.forEach(function (s) {
      seriesValues(s).forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); });
    });
    var isLog = state.scale === "log";
    var pos = vals.filter(function (v) { return v > 0; });
    var maxV = vals.length ? Math.max.apply(null, vals) : 1;
    var yMin, yMax, yOf, ticks;

    if (isLog) {
      // Pad by a fixed ratio rather than snapping out to whole decades: data
      // running 2–11 inside a 1–100 axis sits in the bottom half and wastes
      // the plot. Ticks are still placed on 1-2-5 positions.
      var minP = pos.length ? Math.min.apply(null, pos) : 0.001;
      var topV = maxV > minP ? maxV : minP * 1.05;   // only guard a degenerate domain
      yMin = minP / 1.35;
      yMax = topV * 1.35;
      var lMin = Math.log(yMin), lMax = Math.log(yMax);
      yOf = function (v) {
        if (v == null || v <= 0) return null;
        return m.top + innerH - (Math.log(v) - lMin) / (lMax - lMin) * innerH;
      };
      ticks = logTicks(yMin, yMax);
    } else {
      // Zero-based when the data actually reaches down toward zero; otherwise a
      // padded window around the data. Forcing zero on rates that sit between,
      // say, 14 and 25 spends half the plot on empty space and flattens exactly
      // the differences the chart exists to show. Whenever the baseline is not
      // zero the chart says so in the axis note — a truncated axis is only
      // honest if it is declared.
      var minV = vals.length ? Math.min.apply(null, vals) : 0;
      var span = maxV - minV;
      var pad = span > 0 ? span * 0.12 : (maxV * 0.1 || 1);
      var lo = (minV <= maxV * 0.3) ? 0 : Math.max(0, minV - pad);
      var hi = maxV + pad;
      // Snap the bounds outward to the tick step so the axis reads 12 and 26,
      // never 13.06 and 25.9.
      var step = niceStep(hi - lo, 5);
      yMin = Math.max(0, Math.floor(lo / step + 1e-9) * step);
      yMax = Math.ceil(hi / step - 1e-9) * step;
      if (yMax <= yMin) yMax = yMin + step;
      ticks = ticksBetween(yMin, yMax, step);
      yOf = function (v) {
        if (v == null || !isFinite(v)) return null;
        return m.top + innerH - (v - yMin) / (yMax - yMin) * innerH;
      };
    }

    setAxisNote(isLog, yMin);

    // --- gridlines + y ticks (solid hairlines, one step off surface)
    var gGrid = svgEl("g");
    ticks.forEach(function (t) {
      var y = yOf(t);
      if (y == null) return;
      gGrid.appendChild(svgEl("line", {
        class: "grid-line", x1: m.left, x2: m.left + innerW, y1: y, y2: y
      }));
      var tx = svgEl("text", { class: "tick-text", x: m.left - 8, y: y, "text-anchor": "end", "dominant-baseline": "middle" });
      tx.textContent = tickText(t);
      gGrid.appendChild(tx);
    });
    svg.appendChild(gGrid);

    // --- x axis
    var gAxis = svgEl("g");
    gAxis.appendChild(svgEl("line", {
      class: "axis-line", x1: m.left, x2: m.left + innerW,
      y1: m.top + innerH, y2: m.top + innerH
    }));
    years.forEach(function (yr, i) {
      // On narrow screens label every other year so ticks never collide.
      if (narrow && i % 2 === 1 && i !== years.length - 1) return;
      var tx = svgEl("text", {
        class: "tick-text", x: xOf(yr), y: m.top + innerH + 16, "text-anchor": "middle"
      });
      tx.textContent = yr;
      gAxis.appendChild(tx);
    });
    svg.appendChild(gAxis);

    // --- ICD-10 boundary marker (1999). The coding system changed that year,
    //     so values are not strictly comparable across the line.
    var icdX = xOf(1999);
    var gIcd = svgEl("g");
    gIcd.appendChild(svgEl("line", {
      class: "icd-marker", x1: icdX, x2: icdX, y1: m.top, y2: m.top + innerH
    }));
    var icdT = svgEl("text", { class: "icd-text", x: icdX + 5, y: m.top + 10 });
    icdT.textContent = narrow ? "ICD-10" : "ICD-10 begins";
    gIcd.appendChild(icdT);
    svg.appendChild(gIcd);

    // --- series lines
    var gLines = svgEl("g");
    var plotted = [];
    state.series.forEach(function (s) {
      var color = seriesColor(s);
      var values = seriesValues(s);
      var pts = [];
      var segments = [];   // break the path wherever a value can't be plotted
      var run = [];
      years.forEach(function (yr, i) {
        var v = values[i];
        var py = yOf(v);
        if (py == null) {
          if (run.length) { segments.push(run); run = []; }
          pts.push(null);
        } else {
          var p = { x: xOf(yr), y: py, v: v, year: yr };
          run.push(p); pts.push(p);
        }
      });
      if (run.length) segments.push(run);

      segments.forEach(function (seg) {
        if (seg.length === 1) return; // a lone point is drawn as its marker only
        var d = seg.map(function (p, i) {
          return (i ? "L" : "M") + p.x.toFixed(2) + " " + p.y.toFixed(2);
        }).join(" ");
        gLines.appendChild(svgEl("path", { class: "series-line", d: d, stroke: color }));
      });

      // markers: >=8px diameter, 2px surface ring
      seg_dots(gLines, pts, color);
      plotted.push({ s: s, pts: pts, color: color });
    });
    svg.appendChild(gLines);

    function seg_dots(g, pts, color) {
      pts.forEach(function (p) {
        if (!p) return;
        g.appendChild(svgEl("circle", { class: "series-dot", cx: p.x, cy: p.y, r: 4, fill: color }));
      });
    }

    // --- direct end-labels with leader lines
    if (showEndLabels) {
      var wanted = [];
      plotted.forEach(function (p) {
        var last = null;
        for (var i = p.pts.length - 1; i >= 0; i--) { if (p.pts[i]) { last = p.pts[i]; break; } }
        if (last) wanted.push({ y: last.y, want: last.y, anchor: last, color: p.color, text: shortName(p.s) });
      });
      // Resolve collisions by nudging, then connect each label to its line with a
      // leader so a moved label never detaches from the series it names.
      wanted.sort(function (a, b) { return a.want - b.want; });
      var gap = 15;
      for (var i = 1; i < wanted.length; i++) {
        if (wanted[i].y - wanted[i - 1].y < gap) wanted[i].y = wanted[i - 1].y + gap;
      }
      var overflow = wanted.length ? wanted[wanted.length - 1].y - (m.top + innerH) : 0;
      if (overflow > 0) wanted.forEach(function (w) { w.y -= overflow; });
      for (var j = wanted.length - 2; j >= 0; j--) {
        if (wanted[j + 1].y - wanted[j].y < gap) wanted[j].y = wanted[j + 1].y - gap;
      }

      var gLab = svgEl("g");
      var labelX = m.left + innerW + 12;
      wanted.forEach(function (w) {
        if (Math.abs(w.y - w.anchor.y) > 1.5) {
          gLab.appendChild(svgEl("path", {
            class: "leader",
            d: "M" + (w.anchor.x + 6) + " " + w.anchor.y.toFixed(2) +
               "L" + (labelX - 5) + " " + w.y.toFixed(2)
          }));
        }
        var t = svgEl("text", { class: "end-label", x: labelX, y: w.y.toFixed(2) });
        t.textContent = w.text;          // textContent: labels are data, never innerHTML
        gLab.appendChild(t);
      });
      svg.appendChild(gLab);
    }

    // --- hover layer (added last so it sits above the marks)
    var gHover = svgEl("g");
    gHover.setAttribute("pointer-events", "none");
    svg.appendChild(gHover);

    var capture = svgEl("rect", {
      x: m.left, y: m.top, width: innerW, height: innerH,
      fill: "transparent", "pointer-events": "all"
    });
    svg.appendChild(capture);

    layout = {
      m: m, innerW: innerW, innerH: innerH, xOf: xOf, yOf: yOf,
      plotted: plotted, gHover: gHover, width: width
    };

    svg.setAttribute("aria-label", chartSummary());
    if (state.hoverIndex != null) drawHover(state.hoverIndex);
  }

  function setAxisNote(isLog, yMin) {
    if (!el.axisNote) return;
    if (isLog) el.axisNote.textContent = "— logarithmic scale";
    else if (yMin > 0) el.axisNote.textContent = "— axis starts at " + tickText(yMin) + ", not zero";
    else el.axisNote.textContent = "— see “About these numbers” below";
  }

  function chartSummary() {
    var names = state.series.map(fullName).join("; ");
    return "Line chart of mortality rates from " + DATA.years[0] + " to " +
      DATA.years[DATA.years.length - 1] + ", showing " + state.series.length +
      " series: " + names + ". The full values are available in the data table below.";
  }

  /* --- Hover & crosshair ----------------------------------------------------
     The crosshair finds the X; readers aim at a year, never at a 2px line.
     One tooltip lists every series at that year. */

  function nearestIndex(clientX) {
    if (!layout) return null;
    var rect = el.svg.getBoundingClientRect();
    var scale = rect.width / layout.width;
    var px = (clientX - rect.left) / scale;
    var best = null, bestD = Infinity;
    DATA.years.forEach(function (yr, i) {
      var d = Math.abs(layout.xOf(yr) - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function drawHover(idx) {
    if (!layout) return;
    clear(layout.gHover);
    var year = DATA.years[idx];
    var x = layout.xOf(year);

    layout.gHover.appendChild(svgEl("line", {
      class: "crosshair", x1: x, x2: x,
      y1: layout.m.top, y2: layout.m.top + layout.innerH
    }));

    var rows = [];
    layout.plotted.forEach(function (p) {
      var pt = p.pts[idx];
      if (!pt) { rows.push({ name: fullName(p.s), color: p.color, v: null }); return; }
      layout.gHover.appendChild(svgEl("circle", {
        class: "hover-dot", cx: pt.x, cy: pt.y, r: 5.5, fill: p.color
      }));
      rows.push({ name: fullName(p.s), color: p.color, v: pt.v });
    });
    rows.sort(function (a, b) { return (b.v == null ? -1 : b.v) - (a.v == null ? -1 : a.v); });

    showTooltip(year, rows, x);
    announce(year, rows);
  }

  function showTooltip(year, rows, x) {
    var tip = el.tooltip;
    clear(tip);

    var h = document.createElement("div");
    h.className = "tt-year";
    h.textContent = year;
    tip.appendChild(h);

    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "tt-row";

      var key = document.createElement("span");
      key.className = "tt-key";
      key.style.background = r.color;

      var val = document.createElement("span");
      val.className = "tt-val";
      val.textContent = formatRate(r.v);          // values lead

      var nm = document.createElement("span");
      nm.className = "tt-name";
      nm.textContent = r.name;                    // labels follow; textContent always

      row.appendChild(key); row.appendChild(val); row.appendChild(nm);
      tip.appendChild(row);
    });

    tip.setAttribute("data-show", "1");

    // Position inside the wrapper, flipping before it can overflow.
    var wrapW = el.chartWrap.clientWidth;
    var rect = el.svg.getBoundingClientRect();
    var scale = rect.width / (layout ? layout.width : rect.width);
    var px = x * scale;
    var tw = tip.offsetWidth;
    var left = px + 16;
    if (left + tw > wrapW - 4) left = px - tw - 16;
    if (left < 4) left = 4;
    tip.style.left = left + "px";
    tip.style.top = "12px";
  }

  function hideTooltip() {
    el.tooltip.setAttribute("data-show", "0");
    if (layout) clear(layout.gHover);
  }

  function announce(year, rows) {
    var txt = year + ". " + rows.map(function (r) {
      return r.name + " " + formatRate(r.v);
    }).join(". ");
    el.live.textContent = txt;
  }

  /* --- Legend ---------------------------------------------------------------- */

  function renderLegend() {
    clear(el.legend);
    if (!state.series.length) { el.legend.hidden = true; return; }
    el.legend.hidden = false;

    state.series.forEach(function (s) {
      var chip = document.createElement("span");
      chip.className = "chip";

      var key = document.createElement("span");
      key.className = "key";
      key.style.background = seriesColor(s);

      var label = document.createElement("span");
      label.textContent = fullName(s);

      var x = document.createElement("button");
      x.className = "chip-x";
      x.type = "button";
      x.innerHTML = "&times;";
      x.setAttribute("aria-label", "Remove " + fullName(s));
      x.addEventListener("click", function () { removeSeries(seriesKey(s)); });

      chip.appendChild(key); chip.appendChild(label); chip.appendChild(x);
      el.legend.appendChild(chip);
    });
  }

  /* --- Table view ------------------------------------------------------------
     The accessible twin of the chart, and the relief the palette's light-mode
     contrast warning requires. Every plotted value is readable here. */

  function renderTable() {
    el.tableSection.hidden = !state.showTable;
    if (!state.showTable) return;
    clear(el.tableHost);
    if (!state.series.length) return;

    var table = document.createElement("table");
    var cap = document.createElement("caption");
    cap.textContent = "Mortality rate per 100,000 people, by year. Values for 1999 and later use ICD-10 coding.";
    table.appendChild(cap);

    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    var th0 = document.createElement("th");
    th0.scope = "col";
    th0.textContent = "Year";
    hr.appendChild(th0);
    state.series.forEach(function (s) {
      var th = document.createElement("th");
      th.scope = "col";
      var key = document.createElement("span");
      key.className = "key";
      key.style.background = seriesColor(s);
      th.appendChild(key);
      th.appendChild(document.createTextNode(fullName(s)));
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    DATA.years.forEach(function (yr, i) {
      var tr = document.createElement("tr");
      var td0 = document.createElement("th");
      td0.scope = "row";
      td0.textContent = yr;
      tr.appendChild(td0);
      state.series.forEach(function (s) {
        var td = document.createElement("td");
        td.textContent = formatRate(seriesValues(s)[i]);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    el.tableHost.appendChild(table);
  }

  /* --- Series management ------------------------------------------------------ */

  function addSeries(cause, sex, race) {
    var key = cause + "|" + sex + "|" + race;
    if (!DATA.series[key]) return false;
    if (state.series.some(function (s) { return seriesKey(s) === key; })) return false;
    var slot = lowestFreeSlot();
    if (slot == null) return false;
    state.series.push({ cause: cause, sex: sex, race: race, slot: slot });
    return true;
  }

  function removeSeries(key) {
    state.series = state.series.filter(function (s) { return seriesKey(s) !== key; });
    state.hoverIndex = null;
    render();
  }

  function syncControls() {
    var full = state.series.length >= MAX_SERIES;
    var key = el.cause.value + "|" + el.sex.value + "|" + el.race.value;
    var dupe = state.series.some(function (s) { return seriesKey(s) === key; });

    el.add.disabled = full || dupe;
    el.add.textContent = full ? "Limit reached" : (dupe ? "Already shown" : "Add series");

    el.clear.disabled = !state.series.length;
    el.download.disabled = !state.series.length;

    el.note.textContent = state.series.length
      ? state.series.length + " of " + MAX_SERIES + " series shown."
      : "Pick a cause, gender and race, then add it to the chart.";
  }

  /* --- CSV export -------------------------------------------------------------- */

  function downloadCSV() {
    if (!state.series.length) return;
    var rows = [["year", "cause", "sex", "race", "rate_per_100k"]];
    state.series.forEach(function (s) {
      var v = seriesValues(s);
      DATA.years.forEach(function (yr, i) {
        rows.push([yr, causeLabel(s.cause), sexLabel(s.sex), raceLabel(s.race), v[i]]);
      });
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        c = String(c == null ? "" : c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(",");
    }).join("\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "dasil-mortality-selection.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* --- Theme --------------------------------------------------------------------
     Inside an iframe we stay light: the host WordPress page is light-only, and a
     dark panel in a white page reads as broken rather than as a theme. Opened on
     its own, the page follows the reader's OS setting. The toggle always wins. */

  function initTheme() {
    var embedded = false;
    try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
    if (embedded) document.body.classList.add("is-embedded");

    var saved = null;
    try { saved = localStorage.getItem("dasil-mortality-theme"); } catch (e) { /* private mode */ }

    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    } else if (embedded) {
      document.documentElement.setAttribute("data-theme", "light");
    }

    el.theme.addEventListener("click", function () {
      var isDark = document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.hasAttribute("data-theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("dasil-mortality-theme", next); } catch (e) { /* ignore */ }
      el.theme.setAttribute("aria-pressed", String(next === "dark"));
      render();   // series colors are theme-dependent; re-read them
    });
  }

  /* --- Wiring --------------------------------------------------------------------- */

  function fillSelect(sel, values, labeller) {
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = labeller(v);
      sel.appendChild(o);
    });
  }

  function init() {
    el.root = document.getElementById("root");
    el.svg = document.getElementById("chart");
    el.chartWrap = document.getElementById("chartWrap");
    el.tooltip = document.getElementById("tooltip");
    el.empty = document.getElementById("emptyState");
    el.legend = document.getElementById("legend");
    el.live = document.getElementById("live");
    el.cause = document.getElementById("causeSel");
    el.sex = document.getElementById("sexSel");
    el.race = document.getElementById("raceSel");
    el.add = document.getElementById("addBtn");
    el.clear = document.getElementById("clearBtn");
    el.download = document.getElementById("downloadBtn");
    el.theme = document.getElementById("themeBtn");
    el.note = document.getElementById("controlNote");
    el.tableSection = document.getElementById("tableView");
    el.tableHost = document.getElementById("tableHost");
    el.tableBtn = document.getElementById("tableBtn");
    el.axisNote = document.getElementById("axisNote");

    fillSelect(el.cause, DATA.causes, causeLabel);
    fillSelect(el.sex, DATA.sexes, sexLabel);
    fillSelect(el.race, DATA.races, raceLabel);

    initTheme();

    // Opening view: one cause across the three race groups — three series, which
    // is inside the all-pairs safe cap and shows what the tool is for.
    el.cause.value = "Cancer";
    el.sex.value = "All_Genders";
    el.race.value = "All_Races";
    ["White", "Black", "Other"].forEach(function (r) { addSeries("Cancer", "All_Genders", r); });

    el.add.addEventListener("click", function () {
      if (addSeries(el.cause.value, el.sex.value, el.race.value)) render();
      else syncControls();
    });
    [el.cause, el.sex, el.race].forEach(function (s) {
      s.addEventListener("change", syncControls);
    });

    el.clear.addEventListener("click", function () {
      state.series = [];
      state.hoverIndex = null;
      render();
    });

    document.getElementById("byRaceBtn").addEventListener("click", function () {
      state.series = [];
      ["White", "Black", "Other"].forEach(function (r) { addSeries(el.cause.value, el.sex.value, r); });
      state.hoverIndex = null;
      render();
    });
    document.getElementById("bySexBtn").addEventListener("click", function () {
      state.series = [];
      ["Female", "Male"].forEach(function (g) { addSeries(el.cause.value, g, el.race.value); });
      state.hoverIndex = null;
      render();
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="scale"]'), function (r) {
      r.addEventListener("change", function () {
        if (r.checked) { state.scale = r.value; renderChart(); }
      });
    });

    el.tableBtn.addEventListener("click", function () {
      state.showTable = !state.showTable;
      el.tableBtn.setAttribute("aria-expanded", String(state.showTable));
      el.tableBtn.textContent = state.showTable ? "Hide data table" : "Show data table";
      renderTable();
    });

    el.download.addEventListener("click", downloadCSV);

    // --- pointer + keyboard hover
    el.svg.addEventListener("pointermove", function (e) {
      var idx = nearestIndex(e.clientX);
      if (idx != null && idx !== state.hoverIndex) { state.hoverIndex = idx; drawHover(idx); }
      else if (idx != null) drawHover(idx);
    });
    el.svg.addEventListener("pointerleave", function () {
      state.hoverIndex = null;
      hideTooltip();
    });
    el.svg.addEventListener("keydown", function (e) {
      if (!state.series.length) return;
      var i = state.hoverIndex;
      if (e.key === "ArrowRight") { i = i == null ? 0 : Math.min(DATA.years.length - 1, i + 1); }
      else if (e.key === "ArrowLeft") { i = i == null ? DATA.years.length - 1 : Math.max(0, i - 1); }
      else if (e.key === "Home") { i = 0; }
      else if (e.key === "End") { i = DATA.years.length - 1; }
      else if (e.key === "Escape") { state.hoverIndex = null; hideTooltip(); return; }
      else return;
      e.preventDefault();
      state.hoverIndex = i;
      drawHover(i);
    });
    el.svg.addEventListener("blur", function () { state.hoverIndex = null; hideTooltip(); });

    // --- responsive re-render
    var pending = null;
    function onResize() {
      if (pending) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(function () { pending = null; renderChart(); });
    }
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(el.chartWrap);
    else window.addEventListener("resize", onResize);

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
