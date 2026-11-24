// Project confirmed daily and weekly pivots in price/time coordinates.
export const trendStyles = {
  long: {label:"장기 추세", color:"#aeacff"},
  short: {label:"단기 추세", color:"#80c9ff"},
  support: {label:"지지", color:"#68d8b4"},
  resistance: {label:"저항", color:"#efae83"}
};

function pivots(bars, field, radius) {
  const result = [];
  for (let i = radius; i < bars.length - radius; i++) {
    const value = bars[i][field];
    if (!Number.isFinite(value) || value <= 0) continue;
    const neighbors = bars.slice(i-radius, i+radius+1);
    const extreme = field === 3 ? Math.min : Math.max;
    if (value === extreme(...neighbors.map(b => b[field])) &&
        !neighbors.slice(radius+1).some(b => b[field] === value)) {
      result.push({time:bars[i][0], price:value});
    }
  }
  return result;
}

function diagonal(points, rising, key) {
  const last = points.at(-1);
  if (!last) return;
  for (let i = points.length-2; i >= 0; i--) {
    const first = points[i];
    const slope = (last.price-first.price)/(last.time-first.time);
    if (rising ? slope <= 0 : slope >= 0) continue;
    if (points.slice(i+1,-1).some(p => rising
      ? p.price < first.price+slope*(p.time-first.time)
      : p.price > first.price+slope*(p.time-first.time))) continue;
    return {key, ...first, slope};
  }
}

function zone(points, support, close, tolerance) {
  const candidates = [];
  for (const point of points) {
    const group = points.filter(p => Math.abs(p.price-point.price) <= tolerance);
    if (group.length < 2) continue;
    const price = group.reduce((total,p) => total+p.price,0)/group.length;
    if (support ? price > close : price < close) continue;
    candidates.push({key:support ? "support" : "resistance", time:group[0].time,
      price, slope:0, halfWidth:tolerance/2});
  }
  return candidates.sort((a,b)=>Math.abs(a.price-close)-Math.abs(b.price-close))[0];
}

export function chartTrends(daily, weekly, close) {
  const recent = daily.slice(-90);
  const lows = pivots(recent,3,2), highs = pivots(recent,2,2);
  const ranges = recent.slice(-20);
  const tolerance = Math.max(close*.001, ranges.reduce((sum,b)=>sum+b[2]-b[3],0)/Math.max(1,ranges.length)*.35);
  return [
    diagonal(pivots(weekly,3,2),true,"long"), diagonal(pivots(weekly,2,2),false,"long"),
    diagonal(lows,true,"short"), diagonal(highs,false,"short"),
    zone(lows,true,close,tolerance), zone(highs,false,close,tolerance)
  ].filter(Boolean);
}

// End strictly before the cutoff, including when replaying an old session.
export function beforeTime(bars, cutoff) {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = Math.floor((lo+hi)/2);
    if (bars[mid][0] < cutoff) lo = mid+1;
    else hi = mid;
  }
  return lo;
}
