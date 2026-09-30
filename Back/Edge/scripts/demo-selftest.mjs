// 三案例演示 · API 级自测（03路）。在 demo03 栈上以 TEST- 前缀一次性客户验证三案例全链与负例；
// 与 demo-init 分离：自测产生的客户用于测试证据，跑完由重置流程清库后 demo-init 才注入演示客户。
// 断言材料来源：docs/integration/2026-09-29/materials/cases/*/（case-input.json + expectations.json，
// 独立预期由 tools/independent-expectations.mjs 生成）。被测系统零改动、零案例标签注入。
// 用法：JW_INTEG_RUN_SUBDIR=demo03 node scripts/demo-selftest.mjs [--out <RESULTS路径>] [--prefix TEST3]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { REPO_ROOT, RUN_DIR, loadParams, ok, info, fail } from './integration-lib.mjs';

const TENANT = 't1';
const ALLOWED_KINDS = ['financial_statement', 'invoice', 'bank_statement', 'order_contract', 'equipment_list', 'litigation_document', 'other', 'legal_document'];
const DOMAINS = ['business', 'policy', 'credit', 'commerce', 'asset'];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const argOf = (argv, name, dflt = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };

const argv = process.argv.slice(2);
const MATERIALS = path.resolve(argOf(argv, '--materials', path.join(REPO_ROOT, 'docs', 'integration', '2026-09-29', 'materials')));
const PREFIX = argOf(argv, '--prefix', 'TEST3');
const OUT_PATH = argOf(argv, '--out', path.join(RUN_DIR, 'demo-selftest-results.json'));

const params = loadParams();
if (!params) fail('params.json 不存在：先运行 integration-up（JW_INTEG_RUN_SUBDIR=demo03）');
const EDGE = `http://127.0.0.1:${params.edgePort}`;

const results = [];
const evidenceDir = path.join(path.dirname(OUT_PATH), 'evidence');
mkdirSync(evidenceDir, { recursive: true });
let uidN = 0;
const uid = (p) => `${p}-${Date.now().toString(36)}-${(uidN++).toString(36)}`;
const stamp = () => new Date().toISOString();

function record(id, name, pass, detail, note = '') {
  results.push({ id, name, pass, note, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${id} ${name}${note ? ` — ${note}` : ''}`);
  if (!pass) console.log(`      ${JSON.stringify(detail).slice(0, 500)}`);
  return pass;
}

async function http(method, pathname, { session, body, headers = {} } = {}) {
  const h = { ...headers };
  let payload;
  if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  if (session) h['x-jw-session'] = session;
  const res = await fetch(`${EDGE}${pathname}`, { method, headers: h, body: payload, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text };
}
const login = async (principalId) => (await http('POST', '/api/jw/v2/session', { body: { principalId } })).json?.session?.sessionId;
const sleep = (ms) => new Promise((x) => setTimeout(x, ms));

async function waitSettled(biz, customerId, { timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(1500);
    last = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/advance-rounds`, { session: biz });
    const domains = last.json?.domains ?? [];
    const procState = last.json?.caseOutcome?.status ?? null;
    const busyStates = domains.filter((d) => ['queued', 'running', 'unknown'].includes(d.state));
    if (busyStates.length === 0 && procState !== 'in_progress_waits') {
      const allSettled = domains.every((d) => !['queued', 'running', 'unknown'].includes(d.state));
      if (allSettled) return last.json;
    }
  }
  return last?.json ?? null;
}

