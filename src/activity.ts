import fs from 'node:fs';
import path from 'node:path';
import type { BridgeConfig } from './config.js';

export interface ToolCallRecord {
  id: string;
  ts: string;
  tool: string;
  status: 'started' | 'ok' | 'error';
  durationMs?: number;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

export interface AuditRecord {
  ts: string;
  action: string;
  [key: string]: unknown;
}

const SENSITIVE_KEY_RE = /token|secret|password|authorization|cookie|unlock|content|oldText|newText|headers/i;

export function appendToolCall(config: BridgeConfig, record: ToolCallRecord): void {
  appendJsonl(path.join(config.dataDir, 'tool-calls.jsonl'), record);
}

export function readToolCalls(config: BridgeConfig, limit: number): ToolCallRecord[] {
  return readJsonl<ToolCallRecord>(path.join(config.dataDir, 'tool-calls.jsonl'), limit);
}

export function readAuditEvents(config: BridgeConfig, limit: number): AuditRecord[] {
  return readJsonl<AuditRecord>(path.join(config.dataDir, 'audit.jsonl'), limit);
}

export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(sanitizeForLog);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitizeForLog(item);
    }
    return out;
  }
  return String(value);
}

export function summarizeToolResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const value = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  const contentText = value.content
    ?.map((item) => item.type === 'text' ? item.text : undefined)
    .filter((item): item is string => Boolean(item))
    .join('\n')
    .slice(0, 500);
  return sanitizeForLog({
    isError: Boolean(value.isError),
    structuredContent: value.structuredContent,
    textPreview: contentText,
  }) as Record<string, unknown>;
}

function appendJsonl(filePath: string, record: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function readJsonl<T>(filePath: string, limit: number): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .slice(-limit)
    .map((line) => JSON.parse(line) as T)
    .reverse();
}
