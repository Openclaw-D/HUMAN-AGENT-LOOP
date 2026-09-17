// 任务 02 · B1/W01–W03 进件规范化测试：分级归集、元数据与可读性待补、同源依赖不叠加证明。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindOpportunityToCustomer, createInvitation, normalizeIntakeBatch } from '../intake/normalize.mjs';

function baseUpload(overrides = {}) {
  return {
    uploadId: 'U1', subjectId: 'subj-main', period: '2026-07', kind: 'tax_filing',
    caliber: 'tax_filing', uploaderInviteId: 'inv-finance', sourceChannel: 'wecom_kf',
    content: '合成材料正文', ...overrides,
  };
}

function fixture() {
  const binding = bindOpportunityToCustomer({
    customerId: 'cust-A', opportunities: ['opp-1', 'opp-2'], placeIds: ['place-1'],
  });
  const invFinance = createInvitation({
    inviteId: 'inv-finance', role: 'finance', allowedSubjects: ['subj-main'], allowedKinds: ['tax_filing', 'bank_receipts', 'accounting_ledger'],
  });
  const invLegal = createInvitation({
    inviteId: 'inv-legal', role: 'legal_rep', allowedSubjects: ['subj-main', 'subj-holdco'], allowedKinds: ['equipment_contract', 'bank_receipts'],
  });
  return { binding, invitations: [invFinance.invitation, invLegal.invitation] };
}

