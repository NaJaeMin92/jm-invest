import {usMarketSession} from "../watch-quotes.js?v=64";
import {publicQuote} from "../instrument.js?v=112";
import {metrics, metricsAt, matches, factors} from "./strategy.js?v=115";
import {prepareChart} from "../instrument-chart.js?v=103";
import {touchCandidate, windowsPerGroup} from "./lab-backtest.js?v=146";
import {firstTouchLevels} from "./first-touch.js?v=113";

const dayMs = 86400000;
const nyDay = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"});
const dateKey = ms => new Date(ms).toISOString().slice(0, 10);
const get = id => document.getElementById("lab-" + id);
const example = {nickname:"예시 · RSI 30 이하", side:"buy", frame:"day", join:"all",
  conditions:[{key:"rsi",op:"lte",value:30}]};

const condition = (key, op, value) => ({key,op,value});
const templates = [
  ["rsi", "RSI 과매도", "buy", [condition("rsi","lte",30)]],
  ["bollinger", "볼린저 하단", "buy", [condition("band","lte",0)]],
  ["sma", "SMA20 추세 추종", "buy", [condition("ma","gte",0)]],
  ["rsi-high", "RSI 과매수", "sell", [condition("rsi","gte",70)]],
  ["band-high", "볼린저 상단", "sell", [condition("band","gte",100)]],
  ["dual", "RSI·볼린저 동시 과매도", "buy", [condition("rsi","lte",35),condition("band","lte",10)]],
  ["pullback", "SMA20 눌림목", "buy", [condition("ma","lte",-3),condition("rsi","gte",40)]],
  ["support", "지지선 접근", "buy", [condition("support","gte",0),condition("support","lte",1)]],
  ["resistance", "저항선 접근", "sell", [condition("resistance","gte",-1),condition("resistance","lte",0)]],
  ["fibonacci", "피보나치 61.8% 접근", "buy", [condition("fibonacci","gte",-1),condition("fibonacci","lte",1)]]
].map(([id,nickname,side,conditions])=>["builtin-"+id,{nickname,side,conditions,frame:"day",join:"all"}]);

const learnedKey = symbol => "jm-invest:lab-fill-rules:v1:" + symbol;

export function inferFillRules(bars,fills) {
  const chart=prepareChart(bars,"day");
  const start=Math.max(20,bars.length-120);
  const split=start+Math.floor((bars.length-start)*.7);
  const fillsBySide = new Map(["buy","sell"].map(side=>[side,new Set(fills.filter(f=>f.side===side).map(f=>f.day))]));
  const trials=templates.map(([id,rule])=>({id,rule,train:0,trainHits:0,test:0,testHits:0,actualTest:0}));
  for(let i=start;i<bars.length;i++){
    const values=metricsAt(chart,"day",i-1);
    const day=dateKey(bars[i][0]*1000);
    for(const trial of trials){
      const filled=fillsBySide.get(trial.rule.side).has(day), signal=matches(trial.rule,values);
      if(i<split){
        if(signal){trial.train++;if(filled)trial.trainHits++;}
      }else{
        if(filled)trial.actualTest++;
        if(signal){trial.test++;if(filled)trial.testHits++;}
      }
    }
  }
  return ["buy","sell"].flatMap(side=>{
    const selected=trials.filter(t=>t.rule.side===side && t.trainHits>=2)
      .sort((a,b)=>b.trainHits/Math.sqrt(b.train)-a.trainHits/Math.sqrt(a.train))[0];
    if(!selected || selected.testHits===0 ||
        selected.testHits/selected.test <= selected.actualTest/(bars.length-split)) return [];
    const {rule,trainHits,train,testHits,test,actualTest}=selected;
    return [{...rule,nickname:"체결 기반 · "+rule.nickname,sample:{trainHits,train,testHits,test,actualTest}}];
  });
}

export function executionWindows(first, last) {
  const ranges = [];
  const end = Date.parse(last);
  for (let from = Date.parse(first); from <= end; from += 84 * dayMs) {
    ranges.push([dateKey(from), dateKey(Math.min(end, from + 83 * dayMs))]);
  }
  return ranges;
}

export {touchCandidate} from "./lab-backtest.js?v=146";

