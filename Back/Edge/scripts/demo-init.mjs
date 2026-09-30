// 三案例演示初始化（03路 · 2026-09-29集成轮）。docs/integration/2026-09-29/materials/CASES.json 的执行入口。
// 职责：通过**正式服务接口**幂等初始化三客户/材料/授权——建档、受限邀请与进件绑定、材料上传
// （真实 Connectors 解析链）、操作员声明登记（融资需求/尽调录入口径）、客户授权登记。
// 纪律（00_CONTRACT.md）：
//   - 不直接写数据库造已完成结果；不发起分析/推进/人工核验（演示从初始阶段开始：
//     已预载材料 ≠ 分析/核验完成）。
//   - 幂等：客户按 legalEntityRef 判重（服务端 409 CUSTOMER_EXISTS 归位）；材料按内容寻址
//     （同字节 duplicateOf 判重）；声明/授权按确定性 requestId（同载荷重放 reused）。
//     重跑收敛到同一服务端状态，不产生重复事实。
//   - 案例标签（good/medium/bad）只存在于材料包文档，不进入任何被测系统调用；
//     声明内容来自 case-input.json 的字面清单（与案例标签无关，中例补件项初始化时跳过）。
//   - 凭据（客户联系人凭据）只写 Git 排除的 RUN_DIR/demo-state.json；本脚本输出一律脱敏。
// 用法：JW_INTEG_RUN_SUBDIR=demo03 node Back/Edge/scripts/demo-init.mjs
//       [--materials <materials目录>] [--verify-only] [--out <结果json路径>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { EDGE_ROOT, REPO_ROOT, RUN_DIR, loadParams, ok, info, fail } from './integration-lib.mjs';

const TENANT = 't1';
const ALLOWED_KINDS = ['financial_statement', 'invoice', 'bank_statement', 'order_contract', 'equipment_list', 'litigation_document', 'other', 'legal_document'];
const CONTACT_LABEL_SUFFIX = '（客户联系人·演示）';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const shortHash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
const argOf = (argv, name, dflt = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };

const argv = process.argv.slice(2);
const MATERIALS = path.resolve(argOf(argv, '--materials', path.join(REPO_ROOT, 'docs', 'integration', '2026-09-29', 'materials')));
const VERIFY_ONLY = argv.includes('--verify-only');
const OUT_PATH = argOf(argv, '--out', path.join(RUN_DIR, 'demo-init-results.json'));
const STATE_PATH = path.join(RUN_DIR, 'demo-state.json');

const params = loadParams();
if (!params) fail('params.json 不存在：先运行 integration-up（JW_INTEG_RUN_SUBDIR=demo03）');
const EDGE = `http://127.0.0.1:${params.edgePort}`;

