import AppKit
import CryptoKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

private let appName = "ChatGPT2LocalBridge"

enum AppLanguage: String, CaseIterable, Identifiable, Codable {
    case en
    case zh

    var id: String { rawValue }

    var toggleLabel: String {
        switch self {
        case .en: return "中文"
        case .zh: return "EN"
        }
    }
}

@main
struct ChatGPT2LocalBridgeLauncher {
    private static var delegate: AppDelegate?

    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        Self.delegate = delegate
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

@MainActor
final class AppState {
    static let shared = AppState()
    let model = BridgeModel()
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var windowController: NSWindowController?
    private var isShowingWindow = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = makeMainMenu()
        showWindow()
        Task { @MainActor in
            await AppState.shared.model.bootstrap()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        if window?.isVisible != true {
            showWindow(activate: false)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    @objc private func startServiceMenu(_ sender: Any?) {
        Task { @MainActor in
            await AppState.shared.model.startService()
        }
    }

    @objc private func stopServiceMenu(_ sender: Any?) {
        Task { @MainActor in
            await AppState.shared.model.stopService()
        }
    }

    @objc private func openWebConsoleMenu(_ sender: Any?) {
        Task { @MainActor in
            AppState.shared.model.openWebConsole()
        }
    }

    @MainActor
    private func showWindow(activate: Bool = true) {
        if isShowingWindow { return }
        isShowingWindow = true
        defer { isShowingWindow = false }

        if let window {
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
            windowController?.showWindow(nil)
            if activate {
                NSRunningApplication.current.activate(options: [.activateAllWindows])
                NSApp.activate(ignoringOtherApps: true)
            }
            return
        }

        NSApp.setActivationPolicy(.regular)
        let root = ContentView()
            .environmentObject(AppState.shared.model)
            .frame(minWidth: 1320, minHeight: 820)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = appName
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 1320, height: 820)
        window.collectionBehavior.insert(.moveToActiveSpace)
        window.contentView = NSHostingView(rootView: root)
        window.center()
        window.setFrameAutosaveName("ChatGPT2LocalBridge.MainWindow.v2")
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        let controller = NSWindowController(window: window)
        controller.showWindow(nil)
        if activate {
            NSRunningApplication.current.activate(options: [.activateAllWindows])
            NSApp.activate(ignoringOtherApps: true)
        }
        self.windowController = controller
        self.window = window
        if activate {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                guard let window = self?.window else { return }
                NSApp.setActivationPolicy(.regular)
                window.makeKeyAndOrderFront(nil)
                window.orderFrontRegardless()
                NSRunningApplication.current.activate(options: [.activateAllWindows])
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    private func makeMainMenu() -> NSMenu {
        let main = NSMenu(title: appName)

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: appName)
        appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let bridgeItem = NSMenuItem()
        let bridgeMenu = NSMenu(title: "Bridge")
        let start = NSMenuItem(title: "Start Service", action: #selector(startServiceMenu(_:)), keyEquivalent: "r")
        start.keyEquivalentModifierMask = [.command]
        start.target = self
        bridgeMenu.addItem(start)
        let stop = NSMenuItem(title: "Stop Service", action: #selector(stopServiceMenu(_:)), keyEquivalent: ".")
        stop.keyEquivalentModifierMask = [.command]
        stop.target = self
        bridgeMenu.addItem(stop)
        bridgeMenu.addItem(.separator())
        let web = NSMenuItem(title: "Open Web Console", action: #selector(openWebConsoleMenu(_:)), keyEquivalent: "o")
        web.keyEquivalentModifierMask = [.command]
        web.target = self
        bridgeMenu.addItem(web)
        bridgeItem.submenu = bridgeMenu
        main.addItem(bridgeItem)

        return main
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var selection: AppWorkspace? = .dashboard

    var body: some View {
        HStack(spacing: 0) {
            AppSidebar(selection: $selection)
                .frame(minWidth: 268, idealWidth: 268, maxWidth: 268)
                .background(.regularMaterial)
                .layoutPriority(2)
            Divider()
            VStack(spacing: 0) {
                CompactStatusBar()
                Divider()
                MainWorkspace(selection: selection ?? .dashboard)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .layoutPriority(1)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

enum AppWorkspace: String, CaseIterable, Identifiable {
    case dashboard
    case connector
    case tutorial
    case policy
    case tools
    case trace
    case codex
    case exchange

    var id: String { rawValue }

    var title: String {
        title(language: .en)
    }

    func title(language: AppLanguage) -> String {
        switch self {
        case .dashboard: return language == .zh ? "总览" : "Dashboard"
        case .connector: return language == .zh ? "连接器设置" : "Connector Setup"
        case .tutorial: return language == .zh ? "创建教程" : "Setup Guide"
        case .policy: return language == .zh ? "策略中心" : "Policy Center"
        case .tools: return language == .zh ? "工具目录" : "Tool Catalog"
        case .trace: return language == .zh ? "调用记录" : "Trace Studio"
        case .codex: return language == .zh ? "Codex 任务" : "Codex Runner"
        case .exchange: return language == .zh ? "文件交换" : "Files & Exchange"
        }
    }

    var subtitle: String {
        subtitle(language: .en)
    }

    func subtitle(language: AppLanguage) -> String {
        switch self {
        case .dashboard: return language == .zh ? "服务、风险、最近调用" : "service, risks, recent calls"
        case .connector: return language == .zh ? "ChatGPT 连接器字段" : "ChatGPT connector fields"
        case .tutorial: return language == .zh ? "复刻 ChatGPT New App 表单" : "ChatGPT New App form mirror"
        case .policy: return language == .zh ? "根目录、技能、Shell 规则" : "roots, skills, shell rules"
        case .tools: return language == .zh ? "分层 MCP 工具面" : "tiered MCP tool surface"
        case .trace: return language == .zh ? "时间线、表格、详情" : "timeline, table, inspector"
        case .codex: return language == .zh ? "本地 Codex CLI 任务" : "local Codex CLI tasks"
        case .exchange: return language == .zh ? "读取、打包、下载" : "reads, bundles, downloads"
        }
    }

    var symbol: String {
        switch self {
        case .dashboard: return "gauge.with.dots.needle.67percent"
        case .connector: return "point.3.connected.trianglepath.dotted"
        case .tutorial: return "list.clipboard.fill"
        case .policy: return "checklist.checked"
        case .tools: return "wrench.and.screwdriver.fill"
        case .trace: return "waveform.path.ecg.rectangle"
        case .codex: return "sparkles.rectangle.stack.fill"
        case .exchange: return "arrow.left.arrow.right.square.fill"
        }
    }

    var tint: Color {
        switch self {
        case .dashboard: return .green
        case .connector: return .blue
        case .tutorial: return .red
        case .policy: return .indigo
        case .tools: return .teal
        case .trace: return .orange
        case .codex: return .purple
        case .exchange: return .cyan
        }
    }
}

struct AppSidebar: View {
    @EnvironmentObject private var model: BridgeModel
    @Binding var selection: AppWorkspace?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(appName)
                        .font(.system(size: 13, weight: .bold))
                    Text(model.isOnline ? model.tr("Local bridge online", "本地桥接在线") : model.tr("Service offline", "服务离线"))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(14)

            List(AppWorkspace.allCases, selection: $selection) { workspace in
                SidebarWorkspaceRow(workspace: workspace)
                    .tag(workspace)
            }
            .listStyle(.sidebar)

            VStack(alignment: .leading, spacing: 10) {
                Button {
                    selection = .connector
                } label: {
                    SidebarStatusPill(
                        title: model.authModeLabel,
                        value: model.connectorUrlDisplay,
                        symbol: model.status?.oauthEnabled == true ? "lock.fill" : "lock.open.fill",
                        tint: model.status?.oauthEnabled == true ? .green : .orange
                    )
                }
                .buttonStyle(.plain)
                .help(model.tr("Open connector setup", "打开连接器设置"))

                Button {
                    selection = .tools
                } label: {
                    SidebarStatusPill(
                        title: model.tr("Tools", "工具"),
                        value: model.toolCountLabel,
                        symbol: "wrench.and.screwdriver.fill",
                        tint: .teal
                    )
                }
                .buttonStyle(.plain)
                .help(model.tr("Open tool catalog", "打开工具目录"))
            }
            .padding(12)
        }
        .frame(minWidth: 268, maxWidth: 268)
        .clipped()
    }
}

struct SidebarWorkspaceRow: View {
    @EnvironmentObject private var model: BridgeModel
    let workspace: AppWorkspace

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(workspace.title(language: model.language))
                    .font(.system(size: 13, weight: .semibold))
                Text(workspace.subtitle(language: model.language))
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: workspace.symbol)
                .foregroundStyle(workspace.tint)
        }
        .padding(.vertical, 3)
    }
}

struct SidebarStatusPill: View {
    let title: String
    let value: String
    let symbol: String
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 11, weight: .bold))
                Text(value)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct CompactStatusBar: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                StatusDot(online: model.isOnline)
                Text(model.isOnline ? model.tr("Online", "在线") : model.tr("Offline", "离线"))
                    .font(.system(size: 13, weight: .bold))
                Text(":\(model.port)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)

                Divider()
                    .frame(height: 18)

                StatusBadge(title: model.authModeLabel, symbol: model.status?.oauthEnabled == true ? "lock.fill" : "lock.open.fill", tint: model.status?.oauthEnabled == true ? .green : .orange)
                StatusBadge(title: model.toolCountLabel, symbol: "wrench.and.screwdriver.fill", tint: .teal)
                StatusBadge(title: model.tr("\(model.connectorActivity.toolCalls.count) calls", "\(model.connectorActivity.toolCalls.count) 次调用"), symbol: "waveform.path.ecg", tint: .blue)
                if model.profileRestartRequired {
                    StatusBadge(title: model.tr("restart required", "需要重启"), symbol: "arrow.triangle.2.circlepath", tint: .orange)
                }

                if let firstRisk = model.riskAlerts.first {
                    StatusBadge(title: firstRisk.title, symbol: firstRisk.symbol, tint: firstRisk.tint)
                }

                Spacer(minLength: 18)

                if let message = model.lastError, !message.isEmpty {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.orange)
                        .lineLimit(1)
                        .frame(maxWidth: 260, alignment: .trailing)
                }

                Button { model.toggleLanguage() } label: {
                    Label(model.language.toggleLabel, systemImage: "globe")
                }
                .help(model.tr("Switch language", "切换语言"))
                Button { Task { await model.refresh() } } label: {
                    Label(model.tr("Refresh", "刷新"), systemImage: "arrow.clockwise")
                }
                Button { Task { await model.startService() } } label: {
                    Label(model.tr("Start", "启动"), systemImage: "play.fill")
                }
                .disabled(model.isStarting || model.isOnline)
                Button { Task { await model.restartService() } } label: {
                    Label(model.tr("Restart", "重启"), systemImage: "arrow.triangle.2.circlepath")
                }
                Button { Task { await model.stopService() } } label: {
                    Label(model.tr("Stop", "停止"), systemImage: "stop.fill")
                }
                .disabled(!model.isOnline)
            }
            .frame(minWidth: 1040, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(.regularMaterial)
    }
}

struct StatusDot: View {
    let online: Bool

    var body: some View {
        Circle()
            .fill(online ? Color.green : Color.red)
            .frame(width: 9, height: 9)
            .shadow(color: (online ? Color.green : Color.red).opacity(0.35), radius: 5)
    }
}

struct StatusBadge: View {
    let title: String
    let symbol: String
    let tint: Color

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.system(size: 11, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(tint.opacity(0.12))
            .foregroundStyle(tint)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct MainWorkspace: View {
    let selection: AppWorkspace

    var body: some View {
        ScrollView(.vertical, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 16) {
                WorkspaceTitle(workspace: selection)
                WorkspaceInlineInspector(workspace: selection)

                switch selection {
                case .dashboard:
                    DashboardView()
                case .connector:
                    ConnectorWizardView()
                case .tutorial:
                    ConnectorSetupGuideView()
                case .policy:
                    PolicyCenterWorkspaceView()
                case .tools:
                    ToolCatalogWorkspaceView()
                case .trace:
                    TraceStudioView()
                case .codex:
                    CodexRunnerView()
                case .exchange:
                    ExchangeWorkspaceView()
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .id(selection)
        .defaultScrollAnchor(.topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct WorkspaceTitle: View {
    @EnvironmentObject private var model: BridgeModel
    let workspace: AppWorkspace

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(workspace.tint.opacity(0.14))
                Image(systemName: workspace.symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(workspace.tint)
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 2) {
                Text(workspace.title(language: model.language))
                    .font(.system(size: 20, weight: .bold))
                Text(workspace.subtitle(language: model.language))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

struct WorkspaceInlineInspector: View {
    @EnvironmentObject private var model: BridgeModel
    let workspace: AppWorkspace

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 10) {
                PanelHeader(title: model.tr("Context", "上下文"), symbol: "sidebar.squares.leading")
                Spacer()
                StatusBadge(title: model.tr("Merged inspector", "已合并右栏"), symbol: "rectangle.compress.vertical", tint: .secondary)
            }

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 138), spacing: 10, alignment: .top)],
                alignment: .leading,
                spacing: 10
            ) {
                InlineInspectorMetric(label: model.tr("Service", "服务"), value: model.isOnline ? model.tr("Online", "在线") : model.tr("Offline", "离线"), symbol: model.isOnline ? "checkmark.circle.fill" : "xmark.circle.fill", tint: model.isOnline ? .green : .red)
                InlineInspectorMetric(label: model.tr("Port", "端口"), value: model.port, symbol: "network", tint: .blue)
                InlineInspectorMetric(label: model.tr("Auth", "认证"), value: model.authModeLabel, symbol: model.status?.oauthEnabled == true ? "lock.fill" : "lock.open.fill", tint: model.status?.oauthEnabled == true ? .green : .orange)
                InlineInspectorMetric(label: model.tr("Tools", "工具"), value: model.toolCountLabel, symbol: "wrench.and.screwdriver.fill", tint: .teal)
                InlineInspectorMetric(label: model.tr("Calls", "调用"), value: "\(model.connectorActivity.toolCalls.count)", symbol: "waveform.path.ecg", tint: .orange)
                InlineInspectorMetric(label: model.tr("Workspace", "工作区"), value: workspace.title(language: model.language), symbol: workspace.symbol, tint: workspace.tint)
            }

            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(model.tr("Connector URL", "连接器 URL"))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Text(model.connectorURL)
                            .font(.system(size: 11, design: .monospaced))
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                        Button { model.copyConnectorURL() } label: {
                            Label(model.tr("Copy URL", "复制 URL"), systemImage: "doc.on.doc")
                        }
                        .controlSize(.small)
                        Button { model.copyConnectorNewAppFields() } label: {
                            Label(model.tr("Copy Fields", "复制字段"), systemImage: "list.clipboard")
                        }
                        .controlSize(.small)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 7) {
                    Button { model.openLogs() } label: { Label(model.tr("Logs", "日志"), systemImage: "text.page") }
                    Button { model.openPolicy() } label: { Label(model.tr("Policy", "策略"), systemImage: "doc.text") }
                    Button { model.revealDataDir() } label: { Label(model.tr("Data", "数据"), systemImage: "folder") }
                    Button { model.openWebConsole() } label: { Label(model.tr("Web", "网页"), systemImage: "safari") }
                }
                .labelStyle(.iconOnly)
            }

            if !model.riskAlerts.isEmpty {
                HStack(spacing: 8) {
                    Text(model.tr("Risks", "风险"))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.secondary)
                    ForEach(model.riskAlerts.prefix(3)) { alert in
                        StatusBadge(title: alert.title, symbol: alert.symbol, tint: alert.tint)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(12)
        .background(PanelBackground())
    }
}

struct InlineInspectorMetric: View {
    let label: String
    let value: String
    let symbol: String
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.system(size: 11, weight: .semibold, design: value.count > 12 ? .monospaced : .default))
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct HeaderView: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        HStack(spacing: 14) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 42, height: 42)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(appName)
                    .font(.system(size: 18, weight: .semibold))
                Text("Native macOS console for the ChatGPT connector, local traces, and bundled Rust launcher")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let message = model.lastError, !message.isEmpty {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.orange)
                    .lineLimit(1)
                    .frame(maxWidth: 320, alignment: .trailing)
            }

            Button {
                Task { await model.refresh() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }

            Button {
                Task { await model.startService() }
            } label: {
                Label("Start", systemImage: "play.fill")
            }
            .disabled(model.isStarting || model.isOnline)

            Button {
                Task { await model.stopService() }
            } label: {
                Label("Stop", systemImage: "stop.fill")
            }
            .disabled(!model.isOnline)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(.regularMaterial)
    }
}

struct DashboardView: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                StatusGrid()
                PrimaryActionPanel()
            }

            RiskOverviewPanel()

            HStack(alignment: .top, spacing: 16) {
                RecentCallsCompactPanel()
                RuntimePanel()
            }
        }
    }
}

struct PrimaryActionPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: model.tr("Primary Actions", "主要操作"), symbol: "bolt.fill")
            Button { Task { await model.startService() } } label: {
                Label(model.tr("Start", "启动"), systemImage: "play.fill")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .disabled(model.isStarting || model.isOnline)
            Button { Task { await model.stopService() } } label: {
                Label(model.tr("Stop", "停止"), systemImage: "stop.fill")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .disabled(!model.isOnline)
            Button { Task { await model.restartService() } } label: {
                Label(model.tr("Restart", "重启"), systemImage: "arrow.triangle.2.circlepath")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button { model.openChatGPT() } label: {
                Label("Open ChatGPT", systemImage: "safari")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button { model.copyConnectorURL() } label: {
                Label(model.tr("Copy Connector URL", "复制连接器 URL"), systemImage: "link")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button { model.copyConnectorNewAppFields() } label: {
                Label(model.tr("Copy New App Fields", "复制新应用字段"), systemImage: "doc.on.clipboard")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button { model.copyConnectorSetupSteps() } label: {
                Label(model.tr("Copy Setup Steps", "复制配置步骤"), systemImage: "list.clipboard")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            MiniConnectorField(label: model.tr("Name", "名称"), value: model.suggestedConnectorAppName)
            MiniConnectorField(label: model.tr("Connection", "连接"), value: model.connectorURL)
            MiniConnectorField(label: model.tr("Authentication", "认证"), value: model.authModeLabel)
            Text(model.connectorUrlDisplay)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
        .padding(14)
        .frame(width: 240, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct MiniConnectorField: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 11, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct RiskOverviewPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: model.tr("Current Risk Signals", "当前风险信号"), symbol: "shield.lefthalf.filled")
            if model.riskAlerts.isEmpty {
                Label(model.tr("No active risk signal in the current policy snapshot.", "当前策略快照没有活跃风险。"), systemImage: "checkmark.shield.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.green)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.green.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 10)], spacing: 10) {
                    ForEach(model.riskAlerts) { alert in
                        RiskAlertCard(alert: alert)
                    }
                }
            }
        }
        .padding(14)
        .background(PanelBackground())
    }
}

struct RiskAlertCard: View {
    let alert: RiskAlert

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: alert.symbol)
                .foregroundStyle(alert.tint)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 4) {
                Text(alert.title)
                    .font(.system(size: 12, weight: .bold))
                Text(alert.detail)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(alert.tint.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct RecentCallsCompactPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: model.tr("Recent 5 Tool Calls", "最近 5 次工具调用"), symbol: "clock.arrow.circlepath")
            if model.connectorActivity.toolCalls.isEmpty {
                EmptyState(text: model.tr("No connector calls yet.", "还没有连接器调用。"))
            } else {
                VStack(spacing: 8) {
                    ForEach(Array(model.connectorActivity.toolCalls.prefix(5))) { call in
                        ToolCallRow(call: call)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ConnectorWizardView: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var routeToAdd: ConnectorRoute = .macMini

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                ConnectorMachineList(routeToAdd: $routeToAdd)
                    .frame(width: 270)
                ConnectorMachineEditor()
            }

            ConnectorRouteGuide()

            HStack(alignment: .top, spacing: 16) {
                AuthModeRiskPanel()
                ConnectorPromptPanel()
            }
        }
    }
}

struct ConnectorSetupGuideView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ChatGPTNewAppReplicaPanel()
        }
    }
}

