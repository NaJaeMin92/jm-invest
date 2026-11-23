"""Serve TradeInSight and its owner-only Kiwoom order endpoint."""
import argparse
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
import os
from pathlib import Path
from queue import Empty, SimpleQueue
import re
import secrets
import sqlite3
import stat
from threading import Event, Lock, Thread
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
KIWOOM = "https://api.kiwoom.com"
SUPABASE = "https://mfycpprqyaidoixytdim.supabase.co"
PUBLIC_KEY = "sb_publishable_KIxbzozNkk50oEZ9GehtZA_E484E5Lr"
PAGES_ORIGIN = "https://najaemin92.github.io"
OWNER = "9fc22c69-b253-406a-be2b-eb8ad9526a3c"
YAHOO_SYMBOLS = {
    "BZMAIN": ("BZ%3DF", "Futures"), "CLMAIN": ("CL%3DF", "Futures"), "VIX": ("%5EVIX", "Index"),
}
STATIC = {
    "index.html", "journal.html", "style.css", "journal.js", "instrument.js", "instrument-chart.js",
    "market-panels.js", "chart-tools.js", "chart-annotations.js", "technical-indicators.js", "orders.js", "watch-editor.js",
    "watch-quotes.js",
}


class Problem(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def read_json(url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    with urlopen(Request(url, data=data, headers={"Content-Type": "application/json", **headers}), timeout=15) as response:
        return json.load(response)


def owner_session(authorization):
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise Problem(401, "로그인이 필요합니다.")
    try:
        user = read_json(SUPABASE + "/auth/v1/user", {"Authorization": authorization, "apikey": PUBLIC_KEY})
    except HTTPError as error:
        if error.code in (401, 403):
            raise Problem(401, "다시 로그인해 주세요.") from error
        raise
    if user.get("id") != OWNER:
        raise Problem(403, "본인 계정만 주문할 수 있습니다.")


def order_fields(data):
    symbol = str(data.get("symbol", "")).strip().upper()
    quantity, price = str(data.get("quantity", "")), str(data.get("price", ""))
    exchange, side = data.get("exchange"), data.get("side")
    if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", symbol) or exchange not in ("NA", "ND", "NY"):
        raise Problem(400, "종목코드와 거래소를 확인하세요.")
    if side not in ("buy", "sell") or not re.fullmatch(r"[1-9]\d{0,8}", quantity):
        raise Problem(400, "매매 구분과 주 단위 수량을 확인하세요.")
    if not re.fullmatch(r"\d{1,7}(?:\.\d{1,4})?", price) or not Decimal(price) > 0:
        raise Problem(400, "유효한 USD 지정가를 입력하세요.")
    return dict(symbol=symbol, quantity=quantity, price=price, exchange=exchange, side=side,
                amount=format(Decimal(price)*int(quantity), "f"))


class Kiwoom:
    def __init__(self, key, secret):
        self.key = key
        self.secret = secret
        self.token = None
        self.until = 0
        self.lock = Lock()
        self.directory_lock = Lock()
        self.directory = {}
        self.directory_until = 0

    def access_token(self):
        with self.lock:
            if not self.token or self.until <= time.monotonic():
                try:
                    result = read_json(KIWOOM + "/oauth2/token", {"api-id": "au10001"}, {
                        "grant_type": "client_credentials", "appkey": self.key, "secretkey": self.secret,
                    })
                except (OSError, ValueError) as error:
                    raise Problem(502, "키움 인증 서버에 연결하지 못했습니다.") from error
                if str(result.get("return_code")) != "0" or not result.get("token"):
                    raise Problem(502, "키움 인증 오류. API 키와 등록 IP를 확인하세요.")
                self.token = result["token"]
                self.until = time.monotonic() + 600
            return self.token

    def symbol_directory(self, token):
        with self.directory_lock:
            if time.monotonic() < self.directory_until:
                return self.directory
            result = read_json(KIWOOM + "/api/us/stkinfo", {
                "api-id": "usa10099", "Authorization": "Bearer " + token,
            }, {"stex_tp": "%"})
            if str(result.get("return_code")) != "0" or not result.get("list"):
                raise Problem(502, "키움 종목 목록을 받아오지 못했습니다.")
            self.directory = {row["stk_cd"]: row["stex_tp"] for row in result["list"]
                              if row.get("stk_cd") and row.get("stex_tp") in ("ND", "NY", "NA")}
            self.directory_until = time.monotonic() + 3600
            return self.directory

    def market_quote(self, token, item, transaction):
        return read_json(KIWOOM + "/api/us/mrkcond", {
            "api-id": transaction, "Authorization": "Bearer " + token,
        }, {"stex_tp": item["stex_tp"], "stk_cd": item["jmcode"]})

    def current_quote(self, token, item):
        result = self.market_quote(token, item, "usa20100")
        if str(result.get("return_code")) != "0":
            return None
        price = abs(float(result["cur_prc"]))
        if not math.isfinite(price) or not price:
            return None
        change = float(result["flu_rt"]) if result.get("flu_rt") else None
        return {"symbol": item["symbol"], "price": price, "snapshot": True,
                "change": change if change is not None and math.isfinite(change) else None}

    def daily_quote(self, token, item):
        result = self.market_quote(token, item, "usa20590")
        if str(result.get("return_code")) != "0":
            return None
        daily = []
        for row in result.get("result_list", [])[:5]:
            try:
                change = float(row["flu_rt"])
                price = abs(float(row["cur_prc"]))
            except (KeyError, ValueError, TypeError):
                continue
            if math.isfinite(change) and math.isfinite(price) and price > 0 and row.get("dt"):
                daily.append({"date": row["dt"], "change": change, "price": price})
        return {"symbol": item["symbol"], "daily": daily} if daily else None

    def order_context(self, symbol):
        token = self.access_token()
        directory = self.symbol_directory(token)
        ticker = next((candidate for candidate in (symbol, symbol.replace("-", "."), symbol.replace(".", "-"))
                       if candidate in directory), None)
        if ticker is None:
            raise Problem(404, "키움 미국주식 주문을 지원하지 않는 종목입니다.")
        item = {"jmcode": ticker, "stex_tp": directory[ticker]}
        context = {"symbol": ticker, "exchange": item["stex_tp"]}
        for transaction in ("usa20101", "usa20100"):
            try:
                result = self.market_quote(token, item, transaction)
            except (OSError, ValueError):
                continue
            if str(result.get("return_code")) != "0":
                continue
            if transaction == "usa20101":
                context.update(price=positive_quote(result.get("cur_prc")),
                               date=str(result.get("dt") or ""), time=str(result.get("bid_tm") or ""),
                               asks=order_book_levels(result, "sel"), bids=order_book_levels(result, "buy"))
            else:
                context["fx"] = positive_quote(result.get("base_exrt"))
                if not context.get("price"):
                    context["price"] = positive_quote(result.get("cur_prc"))
        return context

    def submit(self, token, order):
        tr = "ust20000" if order["side"] == "buy" else "ust20001"
        return read_json(KIWOOM + "/api/us/ordr", {"api-id": tr, "Authorization": "Bearer " + token}, {
            "stex_tp": order["exchange"], "stk_cd": order["symbol"], "ord_qty": order["quantity"],
            "ord_uv": order["price"], "trde_tp": "00",
        })


class Orders:
    def __init__(self, broker, filename):
        self.broker = broker
        self.filename = filename
        with sqlite3.connect(filename) as db:
            db.execute("""CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY, expires INTEGER NOT NULL, payload TEXT NOT NULL,
                state TEXT NOT NULL, number TEXT
            )""")

    def preview(self, data):
        order = order_fields(data)
        intent = secrets.token_urlsafe(24)
        with sqlite3.connect(self.filename) as db:
            db.execute("DELETE FROM orders WHERE state='preview' AND expires<?", (int(time.time()),))
            db.execute("INSERT INTO orders VALUES (?,?,?,'preview',NULL)",
                       (intent, int(time.time()) + 120, json.dumps(order)))
        return {"id": intent, **order}

    def submit(self, data):
        intent = data.get("id")
        if not isinstance(intent, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32}", intent):
            raise Problem(400, "주문을 다시 확인하세요.")
        token = self.broker.access_token()
        with sqlite3.connect(self.filename) as db:
            cursor = db.execute("UPDATE orders SET state='sending' WHERE id=? AND state='preview' AND expires>=?",
                                (intent,int(time.time())))
            if cursor.rowcount != 1:
                existing = db.execute("SELECT state,number FROM orders WHERE id=?", (intent,)).fetchone()
                if existing and existing[0] == "accepted":
                    return {"number": existing[1]}
                raise Problem(409, "주문 확인이 만료되었거나 이미 처리되었습니다. 키움에서 확인하세요.")
            order = json.loads(db.execute("SELECT payload FROM orders WHERE id=?", (intent,)).fetchone()[0])

        try:
            result = self.broker.submit(token, order)
        except Exception as error:
            self.update(intent, "unknown")
            raise Problem(502, "전송 결과를 확인하지 못했습니다. 새 주문 전에 키움 주문 내역을 확인하세요.") from error
        if not isinstance(result, dict) or "return_code" not in result:
            self.update(intent, "unknown")
            raise Problem(502, "키움 응답을 확인하지 못했습니다. 키움에서 접수 상태를 확인하세요.")
        if str(result.get("return_code")) != "0":
            self.update(intent, "rejected")
            raise Problem(422, "키움이 주문을 거절했습니다. " + str(result.get("return_msg") or "")[:200])
        number = str(result.get("ord_no") or "").strip()
        if not number:
            self.update(intent, "unknown")
            raise Problem(502, "주문번호를 받지 못했습니다. 키움에서 접수 상태를 확인하세요.")
        self.update(intent, "accepted", number)
        return {"number": number}

    def update(self, intent, state, number=None):
        with sqlite3.connect(self.filename) as db:
            db.execute("UPDATE orders SET state=?,number=? WHERE id=?", (state,number,intent))


def kiwoom_ticks(socket, items, timeout_error):
    socket.send(json.dumps({"trnm": "LOGIN", "token": items["token"]}))
    subscriptions = {(item["jmcode"], item["stex_tp"]): item.get("symbol", item["jmcode"])
                     for item in items["symbols"]}
    request = {"trnm": "REG", "grp_no": "1", "refresh": "0",
               "data": [{"item": [{"jmcode": ticker, "stex_tp": exchange}
                                  for ticker, exchange in subscriptions], "type": ["FE"]}]}
    registered = False
    while True:
        try:
            raw = socket.recv()
        except timeout_error:
            if not registered:
                raise
            yield None
            continue
        if not raw:
            return
        message = json.loads(raw)
        action = message.get("trnm")
        if action == "PING":
            socket.send(raw)
            if registered:
                yield None
        elif action in ("LOGIN", "REG"):
            if str(message.get("return_code")) != "0":
                raise Problem(502, "키움 실시간 시세 등록에 실패했습니다.")
            if action == "LOGIN":
                socket.send(json.dumps(request))
            else:
                registered = True
                yield None
        elif action == "REAL":
            for tick in message.get("data", []):
                if tick.get("type") != "FE":
                    continue
                values = tick.get("values", {})
                try:
                    price = abs(float(values["10"]))
                    change = float(values["12"]) if values.get("12") else None
                except (KeyError, ValueError, TypeError):
                    continue
                if not math.isfinite(price) or not price:
                    continue
                symbol = subscriptions.get((tick.get("item"), tick.get("stexTp")))
                if not symbol:
                    continue
                yield {"symbol": symbol, "price": price,
                       "change": change if change is not None and math.isfinite(change) else None,
                       "date": values.get("22"), "session": values.get("290")}


def positive_quote(raw):
    try:
        value = abs(float(raw))
    except (ValueError, TypeError):
        return None
    return value if math.isfinite(value) and value > 0 else None


def order_book_levels(result, side):
    levels = []
    for index in range(1, 11):
        field = f"{side}_{index}bid"
        price = positive_quote(result.get(field))
        if price is not None:
            levels.append({"price": price, "quantity": positive_quote(result.get(field + "_req"))})
    return levels


def seed_kiwoom_quotes(broker, token, items, snapshots, stopped):
    for read_quote in (broker.current_quote, broker.daily_quote):
        for item in items:
            if stopped.is_set():
                return
            try:
                quote = read_quote(token, item)
            except (OSError, KeyError, ValueError, TypeError):
                quote = None
            if quote:
                snapshots.put(quote)
            if stopped.wait(0.75):
                return


def refresh_external_quotes(symbols, snapshots, stopped):
    while not stopped.is_set():
        for symbol in symbols:
            if stopped.is_set():
                return
            try:
                ticker, market_type = YAHOO_SYMBOLS[symbol]
                result = read_json(
                    "https://query1.finance.yahoo.com/v8/finance/chart/" + ticker
                    + "?range=1d&interval=5m", {"User-Agent": "Mozilla/5.0"})
                meta = result["chart"]["result"][0]["meta"]
                price = float(meta["regularMarketPrice"])
                previous = float(meta["chartPreviousClose"])
                if not all(math.isfinite(value) and value > 0 for value in (price, previous)):
                    continue
                snapshots.put({"symbol": symbol, "price": price, "change": (price / previous - 1) * 100,
                               "quoteTime": meta.get("regularMarketTime"), "marketType": market_type})
            except (OSError, KeyError, ValueError, IndexError, TypeError):
                continue
        if stopped.wait(30):
            return


class App(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    orders = None
    quote_broker = None
    quote_lock = Lock()
    quotes_only = False
    host = ""
    origin = ""

    def allowed_host(self):
        self.close_connection = True
        if self.headers.get("Host") != self.host:
            self.send_error(403)
            return False
        return True

    def serve_static(self, send):
        if self.quotes_only:
            self.send_error(404)
            return
        resource = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        source = (ROOT / resource).resolve()
        asset = source.is_file() and (ROOT / "assets") in source.parents
        top_level = resource in STATIC and source.parent == ROOT and source.is_file()
        if not (asset or top_level):
            self.send_error(404)
            return
        content = source.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(source.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if send:
            self.wfile.write(content)

    def do_HEAD(self):
        if self.allowed_host():
            self.serve_static(False)

    def do_GET(self):
        if not self.allowed_host():
            return
        path = urlsplit(self.path)
        if not self.quotes_only and path.path == "/api/orders/status":
            self.handle_order("status")
        elif not self.quotes_only and path.path == "/api/orders/context":
            self.handle_order_context(parse_qs(path.query).get("symbol", [""])[0])
        else:
            self.serve_static(True)

    def do_POST(self):
        if not self.allowed_host():
            return
        path = urlsplit(self.path).path
        if path == "/api/quotes/stream":
            self.stream_quotes()
            return
        if self.quotes_only or path not in ("/api/orders/preview","/api/orders/submit"):
            self.send_error(404)
            return
        self.handle_order(path.rsplit("/", 1)[-1])

    def do_OPTIONS(self):
        if not self.allowed_host():
            return
        if not self.quotes_only or self.path != "/api/quotes/stream" or self.headers.get("Origin") != self.origin:
            self.send_error(403)
            return
        self.send_response(204)
        self.quote_headers()
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def quote_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.quotes_only and self.headers.get("Origin") == self.origin:
            self.send_header("Access-Control-Allow-Origin", self.origin)
            self.send_header("Vary", "Origin")

    def stream_quotes(self):
        self.close_connection = True
        opened = False
        acquired = False
        socket = None
        stopped = Event()
        try:
            if self.quote_broker is None:
                raise Problem(503, "키움 시세 서비스가 꺼져 있습니다.")
            if self.headers.get("Origin") != self.origin or self.headers.get_content_type() != "application/json":
                raise Problem(403, "허용되지 않은 시세 요청입니다.")
            owner_session(self.headers.get("Authorization"))
            length = int(self.headers.get("Content-Length", "0"))
            requested = json.loads(self.rfile.read(length)) if 0 < length <= 16000 else None
            if isinstance(requested, list):
                requested = [item.get("jmcode") if isinstance(item, dict) else item for item in requested]
            if not isinstance(requested, list) or not 1 <= len(requested) <= 200 or any(
                not isinstance(symbol, str) or not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", symbol)
                for symbol in requested
            ):
                raise Problem(400, "종목 코드를 확인하세요.")
            acquired = self.quote_lock.acquire(timeout=3)
            if not acquired:
                raise Problem(409, "키움 시세 세션을 다른 탭에서 사용 중입니다.")
            token = self.quote_broker.access_token()
            external = [symbol for symbol in dict.fromkeys(requested) if symbol in YAHOO_SYMBOLS]
            equities = [symbol for symbol in dict.fromkeys(requested) if symbol not in YAHOO_SYMBOLS]
            directory = self.quote_broker.symbol_directory(token) if equities else {}
            items, unsupported = [], []
            for symbol in equities:
                ticker = next((candidate for candidate in (symbol, symbol.replace("-", "."), symbol.replace(".", "-"))
                               if candidate in directory), None)
                if ticker:
                    items.append({"symbol": symbol, "jmcode": ticker, "stex_tp": directory[ticker]})
                else:
                    unsupported.append(symbol)
            ticks = iter(())
            if items:
                import websocket
                socket = websocket.create_connection(
                    "wss://api.kiwoom.com:10000/api/websocket", timeout=8, suppress_origin=True)
                ticks = kiwoom_ticks(socket, {"token": token, "symbols": items}, websocket.WebSocketTimeoutException)
                next(ticks, None)
                socket.settimeout(2)
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Connection", "close")
            self.quote_headers()
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            opened = True
            snapshots = SimpleQueue()
            if items:
                Thread(target=seed_kiwoom_quotes, args=(self.quote_broker, token, items, snapshots, stopped),
                       daemon=True).start()
            if external:
                Thread(target=refresh_external_quotes, args=(external, snapshots, stopped), daemon=True).start()
            deadline = time.monotonic() + 300
            tick = {"unsupported": unsupported}
            while True:
                if time.monotonic() >= deadline:
                    break
                frames = [tick]
                while True:
                    try:
                        frames.append(snapshots.get_nowait())
                    except Empty:
                        break
                payload = b"".join((json.dumps(frame) + "\n").encode() for frame in frames)
                self.wfile.write(f"{len(payload):X}\r\n".encode() + payload + b"\r\n")
                try:
                    tick = next(ticks)
                except StopIteration:
                    if items or not external:
                        break
                    stopped.wait(2)
                    tick = None
            self.wfile.write(b"0\r\n\r\n")
        except Problem as error:
            if not opened:
                self.write_json(error.status, {"message": str(error)})
        except (OSError, ImportError, ValueError, TypeError):
            if not opened:
                self.write_json(502, {"message": "키움 실시간 시세에 연결하지 못했습니다."})
        except Exception:
            if not opened:
                self.write_json(502, {"message": "키움 실시간 시세를 받지 못했습니다."})
        finally:
            stopped.set()
            try:
                if socket is not None:
                    socket.close(timeout=0)
            finally:
                if acquired:
                    self.quote_lock.release()

    def handle_order(self, action):
        try:
            owner_session(self.headers.get("Authorization"))
            if action == "status":
                result = {"enabled": self.orders is not None}
            else:
                if self.orders is None or self.headers.get("Origin") != self.origin:
                    raise Problem(403, "주문 서버에서 요청을 허용하지 않습니다.")
                if self.headers.get_content_type() != "application/json":
                    raise Problem(415, "유효한 주문 데이터를 사용하세요.")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048:
                    raise Problem(400, "주문 데이터를 확인하세요.")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise Problem(400, "주문 데이터를 확인하세요.")
                result = self.orders.preview(data) if action == "preview" else self.orders.submit(data)
            self.write_json(200, result)
        except Problem as error:
            self.write_json(error.status, {"message": str(error)})
        except (ValueError, TypeError):
            self.write_json(400, {"message": "주문 데이터를 확인하세요."})
        except (OSError, sqlite3.Error):
            self.write_json(503, {"message": "요청 상태를 확인하지 못했습니다. 전송한 경우 키움 주문 내역을 확인하세요."})

    def handle_order_context(self, symbol):
        try:
            owner_session(self.headers.get("Authorization"))
            if self.quote_broker is None:
                raise Problem(503, "키움 시세 서버가 연결되어 있지 않습니다.")
            if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", symbol):
                raise Problem(400, "종목 코드를 확인하세요.")
            self.write_json(200, {**self.quote_broker.order_context(symbol), "enabled": self.orders is not None})
        except Problem as error:
            self.write_json(error.status, {"message": str(error)})
        except (OSError, ValueError):
            self.write_json(503, {"message": "키움 주문 정보를 불러오지 못했습니다."})

    def write_json(self, status, result):
        content = json.dumps(result, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        if self.quotes_only:
            self.quote_headers()
        self.end_headers()
        self.wfile.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--live", action="store_true", help="Enable explicit orders on the real account")
    parser.add_argument("--quotes", action="store_true", help="Enable private read-only Kiwoom quotes")
    parser.add_argument("--quote-gateway", action="store_true",
                        help="Serve only authenticated quotes for GitHub Pages via an HTTPS reverse proxy")
    args = parser.parse_args()
    if args.quote_gateway and args.live:
        parser.error("--quote-gateway cannot be combined with --live")
    App.host = f"127.0.0.1:{args.port}"
    App.quotes_only = args.quote_gateway
    App.origin = PAGES_ORIGIN if args.quote_gateway else "http://" + App.host
    if args.live or args.quotes or args.quote_gateway:
        os.umask(0o077)
        path = Path.home() / ".jm-invest-credentials.json"
        with path.open() as config:
            info = os.fstat(config.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                parser.error("Credentials must belong to you and have mode 600")
            credentials = json.load(config)
        broker = Kiwoom(credentials["KIWOOM_APP_KEY"], credentials["KIWOOM_APP_SECRET"])
        App.quote_broker = broker
        if args.live:
            App.orders = Orders(broker, Path.home() / ".jm-invest-orders.sqlite")
    with ThreadingHTTPServer(("127.0.0.1",args.port), App) as app:
        print("http://" + App.host, flush=True)
        app.serve_forever()


if __name__ == "__main__":
    main()
