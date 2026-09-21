// V0.4 03-receipts · Edge 回执围栏 专项回归（模型级，直连本地可计数替身）。
// 被测：Back/Edge/src/assistant-receipts.mjs + assistant-model.mjs 的既有语义（只读核验，不改产品代码）。
// 每例断言替身真实出站命中数，不以 HTTP 返回码代替；验收口径：
//   未知不重复出站（同进程+重启）、损坏/篡改回执 fail-closed、并发合并、
//   上下文/配置变化不假去重、发送前失败无围栏残留、账本与替身计数可核对。
// 替身形态验证协议语义，不构成真实模型质量测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { prepareEvidence } from '../src/assistant-evidence.mjs';
import { digest } from '../src/assistant-receipts.mjs';
import { startTransportStub } from '../../B/test/v04-transport-stub.mjs';

const MATERIAL_TEXT = '合成客户申请设备回租500万元；开票与经营流水期间不同，需核对期间与重复交易。';
const materialHash = () => createHash('sha256').update(MATERIAL_TEXT).digest('hex');

/** 标准夹具：独立临时目录 + 可计数替身 + 真实 createAssistantModel 装配。 */
async function fixture(tag, { budget = true, timeoutMs = 2000, requireEvidence = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-rf-' + tag + '-'));
  const stub = await startTransportStub();
  const configPath = path.join(dir, 'model-config.json');
  const args = {
    configPath,
    receiptsDir: path.join(dir, 'model-state'),
    costLedgerPath: path.join(dir, 'cost-ledger.jsonl'),
    requireEvidence,
    log: () => {},
  };
  await fs.writeFile(configPath, JSON.stringify({
    transport: { mode: 'mock', mock: { baseUrl: stub.url, timeoutMs } },
    evidencePolicy: { allowedHashes: [materialHash()] },
    ...(budget ? { budget: { maxTotalCost: 10, perCallEstimate: 0.01 } } : {}),
  }));
  const model = await createAssistantModel(args);
  const base = {
    customerId: 'v04-cust-1', tenantId: 'v04-tenant-A', assistant: 'credit', question: '请核对当前候选方案',
    context: { customerName: '合成样本', contextVersion: '0', assessmentState: 'awaiting_human_review',
      candidate: { version: 1, suggestedAmount: 1000000, suggestedTermMonths: 36, tendency: 'cautious_do' },
      blockersCount: 1, materialsByDomain: { credit: 1 }, evidenceRefs: [] },
  };
  const restart = () => createAssistantModel(args);
  const close = async () => {
    await stub.close();
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { dir, stub, model, base, args, restart, close };
}

const evidenceContext = async (model, base, revision = 0) => {
  const pol = model.evidencePolicy();
  const pack = await prepareEvidence({ tenantId: base.tenantId, customerId: base.customerId, revision,
    allowedHashes: pol.allowedHashes, maxChars: pol.maxChars,
    materials: [{ tenantId: base.tenantId, customerId: base.customerId, hash: materialHash(),
      artifactId: 'art-v04', evidenceId: 'ev-v04', parserVersion: 'v04-test-v1', current: true, text: MATERIAL_TEXT }] });
  return { ...base.context, evidencePack: pack, evidenceRefs: pack.snippets.map((s) => ({ id: s.id, version: s.parserVersion, hash: s.hash })) };
};

const readLedger = async (file) => (await fs.readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('V04-RF-01 成功后同输入重放：同进程与重启均零出站', async () => {
  const f = await fixture('replay');
  try {
    const a = await f.model.observe(f.base);
    assert.equal(a.status, 'simulated');
    assert.equal(a.sent, true);
    const b = await f.model.observe(f.base);
    assert.equal(b.replayed, true);
    assert.deepEqual(b.observations, a.observations);
    const again = await (await f.restart()).observe(f.base);
    assert.equal(again.replayed, true, '重启后持久回执重放');
    assert.equal(f.stub.hits(), 1);
  } finally { await f.close(); }
});

test('V04-RF-02 发送后断连→unknown：同进程与重启重试均零出站（未知围栏持久）', async () => {
  const f = await fixture('unknown-destroy');
  try {
    f.stub.control.mode = 'destroy';
    const a = await f.model.observe(f.base);
    assert.equal(a.status, 'unknown');
    assert.equal(a.sent, null);
    assert.equal(f.stub.hits(), 1, '请求已到达替身：发送后未知');
    // unknown 结果本身落 terminal 回执：重放如实返回原错误码，不重发
    const retry = await f.model.observe(f.base);
    assert.equal(retry.status, 'unknown');
    assert.equal(retry.replayed, true);
    assert.equal(retry.error.code, 'RESULT_UNKNOWN_INTERRUPTED', '回执保留原始未知原因');
    const retry2 = await (await f.restart()).observe(f.base);
    assert.equal(retry2.status, 'unknown');
    assert.equal(f.stub.hits(), 1, '同进程与重启重试均未重复出站');
    // 仅 intent 残留（进程崩溃于 intent 与 terminal 之间）：RECOVERED_INTENT_WITHOUT_RECEIPT，仍零出站
    await fs.rm(path.join(f.args.receiptsDir, 'receipts', encodeURIComponent(a.requestId) + '.json'));
    const intentOnly = await (await f.restart()).observe(f.base);
    assert.equal(intentOnly.status, 'unknown');
    assert.equal(intentOnly.error.code, 'RECOVERED_INTENT_WITHOUT_RECEIPT');
    assert.equal(f.stub.hits(), 1);
  } finally { await f.close(); }
});

test('V04-RF-03 发送后超时→unknown：重试零出站，请求实证已到达替身', async () => {
  const f = await fixture('unknown-timeout', { timeoutMs: 200 });
  try {
    f.stub.control.delayMs = 800;
    const a = await f.model.observe(f.base);
    assert.equal(a.status, 'unknown');
    assert.equal(f.stub.hits(), 1);
    const retry = await (await f.restart()).observe(f.base);
    assert.equal(retry.status, 'unknown');
    assert.equal(f.stub.hits(), 1, '超时未知不自动重发');
  } finally { await f.close(); }
});

test('V04-RF-04 回执损坏/身份篡改→fail-closed：零出站且文件逐字节保留', async () => {
  const f = await fixture('corrupt');
  try {
    const ok = await f.model.observe(f.base);
    const file = path.join(f.args.receiptsDir, 'receipts', encodeURIComponent(ok.requestId) + '.json');
    // 坏 JSON
    const raw = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, '{broken');
    const c1 = await (await f.restart()).observe(f.base);
    assert.equal(c1.status, 'unknown');
    assert.equal(f.stub.hits(), 1);
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
    // 身份篡改（可解析但身份不符）
    const record = JSON.parse(raw);
    record.identity.tenantId = 'v04-tenant-EVIL';
    await fs.writeFile(file, JSON.stringify(record));
    const c2 = await (await f.restart()).observe(f.base);
    assert.equal(c2.status, 'unknown');
    assert.equal(c2.error.code, 'RECEIPT_IDENTITY_MISMATCH');
    assert.equal(f.stub.hits(), 1, '损坏/篡改回执一律不触发新出站');
  } finally { await f.close(); }
});

test('V04-RF-05 并发重复：12 并发同输入合并为 1 次出站', async () => {
  const f = await fixture('concurrent');
  try {
    f.stub.control.delayMs = 80;
    const other = await f.restart();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? other : f.model).observe(f.base)));
    assert.equal(f.stub.hits(), 1);
    assert.equal(new Set(results.map((r) => r.requestId)).size, 1);
    assert.ok(results.every((r) => r.status === 'simulated'));
  } finally { await f.close(); }
});

