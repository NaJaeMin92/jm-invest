import {splitBudget} from "./split-budget.js?v=86";
import {factors, metrics, matches} from "./strategy.js?v=84";

const nyDate = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
const get=id=>document.getElementById("strategy-"+id);
const option=(value,label)=>new Option(label,value);
const shortName={day:"일봉",week:"주봉",month:"월봉"};

const draftFactors = {
  relativeStrength: "상대강도 · SOXX/QQQ",
  goldenCross: "골든크로스",
  anchoredVwap: "Anchored VWAP · 앵커 거래량가중평균가",
  volumeProfile: "Volume Profile · 매물대",
  marketBreadth: "Market Breadth · 시장 폭"
};
const isDraft=key=>Object.hasOwn(draftFactors,key);

export const strategyPrefix="jm-invest:strategy:v1:";

export function readStrategy(symbol) {
  try {
    const rule=JSON.parse(localStorage.getItem(strategyPrefix+symbol));
    return Array.isArray(rule?.conditions) ? rule : null;
  } catch { return null; }
}

function strategySummary(rule) {
  return [shortName[rule.frame], rule.side==="sell" ? "매도" : "매수",
    rule.allocation ? `$${rule.allocation.amount} · ${rule.allocation.units}분할` : `${rule.quantity}주`,
    "조건 "+rule.conditions.length+"개"].join(" · ");
}

function conditionLabel(c) {
  if(isDraft(c.key))return draftFactors[c.key];
  const name=factors[c.key]?.[0];
  if(!name)return "종료된 조건";
  return name.split(" · ")[0]+" "+(c.op==="gte" ? "≥" : "≤")+" "+c.value;
}

export function libraryDetails(rule) {
  const draft=rule.allocation || rule.conditions.some(c=>isDraft(c.key));
  const size=rule.allocation
    ? `$${Number(rule.allocation.amount).toLocaleString("en-US",{maximumFractionDigits:2})} · ${rule.allocation.units}분할`
    : `${rule.quantity}주`;
  const mode=draft ? "초안" : rule.mode==="live" ? "실계좌 지정가" : "신호 확인";
  return {
    conditions:rule.conditions.map(conditionLabel).join(rule.join==="any" ? " 또는 " : " 그리고 "),
    meta:[shortName[rule.frame],size,mode].join(" · ")
  };
}

