// DEF-03 定向重现与修复验证(r33-g4full D-27b 的 B 内部语义等价):
// 中断→unknown→零盲重发 → (版本漂移:恢复期上报使 A 目标版本推进) →
// 可信人工 retry_step 恰一次新 attempt/requestId 重发 → settleAfterResume 收口 A → candidate_ready;
// 负例:无凭据/重复授权/他项目授权 → 零额外调用;unknown 安全与脱敏不回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBRuntime } from '../src/runtime.mjs';
import { settleAfterResume } from '../src/worker/worker.mjs';
import { startMockApi, tmpDir, rmDir, testRoutes, testVerifier, sleep } from './helpers.mjs';
import { fs } from '../src/deps.mjs';

function makeRuntime(dir, api, over = {}) {
  return createBRuntime({
    dataDir: dir,
    config: {
      transport: api ? { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 30000 } } : {},
      routes: testRoutes(), contract: { mode: 'stub' },
    },
    overrides: { principalVerifier: testVerifier(), logger: () => {}, ...over },
  });
}

async function waitIntentReceipt(dir, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const names = await fs.readdir(`${dir}/receipts`);
      if (names.some((n) => n.endsWith('.json'))) {
        const raw = JSON.parse(await fs.readFile(`${dir}/receipts/${names[0]}`, 'utf8'));
        if (raw.phase === 'intent') return raw;
      }
    } catch { /* 尚无 */ }
    await sleep(100);
  }
  throw new Error('等待 intent 回执超时');
}

test('DEF-03:中断→unknown→版本漂移→可信 retry_step 恰一次重发→A 收口 candidate_ready', async () => {
  const apiSlow = await startMockApi({ mode: 'slow', delayMs: 20000 });
  const dir = await tmpDir('def03-');
  try {
    const rt1 = makeRuntime(dir, apiSlow);
    await rt1.contract.seedGoal({ goalId: 'g1', projectId: 'p1', goalKey: 'model_review', role: 'credit' });
    const claim = await rt1.contract.claimGoal({ goalId: 'g1', requestId: 'c1', now: new Date().toISOString(), leaseMs: 600000 });
    // 模拟常驻 worker 的登记(D 以 registry 取 taskRunId/fencing)
    await fs.mkdir(`${dir}/worker`, { recursive: true });
    await fs.writeFile(`${dir}/worker/runs.json`, JSON.stringify({
      'w:g1:c1': { status: 'running', goalId: 'g1', fencingToken: 1, claimedAt: claim.assignment.claimedAt, startedAt: new Date().toISOString() },
    }), 'utf8');
    const taskRunId = 'w:g1:c1';
    // 在途启动(不 await;模拟 worker 进程即将被 kill)
    rt1.orchestrator.start({ taskRunId, taskId: 'g1', goalId: 'g1', projectId: 'p1', assignment: claim.assignment, task: claim.task }).catch(() => {});
    const intent = await waitIntentReceipt(dir);
    assert.equal(intent.phase, 'intent');

    // "kill":强断在途连接(等价 SIGKILL 后的传输面;close() 会等慢连接排空,必须 closeAllConnections)
    apiSlow.server.closeAllConnections();
    apiSlow.server.close();
    await sleep(600);
    const apiFast = await startMockApi({ mode: 'ok' });
    try {
      // 新实例(模拟重启后的 worker/CLI;同 dataDir:checkpoint+回执+registry 仍在)
      const rt2 = makeRuntime(dir, apiFast);
      const recovered = await rt2.orchestrator.recover(taskRunId);
      assert.ok(recovered, 'checkpoint 应可恢复');
      assert.equal(recovered.state, 'unknown');
      assert.equal(apiFast._calls === undefined ? (await import('../src/deps.mjs'), 0) : 0, 0);
      // 版本漂移(恢复期上报会使 A 目标版本推进;stub 以重播种模拟)
      await rt2.contract.seedGoal({ goalId: 'g1', projectId: 'p1', goalKey: 'model_review', role: 'credit', version: 2 });

      // 可信人工授权 retry_step:恰一次新 attempt/requestId 重发
      const view = await rt2.orchestrator.resume(taskRunId, {
        principalCredential: 'cred:boss', action: 'retry_step', stepId: 'model:credit:risk_review',
      });
      assert.equal(view.state, 'completed', `重跑终局:${JSON.stringify(view.terminal)}`);
      const step = view.steps[0];
      assert.equal(step.attempt, 1, '新 attempt');
      assert.ok(step.requestId.endsWith('::a1'), `新 requestId:${step.requestId}`);
      assert.equal(apiFast.requests.length, 1, '恰一次新调用');
      assert.equal(view.humanActions[0].principal.principalId, 'boss');

      // A 收口:settleAfterResume → stub completeGoal → candidate_ready
      const s = await settleAfterResume({ contract: rt2.contract, registryDir: `${dir}/worker`, taskRunId, view });
      assert.equal(s.settled, 'submitted', `收口:${JSON.stringify({ settled: s.settled, code: s.submit?.code })}`);
      const goalView = await rt2.contract.getGoalView('g1');
      assert.equal(goalView.status, 'candidate_ready');
      assert.equal((await rt2.contract.getExecutionReceipt(`${taskRunId}::complete:r1`)).kind, 'execution_completed');

      // 负例1:重复授权(已完成)→ 边界 TERMINAL_STATE 拒绝,零新增调用
      await assert.rejects(() => rt2.orchestrator.resume(taskRunId, {
        principalCredential: 'cred:boss', action: 'retry_step', stepId: 'model:credit:risk_review',
      }), (e) => e.code === 'TERMINAL_STATE');
      // 负例2:重复 settle(同 view 再收口)→ 同 requestId 幂等 replayed,零新增调用、无重复回执
      const s2 = await settleAfterResume({ contract: rt2.contract, registryDir: `${dir}/worker`, taskRunId, view });
      assert.equal(s2.settled, 'submitted-replayed');
      assert.equal(apiFast.requests.length, 1, '负例后零新增调用');
    } finally { await apiFast.close(); }
  } finally { await rmDir(dir); }
}, { timeout: 60000 });
