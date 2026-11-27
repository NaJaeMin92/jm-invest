# JM Invest

아이폰과 데스크톱에서 관심종목, 종목 차트, 키움 계좌 잔고와 실현손익을 확인하는 웹 앱입니다. 로컬 앱과 GitHub Pages는 같은 프런트엔드를 사용합니다. 주소의 `#stock=ANT` 같은 값은 열 종목을 선택합니다.

## 휴대폰에 설치

휴대폰에서 [TradeInSight](https://najaemin92.github.io/jm-invest/)를 열고 My Watchlist 오른쪽의 설치 아이콘을 누르세요. iPhone은 Safari의 공유 메뉴에서 **홈 화면에 추가**, Android는 Chrome 메뉴에서 **앱 설치**를 선택해도 됩니다. 설치한 아이콘으로 열면 여섯 탭을 독립 창에서 사용할 수 있습니다.

실시간 시세는 로그인과 시세 게이트웨이 연결이 필요합니다. 공개 웹앱에서는 주문을 미리 볼 수 있고, iPhone의 직접 주문은 아래 네이티브 앱에서 처리합니다.

## GitHub Pages 배포

GitHub Pages는 `najaemin92/jm-invest` 저장소의 `main` 루트에서 배포됩니다. 변경 사항을 커밋한 뒤 로컬 앱과 공개 사이트를 차례로 검증합니다.

```sh
python3 scripts/publish-site.py check-local
python3 scripts/publish-site.py publish
```

배포 명령은 대상 커밋을 기록하고 일반 푸시를 수행합니다. Pages의 HTML, CSS, JavaScript, 공개 자산이 커밋과 일치하면 대기를 해제합니다. 연결이 끊기면 `python3 scripts/publish-site.py retry`로 같은 커밋을 재개할 수 있습니다. 이 Mac의 LaunchAgent가 로그인 세션에서 대기 중인 배포를 재시도합니다.

## 아이폰 앱에서 직접 주문하기

JM Invest iPhone 앱은 키움에 직접 연결해 미국주식 10단계 호가를 수신하고, 기기 인증을 거쳐 매수·매도 주문을 전송합니다. 설치 후에는 Mac을 꺼도 사용할 수 있습니다. 외출 중 집의 등록 IP를 사용하려면 아이폰을 집 공유기의 VPN에 연결하세요. [아이폰 앱 설치와 첫 연결](ios/README.md)

## Private US stock orders on the web

The GitHub Pages frontend offers signed-in quotes through the Mac gateway and order previews. On iPhone, a stock ticket can also open the installed native app. Web orders use the local order server. Keep the backend host awake and connected on its Kiwoom-registered IP while using the web gateway or local server.

```sh
python3 scripts/order-server.py --live
```

Open `http://127.0.0.1:8765/`, sign in to **Account**, and use **매수** or **매도**
from a stock's detail view. The ticket can load Kiwoom bid and ask levels and
estimate the KRW amount at Kiwoom's reference exchange rate. It accepts US
whole-share limit, market, LOC, and VWAP/TWAP limit or market orders. The
미체결 view shows the broker's open orders and lets you review a price amendment
or cancellation of the remaining shares. It sends a single request when you
confirm the preview and displays the broker's order number. Check any uncertain submission in
Kiwoom before sending a new order. The server reads the existing mode-600
`~/.jm-invest-credentials.json` file and binds to the Mac's loopback interface.

## Private Kiwoom quotes

Install `websocket-client` in the Python environment that runs the server, then
run `python3 scripts/order-server.py --quotes` from the repository root. Open
`http://127.0.0.1:8765/` and sign in through Account. My Watchlist uses the
Kiwoom current-quote and daily APIs to fill US equity rows, minute bars for the
sparklines, and the FE WebSocket to update traded prices and the latest minute.
Brent and WTI crude oil futures and the VIX index use
Yahoo Finance delayed quotes. This mode enables quotes only. The existing `--live` mode enables
quotes and orders. The local server uses the same mode-600 credentials file
and registered IP as the order service.

For phone access through the existing GitHub Pages site, run a dedicated
`--quote-gateway --port 8767` instance behind an HTTPS reverse proxy. The
proxy must preserve streaming, forward the Authorization header without
logging it, and set the upstream Host to `127.0.0.1:8767`. Configure the
public HTTPS URL ending in `/api/quotes/stream` as the
`kiwoom-quote-gateway` meta tag in `index.html`. The gateway handles quote
requests from the GitHub Pages origin and checks the signed-in owner session
before subscribing to Kiwoom. The local app and gateway share one Kiwoom
WebSocket slot. Additional clients refresh current quotes and open books via
REST and resume push updates when the slot becomes available.

Signed-in stock charts also read the owner's Kiwoom execution history through
`GET /api/quotes/executions` on the local server or phone gateway. B and S
mark reported purchases and sales. Select a flag for the order-level fill
price, quantity and execution time in New York. Records with only a trading
date appear on daily and longer intervals. The browser keeps execution
records in memory while the symbol is open.
