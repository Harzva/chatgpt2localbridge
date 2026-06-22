import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BridgeConfig } from './config.js';
import { readAuditEvents, readToolCalls } from './activity.js';

export function handleDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: BridgeConfig,
): boolean {
  if (req.method === 'GET' && (url.pathname === '/app' || url.pathname === '/app/')) {
    sendHtml(res, 200, renderDashboardHtml(config));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/app/api/status') {
    if (!isDashboardAuthorized(req, url, config)) {
      return sendJson(res, 401, { error: 'Dashboard token required' });
    }
    return sendJson(res, 200, {
      service: 'chatgpt2localbridge',
      version: '0.1.1',
      oauthEnabled: config.oauth.enabled,
      publicBaseUrl: config.oauth.publicBaseUrl,
      dataDir: config.dataDir,
      logDir: config.logDir,
      allowedProjectRoots: config.policy.allowedProjectRoots,
      skillRoots: config.policy.skillRoots,
      denyGlobs: config.policy.denyGlobs,
      shellEnabled: config.policy.shell.enabled,
      dashboardTokenConfigured: Boolean(config.dashboard.token),
      toolProfile: config.toolProfile,
    });
  }

  if (req.method === 'GET' && url.pathname === '/app/api/activity') {
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
    ? 'LOCALBRIDGE_DASHBOARD_TOKEN'
    : 'Dashboard token is not configured';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT2LocalBridge Console</title>
  <style>
    :root{color-scheme:light;--ink:#18211f;--soft:#5b6965;--faint:#7d8a86;--line:#ccd8d4;--paper:#eef3f1;--panel:#fff;--rail:#22302d;--green:#0f7b68;--blue:#2c6387;--amber:#a96c18;--red:#b64242;--shadow:0 18px 50px rgba(22,35,32,.08)}
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(180deg,#eef3f1 0,#f8faf9 42%,#eef3f1 100%);color:var(--ink);font-family:Avenir Next,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(24,33,31,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(24,33,31,.03) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(#000,transparent 72%)}
    header{position:sticky;top:0;z-index:2;border-bottom:1px solid var(--line);background:rgba(248,250,249,.9);backdrop-filter:blur(16px)}
    .topbar{max-width:1240px;margin:0 auto;padding:14px 20px;display:grid;grid-template-columns:minmax(240px,1fr) auto;gap:18px;align-items:center}
    h1{margin:0;font-size:18px;letter-spacing:0;font-weight:760}.kicker{margin-top:3px;color:var(--soft);font-size:12px}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
    .input{height:38px;width:min(380px,46vw);border:1px solid var(--line);border-radius:8px;padding:0 12px;background:#fff;color:var(--ink);font:inherit;font-size:13px;box-shadow:0 1px 0 rgba(255,255,255,.8)}
    button{height:38px;border:1px solid var(--rail);border-radius:8px;background:var(--rail);color:#fff;font-weight:760;padding:0 13px;cursor:pointer;font:inherit;font-size:13px}button:hover{filter:brightness(1.08)}.secondary{border-color:var(--line);background:#fff;color:var(--ink)}
    .shell{max-width:1240px;margin:0 auto;padding:20px}.status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{min-height:96px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.88);box-shadow:var(--shadow);padding:14px;display:grid;align-content:space-between}
    .metric .label{color:var(--soft);font-size:12px;font-weight:720;text-transform:uppercase;letter-spacing:.04em}.metric .value{font-size:24px;font-weight:820;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.metric .note{color:var(--faint);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;margin-top:14px}.card{border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow);padding:16px}.card h2{font-size:14px;margin:0 0 12px;font-weight:800}.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.pill{display:inline-flex;align-items:center;gap:6px;min-height:24px;border:1px solid var(--line);border-radius:999px;background:#f7faf9;padding:2px 9px;color:var(--soft);font-size:12px;font-weight:720}.dot{width:8px;height:8px;border-radius:50%;background:var(--faint)}.dot.ok{background:var(--green)}.dot.warn{background:var(--amber)}.dot.error{background:var(--red)}
    .kv{display:grid;grid-template-columns:136px minmax(0,1fr);gap:9px 12px;font-size:13px}.kv div:nth-child(odd){color:var(--soft);font-weight:700}.path,.mono,code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.path,.mono{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.roots{display:grid;gap:8px}.root{border:1px solid var(--line);border-radius:8px;padding:10px 11px;background:#f8fbfa;font-size:12px}
    table{width:100%;border-collapse:separate;border-spacing:0;margin-top:10px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:12px}tr:last-child td{border-bottom:0}th{background:#edf4f1;color:#42524e;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.state-ok{color:var(--green);font-weight:760}.state-error{color:var(--red);font-weight:760}.state-started{color:var(--amber);font-weight:760}pre{white-space:pre-wrap;margin:0;max-height:132px;overflow:auto;color:#2a3835}.empty{padding:22px;border:1px dashed var(--line);border-radius:8px;color:var(--faint);font-size:13px;text-align:center;background:#fbfcfc}.notice{border-left:3px solid var(--blue);padding:10px 12px;background:#f3f8fb;color:#355363;font-size:13px;line-height:1.5}.hidden{display:none!important}
    @media(max-width:980px){.topbar,.layout{grid-template-columns:1fr}.toolbar{justify-content:flex-start}.input{width:100%}.status-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:620px){.shell{padding:14px}.status-strip{grid-template-columns:1fr}.kv{grid-template-columns:1fr}th:nth-child(4),td:nth-child(4){display:none}}
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <h1>ChatGPT2LocalBridge</h1>
        <div class="kicker">Local MCP operations console</div>
      </div>
      <div class="toolbar">
        <input id="token" class="input" type="password" autocomplete="off" placeholder="${escapeHtml(tokenHint)}" aria-label="Dashboard token">
        <button id="save" title="Save dashboard token">Save</button>
        <button class="secondary" id="clear" title="Clear saved dashboard token">Clear</button>
        <button class="secondary" id="refresh" title="Refresh dashboard">Refresh</button>
      </div>
    </div>
  </header>
  <main class="shell">
    <section class="status-strip" aria-label="Bridge status summary">
      <article class="metric"><div class="label">Service</div><div class="value" id="metric-service">Waiting</div><div class="note" id="metric-version">-</div></article>
      <article class="metric"><div class="label">OAuth</div><div class="value" id="metric-oauth">-</div><div class="note" id="metric-public">-</div></article>
      <article class="metric"><div class="label">Workspace Roots</div><div class="value" id="metric-roots">-</div><div class="note">approved filesystem scope</div></article>
      <article class="metric"><div class="label">Activity</div><div class="value" id="metric-activity">-</div><div class="note" id="metric-audit">-</div></article>
    </section>
    <section class="layout">
      <article class="card">
        <div class="card-head"><h2>Runtime</h2><span class="pill"><span class="dot" id="runtime-dot"></span><span id="runtime-label">Not loaded</span></span></div>
        <div class="kv" id="runtime"></div>
      </article>
      <article class="card">
        <div class="card-head"><h2>Roots</h2><span class="pill" id="shell-pill">Shell -</span></div>
        <div class="roots" id="roots"></div>
      </article>
    </section>
    <section class="card" style="margin-top:14px">
      <div class="card-head"><h2>Tool Calls</h2><span class="pill" id="calls-pill">0 records</span></div>
      <table><thead><tr><th>Time</th><th>Tool</th><th>Status</th><th>Duration</th><th>Summary</th></tr></thead><tbody id="calls"></tbody></table>
      <div class="empty hidden" id="calls-empty">No tool calls recorded yet.</div>
    </section>
    <section class="card" style="margin-top:14px">
      <div class="card-head"><h2>Audit Events</h2><span class="pill" id="audit-pill">0 records</span></div>
      <table><thead><tr><th>Time</th><th>Action</th><th>Data</th></tr></thead><tbody id="audit"></tbody></table>
      <div class="empty hidden" id="audit-empty">No audit events recorded yet.</div>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const queryToken = params.get('dashboard_token');
    if (queryToken) {
      localStorage.setItem('localbridge.dashboardToken', queryToken);
      history.replaceState(null, '', location.pathname);
    }
    const initial = queryToken || localStorage.getItem('localbridge.dashboardToken') || '';
    const tokenInput = document.getElementById('token');
    tokenInput.value = initial;
    document.getElementById('save').onclick = () => { localStorage.setItem('localbridge.dashboardToken', tokenInput.value); load(); };
    document.getElementById('clear').onclick = () => { tokenInput.value = ''; localStorage.removeItem('localbridge.dashboardToken'); load(); };
    document.getElementById('refresh').onclick = () => load();
    async function api(path) {
      const token = tokenInput.value;
      const res = await fetch(path, { headers: token ? { 'x-localbridge-dashboard-token': token } : {} });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    async function load() {
      try {
        const status = await api('/app/api/status');
        renderStatus(status);
        const activity = await api('/app/api/activity?limit=120');
        renderCalls(activity.toolCalls || []);
        renderAudit(activity.auditEvents || []);
      } catch (err) {
        renderError(String(err.message || err));
      }
    }
    function renderStatus(status) {
      const ok = status.service === 'chatgpt2localbridge';
      document.getElementById('runtime-dot').className = 'dot ' + (ok ? 'ok' : 'error');
      document.getElementById('runtime-label').textContent = ok ? 'Online' : 'Attention';
      document.getElementById('metric-service').textContent = ok ? 'Online' : 'Check';
      document.getElementById('metric-version').textContent = status.service + ' ' + status.version;
      document.getElementById('metric-oauth').textContent = status.oauthEnabled ? 'Enabled' : 'Off';
      document.getElementById('metric-public').textContent = status.publicBaseUrl || 'local only';
      document.getElementById('metric-roots').textContent = String((status.allowedProjectRoots || []).length);
      document.getElementById('shell-pill').textContent = 'Shell ' + (status.shellEnabled ? 'enabled' : 'off');
      const rows = [
        ['Public URL', status.publicBaseUrl || 'not configured'],
        ['Data dir', status.dataDir],
        ['Log dir', status.logDir],
        ['OAuth', status.oauthEnabled ? 'enabled' : 'off'],
        ['Dashboard token', status.dashboardTokenConfigured ? 'configured' : 'missing'],
        ['Shell', status.shellEnabled ? 'enabled' : 'off'],
        ['Tool profile', status.toolProfile || 'normal'],
      ];
      document.getElementById('runtime').innerHTML = rows.map(([k, v]) => '<div>' + esc(k) + '</div><div class="path" title="' + esc(v) + '">' + esc(v) + '</div>').join('');
      const roots = status.allowedProjectRoots || [];
      document.getElementById('roots').innerHTML = roots.length ? roots.map((root) => '<div class="root path" title="' + esc(root) + '">' + esc(root) + '</div>').join('') : '<div class="empty">No approved roots.</div>';
    }
    function renderError(message) {
      document.getElementById('runtime-dot').className = 'dot error';
      document.getElementById('runtime-label').textContent = 'Locked';
      document.getElementById('metric-service').textContent = 'Locked';
      document.getElementById('metric-version').textContent = 'token required';
      document.getElementById('metric-oauth').textContent = '-';
      document.getElementById('metric-public').textContent = '-';
      document.getElementById('metric-roots').textContent = '-';
      document.getElementById('metric-activity').textContent = '-';
      document.getElementById('metric-audit').textContent = '-';
      document.getElementById('runtime').innerHTML = '<div>Console</div><div class="notice">' + esc(message) + '</div>';
      document.getElementById('roots').innerHTML = '<div class="empty">Enter a dashboard token to unlock runtime details.</div>';
      renderCalls([]);
      renderAudit([]);
    }
    function renderCalls(records) {
      document.getElementById('metric-activity').textContent = String(records.length);
      document.getElementById('calls-pill').textContent = records.length + ' records';
      document.getElementById('calls').closest('table').classList.toggle('hidden', records.length === 0);
      document.getElementById('calls-empty').classList.toggle('hidden', records.length !== 0);
      document.getElementById('calls').innerHTML = records.map((r) => '<tr><td>' + esc(formatTime(r.ts)) + '</td><td><code>' + esc(r.tool) + '</code></td><td class="' + stateClass(r.status) + '">' + esc(r.status) + '</td><td>' + esc(r.durationMs == null ? '-' : r.durationMs + ' ms') + '</td><td><pre>' + esc(summary(r.args || r.result || r.error || {})) + '</pre></td></tr>').join('');
    }
    function renderAudit(records) {
      document.getElementById('metric-audit').textContent = records.length + ' audit events';
      document.getElementById('audit-pill').textContent = records.length + ' records';
      document.getElementById('audit').closest('table').classList.toggle('hidden', records.length === 0);
      document.getElementById('audit-empty').classList.toggle('hidden', records.length !== 0);
      document.getElementById('audit').innerHTML = records.map((r) => '<tr><td>' + esc(formatTime(r.ts)) + '</td><td><code>' + esc(r.action) + '</code></td><td><pre>' + esc(summary(r)) + '</pre></td></tr>').join('');
    }
    function stateClass(value) { return value === 'error' ? 'state-error' : value === 'started' ? 'state-started' : 'state-ok'; }
    function formatTime(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(); }
    function summary(value) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
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
