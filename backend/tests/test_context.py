"""Tests for the reference methods and the decision-time sensitivity. Hand-made data, hand-worked answers."""
import warnings
from datetime import date, time

import pandas as pd
import pytest

from app import context, core

warnings.filterwarnings("ignore")


def T(s):
    return pd.Timestamp(s, tz="UTC")


def hourly(rows):
    """rows: (hour start, MW) -> Series indexed by hour start"""
    return pd.Series({T(t): v for t, v in rows}, dtype=float)


# ---------- reference method A: same hour two days earlier ----------

def test_same_hour_two_days_earlier_uses_the_right_source_hour():
    h = hourly([("2026-01-01 10:00", 111), ("2026-01-01 11:00", 222)])
    b = context.same_hour_two_days_earlier(h, [date(2026, 1, 3)]).set_index("startTime").baseline
    assert b[T("2026-01-03 10:00")] == 111 and b[T("2026-01-03 11:00")] == 222
    assert len(b) == 2                                   # hours without a source hour are absent, not zero


def test_same_hour_two_days_earlier_needs_late_december_for_1_january():
    h = hourly([("2025-12-30 05:00", 90)])
    b = context.same_hour_two_days_earlier(h, [date(2026, 1, 1)])
    assert b.startTime.tolist() == [T("2026-01-01 05:00")] and b.baseline.tolist() == [90]


# ---------- reference method B: last known actual, held flat (no look-ahead) ----------

def test_persistence_uses_only_hours_that_finished_by_the_decision_time():
    h = hourly([("2026-01-14 07:00", 70), ("2026-01-14 08:00", 80), ("2026-01-14 09:00", 90)])
    # decision 09:00: the 08:00 hour ended at 09:00 (<= decision) so it is known; the 09:00 hour is not
    b = context.last_known_actual_held_flat(h, [date(2026, 1, 15)], time(9, 0))
    assert set(b.baseline) == {80.0} and len(b) == 24
    # one minute earlier the 08:00 hour has not finished, so 07:00 is the latest known hour
    b = context.last_known_actual_held_flat(h, [date(2026, 1, 15)], time(8, 59))
    assert set(b.baseline) == {70.0}


def test_persistence_skips_days_with_no_known_actual():
    h = hourly([("2026-01-20 00:00", 5)])
    assert context.last_known_actual_held_flat(h, [date(2026, 1, 15)], time(9, 0)).empty


# ---------- scoring against the references ----------

def pairs(forecast, actual):
    idx = pd.date_range("2026-01-15 10:00", periods=len(actual), freq="h", tz="UTC")
    df = pd.DataFrame({"startTime": idx, "horizon_h": 20.0, "forecast": forecast, "actual": actual})
    df["error"] = df.forecast - df.actual
    df["abs_error"] = df.error.abs()
    return df


def test_compare_to_baselines_known_values():
    p = pairs([110, 190], [100, 200])                                      # errors +10, -10 -> MAE 10
    b = pd.DataFrame({"startTime": p.startTime, "baseline": [150.0, 150.0]})  # errors +50, -50 -> MAE 50
    r = context.compare_to_baselines(p, {"ref": b})
    assert r["n"] == 2 and r["forecast"]["mae"] == 10 and r["forecast"]["bias"] == 0
    assert r["baselines"][0]["mae"] == 50 and r["baselines"][0]["skill_pct"] == 80   # 1 - 10/50


def test_compare_scores_only_hours_every_method_has():
    p = pairs([110, 190], [100, 200])
    b = pd.DataFrame({"startTime": [p.startTime[0]], "baseline": [150.0]})   # second hour missing
    r = context.compare_to_baselines(p, {"ref": b})
    assert r["n"] == 1 and r["forecast"]["mae"] == 10 and r["baselines"][0]["mae"] == 50


def test_negative_skill_when_the_forecast_is_worse():
    p = pairs([100], [200])                                                  # MAE 100
    b = pd.DataFrame({"startTime": p.startTime, "baseline": [150.0]})        # MAE 50
    assert context.compare_to_baselines(p, {"r": b})["baselines"][0]["skill_pct"] == -100


