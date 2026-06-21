# ChatGPT2LocalBridge RS

Rust-native companion build for ChatGPT2LocalBridge.

This crate keeps the dependency surface intentionally small: `serde` and
`serde_json` handle policy files, activity JSONL, and MCP JSON-RPC payloads.
The first milestone focuses on a small, auditable local operator app:

- `GET /health`
- `GET /app`
- `GET /app/api/status`
- `GET /app/api/activity`
- minimal `POST /mcp` smoke support for `initialize`, `tools/list`,
  `bridge.health`, `bridge.activity`, and `file.list`

The TypeScript implementation remains the full production MCP/OAuth bridge. The
Rust version is the migration track for a smaller native binary and local
desktop packaging.

## Run

```bash
cargo run --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml -- --http 3842
```

With local config:

```bash
set -a
source .env.local
set +a
cargo run --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml -- --http 3842
```

Open:

```text
http://127.0.0.1:3842/app
```

## Init

```bash
cargo run --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml -- init --root ~/Projects
```

This creates `bridge.policy.json` and `.env.local` in the current directory if
they do not already exist.

## Current Scope

The Rust app is a working native console and MCP smoke server. It does not yet
include the full OAuth/DCR/PKCE flow or the full 38-tool MCP surface from the
TypeScript bridge.
