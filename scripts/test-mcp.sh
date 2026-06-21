#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
mkdir -p "$TMPDIR/workspace" "$TMPDIR/cloud"
mkdir -p "$TMPDIR/skills/demo-skill/references"
cat >"$TMPDIR/skills/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: Demo skill for local skill registry tests.
---

# Demo Skill

Use `references/checklist.md` before making a change.
EOF
cat >"$TMPDIR/skills/demo-skill/references/checklist.md" <<'EOF'
# Checklist

- Read policy first.
- Keep changes scoped.
EOF

cat > "$TMPDIR/bridge.policy.json" <<JSON
{
  "allowedProjectRoots": ["$ROOT", "$TMPDIR/workspace"],
  "skillRoots": ["$TMPDIR/skills"],
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
for (const name of ["project.snapshot", "project.bundle", "policy.read", "policy.validate", "skill.list", "skill.search", "skill.read", "skill.bundle", "skill.route", "file.list", "file.read_path", "file_read_path", "code.read", "shell.exec", "bridge.health", "bridge.activity", "cloud.download"]) {
  if (!tools.includes(name)) throw new Error(`missing tool: ${name}`);
}
console.log(`[test] tools ok (${tools.length})`);
'

echo "[test] absolute path read"
path_read_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"path-read-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"file.read_path\",\"arguments\":{\"paths\":[\"$ROOT/package.json\"],\"maxLines\":40}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/path-read-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/path-read-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$path_read_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const file = lines.find((line) => line.id === 2)?.result?.structuredContent?.files?.[0];
if (!file?.content?.includes("chatgpt2localbridge") || !file?.sha256 || file?.error) {
  throw new Error(`unexpected file.read_path result: ${JSON.stringify(file)}`);
}
console.log("[test] absolute path read ok");
'

echo "[test] absolute path read alias"
path_read_alias_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"path-read-alias-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"file_read_path\",\"arguments\":{\"paths\":[\"$ROOT/package.json\"],\"maxLines\":40}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/path-read-alias-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/path-read-alias-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$path_read_alias_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const file = lines.find((line) => line.id === 2)?.result?.structuredContent?.files?.[0];
if (!file?.content?.includes("chatgpt2localbridge") || !file?.sha256 || file?.error) {
  throw new Error(`unexpected file_read_path result: ${JSON.stringify(file)}`);
}
console.log("[test] absolute path read alias ok");
'

echo "[test] project bundle"
bundle_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"bundle-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"project.bundle\",\"arguments\":{\"projectPath\":\"$ROOT\",\"files\":[\"package.json\"],\"includeDirectorySummary\":true,\"maxEntries\":20,\"maxFileBytes\":20000,\"maxTotalBytes\":50000}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/bundle-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/bundle-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$bundle_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const bundle = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!bundle?.files?.some((file) => file.path === "package.json" && file.content?.includes("chatgpt2localbridge"))) {
  throw new Error(`unexpected project.bundle result: ${JSON.stringify(bundle)}`);
}
console.log("[test] project bundle ok");
'

echo "[test] local skills"
skill_list_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"skill.list\",\"arguments\":{\"skillRoot\":\"$TMPDIR/skills\",\"maxResults\":20}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/skill-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/skill-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"
skill_read_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill-read-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"skill.read\",\"arguments\":{\"skillRoot\":\"$TMPDIR/skills\",\"skill\":\"demo-skill\"}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/skill-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/skill-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"
skill_bundle_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill-bundle-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"skill.bundle\",\"arguments\":{\"skillRoot\":\"$TMPDIR/skills\",\"skill\":\"demo-skill\",\"includeReferences\":true}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/skill-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/skill-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"
skill_route_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill-route-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"skill.route\",\"arguments\":{\"skillRoot\":\"$TMPDIR/skills\",\"task\":\"use demo skill checklist\"}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/skill-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/skill-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n%s\n%s\n%s\n' "$skill_list_response" "$skill_read_response" "$skill_bundle_response" "$skill_route_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const list = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!list?.skills?.some((skill) => skill.id === "demo-skill")) throw new Error(`missing demo skill: ${JSON.stringify(list)}`);
const read = lines.find((line) => line.id === 3)?.result?.structuredContent;
if (!read?.content?.includes("Demo Skill")) throw new Error(`unexpected skill.read: ${JSON.stringify(read)}`);
const bundle = lines.find((line) => line.id === 4)?.result?.structuredContent;
if (!bundle?.files?.some((file) => file.path === "demo-skill/references/checklist.md")) {
  throw new Error(`missing bundled reference: ${JSON.stringify(bundle)}`);
}
const route = lines.find((line) => line.id === 5)?.result?.structuredContent;
if (!route?.recommendations?.some((skill) => skill.id === "demo-skill")) throw new Error(`unexpected skill.route: ${JSON.stringify(route)}`);
console.log("[test] local skills ok");
'

