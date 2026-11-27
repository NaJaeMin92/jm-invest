import {runWindows} from "./lab-backtest.js?v=150";
self.onmessage=({data:{bars,years,rule,seed}})=>{
  try{
    let state=seed;
    const random=seed===undefined ? Math.random : ()=>{
      state=(Math.imul(1664525,state)+1013904223)>>>0;
      return state/2**32;
    };
    const results=runWindows(bars,years,rule,progress=>self.postMessage({progress}),random);
    self.postMessage({results});
  }catch(error){self.postMessage({error:error.message});}
};
