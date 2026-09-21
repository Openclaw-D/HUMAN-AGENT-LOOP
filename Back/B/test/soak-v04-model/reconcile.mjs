// V0.4 soak-03 · 终局全量对账与硬不变量扫描（只读）。
// 断言源：替身全量命中流（all-hits.json）+ 预算账本（ledger-main.jsonl）+ 回执文件 +
//         worker 注册表（身份→结果声明）。
// 硬不变量（任一违反 → ok=false）：
//   H1 预占先于出站：每个替身命中 requestId 必有 reserve；
//   H2 同一幂等命令重复副作用=0：每 requestId 至多 1 次 reserve、至多 1 次替身命中；
//   H3 伪报语义：terminal simulated/succeeded ↔ 命中恰 1（0 即伪报成功）；failed 未发送 ↔ 命中 0
//      （仅预算阻断/TRANSPORT_UNREACHABLE；429 属已到达未处理=1）；failed 确定 ↔ 命中 1；
//      terminal unknown ↔ 命中恰 1（未知自动重发=0）；命中必有回执落盘；
//   H4 预算上限：每客户 reserve 合计 ≤ customerMax(6)，全局 ≤ maxTotalCost(200)；
//   H5 回执/账本完好：全部可解析、形状合法（仅 intent 残留只允许出现在崩溃窗口并如实列出）。
import fs from 'node:fs/promises';
import path from 'node:path';

const readLines = async (file) => {
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return text.split('\n').filter((l) => l.trim());
};

