// V0.5 十案例检查点初始化（03路配方执行器）。消费 02 路 CASE_RECIPES（唯一材料与语义 writer），
// 通过**授权 API**实际执行得到每个检查点；不直写数据库结果表、不清库重置；合成人工办理与
// 模拟外部回执在记录中明确标识。重演 = 换 batchId（新批次），旧批次历史保留。
//
// 消费契约（与 02-back 约定；02 冻结后如有字段名出入以其 CONTRACT_DELTA 为准）：
//   CASE_RECIPES.json = {
//     batchId, cases: [{ caseId, dir(相对 recipes 文件), displayName, industry, annualRevenueCny,
//       scenarioKey: bad|medium|good, scenarioLabel: 差|中|好, highlight(案例要点),
//       steps: [ {op..} ] } ] }
//   step op：
//     upload   {file,kind}                        联系人经进件链上传原件（真实解析）
//     declare  {factKey,value,unit?,note?}        操作员声明（source_supported，operator_declared）
//     advance  {}                                 一次事件推进（五区并行）
//     wait     {seconds?}                         等待收敛（默认由 waitSettled 覆盖，少用）
//     verify   {factKey,value,unit?,through?}     模拟人工核验（confirmed；记录标注 synthetic_human_step）
//     adopt    {domain,rationale?}                人工采用（流程 principal）
//     decline  {domain,rationale?}                人工搁置（set_aside）
//     reject   {domain,rationale?}                信审域正式拒绝
//     cycle    {action: open|fulfill|receipt|settle|close|reorder, ref?}   业务周期（09/10）
//     expect   {domain,state}                     断言当前域状态（不符则该 case FAIL）
// // 用法：JW_INTEG_RUN_SUBDIR=v05 node scripts/demo-init-v2.mjs --recipes <CASE_RECIPES.json> [--only caseId]...
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EDGE_ROOT, REPO_ROOT, RUN_DIR, loadParams, ok, info, fail } from './integration-lib.mjs';

const TENANT = 't1';
const ALLOWED_KINDS = ['financial_statement', 'invoice', 'bank_statement', 'order_contract', 'equipment_list', 'litigation_document', 'other', 'legal_document'];
const DOMAINS = ['business', 'policy', 'credit', 'commerce', 'asset'];

const argv = process.argv.slice(2);
const argOf = (name, dflt = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const RECIPES_PATH = path.resolve(argOf('--recipes', '') || fail('用法：--recipes <CASE_RECIPES.json>'));
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv.slice(i + 1).filter(a => !a.startsWith('--')) : []; })();
const OUT_PATH = argOf('--out', path.join(RUN_DIR, 'demo-init-v2-results.json'));

