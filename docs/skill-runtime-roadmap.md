# Skill Runtime Roadmap

目标：把 ChatGPT2LocalBridge 从“本地文件桥接器”升级为安全可审计的
**本地 Skill Runtime**，让 ChatGPT 能发现、读取、路由和调用用户批准的
本地 skill，但不把整台机器或任意脚本暴露给云端模型。

## Roadmap Rules

- `[x]` 表示当前仓库已有代码、测试、文档或截图证据。
- `[ ]` 表示尚未完成、尚未验证、仍需设计，或需要用户确认。
- 读取 skill、理解 skill、执行 skill 是三件事，不能混为一个完成项。
- 默认只暴露少量稳定 MCP 工具；不要把每个本地 skill 都动态注册成一个
  ChatGPT tool。
- 可执行 skill 必须晚于 manifest、policy、trace 和 UI 审计能力。

## Current Baseline

- [x] 已支持 `skillRoots` policy。
  - Evidence: `bridge.policy.json` / `src/config.ts` 支持 `skillRoots`。
- [x] 已支持只读 skill 工具面。
  - Evidence: `skill.list`, `skill.search`, `skill.read`, `skill.bundle`,
    `skill.route` 已在 MCP server 注册。
- [x] Skill route can feed Codex handoff context.
  - Evidence: `handoff.create` accepts `skillTask`, `skillRoot`, and
    `maxSkillContext`, then injects compact route results into
    `handoff.skillContext`.
- [x] Skill reference reads are activation-gated.
  - Evidence: `skill.read` activates a `SKILL.md`; `skill.bundle` only includes
    referenced files when the caller passes the returned `activationId`.
- [x] Project-local `.codex/skills` discovery is supported for approved roots.
  - Evidence: `handoff.create` can route skills found under a project's
    `.codex/skills` directory.
- [x] 已有本地 skill smoke tests。
  - Evidence: `scripts/test-mcp.sh` 覆盖 `skill.list/read/bundle/route`,
    activationId gate, and project `.codex/skills` discovery.
- [x] README 已说明 `~/.codex/skills` 可作为 skill root。
  - Evidence: README 的 Local Skills 小节。

当前能力是 **Read-only Skill Registry**。它能让 ChatGPT 通过 MCP 读取和
路由本地 skill 文档，但还不是完整的 Skill Runtime。

## Optimized Five Decisions

### 1. ChatGPT 不会自动识别本地 skill

ChatGPT 只根据 MCP `tools/list` 里的 tool schema 做决策。所谓“识别本地
skill”，实际链路是：

```text
skillRoots -> local registry scan -> stable MCP tools -> ChatGPT tool call
```

因此责任边界是：

| Layer | Responsibility |
| --- | --- |
| ChatGPT | 选择调用哪个已暴露 tool |
| MCP Bridge | 暴露少量稳定 schema |
| Skill Registry | 扫描、索引、路由本地 skill |
| Runtime | 在 policy 内读取或执行被批准的 action |
| App | 让用户查看、启用、禁用、审计 skill |

### 2. 现阶段不是从零开始，而是从只读 registry 升级

已有 `skill.*` 工具是基础。下一步不是“再做一个 skill.list”，而是把
已有能力收束为三个层次：

| Level | Tool Shape | Goal |
| --- | --- | --- |
| Discover | `skill.list`, `skill.search` | 找到可用 skill |
| Understand | `skill.read`, `skill.bundle`, `skill.route` | 让 ChatGPT 读懂 skill |
| Invoke | `skill.invoke` | 在 policy 内执行 manifest 声明的安全 action |

### 3. 推荐 Manifest-driven，但先不执行任意 `index.js`

每个 skill 可以逐步支持 `skill.json`：

```json
{
  "name": "example.skill",
  "version": "0.1.0",
  "description": "Describe what this skill helps with.",
  "entry": "SKILL.md",
  "type": "instruction",
  "capabilities": ["filesystem.read"],
  "actions": []
}
```

第一版只接受 `instruction` 和 `template` 类型。`executable` 类型必须等
policy、trace、UI、测试全部就绪后再打开。

### 4. 不动态注册海量 per-skill tools

不要让 200 个本地 skill 变成 200 个 ChatGPT tools。原因：

- ChatGPT 工具选择会更容易混乱。
- Connector 工具列表可能被缓存。
- 工具越多，安全和测试面越难收敛。

推荐保留稳定工具面：

```text
skill.list
skill.search
skill.read
skill.bundle
skill.route
skill.invoke
```

`skill.invoke` 内部根据 manifest、policy、capabilities 和 action id 路由。

### 5. 产品定位升级为 Local Skill OS

差异化定位：

```text
ChatGPT2LocalBridge =
  local workspace bridge
  + skill registry
  + Codex Runner
  + policy/audit control plane
```

这不是裸 shell 代理，也不是简单文件读取器。它应该成为“ChatGPT 连接本地
能力”的控制面：可发现、可解释、可审计、可关闭。

## Skill Package Standard

### Phase 1 Manifest

每个 skill 目录可以包含：

```text
my-skill/
  SKILL.md
  skill.json
  references/
  templates/
```

`skill.json` 字段：

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | 稳定 id，建议小写加点号或短横线 |
| `version` | yes | semver 或日期版本 |
| `description` | yes | 给 ChatGPT 和 App 展示 |
| `entry` | yes | 默认 `SKILL.md` |
| `type` | yes | `instruction`, `template`, `workflow`, `executable` |
| `capabilities` | yes | 如 `filesystem.read`, `codex.task`, `network.read` |
| `actions` | no | 第二阶段开始使用 |
| `risk` | no | `low`, `medium`, `high` |

### Capability Vocabulary

第一版能力词表：

