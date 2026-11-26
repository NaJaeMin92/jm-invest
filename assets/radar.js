import {strategyPresets} from "./strategy-editor.js?v=114";
import {firstTouchLevels} from "./first-touch.js?v=113";
import {factors, metrics} from "./strategy.js?v=84";

const et=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
const kst=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const money=n=>"$"+n.toLocaleString("en-US",{maximumFractionDigits:4});
const fmt=n=>Number(n.toFixed(2)).toString();
const frameName={day:"일봉",week:"주봉",month:"월봉"};
const scanInterval=5*60_000;

// Distance to the upper edge is positive as a falling price approaches support.
export function supportCandidate(price, levels, config) {
  const {tolerance,drawdown,reactions,rsiCeiling,single}=config;
  const lines=levels.lines.map(l=>({...l,lo:l.price*(1-tolerance/100),hi:l.price*(1+tolerance/100)}));
  const candidates=[];
  function add(lo,hi,evidence,name,review=false) {
    if (lo>hi || price<lo) return;
    const distance=Math.max(0,(price/hi-1)*100);
    if(distance>3) return;
    candidates.push({rank:distance===0?0:1,distance,side:"buy",
      label:distance===0?(review?"터치 · 검토":"지지 구간 진입"):"지지 구간 접근",
      evidence, note:name+" · "+(distance===0?"현재가 "+money(price):"구간까지 "+fmt(distance)+"%")});
  }
  const describe=l=>(l.kind==="long"?"장기 빗각 ":"수평 지지 ")+money(l.price);
  if(lines.length===2){
    add(Math.max(...lines.map(l=>l.lo)),Math.min(...lines.map(l=>l.hi)),lines.map(describe).join(" · "),"두 선 겹침");
  }
  for(const line of lines){
    const drop=levels.high ? (1-price/levels.high)*100 : null;
    const deep=drop!==null && drop>=drawdown;
    if(!Number.isFinite(levels.rsi.day) || levels.rsi.day>=rsiCeiling || (!deep && line.reactions<reactions))continue;
    add(line.lo,line.hi,describe(line)+" · RSI "+fmt(levels.rsi.day),
      deep?"파동 고점 대비 −"+fmt(drop)+"%":"과거 반응 "+line.reactions+"회",single!=="buy");
  }
  return candidates.sort(compare)[0];
}

function compare(a,b){return a.rank-b.rank || a.distance-b.distance;}

export function indicatorCandidate(rule,values){
  const conditions=rule.conditions;
  if(!conditions?.length || conditions.some(c=>!factors[c.key] || !Number.isFinite(c.value) || !Number.isFinite(values[c.key]))) return;
  const tests=conditions.map(c=>{
    const v=values[c.key],gap=Math.max(0,c.op==="lte"?v-c.value:c.value-v);
    const near={rsi:5,band:10}[c.key] || 0;
    return {distance:gap===0?0:near?gap/near:Infinity,
      text:factors[c.key][0].split(" · ")[0]+" "+fmt(v)+" (기준 "+(c.op==="lte"?"≤":"≥")+fmt(c.value)+")"};
  });
  const distance=(rule.join==="any"?Math.min:Math.max)(...tests.map(t=>t.distance));
  if(distance>1)return;
  const evidence=(rule.join==="any"?tests.filter(t=>t.distance<=1):tests).map(t=>t.text).join(" · ");
  return {rank:distance===0?0:1,distance,side:rule.side,label:distance===0?"조건 충족":"기준 근접",evidence,note:frameName[rule.frame || "day"]};
}

export function radarCandidates(symbol,held,active,daily,price,now=new Date()) {
  const date=et.format(now), stamp=Date.parse(date+"T12:00:00Z")/1000;
  const closed=daily.filter(b=>et.format(b[0]*1000)<date);
  if(!Number.isFinite(price) || price<=0 || !closed.length || stamp-closed.at(-1)[0]>7*86400)return [];
  const rows=[];
  const rules=[active || {...strategyPresets.firstTouch,preset:"firstTouch"}];
  const otherSide=active?.side==="sell"?"buy":"sell";
  if(otherSide==="buy" || held){
    const key=otherSide==="buy"?"firstTouch":"overheat";
    const other=active?.variants?.[key] || {...strategyPresets[key],preset:key};
    if(other.side===otherSide)rules.push(other);
  }
  for(const rule of rules){
    if(rule.side==="sell" && !held)continue;
    const candidate=rule.preset==="firstTouch"
      ?supportCandidate(price,firstTouchLevels(closed,stamp,rule.touch),rule.touch)
      :indicatorCandidate(rule,metrics([...closed,[stamp,price,price,price,price,0]],rule.frame || "day"));
    if(candidate)rows.push({...candidate,symbol,name:rule.nickname || "직접 설정",barDate:et.format(closed.at(-1)[0]*1000)});
  }
  return rows;
}

