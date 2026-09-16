// D-25 预算上限失败关闭测试(05:00 评审反例全覆盖;mock 可测,0 真实调用):
//   T1 顺序上限;T2 重启(新实例同账本)不绕过;T3 真实并发:6 实例 Promise.all 共享账本
//   (预算1/单次1 → 恰 1 次出站,5 次 BUDGET_* 拒绝);T4 真实跨进程:子进程+父进程同时调用
//   (合计出站 ≤ 预算);T5 账本路径=目录 → 失败关闭 0 出站;T6 坏账本 → 失败关闭 0 出站;
//   T7 非法预算(NaN/Infinity/负数/缺项) → 创建即抛错;T8 无 costLogPath + 启用预算 → 失败关闭。
// reserve/actual 语义见 HANDOFF-D §2:reserve=扣减主体(估算,永久);actual=观测+超额补记(差额)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createModelTransport } from '../src/transport/glm.mjs';
import { startMockApi, tmpDir, rmDir, testRoutes } from './helpers.mjs';

const mkTransport = (api, ledger, budget, over = {}) => createModelTransport({
  mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 20000 }, budget, costLogPath: ledger, ...over,
});

test('T1 预算顺序上限:首调用入账后,后续 BUDGET_EXCEEDED 且未发送', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('budget-t1-');
  const ledger = `${dir}/cost-ledger.jsonl`;
  try {
    const t = mkTransport(api, ledger, { maxTotalCost: 0.001, perCallEstimate: 0.001 });
    assert.equal((await t.complete({ requestId: 'b1', evidenceRefs: [] })).status, 'simulated');
    const r2 = await t.complete({ requestId: 'b2', evidenceRefs: [] });
    assert.equal(r2.status, 'failed');
    assert.equal(r2.sentFlag, false);
    assert.equal(r2.error.code, 'BUDGET_EXCEEDED');
    assert.match(r2.error.messageZh, /失败关闭/);
    // 账本语义:reserve(扣减主体)+actual(差额 0,观测)各一条
    const lines = (await fs.readFile(ledger, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => `${l.type}:${l.amount}`), ['reserve:0.001', 'actual:0']);
    assert.equal(api.requests.length, 1, '超限后零出站');
  } finally { await api.close(); await rmDir(dir); }
});

test('T2 重启不绕过:新实例读同一持久账本,立即失败关闭', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('budget-t2-');
  const ledger = `${dir}/cost-ledger.jsonl`;
  const budget = { maxTotalCost: 0.001, perCallEstimate: 0.001 };
  try {
    const t1 = mkTransport(api, ledger, budget);
    assert.equal((await t1.complete({ requestId: 'c1', evidenceRefs: [] })).status, 'simulated');
    const t2 = mkTransport(api, ledger, budget); // "重启":全新实例同账本
    const r = await t2.complete({ requestId: 'c2', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.error.code, 'BUDGET_EXCEEDED');
    assert.equal(api.requests.length, 1, '重启后零出站(未绕过)');
  } finally { await api.close(); await rmDir(dir); }
});

test('T3 真实并发:6 实例 Promise.all 共享账本(预算1/单次1)→ 恰 1 次出站,5 次预算拒绝', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('budget-t3-');
  const ledger = `${dir}/cost-ledger.jsonl`;
  try {
    const budget = { maxTotalCost: 1, perCallEstimate: 1 };
    const transports = Array.from({ length: 6 }, (_, i) => mkTransport(api, ledger, budget));
    const results = await Promise.all(transports.map((t, i) =>
      t.complete({ requestId: `p${i}`, evidenceRefs: [] }).then((r) => ({ status: r.status, code: r.error?.code ?? null }))));
    const okCount = results.filter((r) => r.status === 'simulated').length;
    const blockedCount = results.filter((r) => r.status === 'failed' && ['BUDGET_EXCEEDED', 'BUDGET_LOCK_TIMEOUT'].includes(r.code)).length;
    assert.equal(okCount, 1, `恰一次出站:${JSON.stringify(results)}`);
    assert.equal(blockedCount, 5, `其余五次预算拒绝:${JSON.stringify(results)}`);
    assert.equal(api.requests.length, 1, 'mock 实际只收到 1 次请求');
    // 账本恰 1 条 reserve(扣减主体;actual 差额 0 不入账)
    const lines = (await fs.readFile(ledger, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.filter((l) => l.type === 'reserve').length, 1);
  } finally { await api.close(); await rmDir(dir); }
});

test('T4 真实跨进程:子进程与父进程同时调用(共享账本,预算1/单次1)→ 合计出站恰 1 次', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('budget-t4-');
  const ledger = `${dir}/cost-ledger.jsonl`;
  try {
    const childScript = fileURLToPath(new URL('./budget-child.mjs', import.meta.url));
    const child = spawn(process.execPath, [childScript, api.baseUrl, ledger], { stdio: ['ignore', 'pipe', 'pipe'] });
    let childOut = '';
    child.stdout.on('data', (c) => { childOut += c; });
    child.stderr.on('data', (c) => { childOut += c; });
    // 父进程同时发起(与子进程真实并发)
    const parentT = mkTransport(api, ledger, { maxTotalCost: 1, perCallEstimate: 1 });
    const parentP = parentT.complete({ requestId: 'parent', evidenceRefs: [] }).then((r) => ({ status: r.status, code: r.error?.code ?? null }));
    const childP = new Promise((r) => child.on('exit', () => r()));
    await Promise.all([parentP, childP]);
    const childResult = JSON.parse(childOut.trim().split('\n').pop());
    const parentResult = await parentP;
    const okCount = [parentResult, childResult].filter((r) => r.status === 'simulated').length;
    assert.equal(okCount, 1, `跨进程恰一次出站:parent=${JSON.stringify(parentResult)} child=${JSON.stringify(childResult)}`);
    assert.equal(api.requests.length, 1, 'mock 实际只收到 1 次请求');
  } finally { await api.close(); await rmDir(dir); }
}, { timeout: 60000 });

