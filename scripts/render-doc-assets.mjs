#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsAssets = path.join(root, 'docs', 'assets');
const mockupsDir = path.join(docsAssets, 'mockups');
const screenshotsDir = path.join(docsAssets, 'screenshots');

fs.mkdirSync(docsAssets, { recursive: true });
fs.mkdirSync(mockupsDir, { recursive: true });
fs.mkdirSync(screenshotsDir, { recursive: true });

const coverSource = path.join(root, 'assets', 'cover.png');
const coverTarget = path.join(docsAssets, 'cover.png');
if (fs.existsSync(coverSource)) fs.copyFileSync(coverSource, coverTarget);

const chrome = findChrome();

const logoHtml = path.join(docsAssets, 'logo-source.html');
fs.writeFileSync(logoHtml, renderLogo(), 'utf8');
screenshot(logoHtml, path.join(docsAssets, 'logo.png'), 512, 512);

const steps = [
  {
    name: '01-init',
    title: 'Step 1 - Initialize local policy',
    subtitle: 'Choose the folder ChatGPT is allowed to work with.',
    body: terminal([
      '$ npx github:harzva/chatgpt2localbridge init --root ~/Projects',
      'Wrote: bridge.policy.json',
      'Wrote: .env.local',
      'Next: set -a; source .env.local; set +a',
    ]),
  },
  {
    name: '02-run',
    title: 'Step 2 - Run local MCP server',
    subtitle: 'The bridge listens on loopback first.',
    body: terminal([
      '$ set -a; source .env.local; set +a',
      '$ npx github:harzva/chatgpt2localbridge --http 3838',
      '[bridge] ChatGPT2LocalBridge v0.1.0 starting',
      '[bridge] /mcp ready at http://localhost:3838/mcp',
    ]),
  },
  {
    name: '03-health',
    title: 'Step 3 - Check health',
    subtitle: 'A small health endpoint keeps debugging boring.',
    body: terminal([
      '$ curl -sS http://127.0.0.1:3838/health',
      '{ "status": "ok", "service": "chatgpt2localbridge" }',
    ]),
  },
  {
    name: '04-tunnel',
    title: 'Step 4 - Expose HTTPS tunnel',
    subtitle: 'Use a fixed HTTPS URL for hosted ChatGPT connectors.',
    body: diagram(['localhost:3838', 'HTTPS tunnel', 'ChatGPT']),
  },
  {
    name: '05-connector',
    title: 'Step 5 - Create ChatGPT connector',
    subtitle: 'Use OAuth and the public /mcp URL.',
    body: formMock([
      ['Name', 'ChatGPT2LocalBridge'],
      ['URL', 'https://your-fixed-domain.example.com/mcp'],
      ['Auth', 'OAuth'],
    ]),
  },
  {
    name: '06-authorize',
    title: 'Step 6 - Authorize',
    subtitle: 'Enter the unlock code from your local .env.local file.',
    body: authMock(),
  },
  {
    name: '07-success',
    title: 'Step 7 - Use the tool',
    subtitle: 'ChatGPT can now call File list inside approved roots.',
    body: resultMock(),
  },
  {
    name: '08-agent-computer-use',
    title: 'Agent Computer Use setup',
    subtitle: 'A coding agent can click through the connector UI while you approve secrets.',
    body: agentMock(),
  },
  {
    name: '09-policy-center',
    title: 'Policy Center',
    subtitle: 'Edit approved roots, skill roots, deny globs, and shell rules in the native app.',
    body: policyMock(),
  },
];

for (const step of steps) {
  const htmlPath = path.join(mockupsDir, `${step.name}.html`);
  const pngPath = path.join(screenshotsDir, `${step.name}.png`);
  fs.writeFileSync(htmlPath, renderMockup(step), 'utf8');
  screenshot(htmlPath, pngPath, 1400, 900);
}

writeThumbnail('architecture-horizontal', renderArchitectureHorizontal(), 1600, 900);

const indexHtml = path.join(root, 'docs', 'index.html');
if (fs.existsSync(indexHtml)) {
  screenshot(indexHtml, path.join(docsAssets, 'page-desktop.png'), 1440, 1000);
  screenshot(indexHtml, path.join(docsAssets, 'page-mobile.png'), 390, 900);
  screenshot(indexHtml, path.join(docsAssets, 'og.png'), 1200, 630);
  const showcaseHtml = path.join(root, 'docs', 'showcase.html');
  if (fs.existsSync(showcaseHtml)) {
    screenshot(showcaseHtml, path.join(docsAssets, 'showcase-gallery.png'), 1440, 1000);
  }
  writeThumbnail('thumbnail-responsive', renderResponsiveThumbnail(), 1600, 1000);
  writeThumbnail('thumbnail-matrix', renderMatrixThumbnail(), 1200, 675);
  writeThumbnail('thumbnail-square', renderSquareThumbnail(), 1080, 1080);
  writeThumbnail('thumbnail-story', renderStoryThumbnail(), 1080, 1920);
  writeThumbnail('xhs-promo', renderXhsPromo(), 1242, 1660);
  writeThumbnail('xhs-community', renderXhsCommunity(), 1242, 1660);
}

