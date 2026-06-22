import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BridgeConfig } from './config.js';

export interface CodexAnalyticsPoint {
  date: string;
  metric: string;
  category: string;
  value: number;
  source: string;
}

export interface CodexAnalyticsSnapshot {
  id: string;
  ts: string;
  source: string;
  workspaceId?: string;
  points: CodexAnalyticsPoint[];
  raw: unknown;
}

export interface CodexAnalyticsSummary {
  snapshots: Array<Pick<CodexAnalyticsSnapshot, 'id' | 'ts' | 'source' | 'workspaceId'> & { pointCount: number }>;
  pointCount: number;
  totalsByMetric: Array<{ metric: string; value: number }>;
  topCategories: Array<{ metric: string; category: string; value: number }>;
  dailyTotals: Array<{ date: string; metric: string; value: number }>;
  series: Array<{ metric: string; category: string; points: Array<{ date: string; value: number }> }>;
  insights: string[];
}

const SNAPSHOT_FILE = 'codex-analytics-snapshots.jsonl';
const NUMERIC_METRIC_FIELDS = [
  'skills_used',
  'threads',
  'turns',
  'credits',
  'text_input_tokens',
  'text_cached_input_tokens',
  'text_output_tokens',
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'prs_reviewed',
  'comments',
  'p0_comments',
  'p1_comments',
  'p2_comments',
  'replies',
  'positive_reactions',
  'negative_reactions',
  'other_reactions',
];

export function importCodexAnalyticsSnapshot(config: BridgeConfig, payload: unknown): CodexAnalyticsSummary {
  const now = new Date().toISOString();
  const source = readString(payload, ['source']) ?? 'manual-import';
  const workspaceId = readString(payload, ['workspace_id', 'workspaceId']);
  const points = normalizeCodexAnalyticsPoints(payload, source);
  const snapshot: CodexAnalyticsSnapshot = {
    id: randomUUID(),
    ts: now,
    source,
    workspaceId,
    points,
    raw: sanitizeRawSnapshot(payload),
  };
  appendSnapshot(config, snapshot);
  return readCodexAnalyticsSummary(config, 80);
}

export function readCodexAnalyticsSummary(config: BridgeConfig, limit: number): CodexAnalyticsSummary {
  const snapshots = readSnapshots(config, limit);
  const points = snapshots.flatMap((snapshot) => snapshot.points);
  const totals = new Map<string, number>();
  const categoryTotals = new Map<string, number>();
  const dailyTotals = new Map<string, number>();
  const seriesMap = new Map<string, Map<string, number>>();

  for (const point of points) {
    totals.set(point.metric, (totals.get(point.metric) ?? 0) + point.value);
    categoryTotals.set(`${point.metric}\u0000${point.category}`, (categoryTotals.get(`${point.metric}\u0000${point.category}`) ?? 0) + point.value);
    dailyTotals.set(`${point.date}\u0000${point.metric}`, (dailyTotals.get(`${point.date}\u0000${point.metric}`) ?? 0) + point.value);
    const seriesKey = `${point.metric}\u0000${point.category}`;
    const values = seriesMap.get(seriesKey) ?? new Map<string, number>();
    values.set(point.date, (values.get(point.date) ?? 0) + point.value);
    seriesMap.set(seriesKey, values);
  }

  const totalsByMetric = [...totals.entries()]
    .map(([metric, value]) => ({ metric, value: round(value) }))
    .sort((a, b) => b.value - a.value);
  const topCategories = [...categoryTotals.entries()]
    .map(([key, value]) => {
      const [metric, category] = key.split('\u0000');
      return { metric, category, value: round(value) };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const daily = [...dailyTotals.entries()]
    .map(([key, value]) => {
      const [date, metric] = key.split('\u0000');
      return { date, metric, value: round(value) };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric));
  const series = [...seriesMap.entries()]
    .map(([key, values]) => {
      const [metric, category] = key.split('\u0000');
      return {
        metric,
        category,
        points: [...values.entries()]
          .map(([date, value]) => ({ date, value: round(value) }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .sort((a, b) => a.metric.localeCompare(b.metric) || a.category.localeCompare(b.category));

  return {
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      ts: snapshot.ts,
      source: snapshot.source,
      workspaceId: snapshot.workspaceId,
      pointCount: snapshot.points.length,
    })),
    pointCount: points.length,
    totalsByMetric,
    topCategories,
    dailyTotals: daily,
    series,
    insights: buildInsights(totalsByMetric, daily, topCategories),
  };
}

function normalizeCodexAnalyticsPoints(payload: unknown, source: string): CodexAnalyticsPoint[] {
  const points: CodexAnalyticsPoint[] = [];
  collectSeriesPoints(payload, points, source);
  collectRecordMetricPoints(payload, points, source);
  return dedupePoints(points);
}

function collectSeriesPoints(value: unknown, out: CodexAnalyticsPoint[], source: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectSeriesPoints(item, out, source);
    return;
  }

  const record = value as Record<string, unknown>;
  const metric = normalizeMetricName(readString(record, ['metric', 'title', 'name']) ?? 'codex_usage');
  const series = Array.isArray(record.series) ? record.series : undefined;
  if (series) {
    for (const item of series) {
      if (!item || typeof item !== 'object') continue;
      const seriesRecord = item as Record<string, unknown>;
      const category = readString(seriesRecord, ['name', 'category', 'label', 'skill', 'client', 'user']) ?? 'unknown';
      const rows = Array.isArray(seriesRecord.data)
        ? seriesRecord.data
        : Array.isArray(seriesRecord.points)
          ? seriesRecord.points
          : [];
      for (const row of rows) {
        const parsed = parseDateValue(row);
        if (parsed) out.push({ date: parsed.date, metric, category, value: parsed.value, source });
      }
    }
  }

  for (const item of Object.values(record)) {
    if (item && typeof item === 'object') collectSeriesPoints(item, out, source);
  }
}

function collectRecordMetricPoints(value: unknown, out: CodexAnalyticsPoint[], source: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectRecordMetricPoints(item, out, source);
    return;
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.records)
      ? record.records
      : Array.isArray(record.results)
        ? record.results
        : undefined;

  if (rows) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rowRecord = row as Record<string, unknown>;
      const date = parseDate(rowRecord.start_time ?? rowRecord.date ?? rowRecord.day ?? rowRecord.bucket);
      if (!date) continue;
      const category = readString(rowRecord, ['skill', 'client', 'surface', 'user_email', 'user_id', 'model', 'agent', 'identity'])
        ?? readString(record, ['group', 'category'])
        ?? 'workspace';
      for (const field of NUMERIC_METRIC_FIELDS) {
        const numberValue = asNumber(rowRecord[field]);
        if (numberValue !== undefined) {
          out.push({ date, metric: normalizeMetricName(field), category, value: numberValue, source });
        }
      }
    }
  }

  for (const item of Object.values(record)) {
    if (item && typeof item === 'object') collectRecordMetricPoints(item, out, source);
  }
}