function replayIssue(rule) {
  if (rule.preset === "firstTouch") return rule.touch ? "" : "터치 설정이 없습니다.";
  if (!rule.conditions?.length) return "저장된 판단 조건이 없습니다.";
  if (rule.conditions.some(c => !Object.hasOwn(factors,c.key) || ["vix", "fear"].includes(c.key))) {
    return "이 전략에는 과거 시점의 값이 제공되지 않는 지표가 있습니다.";
  }
  return "";
}

export function replaySession(bars, index, rule) {
  const current = bars[index];
  if (rule.preset === "firstTouch") {
    const levels = firstTouchLevels(bars.slice(0,index), current[0], rule.touch);
    return touchCandidate(levels, rule.touch, current);
  }
  const values = metrics(bars.slice(0,index+1), rule.frame);
  if (!matches(rule, values)) return null;
  return {side:rule.side, label:rule.side === "sell" ? "매도 조건 충족" : "매수 조건 충족",
    detail:rule.conditions.map(c => factors[c.key][0].split(" · ")[0] + " " + values[c.key].toFixed(1)).join(" · ")};
}

export function compareSessions(days, signals, fills) {
  const grouped = new Map(days.map(day => [day,{day,signal:signals.get(day),fills:[]}]));
  for (const fill of fills ?? []) {
    if (["buy","sell"].includes(fill.side)) grouped.get(fill.day)?.fills.push(fill);
  }
  const events = [...grouped.values()].filter(row => row.signal || row.fills.length).reverse();
  return {events, signalDays:events.filter(r => r.signal?.side).length,
    fillDays:fills && events.filter(r => r.fills.length).length,
    matchDays:fills && events.filter(r => r.signal?.side && r.fills.some(f => f.side===r.signal.side)).length};
}

async function loadBars(symbol, needed, loadChart, canRead, signal, progress=()=>{}) {
  const now=new Date(), session=usMarketSession(now), today=session.date;
  const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",hourCycle:"h23"}).format(now));
  const closedToday=session.phase==="After" || hour>=16;
  const bars = new Map();
  const merge = rows => {
    for (const bar of rows || []) {
      if(!Array.isArray(bar) || bar.length<5 || !bar.slice(0,5).every(Number.isFinite))continue;
      const [stamp,opening,high,low,closing]=bar, day=dateKey(stamp*1000);
      if(low>0 && low<=Math.min(opening,closing) && high>=Math.max(opening,closing) &&
         (day<today || closedToday && day===today))bars.set(stamp,bar);
    }
  };
  let source, issue;
  if (canRead) {
    try {
      const first = await loadChart(symbol, "day", null, signal);
      merge(first?.daily);
      source = first?.source || "키움";
      let before = first?.before;
      progress(bars.size);
      while (before && bars.size < needed) {
        const page = await loadChart(symbol, "day", before, signal);
        merge(page?.bars);
        progress(bars.size);
        if (!page?.before) break;
        if (page.before >= before) throw Error("이전 일봉 페이지가 중복됐습니다.");
        before = page.before;
      }
    } catch(error) { signal.throwIfAborted(); issue = error; }
  }
  if (!bars.size) {
    const snapshot = await publicQuote(symbol);
    signal.throwIfAborted();
    merge(snapshot?.daily);
    if (!bars.size) throw issue || new Error(canRead ? "이 종목의 일봉을 불러오지 못했습니다." : "이 종목의 일봉은 계좌 로그인 후 조회할 수 있습니다.");
    source = "저장 시세";
  }
  return {bars:[...bars.values()].sort((a,b)=>a[0]-b[0]).slice(-needed), source,
    partial:Boolean(issue && bars.size < needed && source !== "저장 시세")};
}

