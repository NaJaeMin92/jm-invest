import Foundation

struct TradingIssue: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

struct BrokerKeys: Codable {
    let appKey: String
    let secret: String
}

struct Stock: Equatable, Codable {
    let symbol: String
    let exchange: String
    let name: String
    var venue: String { ["ND": "NASDAQ", "NY": "NYSE", "NA": "AMEX"][exchange] ?? exchange }
    var fields: [String: String] { ["stk_cd": symbol, "stex_tp": exchange] }
}

enum Side: String, CaseIterable, Codable {
    case buy, sell
    var label: String { self == .buy ? "Buy" : "Sell" }
    var korean: String { self == .buy ? "매수" : "매도" }
    var transaction: String { self == .buy ? "ust20000" : "ust20001" }
}

struct StockLink {
    let symbol: String
    let side: Side

    init?(_ url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "jminvest", parts.host == "stock", parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil,
              parts.path.range(of: #"^/[A-Z][A-Z0-9.-]{0,11}$"#, options: .regularExpression) != nil,
              let items = parts.queryItems, items.count == 1, items[0].name == "side",
              let side = Side(rawValue: items[0].value ?? "") else { return nil }
        symbol = String(parts.path.dropFirst())
        self.side = side
    }
}

enum OrderKind: String, CaseIterable, Codable {
    case limit = "00", market = "03", vwapLimit = "26", twapLimit = "27", loc = "30", vwapMarket = "36", twapMarket = "37"
    var label: String {
        switch self {
        case .limit: return "지정가"
        case .market: return "시장가"
        case .vwapLimit: return "VWAP 지정가"
        case .twapLimit: return "TWAP 지정가"
        case .loc: return "LOC"
        case .vwapMarket: return "VWAP 시장가"
        case .twapMarket: return "TWAP 시장가"
        }
    }
    var needsPrice: Bool { [.limit, .vwapLimit, .twapLimit, .loc].contains(self) }
    var minimumQuantity: Int { [.vwapLimit, .twapLimit, .vwapMarket, .twapMarket].contains(self) ? 5 : 1 }
}

let usLocale = Locale(identifier: "en_US_POSIX")

func decimal(_ field: Any?) -> Decimal? {
    let raw = (field as? String ?? (field as? NSNumber)?.stringValue ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard raw.range(of: #"^[+-]?[0-9]+(\.[0-9]+)?$"#, options: .regularExpression) != nil else { return nil }
    return Decimal(string: raw, locale: usLocale)
}

func priceValue(_ field: Any?) -> Decimal? {
    guard let value = decimal(field), value != 0 else { return nil }
    return abs(value)
}

func usd(_ value: Decimal) -> String {
    value.formatted(.currency(code: "USD").locale(usLocale).precision(.fractionLength(2...4)))
}

struct Ticket: Codable, Identifiable {
    let id: UUID
    let created: Date
    let stock: Stock
    let side: Side
    let kind: OrderKind
    let quantity: Int
    let unitPrice: String
    var total: Decimal? { decimal(unitPrice).map { $0 * Decimal(quantity) } }

    init(stock: Stock, side: Side, kind: OrderKind, quantity: String, price: String) throws {
        guard quantity.range(of: #"^[1-9][0-9]{0,5}$"#, options: .regularExpression) != nil,
              let count = Int(quantity), count >= kind.minimumQuantity else {
            throw TradingIssue("수량은 \(kind.minimumQuantity)주부터 999,999주까지 정수로 입력하세요.")
        }
        var formatted = ""
        if kind.needsPrice {
            guard price.range(of: #"^[0-9]{1,7}(\.[0-9]{1,4})?$"#, options: .regularExpression) != nil,
                  let value = decimal(price), value > 0 else { throw TradingIssue("유효한 USD 지정가를 입력하세요.") }
            let scale = value < 1 ? 4 : 2
            var input = value, rounded = Decimal()
            NSDecimalRound(&rounded, &input, scale, .plain)
            guard rounded == value else { throw TradingIssue("지정가는 $1 이상 소수점 2자리, $1 미만은 4자리까지 가능합니다.") }
            formatted = value.formatted(.number.locale(usLocale).grouping(.never).precision(.fractionLength(scale)))
        }
        id = UUID()
        created = Date()
        self.stock = stock
        self.side = side
        self.kind = kind
        self.quantity = count
        unitPrice = formatted
    }

    var payload: [String: String] {
        stock.fields.merging(["ord_qty": String(quantity), "ord_uv": unitPrice, "trde_tp": kind.rawValue]) { _, value in value }
    }
}

struct PriceLevel: Identifiable {
    let id: Int
    let price: Decimal
}

struct Depth {
    let asks: [PriceLevel]
    let bids: [PriceLevel]
    let time: String

    init(fields: [String: Any], streaming: Bool) {
        func levels(_ ask: Bool) -> [PriceLevel] {
            (1...10).compactMap { level in
                let key = streaming ? String((ask ? 40 : 50) + level) : "\(ask ? "sel" : "buy")_\(level)bid"
                return priceValue(fields[key]).map { PriceLevel(id: level, price: $0) }
            }
        }
        asks = levels(true)
        bids = levels(false)
        let raw = fields[streaming ? "21" : "bid_tm"] as? String ?? ""
        time = raw.count == 6 ? "\(raw.prefix(2)):\(raw.dropFirst(2).prefix(2)):\(raw.suffix(2))" : raw
    }
}

struct Position {
    let quantity: Decimal
    let average: Decimal?
}

enum MarketEvent {
    case depth(Depth)
    case price(Decimal)
}

enum FeedAction {
    case register, registered, pong, updates([MarketEvent]), ignore
}

enum KiwoomWire {
    static func registration(for stock: Stock) -> [String: Any] {
        ["trnm": "REG", "grp_no": "1", "refresh": "1", "data": [
            ["item": [["jmcode": stock.symbol, "stex_tp": stock.exchange]], "type": ["FT", "FE"]]
        ]]
    }

    static func action(_ packet: [String: Any], stock: Stock) throws -> FeedAction {
        switch packet["trnm"] as? String {
        case "PING": return .pong
        case "LOGIN", "REG":
            guard decimal(packet["return_code"]) == 0 else { throw TradingIssue("키움 실시간 호가 등록이 거절되었습니다.") }
            return packet["trnm"] as? String == "LOGIN" ? .register : .registered
        case "REAL":
            let ticks = packet["data"] as? [[String: Any]] ?? []
            return .updates(ticks.compactMap { tick in
                guard tick["item"] as? String == stock.symbol, tick["stexTp"] as? String == stock.exchange,
                      let fields = tick["values"] as? [String: Any] else { return nil }
                switch tick["type"] as? String {
                case "FT": return .depth(Depth(fields: fields, streaming: true))
                case "FE": return priceValue(fields["10"]).map(MarketEvent.price)
                default: return nil
                }
            })
        default: return .ignore
        }
    }
}
