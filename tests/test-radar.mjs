import test from "node:test";
import assert from "node:assert/strict";
import {supportCandidate,indicatorCandidate,radarCandidates} from "../assets/radar.js";
const config={tolerance:1,reactions:4,rally:20,drawdown:20,single:"notify",rsiCeiling:60};
const levels={lines:[{kind:"support",price:100,reactions:4},{kind:"long",price:101,reactions:4}],rsi:{day:67},high:120};
test("Radar shows distance to overlapping support before entry, ignores a break and a distant setup",()=>{
  assert.match(supportCandidate(103,levels,config).label,/접근/);
  assert.match(supportCandidate(100.5,levels,config).note,/두 선 겹침/);
  assert.equal(supportCandidate(91,levels,config),undefined);
  assert.equal(supportCandidate(115,levels,config),undefined);
});
test("one-line alert reflects the user's RSI and order discretion",()=>{
  const single={...levels,lines:levels.lines.slice(0,1)};
  assert.equal(supportCandidate(100,single,config),undefined);
  assert.equal(supportCandidate(100,{...single,rsi:{day:58}},config).label,"터치 · 검토");
});
test("proximity and full match respect customized sell conditions and missing data",()=>{
  const rule={join:"all",side:"sell",conditions:[{key:"rsi",op:"gte",value:75},{key:"band",op:"gte",value:100}]};
  assert.equal(indicatorCandidate(rule,{rsi:72,band:98}).rank,1);
  assert.equal(indicatorCandidate(rule,{rsi:75,band:100}).rank,0);
  assert.equal(indicatorCandidate(rule,{rsi:60,band:105}),undefined);
  assert.equal(indicatorCandidate(rule,{rsi:78}),undefined);
});
test("sell candidates need a held position, and stale bars yield no daily recommendations",()=>{
  const now=new Date("2026-11-25T18:00:00Z");
  const bars=Array.from({length:90},(_,i)=>{const p=30+i;return [Date.parse("2026-11-25T05:00:00Z")/1000-(90-i)*86400,p,p+1,p-1,p,100]});
  const active={nickname:"테스트",frame:"day",join:"all",side:"sell",conditions:[{key:"rsi",op:"gte",value:75}]};
  assert.ok(radarCandidates("TEST",true,active,bars,120,now).some(r=>r.side==="sell"));
  assert.ok(!radarCandidates("TEST",false,active,bars,120,now).some(r=>r.side==="sell"));
  assert.deepEqual(radarCandidates("TEST",true,active,bars,120,new Date("2026-12-12")),[]);
});
