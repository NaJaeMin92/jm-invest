const sigmaSnapshot = "./assets/market/sigma-inputs.json?v=49";
const sigmaFeed = "https://raw.githubusercontent.com/NaJaeMin92/jm-invest/market-data/sigma-inputs.json";
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

export function calculateSigma({anchor,close,call,put,fromDate,through,expiry}) {
  const elapsed = Date.parse(expiry) - Date.parse(fromDate);
  const horizon = Date.parse(through) - Date.parse(fromDate);
  if (![anchor,close,call,put,elapsed,horizon].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Enter positive prices and dates after the anchor");
  }
  // ATM straddle ≈ sqrt(2/π) σ in the short-term normal approximation.
  const width = (call + put) * Math.sqrt(Math.PI / 2) * Math.sqrt(horizon / elapsed);
  return { low:anchor-width, high:anchor+width, move:100*width/anchor, z:(close-anchor)/width };
}

function renderSigma(container, data, symbol, name) {
  const level = data?.symbols?.[symbol];
  const source = document.querySelector("#sigma-source");
  source.href = "https://www.nasdaq.com/market-activity/stocks/" + encodeURIComponent(symbol.toLowerCase()) + "/option-chain";
  if (!level) {
    container.replaceChildren(node("p", "No option quote from the anchor session. Enter raw ATM option prices below to calculate its band.", "market-date"));
    return;
  }
  const { low, high, move, z } = calculateSigma(level);
  const { anchor, close, change } = level;
  const status = z >= 1.5 ? "Overheated" : z >= 1 ? "Above range" : z <= -1.5 ? "Oversold" : z <= -1 ? "Below range" : "Normal";
  const block = node("article", "", "sigma-overview");
  const heading = node("div", "", "sigma-heading");
  const identity = node("div", "", "sigma-identity");
  identity.append(node("strong", symbol), node("p", name === symbol ? "" : name));
  heading.append(identity, node("span", status, "sigma-status"));
  const details = facts([
    ["Last close", usd.format(close)], ["Session change", Number.isFinite(change) ? signed(change, 2) + "%" : "—"],
    ["Position on band", signed(z, 2) + "σ"], ["Expected range", usd.format(low) + " – " + usd.format(high)],
    ["Band width", "±" + move.toFixed(1) + "%"], ["Anchor close", usd.format(anchor)]
  ], "sigma-details");
  details.children[1].lastElementChild.dataset.change = change < 0 ? "negative" : change > 0 ? "positive" : "flat";
  block.append(
    heading, node("p", "Band window · " + level.fromDate + " → " + level.through, "market-date"),
    meter(50 + 25 * z, ["−2σ", "−1σ", "0σ", "+1σ", "+2σ"], "sigma-meter"), details,
    node("p", level.manual ? "Calculated from your option prices" :
      "Calculated from Nasdaq option quotes · " + usd.format(level.strike) + " strike · Expiry " + level.expiry, "market-date"),
    node("p", "Stock close · " + level.asOf, "market-date")
  );
  container.replaceChildren(block);
}

function showSigmaCalculator(symbol, name) {
  const form = document.querySelector("#sigma-calculator");
  form.reset();
  form.onsubmit = event => {
    event.preventDefault();
    const fields = new FormData(form);
    const level = Object.fromEntries(fields);
    for (const field of ["anchor","close","call","put"]) level[field] = Number(level[field]);
    const error = document.querySelector("#sigma-error");
    try {
      calculateSigma(level);
      level.manual = true;
      level.asOf = "Entered price";
      const target = document.querySelector("#sigma-content");
      target.marketRequest = null;
      renderSigma(target,{symbols:{[symbol]:level}},symbol,name);
      error.textContent = "";
    } catch (problem) {
      error.textContent = problem.message;
    }
  };
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
  const block = node("article", "", "sentiment-overview");
  const scale = node("div", "", "sentiment-gauge");
  const ring = node("div", "", "sentiment-arc");
  ring.setAttribute("aria-hidden", "true");
  const marker = node("span", "", "sentiment-marker");
  marker.style.setProperty("--angle", (1.8 * Math.min(100, Math.max(0, index.score)) - 90) + "deg");
  ring.append(marker);
  const reading = node("div", "", "sentiment-reading");
  const rating = node("p", titleCase(index.rating), "sentiment-rating");
  rating.dataset.rating = index.rating;
  reading.append(node("strong", String(Math.round(index.score)), "market-number"), rating);
  scale.append(ring, reading);
  const endpoints = node("div", "", "sentiment-endpoints");
  endpoints.append(node("span", "0 · Extreme fear"), node("span", "Extreme greed · 100"));
  block.append(
    node("p", "US Market Sentiment", "market-date"),
    scale, endpoints,
    facts([
      ["Previous close", index.previous_close], ["1 week ago", index.previous_1_week],
      ["1 month ago", index.previous_1_month], ["1 year ago", index.previous_1_year]
    ].map(([name, value]) => [name, Number.isFinite(value) ? String(Math.round(value)) : "—"]), "sentiment-history"),
    node("p", (saved ? "Saved reading · " : "Observed · ") + inTimeZone.format(new Date(index.timestamp)) + " ET", "market-date")
  );
  const drivers = components.filter(([key]) => data[key]?.rating)
    .map(([key, label]) => [label, titleCase(data[key].rating)]);
  container.replaceChildren(block);
  if (drivers.length) {
    const list = facts(drivers, "market-drivers");
    for (const item of list.children) item.lastElementChild.dataset.rating = item.lastElementChild.textContent.toLowerCase();
    container.append(node("h4", "Index components"), list);
  }
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
  sigmaSnapshot, sigmaFeed, data => Boolean(data.symbols && Object.values(data.symbols).some(item => item.anchor && item.call && item.put)),
  data => Object.values(data.symbols).reduce((latest, item) => item.asOf > latest ? item.asOf : latest, ""), 300_000
);
const loadSentiment = cachedFeed(
  cnnSnapshot, cnnFeed, data => Number.isFinite(data.fear_and_greed?.score) && Number.isFinite(Date.parse(data.fear_and_greed?.timestamp)),
  data => Date.parse(data.fear_and_greed.timestamp), 60_000
);

export function loadWatchSentiment(render) {
  return loadSentiment((data, saved) => {
    const {score, rating} = data.fear_and_greed;
    render({
      score: Math.round(score),
      rating: titleCase(rating),
      angle: 1.8 * Math.min(100, Math.max(0, score)) - 90,
      saved
    });
  });
}

export function showMarketPanel(panel, symbol, name) {
  const target = document.querySelector("#" + panel + "-content");
  if (panel === "sigma") showSigmaCalculator(symbol, name);
  const request = {};
  target.dataset.symbol = symbol;
  target.marketRequest = request;
  target.textContent = "Loading market data…";
  const render = (data, saved) => {
    if (target.marketRequest !== request) return;
    if (panel === "sigma") renderSigma(target, data, symbol, name);
    else renderSentiment(target, data, saved);
  };
  (panel === "sigma" ? loadSigma : loadSentiment)(render).catch(() => {
    if (target.marketRequest !== request) return;
    if (panel === "sigma") renderSigma(target, null, symbol, name);
    else target.textContent = "Market data is temporarily unavailable.";
  });
}
