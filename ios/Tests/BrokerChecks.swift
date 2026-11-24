import Foundation

private struct CheckFailure: Error { let message: String }
private func expect(_ value: Bool, _ message: String) throws {
    if !value { throw CheckFailure(message: message) }
}
private func mustReject(_ body: () throws -> Void) throws {
    do { try body() } catch { return }
    throw CheckFailure(message: "Invalid order passed validation")
}

private final class FixtureTransport: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, [String: Any]))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, json) = try Self.handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: json))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main
struct BrokerChecks {
    static let stock = Stock(symbol: "AAPL", exchange: "ND", name: "Apple")
    static func ticket(_ price: String = "13.2", _ kind: OrderKind = .limit, _ count: String = "6", side: Side = .buy) throws -> Ticket {
        try Ticket(stock: stock, side: side, kind: kind, quantity: count, price: price)
    }

    static func wireChecks() throws {
        for side in Side.allCases {
            let link = StockLink(URL(string: "jminvest://stock/BRK.B?side=" + side.rawValue)!)
            try expect(link?.symbol == "BRK.B" && link?.side == side, "Stock draft link")
        }
        for link in ["jminvest://stock/AAPL?side=sell&quantity=5", "jminvest://stock/AAPL?side=place",
                     "jminvest://stock/AAPL/confirm?side=buy", "jminvest://stock/AAPL?side=buy#order"] {
            try expect(StockLink(URL(string: link)!) == nil, "Invalid draft link")
        }
        let small = try ticket("0.0095")
        try expect(small.unitPrice == "0.0095" && small.total == decimal("0.057"), "Sub-dollar precision")
        try expect(try ticket("1").unitPrice == "1.00", "Dollar threshold")
        try expect(try ticket("1.2300").unitPrice == "1.23", "Trailing zeros")
        for kind in OrderKind.allCases {
            let t = try ticket("24.70", kind)
            try expect(t.payload["ord_uv"] == (kind.needsPrice ? "24.70" : ""), "Order price field")
            try expect(t.payload["trde_tp"] == kind.rawValue && t.payload["stex_tp"] == "ND", "Kind and venue fields")
        }
        for text in ["0", "1.001", "-0.001", "1e2", "3,50", "0.00001", "nan", ""] {
            try mustReject { _ = try ticket(text) }
        }
        for q in ["0", "-1", "1.5", "1000000"] { try mustReject { _ = try ticket("1.00", .limit, q) } }
        try mustReject { _ = try ticket("0.50", .vwapLimit, "4") }
        if case .register = try KiwoomWire.action(["trnm": "LOGIN", "return_code": 0], stock: stock) {} else { throw CheckFailure(message: "Login handshake") }
        if case .registered = try KiwoomWire.action(["trnm": "REG", "return_code": "0"], stock: stock) {} else { throw CheckFailure(message: "Registration handshake") }
        if case .pong = try KiwoomWire.action(["trnm": "PING"], stock: stock) {} else { throw CheckFailure(message: "Heartbeat") }
        try mustReject { _ = try KiwoomWire.action(["trnm":"LOGIN", "return_code":2], stock: stock) }
        let registration = KiwoomWire.registration(for: stock)["data"] as! [[String: Any]]
        try expect(registration.first?["type"] as? [String] == ["FT", "FE"], "Feed types")
        try expect(registration.first?["item"] as? [[String: String]] == [["jmcode":"AAPL","stex_tp":"ND"]], "Feed instrument")
        let ft: [String: Any] = ["type":"FT", "item":"AAPL", "stexTp":"ND", "values":["41":"13.21", "50":"13.30", "51":"13.20", "60":"13.00", "21":"091502"]]
        let fe: [String: Any] = ["type":"FE", "item":"AAPL", "stexTp":"ND", "values":["10":"-13.22"]]
        var other = ft; other["item"] = "META"
        guard case .updates(let events) = try KiwoomWire.action(["trnm":"REAL", "data":[other, ft, fe]], stock: stock),
              events.count == 2, case .depth(let book) = events[0], case .price(let trade) = events[1] else {
            throw CheckFailure(message: "FT/FE dispatch")
        }
        try expect(book.asks.map(\.id) == [1,10] && book.bids.map(\.id) == [1,10], "Depth levels")
        try expect(book.time == "09:15:02" && trade == decimal("13.22"), "Time and last price")
    }

