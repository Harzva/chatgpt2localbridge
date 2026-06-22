# macOS Screenshot CLI

`scripts/mac-screenshot.sh` is a Mac mini helper for capturing real screenshots
from any app, screen region, or fixed coordinate rectangle.

Default output directory:

```text
docs/assets/app_screenshots
```

## Quick Commands

```bash
npm run shot:selection
npm run shot:window
npm run shot:full
npm run shot:app
```

## Direct Commands

Select any area:

```bash
scripts/mac-screenshot.sh --selection --open --copy-path
```

Click any window:

```bash
scripts/mac-screenshot.sh --window --out docs/assets/app_screenshots
```

Capture a fixed rectangle:

```bash
scripts/mac-screenshot.sh --rect 100,120,1280,760 --out docs/assets/app_screenshots/dashboard.png
```

Capture the front window bounds of a running app:

```bash
scripts/mac-screenshot.sh --app "ChatGPT2LocalBridge" --open --copy-path
```

Wait before capture:

```bash
scripts/mac-screenshot.sh --selection --delay 3
```

## Permissions

macOS may require Screen Recording permission for whichever process runs the
command:

- Terminal
- iTerm
- VS Code
- Codex or another local agent host

Grant it in:

```text
System Settings -> Privacy & Security -> Screen & System Audio Recording
```

After changing the permission, quit and reopen the app that runs the command.

## Asset Guidance

Use clear filenames:

```text
app-dashboard.png
app-trace-analytics.png
chatgpt-tool-call-proof.png
connector-new-app-form.png
```

Before publishing, hide unlock codes, tokens, cookies, private paths that are
not meant to be public, and raw chat logs.
