import {setupStrategy,readStrategy,strategyPrefix,libraryDetails} from "./assets/strategy-editor.js?v=95";
import {setupWatchEditor} from "./watch-editor.js?v=95";
import {setupOrders} from "./orders.js?v=83";
import { setupInstrument, sparkline } from "./instrument.js?v=90";
import {loadWatchSentiment} from "./market-panels.js?v=89";
import {usMarketSession} from "./watch-quotes.js?v=64";

const service = "https://mfycpprqyaidoixytdim.supabase.co";
const publicKey = "sb_publishable_KIxbzozNkk50oEZ9GehtZA_E484E5Lr";
const login = document.querySelector("#login");
const workspace = document.querySelector("#private");
const message = document.querySelector("#status");
let token = null;
let valuationSnapshot = null;
let returnToStock = null;
const heldWatchSymbols = new Set();
const watchSymbolKey = symbol => symbol.trim().toUpperCase().replaceAll(".", "-");
const storageKey = "jm-invest:private-refresh:v1";
const ownerId = "9fc22c69-b253-406a-be2b-eb8ad9526a3c";

function storedSession() {
  try { return localStorage.getItem(storageKey); } catch { return null; }
}

function saveSession(refreshToken) {
  try {
    if (refreshToken) localStorage.setItem(storageKey, refreshToken);
    else localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

async function request(path, { method = "GET", body, accessToken = token } = {}) {
  const headers = { apikey: publicKey, "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(service + path, {
    method, headers, cache: "no-store", body: body && JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.code = payload?.error_code || payload?.code;
    error.httpStatus = response.status;
    throw error;
  }
  return payload;
}

const holdingsPanel = document.querySelector("#account-holdings");
const holdingsToggle = document.querySelector("#open-kiwoom");
const logout = document.querySelector("#logout");
const navigation = document.querySelector("#bottom-nav");
const navButtons = [...navigation.querySelectorAll("button")];
function selectView(view) {
  if (!token && view !== "account") returnToStock = null;
  const needsLogin = !["home","strategies"].includes(view) && !token;
  document.getElementById("watch-login").hidden = Boolean(token);
  document.body.dataset.view = view;
  setDetail(view === "account" && !needsLogin);
  login.hidden = !needsLogin;
  workspace.hidden = needsLogin;
  message.textContent = "";
  for (const panel of document.querySelectorAll("#private > [id^=tab-]")) panel.hidden=panel.id!=="tab-"+view || needsLogin;
  for (const button of navButtons) {
    const active = button.dataset.view === (["more","profit"].includes(view) ? "account" : view);
    if (active) {
      document.querySelector("#section-icon").replaceChildren(button.querySelector("svg").cloneNode(true));
      button.setAttribute("aria-current", "page");
    }
    else button.removeAttribute("aria-current");
  }
  document.querySelector("#page-heading").textContent = {
    strategies:"Strategies", home:"My Watchlist", account:"계좌", profit:"Realized P&L", more:"Menu"
  }[view];
  const korean = view === "account";
  document.querySelector("#page-heading").lang = korean ? "ko" : "en";
  login.lang = korean ? "ko" : "en";
  for (const [id, english, translated] of [
    ["login-heading","Sign in to your account","계좌에 로그인"],
    ["login-email-label","Email","이메일"],
    ["login-password-label","Password","비밀번호"],
    ["login-remember-label","Keep me signed in on this device","이 기기에서 로그인 유지"],
    ["login-submit","Sign in","로그인"],
  ]) document.getElementById(id).textContent = korean ? translated : english;
  if(view==="strategies") renderStrategies();
  window.scrollTo(0, 0);
  if (view === "home") refreshWatchlistQuotes();
  else syncKiwoomQuotes();
}
const strategyLibrary=document.getElementById("strategy-library");
const strategyPicker=document.getElementById("strategy-picker");
const newStrategy=document.getElementById("strategy-new");
const manageStrategies=document.getElementById("strategy-manage");
const selectionPrefix="jm-invest:selected-strategy:v1:";
let strategyFilter="all", managingStrategies=false, pickingSymbol=false;

function openLibraryStrategy(symbol) {
  pickingSymbol=false;
  strategy.open(symbol);
}
function renderStrategies() {
  let symbols=[];
  const selected=new Set();
  try {
    const keys=Object.keys(localStorage);
    for(const key of keys)if(key.startsWith(selectionPrefix))selected.add(key.slice(selectionPrefix.length));
    symbols=keys.filter(k=>k.startsWith(strategyPrefix)).map(k=>k.slice(strategyPrefix.length))
      .filter(s=>/^[A-Z][A-Z0-9.-]{0,11}$/.test(s)).sort();
  } catch {}
  document.getElementById("strategy-selected-count").textContent=symbols.filter(symbol=>selected.has(symbol)).length;
  const empty=symbols.length===0;
  if(empty){managingStrategies=false;strategyFilter="all";}
  document.getElementById("strategy-count").textContent=empty ? "아직 저장한 전략이 없습니다" : "저장한 종목 "+symbols.length+"개";
  document.getElementById("strategy-toolbar").hidden=empty;
  newStrategy.hidden=empty;
  strategyPicker.hidden=!empty && !pickingSymbol;
  newStrategy.setAttribute("aria-expanded",String(!strategyPicker.hidden));
  if(!strategyPicker.hidden){
    const suggestions=document.getElementById("strategy-suggestions");
    suggestions.replaceChildren();
    const tickers=readWatchlist().filter(symbol=>!marketSymbols.some(m=>m.symbol===symbol)).slice(0,4);
    document.getElementById("strategy-suggested").hidden=!tickers.length;
    for(const symbol of tickers){
      const pick=document.createElement("button");
      pick.type="button";
      const identity=document.createElement("span"), ticker=document.createElement("b"), company=document.createElement("small");
      ticker.textContent=symbol;
      const name=nameFor(symbol);
      company.textContent=name===symbol ? "" : name;
      identity.append(ticker,company);
      pick.append(tickerIcon(symbol),identity);
      pick.onclick=()=>openLibraryStrategy(symbol);
      suggestions.append(pick);
    }
  }
  manageStrategies.textContent=managingStrategies ? "완료" : "관리";
  manageStrategies.setAttribute("aria-pressed",String(managingStrategies));
  for(const filter of document.querySelectorAll("#strategy-filter button")){
    filter.setAttribute("aria-pressed",String(filter.dataset.side===strategyFilter));
  }
  strategyLibrary.replaceChildren();
  for(const symbol of symbols){
    const rule=readStrategy(symbol);
    if(strategyFilter==="selected"){
      if(!selected.has(symbol))continue;
    }else if(strategyFilter!=="all" && rule?.side!==strategyFilter)continue;
    const row=document.getElementById("strategy-entry-template").content.firstElementChild.cloneNode(true);
    const card=row.querySelector(".strategy-card"), side=row.querySelector(".rule-side");
    const checkbox=row.querySelector("input");
    checkbox.checked=selected.has(symbol);
    checkbox.setAttribute("aria-label",symbol+" 전략 선택");
    checkbox.onchange=()=>{
      try {
        if(checkbox.checked)localStorage.setItem(selectionPrefix+symbol,"1");
        else localStorage.removeItem(selectionPrefix+symbol);
      } catch {
        checkbox.checked=!checkbox.checked;
        window.alert("전략 선택을 저장하지 못했습니다.");
        return;
      }
      renderStrategies();
      const focusTarget=strategyLibrary.querySelector('input[aria-label="'+symbol+' 전략 선택"]')
        || document.querySelector('#strategy-filter [aria-pressed="true"]');
      focusTarget.focus({preventScroll:true});
    };
    card.prepend(tickerIcon(symbol));
    card.querySelector("strong").textContent=symbol;
    side.hidden=!rule;
    if(rule){
      side.dataset.side=rule.side;
      side.textContent=rule.side==="sell" ? "매도" : "매수";
      const details=libraryDetails(rule);
      card.querySelector(".rule-conditions").textContent=details.conditions;
      card.querySelector(".rule-frame").textContent=details.frame;
      card.querySelector(".rule-size").textContent=details.size;
      card.querySelector(".rule-mode").textContent=details.mode;
    }else card.querySelector(".rule-conditions").textContent="설정 확인";
    card.onclick=()=>openLibraryStrategy(symbol);
    const remove=row.querySelector(".strategy-delete");
    remove.hidden=!managingStrategies;
    remove.setAttribute("aria-label",symbol+" 전략 삭제");
    remove.onclick=()=>{
      if(!window.confirm(symbol+" 전략을 삭제할까요?"))return;
      try {localStorage.removeItem(selectionPrefix+symbol);localStorage.removeItem(strategyPrefix+symbol);renderStrategies();}
      catch {window.alert("전략을 삭제하지 못했습니다.");}
    };
    strategyLibrary.append(row);
  }
  if(!empty && !strategyLibrary.children.length){
    const message=document.createElement("p");
    message.className="rule-empty";
    message.textContent=strategyFilter==="selected" ? "선택한 전략이 없습니다." : (strategyFilter==="sell" ? "매도" : "매수")+" 전략이 없습니다.";
    strategyLibrary.append(message);
  }
}
newStrategy.onclick=()=>{
  pickingSymbol=strategyPicker.hidden;
  renderStrategies();
  if(pickingSymbol)document.getElementById("strategy-symbol").focus();
};
manageStrategies.onclick=()=>{
  managingStrategies=!managingStrategies;
  renderStrategies();
};
for(const filter of document.querySelectorAll("#strategy-filter button")){
  filter.onclick=()=>{strategyFilter=filter.dataset.side;renderStrategies();};
}
window.addEventListener("storage",event=>{
  if(document.body.dataset.view==="strategies" && (!event.key || event.key.startsWith(strategyPrefix) || event.key.startsWith(selectionPrefix)))renderStrategies();
});
strategyPicker.onsubmit=e=>{
  e.preventDefault();
  const symbol=document.getElementById("strategy-symbol").value.toUpperCase();
  strategyPicker.reset();
  openLibraryStrategy(symbol);
};
document.getElementById("strategy-sheet").addEventListener("close",()=>{
  if(document.body.dataset.view==="strategies")renderStrategies();
});

// Native modal dialogs make the rest of the document inert. Keep the single
// navigation bar inside the most recently opened modal so touch and keyboard work.
const navAnchor=document.createComment("main navigation");
navigation.before(navAnchor);
const modalStack=[];
function placeNavigation() {
  const top=modalStack.filter(d=>d.open).at(-1);
  if(top && navigation.parentElement!==top)top.append(navigation);
  if(!top && navigation.previousSibling!==navAnchor)navAnchor.after(navigation);
}
const modalObserver=new MutationObserver(records=>{
  for(const {target} of records){
    const i=modalStack.indexOf(target);
    if(i>=0)modalStack.splice(i,1);
    if(target.open)modalStack.push(target);
  }
  placeNavigation();
});
for(const d of document.querySelectorAll("dialog"))modalObserver.observe(d,{attributes:true,attributeFilter:["open"]});
for (const button of navButtons) {
  button.addEventListener("click",()=>{
    const go=()=>selectView(button.dataset.view);
    for(const d of modalStack.slice().reverse()){
      if(!d.open)continue;
      if(d.id==="stock-detail"){instrument.leave(go);return;}
      if(d.dispatchEvent(new Event("cancel",{cancelable:true})))d.close();
      if(d.open)return;
    }
    go();
  });
}

for (const button of document.querySelectorAll("[data-shortcut]")) {
  button.addEventListener("click", () => selectView(button.dataset.shortcut));
}

function setDetail(open) {
  holdingsPanel.hidden = !open;
  holdingsToggle.setAttribute("aria-expanded", String(open));
}
holdingsToggle.addEventListener("click", () => setDetail(holdingsPanel.hidden));

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = login.querySelector("button");
  submit.disabled = true;
  message.textContent = "Signing in…";
  try {
    const body = { email: login.elements.email.value.trim(), password: login.elements.password.value };
    const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body });
    const remember = login.elements.remember.checked;
    await openWorkspace(session, remember);

  } catch (error) {
    if (error.code === "owner_required") {
      message.textContent = "Sign in with the registered owner account.";
    } else if (error.code === "invalid_credentials") {
      message.textContent = "Check your email and password and try again.";
    } else if (error.code === "email_not_confirmed") {
      message.textContent = "Verify your email before signing in.";
    } else if (error.httpStatus === 429) {
      message.textContent = "Too many attempts. Try again shortly.";
    } else {
      message.textContent = `Unable to reach the sign-in service${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}.`;
    }
  } finally {
    login.elements.password.value = "";
    submit.disabled = false;
  }
});

