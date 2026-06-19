import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { BridgeConfig } from './config.js';
import { snapshotProject } from './project.js';
import { getRawDiff, getChangedFiles, parseUnifiedDiff } from './diffEngine.js';
import {
  appendToolCall,
  readAuditEvents,
  readToolCalls,
  sanitizeForLog,
  summarizeToolResult,
} from './activity.js';

const execAsync = promisify(exec);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 200_000;
const BRIDGE_SERVICE_LABELS = [
  'com.chatgpt2localbridge.bridge',
  'com.chatgpt2localbridge.ngrok',
];
const BRIDGE_LOG_FILES = [
  'bridge.err.log',
  'bridge.out.log',
  'ngrok.log',
] as const;
const SERVICE_RESTART_LABELS = ['bridge', 'ngrok'] as const;

let activeConfig: BridgeConfig | undefined;

interface WorkspaceRecord {
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

interface TaskRecord {
  id: string;
  title: string;
  workspace?: string;
  projectPath?: string;
  status: 'active' | 'done' | 'blocked';
  notes: Array<{ ts: string; text: string }>;
  createdAt: string;
  updatedAt: string;
}

interface ProcessRecord {
  id: string;
  workspace?: string;
  projectPath: string;
  command: string;
  pid: number;
  logFile: string;
  status: 'running' | 'exited' | 'unknown';
  startedAt: string;
  updatedAt: string;
}

const fileTreeEntryOutput = {
  path: z.string(),
  size: z.number(),
  lines: z.number(),
};

const changedFileOutput = {
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  insertions: z.number(),
  deletions: z.number(),
};

const diffStatsOutput = {
  files: z.number(),
  insertions: z.number(),
  deletions: z.number(),
};

const fileSummaryOutput = {
  path: z.string(),
  lines: z.number().optional(),
  truncated: z.boolean().optional(),
  error: z.string().optional(),
};

const directoryEntryOutput = {
  path: z.string(),
  type: z.enum(['file', 'directory', 'other']),
  size: z.number(),
  modifiedAt: z.string(),
};

const serviceStatusOutput = {
  label: z.string(),
  state: z.string(),
  pid: z.number().optional(),
  lastExitCode: z.string().optional(),
};

const logFileOutput = {
  file: z.string(),
  lines: z.array(z.string()),
  truncated: z.boolean(),
  error: z.string().optional(),
};

const fileStatOutput = {
  path: z.string(),
  type: z.enum(['file', 'directory', 'other']),
  size: z.number(),
  modifiedAt: z.string(),
  sha256: z.string().optional(),
};

const packageScriptOutput = {
  name: z.string(),
  command: z.string(),
};

const healthCheckOutput = {
  name: z.string(),
  url: z.string(),
  ok: z.boolean(),
  status: z.number().optional(),
  body: z.string().optional(),
  error: z.string().optional(),
};

const detectedTestOutput = {
  name: z.string(),
  command: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
};

const workspaceOutput = {
  name: z.string(),
  path: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isDefault: z.boolean().optional(),
};

const taskOutput = {
  id: z.string(),
  title: z.string(),
  workspace: z.string().optional(),
  projectPath: z.string().optional(),
  status: z.enum(['active', 'done', 'blocked']),
  notes: z.array(z.object({ ts: z.string(), text: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const processOutput = {
  id: z.string(),
  workspace: z.string().optional(),
  projectPath: z.string(),
  command: z.string(),
  pid: z.number(),
  logFile: z.string(),
  status: z.enum(['running', 'exited', 'unknown']),
  startedAt: z.string(),
  updatedAt: z.string(),
};

const toolCallOutput = {
  id: z.string(),
  ts: z.string(),
  tool: z.string(),
  status: z.enum(['started', 'ok', 'error']),
  durationMs: z.number().optional(),
  args: z.record(z.unknown()).optional(),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
};

const auditEventOutput = {
  ts: z.string(),
  action: z.string(),
};

const cloudDownloadOutput = {
  file: z.string(),
  bytes: z.number(),
  sha256: z.string(),
  contentType: z.string().optional(),
  sourceUrlHost: z.string(),
};

export function createMcpServer(config: BridgeConfig): McpServer {
  activeConfig = config;
  const server = new McpServer(
    { name: 'chatgpt2localbridge', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool('project.snapshot', {
    title: 'Project Snapshot',
    description: 'Get local project context: git state, language, package manager, and a bounded file tree. Use this before editing a project.',
    inputSchema: {
      path: z.string().describe('Absolute path to the project directory'),
      maxDepth: z.number().int().min(1).max(10).default(3),
    },
    outputSchema: {
      path: z.string(),
      branch: z.string(),
      isGitRepo: z.boolean(),
      headCommit: z.string().optional(),
      isDirty: z.boolean(),
      entries: z.array(z.string()),
      language: z.string().optional(),
      packageManager: z.string().optional(),
      fileTree: z.array(z.object(fileTreeEntryOutput)),
      totalFiles: z.number(),
      totalLines: z.number(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('project.snapshot', async ({ path: projectPath, maxDepth }) => {
    const root = resolveProject(projectPath);
    const snapshot = snapshotProject(root);
    const fileTree = buildFileTree(root, maxDepth);

    return {
      content: [{
        type: 'text' as const,
        text: `${snapshot.language ?? 'project'} at ${snapshot.path} (${snapshot.isGitRepo ? `branch: ${snapshot.branch}` : 'not a git repo'}, ${snapshot.isDirty ? 'dirty' : 'clean'})`,
      }],
      structuredContent: {
        ...snapshot,
        fileTree: fileTree.files.slice(0, 300),
        totalFiles: fileTree.totalFiles,
        totalLines: fileTree.totalLines,
      },
    };
  }));

  server.registerTool('code.read', {
    title: 'Read Files',
    description: 'Read one or more text files from a local project.',
    inputSchema: {
      projectPath: z.string(),
      files: z.array(z.string()).min(1),
      maxLines: z.number().int().min(10).max(5000).default(1000),
    },
    outputSchema: {
      files: z.array(z.object(fileSummaryOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('code.read', async ({ projectPath, files, maxLines }) => {
    const root = resolveProject(projectPath);
    const results = files.map((file) => readProjectFile(root, file, maxLines));

    return {
      content: [{
        type: 'text' as const,
        text: results.map((r) => r.error
          ? `${r.path}: ${r.error}`
          : `--- ${r.path} (${r.lines} lines${r.truncated ? ', truncated' : ''}) ---\n${r.content}`
        ).join('\n\n'),
      }],
      structuredContent: {
        files: results.map(({ path, lines, truncated, error }) => ({ path, lines, truncated, error })),
      },
      _meta: { fileContents: results },
    };
  }));

  server.registerTool('code.read_range', {
    title: 'Read File Range',
    description: 'Read a bounded line range from one text file inside a project.',
    inputSchema: {
      projectPath: z.string(),
      file: z.string(),
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
    },
    outputSchema: {
      file: z.string(),
      startLine: z.number(),
      endLine: z.number(),
      totalLines: z.number(),
      content: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('code.read_range', async ({ projectPath, file, startLine, endLine }) => {
    const root = resolveProject(projectPath);
    const range = readProjectFileRange(root, file, startLine, endLine);
    return {
      content: [{ type: 'text' as const, text: range.content }],
      structuredContent: range,
    };
  }));

  server.registerTool('code.search', {
    title: 'Search Code',
    description: 'Search local project files with ripgrep-compatible output.',
    inputSchema: {
      projectPath: z.string(),
      query: z.string(),
      glob: z.string().optional(),
      maxResults: z.number().int().min(1).max(500).default(100),
    },
    outputSchema: {
      query: z.string(),
      count: z.number(),
      files: z.array(z.string()),
      matches: z.array(z.object({
        file: z.string(),
        line: z.number(),
        text: z.string(),
      })),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('code.search', async ({ projectPath, query, glob, maxResults }) => {
    const root = resolveProject(projectPath);
    const args = ['--line-number', '--no-heading', '--color', 'never'];
    if (glob) args.push('-g', glob);
    args.push(query, '.');

    try {
      const output = execFileSync('rg', args, {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      }).trim();
      const matches = parseSearchOutput(output).slice(0, maxResults);
      return searchResponse(query, matches);
    } catch (err) {
      const status = typeof err === 'object' && err !== null && 'status' in err ? (err as { status?: number }).status : undefined;
      if (status === 1) return searchResponse(query, []);
      return {
        content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }));

  server.registerTool('file.list', {
    title: 'List Directory',
    description: 'List files and directories inside a project directory without reading file contents.',
    inputSchema: {
      projectPath: z.string(),
      dir: z.string().default('.'),
      recursive: z.boolean().default(false),
      maxEntries: z.number().int().min(1).max(1000).default(200),
    },
    outputSchema: {
      dir: z.string(),
      entries: z.array(z.object(directoryEntryOutput)),
      truncated: z.boolean(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('file.list', async ({ projectPath, dir, recursive, maxEntries }) => {
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, dir);
    const entries = listDirectory(root, target, recursive, maxEntries);
    return {
      content: [{
        type: 'text' as const,
        text: entries.items.length
          ? entries.items.map((entry) => `${entry.type.padEnd(9)} ${entry.path}`).join('\n')
          : `No entries in ${dir}`,
      }],
      structuredContent: { dir, entries: entries.items, truncated: entries.truncated },
    };
  }));

  server.registerTool('file.stat', {
    title: 'File Stat',
    description: 'Return metadata for a file or directory inside a project, optionally including sha256 for files.',
    inputSchema: {
      projectPath: z.string(),
      file: z.string(),
      includeHash: z.boolean().default(false),
    },
    outputSchema: fileStatOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('file.stat', async ({ projectPath, file, includeHash }) => {
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, file);
    const stat = statProjectPath(root, target, includeHash);
    return {
      content: [{ type: 'text' as const, text: `${stat.type} ${stat.path} ${stat.size} bytes${stat.sha256 ? ` sha256=${stat.sha256}` : ''}` }],
      structuredContent: stat,
    };
  }));

  server.registerTool('file.write', {
    title: 'Write File',
    description: 'Create or overwrite a text file inside a project. Use code.read first when modifying an existing file.',
    inputSchema: {
      projectPath: z.string(),
      file: z.string(),
      content: z.string(),
      createDirs: z.boolean().default(true),
    },
    outputSchema: {
      file: z.string(),
      changedFiles: z.array(z.object(changedFileOutput)),
      stats: z.object(diffStatsOutput),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('file.write', async ({ projectPath, file, content, createDirs }) => {
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, file);
    const before = fileDigest(target);
    if (createDirs) fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    auditFileOperation('file.write', root, [{ path: target, before, after: fileDigest(target) }]);
    return fileChangeResponse(root, file, `Wrote ${file}`);
  }));

  server.registerTool('cloud.download', {
    title: 'Download Cloud File',
    description: 'Download a ChatGPT/App-provided HTTPS file URL into an approved local workspace. Use this when a cloud-side file has a download link and should be synced to local disk.',
    inputSchema: {
      projectPath: z.string(),
      url: z.string().url(),
      file: z.string(),
      overwrite: z.boolean().default(false),
      maxBytes: z.number().int().min(1).max(100 * 1024 * 1024).default(50 * 1024 * 1024),
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    },
    outputSchema: cloudDownloadOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, withToolLogging('cloud.download', async ({ projectPath, url, file, overwrite, maxBytes, expectedSha256 }) => {
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, file);
    if (fs.existsSync(target) && !overwrite) {
      return { content: [{ type: 'text' as const, text: `Download cancelled: target exists: ${file}` }], isError: true };
    }
    const before = fileDigest(target);
    const tempTarget = path.join(path.dirname(target), `.${path.basename(target)}.${Date.now()}.download`);
    try {
      const downloaded = await downloadToLocalFile(url, tempTarget, maxBytes);
      if (expectedSha256 && downloaded.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        fs.unlinkSync(tempTarget);
        return {
          content: [{ type: 'text' as const, text: `Download failed: sha256 mismatch for ${file}` }],
          structuredContent: { ...downloaded, file },
          isError: true,
        };
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(tempTarget, target);
      auditFileOperation('cloud.download', root, [{ path: target, before, after: downloaded.sha256 }]);
      return {
        content: [{ type: 'text' as const, text: `Downloaded ${downloaded.bytes} bytes to ${file}` }],
        structuredContent: { file, ...downloaded },
      };
    } finally {
      if (fs.existsSync(tempTarget)) fs.unlinkSync(tempTarget);
    }
  }));

  server.registerTool('file.mkdir', {
    title: 'Create Directory',
    description: 'Create a directory inside a project.',
    inputSchema: {
      projectPath: z.string(),
      dir: z.string(),
      recursive: z.boolean().default(true),
    },
    outputSchema: {
      dir: z.string(),
      created: z.boolean(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('file.mkdir', async ({ projectPath, dir, recursive }) => {
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, dir);
    const existed = fs.existsSync(target);
    fs.mkdirSync(target, { recursive });
    auditFileOperation('file.mkdir', root, [{ path: target, before: existed ? 'exists' : undefined, after: 'directory' }]);
    return {
      content: [{ type: 'text' as const, text: `${existed ? 'Directory already exists' : 'Created directory'}: ${dir}` }],
      structuredContent: { dir, created: !existed },
    };
  }));

  server.registerTool('file.copy', {
    title: 'Copy File',
    description: 'Copy a file inside a project.',
    inputSchema: {
      projectPath: z.string(),
      from: z.string(),
      to: z.string(),
      overwrite: z.boolean().default(false),
    },
    outputSchema: {
      from: z.string(),
      to: z.string(),
      changedFiles: z.array(z.object(changedFileOutput)),
      stats: z.object(diffStatsOutput),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('file.copy', async ({ projectPath, from, to, overwrite }) => {
    const root = resolveProject(projectPath);
    const source = resolveInsideProject(root, from);
    const target = resolveInsideProject(root, to);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      return { content: [{ type: 'text' as const, text: `Copy failed: source is not a file: ${from}` }], isError: true };
    }
    if (fs.existsSync(target) && !overwrite) {
      return { content: [{ type: 'text' as const, text: `Copy failed: target exists: ${to}` }], isError: true };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const before = fileDigest(target);
    fs.copyFileSync(source, target);
    auditFileOperation('file.copy', root, [{ path: target, before, after: fileDigest(target) }]);
    return fileMoveResponse(root, from, to, `Copied ${from} to ${to}`);
  }));

  server.registerTool('file.move', {
    title: 'Move File',
    description: 'Move or rename a file or directory inside a project.',
    inputSchema: {
      projectPath: z.string(),
      from: z.string(),
      to: z.string(),
      overwrite: z.boolean().default(false),
    },
    outputSchema: {
      from: z.string(),
      to: z.string(),
      changedFiles: z.array(z.object(changedFileOutput)),
      stats: z.object(diffStatsOutput),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('file.move', async ({ projectPath, from, to, overwrite }) => {
    const root = resolveProject(projectPath);
    const source = resolveInsideProject(root, from);
    const target = resolveInsideProject(root, to);
    if (!fs.existsSync(source)) {
      return { content: [{ type: 'text' as const, text: `Move failed: source does not exist: ${from}` }], isError: true };
    }
    if (fs.existsSync(target) && !overwrite) {
      return { content: [{ type: 'text' as const, text: `Move failed: target exists: ${to}` }], isError: true };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const sourceBefore = fileDigest(source);
    const targetBefore = fileDigest(target);
    if (overwrite && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(source, target);
    auditFileOperation('file.move', root, [
      { path: source, before: sourceBefore, after: fileDigest(source) },
      { path: target, before: targetBefore, after: fileDigest(target) },
    ]);
    return fileMoveResponse(root, from, to, `Moved ${from} to ${to}`);
  }));

  server.registerTool('file.patch', {
    title: 'Patch File',
    description: 'Replace exact text inside a file. Fails unless the old text is found exactly once, unless replaceAll is true.',
    inputSchema: {
      projectPath: z.string(),
      file: z.string(),
      oldText: z.string(),
      newText: z.string(),
      replaceAll: z.boolean().default(false),
    },
    outputSchema: {
      file: z.string(),
      changedFiles: z.array(z.object(changedFileOutput)),
      stats: z.object(diffStatsOutput),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('file.patch', async ({ projectPath, file, oldText, newText, replaceAll }) => {
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, file);
    const current = fs.readFileSync(target, 'utf-8');
    const count = countOccurrences(current, oldText);
    if (count === 0) {
      return { content: [{ type: 'text' as const, text: `Patch failed: oldText not found in ${file}` }], isError: true };
    }
    if (!replaceAll && count > 1) {
      return { content: [{ type: 'text' as const, text: `Patch failed: oldText appears ${count} times in ${file}` }], isError: true };
    }
    const before = fileDigest(target);
    const next = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
    fs.writeFileSync(target, next, 'utf-8');
    auditFileOperation('file.patch', root, [{ path: target, before, after: fileDigest(target) }]);
    return fileChangeResponse(root, file, `Patched ${file}`);
  }));

  server.registerTool('file.delete', {
    title: 'Delete File',
    description: 'Delete a file inside a project.',
    inputSchema: {
      projectPath: z.string(),
      file: z.string(),
      confirm: z.boolean(),
    },
    outputSchema: {
      file: z.string(),
      changedFiles: z.array(z.object(changedFileOutput)),
      stats: z.object(diffStatsOutput),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, withToolLogging('file.delete', async ({ projectPath, file, confirm }) => {
    if (!confirm) {
      return { content: [{ type: 'text' as const, text: 'Delete cancelled: confirm must be true.' }], isError: true };
    }
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, file);
    const before = fileDigest(target);
    fs.unlinkSync(target);
    auditFileOperation('file.delete', root, [{ path: target, before, after: undefined }]);
    return fileChangeResponse(root, file, `Deleted ${file}`);
  }));

  server.registerTool('shell.exec', {
    title: 'Run Shell Command',
    description: 'Run a shell command in the project directory and return stdout/stderr. Use for tests, builds, and local inspection.',
    inputSchema: {
      projectPath: z.string(),
      command: z.string(),
      timeoutMs: z.number().int().min(1000).max(120000).default(30000),
      maxOutputBytes: z.number().int().min(1000).max(1000000).default(MAX_OUTPUT_BYTES),
    },
    outputSchema: {
      command: z.string(),
      exitCode: z.number(),
      stdout: z.string(),
      stderr: z.string(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, withToolLogging('shell.exec', async ({ projectPath, command, timeoutMs, maxOutputBytes }) => {
    const root = resolveProject(projectPath);
    const blocked = validateShellCommand(command);
    if (blocked) {
      return commandResponse(command, 126, '', blocked, maxOutputBytes, true);
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        env: process.env,
      });
      return commandResponse(command, 0, stdout, stderr, maxOutputBytes);
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return commandResponse(command, e.code ?? 1, e.stdout ?? '', e.stderr ?? e.message ?? '', maxOutputBytes, true);
    }
  }));

  server.registerTool('test.detect', {
    title: 'Detect Test Commands',
    description: 'Detect likely project test commands without running them.',
    inputSchema: { projectPath: z.string() },
    outputSchema: {
      commands: z.array(z.object(detectedTestOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('test.detect', async ({ projectPath }) => {
    const root = resolveProject(projectPath);
    const commands = detectTestCommands(root);
    return {
      content: [{ type: 'text' as const, text: commands.length ? commands.map((c) => `${c.name}: ${c.command}`).join('\n') : 'No test command detected.' }],
      structuredContent: { commands },
    };
  }));

  server.registerTool('test.run', {
    title: 'Run Tests',
    description: 'Run a detected or explicit test command in a project directory.',
    inputSchema: {
      projectPath: z.string(),
      command: z.string().optional(),
      timeoutMs: z.number().int().min(1000).max(120000).default(60000),
      maxOutputBytes: z.number().int().min(1000).max(1000000).default(MAX_OUTPUT_BYTES),
    },
    outputSchema: {
      command: z.string(),
      exitCode: z.number(),
      stdout: z.string(),
      stderr: z.string(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, withToolLogging('test.run', async ({ projectPath, command, timeoutMs, maxOutputBytes }) => {
    const root = resolveProject(projectPath);
    const selected = command ?? detectTestCommands(root)[0]?.command;
    if (!selected) {
      return commandResponse('test.run', 1, '', 'No test command detected. Provide command explicitly.', maxOutputBytes, true);
    }
    const blocked = validateShellCommand(selected);
    if (blocked) {
      return commandResponse(selected, 126, '', blocked, maxOutputBytes, true);
    }
    try {
      const { stdout, stderr } = await execAsync(selected, {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        env: process.env,
      });
      return commandResponse(selected, 0, stdout, stderr, maxOutputBytes);
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return commandResponse(selected, e.code ?? 1, e.stdout ?? '', e.stderr ?? e.message ?? '', maxOutputBytes, true);
    }
  }));

  server.registerTool('git.status', {
    title: 'Git Status',
    description: 'Return git branch, HEAD, and porcelain status for a project.',
    inputSchema: { projectPath: z.string() },
    outputSchema: {
      branch: z.string(),
      head: z.string(),
      files: z.array(z.object({
        status: z.string(),
        path: z.string(),
      })),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('git.status', async ({ projectPath }) => {
    const root = resolveProject(projectPath);
    const branch = git(root, ['branch', '--show-current']).trim();
    const head = git(root, ['rev-parse', '--short', 'HEAD']).trim();
    const porcelain = git(root, ['status', '--porcelain=v1']);
    const files = porcelain.trim() ? porcelain.trim().split('\n').map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3),
    })) : [];
    return {
      content: [{ type: 'text' as const, text: `${branch || '(detached)'} ${head}: ${files.length} changed file(s)` }],
      structuredContent: { branch, head, files },
    };
  }));

  server.registerTool('git.diff', {
    title: 'Git Diff',
    description: 'Return git diff summary and structured diff for the current working tree.',
    inputSchema: {
      projectPath: z.string(),
      ref: z.string().optional().describe('Optional git ref to diff against. Defaults to HEAD.'),
    },
    outputSchema: {
      changedFiles: z.array(z.object(changedFileOutput)),
      stats: z.object(diffStatsOutput),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('git.diff', async ({ projectPath, ref }) => {
    const root = resolveProject(projectPath);
    const rawDiff = getRawDiff(root, ref);
    const structured = parseUnifiedDiff(rawDiff);
    const changedFiles = getChangedFiles(root, ref);
    const insertions = changedFiles.reduce((sum, file) => sum + file.insertions, 0);
    const deletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0);
    return {
      content: [{
        type: 'text' as const,
        text: changedFiles.length
          ? `${changedFiles.length} file(s) changed: +${insertions} -${deletions}`
          : 'No changes detected.',
      }],
      structuredContent: { changedFiles, stats: { files: changedFiles.length, insertions, deletions } },
      _meta: { fullDiff: rawDiff, diffJson: structured, projectPath: root },
    };
  }));

  server.registerTool('git.checkpoint', {
    title: 'Git Checkpoint',
    description: 'Return the current HEAD commit. Use this before a risky edit so git.revert can restore the working tree to this commit.',
    inputSchema: { projectPath: z.string() },
    outputSchema: {
      checkpoint: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('git.checkpoint', async ({ projectPath }) => {
    const root = resolveProject(projectPath);
    const checkpoint = git(root, ['rev-parse', 'HEAD']).trim();
    return {
      content: [{ type: 'text' as const, text: `Checkpoint: ${checkpoint}` }],
      structuredContent: { checkpoint },
    };
  }));

  server.registerTool('git.revert', {
    title: 'Git Revert Working Tree',
    description: 'Destructive: restore tracked files to a checkpoint and optionally remove untracked files.',
    inputSchema: {
      projectPath: z.string(),
      checkpoint: z.string(),
      cleanUntracked: z.boolean().default(false),
      confirm: z.boolean(),
    },
    outputSchema: {
      checkpoint: z.string(),
      cleanUntracked: z.boolean(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, withToolLogging('git.revert', async ({ projectPath, checkpoint, cleanUntracked, confirm }) => {
    if (!confirm) {
      return { content: [{ type: 'text' as const, text: 'Revert cancelled: confirm must be true.' }], isError: true };
    }
    const root = resolveProject(projectPath);
    git(root, ['restore', '--source', checkpoint, '--staged', '--worktree', '.']);
    if (cleanUntracked) git(root, ['clean', '-fd']);
    return {
      content: [{ type: 'text' as const, text: `Restored tracked files to ${checkpoint}${cleanUntracked ? ' and removed untracked files' : ''}.` }],
      structuredContent: { checkpoint, cleanUntracked },
    };
  }));

  server.registerTool('project.scripts', {
    title: 'Project Package Scripts',
    description: 'Return scripts from package.json for a Node project.',
    inputSchema: { projectPath: z.string() },
    outputSchema: {
      packageJson: z.string(),
      scripts: z.array(z.object(packageScriptOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('project.scripts', async ({ projectPath }) => {
    const root = resolveProject(projectPath);
    const packageJson = resolveInsideProject(root, 'package.json');
    const scripts = readPackageScripts(packageJson);
    return {
      content: [{ type: 'text' as const, text: scripts.length ? scripts.map((s) => `${s.name}: ${s.command}`).join('\n') : 'No package scripts found.' }],
      structuredContent: { packageJson: 'package.json', scripts },
    };
  }));

  server.registerTool('project.index', {
    title: 'Project Index',
    description: 'Return a higher-level project index: package scripts, key files, detected tests, and top-level structure.',
    inputSchema: { projectPath: z.string() },
    outputSchema: {
      path: z.string(),
      language: z.string().optional(),
      packageManager: z.string().optional(),
      scripts: z.array(z.object(packageScriptOutput)),
      tests: z.array(z.object(detectedTestOutput)),
      keyFiles: z.array(z.string()),
      entries: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('project.index', async ({ projectPath }) => {
    const root = resolveProject(projectPath);
    const snapshot = snapshotProject(root);
    const packageJson = path.join(root, 'package.json');
    const scripts = fs.existsSync(packageJson) ? readPackageScripts(packageJson) : [];
    const index = {
      path: root,
      language: snapshot.language,
      packageManager: snapshot.packageManager,
      scripts,
      tests: detectTestCommands(root),
      keyFiles: detectKeyFiles(root),
      entries: snapshot.entries,
    };
    return {
      content: [{ type: 'text' as const, text: formatProjectIndex(index) }],
      structuredContent: index,
    };
  }));

  server.registerTool('workspace.add', {
    title: 'Add Workspace',
    description: 'Register a local project path with a short workspace name.',
    inputSchema: {
      name: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
      projectPath: z.string(),
      makeDefault: z.boolean().default(false),
    },
    outputSchema: z.object(workspaceOutput).shape,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('workspace.add', async ({ name, projectPath, makeDefault }) => {
    const root = resolveProject(projectPath);
    const workspace = saveWorkspace(name, root, makeDefault);
    return {
      content: [{ type: 'text' as const, text: `Workspace ${name}: ${root}${workspace.isDefault ? ' (default)' : ''}` }],
      structuredContent: workspace,
    };
  }));

  server.registerTool('workspace.list', {
    title: 'List Workspaces',
    description: 'List registered local workspaces.',
    inputSchema: {},
    outputSchema: {
      workspaces: z.array(z.object(workspaceOutput)),
      defaultWorkspace: z.string().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('workspace.list', async () => {
    const workspaces = readWorkspaces();
    const defaultWorkspace = workspaces.find((workspace) => workspace.isDefault)?.name;
    return {
      content: [{ type: 'text' as const, text: workspaces.length ? workspaces.map(formatWorkspace).join('\n') : 'No workspaces registered.' }],
      structuredContent: { workspaces, defaultWorkspace },
    };
  }));

  server.registerTool('workspace.resolve', {
    title: 'Resolve Workspace',
    description: 'Resolve a workspace name to its project path. If name is omitted, resolves the default workspace.',
    inputSchema: { name: z.string().optional() },
    outputSchema: z.object(workspaceOutput).shape,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('workspace.resolve', async ({ name }) => {
    const workspace = resolveWorkspaceRecord(name);
    return {
      content: [{ type: 'text' as const, text: `${workspace.name}: ${workspace.path}` }],
      structuredContent: workspace,
    };
  }));

  server.registerTool('task.start', {
    title: 'Start Task',
    description: 'Start a lightweight persisted task/session record for multi-step work.',
    inputSchema: {
      title: z.string(),
      workspace: z.string().optional(),
      projectPath: z.string().optional(),
    },
    outputSchema: z.object(taskOutput).shape,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('task.start', async ({ title, workspace, projectPath }) => {
    const task = startTask(title, workspace, projectPath);
    return {
      content: [{ type: 'text' as const, text: `Task ${task.id}: ${task.title}` }],
      structuredContent: task,
    };
  }));

  server.registerTool('task.note', {
    title: 'Add Task Note',
    description: 'Append a note to a persisted task/session.',
    inputSchema: {
      taskId: z.string(),
      note: z.string(),
    },
    outputSchema: z.object(taskOutput).shape,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('task.note', async ({ taskId, note }) => {
    const task = updateTask(taskId, { note });
    return {
      content: [{ type: 'text' as const, text: `Added note to ${task.id}` }],
      structuredContent: task,
    };
  }));

  server.registerTool('task.status', {
    title: 'Task Status',
    description: 'Read one task or list recent task/session records.',
    inputSchema: {
      taskId: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      tasks: z.array(z.object(taskOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('task.status', async ({ taskId, limit }) => {
    const tasks = taskId ? [getTask(taskId)] : readTasks().slice(-limit).reverse();
    return {
      content: [{ type: 'text' as const, text: tasks.length ? tasks.map(formatTask).join('\n') : 'No tasks found.' }],
      structuredContent: { tasks },
    };
  }));

  server.registerTool('task.finish', {
    title: 'Finish Task',
    description: 'Mark a persisted task/session as done or blocked.',
    inputSchema: {
      taskId: z.string(),
      status: z.enum(['done', 'blocked']).default('done'),
      note: z.string().optional(),
    },
    outputSchema: z.object(taskOutput).shape,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('task.finish', async ({ taskId, status, note }) => {
    const task = updateTask(taskId, { status, note });
    return {
      content: [{ type: 'text' as const, text: `Task ${task.id} marked ${task.status}` }],
      structuredContent: task,
    };
  }));

  server.registerTool('process.start', {
    title: 'Start Project Process',
    description: 'Start a long-running project process and persist its pid/log path.',
    inputSchema: {
      projectPath: z.string(),
      command: z.string(),
      workspace: z.string().optional(),
    },
    outputSchema: z.object(processOutput).shape,
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, withToolLogging('process.start', async ({ projectPath, command, workspace }) => {
    const root = resolveProject(projectPath);
    const blocked = validateShellCommand(command);
    if (blocked) throw new Error(blocked);
    const record = startManagedProcess(root, command, workspace);
    return {
      content: [{ type: 'text' as const, text: `Started ${record.id} pid=${record.pid} log=${record.logFile}` }],
      structuredContent: record,
    };
  }));

  server.registerTool('process.list', {
    title: 'List Project Processes',
    description: 'List processes started by this bridge runtime.',
    inputSchema: {
      workspace: z.string().optional(),
    },
    outputSchema: {
      processes: z.array(z.object(processOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('process.list', async ({ workspace }) => {
    const processes = refreshProcesses().filter((process) => !workspace || process.workspace === workspace);
    return {
      content: [{ type: 'text' as const, text: processes.length ? processes.map(formatProcess).join('\n') : 'No managed processes.' }],
      structuredContent: { processes },
    };
  }));

  server.registerTool('process.stop', {
    title: 'Stop Project Process',
    description: 'Stop a process previously started by process.start. Requires confirm=true.',
    inputSchema: {
      processId: z.string(),
      confirm: z.boolean(),
    },
    outputSchema: z.object(processOutput).shape,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, withToolLogging('process.stop', async ({ processId, confirm }) => {
    if (!confirm) throw new Error('Stop cancelled: confirm must be true.');
    const record = stopManagedProcess(processId);
    return {
      content: [{ type: 'text' as const, text: `Stopped ${record.id} pid=${record.pid}` }],
      structuredContent: record,
    };
  }));

  server.registerTool('port.check', {
    title: 'Check Port',
    description: 'Check whether a local TCP port is listening and identify the owning process when possible.',
    inputSchema: {
      port: z.number().int().min(1).max(65535),
      host: z.string().default('127.0.0.1'),
    },
    outputSchema: {
      host: z.string(),
      port: z.number(),
      listening: z.boolean(),
      output: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('port.check', async ({ port, host }) => {
    const output = checkPort(port);
    const listening = output.trim().length > 0;
    return {
      content: [{ type: 'text' as const, text: listening ? output : `${host}:${port} is not listening` }],
      structuredContent: { host, port, listening, output },
    };
  }));

  server.registerTool('bridge.status', {
    title: 'Bridge Status',
    description: 'Return local bridge and tunnel launchd service status.',
    inputSchema: {},
    outputSchema: {
      services: z.array(z.object(serviceStatusOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('bridge.status', async () => {
    const services = BRIDGE_SERVICE_LABELS.map(readLaunchdStatus);
    return {
      content: [{ type: 'text' as const, text: services.map(formatServiceStatus).join('\n') }],
      structuredContent: { services },
    };
  }));

  server.registerTool('bridge.health', {
    title: 'Bridge Health',
    description: 'Check local and optional public bridge health endpoints.',
    inputSchema: {
      includePublic: z.boolean().default(true),
      publicBaseUrl: z.string().url().default('https://example.ngrok-free.app'),
      timeoutMs: z.number().int().min(500).max(10000).default(5000),
    },
    outputSchema: {
      checks: z.array(z.object(healthCheckOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, withToolLogging('bridge.health', async ({ includePublic, publicBaseUrl, timeoutMs }) => {
    const checks = [await checkHealth('local', 'http://127.0.0.1:3838/health', timeoutMs)];
    if (includePublic) checks.push(await checkHealth('public', `${publicBaseUrl.replace(/\/$/, '')}/health`, timeoutMs));
    return {
      content: [{ type: 'text' as const, text: checks.map((check) => `${check.name}: ${check.ok ? 'ok' : 'failed'} ${check.status ?? ''} ${check.error ?? ''}`.trim()).join('\n') }],
      structuredContent: { checks },
    };
  }));

  server.registerTool('bridge.logs', {
    title: 'Bridge Logs',
    description: 'Read recent bridge and tunnel log lines from the configured log directory.',
    inputSchema: {
      files: z.array(z.enum(BRIDGE_LOG_FILES)).default(['bridge.err.log', 'ngrok.log']),
      lines: z.number().int().min(1).max(500).default(100),
    },
    outputSchema: {
      logDir: z.string(),
      files: z.array(z.object(logFileOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('bridge.logs', async ({ files, lines }) => {
    const results = files.map((file) => readBridgeLog(config.logDir, file, lines));
    return {
      content: [{
        type: 'text' as const,
        text: results.map((result) => result.error
          ? `--- ${result.file} ---\n${result.error}`
          : `--- ${result.file}${result.truncated ? ' (truncated)' : ''} ---\n${result.lines.join('\n')}`
        ).join('\n\n'),
      }],
      structuredContent: { logDir: config.logDir, files: results },
    };
  }));

  server.registerTool('bridge.activity', {
    title: 'Bridge Activity',
    description: 'Read recent local bridge tool-call records and audit events. Use this to inspect what ChatGPT actually asked the MCP server to do.',
    inputSchema: {
      limit: z.number().int().min(1).max(500).default(100),
      includeAudit: z.boolean().default(true),
    },
    outputSchema: {
      toolCalls: z.array(z.object(toolCallOutput)),
      auditEvents: z.array(z.object(auditEventOutput).passthrough()),
      dataDir: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('bridge.activity', async ({ limit, includeAudit }) => {
    const calls = readToolCalls(config, limit);
    const auditEvents = includeAudit ? readAuditEvents(config, limit) : [];
    return {
      content: [{
        type: 'text' as const,
        text: calls.length
          ? calls.map((call) => `${call.ts} ${call.status.padEnd(7)} ${call.tool} ${call.durationMs ?? ''}`).join('\n')
          : 'No tool calls recorded yet.',
      }],
      structuredContent: { toolCalls: calls, auditEvents, dataDir: config.dataDir },
    };
  }));

  server.registerTool('service.restart', {
    title: 'Restart Bridge Service',
    description: 'Restart one fixed launchd service: bridge or ngrok. Requires confirm=true.',
    inputSchema: {
      service: z.enum(SERVICE_RESTART_LABELS),
      confirm: z.boolean(),
    },
    outputSchema: {
      service: z.string(),
      label: z.string(),
      exitCode: z.number(),
      stdout: z.string(),
      stderr: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, withToolLogging('service.restart', async ({ service, confirm }) => {
    if (!confirm) {
      return { content: [{ type: 'text' as const, text: 'Restart cancelled: confirm must be true.' }], isError: true };
    }
    const label = serviceLabel(service);
    const plist = path.join(process.env.HOME ?? os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
    const command = `launchctl kickstart -k gui/$(id -u)/${label}`;
    try {
      const stdout = execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid?.() ?? 501}/${label}`], {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      });
      auditEvent('service.restart', { service, label, plist, exitCode: 0 });
      return {
        content: [{ type: 'text' as const, text: `Restarted ${label}` }],
        structuredContent: { service, label, exitCode: 0, stdout, stderr: '' },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      auditEvent('service.restart', { service, label, plist, exitCode: 1, error: message });
      return {
        content: [{ type: 'text' as const, text: `$ ${command}\nexit 1\nstderr:\n${message}` }],
        structuredContent: { service, label, exitCode: 1, stdout: '', stderr: message },
        isError: true,
      };
    }
  }));

  return server;
}

export async function startStdioServer(config: BridgeConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function withToolLogging<TArgs>(
  name: string,
  handler: (args: TArgs) => Promise<any>,
): (args: TArgs) => Promise<any> {
  return async (args: TArgs) => {
    const startedAt = Date.now();
    const callId = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const config = activeConfig;
    if (config) {
      appendToolCall(config, {
        id: callId,
        ts: new Date(startedAt).toISOString(),
        tool: name,
        status: 'started',
        args: sanitizeForLog(args) as Record<string, unknown>,
      });
    }
    console.error(`[mcp] tool.start ${name} ${summarizeArgs(args)}`);
    try {
      const result = await handler(args);
      if (config) {
        appendToolCall(config, {
          id: callId,
          ts: new Date().toISOString(),
          tool: name,
          status: 'ok',
          durationMs: Date.now() - startedAt,
          args: sanitizeForLog(args) as Record<string, unknown>,
          result: summarizeToolResult(result),
        });
      }
      console.error(`[mcp] tool.done ${name} durationMs=${Date.now() - startedAt}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (config) {
        appendToolCall(config, {
          id: callId,
          ts: new Date().toISOString(),
          tool: name,
          status: 'error',
          durationMs: Date.now() - startedAt,
          args: sanitizeForLog(args) as Record<string, unknown>,
          error: message,
        });
      }
      console.error(`[mcp] tool.error ${name} durationMs=${Date.now() - startedAt} error=${JSON.stringify(message)}`);
      throw err;
    }
  };
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const source = args as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['path', 'projectPath', 'file', 'files', 'query', 'glob', 'command', 'ref', 'checkpoint']) {
    if (!(key in source)) continue;
    const value = source[key];
    if (key === 'command' && typeof value === 'string') {
      summary[key] = value.length > 120 ? `${value.slice(0, 120)}...` : value;
    } else if (Array.isArray(value)) {
      summary[key] = value.slice(0, 10);
    } else {
      summary[key] = value;
    }
  }
  return JSON.stringify(summary);
}

function resolveProject(projectPath: string): string {
  const root = path.resolve(projectPath);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error(`Project path is not a directory: ${projectPath}`);
  assertAllowedProjectRoot(root);
  return root;
}

function resolveInsideProject(root: string, relPath: string): string {
  if (path.isAbsolute(relPath)) throw new Error(`File path must be relative: ${relPath}`);
  const fullPath = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (fullPath !== root && !fullPath.startsWith(rootWithSep)) {
    throw new Error(`Path outside project directory: ${relPath}`);
  }
  assertNotDeniedPath(root, fullPath);
  return fullPath;
}

function assertAllowedProjectRoot(root: string) {
  const policy = activeConfig?.policy;
  if (!policy?.allowedProjectRoots.length) return;
  const allowed = policy.allowedProjectRoots.map((entry) => path.resolve(expandHome(entry)));
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const ok = allowed.some((entry) => {
    const allowedRoot = entry.endsWith(path.sep) ? entry : `${entry}${path.sep}`;
    return root === entry || rootWithSep.startsWith(allowedRoot);
  });
  if (!ok) throw new Error(`Project path is outside allowed roots: ${root}`);
}

function assertNotDeniedPath(root: string, fullPath: string) {
  const rel = path.relative(root, fullPath) || '.';
  const normalized = rel.split(path.sep).join('/');
  for (const pattern of activeConfig?.policy.denyGlobs ?? []) {
    if (matchesDenyGlob(normalized, pattern)) throw new Error(`Path is denied by policy: ${rel}`);
  }
}

function matchesDenyGlob(filePath: string, glob: string): boolean {
  const normalized = glob.split(path.sep).join('/');
  if (normalized.startsWith('**/')) {
    const suffix = normalized.slice(3);
    if (suffix.endsWith('/**')) {
      const dir = suffix.slice(0, -3);
      return filePath === dir || filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`);
    }
    return filePath === suffix || filePath.endsWith(`/${suffix}`);
  }
  if (normalized.includes('*')) {
    const regex = new RegExp(`^${normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`);
    return regex.test(filePath);
  }
  return filePath === normalized;
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/')
    ? path.join(process.env.HOME ?? '', value.slice(2))
    : value;
}

function readProjectFile(root: string, relPath: string, maxLines: number) {
  try {
    const fullPath = resolveInsideProject(root, relPath);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return { path: relPath, error: 'Not a file' };
    if (stat.size > MAX_FILE_BYTES) return { path: relPath, error: `File too large (${stat.size} bytes)` };
    if (isBinaryFile(fullPath)) return { path: relPath, error: 'Binary file', sizeBytes: stat.size };
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const truncated = lines.length > maxLines;
    return {
      path: relPath,
      lines: lines.length,
      truncated,
      content: truncated ? `${lines.slice(0, maxLines).join('\n')}\n... (truncated)` : content,
    };
  } catch (err) {
    return { path: relPath, error: err instanceof Error ? err.message : String(err) };
  }
}

function readProjectFileRange(root: string, relPath: string, startLine: number, endLine: number) {
  if (endLine < startLine) throw new Error('endLine must be greater than or equal to startLine');
  if (endLine - startLine > 1000) throw new Error('Line range is too large; maximum is 1000 lines');
  const fullPath = resolveInsideProject(root, relPath);
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${relPath}`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`File too large (${stat.size} bytes)`);
  if (isBinaryFile(fullPath)) throw new Error(`Binary file: ${relPath}`);
  const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
  const selected = lines.slice(startLine - 1, endLine);
  return {
    file: relPath,
    startLine,
    endLine: Math.min(endLine, lines.length),
    totalLines: lines.length,
    content: selected.map((line, index) => `${startLine + index}: ${line}`).join('\n'),
  };
}

function fileChangeResponse(root: string, file: string, message: string) {
  const changedFiles = getChangedFiles(root);
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: {
      file,
      changedFiles,
      stats: {
        files: changedFiles.length,
        insertions: changedFiles.reduce((sum, f) => sum + f.insertions, 0),
        deletions: changedFiles.reduce((sum, f) => sum + f.deletions, 0),
      },
    },
  };
}

function fileMoveResponse(root: string, from: string, to: string, message: string) {
  const changedFiles = getChangedFiles(root);
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: {
      from,
      to,
      changedFiles,
      stats: {
        files: changedFiles.length,
        insertions: changedFiles.reduce((sum, f) => sum + f.insertions, 0),
        deletions: changedFiles.reduce((sum, f) => sum + f.deletions, 0),
      },
    },
  };
}

function commandResponse(command: string, exitCode: number, stdout: string, stderr: string, maxOutputBytes: number, isError = false) {
  const out = truncate(stdout, maxOutputBytes);
  const err = truncate(stderr, maxOutputBytes);
  return {
    content: [{
      type: 'text' as const,
      text: `$ ${command}\nexit ${exitCode}\n${out}${err ? `\nstderr:\n${err}` : ''}`.trim(),
    }],
    structuredContent: { command, exitCode, stdout: out, stderr: err },
    isError,
  };
}

function validateShellCommand(command: string): string | undefined {
  const shell = activeConfig?.policy.shell;
  if (shell && !shell.enabled) return 'Shell execution is disabled by policy.';
  for (const pattern of shell?.denyPatterns ?? []) {
    if (new RegExp(pattern, 'i').test(command)) return `Shell command denied by policy pattern: ${pattern}`;
  }
  return undefined;
}

function searchResponse(query: string, matches: Array<{ file: string; line: number; text: string }>) {
  const files = [...new Set(matches.map((match) => match.file))];
  return {
    content: [{
      type: 'text' as const,
      text: matches.length
        ? `Found ${matches.length} match(es) in ${files.length} file(s):\n${matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n')}`
        : `No matches for "${query}"`,
    }],
    structuredContent: { query, count: matches.length, files, matches },
  };
}

function parseSearchOutput(output: string): Array<{ file: string; line: number; text: string }> {
  if (!output) return [];
  return output.split('\n').map((line) => {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    return match
      ? { file: match[1], line: Number.parseInt(match[2], 10), text: match[3].trim() }
      : { file: 'unknown', line: 0, text: line };
  });
}

function statProjectPath(root: string, target: string, includeHash: boolean) {
  const stat = fs.statSync(target);
  const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
  const result: { path: string; type: 'file' | 'directory' | 'other'; size: number; modifiedAt: string; sha256?: string } = {
    path: path.relative(root, target) || '.',
    type,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
  if (includeHash && stat.isFile()) {
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File too large to hash (${stat.size} bytes)`);
    result.sha256 = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  }
  return result;
}

async function downloadToLocalFile(url: string, target: string, maxBytes: number) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('cloud.download only accepts HTTPS URLs, except localhost for testing.');
  }

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'ChatGPT2LocalBridge/0.1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('Download failed: response body is empty.');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`Download too large: ${contentLength} bytes exceeds maxBytes=${maxBytes}`);
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new Error(`Download too large: exceeded maxBytes=${maxBytes}`);
    }
    chunks.push(buffer);
  }

  const data = Buffer.concat(chunks);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return {
    bytes,
    sha256: createHash('sha256').update(data).digest('hex'),
    contentType: response.headers.get('content-type') ?? undefined,
    sourceUrlHost: parsed.host,
  };
}

function listDirectory(root: string, target: string, recursive: boolean, maxEntries: number) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${path.relative(root, target) || '.'}`);

  const items: Array<{ path: string; type: 'file' | 'directory' | 'other'; size: number; modifiedAt: string }> = [];
  let truncated = false;

  function walk(dir: string) {
    if (truncated) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (items.length >= maxEntries) {
        truncated = true;
        return;
      }
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath) || '.';
      const entryStat = fs.statSync(fullPath);
      const type = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other';
      items.push({
        path: relPath,
        type,
        size: entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      });
      if (recursive && entry.isDirectory() && !SKIP_DIRS.has(entry.name)) walk(fullPath);
    }
  }

  walk(target);
  return { items, truncated };
}

function readPackageScripts(packageJsonPath: string) {
  const raw = fs.readFileSync(packageJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  return Object.entries(parsed.scripts ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, command]) => ({ name, command }));
}

function detectKeyFiles(root: string): string[] {
  const candidates = [
    'package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
    'next.config.js', 'next.config.mjs', 'nuxt.config.ts',
    'src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/index.tsx',
    'src/App.tsx', 'src/App.vue', 'README.md',
    'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml',
  ];
  return candidates.filter((file) => fs.existsSync(path.join(root, file)));
}

function formatProjectIndex(index: {
  path: string;
  language?: string;
  packageManager?: string;
  scripts: Array<{ name: string; command: string }>;
  tests: Array<{ name: string; command: string; confidence: 'high' | 'medium' | 'low' }>;
  keyFiles: string[];
  entries: string[];
}) {
  return [
    `Project: ${index.path}`,
    `Language: ${index.language ?? 'unknown'}`,
    `Package manager: ${index.packageManager ?? 'unknown'}`,
    `Scripts: ${index.scripts.map((script) => script.name).join(', ') || 'none'}`,
    `Tests: ${index.tests.map((test) => test.command).join(', ') || 'none'}`,
    `Key files: ${index.keyFiles.join(', ') || 'none'}`,
  ].join('\n');
}

function detectTestCommands(root: string) {
  const commands: Array<{ name: string; command: string; confidence: 'high' | 'medium' | 'low' }> = [];
  const packageJson = path.join(root, 'package.json');
  if (fs.existsSync(packageJson)) {
    const scripts = readPackageScripts(packageJson);
    for (const script of scripts) {
      if (script.name === 'test') commands.push({ name: 'npm test', command: 'npm test', confidence: 'high' });
      else if (/test|spec|vitest|jest|playwright/i.test(script.name)) {
        commands.push({ name: `npm run ${script.name}`, command: `npm run ${script.name}`, confidence: 'medium' });
      }
    }
  }
  if (fs.existsSync(path.join(root, 'pyproject.toml'))) commands.push({ name: 'pytest', command: 'pytest', confidence: 'medium' });
  if (fs.existsSync(path.join(root, 'go.mod'))) commands.push({ name: 'go test', command: 'go test ./...', confidence: 'high' });
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) commands.push({ name: 'cargo test', command: 'cargo test', confidence: 'high' });
  return commands;
}

function runtimeFile(name: string): string {
  const config = activeConfig;
  if (!config) throw new Error('Bridge config is not initialized');
  fs.mkdirSync(config.dataDir, { recursive: true });
  return path.join(config.dataDir, name);
}

function readJsonFile<T>(name: string, fallback: T): T {
  const file = runtimeFile(name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function writeJsonFile<T>(name: string, value: T) {
  fs.writeFileSync(runtimeFile(name), `${JSON.stringify(value, null, 2)}\n`);
}

function readWorkspaces(): WorkspaceRecord[] {
  return readJsonFile<WorkspaceRecord[]>('workspaces.json', []);
}

function writeWorkspaces(workspaces: WorkspaceRecord[]) {
  writeJsonFile('workspaces.json', workspaces);
}

function saveWorkspace(name: string, projectPath: string, makeDefault: boolean): WorkspaceRecord {
  const now = new Date().toISOString();
  const workspaces = readWorkspaces().filter((workspace) => workspace.name !== name);
  const existing = readWorkspaces().find((workspace) => workspace.name === name);
  const workspace: WorkspaceRecord = {
    name,
    path: projectPath,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    isDefault: makeDefault || existing?.isDefault || workspaces.length === 0,
  };
  if (workspace.isDefault) {
    for (const item of workspaces) delete item.isDefault;
  }
  workspaces.push(workspace);
  writeWorkspaces(workspaces.sort((a, b) => a.name.localeCompare(b.name)));
  auditEvent('workspace.add', { name, projectPath, makeDefault: workspace.isDefault });
  return workspace;
}

function resolveWorkspaceRecord(name?: string): WorkspaceRecord {
  const workspaces = readWorkspaces();
  const workspace = name
    ? workspaces.find((item) => item.name === name)
    : workspaces.find((item) => item.isDefault);
  if (!workspace) throw new Error(name ? `Workspace not found: ${name}` : 'No default workspace registered.');
  return workspace;
}

function formatWorkspace(workspace: WorkspaceRecord) {
  return `${workspace.name}: ${workspace.path}${workspace.isDefault ? ' (default)' : ''}`;
}

function readTasks(): TaskRecord[] {
  return readJsonFile<TaskRecord[]>('tasks.json', []);
}

function writeTasks(tasks: TaskRecord[]) {
  writeJsonFile('tasks.json', tasks);
}

function startTask(title: string, workspace?: string, projectPath?: string): TaskRecord {
  const now = new Date().toISOString();
  const resolvedPath = projectPath ? resolveProject(projectPath) : workspace ? resolveWorkspaceRecord(workspace).path : undefined;
  const task: TaskRecord = {
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    workspace,
    projectPath: resolvedPath,
    status: 'active',
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  auditEvent('task.start', { id: task.id, title, workspace, projectPath: resolvedPath });
  return task;
}

function getTask(taskId: string): TaskRecord {
  const task = readTasks().find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function updateTask(taskId: string, patch: { status?: 'done' | 'blocked'; note?: string }): TaskRecord {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) throw new Error(`Task not found: ${taskId}`);
  const now = new Date().toISOString();
  const task = tasks[index];
  if (patch.status) task.status = patch.status;
  if (patch.note) task.notes.push({ ts: now, text: patch.note });
  task.updatedAt = now;
  tasks[index] = task;
  writeTasks(tasks);
  auditEvent('task.update', { id: task.id, status: task.status, note: patch.note });
  return task;
}

function formatTask(task: TaskRecord) {
  return `${task.id} [${task.status}] ${task.title}${task.workspace ? ` workspace=${task.workspace}` : ''}`;
}

function readProcesses(): ProcessRecord[] {
  return readJsonFile<ProcessRecord[]>('processes.json', []);
}

function writeProcesses(processes: ProcessRecord[]) {
  writeJsonFile('processes.json', processes);
}

function startManagedProcess(projectPath: string, command: string, workspace?: string): ProcessRecord {
  const config = activeConfig;
  if (!config) throw new Error('Bridge config is not initialized');
  const now = new Date().toISOString();
  const id = `proc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const logDir = path.join(config.dataDir, 'process-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${id}.log`);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(command, {
    cwd: projectPath,
    shell: true,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  const record: ProcessRecord = {
    id,
    workspace,
    projectPath,
    command,
    pid: child.pid ?? 0,
    logFile,
    status: 'running',
    startedAt: now,
    updatedAt: now,
  };
  const processes = readProcesses();
  processes.push(record);
  writeProcesses(processes);
  auditEvent('process.start', { id, projectPath, command, pid: record.pid, logFile });
  return record;
}

function refreshProcesses(): ProcessRecord[] {
  const processes = readProcesses().map((record) => ({
    ...record,
    status: isPidRunning(record.pid) ? 'running' as const : 'exited' as const,
    updatedAt: new Date().toISOString(),
  }));
  writeProcesses(processes);
  return processes;
}

function stopManagedProcess(processId: string): ProcessRecord {
  const processes = refreshProcesses();
  const index = processes.findIndex((process) => process.id === processId);
  if (index === -1) throw new Error(`Managed process not found: ${processId}`);
  const record = processes[index];
  if (record.status === 'running') {
    try {
      process.kill(-record.pid, 'SIGTERM');
    } catch {
      try { process.kill(record.pid, 'SIGTERM'); } catch {}
    }
  }
  record.status = 'exited';
  record.updatedAt = new Date().toISOString();
  processes[index] = record;
  writeProcesses(processes);
  auditEvent('process.stop', { id: record.id, pid: record.pid, command: record.command });
  return record;
}

function isPidRunning(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatProcess(record: ProcessRecord) {
  return `${record.id} [${record.status}] pid=${record.pid} ${record.command} log=${record.logFile}`;
}

function checkPort(port: number): string {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return '';
  }
}

async function checkHealth(name: string, url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = truncate(await response.text(), 1000);
    return { name, url, ok: response.ok, status: response.status, body };
  } catch (err) {
    return { name, url, ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

function serviceLabel(service: typeof SERVICE_RESTART_LABELS[number]) {
  return service === 'bridge'
    ? 'com.chatgpt2localbridge.bridge'
    : 'com.chatgpt2localbridge.ngrok';
}

function fileDigest(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return stat.isDirectory() ? 'directory' : 'other';
  if (stat.size > MAX_FILE_BYTES) return `large:${stat.size}`;
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function auditFileOperation(action: string, root: string, files: Array<{ path: string; before?: string; after?: string }>) {
  auditEvent(action, {
    projectPath: root,
    files: files.map((file) => ({
      path: path.relative(root, file.path) || '.',
      before: file.before,
      after: file.after,
    })),
  });
}

function auditEvent(action: string, data: Record<string, unknown>) {
  const config = activeConfig;
  if (!config) return;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      action,
      ...data,
    };
    fs.appendFileSync(path.join(config.dataDir, 'audit.jsonl'), `${JSON.stringify(record)}\n`);
  } catch (err) {
    console.error('[audit] write failed:', err instanceof Error ? err.message : String(err));
  }
}

function readLaunchdStatus(label: string) {
  try {
    const output = execFileSync('launchctl', ['print', `gui/${process.getuid?.() ?? 501}/${label}`], {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    return {
      label,
      state: matchLaunchctlValue(output, 'state') ?? 'unknown',
      pid: parseOptionalNumber(matchLaunchctlValue(output, 'pid')),
      lastExitCode: matchLaunchctlValue(output, 'last exit code'),
    };
  } catch (err) {
    return {
      label,
      state: 'unavailable',
      lastExitCode: err instanceof Error ? err.message : String(err),
    };
  }
}

function matchLaunchctlValue(output: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = output.match(new RegExp(`\\b${escaped} = ([^\\n]+)`));
  return match?.[1]?.trim();
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatServiceStatus(service: { label: string; state: string; pid?: number; lastExitCode?: string }) {
  return `${service.label}: ${service.state}${service.pid ? ` pid=${service.pid}` : ''}${service.lastExitCode ? ` lastExit=${service.lastExitCode}` : ''}`;
}

function readBridgeLog(logDir: string, file: typeof BRIDGE_LOG_FILES[number], lines: number) {
  const target = path.join(logDir, file);
  try {
    const content = fs.readFileSync(target, 'utf-8');
    const allLines = content.split('\n');
    const selected = allLines.slice(Math.max(0, allLines.length - lines));
    return {
      file,
      lines: selected,
      truncated: allLines.length > lines,
    };
  } catch (err) {
    return {
      file,
      lines: [],
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
}

function countOccurrences(value: string, search: string): number {
  if (!search) return 0;
  return value.split(search).length - 1;
}

function truncate(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString('utf-8')}\n... (truncated)`;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode',
  'target', 'bin', 'obj', '.gradle', 'coverage', '.nuxt',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.php', '.scala', '.clj', '.ex', '.exs', '.dart', '.lua',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.env', '.cfg',
  '.md', '.txt', '.rst', '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.graphql', '.gql', '.proto', '.thrift',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.svg',
]);

interface FileTreeEntry {
  path: string;
  size: number;
  lines: number;
}

function buildFileTree(projectPath: string, maxDepth: number): { files: FileTreeEntry[]; totalFiles: number; totalLines: number } {
  const files: FileTreeEntry[] = [];
  let totalFiles = 0;
  let totalLines = 0;

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(projectPath, fullPath);

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        totalFiles++;
        if (!isTextLike(relPath)) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_BYTES) continue;
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lineCount = content.split('\n').length;
          totalLines += lineCount;
          files.push({ path: relPath, size: stat.size, lines: lineCount });
        } catch {
          // Ignore unreadable files.
        }
      }
    }
  }

  walk(projectPath, 0);
  files.sort((a, b) => b.lines - a.lines);
  return { files, totalFiles, totalLines };
}

function isTextLike(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || [
    'package.json', 'tsconfig.json', 'cargo.toml', 'go.mod', 'pyproject.toml',
    'setup.py', 'requirements.txt', 'gemfile', 'makefile', 'dockerfile',
    '.gitignore', '.env', 'readme.md', 'readme.txt',
  ].includes(name);
}

function isBinaryFile(filePath: string): boolean {
  if (isTextLike(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(512);
    fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    return buf.includes(0);
  } catch {
    return true;
  }
}
