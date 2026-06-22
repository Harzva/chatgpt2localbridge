# Codex Analytics Integration

ChatGPT2LocalBridge can keep a local, operator-controlled copy of Codex usage
analytics for deeper analysis in the local dashboard.

## Why Local Import First

Codex Enterprise exposes analytics for administrator and governance workflows,
but the browser analytics page is not a stable integration boundary. The bridge
therefore uses a local snapshot format first:

- paste or post sanitized JSON snapshots into the dashboard
- store snapshots in the local data directory
- redact sensitive raw fields before persistence
- normalize values into `date + metric + category + value`
- show totals, top segments, daily peaks, and short insights in `/app`

When a workspace has enterprise API access, an automatic sync job can later write
the same local snapshot format without changing the dashboard.

## Dashboard Import

Open the local console:

```text
http://127.0.0.1:3838/app
```

Enter `LOCALBRIDGE_DASHBOARD_TOKEN`, then use **Codex Analytics Import**.

Minimal `Skills used` snapshot:

```json
{
  "source": "chatgpt-codex-analytics",
  "metric": "skills_used",
  "series": [
    {
      "name": "Roadmp Writer",
      "data": [
        { "date": "2026-06-18", "value": 65 }
      ]
    },
    {
      "name": "Verification Before Completion",
      "data": [
        { "date": "2026-06-18", "value": 7 }
      ]
    },
    {
      "name": "Other",
      "data": [
        { "date": "2026-06-18", "value": 107 }
      ]
    }
  ]
}
```

API-style rows are also accepted:

```json
{
  "source": "codex-enterprise-analytics-api",
  "workspace_id": "workspace-redacted",
  "data": [
    {
      "start_time": "2026-06-18T00:00:00Z",
      "client": "codex_cloud",
      "threads": 12,
      "turns": 74,
      "text_input_tokens": 120000,
      "text_output_tokens": 18000
    }
  ]
}
```

## Local API

All endpoints require the dashboard token.

```bash
curl -sS \
  -H "x-localbridge-dashboard-token: $LOCALBRIDGE_DASHBOARD_TOKEN" \
  http://127.0.0.1:3838/app/api/codex-analytics
```

```bash
curl -sS \
  -H "content-type: application/json" \
  -H "x-localbridge-dashboard-token: $LOCALBRIDGE_DASHBOARD_TOKEN" \
  --data @codex-analytics-snapshot.json \
  http://127.0.0.1:3838/app/api/codex-analytics/import
```

Snapshots are stored at:

```text
$LOCALBRIDGE_DATA_DIR/codex-analytics-snapshots.jsonl
```

The stored raw snapshot is bounded and redacted for keys such as tokens, cookies,
authorization headers, email, prompt, response, and content.

## Enterprise API Sync

If your workspace has Codex Enterprise analytics access, use the sync helper.
Keep the API key in the shell environment, not in the repository.

```bash
CODEX_ANALYTICS_API_KEY=... \
CODEX_WORKSPACE_ID=... \
LOCALBRIDGE_URL=http://127.0.0.1:3838 \
LOCALBRIDGE_DASHBOARD_TOKEN=... \
node scripts/sync-codex-analytics.mjs
```

Useful options:

```bash
START_TIME=1765152000
END_TIME=1765756800
GROUP_BY=day
GROUP=workspace
ENDPOINTS=usage,code_reviews,code_review_responses
OUT=codex-analytics-snapshot.json
```

The helper currently calls:

- `/v1/analytics/codex/workspaces/{workspace_id}/usage`
- `/v1/analytics/codex/workspaces/{workspace_id}/code_reviews`
- `/v1/analytics/codex/workspaces/{workspace_id}/code_review_responses`

The API key needs the `codex.enterprise.analytics.read` scope.

## Deep-Mining Ideas

Useful questions once daily snapshots accumulate:

- Which skills are growing fastest week over week?
- Which categories peak on release days or doc-writing days?
- How much usage is hidden under `Other`, and which skill labels should be
  promoted into first-class categories?
- Which clients or users drive the most turns, threads, or review comments?
- Do code review reactions correlate with P0/P1/P2 comment volume?
- Which days have high skill usage but low successful task completion in local
  bridge traces?

The next useful join is between Codex Analytics and local bridge traces:

```text
Codex cloud usage by day
  + local MCP tool calls
  + audit events
  + Git/test outcomes
  -> skill ROI, blocked workflows, and automation candidates
```
