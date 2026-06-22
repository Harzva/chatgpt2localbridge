# Handoff Spec

目标：让 ChatGPT Web / Mobile 不再直接拼接低层文件和 shell 调用，而是先生成
一个结构化 handoff，再交给本地 Codex Runner 在批准的项目根目录内执行。

## Route

```text
ChatGPT
  -> handoff.create
  -> codex.task_start
  -> local codex-cli
  -> logs / diff / result files
  -> codex.status / codex.result
  -> ChatGPT summary
```

## Principles

- ChatGPT 负责描述目标和约束。
- Bridge 负责校验路径、保存 handoff、记录 trace 和 audit。
- Codex Runner 负责读取项目、修改文件、运行测试和生成结果。
- Codex Runner 使用 Codex CLI `danger-full-access` 执行模式，避免本地
  CLI sandbox/approval 兼容性问题；实际边界由 `bridge.policy.json`、
  handoff 约束、任务超时、日志和 App 可见 trace 共同承担。
- App 负责显示任务、日志、diff、测试结果和取消按钮。
- 低层工具仍保留给高级调试，但默认工作流应使用 handoff 和 Codex Runner。

## Handoff Object

```json
{
  "version": "1",
  "title": "Add handoff demo document",
  "objective": "Create docs/HANDOFF_DEMO.md with the current execution plan.",
  "projectPath": "/absolute/approved/project",
  "workspace": "optional-workspace-name",
  "constraints": [
    "Operate only inside the approved project root.",
    "Do not commit changes.",
    "Keep edits scoped to documentation."
  ],
  "allowedOperations": [
    "read",
    "write",
    "run_tests"
  ],
  "testCommands": [
    "npm run typecheck"
  ],
  "expectedArtifacts": [
    "docs/HANDOFF_DEMO.md"
  ],
  "riskLevel": "low",
  "acceptanceCriteria": [
    "The file exists.",
    "The file describes the Handoff -> Codex Runner loop."
  ],
  "skillContext": [
    "optional skill id or summary"
  ],
  "skillTask": "optional task text used to route approved local skills into this handoff",
  "skillRoot": "optional approved skill root",
  "maxSkillContext": 3,
  "notes": "Optional operator-visible notes."
}
```

## Required Fields

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Short task label for App and trace views. |
| `objective` | yes | Natural-language goal for local Codex. |
| `projectPath` or `workspace` | yes | Must resolve inside `allowedProjectRoots`. |
| `constraints` | yes | At least one constraint. |
| `allowedOperations` | yes | Explicit capability list. |
| `riskLevel` | yes | `low`, `medium`, or `high`. |
| `skillTask` | no | If present, Bridge uses existing local `skill.route` logic and injects recommended skills into `skillContext`. |
| `skillRoot` | no | Must be inside approved `policy.skillRoots`; defaults to the first configured skill root. |

## Allowed Operations

Initial vocabulary:

```text
read
write
run_tests
inspect_git
create_artifact
use_skill_context
```

`shell.exec` is intentionally not an operation name. If a task needs commands,
the handoff should express them as `testCommands` or as Codex Runner instructions.

## Risk Levels

| Risk | Meaning |
| --- | --- |
| `low` | Documentation, analysis, read-only, or narrow file creation. |
| `medium` | Code edits, test runs, generated files, or multi-file changes. |
| `high` | Broad refactors, dependency installs, network calls, release actions, or destructive operations. |

High-risk handoffs should still be saved, but the App should make the risk
visible before the operator trusts the run.

## MCP Tools

### `handoff.create`

Validates and persists a handoff package. It does not run Codex.

If `skillTask` is provided, `handoff.create` routes the task through approved
local skills and stores compact skill recommendations in `skillContext`. This is
the current bridge between Skill Runtime and Codex Runner: skills guide the
handoff, while local Codex CLI performs the actual work.

Skill references are activation-gated. `skill.read` activates a skill's
`SKILL.md` and returns an `activationId`; `skill.bundle` only includes
referenced local files when that `activationId` is passed back. This prevents a
parallel `skill.read` / `skill.bundle` batch from bypassing the intended order.
`handoff.create` records `skillActivations` so the App and trace can show
whether each recommended skill has been read yet.

Returns:

```json
{
  "handoffId": "handoff_...",
  "handoffFile": ".../handoffs/handoff_....json",
  "task": {}
}
```

### `codex.task_start`

Starts local Codex from either:

- `handoffId`
- or legacy direct fields: `task`, `projectPath`, `workspace`

When `handoffId` is used, the runner prompt is generated from the persisted
handoff so ChatGPT does not need to repeat the full task.

Codex Runner also supports local provider profiles. The bridge can inject a
normal Codex CLI environment, an OpenAI-compatible `OPENAI_BASE_URL`, or a
sub2api-compatible endpoint. Provider trace records are redacted to provider
kind, base URL host, model, and env key name.

### `codex.status`

Lists running and recent Codex tasks.

### `codex.result`

Returns a compact result summary by default: task status, changed files, test
result, and linked handoff metadata. Set `includeLog: true` or
`includeDiff: true` only when the conversation needs verbose records; hosted
ChatGPT can block oversized execution logs or diffs with safety checks.

### `codex.cancel`

Stops a running task and records the cancellation.

## Minimal Demo

Prompt for ChatGPT:

```text
Use the connector. First call handoff.create for:
projectPath=/ABSOLUTE/PATH/TO/chatgpt2localbridge
objective=Create docs/HANDOFF_DEMO.md describing the Handoff -> Codex Runner loop.
riskLevel=low
Then call codex.task_start with the returned handoffId.
After it finishes, call codex.result and summarize the result.
```

## Completion Evidence

A valid MVP requires:

- `docs/handoff-spec.md` exists.
- `handoff.create` is present in `tools/list`.
- `handoff.create` rejects project paths outside policy.
- `handoff.create` writes a handoff JSON file.
- `codex.task_start` accepts `handoffId`.
- `codex.status` and `codex.result` return linked handoff metadata.
- The smoke test runs with a fake `codex` binary.
- A real local Codex CLI demo creates `docs/HANDOFF_DEMO.md` through
  `handoff.create -> codex.task_start`.
