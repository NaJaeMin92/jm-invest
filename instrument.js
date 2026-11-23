import {prepareChart, drawChart, isIntraday, visibleBars} from "./instrument-chart.js?v=71";
import {showMarketPanel} from "./market-panels.js?v=68";

import {setupChartTools} from "./chart-tools.js?v=58";

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
export function sparkline(values) {
  const ns = "http://www.w3.org/2000/svg";
  const svg=document.createElementNS(ns,"svg"), path=document.createElementNS(ns,"polyline");
  const min=Math.min(...values), max=Math.max(...values);
  svg.setAttribute("viewBox","0 0 100 44");
  svg.setAttribute("preserveAspectRatio","none");
  path.setAttribute("points",values.map((v,i)=>[(i*99/(values.length-1 || 1)).toFixed(2),(41-38*(v-min)/(max-min||1)).toFixed(2)].join(",")).join(" "));
  path.setAttribute("fill","none");path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width","1.6");
  svg.append(path);
  return svg;
}
const signed = n => (n>=0?"+":"")+n.toFixed(2);
const displaySymbol = s => ({BZMAIN:"BZmain",CLMAIN:"CLmain"}[s] || s);
const validSymbol = /^[A-Z][A-Z0-9.\-]{0,11}$/;

export function setupInstrument({search,nameFor,readList,saveList,orders,subscribeOrderBook,canLoadChart,loadChart,signIn}) {
  const dialog=get("stock-detail"), canvas=get("market-chart"), reference=get("daily-reference");
  let current="", quote=null, frame="day", afterClose=null, quoteRequest=0;
  const trade = get("trade-preview");
  const tradeForm = get("trade-preview-form"), tradeReview = get("trade-preview-review");
  const tradeStatus = get("trade-preview-status"), tradeNext = get("trade-preview-next");
  const tradeConfirm = get("trade-preview-confirm"), tradeEdit = get("trade-preview-edit");
  const bookLevels = get("trade-book-levels"), bookRefresh = get("trade-book-refresh");
  const bookStatus = get("trade-book-status"), bookMarket = get("trade-book-market");
  const bookMode = get("trade-book-mode"), bestPrice = get("trade-use-best");
  const ticketSides = [...tradeForm.querySelectorAll("[data-ticket-side]")];
  const quantity = tradeForm.querySelector('[name="quantity"]');
  const price = tradeForm.querySelector('[name="price"]');
  const priceHint = get("trade-price-hint");
  const dollars = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 4
  });
  const won = new Intl.NumberFormat("ko-KR", {style: "currency", currency: "KRW"});
  const sideName = {buy: "매수", sell: "매도"};
  const previewOnly = "미리보기 모드입니다. 실계좌 주문은 이 Mac의 비공개 서버에서 할 수 있습니다.";
  let tradeSide, orderContext, reviewId, tradeBusy = false, tradeVersion = 0;
  let unsubscribeBook, pendingBook, bookPaint, bookRevision = 0, liveTradePrice, displayedBook;

  function selectTradeSide(side) {
    tradeSide = side;
    trade.dataset.side = side;
    get("trade-preview-title").textContent = sideName[side] + " 주문";
    tradeNext.textContent = sideName[side] + " 검토";
    for (const button of ticketSides) {
      button.setAttribute("aria-pressed", String(button.dataset.ticketSide === side));
    }
    refreshBestPrice();
  }

  function oppositePrice() {
    return (tradeSide === "buy" ? displayedBook?.asks : displayedBook?.bids)?.[0]?.price;
  }

  function refreshBestPrice() {
    bestPrice.hidden = !Number.isFinite(oppositePrice());
    bestPrice.textContent = tradeSide === "buy" ? "최우선 매도호가" : "최우선 매수호가";
  }

  function updateTradeTotal() {
    const amount = quantity.valueAsNumber * price.valueAsNumber;
    const valid = quantity.validity.valid && price.validity.valid && Number.isFinite(amount);
    get("trade-preview-total").textContent = valid ? dollars.format(amount) : "—";
    const converted = get("trade-preview-krw");
    converted.hidden = !valid || !Number.isFinite(orderContext?.fx);
    converted.textContent = converted.hidden ? "" : "약 " + won.format(amount * orderContext.fx);
    for (const button of bookLevels.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.price) === price.valueAsNumber));
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

  function renderBookSide(container, levels) {
    const largest = Math.max(1, ...levels.map(level => level.quantity ?? 0));
    while (container.children.length > levels.length) container.lastElementChild.remove();
    levels.forEach((level, index) => {
      let button = container.children[index];
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.append(document.createElement("span"), document.createElement("small"));
        button.onclick = () => setTradePrice(Number(button.dataset.price));
        container.append(button);
      }
      button.dataset.price = level.price;
      button.style.setProperty("--depth", (100 * (level.quantity ?? 0) / largest) + "%");
      button.firstElementChild.textContent = dollars.format(level.price);
      button.lastElementChild.textContent = level.quantity?.toLocaleString("ko-KR") ?? "—";
    });
  }

  function showTradeQuote(value) {
    if (!Number.isFinite(value)) return;
    const currentPrice = get("trade-preview-quote");
    currentPrice.hidden = false;
    currentPrice.textContent = "키움 현재가 · " + dollars.format(value);
    get("trade-use-quote").hidden = false;
    get("trade-book-price").textContent = dollars.format(value);
  }

  function showOrderBook(book) {
    displayedBook = book;
    const centerBook = bookLevels.hidden;
    bookLevels.hidden = !(book.asks?.length || book.bids?.length);
    bookStatus.hidden = !bookLevels.hidden;
    bookStatus.textContent = "표시할 호가가 없습니다.";
    bookMode.textContent = book.live ? "실시간" : bookLevels.hidden ? "" : "최근 호가";
    bookMode.dataset.live = String(Boolean(book.live));
    get("trade-book-time").textContent = [book.date, book.time].filter(Boolean).join(" ");
    renderBookSide(get("trade-book-asks"), [...(book.asks ?? [])].reverse());
    renderBookSide(get("trade-book-bids"), book.bids ?? []);
    if (centerBook && !bookLevels.hidden) {
      bookLevels.scrollTop = bookMarket.offsetTop + (bookMarket.offsetHeight - bookLevels.clientHeight) / 2;
    }
    refreshBestPrice();
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
      pendingBook = {...update.book, live: true,
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
    tradeVersion += 1;
    selectTradeSide(side);
    orderContext = null;
    reviewId = null;
    displayedBook = undefined;
    refreshBestPrice();
    bookMode.textContent = "";
    bookMode.dataset.live = "false";
    bookRevision = 0;
    liveTradePrice = undefined;
    tradeForm.reset();
    price.setCustomValidity("");
    priceHint.textContent = "";
    tradeForm.hidden = false;
    tradeReview.hidden = true;
    tradeNext.disabled = true;
    tradeConfirm.disabled = true;
    tradeEdit.disabled = false;
    bookLevels.hidden = true;
    bookStatus.hidden = false;
    bookStatus.textContent = "호가 조회 중…";
    get("trade-book-time").textContent = "";
    get("trade-use-quote").hidden = true;
    get("trade-preview-symbol").textContent = displaySymbol(current);
    tradeStatus.textContent = "키움 주문 정보를 확인 중입니다.";
    const referencePrice = get("trade-preview-quote");
    referencePrice.hidden = !Number.isFinite(quote?.price);
    referencePrice.textContent = referencePrice.hidden ? ""
      : (quote.fromKiwoom ? "키움 조회가 · " : "저장된 종가 · ") + dollars.format(quote.price);
    updateTradeTotal();
    trade.showModal();
    unsubscribeBook = subscribeOrderBook(current, onBookUpdate);
    loadTradeContext();
  }

  get("trade-preview-close").onclick = () => { if (!tradeBusy) trade.close(); };
  trade.addEventListener("cancel", event => {
    if (tradeBusy) event.preventDefault();
    event.stopPropagation();
  });
  trade.addEventListener("close", () => {
    tradeVersion += 1;
    reviewId = null;
    unsubscribeBook?.();
    unsubscribeBook = undefined;
    if (bookPaint != null) cancelAnimationFrame(bookPaint);
    bookPaint = pendingBook = undefined;
  });
  bookRefresh.onclick = loadTradeContext;
  for (const button of ticketSides) {
    button.onclick = () => {
      if (!tradeBusy && !tradeForm.hidden) selectTradeSide(button.dataset.ticketSide);
    };
  }
  get("trade-use-quote").onclick = () => setTradePrice(liveTradePrice ?? orderContext?.price);
  bestPrice.onclick = () => setTradePrice(oppositePrice());
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
    let order = {side: tradeSide, quantity: quantity.value, price: price.value,
                 amount: quantity.valueAsNumber * price.valueAsNumber};
    if (orderContext?.enabled) {
      tradeBusy = true;
      tradeNext.disabled = true;
      tradeStatus.textContent = "주문 내용을 확인 중입니다.";
      try {
        order = await orders.preview({...order, symbol: orderContext.symbol, exchange: orderContext.exchange});
      } catch (error) {
        if (version === tradeVersion) tradeStatus.textContent = error.message;
        return;
      } finally {
        tradeBusy = false;
        if (version === tradeVersion) tradeNext.disabled = false;
      }
    }
    if (version !== tradeVersion || !trade.open) return;
    reviewId = order.id ?? null;
    get("trade-review-side").textContent = sideName[order.side];
    get("trade-review-quantity").textContent = Number(order.quantity).toLocaleString("ko-KR") + "주";
    get("trade-review-price").textContent = dollars.format(order.price);
    get("trade-review-total").textContent = dollars.format(order.amount);
    tradeForm.hidden = true;
    tradeReview.hidden = false;
    tradeConfirm.disabled = !reviewId;
    tradeStatus.textContent = reviewId ? "지정가와 수량을 확인한 뒤 실계좌 주문을 전송하세요." : previewOnly;
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
    tradeStatus.textContent = "키움에 주문을 전송 중입니다.";
    try {
      const order = await orders.submit(id);
      tradeStatus.textContent = "키움 주문 접수 · 주문번호 " + order.number;
    } catch (error) {
      tradeStatus.textContent = error instanceof TypeError || error instanceof SyntaxError
        ? "전송 결과를 확인하지 못했습니다. 새 주문 전에 키움 주문 내역을 확인하세요."
        : error.message;
    } finally {
      tradeBusy = false;
    }
  };

  function setFavorite() {
    const saved=readList().includes(current);
    get("stock-star").setAttribute("aria-pressed",String(saved));
    get("stock-star").setAttribute("aria-label",saved?"Remove from watchlist":"Add to watchlist");
  }
  const area = get("chart-area"), latest = get("chart-latest");
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York"
  });
  const first = get("chart-first"), coverage = get("chart-coverage");
  const chartStatus = get("chart-status");
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
  function selectPanel(panel) {
    if (panel !== "chart") tools.pause();
    for (const tab of tabs) {
      const selected = tab.dataset.panel === panel;
      get(tab.getAttribute("aria-controls")).hidden = !selected;
      if (selected) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    if (panel !== "chart") showMarketPanel(panel, current, nameFor(current));
  }
  for (const tab of tabs) tab.addEventListener("click", () => selectPanel(tab.dataset.panel));

  function draw() {
    area.classList.toggle("moving-drawing",tools.drawingOptions());
    if (!chart || !chart.bars.length || !dialog.open) return;
    const snapshot = current === "SKHY" && frame === "day" && start === lastStart
      && windowSize === visibleBars && tools.canUseSnapshot();
    reference.hidden = !snapshot;
    canvas.hidden = snapshot;
    const options = {...tools.chartOptions(), windowSize};
    geometry = snapshot ? null : drawChart(canvas, chart, frame, start, options);
    const end = Math.min(options.end ?? chart.bars.length, start + windowSize) - 1;
    drawSecondary(start,end,options);
    const dates = [start, end].map(i => dateFormat.format(chart.bars[i][0] * 1000));
    get("chart-dates").textContent = dates.join(" – ");
    latest.disabled = options.end != null || start === lastStart;
    first.disabled = start === 0;
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
  function endDrag() {
    if (drag && area.hasPointerCapture(drag.id)) area.releasePointerCapture(drag.id);
    drag = null;
    area.classList.remove("dragging");
  }
  function pinchGeometry() {
    const [first, second] = [...touchPoints.values()];
    const bounds = area.getBoundingClientRect();
    return {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      anchor: Math.max(0, Math.min(1, ((first.x + second.x) / 2 - bounds.left - 8) / Math.max(1, bounds.width - 48)))
    };
  }

  area.addEventListener("pointerdown", event => {
    if (!chart || event.button !== 0 || event.target.closest("#drawing-actions")) return;
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
    drag = {id: event.pointerId, x: event.clientX, y:event.clientY, start, moved:false,
      step: Math.max(1, (area.clientWidth - 48) / windowSize)};
    area.setPointerCapture(event.pointerId);
    area.classList.add("dragging");
  });
  area.addEventListener("pointermove", event => {
    if (touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, {x:event.clientX, y:event.clientY});
      if (pinch && chart && touchPoints.size === 2) {
        const {distance, anchor} = pinchGeometry();
        const count = tools.replayEnd() ?? chart.bars.length;
        const max = Math.min(240, count);
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
      if (drag.moved && lastStart) moveTo(drag.start + (drag.x - event.clientX) / drag.step);
    }
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    area.addEventListener(type, event => {
      if (touchPoints.delete(event.pointerId)) pinch = null;
      if (drag?.id !== event.pointerId) return;
      if (drag.freehand) tools.finishFreehand();
      else if (drag.points) tools.finishMove();
      else if (type === "pointerup" && !drag.moved && tools.replayEnd() == null) {
        tools.selectDrawing(geometry?.hitDrawing(event.clientX,event.clientY));
      }
      endDrag();
    });
  }
  latest.addEventListener("click", () => moveTo(lastStart));
  first.addEventListener("click", () => moveTo(0));
  new ResizeObserver(draw).observe(area);
  function finishFrame(source) {
    chart = source?.length ? prepareChart(source, frame) : null;
    windowSize = visibleBars;
    touchPoints.clear();
    pinch = null;
    lastStart = Math.max(0, (chart?.bars.length || 0) - windowSize);
    start = lastStart;
    get("chart-history").hidden = !chart;
    area.classList.toggle("pannable", lastStart > 0);
    area.classList.toggle("zoomable", Boolean(chart));
    tools.updateSeries(chart,current,frame);
    if (chart) {
      const startDate = dateFormat.format(source[0][0] * 1000);
      const endDate = dateFormat.format(source.at(-1)[0] * 1000);
      coverage.textContent = (isIntraday(frame) ? "Intraday snapshot" : quote?.fromKiwoom ? "Available history" : "Available since first recorded session")
        + " · " + startDate + " – " + endDate + " ET";
      draw();
    } else {
      reference.hidden = true;
      canvas.hidden = true;
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
      const source = quote.fromKiwoom ? (await loadChart(current, value))?.bars : await minuteBars(current);
      if (id !== requestId) return;
      chartStatus.hidden = Boolean(source?.length);
      if (!source?.length) chartStatus.textContent = "Intraday history is unavailable for this interval.";
      finishFrame(source);
    } catch {
      if (id === requestId) chartStatus.textContent = "Intraday history is temporarily unavailable. Select another interval.";
    }
  }
  function renderQuote() {
    const pct = quote.percent, price = quote.price;
    const hasChange = Number.isFinite(price) && Number.isFinite(pct) && pct > -100;
    const compact = new Intl.NumberFormat("en-US", {notation:"compact",maximumFractionDigits:2});
    get("stock-price").textContent = Number.isFinite(price) ? price.toFixed(2) : "—";
    get("stock-change").textContent = hasChange
      ? (pct < 0 ? "▼ " : "▲ ") + signed(price - price / (1 + pct / 100)) + "  " + signed(pct) + "%" : "";
    if (hasChange) get("stock-price").parentElement.dataset.direction = pct < 0 ? "down" : "up";
    get("stock-range").textContent = Number.isFinite(quote.high) && Number.isFinite(quote.low)
      ? quote.high.toFixed(2) + "–" + quote.low.toFixed(2) : "—";
    get("stock-volume").textContent = Number.isFinite(quote.volume) ? compact.format(quote.volume) : "—";
    get("stock-cap").textContent = Number.isFinite(quote.marketCap) ? compact.format(quote.marketCap)
      : current === "SKHY" ? "754.89B" : "—";
    get("stock-name").textContent = (current === "SKHY" ? "SK Hynix Inc" : quote.name)
      + "  " + (quote.exchange === "NasdaqGS" ? "NASDAQ" : quote.exchange);
    get("stock-quote-source").hidden = false;
    get("stock-quote-source").textContent = quote.fromKiwoom ? "Kiwoom" : "Snapshot";
    get("stock-chart-sign-in").hidden = true;
    const when = Number.isFinite(quote.asOf) ? dateFormat.format(quote.asOf * 1000) : "";
    get("stock-time").textContent = quote.fromKiwoom ? "Latest quote"
      : current === "SKHY" ? "Closed 19:59 11/20 ET" : "Closed · " + when + " ET";
    get("stock-frames").hidden=false;
    setFrame(frame);
  }
  async function loadInstrumentQuote(symbol) {
    const id = ++quoteRequest;
    let message = "Chart unavailable";
    try {
      let data = await publicQuote(symbol);
      if (id !== quoteRequest) return;
      if (!data && canLoadChart()) {
        const result = await loadChart(symbol, "day");
        if (result) data = {...result, fromKiwoom: true};
      }
      if (id !== quoteRequest) return;
      if (data) {
        quote = data;
        renderQuote();
        return;
      }
    } catch (error) {
      message = error.message;
    }
    if (id !== quoteRequest) return;
    get("stock-time").textContent = canLoadChart() ? message : "Sign in to load the chart.";
    get("stock-quote-source").hidden = true;
    get("stock-chart-sign-in").hidden = canLoadChart();
    get("stock-frames").hidden = true;
  }
  async function open(symbol) {
    if (trade.open) trade.close();
    current=symbol;quote=null;
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
    get("stock-chart-sign-in").hidden = true;
    get("external-chart").replaceChildren();get("external-chart").hidden=true;
    canvas.hidden=true;reference.hidden=true;get("stock-frames").hidden=true;
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
    if (trade.open) trade.close();
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
  get("stock-chart-sign-in").onclick = () => back(signIn);
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
    open(symbol) {
      history.pushState({stockEntry:true},"","#stock="+encodeURIComponent(symbol));
      sync();
    },
    refresh() {
      if (current && !quote && canLoadChart()) loadInstrumentQuote(current);
    }
  };
}
