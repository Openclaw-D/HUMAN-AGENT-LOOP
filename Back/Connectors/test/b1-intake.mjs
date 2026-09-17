// 任务02 · B1 进件域测试（真实 PG + 受控对象存储；PG 不可达显式跳过不计 PASS）。
// 覆盖：
//   W01 分级邀请：三身份邀请→接受→candidate 绑定→操作者凭依据验证→active；
//        一次有效；角色未获准的 kind / 超出对象锚定 / 过期 / 撤销 → 拒绝上传。
//   W02 口径元数据与待补：期间/币种/单位/口径/页码/上传者落库；不可读材料
//        completeness=needs_followup，不产生任何事实候选（接收/解析/事实/核验分离）。
//   W03 同源依赖：同字节重复=同一来源；同源派生不增加独立证明计数。
//   W10 对象锚定：另一设备的同 kind 材料不能完成本设备覆盖；人工核验升级留痕。
// 运行：cd Back/Connectors && node --test test/b1-intake.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable, makeHarness, TENANT, SIGNING_SECRET, BASE_PG } from './helpers.mjs';
import { compose } from '../src/compose.mjs';
import { startServer } from '../src/http/server.mjs';

const ok = await pgAvailable();
if (!ok) {
  console.log('# SKIP: PG 127.0.0.1:15443 不可达（blocked_env，不计 PASS）');
  process.exit(0);
}

const CUSTOMER = 'cust-001';

test('W01 分级邀请全链：三身份→接受→candidate→验证→active；一次有效', async () => {
  const h = await makeHarness();
  try {
    // 商机触发：为同一客户三个身份分别签发（客户主档在 A，这里只引用）
    const owner = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'customer_owner',
      allowedEvidenceKinds: ['media', 'document'], objectRefs: [], ttlSec: 3600, createdBy: 'op-1',
    });
    const plant = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'plant_manager',
      allowedEvidenceKinds: ['media'], objectRefs: ['device-CNC-01', 'device-CNC-02'], ttlSec: 3600, createdBy: 'op-1',
    });
    const fin = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'customer_finance',
      allowedEvidenceKinds: ['document', 'statement'], objectRefs: [], ttlSec: 3600, createdBy: 'op-1',
    });
    assert.notEqual(owner.token, plant.token);

    // 接受 = candidate（声明级关联，未验证；不得被渠道 resolve）
    const a1 = await h.intake.acceptInvitation({ tenantId: TENANT, token: fin.token, provider: 'wecom', providerUserId: 'wx-fin-1' });
    assert.equal(a1.bindingStatus, 'candidate');
    const resolved = await h.bindings.resolve({ tenantId: TENANT, provider: 'wecom', providerUserId: 'wx-fin-1' });
    assert.equal(resolved.status, 'unbound', '未验证绑定不得被渠道解析');

    // 操作者凭非空依据验证 → active → 可解析
    await h.intake.verifyBinding({ tenantId: TENANT, bindingId: a1.bindingId, verifiedBy: 'op-1', evidenceRefs: ['call-recording:seg-9'] });
    const resolved2 = await h.bindings.resolve({ tenantId: TENANT, provider: 'wecom', providerUserId: 'wx-fin-1' });
    assert.equal(resolved2.status, 'resolved');
    assert.equal(resolved2.customerId, CUSTOMER);

    // 一次有效：同 token 第二次接受 → INVALID_STATE；验证缺依据 → INVALID_INPUT
    await assert.rejects(
      () => h.intake.acceptInvitation({ tenantId: TENANT, token: fin.token, provider: 'wecom', providerUserId: 'wx-fin-1b' }),
      (e) => e.code === 'INVALID_STATE',
    );
    await assert.rejects(
      () => h.intake.verifyBinding({ tenantId: TENANT, bindingId: a1.bindingId, verifiedBy: 'op-2', evidenceRefs: [] }),
      (e) => e.code === 'INVALID_INPUT',
    );
    // 各身份绑定独立可接受
    const a2 = await h.intake.acceptInvitation({ tenantId: TENANT, token: plant.token, provider: 'wecom', providerUserId: 'wx-pm-1' });
    assert.equal(a2.role, 'plant_manager');
    await h.intake.acceptInvitation({ tenantId: TENANT, token: owner.token, provider: 'wecom', providerUserId: 'wx-own-1' });
  } finally { await h.dispose(); }
});