struct ConnectorMachineList: View {
    @EnvironmentObject private var model: BridgeModel
    @Binding var routeToAdd: ConnectorRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Machines", symbol: "server.rack")

            HStack(spacing: 8) {
                Picker("New machine", selection: $routeToAdd) {
                    ForEach(ConnectorRoute.allCases) { route in
                        Label(route.title, systemImage: route.symbol).tag(route)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity)

                Button {
                    model.addConnectorMachine(route: routeToAdd)
                } label: {
                    Label("Add", systemImage: "plus.circle.fill")
                }
            }

            VStack(spacing: 7) {
                ForEach(model.connectorMachines) { machine in
                    ConnectorMachineRow(
                        machine: machine,
                        isSelected: machine.id == model.selectedConnectorMachineID
                    )
                    .onTapGesture {
                        model.selectConnectorMachine(machine.id)
                    }
                }
            }

            if model.connectorMachines.isEmpty {
                EmptyState(text: "Add Mac mini, Linux, or tunnel connector profiles.")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ConnectorMachineRow: View {
    let machine: ConnectorMachineProfile
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: machine.route.symbol)
                .foregroundStyle(machine.route.tint)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(machine.name)
                    .font(.system(size: 12, weight: .bold))
                    .lineLimit(1)
                Text(machine.connectorBaseLabel)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
            ToolBadge(text: machine.authMode.shortLabel, tint: machine.authMode.tint)
        }
        .padding(10)
        .background(isSelected ? Color.accentColor.opacity(0.13) : Color(nsColor: .controlBackgroundColor))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(isSelected ? Color.accentColor.opacity(0.45) : Color.clear, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct ConnectorMachineEditor: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                PanelHeader(title: "Fields", symbol: "rectangle.and.pencil.and.ellipsis")
                Spacer()
                Button { model.copySelectedConnectorFields() } label: {
                    Label("Fields", systemImage: "doc.on.doc")
                }
                .disabled(model.selectedConnectorMachine == nil)
                Button { model.copySelectedConnectorURL() } label: {
                    Label("URL", systemImage: "link")
                }
                .disabled(model.selectedConnectorMachine == nil)
            }

            if let machine = model.selectedConnectorMachine {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        ConnectorEditableField(label: "Name", text: model.selectedMachineStringBinding(\.name))
                        ConnectorEditableField(label: "Server URL", text: model.selectedMachineStringBinding(\.baseURL))
                    }

                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Route")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.secondary)
                            Picker("Route", selection: model.selectedMachineRouteBinding()) {
                                ForEach(ConnectorRoute.allCases) { route in
                                    Label(route.title, systemImage: route.symbol).tag(route)
                                }
                            }
                            .labelsHidden()
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Auth")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.secondary)
                            Picker("Auth", selection: model.selectedMachineAuthBinding()) {
                                ForEach(ConnectorAuthMode.allCases) { mode in
                                    Text(mode.title).tag(mode)
                                }
                            }
                            .labelsHidden()
                        }
                    }

                    ConnectorEditableField(label: "Approved root hint", text: model.selectedMachineStringBinding(\.workspaceRoot))
                    ConnectorEditableField(label: "Notes", text: model.selectedMachineStringBinding(\.notes))

                    HStack(spacing: 8) {
                        ToolBadge(text: machine.route.title, tint: machine.route.tint)
                        ToolBadge(text: machine.authMode.title, tint: machine.authMode.tint)
                        ToolBadge(text: model.connectorURL(for: machine).hasPrefix("https://") ? "HTTPS" : "local/plain", tint: model.connectorURL(for: machine).hasPrefix("https://") ? .green : .orange)
                        if !machine.updatedAt.isEmpty {
                            Text("updated \(machine.updatedAt)")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Button(role: .destructive) {
                            model.deleteSelectedConnectorMachine()
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .disabled(model.connectorMachines.count <= 1)
                    }

                    ConnectorFieldSummary(machine: machine)
                }
            } else {
                EmptyState(text: "Select or add a connector machine profile.")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ConnectorEditableField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.secondary)
            TextField(label, text: $text)
                .font(.system(size: 12, design: .monospaced))
                .textFieldStyle(.roundedBorder)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ConnectorFieldSummary: View {
    @EnvironmentObject private var model: BridgeModel
    let machine: ConnectorMachineProfile

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ConnectorFieldRow(label: "Name", value: machine.name)
            ConnectorFieldRow(label: "URL", value: model.connectorURL(for: machine))
            ConnectorFieldRow(label: "Auth", value: machine.authMode.chatGPTLabel)
            ConnectorFieldRow(label: "Resource", value: model.connectorURL(for: machine))
        }
    }
}

struct ConnectorRouteGuide: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        let route = model.selectedConnectorMachine?.route ?? .macMini
        ConnectorRouteCard(route: route)
    }
}

enum ConnectorRoute: String, CaseIterable, Identifiable, Codable {
    case macMini
    case linux
    case secureTunnel
    case cloudflare
    case ngrok

    var id: String { rawValue }

    var title: String {
        switch self {
        case .macMini: return "Mac mini"
        case .linux: return "Linux"
        case .secureTunnel: return "Secure Tunnel"
        case .cloudflare: return "Cloudflare"
        case .ngrok: return "ngrok"
        }
    }

    var shortTitle: String {
        switch self {
        case .secureTunnel: return "Secure"
        default: return title
        }
    }

    var defaultName: String {
        switch self {
        case .macMini: return "chatgpt2localagent-macmini"
        case .linux: return "chatgpt2localagent-linux"
        case .secureTunnel: return "chatgpt2localagent-secure-tunnel"
        case .cloudflare: return "chatgpt2localagent-cloudflare"
        case .ngrok: return "chatgpt2localagent-ngrok"
        }
    }

    var symbol: String {
        switch self {
        case .macMini: return "macmini"
        case .linux: return "server.rack"
        case .secureTunnel: return "lock.shield.fill"
        case .cloudflare: return "cloud.fill"
        case .ngrok: return "globe"
        }
    }

    var tint: Color {
        switch self {
        case .macMini: return .blue
        case .linux: return .teal
        case .secureTunnel: return .green
        case .cloudflare: return .orange
        case .ngrok: return .pink
        }
    }

    var auth: String {
        switch self {
        case .secureTunnel: return "OAuth or workspace tunnel policy"
        default: return "OAuth recommended"
        }
    }

    var note: String {
        switch self {
        case .macMini: return "Run the bridge beside your local files, expose /mcp with a fixed HTTPS tunnel, then authorize ChatGPT."
        case .linux: return "Run a separate bridge on the Linux machine. Keep that connector and policy separate from Mac mini."
        case .secureTunnel: return "Best public-safe route when available: private MCP server without a public inbound URL."
        case .cloudflare: return "Good for long-running lab and server routes. Treat the public URL as sensitive."
        case .ngrok: return "Fastest fixed-domain setup for demos. Use launchd/service plus OAuth for stability."
        }
    }
}

enum ConnectorAuthMode: String, CaseIterable, Identifiable, Codable {
    case oauth
    case noAuth
    case mixed
    case secureTunnel

    var id: String { rawValue }

    var title: String {
        switch self {
        case .oauth: return "OAuth"
        case .noAuth: return "No auth"
        case .mixed: return "Mixed"
        case .secureTunnel: return "Secure Tunnel"
        }
    }

    var shortLabel: String {
        switch self {
        case .oauth: return "OAuth"
        case .noAuth: return "none"
        case .mixed: return "mixed"
        case .secureTunnel: return "tunnel"
        }
    }

    var chatGPTLabel: String {
        switch self {
        case .oauth: return "OAuth"
        case .noAuth: return "Unauthenticated"
        case .mixed: return "Mixed OAuth / unauthenticated"
        case .secureTunnel: return "Secure MCP Tunnel"
        }
    }

    var tint: Color {
        switch self {
        case .oauth, .secureTunnel: return .green
        case .noAuth: return .orange
        case .mixed: return .purple
        }
    }
}

struct ConnectorMachineProfile: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var route: ConnectorRoute
    var baseURL: String
    var authMode: ConnectorAuthMode
    var workspaceRoot: String
    var notes: String
    var enabled: Bool
    var updatedAt: String

    var connectorBaseLabel: String {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "URL not set" }
        return trimmed
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
    }
}

struct ConnectorMachinesDocument: Codable {
    var selectedID: String
    var machines: [ConnectorMachineProfile]
}

struct ConnectorRouteCard: View {
    let route: ConnectorRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: route.symbol)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 2) {
                    Text(route.title)
                        .font(.system(size: 18, weight: .bold))
                    Text(route.auth)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }
            Text(route.note)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                ConnectorStep(index: 1, text: "Start bridge service")
                ConnectorStep(index: 2, text: "Expose HTTPS /mcp endpoint")
                ConnectorStep(index: 3, text: "Create ChatGPT connector")
                ConnectorStep(index: 4, text: "Authorize and run test prompt")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ConnectorStep: View {
    let index: Int
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Text("\(index)")
                .font(.system(size: 11, weight: .bold))
                .frame(width: 22, height: 22)
                .background(Circle().fill(Color.blue.opacity(0.12)))
                .foregroundStyle(.blue)
            Text(text)
                .font(.system(size: 12, weight: .medium))
        }
    }
}

struct ChatGPTNewAppReplicaPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                PanelHeader(title: "ChatGPT New App Form", symbol: "square.and.pencil")
                Button { model.copyConnectorNewAppFields() } label: {
                    Label("Copy All", systemImage: "doc.on.clipboard")
                }
                Button { model.copyConnectorURL() } label: {
                    Label("Copy Server URL", systemImage: "link")
                }
            }
            NewAppOrderNotice()

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 420), spacing: 16, alignment: .top)],
                alignment: .leading,
                spacing: 16
            ) {
                VStack(alignment: .leading, spacing: 12) {
                    NewAppSection(title: "New App", symbol: "app.badge") {
                        NewAppOrderLabel(text: "Step 1: fill these fields from top to bottom.")
                        NewAppInputRow(label: "Name", value: model.suggestedConnectorAppName, copyAction: model.copyConnectorAppName)
                        NewAppInputRow(label: "Description", value: model.suggestedConnectorDescription, copyAction: model.copyConnectorDescription)
                        NewAppSegmentRow(label: "Connection", selected: "Server URL", options: ["Server URL", "Tunnel"])
                        NewAppInputRow(label: "Server URL", value: model.connectorURL, copyAction: model.copyConnectorURL)
                        NewAppSelectRow(label: "Authentication", value: "OAuth")
                        NewAppDisclosureRow(
                            title: "Advanced OAuth settings",
                            detail: "Review discovered OAuth settings, then use Dynamic Client Registration."
                        )
                        NewAppWarningRow(
                            title: "Custom MCP servers introduce risk.",
                            detail: "Check this only after verifying the URL belongs to your own bridge."
                        )
                        NewAppCheckboxRow(title: "I understand and want to continue", checked: false)
                    }

                    NewAppSection(title: "Create", symbol: "checkmark.circle") {
                        NewAppOrderLabel(text: "Step 4: create the app only after scopes and endpoints look correct.")
                        NewAppStepRow(index: 1, text: "Paste Name, Description, Server URL, and OAuth.")
                        NewAppStepRow(index: 2, text: "Open Advanced OAuth settings and keep DCR selected.")
                        NewAppStepRow(index: 3, text: "Select workspace:read, workspace:write, and shell:exec.")
                        NewAppStepRow(index: 4, text: "Create, connect, authorize, then paste the bridge unlock code.")
                        NewAppStepRow(index: 5, text: "Start a new chat and test bridge_health.")
                    }

                    NewAppSection(title: "Authorization Page", symbol: "key.horizontal.fill") {
                        NewAppOrderLabel(text: "Step 5: paste unlock code only on the authorization page.")
                        OAuthAuthorizeReplicaCard()
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    NewAppSection(title: "Client Registration", symbol: "person.text.rectangle") {
                        NewAppOrderLabel(text: "Step 2: choose DCR. CIMD unavailable is okay.")
                        NewAppSelectRow(label: "Registration method", value: "Dynamic Client Registration (DCR)")
                        NewAppInfoRow(text: "CIMD can stay unavailable. DCR is enough for this bridge.")
                    }

                    NewAppSection(title: "Scopes", symbol: "checklist.checked") {
                        NewAppOrderLabel(text: "Step 3: select all three default scopes.")
                        NewAppCheckboxRow(title: "workspace:read", checked: true)
                        NewAppCheckboxRow(title: "workspace:write", checked: true)
                        NewAppCheckboxRow(title: "shell:exec", checked: true)
                        NewAppInputRow(label: "Base scopes", value: "Leave blank", copyAction: nil)
                    }

                    NewAppSection(title: "OAuth Endpoints", symbol: "lock.doc") {
                        NewAppOrderLabel(text: "Step 3b: endpoints should match your bridge domain.")
                        NewAppInputRow(label: "Auth URL", value: model.oauthAuthorizationURL, copyAction: { model.copyText(model.oauthAuthorizationURL) })
                        NewAppInputRow(label: "Token URL", value: model.oauthTokenURL, copyAction: { model.copyText(model.oauthTokenURL) })
                        NewAppInputRow(label: "Registration URL", value: model.oauthRegistrationURL, copyAction: { model.copyText(model.oauthRegistrationURL) })
                        NewAppInputRow(label: "Authorization server base", value: model.authorizationServerBaseURL, copyAction: { model.copyText(model.authorizationServerBaseURL) })
                        NewAppInputRow(label: "Resource", value: model.connectorURL, copyAction: model.copyConnectorURL)
                    }

                    NewAppSection(title: "OpenID Support", symbol: "person.crop.circle.badge.questionmark") {
                        NewAppOrderLabel(text: "Step 3c: leave OIDC disabled and blank.")
                        NewAppCheckboxRow(title: "OIDC enabled", checked: false)
                        NewAppInputRow(label: "OIDC configuration URL", value: "Leave blank", copyAction: nil)
                        NewAppInputRow(label: "OIDC userinfo endpoint", value: "Leave blank", copyAction: nil)
                        NewAppInputRow(label: "OIDC scopes supported", value: "Leave blank", copyAction: nil)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct NewAppSection<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(title)
                    .font(.system(size: 12, weight: .bold))
                Spacer()
            }
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct NewAppOrderNotice: View {
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
            Text("Fill in order: 1 New App fields -> 2 DCR -> 3 Scopes/OAuth endpoints -> 4 Create -> 5 paste Bridge unlock code on the authorization page.")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color.red.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct NewAppOrderLabel: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "arrow.right.circle.fill")
                .foregroundStyle(.red)
            Text(text)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(Color.red.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct NewAppInputRow: View {
    let label: String
    let value: String
    let copyAction: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Text(value)
                    .font(.system(size: 11, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
                if let copyAction {
                    Button(action: copyAction) {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.borderless)
                    .help("Copy")
                }
            }
            .padding(8)
            .background(Color(nsColor: .textBackgroundColor))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }
}

struct NewAppSecretRow: View {
    let label: String
    let value: String
    let isAvailable: Bool
    let copyAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Text(value)
                    .font(.system(size: 11, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
                Button(action: copyAction) {
                    Label("Copy Unlock Code", systemImage: "key.fill")
                }
                .controlSize(.small)
                .disabled(!isAvailable)
            }
            .padding(8)
            .background(Color(nsColor: .textBackgroundColor))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(isAvailable ? Color.green.opacity(0.35) : Color.orange.opacity(0.45), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }
}

struct OAuthAuthorizeReplicaCard: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Authorize ChatGPT2LocalBridge")
                    .font(.system(size: 13, weight: .bold))
                Text("Allow ChatGPT to access approved local workspaces on this Mac.")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text("Requested scope:")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
                ForEach(["workspace:read", "workspace:write", "shell:exec"], id: \.self) { scope in
                    Text(scope)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.blue.opacity(0.09))
                        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
            }

            Text("Only continue if you started this connection from ChatGPT.")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            NewAppSecretRow(
                label: "Bridge unlock code",
                value: model.maskedOAuthUnlockCode,
                isAvailable: model.oauthUnlockCodeAvailable,
                copyAction: model.copyOAuthUnlockCode
            )

            Button { model.copyOAuthUnlockCode() } label: {
                Label("Copy code, paste into the box, then click Authorize", systemImage: "key.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.oauthUnlockCodeAvailable)

            NewAppInfoRow(text: "This is not a ChatGPT message. Paste the copied unlock code only into the authorization page input, then click Authorize.")
        }
        .padding(12)
        .background(Color(nsColor: .textBackgroundColor))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color(nsColor: .separatorColor).opacity(0.55), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct NewAppSelectRow: View {
    let label: String
    let value: String

    var body: some View {
        NewAppInputRow(label: label, value: value, copyAction: nil)
    }
}

struct NewAppSegmentRow: View {
    let label: String
    let selected: String
    let options: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.secondary)
            HStack(spacing: 4) {
                ForEach(options, id: \.self) { option in
                    Text(option)
                        .font(.system(size: 10, weight: .bold))
                        .padding(.vertical, 5)
                        .frame(maxWidth: .infinity)
                        .background(option == selected ? Color.accentColor.opacity(0.18) : Color.clear)
                        .foregroundStyle(option == selected ? Color.accentColor : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
            }
            .padding(3)
            .background(Color(nsColor: .textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
    }
}

struct NewAppDisclosureRow: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "chevron.down")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 11, weight: .bold))
                Text(detail)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(Color(nsColor: .textBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct NewAppWarningRow: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.orange)
                Text(detail)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(Color.orange.opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct NewAppCheckboxRow: View {
    let title: String
    let checked: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .foregroundStyle(checked ? Color.accentColor : .secondary)
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(Color(nsColor: .textBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct NewAppStepRow: View {
    let index: Int
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("\(index)")
                .font(.system(size: 10, weight: .bold))
                .frame(width: 20, height: 20)
                .background(Circle().fill(Color.accentColor.opacity(0.12)))
                .foregroundStyle(Color.accentColor)
            Text(text)
                .font(.system(size: 11))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}

struct NewAppInfoRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(8)
            .background(Color.blue.opacity(0.07))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct ConnectorFieldPanel: View {
    @EnvironmentObject private var model: BridgeModel
    let route: ConnectorRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                PanelHeader(title: "ChatGPT Connector Fields", symbol: "rectangle.and.pencil.and.ellipsis")
                Button { model.copyConnectorNewAppFields() } label: {
                    Label("Copy All", systemImage: "doc.on.clipboard")
                }
                Button { model.copyConnectorURL() } label: {
                    Label("Copy URL", systemImage: "link")
                }
            }
            ConnectorFieldRow(label: "Name", value: model.suggestedConnectorAppName)
            ConnectorFieldRow(label: "Description", value: model.suggestedConnectorDescription)
            ConnectorFieldRow(label: "Server URL", value: model.connectorURL)
            ConnectorFieldRow(label: "Authentication", value: route == .secureTunnel ? "Tunnel / OAuth" : "OAuth")
            ConnectorFieldRow(label: "OAuth discovery", value: model.status?.oauthEnabled == true ? "auto from Server URL" : "enable OAuth before public use")
            ConnectorFieldRow(label: "Risk checkbox", value: "Check after verifying this is your own bridge URL.")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ConnectorFieldRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 112, alignment: .leading)
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct AuthModeRiskPanel: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Auth Mode Risk", symbol: "lock.trianglebadge.exclamationmark")
            AuthRiskRow(title: "OAuth", note: "Default for public HTTPS tunnels.", tint: .green, symbol: "checkmark.shield.fill")
            AuthRiskRow(title: "No Authentication", note: "Only for loopback, trusted lab, or short-lived private tests.", tint: .orange, symbol: "exclamationmark.triangle.fill")
            AuthRiskRow(title: "Mixed", note: "Advanced per-tool split. Easy to misconfigure; keep privileged tools protected.", tint: .purple, symbol: "slider.horizontal.3")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct AuthRiskRow: View {
    let title: String
    let note: String
    let tint: Color
    let symbol: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .bold))
                Text(note)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(tint.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct ConnectorPromptPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                PanelHeader(title: "Test Prompt", symbol: "text.bubble.fill")
                Button { model.copySelectedConnectorTestPrompt() } label: {
                    Label("Copy", systemImage: "doc.on.clipboard")
                }
                Button { model.openChatGPT() } label: {
                    Label("Open ChatGPT", systemImage: "safari")
                }
            }
            PromptPreview(
                text: model.connectorTestPrompt,
                placeholder: "Connector test prompt will appear after the connector URL is available."
            )
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct PolicyCenterWorkspaceView: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PolicyCenterPanel()
            HStack(alignment: .top, spacing: 16) {
                PolicyDiffPanel()
                PolicyRiskPanel()
            }
        }
    }
}

struct PolicyDiffPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Apply Preview", symbol: "doc.text.magnifyingglass")
            if model.policyDiffRows.isEmpty {
                EmptyState(text: "No policy diff detected.")
            } else {
                VStack(spacing: 8) {
                    ForEach(model.policyDiffRows) { row in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: row.symbol)
                                .foregroundStyle(row.tint)
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(row.title)
                                    .font(.system(size: 12, weight: .bold))
                                Text(row.detail)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(9)
                        .background(row.tint.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct PolicyRiskPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Policy Risk Checks", symbol: "exclamationmark.shield.fill")
            Toggle("Shell tools enabled", isOn: $model.policyShellEnabled)
                .toggleStyle(.switch)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(model.policyShellEnabled ? .orange : .green)
                .onChange(of: model.policyShellEnabled) { model.policyDraftChanged() }
            ForEach(model.policyBroadRootWarnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(.orange)
            }
            if model.policyBroadRootWarnings.isEmpty {
                Label("Approved roots are not broad in the current draft.", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(.green)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ToolCatalogWorkspaceView: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var query = ""
    @State private var selectedTier: ToolTier? = nil

    private var filteredTools: [ToolCatalogItem] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return model.toolCatalog.filter { tool in
            let matchesTier = selectedTier == nil || tool.tier == selectedTier
            let matchesQuery = needle.isEmpty
                || tool.name.lowercased().contains(needle)
                || (tool.title ?? "").lowercased().contains(needle)
                || (tool.description ?? "").lowercased().contains(needle)
            return matchesTier && matchesQuery
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                ToolProfilePanel()
                ToolTierSummaryPanel()
            }

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        TextField("Search tools", text: $query)
                            .textFieldStyle(.plain)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 34)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                    Picker("Tier", selection: $selectedTier) {
                        Text("All").tag(Optional<ToolTier>.none)
                        ForEach(ToolTier.allCases) { tier in
                            Text(tier.title).tag(Optional(tier))
                        }
                    }
                    .frame(width: 180)
                }

                VStack(spacing: 7) {
                    ToolTableHeader()
                    ForEach(filteredTools) { tool in
                        ToolTableRow(tool: tool, profile: model.toolProfile, lastCall: model.lastCall(forTool: tool.name))
                    }
                }
            }
            .padding(14)
            .background(PanelBackground())
        }
    }
}

struct ToolProfilePanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Tool Profile", symbol: "slider.horizontal.3")
            Picker("Mode", selection: $model.toolProfile) {
                ForEach(ToolProfile.allCases) { profile in
                    Text(profile.title).tag(profile)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: model.toolProfile) { model.toolProfileChanged() }
            Text(model.toolProfile.note)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                let enabled = model.toolCatalog.filter { $0.exposure(in: model.toolProfile).isEnabled }.count
                ToolBadge(text: "\(enabled)/\(model.toolCatalog.count) exposed", tint: .blue)
                ToolBadge(text: model.toolProfile.riskLabel, tint: model.toolProfile.riskTint)
                if model.profileRestartRequired {
                    ToolBadge(text: "restart required", tint: .orange)
                }
            }
            if model.profileRestartRequired {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .foregroundStyle(.orange)
                    Text("Current service is still \(model.runtimeToolProfile.title). Restart to apply \(model.toolProfile.title).")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Button("Restart") {
                        Task { await model.restartService() }
                    }
                    .controlSize(.small)
                }
                .padding(8)
                .background(Color.orange.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ToolTierSummaryPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        HStack(spacing: 10) {
            ForEach(ToolTier.allCases) { tier in
                let total = model.toolCatalog.filter { $0.tier == tier }.count
                let enabled = model.toolCatalog.filter { $0.tier == tier && $0.exposure(in: model.toolProfile).isEnabled }.count
                VStack(alignment: .leading, spacing: 6) {
                    Label(tier.title, systemImage: tier.symbol)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(tier.tint)
                    Text("\(enabled)/\(total)")
                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                    Text(tier.note)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(tier.tint.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ToolTableHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            Text("Tool").frame(maxWidth: .infinity, alignment: .leading)
            Text("State").frame(width: 86, alignment: .leading)
            Text("Tier").frame(width: 90, alignment: .leading)
            Text("Risk").frame(width: 82, alignment: .leading)
            Text("Last Call").frame(width: 112, alignment: .leading)
            Text("Use").frame(width: 110, alignment: .leading)
        }
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 10)
    }
}

struct ToolTableRow: View {
    let tool: ToolCatalogItem
    let profile: ToolProfile
    let lastCall: ToolCall?

    var body: some View {
        let exposure = tool.exposure(in: profile)
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(tool.name)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .lineLimit(1)
                    .textSelection(.enabled)
                Text(tool.description ?? tool.title ?? "")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ToolBadge(text: exposure.stateLabel, tint: exposure.tint)
                .frame(width: 86, alignment: .leading)
            ToolBadge(text: tool.tier.title, tint: tool.tier.tint)
                .frame(width: 90, alignment: .leading)
            ToolBadge(text: tool.riskLabel, tint: tool.riskTint)
                .frame(width: 82, alignment: .leading)
            Text(lastCall?.timeText ?? "-")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 112, alignment: .leading)
            Text(exposure.recommendation)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(exposure.tint)
                .frame(width: 110, alignment: .leading)
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct ToolBadge: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(tint.opacity(0.12))
            .foregroundStyle(tint)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

struct TraceStudioView: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var filter: TraceFilter = .all
    @State private var query = ""
    @State private var grouping: TraceGrouping = .conversation
    @State private var selectedID: String?

    private var filteredItems: [TraceItem] {
        model.traceItems.filter { item in
            let matchesFilter = filter == .all || item.kind == filter || (filter == .error && item.status == "error")
            let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let matchesQuery = needle.isEmpty
                || item.title.lowercased().contains(needle)
                || item.subtitle.lowercased().contains(needle)
                || item.detail.lowercased().contains(needle)
                || (item.sessionId?.lowercased().contains(needle) == true)
                || item.taskId.lowercased().contains(needle)
                || item.projectPath.lowercased().contains(needle)
                || (item.conversationId?.lowercased().contains(needle) == true)
            return matchesFilter && matchesQuery
        }
    }

    private var groupedItems: [TraceItemGroup] {
        var buckets: [String: [TraceItem]] = [:]
        for item in filteredItems {
            let key = grouping.key(for: item)
            buckets[key, default: []].append(item)
        }
        return buckets
            .compactMap { key, items in
                let sorted = items.sorted { $0.date > $1.date }
                guard let first = sorted.first else { return nil }
                return TraceItemGroup(
                    grouping: grouping,
                    key: key,
                    title: grouping.title(for: first),
                    subtitle: grouping.subtitle(for: first),
                    items: sorted
                )
            }
            .sorted { $0.items.first?.date ?? .distantPast > $1.items.first?.date ?? .distantPast }
    }

    private var selectedItem: TraceItem? {
        if let selectedID, let item = filteredItems.first(where: { $0.id == selectedID }) {
            return item
        }
        return filteredItems.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Picker("Filter", selection: $filter) {
                    ForEach(TraceFilter.allCases) { item in
                        Text(item.label).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                Picker("Group By", selection: $grouping) {
                    ForEach(TraceGrouping.allCases) { item in
                        Text(item.label).tag(item)
                    }
                }
                .pickerStyle(.menu)
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search trace", text: $query)
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 10)
                .frame(width: 220, height: 32)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Button { model.copyTraceSummary() } label: { Label("Copy", systemImage: "doc.on.clipboard") }
                Button { model.exportTraceSnapshot() } label: { Label("Export", systemImage: "square.and.arrow.down") }
            }

            HStack(spacing: 10) {
                TraceStatPill(title: "Reads", value: model.traceStats.reads, symbol: "doc.text.magnifyingglass", tint: .blue)
                TraceStatPill(title: "Writes", value: model.traceStats.writes, symbol: "pencil.and.outline", tint: .orange)
                TraceStatPill(title: "Downloads", value: model.traceStats.downloads, symbol: "arrow.down.circle.fill", tint: .green)
                TraceStatPill(title: "Errors", value: model.traceStats.errors, symbol: "exclamationmark.triangle.fill", tint: .red)
                TraceStatPill(title: "Sessions", value: model.traceStats.sessions, symbol: "bubble.left.and.exclamationmark.bubble.right", tint: .indigo)
                TraceStatPill(title: "Tasks", value: model.traceStats.tasks, symbol: "list.bullet.rectangle", tint: .mint)
            }

            HStack(alignment: .top, spacing: 12) {
                TraceTimelineColumn(items: filteredItems, selectedID: $selectedID)
                    .frame(width: 250)
                VStack(alignment: .leading, spacing: 10) {
                    TraceSectionedTableColumn(
                        groups: groupedItems,
                        selectedID: $selectedID,
                        grouping: grouping
                    )
                    if let item = selectedItem {
                        TraceInspectorPanel(item: item)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    } else {
                        EmptyState(text: "Select a trace row.")
                    }
                }
            }
        }
    }
}

struct TraceTimelineColumn: View {
    let items: [TraceItem]
    @Binding var selectedID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: "Timeline", symbol: "timeline.selection")
            if items.isEmpty {
                EmptyState(text: "No trace records.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 7) {
                        ForEach(items.prefix(80)) { item in
                            Button {
                                selectedID = item.id
                            } label: {
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: item.kind.symbol)
                                        .foregroundStyle(item.kind.tint)
                                        .frame(width: 16)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.title)
                                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                            .lineLimit(1)
                                        Text(item.timeLabel)
                                            .font(.system(size: 10, design: .monospaced))
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background((selectedID == item.id ? item.kind.tint.opacity(0.16) : Color(nsColor: .controlBackgroundColor)))
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(minHeight: 420)
            }
        }
        .padding(14)
        .background(PanelBackground())
    }
}

struct TraceSectionedTableColumn: View {
    let groups: [TraceItemGroup]
    @Binding var selectedID: String?
    let grouping: TraceGrouping

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: "Calls Table", symbol: "tablecells")
            TraceTableHeader()
            if groups.isEmpty {
                EmptyState(text: "No rows.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 7, pinnedViews: [.sectionHeaders]) {
                        ForEach(groups) { group in
                            Section {
                                ForEach(group.items.prefix(80)) { item in
                                    TraceTableRow(item: item, selected: selectedID == item.id)
                                        .onTapGesture { selectedID = item.id }
                                }
                            } header: {
                                TraceGroupHeader(group: group, grouping: grouping)
                            }
                        }
                    }
                }
                .frame(minHeight: 420)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct TraceGroupHeader: View {
    let group: TraceItemGroup
    let grouping: TraceGrouping

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: grouping.symbol)
                .foregroundStyle(grouping.tint)
                .frame(width: 16)
            Text(group.title)
                .font(.system(size: 10, weight: .semibold))
            Text(group.subtitle)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text("\(group.items.count)")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(grouping.tint)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(grouping.tint.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct TraceTableHeader: View {
    var body: some View {
        HStack(spacing: 8) {
            Text("Tool").frame(maxWidth: .infinity, alignment: .leading)
            Text("Status").frame(width: 68, alignment: .leading)
            Text("Duration").frame(width: 78, alignment: .leading)
            Text("Path/Error").frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 9)
    }
}

struct TraceTableRow: View {
    let item: TraceItem
    let selected: Bool

    var body: some View {
        HStack(spacing: 8) {
            Label(item.title, systemImage: item.kind.symbol)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(item.kind.tint)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(item.status.isEmpty ? "-" : item.status)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(item.status == "error" ? .red : .secondary)
                .frame(width: 68, alignment: .leading)
            Text(item.durationMs.map { "\($0)ms" } ?? "-")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 78, alignment: .leading)
            Text(item.subtitle.isEmpty ? item.detail : item.subtitle)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(9)
        .background(selected ? item.kind.tint.opacity(0.14) : Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct TraceInspectorPanel: View {
    let item: TraceItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: "Inspector", symbol: "sidebar.right")
            InspectorKV("Kind", item.kind.label)
            InspectorKV("Tool", item.title)
            InspectorKV("Status", item.status.isEmpty ? "-" : item.status)
            InspectorKV("Time", item.timestamp)
            InspectorKV("Duration", item.durationMs.map { "\($0) ms" } ?? "-")
            if let sessionId = item.sessionId, !sessionId.isEmpty {
                InspectorKV("Session", sessionId)
            }
            if !item.taskId.isEmpty {
                InspectorKV("Task", item.taskId)
            }
            if !item.projectPath.isEmpty {
                InspectorKV("Project", item.projectPath)
            }
            if !item.connectorProfile.isEmpty {
                InspectorKV("Connector Profile", item.connectorProfile)
            }
            if let conversation = item.conversationId {
                InspectorKV("Conversation", conversation)
            }
            if let requestId = item.requestId {
                InspectorKV("Request", requestId)
            }
            Divider()
            InspectorBlock(title: "Request / Path", value: item.subtitle)
            InspectorBlock(title: "Result / Error", value: item.detail)
            if let context = item.requestContext {
                Divider()
                InspectorKV("Context Source", context.source)
                if let userAgent = context.userAgent { InspectorKV("UA", userAgent) }
                if let transportSessionId = context.transportSessionId { InspectorKV("HTTP Session", transportSessionId) }
            }
        }
        .padding(14)
        .background(PanelBackground())
    }
}

struct InspectorKV: View {
    let key: String
    let value: String

    init(_ key: String, _ value: String) {
        self.key = key
        self.value = value
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(key)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .leading)
            Text(value)
                .font(.system(size: 11, design: .monospaced))
                .lineLimit(2)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }
}

struct InspectorBlock: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.secondary)
            Text(value.isEmpty ? "-" : value)
                .font(.system(size: 11, design: .monospaced))
                .textSelection(.enabled)
                .lineLimit(8)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}

struct CodexRunnerView: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                CodexPromptPanel()
                CodexQueuePanel(tasks: model.codexTasks)
            }
            HStack(alignment: .top, spacing: 16) {
                CodexLogPanel(tasks: model.codexTasks)
                CodexResultPanel(tasks: model.codexTasks)
            }
        }
    }
}

