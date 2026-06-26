#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
mkdir -p "$TMPDIR/workspace" "$TMPDIR/cloud"
mkdir -p "$TMPDIR/skills/demo-skill/references"
mkdir -p "$TMPDIR/workspace/.codex/skills/project-skill/references"
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
cat >"$TMPDIR/workspace/.codex/skills/project-skill/SKILL.md" <<'EOF'
---
name: project-skill
description: Project local skill for .codex discovery tests.
---

# Project Skill

Use `references/project-note.md` for project-local guidance.
EOF
cat >"$TMPDIR/workspace/.codex/skills/project-skill/references/project-note.md" <<'EOF'
# Project Note

- This came from project .codex/skills.
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

echo "[test] stdio tools/list normal profile"
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
for (const name of ["project.snapshot", "project.bundle", "policy.read", "policy.validate", "skill.list", "skill.search", "skill.read", "skill.bundle", "skill.route", "file.list", "file.read_path", "file_read_path", "code.read", "bridge.health", "bridge.activity", "cloud.download", "handoff.create", "codex.task_start", "codex.status", "codex.result", "codex.cancel"]) {
  if (!tools.includes(name)) throw new Error(`missing tool: ${name}`);
}
for (const name of ["shell.exec", "process.start", "file.write", "file.delete", "service.restart"]) {
  if (tools.includes(name)) throw new Error(`normal profile exposed low-level tool: ${name}`);
}
console.log(`[test] normal tools ok (${tools.length})`);
'

echo "[test] stdio tools/list chatgpt-app profile"
chatgpt_app_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$chatgpt_app_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tools = lines.find((line) => line.id === 2)?.result?.tools?.map((tool) => tool.name) ?? [];
const expected = ["bridge_health", "policy_read", "file_list", "file_read_path", "file_write", "local_list_dir", "local_read_file", "local_write_file", "local_bundle_dir", "batch_read", "local_workspace_action", "handoff_create", "codex_task_start", "codex_status", "codex_result"];
for (const name of expected) {
  if (!tools.includes(name)) throw new Error(`chatgpt-app profile missing tool: ${name}`);
}
for (const name of ["file.read_path", "shell.exec", "shell_exec", "file.write", "process.start", "service.restart"]) {
  if (tools.includes(name)) throw new Error(`chatgpt-app profile exposed unsafe or ambiguous tool: ${name}`);
}
if (tools.length !== expected.length) throw new Error(`chatgpt-app profile expected ${expected.length} tools, got ${tools.length}: ${tools.join(", ")}`);
console.log(`[test] chatgpt-app tools ok (${tools.length})`);
'

echo "[test] chatgpt-app file_write"
file_write_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-write-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"file_write\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"file\":\"chatgpt-app/hello.py\",\"content\":\"print('hello from chatgpt-app')\\n\",\"createDirs\":true}}}" \
  | LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$file_write_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const result = lines.find((line) => line.id === 2)?.result;
if (!result?.content?.[0]?.text?.includes("Wrote chatgpt-app/hello.py")) {
  throw new Error(`unexpected file_write result: ${JSON.stringify(result)}`);
}
console.log("[test] chatgpt-app file_write ok");
'

grep -q "hello from chatgpt-app" "$TMPDIR/workspace/chatgpt-app/hello.py"

echo "[test] chatgpt-app local_write_file"
local_write_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-local-write-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"local_write_file\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"file\":\"chatgpt-app/local-write.txt\",\"content\":\"hello from local_write_file\\n\",\"createDirs\":true}}}" \
  | LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$local_write_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const result = lines.find((line) => line.id === 2)?.result;
if (!result?.content?.[0]?.text?.includes("Wrote chatgpt-app/local-write.txt")) {
  throw new Error(`unexpected local_write_file result: ${JSON.stringify(result)}`);
}
console.log("[test] chatgpt-app local_write_file ok");
'

grep -q "hello from local_write_file" "$TMPDIR/workspace/chatgpt-app/local-write.txt"