test('T5 账本路径为目录(不可读写)→ 失败关闭,0 出站(05:00 反例)', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('budget-t5-');
  try {
    const t = mkTransport(api, dir, { maxTotalCost: 1, perCallEstimate: 1 }); // dir 是已存在目录
    const r = await t.complete({ requestId: 'd1', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, false, '确定未发送');
    assert.match(r.error.code, /^BUDGET_LEDGER_/);
    assert.match(r.error.messageZh, /失败关闭/);
    assert.equal(api.requests.length, 0, '0 出站');
  } finally { await api.close(); await rmDir(dir); }
});

test('T6 坏账本(坏行/amount 非法)→ 失败关闭,0 出站', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('budget-t6-');
  const ledger = `${dir}/cost-ledger.jsonl`;
  try {
    await fs.writeFile(ledger, '{not-json\n', 'utf8');
    let t = mkTransport(api, ledger, { maxTotalCost: 1, perCallEstimate: 1 });
    let r = await t.complete({ requestId: 'x1', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.error.code, 'BUDGET_LEDGER_CORRUPT');
    assert.equal(api.requests.length, 0);
    // amount 非有限数值同判
    await fs.writeFile(ledger, `${JSON.stringify({ type: 'reserve', amount: 'big' })}\n`, 'utf8');
    t = mkTransport(api, ledger, { maxTotalCost: 1, perCallEstimate: 1 });
    r = await t.complete({ requestId: 'x2', evidenceRefs: [] });
    assert.equal(r.error.code, 'BUDGET_LEDGER_CORRUPT');
    assert.equal(api.requests.length, 0, '坏账本 0 出站');
  } finally { await api.close(); await rmDir(dir); }
});

test('T7 非法预算(NaN/Infinity/负数/0/缺项)→ 创建即抛错失败关闭', () => {
  const api = null;
  const base = { mode: 'mock', mock: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 }, costLogPath: './test/.tmp/unused-ledger.jsonl' };
  for (const bad of [
    { maxTotalCost: Number.NaN, perCallEstimate: 1 },
    { maxTotalCost: 1, perCallEstimate: Number.POSITIVE_INFINITY },
    { maxTotalCost: -1, perCallEstimate: 1 },
    { maxTotalCost: 1, perCallEstimate: 0 },
    { maxTotalCost: 1 }, // 缺 perCallEstimate
  ]) {
    assert.throws(() => createModelTransport({ ...base, budget: bad }), /budget\./, JSON.stringify(bad));
  }
  void api;
});

test('T8 启用预算但未配置账本路径 → 失败关闭(不吞配置错误)', async () => {
  const api = await startMockApi({ mode: 'ok' });
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 5000 }, budget: { maxTotalCost: 1, perCallEstimate: 0.1 } });
    const r = await t.complete({ requestId: 'n1', evidenceRefs: [] });
    assert.equal(r.status, 'failed');
    assert.equal(r.error.code, 'BUDGET_LEDGER_UNREADABLE');
    assert.equal(api.requests.length, 0);
  } finally { await api.close(); }
});

test('T9 worker 端到端(DEF-04 回归):顶层 budget 段经 runtime 透传,真实 worker 流程预算门生效', async () => {
  const api = await startMockApi({ mode: 'ok' });
  const dir = await tmpDir('budget-t9-');
  try {
    const { createBRuntime } = await import('../src/runtime.mjs');
    const rt = createBRuntime({
      dataDir: dir,
      config: {
        transport: { mode: 'mock', mock: { baseUrl: api.baseUrl, timeoutMs: 10000 } },
        routes: testRoutes(), contract: { mode: 'stub' },
        // 顶层 budget 段(样例与 HANDOFF-D §2 同位):runtime 必须透传到 transport
        budget: { maxTotalCost: 0.001, perCallEstimate: 0.001 },
        worker: { workerId: 'w-budget', concurrency: 2, pollIntervalMs: 30, taskTimeoutMs: 60000 },
      },
      overrides: { logger: () => {} },
    });
    await rt.contract.seedGoal({ goalId: 'gA', projectId: 'p1', goalKey: 'model_review', role: 'credit' });
    await rt.contract.seedGoal({ goalId: 'gB', projectId: 'p1', goalKey: 'model_review', role: 'credit' });
    const cA = await rt.contract.claimGoal({ goalId: 'gA', requestId: 'ca' });
    const rA = await rt.worker.executeNow(cA.task, cA.assignment, { goalVersion: cA.goalVersion });
    assert.equal(rA.submitted, true);
    assert.equal(rA.report.completed, true);
    const cB = await rt.contract.claimGoal({ goalId: 'gB', requestId: 'cb' });
    const rB = await rt.worker.executeNow(cB.task, cB.assignment, { goalVersion: cB.goalVersion });
    assert.equal(rB.submitted, true);
    assert.equal(rB.report.completed, false, '预算耗尽 → fail 出口');
    assert.equal(rB.view.steps[0].error?.code, 'BUDGET_EXCEEDED');
    assert.match(rB.report.failNote, /失败/);
    assert.equal(api.requests.length, 1, '预算门经 runtime 接线生效:合计恰 1 次出站');
  } finally { await api.close(); await rmDir(dir); }
});
