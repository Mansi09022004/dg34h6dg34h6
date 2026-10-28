"""Unit tests for forecast selection, timestamp alignment, missing data and metrics.
Every test uses tiny hand-made data with an answer worked out by hand."""
from datetime import date, time
from math import isclose, sqrt

import numpy as np
import pandas as pd

from app import core


def T(s):
    return pd.Timestamp(s, tz="UTC")


def fc(rows):
    """rows: (publishTime, startTime, generation)"""
    df = pd.DataFrame(rows, columns=["publishTime", "startTime", "generation"])
    df["publishTime"] = df.publishTime.map(T)
    df["startTime"] = df.startTime.map(T)
    return df


def act(rows):
    """rows: (startTime, generation) at 30-minute resolution"""
    df = pd.DataFrame(rows, columns=["startTime", "generation"])
    df["startTime"] = df.startTime.map(T)
    return df


# ---------- forecast selection ----------

def test_picks_latest_publish_not_after_cutoff():
    f = fc([
        ("2026-01-13 20:00", "2026-01-15 10:00", 100),
        ("2026-01-14 07:30", "2026-01-15 10:00", 200),   # expected
        ("2026-01-14 09:25", "2026-01-15 10:00", 300),   # after the 09:00 cutoff -> must be ignored
    ])
    out = core.latest_forecast_at_decision(f, [date(2026, 1, 15)])
    assert out.generation.tolist() == [200]
    assert (out.publishTime <= core.decision_time(date(2026, 1, 15))).all()


def test_cutoff_is_inclusive_and_configurable():
    f = fc([("2026-01-14 09:00", "2026-01-15 10:00", 1), ("2026-01-14 09:25", "2026-01-15 10:00", 2)])
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 15)]).generation.tolist() == [1]
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 15)], time(9, 30)).generation.tolist() == [2]


def test_one_minute_after_cutoff_is_excluded():
    f = fc([("2026-01-14 08:59", "2026-01-15 10:00", 1), ("2026-01-14 09:01", "2026-01-15 10:00", 2)])
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 15)]).generation.tolist() == [1]


def test_no_eligible_forecast_means_no_row_and_no_backfill():
    f = fc([("2026-01-14 12:00", "2026-01-15 10:00", 5)])
    out = core.latest_forecast_at_decision(f, [date(2026, 1, 15)])
    assert out.empty and list(out.columns) == ["startTime", "publishTime", "generation", "horizon_h"]


def test_missing_forecast_value_falls_back_to_older_valid_one():
    f = fc([("2026-01-14 04:30", "2026-01-15 10:00", 111), ("2026-01-14 07:30", "2026-01-15 10:00", np.nan)])
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 15)]).generation.tolist() == [111]


def test_horizon_is_hours_between_publish_and_target():
    f = fc([("2026-01-14 07:30", "2026-01-15 10:00", 1)])
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 15)]).horizon_h.tolist() == [26.5]


def test_only_targets_inside_the_delivery_day_are_selected():
    f = fc([("2026-01-14 07:30", "2026-01-14 23:00", 1),   # previous day
            ("2026-01-14 07:30", "2026-01-15 00:00", 2),   # first hour of the day
            ("2026-01-14 07:30", "2026-01-15 23:00", 3),   # last hour of the day
            ("2026-01-14 07:30", "2026-01-16 00:00", 4)])  # next day
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 15)]).generation.tolist() == [2, 3]


# ---------- January boundaries and timezone ----------

def test_decision_time_is_utc_and_on_previous_day():
    t = core.decision_time(date(2026, 1, 1))
    assert str(t) == "2025-12-31 09:00:00+00:00"            # Jan 1 decisions are taken in December
    assert str(core.decision_time(date(2026, 1, 31), time(6, 30))) == "2026-01-30 06:30:00+00:00"


def test_first_day_of_january_uses_december_publications():
    f = fc([("2025-12-31 08:59", "2026-01-01 00:00", 10), ("2025-12-31 09:01", "2026-01-01 00:00", 20)])
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 1)]).generation.tolist() == [10]


def test_last_day_of_january_excludes_february_targets():
    f = fc([("2026-01-30 07:30", "2026-01-31 23:00", 1), ("2026-01-30 07:30", "2026-02-01 00:00", 2)])
    assert core.latest_forecast_at_decision(f, [date(2026, 1, 31)]).generation.tolist() == [1]


def test_multiple_days_use_their_own_decision_time():
    f = fc([("2026-01-14 07:30", "2026-01-15 10:00", 1), ("2026-01-15 07:30", "2026-01-16 10:00", 2),
            ("2026-01-15 07:30", "2026-01-15 11:00", 9)])  # published on the 15th: too late for the 15th
    out = core.latest_forecast_at_decision(f, [date(2026, 1, 15), date(2026, 1, 16)])
    assert out.generation.tolist() == [1, 2]


# ---------- alignment of hourly forecast and 30-minute actuals ----------

