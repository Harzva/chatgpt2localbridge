# Linux Deployment

Linux deployment is the same product pattern as Mac mini deployment: run the bridge on the machine that owns the files, expose only `/mcp` through HTTPS, and keep file access constrained by `bridge.policy.json`.

## Architecture

```text
ChatGPT
  -> ChatGPT2LocalBridge Linux connector
  -> HTTPS tunnel or reverse proxy
  -> http://127.0.0.1:3838/mcp on Linux
  -> approved Linux workspace roots
```

Do not route Linux through a Mac mini unless that is the only way to reach the Linux host. A direct Linux connector is simpler and keeps policy boundaries clearer.

## Prepare A Linux Workspace

Pick narrow roots. Avoid approving `/`, `/home`, or broad user directories.

```bash
mkdir -p /srv/workspace
```

Example policy roots:

```text
/srv/workspace
/home/agent/projects
```

## Deploy From A Local Clone

From the repository on your local operator machine:

```bash
REMOTE=linux-box \
REMOTE_WORKSPACE=/srv/workspace \
REMOTE_ALLOWED_ROOTS="/srv/workspace,/home/agent/projects" \
REMOTE_RUNTIME=/data/chatgpt2localbridge-runtime \
PUBLIC_BASE_URL=https://linux-bridge.example.com \
bash scripts/deploy-linux-bridge.sh
```

The script uploads the built runtime, installs production Node dependencies, creates or reuses the runtime `.env`, writes `bridge.policy.json`, starts the bridge, and verifies `/health`.

## Expose HTTPS

Use one of these:

```bash
cloudflared tunnel --url http://127.0.0.1:3838 --no-autoupdate
```

or:

```bash
ngrok http 3838 --url=your-fixed-domain.ngrok-free.dev
```

For long-running use, prefer a named Cloudflare Tunnel, a fixed ngrok domain, or your own reverse proxy. Quick tunnels are useful for tests but can change.

## Create The ChatGPT Connector

Create a separate connector for Linux.

```text
Name: ChatGPT2LocalBridge Linux
Server URL: https://linux-bridge.example.com/mcp
Authentication: OAuth
```

Advanced OAuth fields:

```text
Auth URL: https://linux-bridge.example.com/oauth/authorize
Token URL: https://linux-bridge.example.com/oauth/token
Registration URL: https://linux-bridge.example.com/oauth/register
Authorization server base: https://linux-bridge.example.com
Resource: https://linux-bridge.example.com/mcp
Scopes: workspace:read workspace:write shell:exec
OIDC: off
```

When the authorization page asks for an unlock code, enter the value from the Linux runtime `.env` on that machine. Do not paste unlock codes into public chats, screenshots, commits, or issue reports.

## Test From ChatGPT

Ask ChatGPT to call the connector tool directly:

```text
Use the ChatGPT2LocalBridge Linux connector. Call file.read_path, not cloud Python.

paths=["/srv/workspace/README.md"]
maxLines=40
```

If the activity panel shows Python or code interpreter instead of the connector name, ChatGPT did not call the MCP connector. Refresh the conversation, reselect the connector, or reconnect the app.

## Test From The Operator Machine

Without revealing secrets, verify health and OAuth metadata:

```bash
curl -sS https://linux-bridge.example.com/health
curl -sS https://linux-bridge.example.com/.well-known/oauth-authorization-server
```

On the Linux host, inspect tool-call trace:

```bash
tail -40 /data/chatgpt2localbridge-runtime/tool-calls.jsonl
```

## Keep Mac And Linux Separate

Use one connector per machine:

```text
ChatGPT2LocalBridge Mac     -> Mac workspace roots
ChatGPT2LocalBridge Linux   -> Linux workspace roots
```

This avoids confusing paths such as `/Volumes/...` and `/home/...`, and it lets each machine keep a narrow policy.