test('W01 上传范围：未获准 kind / 越对象锚定 / 过期 / 撤销 一律拒绝', async () => {
  const h = await makeHarness();
  try {
    const inv = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'plant_manager',
      allowedEvidenceKinds: ['media'], objectRefs: ['device-CNC-01'], ttlSec: 3600, createdBy: 'op-1',
    });
    await h.intake.acceptInvitation({ tenantId: TENANT, token: inv.token, provider: 'wecom', providerUserId: 'wx-pm-2' });
    // 未获准 kind
    await assert.rejects(
      () => h.intake.checkUploadScope({ tenantId: TENANT, invitationId: inv.invitationId, kind: 'statement' }),
      (e) => e.code === 'CUSTOMER_SCOPE_MISMATCH',
    );
    // 获准 kind 但对象超出锚定（只允许 device-CNC-01）
    await assert.rejects(
      () => h.intake.checkUploadScope({ tenantId: TENANT, invitationId: inv.invitationId, kind: 'media', objectRef: 'device-CNC-99' }),
      (e) => e.code === 'CUSTOMER_SCOPE_MISMATCH',
    );
    // 锚定内 → 放行
    const okScope = await h.intake.checkUploadScope({ tenantId: TENANT, invitationId: inv.invitationId, kind: 'media', objectRef: 'device-CNC-01' });
    assert.equal(okScope.ok, true);

    // 过期：先接受（accepted），过期后上传 → TOKEN_EXPIRED；从未接受的 pending → INVALID_STATE
    const expired = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'customer_finance',
      allowedEvidenceKinds: ['statement'], objectRefs: [], ttlSec: 1, createdBy: 'op-1',
    });
    await h.intake.acceptInvitation({ tenantId: TENANT, token: expired.token, provider: 'wecom', providerUserId: 'wx-fin-9' });
    const neverAccepted = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'customer_finance',
      allowedEvidenceKinds: ['statement'], objectRefs: [], ttlSec: 1, createdBy: 'op-1',
    });
    await new Promise((r) => setTimeout(r, 1100));
    await assert.rejects(
      () => h.intake.checkUploadScope({ tenantId: TENANT, invitationId: expired.invitationId, kind: 'statement' }),
      (e) => e.code === 'TOKEN_EXPIRED',
    );
    await assert.rejects(
      () => h.intake.checkUploadScope({ tenantId: TENANT, invitationId: neverAccepted.invitationId, kind: 'statement' }),
      (e) => e.code === 'INVALID_STATE',
    );
    // 撤销
    const rv = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'customer_owner',
      allowedEvidenceKinds: ['media'], objectRefs: [], ttlSec: 3600, createdBy: 'op-1',
    });
    await h.intake.acceptInvitation({ tenantId: TENANT, token: rv.token, provider: 'wecom', providerUserId: 'wx-own-2' });
    await h.intake.revokeInvitation({ tenantId: TENANT, invitationId: rv.invitationId, actor: 'op-1' });
    await assert.rejects(
      () => h.intake.checkUploadScope({ tenantId: TENANT, invitationId: rv.invitationId, kind: 'media' }),
      (e) => e.code === 'INVALID_STATE',
    );
  } finally { await h.dispose(); }
});

