import { createServer } from 'node:http';

import { AppError, asErrorEnvelope, assert } from '../domain/errors.js';

const DEFAULT_BODY_LIMIT = 1024 * 1024;

function sendJson(response, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(bytes);
}

function allowedOrigin(request, allowlist) {
  const origin = request.headers.origin;
  if (!origin) return null;
  let normalized;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new AppError('ORIGIN_DENIED', 'Origin 格式无效。', 403);
  }
  const sameOrigin = `http://${request.headers.host}`;
  assert(normalized === sameOrigin || allowlist.has(normalized), 'ORIGIN_DENIED', 'Origin 不在精确 allowlist 中。', 403);
  return normalized;
}

async function readJson(request, limit, onBodyRead) {
  onBodyRead?.();
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new AppError('BODY_TOO_LARGE', `请求体超过 ${limit} bytes。`, 413, { limit });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON', '请求体不是有效 JSON。', 400);
  }
}

export function createRequestHandler({ service, allowedOrigins = [], bodyLimit = DEFAULT_BODY_LIMIT, onBodyRead = null }) {
  const allowlist = new Set(allowedOrigins);
  assert(!allowlist.has('*'), 'CORS_CONFIGURATION_INVALID', 'CORS allowlist 禁止使用 *。', 500);
  return async function requestHandler(request, response) {
    const traceId = request.headers['x-trace-id'] ?? null;
    let corsOrigin = null;
    try {
      // Security invariant: this check occurs before route handling and before body consumption.
      corsOrigin = allowedOrigin(request, allowlist);
      const corsHeaders = corsOrigin ? { 'access-control-allow-origin': corsOrigin, vary: 'Origin' } : {};
      const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { ...corsHeaders, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-trace-id' });
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health/live') {
        sendJson(response, 200, { status: 'live', service: 'relayos', gate: 'P2' }, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health/ready') {
        const ready = await service.readiness();
        sendJson(response, ready.status === 'ready' ? 200 : 503, ready, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/scenarios') {
        sendJson(response, 200, { scenarios: service.listScenarios() }, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/work-cases') {
        sendJson(response, 200, { workCases: service.listWorkCases({ scenario: url.searchParams.get('scenario'), status: url.searchParams.get('status'), owner: url.searchParams.get('owner') }) }, corsHeaders);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/work-cases') {
        const body = await readJson(request, bodyLimit, onBodyRead);
        const id = body.payload?.id;
        const result = await service.executeCommand(id, { ...body, commandType: 'workCase.create' });
        sendJson(response, 201, result, corsHeaders);
        return;
      }
      const commandMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)\/commands$/);
      if (request.method === 'POST' && commandMatch) {
        const body = await readJson(request, bodyLimit, onBodyRead);
        const result = await service.executeCommand(decodeURIComponent(commandMatch[1]), body);
        sendJson(response, 200, result, corsHeaders);
        return;
      }
      const eventsMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)\/events$/);
      if (request.method === 'GET' && eventsMatch) {
        const after = Number(url.searchParams.get('after') ?? 0);
        assert(Number.isInteger(after) && after >= 0, 'INVALID_INPUT', 'after 必须是非负整数。');
        sendJson(response, 200, { events: service.getEvents(decodeURIComponent(eventsMatch[1]), after) }, corsHeaders);
        return;
      }
      const replayMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)\/replay$/);
      if (request.method === 'GET' && replayMatch) {
        sendJson(response, 200, service.replay(decodeURIComponent(replayMatch[1])), corsHeaders);
        return;
      }
      const caseMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)$/);
      if (request.method === 'GET' && caseMatch) {
        sendJson(response, 200, service.getWorkCase(decodeURIComponent(caseMatch[1])), corsHeaders);
        return;
      }
      throw new AppError('ROUTE_NOT_FOUND', 'API route 不存在。', 404);
    } catch (error) {
      const mapped = asErrorEnvelope(error, traceId);
      const headers = corsOrigin ? { 'access-control-allow-origin': corsOrigin, vary: 'Origin' } : {};
      sendJson(response, mapped.status, mapped.body, headers);
    }
  };
}

export function createRelayHttpServer(options) {
  return createServer(createRequestHandler(options));
}
