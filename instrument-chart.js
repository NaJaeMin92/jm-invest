import {study} from "./technical-indicators.js";
import {renderAnnotations} from "./chart-annotations.js?v=58";

// Bars are ordered [timestamp, open, high, low, close, volume].
export function isIntraday(interval) {
  return interval === "minute" || interval === "five" || interval === "hour";
}

export function aggregate(bars, interval) {
  if (interval === "minute" || interval === "hour" || interval === "day") return bars;
  const groups = [];
  let lastKey;
  for (const bar of bars) {
    const date = new Date(bar[0] * 1000);
    if (interval === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (interval === "quarter") date.setUTCMonth(3 * Math.floor(date.getUTCMonth() / 3), 1);
    const key = interval === "five" ? Math.floor(bar[0] / 300)
      : date.toISOString().slice(0, interval === "week" ? 10 : 7);
    if (key !== lastKey) {
      groups.push([...bar]);
      lastKey = key;
    } else {
      const group = groups.at(-1);
      group[2] = Math.max(group[2], bar[2]);
      group[3] = Math.min(group[3], bar[3]);
      group[4] = bar[4];
      group[5] += bar[5];
    }
  }
  return groups;
}

function rsi(values) {
  let up = 0, down = 0;
  return values.map((close, i) => {
    if (!i) return null;
    const delta = close - values[i - 1];
    up = (i <= 14 ? up : up * 13 / 14) + Math.max(0, delta) / 14;
    down = (i <= 14 ? down : down * 13 / 14) + Math.max(0, -delta) / 14;
    if (i < 14) return null;
    return down ? 100 - 100 / (1 + up/down) : up ? 100 : 50;
  });
}

export const visibleBars = 55;

export function prepareChart(source, frame) {
  const bars = aggregate(source, frame);
  const closes = bars.map(bar => bar[4]);
  return { bars, closes, strength: rsi(closes), studies: new Map() };
}

const tickDate = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", month:"numeric", day:"numeric" });
const tickHour = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:false });
const sessionDate = new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York" });

function matchingCloses(shown, comparison, frame) {
  if (!comparison) return [];
  const key = timestamp => isIntraday(frame) ? timestamp : sessionDate.format(timestamp * 1000);
  const closes = new Map(comparison.bars.map(bar => [key(bar[0]), bar[4]]));
  return shown.map(bar => closes.get(key(bar[0])));
}

function heikinAshi(bars) {
  let priorOpen, priorClose;
  return bars.map(([time,open,high,low,close,volume]) => {
    const average = (open + high + low + close) / 4;
    const center = priorOpen == null ? (open + close) / 2 : (priorOpen + priorClose) / 2;
    priorOpen = center;
    priorClose = average;
    return [time, center, Math.max(high, center, average), Math.min(low, center, average), average, volume];
  });
}

