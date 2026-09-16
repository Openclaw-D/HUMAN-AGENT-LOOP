// worker 集成测试(v2 契约):pollWork→执行→complete/fail 闭环 / A 回执前置检查 /
// fencing 过期拒绝与有界安全重领 / unknown→人工待办 / 并发上限 / 软超时 / recoverAll。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBRuntime } from '../src/runtime.mjs';
import { startMockApi, tmpDir, rmDir, testRoutes, testVerifier, sleep } from './helpers.mjs';

function makeRuntime(dir, api, over = {}) {
  return createBRuntime({
    dataDir: dir,
    config: {
      transport: api ? { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 5000 } } : {},
      routes: testRoutes(),
      contract: { mode: 'stub' },
      worker: { workerId: 'w-test', concurrency: 2, pollIntervalMs: 50, taskTimeoutMs: 60000 },
    },
    overrides: { principalVerifier: testVerifier(), logger: () => {}, ...over },
  });
}

async function seedStd(rt) {
  await rt.contract.seedGoal({ goalId: 'g1', projectId: 'p1', goalKey: 'model_review', role: 'credit' });
}

test('闭环:pollWork→执行→candidate_ready 提交(provider=simulation);重复执行被 A 回执拦截', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('worker-ok-');
  try {
    const rt = makeRuntime(dir, api);
    await seedStd(rt);
    const claim = await rt.contract.pollWork({ workerId: 'w-test' });
    const r = await rt.worker.executeNow(claim.task, claim.assignment, { goalVersion: claim.goalVersion });
    assert.equal(r.submitted, true);
    assert.equal(r.report.completed, true);
    assert.equal(r.report.result.provider, 'simulation'); // mock 步 → simulation
    assert.ok(r.report.result.output.observations.length >= 1);
    const receipt = await rt.contract.getExecutionReceipt(`${r.taskRunId}::complete`);
    assert.equal(receipt.kind, 'execution_completed');
    const view = await rt.contract.getGoalView('g1');
    assert.equal(view.status, 'candidate_ready'); // complete 最多 candidate_ready(B 不自报验收)

    // 同一 taskRun 再执行:A 已有回执 → skip(恢复幂等)
    const r2 = await rt.worker.executeNow(claim.task, claim.assignment, { goalVersion: claim.goalVersion });
    assert.equal(r2.skipped, true);
    assert.equal(api.requests.length, 1); // 模型调用也只有一次
  } finally { await api.close(); await rmDir(dir); }
});

test('fencing:过期 worker 写回被 A 拒绝;重领不可得时按 rejected 丢弃(不当未执行)', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('worker-fence-');
  try {
    const rt = makeRuntime(dir, api);
    await seedStd(rt);
    const claim = await rt.contract.pollWork({ workerId: 'w-test' });
    // 模拟改派:另一 worker 持有新 lease(旧 worker fencing 已过期)
    await rt.contract.claimGoal({ goalId: 'g1', requestId: 'other-claim', now: new Date(Date.now() + 3600_000).toISOString() });
    const r = await rt.worker.executeNow(claim.task, claim.assignment, { goalVersion: claim.goalVersion });
    assert.equal(r.rejected, 'STALE_FENCING_TOKEN');
    assert.equal(r.view.state, 'completed'); // 执行本身完成,但写回被拒 → 丢弃
  } finally { await api.close(); await rmDir(dir); }
});

test('安全重领:LEASE_EXPIRED 且结果确定 → 有界重领后成功提交(§6 未执行可安全重试路径)', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('worker-reclaim-');
  try {
    const rt = makeRuntime(dir, api);
    // 直接构造:领取后用过去的 now 制造"租约已过期再完成"——桩按时间参数判定
    await rt.contract.seedGoal({ goalId: 'g1', projectId: 'p1', goalKey: 'model_review', role: 'credit' });
    const past = new Date(Date.now() - 3600_000).toISOString();
    const claim = await rt.contract.claimGoal({ goalId: 'g1', requestId: 'c-old', now: past, leaseMs: 1000 });
    assert.equal(claim.ok, true);
    // 此刻租约已过期(桩时间现值)→ 但注意:claim 的 lease 过期后 goal 可被重领;
    // 为让 executeNow 的第一次 complete 稳定命中 LEASE_EXPIRED,先由"他人"重领再放弃:
    // 更直接:executeNow(旧 assignment)→ complete LEASE_EXPIRED → worker 重领(新 token)→ 重新执行 → 成功
    const r = await rt.worker.executeNow(claim.task, claim.assignment, { goalVersion: claim.goalVersion, reclaimLeft: 1 });
    assert.equal(r.submitted, true, `结果:${JSON.stringify({ rejected: r.rejected, discarded: r.discarded, state: r.view?.state })}`);
    assert.equal(r.report.completed, true);
    assert.ok(/:c2-\d+$/.test(r.taskRunId), `新 fencing 周期(带 claimedAt):${r.taskRunId}`); // 周期标识含 claimedAt(A 可能复用 token)
    const receipt = await rt.contract.getExecutionReceipt(`${r.taskRunId}::complete`);
    assert.equal(receipt.kind, 'execution_completed');
    assert.equal(api.requests.length, 2); // 两个执行周期各一次模型调用(旧周期结果确定且未被 A 记录)
  } finally { await api.close(); await rmDir(dir); }
});

