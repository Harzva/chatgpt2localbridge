import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const quiet = args.includes('--quiet');
const outPath = path.resolve(rootDir, outIndex >= 0 ? args[outIndex + 1] : 'assets/mcp-tools.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt2localbridge-tools-'));
const policyPath = path.join(tmpDir, 'bridge.policy.json');

fs.writeFileSync(policyPath, JSON.stringify({
  allowedProjectRoots: [rootDir],
  denyGlobs: ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/.ssh/**'],
  shell: {
    enabled: false,
    denyPatterns: [],
  },
}, null, 2));

const env = {
  ...process.env,
  LOCALBRIDGE_DATA_DIR: path.join(tmpDir, 'data'),
  LOCALBRIDGE_LOG_DIR: path.join(tmpDir, 'logs'),
  LOCALBRIDGE_POLICY_PATH: policyPath,
  LOCALBRIDGE_OAUTH_ENABLED: '0',
  LOCALBRIDGE_TOOL_PROFILE: 'debug',
};

try {
  const response = await runToolsList(env);
  const tools = response
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'MCP tools/list',
    count: tools.length,
    tools,
  }, null, 2)}\n`);

  if (!quiet) console.log(`Wrote ${tools.length} MCP tools to ${outPath}`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function runToolsList(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: rootDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Timed out waiting for MCP tools/list'));
    }, 8000);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const lines = Buffer.concat(stdout).toString('utf-8')
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        const list = lines.find((line) => line.id === 2)?.result?.tools;
        if (!Array.isArray(list)) {
          throw new Error(`No tools/list response found. exit=${code} stderr=${Buffer.concat(stderr).toString('utf-8')}`);
        }
        resolve(list);
      } catch (err) {
        reject(err);
      }
    });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tool-catalog-export', version: '0.1.0' },
      },
    })}\n`);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    })}\n`);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })}\n`);
    child.stdin.end();
  });
}
