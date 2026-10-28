import React from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HELP, fmt, fmtSigned, plural } from "../lib.js";
import { Info, State } from "./ui.jsx";

// Compact blocks that put the headline accuracy number in context. They are rendered inside other
// sections (Accuracy, Analysis), not as sections of their own.

const BLUE = "#3b82f6";
const INK = "#cbd5e1";
const axisText = { fill: "#8a9bbd", fontSize: 12 };

const LABELS = {
  forecast: ["WINDFOR forecast", "Hourly forecast published by Elexon, as available at the decision point."],
  same_hour_2d: ["Same hour, two days earlier", "Predict each hour with what wind actually generated in that hour two days before. Uses no weather information."],
  persistence: ["Last known actual, held flat", "Predict the whole day with the most recent completed hour of actual generation at the decision point. Uses no weather information."],
};

/** Plain-English comparison for one reference method. */
function vs(label, skill) {
  if (skill == null) return null;
  return `${Math.abs(skill).toFixed(0)}% ${skill >= 0 ? "smaller" : "larger"} than “${label.toLowerCase()}”`;
}

/** Forecast vs two trivial reference methods, same hours. */
export function Baselines({ base }) {
  const d = base.data;
  const ok = d?.n > 0;
  const rows = ok ? [["forecast", d.forecast.mae], ...d.baselines.map((b) => [b.key, b.mae])] : [];
  const max = ok ? Math.max(...rows.map((r) => r[1])) : 1;
  return (
    <div className="block">
      <h3 className="block-h">Compared with two simple methods</h3>
      <State q={base} empty={d && !ok && "Not enough overlapping hours to compare."}>
        {ok && (
          <>
            <ul className="bars" aria-label="Average absolute error of the forecast and two simple reference methods">
              {rows.map(([key, mae]) => (
                <li key={key} className={key === "forecast" ? "me" : ""}>
                  <div className="bar-l"><b>{LABELS[key][0]}</b><Info text={LABELS[key][1]} /></div>
                  <div className="bar-t"><i style={{ width: `${(mae / max) * 100}%` }} /></div>
                  <div className="bar-v">{fmt(mae)}<small> MW</small></div>
                </li>
              ))}
            </ul>
            <p className="reading">
              Over the same {plural(d.n, "hour")} the forecast's average miss was{" "}
              {d.baselines.map((b, i) => <span key={b.key}>{i > 0 && " and "}<b>{vs(LABELS[b.key][0], b.skill_pct)}</b></span>)}.
              <span className="faint"> Simple methods that use no weather information, not industry benchmarks.</span>
            </p>
          </>
        )}
      </State>
    </div>
  );
}

const hourOf = (c) => Number(c.slice(0, 2)) + Number(c.slice(3, 5)) / 60;
const yDomain = (vals) => [Math.floor((Math.min(...vals) - 100) / 200) * 200, Math.ceil((Math.max(...vals) + 100) / 200) * 200];

// ---------------------------------------------------------------------------------------------
// Error vs lead time: every published forecast for every delivery hour

function LeadTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-h">Published {p.from_h}–{p.to_h} h before the hour</div>
      <div className="tip-r"><i className="sq" style={{ background: BLUE }} />Average miss (MAE)<b>{fmt(p.mae)} MW</b></div>
      <div className="tip-r">Bias (forecast − actual)<b>{fmtSigned(p.bias)} MW</b></div>
      <div className="tip-f">{plural(p.n, "forecast")} for {plural(p.hours, "delivery hour")}</div>
    </div>
  );
}

/** Computed caption: first vs last full-coverage bucket. */
function leadReading(full, partial, total) {
  const a = full[0], z = full[full.length - 1];
  const pct = (z.mae / a.mae - 1) * 100;
  const parts = [
    `A forecast published ${a.from_h}–${a.to_h} h before the hour missed by ${fmt(a.mae)} MW on average; one published ${z.from_h}–${z.to_h} h before missed by ${fmt(z.mae)} MW (${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "more" : "less"}).`,
    `Every point uses all ${total} delivery hours, so the curve is not mixed up with the hour of the day.`,
  ];
  if (partial.length) parts.push(`Forecasts published more than ${full[full.length - 1].to_h} h ahead exist for only some hours and are not shown.`);
  return parts;
}

