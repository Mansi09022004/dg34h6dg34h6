import React from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, fmtSigned, plural } from "../lib.js";
import { Section, State } from "./ui.jsx";
import { DecisionTime, LeadTime } from "./Context.jsx";

const BLUE = "#3b82f6";
// Brighter than the line colours so the daily bias bars stay readable on the dark background.
const UP = "#7db3ff";    // forecast above actual
const DOWN = "#34d399";  // forecast below actual
const INK = "#cbd5e1";
const axisText = { fill: "#8a9bbd", fontSize: 12 };
const grid = <CartesianGrid stroke="#16213a" vertical={false} />;
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

/** One plain-English sentence per chart, derived from the data shown. */
function takeaways(acc) {
  const { daily, by_hour_of_day: hrs } = acc;
  const worstDay = daily.reduce((a, d) => (d.mae > a.mae ? d : a));
  const high = daily.filter((d) => d.bias > 0).length;
  const hi = hrs.reduce((a, h) => (h.mae > a.mae ? h : a));
  const lo = hrs.reduce((a, h) => (h.mae < a.mae ? h : a));
  return {
    daily: `The forecast was above actual generation on average on ${high} of ${daily.length} days. ${worstDay.day.slice(5)} had the largest average miss (${fmt(worstDay.mae)} MW).`,
    hour: `Average misses are largest around ${hh(hi.hour)} UTC (${fmt(hi.mae)} MW) and smallest around ${hh(lo.hour)} UTC (${fmt(lo.mae)} MW).`,
  };
}

function Tip({ active, payload, label, prefix = "", rows }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      <div className="tip-h">{prefix}{label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div className="tip-r" key={p.dataKey}>{p.dataKey === "mae" ? <i className="kmae" /> : <i className="sq" style={{ background: p.dataKey === "bias" && p.payload.bias < 0 ? DOWN : UP }} />}{rows?.[p.dataKey] ?? p.name}<b>{p.dataKey === "bias" ? fmtSigned(p.value) : fmt(p.value)} MW</b></div>
      ))}
      {payload[0].payload.n != null && <div className="tip-f">{plural(payload[0].payload.n, "hour")}</div>}
    </div>
  );
}

export function Analysis({ acc, sens, lead, day, cutoff }) {
  const ok = acc.data?.metrics?.n > 0;
  const tk = ok ? takeaways(acc.data) : null;
  const dd = day.slice(8);
  return (
    <Section id="analysis" eyebrow="Patterns" title="Where the error comes from" lede="The same hourly forecast-vs-actual pairs, broken down by day, hour of day, lead time and decision time.">
      <State q={acc} empty={acc.data && !ok && "No data for this decision time."}>
        {ok && (
          <div className="analysis">
            <div className="wide">
              <div className="chart-h">
                <h3>Day by day</h3>
                <div className="legend sm">
                  <span><i className="swatch" style={{ background: UP }} />Bias: forecast above actual</span>
                  <span><i className="swatch" style={{ background: DOWN }} />Bias: forecast below actual</span>
                  <span><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={INK} strokeWidth="2" /></svg>MAE</span>
                </div>
              </div>
              <div className="chart" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={acc.data.daily.map((d) => ({ ...d, d: d.day.slice(8) }))} margin={{ top: 8, right: 8, bottom: 20, left: 4 }}>
                    {grid}
                    <XAxis dataKey="d" interval={0} tickMargin={6} stroke="#2a3a5c" tick={{ ...axisText, fontSize: 11 }} label={{ value: "Delivery day (January 2026)", position: "insideBottom", offset: -12, ...axisText }} />
                    <YAxis tickFormatter={fmt} width={58} stroke="none" tick={axisText} label={{ value: "MW", angle: -90, position: "insideLeft", offset: 8, ...axisText }} />
                    <Tooltip content={<Tip prefix="Jan " rows={{ bias: "Bias (forecast − actual)", mae: "MAE" }} />} cursor={{ fill: "#ffffff0a" }} isAnimationActive={false} />
                    <ReferenceLine y={0} stroke="#475569" />
                    <ReferenceLine x={dd} stroke="#f5b544" strokeDasharray="3 3" label={{ value: "selected", fill: "#f5b544", fontSize: 11, position: "insideTopRight" }} />
                    <Bar dataKey="bias" name="Bias" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {acc.data.daily.map((d) => <Cell key={d.day} fill={d.bias >= 0 ? UP : DOWN} fillOpacity={d.day.slice(8) === dd ? 1 : 0.9} />)}
                    </Bar>
                    <Line dataKey="mae" name="MAE" stroke={INK} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="takeaway">{tk.daily}</p>
            </div>

            <div>
              <h3 className="chart-t">Hour of day <small>average miss, UTC</small></h3>
              <div className="chart" style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={acc.data.by_hour_of_day} margin={{ top: 8, right: 8, bottom: 20, left: 4 }}>
                    {grid}
                    <XAxis dataKey="hour" interval={1} tickFormatter={(h) => String(h).padStart(2, "0")} tickMargin={6} stroke="#2a3a5c" tick={axisText} label={{ value: "Hour starting (UTC)", position: "insideBottom", offset: -12, ...axisText }} />
                    <YAxis tickFormatter={fmt} width={58} stroke="none" tick={axisText} label={{ value: "MW", angle: -90, position: "insideLeft", offset: 8, ...axisText }} />
                    <Tooltip content={<Tip prefix="Hour " rows={{ mae: "MAE" }} />} cursor={{ fill: "#ffffff0a" }} isAnimationActive={false} />
                    <Bar dataKey="mae" name="MAE" fill={BLUE} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="takeaway">{tk.hour}</p>
            </div>

            <LeadTime lead={lead} />
          </div>
        )}
      </State>
      <DecisionTime sens={sens} cutoff={cutoff} />
    </Section>
  );
}
