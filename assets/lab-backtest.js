import {prepareChart} from "../instrument-chart.js?v=103";
import {metricsAt,matches} from "./strategy.js?v=115";
import {firstTouchGeometry,firstTouchDecision,firstBuyQuantity} from "./first-touch.js?v=115";

// OHLC shows the price range touched during a session, but not the exact order of ticks.
export function touchCandidate(levels, settings, bar) {
  const opening = bar[1], low = bar[3];
  const points = [low, opening];
  for (const line of levels.lines) {
    for (const edge of [-1, 0, 1]) {
      const price = line.price * (1 + edge * settings.tolerance / 100);
      if (price >= low && price <= opening) points.push(price);
    }
  }
  points.sort((a, b) => b - a);
  let notice;
  for (let i = 1; i < points.length; i++) {
    for (const price of [(points[i-1] + points[i]) / 2, points[i]]) {
      const decision = firstTouchDecision(levels, settings, opening, price);
      if (decision?.action === "buy") return {side:"buy", label:"매수 후보", detail:decision.reason};
      if (decision?.action === "notify") notice = {side:null, label:"검토 후보", detail:decision.reason};
    }
  }
  return notice;
}

const iso = date => date.toISOString().slice(0,10);
export function shiftMonth(day, months) {
  const d=new Date(day+"T12:00:00Z"), n=d.getUTCDate();
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(last,n));
  return iso(d);
}

function after(days, day) {
  let low=0, high=days.length;
  while(low<high){
    const mid=Math.floor((low+high)/2);
    if(days[mid]<=day)low=mid+1;else high=mid;
  }
  return low;
}

// Windows use (calendar start, calendar end], even if an endpoint is a weekend.
export const windowsPerGroup = 20;

export function planWindows(days, years, ready, random=Math.random) {
  const rolling=[], pool=[], chosen=new Set();
  function windowAt(end){
    const start=shiftMonth(end,-12*years), first=after(days,start), last=after(days,end)-1;
    if(first<ready || start<days[0] || last<first)return null;
    return {start,end,first,last};
  }
  if(!days.length)return {rolling,random:[]};
  for(let offset=0;offset<windowsPerGroup;offset++){
    const w=windowAt(shiftMonth(days.at(-1),-offset));
    rolling.push(w && {...w,offset});
    if(w)chosen.add(w.first+"/"+w.last);
  }
  for(const end of days){
    const w=windowAt(end);
    if(w && !chosen.has(w.first+"/"+w.last))pool.push(w);
  }
  const picked=[];
  while(picked.length<windowsPerGroup && pool.length){
    const i=Math.floor(random()*pool.length);
    picked.push(pool[i]);pool[i]=pool.at(-1);pool.pop();
  }
  return {rolling,random:picked};
}

function strategyHistory(bars,rule) {
  const touch=rule.preset==="firstTouch", frame=touch?"day":rule.frame || "day";
  const chart=prepareChart(bars,frame);
  const keys=rule.conditions.map(c=>c.key);
  const trends=keys.some(k=>!["rsi","ma","band"].includes(k));
  const lookback=touch?252:trends?({day:252,week:104,month:60}[frame]):keys.some(k=>k!=="rsi")?20:15;
  const frameIndex=[],cache=new Map();
  let j=0;
  for(const bar of bars){
    while(j+1<chart.bars.length && chart.bars[j+1][0]<=bar[0])j++;
    frameIndex.push(j);
  }
  const firstReady=frameIndex.findIndex(n=>n>=lookback);
  function signal(i){
    const index=frameIndex[i];
    if(cache.has(index))return cache.get(index);
    let hit;
    if(touch){
      const levels=firstTouchGeometry(bars.slice(Math.max(0,i-252),i),rule.touch);
      levels.rsi={day:chart.strength[i-1]};
      hit=touchCandidate(levels,rule.touch,bars[i])?.side==="buy";
    }else hit=matches(rule,metricsAt(chart,frame,index-1,trends));
    cache.set(index,hit);
    return hit;
  }
  return {ready:firstReady<0?bars.length:firstReady,signal};
}

