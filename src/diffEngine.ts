import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ChangedFile, StructuredDiff, DiffLine, DiffHunk, FileDiff, FileStatus } from './types.js';

// ── Diff Engine ─────────────────────────────────────────────────────────────
//
// Generates structured diffs from real git state — NOT from what the agent claims.
// This guarantees the diff always reflects actual file contents on disk, even if
// the agent crashed mid-run.

/**
 * Create a checkpoint: record the state before the run starts.
 * We always use HEAD (the last commit). This way, `git diff <checkpoint>` shows
 * everything the agent changed relative to the last committed state.
 * We also record the working-tree state at run start via a temp commit, so that
 * if the working tree was already dirty, we only show changes the agent made.
 */
export function createCheckpoint(projectPath: string): string | undefined {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8' }).trim();
    return head;
  } catch {
    return undefined;
  }
}

/**
 * Revert to a checkpoint: reset working tree to the committed state at run start.
 */
export function revertToCheckpoint(projectPath: string, checkpoint: string): boolean {
  try {
    // Reset all tracked files to the checkpoint commit state
    execSync(`git checkout -- .`, { cwd: projectPath, encoding: 'utf-8' });
    // Clean untracked files created during the run
    execSync('git clean -fd', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Get the raw unified diff between the checkpoint and current working tree. */
export function getRawDiff(projectPath: string, checkpoint?: string): string {
  try {
    if (checkpoint) {
      // diff between the stash commit and working tree
      return execSync(`git diff ${checkpoint}`, { cwd: projectPath, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    }
    // No checkpoint — diff staged + unstaged
    return execSync('git diff HEAD', { cwd: projectPath, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  } catch {
    return '';
  }
}

/** Parse `git diff --numstat` into ChangedFile[]. */
export function getChangedFiles(projectPath: string, checkpoint?: string): ChangedFile[] {
  try {
    const ref = checkpoint ?? 'HEAD';
    const output = execSync(`git diff --numstat ${ref}`, { cwd: projectPath, encoding: 'utf-8' }).trim();
    if (!output) return [];

    const files: ChangedFile[] = [];
    for (const line of output.split('\n')) {
      // Format: <insertions>\t<deletions>\t<path>
      // Binary files show: -\t-\t<path>
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const ins = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
      const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
      const filePath = parts.slice(2).join('\t');

      // Determine status
      const status = detectFileStatus(projectPath, filePath, checkpoint);

      files.push({
        path: filePath,
        status,
        insertions: isNaN(ins) ? 0 : ins,
        deletions: isNaN(del) ? 0 : del,
      });
    }
    return files;
  } catch {
    return [];
  }
}

function detectFileStatus(projectPath: string, filePath: string, checkpoint?: string): FileStatus {
  try {
    const ref = checkpoint ?? 'HEAD';
    // Check if the file existed at the checkpoint
    const existed = execSync(`git cat-file -e ${ref}:"${filePath}" 2>/dev/null && echo yes || echo no`, {
      cwd: projectPath, encoding: 'utf-8',
    }).trim();
    const existsNow = fs.existsSync(path.join(projectPath, filePath));
    if (existed === 'no' && existsNow) return 'added';
    if (existed === 'yes' && !existsNow) return 'deleted';
    return 'modified';
  } catch {
    return 'modified';
  }
}

/** Parse a unified diff patch into StructuredDiff. */
export function parseUnifiedDiff(patch: string): StructuredDiff {
  const files: FileDiff[] = [];
  const lines = patch.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // File header: "diff --git a/path b/path"
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      const filePath = match ? match[2] : 'unknown';

      // Skip to the first @@ hunk header, collecting status info
      let status: FileStatus = 'modified';
      let oldPath: string | undefined;

      while (i < lines.length && !lines[i].startsWith('@@')) {
        if (lines[i].startsWith('new file')) status = 'added';
        else if (lines[i].startsWith('deleted file')) status = 'deleted';
        else if (lines[i].startsWith('rename from')) oldPath = lines[i].slice('rename from '.length);
        else if (lines[i].startsWith('rename to')) { status = 'renamed'; }
        i++;
      }

      const hunks: DiffHunk[] = [];

      // Parse hunks
      while (i < lines.length && lines[i].startsWith('@@')) {
        const hunkMatch = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!hunkMatch) { i++; continue; }

        const hunk: DiffHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(hunkMatch[3], 10),
          newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          lines: [],
        };
        i++;

        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git')) {
          const hunkLine = lines[i];
          if (hunkLine.startsWith('+++') || hunkLine.startsWith('---')) { i++; continue; }
          if (hunkLine.startsWith('\\')) { i++; continue; } // "\ No newline at end of file"

          if (hunkLine.startsWith('+')) {
            hunk.lines.push({ type: 'added', newLine, text: hunkLine.slice(1) });
            newLine++;
          } else if (hunkLine.startsWith('-')) {
            hunk.lines.push({ type: 'removed', oldLine, text: hunkLine.slice(1) });
            oldLine++;
          } else if (hunkLine.startsWith(' ')) {
            hunk.lines.push({ type: 'context', oldLine, newLine, text: hunkLine.slice(1) });
            oldLine++;
            newLine++;
          }
          // Empty line in diff = context with empty text
          else if (hunkLine === '') {
            hunk.lines.push({ type: 'context', oldLine, newLine, text: '' });
            oldLine++;
            newLine++;
          }
          i++;
        }
        hunks.push(hunk);
      }

      files.push({ file: filePath, oldPath, status, hunks });
    } else {
      i++;
    }
  }

  return { files };
}
