"use strict";

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
  setDetail(false);
  for (const button of navButtons) {
    const active = button.dataset.view === view;
    document.querySelector(`#tab-${button.dataset.view}`).hidden = !active;
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  document.querySelector("#page-heading").textContent = {home:"Watchlists", account:"내 계좌", profit:"실현손익 조회", more:"더보기"}[view];
  window.scrollTo(0, 0);
}
for (const button of navButtons) {
  button.addEventListener("click", () => selectView(button.dataset.view));
}

function setDetail(open) {
  home.hidden = open;
  detail.hidden = !open;
  document.querySelector("#back-accounts").hidden = !open;
  document.querySelector("#page-heading").textContent = open ? "키움증권" : "내 계좌";
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
  message.textContent = "로그인 확인 중…";
  try {
    const body = { email: login.elements.email.value.trim(), password: login.elements.password.value };
    const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body });
    const remember = login.elements.remember.checked;
    await openWorkspace(session, remember);

  } catch (error) {
    if (error.code === "owner_required") {
      message.textContent = "이 사이트에 등록된 본인 계정으로 로그인하세요.";
    } else if (error.code === "invalid_credentials") {
      message.textContent = "이메일 또는 비밀번호가 맞지 않습니다. Supabase Authentication에서 만든 이메일 계정을 사용하세요.";
    } else if (error.code === "email_not_confirmed") {
      message.textContent = "이메일 인증이 완료되지 않았습니다.";
    } else if (error.httpStatus === 429) {
      message.textContent = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.";
    } else {
      message.textContent = `인증 서버에 연결하지 못했습니다${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}.`;
    }
  } finally {
    login.elements.password.value = "";
    submit.disabled = false;
  }
});

