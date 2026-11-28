import {savedTime} from "./device-cache.js?v=162";
const kst = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit"});
const clock = new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul", hourCycle:"h23", hour:"2-digit", minute:"2-digit"});
const monthTitle = new Intl.DateTimeFormat("ko-KR", {timeZone:"UTC", year:"numeric", month:"long"});
const longDay = new Intl.DateTimeFormat("ko-KR", {timeZone:"UTC", month:"long", day:"numeric", weekday:"short"});
const macroNames = {CPI:"미국 소비자물가지수", PCE:"미국 개인소비지출 물가지수", FOMC:"미 연준 금리 결정", GDP:"미국 국내총생산"};
const rawBranch = "https://raw.githubusercontent.com/NaJaeMin92/jm-invest/market-data/";
const pad = n => String(n).padStart(2,"0");
const utcDay = day => new Date(day + "T12:00:00Z");
const shortDay = day => day.slice(5).replace("-", "/");
const symbolKey = value => String(value).trim().toUpperCase().replaceAll(".", "-");

function node(tag, text, name) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (name) el.className = name;
  return el;
}

function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(+utcDay(value)) && utcDay(value).toISOString().startsWith(value);
}

// Date-only US events can span two Korean dates; no arbitrary release hour is assigned.
export function calendarWhen(event) {
  if (typeof event.at === "string" && /(?:Z|[+-]\d\d:\d\d)$/i.test(event.at)) {
    const instant = new Date(event.at);
    if (Number.isFinite(+instant)) {
      const day = kst.format(instant);
      return {first:day, last:day, time:clock.format(instant), sort:+instant, exact:true};
    }
  }
  if (!validDay(event.date)) return null;
  const day = event.date;
  const next = new Date(+utcDay(day) + 86400000).toISOString().slice(0,10);
  if (event.timing === "before") return {first:day, last:day, time:"미국 장전", exact:false};
  if (event.timing === "after") return {first:next, last:next, time:"미국 장후", exact:false};
  return {first:day, last:next, time:"시각 미정", exact:false};
}

export function personalEarnings(events, watchlist, holdings) {
  const watch = new Set(Array.from(watchlist, symbolKey));
  const held = new Set(Array.from(holdings, symbolKey));
  const seen = new Set();
  return events.flatMap(event => {
    const symbol = symbolKey(event.symbol ?? "");
    if (!symbol || (!watch.has(symbol) && !held.has(symbol))) return [];
    const when = calendarWhen(event);
    const key = symbol + "/" + (event.date || when?.first);
    if (!when || seen.has(key)) return [];
    seen.add(key);
    const owner = [held.has(symbol) && "보유", watch.has(symbol) && "관심"].filter(Boolean).join(" · ");
    return [{...event, when, kind:"earnings", title:symbol+" 실적 발표", detail:owner}];
  });
}

