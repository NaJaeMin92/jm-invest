const activeKey = "jm-invest:watchlist:active";
const groupsKey = "jm-invest:watchlist:groups";
const defaultId = "main";
const get = id => document.getElementById(id);
const safeRead = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const node = (tag, text) => {
  const item = document.createElement(tag);
  item.textContent = text;
  return item;
};

export function setupWatchEditor({watchKey, nameFor, tickerIcon, refresh}) {
  const editor = get("watch-editor"), rows = get("watch-editor-rows"), notice = get("home-value");
  let selected = new Set(), drag, undo;
  const groups = () => safeRead(groupsKey, []);
  const active = () => {
    const id = safeRead(activeKey, defaultId);
    return groups().some(group => group.id === id) ? id : defaultId;
  };
  const allGroups = () => {
    const stored = groups();
    if (stored.some(group => group.id === defaultId)) return stored;
    return [{id:defaultId,title:"My Watchlist",symbols:safeRead(watchKey,[])}, ...stored];
  };
  function readList(id = active()) {
    const data = allGroups().find(group => group.id === id)?.symbols;
    return Array.isArray(data) ? data.filter(symbol => typeof symbol === "string" && /^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) : [];
  }
  function renameHeading() {
    const title = allGroups().find(group => group.id === active())?.title || "My Watchlist";
    get("watch-title").textContent = title;
    const picker = get("watch-title-picker");
    const lists = allGroups();
    if (picker.options.length !== lists.length || lists.some((list,index) =>
      picker.options[index].value !== list.id || picker.options[index].text !== list.title)) fillSelect(picker,lists);
    picker.value = active();
  }
  function saveList(symbols, id = active(), manualOrder = false) {
    try {
      localStorage.setItem(groupsKey,JSON.stringify(allGroups().map(group => group.id === id ? {...group,symbols,manualOrder:manualOrder || group.manualOrder} : group)));
      refresh();
      if (editor.open) render();
      return true;
    } catch {
      notice.textContent = "Unable to save your watchlist.";
      return false;
    }
  }
  function fillSelect(select, items) {
    select.replaceChildren(...items.map(({id,title}) => {
      const option = node("option",title);
      option.value = id;
      return option;
    }));
  }
  function selectionChanged() {
    const symbols = readList();
    const count = selected.size;
    get("watch-selection").textContent=symbols.length+(symbols.length===1 ? " symbol" : " symbols");
    get("watch-selected-count").textContent=count+" selected";
    get("watch-actions").hidden=!count || get("watch-manage-panel").hidden;
    if(!count)get("watch-move-form").hidden=true;
    get("watch-list-empty").hidden=Boolean(symbols.length);
    get("watch-select-all").disabled=!symbols.length;
    get("watch-delete").disabled = !count;
    get("watch-move").disabled = !count;
    get("watch-select-all").checked = Boolean(count && count === symbols.length);
    get("watch-select-all").indeterminate = Boolean(count && count < symbols.length);
    for (const row of rows.children) row.querySelector("input").checked = selected.has(row.dataset.symbol);
  }
  function move(index, to) {
    const symbols = readList();
    if (to < 0 || to >= symbols.length || index === to) return;
    const [symbol] = symbols.splice(index,1);
    symbols.splice(to,0,symbol);
    saveList(symbols);
  }
  function makeButton(label, text, run) {
    const button = node("button",text);
    button.type="button";button.setAttribute("aria-label",label);button.onclick=run;
    return button;
  }
  function rowFor(symbol,index) {
    const row = node("li","");
    row.dataset.symbol=symbol;
    const check = document.createElement("input");
    check.type="checkbox";check.setAttribute("aria-label","Select "+symbol);
    check.onchange=()=>{if(check.checked) selected.add(symbol);else selected.delete(symbol);selectionChanged();};
    const identity = node("label","");
    identity.append(check,tickerIcon(symbol),node("span",""));
    identity.lastElementChild.append(node("strong",symbol),node("small",nameFor(symbol)));
    const top = makeButton("Move "+symbol+" to top","↑",()=>move(index,0));
    top.disabled = index===0;
    const handle = makeButton("Reorder "+symbol,"⋮⋮",()=>{});
    handle.className="reorder-handle";
    handle.title="Drag or use the arrow keys";
    handle.addEventListener("keydown",event=>{
      if (!["ArrowUp","ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      move(index,index+(event.key==="ArrowUp"?-1:1));
      rows.querySelector("[data-symbol='"+symbol+"'] .reorder-handle")?.focus();
    });
    handle.onpointerdown=event=>{
      if (event.button!==0) return;
      drag = {id:event.pointerId,index,target:index};
      handle.setPointerCapture(event.pointerId);
      row.classList.add("drag-source");
    };
    handle.onpointermove=event=>{
      if (drag?.id!==event.pointerId) return;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest("#watch-editor-rows li");
      if (!target) return;
      drag.target=[...rows.children].indexOf(target);
      for(const item of rows.children) item.classList.toggle("drag-target",item===target);
    };
    handle.onpointerup=event=>{
      if (drag?.id!==event.pointerId) return;
      const {target}=drag; drag=null;
      clearDrag();
      move(index,target);
    };
    handle.onpointercancel=clearDrag;
    row.append(identity, top, handle);
    return row;
    function clearDrag() {
      drag=null;
      for(const item of rows.children) item.classList.remove("drag-source","drag-target");
    }
  }
  function render() {
    fillSelect(get("watch-active-list"),allGroups());
    get("watch-active-list").value=active();
    fillSelect(get("watch-destination"),allGroups().filter(group=>group.id!==active()));
    const symbols=readList();
    selected=new Set([...selected].filter(symbol=>symbols.includes(symbol)));
    rows.replaceChildren(...symbols.map(rowFor));
    selectionChanged();
  }
  function selectTool(search) {
    get("watch-tools").hidden=!search;
    get("watch-manage-panel").hidden=search;
    get("watch-manage-tab").setAttribute("aria-pressed",String(!search));
    get("watch-search-tab").setAttribute("aria-pressed",String(search));
    selectionChanged();
    if(search)get("watch-symbol").focus();
  }
  get("watch-manage-tab").onclick=()=>selectTool(false);
  get("watch-search-tab").onclick=()=>selectTool(true);
  function open(search=false) {
    selected=new Set();
    notice.textContent="";
    render();
    if (!editor.open) editor.showModal();
    selectTool(search);
    editor.scrollTop=0;
  }
  editor.addEventListener("close",()=>{
    get("watch-create-list").hidden=true;
    get("watch-move-form").hidden=true;
    get("watch-results").replaceChildren();
    get("watch-form").reset();
  });
  get("watch-edit").onclick=()=>open();
  get("watch-editor-done").onclick=()=>editor.close();
  function switchList(event) {
    localStorage.setItem(activeKey,JSON.stringify(event.target.value));
    selected.clear();undo=null;
    get("watch-move-form").hidden=true;
    refresh();
    if (editor.open) render();
  }
  get("watch-active-list").onchange = switchList;
  get("watch-title-picker").onchange = switchList;
  get("watch-select-all").onchange=event=>{
    selected=new Set(event.target.checked?readList():[]);selectionChanged();
  };
  get("watch-new-list").onclick=()=>{
    get("watch-create-list").hidden=false;
    get("watch-create-list").elements.title.focus();
  };
  get("watch-create-list").onsubmit=event=>{
    event.preventDefault();
    const form=event.currentTarget,title=form.elements.title.value.trim();
    if(!title || allGroups().some(group=>group.title.toLowerCase()===title.toLowerCase())) {
      notice.textContent="Use a new list name.";return;
    }
    try {
      const id=crypto.randomUUID();
      localStorage.setItem(groupsKey,JSON.stringify([...allGroups(),{id,title,symbols:[]}]));
      localStorage.setItem(activeKey,JSON.stringify(id));
      form.reset();form.hidden=true;selected.clear();notice.textContent="";
      refresh();render();
    } catch { notice.textContent="Unable to create list."; }
  };
  get("watch-delete").onclick=()=>{
    const before=readList();
    const removed=selected.size;
    if (!removed || !saveList(before.filter(symbol=>!selected.has(symbol)))) return;
    undo={id:active(),before};
    notice.replaceChildren(node("span",removed+" removed. "),makeButton("Undo delete","Undo",()=>{
      if (!undo) return;
      saveList(undo.before,undo.id);undo=null;notice.textContent="";
    }));
  };
  get("watch-move").onclick=()=>{
    if (allGroups().length===1) {
      notice.textContent="Create another watchlist before moving symbols.";
      get("watch-new-list").click();
      return;
    }
    get("watch-move-form").hidden=false;
    get("watch-destination").focus();
  };
  get("watch-move-form").onsubmit=event=>{
    event.preventDefault();
    const destination=get("watch-destination").value;
    const source=active(), wanted=[...selected];
    if (!wanted.length || !destination || destination===source) return;
    try {
      const next = allGroups().map(group => {
        if (group.id === source) return {...group,symbols:readList(source).filter(symbol=>!selected.has(symbol))};
        if (group.id === destination) return {...group,symbols:[...new Set([...readList(destination),...wanted])]};
        return group;
      });
      localStorage.setItem(groupsKey,JSON.stringify(next));
      event.currentTarget.hidden=true;
      refresh();render();
      notice.textContent=wanted.length+" moved.";
    } catch { notice.textContent="Unable to move symbols."; }
  };
  const allSymbols = () => [...new Set(allGroups().flatMap(group => readList(group.id)))];
  const hasManualOrder = () => Boolean(allGroups().find(group=>group.id===active())?.manualOrder);
  return {readList,allSymbols,saveList,hasManualOrder,renameHeading,open};
}