export function LeadTime({ lead }) {
  const d = lead.data;
  const full = d ? d.points.filter((p) => p.hours === d.target_hours) : [];
  const partial = d ? d.points.filter((p) => p.hours !== d.target_hours) : [];
  const ok = full.length > 1;
  const data = full.map((p) => ({ ...p, r: `${p.from_h}–${p.to_h}` }));
  const [yMin, yMax] = ok ? yDomain(full.map((p) => p.mae)) : [0, 1];
  return (
    <div>
      <h3 className="chart-t">Lead time <small>how far ahead the forecast was published</small><Info text={HELP.lead} /></h3>
      <State q={lead} empty={d && !ok && "Not enough forecasts to draw this curve."}>
        {ok && (
          <>
            <div className="chart" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
                  <CartesianGrid stroke="#16213a" vertical={false} />
                  <XAxis dataKey="r" tickMargin={6} stroke="#2a3a5c" tick={axisText} label={{ value: "Hours between publication and the hour predicted", position: "insideBottom", offset: -12, ...axisText }} />
                  <YAxis domain={[yMin, yMax]} tickFormatter={fmt} width={58} stroke="none" tick={axisText} label={{ value: "Average miss (MW)", angle: -90, position: "insideLeft", offset: 8, style: { textAnchor: "middle" }, ...axisText }} />
                  <Tooltip content={<LeadTip />} cursor={{ stroke: "#5b6b8c" }} isAnimationActive={false} />
                  <Line dataKey="mae" type="monotone" stroke={BLUE} strokeWidth={2.5} dot={{ r: 3.5, fill: BLUE, stroke: "#060b17", strokeWidth: 1 }} activeDot={{ r: 5.5, stroke: "#060b17", strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {leadReading(full, partial, d.target_hours).map((t, i) => <p key={i} className="takeaway">{t}</p>)}
          </>
        )}
      </State>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Does the decision time matter?

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-h">Decision at {p.cutoff} UTC<span>day before</span></div>
      <div className="tip-r"><i className="sq" style={{ background: BLUE }} />Average miss (MAE)<b>{fmt(p.mae)} MW</b></div>
      <div className="tip-r">Bias (forecast − actual)<b>{fmtSigned(p.bias)} MW</b></div>
      <div className="tip-f">Scored on {plural(p.matched_hours, "hour")}</div>
    </div>
  );
}

/** Sentences about decision-time sensitivity, all computed from the API result. */
function timingReading(s, cutoff) {
  const pts = s.points;
  const sel = pts.reduce((a, p) => (Math.abs(hourOf(p.cutoff) - hourOf(cutoff)) < Math.abs(hourOf(a.cutoff) - hourOf(cutoff)) ? p : a));
  const best = pts.reduce((a, p) => (p.mae < a.mae ? p : a));
  const gain = (1 - best.mae / sel.mae) * 100;
  return [
    gain > 0.5
      ? `At about ${sel.cutoff} UTC the average miss is ${fmt(sel.mae)} MW. Deciding later improves it: ${fmt(best.mae)} MW at ${best.cutoff} UTC (${gain.toFixed(0)}% lower).`
      : `At about ${sel.cutoff} UTC the average miss is ${fmt(sel.mae)} MW, already the lowest of any decision time shown.`,
    `Waiting does not remove the bias: it stays between ${fmtSigned(Math.min(...pts.map((p) => p.bias), s.freshest.bias))} and ${fmtSigned(Math.max(...pts.map((p) => p.bias), s.freshest.bias))} MW at every decision time, against FUELHH actuals.`,
  ];
}

/** MAE for every hourly decision time on the day before, on the same hours as the headline accuracy. */
export function DecisionTime({ sens, cutoff }) {
  const s = sens.data;
  const ok = s?.points?.length > 0;
  const pts = ok ? s.points.map((p) => ({ ...p, x: hourOf(p.cutoff) })) : [];
  const [yMin, yMax] = ok ? yDomain([...pts.map((p) => p.mae), s.freshest.mae]) : [0, 1];
  const x0 = ok ? pts[0].x : 0;
  const ticks = [3, 6, 9, 12, 15, 18, 21].filter((t) => t >= x0);
  const excluded = s?.excluded ?? [];
  return (
    <div className="block">
      <h3 className="block-h">Does the decision time matter?</h3>
      <State q={sens} empty={s && !ok && "No decision time gives a forecast for every hour."}>
        {ok && (
          <div className="timing">
            <div className="chart" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pts} margin={{ top: 14, right: 16, bottom: 22, left: 4 }}>
                  <CartesianGrid stroke="#16213a" vertical={false} />
                  <XAxis dataKey="x" type="number" domain={[x0, 23]} ticks={ticks} tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} tickMargin={8} stroke="#2a3a5c" tick={axisText}
                    label={{ value: "Decision time on the day before (UTC)", position: "insideBottom", offset: -14, ...axisText }} />
                  <YAxis domain={[yMin, yMax]} tickFormatter={fmt} width={62} stroke="none" tick={axisText}
                    label={{ value: "Average miss (MW)", angle: -90, position: "insideLeft", offset: 6, style: { textAnchor: "middle" }, ...axisText }} />
                  <Tooltip content={<Tip />} cursor={{ stroke: "#5b6b8c" }} isAnimationActive={false} />
                  <ReferenceLine y={s.freshest.mae} stroke={INK} strokeDasharray="5 4" label={{ value: `freshest forecast ${fmt(s.freshest.mae)}`, fill: INK, fontSize: 11, position: "insideBottomRight" }} />
                  {hourOf(cutoff) >= x0 && <ReferenceLine x={hourOf(cutoff)} stroke="#f5b544" strokeDasharray="2 3" strokeWidth={1.5} label={{ value: "your decision time", fill: "#f5b544", fontSize: 11, position: "insideTopRight" }} />}
                  <Line dataKey="mae" type="stepAfter" stroke={BLUE} strokeWidth={2} dot={{ r: 3, fill: BLUE, stroke: "#060b17", strokeWidth: 1 }} activeDot={{ r: 5, stroke: "#060b17", strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="notes">
              {timingReading(s, cutoff).map((t) => <p key={t}>{t}</p>)}
              <p className="faint">
                Every point is scored on the same {plural(s.common_hours, "hour")} as the headline accuracy, so the value at your decision time matches it.
                {excluded.length > 0 && <> Decision times {excluded[0].cutoff}–{excluded[excluded.length - 1].cutoff} UTC are not charted: at those times only {Math.min(...excluded.map((e) => e.matched_hours))} of {s.common_hours} hours have a forecast yet.</>}
                {" "}The dashed line is the freshest forecast published before each hour starts (a best case, not a day-ahead decision).
              </p>
            </div>
          </div>
        )}
      </State>
    </div>
  );
}