document.querySelector("#logout").addEventListener("click", () => {
  const accessToken = token;
  token = null;
  valuationSnapshot = null;
  heldWatchSymbols.clear();
  strategy.close();
  orders.signOut();
  instrument.clearAccountData();
  saveSession(null);
  holdingsList.replaceChildren();
  document.getElementById("holding-distribution").hidden = true;
  document.querySelector("#profit-list").replaceChildren();
  document.querySelector("#profit-period").textContent = "";
  document.querySelector("#profit-updated").textContent = "";
  document.querySelector("#profit-total").textContent = "Awaiting sync";
  workspace.hidden = true;
  document.querySelector("#account-performance").hidden = true;
  document.querySelector("#portfolio-value").textContent = "";
  document.querySelector("#kiwoom-return").textContent = "";
  renderWatchlist();
  setDetail(false);
  login.reset();
  selectView("home");
  request("/auth/v1/logout?scope=local", { method: "POST", accessToken }).catch(() => {});
});

const holdingsList = document.querySelector("#holdings-list");
const numeric = value => value != null && value !== "" && Number.isFinite(Number(value));
const holdingUSD = new Intl.NumberFormat("ko-KR", {style:"currency", currency:"USD", currencyDisplay:"narrowSymbol", maximumFractionDigits:4});
const holdingKRW = new Intl.NumberFormat("ko-KR", {style:"currency", currency:"KRW"});
const formatHolding = (value, formatter) => numeric(value) ? formatter.format(Number(value)) : "—";

