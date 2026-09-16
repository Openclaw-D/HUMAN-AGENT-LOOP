// 集成测试 3：上下文/载荷限额、验证器异常不泄凭据（--faulty-verifier 故障注入钩子）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, newId, simpleTemplate, startKernel, TOKENS } from './utils.mjs';

async function setup(t, extraArgs = []) {
  const k = await startKernel({ extraArgs });
  t.after(() => k.stop());
  const bus = client(k.base, TOKENS.business);
  const adm = client(k.base, TOKENS.admin);
  const ag = client(k.base, TOKENS.agent);
  const tpl = await adm('POST', '/api/v1/templates', simpleTemplate());
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'limit-proj' });
  const projectId = pr.json.projectId;
  await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: {} });
  const g = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'review' });
  return { k, bus, ag, review: g.json.goal };
}

test('载荷限额：result.output 超 64KB 被 400 拒绝（上下文限额守卫）', async (t) => {
  const { ag, review } = await setup(t);
  const claim = await ag('POST', `/api/v1/goals/${review.goalId}/claim`, { requestId: newId('r'), expectedVersion: review.version });
  assert.equal(claim.status, 200);
  const big = 'x'.repeat(65 * 1024);
  const r = await ag('POST', `/api/v1/goals/${review.goalId}/complete`, {
    requestId: newId('r'), expectedVersion: claim.json.goalVersion, fencingToken: claim.json.fencingToken,
    result: { provider: 'simulation', output: { blob: big } },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'INVALID_INPUT');
  assert.ok(r.json.message.includes('限额'));
  // 正常大小仍可用
  const ok = await ag('POST', `/api/v1/goals/${review.goalId}/complete`, {
    requestId: newId('r'), expectedVersion: claim.json.goalVersion, fencingToken: claim.json.fencingToken,
    result: { provider: 'simulation', output: { blob: 'x'.repeat(1024) } },
  });
  assert.equal(ok.status, 200);
});

test('验证器异常：--faulty-verifier 注入后敏感写 403 且错误体不含凭据/异常文本', async (t) => {
  // 先用正常实例建数据（敏感写可用），再以同库 + 故障验证器重启——验证运行期验证器异常的失败关闭
  const first = await startKernel({ keepDb: true });
  const bus = client(first.base, TOKENS.business);
  const adm = client(first.base, TOKENS.admin);
  const tpl = await adm('POST', '/api/v1/templates', simpleTemplate());
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'fault-proj' });
  const projectId = pr.json.projectId;
  await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: {} });
  const g = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'review' });
  const goalId = g.json.goal.goalId;
  const dbName = first.dbName;
  await first.stop();

  const second = await startKernel({ dbUrl: first.dbUrl, extraArgs: ['--faulty-verifier'] });
  t.after(async () => {
    await second.stop();
    const { dropTestDb } = await import('./utils.mjs');
    await dropTestDb(dbName);
  });
  const secret = TOKENS.agent; // 凭据会被故障验证器拼进异常消息——响应体不得出现
  const res = await fetch(`${second.base}/api/v1/goals/${goalId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-principal-credential': secret },
    body: JSON.stringify({ requestId: newId('r'), expectedVersion: 1 }),
  });
  assert.equal(res.status, 403);
  const body = JSON.stringify(await res.json());
  assert.ok(body.includes('PRINCIPAL_UNTRUSTED'), body);
  assert.ok(!body.includes(secret), `凭据泄漏：${body}`);
  assert.ok(!body.includes('exploded'), `异常文本泄漏：${body}`);
});
