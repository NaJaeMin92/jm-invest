import {runWindows} from "./lab-backtest.js?v=146";
self.onmessage=({data:{bars,years,rule}})=>{
  try{
    const results=runWindows(bars,years,rule,progress=>self.postMessage({progress}));
    self.postMessage({results});
  }catch(error){self.postMessage({error:error.message});}
};
