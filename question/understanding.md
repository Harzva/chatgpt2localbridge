# ChatGPT2LocalBridge 问题理解

## 项目背景

`chatgpt2localbridge` 是一个自托管的 **Codex / ChatGPT Plugin App**，核心是一个基于 MCP（Model Context Protocol）的本地工作区桥接器。它让 Web 版 ChatGPT 在授权后，通过 MCP tool 调用访问、读取、打包、追踪甚至操作本地 approved 的项目文件。

## 遇到的现象

用户希望通过 ChatGPT 直接写入本地文件，例如：

```
<approved-workspace>/docs/ARTIFACTS_APP_UPGRADE_PLAN.md
```

但 ChatGPT 反馈：

> 当前 attachlocal2chatgpt 只暴露了 4 个 action：
> - `bridge_health`
> - `policy_read`
> - `file_list`
> - `file_read_path`
>
> 没有暴露 `file.write` / `local_workspace_action` / `file_write` 这类写入 action，因此无法直接创建文件。

## 根因分析

不是文件系统权限问题，也不是 `bridge.policy.json` 策略问题。

真正的原因是 `src/mcpServer.ts` 中的 **`installToolProfileGate`**：服务器在注册 MCP tool 之前，会根据 `LOCALBRIDGE_TOOL_PROFILE` 环境变量过滤允许暴露的 tool。

相关代码位置：`src/mcpServer.ts:2207-2271`

```typescript
function isToolAllowedForProfile(profile, tool): boolean {
  if (profile === 'debug') return true;

  if (profile === 'chatgpt-app') {
    return new Set([
      'bridge_health',
      'policy_read',
      'file_list',
      'local_list_dir',
      'local_read_file',
      'local_bundle_dir',
      'local_workspace_action',
    ]).has(tool);
  }

  // normal 模式：file.write / shell.exec 等 low-level tool 会被 isLowLevelTool() 过滤掉
  ...
}
```

因此：
- `file.write` 虽然已在代码中实现，但在 `chatgpt-app` profile 下根本不会被注册到 MCP。
- 在 `normal` profile 下，`file.write` 被归类为 low-level tool，同样被屏蔽。
- 只有 `debug` profile 会暴露全部 tool，但 debug 模式不适合公开部署。

这就是 ChatGPT 侧看不到写入 action 的原因。

## 已实施的修复

1. **新增 `file_write` tool**（`src/mcpServer.ts`）
   - 作为 `file.write` 的下划线命名兼容别名，与已有的 `file_read_path` 保持一致。
   - 参数与 `file.write` 完全一致：`projectPath`、`file`（相对路径）、`content`、`createDirs`。

2. **把 `file_read_path` 和 `file_write` 加入 `chatgpt-app` profile 白名单**
   - 这样 ChatGPT Custom Connector 在最小暴露集合下也能读、写文件。

3. **更新测试**（`scripts/test-mcp.sh`）
   - chatgpt-app profile 的 tool list 断言更新为 9 个。
   - 新增 `file_write` 功能测试：实际写入文件并校验内容。

4. **重新构建并刷新 tool catalog**
   - `npm run build`
   - `npm run tools:catalog`
   - `npm test` 全部通过。

## 用户接下来需要做的

1. 确认 `.env.local` 中的 profile：
   ```bash
   LOCALBRIDGE_TOOL_PROFILE=chatgpt-app
   ```
2. 重启 ChatGPT2LocalBridge 服务，让新代码生效。
3. 在 ChatGPT Custom Connector 侧刷新/重新连接，重新拉取 `tools/list`。
4. 刷新后 ChatGPT 应该能看到 `file_write`，然后可以调用它写入文件。

## 补充说明

- `local_workspace_action` 当前仍是只读 tool（只支持 `list_dir`/`read_file`/`bundle_dir`）。OpenAI 的 safety checks 曾拦截过对它的调用，因此没有通过扩展它来实现写入，而是单独新增了一个更明确、更细粒度的 `file_write`。
- 如果用户希望一次性开放所有 tool（包括 `shell.exec`），可以把 profile 改成 `debug`，但不建议用于公开可访问的部署。
