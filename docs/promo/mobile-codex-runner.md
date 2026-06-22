# Mobile Codex Runner Promo

## Title Options

1. 手机 ChatGPT 也能调用本地 Codex 干活了
2. 不开远程桌面，让手机上的 ChatGPT 改本地项目
3. 我把 ChatGPT 变成了本地 Codex 的任务入口

## Cover Image

Use:

```text
docs/assets/xhs-mobile-remote.png
```

Image message:

- 手机 ChatGPT 发任务
- `handoff.create -> codex.task_start`
- 本地 Codex CLI 执行
- App 里看日志、diff、测试结果
- OAuth + policy + handoff，不裸露全盘

## Xiaohongshu Copy

我最近把 ChatGPT2LocalBridge 的主线升级成了：

手机 / 网页 ChatGPT 发任务，本地 Codex CLI 真正干活。

不是远程桌面，也不是模拟网页登录。路线是 ChatGPT 官方 Custom Connector
能力：

```text
ChatGPT
-> handoff.create
-> codex.task_start
-> local Codex CLI
-> App trace / logs / diff / test result
```

现在的关键变化是：ChatGPT 不再直接拼低层 `file.write` 或 `shell.exec`，
而是先生成一个结构化 handoff：

- 目标是什么
- 项目路径在哪里
- 允许做哪些事
- 风险等级是什么
- 要跑哪些测试
- 预期产物是什么
- 可选匹配哪些本地 skill

然后本地 Codex Runner 执行。

我刚跑通了一个真实 demo：通过 `handoff.create -> codex.task_start`，让本地
Codex 在仓库里创建 `docs/HANDOFF_DEMO.md`，任务状态 `success`，退出码 `0`。

为什么这个思路好？

- 手机上就能安排本地 Mac mini / server 做项目任务
- 不需要打开 tun 模式
- 不需要把整个项目上传给云端
- OAuth 授权后只访问批准目录
- 本地 App 可以看实时日志、diff、测试结果和调用记录
- 高风险能力不直接暴露成裸 shell，而是走 policy + handoff + trace

我觉得这类工具会变成新的“Agent Plugin App”范式：

给 AI 一个清晰、可审计、可停止的本地控制面，而不是把电脑裸奔暴露出去。

GitHub:

```text
Harzva/chatgpt2localbridge
```

欢迎 PR，尤其是 Windows / Linux 适配、service 安装、Cloudflare Tunnel、
更多真实移动端工作流截图。

## WeChat Opening

如果你经常在手机上想到一个项目任务，但真正的代码和文件都在 Mac mini
或者服务器上，这个工作流会很顺手：

你在手机 ChatGPT 里说任务，ChatGPT 生成一个结构化 handoff，本地
ChatGPT2LocalBridge 收到后交给 Codex CLI 执行。执行日志、改动文件、diff
和测试结果都留在本地 App 里。

这不是把本机全盘暴露出去，而是用 MCP connector、OAuth、policy、
handoff 和 trace 组合出一个可控的本地任务入口。

## Short Caption

手机 ChatGPT 发任务，本地 Codex CLI 干活。

`handoff.create -> codex.task_start` 已跑通真实 demo。App 里能看日志、diff、
测试结果和取消任务。OAuth + policy + handoff，不裸露全盘。
