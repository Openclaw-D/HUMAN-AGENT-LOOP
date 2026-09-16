import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { clampZoom, fitTransform, graphInteractionReducer, initialGraphInteraction, nextNodeByDirection } from '../public/graph-state.js';
import { createViewModel, visibleUiState } from '../public/view-model.js';

const nodes = [
  { id: 'workcase:1', type: 'WorkCase' },
  { id: 'human:left', type: 'HumanPrincipal' },
  { id: 'agent:top', type: 'RoutableAgent' },
  { id: 'system:right', type: 'ExternalSystem' },
];

test('zoom clamps to 25–200 and Fit/reset/drag/pan reducer remains deterministic', () => {
  assert.equal(clampZoom(0), 1);
  assert.equal(clampZoom(.01), .25);
  assert.equal(clampZoom(3), 2);
  let state = initialGraphInteraction(nodes);
  state = graphInteractionReducer(state, { type: 'zoom', value: .1 });
  assert.equal(state.zoom, .25);
  state = graphInteractionReducer(state, { type: 'zoomBy', factor: 100 });
  assert.equal(state.zoom, 2);
  state = graphInteractionReducer(state, { type: 'panBy', dx: 12, dy: -4 });
  assert.deepEqual(state.pan, { x: 12, y: -4 });
  state = graphInteractionReducer(state, { type: 'moveNode', nodeId: 'workcase:1', x: 444, y: 333 });
  assert.deepEqual(state.positions['workcase:1'], { x: 444, y: 333 });
  const fitted = fitTransform(state.positions);
  assert.ok(fitted.zoom >= .25 && fitted.zoom <= 2);
  state = graphInteractionReducer(state, { type: 'fit', ...fitted });
  assert.equal(state.zoom, fitted.zoom);
  state = graphInteractionReducer(state, { type: 'reset', nodes });
  assert.equal(state.zoom, 1);
  assert.deepEqual(state.pan, { x: 0, y: 0 });
  assert.notDeepEqual(state.positions['workcase:1'], { x: 444, y: 333 });
});

test('keyboard directional navigation chooses the nearest node in the requested direction', () => {
  const positions = { center: { x: 0, y: 0 }, left: { x: -10, y: 0 }, right: { x: 20, y: 0 }, farRight: { x: 100, y: 0 }, down: { x: 0, y: 30 } };
  assert.equal(nextNodeByDirection('center', 'ArrowLeft', positions), 'left');
  assert.equal(nextNodeByDirection('center', 'ArrowRight', positions), 'right');
  assert.equal(nextNodeByDirection('center', 'ArrowDown', positions), 'down');
  assert.equal(nextNodeByDirection('center', 'Enter', positions), 'center');
});

test('loading/empty/error/degraded/version conflict/stale/success/offline states are deterministic and explicit', () => {
  for (const kind of ['loading', 'empty', 'error', 'degraded', 'versionConflict', 'stale']) {
    const result = visibleUiState(kind);
    assert.equal(result.kind, kind);
    assert.equal(result.simulated, true);
    assert.match(result.label, /状态演练/);
  }
  assert.equal(visibleUiState('normal', { online: false }).kind, 'offline');
  assert.equal(visibleUiState('normal', { hasCases: false }).kind, 'empty');
  assert.equal(visibleUiState('normal', { providerDegraded: true }).kind, 'degraded');
  assert.equal(visibleUiState('normal', { stale: true }).kind, 'stale');
  assert.equal(visibleUiState('normal').kind, 'ready');
});

test('view model labels the default provider honestly as Mock and never live GLM', () => {
  const graph = { source: { stale: false }, fiveQuestions: { goal: { label: '当前目标', value: '目标' } }, nodes: [], edges: [] };
  const view = createViewModel(graph, { status: 'ready', advisoryProvider: { status: 'ready', providerId: 'mock' } });
  assert.equal(view.provider.label, 'Mock / 未连接真实 GLM');
  assert.equal(view.connection, '数据已连接');
});

test('static UI contract keeps 76/24 hierarchy, reduced motion, Chinese onboarding and demo identity warning', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(css, /grid-template-columns:\s*minmax\(0, 76fr\)\s+minmax\(350px, 24fr\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /中央是当前 WorkCase/);
  assert.match(html, /待接受交接，owner 未变/);
  assert.match(html, /演示角色（未认证）/);
  assert.match(html, /仅模拟权限逻辑，不是登录、身份认证或安全边界/);
  assert.match(html, /建议层，不自动执行/);
  assert.match(app, /identityAssurance:\s*'demo_unverified'/);
  assert.match(app, /关系图不会乐观更新/);
  assert.equal(/supplyChain|enterpriseAutomation|\bfinance\b/.test(`${app}\n${readFileSync('public/view-model.js', 'utf8')}`), false, 'shared renderer must not branch on scenario keys');
});
