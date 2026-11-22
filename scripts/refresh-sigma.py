"""Calculate weekly 1σ bands from option quotes and underlying closes."""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
SYMBOLS = "ANT SKHY SPCX MRVL AAL UAL DAL NVDA AMZN AAPL AMD AVGO GOOG META MSFT NBIS PLTR QQQ SOXX SPY TSLA".split()
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}


def fetch(url, params):
    with urlopen(Request(url + "?" + urlencode(params), headers=HEADERS), timeout=14) as response:
        return json.load(response)


def regular_closes(symbol):
    payload = fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + symbol, {"range": "1mo", "interval": "1d"})
    chart = payload["chart"]["result"][0]
    closes = chart["indicators"]["quote"][0]["close"]
    return [(datetime.fromtimestamp(timestamp, ET).date(), close)
            for timestamp, close in zip(chart["timestamp"], closes) if close is not None and close > 0]


def number(value):
    return float(value.replace(",", ""))


def option_quote(symbol, anchor, close, target):
    payload = fetch("https://api.nasdaq.com/api/quote/" + symbol + "/option-chain", {
        "assetclass": "etf" if symbol in ("QQQ", "SOXX", "SPY") else "stocks", "fromdate": target - timedelta(days=1),
        "todate": target + timedelta(days=21), "limit": 1000,
    })
    chain = payload.get("data") or {}
    date_label = re.search(r"AS OF ([A-Z]+ \d+, \d{4})", chain.get("lastTrade") or "")
    if not date_label or datetime.strptime(date_label[1].title(), "%b %d, %Y").date() != anchor:
        return None
    candidates = []
    for row in (chain.get("table") or {}).get("rows") or []:
        match = re.search(r"--(\d{6})[cp]\d+$", row.get("drillDownURL") or "")
        if not match or not row.get("strike"):
            continue
        try:
            strike = number(row["strike"])
            call_bid, call_ask, put_bid, put_ask = (number(row[key]) for key in ("c_Bid", "c_Ask", "p_Bid", "p_Ask"))
        except (TypeError, ValueError, KeyError):
            continue
        if abs(strike / close - 1) > .05 or not (0 < call_bid <= call_ask and 0 < put_bid <= put_ask):
            continue
        expiry = datetime.strptime(match[1], "%y%m%d").date()
        if expiry <= anchor:
            continue
        candidates.append((expiry, abs(strike-close), strike, (call_bid+call_ask)/2, (put_bid+put_ask)/2))
    if not candidates:
        return None
    expiry, _, strike, call, put = min(candidates)
    return {"expiry": expiry.isoformat(), "strike": strike, "call": call, "put": put}


def calculate(symbol, anchor_friday, today, previous):
    closes = regular_closes(symbol)
    # Drop an incomplete regular session from the source's daily series.
    if closes and closes[-1][0] == today.date() and today.time() < time(16, 0):
        closes.pop()
    if len(closes) < 2:
        return None
    anchor_candidates = [(day, price) for day, price in closes if day <= anchor_friday]
    if not anchor_candidates:
        return None
    anchor, anchor_close = anchor_candidates[-1]
    if (anchor_friday - anchor).days > 1:
        return None
    target = anchor_friday + timedelta(days=7)
    if previous and previous["fromDate"] == anchor.isoformat() and previous["through"] == target.isoformat():
        inputs = {key: previous[key] for key in ("strike", "call", "put", "expiry")}
    else:
        inputs = option_quote(symbol, anchor, anchor_close, target)
    if not inputs:
        return None
    close_date, close = closes[-1]
    return dict(inputs, fromDate=anchor.isoformat(), anchor=anchor_close, through=target.isoformat(),
                asOf=close_date.isoformat(), close=close, change=100 * (close / closes[-2][1] - 1))


def refresh(destination):
    previous = json.loads(destination.read_text())["symbols"] if destination.exists() else {}
    now = datetime.now(ET)
    friday = now.date() - timedelta(days=(now.weekday() - 4) % 7)
    if now.date() == friday and now.time() < time(16, 15):
        friday -= timedelta(days=7)

    def capture(symbol):
        existing = previous.get(symbol)
        try:
            fresh = calculate(symbol, friday, now, existing)
            print(symbol, "updated" if fresh else "no matching anchor option quote", flush=True)
            return symbol, fresh or previous.get(symbol)
        except (OSError, ValueError, LookupError, TypeError, AttributeError) as error:
            print(symbol, "data unavailable", type(error).__name__, flush=True)
            return symbol, previous.get(symbol)

    with ThreadPoolExecutor(max_workers=4) as workers:
        rows = {symbol: item for symbol, item in workers.map(capture, SYMBOLS) if item is not None}
    if not rows:
        raise ValueError("Option data unavailable for all symbols")
    destination.write_text(json.dumps({"symbols": rows}, sort_keys=True, separators=(",", ":"))+"\n")


if __name__ == "__main__":
    refresh(Path(sys.argv[1]))
