// V7 A · HTTP wire 层测试（CONTRACT §4）：真实 socket + fetch 全链。
// 运行：node --test test/v7-a-http.test.mjs

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../src/server.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'v7-a-http-'));
const { server, port } = await startServer({ port: 0, dataDir, principalTokens: ['http-test-human'] });
const BASE = `http://127.0.0.1:${port}`;

after(async () => {
  server.close();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test('health 端点 + 未登记端点 404', async () => {
  const health = await call('GET', '/api/v7/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const missing = await call('GET', '/api/v7/nothing');
  assert.equal(missing.status, 404);
});

test('HTTP 全链：项目→证据→规则→运行→意见→人工接受（双客户端读同一事实）', async () => {
  const proj = await call('POST', '/api/v7/projects', { requestId: 'h-p-1', name: 'HTTP 合成项目' });
  assert.equal(proj.status, 200);
  const projectId = proj.body.project.projectId;

  const rule = await call('POST', '/api/v7/rules', { requestId: 'h-rule-1', indicators: ['产能口径'], allowedTools: ['cashflow-coverage'], humanEscalation: ['缺参'], notes: 'HTTP 规则包' });
  assert.equal(rule.body.ruleVersion.version, 1);

  const ev = await call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: 'h-ev-1', expectedVersion: 1, kind: '巡检', content: { text: '现场正常' } });
  assert.equal(ev.status, 200);
  const evidenceId = ev.body.evidence.evidenceId;

  const run = await call('POST', `/api/v7/projects/${projectId}/runs`, { requestId: 'h-run-1', expectedVersion: 1, ruleVersion: 1, inputEvidence: [{ evidenceId, version: 1 }] });
  assert.equal(run.status, 200);
  const runId = run.body.run.runId;

  const opinion = await call('POST', `/api/v7/runs/${runId}/opinions`, {
    requestId: 'h-op-1', expectedVersion: 1, provider: 'simulation', requestReceipt: 'sim-1',
    candidate: { observations: ['现场正常'], evidenceRefs: [evidenceId], assumptions: [], uncertainty: [], recommendedHumanAction: 'accept_candidate' },
    basedOnEvidence: [{ evidenceId, version: 1 }],
  });
  assert.equal(opinion.status, 200);
  assert.equal(opinion.body.runState, 'candidate_ready');

  // 另一端（GET）读同一事实版本。
  const other = await call('GET', `/api/v7/runs/${runId}`);
  assert.equal(other.body.run.version, 2);
  assert.equal(other.body.run.state, 'candidate_ready');

  // D-6 负例：无凭据自声明 human → 403 PRINCIPAL_UNTRUSTED（不入库）。
  const unauth = await call('POST', `/api/v7/runs/${runId}/human-actions`, { requestId: 'h-ha-0', expectedVersion: 2, action: 'accept_candidate', actorRole: 'human', actorName: '匿名伪造者' });
  assert.equal(unauth.status, 403);
  assert.equal(unauth.body.error, 'PRINCIPAL_UNTRUSTED');

  const accept = await call('POST', `/api/v7/runs/${runId}/human-actions`, { requestId: 'h-ha-1', expectedVersion: 2, action: 'accept_candidate', actorRole: 'human', actorName: '信审员（HTTP）', principalCredential: 'http-test-human', note: '确认候选' });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.runState, 'resolved');
  assert.equal(accept.body.formalOutcome.action, 'accept_candidate');

  // 回执查询（跨端一致性辅助）：重复请求回执可查。
  const receipt = await call('GET', `/api/v7/receipts/h-ha-1?store=runs`);
  assert.equal(receipt.body.found, true);
  assert.equal(receipt.body.receipt.runState, 'resolved');
});

test('HTTP：并发重复提交同 requestId（同载荷）→ 恰一次生效 + 重放', async () => {
  const proj = await call('POST', '/api/v7/projects', { requestId: 'h-p-2', name: 'HTTP 并发项目' });
  const projectId = proj.body.project.projectId;
  // 同 requestId 同载荷并行两发：单进程同步纪律下，恰一次写入 + 一次重放。
  const [a, b] = await Promise.all([
    call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: 'h-ev-race', expectedVersion: 1, kind: 'k', content: { n: 1 } }),
    call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: 'h-ev-race', expectedVersion: 1, kind: 'k', content: { n: 1 } }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 200], '幂等重放不产生 409');
  // 响应到达顺序不保证：断言集合 = 恰一次非重放 + 一次重放。
  const replayedFlags = [a.body.replayed === true, b.body.replayed === true].sort();
  assert.deepEqual(replayedFlags, [false, true], '恰一次非重放写入（顺序不限）');
  const view = await call('GET', `/api/v7/projects/${projectId}`);
  assert.equal(view.body.evidence.length, 1, '不重复记账');
});

test('HTTP：过期版本 409 带中文消息与 serverVersion；异载荷 REQUEST_MISMATCH；非法体 400', async () => {
  const proj = await call('POST', '/api/v7/projects', { requestId: 'h-p-3', name: 'HTTP 冲突项目' });
  const projectId = proj.body.project.projectId;
  await call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: 'h-ev-3a', expectedVersion: 1, kind: 'k', content: {} });
  const stale = await call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: 'h-ev-3b', expectedVersion: 1, kind: 'k', content: {} });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'VERSION_CONFLICT');
  assert.equal(stale.body.serverVersion, 2);

  await call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: 'h-ev-3c', expectedVersion: 2, kind: 'k', content: { v: 1 } });
  const mismatch = await call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: 'h-ev-3c', expectedVersion: 2, kind: 'k', content: { v: 2 } });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error, 'REQUEST_MISMATCH');

  const bad = await fetch(`${BASE}/api/v7/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'INVALID_INPUT');
});

test('HTTP：模型 actorRole 被拒（403）；禁用键 candidate 被拒（400）', async () => {
  const proj = await call('POST', '/api/v7/projects', { requestId: 'h-p-4', name: 'HTTP 权威分离项目' });
  const projectId = proj.body.project.projectId;
  const rule = await call('POST', '/api/v7/rules', { requestId: 'h-rule-4', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const run = await call('POST', `/api/v7/projects/${projectId}/runs`, { requestId: 'h-run-4', expectedVersion: 1, ruleVersion: rule.body.ruleVersion.version, inputEvidence: [] });
  const runId = run.body.run.runId;

  const forbiddenAction = await call('POST', `/api/v7/runs/${runId}/human-actions`, { requestId: 'h-ha-4', expectedVersion: 1, action: 'accept_candidate', actorRole: 'agent', actorName: '角色 Agent' });
  assert.equal(forbiddenAction.status, 403);
  assert.equal(forbiddenAction.body.error, 'ROLE_FORBIDDEN');

  const badCandidate = await call('POST', `/api/v7/runs/${runId}/opinions`, { requestId: 'h-op-4', expectedVersion: 1, provider: 'simulation', requestReceipt: 'r', candidate: { observations: [], approval: '通过' }, basedOnEvidence: [] });
  assert.equal(badCandidate.status, 400);
});