const params = loadParams();
if (!params) fail('params.json 不存在：先 Start-JW.ps1 或 integration-up 启动栈');
const EDGE = `http://127.0.0.1:${params.edgePort}`;
const STATE_PATH = path.join(RUN_DIR, 'demo-state-v2.json');
const loadState = () => { try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; } };
const saveState = (s) => { mkdirSync(RUN_DIR, { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); };

async function http(method, pathname, o = {}) {
  const h = {}; let body;
  if (o.body !== undefined) { body = JSON.stringify(o.body); h['content-type'] = 'application/json'; }
  if (o.session) h['x-jw-session'] = o.session;
  const r = await fetch(`${EDGE}${pathname}`, { method, headers: h, body, signal: AbortSignal.timeout(30000) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { }
  return { status: r.status, json: j, text: t };
}
const sleep = (ms) => new Promise((x) => setTimeout(x, ms));

async function login(principalId) {
  const r = await http('POST', '/api/jw/v2/session', { body: { principalId } });
  const sid = r.json?.session?.sessionId;
  if (!sid) throw new Error(`登录 ${principalId} 失败: ${r.status}`);
  return sid;
}
async function waitTask(session, customerId, taskId, { timeoutMs = 90000 } = {}) {
  const dl = Date.now() + timeoutMs;
  while (Date.now() < dl) {
    await sleep(1200);
    const t = await http('GET', `/api/jw/v2/connectors/processing/tasks/${encodeURIComponent(taskId)}?tid=${TENANT}&cid=${encodeURIComponent(customerId)}`, { session });
    const st = t.json?.task?.status;
    if (['done', 'needs_followup', 'failed', 'blocked_unknown', 'blocked_link', 'blocked_a_unavailable', 'skipped_duplicate'].includes(st)) return t.json?.task ?? null;
  }
  throw new Error(`任务 ${taskId} 超时`);
}
async function waitSettled(session, customerId, { timeoutMs = 120000 } = {}) {
  const dl = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < dl) {
    await sleep(1500);
    last = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/advance-rounds`, { session });
    const ds = last.json?.domains ?? [];
    if (ds.length > 0 && ds.every((d) => !['queued', 'running', 'unknown'].includes(d.state))) return last.json;
  }
  return last?.json ?? null;
}
async function currentReceipt(session, customerId, domain) {
  const r = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/advance-rounds?domain=${domain}`, { session });
  return r.json?.receipt ?? null;
}
const findCustomer = async (biz, ref) => {
  const r = await http('GET', `/api/jw/v2/customers?search=${encodeURIComponent(ref)}`, { session: biz });
  return (r.json?.customers ?? [])[0]?.customerId ?? null;
};

// ---- 配方步骤执行 ----
async function runStep(ctx, step, stepId) {
  const { biz, adv, contact, customerId, caseId } = ctx;
  const rid = (p) => `${ctx.batchId}-${caseId}-${p}`.toLowerCase();
  switch (step.op) {
    case 'upload': {
      const bytes = readFileSync(path.join(ctx.caseDir, 'originals', step.file));
      const up = await http('POST', '/api/jw/v2/actions/connectors/evidence/upload', {
        session: contact,
        body: { requestId: rid(`up-${stepId}`), customerId, tenantId: TENANT, invitationId: ctx.invitationId, kind: step.kind, name: step.file, contentBase64: bytes.toString('base64'), contentType: step.file.endsWith('.csv') ? 'text/csv' : 'text/plain' },
      });
      if (up.status !== 200) throw new Error(`上传 ${step.file}: ${up.status} ${JSON.stringify(up.json)?.slice(0, 120)}`);
      const task = up.json?.processing?.taskId ? await waitTask(biz, customerId, up.json.processing.taskId) : null;
      return { file: step.file, sha256: up.json?.sha256, duplicateOf: up.json?.duplicateOf ?? null, task: task?.status };
    }
    case 'declare': {
      const r = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/artifacts`, {
        session: biz,
        body: { requestId: rid(`decl-${stepId}`), tenantId: TENANT, kind: 'document', factKey: step.factKey, grade: 'source_supported', content: { value: step.value, ...(step.unit ? { unit: step.unit } : {}), sourceMode: 'operator_declared', factKey: step.factKey }, materialMeta: { unit: step.unit ?? null, caliber: step.note ?? 'operator_declared_requirement' } },
      });
      if (r.status !== 200 && r.status !== 409) throw new Error(`声明 ${step.factKey}: ${r.status}`);
      return { factKey: step.factKey, status: r.status };
    }
    case 'verify': {
      // 模拟人工核验（合成演练步骤，非真实核验事件）：confirmed 级登记 + 明确标识
      const r = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/artifacts`, {
        session: biz,
        body: { requestId: rid(`ver-${stepId}`), tenantId: TENANT, kind: 'document', factKey: step.factKey, grade: 'confirmed', content: { value: step.value, ...(step.unit ? { unit: step.unit } : {}), sourceMode: 'human_verified_document', factKey: step.factKey }, materialMeta: { unit: step.unit ?? null, caliber: `人工核验原件后登记（合成人工办理·${ctx.batchId}）` } },
      });
      if (r.status !== 200 && r.status !== 409) throw new Error(`核验 ${step.factKey}: ${r.status}`);
      return { factKey: step.factKey, value: step.value, synthetic: true, status: r.status };
    }
    case 'advance': {
      const p = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/advance-plan?domain=business`, { session: adv });
      if (p.json?.priorCase && p.json?.available === false) return { skipped: 'priorCase', reason: p.json?.reason ?? null };
      if (p.status !== 200 || p.json?.available !== true) throw new Error(`advance-plan 不可用: ${p.status} ${p.json?.reason ?? ''}`);
      const b = { requestId: rid(`adv-${stepId}`), domain: 'business', planId: p.json.planId, planHash: p.json.planHash, expectedVersion: p.json.expectedVersion, roundNo: p.json.roundNo, actionIds: p.json.actionIds };
      const post = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/advance-rounds`, { session: adv, body: b });
      if (![200, 202].includes(post.status)) throw new Error(`advance: ${post.status} ${JSON.stringify(post.json)?.slice(0, 140)}`);
      return { requestId: b.requestId, reused: post.json?.reused === true };
    }
    case 'waitSettled': {
      const s = await waitSettled(adv, customerId);
      return { states: Object.fromEntries((s?.domains ?? []).map((d) => [d.domain, d.state])), outcome: s?.caseOutcome?.status ?? null };
    }
    case 'expect': {
      const s = await waitSettled(adv, customerId);
      const got = (s?.domains ?? []).find((d) => d.domain === step.domain)?.state ?? 'none';
      if (got !== step.state) throw new Error(`期望 ${step.domain}=${step.state}，实际 ${got}`);
      return { domain: step.domain, state: got, ok: true };
    }
    case 'adopt': case 'decline': case 'reject': {
      const rec = await currentReceipt(adv, customerId, step.domain);
      const decision = step.op === 'adopt' ? 'adopt' : step.op === 'decline' ? 'set_aside' : 'reject';
      const resultId = rec?.views?.decisions?.requiredDecision?.resultId ?? rec?.actions?.[0]?.result?.resultId ?? null;
      if (!rec?.roundId || !resultId) return { skipped: `${step.domain} 无可决定候选（state=${rec?.state ?? 'none'}）` };
      const d = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/advance-rounds/${encodeURIComponent(rec.roundId)}/decision`, {
        session: adv,
        body: { requestId: rid(`${decision}-${stepId}`), decision, resultId, expectedVersion: rec.version, rationale: step.rationale ?? `演示配方步骤（合成人工办理·${ctx.batchId}）` },
      });
      if (d.status !== 200) {
        const msg = d.json?.message ?? d.json?.error ?? '';
        if (String(msg).includes('HARD_BLOCK_NOT_ADOPTABLE') || String(msg).includes('NOT_READY')) return { blocked: String(msg).slice(0, 80), synthetic: false };
        throw new Error(`${decision} ${step.domain}: ${d.status} ${String(msg).slice(0, 120)}`);
      }
      return { decision, domain: step.domain, synthetic: true };
    }
    case 'cycle': {
      const cid = ctx.cycleId;
      if (step.action === 'open' || step.action === 'reorder') {
        const body = step.action === 'reorder' ? { requestId: rid(`cyc-open-${stepId}`), reorderOf: cid } : { requestId: rid(`cyc-open-${stepId}`) };
        const r = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/cycles`, { session: adv, body });
        if (r.status !== 200) throw new Error(`cycle ${step.action}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 140)}`);
        ctx.cycleId = r.json?.cycleId ?? null;
        return { action: step.action, cycleId: ctx.cycleId, ...(step.action === 'reorder' ? { simulated: true } : {}) };
      }
      if (!cid) {
        const list = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/cycles`, { session: adv });
        ctx.cycleId = (list.json?.cycles ?? [])[0]?.cycleId ?? null;
        if (!ctx.cycleId) throw new Error(`cycle ${step.action}: 无周期（先 open）`);
      }
      const actionPath = { fulfill: 'fulfill', receipt: 'external-receipt', settle: 'settle', close: 'close' }[step.action];
      const body = step.action === 'receipt' ? { requestId: rid(`cyc-${stepId}`), ref: step.ref ?? `SIM-RECEIPT-${Date.now().toString(36)}`, source: 'simulated_demo' } : { requestId: rid(`cyc-${stepId}`) };
      const r = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/cycles/${encodeURIComponent(ctx.cycleId)}/${actionPath}`, { session: adv, body });
      if (r.status !== 200) throw new Error(`cycle ${step.action}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 140)}`);
      return { action: step.action, cycleId: ctx.cycleId, ...(step.action === 'receipt' ? { simulatedReceipt: true, ref: body.ref } : {}) };
    }
    default: throw new Error(`未知步骤 op=${step.op}`);
  }
}

