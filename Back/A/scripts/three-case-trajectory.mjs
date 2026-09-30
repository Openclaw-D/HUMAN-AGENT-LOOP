// 三案例状态轨迹采集（确定性隔离栈；模拟的只是输入材料与外部事件，规则/状态机/权限/持久化全走真实后端）。
// 输出 docs/integration/2026-09-29/02-back/results/three-case-trajectory.json，供 03 整链与 Codex 验收对照。
// 用法（plain node，勿加 --test——execArgv 会污染 worker）：
//   ARROW_TEST_DB_URL=postgres://arrow_test:***@127.0.0.1:<port>/arrow_test node scripts/three-case-trajectory.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createIsolatedArrowRuntime, HUMAN, TENANT } from './parallel-arrows-runtime.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/integration/2026-09-29/02-back/results/three-case-trajectory.json');

const r = await createIsolatedArrowRuntime({ dbUrl: process.env.ARROW_TEST_DB_URL, seedSuffix: randomUUID().slice(0, 8), progression: 'parallel' });
try {
  const login = async credential => { const x = await fetch(r.baseUrl + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) }); return (await x.json()).session.sessionId; };
  const sid = await login(HUMAN);
  const call = async (method, url, body, session = sid) => { const x = await fetch(r.baseUrl + '/api/jw/v2' + url, { method,
    headers: { 'content-type': 'application/json', 'x-jw-session': session, origin: r.baseUrl }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: x.status, body: await x.json() }; };
  const get = async (c, domain) => { const x = await call('GET', `/customers/${c.customerId}/advance-rounds${domain ? '?domain=' + domain : ''}`); if (x.status !== 200) throw new Error('GET失败:' + JSON.stringify(x.body)); return x.body; };
  const plan = async (c, domain = 'business') => (await call('GET', `/customers/${c.customerId}/advance-plan?domain=${domain}`)).body;
  const advance = async (c, domain = 'business') => {
    const p = await plan(c, domain);
    const b = Object.fromEntries(['domain', 'planId', 'planHash', 'expectedVersion', 'roundNo', 'actionIds'].map(k => [k, p[k]])); b.requestId = randomUUID();
    const x = await call('POST', `/actions/customers/${c.customerId}/advance-rounds`, b);
    if (![200, 202].includes(x.status)) throw new Error('推进被拒:' + JSON.stringify(x.body));
    await r.advance.drain(); return b;
  };
  const choose = async (c, domain, decision = 'adopt') => {
    const v = await get(c, domain); const j = v.receipt;
    const b = { requestId: randomUUID(), decision, resultId: j.actions[0].result.resultId, expectedVersion: j.version, rationale: '有权人工选择（演示轨迹，已阅读候选与依据）' };
    const x = await call('POST', `/actions/customers/${c.customerId}/advance-rounds/${j.roundId}/decision`, b);
    return { status: x.status, body: x.body, domain, decision, roundId: j.roundId };
  };
  const snap = (v, extra = {}) => ({ at: new Date().toISOString(),
    states: Object.fromEntries(v.domains.map(d => [d.domain, d.state])),
    processState: v.caseOutcome?.status ?? null, ending: v.caseOutcome?.ending ?? null,
    affectedDomains: v.affectedDomains ?? [], needsReselection: (v.needsReselection ?? []).map(j => j.domain),
    gates: Object.fromEntries((v.receipts ?? []).map(j => [j.domain, j.zoneCandidates?.gate?.result ?? null])), ...extra });
  const rule = (await r.pool.query("SELECT version FROM rule_pack_versions WHERE status='active' LIMIT 1")).rows[0].version;

  const good = r.cases.find(c => c.id === 'good'), medium = r.cases.find(c => c.id === 'medium'), bad = r.cases.find(c => c.id === 'bad');
  const cases = [];

  { // 好例：一次事件并发五区 → 人工逐区采用 → Diamond → 周期（履约→外部回执人工确认→结清→关闭）
    const steps = [];
    let b = await advance(good); steps.push({ action: 'POST advance-rounds（业务事件：提交分析）', requestId: b.requestId, ...snap(await get(good)) });
    for (const d of ['business', 'policy', 'credit', 'commerce', 'asset']) { const x = await choose(good, d); if (x.status !== 200) throw new Error('adopt失败:' + JSON.stringify(x.body)); steps.push({ action: `POST decision adopt（${d}）`, ...snap(await get(good)) }); }
    const open = await call('POST', `/actions/customers/${good.customerId}/cycles`, { requestId: randomUUID() }); if (open.status !== 200) throw new Error('开周期失败:' + JSON.stringify(open.body));
    steps.push({ action: 'POST cycles（开立第1期）', cycle: { cycleId: open.body.cycle.cycleId, state: open.body.cycle.state } });
    const fu = await call('POST', `/actions/customers/${good.customerId}/cycles/${open.body.cycle.cycleId}/fulfill`, { requestId: randomUUID() });
    steps.push({ action: 'POST cycles/:id/fulfill（内部履约完成）', cycle: { state: fu.body.cycle.state, note: fu.body.cycle.internalFulfillment?.note, externalIntegration: fu.body.cycle.externalIntegration } });
    const rec = await call('POST', `/actions/customers/${good.customerId}/cycles/${open.body.cycle.cycleId}/external-receipt`, { requestId: randomUUID(), ref: 'WIRE-DEMO-0001', source: 'manual-attestation' });
    steps.push({ action: 'POST cycles/:id/external-receipt（有权人类手工确认真实回执）', cycle: { externalReceipt: { ref: rec.body.cycle.externalReceipt.ref, source: rec.body.cycle.externalReceipt.source } } });
    const st = await call('POST', `/actions/customers/${good.customerId}/cycles/${open.body.cycle.cycleId}/settle`, { requestId: randomUUID() });
    steps.push({ action: 'POST cycles/:id/settle（结清）', cycle: { state: st.body.cycle.state } });
    const cl = await call('POST', `/actions/customers/${good.customerId}/cycles/${open.body.cycle.cycleId}/close`, { requestId: randomUUID() });
    steps.push({ action: 'POST cycles/:id/close（关闭）', cycle: { state: cl.body.cycle.state } });
    cases.push({ caseId: `parallel-v1-good`, customerId: good.customerId, scenario: 'good', label: '好例（正常收口）', path: '分析→五区人工采用→Diamond→周期履约→回执确认→结清→关闭', steps });
  }

  { // 中例：信审缺件等待 → 补证（supersede）→ 仅受影响区重算 → Diamond
    const steps = [];
    await advance(medium); steps.push({ action: 'POST advance-rounds（业务事件：提交分析）', ...snap(await get(medium)) });
    const gap = await get(medium, 'credit');
    steps.push({ action: 'GET advance-rounds?domain=credit（信审缺件：unknowns 非空）', state: gap.receipt.state, nextReason: gap.receipt.next?.reason ?? null,
      unknowns: gap.receipt.candidate?.assessment?.unknowns ?? [], gate: gap.receipt.zoneCandidates?.gate?.result ?? null });
    const blocked = await choose(medium, 'credit'); steps.push({ action: 'POST decision adopt（缺件区采用被拒）', status: blocked.status, error: blocked.body.error ?? blocked.body.message });
    for (const d of ['business', 'policy', 'commerce', 'asset']) { const x = await choose(medium, d); if (x.status !== 200) throw new Error('adopt失败:' + JSON.stringify(x.body)); }
    steps.push({ action: 'POST decision adopt ×4（其余区人工采用）', ...snap(await get(medium)) });
    await r.kernel.v2.registerArtifact({ credential: HUMAN, tenantId: TENANT, requestId: randomUUID(), kind: 'financial_statement', factKey: 'monthly_operating_cash_flow', grade: 'confirmed',
      supersedes: medium.artifacts.monthly_operating_cash_flow, content: { value: 200000, sourceMode: 'synthetic', revision: 2, verificationDocument: 'synthetic bank reconciliation' }, materialMeta: { unit: 'CNY' } }, medium.customerId);
    const affected = await get(medium); steps.push({ action: 'POST artifacts（补证：银行对账单取代旧申报，supersedes）', ...snap(affected) });
    await advance(medium, 'credit'); steps.push({ action: 'POST advance-rounds（业务事件：定向重算受影响区）', ...snap(await get(medium)) });
    for (const d of ['policy', 'credit']) { const x = await choose(medium, d); if (x.status !== 200) throw new Error('adopt失败:' + JSON.stringify(x.body)); steps.push({ action: `POST decision adopt（${d} 重算后）`, ...snap(await get(medium)) }); }
    cases.push({ caseId: `parallel-v1-medium`, customerId: medium.customerId, scenario: 'medium', label: '中例（缺件→补证→定向重算）', path: '分析→信审缺件等待→其余区采用→补证→仅受影响区重算→Diamond', steps });
  }

  { // 差例：覆盖率不足由规则计算 → 信审角色正式拒绝 → 归档，其余区停止
    const steps = [];
    await advance(bad); steps.push({ action: 'POST advance-rounds（业务事件：提交分析）', ...snap(await get(bad)) });
    const j = (await get(bad, 'credit')).receipt;
    steps.push({ action: 'GET advance-rounds?domain=credit（覆盖率不足由规则计算得出）', state: j.state,
      coverage: j.candidate?.assessment?.knownFacts?.filter(k => k.includes('覆盖率')) ?? [], suspicion: j.candidate?.assessment?.findingsSuspicion ?? [] });
    const x = await choose(bad, 'credit', 'reject'); if (x.status !== 200) throw new Error('reject失败:' + JSON.stringify(x.body));
    steps.push({ action: 'POST decision reject（信审角色正式拒绝）', ...snap(await get(bad)) });
    const after = await get(bad);
    steps.push({ action: 'GET advance-plan?domain=commerce（后续推进被硬挡）', available: (await plan(bad, 'commerce')).available, reason: (await plan(bad, 'commerce')).reason });
    cases.push({ caseId: `parallel-v1-bad`, customerId: bad.customerId, scenario: 'bad', label: '差例（依据性拒绝）', path: '分析→规则算出覆盖率不足→信审正式拒绝→流程归档、其余区停止', steps, archiveRef: after.caseOutcome?.archiveRef ?? null });
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sourceMode: 'synthetic/deterministic（模拟=输入材料与外部事件；规则判断/状态机/权限/持久化为真实后端）',
    rulePack: `four-domain-rule-pack-v1@${rule}（模拟演示规则，非集团制度）`, exerciseId: r.exerciseId, note: '每步 states 为五域服务端状态；gates 为各区当前 gate 结果', cases }, null, 2));
  console.log(JSON.stringify({ ok: true, out: OUT, cases: cases.map(c => ({ caseId: c.caseId, steps: c.steps.length, ending: c.steps.at(-1).ending ?? c.steps.at(-1).cycle?.state ?? null })) }));
} finally { await r.advance.drain(); await r.close(); }
