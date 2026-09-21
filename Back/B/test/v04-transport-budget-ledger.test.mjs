// V0.4 03-receipts · B transport 预算门与成本账本 专项回归。
// 断言口径：账本条目 ↔ 替身命中数可核对（每次真实出站前必有 reserve；被阻断调用零命中）；
// 预占先于出站（替身命中时账本里已有 reserve）；重启（新 transport 实例同账本）不绕过预算。
// 全程本地替身，无真实外呼。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelTransport, buildModelRequest } from '../src/transport/glm.mjs';
import { startTransportStub } from './v04-transport-stub.mjs';

const requestOf = (over = {}) => {
  const { request } = buildModelRequest({
    runId: 'run-v04b', stepId: 'step-1', attempt: 1, role: 'credit', purpose: 'auxiliary_review',
    projectId: 'proj-v04b', goalId: null, goalLabel: 'V04预算', factVersion: '0', evidenceRefs: [],
    ...over,
  });
  return request;
};

const readLedger = async (file) => (await fs.readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('V04-BL-01 预占先于出站：替身命中时账本已有 reserve；完成后补 actual（mock 名义值差额0）', async () => {
  const stub = await startTransportStub();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-bl01-'));
  const costLogPath = path.join(dir, 'ledger.jsonl');
  try {
    const seenAtHit = [];
    stub.control.onHit = async () => {
      try { seenAtHit.push((await readLedger(costLogPath)).filter((e) => e.type === 'reserve').length); } catch { seenAtHit.push(-1); }
    };
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 },
      budget: { maxTotalCost: 10, perCallEstimate: 0.5 }, costLogPath });
    const r = await t.complete(requestOf());
    assert.equal(r.status, 'simulated');
    assert.equal(stub.hits(), 1);
    assert.deepEqual(seenAtHit, [1], '替身处理请求时 reserve 已落账=预占严格先于出站');
    const entries = await readLedger(costLogPath);
    assert.equal(entries.filter((e) => e.type === 'reserve').length, 1);
    assert.equal(entries.filter((e) => e.type === 'actual').length, 1);
    const reserve = entries.find((e) => e.type === 'reserve');
    const actual = entries.find((e) => e.type === 'actual');
    assert.equal(reserve.requestId, requestOf().requestId);
    assert.equal(reserve.amount, 0.5);
    assert.equal(actual.amount, 0, 'mock 名义值=估算，actual 差额 0');
    assert.equal(actual.billKnown, true);
  } finally { await stub.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('V04-BL-02 次数上限：2次出站后第3次阻断零出站，账本reserve数=替身命中数', async () => {
  const stub = await startTransportStub();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-bl02-'));
  const costLogPath = path.join(dir, 'ledger.jsonl');
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 },
      budget: { maxTotalCost: 10, perCallEstimate: 0.01, maxCalls: 2 }, costLogPath });
    await t.complete(requestOf({ attempt: 1 }));
    await t.complete(requestOf({ attempt: 2 }));
    assert.equal(stub.hits(), 2);
    const blocked = await t.complete(requestOf({ attempt: 3 }));
    assert.equal(blocked.status, 'failed');
    assert.equal(blocked.sentFlag, false, '超限=确定未发送');
    assert.equal(blocked.error.code, 'BUDGET_CALLS_EXCEEDED');
    assert.equal(stub.hits(), 2, '阻断调用零出站');
    const entries = await readLedger(costLogPath);
    assert.equal(entries.filter((e) => e.type === 'reserve').length, stub.hits(), '账本与真实替身计数可核对');
  } finally { await stub.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('V04-BL-03 会话/客户子限额按 scope 隔离：A 会话耗尽不挡 B 会话、A 客户耗尽不挡 B 客户', async () => {
  const stub = await startTransportStub();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-bl03-'));
  const costLogPath = path.join(dir, 'ledger.jsonl');
  try {
    // 会话级单独验证（无客户限额干扰）
    const sess = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 },
      budget: { maxTotalCost: 10, perCallEstimate: 0.01, maxCallsPerSession: 1 }, costLogPath });
    const s1 = await sess.complete(requestOf({ runId: 'sess-A', projectId: 'cust-A', attempt: 1 }));
    assert.equal(s1.status, 'simulated');
    const s2 = await sess.complete(requestOf({ runId: 'sess-A', projectId: 'cust-A', attempt: 2 }));
    assert.equal(s2.error.code, 'BUDGET_CALLS_SESSION_EXCEEDED');
    const s3 = await sess.complete(requestOf({ runId: 'sess-B', projectId: 'cust-A', attempt: 1 }));
    assert.equal(s3.status, 'simulated', '其他会话作用域不受影响');
    // 客户级单独验证（独立账本，避免会话段的预占跨场景累计）
    const costLogPath2 = path.join(dir, 'ledger-customer.jsonl');
    const cust = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 },
      budget: { maxTotalCost: 10, perCallEstimate: 0.01, customerMax: 0.01 }, costLogPath: costLogPath2 });
    const c1 = await cust.complete(requestOf({ runId: 'run-X', projectId: 'cust-A', attempt: 1 }));
    assert.equal(c1.status, 'simulated');
    const c2 = await cust.complete(requestOf({ runId: 'run-Y', projectId: 'cust-A', attempt: 1 }));
    assert.equal(c2.error.code, 'BUDGET_CUSTOMER_EXCEEDED');
    const c3 = await cust.complete(requestOf({ runId: 'run-Z', projectId: 'cust-B', attempt: 1 }));
    assert.equal(c3.status, 'simulated', '其他客户作用域不受影响');
    assert.equal(stub.hits(), 4);
    const entries = await readLedger(costLogPath2);
    assert.equal(entries.filter((e) => e.type === 'reserve').length, 2, '客户级账本 reserve 与命中数一致');
  } finally { await stub.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('V04-BL-04 重启（新实例同账本）不绕过预算：阻断且零出站', async () => {
  const stub = await startTransportStub();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-bl04-'));
  const costLogPath = path.join(dir, 'ledger.jsonl');
  try {
    const opts = { mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 },
      budget: { maxTotalCost: 10, perCallEstimate: 0.01, maxCalls: 1 }, costLogPath };
    const first = createModelTransport(opts);
    await first.complete(requestOf({ attempt: 1 }));
    assert.equal(stub.hits(), 1);
    const restarted = createModelTransport(opts); // 模拟进程重启后重建 transport
    const blocked = await restarted.complete(requestOf({ attempt: 2 }));
    assert.equal(blocked.status, 'failed');
    assert.equal(blocked.error.code, 'BUDGET_CALLS_EXCEEDED');
    assert.equal(stub.hits(), 1, '重启不产生新出站');
  } finally { await stub.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('V04-BL-05 账本损坏行→失败关闭（BUDGET_LEDGER_CORRUPT），零出站；原文件不被改写', async () => {
  const stub = await startTransportStub();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-bl05-'));
  const costLogPath = path.join(dir, 'ledger.jsonl');
  try {
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 },
      budget: { maxTotalCost: 10, perCallEstimate: 0.01 }, costLogPath });
    const raw = '{"type":"reserve","amount":"not-a-number"}\n';
    await fs.writeFile(costLogPath, raw);
    const r = await t.complete(requestOf());
    assert.equal(r.status, 'failed');
    assert.equal(r.sentFlag, false);
    assert.equal(r.error.code, 'BUDGET_LEDGER_CORRUPT');
    assert.equal(stub.hits(), 0);
    assert.equal(await fs.readFile(costLogPath, 'utf8'), raw, '失败关闭不篡改账本');
  } finally { await stub.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('V04-BL-06 预算配置不完整→构造即抛错失败关闭；unlimitedTotalCost 合法形态可用', async () => {
  const stub = await startTransportStub();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-bl06-'));
  const costLogPath = path.join(dir, 'ledger.jsonl');
  try {
    assert.throws(() => createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url }, budget: { maxTotalCost: 10 } }),
      /perCallEstimate/);
    const t = createModelTransport({ mode: 'mock', mock: { baseUrl: stub.url, timeoutMs: 2000 },
      budget: { unlimitedTotalCost: true, perCallEstimate: 0.01 }, costLogPath });
    const r = await t.complete(requestOf());
    assert.equal(r.status, 'simulated');
    assert.equal(stub.hits(), 1);
  } finally { await stub.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
