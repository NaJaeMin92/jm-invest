import test from "node:test";
import assert from "node:assert/strict";
import {planWindows,shiftMonth,simulateWindow,runWindows} from "../assets/lab-backtest.js";
const day=86400000;
const date=i=>new Date(Date.UTC(2015,0,1)+i*day);
const days=Array.from({length:4200},(_,i)=>date(i)).filter(d=>d.getUTCDay()!==0 && d.getUTCDay()!==6).map(d=>d.toISOString().slice(0,10));

test("10 rolling calendar-year windows end monthly and 10 distinct random windows have the same span",()=>{
  assert.equal(shiftMonth("2024-02-29",-12),"2023-02-28");
  assert.equal(shiftMonth("2024-03-31",-1),"2024-02-29");
  for(const years of [1,2,3,5,10]){
    const result=planWindows(days,years,15,()=>0.3);
    assert.deepEqual(result.rolling.map(r=>r.end),Array.from({length:10},(_,i)=>shiftMonth(days.at(-1),-i)));
    const all=[...result.rolling,...result.random];assert.equal(all.length,20);
    assert.equal(new Set(all.map(w=>w.first+"/"+w.last)).size,20);
    for(const r of all){assert.equal(r.start,shiftMonth(r.end,-12*years));assert(days[r.first]>r.start && days[r.last]<=r.end);}
  }
});
test("a listing without enough history or indicator warmup does not produce shortened results",()=>{
  assert(!planWindows(days.slice(0,250),1,20).rolling.some(Boolean));
  assert.equal(planWindows(days,1,days.length).random.length,0);
});
const bars=[[0,100,103,99,101],[1,90,95,86,91],[2,110,114,105,112],[3,80,84,75,80]];
test("one-shot buy observes the budget, limit and portfolio drawdown, even for repeated signals",()=>{
  const rule={side:"buy",price:"95",allocation:{amount:"1000",units:2,perBuy:1}};
  const w={first:0,last:3};
  const noFill=simulateWindow(bars,w,rule,()=>true);
  assert.equal(noFill.qty,0);assert.equal(noFill.profit,0);
  const r=simulateWindow(bars,w,rule,i=>i===1);
  assert.equal(r.filled,1);assert.equal(r.qty,5);assert(Math.abs(r.profit+.05)<1e-9);
  assert(Math.abs(r.drawdown-(950/1110-1))<1e-9);
});
test("first touch cannot fill on its signal candle and a sell liquidates only the modeled holdings",()=>{
  const w={first:0,last:2};
  const first=simulateWindow(bars,w,{side:"buy",preset:"firstTouch",price:"95",quantity:"2"},i=>i===0);
  assert.equal(first.filled,1);assert.equal(first.qty,2);
  const sell=simulateWindow(bars,w,{side:"sell",quantity:"1000",price:"103"},()=>true);
  assert.equal(sell.qty,100);assert(Math.abs(sell.profit-.03)<1e-9);
});
test("weekly and monthly rules see only completed frames and the worker produces independent windows",()=>{
  const data=days.map((t,i)=>{const v=50+i/100;return [Date.parse(t)/1000,v,v+1,v-1,v,10]});
  for(const frame of ["week","month"]){
    const rule={side:"buy",quantity:"2",frame,conditions:[{key:"rsi",op:"gte",value:99}],join:"all"};
    const {rolling,random}=runWindows(data,1,rule);
    assert.equal(random.length,10);assert(rolling.every(r=>r.qty===2 && typeof r.filled==="string"));
  }
});