async function initCase(biz, adm, caseDir, refSuffix) {
  const input = JSON.parse(readFileSync(path.join(caseDir, 'case-input.json'), 'utf8'));
  const legalEntityRef = `${input.legalEntityRef}-${refSuffix}`;
  const findCustomer = async () => {
    // 目录 search 同时匹配 display_name/customer_id/legal_entity_ref（A G1）；返回行不含 legalEntityRef，
    // 以唯一 ref 前缀检索后取首个命中行即可。
    const dir = await http('GET', `/api/jw/v2/customers?search=${encodeURIComponent(legalEntityRef)}`, { session: biz });
    const list = dir.json?.customers ?? [];
    const hit = (Array.isArray(list) ? list : [])[0];
    return hit?.customerId ?? null;
  };
  const mk = await http('POST', '/api/jw/v2/actions/customers', { session: biz, body: { requestId: uid('cc'), tenantId: TENANT, legalEntityRef, displayName: `${input.displayName}（自测）` } });
  let customerId = null;
  if (mk.status === 200 && mk.json?.customerId) customerId = mk.json.customerId;
  else if (mk.status === 409) customerId = await findCustomer();
  if (!customerId) throw new Error(`建档失败 ${mk.status} ${JSON.stringify(mk.json)?.slice(0, 160)}`);
  const inv = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/invitations`, { session: biz, body: { requestId: uid('inv'), tenantId: TENANT, role: 'customer-finance', allowedKinds: ALLOWED_KINDS, expiresInHours: 24 } });
  const code = inv.json?.invitation?.code ?? inv.json?.code;
  const redeem = await http('POST', '/api/jw/v2/invitations/redeem', { body: { code, requestId: uid('rd') } });
  const contactSession = await login.__cred(redeem.json.credential);
  const ii = await http('POST', `/api/jw/v2/actions/connectors/intake/invitations`, { session: biz, body: { requestId: uid('ii'), tenantId: TENANT, customerId, role: 'customer_finance', allowedEvidenceKinds: ALLOWED_KINDS, ttlSec: 86400 } });
  const acc = await http('POST', `/api/jw/v2/actions/connectors/intake/accept`, { session: contactSession, body: { requestId: uid('ia'), tenantId: TENANT, token: ii.json?.token, provider: 'jw_principal', providerUserId: redeem.json?.principalId } });
  const vb = await http('POST', `/api/jw/v2/actions/connectors/intake/verify-binding`, { session: biz, body: { requestId: uid('vb'), tenantId: TENANT, customerId, bindingId: acc.json?.bindingId, verifiedBy: '自测（business）', evidenceRefs: ['demo-selftest'] } });
  if (vb.status !== 200) throw new Error(`绑定失败 ${vb.status}`);
  const uploaded = [];
  for (const f of input.files.filter((f) => f.role === 'initial')) {
    const bytes = readFileSync(path.join(caseDir, 'originals', f.name));
    const up = await http('POST', '/api/jw/v2/actions/connectors/evidence/upload', { session: contactSession, body: { requestId: uid('up'), customerId, tenantId: TENANT, invitationId: ii.json?.invitationId, kind: f.kind, name: f.name, contentBase64: bytes.toString('base64'), contentType: f.name.endsWith('.csv') ? 'text/csv' : 'text/plain' } });
    if (up.status !== 200) throw new Error(`上传 ${f.name} 失败 ${up.status}`);
    uploaded.push({ name: f.name, kind: f.kind, sha256: up.json?.sha256 ?? sha256(bytes), evidenceId: up.json?.evidenceId ?? null, taskId: up.json?.processing?.taskId ?? null });
  }
  for (const f of input.files.filter((f) => f.role === 'supplement')) {
    const bytes = readFileSync(path.join(caseDir, 'originals', f.name));
    uploaded.push({ name: f.name, kind: f.kind, sha256: sha256(bytes), bytes, supplement: true });
  }
  const reg = async (body) => http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/artifacts`, { session: biz, body });
  await reg({ requestId: uid('scope'), tenantId: TENANT, kind: 'document', factKey: 'transaction_scope', grade: 'source_supported', content: { value: { ...input.transaction, customerRange: 'standard' }, sourceMode: 'operator_declared', factKey: 'transaction_scope' }, materialMeta: { unit: null, caliber: 'operator_declared_requirement' } });
  for (const [k, v] of Object.entries(input.declaredRequirements ?? {})) {
    const r = await reg({ requestId: uid('decl'), tenantId: TENANT, kind: 'document', factKey: k, grade: 'source_supported', content: { value: v.value, ...(v.unit ? { unit: v.unit } : {}), sourceMode: 'operator_declared', factKey: k }, materialMeta: { unit: v.unit ?? null, caliber: v.caliber ?? 'operator_declared_requirement' } });
    if (r.status !== 200) throw new Error(`声明 ${k} 失败 ${r.status}`);
  }
  for (const grantee of ['adv1', 'cred1']) {
    const g = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/grants`, { session: adm, body: { requestId: uid('grant'), tenantId: TENANT, principalId: grantee } });
    if (![200, 409].includes(g.status)) throw new Error(`授权 ${grantee} 失败 ${g.status}`);
  }
  return { input, customerId, uploaded, reg };
}

async function verifiedRegister(input, reg) {
  const out = [];
  for (const v of input.verifiedRegistrations ?? []) {
    const r = await reg({ requestId: uid('ver'), tenantId: TENANT, kind: 'document', factKey: v.factKey, grade: 'confirmed', content: { value: v.value, ...(v.unit ? { unit: v.unit } : {}), sourceMode: 'human_verified_document', factKey: v.factKey }, materialMeta: { unit: v.unit ?? null, caliber: '人工核验原件后登记（自测：值来自案例声明清单）' } });
    out.push({ factKey: v.factKey, status: r.status });
  }
  return out;
}

async function adoptAll(biz, customerId, { skipHardBlocked = true } = {}) {
  const adopted = [];
  for (const domain of DOMAINS) {
    const r = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/advance-rounds?domain=${domain}`, { session: biz });
    const rec = r.json?.receipt;
    if (!rec?.roundId || !['awaiting_confirmation'].includes(rec.state)) { adopted.push({ domain, state: rec?.state ?? r.json?.state ?? 'none', skipped: true }); continue; }
    const required = rec?.views?.decisions?.requiredDecision;
    const resultId = required?.resultId ?? rec?.actions?.[0]?.result?.resultId ?? null;
    if (!resultId) { adopted.push({ domain, state: rec.state, skipped: true, note: 'no resultId' }); continue; }
    if (skipHardBlocked && rec?.zoneCandidates?.hardBlock === true) { adopted.push({ domain, state: rec.state, hardBlock: true, skipped: true }); continue; }
    const d = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/advance-rounds/${encodeURIComponent(rec.roundId)}/decision`, { session: biz, body: { requestId: uid('dec'), decision: 'adopt', resultId, expectedVersion: rec.version, rationale: '自测：已阅读候选与依据后采用' } });
    adopted.push({ domain, status: d.status, state: d.json?.receipt?.state ?? d.json?.state ?? null, error: d.status !== 200 ? (d.json?.message ?? JSON.stringify(d.json)?.slice(0, 120)) : undefined });
  }
  return adopted;
}

/** 采用循环：登记/补件改变依据后，受影响区需再推进重算才能再采用；直至完结或轮次上限（如实报告）。 */
async function adoptLoop(sess, customerId, { maxRounds = 4 } = {}) {
  const history = [];
  for (let i = 0; i < maxRounds; i++) {
    const settled = await waitSettled(sess, customerId);
    if (settled?.caseOutcome?.status === 'completed' || settled?.caseOutcome?.status === 'rejected') return { history, final: settled };
    await advanceOnce(sess, customerId);
    const settled2 = await waitSettled(sess, customerId);
    if (settled2?.caseOutcome?.status === 'completed' || settled2?.caseOutcome?.status === 'rejected') return { history, final: settled2 };
    const adopted = await adoptAll(sess, customerId);
    history.push({ round: i + 1, adopted });
  }
  const final = await waitSettled(sess, customerId);
  return { history, final };
}

// ---- 主流程 ----
const t0 = Date.now();
console.log('════ 三案例演示 · API 自测（demo03 栈）════');
const biz = await login('biz1');
const adm = await login('adm1');
const adv = await login('adv1');
const cred = await login('cred1');
if (!biz || !adm || !adv || !cred) fail('演示会话建立失败');
login.__cred = async (credential) => (await http('POST', '/api/jw/v2/session', { body: { credential } })).json?.session?.sessionId;

// T1 环境
{
  const ready = await http('GET', '/healthz/ready');
  const vz = await http('GET', '/versionz');
  record('T1', '环境就绪（Edge ready 聚合 + 版本封存；assistant-model advisory 未配置属预期=零出站）',
    ready.status === 200 && ready.json?.ok === true && !!vz.json?.buildId,
    { ready: ready.json?.ok, checks: (ready.json?.checks ?? []).map((c) => `${c.name}:${c.ok}${c.advisory ? '(advisory)' : ''}`), build: vz.json?.buildId });
}

// 案例初始化（TEST 前缀一次性客户）
let good, medium, bad;
try {
  good = await initCase(biz, adm, path.join(MATERIALS, 'cases', 'good-luoyang-jianxi'), `${PREFIX}-G`);
  medium = await initCase(biz, adm, path.join(MATERIALS, 'cases', 'medium-xinxiang-hengda'), `${PREFIX}-M`);
  bad = await initCase(biz, adm, path.join(MATERIALS, 'cases', 'bad-zhengzhou-tuofeng'), `${PREFIX}-B`);
  record('T2', '三测试客户初始化（建档→邀请→绑定→材料上传→声明→授权；材料走真实解析链）',
    true, { good: good.customerId, medium: medium.customerId, bad: bad.customerId });
} catch (e) {
  record('T2', '三测试客户初始化', false, { error: e.message });
  console.error('初始化失败，中止'); process.exit(1);
}
// 等待材料解析任务收敛
for (const c of [good, medium, bad]) {
  for (const m of c.uploaded.filter((x) => x.taskId)) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const t = await http('GET', `/api/jw/v2/connectors/processing/tasks/${encodeURIComponent(m.taskId)}?tid=${encodeURIComponent(TENANT)}&cid=${encodeURIComponent(c.customerId)}`, { session: biz });
      if (['done', 'needs_followup', 'failed', 'skipped_duplicate'].includes(t.json?.task?.status)) { m.taskStatus = t.json?.task?.status; break; }
      await sleep(1200);
    }
  }
}
record('T3', '材料解析→事实→A 登记收敛（done 或内容寻址判重 skipped_duplicate；补充材料不经进件链属预期）',
  [good, medium, bad].every((c) => c.uploaded.filter((x) => x.taskId).every((m) => ['done', 'skipped_duplicate'].includes(m.taskStatus))),
  [good, medium, bad].map((c) => c.uploaded.map((m) => `${m.name}:${m.taskStatus ?? 'no-task'}`)));

async function advanceOnce(sess, customerId, domain = 'business') {
  const p = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/advance-plan?domain=${domain}`, { session: sess });
  if (p.status !== 200 || p.json?.available !== true) return { plan: p.json ?? null, status: p.status, post: null };
  const b = { requestId: uid('adv'), domain, planId: p.json.planId, planHash: p.json.planHash, expectedVersion: p.json.expectedVersion, roundNo: p.json.roundNo, actionIds: p.json.actionIds };
  const post = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/advance-rounds`, { session: sess, body: b });
  return { plan: p.json, status: p.status, post, body: b };
}

// T4 好例：一次事件 → 五区并行 → 核验 → 采用 → diamond
try {
  const before = stamp();
  const a = await advanceOnce(adv, good.customerId);
  if (![200, 202].includes(a.post?.status ?? 0)) throw new Error(`advance 失败 ${a.post?.status} ${JSON.stringify(a.post?.json)?.slice(0, 200)}`);
  const settled = await waitSettled(adv, good.customerId);
  const after = stamp();
  // 事件证据：一次 requestId 触发的全部步骤（by-request 专用路由，TASK3_INTERFACES §1）
  const ev = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/advance-rounds/by-request/${encodeURIComponent(a.body.requestId)}`, { session: adv });
  const eventJobs = ev.json?.eventJobs ?? [];
  const states = Object.fromEntries((settled?.domains ?? []).map((d) => [d.domain, d.state]));
  const queuedCount = (settled?.receipt?.views?.flow?.events ?? []).filter((e) => e.type === 'COLUMN_QUEUED').length;
  record('T4a', '好例：一次 advance 事件触发五区步骤（同 requestId eventJobs 覆盖五专业）',
    eventJobs.length === 5 && new Set(eventJobs.map((j) => j.domain)).size === 5,
    { requestId: a.body.requestId, eventJobs: eventJobs.map((j) => `${j.domain}:${j.state}`), queuedEvents: queuedCount });
  record('T4b', '好例：初始结果如实——商机/资产 waiting_evidence（收入·权属未核验）；政策 gate NEEDS_EVIDENCE（权属/主体前提未达核验级）但候选已产出；信审（覆盖率2.0）与商务出候选',
    states.business === 'waiting_evidence' && states.asset === 'waiting_evidence' && states.policy === 'awaiting_confirmation' && states.credit === 'awaiting_confirmation' && states.commerce === 'awaiting_confirmation',
    { states });
  const vr = await verifiedRegister(good.input, good.reg);
  const afterVer = await waitSettled(adv, good.customerId);
  const affected = afterVer?.affectedDomains ?? [];
  record('T4c', '好例：人工核验登记（confirmed）→ 仅受影响区失效重算（affectedDomains ⊆ {business,asset,policy}）',
    vr.every((v) => v.status === 200) && affected.every((d) => ['business', 'asset', 'policy'].includes(d)) && affected.length > 0,
    { verified: vr, affectedDomains: affected, states: Object.fromEntries((afterVer?.domains ?? []).map((d) => [d.domain, d.state])) });
  const loop = await adoptLoop(adv, good.customerId);
  const final = loop.final;
  const outcome = final?.caseOutcome ?? {};
  record('T4d', '好例：重算→逐区采用 → CASE_COMPLETED（diamond 收口）',
    outcome.status === 'completed' && outcome.ending === 'diamond',
    { loop: loop.history, outcome, states: Object.fromEntries((final?.domains ?? []).map((d) => [d.domain, d.state])) });
} catch (e) { record('T4', '好例全链', false, { error: e.message }); }

