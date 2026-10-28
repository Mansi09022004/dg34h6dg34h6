import React from "react";
import { DAYS, decisionDate, fmt, fmtDate } from "../lib.js";

/**
 * The scenario controls. They sit directly above the chart they drive:
 * delivery day (which day to look at) and the assumed decision time (which forecast was known).
 */
export function Scenario({ showDay = true, day, setDay, cutoff, setCutoff, threshold, setThreshold }) {
  const i = DAYS.indexOf(day);
  const dec = decisionDate(day, cutoff);
  return (
    <section className={`controls ${showDay ? "" : "two"}`} aria-label="Scenario controls">
      {showDay && (
        <div className="ctl delivery">
          <label htmlFor="day"><i className="sw green" />Delivery day <small>00:00–24:00 UTC</small></label>
          <div className="row">
            <button type="button" className="step" aria-label="Previous day" disabled={i <= 0} onClick={() => setDay(DAYS[i - 1])}>‹</button>
            <select id="day" value={day} onChange={(e) => setDay(e.target.value)}>{DAYS.map((d) => <option key={d}>{d}</option>)}</select>
            <button type="button" className="step" aria-label="Next day" disabled={i >= DAYS.length - 1} onClick={() => setDay(DAYS[i + 1])}>›</button>
          </div>
          <p>All times UTC (in January UK time = UTC).</p>
        </div>
      )}

      <div className="ctl decision">
        <label htmlFor="cutoff"><i className="sw amber" />Decision point <small>day before, UTC</small></label>
        <div className="row">
          <span className="val">{fmtDate(dec)}</span>
          <input id="cutoff" type="time" value={cutoff} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
        </div>
        <p>Assumed decision time (adjustable): an assumption, not a verified official deadline.</p>
      </div>

      <div className="ctl">
        <label htmlFor="thr"><i className="sw grey" />Significant error</label>
        <div className="row">
          <select id="thr" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
            {[1000, 2000, 3000, 4000].map((t) => <option key={t} value={t}>±{fmt(t)} MW</option>)}
          </select>
        </div>
        <p>Hours with a larger miss are flagged.</p>
      </div>
    </section>
  );
}
