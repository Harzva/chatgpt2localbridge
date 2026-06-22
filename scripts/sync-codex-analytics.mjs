#!/usr/bin/env node

import fs from 'node:fs';

const API_BASE = 'https://api.chatgpt.com/v1/analytics/codex';
const apiKeyEnv = process.env.CODEX_ANALYTICS_API_KEY_ENV || 'CODEX_ANALYTICS_API_KEY';
const apiKey = process.env[apiKeyEnv];
const workspaceId = process.env.CODEX_WORKSPACE_ID;
const groupBy = process.env.GROUP_BY ?? 'day';
const group = process.env.GROUP ?? 'workspace';
const limit = process.env.LIMIT ?? '100';
const endpoints = (process.env.ENDPOINTS ?? 'usage,code_reviews,code_review_responses')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const outPath = process.env.OUT ?? 'codex-analytics-snapshot.json';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (!apiKey || !workspaceId) {
  printHelp();
  process.exitCode = 1;
  throw new Error('CODEX_ANALYTICS_API_KEY and CODEX_WORKSPACE_ID are required.');
}

const now = Math.floor(Date.now() / 1000);
const startTime = Number(process.env.START_TIME ?? (now - 7 * 24 * 60 * 60));
const endTime = Number(process.env.END_TIME ?? now);

const snapshot = {
  source: 'codex-enterprise-analytics-api',
  workspace_id: workspaceId,
  start_time: startTime,
  end_time: endTime,
  group_by: groupBy,
  group,
  fetched_at: new Date().toISOString(),
  endpoints: {},
};

for (const endpoint of endpoints) {
  snapshot.endpoints[endpoint] = await fetchEndpoint(endpoint);
}

fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
console.log(`[codex-analytics] wrote ${outPath}`);

async function fetchEndpoint(endpoint) {
  let page;
  const rows = [];
  do {
    const url = new URL(`${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/${endpoint}`);
    url.searchParams.set('start_time', String(startTime));
    url.searchParams.set('end_time', String(endTime));
    url.searchParams.set('group_by', groupBy);
    url.searchParams.set('limit', limit);
    if (group && endpoint === 'usage') url.searchParams.set('group', group);
    if (page) url.searchParams.set('page', page);

    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`${endpoint} failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    rows.push(...extractRows(body));
    page = body.page?.has_more ? body.page.next_page : undefined;
  } while (page);

  console.log(`[codex-analytics] ${endpoint}: ${rows.length} rows`);
  return {
    endpoint,
    data: rows,
  };
}

function extractRows(body) {
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.results)) return body.results;
  if (Array.isArray(body.records)) return body.records;
  return [body];
}

function printHelp() {
  console.log(`Codex Analytics sync

Required:
  CODEX_ANALYTICS_API_KEY=...   API key scoped to codex.enterprise.analytics.read
  CODEX_WORKSPACE_ID=...        ChatGPT workspace id

Optional:
  CODEX_ANALYTICS_API_KEY_ENV=CODEX_ANALYTICS_API_KEY
  START_TIME=1765152000         Inclusive Unix timestamp. Default: 7 days ago.
  END_TIME=1765756800           Exclusive Unix timestamp. Default: now.
  GROUP_BY=day|week             Default: day.
  GROUP=workspace               Usage endpoint group. Default: workspace.
  ENDPOINTS=usage,code_reviews,code_review_responses
  OUT=codex-analytics-snapshot.json

Example:
  CODEX_ANALYTICS_API_KEY=... CODEX_WORKSPACE_ID=... \\
  node scripts/sync-codex-analytics.mjs
`);
}
