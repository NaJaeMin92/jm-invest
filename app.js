"use strict";

const examples = [
  { symbol: "SPY", name: "S&P 500 ETF", anchor: 600, price: 582, width: 4 },
  { symbol: "QQQ", name: "나스닥 100 ETF", anchor: 520, price: 553, width: 5 },
  { symbol: "NVDA", name: "엔비디아", anchor: 130, price: 113, width: 10 },
  { symbol: "AAPL", name: "애플", anchor: 220, price: 224, width: 4 },
];

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 6,
});

function calculate({ anchor, price, width }) {
  const move = anchor * (width / 100);
  const lower = anchor - move;
  const upper = anchor + move;
  const sigma = (price - anchor) / move;
  if (move <= 0 || ![lower, upper, sigma].every(Number.isFinite)) return null;
  return { lower, upper, sigma };
}

function sigmaLabel(sigma) {
  const rounded = Number(sigma.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}σ`;
}

function position(sigma) {
  if (sigma >= 1) return "상단 도달 또는 이탈";
  if (sigma <= -1) return "하단 도달 또는 이탈";
  return "예상 범위 안";
}

const symbols = document.querySelector("#symbols");
const details = document.querySelector("#details");
const buttons = examples.map((example) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = example.symbol;
  button.addEventListener("click", () => select(example));
  symbols.append(button);
  return button;
});

function select(example) {
  const { lower, upper, sigma } = calculate(example);
  const marker = Math.min(100, Math.max(0, 50 + sigma * 25));
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.textContent === example.symbol));
  });
  details.innerHTML = `
    <div class="quote">
      <div>
        <div class="meta">${example.symbol} · ${example.name}</div>
        <div class="hero-value">${dollars.format(example.price)}</div>
      </div>
      <div class="sigma-summary">
        <strong>${sigmaLabel(sigma)}</strong>
        <span>${position(sigma)}</span>
      </div>
    </div>
    <div class="track" aria-hidden="true">
      <div class="band"></div><div class="marker" style="left:${marker}%"></div>
    </div>
    <div class="axis" aria-hidden="true"><span>−1σ</span><span>기준가</span><span>+1σ</span></div>
    <dl>
      <div><dt>기준가</dt><dd>${dollars.format(example.anchor)}</dd></div>
      <div><dt>예상 변동폭</dt><dd>±${example.width}%</dd></div>
      <div><dt>주간 예상 범위</dt><dd>${dollars.format(lower)} ~ ${dollars.format(upper)}</dd></div>
      </dl>`;
}

const form = document.querySelector("#calculator");
const result = document.querySelector("#result");

function showCalculation(event) {
  event?.preventDefault();
  const data = new FormData(form);
  const values = Object.fromEntries(["anchor", "price", "width"].map(
    (field) => [field, Number(data.get(field))]
  ));
  const range = calculate(values);
  result.textContent = range
    ? `${sigmaLabel(range.sigma)} · ${position(range.sigma)} · ${dollars.format(range.lower)} ~ ${dollars.format(range.upper)}`
    : "계산할 수 있는 범위의 숫자를 입력해 주세요.";
}

form.addEventListener("submit", showCalculation);
select(examples[0]);
showCalculation();