document.querySelector("#logout").addEventListener("click", () => {
  const accessToken = token;
  token = null;
  saveSession(null);
  if (holdingsDialog.open) holdingsDialog.close();
  holdingsList.replaceChildren();
  document.querySelector("#holdings-summary").textContent = "";
  document.querySelector("#profit-list").replaceChildren();
  document.querySelector("#profit-period").textContent = "";
  document.querySelector("#profit-updated").textContent = "";
  document.querySelector("#profit-total").textContent = "동기화 대기";
  workspace.hidden = true;
  document.querySelector("#kiwoom-value").textContent = "";
  document.querySelector("#allocation-total").textContent = "";
  document.querySelector("#allocation-value").textContent = "";
  document.querySelector("#allocation-return").textContent = "";
  document.querySelector("#allocation-breakdown").hidden = true;
  document.querySelector("#portfolio-value").textContent = "";
  document.querySelector("#valuation-note").textContent = "";
  document.querySelector("#kiwoom-return").textContent = "";
  navigation.hidden = true;
  renderWatchlist();
  setDetail(false);
  login.reset();
  login.hidden = false;
  message.textContent = "";
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
  if (!Array.isArray(holdings) || balance.return_pct == null) return "평가손익 동기화 필요";
  const profits = holdings.map((holding) => holding.profit_krw);
  if (profits.some((amount) => amount == null || amount === "" || !Number.isFinite(Number(amount)))) {
    return "평가손익 동기화 필요";
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
    item.textContent = "종목별 잔고 동기화가 필요합니다.";
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
    quantity.textContent = `${Number(holding.quantity).toLocaleString("ko-KR")}주`;
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
      if (amount == null || amount === "" || !Number.isFinite(Number(amount))) return "동기화 필요";
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
      if (!currency || price == null || price === "" || !Number.isFinite(Number(price))) return "동기화 필요";
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
    total.textContent = "동기화 대기";
    period.textContent = "";
    updated.textContent = "";
    return;
  }
  const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW" });
  total.textContent = won.format(Number(data.total_krw));
  total.dataset.direction = Number(data.total_krw) < 0 ? "down" : "up";
  period.textContent = `${data.start} ~ ${data.end} · 키움 원화 기준`;
  updated.textContent = new Date(data.observed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST 조회";
  if (!data.entries.length) {
    const row = document.createElement("li");
    row.textContent = "기간 내 실현손익이 없습니다.";
    list.append(row);
  }
  for (const entry of data.entries) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const amount = document.createElement("strong");
    label.textContent = `${entry.date} · ${entry.name} (${entry.symbol})`;
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
const watchEdit = document.querySelector("#watch-edit");
let editingWatchlist = false;
watchEdit.addEventListener("click", () => {
  editingWatchlist = !editingWatchlist;
  watchForm.hidden = !editingWatchlist;
  watchEdit.textContent = editingWatchlist ? "Done" : "Edit";
  watchEdit.setAttribute("aria-expanded", String(editingWatchlist));
  renderWatchlist();
});

function readWatchlist() {
  try {
    const value = JSON.parse(localStorage.getItem(watchKey) || "[]");
    return Array.isArray(value) ? value.filter((symbol) => typeof symbol === "string" && /^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol)) : [];
  } catch { return []; }
}
function renderWatchlist() {
  const symbols = readWatchlist();
  watchList.replaceChildren();
  watchStatus.textContent = symbols.length ? "Saved on this device" : "Add symbols to your watchlist.";
  for (const symbol of symbols) {
    const row = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "watch-ticker-icon";
    const logoFiles = { NVDA:"nvda", GOOGL:"goog", GOOG:"goog", AMZN:"amzn", AVGO:"avgo", NBIS:"nbis", AMZU:"amzu", SOXX:"soxx", SOXL:"soxl" };
    badge.textContent = symbol.slice(0, 2);
    if (logoFiles[symbol]) {
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
    subtitle.textContent = stockDirectory?.find((item) => item.symbol === symbol)?.name || "Price unavailable";
    identity.append(name, subtitle);
    const quote = document.createElement("div");
    quote.className = "watch-quote";
    const priceLabel = document.createElement("strong");
    const priceNote = document.createElement("small");
    const holding = watchHoldings.find((item) => item.symbol === symbol);
    const price = holding?.current_price;
    const hasPrice = price != null && price !== "" && Number.isFinite(Number(price));
    priceLabel.textContent = hasPrice
      ? new Intl.NumberFormat("en-US", { style:"currency", currency:"USD" }).format(Number(price))
      : "—";
    priceNote.textContent = hasPrice ? "Last account sync" : "Price unavailable";
    quote.append(priceLabel, priceNote);
    const remove = document.createElement("button");
    name.textContent = symbol;
    remove.textContent = "Remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${symbol}`);
    remove.addEventListener("click", () => {
      try {
        localStorage.setItem(watchKey, JSON.stringify(readWatchlist().filter((item) => item !== symbol)));
        renderWatchlist();
      } catch { watchStatus.textContent = "관심종목을 저장하지 못했습니다."; }
    });
    row.append(badge, identity, editingWatchlist ? remove : quote);
    watchList.append(row);
  }
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
          localStorage.setItem(watchKey, JSON.stringify([...symbols, item.symbol]));
          document.querySelector("#watch-symbol").value = "";
          results.replaceChildren();
          renderWatchlist();
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
  const homeValue = document.querySelector("#home-value");

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
    document.querySelector("#rp-note").textContent = rp == null ? "총자산·예수금 확인 필요" : "차액 추정 · 영웅문 대조 필요";
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
    bar.setAttribute("aria-label", rp == null ? "연동된 주식과 예수금 비중" : "추정 총자산 중 주식, 예수금, 차액 비중");
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
    note.textContent = new Date(balance.observed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST 기준";
    performance.textContent = balance.return_pct == null ? "" : "평가수익률 " + Number(balance.return_pct).toFixed(2) + "%";
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
    if (token === accessToken) value.textContent = allocationTotal.textContent = error.code === "PGRST205" ? "잔고 DB 설정 대기" : "평가액 조회 실패";
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
  selectView("account");
  loadValuation(token);
  message.textContent = remember && !stored ? "이 브라우저에서는 로그인 상태를 저장할 수 없습니다." : "";
}

async function restoreSession() {
  if (!storedSession()) return;
  login.hidden = true;
  message.textContent = "로그인 확인 중…";
  try {
    const resume = async () => {
      const refreshToken = storedSession();
      if (!refreshToken) {
        login.hidden = false;
        message.textContent = "";
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
    login.hidden = false;
    message.textContent = "저장된 로그인으로 화면을 열지 못했습니다. 다시 로그인해 주세요.";
  }
}

restoreSession();
