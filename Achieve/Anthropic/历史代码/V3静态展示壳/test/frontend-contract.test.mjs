import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('projection has one financing case, four ordered stages, and the configured candidate flows', async () => {
  const { financingLeasingProjection } = await import(new URL('projection.mjs', root));
  assert.equal(financingLeasingProjection.schema, 'FinancingLeasingCaseProjection/v1');
  assert.equal(financingLeasingProjection.caseId, 'FL-DEMO-001');
  assert.deepEqual(financingLeasingProjection.stages.map(({ id, label }) => [id, label]), [
    ['policy', '政策'], ['credit', '信审'], ['commerce', '商务'], ['asset', '资产'],
  ]);
  const expected = {
    policy: ['前置核验', '原文依据', '适用范围', '规则版本', '人工发布'],
    credit: ['多模态解析', '事实核验', '现场尽调', '证据回链', '人工判断'],
    commerce: ['审批条件', '合同任务', '付款核验', '交付查勘', '人工验收'],
    asset: ['投放表现', '异常信号', '条件验证', '旁路评估', '结果反馈'],
  };
  for (const stage of financingLeasingProjection.stages) {
    assert.equal(stage.slots.length, 5);
    assert.deepEqual(stage.slots.map((slot) => slot.label), expected[stage.id]);
    for (const slot of stage.slots) assert.deepEqual(Object.keys(slot).sort(), ['agent', 'evidenceCount', 'exception', 'id', 'label', 'owner', 'receipt', 'status', 'summary', 'updatedAt'].sort());
  }
  assert.match(financingLeasingProjection.stages[0].slots[0].summary, /商机|尽调/);
});

test('fake adapter is async and returns the frozen candidate shape', async () => {
  const { sendChatMessage } = await import(new URL('fake-adapter.mjs', root));
  const pending = sendChatMessage({ caseId: 'FL-DEMO-001', message: '请说明当前缺口' });
  assert.equal(typeof pending?.then, 'function');
  const value = await pending;
  assert.equal(value.caseId, 'FL-DEMO-001');
  assert.match(value.messageId, /^msg-.+/);
  assert.equal(value.status, 'candidate');
  assert.equal(typeof value.answer, 'string');
  assert.ok(value.answer.length > 0);
  assert.deepEqual(value.evidenceRefs, ['EV-SYN-001']);
  await assert.rejects(sendChatMessage({ caseId: 'FL-DEMO-001', message: '   ' }), { code: 'EMPTY_MESSAGE' });
  await assert.rejects(sendChatMessage({ caseId: 'FL-DEMO-001', message: '[error]' }), { code: 'FAKE_ADAPTER_FAILURE' });
});

test('HTML exposes the frozen navigation, view switch, states, and chat controls', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const token of ['data-stage="policy"', 'data-stage="credit"', 'data-stage="commerce"', 'data-stage="asset"', 'data-view="matrix"', 'data-view="graph"', 'id="chat-form"', 'id="chat-submit"', 'id="projection-loading"', 'id="projection-empty"', 'id="projection-error"']) assert.match(html, new RegExp(token));
  assert.doesNotMatch(html, /风控业务协同|需求开发协同|CollaborationCase|共创|全域/);
});

test('CSS freezes three-column desktop proportions and prevents horizontal overflow', async () => {
  const css = await readFile(new URL('styles.css', root), 'utf8');
  assert.match(css, /grid-template-columns\s*:\s*minmax\([^;]+10[^;]+minmax\([^;]+70[^;]+minmax\([^;]+20/i);
  assert.match(css, /overflow-x\s*:\s*hidden/);
  assert.match(css, /@media\s*\(/);
});
