export function average(values, period, weighted = false) {
  let total = 0, last = null, count = 0;
  const window = [];
  return values.map(value => {
    if (value == null) return null;
    count += 1;
    if (weighted && last != null) {
      last += 2 / (period + 1) * (value - last);
      return last;
    }
    window.push(value);
    total += value;
    if (window.length > period) total -= window.shift();
    if (count < period) return null;
    last = total / period;
    return last;
  });
}

const midpoint = (bars, index, period) => {
  if (index + 1 < period) return null;
  const span = bars.slice(index - period + 1, index + 1);
  return (Math.max(...span.map(bar => bar[2])) + Math.min(...span.map(bar => bar[3]))) / 2;
};
const overlay = (label, color, values) => ({ label, color, values });
export const indicatorNames = {
  EMA: "EMA · 5, 10, 20, 200", MA: "SMA · 20", BOLL: "Bollinger Bands · 20, 2",
  IC: "Ichimoku · 9, 26, 52", VWAP: "VWAP · visible window", VP: "Volume profile · by close",
  RSI: "RSI · 14", VOL: "Volume", MACD: "MACD · 12, 26, 9", ROC: "Rate of change · 12",
  DMA: "MA difference · 10, 50", FSTO: "Fast stochastic · 14, 3",
};

export function study(chart, name) {
  if (chart.studies.has(name)) return chart.studies.get(name);
  const { bars, closes } = chart;
  let result = {};
  if (name === "EMA") result.lines = [5, 10, 20, 200].map((period, i) =>
    overlay("EMA" + period, ["#448cff", "#ff9a48", "#ca7bfb", "#eec253"][i], average(closes, period, true)));
  if (name === "MA") result.lines = [overlay("SMA20", "#70d9cf", average(closes, 20))];
  if (name === "BOLL") {
    const middle = average(closes, 20);
    const width = middle.map((mean, i) => mean == null ? null :
      2 * Math.sqrt(closes.slice(i - 19, i + 1).reduce((sum, price) => sum + (price - mean) ** 2, 0) / 20));
    result.lines = [1, 0, -1].map((direction, i) => overlay(["Upper", "Basis", "Lower"][i], "#8587ff",
      middle.map((mean, j) => mean == null ? null : mean + direction * width[j])));
  }
  if (name === "IC") {
    const tenkan = bars.map((_, i) => midpoint(bars, i, 9));
    const kijun = bars.map((_, i) => midpoint(bars, i, 26));
    const delayed = (i, value) => i < 26 ? null : value(i - 26);
    result.lines = [overlay("Tenkan", "#70aaff", tenkan), overlay("Kijun", "#efa571", kijun),
      overlay("Span A", "#56c6ab", bars.map((_, i) => delayed(i, j => kijun[j] == null ? null : (tenkan[j] + kijun[j]) / 2))),
      overlay("Span B", "#dd7f98", bars.map((_, i) => midpoint(bars, i - 26, 52)))];
  }
  if (name === "RSI") result = { lines: [overlay("RSI14", "#5eacff", chart.strength)], domain: [0, 100], levels: [30, 70] };
  if (name === "VOL") result = { histogram: bars.map(bar => bar[5]), levels: [0] };
  if (name === "ROC") result = { lines: [overlay("ROC12", "#85c3ff",
    closes.map((close, i) => i >= 12 && closes[i - 12] !== 0 ? (close / closes[i - 12] - 1) * 100 : null))], levels: [0] };
  if (name === "MACD" || name === "DMA") {
    const macd = name === "MACD";
    const fast = average(closes, macd ? 12 : 10, macd);
    const slow = average(closes, macd ? 26 : 50, macd);
    const difference = slow.map((value, i) => value == null ? null : fast[i] - value);
    const signal = average(difference, macd ? 9 : 10, macd);
    result = {
      lines: [overlay(name, "#63a5ff", difference), overlay("Signal", "#eeb868", signal)],
      histogram: signal.map((value, i) => value == null ? null : difference[i] - value), levels: [0]
    };
  }
  if (name === "FSTO") {
    const fast = bars.map((bar, i) => {
      if (i < 13) return null;
      const span = bars.slice(i - 13, i + 1);
      const low = Math.min(...span.map(row => row[3])), high = Math.max(...span.map(row => row[2]));
      return high === low ? 50 : 100 * (bar[4] - low) / (high - low);
    });
    result = { lines: [overlay("%K", "#63a5ff", fast), overlay("%D", "#eeb868", average(fast, 3))], domain: [0, 100], levels: [20, 80] };
  }
  chart.studies.set(name, result);
  return result;
}

export function signalsAt(chart, index) {
  const [macd, signal] = study(chart, "MACD").lines.map(line => line.values);
  const macdChange = index > 0 && signal[index - 1] != null && signal[index] != null
    ? [macd[index - 1] - signal[index - 1], macd[index] - signal[index]] : null;
  const rsi = chart.strength[index];
  return [
    ["RSI", rsi == null ? "Insufficient history" : rsi.toFixed(1) + (rsi >= 70 ? " · Overbought" : rsi <= 30 ? " · Oversold" : " · Neutral")],
    ["MACD", !macdChange ? "Insufficient history" : macdChange[1] > 0 && macdChange[0] <= 0 ? "Bullish crossover"
      : macdChange[1] < 0 && macdChange[0] >= 0 ? "Bearish crossover" : "No crossover on this candle"],
  ];
}
