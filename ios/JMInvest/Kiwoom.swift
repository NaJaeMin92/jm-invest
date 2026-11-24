import Foundation

final class DirectConnection: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct BrokerRejection: LocalizedError {
    let errorDescription: String?
    init(_ reason: String) { errorDescription = reason }
}

actor Kiwoom {
    private let keys: BrokerKeys
    private let session: URLSession
    private var cachedToken: (String, Date)?
    private var tokenRequest: Task<(String, Date), Error>?
    private var nextRead = ContinuousClock.now

    init(keys: BrokerKeys, session: URLSession? = nil) {
        self.keys = keys
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.urlCache = nil
        config.httpCookieStorage = nil
        self.session = session ?? URLSession(configuration: config, delegate: DirectConnection(), delegateQueue: nil)
    }

    private func post(_ path: String, id: String, token: String? = nil, body: [String: String]) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://api.kiwoom.com" + path)!)
        request.httpMethod = "POST"
        request.setValue(id, forHTTPHeaderField: "api-id")
        request.setValue("application/json;charset=UTF-8", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = decimal(fields["return_code"]) else { throw TradingIssue("키움 응답을 확인할 수 없습니다.") }
        if http.statusCode == 401 { cachedToken = nil }
        if code != 0 && ((200..<300).contains(http.statusCode) || (400..<500).contains(http.statusCode)) {
            if path == "/oauth2/token" { throw BrokerRejection("키움 인증이 거절되었습니다. 실계좌 키와 등록한 공인 IP를 확인하세요.") }
            throw BrokerRejection(String((fields["return_msg"] as? String ?? "키움이 요청을 거절했습니다.").prefix(240)))
        }
        guard code == 0, (200..<300).contains(http.statusCode) else { throw TradingIssue("키움 서버 응답을 확인하지 못했습니다.") }
        return fields
    }

    func accessToken() async throws -> String {
        if let (token, expiry) = cachedToken, Date() < expiry { return token }
        if let tokenRequest { return try await tokenRequest.value.0 }
        let task = Task { try await issueToken() }
        tokenRequest = task
        defer { tokenRequest = nil }
        let issued = try await task.value
        cachedToken = issued
        return issued.0
    }

    private func issueToken() async throws -> (String, Date) {
        let result = try await post("/oauth2/token", id: "au10001",
                                    body: ["grant_type": "client_credentials", "appkey": keys.appKey, "secretkey": keys.secret])
        guard let token = result["token"] as? String, !token.isEmpty else { throw TradingIssue("키움 인증 토큰이 없습니다.") }
        let format = DateFormatter()
        format.locale = usLocale
        format.timeZone = TimeZone(identifier: "Asia/Seoul")
        format.dateFormat = "yyyyMMddHHmmss"
        let expiry = (result["expires_dt"] as? String).flatMap(format.date(from:)) ?? Date().addingTimeInterval(600)
        return (token, expiry.addingTimeInterval(-60))
    }

    private func read(_ path: String, id: String, fields: [String: String]) async throws -> [String: Any] {
        let time = max(nextRead, .now)
        nextRead = time.advanced(by: .milliseconds(750))
        try await Task.sleep(until: time, clock: .continuous)
        try Task.checkCancellation()
        return try await post("/api/us/" + path, id: id, token: accessToken(), body: fields)
    }

    func resolve(_ input: String) async throws -> Stock {
        let ticker = input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard ticker.range(of: #"^[A-Z][A-Z0-9.-]{0,11}$"#, options: .regularExpression) != nil else {
            throw TradingIssue("미국주식 티커를 입력하세요.")
        }
        let alternative = ticker.contains("-") ? ticker.replacingOccurrences(of: "-", with: ".") : ticker.replacingOccurrences(of: ".", with: "-")
        let aliases = alternative == ticker ? [ticker] : [ticker, alternative]
        for candidate in aliases {
            let result = try await read("stkinfo", id: "usa10098", fields: ["stk_cd": candidate])
            let matches = (result["list"] as? [[String: Any]] ?? []).filter { row in
                aliases.contains((row["stk_cd"] as? String ?? "").trimmingCharacters(in: .whitespaces))
                    && ["ND", "NY", "NA"].contains(row["stex_tp"] as? String ?? "")
            }
            guard matches.count <= 1 else { throw TradingIssue("거래소를 하나로 확인할 수 없는 종목입니다.") }
            if let row = matches.first, let symbol = row["stk_cd"] as? String, let exchange = row["stex_tp"] as? String {
                return Stock(symbol: symbol.trimmingCharacters(in: .whitespaces), exchange: exchange,
                             name: row["stk_nm"] as? String ?? row["stk_enm"] as? String ?? symbol)
            }
        }
        throw TradingIssue("키움에서 해당 미국주식 티커를 찾지 못했습니다.")
    }

    func snapshot(_ stock: Stock) async throws -> (Depth, Decimal?) {
        let row = try await read("mrkcond", id: "usa20101", fields: stock.fields)
        return (Depth(fields: row, streaming: false), priceValue(row["cur_prc"]))
    }

    func reference(_ stock: Stock) async throws -> (close: Decimal?, fx: Decimal?) {
        let row = try await read("mrkcond", id: "usa20100", fields: stock.fields)
        return (priceValue(row["base_close_pric"]), priceValue(row["base_exrt"]))
    }

    func position(_ stock: Stock) async throws -> Position {
        var fields = stock.fields
        fields["crnc_code"] = "USD"
        let raw = try await read("acnt", id: "ust21070", fields: fields)
        guard let rows = raw["result_list"] as? [[String: Any]] else { throw TradingIssue("잔고를 확인할 수 없습니다.") }
        if rows.isEmpty { return Position(quantity: 0, average: nil) }
        guard rows.count == 1, let row = rows.first, (row["stk_cd"] as? String)?.trimmingCharacters(in: .whitespaces) == stock.symbol,
              row["crnc_code"] as? String == "USD", let qty = decimal(row["poss_qty"]) else { throw TradingIssue("종목 잔고를 확인할 수 없습니다.") }
        return Position(quantity: qty, average: qty > 0 ? priceValue(row["frgn_stk_book_uv"]) : nil)
    }

    // Order POSTs are made once. Transport or malformed-response errors have an unknown outcome.
    func place(_ ticket: Ticket, token: String) async throws -> String {
        let reply = try await post("/api/us/ordr", id: ticket.side.transaction, token: token, body: ticket.payload)
        guard let number = (reply["ord_no"] as? String)?.trimmingCharacters(in: .whitespaces),
              number.range(of: #"^[0-9]+$"#, options: .regularExpression) != nil,
              number.contains(where: { $0 != "0" }) else { throw TradingIssue("키움 주문번호를 확인하지 못했습니다.") }
        return number
    }

    func stream(_ stock: Stock, deliver: @escaping @MainActor @Sendable (MarketEvent) -> Void) async throws {
        let token = try await accessToken()
        let ws = session.webSocketTask(with: URL(string: "wss://api.kiwoom.com:10000/api/websocket")!)
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            ws.resume()
            defer { ws.cancel(with: .goingAway, reason: nil) }
            func send(_ frame: [String: Any]) async throws {
                let data = try JSONSerialization.data(withJSONObject: frame)
                try await ws.send(.string(String(decoding: data, as: UTF8.self)))
            }
            try await send(["trnm": "LOGIN", "token": token])
            var registered = false
            let activity = FeedActivity()
            let watchdog = Task {
                while !Task.isCancelled {
                    try await Task.sleep(for: .seconds(10))
                    if await activity.expired { ws.cancel(with: .goingAway, reason: nil); return }
                }
            }
            defer { watchdog.cancel() }
            while !Task.isCancelled {
                let message = try await ws.receive()
                let data: Data
                switch message {
                case .string(let text): data = Data(text.utf8)
                case .data(let bytes): data = bytes
                @unknown default: continue
                }
                guard let packet = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                await activity.received()
                switch try KiwoomWire.action(packet, stock: stock) {
                case .pong: try await ws.send(message)
                case .register: try await send(KiwoomWire.registration(for: stock))
                case .registered: registered = true
                case .updates(let events) where registered:
                    for event in events { try Task.checkCancellation(); await deliver(event) }
                default: break
                }
            }
        } onCancel: { ws.cancel(with: .goingAway, reason: nil) }
    }
}

private actor FeedActivity {
    private var last = ContinuousClock.now
    var expired: Bool { last.duration(to: .now) > .seconds(65) }
    func received() { last = .now }
}