struct CodexPromptPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                PanelHeader(title: "codex.task_start Prompt", symbol: "sparkles")
                Button { model.copyCodexRunnerPrompt() } label: {
                    Label("Copy", systemImage: "doc.on.clipboard")
                }
            }
            PromptPreview(text: model.codexRunnerPrompt, placeholder: "No approved root available yet.")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct CodexQueuePanel: View {
    let tasks: [CodexTaskRecord]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Task Queue", symbol: "list.bullet.rectangle.portrait")
            if tasks.isEmpty {
                EmptyState(text: "No Codex Runner jobs recorded yet.")
            } else {
                ForEach(tasks.prefix(8)) { task in
                    CodexTaskRow(task: task)
                }
            }
            HStack(spacing: 8) {
                QueueStatePill(title: "running", tint: .orange, count: tasks.filter(\.isRunning).count)
                QueueStatePill(title: "success", tint: .green, count: tasks.filter(\.isSuccess).count)
                QueueStatePill(title: "failed", tint: .red, count: tasks.filter(\.isFailed).count)
                QueueStatePill(title: "cancelled", tint: .secondary, count: tasks.filter(\.isCancelled).count)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct CodexTaskRow: View {
    let task: CodexTaskRecord

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(task.statusTint)
                .frame(width: 8, height: 8)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(task.title)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    Spacer()
                    Text(task.status)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(task.statusTint)
                }
                Text(task.projectPath ?? task.id)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(task.timeText)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct QueueStatePill: View {
    let title: String
    let tint: Color
    let count: Int

    var body: some View {
        Text("\(title) \(count)")
            .font(.system(size: 10, weight: .bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(tint.opacity(0.12))
            .foregroundStyle(tint)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

struct CodexLogPanel: View {
    @EnvironmentObject private var model: BridgeModel
    let tasks: [CodexTaskRecord]

    private var selectedTask: CodexTaskRecord? {
        tasks.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Live Logs", symbol: "terminal")
            Text(model.codexLogPreview(for: selectedTask))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(10)
                .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct CodexResultPanel: View {
    @EnvironmentObject private var model: BridgeModel
    let tasks: [CodexTaskRecord]

    private var selectedTask: CodexTaskRecord? {
        tasks.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Result Preview", symbol: "doc.text.magnifyingglass")
            InspectorBlock(title: "Changed files", value: selectedTask?.changedFileSummary ?? "No changed-file summary yet.")
            InspectorBlock(title: "Diff preview", value: selectedTask?.diffPreview?.nilIfEmpty ?? "Diff preview will appear here when codex.result returns a patch summary.")
            InspectorBlock(title: "Test result", value: selectedTask?.testResult?.nilIfEmpty ?? "Test result will be attached to completed Codex Runner jobs.")
            Button {
                if let selectedTask {
                    model.cancelCodexTask(selectedTask)
                }
            } label: {
                Label("Cancel selected task", systemImage: "xmark.circle.fill")
            }
            .disabled(selectedTask?.isRunning != true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ExchangeWorkspaceView: View {
    @EnvironmentObject private var model: BridgeModel

    private var reads: [TraceItem] {
        model.traceItems.filter { $0.kind == .read || $0.title == "project.bundle" }
    }

    private var downloads: [TraceItem] {
        model.traceItems.filter { $0.kind == .download }
    }

    private var writes: [TraceItem] {
        model.traceItems.filter { $0.kind == .write }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ExchangePanel()
            HStack(alignment: .top, spacing: 16) {
                ExchangeRecordPanel(title: "Local reads", symbol: "doc.text.magnifyingglass", items: reads, tint: .blue)
                ExchangeRecordPanel(title: "Cloud downloads", symbol: "arrow.down.circle.fill", items: downloads, tint: .green)
                ExchangeRecordPanel(title: "Writes / bundles", symbol: "pencil.and.outline", items: writes, tint: .orange)
            }
        }
    }
}

struct ExchangeRecordPanel: View {
    let title: String
    let symbol: String
    let items: [TraceItem]
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(tint)
            if items.isEmpty {
                EmptyState(text: "No records.")
            } else {
                ForEach(items.prefix(6)) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title)
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        Text(item.subtitle)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct WorkspaceInspector: View {
    @EnvironmentObject private var model: BridgeModel
    let workspace: AppWorkspace

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: workspace.symbol)
                        .foregroundStyle(workspace.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(workspace.title(language: model.language))
                            .font(.system(size: 15, weight: .bold))
                        Text(workspace.subtitle(language: model.language))
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }

                Divider()
                InspectorKV(model.tr("Service", "服务"), model.isOnline ? model.tr("Online", "在线") : model.tr("Offline", "离线"))
                InspectorKV(model.tr("Port", "端口"), model.port)
                InspectorKV(model.tr("Auth", "认证"), model.authModeLabel)
                InspectorKV("URL", model.connectorURL)
                InspectorKV(model.tr("Tools", "工具"), model.toolCountLabel)
                InspectorKV(model.tr("Calls", "调用"), "\(model.connectorActivity.toolCalls.count)")

                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.tr("Risks", "风险"))
                        .font(.system(size: 12, weight: .bold))
                    if model.riskAlerts.isEmpty {
                        Label(model.tr("No active risk.", "没有活跃风险。"), systemImage: "checkmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(.green)
                    } else {
                        ForEach(model.riskAlerts) { alert in
                            RiskAlertCard(alert: alert)
                        }
                    }
                }

                Divider()
                SettingsView()
            }
            .padding(16)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelHeader(title: model.tr("Settings", "设置"), symbol: "gearshape.fill")
            Button { model.openLogs() } label: { Label(model.tr("Open logs", "打开日志"), systemImage: "text.page") }
            Button { model.openPolicy() } label: { Label(model.tr("Open policy", "打开策略"), systemImage: "doc.text") }
            Button { model.revealDataDir() } label: { Label(model.tr("Reveal data dir", "显示数据目录"), systemImage: "folder") }
            Button { model.openWebConsole() } label: { Label(model.tr("Open web console", "打开网页控制台"), systemImage: "safari") }
        }
    }
}

struct StatusGrid: View {
    @EnvironmentObject private var model: BridgeModel

    private var publicUrlLabel: String {
        guard let publicBaseUrl = model.status?.publicBaseUrl,
              !publicBaseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "Local only"
        }
        return publicBaseUrl
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
    }

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 132), spacing: 10, alignment: .top)],
            alignment: .leading,
            spacing: 10
        ) {
            MetricTile(
                title: model.tr("Service", "服务"),
                value: model.isOnline ? model.tr("Online", "在线") : model.tr("Offline", "离线"),
                note: model.status?.version ?? model.tr("Rust engine", "Rust 引擎"),
                tint: model.isOnline ? .green : .red,
                symbol: model.isOnline ? "checkmark.circle.fill" : "xmark.circle.fill"
            )
            MetricTile(
                title: model.tr("Port", "端口"),
                value: model.port,
                note: model.tr("localhost listener", "本机监听"),
                tint: .blue,
                symbol: "network"
            )
            MetricTile(
                title: model.tr("Auth", "认证"),
                value: model.authModeLabel,
                note: model.status?.oauthEnabled == true ? model.tr("public-safe default", "公网默认安全") : model.tr("loopback/lab only", "仅本机/实验"),
                tint: model.status?.oauthEnabled == true ? .green : .orange,
                symbol: model.status?.oauthEnabled == true ? "lock.fill" : "lock.open.fill"
            )
            MetricTile(
                title: model.tr("Public URL", "公网 URL"),
                value: model.status?.publicBaseUrl == nil ? model.tr("Local only", "仅本机") : publicUrlLabel,
                note: model.connectorURL,
                tint: model.status?.publicBaseUrl == nil ? .secondary : .blue,
                symbol: "globe"
            )
            MetricTile(
                title: "MCP \(model.tr("Tools", "工具"))",
                value: "\(model.exposedToolCount)/\(model.toolCatalog.count)",
                note: "\(model.toolProfile.title)",
                tint: .teal,
                symbol: "wrench.and.screwdriver.fill"
            )
            MetricTile(
                title: model.tr("Recent Calls", "最近调用"),
                value: "\(model.connectorActivity.toolCalls.count)",
                note: model.tr("\(model.connectorActivity.auditEvents.count) audit events", "\(model.connectorActivity.auditEvents.count) 条审计事件"),
                tint: .orange,
                symbol: "waveform.path.ecg"
            )
        }
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    let note: String
    let tint: Color
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
                Spacer()
                Image(systemName: symbol)
                    .foregroundStyle(tint)
            }
            Text(value)
                .font(.system(size: value.count > 14 ? 15 : 26, weight: .bold, design: value.count > 14 ? .monospaced : .default))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
            Text(note)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .leading)
        .background(PanelBackground())
    }
}

struct RuntimePanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: model.tr("Runtime", "运行时"), symbol: "server.rack")
            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 8) {
                RuntimeRow(model.tr("Connector data", "连接器数据"), model.connectorDataDir.path)
                RuntimeRow(model.tr("Data dir", "数据目录"), model.dataDir.path)
                RuntimeRow(model.tr("Log dir", "日志目录"), model.logDir.path)
                RuntimeRow(model.tr("Policy", "策略"), model.policyPath.path)
                RuntimeRow(model.tr("Engine", "引擎"), model.enginePath)
                RuntimeRow("PID", model.pidText)
                RuntimeRow("OAuth", model.status?.oauthEnabled == true ? model.tr("Enabled", "已启用") : model.tr("Off", "关闭"))
                RuntimeRow(model.tr("Tool profile", "工具配置"), "\(model.runtimeToolProfile.title) \(model.tr("runtime", "运行中")) / \(model.toolProfile.title) \(model.tr("desired", "目标"))")
            }
        }
        .padding(16)
        .background(PanelBackground())
    }
}

struct RuntimeRow: View {
    let key: String
    let value: String

    init(_ key: String, _ value: String) {
        self.key = key
        self.value = value
    }

    var body: some View {
        GridRow {
            Text(key)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 96, alignment: .leading)
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

struct PolicyCenterPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                PanelHeader(title: "Policy Center", symbol: "checklist.checked")
                Button { model.addAllowedRoot() } label: { Label("Root", systemImage: "folder.badge.plus") }
                Button { model.addSkillRoot() } label: { Label("Skill Root", systemImage: "sparkle.magnifyingglass") }
                Button { model.loadPolicyDraft() } label: { Label("Reload", systemImage: "arrow.clockwise") }
                Button { model.savePolicyDraft() } label: { Label("Apply", systemImage: "checkmark.seal.fill") }
                    .disabled(!model.policyDirty || model.policyErrors.contains { $0.severity == .error })
            }

            HStack(alignment: .top, spacing: 16) {
                PolicyPathList(
                    title: "Allowed Roots",
                    symbol: "folder.fill",
                    paths: $model.policyAllowedRoots,
                    onRemove: model.removeAllowedRoot
                )
                PolicyPathList(
                    title: "Skill Roots",
                    symbol: "sparkles",
                    paths: $model.policySkillRoots,
                    onRemove: model.removeSkillRoot
                )
            }

            HStack(alignment: .top, spacing: 16) {
                PolicyTextArea(title: "Deny Globs", text: $model.policyDenyGlobsText)
                VStack(alignment: .leading, spacing: 10) {
                    Toggle("Enable shell tools", isOn: $model.policyShellEnabled)
                        .font(.system(size: 12, weight: .semibold))
                    PolicyTextArea(title: "Shell Deny Patterns", text: $model.policyShellDenyText)
                }
            }

            PolicyValidationStrip(messages: model.policyErrors, savedLabel: model.policyLastSaved)
        }
        .padding(16)
        .background(PanelBackground())
        .onChange(of: model.policyAllowedRoots) { model.policyDraftChanged() }
        .onChange(of: model.policySkillRoots) { model.policyDraftChanged() }
        .onChange(of: model.policyDenyGlobsText) { model.policyDraftChanged() }
        .onChange(of: model.policyShellEnabled) { model.policyDraftChanged() }
        .onChange(of: model.policyShellDenyText) { model.policyDraftChanged() }
    }
}

struct PolicyPathList: View {
    let title: String
    let symbol: String
    @Binding var paths: [String]
    let onRemove: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .foregroundStyle(.blue)
                Text(title)
                    .font(.system(size: 12, weight: .bold))
                Spacer()
                Text("\(paths.count)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            if paths.isEmpty {
                EmptyState(text: "No paths configured.")
            } else {
                VStack(spacing: 7) {
                    ForEach(paths.indices, id: \.self) { index in
                        HStack(spacing: 8) {
                            TextField("Path", text: binding(for: index))
                                .font(.system(size: 11, design: .monospaced))
                                .textFieldStyle(.plain)
                            Button {
                                onRemove(index)
                            } label: {
                                Image(systemName: "minus.circle.fill")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.red)
                        }
                        .padding(9)
                        .background(Color(nsColor: .controlBackgroundColor))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func binding(for index: Int) -> Binding<String> {
        Binding(
            get: { paths.indices.contains(index) ? paths[index] : "" },
            set: { value in
                if paths.indices.contains(index) {
                    paths[index] = value
                }
            }
        )
    }
}

struct PolicyTextArea: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 12, weight: .bold))
            TextEditor(text: $text)
                .font(.system(size: 11, design: .monospaced))
                .frame(minHeight: 104)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

struct PolicyValidationStrip: View {
    let messages: [PolicyValidationMessage]
    let savedLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if !savedLabel.isEmpty {
                Label(savedLabel, systemImage: "clock.badge.checkmark")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            if messages.isEmpty {
                Label("Policy looks ready.", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.green)
            } else {
                ForEach(messages) { message in
                    Label(message.text, systemImage: message.severity.symbol)
                        .font(.system(size: 12))
                        .foregroundStyle(message.severity.tint)
                }
            }
        }
    }
}

struct RootsPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var roots: [String] {
        model.policyAllowedRoots.isEmpty ? model.status?.allowedProjectRoots ?? [] : model.policyAllowedRoots
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Approved Roots", symbol: "folder.badge.gearshape")
            if roots.isEmpty {
                EmptyState(text: "No roots loaded yet.")
            } else {
                ForEach(roots, id: \.self) { root in
                    HStack(spacing: 8) {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(.blue)
                        Text(root)
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .padding(10)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }

            Divider()

            HStack(spacing: 8) {
                Button {
                    model.openPolicy()
                } label: {
                    Label("Open Policy", systemImage: "doc.text")
                }

                Button {
                    model.revealDataDir()
                } label: {
                    Label("Reveal Data", systemImage: "folder")
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

enum ExchangeMode: String, CaseIterable, Identifiable {
    case localToChatGPT = "Local -> ChatGPT"
    case cloudToLocal = "Cloud -> Local"

    var id: String { rawValue }
}

struct ExchangePanel: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var mode: ExchangeMode = .localToChatGPT

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Exchange Desk", symbol: "arrow.left.arrow.right.square.fill")

            Picker("Exchange Mode", selection: $mode) {
                ForEach(ExchangeMode.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)

            ExchangeFlow(mode: mode)

            if mode == .localToChatGPT {
                localBundleControls
            } else {
                cloudDownloadControls
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }

    private var localBundleControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                BundleRow(label: "Root", value: model.bundleRoot.isEmpty ? "No folder selected" : model.bundleRoot)
                BundleRow(label: "Files", value: model.bundleFiles.isEmpty ? "No files selected" : "\(model.bundleFiles.count) selected")
            }

            HStack(spacing: 8) {
                Button { model.chooseBundleRoot() } label: { Label("Choose Root", systemImage: "folder") }
                Button { model.chooseBundleFiles() } label: { Label("Choose Files", systemImage: "doc.on.doc") }
                Button { model.copyBundlePrompt() } label: { Label("Copy Prompt", systemImage: "doc.on.clipboard") }
                    .disabled(model.bundlePrompt.isEmpty)
                Button { model.openChatGPT() } label: { Label("ChatGPT", systemImage: "safari") }
            }

            PromptPreview(
                text: model.bundlePrompt,
                placeholder: "Select a folder and files to prepare a project.bundle prompt for ChatGPT."
            )
        }
    }

    private var cloudDownloadControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                BundleRow(label: "Root", value: model.cloudWorkspaceRoot.isEmpty ? model.exchangeDefaultRootLabel : model.cloudWorkspaceRoot)
                TextField("Cloud download URL", text: $model.cloudDownloadUrl)
                    .textFieldStyle(.roundedBorder)
                TextField("Destination file, for example downloads/report.pdf", text: $model.cloudDestinationFile)
                    .textFieldStyle(.roundedBorder)
                TextField("Expected sha256, optional", text: $model.cloudExpectedSha256)
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: 8) {
                Button { model.chooseCloudWorkspace() } label: { Label("Choose Root", systemImage: "folder") }
                Button { model.copyCloudDownloadPrompt() } label: { Label("Copy Prompt", systemImage: "doc.on.clipboard") }
                    .disabled(model.cloudDownloadPrompt.isEmpty)
                Button { model.openChatGPT() } label: { Label("ChatGPT", systemImage: "safari") }
            }

            PromptPreview(
                text: model.cloudDownloadPrompt,
                placeholder: "Paste a ChatGPT cloud file URL, choose a local destination, then copy the cloud.download prompt."
            )
        }
    }
}

struct ExchangeFlow: View {
    let mode: ExchangeMode

    private var steps: [(String, String)] {
        switch mode {
        case .localToChatGPT:
            return [
                ("1", "Choose local files"),
                ("2", "project.bundle reads"),
                ("3", "ChatGPT creates artifact"),
            ]
        case .cloudToLocal:
            return [
                ("1", "Paste cloud URL"),
                ("2", "cloud.download verifies"),
                ("3", "Write into approved root"),
            ]
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(spacing: 7) {
                    Text(step.0)
                        .font(.system(size: 11, weight: .bold))
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(Color.accentColor.opacity(0.16)))
                    Text(step.1)
                        .font(.system(size: 11, weight: .medium))
                        .lineLimit(1)
                }
                .padding(.horizontal, 9)
                .padding(.vertical, 7)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                if index < steps.count - 1 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct PromptPreview: View {
    let text: String
    let placeholder: String

    var body: some View {
        Text(text.isEmpty ? placeholder : text)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(text.isEmpty ? .secondary : .primary)
            .textSelection(.enabled)
            .lineLimit(9)
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 108, alignment: .topLeading)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct BundleRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .leading)
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
    }
}

struct ToolsPanel: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var query = ""

    var filteredTools: [ToolCatalogItem] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return model.toolCatalog }
        return model.toolCatalog.filter { tool in
            tool.name.lowercased().contains(needle)
                || (tool.title ?? "").lowercased().contains(needle)
                || (tool.description ?? "").lowercased().contains(needle)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "MCP Tools", symbol: "wrench.and.screwdriver.fill")
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search tools", text: $query)
                    .textFieldStyle(.plain)
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            if filteredTools.isEmpty {
                EmptyState(text: "No tools matched.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredTools.prefix(12)) { tool in
                            ToolCatalogRow(tool: tool, profile: model.toolProfile)
                        }
                    }
                }
                .frame(height: 236)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ToolCatalogRow: View {
    let tool: ToolCatalogItem
    let profile: ToolProfile

    var body: some View {
        let exposure = tool.exposure(in: profile)
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(tool.name)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textSelection(.enabled)
                Spacer()
                ToolBadge(text: exposure.stateLabel, tint: exposure.tint)
                ToolBadge(text: tool.riskLabel, tint: tool.riskTint)
            }
            if let description = tool.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if let title = tool.title, !title.isEmpty {
                Text(title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct ActivityPanel: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelHeader(title: "Recent Connector Calls", symbol: "list.bullet.rectangle")
            if model.connectorActivity.toolCalls.isEmpty {
                EmptyState(text: "No tool calls recorded yet.")
            } else {
                VStack(spacing: 8) {
                    ForEach(model.connectorActivity.toolCalls.prefix(8)) { call in
                        ToolCallRow(call: call)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct ToolCallRow: View {
    let call: ToolCall

    var statusColor: Color {
        switch call.status {
        case "ok": return .green
        case "error": return .red
        case "started": return .orange
        default: return .secondary
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(call.tool)
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    Spacer()
                    Text(call.status)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(statusColor)
                }
                Text(call.ts)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                if let args = call.args?.compactDescription, !args.isEmpty {
                    Text(args)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct TracePanel: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var filter: TraceFilter = .all
    @State private var query = ""

    private var filteredItems: [TraceItem] {
        model.traceItems.filter { item in
            let matchesFilter = filter == .all || item.kind == filter || (filter == .error && item.status == "error")
            let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let matchesQuery = needle.isEmpty
                || item.title.lowercased().contains(needle)
                || item.subtitle.lowercased().contains(needle)
                || item.detail.lowercased().contains(needle)
            return matchesFilter && matchesQuery
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                PanelHeader(title: "Visual Trace", symbol: "point.3.connected.trianglepath.dotted")
                Button { model.copyTraceSummary() } label: { Label("Copy", systemImage: "doc.on.clipboard") }
                Button { model.exportTraceSnapshot() } label: { Label("Export", systemImage: "square.and.arrow.down") }
            }

            HStack(spacing: 10) {
                TraceStatPill(title: "Reads", value: model.traceStats.reads, symbol: "doc.text.magnifyingglass", tint: .blue)
                TraceStatPill(title: "Skills", value: model.traceStats.skills, symbol: "sparkles", tint: .mint)
                TraceStatPill(title: "Policy", value: model.traceStats.policies, symbol: "checklist.checked", tint: .indigo)
                TraceStatPill(title: "Writes", value: model.traceStats.writes, symbol: "pencil.and.outline", tint: .orange)
                TraceStatPill(title: "Downloads", value: model.traceStats.downloads, symbol: "arrow.down.circle.fill", tint: .green)
                TraceStatPill(title: "Errors", value: model.traceStats.errors, symbol: "exclamationmark.triangle.fill", tint: .red)
            }

            HStack(spacing: 10) {
                Picker("Trace Filter", selection: $filter) {
                    ForEach(TraceFilter.allCases) { item in
                        Text(item.label).tag(item)
                    }
                }
                .pickerStyle(.segmented)

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search trace", text: $query)
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 10)
                .frame(width: 220, height: 32)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }

            if filteredItems.isEmpty {
                EmptyState(text: "No audit events recorded yet.")
            } else {
                VStack(spacing: 8) {
                    ForEach(filteredItems.prefix(40)) { item in
                        TraceTimelineRow(item: item)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PanelBackground())
    }
}

struct TraceStatPill: View {
    let title: String
    let value: Int
    let symbol: String
    let tint: Color

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
            Text("\(value)")
                .font(.system(size: 13, weight: .bold))
            Text(title)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct TraceTimelineRow: View {
    let item: TraceItem

    var tint: Color { item.kind.tint }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(tint.opacity(0.16))
                        .frame(width: 28, height: 28)
                    Image(systemName: item.kind.symbol)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(tint)
                }
                Rectangle()
                    .fill(tint.opacity(0.2))
                    .frame(width: 2, height: 46)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(item.title)
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    Spacer()
                    if !item.status.isEmpty {
                        Text(item.status.uppercased())
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(item.status == "error" ? .red : tint)
                    }
                    Text(item.timeLabel)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                Text(item.subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(item.detail)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }
            .padding(.vertical, 2)
        }
        .padding(11)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct FooterBar: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(model.isOnline ? Color.green : Color.red)
                .frame(width: 8, height: 8)
            Text(model.isOnline ? "Rust service is reachable on 127.0.0.1:\(model.port)" : "Rust service is offline")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                model.openLogs()
            } label: {
                Label("Logs", systemImage: "text.page")
            }
            Button {
                model.openWebConsole()
            } label: {
                Label("Web Console", systemImage: "safari")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(.regularMaterial)
    }
}

struct PanelHeader: View {
    let title: String
    let symbol: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 14, weight: .bold))
            Spacer()
        }
    }
}

struct EmptyState: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 74)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct PanelBackground: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Color(nsColor: .textBackgroundColor))
            .shadow(color: Color.black.opacity(0.06), radius: 16, x: 0, y: 8)
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.55), lineWidth: 1)
            )
    }
}

