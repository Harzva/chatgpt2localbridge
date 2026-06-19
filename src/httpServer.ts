import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { BridgeConfig } from './config.js';
import { createMcpServer } from './mcpServer.js';
import {
  addOAuthChallenge,
  handleOAuthRequest,
  isOAuthTokenAuthorized,
} from './oauth.js';
import { handleDashboardRequest } from './dashboard.js';

// ── HTTP Transport for ChatGPT MCP Connectors ───────────────────────────────
//
// Exposes the same MCP tools as the stdio server over Streamable HTTP.
// This is for MCP clients that need an HTTP URL, such as hosted ChatGPT
// connectors behind a tunnel. There is intentionally no browser extension API.

interface HttpServerDeps {
  config: BridgeConfig;
}

export async function startHttpServer(
  deps: HttpServerDeps,
  port: number,
): Promise<void> {
  const { config } = deps;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS for MCP HTTP clients and local tunnel health checks.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization, X-LocalBridge-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;

    if (handleDashboardRequest(req, res, url, config)) return;

    try {
      if (await handleOAuthRequest(req, res, url, config)) return;
    } catch (err) {
      console.error('[http] OAuth error:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'OAuth server error' });
      return;
    }

    // ── Health check ────────────────────────────────────────────────────────
    if (path === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'chatgpt2localbridge',
        version: '0.1.0',
      });
    }

    // ── MCP Streamable HTTP ─────────────────────────────────────────────────
    if (path === '/mcp') {
      if (!isAuthorized(req, url, config)) {
        addOAuthChallenge(res, config);
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createMcpServer(config);
        transport.onerror = (err) => console.error('[http] transport error:', err.message);
        await server.connect(transport);
        await transport.handleRequest(req, res);
        res.on('close', () => { transport.close().catch(() => {}); });
      } catch (err) {
        console.error('[http] MCP error:', err);
        if (!res.headersSent) sendJson(res, 500, { error: 'MCP server error' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found', endpoints: ['/health', '/mcp'] });
  });

  httpServer.listen(port, () => {
    console.error(`[bridge] HTTP server on http://localhost:${port}`);
    console.error(`[bridge]   /health      — status check`);
    console.error(`[bridge]   /mcp         — MCP Streamable HTTP`);
  });

  const shutdown = () => {
    console.error('[bridge] Shutting down...');
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function isAuthorized(req: IncomingMessage, url: URL, config: BridgeConfig): boolean {
  const token = config.authToken;
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const bridgeToken = req.headers['x-localbridge-token'];
  const urlToken = config.allowUrlTokenAuth
    ? url.searchParams.get('localbridge_token')
    : undefined;

  if (bearer && isOAuthTokenAuthorized(config, bearer)) return true;

  if (config.oauth.enabled) {
    if (!token) return false;
    return bearer === token || bridgeToken === token || urlToken === token;
  }

  if (!token) return true;
  return bearer === token || bridgeToken === token || urlToken === token;
}
