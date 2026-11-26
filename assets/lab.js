import {publicQuote} from "../instrument.js?v=112";
import {metrics, matches, factors} from "./strategy.js?v=84";
import {firstTouchLevels, firstTouchDecision} from "./first-touch.js?v=113";

const dayMs = 86400000;
const nyDay = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"});
const dateKey = ms => new Date(ms).toISOString().slice(0, 10);
const get = id => document.getElementById("lab-" + id);
const example = {nickname:"예시 · RSI 30 이하", side:"buy", frame:"day", join:"all",
  conditions:[{key:"rsi",op:"lte",value:30}]};

export function executionWindows(first, last) {
  const ranges = [];
  const end = Date.parse(last);
  for (let from = Date.parse(first); from <= end; from += 84 * dayMs) {
    ranges.push([dateKey(from), dateKey(Math.min(end, from + 83 * dayMs))]);
  }
  return ranges;
}

// OHLC shows the price range touched during a session, but not the exact order of ticks.
export function touchCandidate(levels, settings, bar) {
  const opening = bar[1], low = bar[3];
  const points = [low, opening];
  for (const line of levels.lines) {
    for (const edge of [-1, 0, 1]) {
      const price = line.price * (1 + edge * settings.tolerance / 100);
      if (price >= low && price <= opening) points.push(price);
    }
  }
  points.sort((a, b) => b - a);
  let notice;
  for (let i = 1; i < points.length; i++) {
    for (const price of [(points[i-1] + points[i]) / 2, points[i]]) {
      const decision = firstTouchDecision(levels, settings, opening, price);
      if (decision?.action === "buy") return {side:"buy", label:"매수 후보", detail:decision.reason};
      if (decision?.action === "notify") notice = {side:null, label:"검토 후보", detail:decision.reason};
    }
  }
  return notice;
}

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

async function loadBars(symbol, needed, loadChart, canRead, signal) {
  const today = nyDay.format(new Date());
  const bars = new Map();
  const merge = rows => {
    for (const bar of rows || []) {
      if (Array.isArray(bar) && bar.slice(0,5).every(Number.isFinite) && bar[4]>0 && dateKey(bar[0]*1000)<today) bars.set(bar[0],bar);
    }
  };
  let source, issue;
  if (canRead) {
    try {
      const first = await loadChart(symbol, "day", null, signal);
      merge(first?.daily);
      source = first?.source || "키움";
      let before = first?.before;
      while (before && bars.size < needed) {
        const page = await loadChart(symbol, "day", before, signal);
        merge(page?.bars);
        if (!page?.before || page.before >= before) break;
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
  let controller, lastAccess;

  async function review() {
    controller?.abort();
    const task = new AbortController(), {signal}=task;
    controller=task;
    const symbol=symbolInput.value;
    result.hidden=true;
    if (!symbol) {status.textContent="관심종목에 종목을 추가하세요.";return;}
    const count=Number(period.value);
    const canRead=canLoadChart(), rule=readStrategy(symbol) ?? example, issue=replayIssue(rule);
    lastAccess = canRead;
    login.hidden=canRead;
    status.textContent="일봉을 불러오는 중…";
    try {
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
    return review();
  }
  get("run").addEventListener("click",e=>{e.preventDefault();review();});
  get("form")?.addEventListener("submit",e=>{e.preventDefault();review();});
  for (const control of [period,symbolInput])control.addEventListener("change",review);
  login.addEventListener("click",()=>onSignIn());
  return {open,close(){controller?.abort();controller=null; result.hidden=true; get("events").replaceChildren();}};
}
