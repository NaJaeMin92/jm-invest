import {splitBudget} from "./split-budget.js?v=86";
import {factors, metrics, matches} from "./strategy.js?v=84";
import {firstBuyQuantity} from "./first-touch.js?v=113";
import {touchRecordKey, watchFirstTouch} from "./first-touch-watch.js?v=113";

const presets = {
  firstTouch:{label:"전략 1", nickname:"겹지지 첫매수", side:"buy", conditions:[],
    touch:{rsiCeiling:60, tolerance:1, reactions:4, rally:20, drawdown:20, single:"notify"}},
  overheat:{label:"전략 2", nickname:"과열 분할매도", side:"sell",
    conditions:[{key:"rsi", op:"gte", value:70}, {key:"band", op:"gte", value:100}]},
  custom:{label:"직접 설정", nickname:"직접 설정", side:"buy", conditions:[{key:"rsi", op:"lte", value:30}]}
};
const touchRule = rule => rule.preset === "firstTouch";
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
const macroFactors = {
  cpiYoY: {label:"미국 CPI 전년 동월비",unit:"%"},
  pceYoY: {label:"미국 PCE 물가지수 전년 동월비",unit:"%"},
  fedTargetChangeBp: {label:"연준 목표금리 상단 변동 (직전 결정 대비)",unit:"bp"}
};
const isDraft=key=>Object.hasOwn(draftFactors,key) || Object.hasOwn(macroFactors,key);

export const strategyPrefix="jm-invest:strategy:v1:";

export function readStrategy(symbol) {
  try {
    const rule=JSON.parse(localStorage.getItem(strategyPrefix+symbol));
    return Array.isArray(rule?.conditions) ? rule : null;
  } catch { return null; }
}

function strategySummary(rule) {
  if (rule.preset) return [rule.nickname, shortName[rule.frame], rule.side==="sell" ? "매도" : "매수"].join(" · ");
  return [shortName[rule.frame], rule.side==="sell" ? "매도" : "매수",
    rule.allocation ? `$${rule.allocation.amount} · ${rule.allocation.units}분할` : `${rule.quantity}주`,
    "조건 "+rule.conditions.length+"개"].join(" · ");
}

function conditionLabel(c) {
  const macro=macroFactors[c.key];
  if(macro)return `${macro.label} ${c.op==="gte" ? "≥" : "≤"} ${c.value}${macro.unit}`;
  if(Object.hasOwn(draftFactors,c.key))return draftFactors[c.key];
  const name=factors[c.key]?.[0];
  if(!name)return "종료된 조건";
  return name.split(" · ")[0]+" "+(c.op==="gte" ? "≥" : "≤")+" "+c.value;
}

export function libraryDetails(rule) {
  const draft=rule.incomplete || (rule.allocation && !touchRule(rule)) || rule.conditions.some(c=>isDraft(c.key));
  const size=rule.side==="buy" && rule.incomplete && !rule.allocation ? "예산 미설정" : rule.allocation
    ? `$${Number(rule.allocation.amount).toLocaleString("en-US",{maximumFractionDigits:2})} · ${rule.allocation.units}분할`
    : `${rule.quantity}주`;
  const mode=draft ? "초안" : rule.mode==="live" && (rule.side==="sell" || touchRule(rule)) ? "실계좌 지정가" : "설정 확인";
  return {
    conditions:[rule.nickname, touchRule(rule) ? "장기 상승 빗각 · 수평 지지선" : rule.conditions.map(conditionLabel).join(rule.join==="any" ? " 또는 " : " 그리고 ")].filter(Boolean).join(" · "),
    frame:shortName[rule.frame],size,mode
  };
}