@MainActor
final class BridgeModel: ObservableObject {
    @Published var isOnline = false
    @Published var isStarting = false
    @Published var status: BridgeStatus?
    @Published var activity = BridgeActivity.empty
    @Published var connectorActivity = BridgeActivity.empty
    @Published var codexTasks: [CodexTaskRecord] = []
    @Published var toolCatalog: [ToolCatalogItem] = []
    @Published var bundleRoot = ""
    @Published var bundleFiles: [String] = []
    @Published var bundlePrompt = ""
    @Published var cloudWorkspaceRoot = ""
    @Published var cloudDownloadUrl = ""
    @Published var cloudDestinationFile = "downloads/"
    @Published var cloudExpectedSha256 = ""
    @Published var lastError: String?
    @Published var pidText = "-"
    @Published var policyAllowedRoots: [String] = []
    @Published var policySkillRoots: [String] = []
    @Published var policyDenyGlobsText = ""
    @Published var policyShellEnabled = true
    @Published var policyShellDenyText = ""
    @Published var policyErrors: [PolicyValidationMessage] = []
    @Published var policyDirty = false
    @Published var policyLastSaved = ""
    @Published var toolProfile: ToolProfile = .normal
    @Published var runtimeToolProfile: ToolProfile = .normal
    @Published var connectorMachines: [ConnectorMachineProfile] = []
    @Published var selectedConnectorMachineID = ""
    @Published var language: AppLanguage = .en

    let port = ProcessInfo.processInfo.environment["LOCALBRIDGE_PORT"] ?? "3842"
    let connectorDataDir: URL
    let dataDir: URL
    let logDir: URL
    let policyPath: URL
    let tokenPath: URL
    let toolProfilePath: URL
    let languagePath: URL
    let machinesPath: URL
    let pidPath: URL
    let enginePath: String