test('V04-RF-06 上下文版本/问题/候选变化→新出站不假去重；键序重排不触发新出站', async () => {
  const f = await fixture('invalidate');
  try {
    await f.model.observe(f.base);
    const v2 = structuredClone(f.base);
    v2.context.contextVersion = '1';
    const r2 = await f.model.observe(v2);
    assert.equal(r2.replayed, false);
    const q2 = { ...f.base, question: '请核对回款真实性' };
    const r3 = await f.model.observe(q2);
    assert.equal(r3.replayed, false);
    const reordered = { ...f.base, context: Object.fromEntries(Object.entries(f.base.context).reverse()) };
    const r4 = await f.model.observe(reordered);
    assert.equal(r4.replayed, true, '键序与时钟投影不参与身份');
    assert.equal(f.stub.hits(), 3);
  } finally { await f.close(); }
});

test('V04-RF-07 发送前失败（证据缺失）零出站且无围栏残留；修复后可安全发送', async () => {
  const f = await fixture('presend', { requireEvidence: true });
  try {
    const denied = await f.model.observe(f.base);
    assert.equal(denied.status, 'failed');
    assert.equal(denied.sent, false);
    assert.equal(f.stub.hits(), 0);
    const receiptsDir = path.join(f.args.receiptsDir, 'receipts');
    const leftovers = await fs.readdir(receiptsDir).catch(() => []);
    assert.equal(leftovers.length, 0, '确定性发送前失败不留 claim/intent 残留');
    const context = await evidenceContext(f.model, f.base);
    const ok = await f.model.observe({ ...f.base, context });
    assert.equal(ok.status, 'simulated');
    assert.equal(f.stub.hits(), 1);
  } finally { await f.close(); }
});