function tradedQuantity(bought, sold) {
  if (!numeric(bought) || !numeric(sold)) return "—";
  return (Number(bought) + Number(sold)).toLocaleString("ko-KR") + "주";
}

const holdingSort = document.getElementById("holding-sort");
const signedWon = new Intl.NumberFormat("ko-KR", {style:"currency", currency:"KRW", signDisplay:"exceptZero"});

function showPerformance(node, value, format) {
  node.textContent = numeric(value) ? format(Number(value)) : "—";
  if (numeric(value) && Number(value) !== 0) node.dataset.direction = Number(value) > 0 ? "up" : "down";
  else delete node.dataset.direction;
}

function sortHoldings() {
  const key = holdingSort.value === "value" ? "valuation" : "rate";
  const direction = holdingSort.value === "low" ? 1 : -1;
  const items = [...holdingsList.children];
  items.sort((a,b) => {
    const x = a.dataset[key], y = b.dataset[key];
    if (x == null || y == null) return Number(x == null) - Number(y == null);
    return direction * (Number(x) - Number(y));
  });
  holdingsList.append(...items);
}
holdingSort.onchange = sortHoldings;

const weightPercent = new Intl.NumberFormat("ko-KR",{style:"percent",maximumFractionDigits:2});

function renderHoldingWeights(holdings) {
  const distribution=document.getElementById("holding-distribution");
  const bar=distribution.querySelector(".distribution-bar"), legend=distribution.querySelector("ul");
  bar.replaceChildren();
  legend.replaceChildren();
  distribution.hidden=true;
  if(!holdings.every(h=>numeric(h.value_krw) && Number(h.value_krw)>=0))return 0;
  const values=new Map();
  for(const holding of holdings){
    const symbol=holding.symbol || holding.name || "—";
    values.set(symbol,(values.get(symbol) || 0)+Number(holding.value_krw));
  }
  const total=[...values.values()].reduce((sum,value)=>sum+value,0);
  if(!total)return 0;
  const sorted=[...values].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
  for(const [index,[symbol,value]] of sorted.entries()){
    const segment=document.createElement("i"), label=document.createElement("li");
    const color=`hsl(${(215+index*137.5)%360} 62% 69%)`;
    segment.style.backgroundColor=color;
    segment.style.flexGrow=value/total;
    label.style.setProperty("--holding-color",color);
    label.textContent=symbol+" "+weightPercent.format(value/total);
    segment.title=label.textContent;
    bar.append(segment);
    legend.append(label);
  }
  distribution.hidden=false;
  return total;
}

