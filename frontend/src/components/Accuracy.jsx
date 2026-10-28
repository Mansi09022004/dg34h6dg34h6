import React from "react";
import { HELP, fmt, fmtSigned, plural, useCountUp } from "../lib.js";
import { Info, Section, State } from "./ui.jsx";
import { Baselines } from "./Context.jsx";

/**
 * What was checked about the bias, on the January 2026 snapshot (see scripts/bias_check_*.py and the README).
 * Written as facts that were verified and facts that could NOT be verified. No cause is claimed.
 */
function BiasChecks({ bias }) {
  return (
    <div className="checks">
      <h4>About the bias ({fmtSigned(bias)} MW against FUELHH): what we checked</h4>
      <p className="verified-h">Verified</p>
      <ul>
        <li><b>No data gaps or glitches on the biggest-miss days.</b> On 11, 12 and 28 January FUELHH has all 48 half-hours, no duplicates, no zero or negative values, and no half-hour jump larger than 1,000 MW. The snapshot equals the live Elexon values.</li>
        <li><b>FUELHH agrees with Elexon's 5-minute generation feed (FUELINST).</b> Averaging the 5-minute values to half-hours reproduces FUELHH (differences: 0 MW on 11 and 12 January, at most 88 MW on 28 January).</li>
        <li><b>It is not one bad forecast.</b> On those three days every WINDFOR publication is above FUELHH. The gap shrinks as the forecast gets closer to the hour (28 January: about 7.5 GW two days ahead, about 2.1 GW at the last publication).</li>
        <li><b>It is not a flat offset.</b> Across the month the gap is about 8% of the forecast in the lowest quarter of forecast hours and about 17% in the highest; actual ≈ 0.79 × forecast + 1.2 GW (correlation 0.95).</li>
        <li><b>The two days differ.</b> On 11 January the day-ahead forecast (about 18.4 GW) was close to Elexon's onshore + offshore wind series AGWS (18.0 GW), while FUELHH was 13.6 GW. On 28 January the day-ahead forecast (about 11.1 GW) was well above both AGWS (7.1 GW) and FUELHH (5.8 GW), which looks like a genuine forecast miss.</li>
      </ul>
      <p className="verified-h">Could not be verified</p>
      <ul>
        <li><b>What exactly each dataset covers</b> (for example metered transmission wind versus embedded wind). The only Elexon definition we could retrieve (the 2018 API guide) pairs WINDFOR with FUELHH as "forecast" and "out-turn" but does not define the plant scope; the current documentation pages would not load.</li>
        <li><b>Whether curtailment of wind farms on windy days contributes.</b> That needs bid-offer acceptance data, which this app does not use.</li>
        <li><b>Whether AGWS is the right reference</b> (it is partly estimated).</li>
      </ul>
      <p className="foot">So the cause of the bias is not established. It looks like a mix of genuine forecast error and a possible coverage difference between the two datasets, and we cannot say how much of each.</p>
    </div>
  );
}

/** Every value comes from the API's calculated metrics. No targets, grades, benchmarks or trends. */
export function Accuracy({ acc, base }) {
  const m = acc.data?.metrics;
  const cov = acc.data?.coverage;
  const ok = m?.n > 0;
  const maeA = useCountUp(ok ? m.mae : null);
  return (
    <Section
      id="accuracy"
      eyebrow="All of January 2026"
      title="How accurate has the forecast been?"
      lede={ok ? `Every delivery day in January, each judged on the forecast available at ${acc.data.cutoff_utc} UTC the day before (adjustable assumption). ${cov.matched_hours} of ${cov.expected_hours} hourly periods.` : undefined}
    >
      <State q={acc} empty={acc.data && !ok && "No valid forecast-actual pairs for this decision time."}>
        {ok && (
          <>
            <div className="acc">
              <div className="primary">
                <div className="lbl">Mean absolute error <Info text={HELP.mae} /></div>
                <div className="big">{fmt(maeA ?? m.mae)}<span> MW</span></div>
                <p>On average, the forecast missed actual wind generation by this much, in either direction
                  {m.mae_pct_of_mean_actual != null && <> — <b>{m.mae_pct_of_mean_actual.toFixed(1)}%</b> of the average actual output of {fmt(m.mean_actual)} MW</>}.
                </p>
              </div>
              <dl className="support">
                <div><dt>RMSE <Info text={HELP.rmse} /></dt><dd>{fmt(m.rmse)} <small>MW</small></dd><dd className="n">Large misses count extra</dd></div>
                <div><dt>Bias <Info text={HELP.bias} /></dt><dd>{fmtSigned(m.bias)} <small>MW</small></dd><dd className="n">forecast {m.bias >= 0 ? "above" : "below"} actual on average</dd></div>
                <div>
                  <dt>Forecast error band, P10 to P90 <Info text={HELP.band} /></dt>
                  <dd>{fmtSigned(m.error_p10)} to {fmtSigned(m.error_p90)} <small>MW</small></dd>
                  <dd className="n">the middle 80% of hours (forecast − actual)</dd>
                </div>
                <div><dt>Worst hour <Info text={HELP.worst} /></dt><dd>{fmt(m.max_abs_error)} <small>MW</small></dd><dd className="n">largest single-hour miss</dd></div>
                <div>
                  <dt>Within ±{fmt(m.threshold_mw)} MW <Info text={HELP.within} /></dt><dd>{m.pct_within_threshold.toFixed(0)}<small>% of hours</small></dd>
                  <dd className="n"><span className="meter" aria-hidden><i style={{ width: `${m.pct_within_threshold}%` }} /></span></dd>
                </div>
              </dl>
            </div>

            <Baselines base={base} />

            {cov.missing_hours > 0 && <p className="foot">{plural(cov.missing_hours, "hour")} had no forecast published before the decision point and {cov.missing_hours === 1 ? "is" : "are"} excluded.</p>}
            <p className="foot">The bias is measured against FUELHH wind actuals. Its cause is not established: see the checks below.</p>
            <details className="how">
              <summary>How these numbers are calculated, and what we checked about the bias</summary>
              <ul>
                <li><b>Error</b> = forecast − actual for each hour, in MW. Positive means the forecast was above actual. Forecast and actual are compared hour against hour (the actual is the mean of the hour's two 30-minute values).</li>
                <li><b>MAE</b>: {HELP.mae}</li>
                <li><b>RMSE</b>: {HELP.rmse}</li>
                <li><b>Bias</b>: {HELP.bias}</li>
                <li><b>Forecast error band</b>: {HELP.band}</li>
                <li><b>Within threshold</b>: {HELP.within}</li>
                <li><b>Lead time</b>: {HELP.lead}</li>
              </ul>
              <BiasChecks bias={m.bias} />
            </details>
          </>
        )}
      </State>
    </Section>
  );
}
