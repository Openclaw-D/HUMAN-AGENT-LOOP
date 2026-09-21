// V0.4 soak-03 · 终局补收（post-mortem）。
// 场景：run 进程被提前终止（用户指示快速收尾），替身命中流（内存 allHits）随进程丢失。
// 可用断言源：stub-counters.json（终止前 ≤5s 刷新的替身总计，含 duplicateRequestIds 权威计数）、
//   ledger-main.jsonl（完整账本）、回执目录（完整）、registry.jsonl（完整身份→结果声明）。
// 逐 requestId 命中 join 在终止窗口不可复原，以总计闭环 + 可验子集硬不变量替代，并如实标注。
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..', '..', '..');
const RUN_DIR = path.join(ROOT, '.local', 'soak-v04-model');
const STATE = path.join(RUN_DIR, 'state');
const OUT = path.join(ROOT, 'docs', 'v0.4', 'soak', 'results', '03-model');
const CUSTOMER_MAX = 8, GLOBAL_MAX = 200;

const readLines = async (f) => {
  try { return (await fs.readFile(f, 'utf8')).split('\n').filter((l) => l.trim()); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
};

const counters = JSON.parse(await fs.readFile(path.join(STATE, 'stub-counters.json'), 'utf8'));
const phaseState = JSON.parse(await fs.readFile(path.join(STATE, 'soak-state.json'), 'utf8'));
const p1 = JSON.parse(await fs.readFile(path.join(STATE, 'worker-main', 'phase-result-P1-baseline-c1.json'), 'utf8'));

// 账本
const reserveCount = new Map(); const perCustomer = new Map();
let reserveSum = 0, actualCount = 0, actualSum = 0, badLines = 0;
for (const line of await readLines(path.join(STATE, 'ledger-main.jsonl'))) {
  let e; try { e = JSON.parse(line); } catch { badLines++; continue; }
  if (e.type === 'reserve') {
    reserveCount.set(e.requestId, (reserveCount.get(e.requestId) ?? 0) + 1);
    reserveSum += e.amount;
    if (e.customerKey) perCustomer.set(e.customerKey, (perCustomer.get(e.customerKey) ?? 0) + e.amount);
  } else if (e.type === 'actual') { actualCount++; actualSum += e.amount ?? 0; }
}

// 注册表
const reg = [];
for (const line of await readLines(path.join(STATE, 'worker-main', 'registry.jsonl'))) {
  try { reg.push(JSON.parse(line)); } catch { }
}
const notSentFamily = (c) => (c ?? '').startsWith('BUDGET_') || c === 'TRANSPORT_UNREACHABLE';
const expectHit = reg.filter((r) => !notSentFamily(r.errorCode));
const expectNoHit = reg.filter((r) => notSentFamily(r.errorCode));

// 回执
let terminals = 0, intents = 0, badReceipts = 0, unknownTerminals = 0, fakeShapes = 0;
const phaseDist = {};
const receiptRequestIds = new Set();
const terminalIds = new Set();
const intentIds = [];
for (const d of ['worker-main', 'worker-comp']) {
  const dir = path.join(STATE, d, 'model-state', 'receipts');
  let names = []; try { names = await fs.readdir(dir); } catch { continue; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let rec; try { rec = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); } catch { badReceipts++; continue; }
    receiptRequestIds.add(rec.requestId);
    phaseDist[rec.phase] = (phaseDist[rec.phase] ?? 0) + 1;
    if (rec.phase === 'terminal') {
      terminals++;
      terminalIds.add(rec.requestId);
      if (rec.outcome?.status === 'unknown') unknownTerminals++;
      if (!['simulated', 'succeeded', 'failed', 'unknown'].includes(rec.outcome?.status)) fakeShapes++;
    } else if (rec.phase === 'intent') { intents++; intentIds.push(rec.requestId); }
  }
}
const intentOnlyIds = intentIds.filter((id) => !terminalIds.has(id));