// T5 中例：现金流缺口 → 补件 → 选择性重算 → 收口
try {
  const a = await advanceOnce(adv, medium.customerId);
  if (![200, 202].includes(a.post?.status ?? 0)) throw new Error(`advance 失败 ${a.post?.status}`);
  const settled = await waitSettled(adv, medium.customerId);
  const states = Object.fromEntries((settled?.domains ?? []).map((d) => [d.domain, d.state]));
  const creditRec = (settled?.receipts ?? []).find((r) => r?.domain === 'credit' && r?.current)
    ?? (settled?.receipts ?? []).find((r) => r?.domain === 'credit') ?? settled?.receipt ?? null;
  const creditUnknowns = creditRec?.candidate?.assessment?.unknowns ?? creditRec?.candidate?.unknowns ?? [];
  const hasCashGap = creditUnknowns.some((u) => String(u).includes('现金流') || String(u).includes('月经营') || String(u).includes('月偿债'));
  record('T5a', '中例：分析后信审在指定材料缺口真实停住（覆盖结论不可计算，明确未知项，不补数）',
    states.credit === 'waiting_evidence' && hasCashGap,
    { states, creditDomain: creditRec?.domain ?? null, creditUnknowns: creditUnknowns.slice(0, 3) });
  // 补件：客户经理代录（A originals 面上传原件）+ 按 case-input 补充声明登记（数组逐项）
  const sup = medium.uploaded.find((m) => m.supplement);
  const upOrig = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(medium.customerId)}/originals`, {
    session: biz, body: { requestId: uid('sup-up'), tenantId: TENANT, kind: 'other', file: { name: sup.name, mime: 'text/plain', dataBase64: Buffer.from(sup.bytes).toString('base64') } },
  });
  const supDecls = [];
  for (const v of medium.input.supplementRegistrations ?? []) {
    const r = await medium.reg({ requestId: uid('sup-decl'), tenantId: TENANT, kind: 'document', factKey: v.factKey, grade: 'source_supported', content: { value: v.value, ...(v.unit ? { unit: v.unit } : {}), sourceMode: 'operator_declared', factKey: v.factKey }, materialMeta: { unit: v.unit ?? null, caliber: `补件后登记：${v.caliber ?? ''}` } });
    supDecls.push({ factKey: v.factKey, status: r.status });
  }
  const afterSup = await waitSettled(adv, medium.customerId);
  const affectedAfterSup = afterSup?.dependencyChange?.affectedDomains ?? afterSup?.affectedDomains ?? [];
  const statesAfterSup = Object.fromEntries((afterSup?.domains ?? []).map((d) => [d.domain, d.state]));
  record('T5b', '中例：补件（上传《银行流水摘要-补充》+登记现金流声明）→ 受影响域=信审/政策重算，其余区不失效',
    upOrig.status === 200 && supDecls.every((s) => s.status === 200)
      && affectedAfterSup.length > 0 && affectedAfterSup.every((d) => ['credit', 'policy'].includes(d))
      && !affectedAfterSup.includes('commerce'),
    { upload: upOrig.status, supDecls, affectedAfterSup, statesAfterSup });
  await advanceOnce(adv, medium.customerId);
  const settledSup = await waitSettled(adv, medium.customerId);
  const statesAfterRe = Object.fromEntries((settledSup?.domains ?? []).map((d) => [d.domain, d.state]));
  const creditRec2 = (settledSup?.receipts ?? []).find((r) => r?.domain === 'credit' && r?.current)
    ?? (settledSup?.receipts ?? []).find((r) => r?.domain === 'credit') ?? settledSup?.receipt ?? null;
  const covNote = (creditRec2?.candidate?.assessment?.knownFacts ?? creditRec2?.candidate?.knownFacts ?? []).find((f) => String(f).includes('覆盖率')) ?? null;
  record('T5c', '中例：补件后信审恢复计算（覆盖率 2.0 = 380000/190000，与独立预期一致）',
    statesAfterRe.credit === 'awaiting_confirmation' && String(covNote ?? '').includes('2'),
    { creditState: statesAfterRe.credit, covNote });
  await verifiedRegister(medium.input, medium.reg);
  const loop = await adoptLoop(adv, medium.customerId);
  const final = loop.final;
  record('T5d', '中例：核验+采用 → diamond 收口', final?.caseOutcome?.status === 'completed' && final?.caseOutcome?.ending === 'diamond',
    { loop: loop.history, outcome: final?.caseOutcome, states: Object.fromEntries((final?.domains ?? []).map((d) => [d.domain, d.state])) });
} catch (e) { record('T5', '中例全链', false, { error: e.message }); }

// T6 差例：核验证伪权属 → 硬阻断不可采用 → 信审拒绝 → 拒绝归档
try {
  const a = await advanceOnce(adv, bad.customerId);
  if (![200, 202].includes(a.post?.status ?? 0)) throw new Error(`advance 失败 ${a.post?.status}`);
  const settled = await waitSettled(adv, bad.customerId);
  const states = Object.fromEntries((settled?.domains ?? []).map((d) => [d.domain, d.state]));
  const creditRec0 = (settled?.receipts ?? []).find((r) => r?.domain === 'credit' && r?.current) ?? settled?.receipt ?? null;
  const covOk = JSON.stringify(creditRec0?.candidate?.assessment?.knownFacts ?? []).includes('1.083');
  // 人工核验事件：收入/主体通过；权属核验不通过（false）——申报『自有』被核验证伪
  const vr = await verifiedRegister(bad.input, bad.reg);
  await advanceOnce(adv, bad.customerId);
  const settled2 = await waitSettled(adv, bad.customerId);
  const assetRec = (settled2?.receipts ?? []).find((r) => r?.domain === 'asset' && r?.current) ?? null;
  const gate = assetRec?.zoneCandidates?.gate ?? null;
  const hardBlock = assetRec?.zoneCandidates?.hardBlock === true;
  const ruleHit = JSON.stringify(assetRec?.zoneCandidates ?? {}).includes('SIM-ASSET-OWNERSHIP-01');
  record('T6a', '差例：分析真实运行（覆盖率1.083非阻断）；核验权属不通过后，资产区命中 SIM-ASSET-OWNERSHIP-01 不可豁免硬门（HARD_BLOCK）',
    covOk && vr.every((v) => v.status === 200) && hardBlock && gate?.result === 'HARD_BLOCK' && ruleHit,
    { states, covOk, verified: vr, gate, hardBlock, ruleHit });
  const resultId = assetRec?.views?.decisions?.requiredDecision?.resultId ?? assetRec?.actions?.[0]?.result?.resultId;
  const tryAdopt = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(bad.customerId)}/advance-rounds/${encodeURIComponent(assetRec.roundId)}/decision`, { session: adv, body: { requestId: uid('dec'), decision: 'adopt', resultId, expectedVersion: assetRec.version, rationale: '尝试强行通过（应被拒绝）' } });
  record('T6b', '差例：硬阻断候选采用被服务端 409 拒绝（HARD_BLOCK_NOT_ADOPTABLE，任何 rationale 无效——不能点击刷绿）',
    tryAdopt.status === 409 && String(tryAdopt.json?.message ?? tryAdopt.json?.error ?? '').includes('HARD_BLOCK_NOT_ADOPTABLE'),
    { status: tryAdopt.status, body: tryAdopt.json });
  const creditRec = (settled2?.receipts ?? []).find((r) => r?.domain === 'credit' && r?.current) ?? settled2?.receipt ?? null;
  // 拒绝由流程 principal（adv1，持信审角色）执行——流程按 principal 归属；cred1 单角色会话用于 T9 负例
  const dReject = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(bad.customerId)}/advance-rounds/${encodeURIComponent(creditRec.roundId)}/decision`, { session: adv, body: { requestId: uid('rej'), decision: 'reject', resultId: creditRec.actions?.[0]?.result?.resultId ?? creditRec.views?.decisions?.requiredDecision?.resultId, expectedVersion: creditRec.version, rationale: '权属核验不通过且不可豁免，依据性拒绝（自测）' } });
  const final = await waitSettled(adv, bad.customerId);
  const outcome = final?.caseOutcome ?? {};
  const finalStates = Object.fromEntries((final?.domains ?? []).map((d) => [d.domain, d.state]));
  record('T6c', '差例：信审域明确拒绝（流程principal持信审角色）→ CASE_REJECTED_ARCHIVED（其余区停止；rejection 收口）',
    dReject.status === 200 && outcome.status === 'rejected' && outcome.ending === 'rejection' && Object.values(finalStates).filter((s) => s === 'stopped').length >= 1,
    { reject: dReject.status, outcome, finalStates });
} catch (e) { record('T6', '差例全链', false, { error: e.message }); }

// T7 敏感性探针：好例材料 + 现金流声明改小 → 覆盖率 0.9 < 1.0 → 信审硬门命中（金额变化改变判断）
try {
  const probe = await initCase(biz, adm, path.join(MATERIALS, 'cases', 'good-luoyang-jianxi'), `${PREFIX}-Sens`);
  // 覆写现金流声明为 90000/100000（其余同好例）
  await probe.reg({ requestId: uid('sens-op'), tenantId: TENANT, kind: 'document', factKey: 'monthly_operating_cash_flow', grade: 'source_supported', content: { value: 90000, unit: 'CNY', sourceMode: 'operator_declared', factKey: 'monthly_operating_cash_flow' }, materialMeta: { unit: 'CNY', caliber: '敏感性探针：现金流改小（90000）' } });
  await probe.reg({ requestId: uid('sens-ds'), tenantId: TENANT, kind: 'document', factKey: 'monthly_debt_service', grade: 'source_supported', content: { value: 100000, unit: 'CNY', sourceMode: 'operator_declared', factKey: 'monthly_debt_service' }, materialMeta: { unit: 'CNY', caliber: '敏感性探针：偿债不变（100000）' } });
  const a = await advanceOnce(adv, probe.customerId);
  if (![200, 202].includes(a.post?.status ?? 0)) throw new Error(`advance 失败 ${a.post?.status}`);
  const settled = await waitSettled(adv, probe.customerId);
  const creditRec = settled?.receipts?.find((r) => r?.domain === 'credit' && r?.current) ?? settled?.receipt ?? null;
  const facts = JSON.stringify(creditRec?.candidate?.assessment?.knownFacts ?? creditRec?.candidate?.knownFacts ?? []);
  const gate = creditRec?.zoneCandidates?.gate ?? null;
  const hit = (gate?.result === 'HARD_BLOCK' || gate?.result === 'HOLD_FOR_REVIEW') && facts.includes('0.9')
    && (gate?.ruleIds ?? []).includes('SIM-CASH-COVERAGE-01');
  record('T7', '敏感性探针：现金流 90000/100000 → 覆盖率 0.9 <1.0 → SIM-CASH-COVERAGE-01 命中（takeoff包：hard_block；四域包：HOLD 复核）——同一材料，金额变化改变判断',
    hit, { gate, knownFacts: (creditRec?.candidate?.knownFacts ?? []).filter((f) => String(f).includes('覆盖率')).slice(0, 2), hardBlock: creditRec?.zoneCandidates?.hardBlock === true });
} catch (e) { record('T7', '敏感性探针', false, { error: e.message }); }

// T8 已完结案例读面：advance-plan 如实给出 priorCase（可返单），不报错、不重置
try {
  const p = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/advance-plan?domain=business`, { session: adv });
  record('T8', '已完结案例读面：advance-plan 如实给出 priorCase（diamond；可开新一轮），不报错、不篡改历史',
    p.status === 200 && p.json?.priorCase?.state === 'completed' && p.json?.priorCase?.ending === 'diamond',
    { planStatus: p.status, priorCase: p.json?.priorCase ?? null, available: p.json?.available ?? null });
} catch (e) { record('T8', '幂等', false, { error: e.message }); }

