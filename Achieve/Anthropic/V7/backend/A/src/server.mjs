// V7 A · HTTP wire 层（CONTRACT §4）：node:http 零依赖 JSON API。
// 路由 = 字面量表驱动；请求体有界（1MB）；错误码表统一出口；全部响应 no-store。
// 用法：node server.mjs --port 3601 --data-dir <dir>（env V7_A_PORT / V7_A_DATA_DIR 同义）。

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openServices } from './service.mjs';
import { StoreCorruptError, StoreUnavailableError, RequestMismatchError } from './store.mjs';

const BODY_LIMIT = 1024 * 1024;

const STATUS_BY_CODE = {
  INVALID_INPUT: 400,
  ROLE_FORBIDDEN: 403,
  PRINCIPAL_UNTRUSTED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  REQUEST_MISMATCH: 409,
  EVIDENCE_SUPERSEDED: 409,
  RUN_ESCALATED: 409,
  RUN_RESOLVED: 409,
  STORE_CORRUPT: 500,
  STORE_UNAVAILABLE: 500,
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function errorPayload(error) {
  const code = error?.code;
  if (typeof code === 'string' && code in STATUS_BY_CODE) {
    const payload = { ok: false, error: code, message: error.message };
    if (error.serverVersion !== undefined) payload.serverVersion = error.serverVersion;
    return { status: STATUS_BY_CODE[code], payload };
  }
  // 未知内部错误：不泄露细节，失败关闭。
  return { status: 500, payload: { ok: false, error: 'STORE_UNAVAILABLE', message: '服务内部错误（合成演示存储不可用）' } };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('请求体超出允许大小'), { code: 'INVALID_INPUT' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return resolve({});
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'INVALID_INPUT' }));
      }
    });
    req.on('error', reject);
  });
}

/** 字面量路由表：method + 正则 → handler(params, body)。新增端点只改此表。 */
export function buildRoutes(services) {
  const { facts, runs } = services;
  return [
    ['GET', /^\/api\/v7\/health$/, () => ({ status: 200, payload: { ok: true, service: 'v7-a', contract: 'v0' } })],

    ['POST', /^\/api\/v7\/projects$/, (p, body) => wrap(facts.createProject(body))],
    ['GET', /^\/api\/v7\/projects\/(?<projectId>[^/]+)$/, (params) => wrap(facts.getProject(decodeURIComponent(params.projectId)))],
    ['POST', /^\/api\/v7\/projects\/(?<projectId>[^/]+)\/evidence$/, (params, body) => wrap(facts.attachEvidence({ ...body, projectId: decodeURIComponent(params.projectId) }))],
    ['POST', /^\/api\/v7\/projects\/(?<projectId>[^/]+)\/evidence\/(?<evidenceId>[^/]+)\/supersede$/, (params, body) => wrap(facts.supersedeEvidence({ ...body, projectId: decodeURIComponent(params.projectId), evidenceId: decodeURIComponent(params.evidenceId) }))],

    ['GET', /^\/api\/v7\/rules$/, () => wrap(facts.listRules())],
    ['POST', /^\/api\/v7\/rules$/, (p, body) => wrap(facts.publishRule(body))],
    ['GET', /^\/api\/v7\/rules\/(?<version>\d+)$/, (params) => wrap(facts.getRule(Number(params.version)))],

    ['POST', /^\/api\/v7\/projects\/(?<projectId>[^/]+)\/runs$/, (params, body) => wrap(runs.createRun({ ...body, projectId: decodeURIComponent(params.projectId) }))],
    ['GET', /^\/api\/v7\/runs\/(?<runId>[^/]+)$/, (params) => wrap(runs.getRun(decodeURIComponent(params.runId)))],
    ['POST', /^\/api\/v7\/runs\/(?<runId>[^/]+)\/opinions$/, (params, body) => wrap(runs.addOpinion({ ...body, runId: decodeURIComponent(params.runId) }))],
    ['POST', /^\/api\/v7\/runs\/(?<runId>[^/]+)\/calculation$/, (params, body) => wrap(runs.setCalculation({ ...body, runId: decodeURIComponent(params.runId) }))],
    ['POST', /^\/api\/v7\/runs\/(?<runId>[^/]+)\/state$/, (params, body) => wrap(runs.escalate({ ...body, runId: decodeURIComponent(params.runId) }))],
    ['POST', /^\/api\/v7\/runs\/(?<runId>[^/]+)\/human-actions$/, (params, body) => wrap(runs.addHumanAction({ ...body, runId: decodeURIComponent(params.runId) }))],
    ['GET', /^\/api\/v7\/receipts\/(?<requestId>[^/]+)$/, (params, body, query) => wrap(runs.getReceipt(decodeURIComponent(params.requestId), query.get('store')))],
  ];
}

