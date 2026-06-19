# Architecture

```text
ChatGPT
  -> OAuth Custom Connector
  -> HTTPS tunnel
  -> localhost:3838
  -> ChatGPT2LocalBridge
  -> local policy
  -> approved workspace roots
```

## Components

- MCP server: exposes file, code, shell, git, workspace, task, process, and bridge tools.
- HTTP transport: exposes `/mcp` for hosted clients.
- OAuth server: exposes discovery metadata, DCR, authorize, and token endpoints.
- Policy: decides which local paths and shell operations are allowed.
- Tunnel: optional public HTTPS route, commonly ngrok or a secure tunnel service.

## Why OAuth

OAuth lets ChatGPT register a client, redirect through an authorization page, exchange an authorization code for a bearer token, and then call `/mcp` with that token. This avoids copying static tokens into the ChatGPT connector UI.
