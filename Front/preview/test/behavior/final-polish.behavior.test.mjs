// FINAL-02 行为测试（docs/codex-handoff/v06-real-ai/FINAL_ROUND.md FINAL-02）：
// 1) 冲突下一步按冲突事实实际所属专业分派（不泛指信审；键未知如实兜底）；
// 2) 决策页右侧技术明细默认折叠且业务可读（摘要前置，stale/domain/knownFacts 原始字段不常驻）；
// 3) 聊天历史回执回放如实标注“历史回放 · 非新调用”。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, cleanup, waitFor } from './harness.mjs';
const React = await import('react');
const { deriveCaseBrief } = await import('../../../site-mirror/lib/workbench/case-brief.ts');
const { RoundDecision } = await import('../../../site-mirror/app/takeoff/round-decision.tsx');
const { AssistantObservationPanel } = await import('../../../site-mirror/app/takeoff/assistant-observation.tsx');

const base = {
  customerName: '天山南麓农机装备公司',
  currentMaterials: 6,
  factConflicts: 1,
  snapshot: {
    customer: { displayName: '天山南麓农机装备公司', status: 'active' },
    assessments: [{ status: 'collecting', stale: false }],
    admission: null,
    decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } },
    session: { openQuestions: 0 },
  },
};

test('FINAL-02 冲突下一步：权属冲突分派资产评估专员（不泛指信审）', () => {
  const brief = deriveCaseBrief({ ...structuredClone(base), factConflictKeys: ['equipment_ownership_verified'] });
  assert.equal(brief.nextStep.who, '资产评估专员');
  assert.ok(brief.nextStep.what.includes('资产区'), '下一步点明冲突所在区');
  assert.ok(brief.nextStep.what.includes('显式更正'), '下一步给出显式更正收口口径');
  assert.ok(brief.situation.find((s) => s.key === 'conflict').text.includes('资产专业事实'), '现状行标注冲突涉及专业');
});

test('FINAL-02 冲突下一步：设备对价冲突分派资产评估专员（CLOSE-02 对齐后端 KEYSETS：equipment_deal_amount 仅属 asset 键集，FINAL_BACK_CONTRACT §3 实证）', () => {
  const brief = deriveCaseBrief({ ...structuredClone(base), factConflictKeys: ['equipment_deal_amount'] });
  assert.equal(brief.nextStep.who, '资产评估专员');
});

test('CLOSE-02 冲突下一步：多域冲突并列显示各专业角色（按后端权威键集）', () => {
  const brief = deriveCaseBrief({ ...structuredClone(base), factConflictKeys: ['equipment_ownership_verified', 'fees_known', 'revenue_annual_declared'] });
  for (const role of ['资产评估专员', '商务专员', '客户经理（业务）']) assert.ok(brief.nextStep.who.includes(role), `who 含 ${role}`);
});

test('CLOSE-02 冲突下一步：transaction_scope 全局共享键→五区各专业（每域 deps 都含）', () => {
  const brief = deriveCaseBrief({ ...structuredClone(base), factConflictKeys: ['transaction_scope'] });
  for (const role of ['客户经理（业务）', '政策合规专员', '信审专员', '商务专员', '资产评估专员']) assert.ok(brief.nextStep.who.includes(role), `who 含 ${role}`);
});

test('FINAL-02 冲突下一步：事实键未登记归属时如实兜底，不编造也不泛指信审', () => {
  const brief = deriveCaseBrief({ ...structuredClone(base), factConflictKeys: ['unknown_fact_xyz'] });
  assert.equal(brief.nextStep.who, '具备该事实核验权限的专业岗位');
  assert.ok(brief.nextStep.what.includes('unknown_fact_xyz'), '兜底文案如实列出未知事实键');
  assert.ok(!brief.nextStep.who.includes('信审'), '不泛指信审');
});

const round = {
  roundId: 'rr-1', version: 23, updatedAt: '2026-09-30T06:23:27.015Z', current: true,
  views: {
    decisions: {
      candidate: {
        stale: false, domain: 'business',
        summary: '机械复查见（候选）：收入声明 verified 级、订单有声明显级；诉讼声明为无',
        tendency: 'do', knownFacts: [{ factKey: 'revenue_annual_declared', value: '18000000 CNY' }],
      },
      selection: null,
      reason: '按规则排序',
    },
  },
};

test('FINAL-02 决策右侧：业务摘要前置可见，技术明细默认折叠', () => {
  cleanup();
  render(React.createElement(RoundDecision, { round }));
  assert.ok(screen.getByText('建议推进'), '倾向业务可读前置');
  assert.ok(screen.getByText(/尚未记录人工选择/), '未选择状态如实');
  const details = document.querySelector('details.tk-round-tech');
  assert.ok(details, '技术明细折叠区存在');
  assert.equal(details.open, false, '默认折叠：stale/domain/knownFacts 原始字段不常驻');
  // 业务摘要必须渲染在折叠区之外的正文（.tk-round-brief），折叠区只承载原始字段。
  const briefBox = details?.parentElement?.querySelector('.tk-round-brief');
  assert.ok(briefBox && /收入声明 verified 级/.test(briefBox.textContent ?? ''), '摘要正文在折叠区外可见');
  const rawDt = [...document.querySelectorAll('dt')].find((el) => el.textContent === '事实项');
  assert.ok(rawDt && details?.contains(rawDt), '原始 knownFacts 字段只存在于折叠区内部');
  fireEvent.click(screen.getByText('技术明细（原始字段）'));
  assert.equal(details.open, true, '展开后技术明细可达（不删信息）');
  cleanup();
});

const HEX = 'ab'.repeat(32);
const snap = () => ({
  customer: { displayName: '回放厂', status: 'active' },
  assessments: [{ status: 'collecting', stale: false }],
  admission: { inputVersion: '3' },
  decisionStatus: { basis: {} },
});

test('FINAL-02 聊天回放：replayed 真实回执如实标注“历史回放 · 非新调用”', async () => {
  cleanup();
  const observation = {
    ok: true, authority: 'none', scope: 'preassessment_only', customerId: 'cus_r', assistant: 'business',
    model: {
      status: 'succeeded', sent: true, requestId: 'req-1', contextVersion: '3', replayed: true,
      receiptVersion: 2, contextHash: HEX, configHash: HEX, current: true,
      source: { mode: 'real', model: 'deepseek-flash' }, error: null,
    },
    observations: [{ text: '收入以人工核验登记为准。' }], questions: [], evidenceRefs: [],
  };
  const client = {
    observeAssistant: async () => observation,
    workspace: async () => ({ snapshot: snap() }),
  };
  const wb = { client, customerId: 'cus_r', session: { sessionId: 'sess-r' }, snapshot: snap(), refresh: async () => {}, setError: () => {} };
  render(React.createElement(AssistantObservationPanel, { wb, assistant: 'business', chat: true, defaultToAssistant: true }));
  const input = screen.getByLabelText('聊天消息');
  const send = screen.getByRole('button', { name: '发送消息' });
  fireEvent.change(input, { target: { value: '这个客户现在怎么样？' } });
  fireEvent.click(send);
  await waitFor(() => assert.ok(screen.getByText('收入以人工核验登记为准。'), '回执内容展示'));
  assert.ok(screen.getByText(/历史回放 · 非新调用/), '历史回放标注可见（不冒充新调用）');
  cleanup();
});
