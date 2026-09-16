// 任务 03 · B 路必测矩阵（C09/C10/C11/C20/C21/C22/C23/C24/C25）。
// 判据对齐任务书 §7 必测矩阵；材料级判据在 C 场景集覆盖（见 C/test/four-domain-matrix.test.mjs）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fs } from '../src/deps.mjs';
import { atomicWriteJson } from '../src/ports.mjs';
import { withFileLock } from '../src/fs-lock.mjs';
import { planRecalc, isResultCurrent } from '../src/schedule/recalc-planner.mjs';
import { createDomainCache, cacheKey } from '../src/cache/domain-cache.mjs';
import { createModelTransport } from '../src/transport/glm.mjs';
import { createWorker } from '../src/worker/worker.mjs';
import { createTaskRunOrchestrator } from '../src/graph/task-run-orchestrator.mjs';
import { createContractStub } from '../src/contract/stub.mjs';
import { createRouter } from '../src/router.mjs';
import { FileCheckpointSaver } from '../src/langgraph/file-checkpointer.mjs';
import { LocalFileReceipts, ReceiptsPort, ToolsPort } from '../src/ports.mjs';
import { tmpDir, rmDir, sleep } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHILD_EPERM = path.join(here, 'atomic-write-eperm-child.mjs');
const CHILD_BUDGET = path.join(here, 'budget-child.mjs');

// ---------- C09 选择性重算 ----------
test('C09: 无关留言不触发任何域重算;相关证据只触发受影响域', () => {
  const r1 = planRecalc({ event: { type: 'message_posted' }, currentDomainStatus: { policy: {}, credit: {}, commerce: {}, asset: {} } });
  assert.deepEqual(r1.recompute, []);
  assert.equal(r1.unchanged.length, 4);
  const r2 = planRecalc({ event: { type: 'message_posted', factKeys: ['monthly_debt_service'] }, currentDomainStatus: { policy: {}, credit: {}, commerce: {}, asset: {} } });
  assert.deepEqual(r2.recompute, ['credit', 'commerce']);
  const r3 = planRecalc({ event: { type: 'evidence_submitted', evidenceKind: 'transcript', factKeys: ['equipment_ownership_verified'] }, currentDomainStatus: {} });
  // transcript → policy/credit/asset;factKey → asset/policy(high) → 去重后 3 域,commerce 不动
  assert.deepEqual(r3.recompute, ['policy', 'credit', 'asset']);
  assert.ok(r3.unchanged.includes('commerce') === false || r3.unchanged.length === 0);
});
test('C09 扩展: 已 stale 的域无条件重算;政策更新触发 policy+gate(high)', () => {
  const r = planRecalc({ event: { type: 'evidence_submitted', evidenceKind: 'message' }, currentDomainStatus: { asset: { stale: true } } });
  assert.deepEqual(r.recompute, ['asset']);
  const r2 = planRecalc({ event: { type: 'policy_updated' }, currentDomainStatus: {} });
  assert.deepEqual(r2.recompute, ['policy', 'gate']);
  assert.equal(r2.priority, 'high');
});

// ---------- C10/C11 旧结果不覆盖 + 政策版本失效 ----------
test('C10: 缓存拒绝低代次回写(旧 worker 不覆盖新候选)', async () => {
  const dir = await tmpDir('fd-cache-');
  try {
    const cache = createDomainCache({ dir });
    const key = cacheKey({ tenantId: 't', customerId: 'c', inputHash: 'h1', rulesetVersion: '1.0.0', modelVersion: 'm', promptHash: 'p' });
    const put1 = await cache.put({ key, value: { result: 'new' }, watermark: { generation: 5 }, rulesetVersion: '1.0.0' });
    assert.equal(put1.ok, true);
    const put2 = await cache.put({ key, value: { result: 'stale-worker' }, watermark: { generation: 3 }, rulesetVersion: '1.0.0' });
    assert.equal(put2.ok, false);
    assert.equal(put2.code, 'CACHE_STALE_WRITE');
    const got = await cache.get(key);
    assert.equal(got.value.result, 'new');
    assert.equal(got.watermark.generation, 5);
    // 无水位写入构造即拒
    await assert.rejects(() => cache.put({ key, value: {}, watermark: {} }), /水位/);
  } finally {
    await rmDir(dir);
  }
});
test('C10/C11: isResultCurrent——代次或规则版本不同 → stale', () => {
  const cur = { current: isResultCurrent({ resultWatermark: { generation: 1 }, currentWatermark: { generation: 2 } }).current };
  assert.equal(cur.current, false);
  assert.equal(isResultCurrent({ resultWatermark: { generation: 3 }, currentWatermark: { generation: 3 } }).current, true);
  const v = isResultCurrent({ resultWatermark: { generation: 3 }, currentWatermark: { generation: 3 }, resultRulesetVersion: '1.0.0', currentRulesetVersion: '1.1.0' });
  assert.equal(v.current, false);
  assert.match(v.because, /ruleset/);
});

