import AppKit
import CryptoKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

private let appName = "ChatGPT2LocalBridge"

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
    private func showWindow() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
            windowController?.showWindow(nil)
            NSRunningApplication.current.activate(options: [.activateAllWindows])
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        NSApp.setActivationPolicy(.regular)
        let root = ContentView()
            .environmentObject(AppState.shared.model)
            .frame(minWidth: 1120, minHeight: 760)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1220, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = appName
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: root)
        window.center()
        window.setFrameAutosaveName("ChatGPT2LocalBridge.MainWindow")
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        let controller = NSWindowController(window: window)
        controller.showWindow(nil)
        NSRunningApplication.current.activate(options: [.activateAllWindows])
        NSApp.activate(ignoringOtherApps: true)
        self.windowController = controller
        self.window = window
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

    var body: some View {
        VStack(spacing: 0) {
            HeaderView()
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    StatusGrid()
                    PolicyCenterPanel()
                    HStack(alignment: .top, spacing: 16) {
                        ExchangePanel()
                        ToolsPanel()
                    }
                    HStack(alignment: .top, spacing: 16) {
                        RootsPanel()
                        ActivityPanel()
                    }
                    TracePanel()
                    RuntimePanel()
                }
                .padding(20)
            }
            Divider()
            FooterBar()
        }
        .background(Color(nsColor: .windowBackgroundColor))
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

struct StatusGrid: View {
    @EnvironmentObject private var model: BridgeModel

    var body: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                MetricTile(
                    title: "Service",
                    value: model.isOnline ? "Online" : "Offline",
                    note: model.status?.version ?? "Rust engine",
                    tint: model.isOnline ? .green : .red,
                    symbol: model.isOnline ? "checkmark.circle.fill" : "xmark.circle.fill"
                )
                MetricTile(
                    title: "Port",
                    value: model.port,
                    note: "localhost listener",
                    tint: .blue,
                    symbol: "network"
                )
                MetricTile(
                    title: "Connector Tools",
                    value: "\(model.toolCatalog.count)",
                    note: "ChatGPT-visible MCP tools",
                    tint: .purple,
                    symbol: "wrench.and.screwdriver.fill"
                )
                MetricTile(
                    title: "Connector Trace",
                    value: "\(model.connectorActivity.toolCalls.count)",
                    note: "\(model.connectorActivity.auditEvents.count) audit events",
                    tint: .orange,
                    symbol: "waveform.path.ecg"
                )
            }
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
                .font(.system(size: 26, weight: .bold))
                .lineLimit(1)
            Text(note)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(1)
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
            PanelHeader(title: "Runtime", symbol: "server.rack")
            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 8) {
                RuntimeRow("Connector data", model.connectorDataDir.path)
                RuntimeRow("Data dir", model.dataDir.path)
                RuntimeRow("Log dir", model.logDir.path)
                RuntimeRow("Policy", model.policyPath.path)
                RuntimeRow("Engine", model.enginePath)
                RuntimeRow("PID", model.pidText)
                RuntimeRow("OAuth", model.status?.oauthEnabled == true ? "Enabled" : "Off")
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
                            ToolCatalogRow(tool: tool)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(tool.name)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textSelection(.enabled)
                Spacer()
                if let title = tool.title, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            if let description = tool.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
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

    let port = ProcessInfo.processInfo.environment["LOCALBRIDGE_PORT"] ?? "3842"
    let connectorDataDir: URL
    let dataDir: URL
    let logDir: URL
    let policyPath: URL
    let tokenPath: URL
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
        pidPath = dataDir.appendingPathComponent("bridge-rs.pid")
        enginePath = Bundle.main.path(forResource: "chatgpt2localbridge-rs", ofType: nil) ?? ""
    }

    func bootstrap() async {
        do {
            loadToolCatalog()
            refreshConnectorActivity()
            try ensureLocalFiles()
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

    func openChatGPT() {
        NSWorkspace.shared.open(URL(string: "https://chatgpt.com/")!)
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

    private enum CodingKeys: String, CodingKey {
        case callId = "id"
        case ts
        case tool
        case status
        case durationMs
        case args
        case result
        case error
    }
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
        case .process: return "Process"
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

    init(items: [TraceItem]) {
        reads = items.filter { $0.kind == .read }.count
        skills = items.filter { $0.kind == .skill }.count
        policies = items.filter { $0.kind == .policy }.count
        writes = items.filter { $0.kind == .write }.count
        downloads = items.filter { $0.kind == .download }.count
        errors = items.filter { $0.status == "error" || $0.kind == .error }.count
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
