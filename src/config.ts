import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface BridgePolicy {
  allowedProjectRoots: string[];
  skillRoots: string[];
  denyGlobs: string[];
  shell: {
    enabled: boolean;
    denyPatterns: string[];
  };
}

export type BridgeToolProfile = 'normal' | 'debug' | 'codex-runner-only' | 'chatgpt-app';

export interface BridgeConfig {
  /** Where to store run data on disk */
  dataDir: string;
  /** Where launchd/stdout logs are written */
  logDir: string;
  /** Optional bearer/header token for HTTP MCP requests */
  authToken?: string;
  /** Allow MCP URL query token auth for clients that cannot send headers */
  allowUrlTokenAuth: boolean;
  /** OAuth settings for hosted MCP clients such as ChatGPT connectors */
  oauth: {
    enabled: boolean;
    publicBaseUrl?: string;
    unlockCode?: string;
    tokenTtlSeconds: number;
    codeTtlSeconds: number;
    scopes: string[];
  };
  /** Local browser console for operators */
  dashboard: {
    token?: string;
  };
  /** Policy controlling filesystem and shell boundaries */
  policyPath: string;
  policy: BridgePolicy;
  /** Controls which MCP tools are exposed to hosted clients */
  toolProfile: BridgeToolProfile;
  /** Optional provider settings for Codex Runner */
  codexProvider: CodexProviderConfig;
}

export type CodexProviderKind = 'official' | 'openai-compatible' | 'sub2api';

export interface CodexProviderConfig {
  kind: CodexProviderKind;
  profile?: string;
  codexHome?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv: string;
}

export function loadConfig(): BridgeConfig {
  const dataDir = env('DATA_DIR')
    ?? path.join(os.homedir(), '.chatgpt2localbridge');
  const logDir = env('LOG_DIR')
    ?? path.join(dataDir, 'logs');
  const authToken = env('AUTH_TOKEN') || undefined;
  const allowUrlTokenAuth = env('ALLOW_URL_TOKEN') === '1'
    || env('ALLOW_URL_TOKEN') === 'true';
  const oauthScopes = (env('OAUTH_SCOPES')
    ?? 'workspace:read workspace:write shell:exec')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const oauth = {
    enabled: env('OAUTH_ENABLED') === '1'
      || env('OAUTH_ENABLED') === 'true',
    publicBaseUrl: env('PUBLIC_BASE_URL') || undefined,
    unlockCode: env('OAUTH_UNLOCK_CODE') || undefined,
    tokenTtlSeconds: parsePositiveInt(env('OAUTH_TOKEN_TTL_SECONDS'), 7 * 24 * 60 * 60),
    codeTtlSeconds: parsePositiveInt(env('OAUTH_CODE_TTL_SECONDS'), 10 * 60),
    scopes: oauthScopes.length > 0 ? oauthScopes : ['workspace:read', 'workspace:write', 'shell:exec'],
  };
  const dashboard = {
    token: env('DASHBOARD_TOKEN') || undefined,
  };
  const policyPath = resolvePolicyPath(env('POLICY_PATH'));
  const policy = loadPolicy(policyPath);
  const toolProfile = parseToolProfile(env('TOOL_PROFILE'));
  const codexProvider = loadCodexProvider();

  return {
    dataDir,
    logDir,
    authToken,
    allowUrlTokenAuth,
    oauth,
    dashboard,
    policyPath,
    policy,
    toolProfile,
    codexProvider,
  };
}

function env(name: string): string | undefined {
  return process.env[`LOCALBRIDGE_${name}`];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseToolProfile(value: string | undefined): BridgeToolProfile {
  const normalized = (value ?? 'normal').trim().toLowerCase();
  switch (normalized) {
    case 'full':
    case 'debug':
    case 'all':
      return 'debug';
    case 'minimal':
    case 'public':
    case 'connector':
    case 'connector-minimal':
      return 'chatgpt-app';
    case 'codex':
    case 'codex-runner':
    case 'codex-runner-only':
    case 'codexrunner':
      return 'codex-runner-only';
    case 'chatgpt':
    case 'chatgpt-app':
    case 'app':
      return 'chatgpt-app';
    case 'standard':
    case 'normal':
    default:
      return 'normal';
  }
}

function loadCodexProvider(): CodexProviderConfig {
  const rawKind = (env('CODEX_PROVIDER') ?? 'official').trim().toLowerCase();
  const kind: CodexProviderKind = rawKind === 'sub2api'
    ? 'sub2api'
    : rawKind === 'openai-compatible' || rawKind === 'openai_compatible' || rawKind === 'compatible'
      ? 'openai-compatible'
      : 'official';
  const apiKeyEnv = env('CODEX_API_KEY_ENV')?.trim() || 'OPENAI_API_KEY';
  return {
    kind,
    profile: env('CODEX_PROFILE') || undefined,
    codexHome: env('CODEX_HOME') ? path.resolve(expandHome(env('CODEX_HOME') ?? '')) : undefined,
    model: env('CODEX_MODEL') || undefined,
    baseUrl: env('CODEX_BASE_URL') || env('OPENAI_BASE_URL') || undefined,
    apiKeyEnv,
  };
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : value;
}

function resolvePolicyPath(policyPath?: string): string {
  return policyPath ? path.resolve(expandHome(policyPath)) : path.resolve(process.cwd(), 'bridge.policy.json');
}

function loadPolicy(policyPath: string): BridgePolicy {
  const defaultSkillRoot = path.join(os.homedir(), '.codex', 'skills');
  const defaults: BridgePolicy = {
    allowedProjectRoots: [os.homedir()],
    skillRoots: fs.existsSync(defaultSkillRoot) ? [defaultSkillRoot] : [],
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
  };

  if (!fs.existsSync(policyPath)) return defaults;

  try {
    const raw = JSON.parse(fs.readFileSync(policyPath, 'utf-8')) as Partial<BridgePolicy>;
    return {
      allowedProjectRoots: raw.allowedProjectRoots ?? defaults.allowedProjectRoots,
      skillRoots: raw.skillRoots ?? defaults.skillRoots,
      denyGlobs: raw.denyGlobs ?? defaults.denyGlobs,
      shell: {
        enabled: raw.shell?.enabled ?? defaults.shell.enabled,
        denyPatterns: raw.shell?.denyPatterns ?? defaults.shell.denyPatterns,
      },
    };
  } catch (err) {
    console.error(`[bridge] Failed to load policy ${policyPath}:`, err);
    return defaults;
  }
}