echo "[test] chatgpt-app local_workspace_action write_file"
workspace_action_write_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-workspace-action-write-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"local_workspace_action\",\"arguments\":{\"action\":\"write_file\",\"projectPath\":\"$TMPDIR/workspace\",\"path\":\"chatgpt-app/action-write.txt\",\"content\":\"hello from workspace action\\n\",\"createDirs\":true}}}" \
  | LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$workspace_action_write_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const result = lines.find((line) => line.id === 2)?.result;
if (!result?.content?.[0]?.text?.includes("Wrote chatgpt-app/action-write.txt")) {
  throw new Error(`unexpected local_workspace_action write result: ${JSON.stringify(result)}`);
}
console.log("[test] chatgpt-app local_workspace_action write_file ok");
'

grep -q "hello from workspace action" "$TMPDIR/workspace/chatgpt-app/action-write.txt"

echo "[test] chatgpt-app batch_read"
mkdir -p "$TMPDIR/workspace/src/main/java/com/example"
printf 'class Alpha {}\n' >"$TMPDIR/workspace/src/main/java/com/example/Alpha.java"
printf 'class Beta {}\n' >"$TMPDIR/workspace/src/main/java/com/example/Beta.java"
printf 'export const gamma = 1;\n' >"$TMPDIR/workspace/src/main/java/com/example/Gamma.ts"
batch_read_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-batch-read-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"batch_read\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"globs\":[\"src/**/*.java\"],\"maxFiles\":10,\"maxFileBytes\":20000,\"maxTotalBytes\":50000}}}" \
  | LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$batch_read_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const result = lines.find((line) => line.id === 2)?.result?.structuredContent;
const paths = result?.files?.map((file) => file.path) ?? [];
if (!paths.includes("src/main/java/com/example/Alpha.java") || !paths.includes("src/main/java/com/example/Beta.java")) {
  throw new Error(`unexpected batch_read paths: ${JSON.stringify(result)}`);
}
if (!result.files.some((file) => file.content?.includes("class Alpha")) || !result.files.some((file) => file.content?.includes("class Beta"))) {
  throw new Error(`unexpected batch_read content: ${JSON.stringify(result)}`);
}
console.log("[test] chatgpt-app batch_read ok");
'

echo "[test] chatgpt-app batch_read fallback without rg"
batch_read_fallback_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-batch-read-fallback-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"batch_read\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"globs\":[\"src/**/*.ts\"],\"maxFiles\":10,\"maxFileBytes\":20000,\"maxTotalBytes\":50000}}}" \
  | PATH="/usr/bin:/bin" LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" "$NODE_BIN" dist/index.js 2>/dev/null
)"

printf '%s\n' "$batch_read_fallback_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const result = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!result?.files?.some((file) => file.path === "src/main/java/com/example/Gamma.ts" && file.content?.includes("gamma"))) {
  throw new Error(`unexpected batch_read fallback result: ${JSON.stringify(result)}`);
}
if (!result?.notes?.some((note) => note.includes("built-in glob fallback"))) {
  throw new Error(`missing batch_read fallback note: ${JSON.stringify(result)}`);
}
console.log("[test] chatgpt-app batch_read fallback ok");
'

echo "[test] chatgpt-app handoff/codex aliases"
cat >"$TMPDIR/fake-codex-chatgpt" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
out=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--output-last-message" ]]; then
    out="$arg"
  fi
  prev="$arg"
done
echo '{"event":"fake-codex-chatgpt","message":"alias smoke passed"}'
if [[ -n "$out" ]]; then
  printf 'fake chatgpt alias codex complete\n' >"$out"
fi
SH
chmod +x "$TMPDIR/fake-codex-chatgpt"

chatgpt_handoff_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-handoff-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"handoff_create\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"title\":\"ChatGPT alias handoff\",\"objective\":\"Create a fake handoff alias result.\",\"constraints\":[\"Operate only inside the approved project root.\"],\"allowedOperations\":[\"read\",\"write\",\"create_artifact\"],\"riskLevel\":\"low\",\"acceptanceCriteria\":[\"Fake alias handoff completed.\"],\"skillRoot\":\"$TMPDIR/skills\",\"skillTask\":\"use demo skill checklist\",\"maxSkillContext\":1}}}" \
  | LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-codex-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-codex-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"
