import {trendStyles} from "./assets/chart-trends.js?v=82";
import {prepareChart, drawChart, isIntraday, visibleBars} from "./instrument-chart.js?v=88";
import {setupExecutionFlags} from "./chart-executions.js?v=101";
import {showSigmaPanel} from "./market-panels.js?v=89";

import {setupChartTools} from "./chart-tools.js?v=76";
import {orderKinds, needsPrice, populateKinds} from "./orders.js?v=83";

const get = id => document.getElementById(id);
const savedQuotes = new Set("ANT SKHY SPCX MRVL BZMAIN CLMAIN AAL UAL DAL NVDA AMZN".split(" "));
const cache = new Map();
export function publicQuote(symbol) {
  if (!savedQuotes.has(symbol)) return Promise.resolve(null);
  if (!cache.has(symbol)) {
    cache.set(symbol,fetch("./assets/quotes/"+symbol+".json?v=46").then(response=>{
      if (!response.ok) throw new Error("Quote unavailable");
      return response.json();
    }).catch(()=>{cache.delete(symbol);return null;}));
  }
  return cache.get(symbol);
}
let sparkId=0;
export function sparkline(points, container) {
  const ns = "http://www.w3.org/2000/svg";
  let path = container.querySelector("polyline");
  if (!path) {
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox","0 0 100 44");
    svg.setAttribute("preserveAspectRatio","none");
    path = document.createElementNS(ns,"polyline");
    path.setAttribute("fill","none");
    path.setAttribute("stroke","currentColor");
    path.setAttribute("stroke-width","1.6");
    const gradient=document.createElementNS(ns,"linearGradient");
    gradient.id="spark-fill-"+(++sparkId);
    gradient.setAttribute("x2","0"); gradient.setAttribute("y2","1");
    for(const [offset,opacity] of [["0%","0.30"],["100%","0"]]){
      const stop=document.createElementNS(ns,"stop");
      stop.setAttribute("offset",offset); stop.setAttribute("stop-color","currentColor"); stop.setAttribute("stop-opacity",opacity);
      gradient.append(stop);
    }
    const fill=document.createElementNS(ns,"polygon"), dot=document.createElementNS(ns,"circle");
    fill.setAttribute("fill","url(#"+gradient.id+")");
    dot.setAttribute("r","2");dot.setAttribute("fill","currentColor");
    path.setAttribute("stroke-linejoin","round");
    svg.append(gradient,fill,path,dot);
    container.append(svg);
  }
  const prices = points.map(point => point[1]);
  const min = Math.min(...prices), max = Math.max(...prices), start = points[0][0];
  const span = points.at(-1)[0] - start;
  const coords=points.map(([stamp, value]) => {
    const x = 1 + 98 * (stamp - start) / span;
    const y = min === max ? 22 : 40 - 36 * (value - min) / (max - min);
    return x.toFixed(2) + "," + y.toFixed(2);
  });
  path.setAttribute("points",coords.join(" "));
  path.previousElementSibling.setAttribute("points","1,44 "+coords.join(" ")+" 99,44");
  const [cx,cy]=coords.at(-1).split(",");
  path.nextElementSibling.setAttribute("cx",cx);path.nextElementSibling.setAttribute("cy",cy);
}
const signed = n => (n>=0?"+":"")+n.toFixed(2);
const displaySymbol = s => ({BZMAIN:"BZmain",CLMAIN:"CLmain"}[s] || s);
const validSymbol = /^[A-Z][A-Z0-9.\-]{0,11}$/;
function mergeDaily(oldBars, newBars) {
  const days = new Map();
  for (const bars of [oldBars, newBars]) {
    for (const bar of bars ?? []) days.set(Math.floor(bar[0] / 86400), bar);
  }
  return [...days.values()].sort((a,b) => a[0] - b[0]);
}

