"""End-to-end API tests against the real January 2026 snapshot in backend/data/."""
import warnings

import pandas as pd
import pytest

warnings.filterwarnings("ignore")
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_and_meta():
    assert client.get("/api/health").json() == {"ok": True}
    m = client.get("/api/meta").json()
    assert m["actuals"]["dataset"] == "FUELHH" and m["actuals"]["filter"] == "fuelType=WIND"
    assert m["actuals"]["resolution"] == "30 min" and m["forecasts"]["resolution"] == "hourly"


def test_forecast_endpoint_basic_shape():
    r = client.get("/api/forecast", params={"day": "2026-01-15", "cutoff": "09:00"}).json()
    assert r["decision_time"] == "2026-01-14T09:00:00Z"
    assert len(r["points"]) == 24 and len(r["half_hourly"]) == 48
    assert r["coverage"] == {"expected_hours": 24, "matched_hours": 24, "missing_hours": 0}


@pytest.mark.parametrize("cutoff", ["00:00", "06:00", "09:00", "12:00", "23:59"])
def test_no_forecast_published_after_cutoff_for_any_january_day(cutoff):
    """The key promise: across every delivery day, nothing published after the cutoff is used."""
    for day in pd.date_range("2026-01-01", "2026-01-31"):
        r = client.get("/api/forecast", params={"day": day.date().isoformat(), "cutoff": cutoff}).json()
        for p in r["points"]:
            assert p["publishTime"] <= r["decision_time"], (day, p)
            assert p["startTime"][:10] == day.date().isoformat()


def test_early_cutoff_reports_missing_hours_instead_of_hiding_them():
    r = client.get("/api/accuracy", params={"cutoff": "00:00"}).json()
    assert r["coverage"]["missing_hours"] > 0
    assert r["coverage"]["matched_hours"] + r["coverage"]["missing_hours"] == 744


def test_accuracy_full_month_is_consistent_with_its_own_points():
    r = client.get("/api/accuracy", params={"cutoff": "09:00", "threshold_mw": 2000}).json()
    assert r["coverage"] == {"expected_hours": 744, "matched_hours": 744, "missing_hours": 0}
    m = r["metrics"]
    assert m["n"] == 744 and m["mae"] > 0 and m["rmse"] >= m["mae"]            # RMSE >= MAE always
    # recompute MAE and bias independently from the per-day endpoint
    pts = []
    for d in pd.date_range("2026-01-01", "2026-01-31"):
        pts += client.get("/api/forecast", params={"day": d.date().isoformat()}).json()["points"]
    assert len(pts) == 744
    err = pd.Series([p["error"] for p in pts])
    assert abs(err.abs().mean() - m["mae"]) < 1                                  # points are rounded to 0.1 MW
    assert abs(err.mean() - m["bias"]) < 1
    assert abs((err.abs() <= 2000).mean() * 100 - m["pct_within_threshold"]) < 0.5
    assert len(r["daily"]) == 31


@pytest.mark.parametrize("params", [
    {"day": "2025-12-31"}, {"day": "2026-02-01"}, {"day": "2026-01-15", "cutoff": "9am"},
    {"day": "2026-01-15", "cutoff": "09:00+01:00"}, {"day": "not-a-date"},
])
def test_bad_forecast_inputs_are_rejected(params):
    assert client.get("/api/forecast", params=params).status_code == 422


@pytest.mark.parametrize("params", [
    {"start": "2026-01-10", "end": "2026-01-09"}, {"end": "2026-02-01"}, {"start": "2025-12-31"},
    {"threshold_mw": 0}, {"threshold_mw": -5},
])
def test_bad_accuracy_inputs_are_rejected(params):
    assert client.get("/api/accuracy", params=params).status_code == 422


def test_forecast_hours_and_next_publication():
    r = client.get("/api/forecast", params={"day": "2026-01-15", "cutoff": "09:00"}).json()
    hours = r["forecast_hours"]
    assert len(hours) == 24 and all(h["publishTime"] <= r["decision_time"] for h in hours)
    assert {p["startTime"] for p in r["points"]} <= {h["startTime"] for h in hours}   # pairs are a subset
    nxt = r["next_publication"]
    assert nxt is not None and nxt > r["decision_time"]                              # a newer forecast exists...
    assert nxt not in {h["publishTime"] for h in hours}                               # ...but was not used


def test_forecast_hours_present_even_without_actuals_pairing():
    r = client.get("/api/forecast", params={"day": "2026-01-15", "cutoff": "00:00"}).json()
    assert len(r["forecast_hours"]) >= len(r["points"])
