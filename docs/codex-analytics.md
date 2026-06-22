# Codex Usage Analytics

ChatGPT2LocalBridge includes a native-app panel for Codex Enterprise usage
analytics configuration. This is an app-side operator feature, not an MCP tool.

## Auth Boundary

| Auth | What it unlocks | Reads official usage analytics? |
| --- | --- | --- |
| ChatGPT Connector OAuth for this bridge | Lets ChatGPT call `https://your-bridge/mcp` | No |
| Codex Enterprise Analytics API key | Lets an admin/reporting job call official Codex analytics endpoints | Yes, with `codex.enterprise.analytics.read` |
| Browser cookies from `chatgpt.com` | Lets a human view the web analytics page | Do not use as an integration boundary |

## Official Analytics API

Base URL:

```text
https://api.chatgpt.com/v1/analytics/codex
```

Endpoints shown in the native app:

```text
GET /workspaces/{workspace_id}/usage
GET /workspaces/{workspace_id}/code_reviews
GET /workspaces/{workspace_id}/code_review_responses
```

The API supports day or week buckets, paginated results, and reporting windows
up to 90 days. The usage endpoint can return workspace-wide rows with
`group=workspace` or per-user rows when `group` is omitted.

## Native App Panel

Open:

```text
Usage 分析 -> Codex Analytics API
```

The panel shows:

- official base URL
- required scope
- workspace ID
- API key environment variable name
- `group_by`
- usage `group`
- copyable endpoint list
- copyable sync command
- `Fetch Usage` button for the official `/usage` endpoint

Secrets are not stored in the app. Put the real API key in your shell, launchd
environment, or secrets manager under the env name configured in the panel.

`Fetch Usage` reads the API key from the configured environment variable in the
native app process, follows official pagination, and draws the returned usage
rows as an in-app summary chart. If the app was opened from Finder and cannot
see that env var, use **Copy sync command** and run the helper from a terminal
where the key is available.

## Optional Snapshot Sync

The helper fetches official analytics data and writes a local JSON snapshot:

```bash
CODEX_ANALYTICS_API_KEY=... \
CODEX_WORKSPACE_ID=... \
node scripts/sync-codex-analytics.mjs
```

Useful options:

```bash
CODEX_ANALYTICS_API_KEY_ENV=CODEX_ANALYTICS_API_KEY
START_TIME=1765152000
END_TIME=1765756800
GROUP_BY=day
GROUP=workspace
ENDPOINTS=usage,code_reviews,code_review_responses
OUT=codex-analytics-snapshot.json
```

The snapshot file is local-only by default. Do not commit API outputs that may
contain user, workspace, or usage details.