    private var timer: Timer?
    private var token = ""

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        connectorDataDir = home.appendingPathComponent(".chatgpt2localbridge", isDirectory: true)
        dataDir = home.appendingPathComponent(".chatgpt2localbridge-rs", isDirectory: true)
        logDir = dataDir.appendingPathComponent("logs", isDirectory: true)
        policyPath = dataDir.appendingPathComponent("bridge.policy.json")
        tokenPath = dataDir.appendingPathComponent("dashboard-token")
        toolProfilePath = dataDir.appendingPathComponent("tool-profile")
        languagePath = dataDir.appendingPathComponent("app-language")
        machinesPath = dataDir.appendingPathComponent("machines.json")
        pidPath = dataDir.appendingPathComponent("bridge-rs.pid")
        enginePath = Bundle.main.path(forResource: "chatgpt2localbridge-rs", ofType: nil) ?? ""
    }

    func bootstrap() async {
        do {
            try ensureLocalFiles()
            loadLanguage()
            loadToolProfile()
            loadConnectorMachines()
            loadToolCatalog()
            refreshConnectorActivity()
            loadPolicyDraft()
            token = try String(contentsOf: tokenPath, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            await refresh()
            if !isOnline {
                await startService()
            }
            timer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    await self?.refresh()
                }
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func tr(_ english: String, _ chinese: String) -> String {
        language == .zh ? chinese : english
    }

    func toggleLanguage() {
        language = language == .en ? .zh : .en
        persistLanguage()
    }

    func refresh() async {
        refreshConnectorActivity()
        if toolCatalog.isEmpty {
            loadToolCatalog()
        }

        do {
            let healthURL = URL(string: "http://127.0.0.1:\(port)/health")!
            _ = try await fetchJSON(Health.self, url: healthURL, authorized: false)
            isOnline = true
            lastError = nil

            let statusURL = URL(string: "http://127.0.0.1:\(port)/app/api/status")!
            status = try await fetchJSON(BridgeStatus.self, url: statusURL, authorized: true)
            runtimeToolProfile = ToolProfile(runtimeValue: status?.toolProfile) ?? .normal

            let activityURL = URL(string: "http://127.0.0.1:\(port)/app/api/activity?limit=40")!
            activity = try await fetchJSON(BridgeActivity.self, url: activityURL, authorized: true)
            pidText = readPid() ?? "-"
        } catch {
            isOnline = false
            status = nil
            activity = .empty
            lastError = "Service unreachable"
            pidText = readPid() ?? "-"
        }
    }

    func chooseBundleRoot() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        if panel.runModal() == .OK, let url = panel.url {
            bundleRoot = url.path
            rebuildBundlePrompt()
        }
    }

    func chooseBundleFiles() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true
        panel.prompt = "Choose"
        if !bundleRoot.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: bundleRoot)
        }
        if panel.runModal() == .OK {
            if bundleRoot.isEmpty, let first = panel.urls.first {
                bundleRoot = first.deletingLastPathComponent().path
            }
            let rootURL = URL(fileURLWithPath: bundleRoot)
            bundleFiles = panel.urls
                .map { relativePath(for: $0, root: rootURL) }
                .filter { !$0.isEmpty }
                .sorted()
            rebuildBundlePrompt()
        }
    }

    func copyBundlePrompt() {
        guard !bundlePrompt.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(bundlePrompt, forType: .string)
    }

    func chooseCloudWorkspace() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        if panel.runModal() == .OK, let url = panel.url {
            cloudWorkspaceRoot = url.path
        }
    }

    func copyCloudDownloadPrompt() {
        guard !cloudDownloadPrompt.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(cloudDownloadPrompt, forType: .string)
    }

    var exchangeDefaultRootLabel: String {
        resolvedCloudWorkspaceRoot.isEmpty ? "No approved root selected" : resolvedCloudWorkspaceRoot
    }

    var cloudDownloadPrompt: String {
        let root = resolvedCloudWorkspaceRoot
        let url = cloudDownloadUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let file = cloudDestinationFile.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !url.isEmpty, !file.isEmpty else {
            return ""
        }

        let sha = cloudExpectedSha256.trimmingCharacters(in: .whitespacesAndNewlines)
        let shaLine = sha.isEmpty ? "" : ",\n  \"expectedSha256\": \"\(escapeJSON(sha))\""
        return """
        请使用 ChatGPT2LocalBridge 的 cloud.download 工具，把这个 ChatGPT 云端文件同步到本地批准目录。

        cloud.download 参数：
        {
          "projectPath": "\(escapeJSON(root))",
          "url": "\(escapeJSON(url))",
          "file": "\(escapeJSON(file))",
          "overwrite": false,
          "maxBytes": 52428800\(shaLine)
        }

        完成后请调用 bridge.activity，确认 tool-calls 和 audit.jsonl 里都出现 cloud.download 记录。
        """
    }

    var connectorURL: String {
        let base = effectivePublicBaseUrl
        if !base.isEmpty {
            return mcpURL(from: base)
        }
        return "http://127.0.0.1:\(port)/mcp"
    }

    var effectivePublicBaseUrl: String {
        firstNonEmpty([
            status?.publicBaseUrl,
            ProcessInfo.processInfo.environment["LOCALBRIDGE_PUBLIC_BASE_URL"],
            readLaunchAgentEnv("LOCALBRIDGE_PUBLIC_BASE_URL"),
            readRepoEnvLocalValue("LOCALBRIDGE_PUBLIC_BASE_URL")
        ])
    }

    var connectorUrlDisplay: String {
        connectorURL
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
    }

    var suggestedConnectorAppName: String {
        selectedConnectorMachine?.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? selectedConnectorMachine?.name ?? "attachlocal2chatgpt"
            : "attachlocal2chatgpt"
    }

    var suggestedConnectorDescription: String {
        "Attach approved local Mac files and workspaces to ChatGPT through an OAuth-protected MCP bridge."
    }

    var authModeLabel: String {
        if status?.oauthEnabled == true || nodeBridgeOAuthEnabled {
            return "OAuth"
        }
        return tr("No auth", "未授权")
    }

    var nodeBridgeOAuthEnabled: Bool {
        firstNonEmpty([
            ProcessInfo.processInfo.environment["LOCALBRIDGE_OAUTH_ENABLED"],
            readLaunchAgentEnv("LOCALBRIDGE_OAUTH_ENABLED"),
            readRepoEnvLocalValue("LOCALBRIDGE_OAUTH_ENABLED")
        ]).isTruthy
    }

    var profileRestartRequired: Bool {
        isOnline && runtimeToolProfile != toolProfile
    }

    var exposedToolCount: Int {
        toolCatalog.filter { $0.exposure(in: toolProfile).isEnabled }.count
    }

    var toolCountLabel: String {
        tr("\(exposedToolCount)/\(toolCatalog.count) tools", "\(exposedToolCount)/\(toolCatalog.count) 工具")
    }

    var connectorTestPrompt: String {
        if let machine = selectedConnectorMachine {
            return connectorTestPrompt(for: machine)
        }
        return """
        请调用 ChatGPT2LocalBridge connector，不要使用 Python 或代码解释器。

        1. 先调用 bridge.health 或 bridge.activity 确认连接。
        2. 调用 file.list 或 file.read_path 测试一个已批准 workspace。
        3. 读取完成后回复：使用了哪个 MCP tool、读取路径、前 20 行摘要。

        Connector URL:
        \(connectorURL)
        """
    }

    var selectedConnectorMachine: ConnectorMachineProfile? {
        if let index = selectedConnectorMachineIndex {
            return connectorMachines[index]
        }
        return nil
    }

    func connectorURL(for machine: ConnectorMachineProfile) -> String {
        let base = machine.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if machine.route == .macMini, base.isEmpty || base.isLoopbackBaseURL {
            let liveBase = effectivePublicBaseUrl
            if !liveBase.isEmpty {
                return mcpURL(from: liveBase)
            }
        }
        if base.isEmpty {
            if machine.route == .macMini {
                return connectorURL
            }
            return "https://your-\(machine.route.rawValue)-host.example.com/mcp"
        }
        return mcpURL(from: base)
    }

    func connectorFieldsText(for machine: ConnectorMachineProfile) -> String {
        """
        Name: \(machine.name)
        Description: Local workspace bridge for \(machine.route.title)
        Server URL: \(connectorURL(for: machine))
        Authentication: \(machine.authMode.chatGPTLabel)
        OAuth resource URL: \(connectorURL(for: machine))
        Approved root hint: \(machine.workspaceRoot.isEmpty ? "-" : machine.workspaceRoot)
        """
    }

    var connectorNewAppFieldsText: String {
        """
        ChatGPT New App fields

        Name:
        \(suggestedConnectorAppName)

        Description:
        \(suggestedConnectorDescription)

        Connection:
        Server URL: \(connectorURL)

        Authentication:
        OAuth

        Advanced OAuth settings:
        Registration method: Dynamic Client Registration (DCR)

        Scopes:
        workspace:read
        workspace:write
        shell:exec

        OAuth endpoints:
        Auth URL: \(oauthAuthorizationURL)
        Token URL: \(oauthTokenURL)
        Registration URL: \(oauthRegistrationURL)
        Authorization server base: \(authorizationServerBaseURL)
        Resource: \(connectorURL)

        OIDC:
        Disabled / leave blank.

        Authorization page:
        Bridge unlock code: copy it from this app's Authorization Page card.
        Paste it only into the "Bridge unlock code" input, then click Authorize.

        Safety checkbox:
        Check "I understand and want to continue" only if this URL points to your own bridge.
        """
    }

    var authorizationServerBaseURL: String {
        let base = effectivePublicBaseUrl
        if !base.isEmpty {
            return base.trimmingTrailingSlashes
        }
        return "http://127.0.0.1:\(port)"
    }

    var oauthAuthorizationURL: String {
        "\(authorizationServerBaseURL)/oauth/authorize"
    }

    var oauthTokenURL: String {
        "\(authorizationServerBaseURL)/oauth/token"
    }

    var oauthRegistrationURL: String {
        "\(authorizationServerBaseURL)/oauth/register"
    }

    var oauthUnlockCode: String {
        firstNonEmpty([
            ProcessInfo.processInfo.environment["LOCALBRIDGE_OAUTH_UNLOCK_CODE"],
            readLaunchAgentEnv("LOCALBRIDGE_OAUTH_UNLOCK_CODE"),
            readRepoEnvLocalValue("LOCALBRIDGE_OAUTH_UNLOCK_CODE")
        ])
    }

    var oauthUnlockCodeAvailable: Bool {
        !oauthUnlockCode.isEmpty
    }

    var maskedOAuthUnlockCode: String {
        oauthUnlockCodeAvailable
            ? "••••••••••••••••••••••••"
            : "Not configured"
    }

    var connectorSetupStepsText: String {
        """
        Configure ChatGPT custom MCP app

        1. Open ChatGPT Settings > Connectors > New App.
        2. Name: \(suggestedConnectorAppName)
        3. Description: \(suggestedConnectorDescription)
        4. Connection: choose Server URL.
        5. Server URL: \(connectorURL)
        6. Authentication: OAuth.
        7. Advanced OAuth settings: leave blank first; ChatGPT should discover OAuth from the Server URL.
        8. Check "I understand and want to continue" after verifying the URL is your own bridge.
        9. Click Create, then Connect/Authorize.
        10. On the "Authorize ChatGPT2LocalBridge" page, paste Bridge unlock code from this app's Authorization Page card.
        10a. Do not paste the unlock code into ChatGPT chat messages or public documents.
        11. Start a new ChatGPT chat and run bridge_health. Expected service version: 0.1.1 or later.
        12. Confirm tools include local_write_file or local_workspace_action before testing writes.
        """
    }

    func connectorTestPrompt(for machine: ConnectorMachineProfile) -> String {
        """
        请使用名为 \(machine.name) 的 ChatGPT MCP connector，不要使用 Python 或代码解释器。

        1. 先调用 bridge.health 或 bridge.activity 确认连接。
        2. 如果需要读取本地/服务器文件，只调用该 connector 暴露的 MCP tool。
        3. 优先使用高层或中层工具；只有调试时才用低层 file.* / shell.*。
        4. 读取完成后回复：使用了哪个 MCP tool、读取路径、前 20 行摘要。

        Connector URL:
        \(connectorURL(for: machine))

        Root hint:
        \(machine.workspaceRoot.isEmpty ? "请先通过 policy.allowedProjectRoots 选择已批准目录。" : machine.workspaceRoot)
        """
    }

    func selectedMachineStringBinding(_ keyPath: WritableKeyPath<ConnectorMachineProfile, String>) -> Binding<String> {
        Binding(
            get: { self.selectedConnectorMachine?[keyPath: keyPath] ?? "" },
            set: { value in
                self.updateSelectedConnectorMachine { machine in
                    machine[keyPath: keyPath] = value
                }
            }
        )
    }

    func selectedMachineRouteBinding() -> Binding<ConnectorRoute> {
        Binding(
            get: { self.selectedConnectorMachine?.route ?? .macMini },
            set: { route in
                self.updateSelectedConnectorMachine { machine in
                    machine.route = route
                    if machine.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        machine.name = route.defaultName
                    }
                    if route == .secureTunnel && machine.authMode == .noAuth {
                        machine.authMode = .secureTunnel
                    }
                }
            }
        )
    }

    func selectedMachineAuthBinding() -> Binding<ConnectorAuthMode> {
        Binding(
            get: { self.selectedConnectorMachine?.authMode ?? .oauth },
            set: { authMode in
                self.updateSelectedConnectorMachine { machine in
                    machine.authMode = authMode
                }
            }
        )
    }

    func selectConnectorMachine(_ id: String) {
        selectedConnectorMachineID = id
        saveConnectorMachines()
    }

    func addConnectorMachine(route: ConnectorRoute) {
        let machine = defaultConnectorMachine(route: route, idSuffix: connectorMachines.count + 1)
        connectorMachines.append(machine)
        selectedConnectorMachineID = machine.id
        saveConnectorMachines()
    }

    func deleteSelectedConnectorMachine() {
        guard let index = selectedConnectorMachineIndex, connectorMachines.count > 1 else { return }
        connectorMachines.remove(at: index)
        selectedConnectorMachineID = connectorMachines.first?.id ?? ""
        saveConnectorMachines()
    }

    func copySelectedConnectorURL() {
        guard let machine = selectedConnectorMachine else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(connectorURL(for: machine), forType: .string)
    }

    func copySelectedConnectorFields() {
        guard let machine = selectedConnectorMachine else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(connectorFieldsText(for: machine), forType: .string)
    }

    func copySelectedConnectorTestPrompt() {
        guard let machine = selectedConnectorMachine else {
            copyConnectorTestPrompt()
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(connectorTestPrompt(for: machine), forType: .string)
    }

    private var selectedConnectorMachineIndex: Int? {
        if let index = connectorMachines.firstIndex(where: { $0.id == selectedConnectorMachineID }) {
            return index
        }
        return connectorMachines.indices.first
    }

    private func updateSelectedConnectorMachine(_ mutate: (inout ConnectorMachineProfile) -> Void) {
        guard let index = selectedConnectorMachineIndex else { return }
        selectedConnectorMachineID = connectorMachines[index].id
        mutate(&connectorMachines[index])
        connectorMachines[index].updatedAt = compactTimestamp()
        saveConnectorMachines()
    }

    func toolProfileChanged() {
        persistToolProfile()
        lastError = profileRestartRequired ? "Restart required to apply \(toolProfile.title)" : nil
    }

    private func loadLanguage() {
        guard let raw = try? String(contentsOf: languagePath, encoding: .utf8) else {
            language = .en
            return
        }
        language = AppLanguage(rawValue: raw.trimmingCharacters(in: .whitespacesAndNewlines)) ?? .en
    }

    private func persistLanguage() {
        do {
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            try "\(language.rawValue)\n".write(to: languagePath, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: languagePath.path)
        } catch {
            lastError = "Failed to save language: \(error.localizedDescription)"
        }
    }

    private func loadToolProfile() {
        guard let raw = try? String(contentsOf: toolProfilePath, encoding: .utf8) else {
            toolProfile = .normal
            return
        }
        toolProfile = ToolProfile(runtimeValue: raw) ?? .normal
    }

    private func persistToolProfile() {
        do {
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            try "\(toolProfile.runtimeValue)\n".write(to: toolProfilePath, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: toolProfilePath.path)
        } catch {
            lastError = "Failed to save tool profile: \(error.localizedDescription)"
        }
    }

    private func loadConnectorMachines() {
        if let data = try? Data(contentsOf: machinesPath),
           let document = try? JSONDecoder().decode(ConnectorMachinesDocument.self, from: data),
           !document.machines.isEmpty {
            connectorMachines = document.machines
            selectedConnectorMachineID = document.selectedID.isEmpty
                ? (document.machines.first?.id ?? "")
                : document.selectedID
            if selectedConnectorMachine == nil {
                selectedConnectorMachineID = connectorMachines.first?.id ?? ""
            }
            return
        }

        connectorMachines = defaultConnectorMachines()
        selectedConnectorMachineID = connectorMachines.first?.id ?? ""
        saveConnectorMachines()
    }

    private func saveConnectorMachines() {
        do {
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            let document = ConnectorMachinesDocument(
                selectedID: selectedConnectorMachineID,
                machines: connectorMachines
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(document)
            try data.write(to: machinesPath, options: [.atomic])
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: machinesPath.path)
        } catch {
            lastError = "Failed to save connector machines: \(error.localizedDescription)"
        }
    }

    private func defaultConnectorMachines() -> [ConnectorMachineProfile] {
        [
            ConnectorMachineProfile(
                id: "mac-mini-local",
                name: ConnectorRoute.macMini.defaultName,
                route: .macMini,
                baseURL: effectivePublicBaseUrl.isEmpty ? "http://127.0.0.1:\(port)" : effectivePublicBaseUrl,
                authMode: .oauth,
                workspaceRoot: status?.allowedProjectRoots.first ?? policyAllowedRoots.first ?? "",
                notes: "Local Mac mini bridge beside the native app.",
                enabled: true,
                updatedAt: compactTimestamp()
            ),
            defaultConnectorMachine(route: .linux, idSuffix: 1),
            defaultConnectorMachine(route: .secureTunnel, idSuffix: 1)
        ]
    }

    private func defaultConnectorMachine(route: ConnectorRoute, idSuffix: Int) -> ConnectorMachineProfile {
        let id = "\(route.rawValue)-\(UUID().uuidString.prefix(8).lowercased())"
        let baseURL: String
        let authMode: ConnectorAuthMode
        let root: String
        let note: String

        switch route {
        case .macMini:
            baseURL = effectivePublicBaseUrl.isEmpty == false
                ? effectivePublicBaseUrl
                : "http://127.0.0.1:\(port)"
            authMode = .oauth
            root = status?.allowedProjectRoots.first ?? policyAllowedRoots.first ?? ""
            note = "Local Mac mini bridge beside the native app."
        case .linux:
            baseURL = ""
            authMode = .oauth
            root = "/home/user/workspace"
            note = "Remote Linux bridge. Keep its policy separate from Mac mini."
        case .secureTunnel:
            baseURL = ""
            authMode = .secureTunnel
            root = "/workspace"
            note = "Private MCP route through Secure MCP Tunnel when supported."
        case .cloudflare:
            baseURL = "https://your-cloudflare-tunnel.example.com"
            authMode = .oauth
            root = "/workspace"
            note = "Long-running server/lab HTTPS route. Treat URL as sensitive."
        case .ngrok:
            baseURL = "https://your-ngrok-domain.ngrok-free.dev"
            authMode = .oauth
            root = "/workspace"
            note = "Fast demo route. Run ngrok as launchd/service for stability."
        }

        return ConnectorMachineProfile(
            id: id,
            name: idSuffix > 1 ? "\(route.defaultName)-\(idSuffix)" : route.defaultName,
            route: route,
            baseURL: baseURL,
            authMode: authMode,
            workspaceRoot: root,
            notes: note,
            enabled: true,
            updatedAt: compactTimestamp()
        )
    }

    private func compactTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: Date())
    }

    var codexRunnerPrompt: String {
        let root = status?.allowedProjectRoots.first ?? policyAllowedRoots.first ?? resolvedCloudWorkspaceRoot
        guard !root.isEmpty else { return "" }
        return """
        请使用 ChatGPT2LocalBridge 的 codex.task_start 入口执行本地 Codex 任务，不要直接裸用 shell.exec。

        codex.task_start 参数建议：
        {
          "projectPath": "\(escapeJSON(root))",
          "task": "先检查仓库状态，说明计划，然后做最小改动并运行相关测试。",
          "mode": "normal",
          "timeoutMs": 120000
        }

        完成后调用 codex.status / codex.result，并总结 changed files、diff preview、test result。
        """
    }

    var riskAlerts: [RiskAlert] {
        var alerts: [RiskAlert] = []
        let currentURL = connectorURL.lowercased()
        let isPublic = currentURL.hasPrefix("https://")
            && !currentURL.contains("127.0.0.1")
            && !currentURL.contains("localhost")

        if status?.oauthEnabled != true {
            alerts.append(RiskAlert(
                title: tr("No-auth connector", "未授权连接器"),
                detail: isPublic ? tr("Public connector URL is not protected by OAuth.", "公网连接器 URL 未受 OAuth 保护。") : tr("No-auth is acceptable only for loopback or short lab tests.", "未授权只适合本机回环或短期实验。"),
                symbol: "lock.open.trianglebadge.exclamationmark",
                tint: .orange
            ))
        }

        if isPublic {
            alerts.append(RiskAlert(
                title: tr("Public MCP URL", "公网 MCP URL"),
                detail: tr("Treat the URL as sensitive. Prefer OAuth or Secure MCP Tunnel for long-running use.", "请把该 URL 当作敏感入口；长期使用优先 OAuth 或 Secure MCP Tunnel。"),
                symbol: "globe.badge.chevron.backward",
                tint: status?.oauthEnabled == true ? .blue : .orange
            ))
        }

        if policyShellEnabled || status?.shellEnabled == true {
            alerts.append(RiskAlert(
                title: tr("Shell enabled", "Shell 已启用"),
                detail: tr("Shell tools should stay in Debug Mode or Codex Runner Only, with deny patterns and trace logging.", "Shell 工具建议只放在调试模式或 Codex Runner Only，并保留拒绝规则和调用日志。"),
                symbol: "terminal.fill",
                tint: .orange
            ))
        }

        for warning in policyBroadRootWarnings.prefix(3) {
            alerts.append(RiskAlert(
                title: tr("Broad root", "根目录过宽"),
                detail: warning,
                symbol: "folder.badge.questionmark",
                tint: .red
            ))
        }

        return alerts
    }

    var policyBroadRootWarnings: [String] {
        let roots = normalizedLines(policyAllowedRoots.isEmpty ? (status?.allowedProjectRoots ?? []) : policyAllowedRoots)
        return roots.compactMap { root in
            broadRootWarning(for: root)
        }
    }

    var policyDiffRows: [PolicyDiffRow] {
        guard let saved = readSavedPolicyDocument() else {
            return [PolicyDiffRow(
                title: "New policy draft",
                detail: "No saved policy was readable; applying will create or replace bridge.policy.json.",
                symbol: "doc.badge.plus",
                tint: .orange
            )]
        }

        let current = currentPolicyDocument()
        var rows: [PolicyDiffRow] = []
        let oldRoots = Set(saved.allowedProjectRoots)
        let newRoots = Set(current.allowedProjectRoots)
        let addedRoots = newRoots.subtracting(oldRoots).sorted()
        let removedRoots = oldRoots.subtracting(newRoots).sorted()

        if !addedRoots.isEmpty {
            rows.append(PolicyDiffRow(title: "Allowed roots added", detail: addedRoots.joined(separator: "\n"), symbol: "folder.badge.plus", tint: .blue))
        }
        if !removedRoots.isEmpty {
            rows.append(PolicyDiffRow(title: "Allowed roots removed", detail: removedRoots.joined(separator: "\n"), symbol: "folder.badge.minus", tint: .secondary))
        }

        let oldSkills = Set(saved.skillRoots ?? [])
        let newSkills = Set(current.skillRoots ?? [])
        let addedSkills = newSkills.subtracting(oldSkills).sorted()
        if !addedSkills.isEmpty {
            rows.append(PolicyDiffRow(title: "Skill roots added", detail: addedSkills.joined(separator: "\n"), symbol: "sparkles", tint: .purple))
        }

        let oldDeny = Set(saved.denyGlobs)
        let newDeny = Set(current.denyGlobs)
        let removedDeny = oldDeny.subtracting(newDeny).sorted()
        if !removedDeny.isEmpty {
            rows.append(PolicyDiffRow(title: "Deny globs removed", detail: removedDeny.joined(separator: "\n"), symbol: "exclamationmark.triangle.fill", tint: .orange))
        }

        if saved.shell.enabled != current.shell.enabled {
            rows.append(PolicyDiffRow(
                title: current.shell.enabled ? "Shell opened" : "Shell closed",
                detail: "shell.enabled \(saved.shell.enabled) -> \(current.shell.enabled)",
                symbol: current.shell.enabled ? "terminal.fill" : "lock.fill",
                tint: current.shell.enabled ? .orange : .green
            ))
        }

        let oldShellDeny = Set(saved.shell.denyPatterns)
        let newShellDeny = Set(current.shell.denyPatterns)
        let removedShellDeny = oldShellDeny.subtracting(newShellDeny).sorted()
        if !removedShellDeny.isEmpty {
            rows.append(PolicyDiffRow(title: "Shell deny rules removed", detail: removedShellDeny.joined(separator: "\n"), symbol: "exclamationmark.octagon.fill", tint: .red))
        }

        return rows
    }

    func lastCall(forTool tool: String) -> ToolCall? {
        connectorActivity.toolCalls.first { $0.tool == tool }
    }

    func copyConnectorURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(connectorURL, forType: .string)
    }

    func copyText(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    func copyConnectorAppName() {
        copyText(suggestedConnectorAppName)
    }

    func copyConnectorDescription() {
        copyText(suggestedConnectorDescription)
    }

    func copyOAuthUnlockCode() {
        guard oauthUnlockCodeAvailable else { return }
        copyText(oauthUnlockCode)
    }

    func copyConnectorNewAppFields() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(connectorNewAppFieldsText, forType: .string)
    }

    func copyConnectorSetupSteps() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(connectorSetupStepsText, forType: .string)
    }

    func copyConnectorTestPrompt() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(connectorTestPrompt, forType: .string)
    }

    func copyCodexRunnerPrompt() {
        guard !codexRunnerPrompt.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(codexRunnerPrompt, forType: .string)
    }

    func codexLogPreview(for task: CodexTaskRecord?) -> String {
        guard let task else {
            return "No Codex Runner jobs recorded yet."
        }
        guard let logFile = task.logFile, !logFile.isEmpty else {
            return "Task has no log file yet."
        }
        guard let raw = try? String(contentsOf: URL(fileURLWithPath: logFile), encoding: .utf8), !raw.isEmpty else {
            return "Waiting for Codex Runner log output..."
        }
        return String(raw.suffix(6000))
    }

    func cancelCodexTask(_ task: CodexTaskRecord) {
        if task.isRunning, let pid = task.pid {
            Darwin.kill(Int32(pid), SIGTERM)
        }
        markCodexTaskCancelled(task.id, in: dataDir)
        markCodexTaskCancelled(task.id, in: connectorDataDir)
        refreshConnectorActivity()
    }

    func openChatGPT() {
        NSWorkspace.shared.open(URL(string: "https://chatgpt.com/")!)
    }

    func restartService() async {
        await stopService()
        await startService()
    }

    func startService() async {
        guard !enginePath.isEmpty else {
            lastError = "Bundled Rust engine is missing"
            return
        }
        if isOnline { return }

        isStarting = true
        defer { isStarting = false }

        do {
            try ensureLocalFiles()
            token = try String(contentsOf: tokenPath, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)

            let process = Process()
            process.executableURL = URL(fileURLWithPath: enginePath)
            process.arguments = ["--http", port]
            var environment = ProcessInfo.processInfo.environment
            environment["HOME"] = FileManager.default.homeDirectoryForCurrentUser.path
            environment["LOCALBRIDGE_PORT"] = port
            environment["LOCALBRIDGE_DATA_DIR"] = dataDir.path
            environment["LOCALBRIDGE_LOG_DIR"] = logDir.path
            environment["LOCALBRIDGE_POLICY_PATH"] = policyPath.path
            environment["LOCALBRIDGE_DASHBOARD_TOKEN"] = token
            environment["LOCALBRIDGE_OAUTH_ENABLED"] = ProcessInfo.processInfo.environment["LOCALBRIDGE_OAUTH_ENABLED"] ?? "0"
            environment["LOCALBRIDGE_TOOL_PROFILE"] = toolProfile.runtimeValue
            environment["PATH"] = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
            process.environment = environment

            let outURL = logDir.appendingPathComponent("bridge-rs.out.log")
            let errURL = logDir.appendingPathComponent("bridge-rs.err.log")
            FileManager.default.createFile(atPath: outURL.path, contents: nil)
            FileManager.default.createFile(atPath: errURL.path, contents: nil)
            process.standardOutput = try FileHandle(forWritingTo: outURL)
            process.standardError = try FileHandle(forWritingTo: errURL)
            try process.run()
            try "\(process.processIdentifier)\n".write(to: pidPath, atomically: true, encoding: .utf8)

            for _ in 0..<40 {
                try? await Task.sleep(nanoseconds: 125_000_000)
                await refresh()
                if isOnline { return }
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func stopService() async {
        guard let pid = readPid(), let pidNumber = Int32(pid.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            await refresh()
            return
        }

        Darwin.kill(pidNumber, SIGTERM)
        try? FileManager.default.removeItem(at: pidPath)
        try? await Task.sleep(nanoseconds: 500_000_000)
        await refresh()
    }

    func openWebConsole() {
        let url = URL(string: "http://127.0.0.1:\(port)/app?dashboard_token=\(token)")!
        NSWorkspace.shared.open(url)
    }

    func openLogs() {
        NSWorkspace.shared.open(logDir)
    }

    func openPolicy() {
        NSWorkspace.shared.open(policyPath)
    }

    func revealDataDir() {
        NSWorkspace.shared.activateFileViewerSelecting([dataDir])
    }

    func addAllowedRoot() {
        guard let path = chooseDirectory(prompt: "Add Root") else { return }
        if !policyAllowedRoots.contains(path) {
            policyAllowedRoots.append(path)
            policyDraftChanged()
        }
    }

    func addSkillRoot() {
        guard let path = chooseDirectory(prompt: "Add Skill Root") else { return }
        if !policySkillRoots.contains(path) {
            policySkillRoots.append(path)
            policyDraftChanged()
        }
    }

    func removeAllowedRoot(index: Int) {
        guard policyAllowedRoots.indices.contains(index) else { return }
        policyAllowedRoots.remove(at: index)
        policyDraftChanged()
    }

    func removeSkillRoot(index: Int) {
        guard policySkillRoots.indices.contains(index) else { return }
        policySkillRoots.remove(at: index)
        policyDraftChanged()
    }

    func loadPolicyDraft() {
        do {
            let data = try Data(contentsOf: policyPath)
            let policy = try JSONDecoder().decode(PolicyDocument.self, from: data)
            policyAllowedRoots = policy.allowedProjectRoots
            policySkillRoots = policy.skillRoots ?? [FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex/skills").path]
            policyDenyGlobsText = policy.denyGlobs.joined(separator: "\n")
            policyShellEnabled = policy.shell.enabled
            policyShellDenyText = policy.shell.denyPatterns.joined(separator: "\n")
            policyDirty = false
            policyErrors = validatePolicyDraft(markDirty: false)
            policyLastSaved = "Loaded \(policyPath.lastPathComponent)"
        } catch {
            let fallback = defaultPolicyDocument()
            policyAllowedRoots = fallback.allowedProjectRoots
            policySkillRoots = fallback.skillRoots ?? []
            policyDenyGlobsText = fallback.denyGlobs.joined(separator: "\n")
            policyShellEnabled = fallback.shell.enabled
            policyShellDenyText = fallback.shell.denyPatterns.joined(separator: "\n")
            policyErrors = [PolicyValidationMessage(.warning, "Policy file was missing or unreadable; loaded defaults.")]
            policyDirty = true
        }
    }

    func policyDraftChanged() {
        policyDirty = true
        policyErrors = validatePolicyDraft(markDirty: true)
    }

    func savePolicyDraft() {
        let messages = validatePolicyDraft(markDirty: true)
        policyErrors = messages
        if messages.contains(where: { $0.severity == .error }) {
            return
        }

        do {
            let policy = currentPolicyDocument()
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(policy)
            let before = try? String(contentsOf: policyPath, encoding: .utf8)
            let backup = policyPath.deletingLastPathComponent().appendingPathComponent("bridge.policy.backup.json")
            if FileManager.default.fileExists(atPath: policyPath.path) {
                try? FileManager.default.removeItem(at: backup)
                try? FileManager.default.copyItem(at: policyPath, to: backup)
            }
            try data.write(to: policyPath, options: [.atomic])
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: policyPath.path)
            let after = String(data: data, encoding: .utf8) ?? ""
        writePolicyAudit(before: before, after: after)
            policyDirty = false
            policyLastSaved = "Saved \(DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)); restart service to apply."
            Task { await refresh() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    var traceItems: [TraceItem] {
        let toolItems = connectorActivity.toolCalls.map { TraceItem(toolCall: $0) }
        let auditItems = connectorActivity.auditEvents.map { TraceItem(auditEvent: $0) }
        return (toolItems + auditItems)
            .sorted { $0.date > $1.date }
    }

    var traceStats: TraceStats {
        TraceStats(items: traceItems)
    }

    func copyTraceSummary() {
        let text = traceItems.prefix(40).map { item in
            "\(item.timeLabel) [\(item.kind.label)] \(item.title) \(item.status) \(item.subtitle) \(item.detail)"
        }.joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text.isEmpty ? "No trace records." : text, forType: .string)
    }

    func exportTraceSnapshot() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "chatgpt2localbridge-trace-\(traceExportTimestamp()).json"
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        if panel.runModal() != .OK { return }
        guard let url = panel.url else { return }

        let payload: [String: Any] = [
            "exportedAt": ISO8601DateFormatter().string(from: Date()),
            "source": connectorDataDir.path,
            "items": traceItems.map(\.exportObject),
        ]
        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: url)
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func refreshConnectorActivity() {
        let connector = readActivityFiles(dataDir: connectorDataDir, limit: 200)
        let native = readActivityFiles(dataDir: dataDir, limit: 200)
        connectorActivity = BridgeActivity(
            toolCalls: (connector.toolCalls + native.toolCalls).sorted { $0.ts > $1.ts },
            auditEvents: (connector.auditEvents + native.auditEvents).sorted { ($0.ts ?? "") > ($1.ts ?? "") }
        )
        let taskRecords = readJsonArray(CodexTaskRecord.self, from: connectorDataDir.appendingPathComponent("tasks.json"))
            + readJsonArray(CodexTaskRecord.self, from: dataDir.appendingPathComponent("tasks.json"))
        var seen: Set<String> = []
        codexTasks = taskRecords
            .filter { task in
                if seen.contains(task.id) { return false }
                seen.insert(task.id)
                return task.isCodexTask
            }
            .sorted { $0.sortKey > $1.sortKey }
    }

    private func readActivityFiles(dataDir: URL, limit: Int) -> BridgeActivity {
        BridgeActivity(
            toolCalls: readJsonl(ToolCall.self, from: dataDir.appendingPathComponent("tool-calls.jsonl"), limit: limit),
            auditEvents: readJsonl(AuditEvent.self, from: dataDir.appendingPathComponent("audit.jsonl"), limit: limit)
        )
    }

    private func readJsonl<T: Decodable>(_ type: T.Type, from file: URL, limit: Int) -> [T] {
        guard let raw = try? String(contentsOf: file, encoding: .utf8), !raw.isEmpty else {
            return []
        }
        let decoder = JSONDecoder()
        return raw
            .split(separator: "\n", omittingEmptySubsequences: true)
            .suffix(limit)
            .reversed()
            .compactMap { line in
                try? decoder.decode(type, from: Data(String(line).utf8))
            }
    }

    private func readJsonArray<T: Decodable>(_ type: T.Type, from file: URL) -> [T] {
        guard let data = try? Data(contentsOf: file), !data.isEmpty else {
            return []
        }
        return (try? JSONDecoder().decode([T].self, from: data)) ?? []
    }

    private func markCodexTaskCancelled(_ id: String, in directory: URL) {
        let file = directory.appendingPathComponent("tasks.json")
        guard let data = try? Data(contentsOf: file),
              var tasks = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
            return
        }
        let now = ISO8601DateFormatter().string(from: Date())
        var changed = false
        for index in tasks.indices where tasks[index]["id"] as? String == id {
            tasks[index]["status"] = "cancelled"
            tasks[index]["completedAt"] = now
            tasks[index]["updatedAt"] = now
            var notes = tasks[index]["notes"] as? [[String: Any]] ?? []
            notes.append(["ts": now, "text": "cancelled from native app"])
            tasks[index]["notes"] = notes
            changed = true
        }
        guard changed,
              let output = try? JSONSerialization.data(withJSONObject: tasks, options: [.prettyPrinted, .sortedKeys]) else {
            return
        }
        try? output.write(to: file, options: [.atomic])
    }

    private func loadToolCatalog() {
        guard let url = Bundle.main.url(forResource: "mcp-tools", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(ToolCatalogDocument.self, from: data) else {
            toolCatalog = []
            return
        }
        toolCatalog = catalog.tools
    }

    private func rebuildBundlePrompt() {
        guard !bundleRoot.isEmpty else {
            bundlePrompt = ""
            return
        }
        let encodedFiles = bundleFiles.map { "\"\($0.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\"" }
        bundlePrompt = """
        请使用 ChatGPT2LocalBridge 的 project.bundle 工具先读取本地内容，然后再回答或生成云端可下载副本。

        project.bundle 参数：
        {
          "projectPath": "\(bundleRoot.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))",
          "dir": ".",
          "files": [\(encodedFiles.joined(separator: ", "))],
          "includeDirectorySummary": true,
          "includeGitDiff": true
        }

        如果我要求把云端文件同步回本地，再使用 cloud.download 写入批准的本地 workspace。
        """
    }

    private var resolvedCloudWorkspaceRoot: String {
        if !cloudWorkspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return cloudWorkspaceRoot
        }
        if !bundleRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return bundleRoot
        }
        return status?.allowedProjectRoots.first ?? ""
    }

    private func escapeJSON(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }

    private func mcpURL(from base: String) -> String {
        let trimmed = base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if trimmed.hasSuffix("/mcp") {
            return trimmed
        }
        return "\(trimmed)/mcp"
    }

    private func broadRootWarning(for root: String) -> String? {
        let expanded = (root as NSString).expandingTildeInPath
        let home = NSHomeDirectory()
        if expanded == "/" {
            return "Approved root is filesystem root: \(root)"
        }
        if expanded == home || root == "~" {
            return "Approved root is the full home directory: \(root)"
        }
        if expanded == "/Volumes" || expanded == "/Volumes/" {
            return "Approved root exposes all mounted volumes: \(root)"
        }
        if expanded.split(separator: "/").count <= 1 && expanded.hasPrefix("/Volumes/") {
            return "Approved root is a whole mounted volume: \(root)"
        }
        return nil
    }

    private func readSavedPolicyDocument() -> PolicyDocument? {
        guard let data = try? Data(contentsOf: policyPath) else { return nil }
        return try? JSONDecoder().decode(PolicyDocument.self, from: data)
    }

    private func traceExportTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }

    private func relativePath(for url: URL, root: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let filePath = url.standardizedFileURL.path
        let prefix = rootPath.hasSuffix("/") ? rootPath : "\(rootPath)/"
        guard filePath.hasPrefix(prefix) else {
            return url.lastPathComponent
        }
        return String(filePath.dropFirst(prefix.count))
    }

    private func fetchJSON<T: Decodable>(_ type: T.Type, url: URL, authorized: Bool) async throws -> T {
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        if authorized {
            request.addValue(token, forHTTPHeaderField: "x-localbridge-dashboard-token")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw BridgeError.badHTTP
        }
        return try JSONDecoder().decode(type, from: data)
    }

    private func ensureLocalFiles() throws {
        try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)

        if !FileManager.default.fileExists(atPath: tokenPath.path) {
            let generated = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
                + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16)
            try "\(generated)\n".write(to: tokenPath, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenPath.path)
        }

        if !FileManager.default.fileExists(atPath: toolProfilePath.path) {
            try "\(ToolProfile.normal.runtimeValue)\n".write(to: toolProfilePath, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: toolProfilePath.path)
        }

        if !FileManager.default.fileExists(atPath: languagePath.path) {
            try "\(AppLanguage.en.rawValue)\n".write(to: languagePath, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: languagePath.path)
        }

        if !FileManager.default.fileExists(atPath: policyPath.path) {
            let defaultRoot = ProcessInfo.processInfo.environment["LOCALBRIDGE_DEFAULT_PROJECT_ROOT"]
                ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents").path
            let skillRoot = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex/skills").path
            let policy = """
            {
              "allowedProjectRoots": [
                "\(defaultRoot)"
              ],
              "skillRoots": [
                "\(skillRoot)"
              ],
              "denyGlobs": [
                "**/.env",
                "**/.env.*",
                "**/*.pem",
                "**/*.key",
                "**/*.p12",
                "**/*.pfx",
                "**/.npmrc",
                "**/.netrc",
                "**/.ssh/**",
                "**/id_rsa",
                "**/id_ed25519"
              ],
              "shell": {
                "enabled": true,
                "denyPatterns": [
                  "sudo",
                  "rm\\\\s+-rf\\\\s+/",
                  "chmod\\\\s+-R",
                  "chown\\\\s+-R",
                  "security\\\\s+find-",
                  "launchctl\\\\s+bootout\\\\s+system"
                ]
              }
            }
            """
            try policy.write(to: policyPath, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: policyPath.path)
        } else {
            try migratePolicyIfNeeded()
        }
    }

    private func readPid() -> String? {
        try? String(contentsOf: pidPath, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func chooseDirectory(prompt: String) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = prompt
        return panel.runModal() == .OK ? panel.url?.path : nil
    }

    private func currentPolicyDocument() -> PolicyDocument {
        PolicyDocument(
            allowedProjectRoots: normalizedLines(policyAllowedRoots),
            skillRoots: normalizedLines(policySkillRoots),
            denyGlobs: normalizedLines(policyDenyGlobsText.components(separatedBy: .newlines)),
            shell: ShellPolicyDocument(
                enabled: policyShellEnabled,
                denyPatterns: normalizedLines(policyShellDenyText.components(separatedBy: .newlines))
            )
        )
    }

    private func defaultPolicyDocument() -> PolicyDocument {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return PolicyDocument(
            allowedProjectRoots: [home.appendingPathComponent("Documents").path],
            skillRoots: [home.appendingPathComponent(".codex/skills").path],
            denyGlobs: [
                "**/.env",
                "**/.env.*",
                "**/*.pem",
                "**/*.key",
                "**/*.p12",
                "**/*.pfx",
                "**/.npmrc",
                "**/.netrc",
                "**/.ssh/**",
                "**/id_rsa",
                "**/id_ed25519"
            ],
            shell: ShellPolicyDocument(
                enabled: true,
                denyPatterns: [
                    "sudo",
                    "rm\\\\s+-rf\\\\s+/",
                    "chmod\\\\s+-R",
                    "chown\\\\s+-R",
                    "security\\\\s+find-",
                    "launchctl\\\\s+bootout\\\\s+system"
                ]
            )
        )
    }

    private func migratePolicyIfNeeded() throws {
        let data = try Data(contentsOf: policyPath)
        let existing = try JSONDecoder().decode(PolicyDocument.self, from: data)
        if existing.skillRoots?.isEmpty == false {
            return
        }

        let migrated = PolicyDocument(
            allowedProjectRoots: existing.allowedProjectRoots,
            skillRoots: [FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex/skills").path],
            denyGlobs: existing.denyGlobs,
            shell: existing.shell
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let nextData = try encoder.encode(migrated)
        let before = String(data: data, encoding: .utf8)
        let backup = policyPath.deletingLastPathComponent().appendingPathComponent("bridge.policy.backup.json")
        try? FileManager.default.removeItem(at: backup)
        try? FileManager.default.copyItem(at: policyPath, to: backup)
        try nextData.write(to: policyPath, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: policyPath.path)
        writePolicyAudit(
            before: before,
            after: String(data: nextData, encoding: .utf8) ?? "",
            allowedRoots: migrated.allowedProjectRoots,
            skillRoots: migrated.skillRoots ?? []
        )
    }

    private func validatePolicyDraft(markDirty: Bool) -> [PolicyValidationMessage] {
        let policy = currentPolicyDocument()
        var messages: [PolicyValidationMessage] = []

        if policy.allowedProjectRoots.isEmpty {
            messages.append(PolicyValidationMessage(.error, "Add at least one approved workspace root."))
        }

        for root in policy.allowedProjectRoots {
            let expanded = (root as NSString).expandingTildeInPath
            if expanded == "/" || expanded == NSHomeDirectory() {
                messages.append(PolicyValidationMessage(.warning, "Approved root is broad: \(root)"))
            }
            if !FileManager.default.fileExists(atPath: expanded) {
                messages.append(PolicyValidationMessage(.warning, "Root does not exist yet: \(root)"))
            }
        }

        for root in policy.skillRoots ?? [] {
            let expanded = (root as NSString).expandingTildeInPath
            if expanded == "\(NSHomeDirectory())/.codex" {
                messages.append(PolicyValidationMessage(.error, "Expose ~/.codex/skills, not the whole ~/.codex directory."))
            }
            if !FileManager.default.fileExists(atPath: expanded) {
                messages.append(PolicyValidationMessage(.warning, "Skill root does not exist yet: \(root)"))
            }
        }

        for required in ["**/.env", "**/.env.*", "**/*.key", "**/*.pem", "**/.ssh/**"] {
            if !policy.denyGlobs.contains(required) {
                messages.append(PolicyValidationMessage(.warning, "Recommended deny glob missing: \(required)"))
            }
        }

        if markDirty && policy.shell.enabled && policy.shell.denyPatterns.isEmpty {
            messages.append(PolicyValidationMessage(.warning, "Shell is enabled without deny patterns."))
        }

        return messages
    }

    private func normalizedLines(_ values: [String]) -> [String] {
        var seen: Set<String> = []
        return values
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .filter { value in
                if seen.contains(value) { return false }
                seen.insert(value)
                return true
            }
    }

    private func writePolicyAudit(before: String?, after: String, allowedRoots: [String]? = nil, skillRoots: [String]? = nil) {
        let event: [String: Any] = [
            "ts": ISO8601DateFormatter().string(from: Date()),
            "action": "policy.write",
            "policyPath": policyPath.path,
            "backupPath": policyPath.deletingLastPathComponent().appendingPathComponent("bridge.policy.backup.json").path,
            "beforeSha256": sha256(before ?? ""),
            "afterSha256": sha256(after),
            "allowedProjectRoots": allowedRoots ?? policyAllowedRoots,
            "skillRoots": skillRoots ?? policySkillRoots
        ]
        appendAudit(event, to: dataDir)
        appendAudit(event, to: connectorDataDir)
    }

    private func appendAudit(_ event: [String: Any], to directory: URL) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent("audit.jsonl")
            let data = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
            if !FileManager.default.fileExists(atPath: file.path) {
                FileManager.default.createFile(atPath: file.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: file)
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.write(contentsOf: Data("\n".utf8))
            try handle.close()
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func sha256(_ value: String) -> String {
        let data = Data(value.utf8)
        #if canImport(CryptoKit)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #else
        return "\(data.count)"
        #endif
    }

    private func firstNonEmpty(_ values: [String?]) -> String {
        values
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? ""
    }

    private func readLaunchAgentEnv(_ key: String) -> String? {
        let plist = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/com.chatgpt2localbridge.bridge.plist")
        guard let data = try? Data(contentsOf: plist),
              let raw = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
              let dict = raw as? [String: Any],
              let env = dict["EnvironmentVariables"] as? [String: Any] else {
            return nil
        }
        return env[key] as? String
    }

    private func readRepoEnvLocalValue(_ key: String) -> String? {
        let candidates = [
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".env.local"),
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".chatgpt2localbridge/.env.local")
        ]
        for file in candidates where FileManager.default.fileExists(atPath: file.path) {
            guard let raw = try? String(contentsOf: file, encoding: .utf8) else { continue }
            for line in raw.split(separator: "\n") {
                let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard text.hasPrefix("export \(key)=") || text.hasPrefix("\(key)=") else { continue }
                let value = text.split(separator: "=", maxSplits: 1).dropFirst().joined(separator: "=")
                return value.trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
            }
        }
        return nil
    }
}

private extension String {
    var isTruthy: Bool {
        ["1", "true", "yes", "on"].contains(trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    var isLoopbackBaseURL: Bool {
        let lower = lowercased()
        return lower.hasPrefix("http://127.0.0.1")
            || lower.hasPrefix("http://localhost")
            || lower.hasPrefix("https://127.0.0.1")
            || lower.hasPrefix("https://localhost")
    }

    var trimmingTrailingSlashes: String {
        var value = self
        while value.hasSuffix("/") {
            value.removeLast()
        }
        return value
    }
}

enum BridgeError: Error {
    case badHTTP
}

struct Health: Decodable {
    let service: String
    let status: String
    let version: String
}

struct PolicyDocument: Codable {
    let allowedProjectRoots: [String]
    let skillRoots: [String]?
    let denyGlobs: [String]
    let shell: ShellPolicyDocument
}

struct ShellPolicyDocument: Codable {
    let enabled: Bool
    let denyPatterns: [String]
}

enum PolicySeverity: String {
    case warning
    case error

    var symbol: String {
        switch self {
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.octagon.fill"
        }
    }

    var tint: Color {
        switch self {
        case .warning: return .orange
        case .error: return .red
        }
    }
}

struct PolicyValidationMessage: Identifiable {
    let id = UUID()
    let severity: PolicySeverity
    let text: String

    init(_ severity: PolicySeverity, _ text: String) {
        self.severity = severity
        self.text = text
    }
}

struct RiskAlert: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let symbol: String
    let tint: Color
}

struct PolicyDiffRow: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let symbol: String
    let tint: Color
}

enum ToolProfile: String, CaseIterable, Identifiable {
    case normal
    case debug
    case codexRunner

    var id: String { rawValue }

    init?(runtimeValue: String?) {
        let normalized = (runtimeValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch normalized {
        case "normal", "":
            self = .normal
        case "debug", "all":
            self = .debug
        case "codex", "codex-runner", "codex-runner-only", "codexrunner":
            self = .codexRunner
        default:
            return nil
        }
    }

    var runtimeValue: String {
        switch self {
        case .normal: return "normal"
        case .debug: return "debug"
        case .codexRunner: return "codex-runner-only"
        }
    }

    var title: String {
        switch self {
        case .normal: return "Normal Mode"
        case .debug: return "Debug Mode"
        case .codexRunner: return "Codex Runner Only"
        }
    }

    var note: String {
        switch self {
        case .normal:
            return "Prefer codex.*, project.bundle, git.diff, and test.run. Avoid raw shell and low-level writes."
        case .debug:
            return "Allow lower-level file and shell tools for diagnosis, with trace evidence and short timeouts."
        case .codexRunner:
            return "Route broad local work through codex.task_start / codex.status / codex.result."
        }
    }

    var riskLabel: String {
        switch self {
        case .normal: return "low-level blocked"
        case .debug: return "all tools exposed"
        case .codexRunner: return "runner-only"
        }
    }

    var riskTint: Color {
        switch self {
        case .normal: return .green
        case .debug: return .orange
        case .codexRunner: return .purple
        }
    }
}

struct ToolExposure {
    let isEnabled: Bool
    let stateLabel: String
    let recommendation: String
    let tint: Color
}

enum ToolTier: String, CaseIterable, Identifiable {
    case high
    case mid
    case low

    var id: String { rawValue }

    var title: String {
        switch self {
        case .high: return "High"
        case .mid: return "Mid"
        case .low: return "Low"
        }
    }

    var symbol: String {
        switch self {
        case .high: return "sparkles.rectangle.stack.fill"
        case .mid: return "square.stack.3d.up"
        case .low: return "wrench.adjustable.fill"
        }
    }

    var tint: Color {
        switch self {
        case .high: return .green
        case .mid: return .blue
        case .low: return .orange
        }
    }

    var note: String {
        switch self {
        case .high: return "agent-friendly entrypoints"
        case .mid: return "project state and testing"
        case .low: return "debug-only primitives"
        }
    }
}

struct BridgeStatus: Decodable {
    let service: String
    let version: String
    let oauthEnabled: Bool
    let publicBaseUrl: String?
    let dataDir: String
    let logDir: String
    let allowedProjectRoots: [String]
    let skillRoots: [String]?
    let denyGlobs: [String]?
    let shellEnabled: Bool
    let toolProfile: String?
    let dashboardTokenConfigured: Bool
}

struct BridgeActivity: Decodable {
    let toolCalls: [ToolCall]
    let auditEvents: [AuditEvent]

    static let empty = BridgeActivity(toolCalls: [], auditEvents: [])
}

struct ToolCatalogDocument: Decodable {
    let count: Int
    let tools: [ToolCatalogItem]
}

struct ToolCatalogItem: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let title: String?
    let description: String?

    var tier: ToolTier {
        if name.hasPrefix("codex.") || name == "task.start" || name == "task.status" || name == "task.result" {
            return .high
        }
        if name == "project.bundle" || name == "git.diff" || name == "test.run" || name == "policy.read" || name == "bridge.activity" {
            return .mid
        }
        if name.hasPrefix("file.")
            || name == "shell.exec"
            || name.hasPrefix("process.")
            || name.hasPrefix("workspace.") {
            return .low
        }
        return .mid
    }

    var riskLabel: String {
        if name == "shell.exec"
            || name.hasPrefix("process.")
            || name == "service.restart"
            || name == "git.revert"
            || name == "git.checkpoint"
            || name == "workspace.add" {
            return "High"
        }
        if name == "file.write"
            || name == "file.mkdir"
            || name == "file.copy"
            || name == "file.move"
            || name == "file.patch"
            || name == "file.delete"
            || name == "cloud.download"
            || name == "codex.task_start"
            || name == "codex.cancel" {
            return "Medium"
        }
        if name.hasPrefix("policy.") || name.hasPrefix("workspace.") { return "Medium" }
        return "Low"
    }

    var riskTint: Color {
        switch riskLabel {
        case "High": return .red
        case "Medium": return .orange
        default: return .green
        }
    }

    var recommendation: String {
        switch tier {
        case .high: return "Recommended"
        case .mid: return "Recommended"
        case .low: return riskLabel == "High" ? "Debug only" : "Use carefully"
        }
    }

    func exposure(in profile: ToolProfile) -> ToolExposure {
        switch profile {
        case .debug:
            return ToolExposure(
                isEnabled: true,
                stateLabel: "Enabled",
                recommendation: recommendation,
                tint: riskLabel == "High" ? .orange : .green
            )
        case .codexRunner:
            let allowed = isAlwaysSafeTool || name.hasPrefix("codex.")
            return ToolExposure(
                isEnabled: allowed,
                stateLabel: allowed ? "Enabled" : "Hidden",
                recommendation: allowed ? (name.hasPrefix("codex.") ? "Recommended" : "Safe status") : "Blocked",
                tint: allowed ? (name.hasPrefix("codex.") ? .purple : .green) : .red
            )
        case .normal:
            let allowed = isAlwaysSafeTool || name.hasPrefix("codex.") || !isLowLevelPrimitive
            return ToolExposure(
                isEnabled: allowed,
                stateLabel: allowed ? "Enabled" : "Hidden",
                recommendation: allowed ? recommendation : "Debug only",
                tint: allowed ? (tier == .high ? .green : .blue) : .red
            )
        }
    }

    private var isAlwaysSafeTool: Bool {
        [
            "bridge.health",
            "bridge.activity",
            "bridge.logs",
            "bridge.status",
            "policy.read",
            "workspace.list",
            "workspace.resolve"
        ].contains(name)
    }

    private var isLowLevelPrimitive: Bool {
        name == "shell.exec"
            || name.hasPrefix("process.")
            || name == "service.restart"
            || name == "git.revert"
            || name == "git.checkpoint"
            || name == "workspace.add"
            || name == "file.write"
            || name == "file.mkdir"
            || name == "file.copy"
            || name == "file.move"
            || name == "file.patch"
            || name == "file.delete"
    }
}

struct AuditEvent: Decodable, Identifiable {
    let id = UUID()
    let ts: String?
    let action: String?
    let payload: [String: JSONValue]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        ts = try? container.decode(String.self, forKey: DynamicCodingKey("ts"))
        action = try? container.decode(String.self, forKey: DynamicCodingKey("action"))

        var values: [String: JSONValue] = [:]
        for key in container.allKeys where key.stringValue != "ts" && key.stringValue != "action" {
            values[key.stringValue] = try? container.decode(JSONValue.self, forKey: key)
        }
        payload = values
    }

    var compactDescription: String {
        payload
            .keys
            .sorted()
            .map { key in "\(key): \(payload[key]?.compactDescription ?? "")" }
            .joined(separator: ", ")
    }

    var projectPathLabel: String {
        payload["projectPath"]?.stringValue ?? action ?? "audit"
    }

    var fileSummary: String {
        guard let files = payload["files"]?.arrayValue else { return "" }
        let summaries = files.compactMap { value -> String? in
            guard let object = value.objectValue else { return nil }
            let path = object["path"]?.stringValue ?? "file"
            let before = object["before"]?.compactDescription ?? ""
            let after = object["after"]?.compactDescription ?? ""
            if before.isEmpty && after.isEmpty { return path }
            return "\(path) before=\(before.isEmpty ? "-" : before) after=\(after.isEmpty ? "-" : after)"
        }
        return summaries.joined(separator: "; ")
    }
}

