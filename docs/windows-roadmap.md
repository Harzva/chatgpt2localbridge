# Windows Roadmap

ChatGPT2LocalBridge releases include a Windows Rust preview artifact. It is
useful for testing the local console shape, but it is not yet the full OAuth MCP
bridge.

## Current Windows Preview

- Rust native binary: `chatgpt2localbridge-rs.exe`
- Local app URL: `http://127.0.0.1:3842/app`
- Health and activity APIs
- Minimal MCP smoke surface
- Policy/example files bundled in the release zip

## Not Yet Complete

- Full OAuth connector parity with the Node/TypeScript bridge
- Windows service installer
- Windows-native tunnel setup guide
- Signed installer
- Full Codex Runner task console parity

## Planned Release Shape

```text
ChatGPT2LocalBridge-windows-x64-rust-preview.zip
  chatgpt2localbridge-rs.exe
  README-WINDOWS.md
  bridge.policy.example.json
  .env.example
  mcp-tools.json
```

## Contribution Targets

- Windows service template
- PowerShell setup script
- Cloudflare Tunnel / ngrok examples
- Windows screenshot evidence
- Codex Runner parity tests

PRs are welcome, especially from users who can validate on Windows 11 with a
real ChatGPT connector workflow.
