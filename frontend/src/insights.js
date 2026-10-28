// Pure functions that turn the API's hourly points into findings, chart rows and plain-English text.
// Nothing here is hardcoded: every statement is computed from the selected day's data.
// error = forecast − actual (MW). Positive = forecast above actual.

import { fmt, hhmm, plural } from "./lib.js";

/** Hour of day as a number: "2026-01-15T10:30:00Z" -> 10.5 */
export const hourNum = (iso) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
export const hourLabel = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;

/** Group consecutive hours (already filtered to "significant") into runs, e.g. 11:00–16:00. */
function runs(points) {
  const out = [];
  for (const p of points) {
    const h = hourNum(p.startTime);
    const last = out[out.length - 1];
    if (last && h === last.to) {
      last.to = h + 1; last.n += 1;
      if (Math.abs(p.error) > Math.abs(last.peak.error)) last.peak = p;
    } else out.push({ from: h, to: h + 1, n: 1, peak: p });
  }
  return out;
}

/** Everything the hero and the insight section say about one delivery day. */
export function dayInsights(points, threshold) {
  if (!points.length) return null;
  const n = points.length;
  const avg = points.reduce((a, p) => a + p.error, 0) / n;
  const mae = points.reduce((a, p) => a + Math.abs(p.error), 0) / n;
  const worst = points.reduce((a, p) => (Math.abs(p.error) > Math.abs(a.error) ? p : a));
  const above = points.filter((p) => p.error > 0).length;
  const below = points.filter((p) => p.error < 0).length;
  const significant = points.filter((p) => Math.abs(p.error) > threshold);
  const pubs = [...new Set(points.map((p) => p.publishTime))].sort();
  return { n, avg, mae, worst, above, below, significant, runs: runs(significant), pubs };
}

const dir = (e) => (e >= 0 ? "above" : "below");

/** The "What matters for this delivery" findings, in plain English. */
export function findings(ins, threshold, monthMae) {
  const out = [];
  out.push({
    key: "avg",
    head: `${fmt(Math.abs(ins.avg))} MW ${dir(ins.avg)} on average`,
    body: `Across the day the forecast was ${fmt(Math.abs(ins.avg))} MW ${dir(ins.avg)} actual wind generation (forecast − actual, averaged over ${plural(ins.n, "hour")}). It was above actual in ${plural(ins.above, "hour")} and below in ${ins.below}.`,
  });
  out.push({
    key: "worst",
    head: `Largest miss: ${fmt(Math.abs(ins.worst.error))} MW at ${hhmm(ins.worst.startTime)} UTC`,
    body: `In the hour starting ${hhmm(ins.worst.startTime)} UTC the forecast said ${fmt(ins.worst.forecast)} MW but wind generated ${fmt(ins.worst.actual)} MW: ${fmt(Math.abs(ins.worst.error))} MW ${dir(ins.worst.error)} actual.`,
  });
  if (ins.significant.length === 0) {
    out.push({ key: "sig", head: `No hour missed by more than ±${fmt(threshold)} MW`, body: `Every hour of this day was within ±${fmt(threshold)} MW of actual generation.` });
  } else {
    const r = ins.runs.map((x) => `${hourLabel(x.from)}–${x.to === 24 ? "24:00" : hourLabel(x.to)}`);
    out.push({
      key: "sig",
      head: `${ins.significant.length} of ${plural(ins.n, "hour")} missed by more than ±${fmt(threshold)} MW`,
      body: `${plural(ins.significant.length, "hour")} had an error larger than ±${fmt(threshold)} MW, in ${plural(ins.runs.length, "stretch").replace("stretchs", "stretches")}: ${r.join(", ")} UTC.`,
    });
  }
  if (monthMae != null) {
    out.push({
      key: "ctx",
      head: `Day MAE ${fmt(ins.mae)} MW vs January ${fmt(monthMae)} MW`,
      body: `This day's average absolute miss was ${fmt(ins.mae)} MW, compared with ${fmt(monthMae)} MW across all of January at the same decision time.`,
    });
  }
  return out;
}

/**
 * What the forecast itself says for one delivery day (no actuals involved).
 * `hours` are the selected forecast hours: { startTime, publishTime, generation } in MW.
 * Each hourly value is an average power over one hour, so MW x 1 h = MWh; the day total is their sum in GWh.
 */
export function forecastSummary(hours) {
  if (!hours.length) return null;
  const peak = hours.reduce((a, h) => (h.generation > a.generation ? h : a));
  const low = hours.reduce((a, h) => (h.generation < a.generation ? h : a));
  const sum = hours.reduce((a, h) => a + h.generation, 0);
  const pubs = [...new Set(hours.map((h) => h.publishTime))].sort();
  return { n: hours.length, avg: sum / hours.length, peak, low, totalGWh: sum / 1000, pubs };
}

/**
 * Rows for the main chart on a numeric hour axis (x = hour of day).
 * Hourly mode also inserts a synthetic row where forecast and actual cross, so the shaded
 * "forecast above actual" / "actual above forecast" areas switch exactly at the crossing.
 */
export function chartRows(mode, points, half) {
  if (mode === "30min") {
    return half.map((r) => ({
      x: hourNum(r.startTime), forecast: r.forecast_for_hour, actual: r.actual_30min,
      sp: r.settlementPeriod, published: r.publishTime,
    }));
  }
  const rows = [];
  points.forEach((p, i) => {
    const a = p.actual, f = p.forecast;
    rows.push({
      x: hourNum(p.startTime), forecast: f, actual: a, error: p.error, published: p.publishTime, lead: p.horizon_h,
      over: [a, Math.max(a, f)],   // forecast above actual (blue tint)
      under: [Math.min(a, f), a],  // actual above forecast (emerald tint)
    });
    const q = points[i + 1];
    if (q && p.error * q.error < 0) {
      const t = p.error / (p.error - q.error);
      const v = p.forecast + t * (q.forecast - p.forecast);
      rows.push({ x: hourNum(p.startTime) + t * (hourNum(q.startTime) - hourNum(p.startTime)), forecast: v, actual: v, synthetic: true, over: [v, v], under: [v, v] });
    }
  });
  return rows;
}
