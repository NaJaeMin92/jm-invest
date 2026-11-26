import {prepareChart} from "../instrument-chart.js?v=82";
import {study} from "../technical-indicators.js?v=76";
import {chartTrends} from "./chart-trends.js?v=82";

// Prices relative to a chart level are expressed as a signed percentage.
export const factors = {
  rsi:["RSI · 14",30], vix:["VIX · 최근 지수",20], fear:["Fear & Greed · 최근 점수",25],
  band:["볼린저 %B · 하단 0 / 상단 100",20], ma:["20봉 이동평균 대비 (%)",0],
  long:["장기 상승 추세선 대비 (%)",0], longDown:["장기 하락 추세선 대비 (%)",0],
  shortUp:["단기 상승 추세선 대비 (%)",0], short:["단기 하락 추세선 대비 (%)",0],
  support:["지지선 대비 (%)",0], resistance:["저항선 대비 (%)",0],
  fibonacci:["피보나치 61.8% 선 대비 (%)",0]
};

export function metrics(daily, frame) {
  const chart = prepareChart(daily, frame);
  return metricsAt(chart,frame,chart.bars.length-2); // The current period is still open.
}

export function metricsAt(chart, frame, i, includeTrends=true) {
  if (i < 0) return {};
  const bars = chart.bars, close = bars[i][4];
  const distance = value => value > 0 ? 100*(close/value-1) : null;
  const result = {rsi:chart.strength[i], ma:distance(study(chart,"MA").lines[0].values[i])};
  const [upper,,lower] = study(chart,"BOLL").lines.map(line=>line.values[i]);
  if (upper > lower) result.band = 100*(close-lower)/(upper-lower);
  if (!includeTrends) return result;
  // The tested candle must not participate in constructing its reference lines.
  for (const g of chartTrends(bars,frame,i)) {
    if (g.key==="fibonacci" && g.label!=="61.8%") continue;
    let key=g.key;
    if(key==="long" && g.slope<0) key="longDown";
    if(key==="short" && g.slope>0) key="shortUp";
    result[key]=distance(g.price+g.slope*(i-g.index));
  }
  return result;
}

export function matches(rule, values) {
  if (!rule.conditions.length || rule.conditions.some(c=>!Object.hasOwn(factors,c.key) || !Number.isFinite(values[c.key]) || !Number.isFinite(c.value))) return false;
  const tests=rule.conditions.map(c=>c.op==="gte" ? values[c.key]>=c.value : values[c.key]<=c.value);
  return rule.join==="all" ? tests.every(Boolean) : tests.some(Boolean);
}
