<div align="center">
  <img src="./docs/assets/logo.png" alt="ChatGPT2LocalBridge logo" width="180" />
  <h1>ChatGPT2LocalBridge</h1>
  <p><strong>Codex / ChatGPT Plugin App for approved local workspaces.</strong></p>
  <p>
    <img alt="Codex Plugin App" src="https://img.shields.io/badge/Codex-Plugin%20App-7c3aed.svg" />
    <img alt="ChatGPT Plugin App" src="https://img.shields.io/badge/ChatGPT-Plugin%20App-10a37f.svg" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" />
    <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933.svg" />
    <img alt="Rust" src="https://img.shields.io/badge/rust-native%20preview-b7410e.svg" />
    <img alt="MCP" src="https://img.shields.io/badge/MCP-Streamable%20HTTP-1769e0.svg" />
    <img alt="Status" src="https://img.shields.io/badge/status-alpha-f59e0b.svg" />
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/Harzva/chatgpt2localbridge?style=social" />
  </p>
  <p>
    <a href="./docs/index.html">Pages source</a>
    ·
    <a href="./docs/showcase.html">Showcase</a>
    ·
    <a href="./docs/human-tutorial.html">Human tutorial</a>
    ·
    <a href="./docs/agent-computer-use.html">Agent tutorial</a>
    ·
    <a href="./docs/authentication-modes.md">Auth modes</a>
    ·
    <a href="./docs/linux-deploy.md">Linux deploy</a>
    ·
    <a href="./docs/alternatives.md">Alternatives</a>
    ·
    <a href="./docs/sync-flows.md">Sync flows</a>
    ·
    <a href="./docs/evidence.md">Evidence</a>
    ·
    <a href="./docs/promo/xhs-note.md">Promo copy</a>
    ·
    <a href="./ROADMAP.md">Roadmap</a>
  </p>
</div>

![ChatGPT2LocalBridge cover](./docs/assets/cover.png)

<!-- showcase:start -->
<p align="center">
  <img src="./docs/assets/thumbnail-responsive.png" alt="ChatGPT2LocalBridge responsive preview" width="900" />
</p>
<!-- showcase:end -->

ChatGPT2LocalBridge is a self-hosted **Codex / ChatGPT Plugin App**: a local desktop/operator app plus an MCP connector that lets ChatGPT access approved local workspaces after authorization. It is designed for people who want ChatGPT or Codex-style agents to inspect, bundle, download, trace, or operate on local project files without uploading the whole workspace elsewhere.

The TypeScript build is the full OAuth MCP connector. A small Rust native
preview also lives in [`rust/chatgpt2localbridge-rs`](./rust/chatgpt2localbridge-rs)
for the local operator console, health checks, activity APIs, and a minimal MCP
smoke surface.

In this repository, **plugin app** means a small agent-facing product surface: a local app, a policy file, a tool catalog, trace records, and one or more ChatGPT/Codex-visible MCP tools. It is not a legacy ChatGPT plugin. It is best described as:

- **Codex Plugin App**
- **ChatGPT Plugin App**
- **MCP Server**
- **ChatGPT Custom Connector**
- **OAuth Local Workspace Bridge**

> Unofficial project. Not affiliated with OpenAI.

## Build Your Own Plugin App

This project is also an invitation to build more agent-facing plugin apps. A good plugin app should give ChatGPT or Codex a focused tool surface, keep risky operations behind policy, and give the human operator a clear local console.

| Layer | What to build | Example in this repo |
| --- | --- | --- |
| Agent interface | MCP tools with concise names, schemas, and safe defaults | `project.bundle`, `policy.read`, `codex.task_start` |
| Human control | A local app that shows status, policy, traces, and cancel buttons | Native macOS console |
| Safety policy | Approved roots, deny globs, auth mode, shell restrictions | `bridge.policy.json` |
| Distribution | README, GitHub Pages, screenshots, setup prompts, install scripts | `docs/`, `npx github:...`, macOS app bundle |

If you build your own plugin app, keep the default workflow narrow and readable: one clear problem, one safe tool surface, one local control panel, and one copyable ChatGPT test prompt.

## Route

