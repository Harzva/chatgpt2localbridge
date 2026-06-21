# Xiaohongshu Promo Copy

## Title Options

1. 把本地文件挂到 ChatGPT
2. 我做了一个本地 MCP 插件 App
3. ChatGPT 也能看本地项目了

## Recommended Image Order

1. `docs/assets/xhs-promo.png`
   首图，放项目定位、核心能力、实测数字和安全提醒。
2. ChatGPT 工具调用截图
   使用你发的工具调用列表截图，重点露出 `file_read_path`、`local_workspace_action`、返回 `CHATGPT_WRITE_TEST.md` 内容这几个证据点。发布前把完整本机路径打码或裁切成 `<approved-workspace>/...`。
3. shell_exec 策略拦截图
   使用你发的 `shell_exec` 截图，重点说明：高危命令措辞被 bridge 安全策略拦截，改成纯文本计划后成功写入 TXT。这证明它不是裸 shell 代理。
4. macOS App 控制台截图
   放连接器 URL、OAuth、工具数量、Trace/调用记录区域，证明它不是纯命令行 demo，而是有本地控制面。
5. `docs/assets/xhs-community.png`
   欢迎开发者共建和 PR，突出 Linux 适配 Todo。
6. `docs/evidence.md` 截图
   展示测试摘要：`chatgpt-app tools ok (10)`、`file_write ok`、`cloud download write ok`、`oauth metadata ok`。
7. GitHub README / Pages 截图
   展示开源仓库、安装方式、GitHub Pages 教程入口。

## Main Copy

我把 ChatGPT2LocalBridge 整理成了一个独立开源项目。

它不是传统浏览器插件，而是一个面向 ChatGPT / Codex 的本地 Plugin App：
本机跑一个 MCP bridge，ChatGPT 通过 OAuth 授权后，只能访问你批准的本地目录。

这次不是只做概念图，而是把实测证据也整理进仓库了：

- ChatGPT 侧工具调用截图里，可以看到 `file_read_path` 成功读取本地写入测试文件
- 工具调用列表里有 `bridge_health`、`policy_read`、`local_workspace_action`、`file_read_path`
- 测试脚本显示 `chatgpt-app tools ok (10)`
- 写入链路通过：`file_write ok`、`local_write_file ok`、`local_workspace_action write_file ok`
- 云端文件下载到本地通过：`cloud download write ok`
- OAuth 元数据通过：`oauth metadata ok`
- macOS App 已安装到本地，可以看连接器字段、工具数量、策略和 Trace 记录
- `shell_exec` 里包含高危命令措辞时被安全策略拦截，改成纯文本后再写入成功
- Linux 版本还需要更多适配和实测，欢迎开发者 PR

现在它能做的事：

- 本地目录读取和文件内容读取
- 多文件 bundle，方便一次性给 ChatGPT 上下文
- 文件写入 smoke test 和审计记录
- macOS 原生控制台，查看 policy、tools、trace、download
- OAuth / unlock code 授权流程
- GitHub Pages 宣传页和截图教程

实测经验：不要默认开启 xhigh / XHigh 模式，报错会明显更多。普通模式先跑通，再开调试模式抓 trace。这个备注我也写进了 evidence 文档里。

我更想把它定位成一个开源倡议：大家都可以为 ChatGPT / Codex 做自己的 Plugin App。核心不是把电脑裸奔暴露出去，而是给 AI 一个安全、可审计、可停止的本地控制面。

Todo：Linux 适配还需要继续完善，尤其是 systemd service、Cloudflare Tunnel、服务器安全策略、不同发行版安装脚本。欢迎提 issue / PR 一起共建。

GitHub: Harzva/chatgpt2localbridge

## Short Version

做了一个开源项目：ChatGPT2LocalBridge。

它让 ChatGPT 通过 MCP + OAuth 访问你批准的本地目录，并且所有读取、写入、下载、工具调用都能在本地 App 里看记录。

实测已经跑通：

- ChatGPT 调用工具读取本地文件
- 写入测试文件并再次读回
- 云端文件下载到本地
- macOS App 显示工具、策略、Trace
- 高危 shell 命令措辞会被策略拦截
- `chatgpt-app` profile 暴露 10 个工具

注意：别默认开 xhigh / XHigh，实测报错更多。先普通模式跑通，再调试。

Linux 适配欢迎 PR：systemd、隧道、安装脚本、安全策略都可以一起补。

GitHub: Harzva/chatgpt2localbridge

## Screenshot Captions

- 图 1：项目首图，把本地文件安全挂到 ChatGPT。
- 图 2：ChatGPT 实际工具调用，`file_read_path` 成功返回本地测试文件内容。
- 图 3：`shell_exec` 安全策略拦截，高危措辞不会直接执行。
- 图 4：macOS App 控制台，能看连接器 URL、OAuth、工具数量和 Trace。
- 图 5：欢迎开发者共建，Linux 适配 Todo 欢迎 PR。
- 图 6：Evidence 文档，记录 build/test、写入、下载、OAuth 测试结果。
- 图 7：GitHub README，开源安装和教程入口。

## Tags

#ChatGPT #MCP #Codex #开源项目 #效率工具 #本地知识库 #AI工具 #程序员工具 #GitHub
