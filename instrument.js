import {prepareChart, drawChart, isIntraday, visibleBars} from "./instrument-chart.js?v=58";
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

export function setupInstrument({search,nameFor,readList,saveList,orders}) {
  const dialog=get("stock-detail"), canvas=get("market-chart"), reference=get("daily-reference");
  let current="", quote=null, frame="day", afterClose=null;
  const trade = get("trade-preview");
  const tradeForm = get("trade-preview-form"), tradeReview = get("trade-preview-review");
  const tradeStatus = get("trade-preview-status"), tradeNext = get("trade-preview-next");
  const tradeConfirm = get("trade-preview-confirm"), tradeEdit = get("trade-preview-edit");
  const book = get("trade-book"), bookRefresh = get("trade-book-refresh");
  const quantity = tradeForm.querySelector('[name="quantity"]');
  const price = tradeForm.querySelector('[name="price"]');
  const dollars = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 4
  });
  const won = new Intl.NumberFormat("ko-KR", {style: "currency", currency: "KRW"});
  const sideName = {buy: "매수", sell: "매도"};
  const previewOnly = "미리보기 모드입니다. 실계좌 주문은 이 Mac의 비공개 서버에서 할 수 있습니다.";
  let tradeSide, orderContext, reviewId, tradeBusy = false, tradeVersion = 0;

  function updateTradeTotal() {
    const amount = quantity.valueAsNumber * price.valueAsNumber;
    const valid = quantity.validity.valid && price.validity.valid && Number.isFinite(amount);
    get("trade-preview-total").textContent = valid ? dollars.format(amount) : "—";
    const converted = get("trade-preview-krw");
    converted.hidden = !valid || !Number.isFinite(orderContext?.fx);
    converted.textContent = converted.hidden ? "" : "약 " + won.format(amount * orderContext.fx);
  }

  function setTradePrice(value) {
    if (!Number.isFinite(value)) return;
    price.value = value.toFixed(4);
    updateTradeTotal();
  }

  function renderBookSide(container, levels) {
    container.replaceChildren(...(levels ?? []).map(level => {
      const button = document.createElement("button");
      button.type = "button";
      const value = document.createElement("span");
      value.textContent = dollars.format(level.price);
      const volume = document.createElement("small");
      volume.textContent = level.quantity?.toLocaleString("ko-KR") ?? "—";
      button.append(value, volume);
      button.onclick = () => setTradePrice(level.price);
      return button;
    }));
  }

  async function loadTradeContext() {
    const version = tradeVersion;
    bookRefresh.disabled = true;
    try {
      const context = await orders.stockContext(current);
      if (version !== tradeVersion || !trade.open) return;
      orderContext = context;
      tradeStatus.textContent = context?.enabled ? "" : previewOnly;
      const currentPrice = get("trade-preview-quote");
      if (Number.isFinite(context?.price)) {
        currentPrice.hidden = false;
        currentPrice.textContent = "키움 현재가 · " + dollars.format(context.price);
        get("trade-use-quote").hidden = false;
      }
      book.hidden = !(context?.asks?.length || context?.bids?.length);
      get("trade-book-time").textContent = [context?.date, context?.time].filter(Boolean).join(" ");
      renderBookSide(get("trade-book-asks"), context?.asks);
      renderBookSide(get("trade-book-bids"), context?.bids);
      updateTradeTotal();
    } catch (error) {
      if (version === tradeVersion && trade.open) tradeStatus.textContent = error.message;
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
    tradeSide = side;
    orderContext = null;
    reviewId = null;
    tradeForm.reset();
    tradeForm.hidden = false;
    tradeReview.hidden = true;
    tradeNext.disabled = true;
    tradeConfirm.disabled = true;
    tradeEdit.disabled = false;
    book.hidden = true;
    book.open = false;
    get("trade-use-quote").hidden = true;
    get("trade-preview-symbol").textContent = displaySymbol(current);
    get("trade-preview-title").textContent = sideName[side] + " 주문";
    trade.dataset.side = side;
    tradeStatus.textContent = "키움 주문 정보를 확인 중입니다.";
    const referencePrice = get("trade-preview-quote");
    referencePrice.hidden = !Number.isFinite(quote?.price);
    referencePrice.textContent = referencePrice.hidden ? "" : "저장된 종가 · " + dollars.format(quote.price);
    updateTradeTotal();
    trade.showModal();
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
  });
  bookRefresh.onclick = loadTradeContext;
  get("trade-use-quote").onclick = () => setTradePrice(orderContext?.price);
  for (const button of tradeForm.querySelectorAll("[data-trade-step]")) {
    button.onclick = () => {
      const field = button.dataset.tradeStep === "price" ? price : quantity;
      if (button.value === "1") field.stepUp();
      else field.stepDown();
      updateTradeTotal();
    };
  }
  tradeForm.addEventListener("input", updateTradeTotal);
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
  let chart = null, start = 0, lastStart = 0, drag = null, requestId = 0;
  let geometry;
  const tools = setupChartTools({
    redraw:draw, moveTo, getView:()=>({start,windowSize:visibleBars}), alternatives:[...savedQuotes],
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
    const snapshot = current === "SKHY" && frame === "day" && start === lastStart && tools.canUseSnapshot();
    reference.hidden = !snapshot;
    canvas.hidden = snapshot;
    const options = tools.chartOptions();
    geometry = snapshot ? null : drawChart(canvas, chart, frame, start, options);
    const end = Math.min(options.end ?? chart.bars.length, start + visibleBars) - 1;
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
      ...options, end:last, drawings:[], overlays:[], lower:"none", compare:null
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
  area.addEventListener("pointerdown", event => {
    if (!chart || !event.isPrimary || event.button !== 0 || event.target.closest("#drawing-actions")) return;
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
      step: Math.max(1, (area.clientWidth - 48) / visibleBars)};
    area.setPointerCapture(event.pointerId);
    area.classList.add("dragging");
  });
  area.addEventListener("pointermove", event => {
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
    lastStart = Math.max(0, (chart?.bars.length || 0) - visibleBars);
    start = lastStart;
    get("chart-history").hidden = !chart;
    area.classList.toggle("pannable", lastStart > 0);
    tools.updateSeries(chart,current,frame);
    if (chart) {
      const startDate = dateFormat.format(source[0][0] * 1000);
      const endDate = dateFormat.format(source.at(-1)[0] * 1000);
      coverage.textContent = (isIntraday(frame) ? "Intraday snapshot" : "Available since first recorded session")
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
    if (!quote || value === "hour" || !isIntraday(value)) {
      finishFrame(quote && (value === "hour" ? quote.hourly : quote.daily));
      return;
    }
    finishFrame(null);
    chartStatus.textContent = "Loading intraday history…";
    chartStatus.hidden = false;
    try {
      const source = await minuteBars(current);
      if (id !== requestId) return;
      chartStatus.hidden = true;
      finishFrame(source);
    } catch {
      if (id === requestId) chartStatus.textContent = "Intraday history is temporarily unavailable. Select another interval.";
    }
  }
  function renderQuote() {
    const pct=quote.percent, change=quote.price-quote.price/(1+pct/100);
    get("stock-price").textContent=quote.price.toFixed(2);
    get("stock-change").textContent=(pct<0?"▼ ":"▲ ")+signed(change)+"  "+signed(pct)+"%";
    get("stock-price").parentElement.dataset.direction=pct<0?"down":"up";
    get("stock-range").textContent=quote.high.toFixed(2)+"–"+quote.low.toFixed(2);
    get("stock-volume").textContent=Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:2}).format(quote.volume);
    get("stock-cap").textContent=current==="SKHY"?"754.89B":"—";
    get("stock-name").textContent=(current==="SKHY"?"SK Hynix Inc":quote.name)+"  "+(quote.exchange==="NasdaqGS"?"NASDAQ":quote.exchange);
    document.querySelector(".quote-time small").hidden=false;
    const when=new Date(quote.asOf*1000).toLocaleString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",year:"numeric"});
    get("stock-time").textContent=current==="SKHY"?"Closed 19:59 11/20 ET":"Closed · "+when+" ET";
    get("stock-frames").hidden=false;
    setFrame(frame);
  }
  function fallback() {
    get("stock-time").textContent="Chart unavailable";
    document.querySelector(".quote-time small").hidden=true;
    get("stock-frames").hidden=true;
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
    get("external-chart").replaceChildren();get("external-chart").hidden=true;
    canvas.hidden=true;reference.hidden=true;get("stock-frames").hidden=true;
    setFavorite();setFrame("day");
    const data=await publicQuote(symbol);
    if(current!==symbol)return;
    quote=data;
    if (quote) renderQuote();else fallback();
  }
  function sync() {
    const symbol=new URLSearchParams(location.hash.slice(1)).get("stock")?.toUpperCase();
    if (symbol && validSymbol.test(symbol)) {
      if(symbol!==current)open(symbol);
      return;
    }
    requestId += 1;
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
  return symbol=>{
    history.pushState({stockEntry:true},"","#stock="+encodeURIComponent(symbol));
    sync();
  };
}
