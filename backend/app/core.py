"""Core domain logic: pick the forecast known at decision time, and score it.

Kept free of any web-framework code so it is easy to unit test.

Data facts (verified against the live Elexon API, see README):
  * FUELHH (actuals)  : one value per 30-minute period, MW = average power in that period.
  * WINDFOR (forecast): one value per HOUR (startTime always on the hour), many publishTimes.
All timestamps are UTC. In January the UK is on GMT (== UTC), so no DST handling is needed.
"""
from __future__ import annotations

from datetime import date, time

import numpy as np
import pandas as pd

# ASSUMPTION (not a verified official market deadline): the buyer decides at 09:00 on the
# day before delivery (D-1). The assignment does not give a cutoff, so this is a default
# that the caller/UI can change.
DEFAULT_CUTOFF = time(9, 0)


def decision_time(delivery_day: date, cutoff: time = DEFAULT_CUTOFF) -> pd.Timestamp:
    """The assumed decision moment: `cutoff` (UTC) on the day before delivery."""
    return pd.Timestamp(delivery_day, tz="UTC") - pd.Timedelta(days=1) + pd.Timedelta(
        hours=cutoff.hour, minutes=cutoff.minute
    )


def latest_forecast_at_decision(
    forecasts: pd.DataFrame, delivery_days: list[date], cutoff: time = DEFAULT_CUTOFF
) -> pd.DataFrame:
    """For every target hour of each delivery day, keep the forecast with the
    greatest `publishTime` that is <= the decision time of that day.

    Input columns : publishTime, startTime, generation  (UTC timestamps)
    Output columns: startTime, publishTime, generation, horizon_h

    Guarantees:
      * a forecast published after the decision time is never used (inclusive at the cutoff);
      * target hours with no eligible forecast are absent (never back-filled with a later
        forecast, which would leak information the buyer did not have);
      * forecasts with missing `generation` are ignored, so an older valid forecast can be
        used instead of a blank one.
    """
    cols = ["startTime", "publishTime", "generation", "horizon_h"]
    valid = forecasts.dropna(subset=["generation"])
    # Vectorised: each target hour belongs to one delivery day D (its UTC date), and its
    # decision time is `cutoff` on D-1. Keep rows of the requested days published at or before it.
    days = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC") for d in delivery_days])
    day_of = valid.startTime.dt.floor("D")
    in_days = valid[day_of.isin(days)]
    decision = in_days.startTime.dt.floor("D") - pd.Timedelta(days=1) + pd.Timedelta(hours=cutoff.hour, minutes=cutoff.minute)
    known = in_days[in_days.publishTime <= decision]
    out = known.sort_values("publishTime").groupby("startTime", as_index=False).tail(1)
    out = out.sort_values("startTime").reset_index(drop=True)
    out["horizon_h"] = (out.startTime - out.publishTime).dt.total_seconds() / 3600
    return out[cols]


def hourly_actuals(actuals: pd.DataFrame) -> pd.DataFrame:
    """Average the two 30-minute FUELHH values of each hour into one hourly value.

    MW is average power, so the mean of the two half-hours is the hour's average output.
    An hour is only produced when BOTH half-hours are present and non-missing; a lone
    half-hour is dropped rather than silently treated as the whole hour.
    This puts actuals on the same hourly grid as the hourly WINDFOR forecast.
    """
    a = actuals.dropna(subset=["generation"]).copy()
    a["hour"] = a.startTime.dt.floor("h")
    g = a.groupby("hour").generation.agg(["mean", "count"])
    g = g[g["count"] == 2]
    return g["mean"].rename("actual").rename_axis("startTime").reset_index()


def join_forecast_actual(selected: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Inner-join selected forecasts with hourly actuals (valid pairs only) and add errors.
    error = forecast - actual  (positive => forecast above actual)."""
    df = selected.rename(columns={"generation": "forecast"}).merge(hourly_actuals(actuals), on="startTime")
    df["error"] = df.forecast - df.actual
    df["abs_error"] = df.error.abs()
    return df


def error_metrics(df: pd.DataFrame, threshold_mw: float = 2000.0) -> dict:
    """Accuracy numbers, all in MW unless noted. Sign convention: error = forecast - actual."""
    if df.empty:
        return {"n": 0}
    e, ae = df.error, df.abs_error
    mean_actual = float(df.actual.mean())
    return {
        "n": int(len(df)),
        "mae": float(ae.mean()),
        "rmse": float(np.sqrt((e**2).mean())),
        "bias": float(e.mean()),
        # None (not a number) when the mean actual is not positive, to avoid a divide-by-zero.
        "mae_pct_of_mean_actual": float(ae.mean() / mean_actual * 100) if mean_actual > 0 else None,
        "mean_actual": mean_actual,
        "p50_abs_error": float(ae.quantile(0.5)),
        "p90_abs_error": float(ae.quantile(0.9)),
        "p95_abs_error": float(ae.quantile(0.95)),
        "max_abs_error": float(ae.max()),
        "threshold_mw": float(threshold_mw),
        "pct_within_threshold": float((ae <= threshold_mw).mean() * 100),
        # Signed forecast-error band: 80% of hours fall between these two values.
        "error_p10": float(e.quantile(0.1)),
        "error_p90": float(e.quantile(0.9)),
    }


def coverage(df: pd.DataFrame, n_days: int) -> dict:
    """How many hourly delivery periods have a valid forecast-actual pair."""
    expected = n_days * 24
    return {"expected_hours": expected, "matched_hours": int(len(df)), "missing_hours": expected - int(len(df))}


def breakdown_by_hour_of_day(df: pd.DataFrame) -> list[dict]:
    g = df.groupby(df.startTime.dt.hour).agg(mae=("abs_error", "mean"), bias=("error", "mean"))
    return [{"hour": int(h), "mae": float(r.mae), "bias": float(r.bias)} for h, r in g.iterrows()]


def half_hourly_view(actuals: pd.DataFrame, selected: pd.DataFrame, day: date) -> pd.DataFrame:
    """The original 30-minute actuals of one delivery day next to the hourly forecast
    that covers each period. For inspection only: errors are NOT computed per half-hour,
    because the forecast is hourly."""
    t0 = pd.Timestamp(day, tz="UTC")
    a = actuals[(actuals.startTime >= t0) & (actuals.startTime < t0 + pd.Timedelta(days=1))].copy()
    a["hour"] = a.startTime.dt.floor("h")
    f = selected.rename(columns={"startTime": "hour", "generation": "forecast_for_hour"})[["hour", "forecast_for_hour", "publishTime"]]
    out = a.merge(f, on="hour", how="left").rename(columns={"generation": "actual_30min"})
    return out[["startTime", "settlementPeriod", "actual_30min", "forecast_for_hour", "publishTime"]].sort_values("startTime")
