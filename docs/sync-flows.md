# File Sync Flows

ChatGPT2LocalBridge supports two practical file directions, with different trust boundaries.

## Local to ChatGPT

There are two patterns:

1. MCP read tools expose approved local file content to ChatGPT during a conversation.
2. A future ChatGPT App widget can use the Apps SDK file helpers, such as `uploadFile`, when the user explicitly chooses a local file in the app UI.

The MCP server cannot silently upload arbitrary local files to ChatGPT storage. Keep uploads user-approved.

## ChatGPT Cloud to Local

If ChatGPT or an App UI provides a temporary HTTPS download URL for a cloud-side file, use:

```text
cloud.download
```

The tool downloads that URL into an approved local workspace, records the write in `audit.jsonl`, and stores a tool-call record in `tool-calls.jsonl`.

Inputs:

- `projectPath`: approved local workspace root
- `url`: HTTPS download URL
- `file`: relative local destination
- `overwrite`: whether an existing local file can be replaced
- `maxBytes`: safety limit
- `expectedSha256`: optional integrity check

Safety behavior:

- Only HTTPS URLs are accepted, except localhost for tests.
- Files are downloaded to a temporary file first.
- Hash verification happens before replacing the destination.
- Destination paths still obey `allowedProjectRoots` and deny globs.

## Local Console

Run the bridge in HTTP mode and open:

```text
http://127.0.0.1:3838/app
```

The console shows:

- bridge status
- approved roots
- OAuth/public URL settings
- recent MCP tool calls
- audit events for file writes, downloads, tasks, processes, and service restarts

Set `LOCALBRIDGE_DASHBOARD_TOKEN` before using the console APIs.