    @MainActor static func orderChecks() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureTransport.self]
        let client = Kiwoom(keys: BrokerKeys(appKey: "fixture", secret: "fixture"), session: URLSession(configuration: config))
        FixtureTransport.handler = { request in
            switch request.value(forHTTPHeaderField: "api-id") {
            case "au10001": return (200, ["return_code":0,"token":"fixture-token"])
            case "usa10098": return (200, ["return_code":0,"list":[["stk_cd":"AAPL","stex_tp":"ND","stk_nm":"Apple"]]])
            case "usa20101": return (200, ["return_code":0,"sel_1bid":"13.3","buy_1bid":"13.2","cur_prc":"13.25"])
            case "ust21070": return (200, ["return_code":0,"result_list":[["stk_cd":"AAPL","crnc_code":"USD","qty":"3","poss_qty":"4","frgn_stk_book_uv":"10"]]])
            default: throw CheckFailure(message: "Unexpected request")
            }
        }
        try expect(try await client.resolve(" aapl ") == stock, "Resolved stock")
        let (book, mark) = try await client.snapshot(stock)
        try expect(book.bids.first?.price == decimal("13.2") && mark == decimal("13.25"), "REST snapshot")
        try expect(try await client.position(stock).quantity == 4, "Total holdings")
        let token = try await client.accessToken()
        var record: Receipt?
        let gate = OrderGate(load: { record }, save: { record = $0 })
        let buy = try ticket(), sell = try ticket("0.78", .limit, "2", side: .sell)
        var requests = 0
        FixtureTransport.handler = { request in
            requests += 1
            try expect(request.httpMethod == "POST" && request.url?.path == "/api/us/ordr" &&
                       request.value(forHTTPHeaderField: "api-id") == "ust20000" &&
                       request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token", "Buy endpoint")
            return (200, ["return_code": 0, "ord_no":"000123456"])
        }
        let accepted = try await gate.send(buy) {
            try expect(record?.status == .unknown, "Intent persisted before transmission")
            do {
                _ = try await gate.send(buy) { throw CheckFailure(message: "Double send") }
                throw CheckFailure(message: "Second invocation accepted")
            } catch is TradingIssue {}
            return try await client.place(buy, token: token)
        }
        try expect(accepted.status == .accepted && accepted.detail == "000123456" && requests == 1, "Single accepted order")

        record = nil
        do {
            _ = try await gate.send(buy) { try await client.place(buy, token: token) }
            throw CheckFailure(message: "Consumed review reused")
        } catch is TradingIssue {}
        FixtureTransport.handler = { request in
            requests += 1
            try expect(request.value(forHTTPHeaderField: "api-id") == "ust20001", "Sell endpoint")
            return (200, ["return_code":1, "return_msg":"주문 거절"])
        }
        let rejected = try await gate.send(sell) { try await client.place(sell, token: token) }
        try expect(rejected.status == .rejected && requests == 2, "Explicit rejection")

        for malformed in [false, true] {
            record = nil
            let new = try ticket()
            FixtureTransport.handler = { _ in
                requests += 1
                if malformed { return (200, ["return_code":0, "ord_no":"000000000"]) }
                throw URLError(.networkConnectionLost)
            }
            let before = requests
            let result = try await gate.send(new) { try await client.place(new, token: token) }
            try expect(result.status == .unknown && requests == before + 1, "No retry on uncertain outcome")
            let restored = OrderGate(load: { record }, save: { record = $0 })
            do {
                _ = try await restored.send(try ticket()) { try await client.place(new, token: token) }
                throw CheckFailure(message: "Unresolved order not preserved on relaunch")
            } catch is TradingIssue {}
            try expect(requests == before + 1, "No replay on relaunch")
        }
        let blocked = OrderGate(load: { nil }, save: { _ in throw TradingIssue("Storage unavailable") })
        var attempted = false
        do {
            _ = try await blocked.send(try ticket()) { attempted = true; return "123" }
            throw CheckFailure(message: "Write failure ignored")
        } catch is TradingIssue {}
        try expect(!attempted, "Order sent without durable intent")
    }

    static func main() async throws {
        try wireChecks()
        try await orderChecks()
        print("PASS — order precision and types, REST routing, WebSocket messages, holdings, review consumption, rejection and recovery")
    }
}
