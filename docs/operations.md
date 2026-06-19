# Operations

## Local Run

```bash
npm run build
LOCALBRIDGE_POLICY_PATH="$PWD/bridge.policy.json" node dist/index.js --http 3838
```

## Health

```bash
curl -sS http://127.0.0.1:3838/health
```

## OAuth Discovery

```bash
curl -sS "$LOCALBRIDGE_PUBLIC_BASE_URL/.well-known/oauth-protected-resource/mcp"
curl -sS "$LOCALBRIDGE_PUBLIC_BASE_URL/.well-known/oauth-authorization-server"
```

## Common 401 Causes

- ChatGPT selected an old connector.
- OAuth was not enabled in the running service.
- `LOCALBRIDGE_PUBLIC_BASE_URL` does not match the URL configured in ChatGPT.
- The token expired.
- The connector was created before OAuth metadata was fixed.
