import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_WORKSPACES } from '../lib/flow-workspaces.ts';

const STAGE_FLOWS = Object.freeze({
  policy: Object.freeze(['policy-material', 'policy-rules', 'policy-quant', 'policy-prereview', 'policy-update']),
  credit: Object.freeze(['credit-parse', 'credit-fact', 'credit-link', 'credit-coordinate', 'credit-review']),
  commerce: Object.freeze(['commerce-contract', 'commerce-logistics', 'commerce-funding', 'commerce-payment-check', 'commerce-final-payment']),
  asset: Object.freeze(['asset-onboard', 'asset-rent', 'asset-warning', 'asset-collection', 'asset-litigation']),
});
const EXPECTED_IDS = Object.values(STAGE_FLOWS).flat();
const WORKSPACES = Object.values(FLOW_WORKSPACES);

function content(value, path = 'workspace') {
  if (typeof value === 'string') return assert.ok(value.trim(), `${path} must be non-empty`);
  if (Array.isArray(value)) {
    assert.ok(value.length, `${path} must be non-empty`);
    return value.forEach((item, index) => content(item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) if (typeof child !== 'boolean' && typeof child !== 'number') content(child, `${path}.${key}`);
}

test('workspace keys are exactly the frozen twenty flow ids and old policy ids are absent', () => {
  assert.equal(Object.keys(FLOW_WORKSPACES).length, 20);
  assert.deepEqual(Object.keys(FLOW_WORKSPACES).sort(), [...EXPECTED_IDS].sort());
  for (const id of EXPECTED_IDS) assert.equal(FLOW_WORKSPACES[id].id, id);
  for (const oldId of ['policy-model', 'policy-strategy', 'policy-release', 'policy-monitor']) assert.equal(FLOW_WORKSPACES[oldId], undefined);
});

test('twenty workspace ids, business types and visualization types are unique', () => {
  assert.equal(new Set(WORKSPACES.map((workspace) => workspace.id)).size, 20);
  assert.equal(new Set(WORKSPACES.map((workspace) => workspace.type)).size, 20);
  assert.equal(new Set(WORKSPACES.map((workspace) => workspace.visualization.type)).size, 20);
  for (const workspace of WORKSPACES) assert.equal(workspace.type, `${workspace.id}-workspace`);
});

test('every workspace is complete and graph references are valid', () => {
  for (const workspace of WORKSPACES) {
    content(workspace);
    assert.ok(workspace.matrix.columns.length >= 5);
    assert.ok(workspace.matrix.rows.length >= 2);
    const keys = workspace.matrix.columns.map((column) => column.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const row of workspace.matrix.rows) assert.deepEqual(Object.keys(row.cells).sort(), [...keys].sort());
    assert.ok(workspace.graph.nodes.length >= 4);
    assert.ok(workspace.graph.edges.length >= 3);
    const nodeIds = new Set(workspace.graph.nodes.map((node) => node.id));
    for (const edge of workspace.graph.edges) {
      assert.ok(nodeIds.has(edge.source));
      assert.ok(nodeIds.has(edge.target));
    }
    assert.match(workspace.whyMe, /authority=none/);
    assert.match(workspace.primaryHumanAction.humanGate, /Gate/);
    assert.doesNotMatch(workspace.primaryHumanAction.owner, /Agent/i);
    assert.ok(EXPECTED_IDS.includes(workspace.nextHandoff.target));
  }
});

test('five pages in each stage do not share matrix or graph objects or serialized content', () => {
  for (const flowIds of Object.values(STAGE_FLOWS)) {
    const pages = flowIds.map((id) => FLOW_WORKSPACES[id]);
    assert.equal(new Set(pages.map((page) => page.matrix)).size, 5);
    assert.equal(new Set(pages.map((page) => page.graph)).size, 5);
    assert.equal(new Set(pages.map((page) => JSON.stringify(page.matrix))).size, 5);
    assert.equal(new Set(pages.map((page) => JSON.stringify(page.graph))).size, 5);
  }
});

test('policy five pages implement the new material, rules, quant, prereview and update semantics', () => {
  const expectations = {
    'policy-material': ['材料', '分类', '栏目', '字段', '可信度', '原始定位', 'Context Version'],
    'policy-rules': ['规则', '客户/主体', '设备', '租赁结构', '命中', '缺口', '例外'],
    'policy-quant': ['维度', '原始值', '归一值', '权重', '贡献度', '证据', '异常解释'],
    'policy-prereview': ['判断项', '候选结论', '支持证据', '反对证据', '置信提示', '待人工问题', '影响'],
    'policy-update': ['版本', '变化', '触发事件', '影响范围', '回执', '回退点', '下一 Context Version'],
  };
  for (const [id, labels] of Object.entries(expectations)) {
    assert.deepEqual(FLOW_WORKSPACES[id].matrix.columns.map((column) => column.label), labels);
  }
  assert.match(FLOW_WORKSPACES['policy-material'].visualization.type, /OCR.*分类.*字段映射.*共享信息分发/);
  assert.match(FLOW_WORKSPACES['policy-update'].visualization.type, /版本反馈.*四板块回流/);
});

test('matrix data is business-specific and not a five-flow mapping', () => {
  for (const [stageId, flowIds] of Object.entries(STAGE_FLOWS)) {
    const labels = flowIds.map((id) => FLOW_WORKSPACES[id].headline.split('：')[0]);
    for (const flowId of flowIds) {
      const serialized = JSON.stringify(FLOW_WORKSPACES[flowId].matrix);
      assert.equal(labels.every((label) => serialized.includes(label)), false, `${stageId}/${flowId}`);
      assert.ok(FLOW_WORKSPACES[flowId].matrix.rows.every((row) => !flowIds.includes(row.id)));
    }
  }
});

test('serialized workspaces contain no credential or live/production claim', () => {
  const serialized = JSON.stringify(FLOW_WORKSPACES);
  assert.doesNotMatch(serialized, /ZAI_API_KEY/i);
  assert.doesNotMatch(serialized, /已接集团系统|生产数据库|live verified/i);
});