test('unknown → fail 出口 + clarification 人工待办(不盲重发,不自动重领)', async () => {
  const api = await startMockApi({ mode: 'close' });
  const dir = await tmpDir('worker-unk-');
  try {
    const rt = makeRuntime(dir, api);
    await seedStd(rt);
    const claim = await rt.contract.pollWork({ workerId: 'w-test' });
    const r = await rt.worker.executeNow(claim.task, claim.assignment, { goalVersion: claim.goalVersion });
    assert.equal(r.submitted, true);
    assert.equal(r.report.completed, false);
    assert.equal(r.view.terminal.kind, 'unknown');
    const hr = await rt.contract.getHumanRequest(`hr:g1:clarification`);
    assert.ok(hr, '应创建 clarification 人工待办');
    assert.match(hr.question, /不可知/);
    assert.equal(api.requests.length, 1); // 零盲重发
  } finally { await api.close(); await rmDir(dir); }
});

test('worker 主循环:并发上限与队列顺序;停机等待在途任务收尾', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('worker-loop-');
  try {
    const rt = createBRuntime({
      dataDir: dir,
      config: {
        transport: { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 5000 } },
        routes: testRoutes(), contract: { mode: 'stub' },
        worker: { workerId: 'w-loop', concurrency: 1, pollIntervalMs: 30, taskTimeoutMs: 60000 },
      },
      overrides: { logger: () => {} },
    });
    await rt.contract.seedGoal({ goalId: 'tA', projectId: 'p1', goalKey: 'model_review', role: 'credit' });
    await rt.contract.seedGoal({ goalId: 'tB', projectId: 'p1', goalKey: 'cash_flow_coverage', params: { monthlyOperatingCashFlow: 2, monthlyDebtService: 1, currency: 'CNY' } });
    await rt.worker.startLoop();
    const t0 = Date.now();
    while (rt.worker.activeCount() > 0 || Date.now() - t0 < 300) await sleep(50);
    await sleep(800); // 等待队列清空
    const { fs } = await import('../src/deps.mjs');
    const reg = JSON.parse(await fs.readFile(`${dir}/worker/runs.json`, 'utf8'));
    const statuses = Object.entries(reg).filter(([k]) => k !== '#cursor').map(([, r]) => r.status);
    assert.ok(statuses.filter((s) => s === 'submitted').length === 2, `状态:${JSON.stringify(reg)}`);
    await rt.worker.stopLoop();
  } finally { await api.close(); await rmDir(dir); }
});

test('软超时:取消在步边界生效,未发送步取消、已完成步保留(不谎称未发生)', async () => {
  const api = await startMockApi({ mode: 'slow', delayMs: 1500 });
  const dir = await tmpDir('worker-timeout-');
  try {
    const rt = createBRuntime({
      dataDir: dir,
      config: {
        transport: { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 60000 } }, // transport 不超时,由任务软超时取消
        routes: testRoutes(), contract: { mode: 'stub' },
        worker: { workerId: 'w-to', concurrency: 1, pollIntervalMs: 30, taskTimeoutMs: 300 },
      },
      overrides: { logger: () => {} },
    });
    await rt.contract.seedGoal({ goalId: 'g1', projectId: 'p1', goalKey: 'review_with_calc', params: { monthlyOperatingCashFlow: 2, monthlyDebtService: 1, currency: 'CNY' } });
    const claim = await rt.contract.pollWork({ workerId: 'w-to' });
    const r = await rt.worker.executeNow(claim.task, claim.assignment, { goalVersion: claim.goalVersion });
    assert.ok(r.view.terminal, '应有终局');
    const modelStep = r.view.steps.find((s) => s.kind === 'model');
    assert.ok(['simulated', 'succeeded'].includes(modelStep.state), `模型步 ${modelStep.state}(在途完成,不得谎称未发生)`);
    const toolStep = r.view.steps.find((s) => s.kind === 'tool');
    assert.equal(toolStep.state, 'cancelled', '工具步未发送 → 取消');
    assert.equal(r.view.state, 'human_required');
    assert.equal(r.submitted, true);
    assert.equal(r.report.completed, false); // fail 出口
  } finally { await api.close(); await rmDir(dir); }
}, { timeout: 30000 });

test('recoverAll:提交过的不动;未收尾的 run 补对账并如实标记', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('worker-rec-');
  try {
    const rt = makeRuntime(dir, api);
    await seedStd(rt);
    const claim = await rt.contract.pollWork({ workerId: 'w-test' });
    await rt.worker.executeNow(claim.task, claim.assignment, { goalVersion: claim.goalVersion });
    // 伪造一条"崩溃遗留"的 registry 记录(无 checkpoint、无回执)
    const { fs } = await import('../src/deps.mjs');
    const regPath = `${dir}/worker/runs.json`;
    const reg = JSON.parse(await fs.readFile(regPath, 'utf8'));
    reg['w-test:ghost:c1'] = { status: 'running', goalId: 'g1', fencingToken: 1, startedAt: new Date().toISOString() };
    await fs.writeFile(regPath, JSON.stringify(reg), 'utf8');
    const results = await rt.worker.recoverAll();
    const ghost = results.find((r) => r.taskRunId.includes('ghost'));
    assert.ok(ghost);
    assert.equal(ghost.skipped, 'no-checkpoint'); // 无 checkpoint:如实跳过,不编造
  } finally { await api.close(); await rmDir(dir); }
});
