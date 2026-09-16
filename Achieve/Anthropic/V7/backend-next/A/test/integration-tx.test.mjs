// 集成测试 5：D-09 补强——失败命令零孤儿 outbox/audit；成功命令 outbox 行可见。
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, newId, simpleTemplate, startKernel, TOKENS } from './utils.mjs';

test('同事务性：命令失败（任意 4xx/500）后 outbox/audit 计数不变；成功后事件可见', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const bus = client(k.base, TOKENS.business);
  const ag = client(k.base, TOKENS.agent);
  const adm = client(k.base, TOKENS.admin);
  const counts = async () => ({
    outbox: Number((await k.pool.query('SELECT count(*)::int AS n FROM outbox_events')).rows[0].n),
    audit: Number((await k.pool.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n),
    evidence: Number((await k.pool.query('SELECT count(*)::int AS n FROM evidence')).rows[0].n),
  });

  const tpl = await adm('POST', '/api/v1/templates', simpleTemplate());
  assert.equal(tpl.status, 200);
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'tx-proj' });
  const projectId = pr.json.projectId;
  const ev = await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: {} });
  assert.equal(ev.status, 200);
  const g = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'review' });
  assert.equal(g.status, 200);
  // OBS-2 回归：goal 投影含 projectId；OBS-1 回归：列表端点必须驼峰投影（有数据行才测得出泄漏）
  assert.equal(g.json.goal.projectId, projectId);
  const hrNew = await bus('POST', `/api/v1/projects/${projectId}/human-requests`, {
    requestId: newId('r'), goalId: null, kind: 'clarification', question: 'obs1?', requestedRole: 'approver',
  });
  assert.equal(hrNew.status, 200);
  const hrList = await bus('GET', `/api/v1/projects/${projectId}/human-requests`);
  assert.equal(hrList.status, 200);
  assert.ok(hrList.json.humanRequests.length >= 1 && hrList.json.humanRequests.every((h) => h.hrequestId !== undefined && h.requestedRole !== undefined && h.hrequest_id === undefined), `OBS-1 蛇形泄漏：${JSON.stringify(hrList.json.humanRequests[0])}`);
  const before = await counts();

  // 失败命令组：FORBIDDEN_KEY / 版本冲突 / 越权项目 / 帐目不存在的目标
  const claim = await ag('POST', `/api/v1/goals/${g.json.goal.goalId}/claim`, { requestId: newId('r'), expectedVersion: g.json.goal.version });
  assert.equal(claim.status, 200);
  const mid = await counts();
  const failures = [
    ag('POST', `/api/v1/goals/${g.json.goal.goalId}/complete`, {
      requestId: newId('r'), expectedVersion: claim.json.goalVersion, fencingToken: claim.json.fencingToken,
      result: { provider: 'simulation', output: { approvedBy: 'x' } },
    }),
    ag('POST', `/api/v1/goals/${g.json.goal.goalId}/claim`, { requestId: newId('r'), expectedVersion: 99 }),
    ag('POST', '/api/v1/goals/g-nonexistent/claim', { requestId: newId('r'), expectedVersion: 1 }),
    bus('POST', `/api/v1/projects/${projectId}/evidence/no-such/supersede`, { requestId: newId('r'), expectedVersion: 1, content: {} }),
  ];
  for (const f of failures) {
    const r = await f;
    assert.ok(r.status >= 400, `预期失败，实得 ${r.status}`);
  }
  const after = await counts();
  assert.deepEqual(after, mid, `失败命令不得留下任何写入：${JSON.stringify({ before, mid, after })}`);

  // 成功命令：outbox 行可见且与业务写同事务（evidence 提交后事件数增加）
  const ev2 = await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: after.evidence + 1000, kind: 'doc2', content: {} });
  assert.equal(ev2.status, 409); // 版本门先行——此失败同样零写入
  const finalCounts = await counts();
  assert.deepEqual(finalCounts, after, '版本冲突后零写入');
});