// ---- HTTP 帮助（与 integration-smoke 同型：Edge 同源会话面）----
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
const login = async (principalId) => {
  const r = await http('POST', '/api/jw/v2/session', { body: { principalId } });
  if (r.status !== 200 || !r.json?.session?.sessionId) throw new Error(`登录 ${principalId} 失败: ${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
  return r.json.session.sessionId;
};
const loginWithCredential = async (credential) => {
  const r = await http('POST', '/api/jw/v2/session', { body: { credential } });
  if (r.status !== 200 || !r.json?.session?.sessionId) throw new Error(`凭据会话失败: ${r.status}`);
  return r.json.session.sessionId;
};
async function waitTask(session, customerId, taskId, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await new Promise((x) => setTimeout(x, 1200));
    last = await http('GET', `/api/jw/v2/connectors/processing/tasks/${encodeURIComponent(taskId)}?tid=${encodeURIComponent(TENANT)}&cid=${encodeURIComponent(customerId)}`, { session });
    const st = last.json?.task?.status;
    if (['done', 'needs_followup', 'failed', 'blocked_unknown', 'blocked_link', 'blocked_a_unavailable', 'skipped_duplicate'].includes(st)) return last.json?.task ?? null;
  }
  throw new Error(`任务 ${taskId} 超时：${last?.status}`);
}

// ---- 状态文件（联系人凭据续用；Git 排除）----
function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) { mkdirSync(RUN_DIR, { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

// ---- 服务端状态探查（幂等判据以服务端为准）----
async function findCustomerByRef(biz, legalEntityRef) {
  // 目录 search 同时匹配 display_name/customer_id/legal_entity_ref（A G1）；返回行不含 legalEntityRef，
  // 以唯一 ref 检索后取首个命中行。
  const r = await http('GET', `/api/jw/v2/customers?search=${encodeURIComponent(legalEntityRef)}`, { session: biz });
  const hit = (r.json?.customers ?? [])[0];
  return hit?.customerId ?? null;
}
async function workspaceArtifactDigests(biz, customerId) {
  const r = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/workspace`, { session: biz });
  if (r.status !== 200) return { hashes: new Set(), factKeys: new Set() };
  const arts = r.json?.snapshot?.artifacts ?? [];
  const hashes = new Set(arts.map((a) => a.sha256).filter(Boolean));
  const factKeys = new Set(arts.filter((a) => a.factKey ?? a.fact_key).map((a) => a.factKey ?? a.fact_key));
  return { hashes, factKeys };
}

// ---- 主流程 ----
const t0 = Date.now();
const results = { suite: 'demo3-init', date: new Date().toISOString(), edge: params.edgePort, tenant: TENANT, cases: [], errors: [] };
const state = loadState();
const CASE_DIR_BY_ID = {};

let biz, adm;
try {
  biz = await login('biz1');
  adm = await login('adm1');
} catch (e) { fail(`会话建立失败（栈就绪后重试）: ${e.message}`); }
ok(`会话就绪（biz1/adm1）→ ${EDGE}`);

const casesRoot = path.join(MATERIALS, 'cases');
const caseDirs = existsSync(casesRoot)
  ? (await import('node:fs')).readdirSync(casesRoot).map((d) => path.join(casesRoot, d)).filter((d) => existsSync(path.join(d, 'case-input.json'))).sort()
  : [];
if (caseDirs.length === 0) fail(`材料包缺案例目录：${casesRoot}`);