export function setupStrategy({loadChart,orders,canLoadChart,tickerIcon,subscribeOrderBook}) {
  const sheet=get("sheet"), form=get("form"), fields=get("fields"), list=get("conditions"), state=get("state");
  const f=form.elements;
  let symbol, run, sending=false;
  function setStage(stage) {
    sheet.dataset.stage=stage;
    get("signals").hidden=stage!=="conditions";
    get("orders").hidden=stage!=="orders";
    for(const button of sheet.querySelectorAll("[data-stage]")){
      button.setAttribute("aria-pressed",String(button.dataset.stage===stage));
    }
    form.scrollTop=0;
  }
  for(const button of sheet.querySelectorAll("[data-stage]"))button.onclick=()=>setStage(button.dataset.stage);
  get("next").onclick=()=>setStage("orders");
  function add(c={key:"rsi",op:"lte",value:30}) {
    const row=get("row-template").content.firstElementChild.cloneNode(true);
    const factor=row.querySelector(".condition-factor select"),op=row.querySelector(".condition-comparison select");
    const input=row.querySelector("input");
    for (const [key,[name]] of Object.entries(factors)) factor.add(option(key,name));
    const group=document.createElement("optgroup");
    group.label="백테스트 후보";
    for (const [key,name] of Object.entries(draftFactors)) group.append(option(key,name));
    factor.append(group);
    const macroGroup=document.createElement("optgroup");
    macroGroup.label="미국 경제지표 · 백테스트 후보";
    for(const [key,{label,unit}] of Object.entries(macroFactors))macroGroup.append(option(key,label+" ("+unit+")"));
    factor.append(macroGroup);
    factor.required=true;
    if (!Object.hasOwn(factors,c.key) && !isDraft(c.key)) {
      const missing=option("","대체 조건 선택");
      missing.disabled=true;
      factor.prepend(missing);
      state.textContent="사용이 종료된 조건을 교체하거나 삭제하세요.";
    }
    factor.value=(Object.hasOwn(factors,c.key) || isDraft(c.key)) ? c.key : ""; factor.setAttribute("aria-label","판단 요소");
    op.value=c.op || "lte";
    input.value=c.value ?? "";
    function updateRow() {
      const numeric=!Object.hasOwn(draftFactors,factor.value);
      op.parentElement.hidden=op.disabled=input.parentElement.hidden=input.disabled=!numeric;
      const unit=macroFactors[factor.value]?.unit;
      row.querySelector(".condition-limit span").textContent=unit ? `기준값 (${unit})` : "기준값";
    }
    updateRow();
    factor.onchange=()=>{
      input.value=factors[factor.value]?.[1] ?? "";
      op.value="lte";
      updateRow();
      sync();
    };
    row.querySelector("button").onclick=()=>{row.remove();sync();};
    list.append(row);

  }
  function sync() {
    get("condition-count").textContent="조건 "+list.children.length+"개";
    get("join").hidden=list.children.length<2;
    const touch=f.preset.value==="firstTouch";
    get("custom").disabled=get("custom").hidden=touch;
    get("touch").disabled=get("touch").hidden=!touch;
    get("direction").disabled=get("direction").hidden=touch;
    const buy=touch || f.side.value==="buy";
    get("quantity").hidden=f.quantity.disabled=buy;
    get("budget").hidden=get("budget").disabled=!buy;
    if(buy) {
      const plan=splitBudget(f.budget.value,f.units.valueAsNumber,f.perBuy.valueAsNumber);
      const usd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"});
      get("allocation").textContent=plan ? ["총 "+plan.rounds+"회 매수", ...plan.ranges.map(r=>{
        const range=r.first===r.end ? r.first : r.first+"–"+r.end;
        return range+"회차 · "+r.size+"분할 · 회당 "+usd.format(r.cents/100);
      })].join("\n") : "총예산과 분할 수를 입력하세요. 각 분할에는 최소 1센트를 배정합니다.";
      f.perBuy.max=f.units.value;
    }
    const draft=!touch && (buy || Array.from(list.children).some(row=>isDraft(row.querySelector(".condition-factor select").value)));
    get("draft-note").hidden=!draft;
    get("watch-note").hidden=draft;
    get("watch-note").textContent=touch ? "기업 악재 여부는 직접 확인한 뒤 시작하세요. 창이 열린 동안 실시간 체결가를 감시하고 첫 신호에 지정가 주문을 한 번 접수합니다." : "이 창이 열려 있는 동안 직전 완료 봉을 기준으로 1분마다 확인합니다. 조건을 충족하면 한 번 실행합니다.";
    get("observe").hidden=!touch || Boolean(run);
    get("draft-note").textContent=buy ? "분할 예산은 초안으로 저장합니다." : "백테스트 후보가 포함된 규칙은 초안으로 저장합니다.";
    get("start").disabled=draft;
    get("save").textContent=draft ? "초안 저장" : "규칙 저장";
    f.price.required=!draft;
    get("start").textContent="실계좌 "+(buy ? "매수" : "매도")+" 1회 자동주문 시작";
    fields.disabled=Boolean(run); get("save").disabled=Boolean(run);
    get("start").hidden=Boolean(run); get("stop").hidden=!run || sending;
    get("close").disabled=sending;
  }
  function rule(purpose="start") {
    const preset=f.preset.value, touch=preset==="firstTouch";
    const optionalOrder=purpose==="observe" || (purpose==="save" && preset!=="custom");
    const invalid=[...form.querySelectorAll("input:invalid,select:invalid")].find(el=>
      !optionalOrder || !get("orders").contains(el) || (purpose==="save" && el.value!==""));
    if(invalid){
      setStage(get("signals").contains(invalid) ? "conditions" : "orders");
      invalid.reportValidity();
      return;
    }
    const conditions=touch ? [] : Array.from(list.children,row=>{
      const [factor,op]=row.querySelectorAll("select");
      const input=row.querySelector("input");
      return input.disabled ? {key:factor.value} : {key:factor.value,op:op.value,value:input.valueAsNumber};
    });
    if (!touch && !conditions.length) {state.textContent="판단 조건을 하나 이상 추가하세요.";return;}
    if(f.price.value && !/^\d{1,7}(\.\d{1,4})?$/.test(f.price.value)) {state.textContent="지정가 자릿수를 확인하세요.";return;}
    if(Number(f.price.value)>=1 && (f.price.value.split(".")[1]||"").length>2) {state.textContent="$1 이상은 소수점 두 자리까지 입력하세요.";return;}
    let allocation;
    if(f.side.value==="buy" && purpose!=="observe" && (!optionalOrder || f.budget.value)){
      allocation={amount:f.budget.value,units:f.units.valueAsNumber,perBuy:f.perBuy.valueAsNumber};
      if(!splitBudget(allocation.amount,allocation.units,allocation.perBuy)){
        state.textContent="총예산과 분할 수를 확인하세요.";return;
      }
    }
    const settings=touch ? {rsiCeiling:f.rsiCeiling.valueAsNumber, tolerance:f.tolerance.valueAsNumber, reactions:f.reactions.valueAsNumber,
      drawdown:f.drawdown.valueAsNumber, rally:f.rally.valueAsNumber, single:f.single.value} : undefined;
    if(touch && !optionalOrder && !(firstBuyQuantity(allocation, f.price.value) >= 1)){
      state.textContent="1차 예산으로 지정가 1주 이상을 매수할 수 있어야 합니다.";return;
    }
    const incomplete=preset!=="custom" && (!f.price.value || (f.side.value==="buy" && !allocation));
    return {preset,nickname:f.nickname.value.trim() || presets[preset].nickname, touch:settings,incomplete,allocation,symbol,frame:touch ? "day" : f.frame.value,join:f.join.value,side:f.side.value,quantity:allocation ? undefined : f.quantity.value,price:f.price.value,mode:"live",conditions};
  }
  function showStock(symbol) {
    const rule=readStrategy(symbol);
    const panel=document.getElementById("stock-strategy-panel");
    panel.querySelector("h3").textContent=symbol+" 전략";
    panel.querySelector("p").textContent=rule ? strategySummary(rule) : "저장한 전략이 없습니다.";
    const conditions=panel.querySelector("ul");
    conditions.replaceChildren();
    if(rule && touchRule(rule)){
      const item=document.createElement("li");
      item.textContent="두 선 겹침 시 1차 매수 · 한 선만 닿으면 "+(rule.touch.single==="buy" ? "조건부 매수" : "알림");
      conditions.append(item);
    }
    for (const c of rule?.conditions || []) {
      const item=document.createElement("li");
      item.textContent=Object.hasOwn(factors,c.key) ? [factors[c.key][0],c.op==="gte" ? "≥" : "≤",c.value].join(" ") : conditionLabel(c);
      conditions.append(item);
    }
    const edit=panel.querySelector("button");
    edit.textContent=rule ? "전략 편집" : "전략 만들기";
    edit.onclick=()=>open(symbol,panel);
  }
  function open(ticker,host=document.getElementById("tab-strategies")){
    if(sheet.open)return;
    if(sheet.parentElement!==host)host.append(sheet);
    symbol=ticker; state.textContent="";
    const active=readStrategy(symbol);
    const key=active?.preset || (active ? "custom" : "firstTouch");
    loadPreset(key,active);
    get("title").textContent=symbol;
    get("logo").replaceChildren(tickerIcon(symbol));
    setStage("conditions"); sheet.showModal();
  }
  function loadPreset(key,saved) {
    const base=presets[key];
    form.reset(); list.replaceChildren();
    f.preset.value=key; f.nickname.value=saved?.nickname ?? base.nickname;
    const variants=readStrategy(symbol)?.variants;
    for(const [value,option] of Object.entries(presets)){
      const name=(variants?.[value]?.nickname || option.nickname);
      f.preset.querySelector('[value="'+value+'"]').textContent=value==="custom" && name===option.label ? name : option.label+" · "+name;
    }
    f.side.value=saved?.side || base.side;
    for(const k of ["frame","join","quantity","price"]) if(saved?.[k]!=null)f[k].value=saved[k];
    if(saved?.mode==="signal" && !saved.allocation)f.price.value="";
    if(saved?.allocation){
      f.budget.value=saved.allocation.amount; f.units.value=saved.allocation.units; f.perBuy.value=saved.allocation.perBuy;
    }
    if(key==="firstTouch"){
      for(const [k,v] of Object.entries({...base.touch,...saved?.touch}))f[k].value=v;
      try {
        const last=JSON.parse(localStorage.getItem(touchRecordKey(symbol)));
        if(last)state.textContent="최근 신호 · "+new Date(last.time*1000).toLocaleString()+"\n"+last.message;
      } catch {}
    }
    for(const c of saved?.conditions || base.conditions)add(c);
    sync();
  }
  f.preset.onchange=()=>{
    const key=f.preset.value, active=readStrategy(symbol);
    const saved=(active?.preset || "custom")===key ? active : active?.variants?.[key];
    state.textContent="";loadPreset(key,saved);
  };
  get("save").onclick=()=>{
    const r=rule("save"); if(!r) return;
    try {
      const previous=readStrategy(symbol), variants={...previous?.variants};
      if(previous){const {variants:ignored,...old}=previous; variants[old.preset || "custom"]=old;}
      variants[r.preset]=r;
      localStorage.setItem(strategyPrefix+symbol,JSON.stringify({...r,variants}));
      const label=presets[r.preset].label;
      f.preset.selectedOptions[0].textContent=label===r.nickname ? label : label+" · "+r.nickname;
      state.textContent="저장했습니다 · "+r.nickname;
    } catch {state.textContent="이 브라우저에 저장하지 못했습니다.";}
  };
  get("budget").oninput=sync;
  get("add").onclick=()=>{add();sync();list.lastElementChild.querySelector("select").focus();};
  for(const radio of form.querySelectorAll('[name="side"]'))radio.onchange=sync;
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
  get("start").onclick=()=>start(false);
  get("observe").onclick=()=>start(true);
  async function start(observe){
    if(run)return;
    const r=rule(observe ? "observe" : "start");if(!r)return;
    if((r.allocation && !touchRule(r)) || r.conditions.some(c=>isDraft(c.key)))return;
    if(!canLoadChart()){state.textContent="시세 조회를 위해 계좌에 로그인하세요.";return;}
    if(!observe && !["127.0.0.1","localhost"].includes(location.hostname)){state.textContent="실주문은 비공개 로컬 주문 서버에서 실행하세요.";return;}
    const ctrl=new AbortController();run=ctrl;sync();state.textContent=r.symbol+" · "+shortName[r.frame]+" · 조건 확인 중";
    try {
      const monitor=()=>watchFirstTouch({r,ctrl,observe,loadChart,subscribeOrderBook,orders,
        report:message=>{if(run===ctrl)state.textContent=message;},
        submitting:value=>{sending=value;sync();}});
      if(observe){const result=await monitor();if(run===ctrl)stop(result);return;}
      const status=await orders.status();
      if(run!==ctrl)return;
      if(!status.enabled)throw Error("실주문 서버를 실행한 뒤 다시 시작하세요.");
      await navigator.locks.request("jm-invest:auto-order",{ifAvailable:true},async lock=>{
        if(!lock)throw Error("다른 창에서 자동주문을 감시하고 있습니다.");
        if(ctrl.signal.aborted)return;
        if(touchRule(r)){
          const result=await monitor();
          if(run===ctrl)stop(result);
        }else await watch(r,ctrl);
      });
    }catch(error){if(run===ctrl)stop(error.message);}
  };
  return {open,close,showStock};
}
