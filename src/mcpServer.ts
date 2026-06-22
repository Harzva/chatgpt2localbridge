import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import type { BridgeConfig, BridgePolicy } from './config.js';
import { snapshotProject } from './project.js';
import { getRawDiff, getChangedFiles, parseUnifiedDiff } from './diffEngine.js';
import {
  appendToolCall,
  readAuditEvents,
  readToolCalls,
  sanitizeForLog,
  summarizeToolResult,
} from './activity.js';
import { getRequestContext, type SafeRequestContext } from './requestContext.js';

const execAsync = promisify(exec);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 200_000;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const BRIDGE_VERSION = '0.1.1';
const TRACE_SESSION_FILE = 'trace-session.json';
const SKILL_ACTIVATION_FILE = 'skill-activations.json';
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
let activeTraceTaskIdCache: string | undefined;

interface TraceSessionRecord {
  id: string;
  title: string;
  projectPath?: string;
  connectorProfile?: string;
  taskId?: string;
  status: 'active' | 'ended';
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
}

const taskStatuses = ['active', 'running', 'success', 'failed', 'cancelled', 'done', 'blocked'] as const;
type TaskStatus = typeof taskStatuses[number];
const handoffRiskLevels = ['low', 'medium', 'high'] as const;
type HandoffRiskLevel = typeof handoffRiskLevels[number];
const handoffAllowedOperations = [
  'read',
  'write',
  'run_tests',
  'inspect_git',
  'create_artifact',
  'use_skill_context',
] as const;
type HandoffAllowedOperation = typeof handoffAllowedOperations[number];

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
  status: TaskStatus;
  notes: Array<{ ts: string; text: string }>;
  createdAt: string;
  updatedAt: string;
  mode?: 'normal' | 'debug';
  timeoutMs?: number;
  command?: string;
  pid?: number;
  logFile?: string;
  resultFile?: string;
  handoffId?: string;
  handoffFile?: string;
  handoff?: HandoffPackage;
  exitCode?: number;
  signal?: string;
  startedAt?: string;
  completedAt?: string;
  changedFiles?: Array<{ path: string; oldPath?: string; status: string; insertions: number; deletions: number }>;
  diffPreview?: string;
  testResult?: string;
}

