import assert from "node:assert/strict";
import test from "node:test";
import {executionGroups} from "../chart-executions.js";

const timestamp = date => Date.parse(date) / 1000;
const fill = {day:"2026-11-23", time:timestamp("2026-11-23T14:37:35Z"), side:"buy", price:10, quantity:2};
function groups(frame, starts, records) {
  return executionGroups({frame, bars:starts.map(start=>[timestamp(start)]), start:0, end:starts.length-1},records);
}

test("fills use the matching exchange candle across intervals", () => {
  for (const [frame,start] of [
    ["minute","2026-11-23T14:37:00Z"], ["five","2026-11-23T14:35:00Z"], ["hour","2026-11-23T14:30:00Z"],
    ["day","2026-11-23"], ["week","2026-11-23"], ["month","2026-11-02"], ["quarter","2026-10-01"]
  ]) assert.equal(groups(frame,[start],[fill])[0].records[0],fill);
});

test("overnight executions use the trading session for daily bars and the actual time for minute bars", () => {
  const overnight = {...fill,time:timestamp("2026-11-23T01:30:15Z")};
  assert.equal(groups("day",["2026-11-20","2026-11-23"],[overnight])[0].index,1);
  assert.equal(groups("minute",["2026-11-23T01:30:00Z"],[overnight]).length,1);
  assert.equal(groups("minute",["2026-11-23T01:29:00Z","2026-11-23T01:32:00Z"],[overnight]).length,0);
  assert.equal(groups("minute",["2026-11-23T01:30:00Z"],[{...overnight,time:null}]).length,0);
});

test("same-candle executions keep both sides and all reported amounts", () => {
  const another = {...fill,price:10.2,quantity:1}, sale = {...fill,side:"sell"};
  const result = groups("day",["2026-11-23"],[fill,another,sale]);
  assert.deepEqual(result.map(group=>group.records), [[fill,another],[sale]]);
});
