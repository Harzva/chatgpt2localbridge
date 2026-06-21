import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { BridgeConfig } from './config.js';

const MAX_BODY_BYTES = 64 * 1024;

interface OAuthClient {
  client_id: string;
  client_id_issued_at: number;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
  scope: string;
}

interface AuthorizationCodeRecord {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource?: string;
  scope: string;
  expires_at: number;
  created_at: number;
}

interface AccessTokenRecord {
  token_hash: string;
  client_id: string;
  resource: string;
  scope: string;
  expires_at: number;
  created_at: number;
}

interface OAuthStoreData {
  clients: Record<string, OAuthClient>;
  codes: Record<string, AuthorizationCodeRecord>;
  tokens: Record<string, AccessTokenRecord>;
}

interface OAuthContext {
  issuer: string;
  resource: string;
  scopes: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  protectedResourceMetadataUrl: string;
  authorizationServerMetadataUrl: string;
}

interface ParsedRequestBody {
  values: Record<string, unknown>;
}

export async function handleOAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: BridgeConfig,
): Promise<boolean> {
  if (!config.oauth.enabled) return false;

  if (req.method === 'GET' && isProtectedResourceMetadataPath(url.pathname)) {
    return sendJson(res, 200, getProtectedResourceMetadata(config));
  }

  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
    return sendJson(res, 200, getAuthorizationServerMetadata(config));
  }

  if (req.method === 'POST' && url.pathname === '/oauth/register') {
    return handleDynamicClientRegistration(req, res, config);
  }

  if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
    return handleAuthorizeGet(req, res, url, config);
  }

  if (req.method === 'POST' && url.pathname === '/oauth/authorize') {
    return handleAuthorizePost(req, res, config);
  }

  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    return handleToken(req, res, config);
  }

  return false;
}

export function isOAuthTokenAuthorized(config: BridgeConfig, token: string | undefined): boolean {
  if (!config.oauth.enabled || !token) return false;
  const now = Date.now();
  const store = loadStore(config);
  const tokenHash = sha256(token);
  let changed = false;

  for (const [hash, record] of Object.entries(store.tokens)) {
    if (record.expires_at <= now) {
      delete store.tokens[hash];
      changed = true;
      continue;
    }
    if (hash === tokenHash && hasRequiredScopes(record.scope, config.oauth.scopes)) {
      if (changed) saveStore(config, store);
      return true;
    }
  }

  if (changed) saveStore(config, store);
  return false;
}