async function feed(url) {
  const response = await fetch(url,{cache:"no-cache",signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw Error("Calendar feed unavailable");
  const data = await response.json();
  if (!Array.isArray(data?.events) || !Number.isFinite(Date.parse(data.updatedAt))) throw Error("Invalid calendar feed");
  return data;
}

export function setupCalendar({getWatchlist, getHoldings, deviceCache}) {
  const get = id => document.getElementById("calendar-"+id);
  const grid = get("grid"), agenda = get("agenda"), filters = get("filters");
  const data = {macro:null, earnings:null};
  const failed = new Set(), restored = new Set();
  let month = kst.format(Date.now()).slice(0,7), selected = null, filter = "all", upcoming = true;
  let request = null, checked = 0;

  function currentEvents() {
    const macro = (data.macro?.events ?? []).flatMap(event => {
      const when = calendarWhen(event);
      if (!when || !macroNames[event.series]) return [];
      return [{...event, when, kind:"macro", title:event.series+" · "+macroNames[event.series], detail:"경제지표"}];
    });
    const earnings = personalEarnings(data.earnings?.events ?? [], getWatchlist(), getHoldings());
    return [...macro,...earnings].filter(e=>filter==="all" || filter===e.kind).sort((a,b)=>
      a.when.first.localeCompare(b.when.first) || (a.when.sort ?? Infinity) - (b.when.sort ?? Infinity) ||
      a.title.localeCompare(b.title));
  }

  function eventRow(event) {
    const li=node("li",null,"calendar-event"), time=node("time"), body=node("div");
    li.dataset.kind=event.kind;
    const {first,last,exact}=event.when;
    time.dateTime=exact ? event.at : first;
    time.append(node("span",first===last ? shortDay(first) : shortDay(first)+"–"+shortDay(last)), node("small",event.when.time));
    body.append(node("strong",event.title),node("small",[event.detail, event.estimated ? (event.kind==="macro" ? "잠정 일정" : "추정") : null,
      event.kind==="earnings" && !exact && first===last ? "시각 미정" : null].filter(Boolean).join(" · ")));
    li.append(time,body);
    if (event.url && /^https:\/\//i.test(event.url)) {
      const link=node("a",event.source || "출처");
      link.href=event.url;link.target="_blank";link.rel="noopener noreferrer";
      link.setAttribute("aria-label",event.title+" 출처 · "+link.textContent);
      li.append(link);
    }
    return li;
  }

  function render() {
    const today=kst.format(Date.now()), start=utcDay(month+"-01");
    const all=currentEvents(), byDay=new Map();
    for(const e of all)for(const day of new Set([e.when.first,e.when.last])){
      if (!byDay.has(day)) byDay.set(day,[]);
      byDay.get(day).push(e);
    }
    get("month").textContent=monthTitle.format(start);
    for (const button of filters.querySelectorAll("[data-filter]"))
      button.setAttribute("aria-pressed", String(button.dataset.filter===filter));
    const cells=[];
    for(let i=0;i<start.getUTCDay();i++) cells.push(node("span"));
    const length=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
    for(let d=1;d<=length;d++){
      const day=month+"-"+pad(d), events=byDay.get(day)??[];
      const button=node("button",null,"calendar-day");button.type="button";button.dataset.date=day;
      button.append(node("span",String(d)));
      button.setAttribute("aria-pressed",String(day===selected));
      if(day===today)button.setAttribute("aria-current","date");
      button.setAttribute("aria-label",longDay.format(utcDay(day))+(events.length?" · 일정 "+events.length+"개":""));
      const dots=node("span",null,"calendar-dots");dots.setAttribute("aria-hidden","true");
      for(const kind of new Set(events.map(e=>e.kind))){const dot=node("i"); dot.dataset.kind=kind; dots.append(dot);}
      button.append(dots);cells.push(button);
    }
    const focused=grid.contains(document.activeElement) ? document.activeElement.dataset.date : null;
    grid.replaceChildren(...cells);
    if(focused)grid.querySelector('[data-date="'+focused+'"]')?.focus({preventScroll:true});
    const events=selected ? byDay.get(selected)??[] : upcoming ?
      all.filter(e=>e.when.last>=today).slice(0,24) :
      all.filter(e=>e.when.first.slice(0,7)<=month && e.when.last.slice(0,7)>=month);
    get("agenda-title").textContent=selected ? longDay.format(utcDay(selected)) : upcoming ? "다가오는 일정" : start.getUTCMonth()+1+"월 일정";
    agenda.replaceChildren(...events.map(eventRow));
    if(!events.length){
      const message=request && !data.macro && !data.earnings ? "일정을 불러오는 중…" :
        selected ? "선택한 날짜에 공개된 일정이 없습니다." : "이 조건에 공개된 일정이 없습니다.";
      agenda.append(node("li",message,"calendar-empty"));
    }
    const messages=[];
    for(const kind of ["macro","earnings"]){
      if(filter!=="all" && kind!==filter)continue;
      const name=kind==="macro"?"경제지표":"실적", snapshot=data[kind];
      if(!snapshot){if(failed.has(kind))messages.push(name+" 일정 조회 실패"); continue;}
      if(kind==="earnings" && snapshot.coverage?.from && snapshot.coverage?.through)
        messages.push("실적 제공 기간 "+shortDay(snapshot.coverage.from)+"–"+shortDay(snapshot.coverage.through)+" (미국 날짜)");
      if(restored.has(kind)) messages.push(name+" 저장 일정 · "+savedTime(Date.parse(snapshot.updatedAt)));
      const oldest=kind==="macro" ? Math.min(...events.filter(e=>e.kind==="macro" && e.checkedAt).map(e=>Date.parse(e.checkedAt)), Date.parse(snapshot.updatedAt)) : Date.parse(snapshot.lastSuccessfulAt || snapshot.updatedAt);
      if (Date.now()-oldest>7*86400000 || failed.has(kind)) messages.push(name+" 일정 확인일 "+kst.format(oldest));
    }
    get("status").textContent=messages.join(" · ");
  }

  function move(n) {
    const t=utcDay(month+"-01");t.setUTCMonth(t.getUTCMonth()+n);
    month=t.toISOString().slice(0,7);selected=null;upcoming=false;render();
  }
  get("prev").onclick=()=>move(-1);get("next").onclick=()=>move(1);
  get("today").onclick=()=>{month=kst.format(Date.now()).slice(0,7); selected=null;upcoming=true;render();};
  filters.addEventListener("click",event=>{
    const button=event.target.closest("[data-filter]");if(button){filter=button.dataset.filter;render();}
  });
  grid.addEventListener("click",event=>{
    const day=event.target.closest("[data-date]")?.dataset.date;
    if(day){selected=day===selected?null:day;upcoming=false;render();}
  });

  function refresh() {
    render();
    if(request || Date.now()-checked<15*60000)return request;
    const work=["macro","earnings"].map(async kind=>{
      if (!data[kind]) {
        const saved=await deviceCache.read("calendar/"+kind,true);
        if (saved?.events) {data[kind]=saved;restored.add(kind);render();}
      }
      const name="calendar-"+kind+".json";
      const local=new URL("./market/"+name,import.meta.url);
      const results=await Promise.allSettled([local, rawBranch+name].map(async url=>{
        const result=await feed(url);
        if(!data[kind] || Date.parse(result.updatedAt)>=Date.parse(data[kind].updatedAt)){
          data[kind]=result;
          restored.delete(kind);
          void deviceCache.write("calendar/"+kind,result,true);
          render();
        }
      }));
      if(results.every(r=>r.status==="rejected"))failed.add(kind);else failed.delete(kind);
    });
    request=Promise.all(work).finally(()=>{checked=Date.now();request=null;render();});
    render();
    return request;
  }
  return {refresh};
}