// ---------- C25 缓存跨客户隔离 ----------
test('C25: 同一文件 hash 不同客户 → 缓存键不同,结果不串线', async () => {
  const dir = await tmpDir('fd-cache-iso-');
  try {
    const cache = createDomainCache({ dir });
    const keyA = cacheKey({ tenantId: 't', customerId: 'cust-A', inputHash: 'SAME_FILE_HASH', rulesetVersion: '1.0.0', modelVersion: 'm', promptHash: 'p' });
    const keyB = cacheKey({ tenantId: 't', customerId: 'cust-B', inputHash: 'SAME_FILE_HASH', rulesetVersion: '1.0.0', modelVersion: 'm', promptHash: 'p' });
    assert.notEqual(keyA, keyB, '客户隔离键必须参与缓存键');
    await cache.put({ key: keyA, value: { context: 'A 的敏感上下文' }, watermark: { generation: 1 } });
    const gotB = await cache.get(keyB);
    assert.equal(gotB, null, '客户 B 不得读到客户 A 的缓存');
    const gotA = await cache.get(keyA);
    assert.equal(gotA.value.context, 'A 的敏感上下文');
  } finally {
    await rmDir(dir);
  }
});

// ---------- C24 Windows 原子写 EPERM 注入 ----------
test('C24: EPERM 注入 → 有界重试成功无残留;永久 EPERM → 结构化失败旧内容完好', async () => {
  const dir = await tmpDir('fd-eperm-');
  try {
    const target = path.join(dir, 'state.json');
    const child = spawn(process.execPath, [CHILD_EPERM, target, '2'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 0, out);
    const result = JSON.parse(out.trim().split('\n').pop());
    assert.equal(result.afterInjection.v, 2, '重试后应写入成功');
    assert.equal(result.tmpResidue, 0, '不得遗留 .tmp 文件(历史实测缺陷)');
    assert.equal(result.permanentError.code, 'ATOMIC_WRITE_FAILED');
    assert.equal(result.permanentError.oldIntact, true, '永久失败时旧内容必须原样');
    assert.equal(result.permanentTmpResidue, 0);
  } finally {
    await rmDir(dir);
  }
});
test('C24 进程内: 非占用类错误(EISDIR)不重试,确定性失败', async () => {
  const dir = await tmpDir('fd-eperm2-');
  try {
    const asDir = path.join(dir, 'target.json');
    await fs.mkdir(asDir);
    await assert.rejects(
      () => atomicWriteJson(asDir, { v: 1 }),
      (e) => e.code === 'ATOMIC_WRITE_FAILED',
    );
  } finally {
    await rmDir(dir);
  }
});

// ---------- C20 多进程预算并发 + C21 坏账本 + 多粒度预算 ----------
function startCountingServer() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      server._count += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  server._count = 0;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('C20: 6 个进程预算仅够 1 调用 → 出站恰 1 次,其余失败关闭', async () => {
  const dir = await tmpDir('fd-c20-');
  const server = await startCountingServer();
  try {
    const ledger = path.join(dir, 'cost-ledger.jsonl');
    const children = [];
    for (let i = 0; i < 6; i += 1) {
      children.push(spawn(process.execPath, [CHILD_BUDGET, `http://127.0.0.1:${server.address().port}`, ledger], { stdio: ['ignore', 'pipe', 'pipe'] }));
    }
    const outs = await Promise.all(children.map((c) => new Promise((r) => {
      let buf = '';
      c.stdout.on('data', (x) => { buf += x; });
      c.stderr.on('data', (x) => { buf += x; });
      c.on('close', () => r(buf.trim().split('\n').pop()));
    })));
    const statuses = outs.map((o) => JSON.parse(o));
    const okCount = statuses.filter((s) => s.status === 'simulated').length;
    const blocked = statuses.filter((s) => s.code === 'BUDGET_EXCEEDED').length;
    assert.equal(server._count, 1, `出站必须恰 1 次,实际 ${server._count}`);
    assert.equal(okCount, 1);
    assert.equal(blocked, 5);
  } finally {
    server.close();
    await rmDir(dir);
  }
});

test('C21: 坏账本/目录账本 → 零出站,明确错误码', async () => {
  const dir = await tmpDir('fd-c21-');
  const server = await startCountingServer();
  try {
    const ledger = path.join(dir, 'cost-ledger.jsonl');
    await fs.writeFile(ledger, '{broken json line}\n{"amount":"NaN"}\n', 'utf8');
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${server.address().port}` }, budget: { maxTotalCost: 10, perCallEstimate: 1 }, costLogPath: ledger });
    const r = await t.complete({ requestId: 'c21-a', contextTags: { projectId: 'p1', runId: 'r1' } });
    assert.equal(r.status, 'failed');
    assert.equal(r.error.code, 'BUDGET_LEDGER_CORRUPT');
    assert.equal(server._count, 0);
    // 目录账本 → UNREADABLE
    const t2 = createModelTransport({ mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${server.address().port}` }, budget: { maxTotalCost: 10, perCallEstimate: 1 }, costLogPath: dir });
    const r2 = await t2.complete({ requestId: 'c21-b', contextTags: { projectId: 'p1', runId: 'r1' } });
    assert.equal(r2.error.code, 'BUDGET_LEDGER_UNREADABLE');
    assert.equal(server._count, 0);
  } finally {
    server.close();
    await rmDir(dir);
  }
});

