"""Context for the headline accuracy number.

Two questions a reader asks right after "MAE = 2,142 MW":

1. Compared with what? -> `compare_to_baselines`: the forecast against two deliberately simple
   reference methods, scored on exactly the same hours.
2. Does the decision time matter? -> `cutoff_sensitivity`: the same accuracy measure for every
   hourly decision time, plus the "freshest forecast" limit.

Everything is computed from the Elexon data. The reference methods are NOT industry benchmarks;
they only answer "is the forecast better than something trivial that uses no weather information?".
Sign convention everywhere: error = prediction - actual (MW).
"""
from __future__ import annotations

from datetime import date, time

import numpy as np
import pandas as pd

from . import core

HOUR = pd.Timedelta(hours=1)


def _hourly(actuals: pd.DataFrame) -> pd.Series:
    """Valid hourly actuals indexed by hour start (both half-hours present, see core.hourly_actuals)."""
    h = core.hourly_actuals(actuals)
    return h.set_index("startTime").actual


def same_hour_two_days_earlier(hourly: pd.Series, delivery_days: list[date]) -> pd.DataFrame:
    """Reference method A: predict each hour with the actual of the same hour two days earlier.

    No look-ahead: the latest source hour is 23:00 on D-2, which ended at 00:00 on D-1, i.e. before
    any decision time on D-1. Hours whose source is missing are simply absent.
    """
    rows = []
    for day in delivery_days:
        t0 = pd.Timestamp(day, tz="UTC")
        for h in range(24):
            t = t0 + h * HOUR
            src = t - pd.Timedelta(days=2)
            if src in hourly.index:
                rows.append((t, float(hourly[src])))
    return pd.DataFrame(rows, columns=["startTime", "baseline"])


def last_known_actual_held_flat(hourly: pd.Series, delivery_days: list[date], cutoff: time) -> pd.DataFrame:
    """Reference method B (persistence): predict every hour of D with the most recent hourly actual
    that had completely finished at the decision time, held flat for the whole day.

    "Finished" means hour_start + 1h <= decision time. Assumes FUELHH values are available
    immediately after the hour ends (optimistic for this reference method).
    """
    rows = []
    for day in delivery_days:
        known = hourly[hourly.index + HOUR <= core.decision_time(day, cutoff)]
        if known.empty:
            continue
        v = float(known.iloc[-1])
        t0 = pd.Timestamp(day, tz="UTC")
        rows += [(t0 + h * HOUR, v) for h in range(24)]
    return pd.DataFrame(rows, columns=["startTime", "baseline"])


def _stats(err: pd.Series) -> dict:
    return {"mae": float(err.abs().mean()), "rmse": float(np.sqrt((err**2).mean())), "bias": float(err.mean())}


def compare_to_baselines(pairs: pd.DataFrame, baselines: dict[str, pd.DataFrame]) -> dict:
    """Score the forecast and each baseline on the hours where ALL of them have a prediction.

    `pairs` = core.join_forecast_actual output. skill_pct = (1 - MAE_forecast / MAE_baseline) * 100:
    the percentage by which the forecast's average miss is smaller (positive) or larger (negative).
    """
    common = set(pairs.startTime)
    for b in baselines.values():
        common &= set(b.startTime)
    df = pairs[pairs.startTime.isin(common)]
    if df.empty:
        return {"n": 0, "forecast": None, "baselines": []}
    out = {"n": int(len(df)), "forecast": _stats(df.forecast - df.actual), "baselines": []}
    for key, b in baselines.items():
        m = df.merge(b, on="startTime")
        s = _stats(m.baseline - m.actual)
        s["skill_pct"] = float((1 - out["forecast"]["mae"] / s["mae"]) * 100) if s["mae"] > 0 else None
        out["baselines"].append({"key": key, **s})
    return out