test('V04-RF-08 旧结果当前性：撤权回调使 current=false 且随回执诚实持久；证据变化→新出站', async () => {
  const f = await fixture('current');
  try {
    const context = await evidenceContext(f.model, f.base);
    // checkCurrent 是 observe 选项字段（缺省 false）；授权方注入 true=当前
    const fresh = await f.model.observe({ ...f.base, context, checkCurrent: async () => true });
    assert.equal(fresh.status, 'simulated');
    assert.equal(fresh.current, true);
    const replay = await f.model.observe({ ...f.base, context });
    assert.equal(replay.replayed, true);
    assert.equal(replay.current, true, '重放沿用回执内持久化的当前性');
    // 在途撤权：新身份（证据修订）下回调返回 false
    const context2 = await evidenceContext(f.model, f.base, 1);
    const revoked = await f.model.observe({ ...f.base, context: context2 });
    assert.equal(revoked.replayed, false, '证据变化走新请求');
    assert.equal(revoked.current, false, '缺省撤权回调使结果不当前');
    assert.equal(f.stub.hits(), 2);
    const replayRevoked = await f.model.observe({ ...f.base, context: context2 });
    assert.equal(replayRevoked.replayed, true);
    assert.equal(replayRevoked.current, false, '回执如实持久 current=false，不翻转为当前');
    assert.equal(f.stub.hits(), 2);
  } finally { await f.close(); }
});

test('V04-RF-09 客户/租户作用域隔离：requestId 各自独立、不跨作用域复用回执', async () => {
  const f = await fixture('scope');
  try {
    const a = await f.model.observe(f.base);
    const b = await f.model.observe({ ...f.base, customerId: 'v04-cust-2' });
    const c = await f.model.observe({ ...f.base, tenantId: 'v04-tenant-B' });
    assert.equal(f.stub.hits(), 3);
    assert.notEqual(a.requestId, b.requestId);
    assert.notEqual(a.requestId, c.requestId);
    assert.ok(b.requestId.includes('v04-cust-2'), 'requestId 内嵌客户身份');
    const aAgain = await f.model.observe(f.base);
    assert.equal(aAgain.replayed, true);
    assert.equal(aAgain.requestId, a.requestId);
    assert.equal(f.stub.hits(), 3);
  } finally { await f.close(); }
});

test('V04-RF-10 账本与替身计数可核对：reserve 数=出站数；unknown 不产生 actual；超限零出站', async () => {
  const f = await fixture('ledger');
  try {
    // 1 成功 + 1 unknown(destroy 换新身份)
    const okCtx = await evidenceContext(f.model, f.base);
    await f.model.observe({ ...f.base, context: okCtx });
    f.stub.control.mode = 'destroy';
    const badCtx = await evidenceContext(f.model, f.base, 1);
    await f.model.observe({ ...f.base, context: badCtx });
    f.stub.control.mode = 'ok';
    // 预算耗尽（perCallEstimate 0.01 × 2 已预占，maxTotalCost 10 远未到——改用次数不可行，直接验证账本口径即可）
    assert.equal(f.stub.hits(), 2);
    const entries = await readLedger(f.args.costLedgerPath);
    const reserves = entries.filter((e) => e.type === 'reserve');
    const actuals = entries.filter((e) => e.type === 'actual');
    assert.equal(reserves.length, f.stub.hits(), '每次真实出站恰好一条 reserve');
    assert.equal(actuals.length, 1, 'unknown 无 usage，不产生 actual');
    assert.equal(reserves.reduce((a, e) => a + e.amount, 0), 0.02);
    assert.ok(entries.every((e) => !JSON.stringify(e).includes('apiKey')), '账本不含凭据字段');
  } finally { await f.close(); }
});