export function drawChart(canvas, chart, frame, start, options) {
  const {bars} = chart;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const end = Math.min(start + (options.windowSize ?? visibleBars), options.end ?? bars.length);
  if (!w || !h || start >= end) return null;
  const pixel = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * pixel);
  canvas.height = Math.round(h * pixel);
  const ctx = canvas.getContext("2d");
  ctx.scale(pixel, pixel);

  const shown = bars.slice(start, end);
  const priceBars = options.type === "heikin"
    ? (chart.heikin ??= heikinAshi(bars)).slice(start, end) : shown;
  const lower = options.lower === "none" ? null : study(chart, options.lower);
  const overlayLines = options.overlays.flatMap(name => study(chart, name).lines || [])
    .map(line => ({...line, values:line.values.slice(start, end)}));
  if (options.overlays.includes("VWAP")) {
    let total = 0, volume = 0;
    const values = shown.map(bar => {
      total += (bar[2] + bar[3] + bar[4]) * bar[5] / 3;
      volume += bar[5];
      return volume > 0 ? total / volume : null;
    });
    overlayLines.push({ label:"VWAP", color:"#80d6bd", values });
  }

  const pad = 8, top = 35, width = w - 43;
  const axis = lower ? h * .73 : h - 19;
  const bottom = options.layers.volume ? axis - 29 : axis - 4;
  const comparison = matchingCloses(shown, options.compare, frame);
  const firstMatch = comparison.findIndex(Number.isFinite);
  const normalized = firstMatch >= 0 && comparison[firstMatch] !== 0
    ? comparison.map(close => close == null ? null : shown[firstMatch][4] * close / comparison[firstMatch])
    : [];
  const extent = priceBars.flatMap(bar => [bar[2], bar[3]]);
  extent.push(...normalized.filter(Number.isFinite));
  extent.push(...overlayLines.flatMap(line => line.values).filter(Number.isFinite));
  const rawLow = Math.min(...extent), rawHigh = Math.max(...extent);
  const logarithmic = options.log && rawLow > 0;
  const units = logarithmic ? Math.log : value => value;
  const low = units(rawLow), high = units(rawHigh), spread = high - low || 1;
  const step = (w - 48) / Math.max(shown.length, 8);
  const x = i => pad + (i + .5) * step;
  const y = price => bottom - (units(price) - low) / spread * (bottom - top);
  const point = (clientX, clientY) => {
    const bounds = canvas.getBoundingClientRect();
    const px = clientX - bounds.left, py = clientY - bounds.top;
    if (px < 0 || px >= width || py < top || py > bottom) return null;
    const index = Math.max(0, Math.min(shown.length - 1, Math.floor((px - pad) / step)));
    const price = low + spread * (bottom - py) / (bottom - top);
    return { time:shown[index][0], price:logarithmic ? Math.exp(price) : price };
  };

  function line(points, color, thickness = 1) {
    if (!points.length) return;
    ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.beginPath();
    for (const [px,py] of points) ctx.lineTo(px,py);
    ctx.stroke();
  }
  function label(text, px, py, color) {
    ctx.font = "11px system-ui";
    ctx.fillStyle = color;
    ctx.fillText(text, px, py);
    return ctx.measureText(text).width;
  }
  const pointsFor = (values, vertical) => values.flatMap((value, i) => value == null ? [] : [[x(i),vertical(value)]]);
  if (options.layers.grid) {
    for (let i=0;i<=4;i+=1) {
      const py = top + (bottom - top) * i / 4;
      line([[pad,py],[width,py]], "#29374f");
    }
  }

  let legendX = pad;
  let legendY = 13;
  ctx.font = "11px system-ui";
  for (const overlay of overlayLines) {
    const value = overlay.values.at(-1);
    if (value == null) continue;
    const text = overlay.label + " " + value.toFixed(2);
    if (legendX + ctx.measureText(text).width > w - 5) {
      legendX = pad;
      legendY += 12;
    }
    if (legendY < top - 2) legendX += label(text, legendX, legendY, overlay.color) + 8;
  }
  const bodyWidth = Math.min(10,Math.max(1,step * .55));
  const volumeMax = Math.max(1,...shown.map(bar=>bar[5]));
  const [gain, loss] = options.greenUp ? ["#57c49e","#eb4e79"] : ["#eb4e79","#57c49e"];
  const continuous = ["line","area","baseline"].includes(options.type);
  for (let i=0;i<priceBars.length;i+=1) {
    const [,open,high,low,close,volume] = priceBars[i];
    const color = close >= open ? gain : loss;
    const mid = x(i);
    if (options.type === "ohlc" || options.type === "mono") {
      const barColor = options.type === "mono" ? "#c0d1e7" : color;
      line([[mid-bodyWidth/2,y(open)],[mid,y(open)]],barColor);
      line([[mid,y(high)],[mid,y(low)]],barColor);
      line([[mid,y(close)],[mid+bodyWidth/2,y(close)]],barColor);
    } else if (!continuous) {
      line([[mid,y(high)],[mid,y(low)]],color);
      const height = Math.max(1,Math.abs(y(open)-y(close)));
      const upper = Math.min(y(open),y(close));
      ctx.fillStyle=color; ctx.strokeStyle=color;
      if (options.type==="hollow" && close>=open) ctx.strokeRect(mid-bodyWidth/2,upper,bodyWidth,height);
      else ctx.fillRect(mid-bodyWidth/2,upper,bodyWidth,height);
    }
    if (options.layers.volume) {
      ctx.fillStyle=color;
      const height=volume/volumeMax * 23;
      ctx.fillRect(mid-bodyWidth/2,axis-height,bodyWidth,height);
    }
  }
  if (continuous) {
    const points = pointsFor(shown.map(bar => bar[4]), y);
    if (options.type === "area") {
      const gradient = ctx.createLinearGradient(0, top, 0, bottom);
      gradient.addColorStop(0, "#4099ed66");
      gradient.addColorStop(1, "#4099ed05");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      for (const [px,py] of points) ctx.lineTo(px,py);
      ctx.lineTo(points.at(-1)[0],bottom);
      ctx.lineTo(points[0][0],bottom);
      ctx.fill();
    }
    if (options.type === "baseline") {
      const baseline = y(shown[0][4]);
      for (const [startY,endY,color,fill] of [
        [top,baseline,"#5bdcc2","#5bdcc22e"],
        [baseline,bottom,"#f291a8","#f291a82e"]
      ]) {
        if (endY <= startY) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0,startY,width,endY-startY);
        ctx.clip();
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (const [px,py] of points) ctx.lineTo(px,py);
        ctx.lineTo(points.at(-1)[0],baseline);
        ctx.lineTo(points[0][0],baseline);
        ctx.fill();
        line(points,color,1.6);
        ctx.restore();
      }
      ctx.setLineDash([3,3]);
      line([[pad,baseline],[width,baseline]],"#8696b1");
      ctx.setLineDash([]);
      label("Base " + shown[0][4].toFixed(2),pad,baseline-4,"#aab8d0");
    } else line(points,"#68b7ff",1.6);
  }
  for (const overlay of overlayLines) line(pointsFor(overlay.values,y),overlay.color);
  if (options.overlays.includes("VP")) {
    const bins = Array(15).fill(0);
    for (const bar of shown) {
      const index = Math.min(14, Math.max(0, Math.floor(15*(units(bar[4])-low)/spread)));
      bins[index] += bar[5];
    }
    const maximum = Math.max(1,...bins);
    ctx.fillStyle = "#65a9ed55";
    bins.forEach((volume,i) => {
      const length = volume/maximum * Math.min(65,w*.19);
      ctx.fillRect(width-length,bottom-(i+1)*(bottom-top)/15,length,(bottom-top)/15-1);
    });
  }

  if (normalized.length) {
    line(pointsFor(normalized,y),"#f5d47d",1.8);
    label(options.compare.symbol + " · indexed at first shared bar",pad,bottom - 5,"#f5d47d");
  }
  const last = shown.at(-1)[4];
  if (options.layers.price) {
    ctx.setLineDash([4,3]);
    line([[0,y(last)],[w,y(last)]],"#aa648d");
    ctx.setLineDash([]);
    label(last.toFixed(2),width,Math.max(top,y(last)-3),"#f0f4ff");
  }
  for (const i of new Set([0,Math.floor(shown.length/2),shown.length-1])) {
    const stamp = shown[i][0] * 1000;
    const time = isIntraday(frame) ? tickHour.format(stamp) :
      ["month","quarter"].includes(frame) ? new Date(stamp).toISOString().slice(0,7) : tickDate.format(stamp);
    label(time,x(i)-4,axis+14,"#a2abc1");
  }
  if (lower) {
    const lines = (lower.lines || []).map(series => ({...series,values:series.values.slice(start,end)}));
    const histogram = lower.histogram?.slice(start,end) || [];
    const values = [...lines.flatMap(series=>series.values), ...histogram, ...(lower.levels || [])].filter(Number.isFinite);
    const [min,max] = lower.domain || [Math.min(...values),Math.max(...values)];
    const ly = value => h - 7 - (h - axis - 36) * (value - min)/(max-min || 1);
    for (const level of lower.levels || []) line([[pad,ly(level)],[width,ly(level)]],"#465168");
    histogram.forEach((value,i) => {
      if (value == null) return;
      ctx.fillStyle = value >= 0 ? "#5ebaac" : "#db6f94";
      ctx.fillRect(x(i)-bodyWidth/2,Math.min(ly(value),ly(0)),bodyWidth,Math.abs(ly(value)-ly(0)));
    });
    let cursor = pad;
    for (const series of lines) {
      line(pointsFor(series.values,ly),series.color,1.3);
      const value = series.values.at(-1);
      cursor += label(series.label + " " + (value?.toFixed(2) ?? "—"),cursor,axis+28,series.color) + 8;
    }
    if (!lines.length) label("Volume",pad,axis+28,"#a2abc1");
  }
  let drawingAt;
  if (options.layers.drawings && options.drawings.length) {
    const xAt = time => {
      let low = 0, high = bars.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (bars[middle][0] < time) low = middle + 1;
        else high = middle;
      }
      return x(low-start);
    };
    drawingAt = renderAnnotations(ctx, options.drawings, { width,top,bottom,xAt,y }, options.selectedDrawing);
  }
  let barIndex;
  return {
    point, step,
    hitDrawing(clientX,clientY) {
      const bounds=canvas.getBoundingClientRect();
      return drawingAt?.(clientX-bounds.left, clientY-bounds.top);
    },
    translate(points,origin,target) {
      barIndex ??= new Map(bars.map((bar,index) => [bar[0],index]));
      const dx = barIndex.get(target.time)-barIndex.get(origin.time);
      const scale = target.price/origin.price;
      const indices = points.map(point => barIndex.get(point.time));
      const shift = Math.max(-Math.min(...indices),Math.min(bars.length-1-Math.max(...indices),dx));
      return points.map((point,index) => ({
        time:bars[indices[index]+shift]?.[0] ?? point.time,
        price:logarithmic ? point.price*scale : point.price+target.price-origin.price
      }));
    }
  };
}
