import test from "node:test";
import assert from "node:assert/strict";
import {calendarWhen,personalEarnings} from "../assets/calendar.js";

test("published US releases use the Korean date and the correct seasonal offset",()=>{
  const winter=calendarWhen({at:"2026-12-09T14:00:00-05:00"});
  assert.equal(winter.first,"2026-12-10");assert.equal(winter.time,"04:00");
  const summer=calendarWhen({at:"2027-06-09T14:00:00-04:00"});
  assert.equal(summer.first,"2027-06-10");assert.equal(summer.time,"03:00");
});

test("US release windows preserve unknown hours and cross calendar boundaries in Korea",()=>{
  const data={date:"2026-12-31"};
  assert.equal(calendarWhen({...data,timing:"before"}).last,"2026-12-31");
  assert.equal(calendarWhen({...data,timing:"after"}).first,"2027-01-01");
  assert.deepEqual(calendarWhen(data),{first:"2026-12-31",last:"2027-01-01",time:"시각 미정",exact:false});
  assert.equal(calendarWhen({date:"2026-11-31"}),null);
});

test("watchlist and holdings union matches US class tickers without doubling an event",()=>{
  const reports=["NVDA","NVDA","BRK.B","OTHER"].map(symbol=>({symbol,date:"2026-11-30",timing:"after"}));
  const result=personalEarnings(reports,["NVDA"],new Set(["NVDA","BRK-B"]));
  assert.deepEqual(result.map(e=>e.title),["NVDA 실적 발표","BRK-B 실적 발표"]);
  assert.deepEqual(result.map(e=>e.detail),["보유 · 관심","보유"]);
});