test('W02 口径元数据落库；不可读材料待补且不产生事实候选', async () => {
  const h = await makeHarness();
  try {
    const inv = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'customer_finance',
      allowedEvidenceKinds: ['statement', 'document'], objectRefs: [], ttlSec: 3600, createdBy: 'op-1',
    });
    await h.intake.acceptInvitation({ tenantId: TENANT, token: inv.token, provider: 'wecom', providerUserId: 'wx-fin-3' });

    // 正常上传：完整口径元数据
    const content = Buffer.from('科目余额表 2025-08（合成测试内容）', 'utf8').toString('base64');
    const reg = await h.evidence.registerArtifact({
      tenantId: TENANT, customerId: CUSTOMER, sourceProvider: 'customer_upload', kind: 'statement',
      sourceGroup: `upload:${CUSTOMER}:statement`, sha256: require_sha256(content), objectRef: 'up-meta-1',
      periodFrom: '2025-08-01', periodTo: '2025-08-31', currency: 'CNY', unit: '元',
      caliber: '会计口径-权责发生制-含税', pageFrom: 1, pageTo: 12,
      uploaderRef: inv.invitationId, uploadSource: 'customer_upload', objectRefs: ['ledger-2025-08'],
    });
    assert.equal(reg.verificationState, 'unverified', '客户上传只能是声明级未核验');
    const row = (await h.store.query(
      `SELECT period_from, period_to, currency, unit, caliber, page_from, page_to, uploader_ref, upload_source, object_refs
       FROM evidence_artifacts WHERE evidence_id=$1`, [reg.evidenceId])).rows[0];
    assert.equal(row.currency, 'CNY');
    assert.equal(row.unit, '元');
    assert.match(row.caliber, /权责/);
    assert.equal(row.page_to, 12);
    assert.equal(row.uploader_ref, inv.invitationId);
    assert.deepEqual(row.object_refs, ['ledger-2025-08']);

    // 不可读（加密/缺页）：needs_followup 登记，绝不产生事实
    const bad = await h.evidence.registerArtifact({
      tenantId: TENANT, customerId: CUSTOMER, sourceProvider: 'customer_upload', kind: 'document',
      sourceGroup: `upload:${CUSTOMER}:document`, objectRef: 'up-enc-1',
      completeness: 'needs_followup', readable: false,
    });
    assert.equal(bad.completeness, 'needs_followup');
    assert.equal(bad.verificationState, 'incomplete');
    // 待补状态不可核验（必须先补齐重传）
    await assert.rejects(
      () => h.evidence.verifyArtifact({ tenantId: TENANT, evidenceId: bad.evidenceId, verifiedBy: 'op-1', verdict: 'verified', reason: 'x' }),
      (e) => e.code === 'INVALID_STATE',
    );
    // readable=false 却不标待补 → 拒绝（防口径漂移）
    await assert.rejects(
      () => h.evidence.registerArtifact({
        tenantId: TENANT, customerId: CUSTOMER, sourceProvider: 'customer_upload', kind: 'document',
        sourceGroup: 'g', completeness: 'needs_followup',
      }),
      (e) => e.code === 'INVALID_INPUT',
    );
    // 上传路径从未调用 assertFact：事实候选数为 0
    const facts = await h.store.query(`SELECT COUNT(*)::int AS n FROM fact_assertions WHERE tenant_id=$1`, [TENANT]);
    assert.equal(facts.rows[0].n, 0, '接收阶段不得自动产生事实候选');
  } finally { await h.dispose(); }
});

test('W03 同源依赖：同字节重复与同源派生不增加独立证明', async () => {
  const h = await makeHarness();
  try {
    const content = Buffer.from('购机合同扫描件（合成测试内容）', 'utf8');
    const sha = require_sha256(content);
    const base = {
      tenantId: TENANT, customerId: CUSTOMER, sourceProvider: 'customer_upload', kind: 'document',
      sourceGroup: 'video-main-1', objectRefs: ['device-CNC-01'],
    };
    const a1 = await h.evidence.registerArtifact({ ...base, objectRef: 'up-orig', sha256: sha });
    assert.equal(a1.sameSourceFlag, null);
    // 同字节重传 → duplicate_of=same_source
    const a2 = await h.evidence.registerArtifact({ ...base, objectRef: 'up-dup', sha256: sha });
    assert.equal(a2.duplicateOf, a1.evidenceId);
    assert.equal(a2.sameSourceFlag, 'same_source');
    // 同源视频截帧（derivedFrom + 同 sourceGroup）→ suspected_duplicate，不加独立佐证
    const a3 = await h.evidence.registerArtifact({ ...base, kind: 'media', objectRef: 'up-frame', derivedFrom: a1.evidenceId });
    assert.equal(a3.sameSourceFlag, 'suspected_duplicate');
    const n = await h.evidence.independentEvidenceCount({ tenantId: TENANT, customerId: CUSTOMER });
    assert.equal(n, 1, '三份材料只有 1 个独立来源');
    // 同对象覆盖计数同样只算 1
    const cov = await h.evidence.evidenceCoverage({ tenantId: TENANT, customerId: CUSTOMER, kind: 'document', objectRef: 'device-CNC-01' });
    assert.equal(cov.independentCount, 1);
  } finally { await h.dispose(); }
});