console.log(`Rendered docs assets into ${docsAssets}`);

function screenshot(inputPath, outputPath, width, height) {
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--screenshot=${outputPath}`,
    pathToFileURL(inputPath).href,
  ], { stdio: 'ignore' });
}

function writeThumbnail(name, html, width, height) {
  const htmlPath = path.join(mockupsDir, `${name}.html`);
  const pngPath = path.join(docsAssets, `${name}.png`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  screenshot(htmlPath, pngPath, width, height);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome/Chromium not found. Set CHROME_BIN to render docs assets.');
}

function renderLogo() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:512px;height:512px;display:grid;place-items:center;background:#eef6ff;font-family:Inter,Arial,sans-serif}
  .mark{width:398px;height:398px;border-radius:92px;background:linear-gradient(145deg,#ffffff 0%,#f8fbff 54%,#e9f7f2 100%);box-shadow:0 30px 70px rgba(13,33,54,.24),inset 0 0 0 1px rgba(255,255,255,.9);position:relative;overflow:hidden}
  .mark:before{content:"";position:absolute;inset:18px;border-radius:74px;border:2px solid rgba(18,110,227,.16)}
  .knot{position:absolute;left:48px;top:48px;width:134px;height:134px;border-radius:36px;background:#fff;box-shadow:0 16px 34px rgba(13,33,54,.13);display:grid;place-items:center}
  .loop{position:absolute;width:48px;height:22px;border:10px solid #111827;border-radius:999px;transform-origin:54px 11px}
  .l1{transform:rotate(0deg) translateX(18px)}.l2{transform:rotate(60deg) translateX(18px)}.l3{transform:rotate(120deg) translateX(18px)}
  .l4{transform:rotate(180deg) translateX(18px)}.l5{transform:rotate(240deg) translateX(18px)}.l6{transform:rotate(300deg) translateX(18px)}
  .core{position:absolute;width:34px;height:34px;border-radius:50%;background:#fff;border:8px solid #111827}
  .terminal{position:absolute;right:42px;top:58px;width:152px;height:116px;border-radius:28px;background:#111827;color:#e8fff4;box-shadow:0 16px 36px rgba(13,33,54,.22);overflow:hidden}
  .termtop{height:28px;background:#1f2937;display:flex;gap:7px;align-items:center;padding-left:18px}
  .dot{width:8px;height:8px;border-radius:50%;background:#ff6159;box-shadow:16px 0 #ffbd2e,32px 0 #28c840}
  .prompt{font:700 39px ui-monospace,SFMono-Regular,Menlo,monospace;position:absolute;left:24px;top:50px;letter-spacing:0;color:#7cf6c2}.prompt span{color:#8fc7ff}
  .bridge{position:absolute;left:88px;top:194px;width:252px;height:92px;border-radius:46px;background:linear-gradient(90deg,#126ee3,#18b893);box-shadow:0 20px 42px rgba(18,110,227,.28)}
  .bridge:before,.bridge:after{content:"";position:absolute;top:25px;width:42px;height:42px;border-radius:50%;background:#fff;box-shadow:0 0 0 10px rgba(255,255,255,.22)}
  .bridge:before{left:24px}.bridge:after{right:24px}
  .bridge .line{position:absolute;left:72px;right:72px;top:42px;height:10px;border-radius:999px;background:#fff}
  .folder{position:absolute;left:104px;bottom:52px;width:198px;height:98px;background:#ffca3a;border-radius:22px;box-shadow:0 18px 34px rgba(13,33,54,.2);border:5px solid #17202a}
  .folder:before{content:"";position:absolute;left:18px;top:-28px;width:82px;height:36px;background:#ffca3a;border:5px solid #17202a;border-bottom:0;border-radius:18px 18px 0 0}
  .lock{position:absolute;right:90px;bottom:76px;width:54px;height:42px;border-radius:12px;background:#fff;border:5px solid #17202a}
  .lock:before{content:"";position:absolute;left:12px;top:-30px;width:22px;height:28px;border:5px solid #17202a;border-bottom:0;border-radius:18px 18px 0 0}
  </style></head><body><div class="mark"><div class="knot"><div class="loop l1"></div><div class="loop l2"></div><div class="loop l3"></div><div class="loop l4"></div><div class="loop l5"></div><div class="loop l6"></div><div class="core"></div></div><div class="terminal"><div class="termtop"><div class="dot"></div></div><div class="prompt">C<span>&gt;</span></div></div><div class="bridge"><div class="line"></div></div><div class="folder"></div><div class="lock"></div></div></body></html>`;
}

