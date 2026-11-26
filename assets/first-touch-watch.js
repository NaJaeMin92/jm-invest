import {firstBuyQuantity, firstTouchDecision, firstTouchLevels} from "./first-touch.js?v=113";

const eastern = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
const dayOf = seconds => eastern.format(seconds * 1000);
export const touchRecordKey = symbol => "jm-invest:first-touch:last:" + symbol;

async function loadLevels(r, date, loadChart, signal) {
  const q = await loadChart(r.symbol, "day", null, signal);
  if (!q?.daily?.length || q.source) throw Error("키움 종목 일봉이 필요합니다.");
  const daily = new Map(q.daily.map(b => [b[0], b]));
  let cursor = q.before;
  while (cursor && daily.size < 400) {
    const page = await loadChart(r.symbol, "day", cursor, signal);
    for (const bar of page?.bars ?? []) daily.set(bar[0], bar);
    if (!page?.before || page.before >= cursor) break;
    cursor = page.before;
  }
  const closed = [...daily.values()].filter(b => dayOf(b[0]) < date).sort((a,b) => a[0]-b[0]);
  return firstTouchLevels(closed, Date.parse(date+"T12:00:00Z")/1000, r.touch);
}

export async function watchFirstTouch({r,ctrl,observe,loadChart,subscribeOrderBook,orders,report,submitting}) {
  const signal=ctrl.signal;
  while (!signal.aborted) {
    const date=eastern.format(Date.now()), levels=await loadLevels(r,date,loadChart,signal);
    signal.throwIfAborted();
    const lines=levels.lines.map(l => (l.kind==="long" ? "빗각 $" : "지지 $")+l.price.toFixed(2)).join(" · ");
    const readings=["day","week","month"].map(k => levels.rsi[k]?.toFixed(1) ?? "—").join(" / ");
    const context="RSI 일·주·월 "+readings;
    report((lines ? lines+" · 실시간 터치 대기" : "확정된 지지선 없음")+"\n"+context);
    let unsubscribe, finish, previous, lastTime=0;
    const event=new Promise(resolve=>{finish=resolve;});
    const abort=()=>finish(null);
    signal.addEventListener("abort",abort,{once:true});
    let trigger;
    try {
      unsubscribe=subscribeOrderBook(r.symbol,tick=>{
        if (signal.aborted || tick.symbol!==r.symbol || !Number.isFinite(tick.price) || tick.price<=0 ||
            !Number.isFinite(tick.tradedAt) || tick.snapshot || tick.book || tick.session==null) return;
        const now=Date.now()/1000;
        if (eastern.format(now*1000)!==date) {finish({rollover:true});return;}
        if (dayOf(tick.tradedAt)!==date || tick.tradedAt<lastTime || now-tick.tradedAt>15 || tick.tradedAt>now+1) return;
        const decision=firstTouchDecision(levels,r.touch,previous,tick.price);
        previous=tick.price; lastTime=tick.tradedAt;
        if (!decision) return;
        const message=(decision.action==="hold" ? "보류" : decision.action==="notify" ? "검토 알림" : "1차 매수 신호")+
          " · $"+tick.price+" · "+decision.reason+"\n"+context;
        try {localStorage.setItem(touchRecordKey(r.symbol),JSON.stringify({time:tick.tradedAt,message}));} catch {}
        report(message);
        if (decision.action==="buy") finish({message,time:tick.tradedAt});
      });
      trigger=await event;
    } finally {
      signal.removeEventListener("abort",abort);
      unsubscribe?.();
    }
    signal.throwIfAborted();
    if (trigger.rollover) continue;
    if (observe) return trigger.message;
    const ctx=await orders.stockContext(r.symbol);
    signal.throwIfAborted();
    if (!ctx?.enabled || ctx.symbol!==r.symbol) throw Error("종목과 실주문 연결을 확인하세요.");
    const quantity=firstBuyQuantity(r.allocation,r.price);
    if (quantity<1 || quantity>999999999) throw Error("1차 주문 수량을 확인하세요.");
    const preview=await orders.preview({symbol:r.symbol,exchange:ctx.exchange,quantity:String(quantity),price:r.price,side:"buy",kind:"00"});
    signal.throwIfAborted();
    if (Date.now()/1000-trigger.time>15) throw Error("신호가 지난 뒤 주문 준비가 끝나 감시를 중지했습니다.");
    submitting(true);
    try {
      const receipt=await orders.submit(preview.id);
      return trigger.message+"\n지정가 "+quantity+"주 접수 · "+receipt.number;
    } finally { submitting(false); }
  }
}
