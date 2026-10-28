import React, { useMemo, useState } from "react";
import { useApi } from "./lib.js";
import { dayInsights } from "./insights.js";
import { Hero } from "./components/Hero.jsx";
import { Scenario } from "./components/Scenario.jsx";
import { ForecastChart } from "./components/ForecastChart.jsx";
import { ForecastSummary } from "./components/ForecastSummary.jsx";
import { Insights } from "./components/Insights.jsx";
import { Accuracy } from "./components/Accuracy.jsx";
import { Analysis } from "./components/Analysis.jsx";
import { Detail } from "./components/Detail.jsx";

const VIEWS = [
  ["forecast", "Forecast", "What is forecast for a delivery day"],
  ["accuracy", "Accuracy", "How good were the forecasts in January?"],
];

/**
 * Two views, because the buyer's two questions are different:
 *  - Forecast: what does the wind forecast known at the decision time say for the delivery day?
 *    (hero numbers -> controls -> hourly forecast chart -> how it compared with what happened -> tables)
 *  - Accuracy: how accurate have the forecasts been over all of January?
 */
export default function App() {
  const [view, setViewState] = useState(() => (window.location.hash === "#accuracy" ? "accuracy" : "forecast"));
  const [day, setDay] = useState("2026-01-15");
  const [cutoff, setCutoff] = useState("09:00"); // assumed decision time (UTC), adjustable
  const [threshold, setThreshold] = useState(2000); // "significant error" in MW

  const setView = (v) => {
    setViewState(v);
    window.history.replaceState(null, "", `#${v}`);
  };

  const meta = useApi("meta", {});
  const fc = useApi("forecast", { day, cutoff });
  const acc = useApi("accuracy", { cutoff, threshold_mw: threshold });
  const base = useApi("baselines", { cutoff });
  const sens = useApi("cutoff-sensitivity", {});
  const lead = useApi("lead-time", {});

  const points = fc.data?.points;
  const ins = useMemo(() => (points?.length ? dayInsights(points, threshold) : null), [points, threshold]);

  return (
    <>
      <Hero meta={meta} fc={fc} compact={view !== "forecast"} />
      <main>
        <div className="tabs" role="tablist" aria-label="Views">
          {VIEWS.map(([id, name, sub]) => (
            <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={view === id} aria-controls={`panel-${id}`} className={view === id ? "on" : ""} onClick={() => setView(id)}>
              <b>{name}</b><span>{sub}</span>
            </button>
          ))}
        </div>

        {view === "forecast" ? (
          <div role="tabpanel" id="panel-forecast" aria-labelledby="tab-forecast">
            <Scenario showDay day={day} setDay={setDay} cutoff={cutoff} setCutoff={setCutoff} threshold={threshold} setThreshold={setThreshold} />
            <ForecastSummary fc={fc} day={day} />
            <ForecastChart fc={fc} />
            <Insights fc={fc} ins={ins} threshold={threshold} monthMae={acc.data?.metrics?.mae} day={day} onAccuracy={() => setView("accuracy")} />
            <Detail fc={fc} threshold={threshold} />
          </div>
        ) : (
          <div role="tabpanel" id="panel-accuracy" aria-labelledby="tab-accuracy">
            <Scenario showDay={false} day={day} setDay={setDay} cutoff={cutoff} setCutoff={setCutoff} threshold={threshold} setThreshold={setThreshold} />
            <Accuracy acc={acc} base={base} />
            <Analysis acc={acc} sens={sens} lead={lead} day={day} cutoff={cutoff} />
          </div>
        )}
        <footer>
          Source: Elexon BMRS (FUELHH wind actuals, WINDFOR forecasts), January 2026 snapshot. Error = forecast − actual, in MW. Wind forecast analysis only: it is not a purchase recommendation.
        </footer>
      </main>
    </>
  );
}
