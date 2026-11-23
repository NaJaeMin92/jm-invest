import {setupWatchEditor} from "./watch-editor.js?v=49";
import {setupOrders} from "./orders.js?v=55";
import { publicQuote, setupInstrument, sparkline } from "./instrument.js?v=58";
import {fetchWatchQuotes, usMarketSession, watchQuoteForSession} from "./watch-quotes.js?v=61";

const service = "https://mfycpprqyaidoixytdim.supabase.co";
const publicKey = "sb_publishable_KIxbzozNkk50oEZ9GehtZA_E484E5Lr";
const login = document.querySelector("#login");
const workspace = document.querySelector("#private");
const message = document.querySelector("#status");
let token = null;
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

const home = document.querySelector("#account-home");
const detail = document.querySelector("#trade-detail");
const logout = document.querySelector("#logout");
const navigation = document.querySelector("#bottom-nav");
const navButtons = [...navigation.querySelectorAll("button")];
function selectView(view) {
  const needsLogin = view !== "home" && !token;
  document.body.dataset.view = view;
  setDetail(false);
  login.hidden = !needsLogin;
  workspace.hidden = needsLogin;
  message.textContent = "";
  for (const button of navButtons) {
    const active = button.dataset.view === view;
    document.querySelector(`#tab-${button.dataset.view}`).hidden = !active || needsLogin;
    if (active) {
      document.querySelector("#section-icon").replaceChildren(button.querySelector("svg").cloneNode(true));
      button.setAttribute("aria-current", "page");
    }
    else button.removeAttribute("aria-current");
  }
  document.querySelector("#page-heading").textContent = {
    home:"My Watchlist", account:"계좌", profit:"Realized P&L", more:"Menu"
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
  window.scrollTo(0, 0);
  if (view === "home") refreshWatchlistQuotes();
  else syncKiwoomQuotes();
}
for (const button of navButtons) {
  button.addEventListener("click", () => selectView(button.dataset.view));
}

for (const button of document.querySelectorAll("[data-shortcut]")) {
  button.addEventListener("click", () => selectView(button.dataset.shortcut));
}

function setDetail(open) {
  home.hidden = open;
  detail.hidden = !open;
  document.querySelector("#back-accounts").hidden = !open;
  document.querySelector("#section-icon").hidden = open;
  document.querySelector("#page-heading").textContent = open ? "키움증권" : "계좌";
}

document.querySelector("#open-kiwoom").addEventListener("click", () => {
  setDetail(true);
  document.querySelector("#back-accounts").focus();
});
document.querySelector("#back-accounts").addEventListener("click", () => {
  setDetail(false);
  document.querySelector("#open-kiwoom").focus();
});


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
  orders.signOut();
  saveSession(null);
  if (holdingsDialog.open) holdingsDialog.close();
  holdingsList.replaceChildren();
  document.querySelector("#holdings-summary").textContent = "";
  document.querySelector("#profit-list").replaceChildren();
  document.querySelector("#profit-period").textContent = "";
  document.querySelector("#profit-updated").textContent = "";
  document.querySelector("#profit-total").textContent = "Awaiting sync";
  workspace.hidden = true;
  document.querySelector("#kiwoom-value").textContent = "";
  document.querySelector("#allocation-total").textContent = "";
  document.querySelector("#allocation-value").textContent = "";
  document.querySelector("#allocation-return").textContent = "";
  document.querySelector("#allocation-breakdown").hidden = true;
  document.querySelector("#portfolio-value").textContent = "";
  document.querySelector("#valuation-note").textContent = "";
  document.querySelector("#kiwoom-return").textContent = "";
  watchHoldings = [];
  renderWatchlist();
  setDetail(false);
  login.reset();
  selectView("home");
  request("/auth/v1/logout?scope=local", { method: "POST", accessToken }).catch(() => {});
});

const holdingsDialog = document.querySelector("#holdings-dialog");
const holdingsList = document.querySelector("#holdings-list");
document.querySelector("#open-holdings").addEventListener("click", () => holdingsDialog.showModal());
document.querySelector("#close-holdings").addEventListener("click", () => holdingsDialog.close());
holdingsDialog.addEventListener("click", (event) => {
  if (event.target === holdingsDialog) holdingsDialog.close();
});

