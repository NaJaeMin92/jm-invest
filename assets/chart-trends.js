// All indices and slopes use bars of the selected interval.
export const trendStyles = {
  long: {label:"장기 추세", color:"#aeacff"},
  short: {label:"단기 추세", color:"#80c9ff"},
  support: {label:"지지", color:"#68d8b4"},
  resistance: {label:"저항", color:"#efae83"},
  fibonacci: {label:"피보나치", color:"#dcc78f"}
};

export function pivots(bars, field, radius) {
  const result = [];
  for (let i = radius; i < bars.length - radius; i++) {
    const value = bars[i][field];
    if (!Number.isFinite(value) || value <= 0) continue;
    const neighbors = bars.slice(i-radius, i+radius+1);
    const extreme = field === 3 ? Math.min : Math.max;
    if (value === extreme(...neighbors.map(b => b[field])) &&
        !neighbors.slice(radius+1).some(b => b[field] === value)) {
      result.push({index:i, price:value});
    }
  }
  return result;
}

function diagonal(points, bars, rising, key, tolerance, minSpan) {
  const last = points.at(-1);
  if (!last || bars.length-last.index > minSpan) return;
  for (let i = points.length-3; i >= 0; i--) {
    const first = points[i];
    const span = last.index-first.index;
    if (span < minSpan) continue;
    const change = last.price-first.price;
    if ((rising ? change : -change) <= tolerance) continue;
    const slope = change/span;
    const valueAt = index => first.price+slope*(index-first.index);
    const middleTouch = points.slice(i+1,-1).some(p => Math.abs(p.price-valueAt(p.index)) <= tolerance);
    if (!middleTouch) continue;
    const broken = bars.slice(first.index).some((bar,offset) => rising
      ? bar[4] < valueAt(first.index+offset)-tolerance
      : bar[4] > valueAt(first.index+offset)+tolerance);
    if (!broken) return {key, ...first, slope};
  }
}

function zone(points, support, bars, tolerance, minSpan) {
  const close = bars.at(-1)[4];
  const candidates = [];
  for (const point of points) {
    const price = point.price;
    if (support ? price > close : price < close) continue;
    const broken = bars.findLastIndex(b => support ? b[4] < price-tolerance : b[4] > price+tolerance);
    const group = points.filter(p => p.index > broken && Math.abs(p.price-price) <= tolerance);
    if (group.length < 3 || group.at(-1).index-group[0].index < minSpan) continue;
    candidates.push({key:support ? "support" : "resistance", index:group[0].index,
      price, slope:0, halfWidth:tolerance});
  }
  return candidates.sort((a,b)=>Math.abs(a.price-close)-Math.abs(b.price-close))[0];
}

// [lookback in bars, pivot radius, minimum span between first and last touch]
const horizons = {
  day:[[60,2,10],[252,5,40]],
  week:[[26,2,6],[104,4,18]],
  month:[[18,1,4],[60,3,12]]
};

function retracement(bars, radius, minSpan, start) {
  const highs = pivots(bars,2,radius), lows = pivots(bars,3,radius);
  const high = highs.at(-1), low = lows.at(-1);
  if (!high || !low || high.index === low.index) return [];
  const rising = high.index > low.index;
  const [first,last] = rising ? [low,high] : [high,low];
  const span = last.index-first.index;
  const move = last.price-first.price;
  if (span < minSpan || (rising ? move <= 0 : move >= 0)) return [];
  const leg = bars.slice(first.index,last.index+1);
  const ranges = leg.map((b,i) => {
    const prev = bars[first.index+i-1]?.[4] ?? b[1];
    return Math.max(b[2],prev)-Math.min(b[3],prev);
  }).sort((a,b)=>a-b);
  if (Math.abs(move) < 3*ranges[Math.floor(ranges.length/2)]) return [];
  const top = Math.max(first.price,last.price), bottom = Math.min(first.price,last.price);
  if (bars.slice(first.index).some(b=>b[2]>top || b[3]<bottom)) return [];
  const pullback = (last.price-bars.at(-1)[4])/move;
  if (pullback < .236 || pullback >= 1) return [];
  return [.382,.5,.618].map(ratio=>({key:"fibonacci", index:start+last.index+radius,
    price:last.price-move*ratio, slope:0, label:(ratio*100).toFixed(1)+"%"}));
}

export function chartTrends(source, frame, end = source.length) {
  const settings = horizons[frame] ?? horizons.day;
  if (end < 3) return [];
  const ranges = source.slice(Math.max(0,end-20),end).map(b=>b[2]-b[3]).sort((a,b)=>a-b);
  const tolerance = Math.max(source[end-1][4]*.001, ranges[Math.floor(ranges.length/2)]*.2);
  const guides = [];
  for (const [h, [lookback,radius,span]] of settings.entries()) {
    const start = Math.max(0,end-lookback);
    const bars = source.slice(start,end);
    const key = h ? "long" : "short";
    for (const support of [true,false]) {
      const points = pivots(bars,support ? 3 : 2,radius);
      const line = diagonal(points,bars,support,key,tolerance,span);
      if (line) guides.push({...line,index:start+line.index});
      if (h === 0) {
        const band = zone(points,support,bars,tolerance,span);
        if (band) guides.push({...band,index:start+band.index});
      }
    }
  }
  const fibStart = Math.max(0,end-settings[1][0]);
  return guides.concat(retracement(source.slice(fibStart,end),settings[0][1],settings[0][2],fibStart));
}