export function setupRadar({getWatchlist,getHoldings,loadChart,canLoadChart,readStrategy,openStock,onSignIn}){
  const get=id=>document.getElementById("radar-"+id);
  const cache=new Map();
  const refreshIcon=get("refresh").firstElementChild;
  let controller,timer,filter="all",candidates=[],signature="";
  function paint(){
    const list=get("list"),fragment=document.createDocumentFragment();
    for(const row of candidates.filter(c=>filter==="all" || c.side===filter).sort((a,b)=>compare(a,b) || a.symbol.localeCompare(b.symbol))){
      const li=document.createElement("li"),card=document.createElement("button"),identity=document.createElement("span");
      card.type="button";card.className="radar-card";card.dataset.side=row.side;card.onclick=()=>openStock(row.symbol);
      identity.className="radar-identity";
      const ticker=document.createElement("strong"),tag=document.createElement("small");
      ticker.textContent=row.symbol;tag.textContent=(row.side==="buy"?"매수":"매도")+" · "+row.label;
      identity.append(ticker,tag);
      const evidence=document.createElement("span"),note=document.createElement("small");
      evidence.className="radar-evidence";evidence.textContent=row.evidence;
      note.className="radar-note";note.textContent=row.name+" · "+row.note+" · "+row.barDate+" ET 기준봉";
      card.append(identity,evidence,note);li.append(card);fragment.append(li);
    }
    list.replaceChildren(fragment);
    if(candidates.length && !list.children.length) {
      const li=document.createElement("li");li.textContent="이 방향의 후보가 없습니다.";list.append(li);
    }
    for(const b of get("filters").querySelectorAll("button"))b.setAttribute("aria-pressed",String(b.dataset.side===filter));
  }
  for(const b of get("filters").querySelectorAll("button"))b.onclick=()=>{filter=b.dataset.side;paint();};
  function close(){controller?.abort();controller=null;clearTimeout(timer);signature="";}
  async function open(force=false){
    const held=new Set(getHoldings()), symbols=[...new Set([...held,...getWatchlist()])].filter(s=>!["BZMAIN","CLMAIN","VIX"].includes(s));
    const key=JSON.stringify([symbols,[...held],canLoadChart()]);
    if(controller && signature===key && !force)return;
    close();signature=key;candidates=[];paint();
    const button=get("refresh"),status=get("status");
    if(!canLoadChart()){cache.clear();button.textContent="로그인";button.setAttribute("aria-label","계좌에 로그인");status.textContent="로그인하면 관심·보유 종목의 키움 시세로 후보를 조회합니다.";return;}
    button.replaceChildren(refreshIcon);button.setAttribute("aria-label","후보 다시 조회");
    const ctrl=new AbortController();controller=ctrl;
    let failed=0,count=0;
    for(const symbol of symbols){
      status.textContent=symbol+" 분석 중 · "+count+"/"+symbols.length;
      try{
        let entry=cache.get(symbol);
        if(force || !entry || Date.now()-entry.at>=scanInterval){
          const q=await loadChart(symbol,"day",null,ctrl.signal);
          if(q?.source || !Number.isFinite(q?.price) || !q.daily?.length)throw Error("시세 없음");
          let daily=q.daily;
          if(daily.length<253 && q.before){
            const older=await loadChart(symbol,"day",q.before,ctrl.signal);
            if(older?.bars?.length)daily=[...older.bars.filter(b=>b[0]<daily[0][0]),...daily];
          }
          ctrl.signal.throwIfAborted();
          entry={at:Date.now(),daily,price:q.price};cache.set(symbol,entry);
        }
        candidates.push(...radarCandidates(symbol,held.has(symbol),readStrategy(symbol),entry.daily,entry.price));
        paint();
      }catch{if(ctrl.signal.aborted)return;failed++;}
      count++;
    }
    if(ctrl.signal.aborted)return;
    status.textContent=kst.format(Date.now())+" KST 조회 · "+(count-failed)+"종목 · "+
      (candidates.length?"후보 "+candidates.length+"건":"조건에 맞는 후보 없음")+(failed?" · 자료 부족 "+failed+"종목":"");
    timer=setTimeout(()=>{if(!document.hidden)open(true);},scanInterval);
  }
  get("refresh").onclick=()=>canLoadChart()?open(true):onSignIn();
  document.addEventListener("visibilitychange",()=>{
    if(document.body.dataset.view!=="radar")return;
    if(document.hidden)close();else open();
  });
  return {open,close};
}
