import React from "react";
import { fmt, fmtDate, fmtStamp, forecastHoursOf, hhmm, useCountUp } from "../lib.js";
import { forecastSummary } from "../insights.js";
import { Info, State } from "./ui.jsx";

const pubRange = (pubs) => (pubs.length === 1 ? fmtStamp(pubs[0]) : `${fmtStamp(pubs[0])} to ${fmtStamp(pubs[pubs.length - 1])}`);

/**
 * What the forecast says for the chosen day, right between the controls and the chart:
 * the average, the peak and lowest hour, the day total, and which forecast publication was used.
 * Only forecast values are used here (no actuals, no errors).
 */
export function ForecastSummary({ fc, day }) {
  const hours = forecastHoursOf(fc.data);
  const fs = hours.length ? forecastSummary(hours) : null;
  const avgA = useCountUp(fs ? fs.avg : null);
  const next = fc.data?.next_publication;
  return (
    <State q={fc} empty={fc.data && !fs && "No forecast had been published before the decision point for this day."}>
      {fs && (
        <section className="fsum" aria-label="Forecast summary for the selected day">
          <div className="fsum-main">
            <div className="eyebrow">{fmtDate(new Date(`${day}T00:00:00Z`))}</div>
            <p className="fsum-h">Wind is forecast to average <b>{fmt(avgA ?? fs.avg)} MW</b></p>
          </div>
          <dl className="fsum-stats">
            <div><dt>Peak hour</dt><dd>{fmt(fs.peak.generation)}<small> MW</small></dd><dd className="n">at {hhmm(fs.peak.startTime)} UTC</dd></div>
            <div><dt>Lowest hour</dt><dd>{fmt(fs.low.generation)}<small> MW</small></dd><dd className="n">at {hhmm(fs.low.startTime)} UTC</dd></div>
            <div>
              <dt>Day total<Info text="Each hourly forecast is an average power in MW for one hour, so it equals that many MWh. This is the sum of the hourly forecasts for the day, in GWh." /></dt>
              <dd>{fmt(fs.totalGWh)}<small> GWh</small></dd><dd className="n">{fs.n === 24 ? "24 hourly forecasts" : `${fs.n} of 24 hours`}</dd>
            </div>
          </dl>
          <p className="fsum-pub">
            Forecast published <b>{pubRange(fs.pubs)}</b>, the latest available at your assumed decision point.
            {next && <> A newer one ({fmtStamp(next)}) came out afterwards and is not used.</>}
          </p>
        </section>
      )}
    </State>
  );
}
