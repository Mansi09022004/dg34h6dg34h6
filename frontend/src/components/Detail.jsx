import React, { useState } from "react";
import { HELP, fmt, fmtSigned, fmtStamp, hhmm } from "../lib.js";
import { Info, Segmented, State } from "./ui.jsx";

/** Error cell: signed value plus a small bar (blue = forecast above actual, emerald = below). */
function ErrCell({ e, max }) {
  const w = Math.min(100, (Math.abs(e) / max) * 100);
  return (
    <td className={`err ${e >= 0 ? "up" : "down"}`}>
      <span className="ebar"><i style={{ width: `${w}%` }} /></span>{fmtSigned(e)}
    </td>
  );
}

/** The rows behind every number for the selected day. Collapsed by default to keep the page short. */
export function Detail({ fc, threshold }) {
  const [tab, setTab] = useState("hourly");
  const points = fc.data?.points ?? [];
  const half = fc.data?.half_hourly ?? [];
  const max = Math.max(1, ...points.map((p) => Math.abs(p.error)));
  return (
    <section className="sec detail" id="detail">
      <details>
        <summary>
          <span className="eyebrow">The numbers</span>
          <h2>Detailed tables{fc.data ? ` for ${fc.data.delivery_day}` : ""}</h2>
          <span className="hint">hourly comparison and original 30-minute actuals (click to expand)</span>
        </summary>
        <div className="det-body">
          <div className="det-tools">
            <Segmented label="Table" value={tab} onChange={setTab} options={[["hourly", "Hourly (used for statistics)"], ["30min", "Original 30-minute actuals"]]} />
            <span className="hint">Rows beyond ±{fmt(threshold)} MW are highlighted.</span>
          </div>
          <State q={fc} empty={fc.data && !points.length && "No forecast available before the decision point for this day."}>
            {points.length > 0 && (tab === "hourly" ? (
              <div className="tablewrap" tabIndex={0} role="region" aria-label="Hourly comparison table">
                <table>
                  <thead><tr>
                    <th scope="col">Hour (UTC)</th><th scope="col">Forecast published</th><th scope="col">Lead (h)<Info text={HELP.lead} /></th>
                    <th scope="col">Forecast MW</th><th scope="col">Actual MW (hour avg)</th><th scope="col">Forecast − actual MW<Info text={HELP.bias} /></th>
                  </tr></thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.startTime} className={Math.abs(p.error) > threshold ? "flag" : ""}>
                        <th scope="row">{hhmm(p.startTime)}</th><td>{fmtStamp(p.publishTime)}</td><td>{p.horizon_h}</td>
                        <td>{fmt(p.forecast)}</td><td>{fmt(p.actual)}</td><ErrCell e={p.error} max={max} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <p className="foot top">The forecast is hourly, so no error is computed per half-hour; the same hourly forecast value sits beside both half-hours it covers.</p>
                <div className="tablewrap" tabIndex={0} role="region" aria-label="Original 30-minute actuals table">
                  <table>
                    <thead><tr><th scope="col">Period start (UTC)</th><th scope="col">Settlement period</th><th scope="col">Actual MW (30 min)</th><th scope="col">Hourly forecast covering it MW</th></tr></thead>
                    <tbody>
                      {half.map((r) => (
                        <tr key={r.startTime}>
                          <th scope="row">{hhmm(r.startTime)}</th><td>{r.settlementPeriod}</td><td>{fmt(r.actual_30min)}</td>
                          <td>{r.forecast_for_hour == null ? "n/a" : fmt(r.forecast_for_hour)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ))}
          </State>
        </div>
      </details>
    </section>
  );
}
