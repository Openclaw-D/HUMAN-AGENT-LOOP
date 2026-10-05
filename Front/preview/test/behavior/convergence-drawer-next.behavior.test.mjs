// V0.6-C1-02 收敛轮行为测试：格子抽屉“下一步”与四页简报同源。
// 任务卡（docs/codex-handoff/v06-convergence/02_FRONT.md）：“统一平台、材料、决策、流程和
// 助手的状态/原因/下一步；去重复文字……突出主要下一步”。抽屉此前固定展示静态职责文案
// （DOMAIN_TODO），与简报条按 arrow 现行状态给出的下一步可能同屏矛盾——本组断言
// domainNextStepCn 按区状态给出与 deriveCaseBrief 相同词汇的下一步，并在无状态信息时
// 如实回退（不编造），由 takeoff-detail.tsx 消费（arrow 不可用→原职责文案）。
import test from 'node:test';
import assert from 'node:assert/strict';
const { domainNextStepCn } = await import('../../../site-mirror/lib/workbench/case-brief.ts');

const arrowWith = (domain, state, extra = {}) => ({
  found: true,
  processStatus: 'running',
  domains: [{ domain, state }],
  candidateDomains: [{ domain, state, ...(state === 'awaiting_confirmation' ? { tendency: 'do' } : {}), ...extra }],
  needsReselection: [],
  affectedDomains: [],
});

test('C1-02 抽屉下一步同源：候选待确认区 → 与简报同词汇的“确认现行候选”（业务区映射 opportunity）', () => {
  const next = domainNextStepCn('opportunity', arrowWith('business', 'awaiting_confirmation'));
  assert.ok(next, '有区状态时给出下一步');
  assert.equal(next.who, '客户经理（业务）', 'who=各域专业角色（权限表同源）');
  assert.ok(next.what.includes('确认业务区现行候选'), 'what=确认候选（与 deriveCaseBrief 同词汇）');
  assert.ok(next.what.includes('默认建议不等于批准'), '保留“默认推荐≠正式审批”口径');
});

test('C1-02 抽屉下一步同源：依据已更新区 → 重新分析并重新选择（reselect 优先于确认）', () => {
  const arrow = arrowWith('credit', 'stale');
  arrow.needsReselection = [{ domain: 'credit', reason: 'basis_updated' }];
  const next = domainNextStepCn('credit', arrow);
  assert.ok(next, 'reselect 区给出下一步');
  assert.ok(next.what.includes('重新分析并重新选择'), '重选文案与简报一致');
  assert.equal(next.who, '信审专员');
});

test('C1-02 抽屉下一步同源：等待补证/分析进行中/已完成各区如实分列，不合并', () => {
  const waiting = domainNextStepCn('asset', arrowWith('asset', 'waiting_evidence'));
  assert.ok(waiting.what.includes('等待补证') && waiting.what.includes('自动重新分析'));
  const running = domainNextStepCn('policy', arrowWith('policy', 'running'));
  assert.ok(running.who.includes('系统'), '在途=系统（处理链），不冒充人工动作');
  assert.ok(running.what.includes('分析进行中'));
  const done = domainNextStepCn('commerce', arrowWith('commerce', 'completed'));
  assert.ok(done.what.includes('已确认收口') && done.what.includes('正式额度审批是另行流程'), '完成≠正式批准');
});

test('C1-02 抽屉下一步同源：arrow 不可用/该区未开始 → null 如实回退（调用方回落职责文案，不编造）', () => {
  assert.equal(domainNextStepCn('policy', null), null, 'arrow 缺失=null');
  assert.equal(domainNextStepCn('policy', { found: false }), null, 'found=false=null');
  assert.equal(domainNextStepCn('policy', arrowWith('policy', 'not_started')), null, '未开始=null（不冒充进度）');
  assert.equal(domainNextStepCn('policy', { found: true, domains: [] }), null, '该区无状态=null');
});