struct ToolCall: Decodable, Identifiable {
    var id: String { "\(callId)-\(ts)-\(status)" }
    let callId: String
    let ts: String
    let tool: String
    let status: String
    let durationMs: Int?
    let args: JSONValue?
    let result: JSONValue?
    let error: String?
    let sessionId: String?
    let taskId: String?
    let projectPath: String?
    let connectorProfile: String?
    let requestContext: TraceCallContext?

    private enum CodingKeys: String, CodingKey {
        case callId = "id"
        case ts
        case tool
        case status
        case durationMs
        case args
        case result
        case error
        case sessionId
        case taskId
        case projectPath
        case connectorProfile
        case requestContext
    }

    var timeText: String {
        let date = parseTraceDate(ts)
        if date.timeIntervalSince1970 <= 0 { return ts.isEmpty ? "-" : ts }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}

struct CodexTaskRecord: Decodable, Identifiable {
    let id: String
    let title: String
    let workspace: String?
    let projectPath: String?
    let status: String
    let notes: [CodexTaskNote]
    let createdAt: String
    let updatedAt: String
    let mode: String?
    let timeoutMs: Int?
    let command: String?
    let pid: Int?
    let logFile: String?
    let resultFile: String?
    let exitCode: Int?
    let signal: String?
    let startedAt: String?
    let completedAt: String?
    let changedFiles: [CodexChangedFile]?
    let diffPreview: String?
    let testResult: String?