def test_actuals_averaged_to_hour_and_error_sign():
    a = act([("2026-01-15 10:00", 100), ("2026-01-15 10:30", 200)])
    f = fc([("2026-01-14 07:00", "2026-01-15 10:00", 180)])
    df = core.join_forecast_actual(core.latest_forecast_at_decision(f, [date(2026, 1, 15)]), a)
    assert df.actual.iloc[0] == 150 and df.error.iloc[0] == 30     # forecast above actual => positive
    m = core.error_metrics(df)
    assert m["mae"] == 30 and m["bias"] == 30 and m["rmse"] == 30


def test_half_hour_belongs_to_its_own_hour():
    # 10:30 must be averaged with 10:00, not with 11:00
    a = act([("2026-01-15 10:00", 100), ("2026-01-15 10:30", 300), ("2026-01-15 11:00", 500), ("2026-01-15 11:30", 700)])
    h = core.hourly_actuals(a).set_index("startTime").actual
    assert h[T("2026-01-15 10:00")] == 200 and h[T("2026-01-15 11:00")] == 600


def test_hour_with_one_half_hour_missing_is_dropped_not_guessed():
    a = act([("2026-01-15 10:00", 100), ("2026-01-15 11:00", 500), ("2026-01-15 11:30", 700)])
    assert core.hourly_actuals(a).startTime.tolist() == [T("2026-01-15 11:00")]


def test_nan_actual_is_not_treated_as_zero():
    a = act([("2026-01-15 10:00", 100), ("2026-01-15 10:30", np.nan)])
    f = fc([("2026-01-14 07:00", "2026-01-15 10:00", 180)])
    df = core.join_forecast_actual(core.latest_forecast_at_decision(f, [date(2026, 1, 15)]), a)
    assert df.empty and core.error_metrics(df) == {"n": 0}


def test_forecast_without_actual_is_not_scored():
    a = act([("2026-01-15 10:00", 100), ("2026-01-15 10:30", 100)])
    f = fc([("2026-01-14 07:00", "2026-01-15 10:00", 110), ("2026-01-14 07:00", "2026-01-15 11:00", 999)])
    df = core.join_forecast_actual(core.latest_forecast_at_decision(f, [date(2026, 1, 15)]), a)
    assert df.startTime.tolist() == [T("2026-01-15 10:00")]
    assert core.coverage(df, 1) == {"expected_hours": 24, "matched_hours": 1, "missing_hours": 23}


# ---------- metrics with known answers ----------

def pairs(errors, actual=1000.0):
    return pd.DataFrame({
        "startTime": pd.date_range("2026-01-15", periods=len(errors), freq="h", tz="UTC"),
        "horizon_h": [20.0] * len(errors), "forecast": [actual + e for e in errors], "actual": actual,
        "error": [float(e) for e in errors], "abs_error": [abs(float(e)) for e in errors]})


def test_metrics_known_values():
    m = core.error_metrics(pairs([100, -200, 300, -400]), threshold_mw=250)
    assert m["n"] == 4
    assert m["mae"] == 250                                  # (100+200+300+400)/4
    assert isclose(m["rmse"], sqrt(75000))                  # sqrt((1e4+4e4+9e4+16e4)/4)
    assert m["bias"] == -50                                 # (100-200+300-400)/4
    assert m["mae_pct_of_mean_actual"] == 25                # 250 / 1000
    assert m["max_abs_error"] == 400
    assert m["p50_abs_error"] == 250
    assert isclose(m["p90_abs_error"], 370)                 # linear interpolation: 300 + 0.7*100
    assert m["pct_within_threshold"] == 50                  # |100|, |200| are <= 250


def test_threshold_is_inclusive():
    assert core.error_metrics(pairs([250, 251]), threshold_mw=250)["pct_within_threshold"] == 50


def test_mae_percentage_is_none_when_mean_actual_is_zero():
    m = core.error_metrics(pairs([10, -10], actual=0.0))
    assert m["mae_pct_of_mean_actual"] is None and m["mae"] == 10


def test_breakdown_by_hour_of_day():
    out = core.breakdown_by_hour_of_day(pairs([100, -300]))          # hours 00 and 01
    assert out == [{"hour": 0, "mae": 100.0, "bias": 100.0}, {"hour": 1, "mae": 300.0, "bias": -300.0}]


# ---------- 30-minute inspection view ----------

def test_half_hourly_view_keeps_original_30_minute_actuals():
    a = act([("2026-01-15 10:00", 100), ("2026-01-15 10:30", 300), ("2026-01-16 00:00", 5)])
    a["settlementPeriod"] = [21, 22, 1]
    sel = core.latest_forecast_at_decision(fc([("2026-01-14 07:00", "2026-01-15 10:00", 180)]), [date(2026, 1, 15)])
    v = core.half_hourly_view(a, sel, date(2026, 1, 15))
    assert v.actual_30min.tolist() == [100, 300]                 # 16 Jan row excluded, no averaging
    assert v.forecast_for_hour.tolist() == [180, 180]            # same hourly forecast covers both
    assert "error" not in v.columns                              # no per-half-hour error vs an hourly forecast
