import React, { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, fmtSigned, fmtStamp, forecastHoursOf } from "../lib.js";
import { chartRows, hourLabel } from "../insights.js";
import { Section, Segmented, State } from "./ui.jsx";

const BLUE = "#3b82f6";      // forecast (and "forecast above actual")
const EMERALD = "#10b981";   // actual (and "actual above forecast")
const RANGES = { all: [0, 24, 3], am: [0, 12, 2], pm: [12, 24, 2] }; // [from h, to h, tick step h]
const axisText = { fill: "#8a9bbd", fontSize: 12 };

/** Tooltip: the forecast first (known beforehand), the actual second (what happened). */
function ChartTip({ active, payload, rows, mode, showActual }) {
  if (!active || !payload?.length) return null;
  let r = payload[0].payload;
  if (r.synthetic) { // crossing point: show the nearest real period instead
    const real = rows.filter((q) => !q.synthetic);
    r = real.reduce((a, q) => (Math.abs(q.x - r.x) < Math.abs(a.x - r.x) ? q : a), real[0]);
  }
  const diff = r.forecast == null ? null : r.forecast - r.actual;
  return (
    <div className="tip">
      <div className="tip-h">{hourLabel(r.x)} UTC<span>{mode === "30min" ? `settlement period ${r.sp}` : "hour"}</span></div>
      <div className="tip-sec">Forecast, known at the decision point</div>
      <div className="tip-r"><i className="kf" />Forecast<b>{r.forecast == null ? "n/a" : `${fmt(r.forecast)} MW`}</b></div>
      {showActual && (
        <>
          <div className="tip-sec">What actually happened</div>
          <div className="tip-r"><i className="ka" />Actual{mode === "hourly" ? " (hour avg)" : " (30 min)"}<b>{fmt(r.actual)} MW</b></div>
          {mode === "hourly" && diff != null && <div className="tip-r diff">Forecast − actual<b className={diff >= 0 ? "up" : "down"}>{fmtSigned(diff)} MW</b></div>}
        </>
      )}
      {r.published && <div className="tip-f">Forecast published {fmtStamp(r.published)}{mode === "hourly" ? ` · ${r.lead} h before this hour` : ""}</div>}
    </div>
  );
}