interface HandoffPackage {
  version: '1';
  id: string;
  title: string;
  objective: string;
  projectPath: string;
  workspace?: string;
  constraints: string[];
  allowedOperations: HandoffAllowedOperation[];
  testCommands: string[];
  expectedArtifacts: string[];
  riskLevel: HandoffRiskLevel;
  acceptanceCriteria: string[];
  skillContext: string[];
  skillActivations?: HandoffSkillActivation[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface HandoffSkillActivation {
  id: string;
  name: string;
  root: string;
  skillFile: string;
  activated: boolean;
  reason: string;
}

interface HandoffCreateInput {
  title: string;
  objective: string;
  workspace?: string;
  projectPath?: string;
  constraints: string[];
  allowedOperations: HandoffAllowedOperation[];
  testCommands?: string[];
  expectedArtifacts?: string[];
  riskLevel?: HandoffRiskLevel;
  acceptanceCriteria?: string[];
  skillContext?: string[];
  skillTask?: string;
  skillRoot?: string;
  maxSkillContext?: number;
  notes?: string | string[];
}

interface ActivatedSkillRecord {
  id: string;
  root: string;
  directory: string;
  skillFile: string;
  activationId: string;
  activatedAt: string;
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

const codexProviderOutput = {
  kind: z.enum(['official', 'openai-compatible', 'sub2api']),
  profile: z.string().optional(),
  codexHome: z.string().optional(),
  model: z.string().optional(),
  baseUrlHost: z.string().optional(),
  codexBin: z.string().optional(),
  apiKeyEnv: z.string(),
  apiKeyConfigured: z.boolean(),
};

const requestContextOutput = {
  source: z.string(),
  transportSessionId: z.string().optional(),
  requestId: z.string().optional(),
  requestIdHash: z.string().optional(),
  userAgent: z.string().optional(),
  connectorProfile: z.string().optional(),
  conversationId: z.string().optional(),
  conversationIdHash: z.string().optional(),
};

const traceSessionOutput = {
  id: z.string(),
  title: z.string(),
  projectPath: z.string().optional(),
  connectorProfile: z.string().optional(),
  taskId: z.string().optional(),
  status: z.enum(['active', 'ended']),
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().optional(),
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

const handoffOutput = {
  version: z.literal('1'),
  id: z.string(),
  title: z.string(),
  objective: z.string(),
  projectPath: z.string(),
  workspace: z.string().optional(),
  constraints: z.array(z.string()),
  allowedOperations: z.array(z.enum(handoffAllowedOperations)),
  testCommands: z.array(z.string()),
  expectedArtifacts: z.array(z.string()),
  riskLevel: z.enum(handoffRiskLevels),
  acceptanceCriteria: z.array(z.string()),
  skillContext: z.array(z.string()),
  skillActivations: z.array(z.object({
    id: z.string(),
    name: z.string(),
    root: z.string(),
    skillFile: z.string(),
    activated: z.boolean(),
    reason: z.string(),
  })).optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const taskOutput = {
  id: z.string(),
  title: z.string(),
  workspace: z.string().optional(),
  projectPath: z.string().optional(),
  status: z.enum(taskStatuses),
  notes: z.array(z.object({ ts: z.string(), text: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
  mode: z.enum(['normal', 'debug']).optional(),
  timeoutMs: z.number().optional(),
  command: z.string().optional(),
  pid: z.number().optional(),
  logFile: z.string().optional(),
  resultFile: z.string().optional(),
  handoffId: z.string().optional(),
  handoffFile: z.string().optional(),
  handoff: z.object(handoffOutput).optional(),
  exitCode: z.number().optional(),
  signal: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  changedFiles: z.array(z.object({
    path: z.string(),
    oldPath: z.string().optional(),
    status: z.string(),
    insertions: z.number(),
    deletions: z.number(),
  })).optional(),
  diffPreview: z.string().optional(),
  testResult: z.string().optional(),
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
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  projectPath: z.string().optional(),
  connectorProfile: z.string().optional(),
  durationMs: z.number().optional(),
  args: z.record(z.unknown()).optional(),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  requestContext: z.object(requestContextOutput).passthrough().optional(),
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

const bundleFileOutput = {
  path: z.string(),
  size: z.number().optional(),
  lines: z.number().optional(),
  sha256: z.string().optional(),
  truncated: z.boolean(),
  content: z.string().optional(),
  error: z.string().optional(),
};

const pathReadFileOutput = {
  path: z.string(),
  projectPath: z.string().optional(),
  relativePath: z.string().optional(),
  size: z.number().optional(),
  lines: z.number().optional(),
  sha256: z.string().optional(),
  truncated: z.boolean().optional(),
  content: z.string().optional(),
  error: z.string().optional(),
};

const skillOutput = {
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  root: z.string(),
  path: z.string(),
  directory: z.string(),
  skillFile: z.string(),
  activated: z.boolean().optional(),
  source: z.enum(['policy', 'project', 'fallback']).optional(),
};

const skillBundleFileOutput = {
  path: z.string(),
  size: z.number().optional(),
  sha256: z.string().optional(),
  truncated: z.boolean(),
  content: z.string().optional(),
  error: z.string().optional(),
};

const policyShape = {
  allowedProjectRoots: z.array(z.string()),
  skillRoots: z.array(z.string()),
  denyGlobs: z.array(z.string()),
  shell: z.object({
    enabled: z.boolean(),
    denyPatterns: z.array(z.string()),
  }),
};

export function createMcpServer(config: BridgeConfig): McpServer {
  activeConfig = config;
  const defaultPublicBaseUrl = config.oauth.publicBaseUrl
    ?? `http://127.0.0.1:${process.env.LOCALBRIDGE_PORT ?? '3838'}`;
  const server = new McpServer(
    { name: 'chatgpt2localbridge', version: BRIDGE_VERSION },
    { capabilities: { tools: {} } },
  );
  installToolProfileGate(server, config);

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
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
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
    description: 'Read one or more text files from a local project. If the user provides absolute local paths like /home/... or /Users/..., prefer file.read_path or file_read_path instead.',
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

  server.registerTool('file.read_path', {
    title: 'Read Absolute Local Paths',
    description: 'Read one or more absolute text file paths from approved local/Linux/Mac workspace roots. Use this whenever the user gives a full local path such as /home/user/project/file.py or /Users/alex/project/file.md; do not use cloud Python or a sandbox shell to check these local paths.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(20)
        .describe('Absolute local file paths to read. Each path must be inside bridge.policy allowedProjectRoots.'),
      maxLines: z.number().int().min(1).max(5000).default(1000),
    },
    outputSchema: {
      files: z.array(z.object(pathReadFileOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('file.read_path', async ({ paths, maxLines }) => {
    const results = paths.map((requestedPath) => readAllowedPathFile(requestedPath, maxLines));

    return {
      content: [{
        type: 'text' as const,
        text: results.map((r) => r.error
          ? `${r.path}: ${r.error}`
          : `--- ${r.path} (${r.lines} lines${r.truncated ? ', truncated' : ''}) ---\n${r.content}`
        ).join('\n\n'),
      }],
      structuredContent: {
        files: results,
      },
      _meta: { fileContents: results },
    };
  }));

  server.registerTool('file_read_path', {
    title: 'Read Absolute Local Paths',
    description: 'Compatibility alias for file.read_path. Read one or more absolute text file paths from approved local/Linux/Mac workspace roots. Use this when ChatGPT asks for file_read_path or when dotted MCP tool names are not available in the current client.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(20)
        .describe('Absolute local file paths to read. Each path must be inside bridge.policy allowedProjectRoots.'),
      maxLines: z.number().int().min(1).max(5000).default(1000),
    },
    outputSchema: {
      files: z.array(z.object(pathReadFileOutput)),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('file_read_path', async ({ paths, maxLines }) => {
    const results = paths.map((requestedPath) => readAllowedPathFile(requestedPath, maxLines));

    return {
      content: [{
        type: 'text' as const,
        text: results.map((r) => r.error
          ? `${r.path}: ${r.error}`
          : `--- ${r.path} (${r.lines} lines${r.truncated ? ', truncated' : ''}) ---\n${r.content}`
        ).join('\n\n'),
      }],
      structuredContent: {
        files: results,
      },
      _meta: { fileContents: results },
    };
  }));

  server.registerTool('project.bundle', {
    title: 'Bundle Project Context',
    description: 'Read a local directory summary, selected text files, and optional git diff in one call. Use this when the user wants several local files inspected or copied into a cloud-side downloadable artifact: read local first with this tool, then generate the downloadable copy from the returned content.',
    inputSchema: {
      projectPath: z.string(),
      dir: z.string().default('.'),
      files: z.array(z.string()).max(40).default([]),
      includeDirectorySummary: z.boolean().default(true),
      recursive: z.boolean().default(false),
      maxEntries: z.number().int().min(1).max(1000).default(120),
      maxFileBytes: z.number().int().min(100).max(MAX_FILE_BYTES).default(120_000),
      maxTotalBytes: z.number().int().min(1000).max(4 * 1024 * 1024).default(750_000),
      includeGitDiff: z.boolean().default(false),
    },
    outputSchema: {
      projectPath: z.string(),
      dir: z.string(),
      directorySummary: z.array(z.object(directoryEntryOutput)),
      files: z.array(z.object(bundleFileOutput)),
      diff: z.string().optional(),
      truncated: z.boolean(),
      notes: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('project.bundle', async ({
    projectPath,
    dir,
    files,
    includeDirectorySummary,
    recursive,
    maxEntries,
    maxFileBytes,
    maxTotalBytes,
    includeGitDiff,
  }) => {
    const root = resolveProject(projectPath);
    const notes: string[] = [];
    let remainingBytes = maxTotalBytes;
    let truncated = false;
    let directorySummary: Array<{ path: string; type: 'file' | 'directory' | 'other'; size: number; modifiedAt: string }> = [];

    if (includeDirectorySummary) {
      const target = resolveInsideProject(root, dir);
      const entries = listDirectory(root, target, recursive, maxEntries);
      directorySummary = entries.items;
      truncated = truncated || entries.truncated;
      if (entries.truncated) notes.push('Directory summary was truncated by maxEntries.');
    }

    const bundledFiles = files.map((file) => {
      const result = readProjectFileForBundle(root, file, maxFileBytes, remainingBytes);
      if (result.content) {
        remainingBytes -= Buffer.byteLength(result.content, 'utf-8');
      }
      truncated = truncated || result.truncated;
      if (result.error) notes.push(`${file}: ${result.error}`);
      return result;
    });

    let diff: string | undefined;
    if (includeGitDiff) {
      try {
        diff = truncate(getRawDiff(root), Math.min(remainingBytes, maxFileBytes));
        remainingBytes -= Buffer.byteLength(diff, 'utf-8');
        if (diff.endsWith('... (truncated)')) {
          truncated = true;
          notes.push('Git diff was truncated by byte limits.');
        }
      } catch (err) {
        notes.push(`git diff unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const content = formatBundleContent({ root, dir, directorySummary, files: bundledFiles, diff, notes, truncated });
    return {
      content: [{ type: 'text' as const, text: content }],
      structuredContent: {
        projectPath: root,
        dir,
        directorySummary,
        files: bundledFiles,
        diff,
        truncated,
        notes,
      },
    };
  }));

  server.registerTool('policy.read', {
    title: 'Read Bridge Policy',
    description: 'Read the active local safety policy: approved workspace roots, skill roots, denied file globs, and shell rules.',
    inputSchema: {},
    outputSchema: {
      policyPath: z.string(),
      policy: z.object(policyShape),
      warnings: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('policy.read', async () => {
    const policy = activeConfig?.policy ?? config.policy;
    const warnings = validatePolicy(policy).warnings;
    return {
      content: [{ type: 'text' as const, text: formatPolicySummary(config.policyPath, policy, warnings) }],
      structuredContent: { policyPath: config.policyPath, policy, warnings },
    };
  }));

  server.registerTool('policy_read', {
    title: 'Read Bridge Policy',
    description: 'ChatGPT-compatible alias for policy.read. Read approved roots, skill roots, deny globs, and shell rules.',
    inputSchema: {},
    outputSchema: {
      policyPath: z.string(),
      policy: z.object(policyShape),
      warnings: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('policy_read', async () => {
    const policy = activeConfig?.policy ?? config.policy;
    const warnings = validatePolicy(policy).warnings;
    return {
      content: [{ type: 'text' as const, text: formatPolicySummary(config.policyPath, policy, warnings) }],
      structuredContent: { policyPath: config.policyPath, policy, warnings },
    };
  }));

  server.registerTool('policy.validate', {
    title: 'Validate Bridge Policy',
    description: 'Validate a proposed policy before saving it in the native app or bridge.policy.json. This tool does not write files.',
    inputSchema: {
      allowedProjectRoots: z.array(z.string()).default([]),
      skillRoots: z.array(z.string()).default([]),
      denyGlobs: z.array(z.string()).default([]),
      shell: z.object({
        enabled: z.boolean().default(true),
        denyPatterns: z.array(z.string()).default([]),
      }).default({ enabled: true, denyPatterns: [] }),
    },
    outputSchema: {
      ok: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      normalized: z.object(policyShape),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('policy.validate', async (policy) => {
    const normalized = normalizePolicy(policy);
    const result = validatePolicy(normalized);
    return {
      content: [{
        type: 'text' as const,
        text: result.ok
          ? `Policy is valid.${result.warnings.length ? `\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}` : ''}`
          : `Policy has errors:\n${result.errors.map((error) => `- ${error}`).join('\n')}`,
      }],
      structuredContent: { ...result, normalized },
    };
  }));

  server.registerTool('skill.list', {
    title: 'List Local Skills',
    description: 'List SKILL.md files from approved skill roots. Defaults to ~/.codex/skills when available.',
    inputSchema: {
      skillRoot: z.string().optional(),
      maxResults: z.number().int().min(1).max(1000).default(200),
    },
    outputSchema: {
      skillRoot: z.string(),
      skills: z.array(z.object(skillOutput)),
      truncated: z.boolean(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('skill.list', async ({ skillRoot, maxResults }) => {
    const roots = resolveSkillRootsForQuery(skillRoot);
    const result = listLocalSkillsAcrossRoots(roots, maxResults);
    return {
      content: [{ type: 'text' as const, text: formatSkillList(result.skills, result.truncated) }],
      structuredContent: { skillRoot: skillRoot ? roots[0] : 'all', roots, skills: result.skills, truncated: result.truncated },
    };
  }));

  server.registerTool('skill.search', {
    title: 'Search Local Skills',
    description: 'Search approved local SKILL.md files by name, description, path, and content preview.',
    inputSchema: {
      query: z.string().min(1),
      skillRoot: z.string().optional(),
      maxResults: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      query: z.string(),
      skillRoot: z.string(),
      skills: z.array(z.object(skillOutput).extend({
        score: z.number(),
        snippet: z.string().optional(),
      })),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('skill.search', async ({ query, skillRoot, maxResults }) => {
    const roots = resolveSkillRootsForQuery(skillRoot);
    const skills = searchLocalSkillsAcrossRoots(roots, query, maxResults);
    return {
      content: [{ type: 'text' as const, text: skills.length ? skills.map((skill) => `${skill.id}: ${skill.description ?? skill.path}`).join('\n') : `No local skills matched "${query}".` }],
      structuredContent: { query, skillRoot: skillRoot ? roots[0] : 'all', roots, skills },
    };
  }));

  server.registerTool('skill.read', {
    title: 'Read Local Skill',
    description: 'Read one approved local SKILL.md file. Use this before following a local Codex skill from ChatGPT.',
    inputSchema: {
      skill: z.string().min(1).describe('Skill id, name, relative directory, or relative path to SKILL.md'),
      skillRoot: z.string().optional(),
      maxBytes: z.number().int().min(1000).max(MAX_SKILL_FILE_BYTES).default(120_000),
    },
    outputSchema: {
      skill: z.object(skillOutput),
      activationId: z.string(),
      content: z.string(),
      truncated: z.boolean(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('skill.read', async ({ skill, skillRoot, maxBytes }) => {
    const { root, record } = findLocalSkillAcrossRoots(resolveSkillRootsForQuery(skillRoot), skill);
    const read = readSkillFile(root, record.skillFile, maxBytes);
    const activation = markSkillActivated(root, record);
    auditEvent('skill.read', { skill: record.id, root, file: record.skillFile, truncated: read.truncated });
    return {
      content: [{ type: 'text' as const, text: read.content }],
      structuredContent: { skill: { ...record, activated: true }, activationId: activation.activationId, content: read.content, truncated: read.truncated },
    };
  }));

  server.registerTool('skill.bundle', {
    title: 'Bundle Local Skill',
    description: 'Bundle a local SKILL.md with directly referenced local text files such as references/*.md. Use this when a task needs the whole local skill context.',
    inputSchema: {
      skill: z.string().min(1),
      skillRoot: z.string().optional(),
      includeReferences: z.boolean().default(true),
      activationId: z.string().optional().describe('Required to include referenced files. Use the activationId returned by skill.read.'),
      maxReferenceFiles: z.number().int().min(0).max(40).default(12),
      maxBytes: z.number().int().min(1000).max(2 * 1024 * 1024).default(250_000),
    },
    outputSchema: {
      skill: z.object(skillOutput),
      files: z.array(z.object(skillBundleFileOutput)),
      truncated: z.boolean(),
      notes: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('skill.bundle', async ({ skill, skillRoot, includeReferences, activationId, maxReferenceFiles, maxBytes }) => {
    const { root, record } = findLocalSkillAcrossRoots(resolveSkillRootsForQuery(skillRoot), skill);
    const bundle = bundleLocalSkill(root, record, includeReferences, activationId, maxReferenceFiles, maxBytes);
    auditEvent('skill.bundle', { skill: record.id, root, files: bundle.files.map((file) => file.path), truncated: bundle.truncated });
    return {
      content: [{ type: 'text' as const, text: formatSkillBundle(record, bundle.files, bundle.notes, bundle.truncated) }],
      structuredContent: { skill: record, ...bundle },
    };
  }));

  server.registerTool('skill.route', {
    title: 'Route Task To Local Skills',
    description: 'Recommend local skills for a task and return a short follow-up prompt for reading or bundling them.',
    inputSchema: {
      task: z.string().min(1),
      skillRoot: z.string().optional(),
      maxResults: z.number().int().min(1).max(10).default(5),
    },
    outputSchema: {
      task: z.string().optional(),
      skillRoot: z.string(),
      recommendations: z.array(z.object(skillOutput).extend({
        score: z.number(),
        reason: z.string(),
      })),
      prompt: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('skill.route', async ({ task, skillRoot, maxResults }) => {
    const roots = resolveSkillRootsForQuery(skillRoot);
    const recommendations = routeLocalSkillsAcrossRoots(roots, task, maxResults);
    const prompt = recommendations.length
      ? `请先使用 skill.read 激活这些本地技能；需要引用文件时再用 skill.bundle：${recommendations.map((skill) => skill.id).join(', ')}。`
      : '没有找到明显匹配的本地技能；可以先使用 skill.search 换关键词检索。';
    auditEvent('skill.route', { task: truncate(task, 500), roots, skills: recommendations.map((skill) => skill.id) });
    return {
      content: [{ type: 'text' as const, text: `${prompt}\n${recommendations.map((skill) => `- ${skill.id}: ${skill.reason}`).join('\n')}`.trim() }],
      structuredContent: { task, skillRoot: skillRoot ? roots[0] : 'all', roots, recommendations, prompt },
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

  server.registerTool('file_list', {
    title: 'List Directory',
    description: 'ChatGPT-compatible alias for file.list. List files and directories inside an approved local workspace.',
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('file_list', async ({ projectPath, dir, recursive, maxEntries }) => {
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

  server.registerTool('local_list_dir', {
    title: 'List Local Directory',
    description: 'Use this first when the user asks whether ChatGPT can see a local path. It lists an approved local directory only; it does not read file contents.',
    inputSchema: {
      projectPath: z.string().describe('Absolute approved local directory path, such as /path/to/project or /Users/name/project.'),
      dir: z.string().default('.').describe('Subdirectory inside projectPath. Use "." for the directory itself.'),
      recursive: z.boolean().default(false),
      maxEntries: z.number().int().min(1).max(1000).default(200),
    },
    outputSchema: {
      projectPath: z.string(),
      dir: z.string(),
      entries: z.array(z.object(directoryEntryOutput)),
      truncated: z.boolean(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('local_list_dir', async ({ projectPath, dir, recursive, maxEntries }) => {
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
      structuredContent: { projectPath: root, dir, entries: entries.items, truncated: entries.truncated },
    };
  }));

  server.registerTool('local_read_file', {
    title: 'Read Local File',
    description: 'Read one approved local text file. Use this only when the user asks to read a specific file, not when they ask to inspect or list a directory.',
    inputSchema: {
      projectPath: z.string().describe('Absolute approved local workspace root.'),
      file: z.string().describe('Relative file path inside projectPath. Do not pass a directory.'),
      maxLines: z.number().int().min(1).max(5000).default(1000),
    },
    outputSchema: {
      projectPath: z.string(),
      file: z.object(fileSummaryOutput),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('local_read_file', async ({ projectPath, file, maxLines }) => {
    const result = readLocalFile(projectPath, file, maxLines);
    return {
      content: [{
        type: 'text' as const,
        text: result.file.error
          ? `${result.file.path}: ${result.file.error}`
          : `--- ${result.file.path} (${result.file.lines} lines${result.file.truncated ? ', truncated' : ''}) ---\n${result.file.content ?? ''}`,
      }],
      structuredContent: { projectPath: result.projectPath, file: stripFileContentFromSummary(result.file) },
      _meta: { fileContents: [result.file] },
    };
  }));

  server.registerTool('local_write_file', {
    title: 'Write Local File',
    description: 'Create or overwrite one approved local text file. Use this when the user explicitly asks to save, create, or update a file in an approved local workspace.',
    inputSchema: {
      projectPath: z.string().describe('Absolute approved local workspace root.'),
      file: z.string().describe('Relative file path inside projectPath. Do not pass an absolute path.'),
      content: z.string().describe('Full text content to write.'),
      createDirs: z.boolean().default(true).describe('Create parent directories when missing.'),
    },
    outputSchema: {
      file: z.string(),
      changedFiles: z.array(z.object(changedFileOutput)),
      stats: z.object(diffStatsOutput),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('local_write_file', async ({ projectPath, file, content, createDirs }) => {
    return writeLocalFile(projectPath, file, content, createDirs);
  }));

  server.registerTool('local_bundle_dir', {
    title: 'Bundle Local Directory',
    description: 'Bundle an approved local directory summary plus selected text files in one call. Use this when the user wants multiple local files or a compact project snapshot.',
    inputSchema: {
      projectPath: z.string().describe('Absolute approved local workspace root.'),
      dir: z.string().default('.').describe('Relative directory inside projectPath.'),
      files: z.array(z.string()).max(40).default([]).describe('Optional relative files to include with content.'),
      recursive: z.boolean().default(false),
      maxEntries: z.number().int().min(1).max(1000).default(120),
      maxFileBytes: z.number().int().min(100).max(MAX_FILE_BYTES).default(120_000),
      maxTotalBytes: z.number().int().min(1000).max(4 * 1024 * 1024).default(750_000),
    },
    outputSchema: {
      projectPath: z.string(),
      dir: z.string(),
      directorySummary: z.array(z.object(directoryEntryOutput)),
      files: z.array(z.object(bundleFileOutput)),
      truncated: z.boolean(),
      notes: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('local_bundle_dir', async ({ projectPath, dir, files, recursive, maxEntries, maxFileBytes, maxTotalBytes }) => {
    const bundle = bundleLocalDirectory({ projectPath, dir, files, recursive, maxEntries, maxFileBytes, maxTotalBytes });
    return {
      content: [{ type: 'text' as const, text: formatBundleContent({ ...bundle, root: bundle.projectPath, diff: undefined }) }],
      structuredContent: bundle,
    };
  }));

  server.registerTool('local_workspace_action', {
    title: 'Local Workspace Action',
    description: 'Preferred single entrypoint for ChatGPT. Choose action=list_dir for directories, read_file for one file, write_file to save one text file, or bundle_dir for a directory summary plus selected files.',
    inputSchema: {
      action: z.enum(['list_dir', 'read_file', 'write_file', 'bundle_dir']),
      projectPath: z.string().describe('Absolute approved local workspace root.'),
      path: z.string().default('.').describe('Relative directory or file path inside projectPath.'),
      files: z.array(z.string()).max(40).default([]).describe('Only used by bundle_dir. Optional relative files to include with content.'),
      content: z.string().optional().describe('Only used by write_file. Full text content to write.'),
      createDirs: z.boolean().default(true).describe('Only used by write_file. Create parent directories when missing.'),
      recursive: z.boolean().default(false),
      maxEntries: z.number().int().min(1).max(1000).default(120),
      maxLines: z.number().int().min(1).max(5000).default(1000),
      maxFileBytes: z.number().int().min(100).max(MAX_FILE_BYTES).default(120_000),
      maxTotalBytes: z.number().int().min(1000).max(4 * 1024 * 1024).default(750_000),
    },
    outputSchema: {
      action: z.enum(['list_dir', 'read_file', 'write_file', 'bundle_dir']),
      result: z.unknown(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('local_workspace_action', async ({
    action,
    projectPath,
    path: relPath,
    files,
    content,
    createDirs,
    recursive,
    maxEntries,
    maxLines,
    maxFileBytes,
    maxTotalBytes,
  }) => {
    if (action === 'list_dir') {
      const result = listLocalDirectory(projectPath, relPath, recursive, maxEntries);
      return {
        content: [{ type: 'text' as const, text: formatDirectoryEntries(result.dir, result.entries) }],
        structuredContent: { action, result },
      };
    }
    if (action === 'read_file') {
      const result = readLocalFile(projectPath, relPath, maxLines);
      return {
        content: [{
          type: 'text' as const,
          text: result.file.error
            ? `${result.file.path}: ${result.file.error}`
            : `--- ${result.file.path} (${result.file.lines} lines${result.file.truncated ? ', truncated' : ''}) ---\n${result.file.content ?? ''}`,
        }],
        structuredContent: { action, result: { projectPath: result.projectPath, file: stripFileContentFromSummary(result.file) } },
        _meta: { fileContents: [result.file] },
      };
    }
    if (action === 'write_file') {
      if (content == null) throw new Error('content is required when action=write_file');
      const result = writeLocalFile(projectPath, relPath, content, createDirs);
      return {
        content: result.content,
        structuredContent: { action, result: result.structuredContent },
      };
    }

    const result = bundleLocalDirectory({
      projectPath,
      dir: relPath,
      files,
      recursive,
      maxEntries,
      maxFileBytes,
      maxTotalBytes,
    });
    return {
      content: [{ type: 'text' as const, text: formatBundleContent({ ...result, root: result.projectPath, diff: undefined }) }],
      structuredContent: { action, result },
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

  // Compatibility alias for ChatGPT Custom Connectors that prefer underscore-named tools.
  server.registerTool('file_write', {
    title: 'Write File',
    description: 'Compatibility alias for file.write. Create or overwrite a text file inside a project.',
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
  }, withToolLogging('file_write', async ({ projectPath, file, content, createDirs }) => {
    const root = resolveProject(projectPath);
    const target = resolveInsideProject(root, file);
    const before = fileDigest(target);
    if (createDirs) fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    auditFileOperation('file_write', root, [{ path: target, before, after: fileDigest(target) }]);
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

  server.registerTool('trace.session_start', {
    title: 'Start Trace Session',
    description: 'Create a logical trace session id for grouping subsequent tool calls by conversation/task/project.',
    inputSchema: {
      title: z.string(),
      projectPath: z.string().optional(),
      connectorProfile: z.string().optional(),
      taskId: z.string().optional(),
    },
    outputSchema: z.object(traceSessionOutput),
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('trace.session_start', async ({ title, projectPath, connectorProfile, taskId }) => {
    const session = startTraceSession({
      title,
      projectPath,
      connectorProfile,
      taskId,
      requestContext: getRequestContext(),
    });
    return {
      content: [{ type: 'text' as const, text: `Trace session ${session.id} started` }],
      structuredContent: session,
    };
  }));

  server.registerTool('trace.session_current', {
    title: 'Get Current Trace Session',
    description: 'Read the current active trace session used by subsequent tool calls.',
    inputSchema: {},
    outputSchema: z.union([
      z.object(traceSessionOutput),
      z.null(),
    ]),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('trace.session_current', async () => {
    const session = readActiveTraceSession();
    return {
      content: [{ type: 'text' as const, text: session ? `Current trace session: ${session.id}` : 'No active trace session.' }],
      structuredContent: session ?? null,
    };
  }));

  server.registerTool('trace.session_end', {
    title: 'End Trace Session',
    description: 'End the currently active trace session. Provide sessionId to end a specific session.',
    inputSchema: {
      sessionId: z.string().optional(),
      note: z.string().optional(),
    },
    outputSchema: z.union([z.object(traceSessionOutput), z.string()]),
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('trace.session_end', async ({ sessionId, note }) => {
    const ended = endTraceSession(sessionId, note);
    if (!ended) {
      return {
        content: [{ type: 'text' as const, text: 'No active session matched.' }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text' as const, text: `Trace session ${ended.id} ended` }],
      structuredContent: ended,
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
    syncTraceContextForTask(task.id, task.projectPath, getRequestContext());
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

  server.registerTool('handoff.create', {
    title: 'Create Codex Handoff',
    description: 'Validate and persist a structured handoff package for local Codex Runner. This does not execute code; call codex.task_start with the returned handoffId to run it.',
    inputSchema: {
      title: z.string().min(1).max(160),
      objective: z.string().min(1).max(12_000),
      workspace: z.string().optional(),
      projectPath: z.string().optional(),
      constraints: z.array(z.string()).min(1).max(20),
      allowedOperations: z.array(z.enum(handoffAllowedOperations)).min(1).max(12),
      testCommands: z.array(z.string()).max(10).default([]),
      expectedArtifacts: z.array(z.string()).max(30).default([]),
      riskLevel: z.enum(handoffRiskLevels).default('medium'),
      acceptanceCriteria: z.array(z.string()).max(20).default([]),
      skillContext: z.array(z.string()).max(20).default([]),
      skillTask: z.string().max(4_000).optional(),
      skillRoot: z.string().optional(),
      maxSkillContext: z.number().int().min(0).max(10).default(3),
      notes: z.union([
        z.string().max(4_000),
        z.array(z.string()).max(20),
      ]).optional(),
    },
    outputSchema: {
      handoffId: z.string(),
      handoffFile: z.string(),
      task: z.object(taskOutput),
      handoff: z.object(handoffOutput),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('handoff.create', async (args) => {
    const { handoff, task } = createHandoff(args);
    syncTraceContextForTask(task.id, task.projectPath, getRequestContext());
    return {
      content: [{
        type: 'text' as const,
        text: `Created handoff ${handoff.id}: ${handoff.title}\nNext: call codex.task_start with handoffId=${handoff.id}`,
      }],
      structuredContent: {
        handoffId: handoff.id,
        handoffFile: task.handoffFile ?? '',
        task,
        handoff,
      },
    };
  }));

  server.registerTool('handoff_create', {
    title: 'Create Codex Handoff',
    description: 'ChatGPT-compatible alias for handoff.create. Create a structured handoff package for local Codex Runner. This does not run code; call codex_task_start with the returned handoffId.',
    inputSchema: {
      title: z.string().min(1).max(160),
      objective: z.string().min(1).max(12_000),
      workspace: z.string().optional(),
      projectPath: z.string().optional(),
      constraints: z.array(z.string()).min(1).max(20),
      allowedOperations: z.array(z.enum(handoffAllowedOperations)).min(1).max(12),
      testCommands: z.array(z.string()).max(10).default([]),
      expectedArtifacts: z.array(z.string()).max(30).default([]),
      riskLevel: z.enum(handoffRiskLevels).default('medium'),
      acceptanceCriteria: z.array(z.string()).max(20).default([]),
      skillContext: z.array(z.string()).max(20).default([]),
      skillTask: z.string().max(4_000).optional(),
      skillRoot: z.string().optional(),
      maxSkillContext: z.number().int().min(0).max(10).default(3),
      notes: z.union([
        z.string().max(4_000),
        z.array(z.string()).max(20),
      ]).optional(),
    },
    outputSchema: {
      handoffId: z.string(),
      handoffFile: z.string(),
      task: z.object(taskOutput),
      handoff: z.object(handoffOutput),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('handoff_create', async (args) => {
    const { handoff, task } = createHandoff(args);
    syncTraceContextForTask(task.id, task.projectPath, getRequestContext());
    return {
      content: [{
        type: 'text' as const,
        text: `Created handoff ${handoff.id}: ${handoff.title}\nNext: call codex_task_start with handoffId=${handoff.id}`,
      }],
      structuredContent: {
        handoffId: handoff.id,
        handoffFile: task.handoffFile ?? '',
        task,
        handoff,
      },
    };
  }));

  server.registerTool('codex.task_start', {
    title: 'Start Codex Runner Task',
    description: 'High-level ChatGPT entrypoint for local Codex work. Creates a persisted task record that the native app can show in Codex Runner; prefer this over raw shell.exec for broad local work.',
    inputSchema: {
      handoffId: z.string().optional(),
      task: z.string().optional(),
      workspace: z.string().optional(),
      projectPath: z.string().optional(),
      mode: z.enum(['normal', 'debug']).default('normal'),
      timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
    },
    outputSchema: z.object(taskOutput).shape,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, withToolLogging('codex.task_start', async ({ handoffId, task, workspace, projectPath, mode, timeoutMs }) => {
    const updated = startCodexRunnerTask(task, workspace, projectPath, mode, timeoutMs, handoffId);
    syncTraceContextForTask(updated.id, updated.projectPath, getRequestContext());
    return {
      content: [{ type: 'text' as const, text: `Codex task ${updated.id}: ${updated.title}` }],
      structuredContent: updated,
    };
  }));

  server.registerTool('codex_task_start', {
    title: 'Start Codex Runner Task',
    description: 'ChatGPT-compatible alias for codex.task_start. Start a local Codex Runner job from a handoffId or scoped project task. Prefer this over shell tools.',
    inputSchema: {
      handoffId: z.string().optional(),
      task: z.string().optional(),
      workspace: z.string().optional(),
      projectPath: z.string().optional(),
      mode: z.enum(['normal', 'debug']).default('normal'),
      timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
    },
    outputSchema: z.object(taskOutput).shape,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('codex_task_start', async ({ handoffId, task, workspace, projectPath, mode, timeoutMs }) => {
    const updated = startCodexRunnerTask(task, workspace, projectPath, mode, timeoutMs, handoffId);
    syncTraceContextForTask(updated.id, updated.projectPath, getRequestContext());
    return {
      content: [{ type: 'text' as const, text: `Codex task ${updated.id}: ${updated.title}` }],
      structuredContent: updated,
    };
  }));

  server.registerTool('codex.status', {
    title: 'Codex Runner Status',
    description: 'Read one Codex Runner task or list recent task records for the native app queue.',
    inputSchema: {
      taskId: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      tasks: z.array(z.object(taskOutput)),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('codex.status', async ({ taskId, limit }) => {
    const tasks = listCodexRunnerTasks(taskId, limit);
    return {
      content: [{ type: 'text' as const, text: tasks.length ? tasks.map(formatTask).join('\n') : 'No Codex Runner tasks found.' }],
      structuredContent: { tasks },
    };
  }));

  server.registerTool('codex_status', {
    title: 'Codex Runner Status',
    description: 'ChatGPT-compatible alias for codex.status. Read one Codex Runner task or list recent task records.',
    inputSchema: {
      taskId: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      tasks: z.array(z.object(taskOutput)),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('codex_status', async ({ taskId, limit }) => {
    const tasks = listCodexRunnerTasks(taskId, limit);
    return {
      content: [{ type: 'text' as const, text: tasks.length ? tasks.map(formatTask).join('\n') : 'No Codex Runner tasks found.' }],
      structuredContent: { tasks },
    };
  }));

  server.registerTool('codex.result', {
    title: 'Codex Runner Result',
    description: 'Return a compact Codex Runner result summary. Full log and diff are opt-in to reduce hosted ChatGPT safety-check blocks.',
    inputSchema: {
      taskId: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(5),
      includeLog: z.boolean().default(false),
      includeDiff: z.boolean().default(false),
    },
    outputSchema: {
      tasks: z.array(z.object(taskOutput)),
      handoff: z.object(handoffOutput).optional(),
      changedFiles: z.array(z.object({
        path: z.string(),
        oldPath: z.string().optional(),
        status: z.string(),
        insertions: z.number(),
        deletions: z.number(),
      })),
      diffPreview: z.string(),
      testResult: z.string(),
      logTail: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, withToolLogging('codex.result', async ({ taskId, limit, includeLog, includeDiff }) => {
    const tasks = listCodexRunnerTasks(taskId, limit).map(refreshCodexTaskResult);
    const primary = tasks[0];
    const compactTasks = tasks.map(compactCodexTask);
    return {
      content: [{
        type: 'text' as const,
        text: primary
          ? [
              formatTask(primary),
              primary.changedFiles?.length ? `changed files=${primary.changedFiles.length}` : '',
              primary.testResult ? `result=${truncate(primary.testResult, 1200)}` : '',
              includeLog || includeDiff ? 'verbose fields requested explicitly' : 'compact result: logTail and diffPreview omitted by default',
            ].filter(Boolean).join('\n')
          : 'No Codex Runner result records yet.',
      }],
      structuredContent: {
        tasks: compactTasks,
        handoff: primary?.handoff,
        changedFiles: primary?.changedFiles ?? [],
        diffPreview: includeDiff ? primary?.diffPreview ?? '' : '',
        testResult: primary?.testResult ?? '',
        logTail: includeLog && primary?.logFile ? readTextTail(primary.logFile, 12_000) : '',
      },
    };
  }));

  server.registerTool('codex_result', {
    title: 'Codex Runner Result',
    description: 'ChatGPT-compatible alias for codex.result. Return a compact task summary by default; set includeLog/includeDiff only when needed.',
    inputSchema: {
      taskId: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(5),
      includeLog: z.boolean().default(false),
      includeDiff: z.boolean().default(false),
    },
    outputSchema: {
      tasks: z.array(z.object(taskOutput)),
      handoff: z.object(handoffOutput).optional(),
      changedFiles: z.array(z.object({
        path: z.string(),
        oldPath: z.string().optional(),
        status: z.string(),
        insertions: z.number(),
        deletions: z.number(),
      })),
      diffPreview: z.string(),
      testResult: z.string(),
      logTail: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, withToolLogging('codex_result', async ({ taskId, limit, includeLog, includeDiff }) => {
    const tasks = listCodexRunnerTasks(taskId, limit).map(refreshCodexTaskResult);
    const primary = tasks[0];
    const compactTasks = tasks.map(compactCodexTask);
    return {
      content: [{
        type: 'text' as const,
        text: primary
          ? [
              formatTask(primary),
              primary.changedFiles?.length ? `changed files=${primary.changedFiles.length}` : '',
              primary.testResult ? `result=${truncate(primary.testResult, 1200)}` : '',
              includeLog || includeDiff ? 'verbose fields requested explicitly' : 'compact result: logTail and diffPreview omitted by default',
            ].filter(Boolean).join('\n')
          : 'No Codex Runner result records yet.',
      }],
      structuredContent: {
        tasks: compactTasks,
        handoff: primary?.handoff,
        changedFiles: primary?.changedFiles ?? [],
        diffPreview: includeDiff ? primary?.diffPreview ?? '' : '',
        testResult: primary?.testResult ?? '',
        logTail: includeLog && primary?.logFile ? readTextTail(primary.logFile, 12_000) : '',
      },
    };
  }));

  server.registerTool('codex.cancel', {
    title: 'Cancel Codex Runner Task',
    description: 'Cancel a running Codex Runner task by task id.',
    inputSchema: {
      taskId: z.string(),
      confirm: z.boolean(),
    },
    outputSchema: z.object(taskOutput).shape,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, withToolLogging('codex.cancel', async ({ taskId, confirm }) => {
    if (!confirm) throw new Error('Cancel skipped: confirm must be true.');
    const task = cancelCodexRunnerTask(taskId);
    return {
      content: [{ type: 'text' as const, text: `Cancelled ${task.id}` }],
      structuredContent: task,
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
    if (activeTraceTaskIdCache === task.id && task.status !== 'active' && task.status !== 'running') {
      activeTraceTaskIdCache = undefined;
    }
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
      publicBaseUrl: z.string().url().default(defaultPublicBaseUrl),
      timeoutMs: z.number().int().min(500).max(10000).default(5000),
    },
    outputSchema: {
      checks: z.array(z.object(healthCheckOutput)),
      codexProvider: z.object(codexProviderOutput),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, withToolLogging('bridge.health', async ({ includePublic, publicBaseUrl, timeoutMs }) => {
    const localPort = process.env.LOCALBRIDGE_PORT ?? '3838';
    const checks = [await checkHealth('local', `http://127.0.0.1:${localPort}/health`, timeoutMs)];
    if (includePublic) checks.push(await checkHealth('public', `${publicBaseUrl.replace(/\/$/, '')}/health`, timeoutMs));
    return {
      content: [{ type: 'text' as const, text: checks.map((check) => `${check.name}: ${check.ok ? 'ok' : 'failed'} ${check.status ?? ''} ${check.error ?? ''}`.trim()).join('\n') }],
      structuredContent: { checks, codexProvider: codexProviderStatus() },
    };
  }));

  server.registerTool('bridge_health', {
    title: 'Bridge Health',
    description: 'ChatGPT-compatible alias for bridge.health. Check local and optional public bridge health endpoints.',
    inputSchema: {
      includePublic: z.boolean().default(true),
      publicBaseUrl: z.string().url().default(defaultPublicBaseUrl),
      timeoutMs: z.number().int().min(500).max(10000).default(5000),
    },
    outputSchema: {
      checks: z.array(z.object(healthCheckOutput)),
      codexProvider: z.object(codexProviderOutput),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, withToolLogging('bridge_health', async ({ includePublic, publicBaseUrl, timeoutMs }) => {
    const localPort = process.env.LOCALBRIDGE_PORT ?? '3838';
    const checks = [await checkHealth('local', `http://127.0.0.1:${localPort}/health`, timeoutMs)];
    if (includePublic) checks.push(await checkHealth('public', `${publicBaseUrl.replace(/\/$/, '')}/health`, timeoutMs));
    return {
      content: [{ type: 'text' as const, text: checks.map((check) => `${check.name}: ${check.ok ? 'ok' : 'failed'} ${check.status ?? ''} ${check.error ?? ''}`.trim()).join('\n') }],
      structuredContent: { checks, codexProvider: codexProviderStatus() },
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
    const context = resolveTraceContext(name, args, getRequestContext());
    const startedAt = Date.now();
    const callId = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const config = activeConfig;
    if (config) {
      appendToolCall(config, {
        id: callId,
        ts: new Date(startedAt).toISOString(),
        tool: name,
        status: 'started',
        sessionId: context.sessionId,
        taskId: context.taskId,
        projectPath: context.projectPath,
        connectorProfile: context.connectorProfile,
        args: sanitizeForLog(args) as Record<string, unknown>,
        requestContext: context.requestContext,
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
          sessionId: context.sessionId,
          taskId: context.taskId,
          projectPath: context.projectPath,
          connectorProfile: context.connectorProfile,
          args: sanitizeForLog(args) as Record<string, unknown>,
          result: summarizeToolResult(result),
          requestContext: context.requestContext,
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
          sessionId: context.sessionId,
          taskId: context.taskId,
          projectPath: context.projectPath,
          connectorProfile: context.connectorProfile,
          args: sanitizeForLog(args) as Record<string, unknown>,
          error: message,
          requestContext: context.requestContext,
        });
      }
      console.error(`[mcp] tool.error ${name} durationMs=${Date.now() - startedAt} error=${JSON.stringify(message)}`);
      throw err;
    }
  };
}

function resolveTraceContext(toolName: string, args: unknown, requestContext: SafeRequestContext) {
  const projectPath = parseProjectPathFromArgs(args) || readActiveTraceSession()?.projectPath;
  const sessionId =
    parseStringField(args, 'sessionId')
    || currentTraceSessionId()
    || undefined;
  const taskId =
    parseStringField(args, 'taskId')
    || activeTraceTaskId();
  const connectorProfile =
    parseStringField(args, 'connectorProfile')
    || requestContext.connectorProfile
    || activeConfig?.toolProfile;

  if (toolName === 'trace.session_start') {
    return {
      sessionId: parseStringField(args, 'sessionId') || sessionId,
      taskId,
      projectPath,
      connectorProfile: connectorProfile?.toString(),
      requestContext: safeRequestContext(requestContext),
    };
  }

  return {
    sessionId,
    taskId,
    projectPath,
    connectorProfile: connectorProfile?.toString(),
    requestContext: safeRequestContext(requestContext),
  };
}

function parseStringField(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseProjectPathFromArgs(args: unknown): string | undefined {
  const direct = parseStringField(args, 'projectPath');
  if (direct) return direct;
  const workspace = parseStringField(args, 'workspace');
  if (!workspace) return undefined;
  try {
    return resolveWorkspaceRecord(workspace).path;
  } catch {
    return undefined;
  }
}

function safeRequestContext(context: SafeRequestContext): Record<string, string> {
  const out: Record<string, string> = { source: context.source };
  if (context.transportSessionId) out.transportSessionId = context.transportSessionId;
  if (context.requestId) out.requestId = context.requestId;
  if (context.requestIdHash) out.requestIdHash = context.requestIdHash;
  if (context.userAgent) out.userAgent = context.userAgent;
  if (context.connectorProfile) out.connectorProfile = context.connectorProfile;
  if (context.conversationId) out.conversationId = context.conversationId;
  if (context.conversationIdHash) out.conversationIdHash = context.conversationIdHash;
  return out;
}

function installToolProfileGate(server: McpServer, config: BridgeConfig): void {
  const originalRegisterTool = server.registerTool.bind(server) as any;
  (server as any).registerTool = (name: string, toolConfig: any, handler: any) => {
    if (!isToolAllowedForProfile(config.toolProfile, name)) {
      return undefined;
    }
    return originalRegisterTool(name, toolConfig, handler);
  };
}

function isToolAllowedForProfile(profile: BridgeConfig['toolProfile'], tool: string): boolean {
  if (profile === 'debug') return true;

  if (profile === 'chatgpt-app') {
    return new Set([
      'bridge_health',
      'policy_read',
      'file_list',
      'file_read_path',
      'file_write',
      'local_list_dir',
      'local_read_file',
      'local_write_file',
      'local_bundle_dir',
      'local_workspace_action',
      'handoff_create',
      'codex_task_start',
      'codex_status',
      'codex_result',
    ]).has(tool);
  }

  const alwaysSafe = new Set([
    'bridge.health',
    'bridge.activity',
    'bridge.logs',
    'bridge.status',
    'policy.read',
    'workspace.list',
    'workspace.resolve',
    'trace.session_start',
    'trace.session_current',
    'trace.session_end',
  ]);
  if (alwaysSafe.has(tool)) return true;
  if (tool.startsWith('codex.')) return true;
  if (tool.startsWith('handoff.')) return true;

  if (profile === 'codex-runner-only') {
    return false;
  }

  if (isLowLevelTool(tool)) {
    return false;
  }

  return true;
}

function isLowLevelTool(tool: string): boolean {
  return tool === 'shell.exec'
    || tool.startsWith('process.')
    || tool === 'service.restart'
    || tool === 'git.revert'
    || tool === 'git.checkpoint'
    || tool === 'workspace.add'
    || tool === 'file.write'
    || tool === 'file.mkdir'
    || tool === 'file.copy'
    || tool === 'file.move'
    || tool === 'file.patch'
    || tool === 'file.delete';
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const source = args as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['path', 'paths', 'projectPath', 'dir', 'file', 'files', 'query', 'glob', 'command', 'ref', 'checkpoint', 'skill', 'skillRoot', 'task']) {
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

function resolveAllowedRootForPath(fullPath: string): string {
  const policy = activeConfig?.policy;
  if (!policy?.allowedProjectRoots.length) {
    const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : undefined;
    return stat?.isDirectory() ? fullPath : path.dirname(fullPath);
  }

  const allowed = policy.allowedProjectRoots
    .map((entry) => path.resolve(expandHome(entry)))
    .filter((entry) => pathIsInsideRoot(fullPath, entry))
    .sort((a, b) => b.length - a.length);

  if (!allowed.length) throw new Error(`Path is outside allowed roots: ${fullPath}`);
  return allowed[0];
}

function pathIsInsideRoot(fullPath: string, root: string): boolean {
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return fullPath === root || fullPath.startsWith(rootWithSep);
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

function listLocalDirectory(projectPath: string, dir: string, recursive: boolean, maxEntries: number) {
  const root = resolveProject(projectPath);
  const target = resolveInsideProject(root, dir);
  const entries = listDirectory(root, target, recursive, maxEntries);
  return {
    projectPath: root,
    dir,
    entries: entries.items,
    truncated: entries.truncated,
  };
}

function formatDirectoryEntries(
  dir: string,
  entries: Array<{ path: string; type: 'file' | 'directory' | 'other'; size: number; modifiedAt: string }>,
) {
  if (!entries.length) return `No entries in ${dir}`;
  return entries
    .map((entry) => `${entry.type.padEnd(9)} ${entry.path} (${entry.size} bytes)`)
    .join('\n');
}

function readLocalFile(projectPath: string, file: string, maxLines: number) {
  const root = resolveProject(projectPath);
  return {
    projectPath: root,
    file: readProjectFile(root, file, maxLines),
  };
}

function writeLocalFile(projectPath: string, file: string, content: string, createDirs: boolean) {
  const root = resolveProject(projectPath);
  const target = resolveInsideProject(root, file);
  const before = fileDigest(target);
  if (createDirs) fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
  auditFileOperation('local_write_file', root, [{ path: target, before, after: fileDigest(target) }]);
  return fileChangeResponse(root, file, `Wrote ${file}`);
}

function stripFileContentFromSummary<TFile extends { content?: string }>(file: TFile): Omit<TFile, 'content'> {
  const { content: _content, ...summary } = file;
  return summary;
}

function bundleLocalDirectory(args: {
  projectPath: string;
  dir: string;
  files: string[];
  recursive: boolean;
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}) {
  const root = resolveProject(args.projectPath);
  const target = resolveInsideProject(root, args.dir);
  const directory = listDirectory(root, target, args.recursive, args.maxEntries);
  const notes: string[] = [];
  let remainingBytes = args.maxTotalBytes;
  let truncated = directory.truncated;

  if (directory.truncated) {
    notes.push('Directory summary was truncated by maxEntries.');
  }

  const files = args.files.map((file) => {
    const result = readProjectFileForBundle(root, file, args.maxFileBytes, remainingBytes);
    if (result.content) {
      remainingBytes -= Buffer.byteLength(result.content, 'utf-8');
    }
    if (result.truncated) truncated = true;
    if (result.error) notes.push(`${file}: ${result.error}`);
    return result;
  });

  return {
    projectPath: root,
    dir: args.dir,
    directorySummary: directory.items,
    files,
    truncated,
    notes,
  };
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

function readAllowedPathFile(requestedPath: string, maxLines: number) {
  try {
    if (!path.isAbsolute(expandHome(requestedPath))) {
      throw new Error(`Path must be absolute: ${requestedPath}`);
    }
    const fullPath = path.resolve(expandHome(requestedPath));
    const root = resolveAllowedRootForPath(fullPath);
    assertNotDeniedPath(root, fullPath);
    const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return { path: fullPath, projectPath: root, relativePath, error: 'Not a file' };
    if (stat.size > MAX_FILE_BYTES) return { path: fullPath, projectPath: root, relativePath, size: stat.size, error: `File too large (${stat.size} bytes)` };
    if (isBinaryFile(fullPath)) return { path: fullPath, projectPath: root, relativePath, size: stat.size, error: 'Binary file' };
    const bytes = fs.readFileSync(fullPath);
    const content = bytes.toString('utf-8');
    const lines = content.split('\n');
    const truncated = lines.length > maxLines;
    return {
      path: fullPath,
      projectPath: root,
      relativePath,
      size: stat.size,
      lines: lines.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      truncated,
      content: truncated ? `${lines.slice(0, maxLines).join('\n')}\n... (truncated)` : content,
    };
  } catch (err) {
    return { path: requestedPath, error: err instanceof Error ? err.message : String(err) };
  }
}

function readProjectFileForBundle(root: string, relPath: string, maxFileBytes: number, remainingBytes: number) {
  try {
    const fullPath = resolveInsideProject(root, relPath);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return { path: relPath, truncated: false, error: 'Not a file' };
    if (stat.size > MAX_FILE_BYTES) {
      return { path: relPath, size: stat.size, truncated: false, error: `File too large (${stat.size} bytes)` };
    }
    if (isBinaryFile(fullPath)) {
      return { path: relPath, size: stat.size, truncated: false, error: 'Binary file' };
    }
    if (remainingBytes <= 0) {
      return { path: relPath, size: stat.size, truncated: true, error: 'Skipped because maxTotalBytes was reached' };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const byteLimit = Math.min(maxFileBytes, remainingBytes);
    const truncated = Buffer.byteLength(content, 'utf-8') > byteLimit;
    return {
      path: relPath,
      size: stat.size,
      lines: content.split('\n').length,
      sha256: createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex'),
      truncated,
      content: truncate(content, byteLimit),
    };
  } catch (err) {
    return {
      path: relPath,
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
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

function formatBundleContent(bundle: {
  root: string;
  dir: string;
  directorySummary: Array<{ path: string; type: 'file' | 'directory' | 'other'; size: number; modifiedAt: string }>;
  files: Array<{ path: string; size?: number; lines?: number; sha256?: string; truncated: boolean; content?: string; error?: string }>;
  diff?: string;
  notes: string[];
  truncated: boolean;
}) {
  const sections = [
    '# ChatGPT2LocalBridge Project Bundle',
    `Project: ${bundle.root}`,
    `Directory: ${bundle.dir}`,
    `Truncated: ${bundle.truncated ? 'yes' : 'no'}`,
  ];

  if (bundle.directorySummary.length) {
    sections.push(
      '',
      '## Directory Summary',
      bundle.directorySummary
        .map((entry) => `${entry.type.padEnd(9)} ${entry.path} (${entry.size} bytes)`)
        .join('\n'),
    );
  }

  if (bundle.files.length) {
    sections.push('', '## Files');
    for (const file of bundle.files) {
      const meta = [
        file.size == null ? undefined : `${file.size} bytes`,
        file.lines == null ? undefined : `${file.lines} lines`,
        file.sha256 ? `sha256=${file.sha256}` : undefined,
        file.truncated ? 'truncated' : undefined,
      ].filter(Boolean).join(', ');
      sections.push(`\n--- BEGIN FILE ${file.path}${meta ? ` (${meta})` : ''} ---`);
      sections.push(file.error ? `ERROR: ${file.error}` : file.content ?? '');
      sections.push(`--- END FILE ${file.path} ---`);
    }
  }

  if (bundle.diff) {
    sections.push('', '## Git Diff', bundle.diff);
  }

  if (bundle.notes.length) {
    sections.push('', '## Notes', bundle.notes.map((note) => `- ${note}`).join('\n'));
  }

  return sections.join('\n');
}

function normalizePolicy(policy: Partial<BridgePolicy>): BridgePolicy {
  const fallback = activeConfig?.policy ?? {
    allowedProjectRoots: [],
    skillRoots: [],
    denyGlobs: [],
    shell: { enabled: true, denyPatterns: [] },
  };
  return {
    allowedProjectRoots: (policy.allowedProjectRoots ?? fallback.allowedProjectRoots).map((entry) => path.resolve(expandHome(entry))),
    skillRoots: (policy.skillRoots ?? fallback.skillRoots).map((entry) => path.resolve(expandHome(entry))),
    denyGlobs: policy.denyGlobs ?? fallback.denyGlobs,
    shell: {
      enabled: policy.shell?.enabled ?? fallback.shell.enabled,
      denyPatterns: policy.shell?.denyPatterns ?? fallback.shell.denyPatterns,
    },
  };
}

function validatePolicy(policy: BridgePolicy) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!policy.allowedProjectRoots.length) {
    errors.push('allowedProjectRoots must include at least one approved workspace root.');
  }
  for (const root of policy.allowedProjectRoots) {
    const resolved = path.resolve(expandHome(root));
    if (!fs.existsSync(resolved)) warnings.push(`Allowed root does not exist yet: ${resolved}`);
    if (resolved === '/' || resolved === os.homedir() || resolved === path.dirname(os.homedir())) {
      warnings.push(`Allowed root is broad; prefer a specific workspace directory: ${resolved}`);
    }
  }

  for (const root of policy.skillRoots) {
    const resolved = path.resolve(expandHome(root));
    if (!fs.existsSync(resolved)) warnings.push(`Skill root does not exist yet: ${resolved}`);
    if (resolved.endsWith(`${path.sep}.codex`) || resolved === path.join(os.homedir(), '.codex')) {
      errors.push('Do not expose the whole ~/.codex directory. Use ~/.codex/skills instead.');
    }
  }

  const requiredDeny = ['**/.env', '**/.env.*', '**/*.key', '**/*.pem', '**/.ssh/**'];
  for (const pattern of requiredDeny) {
    if (!policy.denyGlobs.includes(pattern)) warnings.push(`Recommended deny glob is missing: ${pattern}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

function formatPolicySummary(policyPath: string, policy: BridgePolicy, warnings: string[]) {
  return [
    `Policy: ${policyPath}`,
    `Allowed roots:\n${policy.allowedProjectRoots.map((root) => `- ${root}`).join('\n') || '- none'}`,
    `Skill roots:\n${policy.skillRoots.map((root) => `- ${root}`).join('\n') || '- none'}`,
    `Shell: ${policy.shell.enabled ? 'enabled' : 'disabled'}`,
    warnings.length ? `Warnings:\n${warnings.map((warning) => `- ${warning}`).join('\n')}` : 'Warnings: none',
  ].join('\n\n');
}

function resolveSkillRoot(skillRoot?: string): string {
  const roots = knownSkillRoots();
  if (!roots.length) {
    throw new Error('No skill roots are configured. Add ~/.codex/skills to policy.skillRoots or create .codex/skills under an approved project.');
  }
  if (!skillRoot) return roots[0];

  const requested = path.resolve(expandHome(skillRoot));
  const requestedWithSep = requested.endsWith(path.sep) ? requested : `${requested}${path.sep}`;
  const ok = roots.some((root) => {
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    return requested === root || requestedWithSep.startsWith(rootWithSep);
  });
  if (!ok) {
    throw new Error(`Skill root is outside approved skill roots: ${requested}`);
  }
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) {
    throw new Error(`Skill root is not a directory: ${requested}`);
  }
  return requested;
}

function resolveSkillRootsForQuery(skillRoot?: string, projectPath?: string): string[] {
  if (skillRoot) return [resolveSkillRoot(skillRoot)];

  const roots = knownSkillRoots(projectPath);
  if (!roots.length) {
    throw new Error('No skill roots are configured. Add ~/.codex/skills to policy.skillRoots or create .codex/skills under an approved project.');
  }
  return roots;
}

function knownSkillRoots(projectPath?: string): string[] {
  const roots = configuredSkillRoots();
  const projectRoots = projectSkillRoots(projectPath)
    .filter((root) => !roots.includes(root));
  return [...roots, ...projectRoots];
}

function configuredSkillRoots(): string[] {
  const roots = (activeConfig?.policy.skillRoots ?? [])
    .map((entry) => path.resolve(expandHome(entry)))
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isDirectory());
  if (roots.length) return roots;

  const fallback = path.join(os.homedir(), '.codex', 'skills');
  return fs.existsSync(fallback) && fs.statSync(fallback).isDirectory() ? [fallback] : [];
}

function projectSkillRoots(projectPath?: string): string[] {
  const candidates = new Set<string>();
  const addRoot = (root: string) => {
    const skillRoot = path.join(root, '.codex', 'skills');
    if (fs.existsSync(skillRoot) && fs.statSync(skillRoot).isDirectory()) {
      candidates.add(path.resolve(skillRoot));
    }
  };

  if (projectPath) {
    addRoot(resolveProject(projectPath));
    return [...candidates];
  }

  for (const root of activeConfig?.policy.allowedProjectRoots ?? []) {
    const resolved = path.resolve(expandHome(root));
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) addRoot(resolved);
  }
  return [...candidates];
}

function resolveInsideSkillRoot(root: string, relPath: string): string {
  if (path.isAbsolute(relPath)) throw new Error(`Skill path must be relative: ${relPath}`);
  const fullPath = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (fullPath !== root && !fullPath.startsWith(rootWithSep)) {
    throw new Error(`Path outside skill root: ${relPath}`);
  }
  assertNotDeniedPath(root, fullPath);
  return fullPath;
}

function listLocalSkills(root: string, maxResults: number) {
  const skills: ReturnType<typeof skillRecord>[] = [];
  let truncated = false;

  function walk(dir: string) {
    if (truncated) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const skillFile = path.join(fullPath, 'SKILL.md');
        if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
          if (skills.length >= maxResults) {
            truncated = true;
            return;
          }
          skills.push(skillRecord(root, skillFile));
          continue;
        }
        walk(fullPath);
      }
    }
  }

  walk(root);
  skills.sort((a, b) => a.id.localeCompare(b.id));
  return { skills, truncated };
}

function listLocalSkillsAcrossRoots(roots: string[], maxResults: number) {
  const skills: ReturnType<typeof skillRecord>[] = [];
  let truncated = false;
  for (const root of roots) {
    if (skills.length >= maxResults) {
      truncated = true;
      break;
    }
    const result = listLocalSkills(root, maxResults - skills.length);
    skills.push(...result.skills);
    truncated = truncated || result.truncated;
  }
  const seen = new Set<string>();
  const unique = skills
    .sort((a, b) => a.id.localeCompare(b.id) || a.root.localeCompare(b.root))
    .filter((skill) => {
      const key = `${skill.root}:${skill.skillFile}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { skills: unique, truncated };
}

function skillRecord(root: string, skillFilePath: string) {
  const skillFile = path.relative(root, skillFilePath).split(path.sep).join('/');
  const directory = path.dirname(skillFile).split(path.sep).join('/');
  const content = safeReadText(skillFilePath, 120_000);
  const metadata = parseSkillMetadata(content);
  const id = directory === '.' ? metadata.name ?? path.basename(root) : directory;
  return {
    id,
    name: metadata.name ?? path.basename(directory),
    description: metadata.description,
    root,
    path: directory,
    directory,
    skillFile,
    activated: isSkillActivated(root, directory),
    source: skillRootSource(root),
  };
}

function skillRootSource(root: string): 'policy' | 'project' | 'fallback' {
  const resolved = path.resolve(root);
  if ((activeConfig?.policy.skillRoots ?? []).map((entry) => path.resolve(expandHome(entry))).includes(resolved)) return 'policy';
  if (resolved === path.join(os.homedir(), '.codex', 'skills')) return 'fallback';
  return 'project';
}

function parseSkillMetadata(content: string): { name?: string; description?: string } {
  const metadata: { name?: string; description?: string } = {};
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end > 0) {
      const frontmatter = content.slice(3, end).split('\n');
      for (const line of frontmatter) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
        if (!match) continue;
        const key = match[1].toLowerCase();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (key === 'name') metadata.name = value;
        if (key === 'description') metadata.description = value;
      }
    }
  }
  if (!metadata.description) {
    metadata.description = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#') && !line.startsWith('---') && !line.includes(':'));
  }
  return metadata;
}

function searchLocalSkills(root: string, query: string, maxResults: number) {
  const needle = query.toLowerCase();
  const skills = listLocalSkills(root, 1000).skills
    .map((skill) => {
      const fullPath = resolveInsideSkillRoot(root, skill.skillFile);
      const content = safeReadText(fullPath, 120_000);
      const haystack = `${skill.id}\n${skill.name}\n${skill.description ?? ''}\n${skill.path}\n${content}`.toLowerCase();
      const score = scoreText(haystack, needle, skill);
      const snippet = score > 0 ? snippetAround(content, needle) : undefined;
      return { ...skill, score, snippet };
    })
    .filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, maxResults);
  return skills;
}

function searchLocalSkillsAcrossRoots(roots: string[], query: string, maxResults: number) {
  return roots
    .flatMap((root) => searchLocalSkills(root, query, maxResults))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id) || a.root.localeCompare(b.root))
    .slice(0, maxResults);
}

function scoreText(haystack: string, needle: string, skill: { id: string; name: string; description?: string; path: string }) {
  const tokens = needle.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (skill.id.toLowerCase().includes(token)) score += 12;
    if (skill.name.toLowerCase().includes(token)) score += 10;
    if ((skill.description ?? '').toLowerCase().includes(token)) score += 7;
    if (skill.path.toLowerCase().includes(token)) score += 5;
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function snippetAround(content: string, lowerNeedle: string) {
  const lower = content.toLowerCase();
  const firstToken = lowerNeedle.split(/\s+/).find(Boolean) ?? lowerNeedle;
  const index = lower.indexOf(firstToken);
  if (index < 0) return content.slice(0, 240);
  const start = Math.max(0, index - 100);
  const end = Math.min(content.length, index + 180);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function findLocalSkill(root: string, requested: string) {
  const cleaned = requested.trim().replace(/^\/+/, '');
  const directCandidates = [
    cleaned,
    cleaned.endsWith('/SKILL.md') || cleaned === 'SKILL.md' ? cleaned : `${cleaned}/SKILL.md`,
  ];
  for (const candidate of directCandidates) {
    try {
      const fullPath = resolveInsideSkillRoot(root, candidate);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() && path.basename(fullPath) === 'SKILL.md') {
        return skillRecord(root, fullPath);
      }
    } catch {
      // Fall through to indexed lookup.
    }
  }

  const requestedLower = cleaned.toLowerCase();
  const record = listLocalSkills(root, 1000).skills.find((skill) => (
    skill.id.toLowerCase() === requestedLower
    || skill.name.toLowerCase() === requestedLower
    || skill.path.toLowerCase() === requestedLower
    || skill.skillFile.toLowerCase() === requestedLower
  ));
  if (!record) throw new Error(`Skill not found in ${root}: ${requested}`);
  return record;
}

function findLocalSkillAcrossRoots(roots: string[], requested: string): { root: string; record: ReturnType<typeof skillRecord> } {
  const errors: string[] = [];
  for (const root of roots) {
    try {
      return { root, record: findLocalSkill(root, requested) };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`Skill not found in approved skill roots: ${requested}${errors.length ? ` (${errors.join('; ')})` : ''}`);
}

function readSkillFile(root: string, relPath: string, maxBytes: number) {
  const fullPath = resolveInsideSkillRoot(root, relPath);
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${relPath}`);
  if (isBinaryFile(fullPath)) throw new Error(`Binary file: ${relPath}`);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const truncated = Buffer.byteLength(content, 'utf-8') > maxBytes;
  return {
    path: relPath,
    size: stat.size,
    sha256: createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex'),
    truncated,
    content: truncate(content, maxBytes),
  };
}

function bundleLocalSkill(
  root: string,
  record: ReturnType<typeof skillRecord>,
  includeReferences: boolean,
  activationId: string | undefined,
  maxReferenceFiles: number,
  maxBytes: number,
) {
  let remainingBytes = maxBytes;
  let truncated = false;
  const notes: string[] = [];
  const files: Array<{ path: string; size?: number; sha256?: string; truncated: boolean; content?: string; error?: string }> = [];

  function addFile(relPath: string) {
    if (remainingBytes <= 0) {
      truncated = true;
      notes.push(`${relPath}: skipped because maxBytes was reached`);
      return;
    }
    try {
      const read = readSkillFile(root, relPath, Math.min(remainingBytes, MAX_SKILL_FILE_BYTES));
      remainingBytes -= Buffer.byteLength(read.content, 'utf-8');
      truncated = truncated || read.truncated;
      files.push(read);
    } catch (err) {
      files.push({ path: relPath, truncated: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  addFile(record.skillFile);
  if (includeReferences && files[0]?.content) {
    if (!isValidSkillActivation(root, record.directory, activationId)) {
      notes.push('Reference files are gated. Call skill.read for this skill first, then call skill.bundle with the returned activationId.');
      return { files, truncated, notes };
    }
    const refs = extractSkillReferences(root, record, files[0].content).slice(0, maxReferenceFiles);
    for (const ref of refs) addFile(ref);
    if (refs.length >= maxReferenceFiles) notes.push('Reference files were limited by maxReferenceFiles.');
  }

  return { files, truncated, notes };
}

function extractSkillReferences(root: string, record: ReturnType<typeof skillRecord>, content: string): string[] {
  const skillDir = record.directory === '.' ? '' : record.directory;
  const candidates = new Set<string>();
  const markdownLinks = content.matchAll(/\]\(([^)]+)\)/g);
  for (const match of markdownLinks) candidates.add(match[1]);
  const backticks = content.matchAll(/`([^`\n]+\.(?:md|json|ya?ml|txt|toml|sh))`/gi);
  for (const match of backticks) candidates.add(match[1]);

  return [...candidates]
    .map((candidate) => candidate.trim().split('#')[0])
    .filter((candidate) => candidate && !candidate.startsWith('http:') && !candidate.startsWith('https:') && !candidate.startsWith('/'))
    .map((candidate) => (skillDir ? path.posix.join(skillDir, candidate) : candidate))
    .filter((candidate, index, list) => list.indexOf(candidate) === index)
    .filter((candidate) => {
      try {
        const fullPath = resolveInsideSkillRoot(root, candidate);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() && isTextLike(fullPath);
      } catch {
        return false;
      }
    });
}

function routeLocalSkills(root: string, task: string, maxResults: number) {
  const skills = searchLocalSkills(root, task, maxResults);
  return skills.map((skill) => ({
    ...skill,
    reason: skill.snippet
      ? `matched task terms in ${skill.id}: ${skill.snippet}`
      : `matched task terms in ${skill.id}`,
  }));
}

function routeLocalSkillsAcrossRoots(roots: string[], task: string, maxResults: number) {
  return roots
    .flatMap((root) => routeLocalSkills(root, task, maxResults))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id) || a.root.localeCompare(b.root))
    .slice(0, maxResults);
}

function formatSkillList(skills: Array<ReturnType<typeof skillRecord>>, truncated: boolean) {
  if (!skills.length) return 'No local skills found.';
  return `${skills.map((skill) => `${skill.id}: ${skill.description ?? skill.skillFile}`).join('\n')}${truncated ? '\n... (truncated)' : ''}`;
}

function formatSkillBundle(
  record: ReturnType<typeof skillRecord>,
  files: Array<{ path: string; content?: string; error?: string; truncated: boolean; sha256?: string; size?: number }>,
  notes: string[],
  truncated: boolean,
) {
  const sections = [
    '# ChatGPT2LocalBridge Skill Bundle',
    `Skill: ${record.id}`,
    `Root: ${record.root}`,
    `Truncated: ${truncated ? 'yes' : 'no'}`,
  ];
  for (const file of files) {
    const meta = [
      file.size == null ? undefined : `${file.size} bytes`,
      file.sha256 ? `sha256=${file.sha256}` : undefined,
      file.truncated ? 'truncated' : undefined,
    ].filter(Boolean).join(', ');
    sections.push('', `--- BEGIN FILE ${file.path}${meta ? ` (${meta})` : ''} ---`);
    sections.push(file.error ? `ERROR: ${file.error}` : file.content ?? '');
    sections.push(`--- END FILE ${file.path} ---`);
  }
  if (notes.length) sections.push('', '## Notes', notes.map((note) => `- ${note}`).join('\n'));
  return sections.join('\n');
}

function safeReadText(filePath: string, maxBytes: number) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return truncate(content, maxBytes);
  } catch {
    return '';
  }
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
      'User-Agent': `ChatGPT2LocalBridge/${BRIDGE_VERSION}`,
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

function readSkillActivations(): ActivatedSkillRecord[] {
  return readJsonFile<ActivatedSkillRecord[]>(SKILL_ACTIVATION_FILE, []);
}

function writeSkillActivations(records: ActivatedSkillRecord[]) {
  writeJsonFile(SKILL_ACTIVATION_FILE, records);
}

function skillActivationKey(root: string, directory: string): string {
  return `${path.resolve(root)}::${directory}`;
}

function findSkillActivation(root: string, directory: string): ActivatedSkillRecord | undefined {
  const key = skillActivationKey(root, directory);
  return readSkillActivations().find((record) => skillActivationKey(record.root, record.directory) === key);
}

function isSkillActivated(root: string, directory: string): boolean {
  return Boolean(findSkillActivation(root, directory));
}

function isValidSkillActivation(root: string, directory: string, activationId: string | undefined): boolean {
  if (!activationId) return false;
  return findSkillActivation(root, directory)?.activationId === activationId;
}

function markSkillActivated(root: string, record: ReturnType<typeof skillRecord>): ActivatedSkillRecord {
  const key = skillActivationKey(root, record.directory);
  const now = nowIso();
  const records = readSkillActivations().filter((item) => skillActivationKey(item.root, item.directory) !== key);
  const activated: ActivatedSkillRecord = {
    id: record.id,
    root: path.resolve(root),
    directory: record.directory,
    skillFile: record.skillFile,
    activationId: `skillact_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`,
    activatedAt: now,
  };
  records.push(activated);
  writeSkillActivations(records.sort((a, b) => a.id.localeCompare(b.id) || a.root.localeCompare(b.root)));
  auditEvent('skill.activate', { skill: record.id, root, directory: record.directory, skillFile: record.skillFile });
  return activated;
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

function syncTraceContextForTask(taskId: string, projectPath: string | undefined, requestContext: SafeRequestContext): void {
  const session = readActiveTraceSession();
  const now = nowIso();
  if (session) {
    session.taskId = taskId;
    session.projectPath = projectPath || session.projectPath;
    session.connectorProfile = requestContext.connectorProfile || session.connectorProfile;
    session.updatedAt = now;
    writeTraceSession(session);
  } else {
    const title = `Task ${taskId}`;
    startTraceSession({
      title,
      projectPath: projectPath,
      connectorProfile: requestContext.connectorProfile,
      taskId,
    });
  }
  activeTraceTaskIdCache = taskId;
}

function currentTraceSessionId(): string | undefined {
  return readActiveTraceSession()?.id;
}

function activeTraceTaskId(): string | undefined {
  return activeTraceTaskIdCache || readActiveTraceSession()?.taskId;
}

function startTraceSession(params: {
  title: string;
  projectPath?: string;
  connectorProfile?: string;
  taskId?: string;
  requestContext?: SafeRequestContext;
}): TraceSessionRecord {
  const now = nowIso();
  const nowMs = Date.now();
  const session: TraceSessionRecord = {
    id: `trace_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: params.title,
    projectPath: params.projectPath,
    connectorProfile: params.connectorProfile || params.requestContext?.connectorProfile,
    taskId: params.taskId,
    status: 'active',
    startedAt: now,
    updatedAt: now,
  };
  writeTraceSession(session);
  return session;
}

function readActiveTraceSession(): TraceSessionRecord | undefined {
  const file = runtimeFile(TRACE_SESSION_FILE);
  if (!fs.existsSync(file)) return undefined;
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf-8')) as TraceSessionRecord;
    return record.status === 'active' ? record : undefined;
  } catch {
    return undefined;
  }
}

function writeTraceSession(session: TraceSessionRecord | null): void {
  if (!session) {
    const file = runtimeFile(TRACE_SESSION_FILE);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.writeFileSync(runtimeFile(TRACE_SESSION_FILE), `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

function endTraceSession(sessionId?: string, _note?: string): TraceSessionRecord | undefined {
  const session = readActiveTraceSession();
  if (!session) return undefined;
  if (sessionId && session.id !== sessionId) return undefined;

  session.status = 'ended';
  session.updatedAt = nowIso();
  session.endedAt = session.updatedAt;
  writeTraceSession(null);
  return session;
}

function readTasks(): TaskRecord[] {
  return readJsonFile<TaskRecord[]>('tasks.json', []);
}

function writeTasks(tasks: TaskRecord[]) {
  writeJsonFile('tasks.json', tasks);
}

function nowIso(): string {
  return new Date().toISOString();
}

function createHandoff(input: HandoffCreateInput): { handoff: HandoffPackage; task: TaskRecord } {
  const config = activeConfig;
  if (!config) throw new Error('Bridge config is not initialized');
  const root = input.projectPath
    ? resolveProject(input.projectPath)
    : input.workspace
      ? resolveWorkspaceRecord(input.workspace).path
      : undefined;
  if (!root) throw new Error('handoff.create requires projectPath or workspace.');

  const now = nowIso();
  const id = `handoff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const routedSkills = routeSkillsForHandoff(input, root);
  const handoff: HandoffPackage = {
    version: '1',
    id,
    title: input.title.trim(),
    objective: input.objective.trim(),
    projectPath: root,
    workspace: input.workspace,
    constraints: normalizeStringList(input.constraints),
    allowedOperations: Array.from(new Set(input.allowedOperations)),
    testCommands: normalizeStringList(input.testCommands ?? []),
    expectedArtifacts: normalizeStringList(input.expectedArtifacts ?? []),
    riskLevel: input.riskLevel ?? 'medium',
    acceptanceCriteria: normalizeStringList(input.acceptanceCriteria ?? []),
    skillContext: normalizeStringList([...(input.skillContext ?? []), ...routedSkills.context]),
    skillActivations: routedSkills.activations,
    notes: normalizeOptionalNotes(input.notes),
    createdAt: now,
    updatedAt: now,
  };
  if (!handoff.constraints.length) throw new Error('handoff.create requires at least one constraint.');
  if (!handoff.allowedOperations.length) throw new Error('handoff.create requires at least one allowed operation.');

  const handoffDir = path.join(config.dataDir, 'handoffs');
  fs.mkdirSync(handoffDir, { recursive: true });
  const handoffFile = path.join(handoffDir, `${id}.json`);
  fs.writeFileSync(handoffFile, `${JSON.stringify(handoff, null, 2)}\n`);

  const task: TaskRecord = {
    id,
    title: handoff.title,
    workspace: handoff.workspace,
    projectPath: handoff.projectPath,
    status: 'active',
    notes: [{ ts: now, text: `handoff.created risk=${handoff.riskLevel}; operations=${handoff.allowedOperations.join(',')}` }],
    createdAt: now,
    updatedAt: now,
    handoffId: id,
    handoffFile,
    handoff,
  };
  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  auditEvent('handoff.create', {
    id,
    title: handoff.title,
    projectPath: handoff.projectPath,
    workspace: handoff.workspace,
    riskLevel: handoff.riskLevel,
    allowedOperations: handoff.allowedOperations,
    handoffFile,
  });
  return { handoff, task };
}

function normalizeStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function routeSkillsForHandoff(input: HandoffCreateInput, projectPath: string): { context: string[]; activations: HandoffSkillActivation[] } {
  const task = input.skillTask?.trim();
  const limit = input.maxSkillContext ?? 3;
  if (!task || limit <= 0) return { context: [], activations: [] };

  const roots = resolveSkillRootsForQuery(input.skillRoot, projectPath);
  const recommendations = routeLocalSkillsAcrossRoots(roots, task, limit);
  return {
    context: recommendations.map((skill) => [
      `skill: ${skill.id}`,
      `name: ${skill.name}`,
      skill.description ? `description: ${skill.description}` : undefined,
      `file: ${path.posix.join(skill.root, skill.skillFile)}`,
      `activated: ${skill.activated ? 'yes' : 'no'}`,
      `reason: ${skill.reason}`,
      'next: call skill.read before using referenced files; skill.bundle references are gated until activation',
    ].filter(Boolean).join(' | ')),
    activations: recommendations.map((skill) => ({
      id: skill.id,
      name: skill.name,
      root: skill.root,
      skillFile: skill.skillFile,
      activated: Boolean(skill.activated),
      reason: skill.reason,
    })),
  };
}

function normalizeOptionalNotes(value: HandoffCreateInput['notes']): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return normalizeStringList(value).join('\n') || undefined;
  return value.trim() || undefined;
}

function readHandoff(handoffId: string): HandoffPackage {
  const config = activeConfig;
  if (!config) throw new Error('Bridge config is not initialized');
  const tasks = readTasks();
  const task = tasks.find((item) => item.handoffId === handoffId || item.id === handoffId);
  if (task?.handoff) return task.handoff;
  const file = task?.handoffFile ?? path.join(config.dataDir, 'handoffs', `${handoffId}.json`);
  if (!pathIsInsideRoot(path.resolve(file), path.join(config.dataDir, 'handoffs'))) {
    throw new Error(`Handoff file is outside runtime handoff directory: ${file}`);
  }
  if (!fs.existsSync(file)) throw new Error(`Handoff not found: ${handoffId}`);
  const handoff = JSON.parse(fs.readFileSync(file, 'utf-8')) as HandoffPackage;
  resolveProject(handoff.projectPath);
  return handoff;
}

function formatHandoffPrompt(handoff: HandoffPackage): string {
  return [
    `Handoff: ${handoff.title}`,
    '',
    'Objective:',
    handoff.objective,
    '',
    `Project root: ${handoff.projectPath}`,
    `Risk level: ${handoff.riskLevel}`,
    `Allowed operations: ${handoff.allowedOperations.join(', ')}`,
    '',
    'Constraints:',
    ...handoff.constraints.map((item) => `- ${item}`),
    handoff.testCommands.length ? '\nTest commands:' : '',
    ...handoff.testCommands.map((item) => `- ${item}`),
    handoff.expectedArtifacts.length ? '\nExpected artifacts:' : '',
    ...handoff.expectedArtifacts.map((item) => `- ${item}`),
    handoff.acceptanceCriteria.length ? '\nAcceptance criteria:' : '',
    ...handoff.acceptanceCriteria.map((item) => `- ${item}`),
    handoff.skillContext.length ? '\nSkill context:' : '',
    ...handoff.skillContext.map((item) => `- ${item}`),
    handoff.notes ? '\nNotes:' : '',
    handoff.notes ?? '',
    '',
    'Runner instructions:',
    '- Operate only inside the approved project root.',
    '- Keep changes scoped to the handoff objective.',
    '- Before finishing, report changed files and tests run.',
    '- Do not commit changes unless the handoff explicitly asks for it.',
  ].filter((line) => line !== '').join('\n');
}

function startTask(title: string, workspace?: string, projectPath?: string): TaskRecord {
  const now = nowIso();
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
  const task = refreshCodexRunnerTasks().find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function updateTask(taskId: string, patch: Partial<Omit<TaskRecord, 'id' | 'notes' | 'createdAt'>> & { note?: string }): TaskRecord {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) throw new Error(`Task not found: ${taskId}`);
  const now = nowIso();
  const task = tasks[index];
  const { note, ...fields } = patch;
  Object.assign(task, fields);
  if (note) task.notes.push({ ts: now, text: note });
  task.updatedAt = fields.updatedAt ?? now;
  tasks[index] = task;
  writeTasks(tasks);
  auditEvent('task.update', { id: task.id, status: task.status, note: patch.note });
  return task;
}

function formatTask(task: TaskRecord) {
  return `${task.id} [${task.status}] ${task.title}${task.workspace ? ` workspace=${task.workspace}` : ''}${task.projectPath ? ` path=${task.projectPath}` : ''}`;
}

function listCodexRunnerTasks(taskId: string | undefined, limit: number): TaskRecord[] {
  const tasks = refreshCodexRunnerTasks();
  if (taskId) return [getTask(taskId)];
  return tasks
    .filter(isCodexRunnerTask)
    .slice(-limit)
    .reverse();
}

function isCodexRunnerTask(task: TaskRecord): boolean {
  return task.id.startsWith('codex_')
    || task.notes.some((note) => note.text.includes('codex.mode='))
    || task.logFile?.includes('codex-runs') === true
    || task.command?.includes(' exec --json --cd ') === true;
}

function codexProviderStatus() {
  const provider = activeConfig?.codexProvider ?? {
    kind: 'official' as const,
    apiKeyEnv: 'OPENAI_API_KEY',
  };
  return {
    kind: provider.kind,
    profile: provider.profile,
    codexHome: provider.codexHome,
    model: provider.model,
    baseUrlHost: provider.baseUrl ? safeUrlHost(provider.baseUrl) : undefined,
    codexBin: resolveCodexBinary(),
    apiKeyEnv: provider.apiKeyEnv,
    apiKeyConfigured: Boolean(process.env[provider.apiKeyEnv]),
  };
}

function safeUrlHost(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function buildCodexRunnerEnv(config: BridgeConfig): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.PATH = buildCodexRunnerPath(env.PATH);
  const provider = config.codexProvider;
  if (provider.codexHome) env.CODEX_HOME = provider.codexHome;
  if (provider.model) env.CODEX_MODEL = provider.model;
  if (provider.profile) env.CODEX_PROFILE = provider.profile;
  if (provider.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl;
  if (provider.apiKeyEnv !== 'OPENAI_API_KEY' && process.env[provider.apiKeyEnv]) {
    env.OPENAI_API_KEY = process.env[provider.apiKeyEnv];
  }
  return env;
}

function resolveCodexBinary(): string {
  const configured = process.env.LOCALBRIDGE_CODEX_BIN || process.env.CODEX_BIN;
  if (configured?.trim()) return expandExecutablePath(configured.trim());
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    path.join(os.homedir(), '.local', 'node', 'current', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    '/usr/bin/codex',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? 'codex';
}

function expandExecutablePath(value: string): string {
  if (value === '~' || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function buildCodexRunnerPath(currentPath: string | undefined): string {
  const entries = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.local', 'node', 'current', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    ...(currentPath ? currentPath.split(path.delimiter) : []),
  ];
  return [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

function formatCodexSpawnError(err: Error, codexBin: string): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return `codex runner failed to start: executable not found (${codexBin}). Set LOCALBRIDGE_CODEX_BIN=/absolute/path/to/codex or make sure codex is installed in ~/.local/bin, ~/.local/node/current/bin, /opt/homebrew/bin, or /usr/local/bin for launchd/App services.`;
  }
  return `codex runner failed to start: ${err.message}`;
}

function startCodexRunnerTask(
  title: string | undefined,
  workspace: string | undefined,
  projectPath: string | undefined,
  mode: 'normal' | 'debug',
  timeoutMs: number,
  handoffId?: string,
): TaskRecord {
  const config = activeConfig;
  if (!config) throw new Error('Bridge config is not initialized');
  const handoff = handoffId ? readHandoff(handoffId) : undefined;
  const effectiveWorkspace = handoff?.workspace ?? workspace;
  const root = handoff
    ? resolveProject(handoff.projectPath)
    : projectPath
      ? resolveProject(projectPath)
      : workspace
        ? resolveWorkspaceRecord(workspace).path
        : undefined;
  if (!root) throw new Error('codex.task_start requires projectPath or workspace.');
  const effectiveTitle = handoff?.title ?? title?.trim();
  if (!effectiveTitle) throw new Error('codex.task_start requires task when handoffId is not provided.');

  const now = nowIso();
  const id = `codex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const logDir = path.join(config.dataDir, 'codex-runs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${id}.jsonl`);
  const resultFile = path.join(logDir, `${id}.last-message.txt`);
  const codexBin = resolveCodexBinary();
  const provider = codexProviderStatus();
  const prompt = handoff ? formatHandoffPrompt(handoff) : [
    effectiveTitle,
    '',
    'Operate only inside the approved project root. Keep changes scoped.',
    'Before finishing, report changed files and any tests you ran.',
  ].join('\n');
  const args = [
    'exec',
    '--json',
    '--cd', root,
    '--sandbox', 'danger-full-access',
    '--dangerously-bypass-approvals-and-sandbox',
    '--output-last-message', resultFile,
    prompt,
  ];
  const command = [codexBin, ...args.map(shellQuote)].join(' ');
  const task: TaskRecord = {
    id,
    title: effectiveTitle,
    workspace: effectiveWorkspace,
    projectPath: root,
    status: 'running',
    notes: [{ ts: now, text: `codex.mode=${mode}; timeoutMs=${timeoutMs}; provider=${provider.kind}${provider.baseUrlHost ? `@${provider.baseUrlHost}` : ''}${handoff ? `; handoffId=${handoff.id}; risk=${handoff.riskLevel}` : ''}` }],
    createdAt: now,
    updatedAt: now,
    mode,
    timeoutMs,
    command,
    logFile,
    resultFile,
    handoffId: handoff?.id,
    handoffFile: handoff ? path.join(config.dataDir, 'handoffs', `${handoff.id}.json`) : undefined,
    handoff,
    startedAt: now,
    changedFiles: [],
    diffPreview: '',
    testResult: 'No test result captured yet.',
  };

  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  auditEvent('codex.task_start', { id, title: effectiveTitle, workspace: effectiveWorkspace, projectPath: root, mode, timeoutMs, logFile, resultFile, handoffId: handoff?.id, provider });

  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  stream.write(`${JSON.stringify({ ts: now, event: 'runner.start', command, projectPath: root, provider })}\n`);
  let timedOut = false;
  try {
    const child = spawn(codexBin, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildCodexRunnerEnv(config),
    });
    child.stdout?.pipe(stream, { end: false });
    child.stderr?.pipe(stream, { end: false });
    updateTask(id, { pid: child.pid ?? 0 });

    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timeout);
      const message = formatCodexSpawnError(err, codexBin);
      stream.write(`${JSON.stringify({ ts: nowIso(), event: 'runner.error', error: message })}\n`);
      stream.end();
      updateTask(id, {
        status: 'failed',
        completedAt: nowIso(),
        testResult: message,
        note: message,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const completedAt = nowIso();
      const next = refreshCodexTaskResult({
        ...getTask(id),
        status: timedOut ? 'failed' : code === 0 ? 'success' : 'failed',
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        completedAt,
        updatedAt: completedAt,
      });
      stream.write(`${JSON.stringify({ ts: completedAt, event: 'runner.close', code, signal, status: next.status })}\n`);
      stream.end();
      updateTask(id, {
        ...next,
        note: timedOut ? `codex runner timed out after ${timeoutMs}ms` : `codex runner exited code=${code ?? '-'} signal=${signal ?? '-'}`,
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stream.write(`${JSON.stringify({ ts: nowIso(), event: 'runner.error', error: message })}\n`);
    stream.end();
    return updateTask(id, {
      status: 'failed',
      completedAt: nowIso(),
      testResult: message,
      note: `codex runner failed: ${message}`,
    });
  }

  return getTask(id);
}

function refreshCodexRunnerTasks(): TaskRecord[] {
  let changed = false;
  const tasks = readTasks().map((task) => {
    if (task.status === 'running' && task.pid && !isPidRunning(task.pid)) {
      changed = true;
      return refreshCodexTaskResult({
        ...task,
        status: 'failed',
        completedAt: task.completedAt ?? nowIso(),
        updatedAt: nowIso(),
        notes: [
          ...task.notes,
          { ts: nowIso(), text: 'runner process is no longer alive; exact exit code was not captured' },
        ],
      });
    }
    return task.projectPath ? refreshCodexTaskResult(task) : task;
  });
  if (changed) writeTasks(tasks);
  return tasks;
}

function compactCodexTask(task: TaskRecord): TaskRecord {
  return {
    id: task.id,
    title: task.title,
    workspace: task.workspace,
    projectPath: task.projectPath,
    status: task.status,
    notes: task.notes.slice(-3),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    mode: task.mode,
    timeoutMs: task.timeoutMs,
    handoffId: task.handoffId,
    handoff: task.handoff,
    exitCode: task.exitCode,
    signal: task.signal,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    changedFiles: task.changedFiles?.slice(0, 80),
    testResult: task.testResult,
  };
}

function refreshCodexTaskResult(task: TaskRecord): TaskRecord {
  if (!task.projectPath) return task;
  const hasGit = isGitWorkTree(task.projectPath);
  const changedFiles = hasGit ? getChangedFiles(task.projectPath).map((file) => ({
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    insertions: file.insertions,
    deletions: file.deletions,
  })) : [];
  const diffPreview = hasGit ? truncate(getRawDiff(task.projectPath), 60_000) : '';
  const lastMessage = task.resultFile && fs.existsSync(task.resultFile)
    ? truncate(fs.readFileSync(task.resultFile, 'utf-8'), 20_000)
    : '';
  return {
    ...task,
    changedFiles,
    diffPreview,
    testResult: extractTestResult(lastMessage || (task.logFile ? readTextTail(task.logFile, 20_000) : '')) || task.testResult || 'No test result captured yet.',
  };
}

function isGitWorkTree(projectPath: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectPath,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function cancelCodexRunnerTask(taskId: string): TaskRecord {
  const task = getTask(taskId);
  if (task.status === 'running' && task.pid) {
    try {
      process.kill(task.pid, 'SIGTERM');
    } catch {}
  }
  return updateTask(taskId, {
    status: 'cancelled',
    completedAt: nowIso(),
    note: 'cancelled by codex.cancel',
  });
}

function readTextTail(file: string, maxBytes: number): string {
  if (!fs.existsSync(file)) return '';
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

function extractTestResult(text: string): string {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const matches = lines.filter((line) => /test|passed|failed|ok|exit|error/i.test(line)).slice(-12);
  return matches.join('\n');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
