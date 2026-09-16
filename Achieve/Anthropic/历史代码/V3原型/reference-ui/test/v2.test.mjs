import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProjection } from '../demo-state.mjs';
import { readFileSync } from 'node:fs';

test('十场景有共享投影字段且内容不同', () => {
  const projection = createDemoProjection();
  assert.equal(projection.scenarios.length, 10);
  assert.equal(new Set(projection.scenarios.map((scene) => scene.work)).size, 10);
  assert.ok(projection.scenarios.every((scene) => scene.projectionVersion === scene.eventCursor - 200));
  assert.ok(projection.scenarios.every((scene) => scene.stages.some((stage) => stage.missing !== '无新增缺失项')));
});

test('模型运行与普通消息分别具有明确界面动作', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /发送消息/);
  assert.match(app, /普通消息不会触发模型/);
  assert.match(app, /生成候选/);
  assert.match(app, /已完成，候选产物待审/);
});

test('矩阵包含责任权限状态交互等待与异常', () => {
  const projection = createDemoProjection();
  for (const scene of projection.scenarios) {
    const cell = scene.matrix[0].cells[0];
    for (const field of ['responsibility','permission','status','interactions','last','waiting','exception']) assert.ok(field in cell);
  }
});