function parseDateValue(value: unknown): { date: string; value: number } | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const date = parseDate(value[0]);
    const numberValue = asNumber(value[1]);
    return date && numberValue !== undefined ? { date, value: numberValue } : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const date = parseDate(record.date ?? record.day ?? record.bucket ?? record.start_time ?? record.x);
  const numberValue = asNumber(record.value ?? record.count ?? record.total ?? record.y);
  return date && numberValue !== undefined ? { date, value: numberValue } : undefined;
}

function parseDate(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return undefined;
}

function normalizeMetricName(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'codex_usage';
}

function dedupePoints(points: CodexAnalyticsPoint[]): CodexAnalyticsPoint[] {
  const seen = new Set<string>();
  const out: CodexAnalyticsPoint[] = [];
  for (const point of points) {
    const key = `${point.date}\u0000${point.metric}\u0000${point.category}\u0000${point.value}\u0000${point.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point);
  }
  return out;
}

function buildInsights(
  totals: Array<{ metric: string; value: number }>,
  daily: Array<{ date: string; metric: string; value: number }>,
  categories: Array<{ metric: string; category: string; value: number }>,
): string[] {
  const insights: string[] = [];
  for (const total of totals.slice(0, 4)) {
    const peak = daily
      .filter((item) => item.metric === total.metric)
      .sort((a, b) => b.value - a.value)[0];
    if (peak) insights.push(`${total.metric}: peak ${peak.value} on ${peak.date}, total ${total.value}.`);
    const top = categories.find((item) => item.metric === total.metric);
    if (top && total.value > 0) {
      insights.push(`${total.metric}: top segment ${top.category} is ${round((top.value / total.value) * 100)}% of total.`);
    }
  }
  return insights;
}

function appendSnapshot(config: BridgeConfig, snapshot: CodexAnalyticsSnapshot): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.appendFileSync(snapshotPath(config), `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
}

function readSnapshots(config: BridgeConfig, limit: number): CodexAnalyticsSnapshot[] {
  const filePath = snapshotPath(config);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .slice(-limit)
    .map((line) => JSON.parse(line) as CodexAnalyticsSnapshot)
    .reverse();
}

function snapshotPath(config: BridgeConfig): string {
  return path.join(config.dataDir, SNAPSHOT_FILE);
}

function sanitizeRawSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(sanitizeRawSnapshot);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /token|secret|password|authorization|cookie|email|prompt|response|content/i.test(key)
        ? '[redacted]'
        : sanitizeRawSnapshot(item);
    }
    return out;
  }
  return String(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
