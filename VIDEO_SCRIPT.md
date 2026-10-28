# Video script (10 min max, unlisted YouTube)

## Part 1 — Client pitch (~4:30)
**0:00 Problem (45s).** "Your day-ahead decision has to be made the day before delivery. Wind is weather-dependent, so wind forecast errors matter. Two questions: what did the forecast say when you had to decide, and how much can you trust it?"

**0:45 The forecast first (90s).** Open the app on the Forecast tab, pick 15 Jan. "This is what the wind forecast says for the delivery day: it averages about 11,600 MW, peaks at 15,800 MW at midnight, drops to 8,900 MW in the afternoon, about 280 GWh over the day." Point to the line under the headline: "This is the forecast published at 07:30 on 14 Jan, the latest you had at our assumed 09:00 decision point (adjustable, an assumption, not an official deadline). A newer one came out at 09:30; you didn't have it, so we don't use it." Change the decision time to show the forecast change.

**1:55 What actually happened (30s).** Scroll to the chart: "Because this day is in the past we can lay the actual generation next to the forecast." Untick Show actual to show the forecast alone, then tick it again. One sentence on the section below: how the forecast compared with what happened.

**2:25 Accuracy (60s).** Click the Accuracy tab. "Average miss 2.1 GW, about 18% of output. 9 times in 10 you're within 4.3 GW. And it leans one way: +1.85 GW against FUELHH. We checked it: no data gaps on the biggest-miss days, but we cannot yet say why, so we label it as bias against FUELHH and say the cause is not established." Show daily bars (which days hurt most) and hour-of-day.

**3:15 Context (45s).** Scroll to "Is the forecast better than doing something simple?": "2,142 MW sounds big, but two trivial methods that use no weather information miss by about 4,100 to 4,300 MW, so the forecast halves the error." Then "Does the decision time matter?": "Deciding later improves it, from about 2,200 MW to 1,936 MW, and the best case is 1,800 MW, but the consistent offset stays. So timing is worth a look, but it is not the main issue."

**3:45 Takeaway (45s).** "Practical use: the average miss and the bias tell you how uncertain the wind forecast is; combine them with your demand and other supply. They are not a purchase amount. Next steps: more weather inputs, rolling bias correction, alerts when the forecast changes."

## Part 2 — Tech lead walkthrough (~5:00)
**0:00 Architecture (60s).** Diagram: Elexon -> `scripts/fetch_data.py` -> CSV snapshots -> FastAPI (`core.py` pure logic, `main.py` routes) -> React. Why snapshots: speed, reproducibility, no runtime dependency. Same repo deploys to Vercel (serverless function + static UI) and Docker (one container).

**1:00 The core rule (90s).** Open `core.py: latest_forecast_at_decision`. Filter to the target day, `publishTime <= decision time`, sort, take last per `startTime`. Show the no-leakage choice (no back-fill). Show the tests: late publish ignored, inclusive cutoff, empty case, error sign.

**2:30 Analysis choices (60s).** Hourly vs half-hourly alignment; error sign; why MAE/RMSE/bias/percentiles and not MAPE; lead-time breakdown. Mention the sanity check that even the freshest forecast is biased +1.6 GW, so the finding isn't a cutoff artefact.

**3:30 Frontend + practices (60s).** `useApi` hook, charts, no state library needed. Practices: pure functions, tests on the rule that matters, pinned dependencies, snapshot data, README with decisions and AI disclosure.

**4:15 Quality (30s).** Backend: 60 tests including explicit no-look-ahead tests; frontend: 15 tests on the generated findings; CI workflow defined (runs on push).

**4:30 Limits (30s).** Single month, single metric source, 09:00 assumed cutoff, no capacity normalisation, no auth. All easy extensions.