for (const caseDir of caseDirs) {
  const input = JSON.parse(readFileSync(path.join(caseDir, 'case-input.json'), 'utf8'));
  const caseId = input.caseId;
  CASE_DIR_BY_ID[caseId] = path.basename(caseDir);
  const row = { caseId, displayName: input.displayName, legalEntityRef: input.legalEntityRef };
  console.log(`\n──── ${caseId} ${input.displayName} ────`);
  try {
    // 1) 建档（幂等：先查目录，再创建；409 归位为已存在）
    let customerId = state[caseId]?.customerId ?? null;
    if (customerId) {
      const still = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}`, { session: biz }).catch(() => ({ status: 0 }));
      if (![200].includes(still.status)) customerId = null;
    }
    if (!customerId) customerId = await findCustomerByRef(biz, input.legalEntityRef);
    if (!customerId) {
      const mk = await http('POST', '/api/jw/v2/actions/customers', {
        session: biz,
        body: { requestId: `demo3-${caseId}-create`, tenantId: TENANT, legalEntityRef: input.legalEntityRef, displayName: input.displayName },
      });
      if (mk.status === 200 && mk.json?.customerId) { customerId = mk.json.customerId; ok(`建档 ${customerId}（正式接口）`); }
      else if (mk.status === 409) { customerId = await findCustomerByRef(biz, input.legalEntityRef); info(`客户已存在（409 判重归位）→ ${customerId}`); }
      if (!customerId) throw new Error(`建档失败: ${mk.status} ${JSON.stringify(mk.json)?.slice(0, 200)}`);
    } else info(`客户已存在 → ${customerId}（跳过建档）`);
    row.customerId = customerId;

    // 2) 联系人（受限邀请→兑换；凭据只存 RUN_DIR/demo-state.json）
    let contact = state[caseId]?.contact ?? null;
    let contactSession = null;
    if (contact?.credential) {
      try { contactSession = await loginWithCredential(contact.credential); } catch { contactSession = null; }
    }
    if (!contactSession) {
      const inv = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/invitations`, {
        session: biz,
        body: { requestId: `demo3-${caseId}-inv-${Date.now().toString(36)}`, tenantId: TENANT, role: 'customer-finance', allowedKinds: ALLOWED_KINDS, expiresInHours: 24 },
      });
      const code = inv.json?.invitation?.code ?? inv.json?.code;
      const redeem = await http('POST', '/api/jw/v2/invitations/redeem', { body: { code, requestId: `demo3-${caseId}-redeem-${Date.now().toString(36)}` } });
      const cred = redeem.json?.credential;
      contactSession = await loginWithCredential(cred);
      contact = { principalId: redeem.json?.principalId, credential: cred };
      ok(`客户联系人就绪（受限邀请链；凭据仅存运行目录）`);
    } else info('客户联系人会话复用（状态文件）');
    state[caseId] = { ...(state[caseId] ?? {}), customerId, contact };

    // 3) 进件邀请+绑定（幂等：已有可用绑定则上传自然成功；重复签发不影响内容寻址判重）
    let invitationId = state[caseId]?.invitationId ?? null;
    const upCtx = await http('GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    if (!(upCtx.json?.available === true)) {
      const ii = await http('POST', '/api/jw/v2/actions/connectors/intake/invitations', {
        session: biz,
        body: { requestId: `demo3-${caseId}-intake-${Date.now().toString(36)}`, tenantId: TENANT, customerId, role: 'customer_finance', allowedEvidenceKinds: ALLOWED_KINDS, ttlSec: 86400 },
      });
      invitationId = ii.json?.invitationId;
      const acc = await http('POST', '/api/jw/v2/actions/connectors/intake/accept', {
        session: contactSession,
        body: { requestId: `demo3-${caseId}-accept-${Date.now().toString(36)}`, tenantId: TENANT, token: ii.json?.token, provider: 'jw_principal', providerUserId: contact.principalId },
      });
      const vb = await http('POST', '/api/jw/v2/actions/connectors/intake/verify-binding', {
        session: biz,
        body: { requestId: `demo3-${caseId}-bind-${Date.now().toString(36)}`, tenantId: TENANT, customerId, bindingId: acc.json?.bindingId, verifiedBy: '演示初始化（business）', evidenceRefs: [`invitation:${invitationId}`] },
      });
      if (vb.status !== 200) throw new Error(`绑定核验失败: ${vb.status} ${JSON.stringify(vb.json)?.slice(0, 160)}`);
      ok(`进件绑定就绪（invitation=${invitationId}）`);
    } else info('进件上下文可用（跳过重复绑定）');
    state[caseId].invitationId = invitationId;

    // 4) 初始材料上传（真实解析链；幂等=同字节 duplicateOf 判重；supplement 角色文件不上传）
    const { hashes: knownHashes } = await workspaceArtifactDigests(biz, customerId);
    row.materials = [];
    for (const f of input.files.filter((f) => f.role === 'initial')) {
      const bytes = readFileSync(path.join(caseDir, 'originals', f.name));
      const digest = sha256(bytes);
      if (knownHashes.has(digest)) { row.materials.push({ name: f.name, sha256: digest, note: '已登记（内容寻址判重，跳过）' }); continue; }
      const up = await http('POST', '/api/jw/v2/actions/connectors/evidence/upload', {
        session: contactSession,
        body: { requestId: `demo3-${caseId}-up-${digest.slice(0, 8)}`, customerId, tenantId: TENANT, invitationId, kind: f.kind, name: f.name, contentBase64: bytes.toString('base64'), contentType: f.name.endsWith('.csv') ? 'text/csv' : 'text/plain' },
      });
      if (up.status !== 200) throw new Error(`上传 ${f.name} 失败: ${up.status} ${JSON.stringify(up.json)?.slice(0, 160)}`);
      const taskId = up.json?.processing?.taskId;
      const task = taskId ? await waitTask(biz, customerId, taskId) : null;
      row.materials.push({ name: f.name, kind: f.kind, sha256: up.json?.sha256 ?? digest, evidenceId: up.json?.evidenceId ?? null, duplicateOf: up.json?.duplicateOf ?? null, taskStatus: task?.status ?? null });
      ok(`材料上传→解析→登记：${f.name}（task=${task?.status}${up.json?.duplicateOf ? '，判重=' + up.json.duplicateOf : ''}）`);
    }
    if (row.materials.length === 0) row.materials.push({ note: '全部已登记' });
    if (input.files.some((f) => f.role === 'supplement')) {
      row.supplementPrepared = input.files.filter((f) => f.role === 'supplement').map((f) => f.name);
      info(`补充材料已备于材料包（${row.supplementPrepared.join('、')}）：初始化不上传——补件是演示中的用户事件`);
    }

    // 5) 操作员声明登记（source_supported，operator_declared；幂等=确定性 requestId + 服务端 factKey 检查）
    const { factKeys: knownFactKeys } = await workspaceArtifactDigests(biz, customerId);
    const scopeBody = {
      requestId: `demo3-${caseId}-scope`, tenantId: TENANT, kind: 'document', factKey: 'transaction_scope', grade: 'source_supported',
      content: { value: { orgType: input.transaction.orgType, product: input.transaction.product, region: input.transaction.region, customerRange: 'standard' }, sourceMode: 'operator_declared', factKey: 'transaction_scope' },
      materialMeta: { unit: null, caliber: 'operator_declared_requirement' },
    };
    const decls = [{ factKey: 'transaction_scope', body: scopeBody }];
    for (const [k, v] of Object.entries(input.declaredRequirements ?? {})) {
      decls.push({
        factKey: k,
        body: {
          requestId: `demo3-${caseId}-decl-${k}-${shortHash(JSON.stringify(v.value))}`, tenantId: TENANT, kind: 'document', factKey: k, grade: 'source_supported',
          content: { value: v.value, ...(v.unit ? { unit: v.unit } : {}), sourceMode: 'operator_declared', factKey: k },
          materialMeta: { unit: v.unit ?? null, caliber: v.caliber ?? 'operator_declared_requirement' },
        },
      });
    }
    row.declarations = [];
    for (const d of decls) {
      if (knownFactKeys.has(d.factKey)) { row.declarations.push({ factKey: d.factKey, note: '已登记（跳过）' }); continue; }
      const reg = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/artifacts`, { session: biz, body: d.body });
      if (reg.status !== 200) throw new Error(`声明 ${d.factKey} 登记失败: ${reg.status} ${JSON.stringify(reg.json)?.slice(0, 160)}`);
      row.declarations.push({ factKey: d.factKey, artifactId: reg.json?.artifactId ?? null });
    }
    ok(`声明登记完成：${row.declarations.filter((d) => !d.note).length} 新登记 / ${row.declarations.filter((d) => d.note).length} 已存在`);

    // 6) 客户授权（admin 正式接口；adv1/cred1 需要客户面操作授权）
    row.grants = [];
    for (const grantee of ['adv1', 'cred1']) {
      const g = await http('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/grants`, {
        session: adm,
        body: { requestId: `demo3-${caseId}-grant-${grantee}`, tenantId: TENANT, principalId: grantee },
      });
      if (![200, 409].includes(g.status)) throw new Error(`授权 ${grantee} 失败: ${g.status} ${JSON.stringify(g.json)?.slice(0, 160)}`);
      row.grants.push({ principalId: grantee, status: g.status, note: g.json?.replayed ? 'replayed' : undefined });
    }
    ok('客户授权登记（adv1/cred1，admin 正式接口）');

    // 7) 明确不做：不推进、不核验、不采用（演示从初始阶段开始）
    const rounds = await http('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/advance-rounds/active`, { session: biz });
    row.advanceStateAtInit = rounds.status === 200 ? (rounds.json?.receipt?.state ?? 'not_started') : `http:${rounds.status}`;
    info(`推进状态（应为初始）：${row.advanceStateAtInit}；初始化不发起分析/核验`);
    results.cases.push(row);
    saveState(state);
  } catch (e) {
    results.errors.push(`${caseId}: ${e.message}`);
    console.error(`[demo-init] ✗ ${caseId}: ${e.message}`);
  }
}

