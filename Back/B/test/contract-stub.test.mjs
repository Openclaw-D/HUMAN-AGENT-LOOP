// 契约 stub v2 语义测试(对齐 A CONTRACT v1.0 §3.4/§6):
// goal 粒度 claim/complete/fail、门序、fencing/lease、requestId 载荷一致性、幂等重放、人工待办。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractStub } from '../src/contract/stub.mjs';

async function seeded() {
  const s = createContractStub({});
  await s.seedGoal({ goalId: 'g1', projectId: 'p1', goalKey: 'model_review' });
  return s;
}

const RESULT = { provider: 'simulation', output: { observations: ['o'], evidenceRefs: [], assumptions: [], uncertainty: [] } };

test('claim→complete 正常路径:回执落库、目标版本推进、candidate_ready', async () => {
  const s = await seeded();
  const c = await s.claimGoal({ goalId: 'g1', requestId: 'c1', now: '2026-09-16T01:00:00Z', leaseMs: 60000 });
  assert.equal(c.ok, true);
  assert.equal(c.assignment.fencingToken, 1);
  const done = await s.completeGoal({
    goalId: 'g1', requestId: 'rq1', expectedVersion: c.goalVersion, fencingToken: 1,
    result: RESULT, now: '2026-09-16T01:00:05Z',
  });
  assert.equal(done.ok, true);
  assert.equal(done.replayed, false);
  assert.equal(done.goalVersion, 2);
  const receipt = await s.getExecutionReceipt('rq1');
  assert.equal(receipt.kind, 'execution_completed');
  const view = await s.getGoalView('g1');
  assert.equal(view.status, 'candidate_ready');
});

test('门序与 fencing:过期 token 写回拒绝;lease 过期写回拒绝;旧 token 不可复活', async () => {
  const s = await seeded();
  await s.claimGoal({ goalId: 'g1', requestId: 'c1', now: '2026-09-16T01:00:00Z', leaseMs: 1000 });
  // 租约过期后另一 worker 重领(§3.4:过期租约可重领,token 递增)
  const c2 = await s.claimGoal({ goalId: 'g1', requestId: 'c2', now: '2026-09-16T01:00:10Z', leaseMs: 60000 });
  assert.equal(c2.ok, true);
  assert.equal(c2.assignment.fencingToken, 2);
  // 旧 worker(token=1)写回 → STALE_FENCING_TOKEN(安全重试路径语义:A 未记录效果)
  const stale = await s.completeGoal({ goalId: 'g1', requestId: 'rq-old', fencingToken: 1, result: RESULT });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_FENCING_TOKEN');
  // 新 worker 租约过期后写回 → LEASE_EXPIRED(同样未记录效果,可重领)
  const late = await s.completeGoal({ goalId: 'g1', requestId: 'rq2', fencingToken: 2, result: RESULT, now: '2026-09-16T01:02:00Z' });
  assert.equal(late.ok, false);
  assert.equal(late.code, 'LEASE_EXPIRED');
  // LEASE_EXPIRED 后目标可被再次重领(不冻结)
  const c3 = await s.claimGoal({ goalId: 'g1', requestId: 'c3', now: '2026-09-16T01:02:01Z', leaseMs: 60000 });
  assert.equal(c3.ok, true);
  assert.equal(c3.assignment.fencingToken, 3);
});

test('requestId 载荷一致性:同载荷重放 → replayed:true;异载荷 → REQUEST_MISMATCH', async () => {
  const s = await seeded();
  await s.claimGoal({ goalId: 'g1', requestId: 'c1' });
  const r1 = await s.completeGoal({ goalId: 'g1', requestId: 'rq9', fencingToken: 1, result: RESULT });
  const r2 = await s.completeGoal({ goalId: 'g1', requestId: 'rq9', fencingToken: 1, result: RESULT });
  assert.equal(r2.ok, true);
  assert.equal(r2.replayed, true);
  const bad = await s.completeGoal({ goalId: 'g1', requestId: 'rq9', fencingToken: 1, result: { provider: 'simulation', output: { observations: ['different'] } } });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'REQUEST_MISMATCH');
});

