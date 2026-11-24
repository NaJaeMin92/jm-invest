import test from "node:test";
import assert from "node:assert/strict";
import {metrics,matches} from "../assets/strategy.js";

test("strategy uses the last complete candle on each timeframe",()=>{
  const bars=Array.from({length:800},(_,i)=>[1704117600+i*86400,i+10,i+12,i+9,i+11,100]);
  for(const frame of ["day","week","month"]){
    const baseline=metrics(bars,frame);
    assert.equal(baseline.rsi,100);
    assert.equal("atr" in baseline,false);
    assert.equal("volume" in baseline,false);
    const modified=[...bars.slice(0,-1),[bars.at(-1)[0],500,10000,1,5,9999999]];
    assert.deepEqual(metrics(modified,frame),baseline);
  }
});
test("OR and AND honor thresholds and missing selected data blocks execution",()=>{
  const conditions=[{key:"vix",op:"lte",value:18},{key:"rsi",op:"gte",value:40}];
  assert.equal(matches({conditions,join:"any"},{vix:19,rsi:40}),true);
  assert.equal(matches({conditions,join:"all"},{vix:19,rsi:40}),false);
  assert.equal(matches({conditions,join:"any"},{rsi:40}),false);
  assert.equal(matches({conditions:[],join:"all"},{}),false);
});

test("retired factors prevent a legacy OR rule from executing",()=>{
  for (const key of ["atr","volume"]) {
    const conditions=[{key,op:"lte",value:3},{key:"rsi",op:"gte",value:40}];
    assert.equal(matches({conditions,join:"any"},{[key]:1,rsi:50}),false);
  }
});