export function setupInstrument({strategy,isSignedIn,search,nameFor,readList,saveList,orders,readPositionSnapshot,subscribeOrderBook,canLoadChart,loadChart,loadExecutions,signIn}) {
  const dialog=get("stock-detail"), canvas=get("market-chart");
  const executions = setupExecutionFlags(loadExecutions);
  let current="", quote=null, frame="day", afterClose=null, quoteRequest=0;
  const fullHistory = new Map();
  let historyAbort, historyState = "";
  const trade = get("trade-preview");
  const tradeForm = get("trade-preview-form"), tradeReview = get("trade-preview-review");
  const tradeStatus = get("trade-preview-status"), tradeNext = get("trade-preview-next");
  const tradeConfirm = get("trade-preview-confirm"), tradeEdit = get("trade-preview-edit");
  const bookLevels = get("trade-book-levels"), bookRefresh = get("trade-book-refresh");
  const bookStatus = get("trade-book-status");
  const bookAsks = get("trade-book-asks"), bookBids = get("trade-book-bids");
  new ResizeObserver(([entry]) => {
    if (!entry.contentRect.height) return;
    const visibleRows = Math.max(1, Math.min(10, Math.floor(entry.contentRect.height / 44)));
    bookLevels.style.setProperty("--visible-rows", visibleRows);
  }).observe(bookBids);
  const bookMode = get("trade-book-mode"), kind = get("trade-kind");
  populateKinds(kind);
  const ticketSides = [...tradeForm.querySelectorAll("[data-ticket-side]")];
  const quantity = tradeForm.querySelector('[name="quantity"]');
  const price = tradeForm.querySelector('[name="price"]');
  const priceHint = get("trade-price-hint");
  const positionPanel = get("trade-position"), positionMessage = get("trade-position-message");
  const heldShares = get("trade-position-shares"), averagePrice = get("trade-position-average");
  const positionReturn = get("trade-position-return"), retryPosition = get("trade-position-retry");
  const sharesFormat = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:8});
  const returnFormat = new Intl.NumberFormat("en-US", {style:"percent", minimumFractionDigits:2, signDisplay:"exceptZero"});
  const positionDate = new Intl.DateTimeFormat("ko-KR", {dateStyle:"short", timeStyle:"short", timeZone:"Asia/Seoul"});
  const dollars = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 4
  });
  const won = new Intl.NumberFormat("ko-KR", {style: "currency", currency: "KRW"});
  const sideName = {buy: "매수", sell: "매도"};
  const nativeLink = get("trade-open-iphone");
  const onPhonePages = location.hostname === "najaemin92.github.io" && /iPhone/i.test(navigator.userAgent);
  const previewOnly = onPhonePages ? "실주문은 설치된 JM Invest 앱에서 확인하세요."
    : "미리보기 모드입니다. 실계좌 주문은 이 Mac의 비공개 서버에서 할 수 있습니다.";
  let tradeSide, orderContext, reviewId, tradeBusy = false, tradeVersion = 0;
  let unsubscribeBook, pendingBook, bookPaint, bookRevision = 0, liveTradePrice, displayedBook;
  let position, positionRequest;

  function updatePositionReturn() {
    const mark = liveTradePrice ?? orderContext?.price ?? position?.markPrice;
    const text = position?.averagePrice > 0 && mark > 0 ? returnFormat.format(mark / position.averagePrice - 1) : "—";
    positionReturn.textContent = text;
    positionReturn.dataset.direction = text.startsWith("+") ? "up" : text.startsWith("-") ? "down" : "";
  }

  function resetPosition() {
    positionRequest?.abort();
    positionRequest = position = null;
    positionPanel.querySelector("dl").hidden = false;
    positionPanel.removeAttribute("aria-busy");
    positionMessage.hidden = true;
    get("trade-position-quantity-label").textContent = "보유수량";
    heldShares.textContent = averagePrice.textContent = "—";
    updatePositionReturn();
  }

  function showPosition(result) {
    position = result;
    get("trade-position-quantity-label").textContent = result.observed != null ? "결제기준 수량" : "보유수량";
    heldShares.textContent = sharesFormat.format(result.quantity) + "주";
    averagePrice.textContent = result.averagePrice > 0 ? dollars.format(result.averagePrice) : "—";
    updatePositionReturn();
  }

  async function loadPosition() {
    resetPosition();
    const controller = new AbortController();
    positionRequest = controller;
    positionPanel.setAttribute("aria-busy", "true");
    try {
      const result = await orders.stockPosition(current, controller.signal);
      if (controller.signal.aborted) return;
      if (result) {
        showPosition(result);
        return;
      }
      positionMessage.firstElementChild.textContent = "로그인 후 보유 잔고를 볼 수 있습니다.";
      retryPosition.hidden = true;
    } catch {
      if (controller.signal.aborted) return;
      const saved = await readPositionSnapshot(current);
      if (controller.signal.aborted) return;
      if (saved) showPosition(saved);
      positionMessage.firstElementChild.textContent = saved
        ? "최근 동기화 · " + positionDate.format(saved.observed) + " KST" : "보유 잔고를 불러오지 못했습니다.";
      retryPosition.hidden = false;
    } finally {
      if (!controller.signal.aborted) positionPanel.removeAttribute("aria-busy");
    }
    positionPanel.querySelector("dl").hidden = !position;
    positionMessage.hidden = false;
  }
  retryPosition.onclick = loadPosition;

  function selectTradeSide(side) {
    tradeSide = side;
    positionPanel.hidden = side !== "sell";
    trade.dataset.side = side;
    tradeNext.textContent = sideName[side] + (onPhonePages ? " 미리보기" : " 주문 확인");
    nativeLink.hidden = !onPhonePages;
    if (onPhonePages) nativeLink.href = "jminvest://stock/" + encodeURIComponent(current) + "?side=" + side;
    for (const button of ticketSides) {
      button.setAttribute("aria-pressed", String(button.dataset.ticketSide === side));
    }
  }

  function updateOrderKind() {
    const algo = ["26","27","36","37"].includes(kind.value);
    quantity.min = algo ? "5" : "1";
    get("trade-quantity-label").textContent = algo ? "수량 (최소 5주)" : "수량 (주)";
    price.disabled = !needsPrice(kind.value);
    get("trade-kind-help").textContent = ({
      "00":"지정한 가격 또는 더 유리한 가격에 체결", "03":"체결 시점에 주문 금액 결정",
      "26":"거래량에 맞춰 지정가 범위에서 분할 체결", "27":"시간을 나눠 지정가 범위에서 분할 체결",
      "30":"종가가 지정가 조건을 충족하면 체결", "36":"거래량에 맞춰 시장가로 분할 체결",
      "37":"시간을 나눠 시장가로 분할 체결"
    })[kind.value] || "";
    get("trade-limit-field").hidden = price.disabled;
    for (const button of bookLevels.querySelectorAll("button")) button.disabled = price.disabled;
    updateTradeTotal();
  }
  kind.onchange = updateOrderKind;

  function updateTradeTotal() {
    const amount = quantity.valueAsNumber * price.valueAsNumber;
    const valid = quantity.validity.valid && price.validity.valid && Number.isFinite(amount);
    get("trade-preview-total").textContent = price.disabled ? "체결 시 결정" : valid ? dollars.format(amount) : "—";
    const converted = get("trade-preview-krw");
    get("trade-limit-krw").textContent = !price.disabled && price.valueAsNumber > 0 && orderContext?.fx > 0
      ? "1주 약 " + won.format(price.valueAsNumber * orderContext.fx) : "";
    converted.hidden = price.disabled || !valid || !Number.isFinite(orderContext?.fx);
    converted.textContent = converted.hidden ? "" : "약 " + won.format(amount * orderContext.fx);
    for (const button of bookLevels.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(!price.disabled && Number(button.dataset.price) === price.valueAsNumber));
    }
  }

  function setTradePrice(value) {
    if (!Number.isFinite(value)) return;
    const scale = value >= 1 ? 100 : 10_000;
    const scaled = Number((value * scale).toFixed(6));
    const rounded = (tradeSide === "buy" ? Math.floor(scaled) : Math.ceil(scaled)) / scale;
    price.value = rounded.toFixed(rounded >= 1 ? 2 : 4);
    price.setCustomValidity("");
    priceHint.textContent = Math.abs(rounded - value) > 1e-8
      ? dollars.format(value) + " → 주문가 " + dollars.format(rounded) : "";
    updateTradeTotal();
  }

  function renderBookSide(container, levels, depth) {
    const largest = Math.max(1, ...levels.map(level => level.quantity ?? 0));
    while (container.children.length > depth) container.lastElementChild.remove();
    for (let index = 0; index < depth; index++) {
      const level = levels[index];
      let row = container.children[index];
      const tag = level ? "button" : "span";
      if (row?.localName !== tag) {
        const next = document.createElement(tag);
        if (row) row.replaceWith(next);
        else container.append(next);
        row = next;
        if (level) {
          row.type = "button";
          const prices = document.createElement("span");
          prices.append(document.createElement("b"), document.createElement("small"));
          row.append(prices, document.createElement("span"));
          row.onclick = () => setTradePrice(Number(row.dataset.price));
        } else {
          row.className = "book-empty-level";
          row.setAttribute("aria-hidden", "true");
          row.textContent = "—";
        }
      }
      if (!level) continue;
      row.dataset.price = level.price;
      row.style.setProperty("--depth", (100 * (level.quantity ?? 0) / largest) + "%");
      row.disabled = price.disabled;
      const prices = row.firstElementChild, change = row.lastElementChild;
      prices.firstElementChild.textContent = dollars.format(level.price);
      prices.lastElementChild.textContent = orderContext?.fx > 0 ? won.format(level.price * orderContext.fx) : "₩—";
      const percent = orderContext?.previousClose > 0 ? (level.price / orderContext.previousClose - 1) * 100 : null;
      change.textContent = percent == null ? "—" : (percent > 0 ? "+" : "") + percent.toFixed(2) + "%";
      change.dataset.direction = percent > 0 ? "up" : percent < 0 ? "down" : "";
    }
  }

  function setTicketQuote(value, label) {
    get("trade-preview-quote").hidden = !Number.isFinite(value);
    get("trade-quote-value").textContent = Number.isFinite(value) ? dollars.format(value) : "";
    get("trade-quote-label").textContent = label;
  }

  function showTradeQuote(value) {
    if (!Number.isFinite(value)) return;
    setTicketQuote(value, "현재가");
    if (position) updatePositionReturn();
    get("trade-use-quote").hidden = false;
    get("trade-book-price").textContent = dollars.format(value);
    get("trade-book-krw").textContent = orderContext?.fx > 0 ? won.format(value * orderContext.fx) : "";
  }

  function showOrderBook(book) {
    displayedBook = book;
    const firstBook = bookLevels.hidden;
    const asks = book.asks ?? [], bids = book.bids ?? [];
    const depth = Math.max(asks.length, bids.length);
    bookLevels.hidden = !depth;
    bookStatus.hidden = !bookLevels.hidden;
    bookStatus.textContent = "표시할 호가가 없습니다.";
    bookMode.textContent = book.live ? "실시간" : bookLevels.hidden ? "" : "최근 호가";
    bookMode.dataset.live = String(Boolean(book.live));
    const timestamp = get("trade-book-time");
    const day = book.date?.replace(/^\d{4}(\d{2})(\d{2})$/, "$1/$2");
    const clock = book.time?.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3");
    timestamp.textContent = [day, clock].filter(Boolean).join(" ");
    timestamp.title = [book.date, book.time].filter(Boolean).join(" ");
    renderBookSide(bookAsks, asks, depth);
    renderBookSide(bookBids, bids, depth);
    if (firstBook && depth) {
      bookAsks.scrollTop = bookBids.scrollTop = 0;
    }
    updateTradeTotal();
  }

  function onBookUpdate(update) {
    if (!trade.open || tradeForm.hidden) return;
    if (update.bookStatus === "reconnecting") {
      bookMode.textContent = "재연결 중";
      bookMode.dataset.live = "false";
      return;
    }
    if (update.book) {
      bookRevision += 1;
      pendingBook = {...update.book, live: !update.book.snapshot,
        time: update.book.time.replace(/^(\d\d)(\d\d)(\d\d)$/, "$1:$2:$3")};
    } else if (Number.isFinite(update.price)) {
      liveTradePrice = update.price;
    }
    bookPaint ??= requestAnimationFrame(() => {
      bookPaint = undefined;
      if (Number.isFinite(liveTradePrice)) showTradeQuote(liveTradePrice);
      if (pendingBook) showOrderBook(pendingBook);
      pendingBook = undefined;
    });
  }

  async function loadTradeContext() {
    const version = tradeVersion;
    const revision = bookRevision;
    bookRefresh.disabled = true;
    try {
      const context = await orders.stockContext(current);
      if (version !== tradeVersion || !trade.open) return;
      orderContext = context;
      tradeStatus.textContent = context?.enabled ? "" : previewOnly;
      showTradeQuote(liveTradePrice ?? context?.price);
      if (context && revision === bookRevision) showOrderBook(context);
      else if (displayedBook) showOrderBook(displayedBook);
      if (!context && bookLevels.hidden) bookStatus.textContent = "로그인 후 호가를 볼 수 있습니다.";
      updateTradeTotal();
    } catch (error) {
      if (version === tradeVersion && trade.open) {
        tradeStatus.textContent = error.message;
        if (bookLevels.hidden) bookStatus.textContent = "호가를 불러오지 못했습니다.";
      }
    } finally {
      if (version === tradeVersion) {
        bookRefresh.disabled = false;
        tradeNext.disabled = false;
      }
    }
  }

  function openTrade(side) {
    if (tradeBusy || trade.open) return;
    if (unsubscribeBook) releaseTicket();
    tradeVersion += 1;
    selectTradeSide(side);
    orderContext = null;
    reviewId = null;
    displayedBook = undefined;
    bookMode.textContent = "";
    bookMode.dataset.live = "false";
    bookRevision = 0;
    liveTradePrice = undefined;
    tradeForm.reset();
    kind.value = "00";
    updateOrderKind();
    price.setCustomValidity("");
    priceHint.textContent = "";
    tradeForm.hidden = false;
    tradeReview.hidden = true;
    tradeNext.disabled = true;
    tradeConfirm.disabled = true;
    tradeConfirm.hidden = false;
    get("trade-book-price").textContent = "—";
    get("trade-book-krw").textContent = "";
    tradeEdit.disabled = false;
    tradeEdit.hidden = false;
    get("trade-review-pending").hidden = true;
    bookLevels.hidden = true;
    bookStatus.hidden = false;
    bookStatus.textContent = "호가 조회 중…";
    get("trade-book-time").textContent = "";
    get("trade-use-quote").hidden = true;
    get("trade-preview-symbol").textContent = displaySymbol(current);
    get("trade-company").textContent = quote?.name || nameFor(current) || "";
    tradeStatus.textContent = "";
    setTicketQuote(quote?.price, quote?.fromKiwoom ? "최근 조회가" : "저장된 종가");
    updateTradeTotal();
    trade.showModal();
    unsubscribeBook = subscribeOrderBook(current, onBookUpdate);
    loadTradeContext();
    if (side === "sell") loadPosition();
  }

  get("trade-preview-close").onclick = () => { if (!tradeBusy) trade.close(); };
  trade.addEventListener("cancel", event => {
    if (tradeBusy) event.preventDefault();
    event.stopPropagation();
  });
  function releaseTicket() {
    tradeVersion += 1;
    resetPosition();
    reviewId = null;
    unsubscribeBook?.();
    unsubscribeBook = undefined;
    if (bookPaint != null) cancelAnimationFrame(bookPaint);
    bookPaint = pendingBook = undefined;
  }
  trade.addEventListener("close", () => { if (!trade.open) releaseTicket(); });
  bookRefresh.onclick = loadTradeContext;
  for (const button of ticketSides) {
    button.onclick = () => {
      const side = button.dataset.ticketSide;
      if (tradeBusy || tradeForm.hidden || tradeSide === side) return;
      selectTradeSide(side);
      if (side === "sell") loadPosition();
      else resetPosition();
    };
  }
  get("trade-use-quote").onclick = () => setTradePrice(liveTradePrice ?? orderContext?.price);
  get("trade-pending").onclick = get("trade-review-pending").onclick = () => {
    if (!tradeBusy) orders.openPending();
  };
  for (const button of tradeForm.querySelectorAll("[data-trade-step]")) {
    button.onclick = () => {
      if (button.dataset.tradeStep === "price") {
        if (!Number.isFinite(price.valueAsNumber)) {
          setTradePrice(liveTradePrice ?? orderContext?.price);
          return;
        }
        const direction = Number(button.value);
        const currentPrice = price.valueAsNumber;
        const tick = currentPrice < 1 || currentPrice === 1 && direction < 0 ? 0.0001 : 0.01;
        const value = Number((currentPrice + direction * tick).toFixed(4));
        setTradePrice(Math.min(Number(price.max), Math.max(Number(price.min), value)));
      } else if (button.value === "1") quantity.stepUp();
      else quantity.stepDown();
      updateTradeTotal();
    };
  }
  tradeForm.addEventListener("input", () => {
    const decimals = price.value.split(".")[1]?.replace(/0+$/, "").length ?? 0;
    const invalid = decimals > (price.valueAsNumber >= 1 ? 2 : 4);
    price.setCustomValidity(invalid ? "$1 이상은 소수점 2자리, $1 미만은 4자리까지 입력할 수 있습니다." : "");
    priceHint.textContent = "";
    updateTradeTotal();
  });
  tradeForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (tradeBusy || tradeNext.disabled || !tradeForm.reportValidity()) return;
    const version = tradeVersion;
    let order = {side: tradeSide, kind:kind.value, quantity: quantity.value, price: price.disabled ? "" : price.value,
                 amount: price.disabled ? null : quantity.valueAsNumber * price.valueAsNumber};
    if (orderContext?.enabled) {
      tradeBusy = true;
      tradeNext.disabled = true;
      tradeStatus.textContent = "";
      tradeNext.textContent = "확인 중…";
      try {
        order = await orders.preview({...order, symbol: orderContext.symbol, exchange: orderContext.exchange});
      } catch (error) {
        if (version === tradeVersion) tradeStatus.textContent = error.message;
        return;
      } finally {
        tradeBusy = false;
        if (version === tradeVersion) {
          tradeNext.disabled = false;
          tradeNext.textContent = sideName[tradeSide] + " 주문 확인";
        }
      }
    }
    if (version !== tradeVersion || !trade.open) return;
    reviewId = order.id ?? null;
    get("trade-review-title").textContent = "주문 확인";
    tradeConfirm.textContent = sideName[order.side] + " 주문하기";
    get("trade-review-side").textContent = {buy:"Buy", sell:"Sell"}[order.side];
    get("trade-review-kind").textContent = orderKinds.get(order.kind);
    get("trade-review-quantity").textContent = Number(order.quantity).toLocaleString("ko-KR") + "주";
    get("trade-review-price").textContent = order.price ? dollars.format(order.price) : "시장가";
    get("trade-review-total").textContent = order.amount == null ? "체결 시 결정" : dollars.format(order.amount);
    tradeForm.hidden = true;
    tradeReview.hidden = false;
    tradeConfirm.disabled = !reviewId;
    tradeStatus.textContent = reviewId ? "" : previewOnly;
    get("trade-review-title").focus();
  });

  tradeEdit.onclick = () => {
    if (tradeBusy) return;
    reviewId = null;
    tradeConfirm.disabled = true;
    tradeReview.hidden = true;
    tradeForm.hidden = false;
    tradeStatus.textContent = orderContext?.enabled ? "" : previewOnly;
    quantity.focus();
  };

  tradeConfirm.onclick = async () => {
    if (tradeBusy || !reviewId) return;
    const id = reviewId;
    reviewId = null;
    tradeBusy = true;
    tradeConfirm.disabled = true;
    tradeEdit.disabled = true;
    tradeConfirm.textContent = "접수 중…";
    tradeStatus.textContent = "";
    try {
      const order = await orders.submit(id);
      get("trade-review-title").textContent = sideName[tradeSide] + " 주문 접수";
      tradeStatus.textContent = "키움 주문 접수 · 주문번호 " + order.number;
    } catch (error) {
      tradeStatus.textContent = error instanceof TypeError || error instanceof SyntaxError
        ? "전송 결과를 확인하지 못했습니다. 새 주문 전에 키움 주문 내역을 확인하세요."
        : error.message;
    } finally {
      tradeBusy = false;
      tradeEdit.hidden = true;
      tradeConfirm.hidden = true;
      get("trade-review-pending").hidden = false;
    }
  };

  function setFavorite() {
    const saved=readList().includes(current);
    get("stock-star").setAttribute("aria-pressed",String(saved));
    get("stock-star").setAttribute("aria-label",saved?"Remove from watchlist":"Add to watchlist");
  }
  const area = get("chart-area");
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York"
  });
  const coverage = get("chart-coverage");
  const chartStatus = get("chart-status");
  const sessionDate = get("chart-session-date");
  sessionDate.onchange = () => setFrame(frame);
  const minuteCache = new Map();
  const tabs = [...dialog.querySelectorAll("[data-panel]")];
  let chart = null, start = 0, lastStart = 0, windowSize = visibleBars, drag = null, requestId = 0;
  const touchPoints = new Map();
  let pinch;
  let geometry;
  const tools = setupChartTools({
    redraw:draw, moveTo, getView:()=>({start,windowSize}), alternatives:[...savedQuotes],
    async loadComparison(symbol, interval) {
      const data = await publicQuote(symbol);
      if (!data) return null;
      const bars = interval === "hour" ? data.hourly : isIntraday(interval) ? await minuteBars(symbol) : data.daily;
      return bars.length ? prepareChart(bars, interval) : null;
    }
  });
  const trends = {long:true, short:true, support:true, resistance:true, fibonacci:false};
  const trendKey = "jm-invest:chart-trends:v1";
  try {
    const saved = JSON.parse(localStorage.getItem(trendKey));
    for (const key of Object.keys(trends)) if (typeof saved?.[key] === "boolean") trends[key] = saved[key];
  } catch {}
  for (const [key, style] of Object.entries(trendStyles)) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    const sample=document.createElement("span"), name=document.createElement("span"), knob=document.createElement("span");
    sample.className="guide-sample"; knob.className="guide-switch";
    sample.setAttribute("aria-hidden","true"); knob.setAttribute("aria-hidden","true");
    name.textContent=style.label; toggle.append(sample,name,knob);
    toggle.setAttribute("role","switch");
    toggle.dataset.trend = key;
    toggle.style.setProperty("--guide",style.color);
    toggle.setAttribute("aria-checked",String(trends[key]));
    toggle.onclick = () => {
      trends[key] = !trends[key];
      toggle.setAttribute("aria-checked",String(trends[key]));
      try { localStorage.setItem(trendKey,JSON.stringify(trends)); } catch {}
      draw();
    };
    get("trend-controls").append(toggle);
  }

  function selectPanel(panel) {
    if (panel !== "chart") tools.pause();
    for (const tab of tabs) {
      const selected = tab.dataset.panel === panel;
      get(tab.getAttribute("aria-controls")).hidden = !selected;
      if (selected) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    if (panel === "strategies") strategy.showStock(current);
    if (panel === "sigma") showSigmaPanel(current, nameFor(current));
  }
  function refreshStockStrategy() {
    if(dialog.open && !get("stock-strategy-panel").hidden)strategy.showStock(current);
  }
  get("strategy-sheet").addEventListener("close",refreshStockStrategy);
  window.addEventListener("storage",refreshStockStrategy);
  for (const tab of tabs) tab.addEventListener("click", () => selectPanel(tab.dataset.panel));

  function draw() {
    area.classList.toggle("moving-drawing",tools.drawingOptions());
    if (!chart || !chart.bars.length || !dialog.open) return;
    const options = {...tools.chartOptions(), windowSize, trends};
    canvas.hidden = false;
    canvas.classList.toggle("with-rsi", options.lower === "RSI");
    clearInspector();
    geometry = drawChart(canvas, chart, frame, start, options);
    const end = Math.min(options.end ?? chart.bars.length, start + windowSize) - 1;
    if (geometry && canLoadChart() && !["BZMAIN","CLMAIN","VIX"].includes(current)) {
      executions.show(current,{bars:chart.bars,frame,start,end,geometry});
    }
    drawSecondary(start,end,options);
    const dates = [start, end].map(i => dateFormat.format(chart.bars[i][0] * 1000));
    get("chart-dates").textContent = dates.join(" – ");
  }
  function drawSecondary(start,end,options) {
    const secondary = tools.secondary();
    const plot = get("dual-market-chart");
    plot.hidden = !secondary;
    if (!secondary) return;
    const {symbol,chart:other} = secondary;
    const earliest = chart.bars[start][0], latest = chart.bars[end][0];
    const first = other.bars.findIndex(bar => bar[0] >= earliest);
    const next = other.bars.findIndex(bar => bar[0] > latest);
    const last = next === -1 ? other.bars.length : next;
    const show = first !== -1 && first < last;
    tools.secondaryCanvas.hidden = !show;
    get("dual-market-caption").textContent = show ? symbol : symbol + " · No candles in this date range";
    if (show) drawChart(tools.secondaryCanvas, other, frame, first, {
      ...options, end:last, windowSize:last-first, drawings:[], overlays:[], lower:"none", compare:null
    });
  }
  function moveTo(index) {
    const limit = tools.replayEnd() == null ? lastStart : Math.min(lastStart, tools.replayEnd() - 1);
    const next = Math.min(limit, Math.max(0, Math.round(index)));
    if (next !== start) {

      start = next;
      draw();
    }
  }
  const inspector=get("candle-inspector"), readout=inspector.querySelector(".candle-readout");
  const intradayStamp=new Intl.DateTimeFormat("ko-KR",{timeZone:"America/New_York",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  let holdTimer;
  function clearInspector(){
    clearTimeout(holdTimer);
    inspector.hidden=true;
  }
  function inspectAt(clientX,clientY){
    const hit=geometry?.inspect(clientX,clientY);
    if(!hit || canvas.hidden){inspector.hidden=true;return false;}
    const [time,o,h,l,c,v]=hit.bar;
    const fmt=n=>n.toFixed(n<1 ? 4 : 2);
    inspector.style.cssText="--cx:"+hit.x+"px;--cy:"+hit.y+"px;--ct:"+hit.top+"px;--cb:"+hit.bottom+"px;--cw:"+hit.width+"px;--cp:"+hit.pad+"px";
    inspector.querySelector(".cross-price").textContent=hit.price;
    readout.style.top=(hit.y<(hit.top+hit.bottom)/2 ? Math.max(hit.top,hit.bottom-62) : hit.top+2)+"px";
    readout.firstElementChild.textContent=(isIntraday(frame)?intradayStamp:dateFormat).format(time*1000)+(isIntraday(frame)?" ET":"");
    readout.lastElementChild.textContent="시 "+fmt(o)+"   고 "+fmt(h)+"   저 "+fmt(l)+"   종 "+fmt(c)+"   거래량 "+v.toLocaleString("ko-KR");
    inspector.hidden=false;return true;
  }
  area.addEventListener("pointerleave",e=>{if(e.pointerType==="mouse")clearInspector();});
  area.addEventListener("contextmenu",e=>{if(!inspector.hidden)e.preventDefault();});
  function endDrag() {
    clearInspector();
    if (drag && area.hasPointerCapture(drag.id)) area.releasePointerCapture(drag.id);
    drag = null;
    area.classList.remove("dragging");
  }
  function pinchGeometry() {
    const [first, second] = [...touchPoints.values()];
    const bounds = area.getBoundingClientRect();
    return {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      anchor: Math.max(0, Math.min(1, ((first.x + second.x) / 2 - bounds.left - (geometry?.pad ?? 8)) / Math.max(1, (geometry?.width ?? bounds.width-45) - (geometry?.pad ?? 8))))
    };
  }

  area.addEventListener("pointerdown", event => {
    clearInspector();
    if (!chart || event.button !== 0 || event.target.closest("#drawing-actions")) return;
    const flag = event.target.closest(".execution-flag");
    if (flag && event.pointerType !== "touch") return;
    if (event.pointerType === "touch" && !tools.activeDrawing() && !tools.drawingOptions()) {
      if (touchPoints.size >= 2) return;
      touchPoints.set(event.pointerId, {x:event.clientX, y:event.clientY});
      area.setPointerCapture(event.pointerId);
      if (touchPoints.size === 2) {
        const {distance, anchor} = pinchGeometry();
        pinch = {distance:Math.max(1, distance), windowSize, index:start + anchor * Math.min(windowSize, chart.bars.length - start)};
        drag = null;
        area.classList.remove("dragging");
        return;
      }
    }
    if (!event.isPrimary) return;
    const points = tools.pointsToMove();
    if (points) {
      const origin = geometry?.point(event.clientX,event.clientY);
      if (!origin) return;
      drag = {id:event.pointerId,points,origin};
      area.setPointerCapture(event.pointerId);
      return;
    }
    if (tools.activeDrawing()) {
      tools.addPoint(geometry?.point(event.clientX,event.clientY));
      if (tools.activeDrawing() === "freehand") {
        drag = {id:event.pointerId,freehand:true};
        area.setPointerCapture(event.pointerId);
      }
      return;
    }
    drag = {id: event.pointerId, x: event.clientX, y:event.clientY, start, moved:false, flag,
      step: geometry?.step ?? 1};
    area.setPointerCapture(event.pointerId);
    if(event.pointerType==="touch" && !flag){
      const id=event.pointerId;
      holdTimer=setTimeout(()=>{
        if(drag?.id===id && !drag.moved && !pinch && inspectAt(drag.x,drag.y))drag.inspect=true;
      },400);
    }
    area.classList.add("dragging");
  });
  area.addEventListener("pointermove", event => {
    if(event.pointerType==="mouse" && !drag && !tools.activeDrawing() && !tools.drawingOptions()){
      if(event.target===canvas)inspectAt(event.clientX,event.clientY);else clearInspector();
      return;
    }
    if(drag?.inspect && drag.id===event.pointerId){inspectAt(event.clientX,event.clientY);return;}
    if (touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, {x:event.clientX, y:event.clientY});
      if (pinch && chart && touchPoints.size === 2) {
        const {distance, anchor} = pinchGeometry();
        const count = tools.replayEnd() ?? chart.bars.length;
        const max = count;

        windowSize = Math.max(Math.min(8, max), Math.min(max,
          Math.round(pinch.windowSize * pinch.distance / Math.max(1, distance))));
        lastStart = Math.max(0, chart.bars.length - windowSize);
        start = Math.max(0, Math.min(count - windowSize, Math.round(pinch.index - anchor * windowSize)));
        area.classList.toggle("pannable", lastStart > 0);
        draw();
        return;
      }
    }
    if (drag?.id !== event.pointerId) return;
    if (drag.freehand) {
      tools.addPoint(geometry?.point(event.clientX,event.clientY));
    } else if (drag.points) {
      const target = geometry?.point(event.clientX,event.clientY);
      if (target) tools.moveDrawing(geometry.translate(drag.points,drag.origin,target));
    } else {
      drag.moved ||= Math.hypot(drag.x-event.clientX,drag.y-event.clientY)>7;
      if(drag.moved)clearInspector();
      if (drag.moved && lastStart) moveTo(drag.start + (drag.x - event.clientX) / drag.step);
    }
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    area.addEventListener(type, event => {
      if (touchPoints.delete(event.pointerId)) pinch = null;
      if (drag?.id !== event.pointerId) return;
      if(drag.inspect){endDrag();return;}
      if (drag.freehand) tools.finishFreehand();
      else if (drag.points) tools.finishMove();
      else if (type === "pointerup" && !drag.moved && drag.flag?.isConnected) drag.flag.click();
      else if (type === "pointerup" && !drag.moved && tools.replayEnd() == null) {
        tools.selectDrawing(geometry?.hitDrawing(event.clientX,event.clientY));
      }
      endDrag();
    });
  }
  new ResizeObserver(draw).observe(area);
  function finishFrame(source, preserve = false) {
    clearInspector();
    const anchor = preserve && chart?.bars[start]?.[0];
    const atLatest = start === lastStart;
    chart = source?.length ? prepareChart(source, frame) : null;
    get("trend-menu").hidden = !chart;
    if (!preserve) windowSize = visibleBars;
    touchPoints.clear();
    pinch = null;
    lastStart = Math.max(0, (chart?.bars.length || 0) - windowSize);
    start = lastStart;
    if (anchor && chart && !atLatest) {
      const index = chart.bars.findIndex(bar => bar[0] >= anchor);
      if (index >= 0) start = Math.min(index,lastStart);
    }
    get("chart-history").hidden = !chart;
    area.classList.toggle("pannable", lastStart > 0);
    area.classList.toggle("zoomable", Boolean(chart));
    if (anchor && chart) tools.extendSeries(chart);
    else tools.updateSeries(chart,current,frame);
    if (chart) {
      const startDate = dateFormat.format(source[0][0] * 1000);
      const endDate = dateFormat.format(source.at(-1)[0] * 1000);
      coverage.textContent = (isIntraday(frame) ? "Intraday history" : historyState || "Available history")
        + " · " + startDate + " – " + endDate + " ET";
      draw();
    } else {
      canvas.hidden = true;
      executions.reset();
      get("dual-market-chart").hidden = true;
    }
  }
  function minuteBars(symbol) {
    if (!minuteCache.has(symbol)) {
      const loading = fetch("./assets/intraday/" + encodeURIComponent(symbol) + ".json?v=47")
        .then(response => {
          if (!response.ok) throw new Error("Missing minute series");
          return response.json();
        }).catch(error => {
          minuteCache.delete(symbol);
          throw error;
        });
      minuteCache.set(symbol, loading);
    }
    return minuteCache.get(symbol);
  }
  async function setFrame(value) {
    const id = ++requestId;
    endDrag();
    frame = value;
    get("chart-session-picker").hidden = !isIntraday(value) || !quote?.fromKiwoom;
    chartStatus.hidden = true;
    for (const button of get("stock-frames").children) {
      button.setAttribute("aria-pressed", String(button.dataset.frame === frame));
    }
    if (!quote || !isIntraday(value) || value === "hour" && !quote.fromKiwoom) {
      finishFrame(quote && (value === "hour" ? quote.hourly : quote.daily));
      return;
    }
    finishFrame(null);
    chartStatus.textContent = "Loading intraday history…";
    chartStatus.hidden = false;
    try {
      const source = quote.fromKiwoom ? (await loadChart(current, value, null, historyAbort?.signal, sessionDate.value))?.bars : await minuteBars(current);
      if (id !== requestId) return;
      chartStatus.hidden = Boolean(source?.length);
      if (!source?.length) chartStatus.textContent = sessionDate.value ? "No intraday bars for this trading date." : "Intraday history is unavailable for this interval.";
      finishFrame(source);
    } catch {
      if (id === requestId) chartStatus.textContent = "Intraday history is temporarily unavailable. Select another interval.";
    }
  }
  function renderQuote(preserve = false) {
    const pct = quote.percent, price = quote.price;
    const hasChange = Number.isFinite(price) && Number.isFinite(pct) && pct > -100;
    const compact = new Intl.NumberFormat("en-US", {notation:"compact",maximumFractionDigits:2});
    get("stock-price").textContent = Number.isFinite(price) ? price.toFixed(2) : "—";
    get("stock-change").textContent = hasChange
      ? (pct < 0 ? "▼ " : "▲ ") + signed(price - price / (1 + pct / 100)) + "  " + signed(pct) + "%" : "";
    if (hasChange) get("stock-price").parentElement.dataset.direction = pct < 0 ? "down" : "up";
    get("stock-range").textContent = Number.isFinite(quote.high) && Number.isFinite(quote.low)
      ? quote.low.toFixed(2) + "–" + quote.high.toFixed(2) : "—";
    get("stock-volume").textContent = Number.isFinite(quote.volume) ? compact.format(quote.volume) : "—";
    get("stock-cap").textContent = Number.isFinite(quote.marketCap) ? compact.format(quote.marketCap)
      : current === "SKHY" ? "754.89B" : "—";
    get("stock-name").textContent = [quote.name || nameFor(current), quote.exchange === "NasdaqGS" ? "NASDAQ" : quote.exchange].filter(Boolean).join("  ");
    get("stock-quote-source").hidden = false;
    get("stock-quote-source").textContent = quote.source || (quote.fromKiwoom ? "Kiwoom" : "Snapshot");
    get("stock-chart-sign-in").hidden = isSignedIn();
    const when = Number.isFinite(quote.asOf) ? dateFormat.format(quote.asOf * 1000) : "";
    get("stock-time").textContent = quote.fromKiwoom ? "Latest quote"
      : current === "SKHY" ? "Closed 19:59 11/20 ET" : "Closed · " + when + " ET";
    get("stock-frames").hidden=false;
    if (!preserve || !chart) setFrame(frame);
    else if (!isIntraday(frame)) finishFrame(quote.daily, true);
  }
  async function loadInstrumentQuote(symbol) {
    const id = ++quoteRequest;
    get("stock-quote-retry").hidden = true;
    historyAbort?.abort();
    historyAbort = new AbortController();
    const signal = historyAbort.signal;
    let message = "Chart unavailable";
    try {
      const saved = await publicQuote(symbol);
      if (id !== quoteRequest) return;
      if (saved && !quote) {
        quote = saved;
        renderQuote();
      }
      if (canLoadChart()) {
        const result = await loadChart(symbol, "day", null, signal);
        if (id !== quoteRequest || !result) return;
        const asOf = new Date().toISOString().slice(0,10);
        const cached = fullHistory.get(symbol);
        let before = cached?.asOf === asOf ? null : result.before;
        let bars = mergeDaily(cached?.asOf === asOf ? cached.bars : saved?.daily, result.daily);
        quote = {...saved, ...result, daily:bars, fromKiwoom:!result.source};
        historyState = before ? "Loading earlier history…" : "";
        renderQuote(Boolean(chart));
        while (before) {
          const part = await loadChart(symbol, "day", before, signal);
          if (id !== quoteRequest) return;
          if (!Array.isArray(part?.bars) || part.before && part.before >= before) throw Error("Invalid history page");
          before = part.before;
          bars = mergeDaily(bars, part.bars);
          quote.daily = bars;
          historyState = before ? "Loading earlier history…" : "";
          if (!isIntraday(frame)) finishFrame(bars, Boolean(chart));
        }
        if (fullHistory.size >= 24) fullHistory.delete(fullHistory.keys().next().value);
        fullHistory.set(symbol, {asOf,bars});
        return;
      }
      if (saved) return;
    } catch (error) {
      message = error.message;
      if (id === quoteRequest && quote?.daily?.length) {
        historyState = "Partial history";
        if (!isIntraday(frame)) finishFrame(quote.daily, Boolean(chart));
        return;
      }
    }
    if (id !== quoteRequest) return;
    get("stock-time").textContent = isSignedIn() ? message : "Sign in to load the chart.";
    get("stock-quote-source").hidden = true;
    get("stock-chart-sign-in").hidden = isSignedIn();
    get("stock-quote-retry").hidden = !canLoadChart();
    get("stock-frames").hidden = true;
  }
  async function open(symbol) {
    executions.reset();
    get("trend-menu").open=false;
    if (trade.open) trade.close();
    if(dialog.contains(get("strategy-sheet")))strategy.close();
    current=symbol;quote=null;historyState="";sessionDate.value="";
    selectPanel("chart");
    document.body.classList.add("instrument-open");
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop=0;
    dialog.classList.remove("expanded");
    get("stock-expand").setAttribute("aria-pressed","false");
    get("stock-price").parentElement.removeAttribute("data-direction");
    get("stock-symbol").textContent=displaySymbol(symbol);
    document.title=displaySymbol(symbol)+" · TradeInSight";
    get("stock-name").textContent=nameFor(symbol);
    for (const id of ["stock-price","stock-range","stock-volume","stock-cap"]) get(id).textContent="—";
    get("stock-change").textContent="";get("stock-time").textContent="Loading quote…";
    get("stock-quote-source").hidden = true;
    get("stock-chart-sign-in").hidden = isSignedIn();
    get("external-chart").replaceChildren();get("external-chart").hidden=true;
    canvas.hidden=true;get("stock-frames").hidden=true;
    setFavorite();setFrame("day");
    await loadInstrumentQuote(symbol);
  }
  function sync() {
    const symbol=new URLSearchParams(location.hash.slice(1)).get("stock")?.toUpperCase();
    if (symbol && validSymbol.test(symbol)) {
      if(symbol!==current)open(symbol);
      return;
    }
    requestId += 1;
    quoteRequest += 1;
    historyAbort?.abort();
    if (trade.open) trade.close();
    if(dialog.contains(get("strategy-sheet")))strategy.close();
    executions.reset();
    current="";quote=null;chart=null;endDrag();
    tools.updateSeries(null,current,frame);
    if(dialog.open) dialog.close();
    document.body.classList.remove("instrument-open");
    get("external-chart").replaceChildren();
    document.title="TradeInSight";
    if(afterClose){const fn=afterClose;afterClose=null;fn();}
  }
  function back(action) {
    afterClose=action;
    if(history.state?.stockEntry) history.back();
    else {history.replaceState(null,"",location.pathname+location.search);sync();}
  }
  get("stock-back").onclick=()=>back();
  dialog.addEventListener("cancel",e=>{e.preventDefault();back();});
  get("stock-search").onclick=()=>back(search);
  get("stock-chart-sign-in").onclick = () => {
    const symbol = current;
    back(() => signIn(symbol));
  };
  get("stock-quote-retry").onclick = () => loadInstrumentQuote(current);
  get("stock-buy").onclick = () => openTrade("buy");
  get("stock-sell").onclick = () => openTrade("sell");
  get("stock-star").onclick=()=>{
    const items=readList();
    if(saveList(items.includes(current)?items.filter(v=>v!==current):[...items,current]))setFavorite();
  };
  get("stock-frames").onclick=e=>{if(e.target.dataset.frame)setFrame(e.target.dataset.frame);};
  get("stock-expand").onclick=()=>{
    const expanded=dialog.classList.toggle("expanded");
    get("stock-expand").setAttribute("aria-pressed",String(expanded));
    dialog.scrollTop=0;draw();
  };
  window.addEventListener("hashchange",sync);
  window.addEventListener("popstate",sync);
  sync();
  return {
    leave:back,
    clearAccountData() { resetPosition(); executions.reset(); },
    open(symbol) {
      history.pushState({stockEntry:true},"","#stock="+encodeURIComponent(symbol));
      sync();
    },
    refresh() {
      get("stock-chart-sign-in").hidden=isSignedIn();
      if (current && canLoadChart()) loadInstrumentQuote(current);
    }
  };
}