# ---------- decision-time sensitivity ----------

def sens_data():
    f = pd.DataFrame(
        [("2026-01-14 07:30", "2026-01-15 10:00", 100),    # available at both cutoffs
         ("2026-01-14 12:30", "2026-01-15 10:00", 140),    # only before the 13:00 cutoff
         ("2026-01-15 09:30", "2026-01-15 10:00", 148),    # published on the delivery day: freshest only
         ("2026-01-14 12:30", "2026-01-15 11:00", 150)],   # 11:00 has a forecast only under the 13:00 cutoff
        columns=["publishTime", "startTime", "generation"])
    f["publishTime"] = f.publishTime.map(T)
    f["startTime"] = f.startTime.map(T)
    a = pd.DataFrame({"startTime": [T("2026-01-15 10:00"), T("2026-01-15 10:30"), T("2026-01-15 11:00"), T("2026-01-15 11:30")],
                      "generation": [150.0] * 4})
    return f, a


def test_cutoff_sensitivity_charts_only_cutoffs_that_cover_every_hour():
    f, a = sens_data()
    r = context.cutoff_sensitivity(f, a, [date(2026, 1, 15)], [time(9, 0), time(13, 0)])
    # 09:00 has a forecast for only one of the two hours; it is listed as excluded, not scored on fewer hours
    assert r["excluded"] == [{"cutoff": "09:00", "matched_hours": 1}]
    assert [p["cutoff"] for p in r["points"]] == ["13:00"] and r["common_hours"] == 2
    late = r["points"][0]
    assert late["matched_hours"] == 2
    assert late["mae"] == 5 and late["bias"] == -5                          # errors -10 (10:00) and 0 (11:00)
    assert late["mean_lead_h"] == 22.0                                      # 21.5 h and 22.5 h
    assert r["freshest"]["mae"] == 1 and r["freshest"]["bias"] == -1        # |148-150| = 2 and 0
    assert r["freshest"]["mean_lead_h"] == 11.5                             # 0.5 h and 22.5 h


def test_cutoff_sensitivity_keeps_cutoffs_with_the_same_full_coverage_together():
    f, a = sens_data()
    r = context.cutoff_sensitivity(f, a, [date(2026, 1, 15)], [time(13, 0), time(14, 0)])
    assert r["excluded"] == [] and [p["cutoff"] for p in r["points"]] == ["13:00", "14:00"]


def test_cutoff_sensitivity_handles_no_common_hours():
    f, a = sens_data()
    assert context.cutoff_sensitivity(f.iloc[0:0], a, [date(2026, 1, 15)], [time(9, 0)]) == {"common_hours": 0, "points": [], "excluded": [], "freshest": None}


# ---------- error vs lead time (every publication) ----------

def lead_data():
    f = pd.DataFrame(
        [("2026-01-15 09:00", "2026-01-15 10:00", 120),   # lead 1 h   -> error +20
         ("2026-01-14 21:00", "2026-01-15 10:00", 130),   # lead 13 h  -> +30
         ("2026-01-14 03:00", "2026-01-15 10:00", 160),   # lead 31 h  -> +60
         ("2026-01-15 10:30", "2026-01-15 10:00", 999),   # published after the hour started: ignored
         ("2026-01-15 10:00", "2026-01-15 11:00", 90)],    # lead 1 h   -> -10
        columns=["publishTime", "startTime", "generation"])
    f["publishTime"] = f.publishTime.map(T)
    f["startTime"] = f.startTime.map(T)
    a = pd.DataFrame({"startTime": [T("2026-01-15 10:00"), T("2026-01-15 10:30"), T("2026-01-15 11:00"), T("2026-01-15 11:30")], "generation": [100.0] * 4})
    return f, a


