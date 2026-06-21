# Alternatives

ChatGPT2LocalBridge ships with OAuth plus an HTTPS tunnel because that combination works well for hosted ChatGPT Custom Connectors. It is not the only possible architecture.

## Authentication Options

| Option | Good for | Tradeoff |
| --- | --- | --- |
| OAuth with DCR and PKCE | Hosted ChatGPT connectors that dynamically register clients | More code, but best revocation and connector fit |
| OAuth with CIMD | Hosted ChatGPT connectors that support client ID metadata documents | Avoids dynamic registration state, but requires correct metadata document handling |
| Static bearer token | Simple private clients | Harder to rotate, easy to paste in the wrong place |
| Header API key | Clients that support custom headers | Depends on connector UI support |
| URL token | Emergency compatibility | Avoid on public URLs; logs and histories can leak URLs |
| No auth | Loopback-only local testing | Never use on a public tunnel |
| Mixed auth | Advanced deployments with anonymous low-risk tools plus OAuth-protected privileged tools | Requires careful per-tool policy; not the default guide |
| ChatGPT Actions | Non-MCP API integrations | Useful for REST APIs, but it is a different product surface from MCP tools |

OpenAI references:

- Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- MCP and connectors guide: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- GPT Action authentication: https://developers.openai.com/api/docs/actions/authentication

## Tunnel Options

| Tunnel | Why use it | Notes |
| --- | --- | --- |
| ngrok | Fastest setup, fixed development domains, good local DX | Use an account-owned dev domain or custom domain for connector stability |
| Cloudflare Tunnel | Strong custom-domain story, long-running service friendly | `cloudflared` makes outbound connections; add Cloudflare Access when you want another policy layer |
| OpenAI Secure MCP Tunnel | Keeps MCP server private when available | In ChatGPT connector settings, choose Tunnel instead of a public server URL |
| VPS reverse proxy | Full control | More ops burden: TLS, firewall, updates, logging |
| Tailscale Funnel | Good if your team already uses Tailscale | Availability and policy depend on your tailnet setup |

## Recommended Default

For a public GitHub user:

```text
OAuth + fixed HTTPS tunnel + narrow allowedProjectRoots + launchd/systemd
```

For an enterprise workspace with supported access:

```text
OpenAI Secure MCP Tunnel + OAuth + private MCP server
```

For a REST-style integration that does not need MCP tools:

```text
ChatGPT Actions + API key or OAuth + HTTPS API
```
