import test from "node:test";
import assert from "node:assert/strict";
import {compareSessions,executionWindows,replaySession,touchCandidate} from "../assets/lab.js";

test("Lab execution queries cover the complete span in disjoint supported windows",()=>{
  assert.deepEqual(executionWindows("2026-01-01","2026-06-30"),[
    ["2026-01-01","2026-03-25"],["2026-03-26","2026-06-17"],["2026-06-18","2026-06-30"]]);
});
test("replay evaluates a saved RSI rule with the previous completed candle",()=>{
  const bars=Array.from({length:25},(_,i)=>[1704117600+i*86400,200-i,202-i,198-i,201-i,1000]);
  const rule={side:"buy",frame:"day",join:"all",conditions:[{key:"rsi",op:"lte",value:30}]};
  const expected=replaySession(bars,20,rule);
  assert.equal(expected.side,"buy");
  bars[20][4]=1000;
  assert.deepEqual(replaySession(bars,20,rule),expected);
});
test("daily first-touch candidates include two-line overlap and distinguish single-line notifications",()=>{
  const settings={single:"notify",tolerance:1,rsiCeiling:60,rally:20,drawdown:15,reactions:4};
  const levels={lines:[{kind:"support",price:100,reactions:4},{kind:"long",price:101.5,reactions:4}],rsi:{day:75},high:150};
  assert.equal(touchCandidate(levels,settings,[0,110,115,99,108,1]).side,"buy");
  assert.equal(touchCandidate(levels,settings,[0,90,100,85,87,1]),undefined);
  levels.lines.pop();levels.rsi.day=59;
  assert.equal(touchCandidate(levels,settings,[0,103,105,100,101,1]).label,"검토 후보");
});
test("Lab pairs fills by side and day, excludes review notifications, and keeps missing private history unknown",()=>{
  const days=["2026-11-19","2026-11-20","2026-11-23"];
  const signals=new Map([[days[0],{side:"buy"}],[days[1],{side:"sell"}],[days[2],{side:null}]]);
  const fills=[{day:days[0],side:"buy"},{day:days[0],side:"sell"},{day:days[1],side:"buy"}];
  const result=compareSessions(days,signals,fills);
  assert.equal(result.matchDays,1);assert.equal(result.fillDays,2);assert.equal(result.signalDays,2);
  assert.equal(compareSessions(days,signals,null).fillDays,null);
});
