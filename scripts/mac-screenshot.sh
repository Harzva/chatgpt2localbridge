#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DIR="$ROOT_DIR/docs/assets/app_screenshots"
MODE="selection"
OUT=""
RECT=""
APP_NAME=""
OPEN_AFTER=0
COPY_PATH=0
DELAY=0

usage() {
  cat <<'EOF'
mac-screenshot.sh - macOS screenshot helper for repo evidence and tutorials

Usage:
  scripts/mac-screenshot.sh [mode] [options]

Modes:
  --selection            Select any area interactively. Default.
  --window               Click any window interactively.
  --full                 Capture the full screen.
  --rect x,y,w,h         Capture a fixed rectangle in screen coordinates.
  --app "App Name"       Capture the front window bounds of an app.

Options:
  --out <file-or-dir>    Output PNG file or directory.
                         Default: docs/assets/app_screenshots
  --delay <seconds>      Wait before capture.
  --open                 Reveal the saved file in Finder.
  --copy-path            Copy the saved path to clipboard.
  --help                 Show this help.

Examples:
  scripts/mac-screenshot.sh --selection --open
  scripts/mac-screenshot.sh --window --out docs/assets/app_screenshots
  scripts/mac-screenshot.sh --rect 100,120,1280,760 --out docs/assets/app_screenshots/app-dashboard.png
  scripts/mac-screenshot.sh --app "ChatGPT2LocalBridge" --copy-path

Notes:
  macOS may require Screen Recording permission for Terminal, iTerm, or the
  agent process running this command. If capture fails, grant permission in:
  System Settings -> Privacy & Security -> Screen & System Audio Recording.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --selection|-s)
      MODE="selection"
      shift
      ;;
    --window|-w)
      MODE="window"
      shift
      ;;
    --full|-f)
      MODE="full"
      shift
      ;;
    --rect|-r)
      MODE="rect"
      RECT="${2:-}"
      shift 2
      ;;
    --app|-a)
      MODE="app"
      APP_NAME="${2:-}"
      shift 2
      ;;
    --out|-o)
      OUT="${2:-}"
      shift 2
      ;;
    --delay)
      DELAY="${2:-0}"
      shift 2
      ;;
    --open)
      OPEN_AFTER=1
      shift
      ;;
    --copy-path)
      COPY_PATH=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

timestamp="$(date +%Y%m%d-%H%M%S)"
if [[ -z "$OUT" ]]; then
  OUT="$DEFAULT_DIR"
fi

if [[ "$OUT" == *.png ]]; then
  output="$OUT"
else
  mkdir -p "$OUT"
  output="$OUT/screenshot-$MODE-$timestamp.png"
fi
mkdir -p "$(dirname "$output")"

if [[ "$DELAY" != "0" ]]; then
  sleep "$DELAY"
fi

capture_rect() {
  local rect="$1"
  if [[ ! "$rect" =~ ^-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$ ]]; then
    echo "--rect must look like x,y,width,height, got: $rect" >&2
    exit 2
  fi
  /usr/sbin/screencapture -x -R "$rect" "$output"
}

app_rect() {
  local name="$1"
  if [[ -z "$name" ]]; then
    echo "--app requires an app/process name." >&2
    exit 2
  fi
  /usr/bin/osascript <<OSA
tell application "System Events"
  set matches to every process whose name contains "$name"
  if (count of matches) is 0 then error "No running app matched: $name"
  set proc to item 1 of matches
  if (count of windows of proc) is 0 then error "Matched app has no windows: " & name of proc
  tell window 1 of proc
    set p to position
    set s to size
    return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
  end tell
end tell
OSA
}

case "$MODE" in
  selection)
    /usr/sbin/screencapture -x -i -s "$output"
    ;;
  window)
    /usr/sbin/screencapture -x -i -w "$output"
    ;;
  full)
    /usr/sbin/screencapture -x "$output"
    ;;
  rect)
    capture_rect "$RECT"
    ;;
  app)
    rect="$(app_rect "$APP_NAME")"
    capture_rect "$rect"
    ;;
esac

if [[ ! -s "$output" ]]; then
  echo "Screenshot was not created: $output" >&2
  exit 1
fi

if [[ "$COPY_PATH" == "1" ]]; then
  printf "%s" "$output" | /usr/bin/pbcopy
fi

if [[ "$OPEN_AFTER" == "1" ]]; then
  /usr/bin/open -R "$output"
fi

echo "$output"