```text
ChatGPT
  -> OAuth MCP Connector
  -> HTTPS tunnel
  -> http://127.0.0.1:3838/mcp
  -> ChatGPT2LocalBridge
  -> approved local workspace roots
```

ChatGPT does not directly mount your disk. It calls MCP tools, and every file operation is checked against `bridge.policy.json`.

## Architecture

<p align="center">
  <img src="./docs/assets/architecture-horizontal.png" alt="ChatGPT2LocalBridge horizontal architecture diagram" width="900" />
</p>

The intended product shape is a control plane, not just a raw shell bridge:

- **ChatGPT Web** makes structured MCP calls.
- **Connector auth** should use OAuth or Secure MCP Tunnel for public access.
- **Bridge policy** gates roots, deny globs, shell mode, timeouts, and traces.
- **Tool tiers** guide ChatGPT toward safer project and Codex Runner workflows.
- **Local app** shows policy, tool calls, logs, diffs, downloads, and cancellable tasks.

## 30-Second Install

```bash
npx github:harzva/chatgpt2localbridge init --root ~/Projects
set -a; source .env.local; set +a
npx github:harzva/chatgpt2localbridge --http 3838
```

Local clone flow:

```bash
git clone https://github.com/harzva/chatgpt2localbridge.git
cd chatgpt2localbridge
npm install
npm run build
node dist/index.js init --root ~/Projects
set -a; source .env.local; set +a
node dist/index.js --http 3838
```

Health check:

```bash
curl -sS http://127.0.0.1:3838/health
```

Local operator console:

```text
http://127.0.0.1:3838/app
```

Rust native preview:

```bash
cargo run --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml -- --http 3842
```

The Rust preview intentionally exposes a smaller MCP surface today:
`initialize`, `tools/list`, `bridge.health`, `bridge.activity`, and `file.list`.

Native macOS app:

```bash
npm run macos:install
open /Applications/ChatGPT2LocalBridge.app
```

The macOS app is a native AppKit/SwiftUI desktop console that embeds the Rust
engine, uses the repository logo as its `.icns` icon, manages the local `3842`
service, and shows the ChatGPT-visible MCP tool catalog, browser bundle prompts,
approved roots, editable policy, logs, connector tool calls, skill reads, write
events, and cloud-download trace records without needing the browser console.

The native **Policy Center** edits the local policy safely:

- workspace roots stay separate from skill roots
- the default skill root is `~/.codex/skills`
- saving creates `bridge.policy.backup.json`
- policy changes are written to local audit trace
- the app warns if you expose broad paths such as `~/.codex`

## Downloads And Releases

GitHub Releases provide prebuilt artifacts for local testing:

- `ChatGPT2LocalBridge-macos-*.app.zip`: native macOS control console with the
  Rust companion binary bundled inside the app.
- `ChatGPT2LocalBridge-windows-x64-rust-preview.zip`: Windows Rust-native local
  console preview.
- `chatgpt2localbridge-*.tgz`: npm package for the full TypeScript OAuth MCP
  bridge.

The Windows artifact is currently a Rust preview, while the full OAuth connector
surface remains the Node/TypeScript package. Release builds are generated by
`.github/workflows/release.yml` when a `v*` tag is pushed.

## ChatGPT Connector Setup

### Choose An Auth Mode

ChatGPT's custom connector UI may offer OAuth, No Authentication, and Mixed Authentication. This project supports more than one path, but the safe default depends on where the endpoint is reachable.

| Connector auth | Use when | Notes |
| --- | --- | --- |
| OAuth | Any public HTTPS tunnel, including Mac mini with ngrok/Cloudflare or a Linux server tunnel | Recommended default. ChatGPT completes an OAuth code flow and later calls `/mcp` with a bearer token. |
| No Authentication | Short-lived loopback-only or private-network tests | Works only if the bridge is intentionally running without OAuth. Do not use this on a public tunnel. |
| Mixed | Advanced per-tool policy where public tools are anonymous and privileged tools require OAuth | Useful later if you split tools by risk. The current public-safe guide keeps the whole connector OAuth-protected. |

