# File Sync Flows

ChatGPT2LocalBridge supports two practical file directions, with different trust boundaries.
The product goal is not to clone the whole disk into ChatGPT; it is to make
approved local roots feel mounted by combining MCP reads, MCP writes, cloud-side
download artifacts, and audited local downloads.

## Local to ChatGPT

There are three related patterns:

1. MCP read tools expose approved local file content to ChatGPT during a conversation.
2. `project.bundle` can read a directory summary, selected files, and optional
   git diff in one bounded call when the user wants several local files moved
   into the conversation context.
3. ChatGPT can use that MCP-read content to create a cloud-side downloadable
   artifact, such as a copied JSON file, report, patch, or bundle manifest.
4. A ChatGPT App widget or another explicit UI can still be useful if the user
   specifically wants to attach a file to a ChatGPT file library flow.

For the common "send this local file to the conversation" case, a separate
upload primitive is not required: ChatGPT reads the local file through the MCP
tool, inspects it, and can re-emit a downloadable copy in the chat. The MCP
server still cannot silently bulk-upload arbitrary local files to permanent
ChatGPT storage; keep broad exports and file-library uploads user-approved.

Recommended ChatGPT-side instruction:

```text
When the user asks for a local file copy or bundle, first call project.bundle or
code.read against the approved local workspace. Then generate the requested
cloud-side downloadable artifact from that returned content. If the user asks to
sync a cloud artifact back to local disk, use cloud.download.
```

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
- the generated MCP tool catalog in the native app
- bundle prompt helpers in the native app
- recent MCP tool calls
- audit events for file writes, downloads, tasks, processes, and service restarts

Set `LOCALBRIDGE_DASHBOARD_TOKEN` before using the console APIs.