test('W10 对象锚定：另一设备的同 kind 材料不能满足本设备覆盖；核验升级留痕', async () => {
  const h = await makeHarness();
  try {
    // 厂长只被允许拍 device-CNC-02，但他上传了 device-CNC-01 同款照片 → 范围门直接拒绝
    const inv = await h.intake.issueInvitation({
      tenantId: TENANT, customerId: CUSTOMER, role: 'plant_manager',
      allowedEvidenceKinds: ['media'], objectRefs: ['device-CNC-02'], ttlSec: 3600, createdBy: 'op-1',
    });
    await h.intake.acceptInvitation({ tenantId: TENANT, token: inv.token, provider: 'wecom', providerUserId: 'wx-pm-3' });
    await assert.rejects(
      () => h.intake.checkUploadScope({ tenantId: TENANT, invitationId: inv.invitationId, kind: 'media', objectRef: 'device-CNC-01' }),
      (e) => e.code === 'CUSTOMER_SCOPE_MISMATCH',
    );

    // 即便材料入了库（如经别的渠道），对象不锚定也不能满足设备覆盖：
    await h.evidence.registerArtifact({
      tenantId: TENANT, customerId: CUSTOMER, sourceProvider: 'customer_upload', kind: 'media',
      sourceGroup: 'g-other-device', objectRefs: ['device-CNC-02'], sha256: require_sha256(Buffer.from('CNC-02 现场')),
    });
    const covA = await h.evidence.evidenceCoverage({ tenantId: TENANT, customerId: CUSTOMER, kind: 'media', objectRef: 'device-CNC-01' });
    assert.equal(covA.independentCount, 0, 'device-CNC-01 未被覆盖');
    const covB = await h.evidence.evidenceCoverage({ tenantId: TENANT, customerId: CUSTOMER, kind: 'media', objectRef: 'device-CNC-02' });
    assert.equal(covB.independentCount, 1, 'device-CNC-02 被覆盖');

    // 事实级：另一设备同谓词事实不构成冲突、也不互相替代
    const f1 = await h.evidence.assertFact({ tenantId: TENANT, customerId: CUSTOMER, subject: 'device-CNC-01', predicate: '铭牌功率', objectValue: '7.5kW', objectRef: 'device-CNC-01' });
    const f2 = await h.evidence.assertFact({ tenantId: TENANT, customerId: CUSTOMER, subject: 'device-CNC-02', predicate: '铭牌功率', objectValue: '11kW', objectRef: 'device-CNC-02' });
    assert.equal(f1.conflicts.length, 0, '不同对象同名谓词不冲突');
    assert.equal(f2.conflicts.length, 0);
    // 同对象同谓词不同值 → 冲突并存
    const f3 = await h.evidence.assertFact({ tenantId: TENANT, customerId: CUSTOMER, subject: 'device-CNC-01', predicate: '铭牌功率', objectValue: '75kW', objectRef: 'device-CNC-01' });
    assert.equal(f3.conflicts.length, 1);

    // 人工核验升级：verified 只能由操作者产生并留痕
    const art = (await h.store.query(
      `SELECT evidence_id FROM evidence_artifacts WHERE tenant_id=$1 AND object_refs @> $2::jsonb LIMIT 1`,
      [TENANT, JSON.stringify(['device-CNC-02'])])).rows[0];
    const v = await h.evidence.verifyArtifact({ tenantId: TENANT, evidenceId: art.evidence_id, verifiedBy: 'op-1', verdict: 'verified', reason: '现场铭牌比对一致（合成演练）' });
    assert.equal(v.verificationState, 'verified');
    const auditRow = (await h.store.query(
      `SELECT action, actor FROM audit_log WHERE tenant_id=$1 AND target_id=$2 AND action='EVIDENCE_VERIFIED'`,
      [TENANT, art.evidence_id])).rows[0];
    assert.equal(auditRow.actor, 'op-1');
  } finally { await h.dispose(); }
});

