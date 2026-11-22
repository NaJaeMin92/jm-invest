const sigmaSnapshot = "./assets/market/sigma.json?v=47";
const sigmaFeed = "https://raw.githubusercontent.com/NaJaeMin92/jm-invest/refs/heads/market-data/sigma.json";
const cnnSnapshot = "./assets/market/fear-and-greed.json?v=47";
const cnnFeed = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const inTimeZone = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
});
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signed = (number, digits) => (number > 0 ? "+" : "") + number.toFixed(digits);
const titleCase = value => String(value || "").replace(/\b\w/g, letter => letter.toUpperCase());

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Market data unavailable");
  return response.json();
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function facts(entries, className = "market-facts") {
  const list = node("dl", "", className);
  for (const [label, value] of entries) {
    const item = document.createElement("div");
    item.append(node("dt", label), node("dd", value));
    list.append(item);
  }
  return list;
}

function meter(position, labels, className = "") {
  const scale = node("div", "", "market-meter " + className);
  scale.setAttribute("aria-hidden", "true");
  const rail = node("div", "", "market-rail");
  rail.style.setProperty("--position", Math.min(100, Math.max(0, position)) + "%");
  scale.append(rail);
  const ticks = node("div", "", "market-ticks");
  ticks.append(...labels.map(label => node("span", label)));
  scale.append(ticks);
  return scale;
}

function renderSigma(container, data, symbol) {
  const level = data.symbols[symbol];
  const source = document.querySelector("#sigma-source");
  source.href = level ? "https://sigmarange.com/symbol/" + encodeURIComponent(symbol) : "https://sigmarange.com/#watchlist";
  if (!level) {
    container.textContent = "SigmaRange does not publish a weekly range for " + symbol + ".";
    return;
  }
  const { low, high, close, change, move, z } = level;
  const block = node("div", "", "market-card");
  block.append(
    node("p", data.from + " → " + data.through, "market-date"),
    node("strong", usd.format(low) + " – " + usd.format(high), "market-number"),
    node("p", signed(z, 2) + "σ · ±" + move.toFixed(1) + "% implied move", "market-subtitle"),
    meter(50 + 25 * z, ["−2σ", "−1σ", "0σ", "+1σ", "+2σ"], "sigma-meter"),
    facts([["Last close", usd.format(close)], ["Session change", signed(change, 2) + "%"]]),
    node("p", "US session close · " + data.asOf, "market-date")
  );
  container.replaceChildren(block);
}

const components = [
  ["market_momentum_sp500", "Market momentum"],
  ["stock_price_strength", "Stock price strength"],
  ["stock_price_breadth", "Stock price breadth"],
  ["put_call_options", "Put and call options"],
  ["market_volatility_vix", "Market volatility"],
  ["safe_haven_demand", "Safe haven demand"],
  ["junk_bond_demand", "Junk bond demand"],
];
function renderSentiment(container, data, saved) {
  const index = data.fear_and_greed;
  const block = node("div", "", "market-card");
  block.append(
    node("p", "US market sentiment", "market-date"),
    node("strong", String(Math.round(index.score)), "market-number"),
    node("p", titleCase(index.rating), "market-subtitle sentiment-rating"),
    meter(index.score, ["0", "25", "50", "75", "100"], "sentiment-meter"),
    facts([
      ["Previous close", index.previous_close], ["1 week ago", index.previous_1_week],
      ["1 month ago", index.previous_1_month], ["1 year ago", index.previous_1_year]
    ].map(([name, value]) => [name, Number.isFinite(value) ? String(Math.round(value)) : "—"])),
    node("p", (saved ? "Saved reading · " : "Observed · ") + inTimeZone.format(new Date(index.timestamp)) + " ET", "market-date")
  );
  const drivers = components.filter(([key]) => data[key]?.rating)
    .map(([key, label]) => [label, titleCase(data[key].rating)]);
  container.replaceChildren(block);
  if (drivers.length) container.append(node("h4", "Index components"), facts(drivers, "market-drivers"));
}

function cachedFeed(fallback, remote, isValid, timestamp, refreshAfter) {
  let cache, lastFetch = 0, pending;
  return render => {
    if (cache) render(cache.data, cache.saved);
    if (cache && Date.now() - lastFetch < refreshAfter) return Promise.resolve();
    if (!pending) {
      const onData = (data, saved) => {
        if (!isValid(data)) throw new Error("Invalid market data");
        if (!cache || timestamp(data) >= timestamp(cache.data)) cache = { data, saved };
        return cache;
      };
      pending = read(remote).then(data => onData(data, false)).catch(async () => {
        if (cache) return cache;
        return onData(await read(fallback), true);
      }).then(result => {
        lastFetch = Date.now();
        return result;
      }).finally(() => { pending = null; });
    }
    return pending.then(({data, saved}) => render(data, saved));
  };
}

const loadSigma = cachedFeed(
  sigmaSnapshot, sigmaFeed, data => Boolean(data.symbols && data.from && data.through && data.asOf),
  data => data.from + data.asOf, 300_000
);
const loadSentiment = cachedFeed(
  cnnSnapshot, cnnFeed, data => Number.isFinite(data.fear_and_greed?.score) && Number.isFinite(Date.parse(data.fear_and_greed?.timestamp)),
  data => Date.parse(data.fear_and_greed.timestamp), 60_000
);

export function showMarketPanel(panel, symbol) {
  const target = document.querySelector("#" + panel + "-content");
  const request = {};
  target.dataset.symbol = symbol;
  target.marketRequest = request;
  target.textContent = "Loading market data…";
  const render = (data, saved) => {
    if (target.marketRequest !== request) return;
    if (panel === "sigma") renderSigma(target, data, symbol);
    else renderSentiment(target, data, saved);
  };
  (panel === "sigma" ? loadSigma : loadSentiment)(render).catch(() => {
    if (target.marketRequest === request) target.textContent = "Market data is temporarily unavailable.";
  });
}
