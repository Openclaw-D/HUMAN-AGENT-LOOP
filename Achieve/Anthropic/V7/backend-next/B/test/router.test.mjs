// 可信路由测试:规则限定、审计 ruleId、失败关闭、NO_ROUTE 不猜。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, validateRouteConfig } from '../src/router.mjs';
import { testRoutes } from './helpers.mjs';

test('合法配置通过校验;首中规则生效且带 ruleId', () => {
  const router = createRouter(testRoutes());
  const r1 = router.routeTask({ taskId: 't1', taskKind: 'model_review', role: 'credit' });
  assert.equal(r1.ok, true);
  assert.equal(r1.ruleId, 'R-CREDIT');
  assert.equal(r1.plan[0].role, 'credit');
  const r2 = router.routeTask({ taskId: 't2', taskKind: 'cash_flow_coverage' });
  assert.equal(r2.ruleId, 'R-CALC');
  assert.equal(r2.plan[0].kind, 'tool');
});

test('taskKind 缺失或无规则命中 → NO_ROUTE(升级人工,不猜)', () => {
  const router = createRouter(testRoutes());
  assert.equal(router.routeTask({ taskId: 'x' }).code, 'NO_ROUTE');
  const r = router.routeTask({ taskId: 'y', taskKind: 'alien_kind' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_ROUTE');
  assert.match(r.messageZh, /升级人工/);
});

test('role 细化匹配:role 不符 → 落到更宽规则或 NO_ROUTE', () => {
  const router = createRouter(testRoutes());
  const r = router.routeTask({ taskId: 'z', taskKind: 'model_review', role: 'policy' });
  assert.equal(r.ok, false); // 测试表只有 credit 的 model_review 规则
});

test('计划深拷贝:路由产物改动不影响规则表', () => {
  const router = createRouter(testRoutes());
  const r = router.routeTask({ taskId: 'a', taskKind: 'cash_flow_coverage' });
  r.plan[0].toolName = 'tampered';
  const r2 = router.routeTask({ taskId: 'b', taskKind: 'cash_flow_coverage' });
  assert.equal(r2.plan[0].toolName, 'calc:cash-flow-coverage');
});

test('非法规则配置失败关闭:重复 ruleId / 非法 kind / 越权 role / 空 plan', () => {
  assert.throws(() => validateRouteConfig({ roles: ['credit'], rules: [] }));
  assert.throws(() => validateRouteConfig({ roles: [], rules: [{ ruleId: 'A', when: { taskKind: 'x' }, plan: [{ stepId: 's', kind: 'model', role: 'credit', purpose: 'p' }] }] }));
  const base = { roles: ['credit'], rules: [{ ruleId: 'A', when: { taskKind: 'x' }, plan: [{ stepId: 's1', kind: 'model', role: 'credit', purpose: 'p' }] }] };
  assert.throws(() => validateRouteConfig({ ...base, rules: [base.rules[0], { ...base.rules[0] }] })); // ruleId 重复
  assert.throws(() => validateRouteConfig({ roles: ['credit'], rules: [{ ruleId: 'B', when: { taskKind: 'x' }, plan: [{ stepId: 's', kind: 'teleport', role: 'credit' }] }] }));
  assert.throws(() => validateRouteConfig({ roles: ['credit'], rules: [{ ruleId: 'C', when: { taskKind: 'x' }, plan: [{ stepId: 's', kind: 'model', role: 'asset', purpose: 'p' }] }] })); // role 越权
  assert.throws(() => validateRouteConfig({ roles: ['credit'], rules: [{ ruleId: 'D', when: { taskKind: 'x' }, plan: [] }] }));
  assert.throws(() => validateRouteConfig({ roles: ['credit'], rules: [{ ruleId: 'E', when: { taskKind: 'x' }, plan: [{ stepId: 's', kind: 'tool' }] }] })); // tool 缺 toolName
});