// Replay one activation per window, matching the strategy editor's one-order watch.
// Daily OHLC cannot establish the intraday ordering after a first-touch signal.
export function simulateWindow(bars,w,rule,signal) {
  const buy=rule.side==="buy", touch=rule.preset==="firstTouch";
  const capital=Number(rule.allocation?.amount)||10000, limit=Number(rule.price)||0;
  const opening=bars[w.first][1];
  let shares=buy?0:Math.floor(capital/opening),cash=capital-shares*opening;
  let peak=capital,drawdown=0,signalDay=null,filled=null,qty=0,submitted=false;
  for(let i=w.first;i<=w.last;i++){
    const bar=bars[i];
    if(signalDay===null && signal(i))signalDay=i;
    if(!submitted && signalDay!==null && i===signalDay+(touch?1:0)){
      submitted=true;
      // A marketable limit receives the open. Otherwise the day's range must reach the limit.
      if(!limit || (buy?bar[3]<=limit:bar[2]>=limit)){
        const fill=limit?(buy?Math.min(bar[1],limit):Math.max(bar[1],limit)):bar[1];
        if(buy){
          const affordable=Math.floor(cash/fill);
          if(rule.allocation){
            const planPrice=limit?rule.price:(Math.ceil(fill*10000)/10000).toFixed(4);
            qty=Math.min(affordable,firstBuyQuantity(rule.allocation,planPrice));
          }else qty=Math.min(affordable,Number(rule.quantity)||affordable);
          cash-=qty*fill;shares+=qty;
        }else{
          qty=Math.min(shares,Number(rule.quantity)||shares);
          cash+=qty*fill;shares-=qty;
        }
        if(qty)filled=i;
      }
    }
    const equity=cash+shares*bar[4];
    peak=Math.max(peak,equity);drawdown=Math.min(drawdown,equity/peak-1);
  }
  return {...w,profit:(cash+shares*bars[w.last][4])/capital-1,drawdown,
    benchmark:bars[w.last][4]/opening-1,signalDay,filled,qty};
}

export function simulatePairedWindow(bars, w, entry, exit, entrySignal, exitSignal) {
  const capital = Number(entry.allocation?.amount) || 10000;
  const opening = bars[w.first][1];
  let cash = capital, shares = 0, peak = capital, drawdown = 0;
  let buys = 0, sells = 0, closed = 0, firstBuy = null;
  let costPerShare = 0, realizedProfit = 0;
  for (let i = w.first; i <= w.last; i++) {
    const rule = shares === 0 ? entry : exit;
    const buying = shares === 0;
    const trigger = rule.preset === "firstTouch" ? i - 1 : i;
    const signal = buying ? entrySignal : exitSignal;
    const [, open, high, low, close] = bars[i];
    const limit = Number(rule.price) || 0;
    if (trigger >= w.first && signal(trigger) && (!limit || (buying ? low <= limit : high >= limit))) {
      const price = limit ? (buying ? Math.min(open,limit) : Math.max(open,limit)) : open;
      if (buying) {
        const affordable = Math.floor(cash/price);
        const planned = rule.allocation
          ? firstBuyQuantity(rule.allocation,limit ? rule.price : (Math.ceil(price*10000)/10000).toFixed(4))
          : Number(rule.quantity) || affordable;
        shares = Math.min(affordable,planned);
        if (shares > 0) {
          cash -= shares*price;
          costPerShare = price;
          buys++;
          firstBuy ??= i;
        }
      } else {
        const quantity = Math.min(shares,Number(rule.quantity) || shares);
        shares -= quantity;
        cash += quantity*price;
        realizedProfit += quantity*(price-costPerShare);
        sells++;
        if (shares === 0) closed++;
      }
    }
    const equity = cash + shares*close;
    peak = Math.max(peak,equity);
    drawdown = Math.min(drawdown,equity/peak-1);
  }
  return {...w,profit:(cash+shares*bars[w.last][4])/capital-1,drawdown,
    benchmark:bars[w.last][4]/opening-1,filled:firstBuy,buys,sells,closed,openShares:shares,
    realizedProfit,unrealizedProfit:shares*(bars[w.last][4]-costPerShare)};
}

export function runWindows(bars,years,rule,progress=()=>{},random=Math.random) {
  const days=bars.map(b=>iso(new Date(b[0]*1000)));
  const entry=rule.entry || rule;
  const {signal,ready}=strategyHistory(bars,entry);
  const exit=rule.exit && strategyHistory(bars,rule.exit);
  const groups=planWindows(days,years,Math.max(ready,exit?.ready ?? 0),random);
  let n=0;
  function evaluate(w){
    if(!w)return null;
    progress(++n);
    const r=exit ? simulatePairedWindow(bars,w,entry,rule.exit,signal,exit.signal) : simulateWindow(bars,w,rule,signal);
    return {...r,signalDay:days[r.signalDay] || null,filled:days[r.filled] || null};
  }
  return {rolling:groups.rolling.map(evaluate),random:groups.random.map(evaluate)};
}
