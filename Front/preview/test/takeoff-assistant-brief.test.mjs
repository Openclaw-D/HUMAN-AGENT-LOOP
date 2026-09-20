// TAKEOFF-FA-1.0.0 · 助手受控简报纯函数单测（确定性替身语义；目标§4 通过标准的本地验证部分）。
// 真实模型未授权（NOT_RUN）：本套件只验证组答结构与诚实性，不声称模型验证通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeAssistantBrief,
  composeAssistantBriefError,
  ASSISTANT_BRIEF_NAMES,
} from '../../site-mirror/lib/workbench/takeoff-assistant-brief.ts';

const FIN = {
  finId: 'fin-1', authority: 'none', rulesetVersion: 'takeoff-first-admission-rule-pack-v1',
  inputHash: 'hash-abc',
  gate: { result: 'CLEAR', reasons: [], ruleIds: ['R1'] },
  amountCandidate: {
    evaluable: true, tendency: 'increase',
    supportable: { min: 40_000, max: 50_000, currency: 'CNY' }, // 03 收口单位=元（PROTOCOL §5）
    suggestedTerm: { value: 36, unit: 'month', basis: '设备折旧期' },
    referencePrice: { value: 240.56, currency: 'CNY', basis: '合成名义口径' },
    conditions: ['补齐设备权属登记'],
    gaps: ['经营流水缺 3 个月'],
    frozen: false, frozenReasons: [],
  },
  nextStep: { label: '补齐经营流水', detail: '由客户方提交' },
  artifactRefs: [{ artifactId: 'art-1' }, { artifactId: 'art-2' }],
};

const SRC = {
  customerName: '恒锐精密（合成）',
  assessment: { assessmentId: 'ass-1', status: 'awaiting_human_review', stale: false, version: 4, candidateRevision: 2, inputVersion: 1, requestedAmountMinor: 5_000_00, ruleVersion: 'v1' },
  admission: {
    request: { requestedAmount: 5_000_00 },
    candidate: { version: 2, suggestedAmount: 5_000_00, suggestedTermMonths: 36, referencePriceMinor: 240_56, tendency: 'increase' },
    inputVersion: 1, candidateRevision: 2,
    preassessment: null,
  },
  finalization: FIN,
};

test('简报：确定性标记恒真；引用可追（finId/inputHash/artifactId/assessmentId）', () => {
  const b = composeAssistantBrief('jianwei', SRC, null);
  assert.equal(b.deterministic, true);
  for (const ref of ['fin-1', 'inputHash=hash-abc', 'ass-1', 'art-1']) assert.ok(b.refs.includes(ref), `refs 含 ${ref}`);
  assert.ok(b.text.includes('非真实模型'), '文本自标确定性替身');
});

test('business 简报：客户/需求登记态/评估状态；未知需求如实待补', () => {
  const b = composeAssistantBrief('business', SRC, null);
  assert.ok(b.text.includes('恒锐精密（合成）') && b.text.includes('awaiting_human_review'));
  assert.ok(b.text.includes('首次回租需求已登记') && b.text.includes('¥5000'), '需求金额读回（分→元）');
  const noReq = composeAssistantBrief('business', { ...SRC, admission: { ...SRC.admission, request: { requestedAmount: null } }, assessment: { ...SRC.assessment, requestedAmountMinor: null } }, null);
  assert.ok(noReq.text.includes('未录入'), '未登记如实展示');
});

test('commerce 简报：可支持区间/期限/价格/条件/缺口与同版锚', () => {
  const b = composeAssistantBrief('commerce', SRC, null);
  assert.ok(b.text.includes('¥40000') && b.text.includes('¥50000'), '金额区间（收口单位=元）');
  assert.ok(b.text.includes('36 month') && b.text.includes('设备折旧期'));
  assert.ok(b.text.includes('¥240.56') && b.text.includes('合成名义口径'), '价格=元口径如实显示');
  assert.ok(b.text.includes('补齐设备权属登记') && b.text.includes('经营流水缺 3 个月'));
  assert.ok(b.text.includes('候选 r2 · 输入 v1'));
});

test('credit/policy/asset 简报：当前性/预评估态/Gate/冻结各自成段', () => {
  const credit = composeAssistantBrief('credit', SRC, null);
  assert.ok(credit.text.includes('未标记过时') && credit.text.includes('未确认'));
  const frozen = composeAssistantBrief('asset', {
    ...SRC,
    finalization: { ...FIN, amountCandidate: { ...FIN.amountCandidate, frozen: true, frozenReasons: ['SIM-LITIGATION-PENDING-01'] }, gate: { result: 'HARD_BLOCK', reasons: ['涉诉未决'], ruleIds: ['R9'] } },
  }, null);
  assert.ok(frozen.text.includes('冻结') && frozen.text.includes('SIM-LITIGATION-PENDING-01'));
  assert.ok(frozen.text.includes('不可一键解除'));
  const policy = composeAssistantBrief('policy', {
    ...SRC,
    finalization: { ...FIN, gate: { result: 'HARD_BLOCK', reasons: ['涉诉未决'], ruleIds: ['R9'] } },
  }, null);
  assert.ok(policy.text.includes('HARD_BLOCK') && policy.text.includes('R9'));
});

test('去重：同 finId 第二次询问=短答不重复推理；不同 finId=全量组答', () => {
  const again = composeAssistantBrief('commerce', SRC, 'fin-1');
  assert.equal(again.deduped, true);
  assert.ok(again.text.includes('不重复全量推理'));
  assert.ok(!again.text.includes('¥40000'), '去重短答不含金额细节');
  const fresh = composeAssistantBrief('commerce', SRC, 'fin-0');
  assert.equal(fresh.deduped, false);
  assert.ok(fresh.text.includes('¥40000'));
});

test('无收口：诚实说读不到，不伪造完成', () => {
  const b = composeAssistantBrief('jianwei', { ...SRC, finalization: null }, null);
  assert.ok(b.text.includes('收口尚未读到') && b.text.includes('不能据此说分析已完成'));
});

test('读取失败回执：带状态与错误码，不伪造成分析结果', () => {
  const t = composeAssistantBriefError('policy', 502, 'UPSTREAM_UNKNOWN');
  assert.ok(t.includes('502') && t.includes('UPSTREAM_UNKNOWN') && t.includes('不伪造'));
});

test('名称表六助手齐全', () => {
  assert.deepEqual(Object.keys(ASSISTANT_BRIEF_NAMES).sort(), ['asset', 'business', 'commerce', 'credit', 'jianwei', 'policy']);
});
