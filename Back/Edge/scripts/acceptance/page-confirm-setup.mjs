// TAKEOFF-FA-1.0.0 路04 · 页面确认装配（T09 页面侧前置）：把一个全新合成客户经真实命令链
// 驱动到 awaiting_human_review 且 Gate=CLEAR；确认动作本身留给有权人员在真实页面执行。
// 全部走 Edge 正常服务入口（不 SQL 补结果）；输出 page-confirm-target.json 供页面取证用。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1].replace(/\/$/, '') : 'http://127.0.0.1:48214';
const TENANT = 'tt1';
const EV = resolve(here, '..', '..', '.run', 'takeoff', 'acceptance');
const FX = resolve(here, '..', '..', 'test', 'fixtures', 'takeoff', 'materials');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[setup] ${m}`);

async function api(path, { method = 'GET', session, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(session ? { 'x-jw-session': session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { }
  return { status: res.status, json };
}
const sessions = {};
async function login(pid) {
  const r = await api('/api/jw/v2/session', { method: 'POST', body: { principalId: pid } });
  if (r.status !== 200) throw new Error(`登录失败 ${pid}`);
  sessions[pid] = r.json.session.sessionId;
  return r.json.session.sessionId;
}
const rq = (p) => `page-confirm-${p}-${Date.now().toString(36)}`;
const biz = await login('biz1');
const cust = await login('cust1');
const cred = await login('cred1');

// 客户 + 邀请 + 接受
const runTag = Date.now().toString(36);
const custR = await api('/api/jw/v2/actions/customers', { method: 'POST', session: biz, body: { requestId: rq('cust'), tenantId: TENANT, legalEntityRef: `SYNTHETIC-PAGE-2026-${runTag}`, displayName: `页面确认演练（合成 ${runTag}）有限公司` } });
if (custR.status !== 200) throw new Error(`建户失败: ${JSON.stringify(custR.json)}`);
const customerId = custR.json.customerId;
log(`customer=${customerId}`);
const kinds = ['legal_document', 'financial_statement', 'equipment_list', 'ownership_document', 'order_contract', 'litigation_document'];
const inv = await api('/api/jw/v2/actions/connectors/intake/invitations', { method: 'POST', session: biz, body: { tenantId: TENANT, customerId, role: 'customer_contact', allowedEvidenceKinds: kinds, ttlSec: 7200, requestId: rq('inv') } });
const invitationId = inv.json.invitationId;
const token = inv.json.token ?? inv.json.invitationToken;
await api('/api/jw/v2/actions/connectors/intake/accept', { method: 'POST', session: cust, body: { tenantId: TENANT, invitationId, token, provider: 'synthetic_portal', providerUserId: `cust-portal-${customerId.slice(-6)}`, requestId: rq('acc') } });

const evidenceIds = {};
const up = async (file, kind, note, extra = {}) => {
  const b = readFileSync(join(FX, file));
  const r = await api('/api/jw/v2/actions/connectors/evidence/upload', {
    method: 'POST', session: cust,
    body: { tenantId: TENANT, customerId, invitationId, kind, contentType: file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.png') ? 'image/png' : 'text/csv', contentBase64: b.toString('base64'), requestId: rq(`up-${file}`), caliber: note ?? null, ...extra },
  });
  if (r.status !== 200 || r.json?.ok !== true) throw new Error(`上传 ${file} 失败: ${JSON.stringify(r.json)}`);
  if (r.json?.evidenceId) evidenceIds[file] = r.json.evidenceId;
};
await up('N1-business-license.pdf', 'legal_document');
await up('N2-balance-sheet.csv', 'financial_statement');
await up('N3-equipment-list.csv', 'equipment_list');
await up('N4-ownership-invoice.png', 'ownership_document');
// 无未决诉讼声明（declared 级事实；撤诉/已结案文本→litigation_pending_declared=false）
await up('A2-litigation-withdrawal.pdf', 'litigation_document', '无未决诉讼声明（合成；结案状态声明）');
log('N1–N4+声明件已传，等待登记+收口…');
for (let i = 0; i < 45; i++) {
  await sleep(2000);
  const ar = await api(`/api/jw/v2/customers/${customerId}/artifacts`, { session: biz });
  const arts = Array.isArray(ar.json?.artifacts) ? ar.json.artifacts : ar.json?.items ?? [];
  if (arts.length >= 5) break;
}
// 清晰身份件取代模糊件（同 kind 双现行=事实冲突，正面确认会被阻断）
await up('N5-entity-identity-license.png', 'legal_document', '主体身份重扫（supersedes N1）', { supersedesEvidenceId: evidenceIds['N1-business-license.pdf'] });
await sleep(6000);

// 人工转录（录入=biz；核验=cred——转录≠核验分离）
const manual = async (key, facts, reason) => {
  const r = await api('/api/jw/v2/actions/connectors/evidence/manual-entry', { method: 'POST', session: biz, body: { tenantId: TENANT, customerId, evidenceId: evidenceIds[key], facts, reason, requestId: rq(`me-${key}`) } });
  if (r.status !== 200) throw new Error(`转录 ${key} 失败: ${JSON.stringify(r.json)}`);
};
await manual('N4-ownership-invoice.png', [{ factKey: 'equipment_ownership_verified', value: true, location: '发票联（合成转录）' }], '发票原件人工转录（合成验收）');
await manual('N5-entity-identity-license.png', [{ factKey: 'entity_identity_verified', value: true, location: '执照信息（合成转录）' }], '执照原件人工转录（合成验收）');
await manual('N2-balance-sheet.csv', [
  { factKey: 'top1_customer_revenue_share', value: 62, unit: '%', location: '客户集中度声明（合成转录）' },
  { factKey: 'monthly_operating_cash_flow', value: 254, unit: 'wan_cny_per_month', location: 'N2 经营数据补充（合成）' },
  { factKey: 'monthly_debt_service', value: 60, unit: 'wan_cny_per_month', location: 'N2 负债偿付推算（合成）' },
], '集中度/现金流/偿债输入转录（合成验收，转录≠核验）');
await sleep(4000);

// 人工核验全部可核验问题（涉诉不存在：本客户未上传诉讼件）
let verifiedN = 0;
{
  const st = await api(`/api/jw/v2/connectors/processing/status?tid=${TENANT}&cid=${customerId}`, { session: biz });
  const qs = Array.isArray(st.json?.questions) ? st.json.questions : [];
  const verifiable = qs.filter((q) => ['material_received', 'suggested', 'answered'].includes(q.status) && (q.target_fact ?? q.binding?.objectRef ?? '') !== 'litigation_pending_declared' && q.question_key);
  for (const q of verifiable) {
    const v = await api('/api/jw/v2/actions/connectors/questions/verify', { method: 'POST', session: cred, body: { tenantId: TENANT, customerId, questionKey: q.question_key, note: '页面确认前置：人工核验（合成验收）', requestId: rq(`qv-${q.question_key}`) } });
    if (v.status === 200) verifiedN += 1;
    await sleep(1500);
  }
  log(`核验 ${verifiedN}/${verifiable.length}`);
}

// 等 Gate=CLEAR
let fin = null;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  const fr = await api(`/api/jw/v2/connectors/analysis/finalization?tid=${TENANT}&cid=${customerId}`, { session: biz });
  const f = fr.json?.finalization ?? null;
  const gate = f?.gate?.result ?? f?.gate ?? null;
  if (gate === 'CLEAR') { fin = f; break; }
}
if (!fin) throw new Error('Gate 未达 CLEAR');
log(`finId=${fin.finId} gate=CLEAR`);

// 当前工件快照 → 评估 → 候选（CLEAR 收口推导）→ 提交人工审阅
const ar = await api(`/api/jw/v2/customers/${customerId}/artifacts`, { session: biz });
const list = Array.isArray(ar.json?.artifacts) ? ar.json.artifacts : ar.json?.items ?? [];
const current = list.filter((a) => String(a.kind ?? '').startsWith('material.') && !a.supersededBy && !a.superseded_by && !a.duplicateOf && !a.duplicate_of).map((a) => a.artifactId ?? a.artifact_id);
const asR = await api(`/api/jw/v2/actions/customers/${customerId}/assessments`, { method: 'POST', session: cred, body: { requestId: rq('as'), tenantId: TENANT, ruleVersion: fin.rulesetVersion, evidenceSnapshot: current.map((artifactId) => ({ artifactId })) } });
const assessmentId = asR.json.assessmentId;
const toATendency = (t) => (t === 'increase' ? 'do' : t === 'decrease' ? 'no_do' : t === 'hold' ? 'cautious_do' : 'cautious_do');
const candR = await api(`/api/jw/v2/actions/assessments/${assessmentId}/candidate`, {
  method: 'POST', session: biz,
  body: {
    requestId: rq('cand'), tenantId: TENANT,
    candidate: {
      tendency: toATendency(fin.amountCandidate?.tendency),
      supportableAmountMinor: fin.amountCandidate?.supportable?.max != null ? Math.round(fin.amountCandidate.supportable.max * 100) : null,
      suggestedTermMonths: fin.amountCandidate?.suggestedTerm?.value ?? null,
      referencePriceMinor: fin.amountCandidate?.referencePrice?.value != null ? Math.round(fin.amountCandidate.referencePrice.value * 100) : null,
      priceUnit: 'cny_per_annum',
      priceBasis: '合成名义口径（非机构定价）',
      basisRefs: current.slice(0, 5),
      changeReason: '页面确认演练候选（CLEAR 收口推导）',
      rationale: '全部前提经人工核验与撤诉纠正（合成验收）',
      producedBy: 'page-confirm-setup',
      warnings: [],
    },
  },
});
const sr = await api(`/api/jw/v2/actions/assessments/${assessmentId}/submit-review`, { method: 'POST', session: cred, body: { requestId: rq('sr'), tenantId: TENANT } });
if (sr.status !== 200) throw new Error(`提交审阅失败: ${JSON.stringify(sr.json)}`);
const out = { customerId, assessmentId, invitationId, finId: fin.finId, verifiedN, at: new Date().toISOString() };
writeFileSync(join(EV, 'page-confirm-target.json'), JSON.stringify(out, null, 2));
log(`就绪：${JSON.stringify(out)}`);
