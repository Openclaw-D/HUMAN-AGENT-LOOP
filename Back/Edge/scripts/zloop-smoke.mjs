// V0.3 zcode-real-loop · API 冒烟（2026-09-20）。
// 目的：页面验收前先确认隔离真实栈后端链（A 登记 → Connectors 上传/解析 → Edge decisions →
// 真实 GLM 候选分析）。一次真实付费调用，账本/回执落本路 run-dir。
// 用法：node Back/Edge/scripts/zloop-smoke.mjs [--skip-upload]
// 输出：docs/v0.3/zcode-real-loop/evidence/smoke-result.json（脱敏：不含密钥/令牌）。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MATERIALS = path.join(REPO_ROOT, 'docs', 'materials', 'kashgar-demo-v1');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'v0.3', 'zcode-real-loop', 'evidence');
const A = 'http://127.0.0.1:48304';
const CONN = 'http://127.0.0.1:48284';
const EDGE = 'http://127.0.0.1:48324';
const TENANT = 'tt1';
const SERVICE_TOKEN = fs.readFileSync(path.join(REPO_ROOT, 'Back', 'Edge', '.run', 'zloop', 'connectors-token.txt'), 'utf8').trim();

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const result = { at: new Date().toISOString(), steps: [] };
  const step = (name, ok, detail) => {
    result.steps.push({ name, ok, detail: typeof detail === 'string' ? detail.slice(0, 500) : detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 400)}`}`);
    if (!ok) process.exitCode = 1;
  };

  // 1) A 建客户（business 人类凭据 tk-biz1）
  const custRes = await fetch(`${A}/api/v2/customers`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-principal-credential': 'tk-biz1' },
    body: JSON.stringify({ requestId: `zloop-smoke-${Date.now().toString(36)}`, credential: 'tk-biz1', tenantId: TENANT, legalEntityRef: 'SYNTHETIC-KS-LASER-500-smoke', displayName: '喀什示例金属加工有限公司（激光·合成·冒烟）' }) });
  const cust = await custRes.json();
  const customerId = cust.customerId;
  step('A建客户', custRes.status === 200 && typeof customerId === 'string', { status: custRes.status, customerId });

  if (!process.argv.includes('--skip-upload')) {
    // 2) Connectors 邀请+上传 D01/D02
    const connApi = async (p, body) => {
      const r = await fetch(`${CONN}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': SERVICE_TOKEN }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };
    const inv = await connApi('/api/connectors/intake/invitations', { tenantId: TENANT, customerId, role: 'customer_finance', allowedEvidenceKinds: ['statement', 'document'], objectRefs: [], ttlSec: 3600, createdBy: 'zloop-smoke' });
    step('Connectors邀请', inv.status === 200 && !!inv.json?.invitationId, { status: inv.status, invitationId: inv.json?.invitationId });
    await connApi('/api/connectors/intake/accept', { tenantId: TENANT, token: inv.json.token, provider: 'wecom_kf', providerUserId: `wx-${inv.json.invitationId}` });
    const uploaded = [];
    for (const rel of ['KS-LASER-500/originals/D01-融资需求登记.pdf', 'KS-LASER-500/originals/D02-主体登记资料.pdf']) {
      const bytes = fs.readFileSync(path.join(MATERIALS, rel));
      const up = await connApi('/api/connectors/evidence/upload', { tenantId: TENANT, customerId, invitationId: inv.json.invitationId, kind: 'document',
        contentBase64: bytes.toString('base64'), contentType: 'application/octet-stream', periodFrom: null, periodTo: null, currency: 'CNY', caliber: '权责发生' });
      uploaded.push({ rel, sha256: sha256(bytes), ...(up.json?.evidenceId ? { evidenceId: up.json.evidenceId } : {}) });
      step(`上传${path.basename(rel)}`, up.status === 200, { status: up.status, evidenceId: up.json?.evidenceId ?? null });
    }
    result.uploaded = uploaded;
    // 3) 驱动处理链 + 等 a_links registered（现行解析就绪）
    for (let i = 0; i < 20; i++) { const t = await connApi('/api/connectors/processing/tick', { maxTasks: 8 }); if ((t.json?.claimed ?? 1) === 0) break; }
    const deadline = Date.now() + 60000;
    let registered = 0;
    for (;;) {
      const r = await fetch(`${A}/api/v2/customers/${encodeURIComponent(customerId)}/artifacts`, { headers: { 'x-principal-credential': 'tk-biz1' } });
      const j = await r.json().catch(() => ({}));
      registered = (j.artifacts ?? j.items ?? []).length;
      if (registered >= 2 || Date.now() > deadline) break;
      await sleep(800);
    }
    step('A登记材料(a_links→artifacts)', registered >= 2, { registered });
  }

  // 4) Edge 会话 + decisions 真实候选分析（一次真实 GLM 调用）
  const login = await (await fetch(`${EDGE}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principalId: 'biz1' }) })).json();
  const sid = login?.session?.sessionId;
  step('Edge会话', !!sid, { principalId: login?.session?.principalId ?? null, tenantId: login?.session?.tenantId ?? null });
  const t0 = Date.now();
  const dr = await fetch(`${EDGE}/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/decisions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid },
    body: JSON.stringify({ assistant: 'credit', question: '针对该客户首次回租准入的信审预评估，基于已登记材料给出3-5个下一步核验或补证建议候选。', operationId: `smoke-${Date.now().toString(36)}`, expectedRevision: 0 }),
  });
  const dj = await dr.json();
  const durMs = Date.now() - t0;
  const m = dj?.latest?.model ?? {};
  result.decision = { httpStatus: dr.status, customerId, assistant: 'credit',
    modelStatus: m.status ?? null, sent: m.source ? true : null, requestId: m.requestId ?? null, analysisRunId: m.analysisRunId ?? null,
    profile: dj?.latest ? '见响应' : null, usage: m.usage ?? null, durationMs: durMs,
    candidates: (dj?.latest?.candidates ?? []).map((c) => ({ id: c.id, label: c.label, impact: c.impact, confidence: c.confidence, confidenceKind: c.confidenceKind, evidenceRefCount: c.evidenceRefIds?.length ?? 0 })),
    error: dj?.error ?? m.error?.code ?? null };
  step('decisions真实候选分析', dr.status === 200 && ['succeeded'].includes(m.status) && (dj?.latest?.candidates?.length ?? 0) >= 3 && dj?.latest?.candidates?.length <= 5,
    { status: dr.status, modelStatus: m.status, candidates: dj?.latest?.candidates?.length ?? 0, usage: m.usage, durationMs: durMs, error: dj?.error ?? m.error?.code ?? null });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'smoke-result.json'), JSON.stringify(result, null, 1));
  console.log(`\n结果 → ${path.join(OUT_DIR, 'smoke-result.json')}`);
}

main().catch((e) => { console.error('[zloop-smoke] 异常:', e?.stack ?? e); process.exit(1); });
