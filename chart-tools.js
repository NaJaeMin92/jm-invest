import {indicatorNames, signalsAt} from "./technical-indicators.js";

const get = id => document.getElementById(id);
const types = {
  line:["Close line","⌁"], area:["Area","◩"], baseline:["Baseline","⇵"],
  candle:["Candles","▥"], hollow:["Hollow candles","▯"], heikin:["Heikin-Ashi","▤"],
  mono:["OHLC bars","┤"], ohlc:["Colored bars","╫"]
};
const overlays = ["EMA","MA","BOLL","IC","VWAP","VP"];
const lower = ["RSI","VOL","MACD","ROC","DMA","FSTO","none"];
const drawings = {
  trend:["Trendline",2,"↗"], horizontal:["Horizontal line",1,"━"], vertical:["Vertical line",1,"┃"], extended:["Extended line",2,"⤢"],
  parallel:["Parallel channel",3,"∥"], fibonacci:["Fibonacci retracement",2,"≡"], extension:["Fibonacci extension",3,"⋮"],
  polyline:["Polyline",Infinity,"⌁"], measure:["Measure",2,"↔"], freehand:["Freehand",Infinity,"✎"], note:["Note",1,"T"]
};
const toolbox = {
  indicators:"Indicators", draw:"Draw", layers:"Chart layers", signals:"Indicator signals",
  compare:"Compare", dual:"Dual charts", replay:"Replay", settings:"Settings"
};
const toolSymbols = {
  indicators:"∿", draw:"✎", layers:"▱", signals:"⋈",
  compare:"⇄", dual:"◫", replay:"▷", settings:"⚙"
};
const drawGroups = [
  ["Lines", ["trend","horizontal","vertical","extended"]],
  ["Patterns and Fibonacci", ["parallel","polyline","fibonacci","extension"]],
  ["Notes and markup", ["measure","freehand","note"]]
];
const layers = { volume:"Volume bars", grid:"Price grid", price:"Last price line", drawings:"Drawings" };
const initialOptions = () => ({
  type:"candle", lower:"RSI", overlays:["EMA"],
  layers:{ volume:true, grid:true, price:true, drawings:true }, log:false, greenUp:false
});
const element = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
function button(label, run, selected) {
  const control = element("button", label);
  control.type = "button";
  control.onclick = run;
  if (selected != null) control.setAttribute("aria-pressed",String(selected));
  return control;
}

function tile(label, symbol, run, selected) {
  const control = button(label, run, selected);
  if (symbol) {
    const icon = element("span", symbol);
    icon.className = "chart-tile-icon";
    icon.setAttribute("aria-hidden","true");
    control.prepend(icon);
  }
  return control;
}

function grid() {
  const list = element("div", "");
  list.className = "chart-tool-grid";
  return list;
}

const drawingKey = "tradeinsight:drawings:v2:";
function removeTestDrawings() {
  try {
    for (let i=localStorage.length-1; i>=0; i-=1) {
      const key=localStorage.key(i);
      if (key?.startsWith("tradeinsight:draw:")) localStorage.removeItem(key);
    }
  } catch { /* Browser storage may be unavailable. */ }
}

