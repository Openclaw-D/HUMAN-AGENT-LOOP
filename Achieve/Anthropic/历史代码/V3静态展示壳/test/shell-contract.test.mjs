import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('shell projection freezes four stages and five configured candidate flows', async () => {
  const { financingLeasingProjection } = await import(new URL('projection.mjs', root));
  assert.deepEqual(financingLeasingProjection.stages.map((stage) => stage.label), ['政策', '信审', '商务', '资产']);
  assert.deepEqual(financingLeasingProjection.stages.map((stage) => stage.slots.map((slot) => slot.label)), [
    ['前置核验', '原文依据', '适用范围', '规则版本', '人工发布'],
    ['多模态解析', '事实核验', '现场尽调', '证据回链', '人工判断'],
    ['审批条件', '合同任务', '付款核验', '交付查勘', '人工验收'],
    ['投放表现', '异常信号', '条件验证', '旁路评估', '结果反馈'],
  ]);
});

test('HTML and CSS expose the three-column shell without legacy semantics', async () => {
  const [html, css] = await Promise.all([readFile(new URL('index.html', root), 'utf8'), readFile(new URL('styles.css', root), 'utf8')]);
  for (const token of ['data-stage="policy"', 'data-stage="credit"', 'data-stage="commerce"', 'data-stage="asset"', 'id="stage-slots"', 'id="workspace-root"', 'id="chat-panel"']) assert.match(html, new RegExp(token));
  assert.doesNotMatch(html, /风控业务协同|需求开发协同|CollaborationCase|共创|全域/);
  assert.match(css, /grid-template-columns\s*:\s*minmax\([^;]+10[^;]+minmax\([^;]+70[^;]+minmax\([^;]+20/i);
  assert.match(css, /overflow-x\s*:\s*hidden/);
  assert.match(css, /@media\s*\(/);
});