function showHoldings(balance) {
  holdingsList.replaceChildren();
  const holdings = balance?.holdings;
  const hasRows = Array.isArray(holdings) && holdings.length > 0;
  document.getElementById("holding-count").textContent = Array.isArray(holdings) ? holdings.length : "";
  document.getElementById("holding-columns").hidden = !hasRows;
  holdingSort.hidden = !hasRows || holdings.length < 2;
  const totalHoldingsValue=renderHoldingWeights(hasRows ? holdings : []);
  if (!hasRows) {
    const item = document.createElement("li");
    item.textContent = Array.isArray(holdings) ? "보유 중인 미국주식이 없습니다." : "잔고 동기화 대기";
    holdingsList.append(item);
    return;
  }
  for (const holding of holdings) {
    const item = document.createElement("li"), details = document.createElement("details");
    const head = document.createElement("summary");
    head.className = "position-line";
    if (numeric(holding.value_krw)) item.dataset.valuation = holding.value_krw;
    if (numeric(holding.return_pct)) item.dataset.rate = holding.return_pct;
    const identity = document.createElement("span"), symbol = document.createElement("strong"), company = document.createElement("small");
    identity.className = "position-identity";
    symbol.textContent = holding.symbol || holding.name || "—";
    company.textContent = holding.name !== symbol.textContent ? holding.name || "" : "";
    identity.append(symbol,company);
    const profit = document.createElement("span"), rate = document.createElement("strong");
    rate.className = "position-rate";
    showPerformance(profit,holding.profit_krw,signedWon.format);
    showPerformance(rate,holding.return_pct,signedWatchPercent);
    head.append(identity,profit,rate);
    head.setAttribute("aria-label", [symbol.textContent, company.textContent, "평가손익 " + profit.textContent, "수익률 " + rate.textContent].filter(Boolean).join(", "));

    const metrics = document.createElement("dl");
    metrics.className = "holding-values";
    const weight = totalHoldingsValue > 0
      ? weightPercent.format(Number(holding.value_krw) / totalHoldingsValue) : "—";
    for (const [label,value] of [
      ["보유수량", numeric(holding.quantity) ? Number(holding.quantity).toLocaleString("ko-KR", {maximumFractionDigits:8}) + "주" : "—"],
      ["주식 내 비중",weight], ["매입가",formatHolding(holding.cost_price,holdingUSD)],
      ["매입금액",formatHolding(holding.cost_krw,holdingKRW)], ["현재가",formatHolding(holding.current_price,holdingUSD)],
      ["평가금액",formatHolding(holding.value_krw,holdingKRW)], ["전일 거래수량",tradedQuantity(holding.previous_buy_qty,holding.previous_sell_qty)],
      ["금일 거래수량",tradedQuantity(holding.today_buy_qty,holding.today_sell_qty)]
    ]) {
      const cell = document.createElement("div"), term = document.createElement("dt"), data = document.createElement("dd");
      term.textContent = label;
      data.textContent = value;
      cell.append(term,data);
      metrics.append(cell);
    }
    details.append(head,metrics);
    item.append(details);
    holdingsList.append(item);
  }
  sortHoldings();
}

function showProfit(data) {
  const list = document.querySelector("#profit-list");
  const total = document.querySelector("#profit-total");
  const period = document.querySelector("#profit-period");
  const updated = document.querySelector("#profit-updated");
  list.replaceChildren();
  if (!data || !Array.isArray(data.entries)) {
    total.textContent = "Awaiting sync";
    period.textContent = "";
    updated.textContent = "";
    return;
  }
  const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW" });
  total.textContent = won.format(Number(data.total_krw));
  total.dataset.direction = Number(data.total_krw) < 0 ? "down" : "up";
  period.textContent = `${data.start} ~ ${data.end} · Kiwoom · KRW`;
  updated.textContent = new Date(data.observed_at).toLocaleString("en-US", { timeZone: "Asia/Seoul" }) + " KST";
  if (!data.entries.length) {
    const row = document.createElement("li");
    row.textContent = "No realized trades in this period.";
    list.append(row);
  }
  for (const entry of data.entries) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const amount = document.createElement("strong");
    const ticker = document.createElement("b");
    ticker.textContent = entry.symbol;
    const date = document.createElement("small");
    date.textContent = [entry.date, entry.name !== entry.symbol && entry.name].filter(Boolean).join(" · ");
    label.append(ticker, date);
    amount.textContent = won.format(Number(entry.profit_krw));
    amount.dataset.direction = Number(entry.profit_krw) < 0 ? "down" : "up";
    row.append(label, amount);
    list.append(row);
  }
}

const watchKey = "jm-invest:watchlist:v1";
const watchList = document.querySelector("#home-holdings");
const watchPriceKey = "jm-invest:watch-quote-display";
let showWatchPrice = false;
try { showWatchPrice = localStorage.getItem(watchPriceKey) === "price"; } catch {}
const watchSentimentRating = document.querySelector("#watch-sentiment-rating");
const watchStatus = document.querySelector("#home-value");
const watchForm = document.querySelector("#watch-form");
// Preserve the existing logos and default watchlist.
const featured = [
  ["ANT", "Anthropic PBC"],
  ["SKHY", "SK Hynix Inc"],
  ["SPCX", "Space Exploration Technologies"],
  ["MRVL", "Marvell Technology"],
  ["BZMAIN", "Brent Last Day Main"],
  ["CLMAIN", "Crude Oil Main"],
  ["AAL", "American Airlines"],
  ["UAL", "United Airlines Holdings"],
  ["DAL", "Delta Air Lines Inc."],
];
const suggestedWatchlist = featured.map(([symbol]) => symbol);
const snapshots = new Map(featured.map(([symbol, name], index) =>
  [symbol, {name, index}]
));
const marketSymbols = [
  {symbol: "VIX", name: "Cboe Volatility Index"},
  {symbol: "BZMAIN", name: "Brent Crude Oil Futures"},
  {symbol: "CLMAIN", name: "WTI Crude Oil Futures"},
];
let sortDirection = 0;
document.querySelector("#watch-sort").addEventListener("click", (event) => {
  sortDirection = sortDirection === 0 ? -1 : sortDirection === -1 ? 1 : 0;
  event.currentTarget.dataset.direction = String(sortDirection);
  event.currentTarget.setAttribute("aria-label", sortDirection === -1
    ? "Highest change first. Show lowest first" : sortDirection === 1
    ? "Lowest change first. Restore saved order" : "Sort by percentage change");
  renderWatchlist();
});
const watchSeedKey = "jm-invest:watchlist:reference-added:v1";
try {
  if (!localStorage.getItem(watchSeedKey)) {
    const existing = JSON.parse(localStorage.getItem(watchKey) || "[]");
    if (Array.isArray(existing)) {
      localStorage.setItem(watchKey, JSON.stringify([...new Set([...existing, ...suggestedWatchlist])]));
      localStorage.setItem(watchSeedKey, "1");
    }
  }
} catch {}

const watchDollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 4
});
const signedWatchPercent = change => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
const nameFor = symbol => snapshots.get(symbol)?.name
  || marketSymbols.find(item => item.symbol === symbol)?.name
  || stockDirectory?.find(item => item.symbol === symbol)?.name || symbol;