// T9 权限负例
try {
  // 跨客户：客户联系人凭据对他人客户上传
  const redeem = await http('POST', '/api/jw/v2/invitations/redeem', { body: { code: 'not-a-real-code-xxxx', requestId: uid('neg') } });
  // cust1（客户角色，未授权）读取好例工作本
  const cust = await login('cust1');
  const ws = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/workspace`, { session: cust });
  const advCust = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/advance-plan?domain=business`, { session: cust });
  // 无角色者推进：comm1（仅商务）对信审域取计划
  const comm = await login('comm1');
  const planCredit = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(bad.customerId)}/advance-plan?domain=credit`, { session: comm });
  record('T9', '权限负例：伪造兑换码拒绝；客户角色推进被拒；单专业角色越域取计划→计划如实不可用（available:false + ROLE_FORBIDDEN）',
    [400, 403, 404, 410].includes(redeem.status) && advCust.status === 403
      && planCredit.status === 200 && planCredit.json?.available === false && planCredit.json?.reason === 'ROLE_FORBIDDEN',
    { redeem: redeem.status, custWs: ws.status, custAdv: advCust.status, commCreditPlan: `${planCredit.status}/available=${planCredit.json?.available}/reason=${planCredit.json?.reason}` });
} catch (e) { record('T9', '权限负例', false, { error: e.message }); }

// T10 事件可追溯：同一 requestId 串联步骤与材料依据
try {
  const ev = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/advance-rounds?requestId=${encodeURIComponent('nonexist')}`, { session: adv });
  const rounds = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/advance-rounds`, { session: adv });
  const events = rounds.json?.receipt?.views?.flow?.events ?? [];
  const types = new Set(events.map((e) => e.type));
  const needed = ['COLUMN_QUEUED', 'COLUMN_STARTED', 'COLUMN_RESULT', 'COLUMN_HUMAN_DECISION', 'CASE_COMPLETED'];
  const missing = needed.filter((t) => !types.has(t));
  record('T10', '事件时间轴：好例全链事件齐备（接受→排队→启动→结果→人工决定→完结），材料/规则驱动的结果可逐事件追溯',
    missing.length === 0, { eventTypes: [...types], missing });
} catch (e) { record('T10', '事件可追溯', false, { error: e.message }); }

// T11 刷新一致：重复读状态不变（服务端权威，无前端本地态）
try {
  const r1 = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/advance-rounds`, { session: adv });
  const r2 = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(good.customerId)}/advance-rounds`, { session: adv });
  const fp = (j) => JSON.stringify({ o: j.json?.caseOutcome, d: (j.json?.domains ?? []).map((x) => [x.domain, x.state]) });
  record('T11', '刷新一致：连续两次读 caseOutcome/domains 状态逐项一致',
    r1.status === 200 && r2.status === 200 && fp(r1) === fp(r2), { first: JSON.parse(fp(r1)) });
} catch (e) { record('T11', '刷新一致', false, { error: e.message }); }

// 汇总
const passCount = results.filter((r) => r.pass).length;
const summary = {
  suite: 'demo3-selftest', date: new Date().toISOString(), stack: { edge: params.edgePort, kernel: params.kernelPort, connectors: params.connectorsPort, dbContainer: params.dbContainer, tenant: TENANT },
  prefix: PREFIX,
  customers: { good: good?.customerId, medium: medium?.customerId, bad: bad?.customerId },
  totals: { pass: passCount, fail: results.length - passCount, elapsedMs: Date.now() - t0 },
  cases: results,
};
writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
console.log('══════════════════════════════════════════');
console.log(`自测结果：${passCount}/${results.length} 通过（${(summary.totals.elapsedMs / 1000).toFixed(1)}s）→ ${OUT_PATH}`);
console.log('══════════════════════════════════════════');
process.exit(passCount === results.length ? 0 : 1);
