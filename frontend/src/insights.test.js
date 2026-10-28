// Run with `npm test` (Node's built-in test runner: no extra dependencies).
// Tests the pure functions that generate the findings and chart rows. Hand-worked answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chartRows, dayInsights, findings, forecastSummary, hourLabel, hourNum } from "./insights.js";

/** error = forecast − actual, so forecast = actual + error */
const pt = (hour, actual, error) => ({
  startTime: `2026-01-15T${String(hour).padStart(2, "0")}:00:00Z`,
  publishTime: "2026-01-14T07:30:00Z", horizon_h: 20, actual, forecast: actual + error, error,
});

test("hourNum / hourLabel convert timestamps and fractions of an hour", () => {
  assert.equal(hourNum("2026-01-15T10:30:00Z"), 10.5);
  assert.equal(hourLabel(10.5), "10:30");
  assert.equal(hourLabel(9), "09:00");
});

test("dayInsights: average, MAE, worst hour, above/below counts", () => {
  const ins = dayInsights([pt(0, 1000, 100), pt(1, 1000, -300), pt(2, 1000, 500), pt(3, 1000, 600)], 250);
  assert.equal(ins.n, 4);
  assert.equal(ins.avg, 225);                      // (100 - 300 + 500 + 600) / 4
  assert.equal(ins.mae, 375);                      // (100 + 300 + 500 + 600) / 4
  assert.equal(ins.worst.error, 600);
  assert.equal(ins.above, 3);
  assert.equal(ins.below, 1);
});

test("dayInsights: the largest miss is judged by absolute size, so a big negative miss wins", () => {
  const ins = dayInsights([pt(0, 1000, 100), pt(1, 1000, -900)], 250);
  assert.equal(ins.worst.error, -900);
});

test("dayInsights: significant hours are grouped into consecutive stretches", () => {
  const ins = dayInsights([pt(0, 1000, 0), pt(1, 1000, 300), pt(2, 1000, -400), pt(3, 1000, 0), pt(4, 1000, 500)], 250);
  assert.equal(ins.significant.length, 3);
  assert.deepEqual(ins.runs.map((r) => [r.from, r.to, r.n]), [[1, 3, 2], [4, 5, 1]]);
  assert.equal(ins.runs[0].peak.error, -400);
});

test("dayInsights: the threshold is exclusive (an error exactly at the threshold is not significant)", () => {
  assert.equal(dayInsights([pt(0, 1000, 250)], 250).significant.length, 0);
});

test("dayInsights: returns null with no points", () => {
  assert.equal(dayInsights([], 2000), null);
});

test("findings are generated from the numbers, including the no-significant-hours case", () => {
  const ins = dayInsights([pt(0, 1000, 100), pt(1, 1000, -300)], 2000);
  const f = findings(ins, 2000, 500);
  assert.deepEqual(f.map((x) => x.key), ["avg", "worst", "sig", "ctx"]);
  assert.match(f[0].head, /^100 MW below on average$/);   // (100 - 300) / 2 = -100
  assert.match(f[1].head, /300 MW at 01:00 UTC/);
  assert.match(f[2].head, /No hour missed by more than ±2,000 MW/);
  assert.match(f[3].head, /Day MAE 200 MW vs January 500 MW/);
});

test("findings: the January comparison is omitted when no monthly MAE is available", () => {
  const ins = dayInsights([pt(0, 1000, 100)], 50);
  assert.equal(findings(ins, 50, null).some((x) => x.key === "ctx"), false);
});

test("findings: stretches are listed with their UTC hours", () => {
  const ins = dayInsights([pt(10, 1000, 500), pt(11, 1000, 500), pt(22, 1000, 500), pt(23, 1000, 500)], 250);
  const sig = findings(ins, 250, null).find((x) => x.key === "sig");
  assert.match(sig.head, /4 of 4 hours/);
  assert.match(sig.body, /10:00–12:00, 22:00–24:00 UTC/);
});