chatgpt_handoff_id="$(printf '%s\n' "$chatgpt_handoff_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const created = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!created?.handoffId || created?.handoff?.riskLevel !== "low") {
  throw new Error(`unexpected handoff_create result: ${JSON.stringify(created)}`);
}
process.stdout.write(created.handoffId);
')"
chatgpt_codex_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"chatgpt-app-codex-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"codex_task_start\",\"arguments\":{\"handoffId\":\"$chatgpt_handoff_id\",\"timeoutMs\":5000}}}" \
  | LOCALBRIDGE_CODEX_BIN="$TMPDIR/fake-codex-chatgpt" LOCALBRIDGE_TOOL_PROFILE=chatgpt-app LOCALBRIDGE_DATA_DIR="$TMPDIR/chatgpt-app-codex-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/chatgpt-app-codex-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"
printf '%s\n' "$chatgpt_codex_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const started = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!started?.id || !started?.handoffId || !started?.command?.includes("--dangerously-bypass-approvals-and-sandbox")) {
  throw new Error(`unexpected codex_task_start alias result: ${JSON.stringify(started)}`);
}
console.log("[test] chatgpt-app handoff/codex aliases ok");
'

echo "[test] stdio tools/list debug profile"
debug_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"debug-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | LOCALBRIDGE_TOOL_PROFILE=debug LOCALBRIDGE_DATA_DIR="$TMPDIR/debug-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/debug-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$debug_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tools = lines.find((line) => line.id === 2)?.result?.tools?.map((tool) => tool.name) ?? [];
for (const name of ["shell.exec", "process.start", "file.write", "file.delete", "service.restart"]) {
  if (!tools.includes(name)) throw new Error(`debug profile missing low-level tool: ${name}`);
}
console.log(`[test] debug tools ok (${tools.length})`);
'

echo "[test] stdio tools/list codex-runner-only profile"
codex_only_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"codex-only-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | LOCALBRIDGE_TOOL_PROFILE=codex-runner-only LOCALBRIDGE_DATA_DIR="$TMPDIR/codex-only-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/codex-only-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$codex_only_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tools = lines.find((line) => line.id === 2)?.result?.tools?.map((tool) => tool.name) ?? [];
for (const name of ["handoff.create", "codex.task_start", "codex.status", "codex.result", "codex.cancel", "bridge.health", "bridge.activity", "policy.read"]) {
  if (!tools.includes(name)) throw new Error(`codex-only profile missing tool: ${name}`);
}
for (const name of ["project.bundle", "file.read_path", "shell.exec", "file.write"]) {
  if (tools.includes(name)) throw new Error(`codex-only profile exposed tool: ${name}`);
}
console.log(`[test] codex-only tools ok (${tools.length})`);
'

echo "[test] codex runner"
cat >"$TMPDIR/fake-codex" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${FAKE_EXPECT_BASE_URL:-}" != "" && "${OPENAI_BASE_URL:-}" != "$FAKE_EXPECT_BASE_URL" ]]; then
  echo "OPENAI_BASE_URL mismatch: ${OPENAI_BASE_URL:-}" >&2
  exit 64
fi
if [[ "${FAKE_EXPECT_OPENAI_API_KEY:-}" != "" && "${OPENAI_API_KEY:-}" != "$FAKE_EXPECT_OPENAI_API_KEY" ]]; then
  echo "OPENAI_API_KEY mismatch" >&2
  exit 65
fi
out=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--output-last-message" ]]; then
    out="$arg"
  fi
  prev="$arg"
done
echo '{"event":"fake-codex","message":"tests passed"}'
if [[ -n "$out" ]]; then
  printf 'fake codex complete\ntests passed\n' >"$out"
fi
SH
chmod +x "$TMPDIR/fake-codex"

