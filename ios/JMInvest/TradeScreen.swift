import SwiftUI

private let ink = Color(red: 0.065, green: 0.09, blue: 0.125)
private let surface = Color(red: 0.11, green: 0.15, blue: 0.20)
private let buyTint = Color(red: 0.71, green: 0.89, blue: 0.81)
private let sellTint = Color(red: 0.91, green: 0.80, blue: 0.67)
private let gain = Color(red: 1, green: 0.65, blue: 0.70)
private let loss = Color(red: 0.45, green: 0.84, blue: 0.73)

private func rate(_ price: Decimal, _ reference: Decimal) -> String {
    let fraction = (price - reference) / reference
    return fraction.formatted(.percent.locale(usLocale).precision(.fractionLength(2)).sign(strategy: .always(includingZero: false)))
}

private extension View {
    func numericKeyboard(fractional: Bool) -> some View {
        #if os(iOS)
        keyboardType(fractional ? .decimalPad : .numberPad)
        #else
        self
        #endif
    }
    func tickerKeyboard() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.characters).autocorrectionDisabled()
        #else
        self
        #endif
    }
    func insetPanel() -> some View {
        padding(14).background(surface, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct TradeScreen: View {
    @ObservedObject var desk: TradeDesk
    @Environment(\.scenePhase) private var phase
    @State private var settings = false
    @State private var fullDepth = false
    @FocusState private var editing: Bool

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let receipt = desk.receipt { receiptCard(receipt).id("receipt") }
                        if desk.connected {
                            HStack {
                                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                                TextField("종목 티커", text: $desk.ticker).tickerKeyboard().focused($editing)
                                    .textFieldStyle(.plain).submitLabel(.search).onSubmit(selectStock)
                                Button("조회", action: selectStock).frame(minHeight: 44)
                            }.padding(.horizontal, 12).background(surface, in: RoundedRectangle(cornerRadius: 13))
                            .disabled(desk.busy)
                            if let stock = desk.stock {
                                header(stock)
                                if desk.side == .sell { holding }
                                ViewThatFits(in: .horizontal) {
                                    HStack(alignment: .top, spacing: 12) {
                                        ladder.frame(minWidth: 138, maxWidth: .infinity)
                                        entry.frame(minWidth: 155, maxWidth: .infinity)
                                    }
                                    VStack(spacing: 14) { entry; ladder }
                                }
                            } else {
                                Text(desk.feedLabel).foregroundStyle(.secondary)
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 12) {
                                Image(systemName: "building.columns").font(.title2).foregroundStyle(buyTint)
                                Text("키움 실계좌 연결").font(.title2.bold())
                                Text("아이폰에서 미국주식 호가를 확인하고 주문합니다. 키움에 등록한 IP로 연결하세요.")
                                    .foregroundStyle(.secondary)
                                Button("API 키 연결") { settings = true }.buttonStyle(.borderedProminent)
                            }.frame(maxWidth: .infinity, alignment: .leading).insetPanel()
                        }
                    }.padding(16)
                }
                .onChange(of: desk.receipt?.ticket.id) { _, id in
                    if id != nil { scroll.scrollTo("receipt", anchor: .top) }
                }
            }
            .background(ink)
            .navigationTitle("JM Invest")
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    Button { editing = false; settings = true } label: { Image(systemName: "key") }
                        .accessibilityLabel("키움 연결 설정").disabled(desk.busy)
                }
                #if os(iOS)
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("완료") { editing = false }
                }
                #endif
            }
            .safeAreaInset(edge: .bottom) {
                if desk.connected, desk.stock != nil, desk.receipt == nil {
                    Button {
                        editing = false
                        desk.makeReview()
                    } label: {
                        Text(desk.side.korean + " 주문 확인").font(.headline).frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.borderedProminent).tint(sideTint).foregroundStyle(ink)
                    .disabled(!desk.canReview).padding(.horizontal, 16).padding(.vertical, 6).background(ink)
                }
            }
        }
        .tint(buyTint).preferredColorScheme(.dark)
        .sheet(isPresented: $settings) { CredentialsView(desk: desk) }
        .sheet(item: $desk.review) { ticket in review(ticket) }
        .alert("JM Invest", isPresented: Binding(get: { desk.issue != nil }, set: { if !$0 { desk.issue = nil } })) {
            Button("확인") { desk.issue = nil }
        } message: { Text(desk.issue ?? "") }
        .onAppear { if phase == .active { desk.activate() } }
        .onChange(of: phase) { _, new in
            if new == .active { desk.activate() }
            if new == .background { editing = false; desk.suspend() }
        }
    }

    private var sideTint: Color { desk.side == .buy ? buyTint : sellTint }

    private func selectStock() {
        editing = false
        desk.select(desk.ticker)
    }

    private func header(_ stock: Stock) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(stock.symbol).font(.largeTitle.bold())
                Spacer()
                Text(desk.price.map(usd) ?? "—").font(.title.bold()).monospacedDigit()
            }
            Text([stock.venue, stock.name].joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
            HStack(spacing: 5) {
                Circle().fill(desk.streaming ? buyTint : .secondary).frame(width: 6, height: 6)
                Text(desk.feedLabel)
                if let time = desk.depth?.time, !time.isEmpty { Text(time).monospacedDigit() }
            }.font(.caption).foregroundStyle(.secondary)
        }
    }

    private var holding: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("보유수량").font(.caption).foregroundStyle(.secondary)
                Text(desk.position.map { "\($0.quantity)주" } ?? (desk.positionStatus.isEmpty ? "—" : desk.positionStatus))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("평균 매입가").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Text(desk.position?.average.map(usd) ?? "—")
                    if let average = desk.position?.average, let mark = desk.price {
                        Text(rate(mark, average)).foregroundStyle(mark >= average ? gain : loss)
                    }
                }
            }
        }.font(.subheadline.weight(.semibold)).monospacedDigit().insetPanel()
    }

    private var ladder: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("호가").font(.headline)
                Spacer()
                Button(fullDepth ? "3단 보기" : "10단 보기") { fullDepth.toggle() }.font(.caption)
            }.frame(minHeight: 44)
            if let book = desk.depth, !(book.asks.isEmpty && book.bids.isEmpty) {
                let depth = min(fullDepth ? 10 : 3, max(book.asks.last?.id ?? 0, book.bids.last?.id ?? 0))
                ForEach((1...depth).reversed(), id: \.self) { i in level(book.asks.first { $0.id == i }, ask: true) }
                HStack { Text("현재가"); Spacer(); Text(desk.price.map(usd) ?? "—") }
                    .font(.caption.bold()).padding(.vertical, 8)
                ForEach(1...depth, id: \.self) { i in level(book.bids.first { $0.id == i }, ask: false) }
            } else {
                Text("표시할 호가 없음").font(.caption).foregroundStyle(.secondary).padding(.vertical, 12)
            }
        }.padding(9).background(surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func level(_ level: PriceLevel?, ask: Bool) -> some View {
        Button {
            if let level { desk.limit = NSDecimalNumber(decimal: level.price).stringValue; editing = false }
        } label: {
            HStack(spacing: 2) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(level.map { usd($0.price) } ?? "—").font(.subheadline.weight(.semibold))
                    if let level, let fx = desk.fx {
                        Text((level.price * fx).formatted(.currency(code: "KRW").locale(Locale(identifier: "ko_KR")).precision(.fractionLength(0))))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 2)
                if let level, let close = desk.priorClose {
                    Text(rate(level.price, close)).font(.caption2).foregroundStyle(level.price >= close ? gain : loss)
                }
            }.monospacedDigit().padding(.horizontal, 4).frame(minHeight: 44)
                .background((ask ? Color.blue : Color.pink).opacity(0.09))
        }.buttonStyle(.plain).disabled(level == nil || !desk.kind.needsPrice)
        .accessibilityLabel((ask ? "매도 호가 " : "매수 호가 ") + (level.map { usd($0.price) } ?? "없음"))
    }

    private var entry: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("매매 구분", selection: $desk.side) {
                ForEach(Side.allCases, id: \.self) { Text($0.label).tag($0) }
            }.pickerStyle(.segmented)
            VStack(alignment: .leading, spacing: 4) {
                Text("주문 종류").font(.caption).foregroundStyle(.secondary)
                Picker("주문 종류", selection: $desk.kind) {
                    ForEach(OrderKind.allCases, id: \.self) { Text($0.label).tag($0) }
                }.labelsHidden().tint(sideTint)
            }
            if desk.kind.needsPrice {
                input("지정가 · USD", text: $desk.limit, fractional: true)
            }
            input("수량 · 주", text: $desk.quantity, fractional: false)
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text("예상 주문 금액").font(.caption).foregroundStyle(.secondary)
                if !desk.kind.needsPrice { Text("체결 시 결정") }
                else if let stock = desk.stock, let draft = try? Ticket(stock: stock, side: desk.side, kind: desk.kind, quantity: desk.quantity, price: desk.limit),
                        let total = draft.total {
                    Text(usd(total)).font(.headline)
                    if let fx = desk.fx {
                        Text("약 " + (total * fx).formatted(.currency(code: "KRW").locale(Locale(identifier: "ko_KR")).precision(.fractionLength(0))))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else { Text("—") }
            }.monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading).insetPanel()
    }

    private func input(_ label: String, text: Binding<String>, fractional: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField(fractional ? "0.00" : "1", text: text)
                .numericKeyboard(fractional: fractional).focused($editing).monospacedDigit()
                .textFieldStyle(.plain).padding(.horizontal, 8).frame(minHeight: 44)
                .background(ink, in: RoundedRectangle(cornerRadius: 8)).accessibilityLabel(label)
        }
    }

    private func review(_ ticket: Ticket) -> some View {
        NavigationStack {
            List {
                Section("키움 미국주식 실계좌") {
                    LabeledContent("종목", value: ticket.stock.symbol + " · " + ticket.stock.venue)
                    LabeledContent("주문 종류", value: ticket.kind.label)
                    LabeledContent("수량", value: "\(ticket.quantity)주")
                    if let value = decimal(ticket.unitPrice) { LabeledContent("지정가", value: usd(value)) }
                    LabeledContent("예상 주문 금액", value: ticket.total.map(usd) ?? "체결 시 결정")
                }
                Button {
                    Task { await desk.confirm(ticket) }
                } label: {
                    Text(desk.busy ? "접수 확인 중…" : ticket.side.korean + " 주문하기")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }.disabled(desk.busy)
            }
            .navigationTitle(ticket.side.korean + " 주문 확인")
            .toolbar { Button("수정") { desk.review = nil }.disabled(desk.busy) }
        }.interactiveDismissDisabled(desk.busy).presentationDetents([.medium, .large])
    }

    private func receiptCard(_ result: Receipt) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(result.status == .accepted ? "주문 접수" : result.status == .rejected ? "주문 거절" : "접수 여부 확인 필요").font(.headline)
            Text("\(result.ticket.stock.symbol) · \(result.ticket.side.korean) \(result.ticket.quantity)주 · \(result.ticket.kind.label)")
            Text([result.ticket.created.formatted(date: .abbreviated, time: .shortened), decimal(result.ticket.unitPrice).map(usd)]
                .compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            Text(result.status == .accepted ? "키움 주문번호 " + result.detail : result.detail).font(.subheadline).foregroundStyle(.secondary)
            Button(result.status == .unknown ? "키움에서 접수 여부를 확인했어요" : "확인", action: desk.acknowledge).disabled(desk.busy)
        }.frame(maxWidth: .infinity, alignment: .leading).insetPanel()
    }
}

private struct CredentialsView: View {
    @ObservedObject var desk: TradeDesk
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var secret = ""
    @State private var error = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                if desk.connected {
                    Section("키움 실계좌") {
                        Label("이 기기에 연결됨", systemImage: "checkmark.circle")
                        Button("연결 해제", role: .destructive) { desk.disconnect(); dismiss() }
                    }
                } else {
                    Section {
                        SecureField("App Key", text: $key)
                        SecureField("App Secret", text: $secret)
                    } footer: { Text("실계좌 키는 이 기기의 Keychain에 저장합니다. 키움에 등록한 IP에서 연결하세요.") }
                    if !error.isEmpty { Text(error).foregroundStyle(.red) }
                    Button(saving ? "인증 중…" : "키움 계좌 연결") {
                        guard !saving else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            do { try await desk.connect(key: key, secret: secret); key = ""; secret = ""; dismiss() }
                            catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving || key.isEmpty || secret.isEmpty)
                }
            }.navigationTitle("계좌 연결").toolbar { Button("닫기") { dismiss() }.disabled(saving) }
        }.interactiveDismissDisabled(saving)
    }
}
