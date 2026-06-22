#!/usr/bin/env node

import { loadConfig } from './config.js';
import { startStdioServer } from './mcpServer.js';
import { startHttpServer } from './httpServer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

// ── CLI Bridge Entry Point ──────────────────────────────────────────────────
//
// Transport modes:
//   stdio  (default)  — for ChatGPT Desktop / local MCP clients
//   http               — for hosted ChatGPT MCP connectors via a tunnel
//
// Usage:
//   node dist/index.js                 → stdio mode
//   node dist/index.js --http 3838     → MCP HTTP mode on port 3838
//   LOCALBRIDGE_PORT=3838 node dist/index.js --http  → MCP HTTP via env

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args[0] === 'help') {
    printHelp();
    return;
  }
  if (args[0] === 'init') {
    initProject(args.slice(1));
    return;
  }

  const config = loadConfig();
  const envPort = process.env.LOCALBRIDGE_PORT;
  const httpMode = args.includes('--http') || args.includes('-h') || !!envPort;
  let httpPort = 3838;

  const httpIdx = args.indexOf('--http');
  if (httpIdx !== -1 && args[httpIdx + 1]) {
    httpPort = parseInt(args[httpIdx + 1], 10);
  } else if (envPort) {
    httpPort = parseInt(envPort, 10);
  }

  // Ensure data directory exists
  fs.mkdirSync(config.dataDir, { recursive: true });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.error(`[bridge] Received ${signal}, shutting down...`);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.error(`[bridge] ChatGPT2LocalBridge v0.1.1 starting`);
  console.error(`[bridge] Data dir: ${config.dataDir}`);
  if (httpMode) console.error(`[bridge] Local console: http://127.0.0.1:${httpPort}/app`);

  if (httpMode) {
    console.error(`[bridge] Mode: MCP Streamable HTTP`);
    await startHttpServer({ config }, httpPort);
  } else {
    console.error(`[bridge] Mode: MCP stdio`);
    console.error(`[bridge] Waiting for MCP client connection...`);
    await startStdioServer(config);
  }
}

function printHelp(): void {
  console.log(`ChatGPT2LocalBridge

Usage:
  chatgpt2localbridge init --root <workspace-root> [--public-url <https-url>] [--port 3838]
  chatgpt2localbridge --http 3838
  chatgpt2localbridge

Commands:
  init       Create bridge.policy.json and .env.local in the current directory.

Options:
  --http     Start MCP Streamable HTTP server on a port. Default: 3838.
  --port     Port written during init. Default: 3838.
  --help     Show this help.

Examples:
  npx github:harzva/chatgpt2localbridge init --root ~/Projects
  set -a; source .env.local; set +a
  npx github:harzva/chatgpt2localbridge --http 3838
`);
}

