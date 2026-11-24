import SwiftUI

@main
struct JMInvestApp: App {
    @StateObject private var desk = TradeDesk()
    var body: some Scene {
        WindowGroup { TradeScreen(desk: desk).onOpenURL { desk.open($0) } }
    }
}
