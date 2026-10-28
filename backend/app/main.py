"""FastAPI app: serves the January-2026 wind forecast views and accuracy stats.

All times are UTC. The decision cutoff is a query parameter (an assumption, not an
official deadline); see core.py for the selection rule.
"""
from __future__ import annotations

import json
from datetime import date, time
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import context, core

DATA = Path(__file__).resolve().parent.parent / "data"
JAN_START, JAN_END = date(2026, 1, 1), date(2026, 1, 31)

app = FastAPI(title="Wind forecast uncertainty API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])  # read-only demo API


@lru_cache
def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Read the CSV snapshots once (see scripts/fetch_data.py)."""
    fc = pd.read_csv(DATA / "forecasts.csv", parse_dates=["publishTime", "startTime"])
    ac = pd.read_csv(DATA / "actuals.csv", parse_dates=["startTime"])
    return fc, ac


def parse_cutoff(cutoff: str) -> time:
    """HH:MM (UTC). Timezone suffixes are rejected so the unit is never ambiguous."""
    try:
        t = time.fromisoformat(cutoff)
    except ValueError:
        raise HTTPException(422, "cutoff must be HH:MM (UTC)")
    if t.tzinfo is not None:
        raise HTTPException(422, "cutoff must be HH:MM (UTC) without a timezone suffix")
    return t


def days_between(start: date, end: date) -> list[date]:
    if start < JAN_START or end > JAN_END or start > end:
        raise HTTPException(422, "dates must satisfy 2026-01-01 <= start <= end <= 2026-01-31")
    return [d.date() for d in pd.date_range(start, end)]


def scored(days: list[date], cutoff: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Selected forecasts and the valid forecast/actual pairs for the given delivery days."""
    fc, ac = load()
    sel = core.latest_forecast_at_decision(fc, days, parse_cutoff(cutoff))
    return sel, core.join_forecast_actual(sel, ac)


def records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe list: ISO UTC timestamps, NaN -> null, MW rounded to 0.1."""
    d = df.copy()
    for c in ("startTime", "publishTime"):
        if c in d:
            d[c] = d[c].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    d = d.round(1).astype(object)
    return d.where(pd.notna(d), None).to_dict("records")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    """Where the data comes from and when the snapshot was taken."""
    try:
        return json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise HTTPException(503, "data snapshot metadata missing; run scripts/fetch_data.py")


@app.get("/api/forecast")
def forecast(day: date, cutoff: str = Query("09:00")):
    """The forecast known at decision time for one delivery day, with actuals alongside."""
    days = days_between(day, day)
    sel, df = scored(days, cutoff)
    fc, ac = load()
    decision = core.decision_time(day, parse_cutoff(cutoff))
    # The first forecast for this day that was published AFTER the decision time: it exists, but the
    # buyer did not have it. Shown to make "known at decision time" concrete.
    t0 = pd.Timestamp(day, tz="UTC")
    later = fc[(fc.startTime >= t0) & (fc.startTime < t0 + pd.Timedelta(days=1)) & (fc.publishTime > decision)]
    next_pub = later.publishTime.min() if len(later) else None
    return {
        "delivery_day": day,
        "cutoff_utc": cutoff,
        "decision_time": decision.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "next_publication": None if next_pub is None else next_pub.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "coverage": core.coverage(df, 1),
        # every selected forecast hour of the day, with or without a matching actual
        "forecast_hours": records(sel[["startTime", "publishTime", "generation", "horizon_h"]]),
        "points": records(df[["startTime", "publishTime", "horizon_h", "forecast", "actual", "error"]]),
        "half_hourly": records(core.half_hourly_view(ac, sel, day)),
    }


@app.get("/api/accuracy")
def accuracy(
    start: date = JAN_START,
    end: date = JAN_END,
    cutoff: str = Query("09:00"),
    threshold_mw: float = Query(2000, gt=0, le=20000),
):
    """Forecast-error statistics for decisions made for delivery days start..end."""
    days = days_between(start, end)
    _, df = scored(days, cutoff)
    daily = df.groupby(df.startTime.dt.strftime("%Y-%m-%d")).agg(mae=("abs_error", "mean"), bias=("error", "mean"))
    daily = daily.reset_index().rename(columns={"startTime": "day"})
    return {
        "cutoff_utc": cutoff,
        "coverage": core.coverage(df, len(days)),
        "metrics": core.error_metrics(df, threshold_mw),
        "by_hour_of_day": core.breakdown_by_hour_of_day(df),
        "daily": records(daily),
    }


@app.get("/api/baselines")
def baselines(start: date = JAN_START, end: date = JAN_END, cutoff: str = Query("09:00")):
    """The forecast vs two simple reference methods, scored on the same hours.
    The reference methods use no weather information and are NOT industry benchmarks."""
    days = days_between(start, end)
    c = parse_cutoff(cutoff)
    _, pairs = scored(days, cutoff)
    _, ac = load()
    hourly = context._hourly(ac)
    result = context.compare_to_baselines(pairs, {
        "same_hour_2d": context.same_hour_two_days_earlier(hourly, days),
        "persistence": context.last_known_actual_held_flat(hourly, days, c),
    })
    return {"cutoff_utc": cutoff, "coverage": core.coverage(pairs, len(days)), **result}


@lru_cache
def _sensitivity() -> dict:
    fc, ac = load()
    days = days_between(JAN_START, JAN_END)
    return context.cutoff_sensitivity(fc, ac, days, [time(h, 0) for h in range(24)])


@lru_cache
def _lead_time() -> dict:
    fc, ac = load()
    return context.error_by_lead_time(fc, ac, days_between(JAN_START, JAN_END))


@app.get("/api/lead-time")
def lead_time():
    """Forecast error vs lead time (hours between publication and the hour predicted), from every published
    forecast for every January delivery hour."""
    return _lead_time()


@app.get("/api/cutoff-sensitivity")
def cutoff_sensitivity():
    """Accuracy for each hourly decision time on D-1 (00:00-23:00 UTC), all of January, on common hours."""
    return _sensitivity()


# Docker/local single-container mode: serve the built React app from the same origin.
# (On Vercel the static files are served by the platform and this directory is absent.)
STATIC = Path(__file__).resolve().parent.parent / "static"
if STATIC.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=STATIC, html=True), name="ui")