```text
filesystem.read
filesystem.write
project.bundle
codex.task
shell.exec
network.read
cloud.download
```

默认只允许：

```text
filesystem.read
project.bundle
codex.task
```

## Phases

### Phase 0: Stabilize Read-only Registry

- [x] `skillRoots` 进入 policy。
- [x] `skill.list/search/read/bundle/route` 可用。
- [x] skill 调用写入 tool-call 和 audit 记录。
- [ ] App 的 Tool Catalog 增加 Skill Catalog 分区。
- [ ] App 显示每个 skill 的 root、entry、risk、capabilities。
- [ ] README 增加 Local Skill OS 定位。

### Phase 1: Manifest Parser

- [ ] 新增 `src/registry/skill_schema.ts`。
- [ ] 新增 `src/registry/skill_loader.ts`。
- [ ] 支持读取 `skill.json`，缺失时从 `SKILL.md` 推断只读 manifest。
- [ ] 校验 manifest 必填字段、相对路径、capability 词表。
- [ ] 拒绝 manifest 指向 skill root 之外的文件。
- [ ] 为 manifest parser 添加单元测试。

### Phase 2: Registry API

- [ ] 强化 `skill.list`，返回 manifest 状态和 risk。
- [ ] 强化 `skill.search`，搜索 manifest、`SKILL.md` 和 references 摘要。
- [ ] 新增 `skill.manifest_read`。
- [ ] 新增 `skill.capabilities`，列出当前 policy 允许的 capability。
- [ ] `skill.route` 返回推荐 skill、理由、下一步建议工具。

### Phase 3: Safe `skill.invoke`

- [ ] 新增 `skill.invoke`，只接受 manifest 中声明的 action id。
- [ ] 第一版只支持 `template` action，不执行脚本。
- [ ] template action 只能生成 prompt、bundle 请求或 Codex Runner 请求。
- [ ] 所有 invoke 写入 `tool-calls.jsonl` 和 `audit.jsonl`。
- [ ] App 可查看 invoke 输入、输出、risk 和 policy 决策。

### Phase 4: Workflow Actions

- [ ] 支持 `workflow` action graph。
- [ ] workflow 只能调用 bridge 已有安全工具，例如 `project.bundle`,
  `policy.read`, `codex.task_start`。
- [ ] 每一步都有 timeout、output limit 和 root check。
- [ ] App 展示 workflow step timeline。
- [ ] workflow 失败时返回可恢复错误，不继续执行后续步骤。

### Phase 5: Executable Skills

- [ ] 默认关闭 `executable`。
- [ ] 需要 policy 显式启用 `skillExecution.enabled`。
- [ ] 每个 executable action 需要 capabilities、allowed roots、timeout。
- [ ] 禁止 skill 自行绕过 bridge policy 读取敏感路径。
- [ ] App 显示红色高风险提示和一键禁用。
- [ ] 发布前完成安全审计和恶意 skill 测试。

## App Upgrade Plan

- [ ] 增加 `Skill Catalog` 页面或分区。
- [ ] 显示 skill 状态：valid、missing manifest、blocked、high risk。
- [ ] 显示 skill 来源 root，避免用户误把整个 `~/.codex` 暴露出去。
- [ ] 支持启用/禁用单个 skill。
- [ ] 支持编辑 policy 中的 `skillRoots` 和 capability allowlist。
- [ ] Trace Studio 按 `skillId` / `actionId` 分组。

## Security Rules

- `skillRoots` 必须窄。推荐 `~/.codex/skills`，不要推荐 `~/.codex`。
- manifest 中所有路径必须解析在对应 skill root 内。
- `instruction` 和 `template` 是默认安全层。
- `workflow` 只能调用已存在的安全 MCP 工具。
- `executable` 必须默认关闭。
- 禁止把 token、cookie、`.env.local`、OAuth store、raw chat log 放进
  skill bundle。

## Test Plan

- [ ] manifest parser fixture tests。
- [ ] malformed manifest rejection tests。
- [ ] path traversal rejection tests。
- [ ] capability allow/deny tests。
- [ ] `skill.invoke` template action smoke test。
- [ ] `skill.invoke` blocked executable test。
- [ ] App Skill Catalog snapshot or accessibility smoke test。
- [ ] ChatGPT connector tool-list smoke test，确认稳定工具数量没有爆炸。

## Release Milestones

### M1: Local Skill OS Positioning

- [ ] README 增加 Local Skill OS 说明。
- [ ] GitHub Pages 增加 Skill Runtime 区块。
- [ ] App Tool Catalog 标出 skill tools。

### M2: Manifest MVP

- [ ] `skill.json` schema 合并。
- [ ] loader 合并。
- [ ] tests 合并。
- [ ] docs 增加 skill package 示例。

### M3: Safe Invoke MVP

- [ ] `skill.invoke` 支持 template action。
- [ ] App trace 可查看 invoke。
- [ ] ChatGPT 测试提示词验证：先 route，再 bundle，再 invoke。

### M4: Workflow Runtime

- [ ] workflow action graph。
- [ ] step trace。
- [ ] failure recovery。
- [ ] Codex Runner 互通。

### M5: Executable Review Gate

- [ ] executable policy 设计。
- [ ] security audit。
- [ ] malicious fixture tests。
- [ ] 用户明确批准后再开放。

## Open Questions

- [ ] manifest 文件名固定为 `skill.json`，还是兼容 `manifest.yaml`？
- [ ] `skill.invoke` 是否应该在 ChatGPT app profile 中默认暴露？
- [ ] App 是否需要“一键扫描本机 skill roots”？
- [ ] 是否需要把 skill package 标准做成独立仓库或模板？
- [ ] Cursor / Claude / Codex skill 之间是否需要转换器？