// 硬不变量（可验子集）
const violations = [];
const hard = (id, why, evidence) => violations.push({ id, why, evidence });
if (counters.duplicateRequestIds > 0) hard('H2-dup-hit', `替身侧重复命中 requestId=${counters.duplicateRequestIds}`, counters.duplicateRequestIds);
for (const [id, n] of reserveCount) if (n > 1) hard('H2-dup-reserve', `重复预占 ${n}`, { requestId: id });
let overC = 0;
for (const [c, v] of perCustomer) if (v > CUSTOMER_MAX + 1e-9) { overC++; if (overC <= 5) hard('H4-customer-cap', `客户 ${c} 预占 ${v} > ${CUSTOMER_MAX}`, { customer: c, sum: v }); }
if (reserveSum > GLOBAL_MAX + 1e-9) hard('H4-global-cap', `全局预占 ${reserveSum} > ${GLOBAL_MAX}`, { reserveSum });
if (badLines > 0) hard('H5-ledger-badlines', `账本坏行 ${badLines}`, { badLines });
if (badReceipts > 0) hard('H5-receipt-parse', `回执损坏 ${badReceipts}`, { badReceipts });
if (fakeShapes > 0) hard('H5-receipt-shape', `回执状态非法 ${fakeShapes}`, { fakeShapes });
// H1/H3 总计闭环：命中总数 == 应命中注册表记录数 + 崩溃窗口仅 intent 数（在途）。
// 容差 30：stub-counters 5s 刷新 × 令牌桶 5/s，终止前最后 ≤5s 的命中可能未入快照（超出容差才判失败）。
const intentOnly = intentOnlyIds.length;
const expectHitTotal = expectHit.length + intentOnly;
const closureDelta = counters.hits - expectHitTotal;
if (Math.abs(closureDelta) > 30) hard('H1-total-closure', `替身命中 ${counters.hits} 与应命中 ${expectHitTotal} 偏差 ${closureDelta} 超出 5s 刷新窗容差`, { stubHits: counters.hits, expectHitRecords: expectHit.length, intentOnly });
// 每条应命中记录必有 reserve（逐 requestId）
let expectHitWithoutReserve = 0;
for (const r of expectHit) if (!reserveCount.get(r.requestId)) expectHitWithoutReserve++;
if (expectHitWithoutReserve > 0) hard('H1-hit-without-reserve', `应命中记录无预占 ${expectHitWithoutReserve}`, { expectHitWithoutReserve });
// 每条应命中记录必有回执落盘
let expectHitWithoutReceipt = 0;
for (const r of expectHit) if (!receiptRequestIds.has(r.requestId)) expectHitWithoutReceipt++;
if (expectHitWithoutReceipt > 0) hard('H3-hit-without-receipt', `应命中记录无回执 ${expectHitWithoutReceipt}`, { expectHitWithoutReceipt });
// 未知自动重发=0 的回执侧口径：unknown terminal 数 == 注册表 unknown 声明数（重启/重试不新增出站）
const regUnknown = reg.filter((r) => r.status === 'unknown').length;
if (regUnknown !== unknownTerminals) hard('H3-unknown-consistency', `注册表 unknown ${regUnknown} ≠ unknown 回执 ${unknownTerminals}`, { regUnknown, unknownTerminals });
if (actualCount > counters.hits) hard('H3-actual-bound', `actual ${actualCount} > 命中 ${counters.hits}`, { actualCount, hits: counters.hits });

const ok = violations.length === 0;
const summary = {
  at: new Date().toISOString(), ok, mode: 'post-mortem（进程提前终止后的补收对账）',
  totals: {
    stubHits: counters.hits, distinctStubRequestIds: counters.distinctRequestIds,
    duplicateStubRequestIds: counters.duplicateRequestIds, stubByForm: counters.byForm,
    stubRestarts: counters.restarts,
    registryRecords: reg.length, expectHitRecords: expectHit.length, expectNoHitRecords: expectNoHit.length,
    reserveRequestIds: reserveCount.size, reserveSum: Math.round(reserveSum * 100) / 100,
    actualCount, actualSum: Math.round(actualSum * 100) / 100,
    budgetRemaining: Math.round((GLOBAL_MAX - reserveSum) * 100) / 100, customers: perCustomer.size,
    receiptFiles: terminals + intents, terminals, intents, intentOnly, badReceipts, phaseDist,
    unknownTerminals, regUnknown, closureDelta,
  },
  limitations: [
    '替身逐 requestId 命中流随进程终止丢失（stub 内存态），H1/H3 以总计闭环+逐requestId可验子集替代；',
    '运行期内每分钟对账（含全量命中 join，worker.mjs reconcile()）至终止前均无 RECONCILE 违规；',
    'stub-counters 刷新间隔 5s，终止前最后 ≤5s 的命中可能未入快照（总计存在 ≤5s 窗口误差）。'],
  violations, checks: { overCustomerCaps: overC, badLines, badReceipts, fakeShapes, expectHitWithoutReserve, expectHitWithoutReceipt },
};
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'reconciliation.json'), JSON.stringify({ ...summary, p1Phase: { name: p1.phase, ops: p1.counters.ops, effectiveMs: p1.effectiveMs } }, null, 1));