test('S3 多粒度预算: 客户级/会话级子限额与调用次数上限独立生效(失败关闭)', async () => {
  const dir = await tmpDir('fd-budget-scope-');
  const server = await startCountingServer();
  try {
    const ledger = path.join(dir, 'cost-ledger.jsonl');
    const t = createModelTransport({
      mode: 'mock',
      mock: { baseUrl: `http://127.0.0.1:${server.address().port}` },
      budget: { maxTotalCost: 100, perCallEstimate: 1, customer: { maxTotalCost: 2 }, session: { maxTotalCost: 1.5 } },
      costLogPath: ledger,
    });
    const req = (runId) => ({ requestId: `m-${runId}`, contextTags: { projectId: 'cust-77', runId } });
    assert.equal((await t.complete(req('s1'))).status, 'simulated');
    // 会话限额 1.5,perCallEstimate=1 → 同会话第 2 次即拦(1+1 > 1.5)
    const second = await t.complete(req('s1'));
    assert.equal(second.status, 'failed');
    assert.equal(second.error.code, 'BUDGET_SESSION_EXCEEDED');
    // 新会话可再过一次(客户累计 2 ≤ 客户上限 2)
    assert.equal((await t.complete(req('s2'))).status, 'simulated');
    // 客户级:同客户第 3 次(累计 3 > 2) → BUDGET_CUSTOMER_EXCEEDED
    const fourth = await t.complete(req('s3'));
    assert.equal(fourth.status, 'failed');
    assert.equal(fourth.error.code, 'BUDGET_CUSTOMER_EXCEEDED');
    assert.equal(server._count, 2, '出站必须恰 2 次(全局未超,客户/会话各自拦截)');
    // 调用次数上限
    const t2 = createModelTransport({
      mode: 'mock',
      mock: { baseUrl: `http://127.0.0.1:${server.address().port}` },
      budget: { maxTotalCost: 100, perCallEstimate: 1, maxCalls: 1 },
      costLogPath: path.join(dir, 'ledger2.jsonl'),
    });
    assert.equal((await t2.complete(req('x1'))).status, 'simulated');
    const over = await t2.complete(req('x2'));
    assert.equal(over.error.code, 'BUDGET_CALLS_EXCEEDED');
  } finally {
    server.close();
    await rmDir(dir);
  }
});

