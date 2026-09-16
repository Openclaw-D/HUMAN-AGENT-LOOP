import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BUSINESS_ACTION_LABELS,
  PRINCIPAL_ROLE,
  ROUTE_PRINCIPAL,
  WORKBENCH_ROUTES,
  WORKBENCH_ROUTE_IDS,
  coarseProgressLabel,
  pathStateLabel,
  quarterThresholdLevel,
  safeDisplay,
} from '../app/v3-surfaces/workbench/workbench-model.ts';

test('five routes keep stable page identity and one Workbench adapter', () => {
  assert.deepEqual(WORKBENCH_ROUTE_IDS, ['business', 'policy', 'credit', 'commercial', 'asset']);
  assert.equal(WORKBENCH_ROUTES.business.heading, '业务作战工作台');
  assert.equal(WORKBENCH_ROUTES.policy.heading, '政策专业工作台');
  assert.equal(ROUTE_PRINCIPAL.business, 'business-owner');
  for (const routeId of WORKBENCH_ROUTE_IDS) {
    const source = readFileSync(new URL(`../app/${routeId}/page.tsx`, import.meta.url), 'utf8');
    assert.match(source, /WorkbenchAdapter/);
    assert.match(source, new RegExp(`initialRoute=["']${routeId}["']`));
    assert.doesNotMatch(source, /v3-live-shell/);
  }
});

test('server quarter thresholds become coarse levels and null remains unknown', () => {
  assert.equal(quarterThresholdLevel(null), null);
  assert.equal(quarterThresholdLevel(0), 0);
  assert.equal(quarterThresholdLevel(25), 1);
  assert.equal(quarterThresholdLevel(50), 2);
  assert.equal(quarterThresholdLevel(75), 3);
  assert.equal(quarterThresholdLevel(100), 4);
  assert.equal(coarseProgressLabel(null), '未提供');
  assert.equal(safeDisplay(null), '未提供');
  assert.equal(safeDisplay(''), '未提供');
});

test('path status keeps unknown distinct from not started', () => {
  assert.equal(pathStateLabel({ completionPercent: null, status: 'not_started' }), '未提供');
  assert.equal(pathStateLabel({ completionPercent: 0, status: 'not_started' }), '尚未开始');
  assert.equal(pathStateLabel({ completionPercent: 50, status: 'in_progress' }), '处理中');
});

test('role and action labels preserve authority boundaries', () => {
  assert.equal(PRINCIPAL_ROLE['external-customer'], 'customer');
  assert.equal(PRINCIPAL_ROLE['external-supplier'], 'supplier');
  assert.deepEqual(Object.keys(BUSINESS_ACTION_LABELS), ['initiate', 'organize', 'assign', 'remind', 'request-supplement', 'terminate']);
  assert.equal(BUSINESS_ACTION_LABELS.terminate, '终止请求');
});

test('Workbench runtime has no static truth or visible quadrant percentages', () => {
  const sources = [
    '../app/v3-surfaces/workbench/case-workbench.tsx',
    '../app/v3-surfaces/workbench/workbench-model.ts',
  ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /Processing\s*100%/i);
  assert.doesNotMatch(sources, /frontendQuarterThreshold/);
  assert.doesNotMatch(sources, />\s*(?:25|50|75|100)%\s*</);
  assert.doesNotMatch(sources, /const\s+PROFESSIONALS\s*=/);
  assert.doesNotMatch(sources, /草稿仅保存在当前界面/);
});
