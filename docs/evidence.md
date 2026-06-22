# Evidence Log

Date: 2026-06-21

This page records public-safe evidence for the current ChatGPT2LocalBridge
release. It intentionally avoids raw logs, unlock codes, OAuth tokens, cookies,
`.env.local`, and private credential material.

## Verified Commands

```bash
npm run -s build && npm run -s test
```

Observed public-safe result summary:

```text
[test] normal tools ok (55)
[test] chatgpt-app tools ok (14)
[test] chatgpt-app file_write ok
[test] chatgpt-app local_write_file ok
[test] chatgpt-app local_workspace_action write_file ok
[test] debug tools ok (69)
[test] codex-only tools ok (15)
[test] cloud download write ok
[test] oauth metadata ok
[test] ok
```

```bash
bash scripts/build-macos-app.sh --install
```

Observed public-safe result summary:

```text
release build finished
/Applications/ChatGPT2LocalBridge.app
```

## ChatGPT Connector Evidence

The connector was tested from ChatGPT with the public MCP endpoint configured as
an OAuth custom connector. The useful troubleshooting finding was:

- An older connector instance could cache only four tools:
  `bridge_health`, `file_list`, `file_read_path`, and `policy_read`.
- Recreating the connector after the tool profile update and using a fresh v3
  connector schema exposes the intended high-level runner surface.
- Verified ChatGPT-side action discovery for `attachlocal2chatgpt-v3` includes
  `handoff_create`, `codex_task_start`, `codex_status`, and `codex_result`.
- One field run confirmed that `handoff_create` can create the handoff and
  `codex_task_start` can create a task, but the task failed with
  `spawn codex ENOENT` when the background service could not find the local
  Codex CLI. The fix is to set `LOCALBRIDGE_CODEX_BIN` or install Codex in a
  service-visible bin directory.
- `codex.result` / `codex_result` now return a compact summary by default. Full
  logs and diffs are opt-in because hosted ChatGPT safety checks can block large
  execution records.
- Read calls and write smoke tests are tracked in the local app trace view.
- Write behavior is separately verified by
  [`CHATGPT_WRITE_TEST.md`](./CHATGPT_WRITE_TEST.md), a harmless Markdown file
  created through the connector flow.
- A `shell.exec` attempt that included risky command wording was blocked by the
  bridge safety policy. The plan was rewritten as plain text and then saved as a
  local TXT artifact. This is expected behavior and is useful evidence that the
  bridge is not a raw unrestricted command proxy.

## Linux Field Evidence

Date: 2026-06-22

A Linux host field run confirmed the same connector pattern works outside the
Mac mini setup:

- The repository was cloned on Linux, dependencies were installed, and the
  TypeScript build completed.
- `node dist/index.js init --root <approved-linux-workspace>` generated
  `.env.local` and `bridge.policy.json`.
- The default ports were already occupied, so the bridge was started on the next
  available test port and `/health` returned `status: ok`.
- A Cloudflare Quick Tunnel exposed the local bridge over HTTPS and `/health`
  worked through the public URL.
- OAuth metadata reflected the tunnel origin after
  `LOCALBRIDGE_PUBLIC_BASE_URL` was updated.
- The ChatGPT Connector fields used the public `/mcp`, `/oauth/authorize`,
  `/oauth/token`, and `/oauth/register` URLs.
- ngrok installation succeeded in a follow-up attempt, but tunnel startup
  correctly stopped at `ERR_NGROK_4018` until the operator supplies an ngrok
  authtoken.
- ChatGPT successfully called connector tools against a Linux workspace path;
  policy still constrained which paths could be read.

This is the field evidence behind the Linux one-click installer and the new
agent setup prompt. Raw logs, private local paths, unlock codes, and tokens are
intentionally excluded.

## Community Todo

- Linux packaging and deployment now have a one-click installer, but still need
  more distro and long-running service testing.
- Linux connector profiles should stay separate from macOS profiles so each
  machine keeps a narrow policy.
- Mobile ChatGPT can call the connector after the app is enabled for the
  conversation. This gives a Remote-Codex-like workflow from a phone without
  requiring a separate tun-mode remote desktop session.
- Contributions and PRs are welcome, especially for Linux service installers,
  Cloudflare Tunnel examples, systemd hardening, and distro-specific docs.

## Known Field Notes

- Keep `xhigh` / `XHigh` mode disabled by default. In local testing it produced
  more tool-call and connector errors than the normal profile.
- Prefer OAuth or a private tunnel for public endpoints.
- Do not publish unlock codes, OAuth stores, cookies, raw screenshots with
  secrets, or `.env.local`.
- Treat raw `shell.exec` as a debug surface. The normal ChatGPT path should
  prefer project, policy, bundle, trace, and Codex Runner tools.

## Public-Safe Evidence Included In Repo

- `assets/mcp-tools.json`: generated ChatGPT-visible MCP tool catalog.
- `docs/assets/evidence/chatgpt-v3-codex-runner-tools.svg`: sanitized evidence
  card showing the v3 ChatGPT connector action list with handoff and Codex
  Runner tools visible.
- `docs/CHATGPT_WRITE_TEST.md`: harmless write smoke-test artifact.
- `question/understanding.md`: public troubleshooting explanation of why write
  tools were missing before the profile update.
- `docs/assets/xhs-promo.png`: shareable Xiaohongshu-style product card.
- `docs/assets/xhs-community.png`: shareable community/PR card with Linux todo.
- `docs/assets/xhs-mobile-remote.png`: shareable mobile workflow card.
- `docs/promo/mobile-codex-runner.md`: mobile-first Xiaohongshu / WeChat copy
  for "phone ChatGPT delegates to local Codex CLI".
- `docs/assets/app_screenshots/`: real app and ChatGPT screenshots captured
  with `scripts/mac-screenshot.sh`.
