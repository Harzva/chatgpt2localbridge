#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$TMPDIR/bridge.policy.json" <<JSON
{
  "allowedProjectRoots": ["$ROOT"],
  "denyGlobs": ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/.ssh/**"],
  "shell": {
    "enabled": true,
    "denyPatterns": ["sudo", "rm\\\\s+-rf\\\\s+/", "chmod\\\\s+-R", "chown\\\\s+-R"]
  }
}
JSON

echo "[test] build"
npm run build >/dev/null

echo "[test] stdio tools/list"
response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/data" LOCALBRIDGE_LOG_DIR="$TMPDIR/logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tools = lines.find((line) => line.id === 2)?.result?.tools?.map((tool) => tool.name) ?? [];
for (const name of ["project.snapshot", "file.list", "code.read", "shell.exec", "bridge.health"]) {
  if (!tools.includes(name)) throw new Error(`missing tool: ${name}`);
}
console.log(`[test] tools ok (${tools.length})`);
'

echo "[test] http /health"
PORT="${LOCALBRIDGE_TEST_PORT:-43838}"
LOCALBRIDGE_DATA_DIR="$TMPDIR/data" \
LOCALBRIDGE_LOG_DIR="$TMPDIR/logs" \
LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" \
node dist/index.js --http "$PORT" >"$TMPDIR/http.out" 2>"$TMPDIR/http.err" &
pid=$!
trap 'kill "$pid" >/dev/null 2>&1 || true; rm -rf "$TMPDIR"' EXIT

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/tmp/chatgpt2localbridge-health.json 2>/dev/null; then
    break
  fi
  sleep 0.1
done

node -e '
const fs = require("node:fs");
const health = JSON.parse(fs.readFileSync("/tmp/chatgpt2localbridge-health.json", "utf8"));
if (health.status !== "ok" || health.service !== "chatgpt2localbridge") {
  throw new Error(`unexpected health payload: ${JSON.stringify(health)}`);
}
console.log("[test] health ok");
'

kill "$pid" >/dev/null 2>&1 || true
wait "$pid" 2>/dev/null || true
trap 'rm -rf "$TMPDIR"' EXIT

echo "[test] oauth challenge"
OAUTH_PORT="$((PORT + 1))"
LOCALBRIDGE_DATA_DIR="$TMPDIR/oauth-data" \
LOCALBRIDGE_LOG_DIR="$TMPDIR/oauth-logs" \
LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" \
LOCALBRIDGE_OAUTH_ENABLED=1 \
LOCALBRIDGE_PUBLIC_BASE_URL="http://127.0.0.1:$OAUTH_PORT" \
LOCALBRIDGE_OAUTH_UNLOCK_CODE="test-unlock-code" \
node dist/index.js --http "$OAUTH_PORT" >"$TMPDIR/oauth.out" 2>"$TMPDIR/oauth.err" &
oauth_pid=$!
trap 'kill "$oauth_pid" >/dev/null 2>&1 || true; rm -rf "$TMPDIR"' EXIT

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:$OAUTH_PORT/health" >/dev/null 2>/dev/null; then
    break
  fi
  sleep 0.1
done

status="$(
  curl -sS -o "$TMPDIR/oauth-unauthorized.json" -w '%{http_code}' \
    -X POST "http://127.0.0.1:$OAUTH_PORT/mcp" \
    -H 'content-type: application/json' \
    --data '{}'
)"
if [[ "$status" != "401" ]]; then
  echo "[test] expected OAuth-protected /mcp to return 401, got $status" >&2
  cat "$TMPDIR/oauth-unauthorized.json" >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:$OAUTH_PORT/.well-known/oauth-authorization-server" >"$TMPDIR/oauth-metadata.json"
node -e '
const fs = require("node:fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
  if (!metadata[key]) throw new Error(`missing OAuth metadata field: ${key}`);
}
console.log("[test] oauth metadata ok");
' "$TMPDIR/oauth-metadata.json"

echo "[test] ok"
