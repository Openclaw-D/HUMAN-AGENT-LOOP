import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PROFESSIONAL_PATH,
  PROFESSIONAL_QUADRANTS,
  SURFACE_ROLES,
  V3_SURFACE_ENTRY_IDS,
  V3_SURFACE_FAMILIES,
  progressLevelForProcess,
  valueChartCount,
  visibleThresholdLabel,
} from '../app/v3-surfaces/shared/surface-model.ts';

test('publishes the nine-entry and four-family shared shell contract', () => {
  assert.deepEqual(V3_SURFACE_ENTRY_IDS, [
    'collaboration', 'value', 'opportunity', 'insight', 'business',
    'policy', 'credit', 'commercial', 'asset',
  ]);
  assert.deepEqual(V3_SURFACE_FAMILIES, ['leadership', 'opportunity', 'insight', 'workbench']);
});

test('freezes eight role projections without reviving equal-weight role tabs', () => {
  assert.deepEqual(
    SURFACE_ROLES.map((role) => role.label),
    ['领导', '业务', '政策', '信审', '商务', '资产', '客户', '供应商'],
  );
  assert.equal(new Set(SURFACE_ROLES.map((role) => role.principalId)).size, 8);
});

test('keeps the professional quadrant positions and professional-only path fixed', () => {
  assert.deepEqual(
    PROFESSIONAL_QUADRANTS.map(({ label, area }) => [label, area]),
    [
      ['资产', 'top-left'],
      ['政策', 'top-right'],
      ['商务', 'bottom-left'],
      ['信审', 'bottom-right'],
    ],
  );
  assert.deepEqual(PROFESSIONAL_PATH, ['材料', '规则', '模型', '人审']);
});

test('does not invent zero progress when a professional projection is missing', () => {
  assert.equal(progressLevelForProcess(null, 'policy'), null);
  assert.equal(visibleThresholdLabel(null), '未提供');
  assert.equal(visibleThresholdLabel(0), '尚未推进');
});

test('derives quadrant bands only from backend process projections', () => {
  const projection = {
    processProjections: [
      { processId: 'policy', evidenceCoverageBand: 3 },
      { processId: 'credit', evidenceCoverageBand: 1 },
    ],
  };
  assert.equal(progressLevelForProcess(projection, 'policy'), 3);
  assert.equal(progressLevelForProcess(projection, 'credit'), 1);
  assert.equal(progressLevelForProcess(projection, 'commercial'), null);
});

test('caps every value mode at four charts', () => {
  assert.equal(valueChartCount('relationship'), 3);
  assert.equal(valueChartCount('path'), 2);
  assert.equal(valueChartCount('matrix'), 0);
  assert.ok(['relationship', 'path', 'matrix'].every((mode) => valueChartCount(mode) <= 4));
});

test('keeps the shared header and main/chat split inside the frozen desktop contract', async () => {
  const css = await readFile(new URL('../app/v3-surfaces/shared/surface-shell.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.shellHeader\s*\{[\s\S]*?height:\s*104px;/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 4fr\) minmax\(320px, 1fr\);/);
  assert.match(css, /height:\s*calc\(100dvh - 104px\);/);
});

test('keeps page-specific titles and entry tabs out of the generic shell contract', async () => {
  const source = await readFile(new URL('../app/v3-surfaces/shared/surface-shell.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /经营协同|价值验证|当前项目群聊/);
  assert.match(source, /props\.pageTitle/);
  assert.match(source, /props\.currentObjective/);
  assert.match(source, /props\.mainContent/);
});