function renderMockup(step) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1400px;height:900px;background:#f4f7fb;color:#17202a;font-family:Inter,Arial,sans-serif;display:grid;place-items:center}
  .frame{width:1120px;height:710px;background:#fff;border:1px solid #d8e1ec;border-radius:18px;box-shadow:0 30px 90px rgba(22,37,61,.14);overflow:hidden}
  .top{height:72px;background:#101828;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 28px}
  .brand{display:flex;align-items:center;gap:12px;font-weight:800}.dot{width:16px;height:16px;border-radius:50%;background:#34c759;box-shadow:24px 0 #fbbf24,48px 0 #ef4444}
  .content{padding:46px}.kicker{color:#1769e0;font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:14px}
  h1{font-size:48px;line-height:1.05;margin:12px 0 10px;letter-spacing:0}.subtitle{font-size:22px;color:#526070;margin:0 0 32px}
  .panel{border:2px solid #d8e1ec;border-radius:16px;background:#fbfdff;padding:28px}
  .terminal{background:#0f172a;color:#e5edf7;border-radius:14px;padding:26px;font:22px ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.75}
  .green{color:#7ee787}.blue{color:#9cc9ff}.yellow{color:#fcd34d}.muted{color:#9aa7bd}
  .diagram{display:flex;align-items:center;justify-content:space-between;gap:20px}.node{flex:1;height:150px;border:3px solid #1769e0;border-radius:18px;display:grid;place-items:center;text-align:center;font-weight:800;font-size:26px;background:white}.arrow{font-size:52px;color:#1769e0}
  .form{display:grid;gap:18px}.field{display:grid;gap:8px}.label{font-weight:800}.input{height:58px;border:2px solid #cbd5e1;border-radius:12px;padding:15px 18px;font-size:22px;background:#fff}.button{margin-top:12px;height:60px;border-radius:12px;background:#1769e0;color:white;display:grid;place-items:center;font-weight:800;font-size:22px}
  .result{display:grid;grid-template-columns:1fr 1fr;gap:22px}.tool{border:2px solid #bbd4ff;border-radius:16px;padding:22px;background:#f8fbff}.list{font-size:22px;line-height:1.9}.pill{display:inline-block;border-radius:999px;background:#e9f3ff;color:#1769e0;padding:8px 12px;font-weight:800}
  </style></head><body><div class="frame"><div class="top"><div class="brand"><div class="dot"></div><span>ChatGPT2LocalBridge</span></div><span>public-safe tutorial mockup</span></div><div class="content"><div class="kicker">Setup walkthrough</div><h1>${step.title}</h1><p class="subtitle">${step.subtitle}</p><div class="panel">${step.body}</div></div></div></body></html>`;
}

function terminal(lines) {
  return `<div class="terminal">${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`;
}

function diagram(labels) {
  return `<div class="diagram">${labels.map((label, index) => `<div class="node">${escapeHtml(label)}</div>${index < labels.length - 1 ? '<div class="arrow">→</div>' : ''}`).join('')}</div>`;
}

function formMock(rows) {
  return `<div class="form">${rows.map(([label, value]) => `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="input">${escapeHtml(value)}</div></div>`).join('')}<div class="button">Create and authorize</div></div>`;
}

function authMock() {
  return `<div class="form"><div class="field"><div class="label">Authorize ChatGPT2LocalBridge</div><div class="input">Requested scope: workspace:read workspace:write shell:exec</div></div><div class="field"><div class="label">Bridge unlock code</div><div class="input muted">••••••••••••••••••••••••</div></div><div class="button">Authorize</div></div>`;
}

function resultMock() {
  return `<div class="result"><div class="tool"><div class="pill">File list</div><pre>{ dir: ".", entries: Array(20) }</pre></div><div class="list"><strong>Approved Workspace</strong><br>README.md<br>package.json<br>src/<br>docs/<br>bridge.policy.json</div></div>`;
}

function agentMock() {
  return `<div class="diagram"><div class="node">Codex agent<br>Computer Use</div><div class="arrow">→</div><div class="node">ChatGPT settings<br>Connectors</div><div class="arrow">→</div><div class="node">Human approves<br>unlock code</div></div>`;
}

function policyMock() {
  return `<div class="form"><div class="result"><div class="tool"><div class="pill">Allowed Roots</div><div class="list">~/Projects<br>~/Workspaces/client-app</div></div><div class="tool"><div class="pill">Skill Roots</div><div class="list">~/.codex/skills<br><span class="muted">not ~/.codex</span></div></div></div><div class="result"><div class="tool"><div class="pill">Deny Globs</div><pre>**/.env
**/*.key
**/.ssh/**</pre></div><div class="tool"><div class="pill">Trace</div><pre>policy.write
skill.read
cloud.download</pre></div></div><div class="button" style="height:48px;margin-top:0;font-size:20px">Validate and Apply</div></div>`;
}

function renderResponsiveThumbnail() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1600px;height:1000px;background:#eef4fb;font-family:Inter,Arial,sans-serif;color:#17202a;overflow:hidden}
  .wrap{position:relative;width:100%;height:100%;padding:70px}
  .kicker{font-size:22px;font-weight:900;color:#1769e0;text-transform:uppercase;letter-spacing:.08em}
  h1{margin:10px 0 0;font-size:76px;line-height:.96;letter-spacing:0;max-width:720px}
  p{font-size:28px;line-height:1.45;color:#526070;max-width:680px}
  .desktop{position:absolute;right:95px;top:90px;width:760px;border:10px solid #17202a;border-radius:30px;box-shadow:0 34px 80px rgba(22,37,61,.24);background:#17202a}
  .desktop img,.phone img{display:block;width:100%;border-radius:18px}
  .phone{position:absolute;right:420px;top:560px;width:160px;border:10px solid #17202a;border-radius:34px;box-shadow:0 26px 60px rgba(22,37,61,.22);background:#17202a}
  .steps{position:absolute;left:72px;bottom:84px;display:flex;gap:14px}
  .chip{padding:14px 18px;border-radius:999px;background:#fff;border:1px solid #d8e1ec;font-size:20px;font-weight:800}
  </style></head><body><div class="wrap"><div class="kicker">Codex / ChatGPT Plugin App</div><h1>Agents meet approved local workspaces.</h1><p>A local control console, OAuth MCP connector, and screenshot-first setup guides for building your own plugin apps.</p><div class="steps"><div class="chip">Plugin App</div><div class="chip">MCP tools</div><div class="chip">GitHub Pages</div></div><div class="desktop"><img src="../page-desktop.png" alt=""></div><div class="phone"><img src="../page-mobile.png" alt=""></div></div></body></html>`;
}

function renderArchitectureHorizontal() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:1600px;height:900px;background:#edf4fb;font-family:Inter,Arial,sans-serif;color:#17202a;display:grid;place-items:center}
  .canvas{width:1460px;height:800px;background:#fff;border:1px solid #d8e1ec;border-radius:28px;box-shadow:0 34px 90px rgba(18,31,56,.16);padding:30px 38px;position:relative;overflow:hidden}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px}
  .kicker{font-size:17px;line-height:1.2;font-weight:900;color:#1769e0;text-transform:uppercase;letter-spacing:.08em}.title{font-size:44px;line-height:1.02;font-weight:900;letter-spacing:0;margin-top:8px}.subtitle{font-size:21px;line-height:1.32;color:#526070;margin-top:10px;max-width:850px}
  .badge{border-radius:999px;background:#e9f3ff;color:#1769e0;border:1px solid #cfe2ff;padding:12px 18px;font-size:18px;font-weight:900;white-space:nowrap}
  .flow{display:grid;grid-template-columns:205px 205px 205px 260px 280px;gap:26px;align-items:stretch;margin-top:14px}
  .card{min-height:170px;border:2px solid #d8e1ec;border-radius:22px;background:#fbfdff;padding:18px 20px;position:relative}
  .card.primary{border-color:#1769e0;background:#f7fbff}.card.safe{border-color:#30b37d;background:#f5fffa}.card.warn{border-color:#f7b733;background:#fffaf0}
  .label{font-size:15px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.06em}.name{font-size:27px;font-weight:900;line-height:1.05;margin-top:8px}.desc{font-size:16px;line-height:1.28;color:#526070;margin-top:10px}.mini{font-size:15px;line-height:1.45;color:#64748b;margin-top:12px}
  .arrow{position:absolute;right:-27px;top:72px;width:28px;height:16px;color:#1769e0;font-size:36px;font-weight:900;z-index:2}
  .tiers{display:grid;grid-template-rows:1fr 1fr 1fr;gap:9px;margin-top:8px}.tier{border-radius:16px;padding:10px 14px;border:1px solid #dbe6f3;background:#fff}.tier strong{display:block;font-size:17px;line-height:1.1}.tier span{display:block;font-size:13px;line-height:1.2;color:#526070;margin-top:4px}.tier.high{border-color:#b9f0d3;background:#f5fffa}.tier.mid{border-color:#bcd7ff;background:#f7fbff}.tier.low{border-color:#ffe0a6;background:#fffaf0}
  .bottom{display:grid;grid-template-columns:1fr 1fr 1fr;gap:22px;margin-top:24px}
  .panel{border-radius:20px;border:1px solid #d8e1ec;background:#fbfdff;padding:18px 22px;min-height:225px}.panel h3{font-size:22px;line-height:1.1;margin:0 0 10px}.panel p{font-size:17px;line-height:1.35;color:#526070;margin:0}.dots{display:flex;gap:10px;margin-top:16px}.dot{height:10px;flex:1;border-radius:999px;background:#1769e0}.dot:nth-child(2){background:#30b37d}.dot:nth-child(3){background:#f7b733}.dot:nth-child(4){background:#ef4444}
  </style></head><body><main class="canvas"><div class="top"><div><div class="kicker">Architecture</div><div class="title">ChatGPT to local workspace control plane</div><div class="subtitle">Web ChatGPT calls MCP tools, the bridge enforces policy, and the local app keeps the operator in the loop with traces, logs, and task controls.</div></div><div class="badge">OAuth or Secure MCP Tunnel first</div></div>
  <section class="flow">
    <div class="card"><div class="label">User intent</div><div class="name">ChatGPT Web</div><div class="desc">The user asks for local project inspection, edits, tests, downloads, or a Codex CLI task.</div><div class="arrow">→</div></div>
    <div class="card primary"><div class="label">Connector</div><div class="name">MCP tools</div><div class="desc">ChatGPT discovers tools from <strong>tools/list</strong> and makes structured <strong>mcp_call</strong> requests.</div><div class="arrow">→</div></div>
    <div class="card safe"><div class="label">Access</div><div class="name">Auth tunnel</div><div class="desc">OAuth or Secure MCP Tunnel protects public deployments. No-auth stays lab-only.</div><div class="arrow">→</div></div>
    <div class="card primary"><div class="label">Bridge core</div><div class="name">Policy gateway</div><div class="desc">Allowed roots, deny globs, shell profile, timeouts, and audit logging guard every call.</div><div class="arrow">→</div></div>
    <div class="card warn"><div class="label">Local side</div><div class="name">Workspace + Codex</div><div class="desc">Approved files, local skills, test commands, and Codex CLI jobs run beside the project.</div></div>
  </section>
  <section class="bottom">
    <div class="panel"><h3>Tool tiers</h3><div class="tiers"><div class="tier high"><strong>High: codex.*</strong><span>task_start, status, result</span></div><div class="tier mid"><strong>Mid: project/git/test</strong><span>bundle, diff, run, policy</span></div><div class="tier low"><strong>Low: debug only</strong><span>file.write, shell.exec</span></div></div></div>
    <div class="panel"><h3>Operator app</h3><p>Policy Center edits roots safely. Trace views show tool calls, file reads/writes, cloud downloads, logs, diffs, and cancellable Codex tasks.</p><div class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>
    <div class="panel"><h3>Safety defaults</h3><p>Public URLs require OAuth or a private tunnel. Normal mode avoids raw shell and guides ChatGPT toward project.bundle, test.run, git.diff, and Codex Runner.</p><div class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>
  </section></main></body></html>`;
}

function renderMatrixThumbnail() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1200px;height:675px;background:#17202a;font-family:Inter,Arial,sans-serif;color:#fff;display:grid;place-items:center}
  .card{width:1040px;height:540px;border-radius:34px;background:#f7fbff;color:#17202a;padding:40px;display:grid;grid-template-columns:1fr 420px;gap:34px;box-shadow:0 28px 80px rgba(0,0,0,.32)}
  h1{font-size:56px;line-height:1;margin:0 0 16px;letter-spacing:0}.tag{font-size:18px;color:#1769e0;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.copy{font-size:24px;line-height:1.5;color:#526070}.preview{border:1px solid #d8e1ec;border-radius:18px;overflow:hidden;align-self:center}.preview img{display:block;width:100%}.badges{display:flex;gap:12px;margin-top:26px}.badge{background:#e9f3ff;color:#1769e0;border-radius:999px;padding:11px 14px;font-weight:800}
  </style></head><body><div class="card"><div><div class="tag">ChatGPT2LocalBridge</div><h1>Codex / ChatGPT plugin app.</h1><div class="copy">A public-ready local operator console with focused MCP tools, policy, traces, and setup guides.</div><div class="badges"><div class="badge">Plugin App</div><div class="badge">MCP</div><div class="badge">Local-first</div></div></div><div class="preview"><img src="../screenshots/05-connector.png" alt=""></div></div></body></html>`;
}

function renderSquareThumbnail() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1080px;height:1080px;background:#f6f8fb;font-family:Inter,Arial,sans-serif;color:#17202a;display:grid;place-items:center}
  .box{width:850px;height:850px;border-radius:56px;background:#fff;border:1px solid #d8e1ec;box-shadow:0 34px 90px rgba(18,31,56,.16);padding:70px;text-align:center}
  .logo{width:190px;height:190px;border-radius:42px;margin:0 auto 34px;border:1px solid #d8e1ec}.logo img{width:100%;height:100%;border-radius:42px}
  h1{font-size:72px;line-height:.98;margin:0 0 20px;letter-spacing:0}.copy{font-size:30px;line-height:1.35;color:#526070}.route{margin-top:42px;display:flex;justify-content:center;gap:12px}.dot{width:22px;height:22px;border-radius:999px;background:#1769e0}.dot:nth-child(2){background:#34c759}.dot:nth-child(3){background:#fbbf24}.dot:nth-child(4){background:#ef4444}
  </style></head><body><div class="box"><div class="logo"><img src="../logo.png" alt=""></div><h1>Build local plugin apps for agents.</h1><div class="copy">Codex / ChatGPT tools with policy, traces, and a native control console.</div><div class="route"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div></body></html>`;
}

function renderStoryThumbnail() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1080px;height:1920px;background:#101828;font-family:Inter,Arial,sans-serif;color:#fff;overflow:hidden}
  .wrap{padding:92px 72px}.logo{width:150px;height:150px;border-radius:34px;background:#fff;margin-bottom:48px}.logo img{width:100%;height:100%;border-radius:34px}
  .kicker{font-size:26px;font-weight:900;color:#7db3ff;text-transform:uppercase;letter-spacing:.08em}h1{font-size:92px;line-height:.95;margin:18px 0 26px;letter-spacing:0}.copy{font-size:38px;line-height:1.42;color:#d7e3f5}
  .phone{margin-top:72px;border:10px solid #fff;border-radius:42px;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.38)}.phone img{display:block;width:100%}.chips{display:flex;flex-wrap:wrap;gap:16px;margin-top:46px}.chip{font-size:28px;font-weight:800;border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:16px 22px;background:rgba(255,255,255,.08)}
  </style></head><body><div class="wrap"><div class="logo"><img src="../logo.png" alt=""></div><div class="kicker">Codex / ChatGPT Plugin App</div><h1>Give agents a safe local control surface.</h1><div class="copy">Focused MCP tools, OAuth tunnels, policy editing, traces, and screenshot-first setup guides.</div><div class="chips"><div class="chip">Plugin App</div><div class="chip">OAuth</div><div class="chip">Computer Use</div></div><div class="phone"><img src="../page-mobile.png" alt=""></div></div></body></html>`;
}

function renderXhsPromo() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:1242px;height:1660px;background:#f7f4ee;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#111827;overflow:hidden}
  .page{position:relative;width:100%;height:100%;padding:62px 68px;background:linear-gradient(180deg,#fffdf8 0%,#eef7ff 62%,#f7fff9 100%)}
  .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:34px}
  .brand{display:flex;align-items:center;gap:20px}.logo{width:104px;height:104px;border-radius:24px;background:#fff;border:1px solid #d9e6f2;box-shadow:0 18px 40px rgba(20,42,70,.16);overflow:hidden}.logo img{width:100%;height:100%;display:block}.brandText{font-size:29px;font-weight:900;line-height:1.05}.brandText span{display:block;font-size:18px;color:#64748b;margin-top:8px;font-weight:800}
  .badge{border:2px solid #111827;border-radius:999px;padding:13px 20px;font-size:22px;font-weight:900;background:#ffca3a;box-shadow:6px 6px 0 #111827}
  h1{font-size:78px;line-height:.98;letter-spacing:0;margin:0 0 20px;font-weight:950;max-width:1030px}.grad{background:linear-gradient(90deg,#126ee3,#10a37f);-webkit-background-clip:text;color:transparent}.sub{font-size:30px;line-height:1.32;color:#334155;max-width:1010px;margin:0 0 28px;font-weight:650}
  .route{height:108px;border:3px solid #111827;border-radius:24px;background:#fff;box-shadow:7px 7px 0 #111827;display:grid;grid-template-columns:1fr 78px 1fr 78px 1fr;align-items:center;padding:0 26px;margin-bottom:24px}.node{text-align:center;font-size:23px;font-weight:900}.node small{display:block;font-size:16px;color:#64748b;margin-top:6px}.arrow{text-align:center;font-size:40px;color:#126ee3;font-weight:950}
  .shots{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:24px}.shot{height:296px;border:3px solid #111827;border-radius:25px;background:#fff;box-shadow:7px 7px 0 #111827;overflow:hidden}.shotHead{height:46px;background:#f4f7fb;border-bottom:2px solid #d9e6f2;display:flex;align-items:center;gap:9px;padding:0 16px;font-size:18px;font-weight:900}.dot{width:11px;height:11px;border-radius:50%;background:#ff5f57;box-shadow:18px 0 #ffbd2e,36px 0 #28c840}.toolBody{padding:20px 22px}.toolName{font-size:27px;font-weight:950;margin-bottom:15px}.code{background:#f8fafc;border:1px solid #d9e6f2;border-radius:16px;padding:14px 15px;font:700 18px ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.55;color:#1f2937}.ok{color:#10a37f}.appGrid{padding:17px;display:grid;grid-template-columns:112px 1fr;gap:15px}.side{background:#eef4fb;border-radius:16px;height:212px;padding:13px}.nav{height:25px;border-radius:8px;background:#dbeafe;margin-bottom:10px}.nav.on{background:#126ee3}.dash{display:grid;grid-template-columns:1fr 1fr;gap:11px}.tile{height:64px;border-radius:14px;background:#f8fafc;border:1px solid #d9e6f2;padding:10px;font-size:15px;font-weight:800}.tile b{display:block;font-size:24px;color:#111827}.trace{grid-column:1/3;height:68px;border-radius:14px;background:#111827;color:#7cf6c2;padding:12px;font:700 17px ui-monospace,SFMono-Regular,Menlo,monospace}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}.card{min-height:126px;background:#fff;border:2px solid #d9e6f2;border-radius:22px;padding:19px 17px;box-shadow:0 14px 34px rgba(20,42,70,.08)}.card strong{display:block;font-size:24px;line-height:1.1;margin-bottom:10px}.card p{font-size:18px;line-height:1.24;color:#475569;margin:0;font-weight:700}.card.blue{border-color:#bcd7ff;background:#f7fbff}.card.green{border-color:#b9f0d3;background:#f5fffa}.card.yellow{border-color:#ffe0a6;background:#fffaf0}.card.red{border-color:#ffc9c9;background:#fff7f7}
  .proof{display:grid;grid-template-columns:1.15fr .85fr;gap:24px;margin-bottom:24px}.panel{border:3px solid #111827;border-radius:28px;background:#111827;color:#f8fafc;padding:24px;box-shadow:8px 8px 0 #10a37f}.panel h2{font-size:31px;line-height:1.08;margin:0 0 13px}.metric{display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,.16);padding:11px 0;font-size:21px}.metric b{font-size:30px;color:#7cf6c2}.warn{border:3px solid #111827;border-radius:28px;background:#fff;box-shadow:8px 8px 0 #ffca3a;padding:24px}.warn h2{font-size:30px;line-height:1.08;margin:0 0 12px}.warn p{font-size:22px;line-height:1.28;margin:0;color:#334155;font-weight:700}.warn .x{display:inline-block;background:#fff1f2;color:#be123c;border-radius:12px;padding:4px 10px}
  .footer{position:absolute;left:68px;right:68px;bottom:50px;display:flex;align-items:end;justify-content:space-between;border-top:2px solid #d9e6f2;padding-top:18px}.repo{font-size:27px;font-weight:950}.repo span{display:block;color:#126ee3;margin-top:7px}.line{font-size:20px;line-height:1.3;color:#64748b;text-align:right;font-weight:750;max-width:430px}
  </style></head><body><main class="page"><section class="top"><div class="brand"><div class="logo"><img src="../logo.png" alt=""></div><div class="brandText">ChatGPT2LocalBridge<span>Codex / ChatGPT Plugin App</span></div></div><div class="badge">MCP ready</div></section><h1>把本地文件<br><span class="grad">挂到 ChatGPT</span></h1><p class="sub">OAuth 授权、策略白名单、Trace 记录，让 ChatGPT 只访问你批准的项目目录。</p><section class="route"><div class="node">ChatGPT<small>云端对话</small></div><div class="arrow">→</div><div class="node">MCP Bridge<small>OAuth + Policy</small></div><div class="arrow">→</div><div class="node">Local Files<small>批准目录</small></div></section><section class="shots"><div class="shot"><div class="shotHead"><span class="dot"></span><span>ChatGPT 工具调用证据</span></div><div class="toolBody"><div class="toolName">file_read_path</div><div class="code">request: &lt;approved-workspace&gt;<br>response: CHATGPT_WRITE_TEST.md<br><span class="ok">content returned: OK</span></div></div></div><div class="shot"><div class="shotHead"><span class="dot"></span><span>macOS App 控制台</span></div><div class="appGrid"><div class="side"><div class="nav on"></div><div class="nav"></div><div class="nav"></div><div class="nav"></div></div><div class="dash"><div class="tile">OAuth<b>On</b></div><div class="tile">Tools<b>10</b></div><div class="tile">Trace<b>OK</b></div><div class="tile">App<b>OK</b></div><div class="trace">bridge_health → policy_read → file_read</div></div></div></div></section><section class="grid"><div class="card blue"><strong>本地可读</strong><p>目录文件返回</p></div><div class="card green"><strong>可写可追踪</strong><p>写入有审计</p></div><div class="card yellow"><strong>原生控制台</strong><p>策略和 Trace</p></div><div class="card red"><strong>安全默认</strong><p>OAuth 优先</p></div></section><section class="proof"><div class="panel"><h2>实测证据</h2><div class="metric"><span>ChatGPT App tools</span><b>10</b></div><div class="metric"><span>Write smoke test</span><b>OK</b></div><div class="metric"><span>Cloud download</span><b>OK</b></div><div class="metric"><span>OAuth metadata</span><b>OK</b></div></div><div class="warn"><h2>实测备注</h2><p>默认别开 <span class="x">xhigh</span>。它在本地测试里报错更多，先用普通模式跑通。</p></div></section><footer class="footer"><div class="repo">GitHub<span>Harzva/chatgpt2localbridge</span></div><div class="line">鼓励大家开发自己的 ChatGPT / Codex Plugin App，给 AI 一个安全、可审计的本地控制面。</div></footer></main></body></html>`;
}

function renderXhsCommunity() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:1242px;height:1660px;background:#fffaf0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#111827;overflow:hidden}
  .page{width:100%;height:100%;padding:70px;background:linear-gradient(180deg,#fffdf8 0%,#f2f8ff 56%,#f7fff9 100%)}
  .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:44px}.brand{display:flex;align-items:center;gap:18px}.logo{width:104px;height:104px;border-radius:24px;background:#fff;border:1px solid #d9e6f2;box-shadow:0 18px 40px rgba(20,42,70,.16);overflow:hidden}.logo img{width:100%;height:100%}.name{font-size:30px;font-weight:950}.name span{display:block;font-size:18px;color:#64748b;margin-top:8px}.badge{border:2px solid #111827;border-radius:999px;background:#10a37f;color:white;padding:13px 20px;font-size:22px;font-weight:900;box-shadow:6px 6px 0 #111827}
  h1{font-size:78px;line-height:1;letter-spacing:0;margin:0 0 20px;font-weight:950}.grad{background:linear-gradient(90deg,#126ee3,#8b5cf6);-webkit-background-clip:text;color:transparent}.sub{font-size:30px;line-height:1.33;color:#334155;font-weight:700;margin:0 0 34px;max-width:1000px}
  .evidence{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}.window{height:344px;border:3px solid #111827;border-radius:28px;background:#fff;box-shadow:8px 8px 0 #111827;overflow:hidden}.bar{height:48px;background:#f4f7fb;border-bottom:2px solid #d9e6f2;display:flex;align-items:center;gap:9px;padding:0 16px;font-size:18px;font-weight:900}.dot{width:11px;height:11px;border-radius:50%;background:#ff5f57;box-shadow:18px 0 #ffbd2e,36px 0 #28c840}.body{padding:23px}.tool{font-size:30px;font-weight:950;margin-bottom:16px}.code{background:#f8fafc;border:1px solid #d9e6f2;border-radius:16px;padding:15px;font:700 18px ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.55;color:#1f2937}.red{color:#be123c}.green{color:#10a37f}
  .todo{border:3px solid #111827;border-radius:30px;background:#111827;color:#f8fafc;padding:30px;box-shadow:9px 9px 0 #ffca3a;margin-bottom:28px}.todo h2{font-size:39px;margin:0 0 20px}.items{display:grid;grid-template-columns:1fr 1fr;gap:17px}.item{border:1px solid rgba(255,255,255,.18);border-radius:20px;padding:18px;background:rgba(255,255,255,.06)}.item b{display:block;font-size:25px;margin-bottom:8px}.item span{font-size:20px;line-height:1.28;color:#d7e3f5;font-weight:700}
  .pr{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-bottom:36px}.card{min-height:164px;background:#fff;border:2px solid #d9e6f2;border-radius:24px;padding:22px;box-shadow:0 16px 36px rgba(20,42,70,.09)}.card b{display:block;font-size:29px;margin-bottom:12px}.card span{font-size:21px;line-height:1.28;color:#475569;font-weight:700}.card.blue{border-color:#bcd7ff}.card.green{border-color:#b9f0d3}.card.purple{border-color:#d8c7ff}
  .cta{border:3px solid #111827;border-radius:30px;background:#fff;box-shadow:9px 9px 0 #10a37f;padding:30px;display:flex;justify-content:space-between;gap:28px;align-items:end}.repo{font-size:30px;font-weight:950}.repo span{display:block;color:#126ee3;margin-top:10px}.copy{font-size:24px;line-height:1.32;color:#334155;text-align:right;font-weight:800;max-width:520px}
  </style></head><body><main class="page"><section class="top"><div class="brand"><div class="logo"><img src="../logo.png" alt=""></div><div class="name">ChatGPT2LocalBridge<span>Open-source Plugin App</span></div></div><div class="badge">PR welcome</div></section><h1>欢迎开发者<br><span class="grad">一起共建</span></h1><p class="sub">这不是裸 shell 代理：策略会拦截风险命令。下一步重点是 Linux 适配，欢迎 Issue 和 PR。</p><section class="evidence"><div class="window"><div class="bar"><span class="dot"></span><span>安全策略证据</span></div><div class="body"><div class="tool">shell_exec</div><div class="code">request: risky wording<br><span class="red">blocked by policy</span><br>rewrite as plain text<br><span class="green">TXT saved: OK</span></div></div></div><div class="window"><div class="bar"><span class="dot"></span><span>工具调用链路</span></div><div class="body"><div class="tool">MCP trace</div><div class="code">bridge_health → OK<br>policy_read → OK<br>file_read_path → OK<br>cloud_download → OK</div></div></div></section><section class="todo"><h2>Linux Todo</h2><div class="items"><div class="item"><b>systemd service</b><span>稳定后台运行和日志</span></div><div class="item"><b>Tunnel examples</b><span>Cloudflare / ngrok 配置</span></div><div class="item"><b>Security profile</b><span>更细的 shell 和 root 策略</span></div><div class="item"><b>Distro docs</b><span>Ubuntu / Debian / Arch 实测</span></div></div></section><section class="pr"><div class="card blue"><b>需要 PR</b><span>Linux 安装脚本、服务模板、部署教程。</span></div><div class="card green"><b>需要实测</b><span>不同服务器、VPN、隧道、权限模型。</span></div><div class="card purple"><b>需要插件</b><span>欢迎做自己的 ChatGPT / Codex Plugin App。</span></div></section><section class="cta"><div class="repo">GitHub<span>Harzva/chatgpt2localbridge</span></div><div class="copy">想让 ChatGPT 更安全地连接本地和服务器？来一起补 Linux 适配。</div></section></main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}