const shareFormat = new Intl.NumberFormat("ko-KR",{maximumFractionDigits:8});
function appendEvents(container, events) {
  const fragment = document.createDocumentFragment();
  for (const row of events) {
    const entry = document.createElement("li"), when = document.createElement("time");
    when.dateTime = row.day; when.textContent = row.day.slice(5).replace("-",".");
    when.title=row.day;
    const body = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("small");
    const counts = [];
    for (const side of ["buy","sell"]) {
      const fills = row.fills.filter(f=>f.side===side);
      if (fills.length) counts.push("실제 "+(side==="buy"?"매수 ":"매도 ")+shareFormat.format(fills.reduce((sum,f)=>sum+Number(f.quantity),0))+"주");
    }
    title.textContent=[row.signal?.label,...counts].filter(Boolean).join(" · ");
    detail.textContent = row.signal?.detail || "";
    body.append(title);
    if (detail.textContent) body.append(detail);
    entry.append(when,body);
    fragment.append(entry);
  }
  if (!events.length) {
    const empty = document.createElement("li");
    empty.textContent = "표시할 기록이 없습니다.";
    fragment.append(empty);
  }
  container.replaceChildren(fragment);
}

export function setupLab({readSymbols, loadChart, loadExecutions, canLoadChart, readStrategy, onSignIn}) {
  const symbolInput=get("symbol"), period=get("period"), status=get("status"), result=get("results"), login=get("login");
  const strategies=get("strategy"), windows=get("windows"), all=get("all-results");
  for(let y=1;y<=30;y++) get("years").append(new Option(y+"년","y"+y));
  let controller, lastAccess, history;
  let rules=new Map();
  const annual=()=>period.value.startsWith("y");
  function selectRules(preferred){
    const active=readStrategy(symbolInput.value);
    rules=new Map(Object.entries(active?.variants || {}).filter(([,r])=>Array.isArray(r?.conditions)));
    const key=active?.preset || "custom";
    if(active)rules.set(key,active);
    strategies.replaceChildren(...[...rules].map(([k,r])=>new Option(r.nickname || "저장된 "+(r.side==="buy"?"매수":"매도")+" 전략",k)));
    try {
      for(const rule of JSON.parse(localStorage.getItem(learnedKey(symbolInput.value)) || "[]")){
        const key="learned-"+rule.side;
        rules.set(key,rule);
        strategies.append(new Option(rule.nickname,key));
      }
    } catch {}
    const group=document.createElement("optgroup");
    group.label="대표 전략";
    for(const [id,rule] of templates){
      rules.set(id,rule);
      group.append(new Option(rule.nickname,id));
    }
    strategies.append(group);
    strategies.value=rules.has(preferred)?preferred:active?key:templates[0][0];
    strategies.disabled=rules.size<2;
  }
  function changed(){
    controller?.abort();controller=null;result.hidden=true;windows.hidden=true;all.hidden=true;
    login.hidden=canLoadChart();
    get("infer").hidden=!canLoadChart() || !symbolInput.value;
    const sample=rules.get(strategies.value)?.sample;
    get("inference").textContent=sample ? `학습 구간 신호 ${sample.train}일 중 ${sample.trainHits}일 일치 · 검증 구간 신호 ${sample.test}일 중 ${sample.testHits}일 일치` : "";
    get("run-all").hidden=!annual();
    get("run").textContent=annual()?"백테스트 실행":"전략 검증";
    if(!annual())return review();
    status.textContent=rules.size ? `최근 일봉 기준 월별 ${windowsPerGroup}구간과 무작위 ${windowsPerGroup}구간을 비교합니다.` : "Strategies에서 이 종목의 전략을 먼저 저장하세요.";
  }

  async function review(runAll = false) {
    controller?.abort();
    const task = new AbortController(), {signal}=task;
    controller=task;
    const symbol=symbolInput.value;
    result.hidden=true;windows.hidden=true;all.hidden=true;
    if (!symbol) {status.textContent="관심종목에 종목을 추가하세요.";return;}
    const count=Number(period.value);
    const canRead=canLoadChart(), saved=rules.get(strategies.value);
    const rule=saved ?? example, issue=replayIssue(rule);
    lastAccess = canRead;
    login.hidden=canRead;
    status.textContent="일봉을 불러오는 중…";
    try {
      if(annual()){
        if(!runAll && !saved)throw Error("Strategies에서 이 종목의 전략을 먼저 저장하세요.");
        if(!runAll && issue)throw Error(issue);
        const years=Number(period.value.slice(1));
        const key=[symbol,canRead,nyDay.format(new Date()),new Date().getUTCHours()].join("/");
        if(history?.key!==key){
          const loaded=await loadBars(symbol,Infinity,loadChart,canRead,signal,n=>{if(!signal.aborted)status.textContent="일봉 "+n.toLocaleString()+"개 조회 중…";});
          signal.throwIfAborted();
          history={...loaded,key:loaded.partial?null:key};
        }
        const {bars,source,partial}=history;
        if(!bars.length)throw Error("조회할 수 있는 완료 일봉이 없습니다.");
        if (runAll) {
          const entries=[...rules.values()];
          const seed=Math.floor(Math.random()*2**32);
          get("all-title").textContent=symbol+" · "+years+"년 전체 전략 백테스트";
          get("all-source").textContent=source+" · 월별 / 무작위 구간 중앙 수익률";
          const list=get("all-list");
          list.replaceChildren();
          all.hidden=false;
          for (const [index,strategy] of entries.entries()) {
            signal.throwIfAborted();
            const name=strategy.nickname || "저장 전략";
            const row=document.createElement("li");
            const title=document.createElement("strong"), summary=document.createElement("small");
            title.textContent=name;
            row.append(title,summary);
            list.append(row);
            status.textContent=(index+1)+"/"+entries.length+" · "+name+" 계산 중…";
            try {
              const limitation=replayIssue(strategy);
              if (limitation) throw Error(limitation);
              const groups=await calculateWindows(bars,years,strategy,signal,()=>{},seed);
              signal.throwIfAborted();
              summary.textContent=[groups.rolling,groups.random].map(group=>{
                const rows=group.filter(Boolean);
                return rows.length ? percent(medianProfit(rows))+" ("+rows.length+"/"+windowsPerGroup+"구간 · 체결 "+rows.filter(r=>r.filled).length+")" : "계산 가능 구간 없음";
              }).join(" / ");
            } catch(error) {
              signal.throwIfAborted();
              summary.textContent=error.message;
            }
          }
          status.textContent=entries.length+"개 전략 비교 완료"+(partial?" · 시세 일부만 조회됨":"");
          return;
        }
        status.textContent="백테스트 구간을 구성하는 중…";
        const groups=await calculateWindows(bars,years,saved,signal,n=>{status.textContent="구간 "+n+" 계산 중…";});
        signal.throwIfAborted();
        renderWindows(groups,years,rule,symbol,bars,source);
        windows.hidden=false;
        const completed=groups.rolling.filter(Boolean).length+groups.random.length;
        status.textContent=[completed+"/"+(2*windowsPerGroup)+"구간 계산 완료",completed<2*windowsPerGroup?"완전한 검증 기간과 지표 준비 이력이 있는 구간만 계산했습니다.":"",
          partial?"시세 일부만 조회되었습니다. 다시 실행하면 재조회합니다.":""].filter(Boolean).join(" · ");
        return;
      }
      const warmup=rule.frame==="month" ? 1400 : rule.frame==="week" ? 600 : 400;
      const {bars,source,partial}=await loadBars(symbol, count+warmup, loadChart, canRead, signal);
      signal.throwIfAborted();
      const start=Math.max(0,bars.length-count);
      const days=bars.slice(start).map(b => dateKey(b[0]*1000));
      if (!days.length) throw Error("조회 기간의 완료 일봉이 없습니다.");
      const signals=new Map();
      if (!issue) {
        status.textContent="과거 전략 조건을 계산하는 중…";
        for (let i=start;i<bars.length;i++) {
          if ((i-start)%12===0) {
            await new Promise(resolve=>setTimeout(resolve,0));
            signal.throwIfAborted();
          }
          const event=replaySession(bars,i,rule);
          if (event) signals.set(days[i-start],event);
        }
      }
      const notes=[issue, partial && "이전 일봉 일부를 불러오지 못했습니다."].filter(Boolean);
      if (rule.preset==="firstTouch") notes.push("시가가 지지 구간 위에서 시작해 일중 저가가 닿은 날을 후보로 표시합니다. 장중 체결 순서는 일봉으로 확인할 수 없습니다.");
      else if (!issue) notes.push("직전 완료 봉 기준으로 조건을 충족한 거래일을 집계합니다.");
      function show(fills) {
        const comparison=compareSessions(days,signals,fills);
        get("rule").textContent = rule.nickname || (rule.side==="buy"?"저장된 매수 전략":"저장된 매도 전략");
        get("range").textContent=symbol+" · "+days[0]+" – "+days.at(-1)+" · "+source;
        get("signals").textContent=issue ? "—" : String(comparison.signalDays);
        get("signals").previousElementSibling.textContent=rule.preset==="firstTouch"?"매수 후보일":"신호 발생일";
        get("fills").textContent=comparison.fillDays ?? "—";
        get("matches").textContent=issue ? "—" : comparison.matchDays ?? "—";
        appendEvents(get("events"),comparison.events);
        result.hidden=false;
      }
      show(null);
      if (canRead) {
        status.textContent="실제 체결 내역을 대조하는 중…";
        try {
          const fills=[];
          for (const [from,to] of executionWindows(days[0],days.at(-1))) {
            const records=await loadExecutions(symbol,from,to,signal);
            signal.throwIfAborted();
            if (!Array.isArray(records)) throw Error();
            fills.push(...records);
          }
          show(fills);
        } catch { signal.throwIfAborted(); notes.push("계좌 체결 내역을 불러오지 못했습니다."); }
      } else notes.push("계좌에 로그인하면 실제 체결일과 비교할 수 있습니다.");
      status.textContent=notes.join(" ");
    } catch(error) {
      if (!signal.aborted) status.textContent=error.message || "조회에 실패했습니다. 다시 시도하세요.";
    }
  }

  get("infer").onclick=async ()=>{
    const symbol=symbolInput.value;
    if(!symbol || !canLoadChart())return;
    controller?.abort();
    const task=new AbortController(), {signal}=task;
    controller=task;
    const button=get("infer");
    button.disabled=true;
    status.textContent="최근 체결과 직전 일봉을 대조하는 중…";
    try {
      const {bars}=await loadBars(symbol,390,loadChart,true,signal);
      if(bars.length<50)throw Error("전략을 비교할 완료 일봉이 부족합니다.");
      const days=bars.slice(-120).map(bar=>dateKey(bar[0]*1000));
      const fills=[];
      for(const [from,to] of executionWindows(days[0],days.at(-1))){
        const records=await loadExecutions(symbol,from,to,signal,true);
        signal.throwIfAborted();
        if(!Array.isArray(records))throw Error("체결 내역을 불러오지 못했습니다.");
        fills.push(...records);
      }
      const learned=inferFillRules(bars,fills);
      if(!learned.length)throw Error("검증 구간에서도 반복해서 일치한 전략이 없습니다.");
      localStorage.setItem(learnedKey(symbol),JSON.stringify(learned));
      selectRules("learned-"+learned[0].side);
      period.value="y1";
      changed();
      status.textContent=learned.length+"개 전략을 이 기기의 Lab에 저장했습니다.";
    }catch(error) {
      if(!signal.aborted)status.textContent=error.message || "체결 기반 전략을 만들지 못했습니다.";
    }finally{button.disabled=false;}
  };

  function open() {
    const prev=symbolInput.value;
    const symbols=[...new Set(readSymbols())].filter(s=>typeof s==="string" && /^[A-Z][A-Z0-9.-]{0,11}$/.test(s));
    const currentOptions=[...symbolInput.options];
    if(currentOptions.length!==symbols.length || currentOptions.some((o,i)=>o.value!==symbols[i]))
      symbolInput.replaceChildren(...symbols.map(s=>new Option(s,s)));
    if(symbols.includes(prev)) symbolInput.value=prev;
    else {
      const preferred = symbols.find(s=>readStrategy(s)) || symbols.find(s=>!["VIX","CLMAIN","BZMAIN"].includes(s));
      if (preferred) symbolInput.value=preferred;
    }
    if(controller && prev===symbolInput.value && lastAccess===canLoadChart())return;
    const initial=!strategies.options.length;
    selectRules(prev===symbolInput.value?strategies.value:null);
    if(initial)period.value="y1";
    return changed();
  }
  get("run").addEventListener("click",e=>{e.preventDefault();review();});
  get("run-all").addEventListener("click",()=>review(true));
  get("form")?.addEventListener("submit",e=>{e.preventDefault();review();});
  symbolInput.addEventListener("change",()=>{selectRules(null);changed();});
  for (const control of [period,strategies])control.addEventListener("change",changed);
  login.addEventListener("click",()=>onSignIn());
  return {open,refreshRules(){selectRules(strategies.value);}};
}

