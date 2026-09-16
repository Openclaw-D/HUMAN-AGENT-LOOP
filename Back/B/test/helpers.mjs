// 测试共用工具:临时目录、loopback mock 服务(真实 socket)、计数 transport 包装。

import { fs } from '../src/deps.mjs';
import http from 'node:http';
import crypto from 'node:crypto';

export async function tmpDir(prefix = 'b-test-') {
  const dir = `./test/.tmp/${prefix}${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function rmDir(dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * 独立 loopback 假 API(真实 socket,非直接函数 fixture)。
 * behaviors: { mode:'ok'|'slow'|'http500'|'http429'|'badjson'|'malformed'|'close',
 *              delayMs, echoHeaders, crossProjectProbe }
 * 返回 { baseUrl, port, server, requests, close() };requests 记录收到的请求体(探针用)。
 */
export function startMockApi(behaviors = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* badjson 由客户端探测 */ }
      requests.push({ at: Date.now(), url: req.url, headers: req.headers, body: parsed });
      const mode = behaviors.mode ?? 'ok';
      const finish = () => {
        if (mode === 'close') { res.destroy(); return; }
        if (mode === 'badjson') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{not-json'); return; }
        if (mode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ findings: 'not-an-array' })); return; }
        if (mode === 'http500') { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'INTERNAL', message: 'boom' })); return; }
        if (mode === 'http429') { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'RATE_LIMITED', message: 'slow down' })); return; }
        // 跨项目串线探针:OpenAI chat.completions 形状,content 为结构化 JSON(C 脚本化语义)
        const observations = [`mock-ok ${parsed?.b_meta?.contextTags?.projectId ?? '?'}`];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          model: 'mock-glm-5.2',
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ observations, questions: [], evidenceRefs: [] }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          mock: { simulationOnly: true, realModelCapability: false, canary: 'canary-test', projectId: parsed?.b_meta?.contextTags?.projectId ?? null },
        }));
      };
      if (mode === 'slow') setTimeout(finish, behaviors.delayMs ?? 3000);
      else finish();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}`, port, server, requests, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** 计数 transport 包装:统计外部调用次数(零调用断言用)。 */
export function countingTransport(inner) {
  const calls = [];
  return {
    mode: inner.mode,
    configFingerprint: () => inner.configFingerprint(),
    costSnapshot: () => inner.costSnapshot(),
    async complete(request) {
      calls.push(request.requestId);
      return inner.complete(request);
    },
    _calls: calls,
  };
}

/** 常用路由配置(合成;不含真实业务阈值)。 */
export function testRoutes() {
  return {
    roles: ['policy', 'credit', 'risk', 'asset', 'commerce', 'seekeeper'],
    rules: [
      { ruleId: 'R-CREDIT', when: { taskKind: 'model_review', role: 'credit' }, plan: [{ stepId: 'model:credit:risk_review', kind: 'model', role: 'credit', purpose: 'risk_review' }] },
      { ruleId: 'R-REVIEW-CALC', when: { taskKind: 'review_with_calc' }, plan: [
        { stepId: 'model:credit:risk_review', kind: 'model', role: 'credit', purpose: 'risk_review' },
        { stepId: 'tool:calc:cash-flow-coverage', kind: 'tool', toolName: 'calc:cash-flow-coverage' },
      ] },
      { ruleId: 'R-CALC', when: { taskKind: 'cash_flow_coverage' }, plan: [{ stepId: 'tool:calc:cash-flow-coverage', kind: 'tool', toolName: 'calc:cash-flow-coverage' }] },
    ],
  };
}

/** 测试身份验证器:凭据 = 'cred:<principalId>' 即可信 human。 */
export function testVerifier() {
  return (credential, ctx) => {
    if (typeof credential === 'string' && credential.startsWith('cred:')) {
      return { ok: true, principalId: credential.slice(5), role: 'human' };
    }
    return { ok: false };
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