def test_error_by_lead_time_uses_every_publication_and_groups_by_lead():
    f, a = lead_data()
    r = context.error_by_lead_time(f, a, [date(2026, 1, 15)], bucket_h=12)
    assert r["target_hours"] == 2 and r["forecasts"] == 4                    # the 999 forecast (negative lead) is dropped
    p0, p12, p24 = r["points"]
    assert (p0["from_h"], p0["to_h"], p0["n"], p0["hours"]) == (0, 12, 2, 2)
    assert p0["mae"] == 15 and p0["bias"] == 5                               # errors +20 and -10
    assert (p12["from_h"], p12["n"], p12["mae"]) == (12, 1, 30)
    assert (p24["from_h"], p24["n"], p24["mae"]) == (24, 1, 60)


def test_error_by_lead_time_ignores_hours_without_an_actual():
    f, a = lead_data()
    r = context.error_by_lead_time(f, a.iloc[:2], [date(2026, 1, 15)], bucket_h=12)   # actuals for 10:00 only
    assert r["target_hours"] == 1 and r["forecasts"] == 3


def test_error_by_lead_time_empty():
    f, a = lead_data()
    assert context.error_by_lead_time(f.iloc[0:0], a, [date(2026, 1, 15)])["points"] == []


def test_freshest_forecast_never_uses_a_forecast_published_after_the_hour_starts():
    f = pd.DataFrame([("2026-01-15 09:59", "2026-01-15 10:00", 1), ("2026-01-15 10:01", "2026-01-15 10:00", 2)],
                     columns=["publishTime", "startTime", "generation"])
    f["publishTime"] = f.publishTime.map(T)
    f["startTime"] = f.startTime.map(T)
    assert context.freshest_forecast(f, [date(2026, 1, 15)]).generation.tolist() == [1]


# ---------- API on the real snapshot ----------

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def test_baselines_endpoint_matches_headline_forecast_numbers():
    r = client.get("/api/baselines", params={"cutoff": "09:00"}).json()
    acc = client.get("/api/accuracy", params={"cutoff": "09:00"}).json()["metrics"]
    assert r["n"] == 744 and abs(r["forecast"]["mae"] - acc["mae"]) < 1e-6    # same hours, same number
    assert [b["key"] for b in r["baselines"]] == ["same_hour_2d", "persistence"]
    for b in r["baselines"]:                                                 # skill_pct is exactly 1 - MAE ratio
        assert abs(b["skill_pct"] - (1 - r["forecast"]["mae"] / b["mae"]) * 100) < 1e-9


def test_baselines_cover_1_january_thanks_to_late_december_actuals():
    r = client.get("/api/baselines", params={"start": "2026-01-01", "end": "2026-01-01"}).json()
    assert r["n"] == 24


def test_cutoff_sensitivity_endpoint_matches_the_headline_number():
    r = client.get("/api/cutoff-sensitivity").json()
    cutoffs = [p["cutoff"] for p in r["points"]]
    assert cutoffs == sorted(cutoffs) and "09:00" in cutoffs
    assert r["common_hours"] == 744 and all(p["matched_hours"] == 744 for p in r["points"])
    assert all(e["matched_hours"] < 744 for e in r["excluded"])               # excluded cutoffs lack some hours
    acc = client.get("/api/accuracy", params={"cutoff": "09:00"}).json()["metrics"]
    p09 = next(p for p in r["points"] if p["cutoff"] == "09:00")
    assert abs(p09["mae"] - acc["mae"]) < 1e-6 and acc["n"] == 744            # same hours, same number
    assert r["freshest"]["mean_lead_h"] < 6


def test_lead_time_endpoint_shape_and_balance():
    r = client.get("/api/lead-time").json()
    pts = r["points"]
    assert r["target_hours"] == 744 and r["forecasts"] == sum(p["n"] for p in pts)
    assert [p["from_h"] for p in pts] == sorted(p["from_h"] for p in pts)
    assert pts[0]["from_h"] == 0 and all(p["to_h"] - p["from_h"] == r["bucket_h"] for p in pts)
    full = [p for p in pts if p["hours"] == r["target_hours"]]
    assert len(full) >= 4                                                    # several buckets cover all 744 hours
    assert all(p["mae"] > 0 and p["n"] >= p["hours"] for p in pts)
