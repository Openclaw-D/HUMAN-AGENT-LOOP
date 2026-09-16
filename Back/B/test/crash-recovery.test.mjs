// 崩溃恢复测试:真实跨进程(SIGKILL)+ FileCheckpointSaver 持久 checkpoint + 业务回执对账。
// 覆盖:进程重启后 recover 投影 / continueRun 节点重入查回执(intent→unknown,零盲重发)/
//       终态回执复用零调用 / 恢复后取消(已发送意图→unknown,未发送→cancelled)。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createBRuntime } from '../src/runtime.mjs';
import { startMockApi, tmpDir, rmDir, testRoutes, testVerifier, sleep } from './helpers.mjs';
import { fileURLToPath } from 'node:url';
import { fs } from '../src/deps.mjs';

const CHILD = fileURLToPath(new URL('./crash-child.mjs', import.meta.url));

async function waitIntentReceipt(dir, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const names = await fs.readdir(`${dir}/receipts`);
      const intent = names.find((n) => n.endsWith('.json') && !n.includes('::complete'));
      if (intent) {
        const raw = JSON.parse(await fs.readFile(`${dir}/receipts/${intent}`, 'utf8'));
        if (raw.phase === 'intent') return raw;
      }
    } catch { /* receipts 目录未建 */ }
    await sleep(100);
  }
  throw new Error('等待 intent 回执超时');
}

test('跨进程崩溃恢复:intent 无回执 → unknown,零盲重发;业务回执对账留痕', async () => {
  const api = await startMockApi({ mode: 'slow', delayMs: 60000 }); // 永不及时的响应
  const dir = await tmpDir('crash-');
  try {
    const rt = createBRuntime({
      dataDir: dir,
      config: { transport: {}, routes: testRoutes(), contract: { mode: 'stub' } },
      overrides: { principalVerifier: testVerifier(), logger: () => {} },
    });
    
    await rt.contract.seedGoal({ goalId: 't-cr', projectId: 'p1', goalKey: 'model_review', role: 'credit' });

    // 子进程:claim → start(阻塞在慢 transport)→ 被 SIGKILL
    const child = spawn(process.execPath, [CHILD, dir, api.baseUrl, 'tr:crash'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let childOut = '';
    child.stdout.on('data', (c) => { childOut += c; });
    child.stderr.on('data', (c) => { childOut += c; });
    const intent = await waitIntentReceipt(dir);
    assert.equal(intent.phase, 'intent');
    child.kill('SIGKILL');
    await sleep(300);

    // 父进程(新 runtime 实例,同数据目录)恢复:业务回执对账
    const view = await rt.orchestrator.recover('tr:crash');
    assert.ok(view, 'checkpoint 应可恢复');
    assert.equal(view.state, 'running'); // 无终局,未续跑
    assert.ok(Array.isArray(view.recoveryNotes) && view.recoveryNotes.length >= 1);
    assert.match(view.recoveryNotes[0], /unknown/);
    assert.equal(api.requests.length, 1); // 崩溃前恰好一次出站

    // 系统统跑:节点重入查业务回执(B 回执 intent 无 terminal)→ unknown,不重发
    const cont = await rt.orchestrator.continueRun('tr:crash');
    assert.equal(cont.state, 'unknown');
    assert.equal(api.requests.length, 1); // 关键断言:零盲重发
    assert.equal(cont.steps[0].state, 'unknown');

    // 恢复后取消(人工在恢复入口决策):终局已是 unknown,parking 在人工门 → cancel 不适用
    const c = await rt.orchestrator.cancel('tr:crash');
    assert.equal(c.cancelApplied, false);
  } finally {
    await api.close();
    await rmDir(dir);
  }
});

test('恢复后取消:未发送剩余步 → cancelled;已有 intent 步 → unknown(不谎称未发送)', async () => {
  const api = await startMockApi({ mode: 'slow', delayMs: 60000 });
  const dir = await tmpDir('crash-cancel-');
  try {
    const rt = createBRuntime({
      dataDir: dir,
      config: { transport: {}, routes: testRoutes(), contract: { mode: 'stub' } },
      overrides: { principalVerifier: testVerifier(), logger: () => {} },
    });
    
    await rt.contract.seedGoal({ goalId: 't-cc', projectId: 'p1', goalKey: 'review_with_calc', params: { monthlyOperatingCashFlow: 1, monthlyDebtService: 1, currency: 'CNY' } });

    const child = spawn(process.execPath, [CHILD, dir, api.baseUrl, 'tr:cc'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitIntentReceipt(dir);
    child.kill('SIGKILL');
    await sleep(300);

    // 恢复视图(运行中,无终局)→ 操作员取消 → 续跑:取消在步边界生效
    await rt.orchestrator.recover('tr:cc');
    const c = await rt.orchestrator.cancel('tr:cc');
    assert.equal(c.ok, true);
    const cont = await rt.orchestrator.continueRun('tr:cc');
    // 终局按保守优先级:存在 unknown 步 → 终局 unknown(取消细节在步状态中)
    assert.equal(cont.state, 'unknown');
    const modelStep = cont.steps.find((s) => s.kind === 'model');
    assert.equal(modelStep.state, 'unknown'); // intent 无回执:不可谎称未发送
    assert.match(modelStep.error.code, /CANCELLED_WITH_PENDING_INTENT/);
    const toolStep = cont.steps.find((s) => s.kind === 'tool');
    assert.equal(toolStep.state, 'cancelled'); // 确定未发送
    assert.equal(api.requests.length, 1);
  } finally {
    await api.close();
    await rmDir(dir);
  }
});

test('checkpoint 跨进程持久:终态运行在新实例可完整投影,continueRun 零新调用', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('crash-view-');
  try {
    const rt1 = createBRuntime({
      dataDir: dir,
      config: { transport: { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 5000 } }, routes: testRoutes(), contract: { mode: 'stub' } },
      overrides: { logger: () => {} },
    });
    
    await rt1.contract.seedGoal({ goalId: 't-pv', projectId: 'p1', goalKey: 'model_review', role: 'credit' });
    const claim = await rt1.contract.pollWork({ workerId: 'w1' });
    const v1 = await rt1.orchestrator.start({ taskRunId: 'tr:pv', taskId: 't-pv', goalId: 't-pv', projectId: 'p1', assignment: claim.assignment, task: claim.task });
    assert.equal(v1.state, 'completed'); // mock-ok 返回 findings → 全步成功
    assert.ok(v1.candidate);

    // 新实例(模拟进程重启):同 checkpointer 可投影视图;续跑为 no-op;零新模型调用
    const rt2 = createBRuntime({
      dataDir: dir,
      config: { transport: { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 5000 } }, routes: testRoutes(), contract: { mode: 'stub' } },
      overrides: { logger: () => {} },
    });
    const v2 = await rt2.orchestrator.view('tr:pv');
    assert.equal(v2.state, 'completed');
    assert.equal(v2.candidate.sourceMode, 'simulated');
    const cont = await rt2.orchestrator.continueRun('tr:pv');
    assert.equal(cont.continued, false);
    assert.equal(api.requests.length, 1); // 零重复调用
  } finally {
    await api.close();
    await rmDir(dir);
  }
});