// RESULTS.json（正式跑真实结果，覆盖冒烟产物）
const samples = await readLines(path.join(STATE, 'worker-main', 'samples.jsonl'));
const sampleObjs = samples.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const results = {
  task: 'V0.4 soak 03_MODEL 模型调用链/回执/预算效率长程测试',
  outcome: '提前收尾（用户指示）——有效长测时长未达任务书 4 小时目标，如实报告',
  startedAt: phaseState.startedAt, endedAt: summary.at,
  phases: [
    { name: 'P1-baseline-c1', complete: true, effectiveMs: p1.effectiveMs, ops: p1.counters.ops,
      unexpected: p1.counters.unexpected, violations: p1.counters.violationCount,
      latency: p1.counters.latencyByClass, overhead: p1.counters.overheadByForm, finalReconcile: p1.finalReconcile },
    { name: 'P2a-mixed-c2', complete: false, note: '运行约17.5分钟后按用户指示终止；期间0非预期错误、0违规',
      samples: sampleObjs.filter((s) => s.phase !== undefined).slice(-20) },
    { name: 'P2b/P2c/P3/P4', complete: false, note: '未执行（提前收尾）' },
  ],
  inputHashes: JSON.parse(await fs.readFile(path.join(RUN_DIR, 'results-raw', 'input-hashes.json'), 'utf8')),
  finalStub: summary.totals,
  reconciliation: summary,
  effectiveSoakMinutes: {
    p1Complete: Math.round(p1.effectiveMs / 60000),
    p2aPartial: Math.round((sampleObjs.length ? (new Date(sampleObjs[sampleObjs.length - 1].at) - new Date(phaseState.startedAt)) / 60000 - Math.round(p1.effectiveMs / 60000) : 0)),
    note: '任务书要求 ≥4 小时有效长测（10 小时硬上限）；本次按用户指示在 ~48 分钟有效时长处收尾，不冒充达标',
  },
};
await fs.writeFile(path.join(OUT, 'RESULTS.json'), JSON.stringify(results, null, 1));

const lines = [
  '# soak-03 终局对账（post-mortem 补收；机读见 reconciliation.json）', '',
  `- 对账时间：${summary.at}（进程按用户指示提前终止后补收）`,
  `- 替身总计：命中 ${summary.totals.stubHits}（去重 requestId ${summary.totals.distinctStubRequestIds}，重复 ${summary.totals.duplicateStubRequestIds}）；重启 ${summary.totals.stubRestarts} 次`,
  `- 注册表：${summary.totals.registryRecords} 条（应命中 ${summary.totals.expectHitRecords} / 应零命中 ${summary.totals.expectNoHitRecords}）`,
  `- 账本：预占 ${summary.totals.reserveRequestIds} 笔合计 ${summary.totals.reserveSum} / 上限 200；actual ${summary.totals.actualCount} 笔合计 ${summary.totals.actualSum}；余额 ${summary.totals.budgetRemaining}；客户数 ${summary.totals.customers}`,
  `- 回执：terminal ${summary.totals.terminals}（unknown ${summary.totals.unknownTerminals}）/ 仅 intent ${summary.totals.intents} / 损坏 ${summary.totals.badReceipts}`,
  `- 硬不变量（可验子集）：${ok ? '全部成立（0 违反）' : `违反 ${violations.length} 条`}`,
  ...violations.map((v) => `  - [${v.id}] ${v.why} ${JSON.stringify(v.evidence)}`),
  '', '## 局限（如实）', ...summary.limitations.map((l) => `- ${l}`),
  '', '（命中无回执/未知重发/伪报语义/重复预占任一非零即失败，不做通过率折算。）',
];
await fs.writeFile(path.join(OUT, 'RECONCILIATION.md'), lines.join('\n'));
console.log(JSON.stringify({ ok, totals: summary.totals, violations, p1: { ops: p1.counters.ops, effectiveMs: p1.effectiveMs } }, null, 1));
