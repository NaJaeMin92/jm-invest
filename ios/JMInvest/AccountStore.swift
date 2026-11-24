import Foundation
import Security
import LocalAuthentication

enum AccountStore {
    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "JMInvest.Kiwoom",
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }

    static func read<T: Decodable>(_ key: String, as: T.Type) throws -> T? {
        var query = query(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw TradingIssue("잠금 해제 후 보안 저장소를 다시 열어주세요.") }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func write<T: Encodable>(_ key: String, _ value: T) throws {
        let item = query(key)
        let update: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(value),
                                     kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(item as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(item.merging(update) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw TradingIssue("아이폰 보안 저장소에 기록하지 못했습니다.") }
    }

    static func remove(_ key: String) throws {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw TradingIssue("보안 저장소를 변경하지 못했습니다.") }
    }

    static func authorize(_ ticket: Ticket) async throws {
        let context = LAContext()
        let reason = "\(ticket.stock.symbol) \(ticket.quantity)주 \(ticket.side.korean) 주문 확인"
        guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) else {
            throw TradingIssue("주문 인증을 완료하지 않았습니다.")
        }
    }
}

struct Receipt: Codable {
    enum Status: String, Codable { case unknown, accepted, rejected }
    let ticket: Ticket
    let status: Status
    let detail: String
}

@MainActor
final class OrderGate {
    typealias Load = () throws -> Receipt?
    typealias Save = (Receipt) throws -> Void
    let load: Load
    private let save: Save
    private var sending = false
    private var consumed: UUID?

    init(load: @escaping Load = { try AccountStore.read("lastOrder", as: Receipt.self) },
         save: @escaping Save = { try AccountStore.write("lastOrder", $0) }) {
        self.load = load
        self.save = save
    }

    func send(_ ticket: Ticket, perform: () async throws -> String) async throws -> Receipt {
        guard !sending, consumed != ticket.id, try load() == nil else { throw TradingIssue("직전 주문 결과를 먼저 확인하세요.") }
        guard Date().timeIntervalSince(ticket.created) < 120 else { throw TradingIssue("주문 확인 시간이 지났습니다. 주문을 다시 확인하세요.") }
        let uncertain = Receipt(ticket: ticket, status: .unknown, detail: "키움 주문내역에서 접수 여부를 확인하세요.")
        // Persist before transmission so an app termination cannot turn a missing reply into an automatic resend.
        try save(uncertain)
        sending = true
        consumed = ticket.id
        defer { sending = false }
        let result: Receipt
        do {
            result = Receipt(ticket: ticket, status: .accepted, detail: try await perform())
        } catch let error as BrokerRejection {
            result = Receipt(ticket: ticket, status: .rejected, detail: error.localizedDescription)
        } catch {
            return uncertain
        }
        try save(result)
        return result
    }
}
