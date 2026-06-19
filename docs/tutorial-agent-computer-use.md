# Agent + Computer Use Tutorial

Use this when a local coding agent is allowed to help click through ChatGPT settings.

![Agent Computer Use setup](./assets/screenshots/08-agent-computer-use.png)

Safety rules:

- The agent must not print tokens or unlock codes.
- The human operator handles browser trust prompts and final approval.
- The agent should verify `/health`, OAuth metadata, and a minimal tool call.

Suggested prompt:

```text
You are configuring ChatGPT2LocalBridge with Computer Use.
Verify local health, open ChatGPT connector settings, create a custom OAuth connector, stop for human approval on unlock code or safety prompts, then test a minimal file.list call.
Never print tokens or unlock codes.
```
