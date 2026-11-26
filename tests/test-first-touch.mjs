import test from "node:test";
import assert from "node:assert/strict";
import {firstBuyQuantity,firstTouchDecision,recentSwingHigh,firstTouchLevels} from "../assets/first-touch.js";
import {watchFirstTouch} from "../assets/first-touch-watch.js";

const settings={rsiCeiling:60,tolerance:1,rally:20,drawdown:20,reactions:4,single:"buy"};
const line=(kind,price,reactions=0)=>({kind,price,reactions});
const decide=(lines,day=45,high=125,previous=110,price=100,s=settings)=>
  firstTouchDecision({lines,high,rsi:{day}},s,previous,price);

test("entry needs a touch from above, and confluence overrides RSI",()=>{
  const both=[line("long",100.2),line("support",100)];
  assert.equal(decide(both,80).action,"buy");
  assert.equal(decide(both,null,null).action,"buy");
  for(const prev of [null,99,100]) assert.equal(decide(both,40,150,prev),null);
  assert.equal(decide(both,40,150,110,90),null);
});
test("one line requires drawdown or independent reactions, low RSI, and an enabled action",()=>{
  const one=[line("support",100)];
  assert.equal(decide(one).action,"buy");
  assert.equal(decide(one,60).action,"hold");
  assert.equal(decide(one,null).action,"hold");
  assert.equal(decide(one,45,105),null);
  assert.equal(decide([line("long",100,4)],45,null).action,"buy");
  assert.equal(decide(one,45,125,110,100,{...settings,single:"notify"}).action,"notify");
});
test("most recent confirmed qualifying upswing takes priority over an older higher top",()=>{
  const points=[120,80,160,85,110,90,95];
  const bars=points.slice(1).flatMap((p,j)=>Array.from({length:12},(_,i)=>{
    const v=points[j]+(p-points[j])*i/12;return [j*12+i,v,v,v,v,1];
  }));
  assert.equal(recentSwingHigh(bars,20),110);
  assert.equal(recentSwingHigh(bars,50),160);
});
test("first order uses only its tranche in whole shares at the entered limit",()=>{
  const plan={amount:"1000.00",units:10,perBuy:1};
  assert.equal(firstBuyQuantity(plan,"33.34"),2);
  assert.equal(firstBuyQuantity(plan,"100.01"),0);
  assert.equal(firstBuyQuantity(plan,"0.0125"),8000);
});

test("stream ignores stale/snapshot data, never submits in observation, and submits once per activation",async()=>{
  const today=Date.now()/1000, date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(Date.now());
  const noon=Date.parse(date+"T12:00:00Z")/1000;
  const daily=Array.from({length:400},(_,i)=>{
    const p=30+2*Math.cos(i*Math.PI/3);
    return [noon-(400-i)*86400,p,p+1,p-1,p,100];
  });
  const touch={...settings,reactions:3,rsiCeiling:100};
  const price=firstTouchLevels(daily,noon,touch).lines[0].price;
  for(const observe of [true,false]){
    let closes=0,submits=0,previews=0;
    const r={symbol:"TEST",touch,allocation:{amount:"1000",units:2,perBuy:1},price:"25.00"};
    const result=await watchFirstTouch({r,ctrl:new AbortController(),observe,loadChart:async()=>({daily}),
      subscribeOrderBook(symbol,send){
        const tick={symbol,price:price+2,tradedAt:Math.floor(today),session:"0"};
        send(tick);send({...tick,price,snapshot:true});send({...tick,price,tradedAt:today-60});
        send({...tick,price});send({...tick,price});
        return ()=>closes++;
      },
      orders:{stockContext:async()=>({symbol:"TEST",exchange:"ND",enabled:true}),preview:async order=>{
        previews++;assert.equal(order.quantity,"20");assert.equal(order.side,"buy");return {id:"mock"};
      },submit:async id=>{assert.equal(id,"mock");submits++;return {number:"test"};}},
      report(){},submitting(){}
    });
    assert.equal(closes,1);assert.equal(previews,observe?0:1);assert.equal(submits,observe?0:1);
    assert.match(result,/1차 매수 신호/);
  }
});
