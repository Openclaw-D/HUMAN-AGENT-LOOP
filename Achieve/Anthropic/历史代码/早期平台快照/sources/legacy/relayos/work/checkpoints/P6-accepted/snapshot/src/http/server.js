import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { parseExactOrigin } from '../config/runtime-config.js';
import { AppError, asErrorEnvelope, assert } from '../domain/errors.js';
import { OperationTracker } from '../ops/operation-tracker.js';
import { DELIVERY_GATE, SERVICE_NAME, SERVICE_VERSION } from '../version.js';
import { createAdvisoryRuntime } from './advisory-runtime.js';
import { serveStaticFile } from './static-files.js';

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sendJson(response, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(bytes);
}

function requestOrigin(rawOrigin) {
  if (typeof rawOrigin !== 'string' || rawOrigin.includes(',')) throw new AppError('ORIGIN_DENIED', 'Origin 格式无效。', 403);
  try {
    return parseExactOrigin(rawOrigin, 'Origin');
  } catch {
    throw new AppError('ORIGIN_DENIED', 'Origin 格式无效。', 403);
  }
}

function localSocketOrigin(request) {
  const address = request.socket.localAddress;
  const port = request.socket.localPort;
  if (!LOOPBACK_ADDRESSES.has(address) || !Number.isInteger(port)) return null;
  const normalized = address === '::ffff:127.0.0.1' ? '127.0.0.1' : address;
  const originHost = normalized.includes(':') ? `[${normalized}]` : normalized;
  return `http://${originHost}:${port}`;
}

function allowedOrigin(request, allowlist) {
  const raw = request.headers.origin;
  if (raw === undefined) return null;
  const origin = requestOrigin(raw);
  const implicitLocal = localSocketOrigin(request);
  assert(origin === implicitLocal || allowlist.has(origin), 'ORIGIN_DENIED', 'Origin 不在精确 allowlist 中。', 403);
  return origin;
}

function headerTraceId(request) {
  const raw = request.headers['x-trace-id'];
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !TRACE_ID.test(raw)) throw new AppError('TRACE_ID_INVALID', 'x-trace-id 格式无效。', 400);
  return raw;
}

function bindBodyTrace(body, headerTrace, fallbackTrace) {
  if (body.traceId !== undefined && (typeof body.traceId !== 'string' || !TRACE_ID.test(body.traceId))) {
    throw new AppError('TRACE_ID_INVALID', 'body traceId 格式无效。', 400);
  }
  const traceId = headerTrace ?? body.traceId ?? fallbackTrace;
  body.traceId = traceId;
  return traceId;
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
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('INVALID_JSON', '请求体必须是 JSON object。', 400);
    return body;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INVALID_JSON', '请求体不是有效 JSON。', 400);
  }
}

