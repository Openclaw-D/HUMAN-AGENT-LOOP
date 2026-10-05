import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, within } from './harness.mjs';
const React = await import('react');
const { TakeoffAssistants } = await import('../../../site-mirror/app/takeoff/takeoff-assistants.tsx');
const { AssistantObservationPanel } = await import('../../../site-mirror/app/takeoff/assistant-observation.tsx');

function fixture() {
  const calls = [];
  const snapshot = { customer: { customerId: 'ui-synthetic', displayName: '合成客户' }, admission: { inputVersion: 3 } };
  const client = {
    observeAssistant: async (...args) => {
      calls.push(args);
      return { ok: true, authority: 'none', scope: 'preassessment_only', customerId: 'ui-synthetic', assistant: 'business',
        model: { receiptVersion: 2, contextHash: 'a'.repeat(64), configHash: 'b'.repeat(64), current: true, status: 'succeeded', sent: true, contextVersion: '3', source: { mode: 'mock', model: 'offline-test' } },
        observations: [{ text: '现金流申报额尚未核验。' }], questions: [{ text: '请核对借款是否误计收入。' }], evidenceRefs: [] };
    },
    workspace: async () => ({ snapshot }),
  };
  return { calls, wb: { client, snapshot, customerId: 'ui-synthetic', session: { sessionId: 'ui-test', roles: ['business'] } },
    source: { snapshot, packageDetail: null, channelTasks: [], currentMaterials: 1, factConflicts: 0 } };
}

test('助手键盘切换专业仅改变当前阅读对象，不启动模型或办理', t => {
  t.after(cleanup);
  const f = fixture();
  render(React.createElement(TakeoffAssistants, { wb: f.wb, customerId: f.wb.customerId, source: f.source, onOpenMaterials() {}, cellContext: null }));
  const business = screen.getByRole('tab', { name: '业务' });
  business.focus();
  fireEvent.keyDown(business, { key: 'ArrowRight' });
  const policy = screen.getByRole('tab', { name: '政策' });
  assert.equal(document.activeElement, policy);
  assert.equal(policy.getAttribute('aria-selected'), 'true');
  assert.equal(business.tabIndex, -1);
  fireEvent.keyDown(policy, { key: 'End' });
  assert.equal(document.activeElement, screen.getByRole('tab', { name: '见微' }));
  assert.equal(f.calls.length, 0);
});

test('展开建议并点选只填入完整问题，必须明确发送才发起观察', t => {
  t.after(cleanup);
  const f = fixture();
  const question = '请核对借款是否误计收入？';
  render(React.createElement(AssistantObservationPanel, { wb: f.wb, assistant: 'business', chat: true, defaultToAssistant: true, suggestions: [question] }));
  const disclosure = document.querySelector('.tk-suggestion-disclosure');
  assert.equal(disclosure.open, false);
  fireEvent.click(within(disclosure).getByText('建议提问'));
  fireEvent.click(within(disclosure).getByRole('button', { name: question }));
  assert.equal(screen.getByLabelText('聊天消息').value, question);
  assert.equal(f.calls.length, 0);
});

test('观察与待核验问题分组可读，模型结果仍明确未核验或批准', async t => {
  t.after(cleanup);
  const f = fixture();
  render(React.createElement(AssistantObservationPanel, { wb: f.wb, assistant: 'business', chat: true, defaultToAssistant: true }));
  fireEvent.change(screen.getByLabelText('聊天消息'), { target: { value: '核对现金流' } });
  fireEvent.click(screen.getByLabelText('发送消息'));
  await waitFor(() => assert.ok(screen.getByText('现金流申报额尚未核验。')));
  assert.ok(within(screen.getByRole('region', { name: '发现' })).getByText('现金流申报额尚未核验。'));
  assert.ok(within(screen.getByRole('region', { name: '待核验问题' })).getByText('请核对借款是否误计收入。'));
  assert.ok(screen.getByText('辅助观察 · 未代替人工核验或批准'));
  assert.equal(f.calls.length, 1);
});
