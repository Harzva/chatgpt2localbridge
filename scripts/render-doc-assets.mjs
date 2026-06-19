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
];

for (const step of steps) {
  const htmlPath = path.join(mockupsDir, `${step.name}.html`);
  const pngPath = path.join(screenshotsDir, `${step.name}.png`);
  fs.writeFileSync(htmlPath, renderMockup(step), 'utf8');
  screenshot(htmlPath, pngPath, 1400, 900);
}

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
  body{margin:0;width:512px;height:512px;display:grid;place-items:center;background:#f7fbff;font-family:Inter,Arial,sans-serif}
  .mark{width:390px;height:390px;border-radius:92px;background:#ffffff;border:10px solid #1769e0;box-shadow:0 24px 60px rgba(23,105,224,.18);position:relative}
  .folder{position:absolute;left:78px;top:205px;width:235px;height:125px;background:#fbbf24;border:9px solid #17202a;border-radius:24px}
  .folder:before{content:"";position:absolute;left:18px;top:-45px;width:104px;height:52px;background:#fbbf24;border:9px solid #17202a;border-bottom:0;border-radius:22px 22px 0 0}
  .key{position:absolute;left:95px;top:78px;width:180px;height:62px;border-radius:34px;border:9px solid #17202a;background:#fff}
  .key:before{content:"";position:absolute;left:18px;top:13px;width:38px;height:38px;border-radius:50%;background:#34c759;border:8px solid #17202a}
  .key:after{content:"";position:absolute;right:-58px;top:23px;width:72px;height:16px;background:#17202a;box-shadow:42px 0 0 #17202a}
  .route{position:absolute;left:80px;top:164px;width:248px;height:0;border-top:12px dashed #1769e0}
  </style></head><body><div class="mark"><div class="key"></div><div class="route"></div><div class="folder"></div></div></body></html>`;
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
  </style></head><body><div class="wrap"><div class="kicker">MCP Connector for local workspaces</div><h1>ChatGPT meets approved local files.</h1><p>OAuth authorization, HTTPS tunnel options, and screenshot-first setup guides for humans and agents.</p><div class="steps"><div class="chip">OAuth</div><div class="chip">npx install</div><div class="chip">GitHub Pages</div></div><div class="desktop"><img src="../page-desktop.png" alt=""></div><div class="phone"><img src="../page-mobile.png" alt=""></div></div></body></html>`;
}

function renderMatrixThumbnail() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1200px;height:675px;background:#17202a;font-family:Inter,Arial,sans-serif;color:#fff;display:grid;place-items:center}
  .card{width:1040px;height:540px;border-radius:34px;background:#f7fbff;color:#17202a;padding:40px;display:grid;grid-template-columns:1fr 420px;gap:34px;box-shadow:0 28px 80px rgba(0,0,0,.32)}
  h1{font-size:56px;line-height:1;margin:0 0 16px;letter-spacing:0}.tag{font-size:18px;color:#1769e0;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.copy{font-size:24px;line-height:1.5;color:#526070}.preview{border:1px solid #d8e1ec;border-radius:18px;overflow:hidden;align-self:center}.preview img{display:block;width:100%}.badges{display:flex;gap:12px;margin-top:26px}.badge{background:#e9f3ff;color:#1769e0;border-radius:999px;padding:11px 14px;font-weight:800}
  </style></head><body><div class="card"><div><div class="tag">ChatGPT2LocalBridge</div><h1>OAuth MCP bridge for approved files.</h1><div class="copy">A public-ready local connector with human and Computer Use setup guides.</div><div class="badges"><div class="badge">MCP</div><div class="badge">OAuth</div><div class="badge">Local-first</div></div></div><div class="preview"><img src="../screenshots/05-connector.png" alt=""></div></div></body></html>`;
}

function renderSquareThumbnail() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1080px;height:1080px;background:#f6f8fb;font-family:Inter,Arial,sans-serif;color:#17202a;display:grid;place-items:center}
  .box{width:850px;height:850px;border-radius:56px;background:#fff;border:1px solid #d8e1ec;box-shadow:0 34px 90px rgba(18,31,56,.16);padding:70px;text-align:center}
  .logo{width:190px;height:190px;border-radius:42px;margin:0 auto 34px;border:1px solid #d8e1ec}.logo img{width:100%;height:100%;border-radius:42px}
  h1{font-size:72px;line-height:.98;margin:0 0 20px;letter-spacing:0}.copy{font-size:30px;line-height:1.35;color:#526070}.route{margin-top:42px;display:flex;justify-content:center;gap:12px}.dot{width:22px;height:22px;border-radius:999px;background:#1769e0}.dot:nth-child(2){background:#34c759}.dot:nth-child(3){background:#fbbf24}.dot:nth-child(4){background:#ef4444}
  </style></head><body><div class="box"><div class="logo"><img src="../logo.png" alt=""></div><h1>Local files, approved by OAuth.</h1><div class="copy">A self-hosted MCP connector for ChatGPT.</div><div class="route"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div></body></html>`;
}

function renderStoryThumbnail() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1080px;height:1920px;background:#101828;font-family:Inter,Arial,sans-serif;color:#fff;overflow:hidden}
  .wrap{padding:92px 72px}.logo{width:150px;height:150px;border-radius:34px;background:#fff;margin-bottom:48px}.logo img{width:100%;height:100%;border-radius:34px}
  .kicker{font-size:26px;font-weight:900;color:#7db3ff;text-transform:uppercase;letter-spacing:.08em}h1{font-size:92px;line-height:.95;margin:18px 0 26px;letter-spacing:0}.copy{font-size:38px;line-height:1.42;color:#d7e3f5}
  .phone{margin-top:72px;border:10px solid #fff;border-radius:42px;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.38)}.phone img{display:block;width:100%}.chips{display:flex;flex-wrap:wrap;gap:16px;margin-top:46px}.chip{font-size:28px;font-weight:800;border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:16px 22px;background:rgba(255,255,255,.08)}
  </style></head><body><div class="wrap"><div class="logo"><img src="../logo.png" alt=""></div><div class="kicker">ChatGPT2LocalBridge</div><h1>Use ChatGPT with approved local workspaces.</h1><div class="copy">OAuth MCP connector, fixed HTTPS tunnels, and screenshot-first setup guides.</div><div class="chips"><div class="chip">npx</div><div class="chip">OAuth</div><div class="chip">Computer Use</div></div><div class="phone"><img src="../page-mobile.png" alt=""></div></div></body></html>`;
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
