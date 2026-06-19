export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  insertions: number;
  deletions: number;
}

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  file: string;
  oldPath?: string;
  status: FileStatus;
  hunks: DiffHunk[];
}

export interface StructuredDiff {
  files: FileDiff[];
}

export interface ProjectSnapshot {
  path: string;
  branch: string;
  isGitRepo: boolean;
  headCommit?: string;
  isDirty: boolean;
  entries: string[];
  language?: string;
  packageManager?: string;
}