If both OAuth and No Authentication appear to work, prefer OAuth for anything reachable from ChatGPT over the internet. No Authentication means the URL itself is the control surface.

Expose the local server through HTTPS:

```bash
ngrok http 3838 --url=your-fixed-domain.ngrok-free.dev
```

Then create a ChatGPT Custom Connector:

| Field | Value |
| --- | --- |
| Name | `ChatGPT2LocalBridge` |
| URL | `https://your-fixed-domain.ngrok-free.dev/mcp` |
| Auth | OAuth |

When the authorization page opens, enter the unlock code from `.env.local`. Do not paste unlock codes or tokens into public chats, issues, screenshots, or commits.

### Linux Server Setup

Linux works the same way as Mac mini: run one bridge next to the files you want ChatGPT to see, expose that bridge through HTTPS, then create a separate ChatGPT connector for that machine.

```bash
REMOTE=linux-box \
REMOTE_WORKSPACE=/srv/workspace \
REMOTE_ALLOWED_ROOTS="/srv/workspace,/home/agent/projects" \
PUBLIC_BASE_URL=https://linux-bridge.example.com \
bash scripts/deploy-linux-bridge.sh
```

Create a second connector such as `ChatGPT2LocalBridge Linux` with:

| Field | Value |
| --- | --- |
| URL | `https://linux-bridge.example.com/mcp` |
| Auth | OAuth |

Use separate connectors for separate machines so each policy can stay narrow. See [Linux deployment](./docs/linux-deploy.md).

## Screenshot Walkthrough

| Step | Preview |
| --- | --- |
| Initialize local policy | ![Initialize](./docs/assets/screenshots/01-init.png) |
| Run local MCP server | ![Run](./docs/assets/screenshots/02-run.png) |
| Review Policy Center | ![Policy Center](./docs/assets/screenshots/09-policy-center.png) |
| Check `/health` | ![Health](./docs/assets/screenshots/03-health.png) |
| Create connector | ![Connector](./docs/assets/screenshots/05-connector.png) |
| Authorize | ![Authorize](./docs/assets/screenshots/06-authorize.png) |
| Test file listing | ![Success](./docs/assets/screenshots/07-success.png) |

Full guides:

- [Human setup tutorial](./docs/human-tutorial.html)
- [Agent + Computer Use tutorial](./docs/agent-computer-use.html)
- [Visual showcase gallery](./docs/showcase.html)
- [Markdown human tutorial](./docs/tutorial-human.md)
- [Markdown agent tutorial](./docs/tutorial-agent-computer-use.md)

## Main MCP Tools

### Tool Tiers

| Tier | Default use | Tools |
| --- | --- | --- |
| High-level agent workflow | Recommended entry point for Web ChatGPT once Codex Runner lands | `codex.task_start`, `codex.status`, `codex.result` |
| Mid-level project workflow | Preferred today for reading context, checking policy, inspecting diffs, and running tests | `project.bundle`, `policy.read`, `git.diff`, `test.run` |
| Low-level debug primitives | Advanced troubleshooting only; avoid as the normal ChatGPT path | `file.read_path`, `file.write`, `shell.exec` |

The roadmap tracks the move from low-level primitives toward a safer Codex Runner surface. See [ROADMAP.md](./ROADMAP.md).

| Area | Examples |
| --- | --- |
| Project | `project.snapshot`, `project.bundle`, `project.index`, `project.scripts` |
| Policy | `policy.read`, `policy.validate` |
| Skills | `skill.list`, `skill.search`, `skill.read`, `skill.bundle`, `skill.route` |
| Code | `code.read`, `code.read_range`, `code.search` |
| Files | `file.list`, `file.read_path`, `file.stat`, `file.write`, `file.patch`, `file.delete` |
| Shell/tests | `shell.exec`, `test.detect`, `test.run` |
| Git | `git.status`, `git.diff`, `git.checkpoint`, `git.revert` |
| Runtime | `workspace.*`, `task.*`, `process.*`, `port.check` |
| Cloud sync | `cloud.download` |
| Bridge | `bridge.status`, `bridge.health`, `bridge.logs`, `bridge.activity`, `service.restart` |

