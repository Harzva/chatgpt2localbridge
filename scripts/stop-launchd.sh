#!/usr/bin/env bash
set -euo pipefail

for label in com.chatgpt2localbridge.bridge com.chatgpt2localbridge.ngrok; do
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/$label.plist" >/dev/null 2>&1 || true
done

echo "Stopped ChatGPT2LocalBridge launchd services."
