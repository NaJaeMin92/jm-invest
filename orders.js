import {setupPendingOrders} from "./pending-orders.js?v=74";

export const orderKinds = new Map([
  ["00", "지정가"], ["03", "시장가"], ["26", "VWAP 지정가"], ["27", "TWAP 지정가"],
  ["30", "LOC"], ["36", "VWAP 시장가"], ["37", "TWAP 시장가"]
]);
export const needsPrice = kind => ["00", "26", "27", "30"].includes(kind);
export function populateKinds(select) {
  for (const [code, label] of orderKinds) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    select.append(option);
  }
}

export function setupOrders(readToken, quoteEndpoint) {
  const publicSite = location.hostname === "najaemin92.github.io";
  async function call(path, body, endpoint = "./api/orders/" + path, signal) {
    const session = readToken();
    if (!session) throw new Error("로그인이 필요합니다.");
    const response = await fetch(endpoint, {
      method:body ? "POST" : "GET", body:body && JSON.stringify(body),
      headers:{Authorization:"Bearer " + session,"Content-Type":"application/json"}, cache:"no-store", signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "주문 서버에 연결하지 못했습니다.");
    return result;
  }
  const pending = setupPendingOrders(call, () => !publicSite && Boolean(readToken()), orderKinds);
  return {
    stockPosition(symbol, signal) {
      if (!readToken()) return Promise.resolve(null);
      if (!quoteEndpoint) throw new Error("잔고 서버에 연결할 수 없습니다.");
      const endpoint = new URL("position", new URL(quoteEndpoint, location.href));
      endpoint.searchParams.set("symbol", symbol);
      return call("", null, endpoint, signal);
    },
    stockContext(symbol) {
      if (!readToken()) return Promise.resolve(null);
      if (publicSite) {
        if (!quoteEndpoint) return Promise.resolve(null);
        const endpoint = new URL("book", new URL(quoteEndpoint, location.href));
        endpoint.searchParams.set("symbol", symbol);
        return call("", null, endpoint).then(context => ({...context, enabled:false}));
      }
      return call("context?symbol=" + encodeURIComponent(symbol));
    },
    preview: data => call("preview", data),
    submit: id => call("submit", {id}),
    openPending: pending.open,
    signOut: pending.close
  };
}
