const dayMs = 86400000;
const blockDays = 84;
const barSeconds = {minute:60, five:300, hour:3600};
const nyDate = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"});
const nyTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit",
  hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
});
const dollars = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD", maximumFractionDigits:4});
const dateString = day => new Date(day * dayMs).toISOString().slice(0,10);
const blockOf = day => Math.floor(day / blockDays);

function period(day, frame) {
  const date = new Date(day * dayMs);
  if (frame === "week") return day - (date.getUTCDay() + 6) % 7;
  if (frame === "month" || frame === "quarter") {
    const month = date.getUTCMonth();
    return Date.UTC(date.getUTCFullYear(), frame === "quarter" ? month - month % 3 : month, 1) / dayMs;
  }
  return day;
}

function viewRange(bars, frame, start, end) {
  const today = Math.floor(Date.now() / dayMs) + 1;
  if (barSeconds[frame]) {
    // Overnight US trades can belong to the following Kiwoom session date.
    const day = index => Date.parse(nyDate.format(bars[index][0] * 1000)) / dayMs;
    return [day(start), Math.min(today, day(end) + 1)];
  }
  const day = index => Math.floor(bars[index][0] / 86400);
  const first = period(day(start), frame), last = period(day(end), frame);
  const date = new Date(last * dayMs);
  if (frame === "month" || frame === "quarter") date.setUTCMonth(date.getUTCMonth() + (frame === "month" ? 1 : 3));
  else date.setUTCDate(date.getUTCDate() + (frame === "week" ? 7 : 1));
  return [first, Math.min(today, date.getTime() / dayMs - 1)];
}

function intradayIndex(bars, start, end, time, duration) {
  if (!Number.isFinite(time)) return -1;
  let left = start, right = end + 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (bars[mid][0] <= time) left = mid + 1;
    else right = mid;
  }
  const index = left - 1;
  return index >= start && time < bars[index][0] + duration ? index : -1;
}

export function executionGroups(view, records) {
  if (!records.length) return [];
  const {bars,frame,start,end} = view, duration = barSeconds[frame];
  const indices = new Map(), groups = new Map();
  if (!duration) {
    for (let i = start; i <= end; i++) indices.set(period(Math.floor(bars[i][0] / 86400), frame), i);
  }
  for (const record of records) {
    const index = duration ? intradayIndex(bars,start,end,record.time,duration) : indices.get(period(Date.parse(record.day) / dayMs,frame));
    if (index == null || index < 0) continue;
    const key = index + "/" + record.side;
    if (!groups.has(key)) groups.set(key,{index,side:record.side,records:[]});
    const group = groups.get(key);
    group.records.push(record);
  }
  return [...groups.values()];
}

