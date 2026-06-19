import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BridgeConfig } from './config.js';
import { readAuditEvents, readToolCalls } from './activity.js';

export function handleDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: BridgeConfig,
): boolean {
  if (req.method !== 'GET') return false;

  if (url.pathname === '/app' || url.pathname === '/app/') {
    sendHtml(res, 200, renderDashboardHtml(config));
    return true;
  }

  if (url.pathname === '/app/api/status') {
    if (!isDashboardAuthorized(req, url, config)) {
      return sendJson(res, 401, { error: 'Dashboard token required' });
    }
    return sendJson(res, 200, {
      service: 'chatgpt2localbridge',
      version: '0.1.0',
      oauthEnabled: config.oauth.enabled,
      publicBaseUrl: config.oauth.publicBaseUrl,
      dataDir: config.dataDir,
      logDir: config.logDir,
      allowedProjectRoots: config.policy.allowedProjectRoots,
      shellEnabled: config.policy.shell.enabled,
      dashboardTokenConfigured: Boolean(config.dashboard.token),
    });
  }

  if (url.pathname === '/app/api/activity') {
    if (!isDashboardAuthorized(req, url, config)) {
      return sendJson(res, 401, { error: 'Dashboard token required' });
    }
    const limit = clamp(Number.parseInt(url.searchParams.get('limit') ?? '100', 10), 1, 500);
    return sendJson(res, 200, {
      toolCalls: readToolCalls(config, limit),
      auditEvents: readAuditEvents(config, limit),
    });
  }

  return false;
}

function isDashboardAuthorized(req: IncomingMessage, url: URL, config: BridgeConfig): boolean {
  if (!config.dashboard.token) return false;
  const queryToken = url.searchParams.get('dashboard_token');
  const headerToken = req.headers['x-localbridge-dashboard-token'];
  return queryToken === config.dashboard.token || headerToken === config.dashboard.token;
}

function renderDashboardHtml(config: BridgeConfig): string {
  const tokenHint = config.dashboard.token
    ? 'Paste LOCALBRIDGE_DASHBOARD_TOKEN or open /app?dashboard_token=... from this Mac.'
    : 'Set LOCALBRIDGE_DASHBOARD_TOKEN in .env.local to enable activity APIs.';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT2LocalBridge Console</title>
  <style>
    :root{color-scheme:light;--ink:#17202a;--muted:#526070;--line:#d8e1ec;--blue:#1769e0;--paper:#f6f8fb;--panel:#fff}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 22px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.92);backdrop-filter:blur(14px)}
    h1{font-size:20px;margin:0;letter-spacing:0}.shell{max-width:1180px;margin:0 auto;padding:22px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:18px}
    .card h2{font-size:15px;margin:0 0 10px}.muted{color:var(--muted);line-height:1.55}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.input{height:40px;min-width:360px;border:1px solid var(--line);border-radius:8px;padding:0 12px;background:#fff}
    button{height:40px;border:1px solid var(--blue);border-radius:8px;background:var(--blue);color:#fff;font-weight:800;padding:0 14px;cursor:pointer}.secondary{border-color:var(--line);background:#fff;color:var(--ink)}
    table{width:100%;border-collapse:collapse;margin-top:14px;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13px}th{background:#f0f5fb;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.ok{color:#1e8f4d}.error{color:#d93025}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}pre{white-space:pre-wrap;margin:0;max-height:120px;overflow:auto}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
    @media(max-width:860px){.grid,.two{grid-template-columns:1fr}.input{min-width:100%;width:100%}header{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
  <header>
    <h1>ChatGPT2LocalBridge Console</h1>
    <div class="toolbar">
      <input id="token" class="input" type="password" autocomplete="off" placeholder="${escapeHtml(tokenHint)}">
      <button id="save">Save token</button>
      <button class="secondary" id="refresh">Refresh</button>
    </div>
  </header>
  <main class="shell">
    <section class="grid">
      <article class="card"><h2>Route</h2><div class="muted">ChatGPT -> OAuth Connector -> /mcp -> approved local roots.</div></article>
      <article class="card"><h2>Cloud to Local</h2><div class="muted">Use <code>cloud.download</code> with a ChatGPT/App-provided HTTPS download URL.</div></article>
      <article class="card"><h2>Local to ChatGPT</h2><div class="muted">Use MCP reads for text, or a ChatGPT App widget with <code>uploadFile</code> for file-library uploads.</div></article>
    </section>
    <section class="two">
      <article class="card"><h2>Status</h2><pre id="status">Not loaded</pre></article>
      <article class="card"><h2>Setup checklist</h2><div class="muted">1. Keep <code>allowedProjectRoots</code> narrow.<br>2. Use OAuth for public tunnel traffic.<br>3. Set <code>LOCALBRIDGE_DASHBOARD_TOKEN</code> for this console.<br>4. Use <code>cloud.download</code> only with trusted HTTPS file URLs.</div></article>
    </section>
    <section class="card" style="margin-top:14px">
      <h2>Tool calls</h2>
      <table><thead><tr><th>Time</th><th>Tool</th><th>Status</th><th>Duration</th><th>Summary</th></tr></thead><tbody id="calls"></tbody></table>
    </section>
    <section class="card" style="margin-top:14px">
      <h2>Audit events</h2>
      <table><thead><tr><th>Time</th><th>Action</th><th>Data</th></tr></thead><tbody id="audit"></tbody></table>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const initial = params.get('dashboard_token') || localStorage.getItem('localbridge.dashboardToken') || '';
    const tokenInput = document.getElementById('token');
    tokenInput.value = initial;
    document.getElementById('save').onclick = () => { localStorage.setItem('localbridge.dashboardToken', tokenInput.value); load(); };
    document.getElementById('refresh').onclick = () => load();
    async function api(path) {
      const token = tokenInput.value;
      const url = path + (path.includes('?') ? '&' : '?') + 'dashboard_token=' + encodeURIComponent(token);
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    async function load() {
      try {
        const status = await api('/app/api/status');
        document.getElementById('status').textContent = JSON.stringify(status, null, 2);
        const activity = await api('/app/api/activity?limit=120');
        renderCalls(activity.toolCalls || []);
        renderAudit(activity.auditEvents || []);
      } catch (err) {
        document.getElementById('status').textContent = String(err.message || err);
      }
    }
    function renderCalls(records) {
      document.getElementById('calls').innerHTML = records.map((r) => '<tr><td>' + esc(r.ts) + '</td><td><code>' + esc(r.tool) + '</code></td><td class="' + (r.status === 'error' ? 'error' : 'ok') + '">' + esc(r.status) + '</td><td>' + esc(r.durationMs ?? '') + '</td><td><pre>' + esc(JSON.stringify(r.args || r.result || r.error || {}, null, 2)) + '</pre></td></tr>').join('');
    }
    function renderAudit(records) {
      document.getElementById('audit').innerHTML = records.map((r) => '<tr><td>' + esc(r.ts) + '</td><td><code>' + esc(r.action) + '</code></td><td><pre>' + esc(JSON.stringify(r, null, 2)) + '</pre></td></tr>').join('');
    }
    function esc(value) { return String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
    if (initial) load();
  </script>
</body>
</html>`;
}

function sendJson(res: ServerResponse, code: number, data: unknown): true {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
  return true;
}

function sendHtml(res: ServerResponse, code: number, body: string): true {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
  return true;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char));
}