    var isCodexTask: Bool {
        command?.contains("codex exec") == true
            || notes.contains { $0.text.contains("codex.mode=") }
            || id.hasPrefix("codex_")
    }

    var isRunning: Bool {
        status == "running" || status == "active"
    }

    var isSuccess: Bool {
        status == "success" || status == "done"
    }

    var isFailed: Bool {
        status == "failed" || status == "blocked"
    }

    var isCancelled: Bool {
        status == "cancelled"
    }

    var statusTint: Color {
        if isRunning { return .orange }
        if isSuccess { return .green }
        if isFailed { return .red }
        if isCancelled { return .secondary }
        return .blue
    }

    var sortKey: Date {
        parseTraceDate(updatedAt.isEmpty ? createdAt : updatedAt)
    }

    var timeText: String {
        let date = sortKey
        if date.timeIntervalSince1970 <= 0 { return updatedAt.isEmpty ? createdAt : updatedAt }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    var changedFileSummary: String {
        guard let changedFiles, !changedFiles.isEmpty else {
            return "No changed-file summary yet."
        }
        return changedFiles.map { file in
            "\(file.status) \(file.path) +\(file.insertions) -\(file.deletions)"
        }.joined(separator: "\n")
    }
}

struct CodexTaskNote: Decodable {
    let ts: String
    let text: String
}

struct CodexChangedFile: Decodable {
    let path: String
    let oldPath: String?
    let status: String
    let insertions: Int
    let deletions: Int
}

struct TraceCallContext: Decodable {
    let source: String
    let transportSessionId: String?
    let requestId: String?
    let requestIdHash: String?
    let userAgent: String?
    let connectorProfile: String?
    let conversationId: String?
    let conversationIdHash: String?

    private enum CodingKeys: String, CodingKey {
        case source
        case transportSessionId
        case requestId
        case requestIdHash
        case userAgent
        case connectorProfile
        case conversationId
        case conversationIdHash
    }

    var exportObject: [String: String] {
        var values: [String: String] = ["source": source]
        if let value = transportSessionId { values["transportSessionId"] = value }
        if let value = requestId { values["requestId"] = value }
        if let value = requestIdHash { values["requestIdHash"] = value }
        if let value = userAgent { values["userAgent"] = value }
        if let value = connectorProfile { values["connectorProfile"] = value }
        if let value = conversationId { values["conversationId"] = value }
        if let value = conversationIdHash { values["conversationIdHash"] = value }
        return values
    }
}

enum TraceGrouping: String, CaseIterable, Identifiable {
    case conversation
    case task
    case project

    var id: String { rawValue }

    var label: String {
        switch self {
        case .conversation: return "Conversation"
        case .task: return "Task"
        case .project: return "Project"
        }
    }

    var symbol: String {
        switch self {
        case .conversation: return "bubble.left.and.exclamationmark.bubble.right"
        case .task: return "list.bullet.rectangle"
        case .project: return "folder"
        }
    }

    var tint: Color {
        switch self {
        case .conversation: return .purple
        case .task: return .mint
        case .project: return .blue
        }
    }

    func key(for item: TraceItem) -> String {
        switch self {
        case .conversation:
            return item.conversationId ?? item.conversationFallback
        case .task:
            return item.taskId.isEmpty ? "task:untagged" : "task:\(item.taskId)"
        case .project:
            return item.projectPath.isEmpty ? "project:untagged" : "project:\(item.projectPath)"
        }
    }

    func title(for item: TraceItem) -> String {
        switch self {
        case .conversation:
            return item.conversationId ?? item.conversationFallbackLabel
        case .task:
            return item.taskId.isEmpty ? "Untagged task" : item.taskId
        case .project:
            if item.projectPath.isEmpty { return "Untagged project" }
            return URL(fileURLWithPath: item.projectPath).lastPathComponent
        }
    }

    func subtitle(for item: TraceItem) -> String {
        switch self {
        case .conversation:
            if let session = item.sessionId, !session.isEmpty { return "Session: \(session)" }
            return "No session id"
        case .task:
            if let sessionId = item.sessionId, !sessionId.isEmpty { return "session \(sessionId)" }
            if !item.projectPath.isEmpty { return "project \(item.projectPath)" }
            return "No extra context"
        case .project:
            if !item.connectorProfile.isEmpty { return "connector \(item.connectorProfile)" }
            if let sessionId = item.sessionId, !sessionId.isEmpty { return "session \(sessionId)" }
            return "No extra context"
        }
    }

    func displayTitle(for group: TraceItemGroup) -> String {
        group.title
    }
}

struct TraceItemGroup: Identifiable {
    let grouping: TraceGrouping
    let key: String
    let title: String
    let subtitle: String
    let items: [TraceItem]
    var id: String { "\(grouping.rawValue):\(key)" }
}

enum TraceFilter: String, CaseIterable, Identifiable {
    case all
    case read
    case skill
    case policy
    case write
    case download
    case process
    case bridge
    case error

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .read: return "Read"
        case .skill: return "Skill"
        case .policy: return "Policy"
        case .write: return "Write"
        case .download: return "Download"
        case .process: return "Shell"
        case .bridge: return "Bridge"
        case .error: return "Error"
        }
    }

    var symbol: String {
        switch self {
        case .all: return "line.3.horizontal.decrease.circle"
        case .read: return "doc.text.magnifyingglass"
        case .skill: return "sparkles"
        case .policy: return "checklist.checked"
        case .write: return "pencil.and.outline"
        case .download: return "arrow.down.circle.fill"
        case .process: return "terminal"
        case .bridge: return "antenna.radiowaves.left.and.right"
        case .error: return "exclamationmark.triangle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .all: return .secondary
        case .read: return .blue
        case .skill: return .mint
        case .policy: return .indigo
        case .write: return .orange
        case .download: return .green
        case .process: return .purple
        case .bridge: return .teal
        case .error: return .red
        }
    }
}

struct TraceStats {
    let reads: Int
    let skills: Int
    let policies: Int
    let writes: Int
    let downloads: Int
    let errors: Int
    let sessions: Int
    let tasks: Int
    let projects: Int

    init(items: [TraceItem]) {
        reads = items.filter { $0.kind == .read }.count
        skills = items.filter { $0.kind == .skill }.count
        policies = items.filter { $0.kind == .policy }.count
        writes = items.filter { $0.kind == .write }.count
        downloads = items.filter { $0.kind == .download }.count
        errors = items.filter { $0.status == "error" || $0.kind == .error }.count
        sessions = Set(items.compactMap(\.sessionId).filter { !$0.isEmpty }).count
        tasks = Set(items.compactMap(\.taskId).filter { !$0.isEmpty }).count
        projects = Set(items.compactMap(\.projectPath).filter { !$0.isEmpty }).count
    }
}

struct TraceItem: Identifiable {
    let id: String
    let date: Date
    let timestamp: String
    let kind: TraceFilter
    let title: String
    let subtitle: String
    let detail: String
    let status: String
    let durationMs: Int?
    let sessionId: String?
    let taskId: String
    let projectPath: String
    let connectorProfile: String
    let requestContext: TraceCallContext?
    let requestId: String?
    let conversationId: String?

    var conversationFallback: String {
        if let conversationId, !conversationId.isEmpty {
            return "conversation:\(conversationId)"
        }
        if let requestId, !requestId.isEmpty {
            return "request:\(requestId)"
        }
        if let sessionId, !sessionId.isEmpty {
            return "session:\(sessionId)"
        }
        return "conversation:untagged"
    }

    var conversationFallbackLabel: String {
        if let conversationId, !conversationId.isEmpty { return conversationId }
        if let requestId, !requestId.isEmpty { return requestId }
        if let sessionId, !sessionId.isEmpty { return sessionId }
        return "No conversation"
    }

    init(toolCall: ToolCall) {
        let kind = toolCall.status == "error" ? TraceFilter.error : TraceItem.kind(forTool: toolCall.tool)
        id = "tool-\(toolCall.id)"
        date = parseTraceDate(toolCall.ts)
        timestamp = toolCall.ts
        self.kind = kind
        title = toolCall.tool
        status = toolCall.status
        durationMs = toolCall.durationMs
        subtitle = TraceItem.subtitle(args: toolCall.args, fallback: kind.label)
        detail = TraceItem.detail(args: toolCall.args, result: toolCall.result, error: toolCall.error)
        sessionId = toolCall.sessionId
        taskId = toolCall.taskId ?? ""
        projectPath = toolCall.projectPath ?? ""
        connectorProfile = toolCall.connectorProfile ?? ""
        requestContext = toolCall.requestContext
        requestId = toolCall.requestContext?.requestId
        conversationId = toolCall.requestContext?.conversationId
    }

    init(auditEvent: AuditEvent) {
        let action = auditEvent.action ?? "audit"
        id = "audit-\(auditEvent.id.uuidString)"
        date = parseTraceDate(auditEvent.ts)
        timestamp = auditEvent.ts ?? ""
        kind = TraceItem.kind(forAuditAction: action)
        title = action
        status = ""
        durationMs = nil
        subtitle = auditEvent.projectPathLabel
        detail = auditEvent.fileSummary.isEmpty ? auditEvent.compactDescription : auditEvent.fileSummary
        sessionId = nil
        taskId = ""
        projectPath = ""
        connectorProfile = ""
        requestContext = nil
        requestId = nil
        conversationId = nil
    }

    var timeLabel: String {
        if date.timeIntervalSince1970 <= 0 { return timestamp.isEmpty ? "-" : timestamp }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    var exportObject: [String: Any] {
        [
            "timestamp": timestamp,
            "kind": kind.label,
            "title": title,
            "status": status,
            "durationMs": durationMs ?? NSNull(),
            "subtitle": subtitle,
            "detail": detail,
            "sessionId": sessionId ?? "",
            "taskId": taskId,
            "projectPath": projectPath,
            "connectorProfile": connectorProfile,
            "requestId": requestId ?? "",
            "conversationId": conversationId ?? "",
            "requestContext": requestContext?.exportObject ?? [:],
        ]
    }

    private static func kind(forTool tool: String) -> TraceFilter {
        if tool == "cloud.download" { return .download }
        if tool.hasPrefix("skill.") { return .skill }
        if tool.hasPrefix("policy.") { return .policy }
        if tool.hasPrefix("file.write")
            || tool.hasPrefix("file.patch")
            || tool.hasPrefix("file.delete")
            || tool.hasPrefix("file.copy")
            || tool.hasPrefix("file.move")
            || tool.hasPrefix("file.mkdir") {
            return .write
        }
        if tool.hasPrefix("process.") || tool == "shell.exec" || tool.hasPrefix("test.") {
            return .process
        }
        if tool.hasPrefix("bridge.") || tool.hasPrefix("workspace.") || tool.hasPrefix("task.") || tool == "service.restart" {
            return .bridge
        }
        return .read
    }

    private static func kind(forAuditAction action: String) -> TraceFilter {
        if action == "cloud.download" { return .download }
        if action.hasPrefix("skill.") { return .skill }
        if action.hasPrefix("policy.") { return .policy }
        if action.hasPrefix("file.") { return .write }
        if action.hasPrefix("process.") || action == "service.restart" { return .process }
        return .bridge
    }

    private static func subtitle(args: JSONValue?, fallback: String) -> String {
        guard let object = args?.objectValue else { return fallback }
        if let file = object["file"]?.stringValue {
            return file
        }
        if let files = object["files"]?.arrayValue {
            let names = files.compactMap(\.stringValue).prefix(4).joined(separator: ", ")
            return names.isEmpty ? fallback : names
        }
        if let dir = object["dir"]?.stringValue {
            return dir
        }
        if let command = object["command"]?.stringValue {
            return command
        }
        if let path = object["projectPath"]?.stringValue {
            return path
        }
        return fallback
    }

    private static func detail(args: JSONValue?, result: JSONValue?, error: String?) -> String {
        if let error, !error.isEmpty { return error }
        if let argsDescription = args?.compactDescription, !argsDescription.isEmpty {
            return argsDescription
        }
        if let resultDescription = result?.compactDescription, !resultDescription.isEmpty {
            return resultDescription
        }
        return "-"
    }
}

private func parseTraceDate(_ value: String?) -> Date {
    guard let value, !value.isEmpty else { return Date(timeIntervalSince1970: 0) }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value) ?? Date(timeIntervalSince1970: 0)
}

extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

struct DynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil

    init(_ stringValue: String) {
        self.stringValue = stringValue
    }

    init?(stringValue: String) {
        self.stringValue = stringValue
    }

    init?(intValue: Int) {
        return nil
    }
}

enum JSONValue: Decodable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .null
        }
    }

    var compactDescription: String {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            return String(value)
        case .bool(let value):
            return value ? "true" : "false"
        case .null:
            return ""
        case .array(let values):
            return "[" + values.map(\.compactDescription).joined(separator: ", ") + "]"
        case .object(let object):
            let pairs = object.keys.sorted().map { key in
                "\(key): \(object[key]?.compactDescription ?? "")"
            }
            return pairs.joined(separator: ", ")
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var arrayValue: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }
}