skill_activity_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill-activity-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"bridge.activity\",\"arguments\":{\"limit\":20,\"includeAudit\":true}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/skill-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/skill-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$skill_activity_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const activity = lines.find((line) => line.id === 6)?.result?.structuredContent;
if (!activity?.toolCalls?.some((call) => call.tool === "skill.read" && call.status === "ok")) {
  throw new Error(`missing skill.read activity: ${JSON.stringify(activity)}`);
}
if (!activity?.auditEvents?.some((event) => event.action === "skill.read")) {
  throw new Error(`missing skill.read audit event: ${JSON.stringify(activity)}`);
}
console.log("[test] skill activity ok");
'

echo "[test] cloud download"
printf 'hello from cloud\n' >"$TMPDIR/cloud/source.txt"
CLOUD_PORT="${LOCALBRIDGE_CLOUD_TEST_PORT:-44840}"
python3 -m http.server "$CLOUD_PORT" --directory "$TMPDIR/cloud" --bind 127.0.0.1 >"$TMPDIR/cloud.out" 2>"$TMPDIR/cloud.err" &
cloud_pid=$!
trap 'kill "$cloud_pid" >/dev/null 2>&1 || true; rm -rf "$TMPDIR"' EXIT

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:$CLOUD_PORT/source.txt" >/dev/null 2>/dev/null; then
    break
  fi
  sleep 0.1
done

download_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cloud-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"cloud.download\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"url\":\"http://127.0.0.1:$CLOUD_PORT/source.txt\",\"file\":\"downloads/source.txt\",\"overwrite\":false}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/cloud-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/cloud-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$download_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const download = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!download || download.bytes !== 17 || !download.sha256) throw new Error(`unexpected cloud.download result: ${JSON.stringify(download)}`);
console.log("[test] cloud download write ok");
'

activity_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"activity-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"bridge.activity\",\"arguments\":{\"limit\":20,\"includeAudit\":true}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/cloud-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/cloud-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$activity_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const activity = lines.find((line) => line.id === 3)?.result?.structuredContent;
if (!activity?.toolCalls?.some((call) => call.tool === "cloud.download" && call.status === "ok")) {
  throw new Error(`missing cloud.download activity: ${JSON.stringify(activity)}`);
}
if (!activity?.auditEvents?.some((event) => event.action === "cloud.download")) {
  throw new Error(`missing cloud.download audit event: ${JSON.stringify(activity)}`);
}
console.log("[test] cloud activity ok");
'

grep -q 'hello from cloud' "$TMPDIR/workspace/downloads/source.txt"
kill "$cloud_pid" >/dev/null 2>&1 || true
wait "$cloud_pid" 2>/dev/null || true
trap 'rm -rf "$TMPDIR"' EXIT

echo "[test] http /health"
PORT="${LOCALBRIDGE_TEST_PORT:-43838}"
LOCALBRIDGE_DATA_DIR="$TMPDIR/data" \
LOCALBRIDGE_LOG_DIR="$TMPDIR/logs" \
LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" \
LOCALBRIDGE_DASHBOARD_TOKEN="dashboard-test-token" \
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

curl -fsS -H 'x-localbridge-dashboard-token: dashboard-test-token' "http://127.0.0.1:$PORT/app/api/status" >"$TMPDIR/dashboard-status.json"
node -e '
const fs = require("node:fs");
const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (status.service !== "chatgpt2localbridge" || !status.dashboardTokenConfigured) {
  throw new Error(`unexpected dashboard status: ${JSON.stringify(status)}`);
}
console.log("[test] dashboard ok");
' "$TMPDIR/dashboard-status.json"

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