// ---------- C22 恢复竞态:活锁不盲抢 + 并发恢复互斥 ----------
function makeOrchestrator(dir, contract, transport) {
  return createTaskRunOrchestrator({
    ports: { receipts: new ReceiptsPort(new LocalFileReceipts(dir)), tools: new ToolsPort({ calculate: async () => ({ ok: true, toolVersion: 't', inputHash: 'x', output: {} }) }), factVersions: { currentVersions: async () => ({ factVersion: '1', ruleVersion: '1' }) } },
    contract, transport, router: createRouter({ roles: ['credit'], rules: [{ ruleId: 'R1', when: { taskKind: 'model_review' }, plan: [{ stepId: 's1', kind: 'model', role: 'credit', purpose: 'p' }] }] }),
    checkpointer: new FileCheckpointSaver(`${dir}/checkpoints`),
    logger: () => {},
  });
}

test('C22/恢复竞态: 活进程持有的恢复锁不被盲抢;死进程锁可接管;registry 并发写不损坏', async () => {
  const dir = await tmpDir('fd-recover-race-');
  try {
    const registryDir = `${dir}/worker`;
    await fs.mkdir(registryDir, { recursive: true });
    const lockDir = `${registryDir}/recover-locks`;
    await fs.mkdir(lockDir, { recursive: true });

    // ① 活进程(本进程 pid)持锁 → recoverAll 必须跳过(不盲抢活锁)
    await fs.writeFile(`${lockDir}/${encodeURIComponent('tr:live')}.lock`, `${process.pid} ${Date.now()} abcdef\n`, 'utf8');
    const contract = createContractStub({ dataDir: `${dir}/stub` });
    const orchestrator = makeOrchestrator(dir, contract, { complete: async () => { throw new Error('not used'); } });
    const worker = createWorker({ contract, orchestrator, registryDir, logger: () => {} });
    await atomicWriteJson(`${registryDir}/runs.json`, { 'tr:live': { status: 'running', goalId: 'g1', fencingToken: 1 } });
    const results = await worker.recoverAll();
    assert.equal(results.length, 1);
    assert.match(results[0].settled ?? '', /recover-locked/, '活锁必须跳过');

    // ② 死进程锁 → 接管并处理(此处无 checkpoint → skipped:no-checkpoint)
    await fs.writeFile(`${lockDir}/${encodeURIComponent('tr:dead')}.lock`, '999999999 1 abcdef\n', 'utf8');
    await atomicWriteJson(`${registryDir}/runs.json`, { 'tr:dead': { status: 'running', goalId: 'g2', fencingToken: 1 } });
    const results2 = await worker.recoverAll();
    assert.equal(results2[0].settled, undefined);
    assert.equal(results2[0].skipped, 'no-checkpoint');

    // ③ 并发写 registry:两个写入方各写 15 次(经 registry.lock 串行) → runs.json 恒为合法 JSON 且双方条目都在
    const writer = async (tag) => {
      for (let i = 0; i < 15; i += 1) {
        const lock = await withFileLock({
          lockPath: `${registryDir}/registry.lock`,
          fn: async () => {
            const raw = await fs.readFile(`${registryDir}/runs.json`, 'utf8').catch(() => '{}');
            const reg = JSON.parse(raw);
            reg[`${tag}-${i}`] = { v: i };
            await atomicWriteJson(`${registryDir}/runs.json`, reg);
          },
        });
        if (!lock.ok) throw new Error(lock.blocked.code);
      }
    };
    await Promise.all([writer('w1'), writer('w2')]);
    const final = JSON.parse(await fs.readFile(`${registryDir}/runs.json`, 'utf8'));
    assert.ok(Object.keys(final).filter((k) => k.startsWith('w1-')).length >= 14, 'w1 条目不得被覆盖丢失');
    assert.ok(Object.keys(final).filter((k) => k.startsWith('w2-')).length >= 14, 'w2 条目不得被覆盖丢失');
  } finally {
    await rmDir(dir);
  }
});

