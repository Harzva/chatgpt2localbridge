import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectSnapshot } from './types.js';

// ── Project Snapshot ────────────────────────────────────────────────────────
//
// Gives ChatGPT lightweight context about the target project without dumping
// the entire file tree or file contents into the model's context.

export function snapshotProject(projectPath: string): ProjectSnapshot {
  const resolved = path.resolve(projectPath);
  const isGitRepo = checkGitRepo(resolved);
  const entries = listTopLevel(resolved);
  const { language, packageManager } = detectProjectType(resolved, entries);

  return {
    path: resolved,
    branch: isGitRepo ? gitBranch(resolved) : 'n/a',
    isGitRepo,
    headCommit: isGitRepo ? gitHead(resolved) : undefined,
    isDirty: isGitRepo ? gitIsDirty(resolved) : false,
    entries,
    language,
    packageManager,
  };
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode',
  'target', 'bin', 'obj', '.gradle', 'coverage',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.cs', '.php', '.scala', '.clj', '.ex', '.exs', '.dart', '.lua',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.env',
  '.md', '.txt', '.sh', '.bash', '.sql', '.graphql', '.proto',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.svg',
]);

interface TreeFile { path: string; lines: number; size: number; }

export function snapshotProjectWithTree(projectPath: string, maxDepth: number = 3) {
  const base = snapshotProject(projectPath);
  const files: TreeFile[] = [];
  let totalLines = 0;

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(projectPath, full);
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      try {
        const stat = fs.statSync(full);
        const content = fs.readFileSync(full, 'utf-8');
        const lineCount = content.split('\n').length;
        totalLines += lineCount;
        files.push({ path: rel, lines: lineCount, size: stat.size });
      } catch {}
    }
  }

  walk(path.resolve(projectPath), 0);
  files.sort((a, b) => b.lines - a.lines);

  return {
    ...base,
    fileTree: files.slice(0, 100),
    totalFiles: files.length,
    totalLines,
  };
}

function checkGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function gitBranch(dir: string): string {
  try {
    return execSync('git branch --show-current', { cwd: dir, encoding: 'utf-8' }).trim() || 'detached';
  } catch {
    return 'unknown';
  }
}

function gitHead(dir: string): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function gitIsDirty(dir: string): boolean {
  try {
    const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function listTopLevel(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter(e => !e.startsWith('.') || e === '.env' || e === '.gitignore')
      .sort();
  } catch {
    return [];
  }
}

function detectProjectType(dir: string, entries: string[]): { language?: string; packageManager?: string } {
  const has = (name: string) => entries.includes(name);

  // Node / TS / JS
  if (has('package.json')) {
    let language = 'javascript';
    if (has('tsconfig.json') || entries.some(e => e.endsWith('.ts'))) language = 'typescript';
    let packageManager = 'npm';
    if (has('pnpm-lock.yaml')) packageManager = 'pnpm';
    else if (has('yarn.lock')) packageManager = 'yarn';
    else if (has('bun.lockb') || has('bun.lock')) packageManager = 'bun';
    return { language, packageManager };
  }

  // Python
  if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
    const packageManager = has('uv.lock') ? 'uv' : has('poetry.lock') ? 'poetry' : 'pip';
    return { language: 'python', packageManager };
  }

  // Rust
  if (has('Cargo.toml')) return { language: 'rust', packageManager: 'cargo' };

  // Go
  if (has('go.mod')) return { language: 'go', packageManager: 'go' };

  return {};
}
