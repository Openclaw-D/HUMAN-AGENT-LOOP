// V7 Lane C · Candidate 结构校验测试：五字段边界、类型、执行性措辞 vs 流程性讨论区分。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidate, scanAuthorityWording } from '../src/candidate-schema.mjs';
import { makeCandidate } from '../src/mock-provider.mjs';

test('合法候选：五字段齐全通过', () => {
  const r = validateCandidate(makeCandidate());
  assert.equal(r.ok, true);
});

test('多余字段 → EXTRA_FIELD（合同边界外字段不得进入）', () => {
  const r = validateCandidate(makeCandidate({ approvalDecision: 'approved' }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'EXTRA_FIELD' && /approvalDecision/.test(x.detail)));
});

test('缺字段 → MISSING_FIELD', () => {
  const c = makeCandidate();
  delete c.uncertainty;
  const r = validateCandidate(c);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'MISSING_FIELD' && /uncertainty/.test(x.detail)));
});

test('evidenceRefs 结构非法 → INVALID_FIELD', () => {
  const r = validateCandidate(makeCandidate({ evidenceRefs: [{ evidenceId: 'ev-001' }] }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'INVALID_FIELD'));
});

test('recommendedHumanAction 必须在枚举内', () => {
  const r = validateCandidate(makeCandidate({ recommendedHumanAction: 'auto_approve' }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'INVALID_FIELD' && /recommendedHumanAction/.test(x.detail)));
});

test('执行性批准措辞 → AUTHORITY_WORDING（“建议批准该笔授信”命中）', () => {
  const r = validateCandidate(makeCandidate({ observations: ['综上：建议批准该笔授信。'] }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'AUTHORITY_WORDING'));
});

test('额度/定价结论性数值 → AUTHORITY_WORDING', () => {
  const a = validateCandidate(makeCandidate({ observations: ['本案件授信额度为 500 万元。'] }));
  const b = validateCandidate(makeCandidate({ observations: ['建议定价为 8.5%。'] }));
  for (const r of [a, b]) {
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.code === 'AUTHORITY_WORDING'));
  }
});

test('流程性讨论不误拒（“额度结论须由人工决定”合法）——不得粗暴拒绝判断', () => {
  const r = validateCandidate(makeCandidate({
    observations: ['额度结论须由人工决定；本候选仅整理覆盖率为 1.4 的算术事实。'],
    uncertainty: ['口径差异未经人工确认。'],
  }));
  assert.equal(r.ok, true);
});

test('扫描器返回命中明细（id/匹配文本），便于留痕与人工复核', () => {
  const s = scanAuthorityWording(makeCandidate({ observations: ['因此应当批准该项目租赁。'] }));
  assert.equal(s.hits.length, 1);
  assert.equal(s.hits[0].id, 'approval_decision');
});
