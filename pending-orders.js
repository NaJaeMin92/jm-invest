export function setupPendingOrders(call, available, kinds) {
  const get = id => document.getElementById(id);
  const dialog = get("pending-orders"), panel = get("pending-list-panel"), list = get("pending-list");
  const form = get("pending-action"), price = get("pending-price"), next = get("pending-next");
  const status = get("pending-status"), refresh = get("pending-refresh");
  let original, action, intent, version = 0, busy = false, timer;

  function clearAction() {
    original = action = intent = null;
    form.hidden = true;
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
    get("pending-original").textContent = "주문번호 " + row.number + " · 미체결 " + row.remaining + "주"
      + (row.price ? " · 기존 $" + row.price : "");
    get("pending-price-label").hidden = price.disabled = !amend;
    price.required = amend;
    price.value = amend ? row.price : "";
    next.textContent = amend ? "정정 내용 확인" : "취소 내용 확인";
    next.disabled = false;
    panel.hidden = true;
    form.hidden = false;
    status.textContent = "";
    (amend ? price : next).focus();
  }

  function draw(rows) {
    const elements = rows.map(row => {
      const item = document.createElement("li");
      const name = document.createElement("strong"), details = document.createElement("small");
      name.textContent = row.symbol + " · " + ({buy:"매수", sell:"매도"}[row.side] ?? "주문");
      details.textContent = [kinds.get(row.kind) || row.kindName, row.price && "$" + row.price,
        "잔여 " + row.remaining + "주", row.time, "주문번호 " + row.number].filter(Boolean).join(" · ");
      const identity = document.createElement("div");
      identity.append(name, details);
      item.append(identity);
      for (const [type, label, enabled] of [["amend","정정",row.canAmend], ["cancel","취소",row.canCancel]]) {
        if (!enabled) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("aria-label", row.symbol + " 주문 " + row.number + " " + label);
        button.onclick = () => edit(row, type);
        item.append(button);
      }
      return item;
    });
    const active = list.contains(document.activeElement) && document.activeElement.getAttribute("aria-label");
    list.replaceChildren(...elements);
    if (active) [...list.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === active)?.focus({preventScroll:true});
  }

  async function reload(receipt = "") {
    clearTimeout(timer);
    const id = ++version;
    refresh.disabled = true;
    if (!available()) {
      status.textContent = "미체결 주문은 로그인한 Mac의 비공개 주문 서버에서 확인할 수 있습니다.";
      return;
    }
    if (!list.children.length) status.textContent = receipt || "미체결 주문 조회 중…";
    try {
      const result = await call("pending");
      if (id !== version || !dialog.open) return;
      draw(result.orders);
      status.textContent = [receipt, result.orders.length ? "" : "미체결 주문이 없습니다."].filter(Boolean).join(" · ");
    } catch (error) {
      if (id === version) {
        list.replaceChildren();
        status.textContent = [receipt, error.message].filter(Boolean).join(" · ");
      }
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
    clearAction();
    status.textContent = "";
  }
  get("pending-close").onclick = () => { if (!busy) close(); };
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (!busy) close(); });
  refresh.onclick = () => reload();
  get("pending-back").onclick = () => { clearAction(); price.readOnly = false; reload(); };
  return {open() {
    if (dialog.open) return;
    clearAction();
    price.readOnly = false;
    dialog.showModal();
    reload();
  }, close};
}