function formatStockProfit(balance, won) {
  const holdings = balance.holdings;
  if (!Array.isArray(holdings) || balance.return_pct == null) return "평가손익 동기화 대기";
  const profits = holdings.map((holding) => holding.profit_krw);
  if (profits.some((amount) => amount == null || amount === "" || !Number.isFinite(Number(amount)))) {
    return "평가손익 동기화 대기";
  }
  const total = profits.reduce((sum, amount) => sum + Number(amount), 0);
  return `${total > 0 ? "+" : ""}${won.format(total)} (${Math.abs(Number(balance.return_pct)).toFixed(2)}%)`;
}

function showHoldings(balance) {
  const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW" });
  document.querySelector("#holdings-summary").textContent = formatStockProfit(balance, won);
  holdingsList.replaceChildren();
  const holdings = balance.holdings;
  if (!Array.isArray(holdings)) {
    const item = document.createElement("li");
    item.textContent = "동기화 후 보유종목을 표시합니다.";
    holdingsList.append(item);
    return;
  }
  if (!holdings.length) {
    const item = document.createElement("li");
    item.textContent = "보유 중인 미국주식이 없습니다.";
    holdingsList.append(item);
    return;
  }
  for (const holding of [...holdings].sort((a, b) => Number(b.value_krw) - Number(a.value_krw))) {
    const item = document.createElement("li");
    const left = document.createElement("div");
    left.className = "holding-main";
    const logo = document.createElement("span");
    logo.className = "holding-logo";
    const ticker = String(holding.symbol || "").toUpperCase();
    const logoFiles = { NVDA: "nvda", GOOGL: "goog", GOOG: "goog", AMZN: "amzn", AVGO: "avgo", NBIS: "nbis", AMZU: "amzu", SOXX: "soxx", SOXL: "soxl" };
    if (logoFiles[ticker]) {
      const image = document.createElement("img");
      image.src = `./assets/companies/${logoFiles[ticker]}.png?v=29`;
      image.alt = "";
      image.addEventListener("error", () => {
        image.remove();
        logo.textContent = ticker.slice(0, 2);
        logo.classList.remove("has-logo");
      });
      logo.classList.add("has-logo");
      logo.append(image);
    } else {
      logo.textContent = ticker.slice(0, 2);
    }
    const labels = document.createElement("div");
    const name = document.createElement("strong");
    const quantity = document.createElement("small");
    const right = document.createElement("div");
    const value = document.createElement("strong");
    const profit = document.createElement("small");
    name.textContent = holding.name === ticker ? ticker : `${holding.name} (${ticker})`;
    quantity.textContent = `${Number(holding.quantity).toLocaleString("en-US")}주`;
    value.textContent = won.format(Number(holding.value_krw));
    const amount = Number(holding.profit_krw);
    profit.textContent = `${amount > 0 ? "+" : ""}${won.format(amount)} (${Math.abs(Number(holding.return_pct)).toFixed(2)}%)`;
    profit.dataset.direction = amount < 0 ? "down" : "up";
    labels.append(name, quantity);
    left.append(logo, labels);
    right.append(value, profit);
    const content = document.createElement("div");
    content.className = "holding-top";
    content.append(left, right);
    const metrics = document.createElement("div");
    metrics.className = "holding-metrics";
    const money = (amount, currency) => {
      if (amount == null || amount === "" || !Number.isFinite(Number(amount))) return "동기화 대기";
      return new Intl.NumberFormat("ko-KR", {
        style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 4,
      }).format(Number(amount));
    };
    const currency = /^[A-Z]{3}$/.test(holding.currency || "") ? holding.currency : null;
    const priceDigits = Math.max(2, ...[holding.cost_price, holding.current_price].map((price) => {
      const fraction = String(price ?? "").split(".")[1] || "";
      return fraction.replace(/0+$/, "").length;
    }));
    const formatPrice = (price) => {
      if (!currency || price == null || price === "" || !Number.isFinite(Number(price))) return "동기화 대기";
      return new Intl.NumberFormat("ko-KR", {
        style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits,
      }).format(Number(price));
    };
    for (const [label, metric] of [
      ["매입가", formatPrice(holding.cost_price)],
      ["매입금액", money(holding.cost_krw, "KRW")],
      ["현재가", formatPrice(holding.current_price)],
      ["평가금액", money(holding.value_krw, "KRW")],
    ]) {
      const cell = document.createElement("div");
      const title = document.createElement("small");
      const text = document.createElement("span");
      title.textContent = label;
      text.textContent = metric;
      cell.append(title, text);
      metrics.append(cell);
    }
    item.append(content, metrics);
    holdingsList.append(item);
  }
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

let watchHoldings = [];
const watchKey = "jm-invest:watchlist:v1";
const watchList = document.querySelector("#home-holdings");
const watchStatus = document.querySelector("#home-value");
const watchForm = document.querySelector("#watch-form");
// The sample watchlist still supplies logos and historical mini charts.
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

const marketQuotes = new Map();
const watchDollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 4
});
const nameFor = symbol => snapshots.get(symbol)?.name || marketQuotes.get(symbol)?.description
  || stockDirectory?.find(item => item.symbol === symbol)?.name || symbol;
