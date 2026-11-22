"use strict";

const service = "https://mfycpprqyaidoixytdim.supabase.co";
const publicKey = "sb_publishable_KIxbzozNkk50oEZ9GehtZA_E484E5Lr";
const login = document.querySelector("#login");
const workspace = document.querySelector("#private");
const symbols = document.querySelector("#trade-symbol");
const chart = document.querySelector("#trade-chart");
let trades = [];
const fills = document.querySelector("#fills");
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

function render(list, rows, format, emptyLabel) {
  list.replaceChildren();
  for (const row of rows.length ? rows.map(format) : [emptyLabel]) {
    const item = document.createElement("li");
    item.textContent = row;
    list.append(item);
  }
}

async function readRecords(accessToken) {
  const rows = [];
  for (let offset = 0; ; offset += 250) {
    const batch = await request(`/rest/v1/kiwoom_fills?select=symbol,order_date,broker_fill_time,side,price,quantity&order=order_date.desc,id.desc&limit=250&offset=${offset}`, { accessToken });
    rows.push(...batch);
    if (batch.length < 250) return rows;
  }
}

function drawChart() {
  chart.replaceChildren();
  const records = trades.filter((trade) => trade.symbol === symbols.value).reverse();
  if (!records.length) return;
  const prices = records.map((trade) => Number(trade.price));
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 240;
  canvas.style.width = "100%";
  canvas.setAttribute("aria-label", "거래 순서별 체결 가격. 매수는 파란 점, 매도는 빨간 점.");
  chart.append(canvas);
  const ctx = canvas.getContext("2d");
  const offset = 90;
  ctx.font = "16px system-ui";
  for (const [y, price] of [[25, high], [195, low]]) {
    ctx.fillStyle = "#52647b";
    ctx.fillText("$" + price.toFixed(2), 4, y + 5);
    ctx.strokeStyle = "#e3e9f3";
    ctx.beginPath();
    ctx.moveTo(offset, y);
    ctx.lineTo(584, y);
    ctx.stroke();
  }
  ctx.fillText(records[0].order_date, offset, 225);
  if (records.length > 1) ctx.fillText(records.at(-1).order_date, 480, 225);
  records.forEach((record, index) => {
    const x = records.length === 1 ? 337 : offset + index * 494 / (records.length - 1);
    const y = high === low ? 110 : 195 - (Number(record.price) - low) / (high - low) * 170;
    ctx.fillStyle = record.side === "buy" ? "#214dc9" : "#b42339";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
  });
  const legend = document.createElement("p");
  legend.textContent = "거래 순서 · 파랑 매수 · 빨강 매도";
  chart.append(legend);
}

function showRecords(records) {
  trades = records;
  symbols.replaceChildren(...[...new Set(records.map((record) => record.symbol))].sort().map((symbol) => new Option(symbol, symbol)));
  symbols.disabled = !records.length;
  drawChart();
  render(fills, trades, ({ order_date, symbol, side, price, quantity }) =>
    `${order_date} · ${symbol} · ${side === "buy" ? "매수" : "매도"} · $${price} × ${quantity}`, "가져온 체결 내역이 없습니다.");
}

const home = document.querySelector("#account-home");
const detail = document.querySelector("#trade-detail");
const logout = document.querySelector("#logout");

function setDetail(open) {
  home.hidden = open;
  detail.hidden = !open;
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

symbols.addEventListener("change", drawChart);

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = login.querySelector("button");
  submit.disabled = true;
  message.textContent = "로그인 확인 중…";
  let signedIn = false;
  try {
    const body = { email: login.elements.email.value.trim(), password: login.elements.password.value };
    const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body });
    signedIn = true;
    const remember = login.elements.remember.checked;
    await openWorkspace(session, remember);

  } catch (error) {
    if (error.code === "owner_required") {
      message.textContent = "이 사이트에 등록된 본인 계정으로 로그인하세요.";
    } else if (signedIn) {
      message.textContent = `로그인은 성공했지만 체결을 조회하지 못했습니다${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}.`;
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
  workspace.hidden = true;
  document.querySelector("#kiwoom-value").textContent = "";
  document.querySelector("#allocation-total").textContent = "";
  document.querySelector("#allocation-value").textContent = "";
  document.querySelector("#allocation-return").textContent = "";
  document.querySelector("#allocation-breakdown").hidden = true;
  document.querySelector(".trade-history").open = false;
  document.querySelector("#portfolio-value").textContent = "";
  document.querySelector("#valuation-note").textContent = "";
  document.querySelector("#kiwoom-return").textContent = "";
  logout.hidden = true;
  setDetail(false);
  showRecords([]);
  symbols.replaceChildren();
  chart.replaceChildren();
  fills.replaceChildren();
  login.reset();
  login.hidden = false;
  message.textContent = "";
  request("/auth/v1/logout?scope=local", { method: "POST", accessToken }).catch(() => {});
});

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
  note.textContent = "";
  performance.textContent = "";
  try {
    const [balance] = await request("/rest/v1/kiwoom_valuation?select=value_krw,return_pct,observed_at&limit=1", { accessToken });
    if (token !== accessToken) return;
    if (!balance) {
      value.textContent = allocationTotal.textContent = "잔고 동기화 대기";
      return;
    }
    value.textContent = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW" }).format(balance.value_krw);
    accountValue.textContent = value.textContent;
    accountValue.hidden = false;
    allocationTotal.textContent = value.textContent;
    performance.dataset.direction = Number(balance.return_pct) < 0 ? "down" : "up";
    note.textContent = new Date(balance.observed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST 기준";
    performance.textContent = balance.return_pct == null ? "" : "평가수익률 " + Number(balance.return_pct).toFixed(2) + "%";
    const allocationReturn = document.querySelector("#allocation-return");
    document.querySelector("#allocation-value").textContent = value.textContent;
    allocationReturn.textContent = performance.textContent;
    allocationReturn.dataset.direction = performance.dataset.direction;
    allocation.hidden = Number(balance.value_krw) <= 0;
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
  const records = await readRecords(session.access_token);
  token = session.access_token;
  showRecords(records);
  login.hidden = true;
  setDetail(false);
  workspace.hidden = false;
  logout.hidden = false;
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
