"use strict";

const service = "https://mfycpprqyaidoixytdim.supabase.co";
const publicKey = "sb_publishable_KIxbzozNkk50oEZ9GehtZA_E484E5Lr";
const login = document.querySelector("#login");
const workspace = document.querySelector("#private");
const entry = document.querySelector("#entry");
const entries = document.querySelector("#entries");
const fills = document.querySelector("#fills");
const status = document.querySelector("#status");
let token = null;

async function request(path, { method = "GET", body, accessToken = token } = {}) {
  const headers = { apikey: publicKey, "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(service + path, {
    method, headers, cache: "no-store", body: body && JSON.stringify(body),
  });
  if (!response.ok) throw new Error(String(response.status));
  const payload = await response.text();
  return payload ? JSON.parse(payload) : null;
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
  return Promise.all([
    request("/rest/v1/trade_journal?select=symbol,trade_date,note&order=trade_date.desc,id.desc", { accessToken }),
    request("/rest/v1/kiwoom_fills?select=symbol,order_date,side,price,quantity&order=order_date.desc,id.desc", { accessToken }),
  ]);
}

function showRecords([notes, trades]) {
  render(entries, notes, ({ trade_date, symbol, note }) => `${trade_date} · ${symbol} · ${note}`, "저장된 일지가 없습니다.");
  render(fills, trades, ({ order_date, symbol, side, price, quantity }) =>
    `${order_date} · ${symbol} · ${side === "buy" ? "매수" : "매도"} · $${price} × ${quantity}`, "가져온 체결 내역이 없습니다.");
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = login.querySelector("button");
  submit.disabled = true;
  status.textContent = "로그인 확인 중…";
  try {
    const body = Object.fromEntries(new FormData(login));
    const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body });
    const records = await readRecords(session.access_token);
    token = session.access_token;
    showRecords(records);
    login.hidden = true;
    workspace.hidden = false;
    status.textContent = "";
  } catch {
    status.textContent = "로그인 또는 데이터 조회에 실패했습니다. 계정 정보와 프로젝트 상태를 확인하세요.";
  } finally {
    login.elements.password.value = "";
    submit.disabled = false;
  }
});

entry.addEventListener("submit", async (event) => {
  event.preventDefault();
  const accessToken = token;
  if (!accessToken) return;
  const submit = entry.querySelector("button");
  submit.disabled = true;
  const body = Object.fromEntries(new FormData(entry));
  body.symbol = body.symbol.trim().toUpperCase();
  body.note = body.note.trim();
  try {
    if (!body.symbol || !body.note) {
      status.textContent = "종목과 메모를 입력하세요.";
      return;
    }
    await request("/rest/v1/trade_journal", { method: "POST", body, accessToken });
    if (accessToken !== token) return;
    entry.reset();
    status.textContent = "저장했습니다.";
    const records = await readRecords(accessToken);
    if (accessToken === token) showRecords(records);
  } catch {
    if (accessToken === token) status.textContent = "일지를 처리하지 못했습니다. 세션이 만료되었다면 다시 로그인하세요.";
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#logout").addEventListener("click", () => {
  const accessToken = token;
  token = null;
  workspace.hidden = true;
  entries.replaceChildren();
  fills.replaceChildren();
  entry.reset();
  login.reset();
  login.hidden = false;
  status.textContent = "로그아웃했습니다.";
  request("/auth/v1/logout?scope=local", { method: "POST", accessToken }).catch(() => {});
});
