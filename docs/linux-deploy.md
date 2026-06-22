# Linux Deployment

Linux deployment is the same product pattern as Mac mini deployment: run the bridge on the machine that owns the files, expose only `/mcp` through HTTPS, and keep file access constrained by `bridge.policy.json`.

## One-Click Install On The Linux Host

Fast path:

```bash
curl -fsSL https://raw.githubusercontent.com/Harzva/chatgpt2localbridge/main/scripts/linux-one-click-install.sh | bash
```

With a narrow workspace root and first port:

```bash
curl -fsSL https://raw.githubusercontent.com/Harzva/chatgpt2localbridge/main/scripts/linux-one-click-install.sh | WORKSPACE_ROOT=/srv/workspace BRIDGE_PORT=3900 bash
```

The installer:

- clones or fast-forwards `https://github.com/Harzva/chatgpt2localbridge`
- runs `npm install` and `npm run build`
- initializes `bridge.policy.json` and `.env.local`
- picks the next free port if the requested port is busy
- starts the local bridge and verifies `/health`
- prints every ChatGPT Connector field to fill
- prints ngrok and Cloudflare registration links and tradeoffs
- prints an agent-safe setup prompt that avoids exposing secrets

Optional tunnel helpers:

```bash
curl -fsSL https://raw.githubusercontent.com/Harzva/chatgpt2localbridge/main/scripts/linux-one-click-install.sh | TUNNEL=cloudflare bash
curl -fsSL https://raw.githubusercontent.com/Harzva/chatgpt2localbridge/main/scripts/linux-one-click-install.sh | TUNNEL=ngrok NGROK_AUTHTOKEN=... NGROK_DOMAIN=my-bridge.ngrok-free.app bash
```

`TUNNEL=cloudflare` uses a Cloudflare Quick Tunnel when `cloudflared` is already installed. The generated `trycloudflare.com` URL is useful for smoke tests, but it can change after restart.

`TUNNEL=ngrok` requires `NGROK_AUTHTOKEN`. `NGROK_DOMAIN` is optional but recommended because ChatGPT Connector URLs should stay stable.

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

## ngrok vs Cloudflare

| Option | Best for | Register | What you need | Stability |
| --- | --- | --- | --- | --- |
| ngrok | Fastest fixed development URL and simple local DX | https://dashboard.ngrok.com/signup | `NGROK_AUTHTOKEN`, optional fixed `NGROK_DOMAIN` | Stable when you use a reserved/fixed domain |
| Cloudflare Quick Tunnel | No-domain smoke tests | https://dash.cloudflare.com/sign-up is optional for quick tests | `cloudflared` installed | URL can change after restart |
| Cloudflare Named Tunnel | Production with your own Cloudflare-managed domain | https://dash.cloudflare.com/sign-up | Cloudflare account, domain, Zero Trust tunnel | Stable hostname |

For ChatGPT Connectors, stable URLs are much easier to maintain. Use a fixed ngrok domain, Cloudflare named tunnel, or your own HTTPS reverse proxy after the first smoke test.

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

## Agent Setup Prompt

Use this when asking a coding agent or terminal agent to set up the Linux host:

```text
Install ChatGPT2LocalBridge from https://github.com/Harzva/chatgpt2localbridge on this Linux host.
Keep secrets local. Do not print .env.local, OAuth tokens, ngrok authtokens,
cookies, or unlock codes into chat.

Use a narrow WORKSPACE_ROOT. Run the Linux one-click installer. Verify /health.
If port 3838 is busy, use the next free port and report it.

For HTTPS:
- If ngrok is selected, ask the human for NGROK_AUTHTOKEN and optional NGROK_DOMAIN.
- If Cloudflare is selected, use Quick Tunnel only for smoke tests and explain
  that a named tunnel is needed for a stable production Connector URL.

Report only:
- local health result
- local app URL
- public MCP URL
- OAuth connector fields
- which tunnel mode was used

Never reveal tokens or unlock codes.
```

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