// ---- 主流程 ----
const recipes = JSON.parse(readFileSync(RECIPES_PATH, 'utf8'));
if (!recipes?.batchId || !Array.isArray(recipes?.cases)) fail('CASE_RECIPES 形状不符：缺 batchId/cases');
const t0 = Date.now();
console.log(`==== demo-init-v2：批次 ${recipes.batchId}（${recipes.cases.length} 案例）====`);
const biz = await login('biz1');
const adm = await login('adm1');
const adv = await login('adv1');
const cred = await login('cred1');
const state = loadState();
state.batches ??= {};
const batchState = (state.batches[recipes.batchId] ??= {});

const results = { suite: 'demo3-init-v2', batchId: recipes.batchId, date: new Date().toISOString(), edge: params.edgePort, tenant: TENANT, cases: [], errors: [] };
for (const [idx, c] of recipes.cases.entries()) {
  if (ONLY.length > 0 && !ONLY.includes(c.caseId)) continue;
  const row = { caseId: c.caseId, displayOrder: idx + 1, scenarioLabel: c.scenarioLabel ?? null, displayName: c.displayName, highlight: c.highlight ?? null, steps: [], errors: [] };
  console.log(`\n──── [${idx + 1}] ${c.caseId} ${c.displayName ?? ''}（${c.scenarioLabel ?? ''}）────`);
  try {
    const caseDir = path.resolve(path.dirname(RECIPES_PATH), c.dir);
    const input = JSON.parse(readFileSync(path.join(caseDir, 'case-input.json'), 'utf8'));
    const ref = input.legalEntityRef;
    let customerId = batchState[c.caseId]?.customerId ?? await findCustomer(biz, ref);
    if (!customerId) {
      const mk = await http('POST', '/api/jw/v2/actions/customers', { session: biz, body: { requestId: `${recipes.batchId}-${c.caseId}-create`.toLowerCase(), tenantId: TENANT, legalEntityRef: ref, displayName: c.displayName ?? input.displayName } });
      if (mk.status === 200) customerId = mk.json.customerId;
      else if (mk.status === 409) customerId = await findCustomer(biz, ref);
      if (!customerId) throw new Error(`建档失败 ${mk.status}`);
      ok(`建档 ${customerId}`);
    } else info(`复用已有客户 ${customerId}`);
    row.customerId = customerId;
    batchState[c.caseId] = { customerId };

    // 联系人/进件（复用旧 state；失效则重建）
    let contact = state[c.caseId]?.contact ?? null;
    let contactSession = null;
    if (contact?.credential) {
      const s = await http('POST', '/api/jw/v2/session', { body: { credential: contact.credential } });
      contactSession = s.json?.session?.sessionId ?? null;
    }
    if (!contactSession) {
      const inv = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/invitations`, { session: biz, body: { requestId: `${recipes.batchId}-${c.caseId}-inv`.toLowerCase(), tenantId: TENANT, role: 'customer-finance', allowedKinds: ALLOWED_KINDS, expiresInHours: 24 } });
      const code = inv.json?.invitation?.code ?? inv.json?.code;
      const redeem = await http('POST', '/api/jw/v2/invitations/redeem', { body: { code, requestId: `${recipes.batchId}-${c.caseId}-rd`.toLowerCase() } });
      contact = { principalId: redeem.json?.principalId, credential: redeem.json?.credential };
      const s = await http('POST', '/api/jw/v2/session', { body: { credential: contact.credential } });
      contactSession = s.json?.session?.sessionId;
      if (!contactSession) throw new Error('联系人会话失败');
    }
    let invitationId = state[c.caseId]?.invitationId ?? null;
    const ctx0 = await http('GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    if (!(ctx0.json?.available === true)) {
      const ii = await http('POST', '/api/jw/v2/actions/connectors/intake/invitations', { session: biz, body: { requestId: `${recipes.batchId}-${c.caseId}-intake`.toLowerCase(), tenantId: TENANT, customerId, role: 'customer_finance', allowedEvidenceKinds: ALLOWED_KINDS, ttlSec: 86400 } });
      invitationId = ii.json?.invitationId;
      const acc = await http('POST', '/api/jw/v2/actions/connectors/intake/accept', { session: contactSession, body: { requestId: `${recipes.batchId}-${c.caseId}-acc`.toLowerCase(), tenantId: TENANT, token: ii.json?.token, provider: 'jw_principal', providerUserId: contact.principalId } });
      const vb = await http('POST', '/api/jw/v2/actions/connectors/intake/verify-binding', { session: biz, body: { requestId: `${recipes.batchId}-${c.caseId}-bind`.toLowerCase(), tenantId: TENANT, customerId, bindingId: acc.json?.bindingId, verifiedBy: `演示初始化（${recipes.batchId}）`, evidenceRefs: [`invitation:${invitationId}`] } });
      if (vb.status !== 200) throw new Error(`绑定核验 ${vb.status}`);
    }
    state[c.caseId] = { ...(state[c.caseId] ?? {}), customerId, contact, invitationId };
    saveState(state);

    // 交易范围（operator_declared；advance 依赖）：case-input.transaction → transaction_scope 声明
    if (input.transaction) {
      const sc = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/artifacts`, {
        session: biz,
        body: { requestId: `${recipes.batchId}-${c.caseId}-scope`.toLowerCase(), tenantId: TENANT, kind: 'document', factKey: 'transaction_scope', grade: 'source_supported', content: { value: { ...input.transaction, customerRange: input.transaction.customerRange ?? 'standard' }, sourceMode: 'operator_declared', factKey: 'transaction_scope' }, materialMeta: { unit: null, caliber: 'operator_declared_requirement' } },
      });
      if (![200, 409].includes(sc.status)) throw new Error(`transaction_scope 登记 ${sc.status}`);
    }

    const ctx = { batchId: recipes.batchId, caseId: c.caseId, caseDir, customerId, invitationId, contact, biz, adv, cred, adm, cycleId: batchState[c.caseId]?.cycleId ?? null };
    for (const [si, step] of (c.steps ?? []).entries()) {
      try {
        const out = await runStep(ctx, step, si);
        row.steps.push({ i: si, op: step.op, ...(step.domain ? { domain: step.domain } : {}), out });
        const brief = out?.skipped || out?.blocked ? ` (${out.skipped ?? out.blocked})` : '';
        console.log(`  ✓ [${si}] ${step.op}${step.domain ? '@' + step.domain : ''}${brief}`);
      } catch (e) {
        row.steps.push({ i: si, op: step.op, error: e.message });
        row.errors.push(`step[${si}] ${step.op}: ${e.message}`);
        console.error(`  ✗ [${si}] ${step.op}: ${e.message}`);
        break; // 该案例中断；已执行步骤幂等可续跑
      }
    }
    batchState[c.caseId].cycleId = ctx.cycleId ?? null;
    // 终态读面（检查点呈现依据）
    const final = await waitSettled(adv, customerId);
    row.finalStates = Object.fromEntries((final?.domains ?? []).map((d) => [d.domain, d.state]));
    row.caseOutcome = final?.caseOutcome ?? null;
    saveState(state);
    results.cases.push(row);
  } catch (e) {
    row.errors.push(String(e.message));
    results.errors.push(`${c.caseId}: ${e.message}`);
    console.error(`[demo-init-v2] ✗ ${c.caseId}: ${e.message}`);
    results.cases.push(row);
  }
}

