# JM Invest

모바일과 데스크톱에서 열리는 정적 시그마 페이지입니다. 종목별 범위와 σ 위치를 비교하고, 기준가·관측가·예상 변동폭을 입력해 계산할 수 있습니다. 기본 종목 값은 예시이며 실시간 시세나 옵션 데이터에 연결되어 있지 않습니다.

## GitHub Pages 배포

1. GitHub에 공개 저장소를 만들고 이 폴더의 파일을 `main` 브랜치 루트에 올립니다. `.nojekyll`도 포함합니다.
2. 저장소의 **Settings → Pages**에서 **Deploy from a branch**를 선택합니다.
3. 브랜치를 `main`, 폴더를 `/ (root)`로 선택하고 저장합니다.
4. Pages 화면에 표시된 주소를 공유합니다. 프로젝트 사이트 주소는 보통 `https://<계정>.github.io/<저장소>/`입니다.

실거래 파일, 일지 및 인증키는 공개 저장소에 포함하지 마세요. 이 버전에는 로그인이나 비공개 거래 저장 기능이 없습니다.

## Private US stock orders

The GitHub Pages build serves the public analysis site. Run the owner-only order service on a Mac whose external IP is registered with Kiwoom.

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
