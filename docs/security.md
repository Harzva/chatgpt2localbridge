# Security Model

ChatGPT2LocalBridge is powerful because it lets a remote ChatGPT session call local tools. Treat the public URL as a sensitive control surface.

## Boundaries

- File access is limited by `allowedProjectRoots`.
- Deny globs block common secret files.
- Shell commands are filtered by deny patterns.
- Hosted ChatGPT access should use OAuth.
- No Authentication is only for loopback-only or private short-lived tests.
- The unlock code is local operator authorization, not a public password to share.

## Do Not Commit

- `.env`
- `bridge.policy.json`
- OAuth store files
- dashboard tokens
- API keys
- cookies
- tokens
- unlock codes
- raw chat logs
- machine-specific private paths

## Recommended Public Setup

1. Run the bridge only on `127.0.0.1`.
2. Expose it with a tunnel that provides HTTPS.
3. Enable OAuth.
4. Use a long random `LOCALBRIDGE_OAUTH_UNLOCK_CODE`.
5. Keep `LOCALBRIDGE_ALLOW_URL_TOKEN=0`.
6. Keep `allowedProjectRoots` narrow.
7. Use `cloud.download` only with trusted HTTPS file URLs.
8. Set `LOCALBRIDGE_DASHBOARD_TOKEN` before exposing the local console.

## Public Tunnel Rule

If ChatGPT reaches the bridge through ngrok, Cloudflare Tunnel, a VPS reverse proxy, or any public HTTPS domain, choose OAuth in the ChatGPT connector UI.

No Authentication can be useful while testing a loopback-only MCP endpoint, but it should not be used with a public tunnel.
