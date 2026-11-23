const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

// https://www.nyse.com/trade/hours-calendars
const holidays = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19",
  "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25"
]);
const earlyCloses = new Set([
  "2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"
]);
const futuresTickers = new Map([
  ["BZMAIN", "NYMEX:BZ1!"], ["CLMAIN", "NYMEX:CL1!"]
]);
const kiwoomExchanges = {NASDAQ: "ND", NYSE: "NY", AMEX: "NA"};
const columns = [
  "name", "description", "is_primary", "close", "change", "update_mode", "time",
  "premarket_close", "premarket_change", "postmarket_close", "postmarket_change"
];

function easternParts(date) {
  return Object.fromEntries(easternTime.formatToParts(date).map(({type, value}) => [type, value]));
}

function dateKey({year, month, day}) {
  return `${year}-${month}-${day}`;
}

export function usMarketSession(now = new Date()) {
  const parts = easternParts(now);
  const date = dateKey(parts);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const early = earlyCloses.has(date);
  let phase = "Close";
  if (!["Sat", "Sun"].includes(parts.weekday) && !holidays.has(date)) {
    if (minutes >= 240 && minutes < 570) phase = "Pre";
    else if (minutes >= 570 && minutes < (early ? 780 : 960)) phase = "Regular";
    else if (minutes >= (early ? 780 : 960) && minutes < (early ? 1020 : 1200)) phase = "After";
  }
  return {date, phase};
}

async function scan(market, query, signal) {
  const response = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: "POST",
    headers: {"Content-Type": "text/plain"},
    body: JSON.stringify({...query, columns}),
    credentials: "omit",
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Quote feed returned HTTP ${response.status}`);
  const {data} = await response.json();
  if (!Array.isArray(data)) throw new Error("Quote feed returned an invalid response");
  return data;
}

export async function fetchWatchQuotes(symbols, signal) {
  const session = usMarketSession();
  const equities = symbols.filter(symbol => !futuresTickers.has(symbol));
  const futures = symbols.filter(symbol => futuresTickers.has(symbol));
  const requests = [];
  // Keep batches small and reserve space for duplicate exchange listings.
  for (let index = 0; index < equities.length; index += 50) {
    const batch = equities.slice(index, index + 50);
    const filter = [{
      left: "name", operation: "in_range",
      right: [...new Set(batch.map(symbol => symbol.replace("-", ".")))]
    }];
    requests.push(scan("america", {filter, range: [0, batch.length * 4]}, signal)
      .then(rows => ({symbols: batch, rows, futures: false})));
  }
  if (futures.length) {
    const tickers = new Map(futures.map(symbol => [futuresTickers.get(symbol), symbol]));
    requests.push(scan("futures", {symbols: {tickers: [...tickers.keys()]}}, signal)
      .then(rows => ({symbols: futures, rows, futures: true})));
  }

  const results = await Promise.allSettled(requests);
  const updates = new Map();
  for (const result of results) {
    if (result.status === "rejected") continue;
    const group = result.value;
    const byTicker = new Map();
    for (const {s, d} of group.rows) {
      const [name, description, primary, price, change, mode, time, prePrice, preChange, afterPrice, afterChange] = d;
      if (!Number.isFinite(price)) continue;
      const ticker = group.futures ? s : name;
      const previous = byTicker.get(ticker);
      if (previous && (previous.primary || !primary)) continue;
      const delay = /^delayed_streaming_(\d+)$/.exec(mode);
      byTicker.set(ticker, {
        description, primary, price, change, session, exchange: kiwoomExchanges[s.split(":")[0]], futures: group.futures, receivedAt: Date.now(),
        date: Number.isFinite(time) ? dateKey(easternParts(time * 1000)) : null,
        delayMinutes: delay ? Math.ceil(Number(delay[1]) / 60) : null,
        prePrice, preChange, afterPrice, afterChange
      });
    }
    for (const symbol of group.symbols) {
      const ticker = group.futures ? futuresTickers.get(symbol) : symbol.replace("-", ".");
      updates.set(symbol, byTicker.get(ticker) ?? null);
    }
  }
  return updates;
}

export function watchQuoteForSession(quote, session) {
  if (!quote) return null;
  if (quote.futures) return {...quote, label: "Futures"};

  const {date, phase} = session;
  const sameSession = quote.session.date === date && quote.session.phase === phase;
  if (sameSession && phase === "Pre" && Number.isFinite(quote.prePrice)) {
    return {...quote, price: quote.prePrice, change: quote.preChange, label: "Pre"};
  }
  if (sameSession && phase === "After" && Number.isFinite(quote.afterPrice)) {
    return {...quote, price: quote.afterPrice, change: quote.afterChange, label: "After"};
  }
  const regular = (phase === "Regular" || phase === "After") && quote.date === date;
  return {...quote, label: regular ? "Regular" : "Close"};
}
