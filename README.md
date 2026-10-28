# Wind Forecast Desk

Web app for a GB energy utility's day-ahead team. For any delivery day in **January 2026** it shows

1. the latest national wind forecast that had been published **at or before an assumed decision time**, next to actual generation, and
2. how accurate those forecasts were (MAE, RMSE, bias, error percentiles and breakdowns), as a **forecast error band**.

The app analyses wind forecast uncertainty only. It does **not** say how much electricity to buy; combine it with demand and other supply information.

**Live app:** https://dg34h6dg34h6.vercel.app

## AI-tool disclosure
Built with the assistance of **Claude (Anthropic) via Claude Code**: data exploration, code and test generation,
and drafting this document. The author reviewed the design decisions and the code.

## Data sources (real Elexon data, no mock data)
Both from the Elexon BMRS API (`https://data.elexon.co.uk/bmrs/api/v1/datasets`):

| Dataset | Used for | Filter | Resolution (verified on the live API) | Fields used |
|---|---|---|---|---|
| [FUELHH](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) | Actual generation | `fuelType = WIND` | **30 minutes** (1,488 rows for 1-31 Jan, always exactly 30 min apart; the snapshot also holds 29-31 Dec for the reference method below) | `startTime`, `generation` (MW), `settlementPeriod` |
| [WINDFOR](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream) | Forecast | none | **Hourly** (`startTime` always on the hour; one publication covers 73 hours at 1 h spacing) | `startTime`, `publishTime`, `generation` (MW) |

Field meaning: `startTime` = start of the delivery period being predicted/measured; `publishTime` = when the
forecast was created; `generation` = average MW. **Lead time** = `startTime - publishTime`.

The app reads **CSV snapshots** in `backend/data/` (created by `scripts/fetch_data.py`, with `meta.json` recording the fetch time), so it is fast, reproducible and does not depend on Elexon being up. The UI shows the snapshot date. If a re-fetch fails (after retries) the script aborts and leaves the existing snapshot untouched. There is no fallback/mock data. The snapshot was verified identical to the live API for all FUELHH rows and the 14 Jan WINDFOR publications.

## Forecast-selection logic and assumptions
For delivery day D and a **decision time** (default **09:00 UTC on D-1**), for every hour of D we use the forecast with the
greatest `publishTime` that is **<= the decision time** (inclusive). Forecasts published afterwards are never used; hours with no eligible forecast are
reported as missing (never back-filled with a later forecast).

- **The 09:00 default is an assumption for this assessment, not a verified official market deadline.** The assignment gives no cutoff.
  It is shown in the UI as "Assumed decision time (adjustable)" and can be changed (API: `cutoff=HH:MM`, UTC).
- **Time zones:** all timestamps are UTC. January is GMT, so UK time = UTC and no daylight-saving conversion is needed (this would need handling for dates in summer time).
- **Delivery day** = the UTC calendar day of `startTime`. Decisions for 1 Jan use forecasts published in December (the snapshot starts 15 Dec).
- **Resolution alignment:** the forecast is hourly and actuals are 30-minute. Each hourly actual = **mean of the hour's two 30-minute values** (MW is average power), and
  only if both are present. All errors are computed hourly, hourly vs hourly. The original 30-minute actuals are shown in a separate table for inspection, with no per-half-hour error.
- **Coverage is shown.** Early cutoffs can leave hours without a forecast (e.g. 00:00 leaves 62 of 744 hours); these are excluded and counted, not hidden.

## Metric definitions
`error = forecast - actual` in MW, per hour. **Sign convention: positive = forecast above actual generation.**

| Metric | Definition |
|---|---|
| MAE | mean of abs(error) |
| RMSE | square root of mean(error^2); always >= MAE |
| Bias | mean(error) |
| MAE / mean actual | MAE / mean(actual) * 100; reported as n/a if mean actual is not positive |
| Hours within threshold | share of hours with abs(error) <= threshold (selectable, inclusive) |
| Forecast error band, P10 to P90 | The 10th and 90th percentile of the signed error (forecast - actual): the middle 80% of hours fall in this range. Shown in the Accuracy KPIs. |
| P50 / P90 / P95 of abs(error) | Percentiles of the absolute error (e.g. P90: in 9 of 10 hours the forecast was within +/- this value of actual). Returned by the API; not shown in the UI. They describe forecast uncertainty, not an amount to buy. |

Only valid forecast-actual pairs are used (inner join); missing values are never treated as zero.

## Investigation: the +1,852 MW bias (forecast above FUELHH WIND)
At the 09:00 decision point the forecast is on average +1,852 MW above FUELHH WIND (above on 27 of the 31 days). **The cause is not established.** An earlier version of this README called it "mostly a definitional mismatch"; that was not verified and has been withdrawn.