test('乐观版本冲突:expectedVersion 过期 → VERSION_CONFLICT(协调冲突语义)', async () => {
  const s = await seeded();
  await s.claimGoal({ goalId: 'g1', requestId: 'c1' });
  const r = await s.completeGoal({ goalId: 'g1', requestId: 'rqV', fencingToken: 1, result: RESULT, expectedVersion: 99 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VERSION_CONFLICT');
});

test('fail 路径:门序同 complete;成功后 goal=failed', async () => {
  const s = await seeded();
  await s.claimGoal({ goalId: 'g1', requestId: 'c1' });
  const r = await s.failGoal({ goalId: 'g1', requestId: 'rqF', fencingToken: 1, note: '[unknown] 结果不可知' });
  assert.equal(r.ok, true);
  assert.equal((await s.getGoalView('g1')).status, 'failed');
  assert.equal((await s.getExecutionReceipt('rqF')).kind, 'execution_failed');
});

test('失效目标:不可领取(NOT_READY)', async () => {
  const s = await seeded();
  await s.invalidateGoals(['g1']);
  const c = await s.claimGoal({ goalId: 'g1', requestId: 'c1' });
  assert.equal(c.ok, false);
  assert.equal(c.code, 'NOT_READY');
});

test('人工待办:同 goal+kind 幂等;kind 合同枚举', async () => {
  const s = await seeded();
  const h1 = await s.createHumanRequest({ projectId: 'p1', goalId: 'g1', kind: 'clarification', question: '结果不可知,需核实' });
  const h2 = await s.createHumanRequest({ projectId: 'p1', goalId: 'g1', kind: 'clarification', question: '结果不可知,需核实' });
  assert.equal(h1.replayed, false);
  assert.equal(h2.replayed, true);
  assert.equal((await s.getHumanRequest('hr:g1:clarification')).status, 'open');
});

test('pollWork:只领 ready;被持有任务跳过', async () => {
  const s = await seeded();
  await s.seedGoal({ goalId: 'g2', projectId: 'p1', goalKey: 'cash_flow_coverage' });
  const c1 = await s.pollWork({ workerId: 'w1' });
  assert.equal(c1.task.goalId, 'g1');
  const c2 = await s.pollWork({ workerId: 'w2' });
  assert.equal(c2.task.goalId, 'g2');
  const c3 = await s.pollWork({ workerId: 'w3' });
  assert.equal(c3.ok, false);
  assert.equal(c3.code, 'NO_CLAIMABLE_GOAL');
});

test('版本投影:getGoalVersions 返回目标乐观版本(B 的 stale 判据)', async () => {
  const s = await seeded();
  const v1 = await s.getGoalVersions('p1', 'g1');
  assert.equal(v1.factVersion, '1');
  const done = await s.completeGoal({ goalId: 'g1', requestId: 'rqV2', fencingToken: (await s.claimGoal({ goalId: 'g1', requestId: 'cX' })).assignment.fencingToken, result: RESULT });
  assert.equal(done.ok, true);
  const v2 = await s.getGoalVersions('p1', 'g1');
  assert.equal(v2.factVersion, '2');
});

test('持久化:restore 后回执仍在(进程重启不丢业务回执)', async () => {
  const dir = `./test/.tmp/stub-${Date.now()}`;
  const s1 = createContractStub({ dataDir: dir });
  await s1.seedGoal({ goalId: 'g1', projectId: 'p1', goalKey: 'model_review' });
  await s1.claimGoal({ goalId: 'g1', requestId: 'c1' });
  await s1.completeGoal({ goalId: 'g1', requestId: 'rqP', fencingToken: 1, result: RESULT });
  const s2 = createContractStub({ dataDir: dir });
  await s2.restore();
  assert.equal((await s2.getExecutionReceipt('rqP')).kind, 'execution_completed');
});
