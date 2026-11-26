"""Publish a market-wide date snapshot. No portfolio symbols are sent to Nasdaq."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


def events_for(day):
    key = day.isoformat()
    request = Request("https://api.nasdaq.com/api/calendar/earnings?date=" + key,
                      headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.load(response)
            return parse_events(payload, day)
        except (URLError, OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(1 + 2 * attempt)


def parse_events(payload, day):
    status = payload.get("status") or {}
    if status.get("rCode") != 200:
        raise ValueError(f"Invalid earnings response for {day}")
    data = payload.get("data")
    if not data and any(err.get("code") == 1002 and "no record" in str(err.get("errorMessage")).lower()
                        for err in status.get("bCodeMessage") or []):
        return []
    if (not isinstance(data, dict) or "rows" not in data or
            datetime.strptime(data.get("asOf", ""), "%a, %b %d, %Y").date() != day):
        raise ValueError(f"Unexpected earnings date for {day}")
    events = {}
    for row in data["rows"] or []:
        symbol = str(row.get("symbol", "")).strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,11}", symbol):
            continue
        timing = {"time-pre-market": "before", "time-after-hours": "after"}.get(row.get("time"), "unknown")
        events[symbol] = {"symbol": symbol, "date": day.isoformat(), "timing": timing, "estimated": True,
                          "source": "Nasdaq", "url": "https://www.nasdaq.com/market-activity/earnings?date=" + day.isoformat()}
    return list(events.values())


def main(path):
    today = datetime.now(ZoneInfo("America/New_York")).date()
    start, end = today - timedelta(days=32), today + timedelta(days=70)
    days = [start + timedelta(days=i) for i in range((end-start).days+1)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        events = [event for batch in pool.map(events_for, days) for event in batch]
    if not events:
        raise ValueError("No earnings events across the entire calendar window")
    result = {"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "coverage": {"from": start.isoformat(), "through": end.isoformat()}, "events": events}
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"))+"\n")
    temp.replace(path)
    print(f"{len(events)} earnings events, {start} through {end}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    main(parser.parse_args().output)
