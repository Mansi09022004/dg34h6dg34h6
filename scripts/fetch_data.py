"""Download the Elexon wind data needed for January 2026 decisions.

Writes snapshots into backend/data/ so the app never depends on the Elexon API at
runtime (faster, reproducible, and the deployed demo keeps working if the API is down).

  actuals.csv    FUELHH, fuelType=WIND  (30-minute actual generation, MW; 29 Dec - 31 Jan)
  forecasts.csv  WINDFOR                (HOURLY forecasts, many publishTimes per target)
  meta.json      where/when the snapshot was fetched (shown in the UI)

Files are written atomically: if any request fails after its retries, the existing
snapshot is left untouched.

Usage:  python scripts/fetch_data.py
"""
import json
import os
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
OUT = Path(__file__).resolve().parent.parent / "backend" / "data"

# Delivery days: January 2026. A forecast for day D is published at most a few days
# earlier, but only forecasts published before the decision cutoff on D-1 matter, so
# fetching publications from mid-December covers every possible decision.
DELIVERY_FROM, DELIVERY_TO = date(2026, 1, 1), date(2026, 1, 31)
PUBLISH_FROM = date(2025, 12, 15)
# Actuals also start earlier than January: the "same hour two days earlier" reference method
# needs actuals from 29 Dec to score 1 Jan. These extra days are never scored as delivery days.
ACTUALS_FROM = date(2025, 12, 29)
PUBLISH_TO = date(2026, 2, 1)


def get(url: str, retries: int = 4) -> list[dict]:
    """GET JSON with exponential backoff; raises after the last attempt."""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)
        except Exception as exc:  # network error, HTTP 5xx/429, bad JSON
            if attempt == retries - 1:
                raise RuntimeError(f"Elexon request failed after {retries} tries: {url}") from exc
            time.sleep(2**attempt)


def chunks(start: date, end: date, days: int):
    """Yield [from, to) windows so each request stays small."""
    cur = start
    while cur < end:
        nxt = min(cur + timedelta(days=days), end)
        yield cur, nxt
        cur = nxt


def write_atomic(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # FUELHH takes settlementDateFrom/To (inclusive on both ends), so the last
    # window ends exactly on 31 Jan and nothing outside January is requested.
    rows = []
    start = ACTUALS_FROM
    while start <= DELIVERY_TO:
        end = min(start + timedelta(days=9), DELIVERY_TO)
        rows += get(f"{BASE}/FUELHH/stream?settlementDateFrom={start}&settlementDateTo={end}&fuelType=WIND")
        start = end + timedelta(days=1)
    act = pd.DataFrame(rows)
    assert set(act.fuelType) == {"WIND"}, "unexpected fuel type in response"
    act = act[["startTime", "settlementDate", "settlementPeriod", "generation"]]
    act = act.drop_duplicates("startTime").sort_values("startTime")

    rows = []
    for a, b in chunks(PUBLISH_FROM, PUBLISH_TO, 3):
        rows += get(f"{BASE}/WINDFOR/stream?publishDateTimeFrom={a}T00:00:00Z&publishDateTimeTo={b}T00:00:00Z")
    fc = pd.DataFrame(rows)[["publishTime", "startTime", "generation"]]
    fc = fc.drop_duplicates(["publishTime", "startTime"]).sort_values(["publishTime", "startTime"])

    meta = {
        "fetched_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "actuals": {"dataset": "FUELHH", "filter": "fuelType=WIND", "resolution": "30 min", "rows": len(act),
                    "first": act.startTime.min(), "last": act.startTime.max()},
        "forecasts": {"dataset": "WINDFOR", "resolution": "hourly", "rows": len(fc),
                      "first_publish": fc.publishTime.min(), "last_publish": fc.publishTime.max()},
        "source": "https://data.elexon.co.uk/bmrs/api/v1/datasets",
    }
    # Only write once everything above succeeded.
    write_atomic(OUT / "actuals.csv", act.to_csv(index=False))
    write_atomic(OUT / "forecasts.csv", fc.to_csv(index=False))
    write_atomic(OUT / "meta.json", json.dumps(meta, indent=2))
    print("actuals", act.shape, act.startTime.min(), act.startTime.max())
    print("forecasts", fc.shape, fc.publishTime.min(), fc.publishTime.max())


if __name__ == "__main__":
    main()
