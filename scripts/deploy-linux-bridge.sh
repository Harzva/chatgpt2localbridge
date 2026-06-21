#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

REMOTE="${REMOTE:-linux-box}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/chatgpt2localbridge}"
REMOTE_WORKSPACE="${REMOTE_WORKSPACE:-/data/workspace}"
REMOTE_RUNTIME="${REMOTE_RUNTIME:-/data/chatgpt2localbridge-runtime}"
REMOTE_PORT="${REMOTE_PORT:-3838}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://linux-bridge.example.com}"
REMOTE_ALLOWED_ROOTS="${REMOTE_ALLOWED_ROOTS:-$REMOTE_WORKSPACE}"
TARBALL="${TMPDIR:-/tmp}/chatgpt2localbridge-linux-runtime.tgz"

echo "[deploy] build local dist"
(cd "$ROOT" && npm run build >/dev/null)

echo "[deploy] package minimal Linux runtime"
rm -f "$TARBALL"
(
  cd "$ROOT"
  tar -czf "$TARBALL" \
    package.json \
    package-lock.json \
    tsconfig.json \
    README.md \
    .env.example \
    bridge.policy.example.json \
    src \
    dist \
    scripts/test-mcp.sh \
    scripts/export-mcp-tools.mjs \
    assets/mcp-tools.json
)
ls -lh "$TARBALL"

echo "[deploy] upload to $REMOTE"
scp "$TARBALL" "$REMOTE:/tmp/chatgpt2localbridge-linux-runtime.tgz"

echo "[deploy] install and start remote bridge"
ssh "$REMOTE" \
  "REMOTE_APP_DIR='$REMOTE_APP_DIR' REMOTE_WORKSPACE='$REMOTE_WORKSPACE' REMOTE_RUNTIME='$REMOTE_RUNTIME' REMOTE_PORT='$REMOTE_PORT' PUBLIC_BASE_URL='$PUBLIC_BASE_URL' REMOTE_ALLOWED_ROOTS='$REMOTE_ALLOWED_ROOTS' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

mkdir -p "$REMOTE_APP_DIR" "$REMOTE_WORKSPACE" "$REMOTE_RUNTIME/logs"
chmod 700 "$REMOTE_RUNTIME"
tar -xzf /tmp/chatgpt2localbridge-linux-runtime.tgz -C "$REMOTE_APP_DIR"

cd "$REMOTE_APP_DIR"
npm install --omit=dev --ignore-scripts >/tmp/chatgpt2localbridge-npm-install.log 2>&1

TOKEN_FILE="$REMOTE_RUNTIME/.env"
if [ ! -f "$TOKEN_FILE" ]; then
  AUTH_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  UNLOCK_CODE="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  DASHBOARD_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  cat >"$TOKEN_FILE" <<ENV
export LOCALBRIDGE_PORT=$REMOTE_PORT
export LOCALBRIDGE_DATA_DIR="$REMOTE_RUNTIME"
export LOCALBRIDGE_LOG_DIR="$REMOTE_RUNTIME/logs"
export LOCALBRIDGE_POLICY_PATH="$REMOTE_APP_DIR/bridge.policy.json"
export LOCALBRIDGE_AUTH_TOKEN="$AUTH_TOKEN"
export LOCALBRIDGE_OAUTH_ENABLED=1
export LOCALBRIDGE_PUBLIC_BASE_URL="$PUBLIC_BASE_URL"
export LOCALBRIDGE_OAUTH_UNLOCK_CODE="$UNLOCK_CODE"
export LOCALBRIDGE_DASHBOARD_TOKEN="$DASHBOARD_TOKEN"
export LOCALBRIDGE_ALLOW_URL_TOKEN=0
ENV
  chmod 600 "$TOKEN_FILE"
fi

node - <<'NODE' >"$REMOTE_APP_DIR/bridge.policy.json"
const fs = require('fs');
const os = require('os');

const roots = (process.env.REMOTE_ALLOWED_ROOTS || process.env.REMOTE_WORKSPACE || '/data/workspace')
  .split(/[\n,]/)
  .map((entry) => entry.trim())
  .filter(Boolean)
  .filter((entry, index, list) => list.indexOf(entry) === index);

const policy = {
  allowedProjectRoots: roots,
  skillRoots: [
    `${os.homedir()}/.codex/skills`,
    `${os.homedir()}/.agents/skills`,
  ],
  denyGlobs: [
    '**/.env',
    '**/.env.*',
    '**/*.pem',
    '**/*.key',
    '**/*.p12',
    '**/*.pfx',
    '**/.npmrc',
    '**/.netrc',
    '**/.ssh/**',
    '**/id_rsa',
    '**/id_ed25519',
  ],
  shell: {
    enabled: true,
    denyPatterns: [
      'sudo',
      'rm\\s+-rf\\s+/',
      'chmod\\s+-R',
      'chown\\s+-R',
      'mkfs',
      'dd\\s+.*of=/dev/',
      'shutdown',
      'reboot',
      ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:',
    ],
  },
};

fs.writeFileSync(process.env.REMOTE_APP_DIR + '/bridge.policy.json', JSON.stringify(policy, null, 2) + '\n');
NODE
chmod 600 "$REMOTE_APP_DIR/bridge.policy.json"

if [ ! -f "$REMOTE_WORKSPACE/README.chatgpt2localbridge-smoke.md" ]; then
  cat >"$REMOTE_WORKSPACE/README.chatgpt2localbridge-smoke.md" <<EOF
# ChatGPT2LocalBridge Linux smoke file

If ChatGPT can read this through the Linux connector, the bridge can see $REMOTE_WORKSPACE.
EOF
fi

if [ -f "$REMOTE_RUNTIME/bridge.pid" ]; then
  old_pid="$(cat "$REMOTE_RUNTIME/bridge.pid" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
fi

set -a
. "$TOKEN_FILE"
set +a
nohup node "$REMOTE_APP_DIR/dist/index.js" --http "$REMOTE_PORT" >"$REMOTE_RUNTIME/logs/bridge.out.log" 2>"$REMOTE_RUNTIME/logs/bridge.err.log" &
echo $! >"$REMOTE_RUNTIME/bridge.pid"

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$REMOTE_PORT/health" >/tmp/chatgpt2localbridge-health.json 2>/dev/null; then
    break
  fi
  sleep 0.25
done

node - <<'NODE'
const fs = require("fs");
const health = JSON.parse(fs.readFileSync("/tmp/chatgpt2localbridge-health.json", "utf8"));
if (health.status !== "ok" || health.service !== "chatgpt2localbridge") {
  throw new Error(`unexpected health: ${JSON.stringify(health)}`);
}
console.log(`[remote] health ok: ${health.service} ${health.version}`);
NODE

node - <<'NODE'
const fs = require("fs");
const tools = JSON.parse(fs.readFileSync("assets/mcp-tools.json", "utf8"));
if (tools.count < 46) throw new Error(`unexpected tool count: ${tools.count}`);
console.log(`[remote] tool catalog ok: ${tools.count}`);
NODE

echo "[remote] app dir: $REMOTE_APP_DIR"
echo "[remote] workspace: $REMOTE_WORKSPACE"
echo "[remote] runtime env: $TOKEN_FILE"
echo "[remote] local mcp: http://127.0.0.1:$REMOTE_PORT/mcp"
echo "[remote] public mcp target: $PUBLIC_BASE_URL/mcp"
REMOTE_SCRIPT

echo "[deploy] complete"