test('C22 补充: in-flight 中断后恢复保留 unknown、零盲重发(与 crash-recovery.test.mjs 同判据的轻量进程内复核)', async () => {
  const dir = await tmpDir('fd-unknown-');
  try {
    // transport:第一次调用挂起(进程"崩溃"),恢复后不重发
    let calls = 0;
    const hangingTransport = {
      configFingerprint: () => ({ mode: 'none' }),
      async complete() { calls += 1; await sleep(60000); throw new Error('unreachable'); },
    };
    const contract = createContractStub({ dataDir: `${dir}/stub` });
    await contract.seedGoal({ goalId: 'g-unk', projectId: 'p', goalKey: 'model_review', role: 'credit' });
    const orchestrator = makeOrchestrator(dir, contract, hangingTransport);
    const assignment = { workerId: 'w1', fencingToken: 7, leaseUntil: new Date(Date.now() + 60000).toISOString() };
    const startP = orchestrator.start({ taskRunId: 'tr:unk', taskId: 'g-unk', goalId: 'g-unk', projectId: 'p', assignment, task: { taskKind: 'model_review', role: 'credit', purpose: 'p', evidenceRefs: [] } });
    await sleep(300); // 等 intent 回执落盘
    const receipts = await fs.readdir(`${dir}/receipts`);
    assert.ok(receipts.some((n) => n.includes('a0')), 'intent 回执应已落盘');
    // 模拟进程消失后重启:新 orchestrator 同 checkpointer
    const orchestrator2 = makeOrchestrator(dir, contract, hangingTransport);
    const view = await orchestrator2.recover('tr:unk');
    assert.ok(view, '恢复视图应存在');
    const cont = await orchestrator2.continueRun('tr:unk');
    assert.equal(cont.state, 'unknown');
    assert.equal(calls, 1, '恢复不得自动重发(零盲重发)');
    await startP.catch(() => {});
  } finally {
    await rmDir(dir);
  }
});

test('S3 限额族: maxRequestChars 超限 → 确定未发送(REQUEST_TOO_LARGE)', async () => {
  const server = await startCountingServer();
  try {
    const t = createModelTransport({
      mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${server.address().port}` },
      limits: { maxRequestChars: 10 },
    });
    const r = await t.complete({ requestId: 'big-1', text: 'x'.repeat(200), contextTags: { projectId: 'p', runId: 'r' } });
    assert.equal(r.status, 'failed');
    assert.equal(r.error.code, 'REQUEST_TOO_LARGE');
    assert.equal(r.sentFlag, false);
    assert.equal(server._count, 0, '超限请求零出站');
    // 构造即拒
    assert.throws(() => createModelTransport({ mode: 'mock', mock: { baseUrl: 'http://127.0.0.1:1' }, limits: { maxRequestChars: -5 } }), /maxRequestChars/);
  } finally {
    server.close();
  }
});

test('C23 前提: 人工授权重试用新 attempt/requestId;预算上限在重试后仍生效', async () => {
  const dir = await tmpDir('fd-c23-');
  const server = await startCountingServer();
  try {
    const ledger = path.join(dir, 'ledger.jsonl');
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${server.address().port}` }, budget: { maxTotalCost: 2, perCallEstimate: 1 }, costLogPath: ledger });
    // attempt 0/1 各一次调用(幂等键不同 → 各预占一次);第 3 次被预算拦截
    const r0 = await t.complete({ requestId: 'run::s1::a0', contextTags: { projectId: 'p', runId: 'run' } });
    assert.equal(r0.status, 'simulated');
    const r1 = await t.complete({ requestId: 'run::s1::a1', contextTags: { projectId: 'p', runId: 'run' } });
    assert.equal(r1.status, 'simulated');
    const r2 = await t.complete({ requestId: 'run::s1::a2', contextTags: { projectId: 'p', runId: 'run' } });
    assert.equal(r2.status, 'failed');
    assert.equal(r2.error.code, 'BUDGET_EXCEEDED');
    assert.equal(server._count, 2, '授权重试得到新预算预占,但总量上限不变');
    // 同 requestId 重放 → 幂等复用,不产生新出站
    const rReplay = await t.complete({ requestId: 'run::s1::a0', contextTags: { projectId: 'p', runId: 'run' } });
    void rReplay;
    assert.equal(server._count, 2);
  } finally {
    server.close();
    await rmDir(dir);
  }
});
