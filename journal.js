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

symbols.addEventListener("change", drawChart);

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = login.querySelector("button");
  submit.disabled = true;
  message.textContent = "로그인 확인 중…";
  let signedIn = false;
  try {
    const body = Object.fromEntries(new FormData(login));
    body.email = body.email.trim();
    const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body });
    signedIn = true;
    if (session.user?.id !== "9fc22c69-b253-406a-be2b-eb8ad9526a3c") {
      await request("/auth/v1/logout?scope=local", { method: "POST", accessToken: session.access_token }).catch(() => {});
      message.textContent = "이 사이트에 등록된 본인 계정으로 로그인하세요.";
      return;
    }
    const records = await readRecords(session.access_token);
    token = session.access_token;
    showRecords(records);
    login.hidden = true;
    workspace.hidden = false;
    message.textContent = "";
  } catch (error) {
    if (signedIn) {
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
  workspace.hidden = true;
  trades = [];
  symbols.replaceChildren();
  chart.replaceChildren();
  fills.replaceChildren();
  login.reset();
  login.hidden = false;
  message.textContent = "로그아웃했습니다.";
  request("/auth/v1/logout?scope=local", { method: "POST", accessToken }).catch(() => {});
});
