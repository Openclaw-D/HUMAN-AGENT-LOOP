// V0.4 03-receipts · 历史用量对账（只读）。
// 对 docs/v0.3/real-api-qa 轮（zloop 隔离栈，2026-09-20T17:20Z 起）逐 requestId 串联三个来源：
//   ① run-log.jsonl（驱动器调用台账，42行，含2条CORRECTION与1条CORRECTION-FINAL注解）
//   ② Back/Edge/.run/zloop/model-cost-ledger.jsonl（B transport 成本账本，reserve/actual）
//   ③ Back/Edge/.run/zloop/model-receipts/receipts/（回执：intent/terminal + .claim）
// 全程只读历史文件，不写回任何原账本/回执；输出写到本目录 reconciliation.json / RECONCILIATION.md。
// 用法：node docs/v0.4/results/03-receipts/reconcile.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const RUNLOG = path.join(ROOT, 'docs/v0.3/real-api-qa/evidence/run-log.jsonl');
const LEDGER = path.join(ROOT, 'Back/Edge/.run/zloop/model-cost-ledger.jsonl');
const RECEIPTS = path.join(ROOT, 'Back/Edge/.run/zloop/model-receipts/receipts');
const OUT_JSON = path.join(import.meta.dirname, 'reconciliation.json');
const OUT_MD = path.join(import.meta.dirname, 'RECONCILIATION.md');

// zloop 轮窗口：首条出站 R01 reserve 起至 CORRECTION-FINAL 后。窗口前条目属更早轮次（takeoff/observe），不在本轮对账范围。
const WINDOW_START = '2026-09-20T17:19:00';
const WINDOW_END = '2026-09-20T18:05:00';
const inWindow = at => at >= WINDOW_START && at <= WINDOW_END;