// ---- 显式案例 manifest（01 NEEDS §1 形状；scenarioLabel 仅为卡片档位配置目标，scenarioIsOutcome:false）----
// 该文件同时是 Edge --arrow-cases-fallback 的回退体：A 未实现 arrow-cases 时由 Edge 只读回退；
// 02 落地 A 实现后本文件自动退为备份（Edge 每请求重读，更新即时生效）。
const manifestPath = path.join(RUN_DIR, 'arrow-cases-manifest.json');
const manifest = {
  ok: true,
  manifestVersion: 'parallel-arrows-cases-v1',
  generatedAt: new Date().toISOString(),
  source: 'demo-init（03路）；案例配置目标标签不构成审批结果，结论只由材料与激活规则包计算',
  cases: results.cases.map((c) => {
    const input = JSON.parse(readFileSync(path.join(casesRoot, CASE_DIR_BY_ID[c.caseId] ?? '', 'case-input.json'), 'utf8'));
    return {
      caseId: c.caseId, customerId: c.customerId, displayName: c.displayName,
      scenarioLabel: input.scenario === 'good' ? '好' : input.scenario === 'medium' ? '中' : '差',
      scenarioKey: input.scenario, industry: input.industry ?? null,
      annualRevenueCny: input.annualRevenueCny ?? null,
      sourceMode: 'synthetic', scenarioIsOutcome: false,
    };
  }),
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
ok(`arrow-cases 回退清单已写出 ${path.relative(REPO_ROOT, manifestPath)}（${manifest.cases.length} 案例；A 实现后自动休眠）`);

// ---- 收尾校验：目录恰好三案例 + 全部初始就绪 ----
if (!VERIFY_ONLY && results.errors.length === 0) {
  const dir = await http('GET', '/api/jw/v2/customers', { session: biz });
  const list = dir.json?.customers ?? dir.json?.items ?? [];
  results.directoryAtEnd = (Array.isArray(list) ? list : []).map((c) => ({ customerId: c.customerId ?? c.customer_id, displayName: c.displayName ?? c.display_name }));
  const expectIds = results.cases.map((c) => c.customerId).sort();
  const gotIds = results.directoryAtEnd.map((c) => c.customerId).sort();
  results.directoryExactThree = JSON.stringify(expectIds) === JSON.stringify(gotIds);
  results.directoryExactThree ? ok(`演示目录校验：恰好三案例客户`) : results.errors.push(`目录含意外客户: ${JSON.stringify(results.directoryAtEnd)}`);
}

results.totals = { cases: results.cases.length, errors: results.errors.length, elapsedMs: Date.now() - t0 };
mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
saveState(state);
console.log('──────────────────────────────────────────────');
if (results.errors.length > 0) {
  console.error(`[demo-init] 完成（含 ${results.errors.length} 个错误）→ ${OUT_PATH}`);
  process.exit(1);
}
console.log(`[demo-init] ✓ 三案例初始化收敛（${(results.totals.elapsedMs / 1000).toFixed(1)}s）→ ${OUT_PATH}`);
console.log('[demo-init] 未发起任何分析/核验/采用：演示从初始阶段开始（材料已备 ≠ 结论已出）');
console.log(`[demo-init] 客户联系人凭据仅存 ${path.relative(REPO_ROOT, STATE_PATH)}（Git 排除；请勿提交）`);
