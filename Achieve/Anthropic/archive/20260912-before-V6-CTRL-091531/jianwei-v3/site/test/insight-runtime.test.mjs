import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildInsightRuntime } from '../app/v3-surfaces/insight/insight-model.ts';

function readyProjection(overrides = {}) {
  return {
    sessionId: 'SESSION-INSIGHT',
    caseId: 'FL-DEMO-001',
    contextVersion: 'CTX-001',
    projectionVersion: 'RUNTIME-001-PROJECTION',
    objective: { title: '补齐关键证据', description: '合成演示目标', status: 'active' },
    metrics: [],
    blockers: [],
    workItems: [
      { processId: 'policy', label: '政策', task: '核验准入边界', runStatus: 'completed', gateState: 'confirmed' },
      { processId: 'credit', label: '信审', task: '补齐订单证据', runStatus: 'needs_input', gateState: 'returned_for_evidence' },
      { processId: 'commercial', label: '商务', task: '核对合同条件', runStatus: 'ready_for_gate', gateState: 'ready' },
      { processId: 'asset', label: '资产', task: '核验设备清单', runStatus: 'failed', gateState: 'not_ready' },
    ],
    thread: {
      threadId: 'FL-DEMO-001-INTERNAL',
      title: '当前项目群聊',
      members: [
        { principalId: 'risk-policy', processId: 'policy', label: '政策', ownerLabel: '政策经理' },
        { principalId: 'risk-credit', processId: 'credit', label: '信审', ownerLabel: '信审经理' },
        { principalId: 'risk-commercial', processId: 'commercial', label: '商务', ownerLabel: '商务经理' },
        { principalId: 'risk-asset', processId: 'asset', label: '资产', ownerLabel: '资产经理' },
      ],
      entries: [],
    },
    memberCount: 5,
    messageCapability: { processId: 'credit', enabled: true, boundContextVersion: 'CTX-001', denialCode: null },
    creditFlowAvailable: true,
    lastMessageEvent: null,
    ...overrides,
  };
}

test('builds runtime rows from actual local projection and focuses the highest-risk task', () => {
  const model = buildInsightRuntime(readyProjection());

  assert.equal(model.caseId, 'FL-DEMO-001');
  assert.equal(model.focusProcessId, 'asset');
  assert.equal(model.processRows.find((row) => row.processId === 'credit').ownerLabel, '信审经理');
  assert.equal(model.processRows.find((row) => row.processId === 'credit').runStatusLabel, '待补充');
  assert.deepEqual(model.exceptionBars.map((bar) => bar.value), [1, 1, 1]);
});

test('uses 未提供 instead of inventing missing owner and status labels', () => {
  const model = buildInsightRuntime(readyProjection({
    workItems: [{ processId: 'credit', label: '', task: '', runStatus: 'unknown_status', gateState: 'unknown_gate' }],
    thread: { threadId: 'T', title: 'T', members: [], entries: [] },
  }));
  const row = model.processRows[0];

  assert.equal(row.label, '未提供');
  assert.equal(row.ownerLabel, '未提供');
  assert.equal(row.task, '未提供');
  assert.equal(row.runStatusLabel, '未提供');
  assert.equal(row.gateStateLabel, '未提供');
});

test('keeps scenario values explicit and does not fabricate actual or forecast SLA', () => {
  const model = buildInsightRuntime(readyProjection());

  assert.deepEqual(model.throughputScenario, [5, 7, 6, 9, 8, 11, 10, 12]);
  assert.equal(model.sla.targetMinutes, 15);
  assert.equal(model.sla.actualMinutes, null);
  assert.equal(model.sla.forecastMinutes, null);
});

test('returns unknown exception counts when no complete runtime work-item set exists', () => {
  const model = buildInsightRuntime(readyProjection({ workItems: [] }));

  assert.equal(model.focusProcessId, '');
  assert.deepEqual(model.exceptionBars.map((bar) => bar.value), [null, null, null]);
});

test('locks the compact shell, 80/20 split, three modes and four-chart ceiling', () => {
  const source = readFileSync(new URL('../app/v3-surfaces/insight/insight-runtime.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/v3-surfaces/insight/insight-runtime.module.css', import.meta.url), 'utf8');
  const shellStyles = readFileSync(new URL('../app/v3-surfaces/shared/surface-shell.module.css', import.meta.url), 'utf8');

  assert.match(source, /useState<SurfaceMode>\('relationship'\)/);
  assert.match(source, /mode === 'relationship'/);
  assert.match(source, /mode === 'path'/);
  assert.match(source, /<SharedSurfaceShell/);
  assert.match(source, /family="insight"/);
  assert.match(source, /<SharedChatPanel/);
  assert.match(source, /data-chart-count/);
  assert.doesNotMatch(source, /donut/i);
  assert.match(source, /candidate · authority none/i);
  assert.equal(source.match(/<h1\b/g)?.length, 1);
  assert.match(source, /role=\{kind === 'error' \? 'alert' : 'status'\}/);
  assert.match(source, /Metric · 图内相对尺度 · 非四档进度/);
  assert.match(source, /continuous points · 0–100/);
  assert.doesNotMatch(source, /frontendQuarterThreshold\}%/);
  assert.doesNotMatch(source, /InsightShellAdapter/);
  assert.match(shellStyles, /\.shellHeader\s*\{[\s\S]*?height:\s*104px;/);
  assert.match(shellStyles, /\.workArea\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 4fr\) minmax\(320px, 1fr\);/);
  assert.match(shellStyles, /\.page\s*\{[\s\S]*?overflow:\s*hidden;/);
  for (const color of ['#fff3ea', '#ffc79d', '#ff8a3d', '#ff6b00']) {
    assert.ok(shellStyles.toLowerCase().includes(color));
  }
  assert.match(styles, /\.relationship/);
});
