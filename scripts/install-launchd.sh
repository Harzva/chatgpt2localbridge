#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

mkdir -p "$HOME/.chatgpt2localbridge/logs" "$LAUNCH_AGENTS"

echo "Copy the example plists from launchd/ to $LAUNCH_AGENTS after replacing placeholders:"
echo "  launchd/com.chatgpt2localbridge.bridge.plist.example"
echo "  launchd/com.chatgpt2localbridge.ngrok.plist.example"
echo
echo "Then load them with:"
echo "  launchctl bootstrap gui/$(id -u) $LAUNCH_AGENTS/com.chatgpt2localbridge.bridge.plist"
echo "  launchctl bootstrap gui/$(id -u) $LAUNCH_AGENTS/com.chatgpt2localbridge.ngrok.plist"
echo
echo "Project root: $ROOT"
