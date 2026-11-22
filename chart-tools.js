import {indicatorNames, signalsAt} from "./technical-indicators.js";

const get = id => document.getElementById(id);
const types = { candle:"Candles", hollow:"Hollow candles", ohlc:"OHLC bars", line:"Close line", area:"Area", heikin:"Heikin-Ashi" };
const overlays = ["EMA","MA","BOLL","IC","VWAP","VP"];
const lower = ["RSI","VOL","MACD","ROC","DMA","FSTO","none"];
const drawings = {
  trend:["Trendline",2], horizontal:["Horizontal line",1], vertical:["Vertical line",1],
  parallel:["Parallel channel",3], fibonacci:["Fibonacci retracement",2],
  polyline:["Polyline",Infinity], measure:["Measure",2], freehand:["Freehand",Infinity], note:["Note",1]
};
const toolbox = {
  indicators:"Indicators", draw:"Draw", layers:"Chart layers", signals:"Indicator signals",
  compare:"Compare", dual:"Dual charts", replay:"Replay", settings:"Settings"
};
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

export function setupChartTools({redraw,moveTo,getView,alternatives,loadComparison}) {
  const dialog = get("chart-tool-dialog"), body = get("chart-tool-body"), task = get("chart-task");
  const noteStatus = get("chart-tool-status"), canvas = get("market-chart"), secondCanvas = get("secondary-market-chart");
  const options = initialOptions();
  let series, symbol, frame, saved = [], pending, replay, timer, comparison, compareRequest = 0, section;
  function store() {
    try {
      localStorage.setItem("tradeinsight:draw:" + symbol + ":" + frame, JSON.stringify(saved));
    } catch {
      noteStatus.textContent = "Drawings are saved for this session.";
    }
  }
  function readDrawings() {
    try {
      const data = JSON.parse(localStorage.getItem("tradeinsight:draw:" + symbol + ":" + frame) || "[]");
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
      const list = element("div","");
      list.className = "chart-tool-grid";
      for (const [id,label] of Object.entries(toolbox)) list.append(button(label,()=>render(id)));
      body.append(list);
    },
    types() {
      for (const [id,label] of Object.entries(types)) body.append(button(label,()=>{
        options.type = id;
        dialog.close();
        update();
      },options.type === id));
    },
    indicators() {
      body.append(element("h4","On the price chart"));
      for (const name of overlays) body.append(button(indicatorNames[name],()=>{
        options.overlays = options.overlays.includes(name) ? options.overlays.filter(value=>value!==name) : [...options.overlays,name];
        render("indicators"); update();
      },options.overlays.includes(name)));
      body.append(element("h4","Below the chart"));
      for (const name of lower) body.append(button(indicatorNames[name] || "None",()=>{
        options.lower = name;
        render("indicators"); update();
      },options.lower===name));
    },
    draw() {
      const note = document.createElement("input");
      note.placeholder = "Note text";
      note.setAttribute("aria-label","Note text");
      note.maxLength = 50;
      for (const [id,[label]] of Object.entries(drawings)) body.append(button(label,()=>{
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
      body.append(note,button("Undo last drawing",()=>{
        saved.pop();store();update();
      }));
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
    get("chart-tool-title").textContent = toolbox[next] || (next === "types" ? "Chart type" : "Chart Toolbox");
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
      return {...options, drawings:pending?.points.length ? [...marks,pending] : marks,
        compare:comparison?.mode === "compare" ? {...comparison.chart,symbol:comparison.symbol} : null,
        end:replay?.end};
    },
    secondary() { return comparison?.mode === "dual" ? comparison : null; },
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