test('B1 HTTP 全链：邀请签发→接受→范围拒绝→获准上传（真实 HTTP + 对象存储）', async () => {
  const h = await makeHarness();
  const PORT = 48179;
  const TOKEN0 = 'b1_service_token';
  const svc = await compose({
    pg: { ...BASE_PG, database: h.dbName },
    objectRoot: h.objectStore.root,
    signingSecret: SIGNING_SECRET,
    serviceToken: TOKEN0,
    wecomTransport: h.transport,
    recordingAdapter: null,
    aBaseUrl: null,
  });
  const server = await startServer(svc, {
    port: PORT,
    wecomConfig: { token: 'x', aesKey: 'x', corpid: 'x', defaultTenantId: TENANT },
    trtcCallbackKey: SIGNING_SECRET,
    serviceToken: TOKEN0,
  });
  const api = async (path, body, { token = TOKEN0, expect = 200 } = {}) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': token },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    assert.equal(r.status, expect, `${path} → ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  };
  try {
    // 无令牌 → 403
    await api('/api/connectors/intake/invitations', { tenantId: TENANT, customerId: CUSTOMER, role: 'customer_finance', allowedEvidenceKinds: ['statement'], ttlSec: 3600 }, { token: 'wrong', expect: 403 });
    // 签发（厂 长：只许 media、只许 CNC-01）
    const inv = await api('/api/connectors/intake/invitations', { tenantId: TENANT, customerId: CUSTOMER, role: 'plant_manager', allowedEvidenceKinds: ['media'], objectRefs: ['device-CNC-01'], ttlSec: 3600, createdBy: 'op-1' });
    assert.ok(inv.token);
    // 接受
    const acc = await api('/api/connectors/intake/accept', { tenantId: TENANT, token: inv.token, provider: 'wecom', providerUserId: 'wx-http-1' });
    assert.equal(acc.bindingStatus, 'candidate');
    // 上传：越对象锚定 → 403 CUSTOMER_SCOPE_MISMATCH
    await api('/api/connectors/evidence/upload', {
      tenantId: TENANT, customerId: CUSTOMER, invitationId: inv.invitationId, kind: 'media',
      objectRef: 'device-CNC-99', contentBase64: Buffer.from('x').toString('base64'),
    }, { expect: 403 });
    // 获准上传：原件入库 + 元数据落库 + 声明级提示
    const up = await api('/api/connectors/evidence/upload', {
      tenantId: TENANT, customerId: CUSTOMER, invitationId: inv.invitationId, kind: 'media',
      objectRefs: ['device-CNC-01'], capturedAt: '2026-09-17T10:00:00Z',
      contentBase64: Buffer.from('CNC-01 现场照片（合成）', 'utf8').toString('base64'), contentType: 'text/plain',
    });
    assert.equal(up.ok, true);
    assert.equal(up.verificationState, 'unverified');
    assert.match(up.note, /声明级/);
    // 人工核验（操作者）→ verified
    const v = await api('/api/connectors/evidence/verify', { tenantId: TENANT, evidenceId: up.evidenceId, verifiedBy: 'op-1', verdict: 'verified', reason: '现场比对（合成）' });
    assert.equal(v.verificationState, 'verified');
    // 对象覆盖：CNC-01 已覆盖；CNC-02 为 0
    const c1 = await api('/api/connectors/evidence/coverage', { tenantId: TENANT, customerId: CUSTOMER, kind: 'media', objectRef: 'device-CNC-01' });
    assert.equal(c1.independentCount, 1);
    const c2 = await api('/api/connectors/evidence/coverage', { tenantId: TENANT, customerId: CUSTOMER, kind: 'media', objectRef: 'device-CNC-02' });
    assert.equal(c2.independentCount, 0);
  } finally {
    await server.close();
    await svc.close();
    await h.dispose();
  }
});

/** 与 ids.mjs 相同的 sha256（避免引服务内部件）。 */
import { createHash } from 'node:crypto';
function require_sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