test('W01 商机归集主档 + 分级邀请；越权上传被拒，不自动获得内部权限', () => {
  const { binding, invitations } = fixture();
  assert.equal(binding.ok, true);
  assert.equal(binding.binding.internalAccessGranted, false, '归集不授予内部权限');
  assert.deepEqual(binding.binding.opportunityIds, ['opp-1', 'opp-2']);

  const r = normalizeIntakeBatch({
    batch: { batchId: 'b1', customerId: 'cust-A', uploads: [
      baseUpload({ uploadId: 'U-ok' }),
      // 财务邀请上传购机合同（种类越权）
      baseUpload({ uploadId: 'U-scope', kind: 'equipment_contract' }),
      // 主体越权
      baseUpload({ uploadId: 'U-subj', subjectId: 'subj-holdco' }),
      // 未挂邀请
      baseUpload({ uploadId: 'U-noinv', uploaderInviteId: 'inv-ghost' }),
    ] },
    invitations,
    bindings: [binding],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.intake.accepted.map((a) => a.uploadId), ['U-ok']);
  const reasons = Object.fromEntries(r.intake.pendingSupplement.map((p) => [p.uploadId, p.reasonCode]));
  assert.equal(reasons['U-scope'], 'OUTSIDE_INVITE_SCOPE');
  assert.equal(reasons['U-subj'], 'OUTSIDE_INVITE_SCOPE');
  assert.equal(reasons['U-noinv'], 'UNKNOWN_INVITE');
});

test('W01 内部角色不可自助邀请（结构拒绝）', () => {
  const r = createInvitation({ inviteId: 'inv-bad', role: 'jianwei', allowedSubjects: ['x'], allowedKinds: ['y'] });
  assert.equal(r.ok, false);
  assert.ok(r.problems[0].includes('内部角色不可自助邀请'));
});

test('B1 无主档绑定拒绝归集（商机不能冒充客户身份）', () => {
  const { invitations } = fixture();
  const r = normalizeIntakeBatch({
    batch: { batchId: 'b2', customerId: 'cust-ghost', uploads: [baseUpload()] },
    invitations, bindings: [],
  });
  assert.equal(r.ok, false);
  assert.ok(r.problems[0].includes('无主档归集绑定'));
});

test('W02 元数据缺失/加密/缺页 → 待补不编数；口径注记自动附带', () => {
  const { binding, invitations } = fixture();
  const r = normalizeIntakeBatch({
    batch: { batchId: 'b3', customerId: 'cust-A', uploads: [
      baseUpload({ uploadId: 'U-noperiod', period: undefined }),
      baseUpload({ uploadId: 'U-nocaliber', caliber: undefined }),
      baseUpload({ uploadId: 'U-enc', readability: 'encrypted' }),
      baseUpload({ uploadId: 'U-pages', readability: 'missing_pages' }),
      baseUpload({ uploadId: 'U-bank', kind: 'bank_receipts', caliber: 'bank_receipts', uploaderInviteId: 'inv-legal' }),
    ] },
    invitations, bindings: [binding],
  });
  assert.equal(r.ok, true);
  const reasons = Object.fromEntries(r.intake.pendingSupplement.map((p) => [p.uploadId, p.reasonCode]));
  assert.equal(reasons['U-noperiod'], 'METADATA_INCOMPLETE');
  assert.equal(reasons['U-nocaliber'], 'METADATA_INCOMPLETE');
  assert.equal(reasons['U-enc'], 'SUPPLEMENT_REQUIRED');
  assert.equal(reasons['U-pages'], 'SUPPLEMENT_REQUIRED');
  // 银行流水口径注记：入账≠经营收入，不产出欺诈结论
  const bank = r.intake.accepted.find((a) => a.uploadId === 'U-bank');
  assert.ok(bank.caliberNote.includes('不直接当经营收入'));
  // 批次状态：有待补 → open（无倒计时/无到期伪装完成）
  assert.equal(r.intake.status, 'open');
  assert.ok(r.intake.pendingUploadIds.includes('U-enc'));
});

test('W03 同源扫描/生成对象不叠加独立证明；断链派生件级联待补', () => {
  const { binding, invitations } = fixture();
  const r = normalizeIntakeBatch({
    batch: { batchId: 'b4', customerId: 'cust-A', uploads: [
      // 原件
      baseUpload({ uploadId: 'R', kind: 'bank_receipts', caliber: 'bank_receipts', uploaderInviteId: 'inv-legal', sourceChannel: 'upload_web' }),
      // 同内容二次扫描（同源声明）
      baseUpload({ uploadId: 'S1', derivedFrom: 'R', content: '合成材料正文' }),
      // 同原件的转写
      baseUpload({ uploadId: 'S2', derivedFrom: 'R', content: '转写文本' }),
      // 断链：derivedFrom 指向待补件
      baseUpload({ uploadId: 'S3', derivedFrom: 'U-enc', content: '截图转述' }),
    ] },
    invitations, bindings: [binding],
  });
  assert.equal(r.ok, true);
  const acc = Object.fromEntries(r.intake.accepted.map((a) => [a.uploadId, a]));
  assert.ok(acc['R'] && acc['S1'] && acc['S2'], '原件与同源派生件均已归集');
  assert.equal(r.intake.sourceRegistry['S1'].rootUploadId, 'R');
  assert.equal(r.intake.sourceRegistry['S2'].rootUploadId, 'R');
  // 独立来源按根去重：R/S1/S2 = 1 个独立来源，不是 3 个
  const roots = new Set(Object.values(r.intake.sourceRegistry).map((x) => x.rootUploadId));
  assert.equal(roots.size, 1);
  assert.equal(r.intake.independentSourceCount, 1);
  // 断链派生件待补
  const s3 = r.intake.pendingSupplement.find((p) => p.uploadId === 'S3');
  assert.equal(s3.reasonCode, 'SOURCE_CHAIN_INCOMPLETE');
});

test('B1 对齐表按主体|期间归集；归集本身不产出比对结论', () => {
  const { binding, invitations } = fixture();
  const r = normalizeIntakeBatch({
    batch: { batchId: 'b5', customerId: 'cust-A', uploads: [
      baseUpload({ uploadId: 'A1', kind: 'tax_filing' }),
      baseUpload({ uploadId: 'A2', kind: 'bank_receipts', caliber: 'bank_receipts', uploaderInviteId: 'inv-legal' }),
      baseUpload({ uploadId: 'A3', period: '2026-08', kind: 'tax_filing' }),
    ] },
    invitations, bindings: [binding],
  });
  assert.equal(r.ok, true);
  assert.equal(r.intake.status, 'aligned');
  assert.equal(r.intake.alignment['subj-main|2026-07'].length, 2);
  assert.equal(r.intake.alignment['subj-main|2026-08'].length, 1);
  assert.ok(!JSON.stringify(r.intake.alignment).includes('匹配'), '对齐表只归集定位，不做自动匹配结论');
});

test('B1 同输入确定性同批次 id（恢复以登记表为准，非倒计时）', () => {
  const { binding, invitations } = fixture();
  const args = {
    batch: { batchId: 'b6', customerId: 'cust-A', uploads: [baseUpload()] },
    invitations, bindings: [binding], now: () => '2026-09-17T00:00:00.000Z',
  };
  const a = normalizeIntakeBatch(args);
  const b = normalizeIntakeBatch(args);
  assert.equal(a.intake.intakeBatchId, b.intake.intakeBatchId);
  assert.equal(a.intake.status, 'aligned');
});
