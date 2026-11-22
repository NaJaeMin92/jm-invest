// Bars are ordered [timestamp, open, high, low, close, volume].
export function aggregate(bars, interval) {
  if (interval === "hour" || interval === "day") return bars;
  const groups = [];
  let lastKey;
  for (const bar of bars) {
    const date = new Date(bar[0] * 1000);
    if (interval === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (interval === "quarter") date.setUTCMonth(3 * Math.floor(date.getUTCMonth() / 3), 1);
    const key = date.toISOString().slice(0, interval === "week" ? 10 : 7);
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

function ema(values, period) {
  let sum = 0, value;
  return values.map((close, i) => {
    if (i < period) sum += close;
    if (i < period - 1) return null;
    value = i === period - 1 ? sum / period : value + 2 / (period + 1) * (close - value);
    return value;
  });
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

const periods = [5, 10, 20, 200];
export const visibleBars = 55;

export function prepareChart(quote, frame) {
  const bars = aggregate(frame === "hour" ? quote.hourly : quote.daily, frame);
  const closes = bars.map(bar => bar[4]);
  return { bars, averages: periods.map(period => ema(closes, period)), strength: rsi(closes) };
}

export function drawChart(canvas, chart, frame, start) {
  const { bars } = chart;
  if (!bars.length || !canvas.clientWidth) return;
  const w = canvas.clientWidth, h = canvas.clientHeight, pixel = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * pixel);
  canvas.height = Math.round(h * pixel);
  const ctx = canvas.getContext("2d");
  ctx.scale(pixel, pixel);
  const end = start + visibleBars;
  const shown = bars.slice(start, end);
  const averages = chart.averages.map(values => values.slice(start, end));
  const r = chart.strength.slice(start, end);
  const colors = ["#388bff","#ff971e","#c659ff","#ffc647"];
  const pad = 8, top = 38, base = h * .61, volumeBase = h * .73, rsiBase = h - 8;
  const lo = Math.min(...shown.map(b=>b[3]),...averages.flat().filter(Number.isFinite));
  const hi = Math.max(...shown.map(b=>b[2]),...averages.flat().filter(Number.isFinite));
  const step = (w-48)/Math.max(shown.length,8);
  const x = i => pad + (i+.5)*step, y = v => base-(v-lo)/(hi-lo || 1)*(base-top);
  const volumeMax = Math.max(1,...shown.map(b=>b[5]));
  function line(points, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (const [a,b] of points) ctx.lineTo(a,b);
    ctx.stroke();
  }
  function text(str,x,y,color) {
    ctx.font = '11px system-ui'; ctx.fillStyle = color; ctx.fillText(str,x,y);
    return ctx.measureText(str).width;
  }
  let left = pad, legendY = 14;
  periods.forEach((p,i)=>{
    const last = averages[i].at(-1);
    if (last == null) return;
    const label = 'EMA'+p+' '+last.toFixed(2);
    if (left+ctx.measureText(label).width>w-5) {left=pad;legendY+=13;}
    left += text(label,left,legendY,colors[i])+7;
  });
  shown.forEach((bar,i)=>{
    const [,o,high,low,c,v] = bar;
    const color = c>=o ? "#ed3278" : "#54c89e";
    line([[x(i),y(high)],[x(i),y(low)]],color);
    ctx.fillStyle=color;
    const body=Math.min(9,Math.max(2,step*.54));
    ctx.fillRect(x(i)-body/2,Math.min(y(o),y(c)),body,Math.max(1,Math.abs(y(o)-y(c))));
    const vh=v/volumeMax*(volumeBase-base-7);
    ctx.fillRect(x(i)-body/2,volumeBase-vh,body,vh);
  });
  averages.forEach((values,j)=>line(values.flatMap((v,i)=>v==null?[]:[[x(i),y(v)]]),colors[j]));
  const last=shown.at(-1)[4];
  ctx.setLineDash([4,3]);line([[0,y(last)],[w,y(last)]],"#ac3972");ctx.setLineDash([]);
  text(last.toFixed(2),w-43,Math.max(top,y(last)-3),"#f2f4fa");
  for(const i of new Set([0,Math.floor(shown.length/2),shown.length-1])){
    const d=new Date(shown[i][0]*1000);
    const label=frame==="hour"?d.toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false}):d.toISOString().slice(5,10);
    text(label,x(i)-4,volumeBase+13,"#8e99af");
  }
  const ry=v=>rsiBase-(rsiBase-volumeBase-32)*v/100;
  text('RSI(14)  '+(r.at(-1)?.toFixed(2)??'—'),pad,volumeBase+29,"#498fff");
  for (const level of [30,70]) {
    ctx.setLineDash([3,3]);line([[0,ry(level)],[w,ry(level)]],"#465168");ctx.setLineDash([]);
  }
  line(r.flatMap((v,i)=>v==null?[]:[[x(i),ry(v)]]),"#428bff");
}