// ---- 显式案例 manifest（00_SCOPE 展示字段；A 权威面就绪前供回退与验收对照）----
const manifest = {
  ok: results.errors.length === 0,
  manifestVersion: 'parallel-arrows-cases-v1',
  generatedAt: new Date().toISOString(),
  batchId: recipes.batchId,
  source: `demo-init-v2（03路配方执行器；批次 ${recipes.batchId}；检查点经授权 API 实际执行）`,
  cases: results.cases.map((r, i) => ({
    caseId: r.caseId, customerId: r.customerId, displayOrder: r.displayOrder ?? i + 1,
    scenarioLabel: r.scenarioLabel, scenarioKey: recipes.cases.find((c) => c.caseId === r.caseId)?.scenarioKey ?? null,
    displayName: r.displayName, industry: recipes.cases.find((c) => c.caseId === r.caseId)?.industry ?? null,
    annualRevenueCny: recipes.cases.find((c) => c.caseId === r.caseId)?.annualRevenueCny ?? null,
    highlight: r.highlight, checkpoint: recipes.cases.find((c) => c.caseId === r.caseId)?.checkpoint ?? null,
    nextAction: recipes.cases.find((c) => c.caseId === r.caseId)?.nextAction ?? null,
    scenarioIsOutcome: false, sourceMode: 'synthetic',
    states: r.finalStates ?? null,
  })),
};
writeFileSync(path.join(RUN_DIR, 'arrow-cases-manifest.json'), JSON.stringify(manifest, null, 2));

results.totals = { cases: results.cases.length, withErrors: results.cases.filter((c) => c.errors.length > 0).length, elapsedMs: Date.now() - t0 };
mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
saveState(state);
console.log('──────────────────────────────────────────────');
if (results.errors.length > 0) {
  console.error(`[demo-init-v2] 完成（${results.errors.length} 例有错误）→ ${OUT_PATH}`);
  process.exit(1);
}
console.log(`[demo-init-v2] ✓ 批次 ${recipes.batchId} 收敛（${recipes.cases.length} 例，${(results.totals.elapsedMs / 1000).toFixed(1)}s）→ ${OUT_PATH}`);
console.log('[demo-init-v2] 检查点全部经授权 API 实际执行；合成人工办理与模拟回执已在记录中标识');