handoff_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"handoff-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"handoff.create\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"title\":\"Handoff smoke\",\"objective\":\"Create a fake Codex handoff smoke result.\",\"constraints\":[\"Operate only inside the approved project root.\"],\"allowedOperations\":[\"read\",\"write\",\"run_tests\"],\"testCommands\":[\"npm test\"],\"expectedArtifacts\":[\"docs/HANDOFF_DEMO.md\"],\"riskLevel\":\"low\",\"acceptanceCriteria\":[\"Fake Codex completed.\"],\"skillContext\":[\"manual-demo-context\"],\"skillRoot\":\"$TMPDIR/skills\",\"skillTask\":\"use demo skill checklist\",\"maxSkillContext\":2,\"notes\":\"created by smoke test\"}}}" \
  | CODEX_BIN="$TMPDIR/fake-codex" LOCALBRIDGE_DATA_DIR="$TMPDIR/codex-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/codex-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

handoff_id="$(printf '%s\n' "$handoff_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const created = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!created?.handoffId || !created?.handoffFile || created?.handoff?.riskLevel !== "low" || !created?.handoff?.skillContext?.some((item) => item.includes("demo-skill"))) {
  throw new Error(`unexpected handoff.create result: ${JSON.stringify(created)}`);
}
if (!fs.existsSync(created.handoffFile)) {
  throw new Error(`handoff file missing: ${created.handoffFile}`);
}
process.stdout.write(created.handoffId);
')"

codex_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"codex-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"codex.task_start\",\"arguments\":{\"handoffId\":\"$handoff_id\",\"timeoutMs\":5000}}}" \
  | CODEX_BIN="$TMPDIR/fake-codex" FAKE_EXPECT_BASE_URL="http://127.0.0.1:4999/v1" FAKE_EXPECT_OPENAI_API_KEY="sub2api-test-key" SUB2API_KEY="sub2api-test-key" LOCALBRIDGE_CODEX_PROVIDER="sub2api" LOCALBRIDGE_CODEX_BASE_URL="http://127.0.0.1:4999/v1" LOCALBRIDGE_CODEX_API_KEY_ENV="SUB2API_KEY" LOCALBRIDGE_DATA_DIR="$TMPDIR/codex-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/codex-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

codex_task_id="$(printf '%s\n' "$codex_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const started = lines.find((line) => line.id === 2)?.result?.structuredContent;
if (!started?.id || !started?.handoffId || !started?.handoff || !started?.command?.includes(" exec --json --cd ") || !started?.command?.includes("--sandbox danger-full-access") || !started?.command?.includes("--dangerously-bypass-approvals-and-sandbox") || !started?.logFile || !started?.notes?.some((note) => note.text.includes("provider=sub2api@127.0.0.1:4999"))) {
  throw new Error(`unexpected codex.task_start result: ${JSON.stringify(started)}`);
}
process.stdout.write(started.id);
')"

for _ in {1..20}; do
  if node -e '
const fs = require("node:fs");
const file = process.argv[1];
const id = process.argv[2];
const tasks = JSON.parse(fs.readFileSync(file, "utf8"));
const task = tasks.find((item) => item.id === id);
if (!task || !["success", "running"].includes(task.status) || !task.logFile || !task.resultFile) process.exit(1);
' "$TMPDIR/codex-data/tasks.json" "$codex_task_id"; then
    break
  fi
  sleep 0.1
done
node -e '
const fs = require("node:fs");
const file = process.argv[1];
const id = process.argv[2];
const tasks = JSON.parse(fs.readFileSync(file, "utf8"));
const task = tasks.find((item) => item.id === id);
if (!task || !["success", "running"].includes(task.status) || !task.logFile || !task.resultFile) {
  throw new Error(`unexpected persisted codex task: ${JSON.stringify(task)}`);
}
console.log("[test] codex runner ok");
' "$TMPDIR/codex-data/tasks.json" "$codex_task_id"

codex_result_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"codex-result-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"codex.result\",\"arguments\":{\"taskId\":\"$codex_task_id\",\"limit\":1,\"includeLog\":true}}}" \
  | CODEX_BIN="$TMPDIR/fake-codex" LOCALBRIDGE_DATA_DIR="$TMPDIR/codex-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/codex-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$codex_result_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const result = lines.find((line) => line.id === 2)?.result?.structuredContent;