const watchEditor = setupWatchEditor({watchKey, nameFor, tickerIcon, refresh() {
  renderWatchlist();
  refreshWatchlistQuotes();
}});
document.getElementById("home-search").onclick = () => {
  watchEditor.open(true);
};
const readWatchlist = watchEditor.readList;
const kiwoomTicks = new Map();
const lastKiwoomPrices = new Map();
const kiwoomDaily = new Map();
const kiwoomRegular = new Map();
const externalPrices = new Map();
const minuteHistory = new Map(), liveMinutes = new Map(), changedSymbols = new Set();
const unavailableSymbols = new Set();
const kiwoomQuoteStatus = document.querySelector("#kiwoom-quote-status");
// Set the HTTPS URL of the authenticated, quote-only gateway when provisioned.
const kiwoomGateway = document.querySelector('meta[name="kiwoom-quote-gateway"]')?.content;
const kiwoomEndpoint = location.hostname === "127.0.0.1" ? "./api/quotes/stream"
  : location.origin === "https://najaemin92.github.io" ? kiwoomGateway : null;
const kiwoomPhases = {"0": "Regular", "1": "Pre", "2": "After", "4": "Overnight"};
let kiwoomStream;
let redrawQuotes;
let kiwoomRetry;
let activeOrderBook;

function subscribeOrderBook(symbol, onUpdate) {
  const subscription = {symbol, onUpdate};
  activeOrderBook = subscription;
  syncKiwoomQuotes();
  return () => {
    if (activeOrderBook !== subscription) return;
    activeOrderBook = undefined;
    syncKiwoomQuotes();
  };
}

function stopKiwoomQuotes() {
  clearTimeout(kiwoomRetry);
  kiwoomRetry = undefined;
  kiwoomStream?.controller.abort();
  kiwoomStream = null;
  if (token) return;
  minuteHistory.clear();
  liveMinutes.clear();
  kiwoomTicks.clear();
  lastKiwoomPrices.clear();
  kiwoomDaily.clear();
  externalPrices.clear();
  unavailableSymbols.clear();
}

window.addEventListener("pagehide", stopKiwoomQuotes);
window.addEventListener("pageshow", refreshWatchlistQuotes);

