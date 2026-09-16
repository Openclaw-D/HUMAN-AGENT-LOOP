// /work 工作台回归测试（2026-09-04 重写）
// 旧版本断言“静态直租演示叙事”；该叙事已按 ZCODE_OVERNIGHT_WORKSPACE_GOAL §3 移除。
// 本文件现在锁定新工作台的不变量：无静态 fixture truth、真实 API、五角色双端、authority 边界。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('/work 不再以静态 fixture 为 truth：DEMO_WORK_PROJECTION 与旧执行壳断开引用', async () => {
  const page = await read('app/work/page.tsx');
  assert.match(page, /WorkShell/);
  assert.match(page, /force-dynamic/);
  assert.doesNotMatch(page, /DEMO_WORK_PROJECTION|WorkExecutionShell|V4SurfaceNav/);
  assert.doesNotMatch(page, /直租|供应商推荐|非标例外/);
});

test('工作台状态只来自真实 /api/v4life API，命令遵守幂等纪律', async () => {
  const [model, shell] = await Promise.all([read('app/work/workspace-model.ts'), read('app/work/WorkShell.tsx')]);
  assert.match(model, /\/api\/v4life\/cases\//);
  assert.match(model, /randomUUID/, '每次命令生成一次性 commandId');
  assert.match(model, /expectedRev/);
  assert.match(shell, /useCaseProjection/);
  assert.match(shell, /useWorkspaceActions/);
});

test('五角色共用同一 responsive 系统，移动端为「看板 / 事项 / 协同」重排', async () => {
  const [contract, shell] = await Promise.all([read('app/work/workspace-contract.ts'), read('app/work/WorkShell.tsx')]);
  for (const actor of [
    'actor-business-chen',
    'actor-policy-li',
    'actor-credit-zhang',
    'actor-commerce-wang',
    'actor-asset-zhou',
  ]) {
    assert.match(contract, new RegExp(actor));
  }
  assert.match(shell, /看板/);
  assert.match(shell, /事项/);
  assert.match(shell, /协同/);
  assert.match(shell, /CaseChat/);
  assert.match(shell, /demo role switch/);
});

test('authority 边界：Chat 为未连接模型的协同框架，Gate 只归匹配的具名角色', async () => {
  const [chat, workbench] = await Promise.all([
    read('app/work/CaseChat.tsx'),
    read('app/work/domains/DomainWorkbench.tsx'),
  ]);
  assert.match(chat, /协同框架 \/ 未连接模型/);
  assert.match(chat, /disabled/);
  assert.match(chat, /不持有正式状态|不审批|不产生 Receipt/);
  assert.match(workbench, /requiredRole/);
  assert.doesNotMatch(workbench, /(?<![无「])自动通过/);
});

test('demo reset 只服务合成 Case 并在生产环境失败关闭', async () => {
  const [route, shell] = await Promise.all([
    read('app/api/v4life/demo/reset/route.ts'),
    read('app/work/WorkShell.tsx'),
  ]);
  assert.match(route, /NODE_ENV/);
  assert.match(route, /CASE_NOT_FOUND/);
  assert.match(shell, /重置合成演示/);
  assert.match(shell, /确认重置合成演示/);
});

test('加载/错误/过期状态原语存在且不伪造成功', async () => {
  const primitives = await read('app/work/inspection/StatusPrimitives.tsx');
  for (const name of ['LoadingBlock', 'EmptyBlock', 'ErrorBlock', 'StaleBanner', 'ConnectionDot', 'FeedbackBanner']) {
    assert.match(primitives, new RegExp(`function ${name}|const ${name}`));
  }
  assert.match(primitives, /authority|INTERNAL_ERROR|exact code/);
});