The full ChatGPT-visible tool catalog is generated from MCP `tools/list` into
[`assets/mcp-tools.json`](./assets/mcp-tools.json):

```bash
npm run tools:catalog
```

`project.bundle` is the recommended multi-file context tool. It returns a
directory summary, selected text files, and optional git diff in one read-only
call, so ChatGPT can read local first and then create a cloud-side downloadable
copy from the returned content.

`skill.*` tools make local Codex skills readable through the connector without
turning the whole Codex runtime directory into a workspace. Configure:

```json
{
  "skillRoots": [
    "/Users/YOUR_USERNAME/.codex/skills"
  ]
}
```

Do not approve the whole `~/.codex` directory. It can contain sessions,
attachments, local configuration, and other private runtime files.

## File Sync And Activity

- Local files can be read by ChatGPT through approved MCP tools.
- Multiple local files can be bundled with `project.bundle`.
- MCP-read local file content can be re-emitted by ChatGPT as a cloud-side downloadable artifact when the user wants a copy in the conversation.
- For stable Trace Studio grouping, ask ChatGPT to call `trace.session_start` at the beginning of each conversation, and `task.start` before long multi-step work.
- ChatGPT/App-provided cloud file download URLs can be written back to local disk with `cloud.download`.
- Tool calls are persisted to `tool-calls.jsonl`.
- File writes, downloads, tasks, processes, and service restarts are persisted to `audit.jsonl`.
- The local console at `/app` and native macOS app show status, tool calls, and audit events.

See [file sync flows](./docs/sync-flows.md).

## Field Evidence

The current release includes sanitized evidence from local and ChatGPT connector
tests: build/test output, macOS app installation, tool catalog counts, write
smoke tests, and connector troubleshooting notes. See
[`docs/evidence.md`](./docs/evidence.md).

Field note: keep `xhigh` / `XHigh` mode off by default. In local testing it
produced more connector/tool-call errors than the normal profile, so use it only
for focused debugging with trace capture enabled.

## Star History

<a href="https://www.star-history.com/?repos=Harzva%2Fchatgpt2localbridge&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Harzva/chatgpt2localbridge&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Harzva/chatgpt2localbridge&type=date&legend=top-left" />
   <img alt="Star History Chart for Harzva/chatgpt2localbridge" src="https://api.star-history.com/chart?repos=Harzva/chatgpt2localbridge&type=date&legend=top-left" />
 </picture>
</a>

## Security Defaults

- Do not run unauthenticated on a public URL.
- Keep `allowedProjectRoots` narrow.
- Keep `skillRoots` narrow; prefer `~/.codex/skills`, not `~/.codex`.
- Never commit `.env.local`, `bridge.policy.json`, OAuth stores, tokens, cookies, or unlock codes.
- Prefer OAuth over URL tokens.
- Set `LOCALBRIDGE_DASHBOARD_TOKEN` before using `/app`.
- Review shell deny rules before enabling shell access for broad workspaces.

See [security model](./docs/security.md).

## Alternatives

OAuth + fixed HTTPS tunnel is the default because it fits ChatGPT Custom Connectors well. Other options exist:

- OpenAI Secure MCP Tunnel, when available to your workspace
- Cloudflare Tunnel
- VPS reverse proxy
- Static bearer token for private clients
- Loopback-only no-auth testing

See [alternatives](./docs/alternatives.md).

## GitHub Pages

The static product site lives in [`docs/`](./docs/index.html). The repository includes a GitHub Actions workflow that deploys it to GitHub Pages after pushing to `main`.

## Development

```bash
npm install
npm run typecheck
npm run tools:catalog
npm test
npm pack --dry-run
cargo test --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml
cargo build --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml
cargo build --release --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml
npm run macos:app
npm run macos:install
```

Render README and docs assets:

```bash
npm run docs:assets
npm run docs:preview
```

## Public Release Checklist

- [ ] Enable GitHub Pages with the included workflow.
- [ ] Confirm `npm test` passes in GitHub Actions.
- [ ] Keep `.env.local` and `bridge.policy.json` untracked.
- [ ] Verify the ChatGPT connector uses OAuth and the correct `/mcp` URL.

## License

MIT