export function createRequestHandler({
  service,
  advisoryService = null,
  allowedOrigins = [],
  bodyLimit = DEFAULT_BODY_LIMIT,
  onBodyRead = null,
  publicDirectory = null,
  operationTracker = new OperationTracker(),
  logger = null,
}) {
  const allowlist = new Set(allowedOrigins.map((origin, index) => parseExactOrigin(origin, `allowedOrigins[${index}]`)));
  assert(!allowlist.has('*'), 'CORS_CONFIGURATION_INVALID', 'CORS allowlist 禁止使用 *。', 500);
  return async function requestHandler(request, response) {
    const startedAt = Date.now();
    let traceId = null;
    let corsOrigin = null;
    let requestOperation = null;
    let loggedAccepted = false;
    const logAccepted = () => {
      if (loggedAccepted) return;
      loggedAccepted = true;
      logger?.log('info', 'http.request.accepted', {
        traceId, component: 'http', httpMethod: request.method,
        httpPath: request.url?.split('?')[0] ?? '/', resultStatus: 'accepted',
      });
    };
    try {
      // Security invariant: Origin is checked before route handling and before body consumption.
      corsOrigin = allowedOrigin(request, allowlist);
      const headerTrace = headerTraceId(request);
      traceId = headerTrace ?? randomUUID();
      const corsHeaders = corsOrigin ? { 'access-control-allow-origin': corsOrigin, vary: 'Origin' } : {};
      if (!operationTracker.accepting) throw new AppError('SERVICE_SHUTTING_DOWN', '服务正在优雅关闭，不再接收新请求。', 503);
      requestOperation = operationTracker.begin('request', { traceId, method: request.method, path: request.url?.split('?')[0] ?? '/' });
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'OPTIONS') {
        logAccepted();
        response.writeHead(204, { ...corsHeaders, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-trace-id' });
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health/live') {
        logAccepted();
        sendJson(response, 200, { status: 'live', service: SERVICE_NAME, serviceVersion: SERVICE_VERSION, gate: DELIVERY_GATE }, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health/ready') {
        logAccepted();
        const ready = await service.readiness();
        const advisoryProvider = advisoryService?.health?.() ?? { status: 'not_configured' };
        const observability = logger?.health?.() ?? { status: 'disabled' };
        sendJson(response, ready.status === 'ready' ? 200 : 503, { ...ready, advisoryProvider, observability }, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/scenarios') {
        logAccepted();
        sendJson(response, 200, { scenarios: service.listScenarios() }, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/work-cases') {
        logAccepted();
        sendJson(response, 200, { workCases: service.listWorkCases({ scenario: url.searchParams.get('scenario'), status: url.searchParams.get('status'), owner: url.searchParams.get('owner') }) }, corsHeaders);
        return;
      }
      const graphMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)\/graph$/);
      if (request.method === 'GET' && graphMatch) {
        logAccepted();
        sendJson(response, 200, service.getContinuityGraph(decodeURIComponent(graphMatch[1])), corsHeaders);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/advisories') {
        assert(advisoryService, 'ADVISORY_UNAVAILABLE', 'Advisory Provider 未配置。', 503);
        const body = await readJson(request, bodyLimit, onBodyRead);
        traceId = bindBodyTrace(body, headerTrace, traceId);
        logAccepted();
        const controller = new AbortController();
        const providerOperation = operationTracker.begin('provider', { traceId, workCaseId: body.workCaseId }, { abort: (reason) => controller.abort(reason) });
        const abort = () => controller.abort(new Error('HTTP advisory request aborted.'));
        request.once('aborted', abort);
        try {
          sendJson(response, 200, await advisoryService.suggest(body, { signal: controller.signal }), corsHeaders);
        } finally {
          request.removeListener('aborted', abort);
          providerOperation.end();
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/work-cases') {
        const body = await readJson(request, bodyLimit, onBodyRead);
        traceId = bindBodyTrace(body, headerTrace, traceId);
        logAccepted();
        const id = body.payload?.id;
        const result = await service.executeCommand(id, { ...body, commandType: 'workCase.create' });
        sendJson(response, 201, result, corsHeaders);
        return;
      }
      const commandMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)\/commands$/);
      if (request.method === 'POST' && commandMatch) {
        const body = await readJson(request, bodyLimit, onBodyRead);
        traceId = bindBodyTrace(body, headerTrace, traceId);
        logAccepted();
        const result = await service.executeCommand(decodeURIComponent(commandMatch[1]), body);
        sendJson(response, 200, result, corsHeaders);
        return;
      }
      const eventsMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)\/events$/);
      if (request.method === 'GET' && eventsMatch) {
        logAccepted();
        const after = Number(url.searchParams.get('after') ?? 0);
        assert(Number.isInteger(after) && after >= 0, 'INVALID_INPUT', 'after 必须是非负整数。');
        sendJson(response, 200, { events: service.getEvents(decodeURIComponent(eventsMatch[1]), after) }, corsHeaders);
        return;
      }
      const replayMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)\/replay$/);
      if (request.method === 'GET' && replayMatch) {
        logAccepted();
        sendJson(response, 200, service.replay(decodeURIComponent(replayMatch[1])), corsHeaders);
        return;
      }
      const caseMatch = url.pathname.match(/^\/api\/work-cases\/([^/]+)$/);
      if (request.method === 'GET' && caseMatch) {
        logAccepted();
        sendJson(response, 200, service.getWorkCase(decodeURIComponent(caseMatch[1])), corsHeaders);
        return;
      }
      logAccepted();
      if (serveStaticFile(request, response, { publicDirectory, headers: corsHeaders })) return;
      throw new AppError('ROUTE_NOT_FOUND', 'API route 不存在。', 404);
    } catch (error) {
      const mapped = asErrorEnvelope(error, traceId);
      const headers = corsOrigin ? { 'access-control-allow-origin': corsOrigin, vary: 'Origin' } : {};
      if (!response.headersSent) sendJson(response, mapped.status, mapped.body, headers);
      else response.destroy();
      logger?.log(mapped.status >= 500 ? 'error' : 'warn', 'http.request.failed', {
        traceId, component: 'http', httpMethod: request.method,
        httpPath: request.url?.split('?')[0] ?? '/', httpStatus: mapped.status,
        resultStatus: 'failed', errorCode: mapped.body.error.code,
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      requestOperation?.end();
      logger?.log('info', 'http.request.completed', {
        traceId, component: 'http', httpMethod: request.method,
        httpPath: request.url?.split('?')[0] ?? '/', httpStatus: response.statusCode,
        resultStatus: response.statusCode >= 400 ? 'failed' : 'completed',
        latencyMs: Date.now() - startedAt,
      });
    }
  };
}

export function createRelayHttpServer(options) {
  const operationTracker = options.operationTracker ?? new OperationTracker();
  const runtime = options.advisoryService ? null : createAdvisoryRuntime({ service: options.service, env: options.env, config: options.advisoryConfig, logger: options.logger });
  const server = createServer(createRequestHandler({
    ...options,
    operationTracker,
    advisoryService: options.advisoryService ?? runtime.service,
  }));
  server.advisoryRuntime = runtime;
  server.operationTracker = operationTracker;
  return server;
}
