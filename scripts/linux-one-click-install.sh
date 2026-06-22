#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Harzva/chatgpt2localbridge.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/chatgpt2localbridge}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/workspace}"
BRIDGE_PORT="${BRIDGE_PORT:-3838}"
TUNNEL="${TUNNEL:-none}"
NGROK_DOMAIN="${NGROK_DOMAIN:-}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
FORCE_INIT="${FORCE_INIT:-0}"

usage() {
  cat <<'USAGE'
ChatGPT2LocalBridge Linux one-click installer

Environment:
  INSTALL_DIR=/opt/chatgpt2localbridge       Install/clone directory.
  WORKSPACE_ROOT=/srv/workspace             Root ChatGPT is allowed to read/write.
  BRIDGE_PORT=3838                          First local port to try.
  TUNNEL=none|cloudflare|ngrok              Optional HTTPS tunnel helper.
  PUBLIC_BASE_URL=https://example.com       Known public URL, if you already have one.
  NGROK_AUTHTOKEN=...                       Required when TUNNEL=ngrok.
  NGROK_DOMAIN=my-name.ngrok-free.app       Optional fixed ngrok domain.
  FORCE_INIT=1                              Overwrite bridge.policy.json and .env.local.

Examples:
  WORKSPACE_ROOT=$HOME/workspace bash scripts/linux-one-click-install.sh
  TUNNEL=cloudflare bash scripts/linux-one-click-install.sh
  TUNNEL=ngrok NGROK_AUTHTOKEN=... NGROK_DOMAIN=my-name.ngrok-free.app bash scripts/linux-one-click-install.sh
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[missing] $1"
    return 1
  fi
}

require_base_tools() {
  local missing=0
  need git || missing=1
  need npm || missing=1
  need node || missing=1
  need curl || missing=1
  if [[ "$missing" -ne 0 ]]; then
    cat <<'EOF'

Install the missing tools, then rerun this script.

Ubuntu/Debian hint:
  sudo apt-get update
  sudo apt-get install -y git curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
EOF
    exit 1
  fi

  local node_major
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$node_major" -lt 20 ]]; then
    echo "[error] Node.js >= 20 is required. Current: $(node -v)"
    exit 1
  fi
}

port_is_free() {
  local port="$1"
  node -e '
const net = require("net");
const port = Number(process.argv[1]);
const server = net.createServer();
server.once("error", () => process.exit(1));
server.once("listening", () => server.close(() => process.exit(0)));
server.listen(port, "127.0.0.1");
' "$port" >/dev/null 2>&1
}

choose_port() {
  local port="$1"
  for _ in $(seq 1 50); do
    if port_is_free "$port"; then
      echo "$port"
      return 0
    fi
    port="$((port + 1))"
  done
  echo "[error] No free port found from $BRIDGE_PORT to $((BRIDGE_PORT + 49))." >&2
  exit 1
}

set_public_base_url() {
  local url="$1"
  url="${url%/}"
  PUBLIC_BASE_URL="$url"
  if [[ -f "$INSTALL_DIR/.env.local" ]]; then
    if grep -q '^export LOCALBRIDGE_PUBLIC_BASE_URL=' "$INSTALL_DIR/.env.local"; then
      sed -i.bak "s#^export LOCALBRIDGE_PUBLIC_BASE_URL=.*#export LOCALBRIDGE_PUBLIC_BASE_URL=\"$url\"#" "$INSTALL_DIR/.env.local"
      rm -f "$INSTALL_DIR/.env.local.bak"
    else
      printf 'export LOCALBRIDGE_PUBLIC_BASE_URL="%s"\n' "$url" >>"$INSTALL_DIR/.env.local"
    fi
  fi
}