const watchEditor = setupWatchEditor({watchKey, nameFor, refresh() {
  renderWatchlist();
  refreshWatchlistQuotes();
}});
const readWatchlist = watchEditor.readList;
let nvidiaHistory;
publicQuote("NVDA").then(quote => {
  if (!quote?.intraday?.length) return;
  nvidiaHistory = quote;
  renderWatchlist();
});

const kiwoomTicks = new Map();
const kiwoomPhases = {"0": "Regular", "1": "Pre", "2": "After"};
let kiwoomStream;
let redrawQuotes;

async function syncKiwoomQuotes() {
  if (location.hostname !== "127.0.0.1") return;
  const active = token && !document.hidden && document.body.dataset.view === "home";
  const items = active ? [...new Set(readWatchlist())].sort().flatMap(symbol => {
    const exchange = marketQuotes.get(symbol)?.exchange;
    return exchange ? [{jmcode: symbol, stex_tp: exchange}] : [];
  }).slice(0, 200) : [];
  const key = JSON.stringify(items);
  if (kiwoomStream?.key === key && kiwoomStream.token === token) return;
  kiwoomStream?.controller.abort();
  kiwoomStream = null;
  if (kiwoomTicks.size) {
    kiwoomTicks.clear();
    renderWatchlist();
  }
  if (!items.length) return;

  const controller = new AbortController();
  const stream = {key, token, controller};
  kiwoomStream = stream;
  try {
    const response = await fetch("./api/quotes/stream", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: key,
      signal: controller.signal
    });
    if (!response.ok || !response.body) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    try {
      while (kiwoomStream === stream) {
        const {done, value} = await reader.read();
        if (done || kiwoomStream !== stream) break;
        const lines = (pending + value).split("\n");
        pending = lines.pop();
        for (const line of lines) {
          const tick = JSON.parse(line);
          if (!tick || !Number.isFinite(tick.price)) continue;
          kiwoomTicks.set(tick.symbol, tick);
          redrawQuotes ??= setTimeout(() => {
            redrawQuotes = undefined;
            renderWatchlist();
          }, 250);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch (error) {
    if (!controller.signal.aborted) console.warn("Kiwoom quote stream disconnected", error);
  } finally {
    if (kiwoomStream === stream) {
      kiwoomStream = null;
      kiwoomTicks.clear();
      renderWatchlist();
    }
  }
}

let watchQuoteRequest;
let lastWatchSession;
async function refreshWatchlistQuotes() {
  if (document.hidden || document.body.dataset.view !== "home") {
    syncKiwoomQuotes();
    return;
  }
  const session = usMarketSession();
  const sessionKey = session.date + session.phase;
  if (lastWatchSession !== sessionKey) {
    lastWatchSession = sessionKey;
    renderWatchlist();
  }
  const symbols = [...new Set(readWatchlist())].sort();
  const key = symbols.join(",");
  if (key === watchQuoteRequest?.key) {
    syncKiwoomQuotes();
    return;
  }
  watchQuoteRequest?.controller.abort();
  const controller = new AbortController();
  const pending = { key, controller };
  watchQuoteRequest = pending;
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const updates = await fetchWatchQuotes(symbols, controller.signal);
    if (watchQuoteRequest !== pending) return;
    for (const [symbol, quote] of updates) {
      if (quote) marketQuotes.set(symbol, quote);
      else marketQuotes.delete(symbol);
    }
  } catch (error) {
    console.warn("Unable to update watchlist quotes", error);
  } finally {
    clearTimeout(timeout);
    if (watchQuoteRequest === pending) {
      watchQuoteRequest = null;
      syncKiwoomQuotes();
      renderWatchlist();
    }
  }
}
setInterval(refreshWatchlistQuotes, 30_000);
document.addEventListener("visibilitychange", refreshWatchlistQuotes);
window.addEventListener("online", refreshWatchlistQuotes);

const openInstrument = setupInstrument({
  search() {
    selectView("home");
    watchEditor.open();
    document.querySelector("#watch-symbol").focus();
  },
  nameFor,
  readList: readWatchlist,
  saveList: watchEditor.saveList,
});
function renderWatchlist() {
  watchEditor.renameHeading();
  const symbols = readWatchlist();
  const session = usMarketSession();
  const date = session.date.replaceAll("-", "");
  const quotes = new Map(symbols.map(symbol => {
    const tick = token && kiwoomTicks.get(symbol);
    const label = tick && kiwoomPhases[tick.session];
    if (label === session.phase && tick.date === date) {
      return [symbol, {...tick, label, fromKiwoom: true}];
    }
    return [symbol, watchQuoteForSession(marketQuotes.get(symbol), session)];
  }));
  if (sortDirection) symbols.sort((a, b) => {
    const left = quotes.get(a)?.change, right = quotes.get(b)?.change;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return Number(Number.isFinite(right)) - Number(Number.isFinite(left));
    }
    return sortDirection * (left - right);
  });
  const focusedQuote = watchList.contains(document.activeElement) ? document.activeElement.href : null;
  watchList.replaceChildren();
  document.querySelector("#watch-empty").hidden = Boolean(symbols.length);
  for (const symbol of symbols) {
    const row = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "watch-ticker-icon";
    const logoFiles = { NVDA:"nvda", GOOGL:"goog", GOOG:"goog", AMZN:"amzn", AVGO:"avgo", NBIS:"nbis", AMZU:"amzu", SOXX:"soxx", SOXL:"soxl" };
    badge.textContent = symbol.slice(0, 2);
    const snapshot = snapshots.get(symbol);
    if (snapshot) {
      row.style.setProperty("--sprite-position", `${snapshot.index * 12.5}%`);
      badge.classList.add("reference-logo");
      badge.textContent = "";
    } else if (logoFiles[symbol]) {
      const image = document.createElement("img");
      image.src = `./assets/companies/${logoFiles[symbol]}.png?v=29`;
      image.alt = "";
      image.addEventListener("load", () => { badge.firstChild?.remove(); });
      image.addEventListener("error", () => image.remove());
      badge.append(image);
    }
    const identity = document.createElement("div");
    identity.className = "watch-identity";
    const name = document.createElement("strong");
    const subtitle = document.createElement("small");
    const market = quotes.get(symbol);
    subtitle.textContent = nameFor(symbol);
    const caption = document.createElement("div");
    caption.className = "watch-caption";
    caption.append(subtitle);
    if (market) {
      const tag = document.createElement("span");
      tag.textContent = market.label;
      tag.className = market.futures ? "session-tag futures" : "session-tag";
      if (!market.futures && ["Pre", "After"].includes(session.phase) && market.label !== session.phase) {
        tag.title = session.phase + " quote pending";
      }
      caption.append(tag);
    }
    identity.append(name, caption);
    const chart = document.createElement("span");
    chart.className = snapshot ? "mini-chart reference-chart" : "mini-chart";
    chart.setAttribute("aria-hidden", "true");
    const quote = document.createElement("div");
    quote.className = "watch-quote";
    const priceLabel = document.createElement("strong");
    const priceNote = document.createElement("small");
    const holding = watchHoldings.find((item) => item.symbol === symbol);
    const price = holding?.current_price;
    const hasPrice = price != null && price !== "" && Number.isFinite(Number(price));
    if (market) {
      const {change, delayMinutes} = market;
      priceLabel.textContent = watchDollars.format(market.price);
      const percent = Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "";
      const stale = Date.now() - market.receivedAt >= 90_000;
      const delay = market.fromKiwoom ? "Kiwoom" : stale ? "Last quote" : delayMinutes ? `${delayMinutes}m delay` : "";
      priceNote.textContent = [percent, delay].filter(Boolean).join(" · ");
      if (Number.isFinite(change)) quote.dataset.direction = change < 0 ? "down" : "up";
    } else {
      priceLabel.textContent = hasPrice ? watchDollars.format(Number(price)) : "—";
      priceNote.textContent = hasPrice ? "Last account sync" : "No quote";
    }
    if (symbol === "NVDA" && nvidiaHistory) {
      chart.style.color = nvidiaHistory.percent < 0 ? "var(--down)" : "var(--up)";
      chart.append(sparkline(nvidiaHistory.intraday));
    }
    quote.append(priceLabel, priceNote);
    const referenceSymbols = { BZMAIN: "BZmain", CLMAIN: "CLmain" };
    name.textContent = referenceSymbols[symbol] || symbol;
    {
      const link = document.createElement("a");
      link.href = "#stock=" + encodeURIComponent(symbol);
      link.className = "symbol-link";
      link.textContent = name.textContent;
      link.setAttribute("aria-label", "Open " + symbol + " chart");
      link.addEventListener("click", event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openInstrument(symbol);
      });
      name.replaceChildren(link);
    }
    row.append(badge, identity, chart, quote);
    watchList.append(row);
  }
  if (focusedQuote) [...watchList.querySelectorAll(".symbol-link")].find(link => link.href === focusedQuote)
    ?.focus({preventScroll: true});
}
var stockDirectory;
watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#watch-symbol").value.trim().toUpperCase();
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
    const matches = stockDirectory.filter((item) =>
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
  const note = document.querySelector("#valuation-note");
  const performance = document.querySelector("#kiwoom-return");
  const accountValue = document.querySelector("#kiwoom-value");

  const allocationTotal = document.querySelector("#allocation-total");
  const allocation = document.querySelector("#allocation-breakdown");
  allocationTotal.textContent = "조회 중…";
  allocation.hidden = true;
  accountValue.hidden = true;
  accountValue.textContent = "";
  value.textContent = "조회 중…";
  document.querySelector("#cash-value").textContent = "동기화 대기";
  document.querySelector("#cash-breakdown").textContent = "";
  document.querySelector("#cash-share").textContent = "";
  note.textContent = "";
  performance.textContent = "";
  try {
    const [balance] = await request("/rest/v1/kiwoom_valuation?select=*&limit=1", { accessToken });
    if (token !== accessToken) return;
    if (!balance) {
      value.textContent = allocationTotal.textContent = "잔고 동기화 대기";
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
    document.querySelector("#rp-value").textContent = rp == null ? "확인 필요" : won.format(rp);
    document.querySelector("#rp-note").textContent = rp == null ? "총자산·예수금 확인 필요" : "총자산에서 주식과 예수금을 뺀 추정액";
    document.querySelector("#rp-share").textContent = rp != null && total > 0 ? new Intl.NumberFormat("ko-KR", { style: "percent", maximumFractionDigits: 1 }).format(rp / total) : "";
    const canCompare = stocks >= 0 && cash >= 0 && total > 0;
    const stockWeight = canCompare ? stocks / total : 0;
    value.textContent = accountValue.textContent = won.format(total);
    allocationTotal.textContent = value.textContent;
    accountValue.hidden = false;
    const bar = document.querySelector("#allocation-bar");
    bar.hidden = !canCompare;
    bar.style.setProperty("--stock-share", `${stockWeight * 100}%`);
    bar.style.setProperty("--cash-end", `${(stockWeight + cash / total) * 100}%`);
    bar.setAttribute("aria-label", rp == null ? "주식 및 예수금 비중" : "주식, 예수금, 차액 비중");
    const percent = new Intl.NumberFormat("ko-KR", { style: "percent", maximumFractionDigits: 1 });
    document.querySelector("#stock-share").textContent = hasCash && canCompare ? percent.format(stockWeight) : "미국주식";
    if (hasCash) {
      document.querySelector("#cash-value").textContent = won.format(cash);
      const usd = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "USD", currencyDisplay: "code" });
      const foreignLabel = balance.cash_usd == null
        ? `외화 환산 ${won.format(balance.cash_foreign_krw)}`
        : usd.format(balance.cash_usd);
      document.querySelector("#cash-breakdown").textContent =
        `${won.format(balance.cash_domestic_krw)} KRW\n${foreignLabel}`;
      if (canCompare) document.querySelector("#cash-share").textContent = percent.format(cash / total);
    }
    performance.dataset.direction = Number(balance.return_pct) < 0 ? "down" : "up";
    note.textContent = new Date(balance.observed_at).toLocaleString("en-US", { timeZone: "Asia/Seoul" }) + " KST";
    performance.textContent = balance.return_pct == null ? "" : "수익률 " + Number(balance.return_pct).toFixed(2) + "%";
    const allocationReturn = document.querySelector("#allocation-return");
    document.querySelector("#allocation-value").textContent = won.format(stocks);
    allocationReturn.textContent = formatStockProfit(balance, won);
    allocationReturn.dataset.direction = performance.dataset.direction;
    allocation.hidden = false;
    showHoldings(balance);
    watchHoldings = Array.isArray(balance.holdings) ? balance.holdings : [];
    renderWatchlist();

    showProfit(balance.realized_profit);
  } catch (error) {
    if (token === accessToken) value.textContent = allocationTotal.textContent = error.code === "PGRST205" ? "잔고 설정 대기" : "잔고를 불러오지 못했습니다";
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
  selectView(document.body.dataset.view || "home");
  loadValuation(token);
  orders.refresh();
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

const orders = setupOrders(() => token);
selectView("home");
restoreSession();