async function syncKiwoomQuotes() {
  if (!kiwoomEndpoint) return;
  const active = token && !document.hidden && (activeOrderBook || document.body.dataset.view === "home");
  const book = active && activeOrderBook?.symbol;
  const symbols = active ? [...new Set(book ? [book, ...readWatchlist()] : readWatchlist())].slice(0, 200) : [];
  const key = JSON.stringify(book ? {symbols, book} : symbols);
  if (kiwoomStream?.key === key && kiwoomStream.token === token) return;
  stopKiwoomQuotes();
  if (!symbols.length) {
    if (!token) kiwoomRegular.clear();
    kiwoomQuoteStatus.textContent = "";
    renderWatchlist();
    return;
  }
  kiwoomQuoteStatus.textContent = "Connecting to Kiwoom…";

  const controller = new AbortController();
  const stream = {key, token, controller};
  kiwoomStream = stream;
  try {
    const response = await fetch(kiwoomEndpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: key,
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      const issue = await response.json().catch(() => null);
      if (response.status === 409 && kiwoomStream === stream) {
        kiwoomRetry = setTimeout(syncKiwoomQuotes, 2_000);
        kiwoomQuoteStatus.textContent = "Kiwoom is in use in another tab. Retrying…";
        return;
      }
      throw new Error(issue?.message ?? `Kiwoom HTTP ${response.status}`);
    }
    kiwoomQuoteStatus.textContent = "Kiwoom connected. Waiting for a trade in this session…";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (kiwoomStream === stream) {
        const {done, value} = await reader.read();
        if (done || kiwoomStream !== stream) break;
        const lines = (pending + decoder.decode(value, {stream: true})).split("\n");
        pending = lines.pop();
        for (const line of lines) {
          const update = JSON.parse(line);
          if (!update) continue;
          if (activeOrderBook?.symbol === update.symbol && (update.book || update.bookStatus || update.session != null
            || update.snapshot && !(kiwoomTicks.get(update.symbol)?.receivedAt > update.sampledAt))) {
            activeOrderBook.onUpdate(update);
          }
          if (update.book || update.bookStatus) continue;
          if (update.symbol) changedSymbols.add(update.symbol);
          if (Array.isArray(update.series)) minuteHistory.set(update.symbol, update.series);
          if (Array.isArray(update.unsupported)) {
            for (const symbol of update.unsupported) { unavailableSymbols.add(symbol); changedSymbols.add(symbol); }
          } else if (Array.isArray(update.daily)) {
            kiwoomDaily.set(update.symbol, update.daily);
          } else if (Number.isFinite(update.price)) {
            if (update.marketType) {
              externalPrices.set(update.symbol, update);
            } else if (update.snapshot) {
              const received = usMarketSession(), previous = lastKiwoomPrices.get(update.symbol);
              const sameSession = previous?.received.date === received.date && previous.received.phase === received.phase;
              const moved = sameSession && (previous.moved || previous.price !== update.price);
              lastKiwoomPrices.set(update.symbol, {...update, received, moved});
            } else {
              const prior = kiwoomTicks.get(update.symbol);
              if (prior?.tradedAt && update.tradedAt && prior.tradedAt > update.tradedAt) continue;
              if (!update.date) update.date = usMarketSession().date.replaceAll("-", "");
              kiwoomTicks.set(update.symbol, update);
              if (update.tradedAt) {
                const minute = Math.floor(update.tradedAt / 60) * 60;
                let points = liveMinutes.get(update.symbol);
                if (prior?.date !== update.date || !points) liveMinutes.set(update.symbol, points = new Map());
                points.set(minute, update.price);
                while (points.keys().next().value < minute - 179 * 60) points.delete(points.keys().next().value);
              }
              if (update.session === "0") kiwoomRegular.set(update.symbol, update);
            }
          }
          redrawQuotes ??= requestAnimationFrame(() => {
            redrawQuotes = undefined;
            renderWatchlist(changedSymbols);
            changedSymbols.clear();
          });
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (kiwoomStream === stream) {
      kiwoomQuoteStatus.textContent = "Kiwoom disconnected. Reconnecting…";
      kiwoomRetry = setTimeout(syncKiwoomQuotes, 2_000);
    }
  } catch (error) {
    if (kiwoomStream === stream) {
      kiwoomQuoteStatus.textContent = error.message;
      kiwoomRetry = setTimeout(syncKiwoomQuotes, 2_000);
    }
  } finally {
    if (kiwoomStream === stream) {
      kiwoomStream = null;
      renderWatchlist();
    }
  }
}

let lastWatchSession;
function refreshWatchlistQuotes() {
  if (!document.hidden && document.body.dataset.view === "home") {
    loadWatchSentiment(({rating, saved}) => {
      watchSentimentRating.hidden = !rating;
      watchSentimentRating.textContent = rating;
      watchSentimentRating.dataset.rating = rating.toLowerCase();
      watchSentimentRating.title = saved ? "Fear & Greed · Saved reading" : "Fear & Greed";
    }).catch(() => {});
    const session = usMarketSession();
    const sessionKey = session.date + session.phase;
    if (lastWatchSession !== sessionKey) {
      lastWatchSession = sessionKey;
      renderWatchlist();
    }
  }
  syncKiwoomQuotes();
}
setInterval(refreshWatchlistQuotes, 30_000);
document.addEventListener("visibilitychange", refreshWatchlistQuotes);
window.addEventListener("online", refreshWatchlistQuotes);

const orders = setupOrders(() => token, kiwoomEndpoint);
async function loadChart(symbol, frame, before, signal, day) {
  if (!token || !kiwoomEndpoint) return null;
  const endpoint = new URL("instrument", new URL(kiwoomEndpoint, location.href));
  endpoint.search = new URLSearchParams({symbol, frame});
  if (before) endpoint.searchParams.set("before", before);
  if (day) endpoint.searchParams.set("date", day.replaceAll("-",""));
  const response = await fetch(endpoint, {headers: {Authorization: "Bearer " + token}, cache: "no-store", signal});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Kiwoom chart unavailable.");
  return payload;
}
const canLoadChart=()=>Boolean(token && kiwoomEndpoint);
const strategy=setupStrategy({loadChart,orders,canLoadChart,tickerIcon});
const instrument = setupInstrument({
  orders,strategy,
  async readPositionSnapshot(symbol) {
    const session = token;
    const balance = await valuationSnapshot;
    if (!session || token !== session || !balance?.observed_at || !Array.isArray(balance.holdings)) return null;
    const row = balance.holdings.find(h => h.currency === "USD" && typeof h.symbol === "string" &&
      watchSymbolKey(h.symbol) === watchSymbolKey(symbol));
    const observed = Date.parse(balance.observed_at);
    if (!row || !numeric(row.quantity) || !Number.isFinite(observed)) return null;
    return {quantity:Number(row.quantity), averagePrice:numeric(row.cost_price) ? Number(row.cost_price) : null,
      markPrice:numeric(row.current_price) ? Number(row.current_price) : null, observed};
  },
  subscribeOrderBook,
  canLoadChart,
  async loadExecutions(symbol, from, to, signal) {
    const endpoint = new URL("executions", new URL(kiwoomEndpoint, location.href));
    endpoint.search = new URLSearchParams({symbol,from:from.replaceAll("-",""),to:to.replaceAll("-","")});
    const response = await fetch(endpoint,{headers:{Authorization:"Bearer "+token},cache:"no-store",signal});
    if (!response.ok) throw new Error("체결 내역을 불러오지 못했습니다.");
    return (await response.json()).executions;
  },
  loadChart,
  signIn(symbol) {
    returnToStock = symbol;
    selectView("account");
  },
  search() {
    selectView("home");
    watchEditor.open(true);
  },
  nameFor,
  readList: readWatchlist,
  saveList: watchEditor.saveList,
});
const watchDate = new Intl.DateTimeFormat("en-US", {month:"short", day:"numeric", timeZone:"America/New_York"});
function renderWatchlist(changed) {
  watchEditor.renameHeading();
  const symbols = readWatchlist();
  const session = usMarketSession();
  const summary = document.getElementById("watch-summary");
  const summaryKey = session.date + "/" + symbols.length;
  if (summary.dataset.key !== summaryKey) {
    summary.dataset.key = summaryKey;
    summary.textContent = watchDate.format(new Date(session.date + "T12:00:00Z")) + " ET · " +
      symbols.length + (symbols.length === 1 ? " symbol" : " symbols");
  }
  const date = session.date.replaceAll("-", "");
  const quotes = new Map(symbols.map(symbol => {
    if (!token) return [symbol, null];
    const external = externalPrices.get(symbol);
    if (external) return [symbol, {...external, label: external.marketType}];
    const tick = kiwoomTicks.get(symbol);
    const snapshot = lastKiwoomPrices.get(symbol);
    const daily = kiwoomDaily.get(symbol)?.find(row => row.date < date
      || row.date === date && ["After","Close"].includes(session.phase));
    const regular = kiwoomRegular.get(symbol);
    const freshOvernight = tick?.session === "4" && tick.tradedAt >= Date.now() / 1000 - 120;
    const live = tick?.date === date || freshOvernight ? tick : null;
    const useTick = live && !(snapshot?.sampledAt > (live.receivedAt ?? live.tradedAt) && snapshot.price !== live.price);
    const lastBar = minuteHistory.get(symbol)?.at(-1);
    const barSession = lastBar && !useTick && usMarketSession(new Date(lastBar[0] * 1000));
    const timedSnapshot = snapshot?.received.date === session.date && snapshot.received.phase === session.phase
      && (snapshot.moved || barSession?.date === session.date && barSession.phase === session.phase);
    const price = useTick ? live.price : snapshot?.price ?? daily?.price;
    const label = useTick ? (kiwoomPhases[live.session] || "Last") : timedSnapshot ? session.phase : snapshot ? "Last" : "Close";
    const change = label === "Regular" ? (useTick ? live.change : snapshot.change)
      : regular?.date === date ? regular.change : daily?.change;
    return [symbol, price != null || Number.isFinite(change)
      ? {price, change, label,
        extendedChange: ["Pre", "After", "Overnight", "Last"].includes(label) ? (useTick ? live.change : snapshot?.change) : null,
        changeDate: regular?.date === date ? date : daily?.date}
      : null];
  }));
  if (kiwoomQuoteStatus.textContent.startsWith("Kiwoom connected")
      && (kiwoomTicks.size || lastKiwoomPrices.size || externalPrices.size)) {
    kiwoomQuoteStatus.textContent = "";
  }
  symbols.sort((a, b) => {
    const vixFirst = Number(b === "VIX") - Number(a === "VIX");
    if (vixFirst) return vixFirst;
    const heldFirst = Number(heldWatchSymbols.has(watchSymbolKey(b))) - Number(heldWatchSymbols.has(watchSymbolKey(a)));
    if (heldFirst || !sortDirection) return heldFirst;
    const left = quotes.get(a)?.change, right = quotes.get(b)?.change;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return Number(Number.isFinite(right)) - Number(Number.isFinite(left));
    }
    return sortDirection * (left - right);
  });
  const existing = new Map([...watchList.children].map(row => [row.dataset.symbol, row]));
  document.querySelector("#watch-empty").hidden = Boolean(symbols.length);
  symbols.forEach((symbol, index) => {
    let row = existing.get(symbol);
    const fresh = !row;
    if (fresh) row = makeWatchRow(symbol);
    existing.delete(symbol);
    if (watchList.children[index] !== row) watchList.insertBefore(row, watchList.children[index] || null);
    if (fresh || !changed || changed.has(symbol)) paintWatchRow(row, symbol, quotes.get(symbol), session);
  });
  for (const row of existing.values()) row.remove();
}

function tickerIcon(symbol) {
  const badge = document.createElement("span");
  badge.className = "watch-ticker-icon";
  badge.setAttribute("aria-hidden","true");
  const logoFiles = {NVDA:"nvda", GOOGL:"goog", GOOG:"goog", AMZN:"amzn", AVGO:"avgo", NBIS:"nbis", AMZU:"amzu", SOXX:"soxx", SOXL:"soxl"};
  const snapshot = snapshots.get(symbol);
  if (snapshot) {
    badge.style.setProperty("--sprite-position", (snapshot.index * 12.5) + "%");
    badge.classList.add("reference-logo");
  } else {
    badge.textContent = symbol === "VIX" ? symbol : symbol.slice(0, 2);
    if (logoFiles[symbol]) {
      const image = document.createElement("img");
      image.src = "./assets/companies/" + logoFiles[symbol] + ".png?v=29";
      image.alt = "";
      image.addEventListener("error", () => image.remove());
      badge.append(image);
    }
  }
  return badge;
}

function makeWatchRow(symbol) {
  const row = document.createElement("li");
  row.dataset.symbol = symbol;
  const badge=tickerIcon(symbol);
  const identity = document.createElement("div"), name = document.createElement("strong");
  identity.className = "watch-identity";
  const link = document.createElement("a");
  link.href = "#stock=" + encodeURIComponent(symbol);
  link.className = "symbol-link";
  link.textContent = ({BZMAIN:"BZmain", CLMAIN:"CLmain"}[symbol] || symbol);
  link.setAttribute("aria-label", "Open " + symbol + " chart");
  link.addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    instrument.open(symbol);
  });
  name.append(link);
  const caption = document.createElement("div");
  caption.className = "watch-caption";
  caption.append(document.createElement("small"), document.createElement("span"));
  identity.append(name, caption);
  const chart = document.createElement("span"), quote = document.createElement("div");
  chart.className = "mini-chart";
  chart.setAttribute("aria-hidden", "true");
  quote.className = "watch-quote";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "watch-metric";
  toggle.onclick = () => {
    showWatchPrice = !showWatchPrice;
    try { localStorage.setItem(watchPriceKey, showWatchPrice ? "price" : "percent"); } catch {}
    renderWatchlist();
  };
  quote.append(toggle, document.createElement("small"), document.createElement("small"));
  row.append(badge, identity, chart, quote);
  return row;
}

