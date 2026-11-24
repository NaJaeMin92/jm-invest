import SwiftUI

@MainActor
final class TradeDesk: ObservableObject {
    @Published var ticker = "AAPL"
    @Published private(set) var stock: Stock?
    @Published private(set) var depth: Depth?
    @Published private(set) var price: Decimal?
    @Published private(set) var priorClose: Decimal?
    @Published private(set) var fx: Decimal?
    @Published private(set) var position: Position?
    @Published private(set) var positionStatus = ""
    @Published private(set) var feedLabel = "계좌 연결 필요"
    @Published private(set) var streaming = false
    @Published private(set) var connected = false
    @Published private(set) var busy = false
    @Published var side = Side.buy
    @Published var kind = OrderKind.limit
    @Published var quantity = "1"
    @Published var limit = ""
    @Published var review: Ticket?
    @Published private(set) var receipt: Receipt?
    @Published var issue: String?
    private let gate = OrderGate()
    private var broker: Kiwoom?
    private var feedTask: Task<Void, Never>?
    private var selection = UUID()
    private var active = false
    private var loaded = false

    func activate() {
        guard !active else { return }
        active = true
        if !loaded {
            do {
                receipt = try gate.load()
                if let keys = try AccountStore.read("credentials", as: BrokerKeys.self) {
                    broker = Kiwoom(keys: keys)
                    connected = true
                }
                loaded = true
            } catch { issue = error.localizedDescription; return }
        }
        if connected { select(stock?.symbol ?? ticker) }
    }

    func suspend() {
        active = false
        review = nil
        selection = UUID()
        feedTask?.cancel()
        streaming = false
        if connected { feedLabel = "호가 일시 정지" }
    }

    func connect(key: String, secret: String) async throws {
        guard !busy else { return }
        let keys = BrokerKeys(appKey: key.trimmingCharacters(in: .whitespacesAndNewlines),
                              secret: secret.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !keys.appKey.isEmpty, !keys.secret.isEmpty else { throw TradingIssue("App Key와 App Secret을 입력하세요.") }
        let client = Kiwoom(keys: keys)
        _ = try await client.accessToken()
        try Task.checkCancellation()
        try AccountStore.write("credentials", keys)
        broker = client
        connected = true
        select(ticker)
    }

    func disconnect() {
        guard !busy else { return }
        do {
            try AccountStore.remove("credentials")
            selection = UUID()
            feedTask?.cancel()
            broker = nil
            connected = false
            resetMarket()
            feedLabel = "계좌 연결 필요"
        } catch { issue = error.localizedDescription }
    }

    private func resetMarket(clearFields: Bool = true) {
        stock = nil
        depth = nil
        price = nil
        priorClose = nil
        fx = nil
        position = nil
        positionStatus = ""
        streaming = false
        review = nil
        if clearFields {
            limit = ""
            quantity = "1"
        }
    }

    func open(_ url: URL) {
        guard !busy, let link = StockLink(url) else { return }
        selection = UUID()
        feedTask?.cancel()
        resetMarket()
        kind = .limit
        ticker = link.symbol
        side = link.side
        select(link.symbol)
    }

    func select(_ input: String) {
        guard active, let broker else { return }
        feedTask?.cancel()
        let id = UUID()
        selection = id
        resetMarket(clearFields: stock?.symbol != input.uppercased())
        feedLabel = "종목 조회 중"
        feedTask = Task {
            do {
                let item = try await broker.resolve(input)
                guard selection == id else { return }
                stock = item
                if ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
                    ticker = item.symbol
                }
                feedLabel = "호가 연결 중"
                positionStatus = "잔고 조회 중"
                async let metadata: Void = loadReference(broker, item, id)
                async let balance: Void = loadPosition(broker, item, id)
                async let quotes: Void = follow(broker, item, id)
                _ = await (metadata, balance, quotes)
            } catch {
                if selection == id { feedLabel = error.localizedDescription }
            }
        }
    }

    private func loadReference(_ broker: Kiwoom, _ item: Stock, _ id: UUID) async {
        guard let values = try? await broker.reference(item), selection == id else { return }
        priorClose = values.close
        fx = values.fx
    }

    private func loadPosition(_ broker: Kiwoom, _ item: Stock, _ id: UUID) async {
        do {
            let result = try await broker.position(item)
            guard selection == id else { return }
            position = result
            positionStatus = ""
        } catch { if selection == id { positionStatus = "잔고 조회 실패" } }
    }

    private func loadSnapshot(_ broker: Kiwoom, _ item: Stock, _ id: UUID, _ revision: Int, _ tradeRevision: Int) async {
        guard let (book, mark) = try? await broker.snapshot(item), selection == id, !Task.isCancelled else { return }
        if revision == depthRevision {
            depth = book
            if !streaming { feedLabel = "최근 조회 호가" }
        }
        if priceRevision == tradeRevision, let mark { price = mark }
    }

    private var depthRevision = 0
    private var priceRevision = 0
    private func follow(_ broker: Kiwoom, _ item: Stock, _ id: UUID) async {
        var pause = 2
        while selection == id && !Task.isCancelled {
            let revision = depthRevision
            let tradeRevision = priceRevision
            async let snapshot: Void = loadSnapshot(broker, item, id, revision, tradeRevision)
            do {
                try await broker.stream(item) { [weak self] event in
                    guard let self, self.selection == id else { return }
                    switch event {
                    case .depth(let book):
                        self.depthRevision += 1
                        self.depth = book
                        self.streaming = true
                        self.feedLabel = "실시간 호가"
                    case .price(let mark):
                        self.priceRevision += 1
                        self.price = mark
                    }
                }
            } catch {}
            guard selection == id && !Task.isCancelled else { return }
            pause = streaming ? 2 : min(pause * 2, 30)
            streaming = false
            _ = await snapshot
            guard selection == id && !Task.isCancelled else { return }
            feedLabel = depth == nil ? "호가 재연결 중" : "최근 조회 호가 · 재연결 중"
            do { try await Task.sleep(for: .seconds(pause)) } catch { return }
        }
    }

    var canReview: Bool {
        guard !busy, receipt == nil, let stock, ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == stock.symbol else { return false }
        return true
    }

    func makeReview() {
        guard canReview, let stock else { return }
        do { review = try Ticket(stock: stock, side: side, kind: kind, quantity: quantity, price: limit) }
        catch { issue = error.localizedDescription }
    }

    func confirm(_ ticket: Ticket) async {
        guard !busy, active, review?.id == ticket.id, let broker else { return }
        busy = true
        defer { busy = false }
        do {
            try await AccountStore.authorize(ticket)
            let token = try await broker.accessToken()
            guard active, review?.id == ticket.id, stock == ticket.stock else { return }
            receipt = try await gate.send(ticket) { try await broker.place(ticket, token: token) }
            review = nil
            if receipt?.status == .accepted, active, stock == ticket.stock { await loadPosition(broker, ticket.stock, selection) }
        } catch {
            review = nil
            receipt = try? gate.load()
            issue = error.localizedDescription
        }
    }

    func acknowledge() {
        guard !busy else { return }
        do { try AccountStore.remove("lastOrder"); receipt = nil }
        catch { issue = error.localizedDescription }
    }
}
