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
[test] normal tools ok (50)
[test] chatgpt-app tools ok (10)
[test] chatgpt-app file_write ok
[test] chatgpt-app local_write_file ok
[test] chatgpt-app local_workspace_action write_file ok
[test] debug tools ok (64)
[test] codex-only tools ok (14)
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
- Recreating the connector after the tool profile update exposes the intended
  `chatgpt-app` profile surface, currently ten tools.
- Read calls and write smoke tests are tracked in the local app trace view.
- Write behavior is separately verified by
  [`CHATGPT_WRITE_TEST.md`](./CHATGPT_WRITE_TEST.md), a harmless Markdown file
  created through the connector flow.

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
- `docs/CHATGPT_WRITE_TEST.md`: harmless write smoke-test artifact.
- `question/understanding.md`: public troubleshooting explanation of why write
  tools were missing before the profile update.
- `docs/assets/xhs-promo.png`: shareable Xiaohongshu-style product card.