function paintWatchRow(row, symbol, market, session) {
  const caption = row.querySelector(".watch-caption"), tag = caption.lastElementChild;
  caption.firstElementChild.textContent = nameFor(symbol);
  tag.hidden = !market;
  tag.textContent = market?.label || "";
  tag.className = market?.marketType ? "session-tag futures" : "session-tag";
  tag.title = market && !market.marketType && ["Pre", "After"].includes(session.phase) && market.label !== session.phase
    ? session.phase + " quote pending" : "";

  const chart = row.querySelector(".mini-chart");
  const points = new Map(token ? minuteHistory.get(symbol) : []);
  if (token) for (const [stamp, price] of liveMinutes.get(symbol) ?? []) points.set(stamp, price);
  const samples = [...points].sort((a, b) => a[0] - b[0]);
  if (samples.length > 1) {
    const end = samples.at(-1)[0];
    let visible = samples.filter(([stamp]) => stamp >= end - 179 * 60);
    const tradingDate = stamp => usMarketSession(new Date(stamp * 1000)).date;
    const date = tradingDate(end);
    if (tradingDate(visible[0][0]) !== date) visible = visible.filter(([stamp]) => tradingDate(stamp) === date);
    if (visible.length > 1) {
      chart.style.color = visible.at(-1)[1] < visible[0][1] ? "#f58ba6" : "#78ddbd";
      sparkline(visible, chart);
    } else chart.replaceChildren();
  } else chart.replaceChildren();

  const quote = row.querySelector(".watch-quote"), [main, price, extra] = quote.children;
  const change = market?.change;
  const quotePrice = Number.isFinite(market?.price)
    ? market.marketType === "Index" ? market.price.toFixed(2) : watchDollars.format(market.price) : "—";
  main.textContent = showWatchPrice ? quotePrice : Number.isFinite(change) ? signedWatchPercent(change) : "—";
  main.title = showWatchPrice ? "Show percentage change" : "Show price";
  main.setAttribute("aria-label", symbol + " " + main.textContent + ". " + main.title);
  quote.dataset.direction = Number.isFinite(change) ? (change < 0 ? "down" : "up") : "";
  if (market) {
    price.textContent = market.marketType === "Futures" ? "Delayed" : "";
  } else {
    price.textContent = !token ? "" : unavailableSymbols.has(symbol) ? "Unavailable on Kiwoom" : "Waiting for quote";
  }
  price.hidden = !price.textContent;
  extra.hidden = !Number.isFinite(market?.extendedChange);
  extra.textContent = extra.hidden ? "" : market.label + ": " + signedWatchPercent(market.extendedChange);
  extra.dataset.direction = market?.extendedChange < 0 ? "down" : "up";
}
var stockDirectory;
watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#watch-symbol").value.trim().toUpperCase().replace(/^\^/, "");
  const results = document.querySelector("#watch-results");
  results.replaceChildren();
  if (!query) return;
  watchStatus.textContent = "Searching…";
  try {
    if (!stockDirectory) {
      const response = await fetch("./assets/symbols.json");
      if (!response.ok) throw new Error("directory unavailable");
      stockDirectory = await response.json();
    }
    const matches = [...marketSymbols, ...stockDirectory].filter((item) =>
      item.symbol.includes(query) || item.name.toUpperCase().includes(query)
    ).sort((a, b) => {
      const rank = (item) => item.symbol === query ? 0 : item.symbol.startsWith(query) ? 1 : 2;
      return rank(a) - rank(b) || a.symbol.localeCompare(b.symbol);
    }).slice(0, 20);
    watchStatus.textContent = matches.length ? "Select a result to add it." : "No matching symbols found.";
    for (const item of matches) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const label = document.createElement("strong");
      const name = document.createElement("small");
      label.textContent = item.symbol;
      name.textContent = item.name;
      button.append(label, name);
      button.addEventListener("click", () => {
        const symbols = readWatchlist();
        if (symbols.includes(item.symbol)) {
          watchStatus.textContent = "Already in your watchlist.";
          return;
        }
        try {
          if (!watchEditor.saveList([...symbols, item.symbol])) return;
          document.querySelector("#watch-symbol").value = "";
          results.replaceChildren();
          watchStatus.textContent = item.symbol + " added.";
        } catch { watchStatus.textContent = "Unable to save your watchlist."; }
      });
      row.append(button);
      results.append(row);
    }
  } catch {
    watchStatus.textContent = "Search is unavailable. Please try again.";
    stockDirectory = null;
  }
});