const runlog = fs.readFileSync(RUNLOG, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const ledgerAll = fs.readFileSync(LEDGER, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const ledgerWin = ledgerAll.filter(e => inWindow(e.at));
const ledgerBefore = ledgerAll.length - ledgerWin.length;

// 回执目录快照：requestId（解码后）→ {phases, terminal?, intent?, claim, mtime}
const receipts = {};
for (const name of fs.readdirSync(RECEIPTS)) {
  if (name.endsWith('.claim')) {
    const id = decodeURIComponent(name.replace(/\.claim$/, ''));
    (receipts[id] ??= { phases: [] }).claim = true;
    continue;
  }
  if (!name.endsWith('.json')) continue;
  const id = decodeURIComponent(name.replace(/\.json$/, ''));
  const isIntent = id.endsWith(':intent');
  const rid = isIntent ? id.slice(0, -':intent'.length) : id;
  const rec = (receipts[rid] ??= { phases: [] });
  try {
    const value = JSON.parse(fs.readFileSync(path.join(RECEIPTS, name), 'utf8'));
    if (isIntent) { rec.intent = { at: value.at }; rec.phases.push('intent'); }
    else {
      rec.terminal = {
        at: value.at, status: value.outcome?.status ?? null, sentFlag: value.outcome?.sentFlag ?? null,
        usage: value.outcome?.usage ?? null, prompt: value.outcome?.usage?.prompt_tokens ?? null,
        completion: value.outcome?.usage?.completion_tokens ?? null, error: value.outcome?.error?.code ?? null,
        current: value.outcome?.current ?? null,
      };
      rec.phases.push('terminal');
    }
  } catch { (rec.phases.push('unparsable')); }
}

// 逐 run-log 行分类；outbound 判定=该行有 requestId 且 modelStatus 为 succeeded/failed（真实到过 transport），
// 注解行（CORRECTION* / R25b 注解）不计数，只作口径证据。
const rows = [];
const seenRequest = new Map(); // requestId → run-log 行号列表
for (const [i, e] of runlog.entries()) {
  const line = i + 1;
  let kind;
  if (e.caseId === 'CORRECTION' || e.caseId === 'CORRECTION-FINAL' || (e.caseId === 'R25b' && !e.requestId)) kind = 'annotation';
  else if (e.type === 'replay' && e.replayed === true) kind = 'replay-zero-outbound';
  else if (e.requestId) kind = 'outbound';
  else if (e.modelStatus === 'succeeded' && (e.caseId ?? '').endsWith('-replay')) kind = 'outbound-unattributed'; // driver bug：真实新出站但未记 requestId（CORRECTION 注解证实）
  else kind = 'gate-zero-outbound';
  if (e.requestId) (seenRequest.get(e.requestId) ?? seenRequest.set(e.requestId, []).get(e.requestId)).push(line);
  rows.push({ line, at: e.at, caseId: e.caseId, type: e.type, kind, note: e.note ?? null,
    requestId: e.requestId ?? null, httpStatus: e.httpStatus, modelStatus: e.modelStatus ?? null,
    replayed: e.replayed ?? null, usage: e.usage ? { prompt: e.usage.prompt_tokens, completion: e.usage.completion_tokens } : null });
}

// 逐 requestId 汇总（仅窗口内出现的 requestId）。
const ids = new Set([...seenRequest.keys(), ...Object.keys(receipts).filter(id => receipts[id].phases.some(p => p !== 'unparsable') || receipts[id].claim)]);
const perRequest = [];
for (const id of [...ids].sort()) {
  const rec = receipts[id] ?? {};
  const led = ledgerWin.filter(e => e.requestId === id);
  const reserves = led.filter(e => e.type === 'reserve');
  const actuals = led.filter(e => e.type === 'actual');
  const rl = rows.filter(r => r.requestId === id);
  if (!rec.phases.length && !led.length && !rl.length) continue;
  perRequest.push({
    requestId: id,
    runlogCases: [...new Set(rl.map(r => r.caseId))], runlogLines: rl.map(r => r.line),
    receipt: { terminal: !!rec.terminal, intent: !!rec.intent, claim: !!rec.claim,
      status: rec.terminal?.status ?? null, sentFlag: rec.terminal?.sentFlag ?? null,
      usageInReceipt: rec.terminal?.usage ? { prompt: rec.terminal.prompt, completion: rec.terminal.completion } : null,
      error: rec.terminal?.error ?? null },
    ledger: { reserves: reserves.length, actuals: actuals.length,
      reserveAmount: +reserves.reduce((a, e) => a + e.amount, 0).toFixed(4),
      actualAmount: +actuals.reduce((a, e) => a + e.amount, 0).toFixed(4),
      actualBillKnown: actuals.map(e => e.billKnown ?? null) },
    usageRunlog: rl.find(r => r.usage)?.usage ?? null,
  });
}

// 账本窗口内孤儿条目（无回执且无 run-log 引用）。
const orphanLedger = ledgerWin.filter(e => !ids.has(e.requestId)).map(e => ({ type: e.type, requestId: e.requestId, at: e.at }));

// 汇总口径。
const outboundRows = rows.filter(r => r.kind === 'outbound');
const distinctOutbound = new Set(outboundRows.map(r => r.requestId));
const usageRunlogLines = rows.filter(r => r.usage);
const distinctUsage = new Set(usageRunlogLines.filter(r => r.requestId).map(r => r.requestId));
const sum = arr => arr.reduce((a, b) => a + b, 0);
const usageDistinct = [...distinctUsage].map(id => {
  const line = usageRunlogLines.find(r => r.requestId === id && r.usage);
  return { prompt: line.usage.prompt, completion: line.usage.completion };
});
// 注解重复行：R25b 注解（caseId=R25b，type undefined）与 17:58:31 R25 行同 request 口径（usage 相同），系同一调用的注解复写。
const annotationUsageDup = usageRunlogLines.filter(r => !r.requestId);
const totals = {
  runlogLines: runlog.length,
  outboundRunlogLines: outboundRows.length,
  distinctOutboundRequestIds: distinctOutbound.size,
  authoritativeOutbound: 28, // CORRECTION-FINAL：25案例调用(含首次R25截断)+R05-replay+R28-replay+R25b复验
  usageRunlogLines: usageRunlogLines.length,
  distinctUsageRequestIds: distinctUsage.size,
  usageSumDistinct: { prompt: sum(usageDistinct.map(u => u.prompt)), completion: sum(usageDistinct.map(u => u.completion)) },
  usageSumAllLines: { prompt: sum(usageRunlogLines.map(r => r.usage.prompt)), completion: sum(usageRunlogLines.map(r => r.usage.completion)) },
  annotationUsageDupLines: annotationUsageDup.map(r => ({ line: r.line, caseId: r.caseId })),
  ledgerWindow: { total: ledgerWin.length, reserves: ledgerWin.filter(e => e.type === 'reserve').length,
    actuals: ledgerWin.filter(e => e.type === 'actual').length, beforeWindow: ledgerBefore,
    reserveAmount: +ledgerWin.filter(e => e.type === 'reserve').reduce((a, e) => a + e.amount, 0).toFixed(2),
    reserveAmounts: [...new Set(ledgerWin.filter(e => e.type === 'reserve').map(e => e.amount))] },
  zeroOutboundGates: rows.filter(r => r.kind === 'gate-zero-outbound').map(r => `${r.caseId}(L${r.line},http=${r.httpStatus})`),
  outboundUnattributed: rows.filter(r => r.kind === 'outbound-unattributed').map(r => `${r.caseId}(L${r.line},at=${r.at})`),
  replayZeroOutbound: rows.filter(r => r.kind === 'replay-zero-outbound').map(r => `${r.caseId}(L${r.line})`),
  orphanLedgerEntries: orphanLedger,
};

// 回执侧与出站侧交叉：窗口内出站的 requestId 是否都有 terminal 回执。
const missingTerminal = [...distinctOutbound].filter(id => !receipts[id]?.terminal);
const receiptsWithoutRunlog = Object.keys(receipts).filter(id => !seenRequest.has(id) && receipts[id].terminal);
// 两次意外出站在回执里是否有 usage（driver 未记 ≠ 回执未记）。
const accidental = ['R05-replay', 'R28-replay'].map(cs => rows.find(r => r.caseId === cs)).filter(Boolean);
const accidentalReceiptUsage = accidental.map(r => ({
  caseId: r.caseId, at: r.at, runlogHasUsage: !!r.usage,
  receiptUsage: (() => {
    // run-log 行未记 requestId（driver bug）；按时间窗在回执目录中找 17:45–17:47 间落 terminal 的回执。
    const hit = Object.entries(receipts).filter(([id, rec]) => rec.terminal && rec.terminal.at >= '2026-09-20T17:45:00' && rec.terminal.at <= '2026-09-20T17:47:30');
    return hit.map(([id, rec]) => ({ requestId: id, at: rec.terminal.at, prompt: rec.terminal.prompt, completion: rec.terminal.completion }));
  })(),
}));

const result = { generatedAt: new Date().toISOString(), window: [WINDOW_START, WINDOW_END],
  sources: { runlog: RUNLOG, ledger: LEDGER, receiptsDir: RECEIPTS,
    receiptsFiles: fs.readdirSync(RECEIPTS).length },
  totals, perRequest, accidentalReceiptUsage,
  crossChecks: { outboundRequestIdsMissingTerminalReceipt: missingTerminal, terminalReceiptsWithoutRunlogLine: receiptsWithoutRunlog } };
fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));

