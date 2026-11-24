import test from "node:test";
import assert from "node:assert/strict";
import {chartTrends} from "../assets/chart-trends.js";

const bars = Array.from({length:252}, (_,i) => {
  const swing = 2*Math.cos(i*Math.PI/3);
  const mid = 30+swing+i*.12;
  return [i,mid,mid+1,mid-1,mid,100];
});

test("each timeframe derives its own lines from confirmed touches", () => {
  for (const frame of ["day","week","month"]) {
    const lines = chartTrends(bars,frame);
    assert.ok(lines.some(l=>l.key==="long" && l.slope>0));
    assert.ok(lines.some(l=>l.key==="short" && l.slope>0));
    assert.deepEqual(chartTrends(bars,frame,180),chartTrends(bars.slice(0,180),frame));
  }
  assert.deepEqual(chartTrends(bars.slice(0,13),"day"),[]);

});

test("repeated horizontal reactions qualify until a closing break", () => {
  const flat = bars.map(([i])=>{ const m=30+2*Math.cos(i*Math.PI/3); return [i,m,m+1,m-1,m,100]; });
  const levels = source=>chartTrends(source,"day").filter(l=>l.key==="support");
  assert.equal(levels(flat).length,1);
  assert.equal(levels([...flat,[252,30,30,20,21,100],[253,30,32,29,31,100]]).length,0);
});

test("confirmed impulse yields three retracement levels only during a pullback", () => {
  const prices = [15,14,13,12,11,10,...Array.from({length:20},(_,i)=>11+i),29,28,27,26,25,24,23,22];
  const candles = values=>values.map((v,i)=>[i,v,v+.1,v-.1,v,1]);
  const fib = values=>chartTrends(candles(values),"day").filter(g=>g.key==="fibonacci");
  assert.deepEqual(fib(prices).map(g=>g.label),["38.2%","50.0%","61.8%"]);
  assert.equal(fib(prices.map(p=>40-p)).length,3);
  assert.equal(fib(prices.slice(0,-6)).length,0);
  assert.equal(fib([...prices,9]).length,0);
});