function calculateWindows(bars,years,rule,signal,progress,seed){
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const worker=new Worker(new URL("./lab-backtest-worker.js?v=150",import.meta.url),{type:"module"});
    const finish=()=>{worker.terminate();signal.removeEventListener("abort",abort);};
    const abort=()=>{finish();reject(signal.reason);};
    signal.addEventListener("abort",abort,{once:true});
    worker.onmessage=({data})=>{
      if(data.progress){progress(data.progress);return;}
      finish();
      if(data.error)reject(Error(data.error));else resolve(data.results);
    };
    worker.onerror=()=>{finish();reject(Error("백테스트 계산을 완료하지 못했습니다."));};
    const {variants,...selected}=rule;
    worker.postMessage({bars,years,rule:selected,seed});
  });
}

const percent=value=>(value>0?"+":"")+(value*100).toFixed(2)+"%";
function medianProfit(rows) {
  const sorted=rows.map(row=>row.profit).sort((a,b)=>a-b);
  const mid=sorted.length/2;
  return (sorted[Math.floor(mid)]+sorted[Math.ceil(mid)-1])/2;
}
function renderWindows(groups,years,rule,symbol,bars,source){
  get("window-title").textContent=(rule.nickname || "저장 전략")+" · "+years+"년 백테스트";
  get("window-source").textContent=symbol+" · "+source+" · "+dateKey(bars[0][0]*1000)+" – "+dateKey(bars.at(-1)[0]*1000);
  const budget=Number(rule.allocation?.amount)||10000;
  const order=Number(rule.price)>0 ? "$"+rule.price+" 당일 지정가" : "시가 모의 체결";
  const qty=rule.allocation?"첫 회차 예산":Number(rule.quantity)>0?rule.quantity+"주":"가용 전량";
  get("model").textContent="각 구간에서 $"+budget.toLocaleString()+"로 독립 시작 · "+(rule.side==="buy"?"현금 시작":"첫날 시가에 보유 가능한 정수 주식으로 시작")+
    ". 첫 신호에 한 번 주문합니다 ("+qty+", "+order+"). "+
    (rule.preset==="firstTouch"?"일봉에서 터치 후보가 나온 다음 거래일에 주문합니다. ":"직전 완료 봉의 신호로 해당 거래일에 주문합니다. ")+
    "수익률과 최대낙폭은 종가 평가 기준이며 수수료·슬리피지·배당 현금흐름은 별도 반영하지 않습니다.";
  const root=get("window-groups");root.replaceChildren();
  for(const [key,title] of [["rolling","월별 슬라이딩"],["random","무작위 구간"]]){
    const rows=groups[key].filter(Boolean),section=document.createElement("section"),h=document.createElement("h3"),summary=document.createElement("p");
    section.className="lab-window-group";h.textContent=title+" · "+rows.length+"/"+windowsPerGroup;
    summary.className="lab-window-summary";
    if(rows.length){
      summary.textContent="중앙 수익률 "+percent(medianProfit(rows))+" · 체결 발생 "+rows.filter(r=>r.filled).length+"구간";
    }else summary.textContent="계산 가능한 구간이 없습니다.";
    section.append(h,summary);
    for(const [index,r] of rows.entries()){
      const item=document.createElement("div"),label=document.createElement("strong"),value=document.createElement("b"),detail=document.createElement("small");
      item.className="lab-window-row";
      const name=key==="random"?"표본 "+(index+1):r.offset?r.offset+"개월 전":"최근";
      label.textContent=name+" · "+r.start+" ~ "+r.end;
      value.textContent=percent(r.profit);value.toggleAttribute("data-negative",r.profit<0);
      detail.textContent="최대낙폭 "+percent(r.drawdown)+" · 단순보유 "+percent(r.benchmark)+" · "+
        (r.filled?r.filled+" "+r.qty+"주 체결":r.signalDay?"신호 발생 · 체결 없음":"신호 없음");
      item.append(label,value,detail);section.append(item);
    }
    root.append(section);
  }
}
