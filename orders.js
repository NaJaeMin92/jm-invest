export function setupOrders(readToken) {
  const get = id => document.getElementById(id);
  const dialog = get("order-dialog"), form = get("order-form"), review = get("order-review");
  const status = get("order-status"), launch = get("open-order"), confirm = get("order-confirm");
  let reviewId = null, busy = false, dialogVersion = 0;
  const publicSite = location.hostname === "najaemin92.github.io";
  async function call(path, body) {
    const session = readToken();
    if (!session) throw new Error("로그인이 필요합니다.");
    const response = await fetch("./api/orders/" + path, {
      method:body ? "POST" : "GET", body:body && JSON.stringify(body),
      headers:{Authorization:"Bearer " + session,"Content-Type":"application/json"}, cache:"no-store"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "주문 서버에 연결하지 못했습니다.");
    return result;
  }
  function reset() {
    form.reset();status.textContent="";form.hidden=false;review.hidden=true;confirm.disabled=false;get("order-edit").disabled=false;reviewId=null;
  }
  async function open(symbol = "", exchange = "") {
    if (dialog.open || busy) return;
    const version = ++dialogVersion;
    const session = readToken();
    reset();
    get("order-title").textContent = symbol ? symbol + " 지정가 주문" : "미국주식 지정가 주문";
    form.elements.symbol.value = symbol;
    const venue = exchange.toUpperCase();
    if (venue.startsWith("NASDAQ")) form.elements.exchange.value = "ND";
    else if (venue === "NYSE") form.elements.exchange.value = "NY";
    else if (venue === "AMEX" || venue === "NYSE AMERICAN") form.elements.exchange.value = "NA";
    form.hidden = true;
    dialog.showModal();
    if (publicSite) {
      status.textContent = "실계좌 주문은 이 Mac의 비공개 주문 서버에서 사용할 수 있습니다.";
      return;
    }
    if (!session) {
      status.textContent = "Account에서 본인 계정으로 로그인한 뒤 주문할 수 있습니다.";
      return;
    }
    status.textContent = "주문 서버에 연결하는 중입니다.";
    const settings = await call("status").catch(() => null);
    if (version !== dialogVersion || !dialog.open || readToken() !== session) return;
    form.hidden = settings?.enabled !== true;
    status.textContent = form.hidden ? "실계좌 주문 서버가 연결되어 있지 않습니다." : "";
  }
  launch.onclick = () => open();
  get("order-close").onclick = () => {if (!busy) dialog.close();};
  dialog.addEventListener("cancel",event=>{if (busy) event.preventDefault();});
  get("order-edit").onclick = () => {if (!busy) {reviewId=null;review.hidden=true;form.hidden=false;status.textContent="";}};
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    busy=true;
    const next=form.querySelector("button");next.disabled=true;
    status.textContent="주문 내용을 확인 중입니다.";
    try {
      const order=await call("preview",Object.fromEntries(new FormData(form)));
      reviewId=order.id;
      get("order-details").textContent = order.symbol + " · " + (order.side==="buy"?"매수 ":"매도 ") + order.quantity + "주 · 1주당 $" + order.price
        + " · 주문금액 $" + order.amount + " (수수료 제외)";
      form.hidden=true;review.hidden=false;confirm.disabled=false;
      status.textContent="실계좌 지정가 주문입니다. 내용을 확인한 뒤 전송하세요.";
    } catch(error) {status.textContent=error.message;}
    finally {busy=false;next.disabled=false;}
  };
  confirm.onclick = async () => {
    if (busy || !reviewId) return;
    busy=true;confirm.disabled=true;
    get("order-edit").disabled=true;
    const id=reviewId;
    reviewId=null;
    status.textContent="키움에 주문을 전송 중입니다.";
    try {
      const order=await call("submit",{id});
      status.textContent="키움 주문 접수 · 주문번호 " + order.number + ". 체결 상태는 키움에서 확인할 수 있습니다.";
    } catch(error) {
      status.textContent=error instanceof TypeError ? "전송 결과를 확인하지 못했습니다. 새 주문을 보내기 전에 키움에서 주문 내역을 확인하세요." : error.message;
    } finally {busy=false;}
  };
  return {
    async refresh() {
      const token = readToken();
      if (!token || publicSite) return;
      try {
        const settings = await call("status");
        launch.hidden = readToken() !== token || settings.enabled !== true;
      }
      catch { launch.hidden=true; }
    },
    stockContext(symbol) {
      if (publicSite || !readToken()) return Promise.resolve(null);
      return call("context?symbol=" + encodeURIComponent(symbol));
    },
    preview: data => call("preview", data),
    submit: id => call("submit", {id}),
    open,
    signOut() { if (dialog.open) dialog.close(); launch.hidden=true; reset(); }
  };
}