function initProject(args: string[]): void {
  const rootArg = optionValue(args, '--root') ?? process.cwd();
  const publicUrl = normalizePublicUrl(optionValue(args, '--public-url') ?? 'https://YOUR-PUBLIC-TUNNEL.example.com');
  const port = optionValue(args, '--port') ?? '3838';
  const force = args.includes('--force');
  const workspaceRoot = path.resolve(expandHome(rootArg));
  const cwd = process.cwd();
  const policyPath = path.join(cwd, 'bridge.policy.json');
  const envPath = path.join(cwd, '.env.local');
  const dataDir = path.join(os.homedir(), '.chatgpt2localbridge');
  const unlockCode = randomBytes(24).toString('hex');
  const dashboardToken = randomBytes(24).toString('hex');

  if (!fs.existsSync(workspaceRoot)) {
    throw new Error(`Workspace root does not exist: ${workspaceRoot}`);
  }

  writeIfMissing(policyPath, JSON.stringify({
    allowedProjectRoots: [workspaceRoot],
    skillRoots: [path.join(os.homedir(), '.codex', 'skills')],
    denyGlobs: [
      '**/.env',
      '**/.env.*',
      '**/*.pem',
      '**/*.key',
      '**/*.p12',
      '**/*.pfx',
      '**/.npmrc',
      '**/.netrc',
      '**/.ssh/**',
      '**/id_rsa',
      '**/id_ed25519',
    ],
    shell: {
      enabled: true,
      denyPatterns: [
        'sudo',
        'rm\\s+-rf\\s+/',
        'chmod\\s+-R',
        'chown\\s+-R',
        'security\\s+find-',
        'launchctl\\s+bootout\\s+system',
      ],
    },
  }, null, 2) + '\n', force);

  writeIfMissing(envPath, [
    `export LOCALBRIDGE_PORT=${port}`,
    `export LOCALBRIDGE_DATA_DIR="${dataDir}"`,
    `export LOCALBRIDGE_LOG_DIR="${path.join(dataDir, 'logs')}"`,
    `export LOCALBRIDGE_POLICY_PATH="${policyPath}"`,
    'export LOCALBRIDGE_OAUTH_ENABLED=1',
    `export LOCALBRIDGE_PUBLIC_BASE_URL="${publicUrl}"`,
    `export LOCALBRIDGE_OAUTH_UNLOCK_CODE="${unlockCode}"`,
    `export LOCALBRIDGE_DASHBOARD_TOKEN="${dashboardToken}"`,
    'export LOCALBRIDGE_ALLOW_URL_TOKEN=0',
    '',
  ].join('\n'), force);

  console.log('Initialized ChatGPT2LocalBridge.');
  console.log(`Policy: ${policyPath}`);
  console.log(`Env:    ${envPath} (contains your local unlock code; do not commit)`);
  console.log('Next:   set -a; source .env.local; set +a');
  console.log(`Run:    chatgpt2localbridge --http ${port}`);
  console.log(`App:    http://127.0.0.1:${port}/app`);
  printConnectorSummary({ publicUrl, port, workspaceRoot, envPath });
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function normalizePublicUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function printConnectorSummary(options: {
  publicUrl: string;
  port: string;
  workspaceRoot: string;
  envPath: string;
}): void {
  const { publicUrl, port, workspaceRoot, envPath } = options;
  console.log(`
Tunnel choices:
  ngrok:
    Register: https://dashboard.ngrok.com/signup
    Use when you want the fastest fixed development domain.
    Requires NGROK_AUTHTOKEN; set NGROK_DOMAIN for a stable Connector URL.

  Cloudflare Tunnel:
    Register: https://dash.cloudflare.com/sign-up
    Quick Tunnel is good for smoke tests, but the trycloudflare URL can change.
    Use a named tunnel for stable production URLs.

ChatGPT Connector fields:
  Name: ChatGPT2LocalBridge Linux
  Server URL: ${publicUrl}/mcp
  Authentication: OAuth

Advanced OAuth fields:
  Auth URL: ${publicUrl}/oauth/authorize
  Token URL: ${publicUrl}/oauth/token
  Registration URL: ${publicUrl}/oauth/register
  Authorization server base: ${publicUrl}
  Resource: ${publicUrl}/mcp
  Scopes: workspace:read workspace:write shell:exec
  OIDC: off

Authorization page:
  Bridge unlock code: read LOCALBRIDGE_OAUTH_UNLOCK_CODE from ${envPath} on this host.
  Do not paste unlock codes, tokens, cookies, or .env contents into public chats, issues, screenshots, or commits.

Local checks:
  curl -sS http://127.0.0.1:${port}/health
  http://127.0.0.1:${port}/app

Agent setup prompt:
  Configure ChatGPT2LocalBridge from https://github.com/Harzva/chatgpt2localbridge on this Linux host.
  Keep secrets local. Do not print .env.local, OAuth tokens, ngrok authtokens, cookies, or unlock codes.
  Use workspace root ${workspaceRoot}. Keep allowed roots narrow.
  Verify /health, expose one HTTPS tunnel, set LOCALBRIDGE_PUBLIC_BASE_URL to the public https origin, then report the Connector fields and verification status only.
`);
}

function writeIfMissing(filePath: string, content: string, force: boolean): void {
  if (fs.existsSync(filePath) && !force) {
    console.log(`Exists, not overwritten: ${filePath}`);
    return;
  }
  fs.writeFileSync(filePath, content, { mode: filePath.endsWith('.env.local') ? 0o600 : 0o644 });
  console.log(`Wrote: ${filePath}`);
}

main().catch((err) => {
  console.error('[bridge] Fatal error:', err);
  process.exit(1);
});
