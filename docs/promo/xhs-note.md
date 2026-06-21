# Xiaohongshu Promo Copy

## Title Options

1. 把本地文件挂到 ChatGPT
2. 我做了一个本地 MCP 插件 App
3. ChatGPT 也能看本地项目了

## Main Copy

我把 ChatGPT2LocalBridge 整理成了一个独立开源项目。

它不是传统浏览器插件，而是一个面向 ChatGPT / Codex 的本地 Plugin App：
本机跑一个 MCP bridge，ChatGPT 通过 OAuth 授权后，只能访问你批准的本地目录。

这次重点补齐了几个真实可用的能力：

- 本地目录读取和文件内容读取
- 多文件 bundle，方便一次性给 ChatGPT 上下文
- 文件写入 smoke test 和审计记录
- macOS 原生控制台，查看 policy、tools、trace、download
- OAuth / unlock code 授权流程
- GitHub Pages 宣传页和截图教程

实测经验：不要默认开启 xhigh / XHigh 模式，报错会明显更多。普通模式先跑通，再开调试模式抓 trace。

我更想把它定位成一个开源倡议：大家都可以为 ChatGPT / Codex 做自己的 Plugin App。核心不是把电脑裸奔暴露出去，而是给 AI 一个安全、可审计、可停止的本地控制面。

GitHub: Harzva/chatgpt2localbridge

## Tags

#ChatGPT #MCP #Codex #开源项目 #效率工具 #本地知识库 #AI工具 #程序员工具 #GitHub
