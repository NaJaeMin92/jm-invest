export function setupPendingOrders(call, available, kinds) {
  const get = id => document.getElementById(id);
  const dialog = get("pending-orders"), panel = get("pending-list-panel"), list = get("pending-list");
  const form = get("pending-action"), price = get("pending-price"), next = get("pending-next");
  const status = get("pending-status"), refresh = get("pending-refresh");
  const filters = get("pending-filters"), placeholder = get("pending-placeholder");
  const template = get("pending-order-row");
  const dollars = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD", maximumFractionDigits:4});
  const sideName = {buy:"Buy", sell:"Sell"};
  let original, action, intent, version = 0, busy = false, timer;
  let rows, filter = "all";

  function showPlaceholder(title, detail = "") {
    placeholder.hidden = !title;
    get("pending-placeholder-title").textContent = title;
    get("pending-placeholder-detail").textContent = detail;
  }

  function orderTerms(row) {
    return [kinds.get(row.kind) || row.kindName, Number(row.price) > 0 && dollars.format(Number(row.price))].filter(Boolean).join(" · ");
  }

  function showOriginal(row) {
    const facts = get("pending-original");
    facts.replaceChildren();
    for (const [label, value] of [["종목", row.symbol], ["매매 구분", sideName[row.side]],
      ["미체결 수량", row.remaining.toLocaleString("ko-KR") + "주"], ["원주문", orderTerms(row)], ["주문번호", row.number]]) {
      if (!value) continue;
      const term = document.createElement("dt"), description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      facts.append(term, description);
    }
  }

  function clearAction() {
    original = action = intent = null;
    form.hidden = true;
    refresh.hidden = false;
    panel.hidden = false;
    get("pending-summary").hidden = true;
    price.value = "";
  }

  function edit(row, type) {
    ++version;
    clearTimeout(timer);
    original = row;
    action = type;
    const amend = type === "amend";
    get("pending-action-title").textContent = row.symbol + (amend ? " 지정가 정정" : " 잔량 취소");
    showOriginal(row);
    form.dataset.action = type;
    refresh.hidden = true;
    get("pending-price-label").hidden = price.disabled = !amend;
    price.required = amend;
    price.value = amend ? row.price : "";
    next.textContent = amend ? "정정 내용 확인" : "취소 내용 확인";
    next.disabled = false;
    price.readOnly = false;
    panel.hidden = true;
    form.hidden = false;
    status.textContent = "";
    (amend ? price : get("pending-action-title")).focus();
    if (!amend) form.requestSubmit();
  }

  function draw() {
    filters.hidden = !rows.length;
    for (const button of filters.querySelectorAll("button")) {
      const side = button.dataset.filter;
      button.querySelector("span").textContent = side === "all" ? rows.length : rows.filter(row => row.side === side).length;
      button.setAttribute("aria-pressed", String(side === filter));
    }
    const visible = rows.filter(row => filter === "all" || row.side === filter);
    const focused = list.contains(document.activeElement) && document.activeElement.getAttribute("aria-label");
    const items = visible.map(row => {
      const item = template.content.firstElementChild.cloneNode(true);
      item.querySelector(".pending-symbol").textContent = row.symbol;
      const side = item.querySelector(".pending-side");
      side.textContent = sideName[row.side] || "주문";
      side.dataset.side = row.side || "";
      item.querySelector(".pending-remaining strong").textContent = row.remaining.toLocaleString("ko-KR") + "주";
      item.querySelector(".pending-terms").textContent = orderTerms(row);
      item.querySelector(".pending-meta span").textContent = "주문번호 " + row.number;
      item.querySelector("time").textContent = (row.time || "").replace(/^(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3");
      for (const button of item.querySelectorAll("[data-action]")) {
        const type = button.dataset.action;
        button.hidden = type === "amend" && !row.canAmend;
        button.disabled = type === "cancel" && !row.canCancel;
        button.setAttribute("aria-label", row.symbol + " 주문 " + row.number + " " + button.textContent);
        button.onclick = () => edit(row, type);
      }
      if (!row.canCancel) {
        const reason = item.querySelector(".pending-reason");
        reason.hidden = false;
        reason.textContent = row.cancelReason || "키움에서 취소 가능 여부를 확인할 수 없습니다.";
      }
      return item;
    });
    list.replaceChildren(...items);
    if (focused) [...list.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === focused)?.focus({preventScroll:true});
    if (visible.length) showPlaceholder("");
    else if (rows.length) showPlaceholder(sideName[filter] + " 미체결 주문이 없습니다.");
    else showPlaceholder("미체결 주문이 없습니다.", "오늘 접수한 주문 중 체결을 기다리는 주문이 여기에 표시됩니다.");
  }

  for (const button of filters.querySelectorAll("button")) {
    button.onclick = () => { filter = button.dataset.filter; draw(); };
  }

  async function reload(receipt = "") {
    clearTimeout(timer);
    const id = ++version;
    refresh.disabled = true;
    if (!available()) {
      showPlaceholder("미체결 주문을 조회할 수 없습니다.", "로그인한 Mac의 비공개 주문 서버에서 확인할 수 있습니다.");
      return;
    }
    if (!rows) showPlaceholder("미체결 주문 조회 중…");
    try {
      const result = await call("pending");
      if (id !== version || !dialog.open) return;
      rows = result.orders;
      draw();
      status.textContent = receipt;
    } catch (error) {
      if (id !== version || !dialog.open) return;
      if (!rows) showPlaceholder("주문을 불러올 수 없습니다.", error.message);
      const message = rows ? "새로고침 실패 · " + error.message : "";
      status.textContent = [receipt, message].filter(Boolean).join(" · ");
    } finally {
      if (id === version && dialog.open) {
        refresh.disabled = false;
        timer = setTimeout(() => reload(receipt), 6000);
      }
    }
  }

  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !original || !form.reportValidity()) return;
    const id = version, sending = Boolean(intent), amend = action === "amend";
    busy = next.disabled = get("pending-back").disabled = true;
    price.readOnly = true;
    try {
      if (sending) {
        const result = await call("submit", {id:intent});
        if (id !== version || !dialog.open) return;
        clearAction();
        await reload((amend ? "정정" : "취소") + " 접수 · 주문번호 " + result.number);
      } else {
        const order = await call("preview", {action, original, price:amend ? price.value : ""});
        if (id !== version || !dialog.open) return;
        intent = order.id;
        const summary = get("pending-summary");
        summary.textContent = amend ? "남은 " + original.remaining + "주의 지정가를 $" + order.price + "로 정정합니다."
          : "남은 " + original.remaining + "주 전체를 취소합니다.";
        summary.hidden = false;
        status.textContent = "";
        next.textContent = amend ? "실계좌 정정 전송" : "실계좌 취소 전송";
      }
    } catch (error) {
      if (id !== version || !dialog.open) return;
      const message = sending && (error instanceof TypeError || error instanceof SyntaxError)
        ? "전송 결과를 확인하지 못했습니다. 키움 주문 내역을 확인하세요." : error.message;
      if (sending) { clearAction(); await reload(message); }
      else status.textContent = message;
    } finally {
      busy = next.disabled = get("pending-back").disabled = false;
      price.readOnly = Boolean(intent);
    }
  };

  function close() {
    ++version;
    clearTimeout(timer);
    if (dialog.open) dialog.close();
    list.replaceChildren();
    rows = undefined;
    filter = "all";
    filters.hidden = true;
    showPlaceholder("");
    clearAction();
    status.textContent = "";
  }
  get("pending-close").onclick = () => { if (!busy) close(); };
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (!busy) close(); });
  refresh.onclick = () => reload();
  get("pending-back").onclick = () => {
    clearAction();
    price.readOnly = false;
    get("pending-close").focus();
    reload();
  };
  return {open() {
    if (dialog.open) return;
    clearAction();
    price.readOnly = false;
    dialog.showModal();
    reload();
  }, close};
}