export function setupChartTools({redraw,moveTo,getView,alternatives,loadComparison}) {
  const dialog = get("chart-tool-dialog"), body = get("chart-tool-body"), task = get("chart-task");
  const noteStatus = get("chart-tool-status"), canvas = get("market-chart"), secondCanvas = get("secondary-market-chart");
  removeTestDrawings();
  const options = initialOptions();
  let selectedDrawing, moving = false;
  let series, symbol, frame, saved = [], pending, replay, timer, comparison, compareRequest = 0, section;
  function store() {
    try {
      localStorage.setItem(drawingKey + symbol + ":" + frame, JSON.stringify(saved));
    } catch {
      noteStatus.textContent = "Drawings are saved for this session.";
    }
  }
  function readDrawings() {
    try {
      const data = JSON.parse(localStorage.getItem(drawingKey + symbol + ":" + frame) || "[]");
      return data.filter(drawing => drawings[drawing.type] && drawing.points?.length &&
        drawing.points.every(p => Number.isFinite(p.price) && Number.isFinite(p.time)));
    } catch {
      return [];
    }
  }
  function stopTimer() {
    clearInterval(timer);
    timer = null;
    get("chart-play").textContent = "Play";
  }
  function showDrawingOptions(menu = "") {
    get("drawing-colors").hidden = menu !== "color";
    get("drawing-styles").hidden = menu !== "style";
    for (const name of ["color","style"]) get("drawing-"+name).setAttribute("aria-expanded",String(menu===name));
  }
  function selectDrawing(drawing) {
    selectedDrawing = saved.includes(drawing) ? drawing : null;
    moving = false;
    showDrawingOptions();
    redraw();
  }
  for (const [name,panel] of [["color","drawing-colors"],["style","drawing-styles"]]) {
    get("drawing-"+name).onclick = () => showDrawingOptions(get(panel).hidden ? name : "");
  }
  for (const control of document.querySelectorAll("#drawing-actions [data-color],#drawing-actions [data-style]")) {
    if (control.dataset.color) control.style.setProperty("--swatch",control.dataset.color);
    control.onclick = () => {
      if (!selectedDrawing) return;
      const attribute = control.dataset.color ? "color" : "style";
      selectedDrawing[attribute] = control.dataset[attribute];
      store();showDrawingOptions();redraw();
    };
  }
  get("drawing-move").onclick = () => {
    if (!selectedDrawing) return;
    moving = !moving;
    showDrawingOptions();
    redraw();
  };
  get("drawing-delete").onclick = () => {
    saved = saved.filter(drawing=>drawing!==selectedDrawing);
    store();selectDrawing(null);
  };
  function drawingOptions() {
    const visible = selectedDrawing && options.layers.drawings && !replay && !pending;
    get("drawing-actions").hidden = !visible;
    get("drawing-move").setAttribute("aria-pressed",String(moving));
    get("drawing-move-hint").hidden = !moving;
    if (visible) {
      get("drawing-color").style.color = selectedDrawing.color || "#e6ba6e";
      for (const button of get("drawing-styles").querySelectorAll("button")) {
        button.setAttribute("aria-pressed",String(button.dataset.style === (selectedDrawing.style || "solid")));
      }
    }
    return Boolean(visible && moving);
  }
  function status() {
    task.hidden = !pending && !replay;
    canvas.classList.toggle("annotating",Boolean(pending));
    get("chart-finish").hidden = pending?.type !== "polyline";
    get("chart-step").hidden = !replay;
    get("chart-play").hidden = !replay;
    get("chart-step").disabled = replay?.end >= series?.bars.length;
    get("chart-play").disabled = get("chart-step").disabled;
    if (pending) {
      const [name,count] = drawings[pending.type];
      noteStatus.textContent = pending.type === "freehand" ? "Drag to draw"
        : name + " · " + (count === Infinity ? pending.points.length + " points · tap Finish" : pending.points.length + "/" + count + " · tap the chart");
    }
    if (replay) noteStatus.textContent = "Replay · " + replay.end + " / " + series.bars.length + " candles";
  }
  function update() {
    status();
    redraw();
  }
  function finishDrawing() {
    if (pending.points.length >= (pending.type === "note" ? 1 : drawings[pending.type][1] === 1 ? 1 : 2)) {
      saved = [...saved.slice(-249), pending];
      store();
    }
    pending = null;
    update();
  }
  function stopMode() {
    pending = null;
    selectedDrawing = null;
    moving = false;
    showDrawingOptions();
    replay = null;
    stopTimer();
    update();
  }
  function step() {
    if (!replay || replay.end >= series.bars.length) return;
    replay.end += 1;
    const {start,windowSize} = getView();
    if (replay.end > start + windowSize) moveTo(replay.end - windowSize);
    if (replay.end >= series.bars.length) stopTimer();
    update();
  }
  function replayFromView() {
    pending = null;
    const {start} = getView();
    replay = {end:Math.min(start+12,series.bars.length-1)};
    dialog.close();
    update();
  }

  get("chart-finish").onclick = finishDrawing;
  get("chart-stop").onclick = stopMode;
  get("chart-step").onclick = step;
  get("chart-play").onclick = () => {
    if (timer) return stopTimer();
    if (!replay || replay.end >= series.bars.length) return;
    timer = setInterval(step, 600);
    get("chart-play").textContent = "Pause";
  };
  const sections = {
    root() {
      const list = grid();
      for (const [id,label] of Object.entries(toolbox)) list.append(tile(label,toolSymbols[id],()=>render(id)));
      body.append(list);
    },
    types() {
      const list = grid();
      for (const [id,[label,symbol]] of Object.entries(types)) {
        list.append(tile(label,symbol,()=>{
          options.type = id;
          dialog.close();
          update();
        },options.type === id));
      }
      body.append(list);
    },
    indicators() {
      const onPrice = grid(), below = grid();
      for (const name of overlays) onPrice.append(button(indicatorNames[name], event => {
        const selected = !options.overlays.includes(name);
        options.overlays = selected ? [...options.overlays,name] : options.overlays.filter(value=>value!==name);
        event.currentTarget.setAttribute("aria-pressed",String(selected));
        update();
      },options.overlays.includes(name)));
      for (const name of lower) below.append(button(indicatorNames[name] || "None",()=>{
        options.lower = options.lower === name ? "none" : name;
        [...below.children].forEach((control,index) => control.setAttribute("aria-pressed",String(lower[index]===options.lower)));
        update();
      },options.lower===name));
      body.append(element("h4","On the price chart"),onPrice,element("h4","Below the chart"),below);
    },
    draw() {
      const note = document.createElement("input");
      note.placeholder = "Note text";
      note.setAttribute("aria-label","Note text");
      note.maxLength = 50;
      for (const [heading,ids] of drawGroups) {
        const list = grid();
        for (const id of ids) {
          const [label,,symbol] = drawings[id];
          list.append(tile(label,symbol,()=>{
            const text = note.value.trim();
            if (id === "note" && !text) {
              note.focus();
              return;
            }
            dialog.close();
            replay = null; stopTimer();
            options.layers.drawings = true;
            pending = {type:id, points:[], text};
            update();
          }));
        }
        body.append(element("h4",heading),list);
      }
      function removeDrawing(clear) {
        if (clear) saved = [];
        else saved.pop();
        selectedDrawing = null;
        store();update();
        render("draw");
      }
      const actions = grid();
      const undo = button("Undo last drawing",()=>removeDrawing(false));
      const clear = button("Clear drawings",()=>removeDrawing(true));
      undo.disabled = clear.disabled = !saved.length;
      actions.append(undo,clear);
      body.append(note,actions);
    },
    layers() {
      for (const [id,label] of Object.entries(layers)) body.append(button(label,()=>{
        options.layers[id] = !options.layers[id];
        render("layers"); update();
      },options.layers[id]));
    },
    signals() {
      const {start,windowSize} = getView();
      const index = Math.min(start + windowSize, replay?.end ?? series.bars.length) - 1;
      const date = new Date(series.bars[index][0]*1000);
      body.append(element("p", date.toLocaleString("en-US",{timeZone:"America/New_York"})+" ET"));
      for (const [label,value] of signalsAt(series,index)) {
        const row = element("p","");
        row.className = "chart-signal";
        row.append(element("strong",label),element("span",value));
        body.append(row);
      }
    },
    compare() { pickComparison("compare"); },
    dual() { pickComparison("dual"); },
    replay() {
      if (series.bars.length > 1) body.append(button("Start at visible window",replayFromView));
      else body.append(element("p","Replay requires at least two candles."));
      if (replay) body.append(button("Exit replay",()=>{dialog.close();stopMode();}));
    },
    settings() {
      body.append(button("Log price scale",()=>{options.log=!options.log;render("settings");update();},options.log));
      body.append(button("Green up candles",()=>{options.greenUp=!options.greenUp;render("settings");update();},options.greenUp));
      body.append(button("Reset chart appearance",()=>{
        Object.assign(options,initialOptions());render("settings");update();
      }));
    }
  };
  function pickComparison(mode) {
    const info = element("p",mode === "compare" ? "Overlay relative performance from the first shared candle." : "Show a second symbol over the same dates.");
    const select = document.createElement("select");
    select.setAttribute("aria-label","Comparison symbol");
    for (const name of alternatives.filter(name=>name!==symbol)) {
      const item = element("option",name); item.value=name; select.append(item);
    }
    body.append(info,select,button("Apply",async()=>{
      const request = ++compareRequest;
      const name = select.value;
      info.textContent = "Loading " + name + "…";
      try {
        const chart = await loadComparison(name,frame);
        if (request !== compareRequest || !dialog.open || section !== mode) return;
        if (!chart) throw new Error("No comparable history");
        comparison = {mode, chart, symbol:name};
        dialog.close(); update();
      } catch {
        if (request === compareRequest) info.textContent = "Price history is unavailable for " + name + ".";
      }
    }),button("Remove comparison",()=>{
      comparison = null;
      dialog.close(); update();
    }));
  }
  function render(next) {
    section = next;
    dialog.dataset.section = next;
    get("chart-tool-title").textContent = toolbox[next] || (next === "types" ? "Line Type" : "Chart Toolbox");
    body.replaceChildren();
    if (!["types","root"].includes(next)) body.append(button("‹ Toolbox",()=>render("root")));
    sections[next]();
    body.querySelector("button")?.focus();
  }
  function open(next) {
    if (!series) return;
    stopTimer();
    render(next);
    dialog.showModal();
  }
  get("chart-type").onclick = () => open("types");
  get("chart-tools").onclick = () => open("root");
  get("chart-tool-close").onclick = () => dialog.close();
  dialog.addEventListener("cancel",event=>event.stopPropagation());
  dialog.addEventListener("close",()=>{compareRequest+=1;});
  return {
    extendSeries(next) {
      if (replay) {
        const stamp = series.bars[replay.end - 1]?.[0];
        const index = next.bars.findIndex(bar => bar[0] >= stamp);
        if (index >= 0) replay.end = index + 1;
      }
      series = next;
    },
    updateSeries(next, nextSymbol, nextFrame) {
      comparison = null;
      compareRequest += 1;
      series = next;
      symbol = nextSymbol;
      frame = nextFrame;
      saved = next ? readDrawings() : [];
      get("chart-type").hidden = !series;
      get("chart-tools").hidden = !series;
      if (dialog.open) dialog.close();
      stopMode();
    },
    pause:stopTimer,
    canUseSnapshot() {
      return options.type==="candle" && options.lower==="RSI" && options.overlays.length===1 && options.overlays[0]==="EMA"
        && Object.values(options.layers).every(Boolean) && !options.log && !options.greenUp
        && !saved.length && !pending && !comparison && !replay;
    },
    chartOptions() {
      const marks = replay
        ? saved.filter(mark => mark.points.every(point => point.time <= series.bars[replay.end-1][0]))
        : saved;
      return {...options, selectedDrawing, drawings:pending?.points.length ? [...marks,pending] : marks,
        compare:comparison?.mode === "compare" ? {...comparison.chart,symbol:comparison.symbol} : null,
        end:replay?.end};
    },
    secondary() { return comparison?.mode === "dual" ? comparison : null; },
    drawingOptions,
    selectDrawing,
    pointsToMove() { return moving ? selectedDrawing?.points : null; },
    moveDrawing(points) {
      if (!moving || !selectedDrawing) return;
      selectedDrawing.points = points;
      redraw();
    },
    finishMove() { if (moving) { moving = false; store(); redraw(); } },
    activeDrawing() { return pending?.type; },
    addPoint(point) {
      if (!point || !pending) return;
      if (pending.points.length < 500) pending.points.push(point);
      if (pending.points.length >= drawings[pending.type][1]) finishDrawing();
      else update();
    },
    finishFreehand() { if (pending?.type === "freehand") finishDrawing(); },
    replayEnd() { return replay?.end; },
    secondaryCanvas:secondCanvas
  };
}
