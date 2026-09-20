// TAKEOFF(2026-09-20) buildModelRequest 可选 contextBrief 加法增量:
//   - 缺省不传:与旧版逐字节一致(text 精确等于旧 join('') 形状,payloadHash 确定);
//   - 传入:服务端组装的必要内容摘要按 '\n' 追加,同输入逐字节同载荷(恢复对账可用);
//   - 空白 brief 视为未传;不同 brief → 不同载荷。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelRequest } from '../src/transport/glm.mjs';

const base = {
  runId: 'run-1', stepId: 's1', attempt: 1, role: 'credit', purpose: 'risk_review',
  projectId: 'proj-1', goalId: null, goalLabel: 'goal', factVersion: 'v7',
  evidenceRefs: [{ id: 'ev-1', version: '1', hash: 'h' }],
};

test('缺省 contextBrief:与旧版逐字节一致', () => {
  const { request, payloadHash } = buildModelRequest(base);
  assert.equal(
    request.text,
    '[goal] 项目 proj-1证据版本 v7。请以 credit 角色做 risk_review 复核:只依据给定证据清单提出观察与问题;不输出审批、额度、价格、批准结论(模型意见 authority=none)。',
  );
  const again = buildModelRequest(base);
  assert.equal(again.payloadHash, payloadHash);
});

test('空白 contextBrief 视为未传(载荷不变)', () => {
  const a = buildModelRequest(base);
  const b = buildModelRequest({ ...base, contextBrief: '   \n  ' });
  assert.equal(a.payloadHash, b.payloadHash);
  assert.equal(a.request.text, b.request.text);
});

test('传入 contextBrief:按 \\n 追加且载荷确定', () => {
  const brief = '[当前上下文] 客户=合成客户一；评估状态=assessing。';
  const { request, payloadHash } = buildModelRequest({ ...base, contextBrief: brief });
  assert.ok(request.text.endsWith(`\n${brief}`));
  const again = buildModelRequest({ ...base, contextBrief: brief });
  assert.equal(again.payloadHash, payloadHash);
  // 前缀仍含权威纪律(authority=none),不因上下文注入而消失
  assert.ok(request.text.includes('authority=none'));
});

test('不同 contextBrief → 不同载荷;evidenceRefs 映射保持三元组', () => {
  const a = buildModelRequest({ ...base, contextBrief: 'A' });
  const b = buildModelRequest({ ...base, contextBrief: 'B' });
  assert.notEqual(a.payloadHash, b.payloadHash);
  assert.deepEqual(a.request.evidenceRefs, [{ id: 'ev-1', version: '1', hash: 'h' }]);
});