// Markdown 摘要
const md = [];
md.push('# 历史用量对账 · real-api-qa 轮（zloop，2026-09-20 17:20–18:00Z）');
md.push('');
md.push(`来源：run-log ${runlog.length} 行；成本账本 ${ledgerAll.length} 条（窗口内 ${ledgerWin.length}，窗口外更早轮次 ${ledgerBefore} 条不动）；回执目录 ${fs.readdirSync(RECEIPTS).length} 个文件。全部只读。`);
md.push('');
md.push('## 口径结论');
md.push('');
md.push(`- 出站尝试（权威口径，CORRECTION-FINAL L41）：**28** = 25 条案例调用（含首次R25截断）+ R05-replay 误出站 + R28-replay 误出站 + R25b 复验。run-log 带真实 requestId 的出站行 ${outboundRows.length} 行、去重 requestId ${distinctOutbound.size} 个（R28 两行、R25 首次/复验两行为不同调用）。`);
md.push(`- usage 留证：run-log 带 usage 的行 **${usageRunlogLines.length} 行**，其中 1 行（L${annotationUsageDup[0]?.line} R25b 注解）与 L34（17:58:31 R25 复验）为**同一调用的注解复写**（CORRECTION-FINAL 已言明注解重复计数）。REPORT §3“27次 usage 入97,358/出35,340”即 27 行直和，**含这次重复**；去重后逐条留证 = **${distinctUsage.size} 次不同调用，入 ${totals.usageSumDistinct.prompt} / 出 ${totals.usageSumDistinct.completion} tokens**（差值 3094/1578 恰为 R25b 那一次）。`);
md.push(`- 28 出站 = ${distinctUsage.size} 次有逐条 usage + 2 次意外出站（R05-replay/R28-replay，driver 当时未记 usage）。`);
md.push(`- 成本账本（窗口内）：reserve **${totals.ledgerWindow.reserves}** 条 / actual **${totals.ledgerWindow.actuals}** 条，预占合计 ${totals.ledgerWindow.reserveAmount} 元；孤儿账本条目 ${orphanLedger.length} 条。`);
md.push(`- 零出站门（如实计入口径、无出站）：${totals.zeroOutboundGates.join('、')}；零出站重放：${totals.replayZeroOutbound.join('、')}。`);
md.push('');
md.push('## 逐 requestId 对账表');
md.push('');
md.push('| requestId（前缀） | 案例 | 回执 terminal/intent/claim | 回执status/sent | usage(run-log) | usage(回执) | 账本 r/a | actual billKnown |');
md.push('|---|---|---|---|---|---|---|---|');
for (const r of perRequest) {
  md.push(`| \`${r.requestId.slice(0, 58)}${r.requestId.length > 58 ? '…' : ''}\` | ${r.runlogCases.join(',') || '（无run-log行）'} | ${r.receipt.terminal ? 'T' : '-'}/${r.receipt.intent ? 'I' : '-'}/${r.receipt.claim ? 'C' : '-'} | ${r.receipt.status ?? '-'}/${r.receipt.sentFlag ?? '-'} | ${r.usageRunlog ? `${r.usageRunlog.prompt}/${r.usageRunlog.completion}` : '-'} | ${r.receipt.usageInReceipt ? `${r.receipt.usageInReceipt.prompt}/${r.receipt.usageInReceipt.completion}` : '-'} | ${r.ledger.reserves}/${r.ledger.actuals} | ${r.ledger.actualBillKnown.join(',')} |`);
}
md.push('');
md.push('## 证据缺口（来源与缺失分开）');
md.push('');
md.push(`- 出站 requestId 无 terminal 回执：${missingTerminal.length ? missingTerminal.join(', ') : '无'}。`);
md.push(`- 有 terminal 回执但 run-log 无对应行（更早轮次残留，不动）：${receiptsWithoutRunlog.length} 个（见 reconciliation.json）。`);
md.push('- 两次意外出站 driver 层未记 usage；回执目录 17:45–17:47Z 窗口的 terminal 回执 usage 见 reconciliation.json `accidentalReceiptUsage`（回执在，driver 台账缺，属证据源差异，费用已含在账本预占内，不据此猜测拆分）。');
md.push('- 供应商账单口径未知（以智谱控制台为准）；本表不做费用猜测。');
fs.writeFileSync(OUT_MD, md.join('\n'));
console.log('OK 写出', OUT_JSON, OUT_MD);
console.log(JSON.stringify(totals, null, 2));