def freshest_forecast(forecasts: pd.DataFrame, delivery_days: list[date]) -> pd.DataFrame:
    """For each target hour the latest forecast published at or before the hour starts.
    This is NOT a day-ahead decision (it uses information from the delivery day itself); it is the
    best-case limit for 'what if we could wait'."""
    t0 = pd.Timestamp(min(delivery_days), tz="UTC")
    t1 = pd.Timestamp(max(delivery_days), tz="UTC") + pd.Timedelta(days=1)
    f = forecasts.dropna(subset=["generation"])
    f = f[(f.startTime >= t0) & (f.startTime < t1) & (f.publishTime <= f.startTime)]
    out = f.sort_values("publishTime").groupby("startTime", as_index=False).tail(1).sort_values("startTime").reset_index(drop=True)
    out["horizon_h"] = (out.startTime - out.publishTime).dt.total_seconds() / 3600
    return out[["startTime", "publishTime", "generation", "horizon_h"]]


def cutoff_sensitivity(forecasts: pd.DataFrame, actuals: pd.DataFrame, delivery_days: list[date], cutoffs: list[time]) -> dict:
    """Forecast accuracy for each candidate decision time (all on D-1).

    Only decision times that give EVERY delivery hour a forecast are charted. Earlier times (for example
    00:00-02:00 UTC, before the first forecast covering the late hours has been published) leave some hours
    without a forecast; they are listed in `excluded` with their own coverage instead of being scored on a
    smaller set of hours. All charted points, and the "freshest forecast" reference, are scored on the same
    hours, so the value at the headline decision time equals the headline accuracy.
    """
    per = {c: core.join_forecast_actual(core.latest_forecast_at_decision(forecasts, delivery_days, c), actuals) for c in cutoffs}
    fresh = core.join_forecast_actual(freshest_forecast(forecasts, delivery_days), actuals)
    most = max((len(df) for df in per.values()), default=0)
    included = [c for c in cutoffs if len(per[c]) == most]
    excluded = [{"cutoff": c.strftime("%H:%M"), "matched_hours": int(len(per[c]))} for c in cutoffs if c not in included]
    common = set.intersection(*[set(per[c].startTime) for c in included]) & set(fresh.startTime) if included else set()
    if not common:
        return {"common_hours": 0, "points": [], "excluded": excluded, "freshest": None}

    def row(df: pd.DataFrame) -> dict:
        sub = df[df.startTime.isin(common)]
        return {**_stats(sub.error), "mean_lead_h": float(sub.horizon_h.mean())}

    points = [{"cutoff": c.strftime("%H:%M"), "matched_hours": int(len(per[c])), **row(per[c])} for c in included]
    return {"common_hours": len(common), "points": points, "excluded": excluded, "freshest": {"matched_hours": int(len(fresh)), **row(fresh)}}


def error_by_lead_time(forecasts: pd.DataFrame, actuals: pd.DataFrame, delivery_days: list[date], bucket_h: int = 6) -> dict:
    """Forecast error against lead time, using EVERY published forecast for every delivery hour.

    Lead time = startTime - publishTime (hours). Each (target hour, publication) pair with a valid actual is
    one observation, so every lead-time bucket draws on the same target hours and the curve is not mixed up with
    the hour of day (unlike taking the single forecast selected at one fixed decision time). Publications made
    after the hour has started (negative lead time) are ignored.
    """
    t0 = pd.Timestamp(min(delivery_days), tz="UTC")
    t1 = pd.Timestamp(max(delivery_days), tz="UTC") + pd.Timedelta(days=1)
    f = forecasts.dropna(subset=["generation"])
    f = f[(f.startTime >= t0) & (f.startTime < t1)].copy()
    f["lead_h"] = (f.startTime - f.publishTime).dt.total_seconds() / 3600
    f = f[f.lead_h >= 0]
    d = f.merge(core.hourly_actuals(actuals), on="startTime")
    if d.empty:
        return {"bucket_h": bucket_h, "target_hours": 0, "forecasts": 0, "points": []}
    d["error"] = d.generation - d.actual
    d["bucket"] = (d.lead_h // bucket_h * bucket_h).astype(int)
    pts = []
    for b, g in d.groupby("bucket"):
        pts.append({"from_h": int(b), "to_h": int(b) + bucket_h, "n": int(len(g)), "hours": int(g.startTime.nunique()), **_stats(g.error)})
    return {"bucket_h": bucket_h, "target_hours": int(d.startTime.nunique()), "forecasts": int(len(d)), "points": pts}