export function setupStrategy({loadChart,orders,canLoadChart}) {
  const sheet=get("sheet"), form=get("form"), fields=get("fields"), list=get("conditions"), state=get("state");
  const f=form.elements;
  let symbol, run, sending=false;
  function add(c={key:"rsi",op:"lte",value:30}) {
    const row=document.createElement("div"), factor=document.createElement("select"), op=document.createElement("select");
    row.className="strategy-row";
    for (const [key,[name]] of Object.entries(factors)) factor.add(option(key,name));
    const group=document.createElement("optgroup");
    group.label="백테스트 후보";
    for (const [key,name] of Object.entries(draftFactors)) group.append(option(key,name));
    factor.append(group);
    factor.required=true;
    if (!Object.hasOwn(factors,c.key) && !isDraft(c.key)) {
      const missing=option("","대체 조건 선택");
      missing.disabled=true;
      factor.prepend(missing);
      state.textContent="사용이 종료된 조건을 교체하거나 삭제하세요.";
    }
    factor.value=(Object.hasOwn(factors,c.key) || isDraft(c.key)) ? c.key : ""; factor.setAttribute("aria-label","판단 요소");
    op.add(option("lte","이하 ≤")); op.add(option("gte","이상 ≥")); op.value=c.op; op.setAttribute("aria-label","비교");
    const input=document.createElement("input"); input.type="number"; input.step="any"; input.required=true;
    input.value=c.value ?? ""; input.setAttribute("aria-label","기준값"); function updateRow() {
      const draft=isDraft(factor.value);
      op.hidden=op.disabled=input.hidden=input.disabled=draft;
    }
    updateRow();
    factor.onchange=()=>{
      input.value=factors[factor.value]?.[1] ?? "";
      op.value="lte";
      updateRow();
      sync();
    };
    const remove=document.createElement("button"); remove.type="button"; remove.textContent="×";
    remove.setAttribute("aria-label","조건 삭제"); remove.onclick=()=>{row.remove();sync();};
    row.append(factor,op,input,remove); list.append(row);
  }
  function sync() {
    const buy=f.side.value==="buy";
    const split=buy && f.sizing.value==="split";
    get("sizing").hidden=!buy;
    f.sizing.disabled=!buy;
    get("quantity").hidden=f.quantity.disabled=split;
    get("budget").hidden=get("budget").disabled=!split;
    if(split) {
      const plan=splitBudget(f.budget.value,f.units.valueAsNumber,f.perBuy.valueAsNumber);
      const usd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"});
      get("allocation").textContent=plan ? ["총 "+plan.rounds+"회 매수", ...plan.ranges.map(r=>{
        const range=r.first===r.end ? r.first : r.first+"–"+r.end;
        return range+"회차 · "+r.size+"분할 · 회당 "+usd.format(r.cents/100);
      })].join("\n") : "총예산과 분할 수를 입력하세요. 각 분할에는 최소 1센트를 배정합니다.";
      f.perBuy.max=f.units.value;
    }
    const draft=split || Array.from(list.children).some(row=>isDraft(row.firstElementChild.value));
    if(draft) f.mode.value="signal";
    f.mode.disabled=draft;
    get("draft-note").hidden=!draft;
    get("watch-note").hidden=split;
    get("draft-note").textContent=split ? "여러 거래일에 걸쳐 사용할 계획입니다. 회차별 예산을 초안으로 저장합니다." : "백테스트 후보가 포함된 규칙은 초안으로 저장할 수 있습니다.";
    get("start").disabled=draft;
    get("save").textContent=draft ? "초안 저장" : "규칙 저장";
    const live=f.mode.value==="live";
    get("price").hidden=!live; f.price.required=live;
    get("start").textContent=live ? "실계좌 "+(f.side.value==="buy"?"매수":"매도")+" 1회 자동주문 시작" : "신호 감시 시작";
    fields.disabled=Boolean(run); get("save").disabled=Boolean(run);
    get("start").hidden=Boolean(run); get("stop").hidden=!run || sending;
    get("close").disabled=sending;
  }
  function rule() {
    if (!form.reportValidity()) return;
    const conditions=Array.from(list.children,row=>{
      const [factor,op,input]=row.children;
      return isDraft(factor.value) ? {key:factor.value} : {key:factor.value,op:op.value,value:input.valueAsNumber};
    });
    if (!conditions.length) {state.textContent="판단 조건을 하나 이상 추가하세요.";return;}
    if(f.mode.value==="live" && !/^\d{1,7}(\.\d{1,4})?$/.test(f.price.value)) {state.textContent="지정가 자릿수를 확인하세요.";return;}
    if(f.mode.value==="live" && Number(f.price.value)>=1 && (f.price.value.split(".")[1]||"").length>2) {state.textContent="$1 이상은 소수점 두 자리까지 입력하세요.";return;}
    let allocation;
    if(f.side.value==="buy" && f.sizing.value==="split"){
      allocation={amount:f.budget.value,units:f.units.valueAsNumber,perBuy:f.perBuy.valueAsNumber};
      if(!splitBudget(allocation.amount,allocation.units,allocation.perBuy)){
        state.textContent="총예산과 분할 수를 확인하세요.";return;
      }
    }
    return {allocation,symbol,frame:f.frame.value,join:f.join.value,side:f.side.value,quantity:f.quantity.value,price:f.price.value,mode:f.mode.value,conditions};
  }
  function showStock(symbol) {
    const rule=readStrategy(symbol);
    const panel=document.getElementById("stock-strategy-panel");
    panel.querySelector("h3").textContent=symbol+" 전략";
    panel.querySelector("p").textContent=rule ? strategySummary(rule) : "저장한 전략이 없습니다.";
    const conditions=panel.querySelector("ul");
    conditions.replaceChildren();
    for (const c of rule?.conditions || []) {
      const item=document.createElement("li");
      item.textContent=draftFactors[c.key] || [factors[c.key]?.[0] || c.key,c.op==="gte" ? "≥" : "≤",c.value].join(" ");
      conditions.append(item);
    }
    const edit=panel.querySelector("button");
    edit.textContent=rule ? "전략 편집" : "전략 만들기";
    edit.onclick=()=>open(symbol,panel);
  }
  function open(ticker,host=document.getElementById("tab-strategies")){
    if(sheet.open)return;
    if(sheet.parentElement!==host)host.append(sheet);
    symbol=ticker; form.reset(); list.replaceChildren(); state.textContent="";
    const saved=readStrategy(symbol);
    if(saved) for(const k of ["frame","join","side","quantity","price"]) f[k].value=saved[k];
    if(saved?.allocation){
      f.sizing.value="split";
      f.budget.value=saved.allocation.amount;
      f.units.value=saved.allocation.units;
      f.perBuy.value=saved.allocation.perBuy;
    }
    for(const c of saved?.conditions||[{key:"rsi",op:"lte",value:30}]) add(c);
    get("title").textContent=symbol+" 자동매매 설정"; sync(); sheet.showModal();
  }
  get("save").onclick=()=>{
    const r=rule(); if(!r) return;
    try {localStorage.setItem(strategyPrefix+symbol,JSON.stringify(r));state.textContent=r.allocation || r.conditions.some(c=>isDraft(c.key)) ? "초안을 저장했습니다." : "규칙을 저장했습니다.";}
    catch {state.textContent="이 브라우저에 저장하지 못했습니다.";}
  };
  f.sizing.onchange=sync; get("budget").oninput=sync;
  get("add").onclick=()=>add(); f.mode.onchange=sync; f.side.onchange=sync;
  function stop(message) {
    if(run){run.abort();run=null;}
    if(message) state.textContent=message;
    sync();
  }
  function close(){if(sheet.open && !sending){stop();sheet.close();}}
  get("close").onclick=close; get("stop").onclick=()=>stop("감시를 중지했습니다.");
  sheet.oncancel=e=>{if(sending)e.preventDefault();else stop();};
  sheet.onclose=()=>stop();
  document.addEventListener("visibilitychange",()=>{if(document.hidden && run && !sending)stop("화면을 벗어나 감시를 중지했습니다.");});
  async function check(r,ctrl) {
    const signal=ctrl.signal;
    const q=await loadChart(r.symbol,"day",null,signal);
    if(!q?.daily?.length || q.source) throw Error("키움 종목 일봉이 필요합니다.");
    if(nyDate.format(q.daily.at(-1)[0]*1000)!==nyDate.format(Date.now())) return "오늘 거래일의 첫 봉을 기다립니다.";
    const values=metrics(q.daily,r.frame);
    if(r.conditions.some(c=>c.key==="vix")){
      const v=await loadChart("VIX","day",null,signal);
      const age=Date.now()/1000-v?.asOf;
      if(age>=0 && age<=1800) values.vix=v.price;
    }
    if(r.conditions.some(c=>c.key==="fear")){
      const res=await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata",{signal,cache:"no-store"});
      if(!res.ok) throw Error("Fear & Greed 조회 실패");
      const {fear_and_greed:v}=await res.json(), age=Date.now()-Date.parse(v.timestamp);
      if(age>=0 && age<=86400000) values.fear=v.score;
    }
    signal.throwIfAborted();
    const detail=r.conditions.map(c=>factors[c.key][0]+" "+(Number.isFinite(values[c.key])?values[c.key].toFixed(2):"자료 부족")).join(" · ");
    if(!matches(r,values)) return detail;
    if(r.mode==="signal"){stop("조건 충족 · "+detail);return;}
    const ctx=await orders.stockContext(r.symbol);
    signal.throwIfAborted();
    if(!ctx?.enabled || ctx.symbol!==r.symbol)throw Error("종목과 실주문 연결을 확인하세요.");
    const preview=await orders.preview({symbol:r.symbol,exchange:ctx.exchange,quantity:r.quantity,price:r.price,side:r.side,kind:"00"});
    signal.throwIfAborted();
    sending=true;sync();state.textContent="키움 주문 접수 확인 중";
    try {
      const receipt=await orders.submit(preview.id);
      stop("주문 접수 · "+r.symbol+" · "+receipt.number);
    } catch(error){stop(error.message+" · 키움 주문내역을 확인하세요.");}
    finally{sending=false;sync();}
  }
  async function watch(r,ctrl) {
    while(!ctrl.signal.aborted){
      try{const message=await check(r,ctrl);if(message && !ctrl.signal.aborted)state.textContent=message;}
      catch(error){if(!ctrl.signal.aborted)stop(error.message);return;}
      if(ctrl.signal.aborted)return;
      await new Promise(resolve=>{
        const wake=()=>{clearTimeout(timer);ctrl.signal.removeEventListener("abort",wake);resolve();};
        const timer=setTimeout(wake,60000);ctrl.signal.addEventListener("abort",wake,{once:true});
      });
    }
  }
  form.onsubmit=e=>e.preventDefault();
  get("start").onclick=async ()=>{
    if(run)return;
    const r=rule();if(!r)return;
    if(r.allocation || r.conditions.some(c=>isDraft(c.key)))return;
    if(!canLoadChart()){state.textContent="시세 조회를 위해 계좌에 로그인하세요.";return;}
    if(r.mode==="live" && !["127.0.0.1","localhost"].includes(location.hostname)){state.textContent="실주문은 비공개 로컬 주문 서버에서 실행하세요.";return;}
    const ctrl=new AbortController();run=ctrl;sync();state.textContent=r.symbol+" · "+shortName[r.frame]+" · 조건 확인 중";
    try {
      if(r.mode==="live"){
        const status=await orders.status();
        if(run!==ctrl)return;
        if(!status.enabled)throw Error("실주문 서버를 실행한 뒤 다시 시작하세요.");
        await navigator.locks.request("jm-invest:auto-order",{ifAvailable:true},async lock=>{
          if(!lock)throw Error("다른 창에서 자동주문을 감시하고 있습니다.");
          await watch(r,ctrl);
        });
      } else await watch(r,ctrl);
    }catch(error){if(run===ctrl)stop(error.message);}
  };
  return {open,close,showStock};
}