**What the docs say.** Elexon's API spec (`https://data.elexon.co.uk/swagger/v1/swagger.json`) describes FUELHH as "half-hourly generation outturn (Generation By Fuel type)... an indication of the generation outturn for Great Britain... average MW values over 30 minutes" and WINDFOR only as "wind generation forecast data". Neither says which plants are covered. The only longer Elexon text we could retrieve is the 2018 "BMRS API and Data Push User Guide": it has a combined service "Wind Generation Forecast and Out-turn Data" that pairs WINDFOR (forecast) with FUELHH (out-turn), which suggests they are meant to be compared, but it does not define plant scope either. The current documentation pages are rendered by JavaScript and the Elexon glossary page returned HTTP 403, so we could not read them.

**What we checked** (`scripts/bias_check_days.py`, live Elexon API, plus `bias_check_raw.py`, `bias_check_monthly.py`, `bias_check_agws.py`):
- *11, 12 and 28 January (the largest misses) have no data gaps or glitches:* FUELHH has all 48 half-hours, no duplicates, no zero or negative values, no half-hour jump above 1,000 MW, and equals the snapshot.
- *FUELHH matches Elexon's 5-minute generation feed (FUELINST)* once averaged to half-hours (0 MW difference on 11 and 12 January, at most 88 MW on 28 January).
- *It is not one bad publication:* on those days every WINDFOR publication is above FUELHH, and the gap shrinks as the forecast approaches the hour (28 January: about 7.5 GW two days ahead, about 2.1 GW at the last publication).
- *It is not a flat offset:* across the month the gap is about 8% of the forecast in the lowest quarter of forecast hours and about 17% in the highest (actual ≈ 0.79 × forecast + 1.2 GW, correlation 0.95). Bias was positive in every month from June 2025 to January 2026 (+0.9 to +1.7 GW).
- *The days differ.* 11 January: the day-ahead forecast (about 18.4 GW) was close to Elexon's onshore + offshore wind series AGWS (18.0 GW) while FUELHH was 13.6 GW. 28 January: the day-ahead forecast (about 11.1 GW) was well above both AGWS (7.1 GW) and FUELHH (5.8 GW), which looks like a genuine forecast miss.

**What we could not verify.** (1) What exactly each dataset covers (for example metered transmission wind versus embedded wind). (2) Whether curtailment of wind farms on windy days contributes (needs bid-offer acceptance data, not used here). (3) Whether AGWS, which is partly estimated, is the right reference.

**Consequence.** The task specifies FUELHH, so the app uses it, labels every bias "against FUELHH" and says the cause is not established (Accuracy tab, "How these numbers are calculated"). The likely picture is a mix of genuine forecast error and a possible coverage difference between the two datasets, but we cannot say how much of each.

## Context for the headline number
**Compared with what? (`/api/baselines`)** The forecast is scored against two deliberately simple reference methods that use no weather information, on exactly the same hours (744 of 744 at a 09:00 decision point):

| Method | Definition | Look-ahead? |
|---|---|---|
| Same hour, two days earlier | Predict hour H of day D with the actual of hour H on D-2 | None: the latest source hour ends at 00:00 on D-1, before any decision time |
| Last known actual, held flat | Predict every hour of D with the most recent completed hourly actual at the decision time | None: only hours whose end is at or before the decision time |

`skill = (1 - MAE_forecast / MAE_reference) * 100`. Result at 09:00: forecast MAE 2,142 MW vs 4,303 MW (same hour D-2) and 4,118 MW (last actual held flat), i.e. about 50% and 48% smaller. These are **not industry benchmarks**, and "last known actual" assumes FUELHH values are available as soon as an hour ends, which favours that method.

**Does the decision time matter? (`/api/cutoff-sensitivity`)** The same MAE for every hourly decision time on D-1. Only decision times that give *every* delivery hour a forecast are charted (03:00-23:00 UTC), and every charted point is scored on the same 744 hours as the headline accuracy, so the value at 09:00 (2,142 MW) equals the headline MAE. 00:00-02:00 UTC are not charted: at those times only 682 of 744 hours have a forecast yet (shown in the API as `excluded`). A reference line shows the "freshest forecast published before each hour starts" (1,800 MW; a best case, not a day-ahead decision). MAE falls from about 2,200 MW at 03:00 to 1,936 MW at 23:00, while the bias stays between about +1.6 and +1.9 GW at every decision time.

**Error versus lead time (`/api/lead-time`).** Uses *every* published forecast for every January delivery hour (14,383 forecast-hour pairs), grouped by lead time = `startTime - publishTime` in 6-hour buckets, so each bucket draws on the same delivery hours and the curve is not mixed up with the hour of day. (An earlier version grouped only the one forecast selected at a fixed 09:00 cutoff, which confounded lead time with hour of day and contradicted the decision-time chart; it was removed.) Result: MAE rises from 1,772 MW for forecasts published 0-6 h before the hour to 2,422 MW for 42-48 h before. Forecasts published more than 48 h ahead exist for only some hours, so they are not charted.

