import test from "node:test";
import assert from "node:assert/strict";
import {chartTrends, beforeTime} from "../chart-trends.js";

test("confirmed rising lows and falling highs produce both trend horizons and nearby zones", () => {
  const bars = Array.from({length:60}, (_, i) => {
    const swing = Math.cos(i*Math.PI/4);
    return [1000*i, 50, 65+swing-i*.02, 35+swing+i*.02, 50, 100];
  });
  const guides = chartTrends(bars,bars,50);
  for (const key of ["long","short"]) {
    assert.ok(guides.some(g => g.key === key && g.slope > 0));
    assert.ok(guides.some(g => g.key === key && g.slope < 0));
  }
  assert.ok(guides.some(g => g.key === "support" && g.price < 50));
  assert.ok(guides.some(g => g.key === "resistance" && g.price > 50));
  assert.equal(beforeTime(bars,bars[10][0]),10);
  assert.deepEqual(chartTrends(bars.slice(0,4),[],50),[]);
});
