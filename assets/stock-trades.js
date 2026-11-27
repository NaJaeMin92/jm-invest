const dayMs = 86_400_000;
const easternDay = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"});
const easternTime = new Intl.DateTimeFormat("ko-KR", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hourCycle:"h23"});
const dollars = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD", maximumFractionDigits:4});
const shares = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:8});
const isoDay = value => new Date(value).toISOString().slice(0,10);

export function setupStockTrades({loadExecutions,canLoadChart,onSignIn,onShowChart,onShowTrades}) {
  const get = id => document.getElementById(id);
  const panel=get("stock-trades"), list=get("stock-trades-list"), status=get("stock-trades-status");
  const chart=get("chart-panel"), chartButton=get("stock-chart-view"), tradesButton=get("stock-trades-view");
  const more=get("stock-trades-more");
  let symbol, cursor, request, loaded;

  function show(trades) {
    chart.hidden=trades;
    panel.hidden=!trades;
    chartButton.setAttribute("aria-pressed",String(!trades));
    tradesButton.setAttribute("aria-pressed",String(trades));
  }

  async function load() {
    if(request || !symbol) return;
    if(!canLoadChart()){
      status.textContent="계좌에 로그인하면 체결 내역을 볼 수 있습니다.";
      more.textContent="계좌 로그인";
      more.hidden=false;
      return;
    }
    const controller=new AbortController();
    request=controller;
    const end=cursor;
    const start=end-29*dayMs;
    status.textContent="체결 내역 불러오는 중…";
    more.hidden=true;
    try {
      const records=await loadExecutions(symbol,isoDay(start),isoDay(end),controller.signal);
      if(request!==controller) return;
      if(!Array.isArray(records)) throw Error("조회 결과를 읽을 수 없습니다.");
      for(const record of records.slice().sort((a,b)=>b.day.localeCompare(a.day)||(b.time??0)-(a.time??0))){
        const row=document.createElement("li");
        const trade=document.createElement("span"), amount=document.createElement("span");
        const side=document.createElement("strong"), date=document.createElement("small");
        const price=document.createElement("strong"), quantity=document.createElement("small");
        side.dataset.side=record.side;
        side.textContent=record.side==="buy"?"매수":"매도";
        date.textContent=record.day+(Number.isFinite(record.time)?" · "+easternTime.format(record.time*1000):"");
        price.textContent=dollars.format(record.price);
        quantity.textContent=shares.format(record.quantity)+"주";
        trade.append(side,date);
        amount.append(price,quantity);
        row.append(trade,amount);
        list.append(row);
      }
      cursor=start-dayMs;
      loaded=true;
      status.textContent=records.length?"":isoDay(start)+" ~ "+isoDay(end)+" 체결 내역 없음";
      more.textContent="이전 30일 보기";
    } catch {
      if(request!==controller) return;
      status.textContent="체결 내역을 불러오지 못했습니다.";
      more.textContent="다시 시도";
    } finally {
      if(request===controller){
        request=undefined;
        more.hidden=false;
      }
    }
  }

  chartButton.onclick=()=>{
    show(false);
    onShowChart();
  };
  tradesButton.onclick=()=>{
    if(!panel.hidden) return;
    onShowTrades();
    show(true);
    if(!loaded) load();
  };
  more.onclick=()=>canLoadChart()?load():onSignIn();

  return {
    reset(next) {
      request?.abort();
      request=undefined;
      symbol=next;
      cursor=Date.parse(easternDay.format(new Date()))+dayMs;
      loaded=false;
      list.replaceChildren();
      status.textContent="";
      more.hidden=true;
      get("stock-trades-title").textContent=next?next+" 체결":"";
      show(false);
    }
  };
}