renderWatchlist();
fetch("./assets/symbols.json").then((response) => {
  if (!response.ok) throw new Error("directory unavailable");
  return response.json();
}).then((items) => {
  stockDirectory = items;
  renderWatchlist();
}).catch(() => {});

async function loadValuation(accessToken) {
  const value = document.querySelector("#portfolio-value");
  const performance = document.querySelector("#kiwoom-return");
  const performanceRow = document.querySelector("#account-performance");
  performanceRow.hidden = true;
  value.textContent = "조회 중…";
  performance.textContent = "";
  showHoldings(null);
  try {
    const [balance] = await request("/rest/v1/kiwoom_valuation?select=*&limit=1", { accessToken });
    if (token !== accessToken) return;
    heldWatchSymbols.clear();
    for (const holding of Array.isArray(balance?.holdings) ? balance.holdings : []) {
      const quantity = Number(holding?.quantity);
      if (typeof holding?.symbol === "string" && Number.isFinite(quantity) && quantity !== 0) {
        heldWatchSymbols.add(watchSymbolKey(holding.symbol));
      }
    }
    renderWatchlist();
    if (!balance) {
      value.textContent = "잔고 동기화 대기";
      return;
    }
    const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW" });
    const stocks = Number(balance.value_krw);
    const hasCash = balance.cash_domestic_krw != null && balance.cash_foreign_krw != null;
    const cash = hasCash ? Number(balance.cash_domestic_krw) + Number(balance.cash_foreign_krw) : 0;
    const estimate = balance.estimated_assets_krw;
    const candidate = estimate == null || !hasCash ? null : Number(estimate) - stocks - cash;
    const rp = candidate != null && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
    const total = rp == null ? stocks + cash : Number(estimate);
    value.textContent = won.format(total);
    performanceRow.hidden = !numeric(balance.return_pct);
    showPerformance(performance,balance.return_pct,signedWatchPercent);
    showHoldings(balance);

    showProfit(balance.realized_profit);
    return balance;
  } catch (error) {
    if (token === accessToken) value.textContent = error.code === "PGRST205" ? "잔고 설정 대기" : "잔고를 불러오지 못했습니다";
  }
}

async function openWorkspace(session, remember) {
  if (session.user?.id !== ownerId) {
    const error = new Error("Owner account required");
    error.code = "owner_required";
    throw error;
  }
  const stored = saveSession(remember ? session.refresh_token : null);
  token = session.access_token;
  login.hidden = true;
  setDetail(false);
  workspace.hidden = false;
  navigation.hidden = false;
  if (returnToStock) {
    selectView("home");
    instrument.open(returnToStock);
    returnToStock = null;
  } else {
    selectView(document.body.dataset.view || "home");
    instrument.refresh();
  }
  valuationSnapshot = loadValuation(token);
  message.textContent = remember && !stored ? "This browser could not save your session." : "";
}

async function restoreSession() {
  if (!storedSession()) return;
  login.hidden = true;
  try {
    const resume = async () => {
      const refreshToken = storedSession();
      if (!refreshToken) {
        selectView(document.body.dataset.view);
        return;
      }
      const session = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: refreshToken },
      });
      await openWorkspace(session, true);
    };
    if (navigator.locks) await navigator.locks.request(storageKey, resume);
    else await resume();
  } catch (error) {
    if (error.httpStatus === 400 || error.httpStatus === 401 || error.code === "owner_required") {
      saveSession(null);
    }
    selectView(document.body.dataset.view);
    if (!login.hidden) message.textContent = "Your saved session could not be restored. Sign in again.";
  }
}

selectView("home");
restoreSession();