print_registration_help() {
  cat <<'EOF'

Tunnel account choices:
  ngrok:
    - Register: https://dashboard.ngrok.com/signup
    - Best when you want the fastest fixed development domain.
    - Needs NGROK_AUTHTOKEN. Optional NGROK_DOMAIN gives a stable Connector URL.

  Cloudflare Tunnel:
    - Register: https://dash.cloudflare.com/sign-up
    - Quick Tunnel can run without owning a domain, but the trycloudflare URL changes.
    - Named Tunnel is better for production when you control a Cloudflare domain.

Recommendation:
  - First smoke test: TUNNEL=cloudflare if cloudflared is installed.
  - Stable ChatGPT Connector: fixed ngrok domain or Cloudflare named tunnel.
EOF
}

print_connector_fields() {
  local base="${PUBLIC_BASE_URL:-https://YOUR-PUBLIC-TUNNEL.example.com}"
  cat <<EOF

ChatGPT Connector fields:
  Name: ChatGPT2LocalBridge Linux
  Server URL: $base/mcp
  Authentication: OAuth

Advanced OAuth fields:
  Auth URL: $base/oauth/authorize
  Token URL: $base/oauth/token
  Registration URL: $base/oauth/register
  Authorization server base: $base
  Resource: $base/mcp
  Scopes: workspace:read workspace:write shell:exec
  OIDC: off

Authorization page:
  Bridge unlock code: read LOCALBRIDGE_OAUTH_UNLOCK_CODE from $INSTALL_DIR/.env.local on this Linux host.
  Do not paste unlock codes, tokens, cookies, or .env contents into public chats, issues, screenshots, or commits.

Local checks:
  curl -sS http://127.0.0.1:$CHOSEN_PORT/health
  http://127.0.0.1:$CHOSEN_PORT/app
  http://127.0.0.1:$CHOSEN_PORT/mcp
EOF
}

print_agent_prompt() {
  cat <<EOF

Agent setup prompt:
  You are configuring ChatGPT2LocalBridge on Linux from $REPO_URL.
  Keep secrets local. Do not print .env.local, OAuth tokens, ngrok authtokens, cookies, or unlock codes.
  Use WORKSPACE_ROOT=$WORKSPACE_ROOT and keep allowed roots narrow.
  Run the one-click installer, verify /health, then configure one HTTPS tunnel.
  If ngrok is selected, ask the human for NGROK_AUTHTOKEN and optional NGROK_DOMAIN, then run ngrok and set LOCALBRIDGE_PUBLIC_BASE_URL to the public https origin.
  If Cloudflare is selected, use quick tunnel only for a smoke test; for stable use, guide the human to create a named tunnel in Cloudflare Zero Trust and set LOCALBRIDGE_PUBLIC_BASE_URL to the stable hostname.
  Report only the Connector fields and verification status. Never reveal secrets.
EOF
}

start_cloudflare_tunnel() {
  if ! command -v cloudflared >/dev/null 2>&1; then
    cat <<'EOF'

[tunnel] cloudflared is not installed.
Install docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
Then rerun:
  TUNNEL=cloudflare bash scripts/linux-one-click-install.sh
EOF
    return 0
  fi

  echo "[tunnel] starting Cloudflare quick tunnel"
  nohup cloudflared tunnel --url "http://127.0.0.1:$CHOSEN_PORT" --no-autoupdate \
    >"$INSTALL_DIR/cloudflared.log" 2>&1 &
  echo $! >"$INSTALL_DIR/cloudflared.pid"
  sleep 5

  local url
  url="$(grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' "$INSTALL_DIR/cloudflared.log" | tail -n 1 || true)"
  if [[ -n "$url" ]]; then
    set_public_base_url "$url"
    echo "[tunnel] Cloudflare quick tunnel: $url"
  else
    echo "[tunnel] Could not parse Cloudflare URL yet. Check: $INSTALL_DIR/cloudflared.log"
  fi
}

