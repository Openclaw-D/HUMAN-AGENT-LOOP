// V4 evolve surface —— 兼容性重定向测试（Codex 验收 checkpoint 授权的窄修复）。
// 旧"体系改进"独立页面已退役：/evolve 现在是到 /#governance 的 compatibility redirect；
// 本测试只钉住重定向语义与"旧页面不得复活"，不恢复任何旧 evolve 内容断言。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('V4 evolve surface is a compatibility redirect to /#governance', async () => {
  const [page, nav] = await Promise.all([
    read('app/evolve/page.tsx'),
    read('app/v4-surface-nav.tsx'),
  ]);

  assert.match(page, /from 'next\/navigation'/);
  assert.match(page, /redirect\('\/#governance'\)/);
  assert.doesNotMatch(page, /V4SurfaceNav|CANONICAL_RELATED_CASE|BACKGROUND_CASES/);

  // 侧边栏不再包含旧"体系改进"/"/evolve"入口（现为两入口：作业执行 + 管理与治理）
  assert.doesNotMatch(nav, /体系改进/);
  assert.doesNotMatch(nav, /'\/evolve'/);
  assert.match(nav, /label: '作业执行'/);
  assert.match(nav, /label: '管理与治理'/);
});
