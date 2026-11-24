import assert from "node:assert/strict";
import test from "node:test";
import {splitBudget} from "../assets/split-budget.js";
test("grouped rounds allocate every cent and every unit exactly once",()=>{
  for(let units=1;units<50;units++)for(let perBuy=1;perBuy<=units;perBuy++){
    const {ranges,rounds}=splitBudget("100.23",units,perBuy);
    assert.equal(rounds,Math.ceil(units/perBuy));
    assert.equal(ranges.reduce((sum,r)=>sum+(r.end-r.first+1)*r.cents,0),10023);
    assert.equal(ranges.reduce((sum,r)=>sum+(r.end-r.first+1)*r.size,0),units);
  }
  assert.deepEqual(splitBudget("1000",10,3).ranges,[{first:1,end:3,size:3,cents:30000},{first:4,end:4,size:1,cents:10000}]);
  assert.equal(splitBudget("0.02",3,1),null);
  assert.equal(splitBudget("100",3,4),null);
});