export function addOAuthChallenge(
  res: ServerResponse,
  config: BridgeConfig,
): void {
  if (!config.oauth.enabled) return;
  const ctx = getOAuthContext(config);
  const scope = config.oauth.scopes.join(' ');
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="chatgpt2localbridge", resource_metadata="${ctx.protectedResourceMetadataUrl}", scope="${scope}"`,
  );
}

export function getOAuthContext(config: BridgeConfig): OAuthContext {
  const issuer = normalizeBaseUrl(config.oauth.publicBaseUrl ?? 'http://localhost:3838');
  const resource = `${issuer}/mcp`;
  return {
    issuer,
    resource,
    scopes: config.oauth.scopes,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    authorizationServerMetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
  };
}

function getProtectedResourceMetadata(config: BridgeConfig): Record<string, unknown> {
  const ctx = getOAuthContext(config);
  return {
    resource: ctx.resource,
    resource_name: 'ChatGPT2LocalBridge',
    authorization_servers: [ctx.issuer],
    scopes_supported: ctx.scopes,
    bearer_methods_supported: ['header'],
  };
}

function getAuthorizationServerMetadata(config: BridgeConfig): Record<string, unknown> {
  const ctx = getOAuthContext(config);
  return {
    issuer: ctx.issuer,
    authorization_endpoint: ctx.authorizationEndpoint,
    token_endpoint: ctx.tokenEndpoint,
    registration_endpoint: ctx.registrationEndpoint,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ctx.scopes,
    resource_parameter_supported: true,
  };
}

async function handleDynamicClientRegistration(
  req: IncomingMessage,
  res: ServerResponse,
  config: BridgeConfig,
): Promise<boolean> {
  const body = await parseRequestBody(req);
  const redirectUris = asStringArray(body.values.redirect_uris);

  if (redirectUris.length === 0 || !redirectUris.every(isHttpsUrl)) {
    sendJson(res, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris must be HTTPS URLs' });
    return true;
  }

  const scope = normalizeRequestedScope(String(body.values.scope ?? config.oauth.scopes.join(' ')), config.oauth.scopes);
  const now = Math.floor(Date.now() / 1000);
  const client: OAuthClient = {
    client_id: `dcr_${randomToken(24)}`,
    client_id_issued_at: now,
    client_name: typeof body.values.client_name === 'string' ? body.values.client_name : 'ChatGPT',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope,
  };

  const store = loadStore(config);
  store.clients[client.client_id] = client;
  saveStore(config, store);

  sendJson(res, 201, {
    ...client,
    client_secret_expires_at: 0,
  });
  return true;
}

function handleAuthorizeGet(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: BridgeConfig,
): boolean {
  const validation = validateAuthorizeParams(url.searchParams, config);
  if (!validation.ok) {
    sendHtml(res, 400, renderAuthorizePage(config, Object.fromEntries(url.searchParams), validation.error));
    return true;
  }

  sendHtml(res, 200, renderAuthorizePage(config, Object.fromEntries(url.searchParams)));
  return true;
}

async function handleAuthorizePost(
  req: IncomingMessage,
  res: ServerResponse,
  config: BridgeConfig,
): Promise<boolean> {
  const body = await parseRequestBody(req);
  const values = normalizeValues(body.values);
  const validation = validateAuthorizeParams(new URLSearchParams(stringEntries(values)), config);

  if (!validation.ok) {
    sendHtml(res, 400, renderAuthorizePage(config, values, validation.error));
    return true;
  }

  if (!config.oauth.unlockCode) {
    sendHtml(res, 403, renderAuthorizePage(config, values, 'OAuth unlock code is not configured on this Mac.'));
    return true;
  }

  if (!constantTimeEqual(values.unlock_code ?? '', config.oauth.unlockCode)) {
    sendHtml(res, 403, renderAuthorizePage(config, values, 'Unlock code was not accepted.'));
    return true;
  }

  const scope = normalizeRequestedScope(values.scope ?? config.oauth.scopes.join(' '), config.oauth.scopes);
  const code = `code_${randomToken(32)}`;
  const now = Date.now();
  const record: AuthorizationCodeRecord = {
    code,
    client_id: values.client_id ?? '',
    redirect_uri: values.redirect_uri ?? '',
    code_challenge: values.code_challenge ?? '',
    resource: values.resource || getOAuthContext(config).resource,
    scope,
    created_at: now,
    expires_at: now + config.oauth.codeTtlSeconds * 1000,
  };

  const store = loadStore(config);
  pruneStore(store, now);
  store.codes[code] = record;
  saveStore(config, store);

  const redirectUrl = new URL(record.redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (values.state) redirectUrl.searchParams.set('state', values.state);

  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
  return true;
}

async function handleToken(
  req: IncomingMessage,
  res: ServerResponse,
  config: BridgeConfig,
): Promise<boolean> {
  const body = await parseRequestBody(req);
  const values = normalizeValues(body.values);

  if (values.grant_type !== 'authorization_code') {
    sendJson(res, 400, { error: 'unsupported_grant_type' });
    return true;
  }

  const code = values.code;
  const clientId = values.client_id;
  const redirectUri = values.redirect_uri;
  const codeVerifier = values.code_verifier;
  if (!code || !clientId || !redirectUri || !codeVerifier) {
    sendJson(res, 400, { error: 'invalid_request' });
    return true;
  }

  const now = Date.now();
  const store = loadStore(config);
  pruneStore(store, now);
  const codeRecord = store.codes[code];
  const client = store.clients[clientId];
  if (!codeRecord || !client || codeRecord.expires_at <= now) {
    saveStore(config, store);
    sendJson(res, 400, { error: 'invalid_grant' });
    return true;
  }

  if (
    codeRecord.client_id !== clientId
    || codeRecord.redirect_uri !== redirectUri
    || !client.redirect_uris.includes(redirectUri)
    || pkceS256(codeVerifier) !== codeRecord.code_challenge
  ) {
    delete store.codes[code];
    saveStore(config, store);
    sendJson(res, 400, { error: 'invalid_grant' });
    return true;
  }

  const accessToken = `atk_${randomToken(40)}`;
  const tokenRecord: AccessTokenRecord = {
    token_hash: sha256(accessToken),
    client_id: clientId,
    resource: codeRecord.resource ?? getOAuthContext(config).resource,
    scope: codeRecord.scope,
    created_at: now,
    expires_at: now + config.oauth.tokenTtlSeconds * 1000,
  };

  delete store.codes[code];
  store.tokens[tokenRecord.token_hash] = tokenRecord;
  saveStore(config, store);

  sendJson(res, 200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.oauth.tokenTtlSeconds,
    scope: tokenRecord.scope,
  });
  return true;
}

function validateAuthorizeParams(
  params: URLSearchParams,
  config: BridgeConfig,
): { ok: true } | { ok: false; error: string } {
  const store = loadStore(config);
  const ctx = getOAuthContext(config);
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const responseType = params.get('response_type');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const resource = params.get('resource');
  const scope = params.get('scope') ?? config.oauth.scopes.join(' ');

  if (responseType !== 'code') return { ok: false, error: 'response_type must be code.' };
  if (!clientId || !store.clients[clientId]) {
    const recovered = recoverUnknownDynamicClient(params, config, store);
    if (!recovered) return { ok: false, error: 'Unknown OAuth client.' };
  }
  const client = clientId ? store.clients[clientId] : undefined;
  if (!client) return { ok: false, error: 'Unknown OAuth client.' };
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return { ok: false, error: 'redirect_uri is not registered for this client.' };
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return { ok: false, error: 'PKCE S256 is required.' };
  }
  if (resource && resource !== ctx.resource && resource !== ctx.issuer) {
    return { ok: false, error: 'OAuth resource does not match this bridge.' };
  }
  if (!requestedScopesAllowed(scope, config.oauth.scopes)) {
    return { ok: false, error: 'Requested scope is not supported.' };
  }

  return { ok: true };
}

function recoverUnknownDynamicClient(
  params: URLSearchParams,
  config: BridgeConfig,
  store: OAuthStoreData,
): boolean {
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const responseType = params.get('response_type');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const scope = params.get('scope') ?? config.oauth.scopes.join(' ');

  if (!clientId?.startsWith('dcr_')) return false;
  if (responseType !== 'code') return false;
  if (!redirectUri || !isTrustedChatGPTRedirectUri(redirectUri)) return false;
  if (!codeChallenge || codeChallengeMethod !== 'S256') return false;
  if (!requestedScopesAllowed(scope, config.oauth.scopes)) return false;

  const now = Math.floor(Date.now() / 1000);
  store.clients[clientId] = {
    client_id: clientId,
    client_id_issued_at: now,
    client_name: 'ChatGPT',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: normalizeRequestedScope(scope, config.oauth.scopes),
  };
  saveStore(config, store);
  return true;
}

async function parseRequestBody(req: IncomingMessage): Promise<ParsedRequestBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('OAuth request body too large');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    const parsed = raw ? JSON.parse(raw) : {};
    return { values: isRecord(parsed) ? parsed : {} };
  }
  const params = new URLSearchParams(raw);
  return { values: Object.fromEntries(params) };
}

function renderAuthorizePage(
  config: BridgeConfig,
  values: Record<string, string | undefined>,
  error?: string,
): string {
  const scope = values.scope ?? config.oauth.scopes.join(' ');
  const client = values.client_id ? loadStore(config).clients[values.client_id] : undefined;
  const hiddenInputs = [
    'response_type',
    'client_id',
    'redirect_uri',
    'code_challenge',
    'code_challenge_method',
    'state',
    'resource',
    'scope',
  ]
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(values[name] ?? '')}">`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ChatGPT2LocalBridge</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #17202a; }
    main { width: min(520px, calc(100vw - 32px)); background: white; border: 1px solid #d8dee7; border-radius: 8px; padding: 24px; box-shadow: 0 14px 40px rgba(24, 32, 48, .12); }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { line-height: 1.5; margin: 10px 0; }
    code { background: #edf1f7; padding: 2px 5px; border-radius: 4px; }
    label { display: block; font-weight: 600; margin-top: 18px; }
    input[type="password"] { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 10px 12px; border: 1px solid #b8c2d0; border-radius: 6px; font-size: 15px; }
    button { margin-top: 18px; width: 100%; padding: 11px 14px; border: 0; border-radius: 6px; background: #0f62fe; color: white; font-weight: 700; font-size: 15px; cursor: pointer; }
    .error { background: #fff0f0; color: #9f1239; border: 1px solid #fecdd3; border-radius: 6px; padding: 10px 12px; }
    .meta { color: #526070; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Authorize ChatGPT2LocalBridge</h1>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <p>Allow <strong>${escapeHtml(client?.client_name ?? 'ChatGPT')}</strong> to access approved local workspaces on this Mac.</p>
    <p class="meta">Requested scope: <code>${escapeHtml(scope)}</code></p>
    <p class="meta">Only continue if you started this connection from ChatGPT.</p>
    <form method="post" action="/oauth/authorize">
      ${hiddenInputs}
      <label for="unlock_code">Bridge unlock code</label>
      <input id="unlock_code" name="unlock_code" type="password" autocomplete="one-time-code" required autofocus>
      <button type="submit">Authorize</button>
    </form>
  </main>
</body>
</html>`;
}

function isProtectedResourceMetadataPath(pathname: string): boolean {
  return pathname === '/.well-known/oauth-protected-resource'
    || pathname === '/.well-known/oauth-protected-resource/mcp';
}

function loadStore(config: BridgeConfig): OAuthStoreData {
  const filePath = storePath(config);
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<OAuthStoreData>;
    return {
      clients: raw.clients ?? {},
      codes: raw.codes ?? {},
      tokens: raw.tokens ?? {},
    };
  } catch (err) {
    console.error('[oauth] failed to load store:', err);
    return emptyStore();
  }
}

function saveStore(config: BridgeConfig, store: OAuthStoreData): void {
  const filePath = storePath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function storePath(config: BridgeConfig): string {
  return path.join(config.dataDir, 'oauth', 'store.json');
}

function emptyStore(): OAuthStoreData {
  return { clients: {}, codes: {}, tokens: {} };
}

function pruneStore(store: OAuthStoreData, now: number): void {
  for (const [code, record] of Object.entries(store.codes)) {
    if (record.expires_at <= now) delete store.codes[code];
  }
  for (const [tokenHash, record] of Object.entries(store.tokens)) {
    if (record.expires_at <= now) delete store.tokens[tokenHash];
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isTrustedChatGPTRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com');
  } catch {
    return false;
  }
}

function normalizeRequestedScope(scope: string, allowed: string[]): string {
  return scope
    .split(/\s+/)
    .filter((item) => allowed.includes(item))
    .join(' ') || allowed.join(' ');
}

function requestedScopesAllowed(scope: string, allowed: string[]): boolean {
  return scope.split(/\s+/).filter(Boolean).every((item) => allowed.includes(item));
}

function hasRequiredScopes(granted: string, required: string[]): boolean {
  const grantedSet = new Set(granted.split(/\s+/).filter(Boolean));
  return required.every((scope) => grantedSet.has(scope));
}

function normalizeValues(values: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = typeof value === 'string' ? value : undefined;
  }
  return out;
}

function stringEntries(values: Record<string, string | undefined>): Array<[string, string]> {
  return Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char));
}
