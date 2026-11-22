import {prepareChart, drawChart, visibleBars} from "./instrument-chart.js?v=46";

const get = id => document.getElementById(id);
const savedQuotes = new Set("ANT SKHY SPCX MRVL BZMAIN CLMAIN AAL UAL DAL NVDA".split(" "));
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
const quoteSymbol = s => ({BZMAIN:"BZ=F",CLMAIN:"CL=F"}[s] || s);
const displaySymbol = s => ({BZMAIN:"BZmain",CLMAIN:"CLmain"}[s] || s);
const validSymbol = /^[A-Z][A-Z0-9.\-]{0,11}$/;

export function setupInstrument({navigate,search,nameFor,readList,saveList}) {
  const dialog=get("stock-detail"), canvas=get("market-chart"), reference=get("daily-reference");
  let current="", quote=null, frame="day", afterClose=null;
  function setFavorite() {
    const saved=readList().includes(current);
    get("stock-star").setAttribute("aria-pressed",String(saved));
    get("stock-star").setAttribute("aria-label",saved?"Remove from watchlist":"Add to watchlist");
  }
  const area = get("chart-area"), range = get("chart-position"), latest = get("chart-latest");
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York"
  });
  let chart = null, start = 0, lastStart = 0, drag = null;

  function draw() {
    if (!chart || !chart.bars.length || !dialog.open) return;
    const snapshot = current === "SKHY" && frame === "day" && start === lastStart;
    reference.hidden = !snapshot;
    canvas.hidden = snapshot;
    if (!snapshot) drawChart(canvas, chart, frame, start);
    const end = Math.min(chart.bars.length, start + visibleBars) - 1;
    const dates = [start, end].map(i => dateFormat.format(chart.bars[i][0] * 1000));
    get("chart-dates").textContent = dates.join(" – ");
    range.value = String(start);
    range.setAttribute("aria-valuetext", dates.join(" to "));
    latest.disabled = start === lastStart;
  }
  function moveTo(index) {
    const next = Math.min(lastStart, Math.max(0, Math.round(index)));
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
    if (!chart || !lastStart || !event.isPrimary || event.button !== 0) return;
    drag = {id: event.pointerId, x: event.clientX, start,
      step: Math.max(1, (area.clientWidth - 48) / visibleBars)};
    area.setPointerCapture(event.pointerId);
    area.classList.add("dragging");
  });
  area.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) moveTo(drag.start + (drag.x - event.clientX) / drag.step);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    area.addEventListener(type, event => { if (drag?.id === event.pointerId) endDrag(); });
  }
  range.addEventListener("input", () => moveTo(Number(range.value)));
  latest.addEventListener("click", () => moveTo(lastStart));
  new ResizeObserver(draw).observe(area);
  function setFrame(value) {
    endDrag();
    frame = value;
    chart = quote ? prepareChart(quote, frame) : null;
    lastStart = Math.max(0, (chart?.bars.length || 0) - visibleBars);
    start = lastStart;
    range.max = String(lastStart);
    range.disabled = lastStart === 0;
    get("chart-history").hidden = !chart;
    area.classList.toggle("pannable", lastStart > 0);
    for (const button of get("stock-frames").children) button.setAttribute("aria-pressed",String(button.dataset.frame===frame));
    draw();
  }
  function link(id, href) {
    const anchor=get(id);anchor.href=href;anchor.target="_blank";anchor.rel="noopener noreferrer";
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
    get("summary-title").textContent=current==="SKHY"?"Vega Summary":"Session Summary";
    if (current === "SKHY") {
      const bullish = document.createElement("b"), bearish = document.createElement("b");
      bullish.dataset.direction = "up"; bullish.textContent = "2";
      bearish.dataset.direction = "down"; bearish.textContent = "7";
      get("stock-summary").replaceChildren("SKHY saw ", bullish, " Bullish and ", bearish, " Bearish short-term technical signals. (2 more)");
    } else get("stock-summary").textContent = displaySymbol(current)+" closed at "+quote.price.toFixed(2)+" ("+signed(pct)+"%). The session ranged from "+quote.low.toFixed(2)+" to "+quote.high.toFixed(2)+".";
    get("stock-frames").hidden=false;
    setFrame(frame);
  }
  function fallback(symbol) {
    const container=get("external-chart");container.hidden=false;canvas.hidden=true;
    const iframe=document.createElement("iframe");
    iframe.title=displaySymbol(symbol)+" market chart";
    iframe.referrerPolicy="no-referrer";
    iframe.src="https://s.tradingview.com/widgetembed/?"+new URLSearchParams({symbol,interval:"D",theme:"dark",style:"1",locale:"en",timezone:"America/New_York"});
    container.replaceChildren(iframe);
    get("stock-time").textContent="Chart by TradingView";
    document.querySelector(".quote-time small").hidden=true;
    get("stock-summary").textContent="Use the quote source for market data and company details.";
    get("stock-frames").hidden=true;
  }
  async function open(symbol) {
    current=symbol;quote=null;
    document.body.classList.add("instrument-open");
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop=0;
    dialog.classList.remove("expanded");
    get("stock-expand").setAttribute("aria-pressed","false");
    get("symbol-copy").textContent="Copy symbol";
    get("symbol-action-menu").hidden=true;
    get("symbol-actions").setAttribute("aria-expanded","false");
    get("stock-price").parentElement.removeAttribute("data-direction");
    get("stock-symbol").textContent=displaySymbol(symbol);
    document.title=displaySymbol(symbol)+" · TradeInSight";
    get("stock-name").textContent=nameFor(symbol);
    for (const id of ["stock-price","stock-range","stock-volume","stock-cap"]) get(id).textContent="—";
    get("stock-change").textContent="";get("stock-time").textContent="Loading quote…";
    get("summary-title").textContent="Session Summary";get("stock-summary").textContent="";
    const url="https://finance.yahoo.com/quote/"+encodeURIComponent(quoteSymbol(symbol))+"/";
    for(const [id,path] of [["options-link","options/"],["news-link","news/"],["company-link","profile/"],["quote-source",""],["symbol-finance",""]]) link(id,url+path);
    get("external-chart").replaceChildren();get("external-chart").hidden=true;
    canvas.hidden=true;reference.hidden=true;get("stock-frames").hidden=true;
    setFavorite();setFrame("day");
    const data=await publicQuote(symbol);
    if(current!==symbol)return;
    quote=data;
    if (quote) renderQuote();else fallback(symbol);
  }
  function sync() {
    const symbol=new URLSearchParams(location.hash.slice(1)).get("stock")?.toUpperCase();
    if (symbol && validSymbol.test(symbol)) {
      if(symbol!==current)open(symbol);
      return;
    }
    current="";quote=null;chart=null;endDrag();
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
  get("symbol-account").onclick=()=>back(()=>navigate("account"));
  get("symbol-feed").onclick=()=>back(()=>navigate("profit"));
  get("chart-tab").onclick=()=>get("chart-area").scrollIntoView({block:"nearest"});
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
  get("symbol-actions").onclick=e=>{
    const menu=get("symbol-action-menu");menu.hidden=!menu.hidden;
    e.currentTarget.setAttribute("aria-expanded",String(!menu.hidden));
  };
  get("symbol-copy").onclick=async()=>{
    try {await navigator.clipboard.writeText(current);get("symbol-action-menu").hidden=true;get("symbol-actions").setAttribute("aria-expanded","false");}
    catch {get("symbol-copy").textContent=current;}
  };
  window.addEventListener("hashchange",sync);
  window.addEventListener("popstate",sync);
  sync();
  return symbol=>{
    history.pushState({stockEntry:true},"","#stock="+encodeURIComponent(symbol));
    sync();
  };
}