export function ForecastChart({ fc }) {
  const [mode, setMode] = useState("hourly");
  const [range, setRange] = useState("all");
  const [showActual, setShowActual] = useState(true);
  const points = fc.data?.points ?? [];
  const half = fc.data?.half_hourly ?? [];
  const [from, to, step] = RANGES[range];
  const hourly = mode === "hourly";

  const rows = useMemo(
    () => chartRows(mode, points, half).filter((r) => r.x >= from && r.x < to),
    [mode, points, half, from, to],
  );
  const vals = rows.flatMap((r) => (showActual ? [r.forecast, r.actual] : [r.forecast])).filter((v) => v != null);
  const yMin = Math.floor((Math.min(...vals) - 500) / 1000) * 1000;
  const yMax = Math.ceil((Math.max(...vals) + 500) / 1000) * 1000;
  const ticks = Array.from({ length: Math.floor((to - from - 1) / step) + 1 }, (_, i) => from + i * step);
  const last = rows.length - 1;
  const lastRow = rows[last];
  const fAbove = lastRow && lastRow.forecast >= lastRow.actual;

  // Direct labels at the right-hand end of each line (so colour is never the only identifier).
  const endLabel = (text, color, above) => ({ x, y, index }) =>
    index === last ? <text x={x + 9} y={y + (above ? -2 : 13)} textAnchor="start" fill={color} fontSize="12" fontWeight="600">{text}</text> : null;

  const hours = forecastHoursOf(fc.data);
  const pubs = [...new Set(hours.map((h) => h.publishTime))].sort();
  const pubText = pubs.length === 0 ? "" : pubs.length === 1 ? fmtStamp(pubs[0]) : `${fmtStamp(pubs[0])} – ${fmtStamp(pubs[pubs.length - 1])}`;
  const next = fc.data?.next_publication;
  const empty = fc.data && !points.length && `No hourly forecast had been published by ${fmtStamp(fc.data.decision_time)}, so there is nothing to show for this day.`;

  return (
    <Section
      id="chart"
      title={fc.data ? `The wind forecast for ${fc.data.delivery_day}` : "The wind forecast for this day"}
      actions={
        <div className="tools">
          <label className="toggle"><input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />Show actual</label>
          <Segmented label="Resolution" value={mode} onChange={setMode} options={[["hourly", "Hourly"], ["30min", "30-minute"]]} />
          <Segmented label="Time range" value={range} onChange={setRange} options={[["all", "Full day"], ["am", "00–12"], ["pm", "12–24"]]} />
        </div>
      }
    >
      <State q={fc} empty={empty}>
        {points.length > 0 && (
          <>
            <div className="legend">
              <span><svg width="26" height="8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={BLUE} strokeWidth="3" /></svg>Forecast</span>
              {showActual && <span><svg width="26" height="8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={EMERALD} strokeWidth="1.75" /></svg>Actual</span>}
              {showActual && hourly && <span><i className="swatch" style={{ background: `${BLUE}44` }} />Forecast above actual</span>}
              {showActual && hourly && <span><i className="swatch" style={{ background: `${EMERALD}44` }} />Actual above forecast</span>}
            </div>

            <div className="chart tall">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 10, right: 62, bottom: 22, left: 4 }}>
                  <defs>
                    <linearGradient id="fcfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BLUE} stopOpacity="0.3" /><stop offset="1" stopColor={BLUE} stopOpacity="0" /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#16213a" vertical={false} />
                  <XAxis dataKey="x" type="number" domain={[from, to - (hourly ? 1 : 0.5)]} ticks={ticks} tickFormatter={(h) => hourLabel(h)} tickMargin={8}
                    stroke="#2a3a5c" tick={axisText} label={{ value: hourly ? "Hour starting (UTC)" : "30-minute period starting (UTC)", position: "insideBottom", offset: -14, ...axisText }} />
                  <YAxis domain={[yMin, yMax]} tickCount={Math.min(8, (yMax - yMin) / 1000 + 1)} tickFormatter={fmt} width={66} stroke="none" tick={axisText}
                    label={{ value: "Wind generation (MW)", angle: -90, position: "insideLeft", offset: 6, style: { textAnchor: "middle" }, ...axisText }} />
                  <Tooltip content={<ChartTip rows={rows} mode={mode} showActual={showActual} />} cursor={{ stroke: "#5b6b8c", strokeWidth: 1 }} isAnimationActive={false} />
                  {!showActual && <Area dataKey="forecast" type={hourly ? "linear" : "stepAfter"} baseValue={yMin} stroke="none" fill="url(#fcfill)" isAnimationActive={false} activeDot={false} />}
                  {showActual && hourly && <Area dataKey="under" type="linear" stroke="none" fill={EMERALD} fillOpacity={0.13} isAnimationActive={false} activeDot={false} />}
                  {showActual && hourly && <Area dataKey="over" type="linear" stroke="none" fill={BLUE} fillOpacity={0.15} isAnimationActive={false} activeDot={false} />}
                  {showActual && (
                    <Line dataKey="actual" type="linear" stroke={EMERALD} strokeWidth={1.75} strokeOpacity={0.9} dot={mode === "30min" ? { r: 2.2, fill: EMERALD, stroke: "#060b17", strokeWidth: 1 } : false}
                      activeDot={{ r: 4, stroke: "#060b17", strokeWidth: 2 }} isAnimationActive={false} label={endLabel("Actual", EMERALD, !fAbove)} />
                  )}
                  <Line dataKey="forecast" type={hourly ? "linear" : "stepAfter"} stroke={BLUE} strokeWidth={3} dot={false}
                    activeDot={{ r: 5, stroke: "#060b17", strokeWidth: 2 }} isAnimationActive={false} label={endLabel("Forecast", BLUE, fAbove || !showActual)} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="prov">
              <div>
                <span className="eyebrow blue">Forecast · known beforehand</span>
                <p>WINDFOR, hourly. Latest publication at or before the decision point: <b>{pubText}</b>.
                  {next ? <> A newer forecast, published {fmtStamp(next)}, was not available then and is not used.</> : " Nothing published later is used."}</p>
              </div>
              <div>
                <span className="eyebrow green">Actual · for comparison</span>
                <p>FUELHH wind, 30-minute periods. {hourly ? "Shown as the average of each hour's two periods." : "Original periods, unaveraged."}</p>
              </div>
            </div>

            <p className="foot">
              {hourly
                ? "Hourly view: the forecast is natively hourly; each actual is the mean of that hour's two 30-minute values, so the two are compared like for like."
                : "30-minute view: original FUELHH periods. The hourly forecast is drawn as a step covering both half-hours; errors are not computed per half-hour."}
              {" "}{fc.data.coverage.matched_hours} of {fc.data.coverage.expected_hours} hours have both a forecast and an actual.
            </p>
          </>
        )}
      </State>
    </Section>
  );
}
