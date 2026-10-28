import React from "react";
import { fmt, fmtSigned, hhmm } from "../lib.js";
import { findings } from "../insights.js";
import { Section, State } from "./ui.jsx";

/** One cell per hour: hue = direction of the miss, intensity = size relative to the chosen threshold. */
function Strip({ points, threshold }) {
  return (
    <div className="strip-wrap">
      <div className="strip" role="list" aria-label="Forecast error by hour of the selected day">
        {points.map((p) => {
          const over = p.error >= 0;
          const alpha = Math.min(1, 0.4 + (Math.abs(p.error) / (2 * threshold)) * 0.6);
          const sig = Math.abs(p.error) > threshold;
          return (
            <button
              key={p.startTime} type="button" role="listitem" className={`cell ${sig ? "sig" : ""}`}
              style={{ background: `rgba(${over ? "125,179,255" : "52,211,153"},${alpha})` }}
              data-tip={`${hhmm(p.startTime)} UTC · forecast ${fmt(p.forecast)} MW, actual ${fmt(p.actual)} MW · ${fmtSigned(p.error)} MW (${over ? "forecast above" : "forecast below"})`}
              aria-label={`${hhmm(p.startTime)} UTC: forecast minus actual ${fmtSigned(p.error)} megawatts`}
            />
          );
        })}
      </div>
      <div className="strip-axis" aria-hidden><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      <div className="strip-key">
        <span><i style={{ background: "rgba(125,179,255,.9)" }} />Forecast above actual</span>
        <span><i style={{ background: "rgba(52,211,153,.9)" }} />Forecast below actual</span>
        <span><i className="ring" />Beyond ±{fmt(threshold)} MW</span>
        <span className="faint">Stronger colour = bigger miss</span>
      </div>
    </div>
  );
}

export function Insights({ fc, ins, threshold, monthMae, day, onAccuracy }) {
  const empty = fc.data && !ins && "No forecast was available before the decision point for this day, so there are no findings to show.";
  return (
    <Section id="matters" eyebrow="For evaluation" title="How the forecast compared with what happened" lede={`${day} is in the past, so we can check the forecast against actual generation. Calculated from the hourly pairs.`}>
      <State q={fc} empty={empty}>
        {ins && (
          <div className="matters">
            <ol className="findings">
              {findings(ins, threshold, monthMae).map((f, i) => (
                <li key={f.key}>
                  <span className="no">{String(i + 1).padStart(2, "0")}</span>
                  <div><h3>{f.head}</h3><p>{f.body}</p></div>
                </li>
              ))}
            </ol>
            <div className="strip-col">
              <h3 className="mini">Hour-by-hour miss</h3>
              <Strip points={fc.data.points} threshold={threshold} />
            </div>
          </div>
        )}
        {onAccuracy && <button type="button" className="linkbtn" onClick={onAccuracy}>See how accurate the forecasts were across all of January →</button>}
      </State>
    </Section>
  );
}