## Project structure
```
api/index.py              Vercel serverless entrypoint (re-exports the FastAPI app)
backend/app/core.py       Pure logic: forecast selection, alignment, metrics (unit-tested)
backend/app/context.py    Reference methods and decision-time sensitivity (unit-tested)
backend/app/main.py       FastAPI routes: /api/meta, /api/forecast, /api/accuracy, /api/baselines, /api/cutoff-sensitivity, /api/health
backend/tests/            test_core.py (logic), test_context.py (reference methods, sensitivity), test_api.py (endpoints on the real snapshot)
frontend/src/insights.test.js  Node built-in tests for the finding/chart-row generators (npm test)
.github/workflows/ci.yml  CI: backend pytest, frontend tests + build, Docker build
backend/data/             actuals.csv, forecasts.csv, meta.json (Elexon snapshot)
frontend/src/             React + Vite + Recharts UI: App.jsx, lib.js (API/format helpers), insights.js (pure functions that
                          generate findings and chart rows), components/ (Hero, Scenario, ForecastChart,
                          Insights, Accuracy, Context, Analysis, Detail, ui)
scripts/fetch_data.py     Re-download the snapshot (retries, atomic write)
scripts/explore.py, bias_check_*.py   Data checks used in the bias investigation (bias_check_days.py: 11, 12, 28 Jan)
requirements.txt          Runtime Python deps (used by Docker and Vercel); requirements-dev.txt adds test deps
Dockerfile                Multi-stage: builds the UI, then serves UI + API from one container
vercel.json               Vercel config: static UI + Python function
```

UI, two views that follow the buyer's two questions. **Forecast** (first): a hero that leads with the forecast itself ("Wind on Thu 15 Jan is forecast to average X MW", peak hour, lowest hour, day total in GWh, the 24-hour forecast profile, and which forecast publication was used, including the newer one that came out after the decision point and is therefore not used); the controls (delivery day, assumed decision time, significant-error threshold); an hour-by-hour chart with the forecast bold and the actual shown lightly (toggle, hourly or 30-minute, zoom to 00-12 / 12-24); a supporting section on how the forecast compared with what happened; and collapsed detailed tables. **Accuracy** (second tab, also reachable at `#accuracy`): MAE as the primary metric, supporting metrics, the comparison with two simple methods, and patterns by day, hour of day, lead time and decision time. All headline numbers and findings are computed from the data. No live updating is implied: the data is a static snapshot.

API: `GET /api/baselines?cutoff=09:00`, `GET /api/cutoff-sensitivity`, `GET /api/lead-time`, `GET /api/forecast?day=2026-01-15&cutoff=09:00` (also returns `forecast_hours`, every selected forecast hour even without an actual, and `next_publication`, the first forecast published after the decision time and therefore not used), `GET /api/accuracy?start=&end=&cutoff=&threshold_mw=2000`, `GET /api/meta`. Invalid dates/cutoffs return HTTP 422.

## Run it
**Local development**
```bash
pip install -r requirements.txt -r requirements-dev.txt
cd backend && uvicorn app.main:app --port 8000      # API on :8000
cd frontend && npm install && npm run dev            # UI on :5173 (proxies /api to :8000)
```
**Docker (single container; built and run locally, see Deployment)**
```bash
docker build -t wind-desk . && docker run -p 8000:8000 wind-desk   # http://localhost:8000
```
**Refresh data (optional):** `pip install pandas && python scripts/fetch_data.py`

## Testing
```bash
cd backend && pytest
```
60 backend tests plus 15 frontend tests (`cd frontend && npm test`). Backend: forecast selection (inclusive cutoff, 1 minute after, no back-fill, NaN handling, delivery-day filter), January boundaries (1 Jan uses December publications, 31 Jan excludes February targets) and UTC decision time,
half-hour/hour alignment, missing data, metrics with hand-calculated answers (MAE, RMSE, bias, percentiles, threshold), and API tests on the real snapshot
(including a check that no forecast published after the cutoff is ever returned, for every January day and several cutoffs), the two reference methods (with explicit no-look-ahead tests) and the decision-time sensitivity (known answers, same-hours scoring, freshest forecast never published after the hour starts). Frontend tests cover the generated findings (averages, largest miss, stretches of significant hours, thresholds) and the chart rows (forecast/actual crossings).

CI (`.github/workflows/ci.yml`) runs the backend tests, frontend tests and build, and a Docker build on every push. The first run on GitHub (after the initial push) completed successfully.

## Deployment (Vercel, free tier)
Push the repo to GitHub (anonymous repo name), import it in Vercel; `vercel.json` builds the UI (`frontend/dist`) and serves `api/index.py` (FastAPI) for `/api/*`, including `backend/**` data files.
**Status (checked 28 Oct 2026):** deployed at https://dg34h6dg34h6.vercel.app. After deploying, `/`, `/api/health`, `/api/accuracy` (MAE 2,142 MW over 744 hours, same as locally), `/api/lead-time`, `/api/cutoff-sensitivity`, `/api/baselines`, `/api/forecast` and `/api/meta` all returned HTTP 200. `vercel.json` sets `"framework": null` because Vercel otherwise detects FastAPI and ignores the static UI (the first deploy returned 404 for every URL). The Docker image was built and run on the author's machine (Docker 29.7.2): the container served the UI and the API, and `/api/accuracy` returned the same MAE (2,142 MW, 744 hours).

## Known limitations
One month, one forecast source, one actual series (FUELHH); the cutoff is an assumption; national level only; no demand or supply data; snapshot data is static.