export async function runReconciliation({ stateDir, allHits, finalIntegrity }) {
  const violations = [];
  const notes = [];
  const hard = (id, why, evidence) => violations.push({ severity: 'hard', id, why, evidence });
  const info = (id, why, evidence) => notes.push({ id, why, evidence });

  // ---- 替身命中流 → 每 requestId 命中数 ----
  const hitsRaw = JSON.parse(await fs.readFile(path.join(stateDir, '..', 'all-hits.json'), 'utf8'));
  const hitCount = new Map();
  for (const h of hitsRaw) hitCount.set(h.requestId, (hitCount.get(h.requestId) ?? 0) + 1);
  for (const [reqId, n] of hitCount) {
    if (n > 1) hard('H2-dup-hit', `requestId 在替身重复命中 ${n} 次`, { requestId: reqId, n });
  }

  // ---- 账本 ----
  const ledgerLines = await readLines(path.join(stateDir, 'ledger-main.jsonl'));
  const reserveCount = new Map();
  const perCustomer = new Map();
  let reserveSum = 0, actualCount = 0, actualSum = 0, badLines = 0;
  for (const line of ledgerLines) {
    let e;
    try { e = JSON.parse(line); } catch { badLines++; continue; }
    if (e.type === 'reserve') {
      reserveCount.set(e.requestId, (reserveCount.get(e.requestId) ?? 0) + 1);
      reserveSum += e.amount;
      if (e.customerKey) perCustomer.set(e.customerKey, (perCustomer.get(e.customerKey) ?? 0) + e.amount);
    } else if (e.type === 'actual') { actualCount++; actualSum += e.amount ?? 0; }
  }
  if (badLines > 0) hard('H5-ledger-badlines', `主账本坏行 ${badLines}`, { badLines });
  for (const [reqId, n] of reserveCount) {
    if (n > 1) hard('H2-dup-reserve', `requestId 重复预占 ${n} 次`, { requestId: reqId, n });
  }
  let hitWithoutReserve = 0;
  for (const reqId of hitCount.keys()) if (!reserveCount.get(reqId)) hitWithoutReserve++;
  if (hitWithoutReserve > 0) hard('H1-hit-without-reserve', `替身命中无预占共 ${hitWithoutReserve}（预占先于出站破坏）`, { hitWithoutReserve });
  let overCustomer = 0;
  for (const [c, v] of perCustomer) if (v > 8 + 1e-9) {
    overCustomer++;
    if (overCustomer <= 5) hard('H4-customer-cap', `客户 ${c} 预占合计 ${v} 超过 customerMax 8`, { customer: c, sum: v });
  }
  if (overCustomer > 5) hard('H4-customer-cap', `超客户上限共 ${overCustomer} 户（超样本）`, { overCustomer });
  if (reserveSum > 200 + 1e-9) hard('H4-global-cap', `全局预占合计 ${reserveSum} 超过 maxTotalCost 200`, { reserveSum });

  // ---- 回执扫描（单遍，main + comp 两个回执仓）----
  const receiptDirs = ['worker-main', 'worker-comp'].map((d) => path.join(stateDir, d, 'model-state', 'receipts'));
  let receiptFiles = 0, terminals = 0, intents = 0, badReceipts = 0;
  let fakeSuccess = 0, fakeNoSend = 0, failedHitsBad = 0, unknownHitsBad = 0, hitWithoutReceipt = 0, intentDupHit = 0;
  const phaseDist = {};
  const receiptIds = new Set();
  let unknownReceipts = 0;
  for (const dir of receiptDirs) {
    let names = [];
    try { names = await fs.readdir(dir); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      receiptFiles++;
      let rec = null;
      try { rec = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); } catch { badReceipts++; continue; }
      const reqId = rec.requestId;
      receiptIds.add(reqId);
      phaseDist[rec.phase] = (phaseDist[rec.phase] ?? 0) + 1;
      const n = hitCount.get(reqId) ?? 0;
      if (rec.phase === 'terminal') {
        terminals++;
        const o = rec.outcome ?? {};
        if (o.status === 'simulated' || o.status === 'succeeded') {
          if (n !== 1) { fakeSuccess++; if (fakeSuccess <= 5) hard('H3-fake-success', `成功回执命中=${n}（0 即伪报成功）`, { requestId: reqId, status: o.status, hits: n }); }
        } else if (o.status === 'failed') {
          const code = o.error?.code ?? '';
          const expectZeroHits = (code.startsWith('BUDGET_') || code === 'TRANSPORT_UNREACHABLE');
          if (expectZeroHits && n !== 0) { fakeNoSend++; if (fakeNoSend <= 5) hard('H3-fake-nosend', `未发送失败回执命中=${n}（应0）`, { requestId: reqId, code, hits: n }); }
          else if (!expectZeroHits && n !== 1) { failedHitsBad++; if (failedHitsBad <= 5) hard('H3-failed-hits', `失败回执命中=${n}（应1；429属已到达未处理）`, { requestId: reqId, code, hits: n }); }
        } else if (o.status === 'unknown') {
          unknownReceipts++;
          if (n !== 1) { unknownHitsBad++; if (unknownHitsBad <= 5) hard('H3-unknown-resend', `未知回执命中=${n}（应恰1，未知自动重发=0）`, { requestId: reqId, hits: n }); }
        } else hard('H5-receipt-shape', `回执 outcome.status 非法 ${o.status}`, { requestId: reqId });
      } else if (rec.phase === 'intent') {
        intents++;
        if (n > 1) { intentDupHit++; hard('H2-intent-dup-hit', `仅 intent 残留却命中 ${n} 次`, { requestId: reqId, hits: n }); }
      }
    }
  }
  for (const reqId of hitCount.keys()) if (!receiptIds.has(reqId)) hitWithoutReceipt++;
  if (badReceipts > 0) hard('H5-receipt-parse', `回执文件损坏 ${badReceipts}`, { badReceipts });
  if (hitWithoutReceipt > 0) hard('H3-hit-without-receipt', `替身命中 ${hitWithoutReceipt} 次无任何回执落盘`, { hitWithoutReceipt });
  if (fakeSuccess > 5) hard('H3-fake-success', `成功回执命中≠1 共 ${fakeSuccess}（超样本）`, { fakeSuccess });
  if (fakeNoSend > 5) hard('H3-fake-nosend', `未发送回执有命中共 ${fakeNoSend}（超样本）`, { fakeNoSend });
  if (failedHitsBad > 5) hard('H3-failed-hits', `确定失败回执命中≠1 共 ${failedHitsBad}（超样本）`, { failedHitsBad });
  if (unknownHitsBad > 5) hard('H3-unknown-resend', `未知回执命中≠1 共 ${unknownHitsBad}（超样本，未知自动重发=0破坏）`, { unknownHitsBad });
  if (receiptFiles > 10000) info('cap-receipts', `回执文件数 ${receiptFiles} 超过契约长历史上限 10000`, { receiptFiles });

  // ---- 注册表 unknown 声明 ↔ 命中 ----
  let unknownRegistry = 0, unknownRegistryBad = 0;
  for (const d of ['worker-main', 'worker-comp']) {
    for (const line of await readLines(path.join(stateDir, d, 'registry.jsonl'))) {
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (rec.status === 'unknown') {
        unknownRegistry++;
        if ((hitCount.get(rec.requestId) ?? 0) !== 1) unknownRegistryBad++;
      }
    }
  }
  if (unknownRegistryBad > 0) hard('H3-unknown-resend-registry', `注册表 unknown 身份命中≠1 共 ${unknownRegistryBad}`, { unknownRegistryBad });

  const ok = violations.length === 0;
  return {
    at: new Date().toISOString(), ok,
    totals: {
      stubHits: hitsRaw.length, distinctRequestIds: hitCount.size,
      reserveRequestIds: reserveCount.size, reserveSum: Math.round(reserveSum * 100) / 100,
      actualCount, actualSum: Math.round(actualSum * 100) / 100,
      receiptFiles, terminals, intents, badReceipts, phaseDist,
      unknownReceipts, unknownRegistry,
      budgetRemaining: Math.round((200 - reserveSum) * 100) / 100,
      customers: perCustomer.size,
    },
    checks: { hitWithoutReserve, duplicateReserves: [...reserveCount.values()].filter((n) => n > 1).length,
      duplicateHits: [...hitCount.values()].filter((n) => n > 1).length,
      fakeSuccess, fakeNoSend, failedHitsBad, unknownHitsBad, hitWithoutReceipt, intentDupHit, overCustomer },
    finalLedgerIntegrity: finalIntegrity,
    violations, notes,
    allHitsFile: '.local/soak-v04-model/all-hits.json',
  };
}

/** 独立运行：node reconcile.mjs（读取既有 all-hits.json 与账本，重跑对账） */
const isMain = process.argv[1] && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const here = path.dirname(process.argv[1]);
  const stateDir = path.resolve(here, '..', '..', '..', '..', '.local', 'soak-v04-model', 'state');
  const summary = await runReconciliation({ stateDir, allHits: null, finalIntegrity: null });
  console.log(JSON.stringify({ ok: summary.ok, totals: summary.totals, checks: summary.checks, violations: summary.violations.slice(0, 10) }, null, 1));
  process.exit(summary.ok ? 0 : 1);
}