test("forecastSummary: average, peak, lowest, day total and publications come from the forecast hours only", () => {
  const h = (hour, mw, pub) => ({ startTime: `2026-01-15T${String(hour).padStart(2, "0")}:00:00Z`, publishTime: pub, generation: mw });
  const fs = forecastSummary([h(10, 100, "2026-01-14T07:30:00Z"), h(11, 300, "2026-01-14T07:30:00Z"), h(12, 200, "2026-01-14T04:30:00Z")]);
  assert.equal(fs.n, 3);
  assert.equal(fs.avg, 200);
  assert.equal(fs.peak.startTime, "2026-01-15T11:00:00Z");
  assert.equal(fs.low.generation, 100);
  assert.equal(fs.totalGWh, 0.6);                       // (100 + 300 + 200) MWh = 0.6 GWh
  assert.deepEqual(fs.pubs, ["2026-01-14T04:30:00Z", "2026-01-14T07:30:00Z"]);
  assert.equal(forecastSummary([]), null);
});

test("chartRows (hourly): a synthetic row is inserted exactly where forecast and actual cross", () => {
  const rows = chartRows("hourly", [pt(0, 100, 100), pt(1, 200, -100)], []);   // forecast 200->100, actual 100->200
  assert.equal(rows.length, 3);
  const mid = rows[1];
  assert.equal(mid.synthetic, true);
  assert.equal(mid.x, 0.5);
  assert.equal(mid.forecast, 150);
  assert.equal(mid.actual, 150);
  assert.deepEqual(rows[0].over, [100, 200]);    // forecast above actual: blue band between them
  assert.deepEqual(rows[0].under, [100, 100]);   // nothing where actual is above forecast
  assert.deepEqual(rows[2].under, [100, 200]);   // after the crossing the actual is above the forecast
  assert.deepEqual(rows[2].over, [200, 200]);
});

test("chartRows (hourly): no synthetic row when the sign does not change or an error is exactly zero", () => {
  assert.equal(chartRows("hourly", [pt(0, 100, 10), pt(1, 100, 20)], []).length, 2);
  assert.equal(chartRows("hourly", [pt(0, 100, 10), pt(1, 100, 0), pt(2, 100, -10)], []).length, 3);
});

test("chartRows (30-minute): original periods on a fractional-hour axis, no shaded bands", () => {
  const half = [
    { startTime: "2026-01-15T10:00:00Z", settlementPeriod: 21, actual_30min: 500, forecast_for_hour: 480, publishTime: "x" },
    { startTime: "2026-01-15T10:30:00Z", settlementPeriod: 22, actual_30min: 520, forecast_for_hour: 480, publishTime: "x" },
  ];
  const rows = chartRows("30min", [], half);
  assert.deepEqual(rows.map((r) => [r.x, r.actual, r.forecast, r.sp]), [[10, 500, 480, 21], [10.5, 520, 480, 22]]);
  assert.equal("over" in rows[0], false);
});

test("grammar: one hour is singular everywhere in the generated findings", () => {
  const ins = dayInsights([pt(10, 1000, 500)], 250);
  const f = findings(ins, 250, null);
  const text = f.map((x) => `${x.head} ${x.body}`).join(" ");
  assert.doesNotMatch(text, /\b1 hours\b/);
  assert.match(f.find((x) => x.key === "sig").head, /^1 of 1 hour missed/);
  assert.match(f.find((x) => x.key === "sig").body, /^1 hour had an error larger than ±250 MW, in 1 stretch:/);
  assert.match(f.find((x) => x.key === "avg").body, /averaged over 1 hour\)\. It was above actual in 1 hour and below in 0\./);
});

test("plural: counts and nouns agree", async () => {
  const { plural } = await import("./lib.js");
  assert.equal(plural(1, "hour"), "1 hour");
  assert.equal(plural(0, "hour"), "0 hours");
  assert.equal(plural(744, "hour"), "744 hours");
});
