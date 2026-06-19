#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LABEL="com.chatgpt2localbridge.bridge"
PLIST="$LAUNCH_AGENTS/$LABEL.plist"
ENV_FILE="$ROOT/.env.local"
POLICY_FILE="$ROOT/bridge.policy.json"
NODE_BIN="$(command -v node)"

escape_xml() {
  printf '%s' "$1" \
    | sed \
      -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&apos;/g"
}

if [[ ! -f "$ENV_FILE" || ! -f "$POLICY_FILE" ]]; then
  echo "Missing .env.local or bridge.policy.json."
  echo "Run first:"
  echo "  node dist/index.js init --root <approved-workspace-root>"
  exit 1
fi

if [[ ! -f "$ROOT/dist/index.js" ]]; then
  echo "Missing dist/index.js; building first..."
  npm --prefix "$ROOT" run build
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

PORT="${LOCALBRIDGE_PORT:-3838}"
DATA_DIR="${LOCALBRIDGE_DATA_DIR:-$HOME/.chatgpt2localbridge}"
LOG_DIR="${LOCALBRIDGE_LOG_DIR:-$HOME/.chatgpt2localbridge/logs}"
POLICY_PATH="${LOCALBRIDGE_POLICY_PATH:-$POLICY_FILE}"
OAUTH_ENABLED="${LOCALBRIDGE_OAUTH_ENABLED:-1}"
PUBLIC_BASE_URL="${LOCALBRIDGE_PUBLIC_BASE_URL:-http://127.0.0.1:$PORT}"
OAUTH_UNLOCK_CODE="${LOCALBRIDGE_OAUTH_UNLOCK_CODE:-}"
DASHBOARD_TOKEN="${LOCALBRIDGE_DASHBOARD_TOKEN:-}"
ALLOW_URL_TOKEN="${LOCALBRIDGE_ALLOW_URL_TOKEN:-0}"
OAUTH_SCOPES="${LOCALBRIDGE_OAUTH_SCOPES:-workspace:read workspace:write shell:exec}"

mkdir -p "$DATA_DIR" "$LOG_DIR" "$LAUNCH_AGENTS"

NODE_BIN_XML="$(escape_xml "$NODE_BIN")"
ROOT_XML="$(escape_xml "$ROOT")"
PORT_XML="$(escape_xml "$PORT")"
DATA_DIR_XML="$(escape_xml "$DATA_DIR")"
LOG_DIR_XML="$(escape_xml "$LOG_DIR")"
POLICY_PATH_XML="$(escape_xml "$POLICY_PATH")"
OAUTH_ENABLED_XML="$(escape_xml "$OAUTH_ENABLED")"
PUBLIC_BASE_URL_XML="$(escape_xml "$PUBLIC_BASE_URL")"
OAUTH_UNLOCK_CODE_XML="$(escape_xml "$OAUTH_UNLOCK_CODE")"
DASHBOARD_TOKEN_XML="$(escape_xml "$DASHBOARD_TOKEN")"
ALLOW_URL_TOKEN_XML="$(escape_xml "$ALLOW_URL_TOKEN")"
OAUTH_SCOPES_XML="$(escape_xml "$OAUTH_SCOPES")"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN_XML</string>
    <string>$ROOT_XML/dist/index.js</string>
    <string>--http</string>
    <string>$PORT_XML</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$ROOT_XML</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>LOCALBRIDGE_PORT</key>
    <string>$PORT_XML</string>
    <key>LOCALBRIDGE_DATA_DIR</key>
    <string>$DATA_DIR_XML</string>
    <key>LOCALBRIDGE_LOG_DIR</key>
    <string>$LOG_DIR_XML</string>
    <key>LOCALBRIDGE_POLICY_PATH</key>
    <string>$POLICY_PATH_XML</string>
    <key>LOCALBRIDGE_OAUTH_ENABLED</key>
    <string>$OAUTH_ENABLED_XML</string>
    <key>LOCALBRIDGE_PUBLIC_BASE_URL</key>
    <string>$PUBLIC_BASE_URL_XML</string>
    <key>LOCALBRIDGE_OAUTH_UNLOCK_CODE</key>
    <string>$OAUTH_UNLOCK_CODE_XML</string>
    <key>LOCALBRIDGE_DASHBOARD_TOKEN</key>
    <string>$DASHBOARD_TOKEN_XML</string>
    <key>LOCALBRIDGE_ALLOW_URL_TOKEN</key>
    <string>$ALLOW_URL_TOKEN_XML</string>
    <key>LOCALBRIDGE_OAUTH_SCOPES</key>
    <string>$OAUTH_SCOPES_XML</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_DIR_XML/bridge.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR_XML/bridge.err.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed $LABEL"
echo "Plist: $PLIST"
echo "Health: http://127.0.0.1:$PORT/health"
echo "Console: http://127.0.0.1:$PORT/app"
