"""Look for data gaps or glitches that could explain the forecast-above-FUELHH bias, on the days with
the largest misses (11, 12 and 28 January) and across the month.

Checks (all against the LIVE Elexon API, nothing is taken from the CSV snapshot except for one comparison):
  1. FUELHH WIND for the day: row count, duplicates, settlement-period continuity, zeros/negatives, biggest
     jump between neighbouring half-hours.
  2. The snapshot CSV equals the live FUELHH values.
  3. FUELINST (5-minute WIND) averaged to half-hours vs FUELHH: is FUELHH consistent with another actuals feed?
  4. AGWS (onshore + offshore wind) vs FUELHH.
  5. Every WINDFOR publication for the day vs actuals: is the over-forecast present in all publications or only
     in one (which would point to a bad publication)?
  6. Month-wide: does the error grow with the forecast level (the pattern expected if actual output is held
     below the forecast on windy days) or is it a flat offset?

Usage: python scripts/bias_check_days.py
"""
import json
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

B = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
DATA = Path(__file__).resolve().parent.parent / "backend" / "data"
DAYS = ["2026-01-11", "2026-01-12", "2026-01-28"]


def get(u):
    with urllib.request.urlopen(B + u, timeout=180) as r:
        return json.load(r)


def day_bounds(d):
    t0 = pd.Timestamp(d, tz="UTC")
    return t0, t0 + pd.Timedelta(days=1)


snap_a = pd.read_csv(DATA / "actuals.csv", parse_dates=["startTime"])
snap_f = pd.read_csv(DATA / "forecasts.csv", parse_dates=["publishTime", "startTime"])

print("=== 1-4: actuals per day ===")
for d in DAYS:
    t0, t1 = day_bounds(d)
    a = pd.DataFrame(get(f"/FUELHH/stream?settlementDateFrom={d}&settlementDateTo={d}&fuelType=WIND"))
    a["startTime"] = pd.to_datetime(a.startTime)
    a = a.sort_values("startTime")
    jumps = a.generation.diff().abs()
    print(f"\n{d}: FUELHH rows {len(a)} (expect 48), dup startTime {int(a.startTime.duplicated().sum())}, "
          f"settlement periods {a.settlementPeriod.min()}-{a.settlementPeriod.max()} contiguous={a.settlementPeriod.diff().dropna().eq(1).all()}")
    print(f"   min {a.generation.min():.0f} max {a.generation.max():.0f} zeros/negatives {int((a.generation <= 0).sum())} biggest half-hour jump {jumps.max():.0f} MW at {a.loc[jumps.idxmax(), 'startTime']}")
    snap = snap_a[(snap_a.startTime >= t0) & (snap_a.startTime < t1)].set_index("startTime").generation
    live = a.set_index("startTime").generation
    print(f"   snapshot == live FUELHH: {bool((snap.reindex(live.index) == live).all())}")

    inst = pd.DataFrame(get(f"/FUELINST/stream?publishDateTimeFrom={d}T00:00:00Z&publishDateTimeTo={(t1 + pd.Timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}&fuelType=WIND"))
    inst["startTime"] = pd.to_datetime(inst.startTime)
    inst = inst[inst.settlementDate == d].drop_duplicates("startTime")
    half = inst.groupby("settlementPeriod").generation.mean()
    cmp = pd.concat([half.rename("fuelinst_mean"), a.set_index("settlementPeriod").generation.rename("fuelhh")], axis=1).dropna()
    print(f"   FUELINST 5-min points {len(inst)}; mean(FUELINST) - FUELHH per half-hour: avg {np.mean(cmp.fuelinst_mean - cmp.fuelhh):.0f} MW, max abs {np.max(np.abs(cmp.fuelinst_mean - cmp.fuelhh)):.0f} MW")

    w = pd.DataFrame(get(f"/AGWS/stream?publishDateTimeFrom={d}T00:00:00Z&publishDateTimeTo={(t1 + pd.Timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}"))
    w = w[w.businessType == "Wind generation"].copy()
    w["startTime"] = pd.to_datetime(w.startTime)
    w = w[(w.startTime >= t0) & (w.startTime < t1)].sort_values("publishTime").drop_duplicates(["startTime", "psrType"], keep="last")
    tot = w.groupby("startTime").quantity.sum()
    j = pd.concat([tot.rename("agws"), live.rename("fuelhh")], axis=1).dropna()
    print(f"   AGWS (onshore+offshore) mean {j.agws.mean():.0f} vs FUELHH mean {j.fuelhh.mean():.0f} MW -> AGWS - FUELHH {np.mean(j.agws - j.fuelhh):.0f} MW over {len(j)} periods")

print("\n=== 5: each WINDFOR publication vs actual, per day ===")
hourly = snap_a.assign(h=snap_a.startTime.dt.floor("h")).groupby("h").generation.agg(["mean", "count"])
hourly = hourly[hourly["count"] == 2]["mean"]
for d in DAYS:
    t0, t1 = day_bounds(d)
    f = snap_f[(snap_f.startTime >= t0) & (snap_f.startTime < t1) & (snap_f.publishTime <= snap_f.startTime)]
    rows = []
    for pub, g in f.groupby("publishTime"):
        e = g.set_index("startTime").generation - hourly.reindex(g.startTime).values
        rows.append((pub, len(g), e.mean(), e.abs().mean()))
    r = pd.DataFrame(rows, columns=["publishTime", "hours", "bias", "mae"])
    print(f"\n{d}: {len(r)} publications covering the day (only hours published before they start)")
    print(r.round(0).to_string(index=False))

print("\n=== 6: month-wide pattern of the error ===")
f = snap_f.dropna()
d = f[f.publishTime <= f.startTime]
best = d.sort_values("publishTime").groupby("startTime").tail(1).set_index("startTime").generation.rename("forecast")
m = pd.concat([best, hourly.rename("actual")], axis=1).dropna().sort_index().loc["2026-01-01":"2026-01-31 23:00"]
m["error"] = m.forecast - m.actual
print(f"freshest forecast vs hourly actual, n={len(m)}: bias {m.error.mean():.0f} MW, MAE {m.error.abs().mean():.0f} MW")
m["level"] = pd.qcut(m.forecast, 4, labels=["lowest quarter", "2nd", "3rd", "highest quarter"])
g = m.groupby("level", observed=True).agg(mean_forecast=("forecast", "mean"), bias=("error", "mean"), ratio=("error", lambda x: np.nan))
g["bias_pct_of_forecast"] = g.bias / g.mean_forecast * 100
print(g[["mean_forecast", "bias", "bias_pct_of_forecast"]].round(1).to_string())
slope, intercept = np.polyfit(m.forecast, m.actual, 1)
print(f"actual = {slope:.3f} x forecast + {intercept:.0f}  (slope 1.0 and intercept 0 would mean no bias; correlation {np.corrcoef(m.forecast, m.actual)[0, 1]:.3f})")
daily = m.groupby(m.index.date).error.mean()
print("days with forecast above actual:", int((daily > 0).sum()), "of", len(daily), "| days below:", [str(x) for x in daily[daily <= 0].index])