start_ngrok_tunnel() {
  if ! command -v ngrok >/dev/null 2>&1; then
    cat <<'EOF'

[tunnel] ngrok is not installed.
Install docs: https://ngrok.com/download
Then rerun with:
  TUNNEL=ngrok NGROK_AUTHTOKEN=... NGROK_DOMAIN=your-domain.ngrok-free.app bash scripts/linux-one-click-install.sh
EOF
    return 0
  fi

  if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
    cat <<'EOF'

[tunnel] NGROK_AUTHTOKEN is required for ngrok.
Register: https://dashboard.ngrok.com/signup
After login, copy the authtoken and rerun:
  TUNNEL=ngrok NGROK_AUTHTOKEN=... bash scripts/linux-one-click-install.sh
EOF
    return 0
  fi

  echo "[tunnel] configuring ngrok authtoken"
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null

  if [[ -n "$NGROK_DOMAIN" ]]; then
    echo "[tunnel] starting ngrok fixed domain: $NGROK_DOMAIN"
    nohup ngrok http "$CHOSEN_PORT" --url="https://$NGROK_DOMAIN" \
      >"$INSTALL_DIR/ngrok.log" 2>&1 &
    set_public_base_url "https://$NGROK_DOMAIN"
  else
    echo "[tunnel] starting ngrok random domain"
    nohup ngrok http "$CHOSEN_PORT" >"$INSTALL_DIR/ngrok.log" 2>&1 &
    sleep 3
    local url
    url="$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);console.log(j.tunnels?.[0]?.public_url||"")}catch{}})' || true)"
    if [[ -n "$url" ]]; then
      set_public_base_url "$url"
    else
      echo "[tunnel] Could not read ngrok URL yet. Check: $INSTALL_DIR/ngrok.log"
    fi
  fi
}

main() {
  require_base_tools

  mkdir -p "$WORKSPACE_ROOT"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "[install] updating existing checkout: $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull --ff-only
  elif [[ -e "$INSTALL_DIR" ]]; then
    echo "[error] INSTALL_DIR exists but is not a git checkout: $INSTALL_DIR"
    exit 1
  else
    echo "[install] cloning $REPO_URL -> $INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi

  cd "$INSTALL_DIR"
  echo "[install] npm install"
  npm install
  echo "[install] npm run build"
  npm run build

  CHOSEN_PORT="$(choose_port "$BRIDGE_PORT")"
  if [[ "$CHOSEN_PORT" != "$BRIDGE_PORT" ]]; then
    echo "[install] port $BRIDGE_PORT is busy; using $CHOSEN_PORT"
  fi

  local public_url="${PUBLIC_BASE_URL:-https://YOUR-PUBLIC-TUNNEL.example.com}"
  public_url="${public_url%/}"
  local init_args=(init --root "$WORKSPACE_ROOT" --public-url "$public_url" --port "$CHOSEN_PORT")
  if [[ "$FORCE_INIT" == "1" ]]; then
    init_args+=(--force)
  fi
  node dist/index.js "${init_args[@]}"
  sed -i.bak "s#^export LOCALBRIDGE_PORT=.*#export LOCALBRIDGE_PORT=$CHOSEN_PORT#" .env.local
  sed -i.bak "s#^export LOCALBRIDGE_PUBLIC_BASE_URL=.*#export LOCALBRIDGE_PUBLIC_BASE_URL=\"$public_url\"#" .env.local
  rm -f .env.local.bak

  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a

  if [[ -f "$INSTALL_DIR/bridge.pid" ]]; then
    old_pid="$(cat "$INSTALL_DIR/bridge.pid" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
  fi

  echo "[install] starting bridge on 127.0.0.1:$CHOSEN_PORT"
  nohup node dist/index.js --http "$CHOSEN_PORT" >"$INSTALL_DIR/bridge.out.log" 2>"$INSTALL_DIR/bridge.err.log" &
  echo $! >"$INSTALL_DIR/bridge.pid"

  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$CHOSEN_PORT/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  curl -fsS "http://127.0.0.1:$CHOSEN_PORT/health" >/dev/null
  echo "[install] health ok"

  case "$TUNNEL" in
    none) ;;
    cloudflare) start_cloudflare_tunnel ;;
    ngrok) start_ngrok_tunnel ;;
    *) echo "[tunnel] unknown TUNNEL=$TUNNEL; expected none, cloudflare, or ngrok" ;;
  esac

  print_registration_help
  print_connector_fields
  print_agent_prompt

  echo
  echo "[done] ChatGPT2LocalBridge Linux install complete."
}

main "$@"