function wrap(result) {
  return { status: 200, payload: result };
}

export function createRequestHandler(services) {
  const routes = buildRoutes(services);
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      for (const [method, re, handlerFn] of routes) {
        if (req.method !== method) continue;
        const match = url.pathname.match(re);
        if (match === null) continue;
        const body = method === 'POST' ? await readBody(req) : {};
        const { status, payload } = handlerFn(match.groups ?? {}, body, url.searchParams);
        json(res, status, payload);
        return;
      }
      json(res, 404, { ok: false, error: 'NOT_FOUND', message: `未登记端点：${req.method} ${url.pathname}` });
    } catch (error) {
      if (error?.code === 'INVALID_INPUT' && error.message.includes('请求体')) {
        json(res, 400, { ok: false, error: 'INVALID_INPUT', message: error.message });
        return;
      }
      const { status, payload } = errorPayload(error);
      json(res, status, payload);
    }
  };
}

/** D-6：从 token 允许列表构造同步 principal 验证器（sha256(token) 集合；token 不落盘）。
 *  tokens: string[]（明文只在本构造内存在）；空/未配置 = 无可信身份源（正式动作失败关闭）。 */
export function createTokenPrincipalVerifier(tokens) {
  const set = new Set((tokens ?? []).filter((t) => typeof t === 'string' && t.length > 0).map((t) => createHash('sha256').update(t, 'utf8').digest('hex')));
  if (set.size === 0) return null;
  return (credential) => {
    const hash = createHash('sha256').update(String(credential), 'utf8').digest('hex');
    if (!set.has(hash)) return { ok: false };
    return { ok: true, role: 'human', principalId: `token-principal-${hash.slice(0, 8)}` };
  };
}

export function startServer({ port, dataDir, principalTokens }) {
  const principalVerifier = createTokenPrincipalVerifier(
    principalTokens ?? (process.env.V7_A_PRINCIPAL_TOKENS ? process.env.V7_A_PRINCIPAL_TOKENS.split(',') : []),
  );
  const services = openServices(dataDir, { principalVerifier });
  const server = createServer((req, res) => {
    createRequestHandler(services)(req, res).catch((error) => {
      const { status, payload } = errorPayload(error);
      try { json(res, status, payload); } catch { /* 连接已断 */ }
    });
  });
  return new Promise((resolve) => {
    // port 0 = 临时端口（测试用）；实际绑定端口以 server.address() 为准。
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ server, services, port: actual });
    });
  });
}

// 直接运行：node server.mjs --port 3601 --data-dir <dir>
if (process.argv[1] !== undefined && process.argv[1].endsWith('server.mjs')) {
  const args = process.argv.slice(2);
  const argOf = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const port = Number(argOf('--port') ?? process.env.V7_A_PORT ?? 3601);
  const dataDir = argOf('--data-dir') ?? process.env.V7_A_DATA_DIR ?? join(process.cwd(), '.data');
  const principalTokens = (argOf('--principal-tokens') ?? process.env.V7_A_PRINCIPAL_TOKENS ?? '').split(',').filter((t) => t.length > 0);
  startServer({ port, dataDir, principalTokens }).then(({ port: bound }) => {
    console.log(`v7-a listening on http://127.0.0.1:${bound} (data: ${dataDir}, contract v0.1, principals: ${principalTokens.length})`);
  });
}
