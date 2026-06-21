# Authentication Modes

ChatGPT custom connectors can be configured with different authentication modes. ChatGPT2LocalBridge supports more than one operating style, but only some are safe for public HTTPS endpoints.

## Recommendation

Use OAuth for any connector that ChatGPT reaches through a public tunnel or public domain.

```text
ChatGPT -> public HTTPS /mcp -> OAuth -> bridge policy -> approved local roots
```

No Authentication is only for short-lived local or private-network testing where the endpoint is not publicly reachable.

## Mode Matrix

| Mode in ChatGPT UI | When to choose it | Bridge requirement | Risk |
| --- | --- | --- | --- |
| OAuth | Production, public HTTPS tunnels, Mac mini, Linux servers, shared workstations | `LOCALBRIDGE_OAUTH_ENABLED=1`, public base URL, OAuth metadata reachable | Best default; revocable and scoped by bridge policy |
| No Authentication | Loopback-only demos, private lab tests, temporary trusted LAN experiments | OAuth disabled or a bridge intentionally configured to accept unauthenticated requests | Dangerous on public URLs because anyone with the URL can call tools |
| Mixed Authentication | Advanced deployments where low-risk tools are public and privileged tools require OAuth | Tool-level policy and careful server design | Easy to misconfigure; not the default public guide |

## Why Mac Mini And Linux May Look Different

If a Mac mini connector was created as No Authentication and still worked, that means the running endpoint accepted unauthenticated MCP calls, or it had another compatibility path enabled.

If a Linux connector was created as OAuth, ChatGPT first completed an authorization flow, stored an access token for that connector instance, and then called `/mcp` with a bearer token.

Both can appear to work, but they are not equally safe:

- Mac mini No Authentication is acceptable only for a short, controlled test.
- Linux over Cloudflare Tunnel, ngrok, or any public domain should use OAuth.
- Separate machines should use separate connectors and separate policies.

## What To Enter In ChatGPT

For OAuth:

```text
Server URL: https://YOUR-DOMAIN/mcp
Auth URL: https://YOUR-DOMAIN/oauth/authorize
Token URL: https://YOUR-DOMAIN/oauth/token
Registration URL: https://YOUR-DOMAIN/oauth/register
Authorization server base: https://YOUR-DOMAIN
Resource: https://YOUR-DOMAIN/mcp
Scopes: workspace:read workspace:write shell:exec
OIDC: off
```

For No Authentication:

```text
Server URL: http://127.0.0.1:3838/mcp or a private test URL
Authentication: No Authentication
```

Do not use No Authentication with a public tunnel.

## Troubleshooting

If ChatGPT uses cloud Python instead of your connector, the bridge may be healthy but the connector is not selected, not authorized, or not loaded in the current conversation. Check the activity panel. A successful call should show the connector name and a tool such as `file.list`, `file.read_path`, or `code.read`.

If `/mcp` returns `401 Unauthorized`, the endpoint is alive and asking for OAuth. Reconnect or reauthorize the connector.

If `/health` works but ChatGPT cannot call tools, recreate the connector after verifying OAuth metadata:

```bash
curl -sS https://YOUR-DOMAIN/.well-known/oauth-protected-resource/mcp
curl -sS https://YOUR-DOMAIN/.well-known/oauth-authorization-server
```