export function setupExecutionFlags(load) {
  const layer = document.getElementById("execution-flags"), retry = document.getElementById("execution-retry");
  const dialog = document.getElementById("execution-detail"), list = document.getElementById("execution-list");
  const blocks = new Map();
  let view, range, symbol, controller, timer, failed = false;
  document.getElementById("execution-close").onclick = () => dialog.close();
  dialog.addEventListener("cancel",event=>event.stopPropagation());

  function details(group) {
    if (dialog.open) return;
    document.getElementById("execution-title").textContent = symbol + " 체결 내역";
    const items = [...group.records].sort((a,b) => b.day.localeCompare(a.day) || (b.time || 0) - (a.time || 0)).map(record=>{
      const li = document.createElement("li"), side = document.createElement("strong");
      const value = document.createElement("b"), when = document.createElement("time");
      side.dataset.side = record.side;
      side.textContent = record.side === "buy" ? "Buy" : "Sell";
      value.textContent = record.quantity.toLocaleString("ko-KR",{maximumFractionDigits:8}) + "주 · " + dollars.format(record.price);
      when.textContent = record.time == null ? record.day + " 거래일" : nyTime.format(record.time * 1000) + " ET";
      when.dateTime = record.time == null ? record.day : new Date(record.time * 1000).toISOString();
      li.append(side,value,when);
      return li;
    });
    list.replaceChildren(...items);
    dialog.showModal();
  }
  function paint() {
    if (!view) return;
    const records = [];
    for (const [key, block] of blocks) {
      if (key >= range.first && key <= range.last) records.push(...block.records);
    }
    const clusters = [], dots = new Map();
    for (const group of executionGroups(view,records).sort((a,b)=>a.index-b.index)) {
      for (const record of group.records) {
        const point = view.geometry.executionPoint(group.index,record.price);
        if (point.y >= point.top && point.y <= point.bottom) {
          dots.set([Math.round(point.x),Math.round(point.y),record.side].join("/"),{...point,side:record.side});
        }
      }
      const p = view.geometry.executionPoint(group.index,group.records[0].price);
      const x = Math.max(14,Math.min(p.width - 14,p.x));
      const below = p.y < p.top + 26 || (group.side === "buy" && p.y <= p.bottom - 26);
      const y = Math.max(p.top + 12,Math.min(p.bottom - 12,p.y + (below ? 15 : -15)));
      const nearby = clusters.findLast(c=>Math.abs(c.x-x)<26 && Math.abs(c.y-y)<24);
      if (nearby) {
        nearby.records.push(...group.records);
        if (nearby.side !== group.side) nearby.side = "both";
      } else clusters.push({...group,x,y,below});
    }
    const focusKey = layer.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const pins = [...dots.values()].map(point=>{
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden","true");
      dot.dataset.side = point.side;
      dot.style.left = point.x + "px";
      dot.style.top = point.y + "px";
      return dot;
    });
    layer.replaceChildren(...pins,...clusters.map(group=>{
      const flag = document.createElement("button");
      flag.type = "button";
      flag.className = "execution-flag";
      flag.dataset.key = group.index + "/" + group.side;
      flag.dataset.side = group.side;
      flag.dataset.below = String(group.below);
      flag.style.left = group.x + "px";
      flag.style.top = group.y + "px";
      flag.textContent = {buy:"B",sell:"S",both:"B/S"}[group.side];
      if (group.records.length > 1) flag.classList.add("multiple");
      const name = {buy:"매수",sell:"매도",both:"매수·매도"}[group.side] + " 체결 " + group.records.length + "건";
      flag.setAttribute("aria-label",name);
      flag.setAttribute("aria-haspopup","dialog");
      flag.title = name;
      flag.onclick = ()=>details(group);
      return flag;
    }));
    if (focusKey) [...layer.children].find(node=>node.dataset.key === focusKey)?.focus({preventScroll:true});
  }
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(next,delay);
  }
  async function next() {
    if (!view || controller || failed) return;
    if (document.hidden || !layer.getClientRects().length) { schedule(60000); return; }
    const today = Math.floor(Date.now()/dayMs);
    let key = range.last;
    while (key >= range.first) {
      const cached = blocks.get(key);
      if (!cached || ((key+1)*blockDays > today-2 && Date.now()-cached.at >= 60000)) break;
      key--;
    }
    if (key < range.first) { schedule(60000); return; }
    const request = new AbortController();
    controller = request;
    const cached = blocks.get(key);
    const start = Math.max(key*blockDays, cached ? today-2 : -Infinity);
    const end = Math.min((key+1)*blockDays-1,today+1);
    try {
      const data = await load(symbol,dateString(start),dateString(end),request.signal);
      if (request.signal.aborted) return;
      const prior = cached?.records.filter(record=>record.day < dateString(start)) ?? [];
      blocks.set(key,{at:Date.now(),records:prior.concat(data)});
      paint();
    } catch {
      if (request.signal.aborted) return;
      failed = true;
      retry.hidden = false;
    } finally {
      if (controller === request) {
        controller = null;
        if (!failed) schedule(0);
      }
    }
  }
  function reset() {
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    view = range = symbol = undefined;
    failed = false;
    retry.hidden = true;
    blocks.clear();
    layer.replaceChildren();
    if (dialog.open) dialog.close();
    list.replaceChildren();
    document.getElementById("execution-title").textContent = "";
  }
  retry.onclick = () => { failed = false; retry.hidden = true; next(); };
  return {
    reset,
    show(nextSymbol,nextView) {
      if (symbol !== nextSymbol) reset();
      symbol = nextSymbol;
      view = nextView;
      const [from,to] = viewRange(view.bars,view.frame,view.start,view.end);
      const first = blockOf(from), last = blockOf(to);
      const changed = !range || first !== range.first || last !== range.last;
      range = {first,last};
      paint();
      if (changed) {
        failed = false;
        retry.hidden = true;
        schedule(180);
      }
    }
  };
}