const handoffId = result?.handoff?.id ?? result?.tasks?.[0]?.handoffId;
if (handoffId !== process.argv[1] || !result?.logTail?.includes("fake-codex")) {
  throw new Error(`unexpected codex.result handoff result: ${JSON.stringify(result)}`);
}
console.log("[test] handoff codex result ok");
' "$handoff_id"

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
skill_bundle_blocked_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill-bundle-blocked-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"skill.bundle\",\"arguments\":{\"skillRoot\":\"$TMPDIR/skills\",\"skill\":\"demo-skill\",\"includeReferences\":true}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/skill-blocked-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/skill-blocked-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"
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
skill_activation_id="$(printf '%s\n' "$skill_read_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const activationId = lines.find((line) => line.id === 3)?.result?.structuredContent?.activationId;
if (!activationId) throw new Error(`missing activationId: ${JSON.stringify(lines)}`);
process.stdout.write(activationId);
')"
skill_bundle_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"skill-bundle-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"skill.bundle\",\"arguments\":{\"skillRoot\":\"$TMPDIR/skills\",\"skill\":\"demo-skill\",\"includeReferences\":true,\"activationId\":\"$skill_activation_id\"}}}" \
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

printf '%s\n' "$skill_bundle_blocked_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const bundle = lines.find((line) => line.id === 7)?.result?.structuredContent;
if (bundle?.files?.some((file) => file.path === "demo-skill/references/checklist.md")) {
  throw new Error(`reference should be gated before skill.read: ${JSON.stringify(bundle)}`);
}
if (!bundle?.notes?.some((note) => note.includes("Reference files are gated"))) {
  throw new Error(`missing gated reference note: ${JSON.stringify(bundle)}`);
}
console.log("[test] skill activation gate ok");
'

echo "[test] project .codex skills"
project_skill_direct_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"project-skill-direct-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"skill.bundle\",\"arguments\":{\"skillRoot\":\"$TMPDIR/workspace/.codex/skills\",\"skill\":\"project-skill\",\"includeReferences\":true}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/project-skill-direct-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/project-skill-direct-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"
project_skill_response="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"project-skill-smoke","version":"0.1.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"handoff.create\",\"arguments\":{\"projectPath\":\"$TMPDIR/workspace\",\"title\":\"Project skill handoff\",\"objective\":\"Use project skill.\",\"constraints\":[\"Operate only inside project.\"],\"allowedOperations\":[\"read\"],\"riskLevel\":\"low\",\"skillTask\":\"project local guidance\",\"maxSkillContext\":3}}}" \
  | LOCALBRIDGE_DATA_DIR="$TMPDIR/project-skill-data" LOCALBRIDGE_LOG_DIR="$TMPDIR/project-skill-logs" LOCALBRIDGE_POLICY_PATH="$TMPDIR/bridge.policy.json" node dist/index.js 2>/dev/null
)"

printf '%s\n' "$project_skill_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const handoff = lines.find((line) => line.id === 8)?.result?.structuredContent?.handoff;
if (!handoff?.skillContext?.some((item) => item.includes("project-skill"))) {
  throw new Error(`project .codex skill was not routed into handoff: ${JSON.stringify(handoff)}`);
}
if (!handoff?.skillActivations?.some((item) => item.id === "project-skill" && item.activated === false)) {
  throw new Error(`missing project skill activation metadata: ${JSON.stringify(handoff)}`);
}
console.log("[test] project .codex skills ok");
'

printf '%s\n' "$project_skill_direct_response" | node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(0, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const bundle = lines.find((line) => line.id === 9)?.result?.structuredContent;
if (!bundle?.skill || bundle.skill.id !== "project-skill") {
  throw new Error(`direct project .codex skill root failed: ${JSON.stringify(lines)}`);
}
if (bundle?.files?.some((file) => file.path.endsWith("references/project-note.md"))) {
  throw new Error(`project reference should be gated before skill.read: ${JSON.stringify(bundle)}`);
}
console.log("[test] project .codex direct skill root ok");
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
