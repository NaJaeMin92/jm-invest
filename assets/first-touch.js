import {chartTrends, pivots} from "./chart-trends.js?v=113";
import {prepareChart} from "../instrument-chart.js?v=82";
import {splitBudget} from "./split-budget.js?v=86";

const at = (line, index) => line.price + (index - line.index) * line.slope;
const within = (price, level, pct) => Math.abs(price / level - 1) * 100 <= pct + 1e-9;

export function recentSwingHigh(bars, rally) {
  const highs = pivots(bars, 2, 5), lows = pivots(bars, 3, 5);
  for (let i = highs.length - 1; i >= 0; i--) {
    const high = highs[i];
    const previousHigher = highs.slice(0, i).findLast(p => p.price >= high.price);
    if (lows.some(low => low.index > (previousHigher?.index ?? -1) && low.index < high.index &&
        high.price >= low.price * (1 + rally / 100))) return high.price;
  }
  return null;
}

export function independentReactions(line, bars, tolerance) {
  const lows = pivots(bars, 3, line.key === "long" ? 5 : 2);
  let last = null, count = 0;
  for (const p of lows) {
    if (p.index < line.index || !within(p.price, at(line, p.index), tolerance)) continue;
    if (last === null || bars.slice(last + 1, p.index).some((b, offset) =>
      b[4] > at(line, last + offset + 1) * (1 + tolerance / 100))) count++;
    last = p.index;
  }
  return count;
}

// Only completed daily bars enter the guides. The placeholder identifies the still-open week/month.
export function firstTouchLevels(closed, today, settings) {
  const geometry = firstTouchGeometry(closed,settings);
  const series = [...closed, [today, 0, 0, 0, 0, 0]];
  const rsi = Object.fromEntries(["day","week","month"].map(frame =>
    [frame, prepareChart(series, frame).strength.at(-2) ?? null]));
  return {...geometry,rsi};
}

export function firstTouchGeometry(closed,settings) {
  const bars = closed.slice(-252);
  const lines = chartTrends(bars, "day").filter(g => g.key === "support" || g.key === "long" && g.slope > 0)
    .map(g => ({kind:g.key, price:at(g, bars.length), reactions:independentReactions(g, bars, settings.tolerance)}));
  return {lines,high:recentSwingHigh(bars,settings.rally)};
}

export function firstTouchDecision(levels, settings, previous, price) {
  if (!(previous > 0 && price > 0)) return null;
  const touching = levels.lines.filter(l => within(price, l.price, settings.tolerance));
  if (!touching.some(l => previous > l.price * (1 + settings.tolerance / 100))) return null;
  if (touching.length === 2) return {action:"buy", reason:"두 선 겹침"};
  const line = touching[0];
  const drawdown = levels.high ? (1 - price / levels.high) * 100 : null;
  const deep = drawdown !== null && drawdown + 1e-9 >= settings.drawdown;
  if (!deep && line.reactions < settings.reactions) return null;
  const reason = (line.kind === "support" ? "수평 지지선" : "장기 상승 빗각") + " · " +
    (deep ? "최근 파동 고점 대비 " + drawdown.toFixed(1) + "% 하락" : "독립 반응 " + line.reactions + "회");
  const rsi = levels.rsi.day;
  if (!Number.isFinite(rsi) || rsi >= settings.rsiCeiling)
    return {action:"hold", reason:reason + (Number.isFinite(rsi) ? " · RSI "+settings.rsiCeiling+" 이상" : " · 일봉 RSI 자료 부족")};
  return {action:settings.single === "buy" ? "buy" : "notify", reason};
}

export function firstBuyQuantity(allocation, limit) {
  const plan = splitBudget(allocation.amount, allocation.units, allocation.perBuy);
  if (!plan || !/^\d{1,7}(\.\d{1,4})?$/.test(limit) || !(Number(limit) > 0)) return 0;
  const [whole, fraction=""] = limit.split(".");
  const priceUnits = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
  return Number(BigInt(plan.ranges[0].cents) * 100n / priceUnits);
}
