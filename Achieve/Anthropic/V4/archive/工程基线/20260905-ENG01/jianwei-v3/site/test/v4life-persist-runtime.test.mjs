// V4-LIFE 持久化端到端测试：引擎 + 文件事件账本 + 模拟重启（V4LIFE_DATA_DIR opt-in 语义的内核等价验证）。
// 覆盖：重启后 rev/Projection 恢复、重启后同 commandId 的自然键兜底语义、reset 清盘后回到种子初态。
// 不测试 runtime 模块本身的环境变量分支（模块加载期读 env，动态 import 会污染同进程其他测试的模块缓存），
// runtime 接线仅为透传 options，refold 行为由引擎保证（engine.ts:1253-1266）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createV4LifeEngine } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed } from '../lib/v4life/seed.ts';
import { createFileEventLog } from '../lib/v4life/file-event-log.ts';

const CASE = 'demo-sme-robot-500w';

function evidenceCommand(overrides = {}) {
  return {
    commandId: 'cmd-persist-1',
    expectedRev: undefined,
    evidenceId: 'ev-persist-supplement',
    kind: 'supplement',
    title: '持久化验证补充材料',
    submittedBy: 'actor-business-chen',
    payload: {
      summary: '用于验证文件事件账本与引擎 refold 的合成补充材料。',
      tags: ['persistence_check'],
    },
    ...overrides,
  };
}

function stripVolatile(projection) {
  const clone = structuredClone(projection);
  delete clone.generatedAt;
  return clone;
}

test('持久化端到端：重启（新引擎从同一文件账本 refold）后 rev 与 Projection 完全恢复', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-persist-'));
  const log1 = createFileEventLog({ dir });
  const engine1 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: log1 });
  const revAtBoot = engine1.rev;

  const command = evidenceCommand({ expectedRev: engine1.rev });
  const result = engine1.appendEvidence(command);
  assert.equal(result.status, 'accepted', '前置：命令被接受，产生新事件');
  const revAfterCommand = engine1.rev;
  assert.ok(revAfterCommand > revAtBoot, '命令应推进 rev');

  // 模拟重启：全新文件账本实例 + 全新引擎，从同一目录 loadAll → refold
  const log2 = createFileEventLog({ dir });
  const engine2 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: log2 });
  assert.equal(engine2.rev, revAfterCommand, '重启后 rev 必须恢复到命令后的值');

  const projection1 = stripVolatile(engine1.getProjection());
  const projection2 = stripVolatile(engine2.getProjection());
  assert.deepEqual(projection2, projection1, '重启后 Projection（除时间戳）与在线引擎完全一致');
});

test('持久化边界：重启后 commandId 幂等缓存不保留，evidenceId 自然键兜底 → 同载荷重发不产生重复事件', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-persist-'));
  const log1 = createFileEventLog({ dir });
  const engine1 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: log1 });
  const command = evidenceCommand({ expectedRev: engine1.rev });
  const first = engine1.appendEvidence(command);
  assert.equal(first.status, 'accepted');
  const eventsBefore = engine1.getEvents(0).events.length;

  // 模拟重启后，同 commandId + 同 payload + 正确 expectedRev 重发：
  // commandId 缓存已失（引擎边界），但 evidenceId 自然键仍识别为同一条证据 → replayed，事件数不变。
  const log2 = createFileEventLog({ dir });
  const engine2 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: log2 });
  const replay = engine2.appendEvidence(evidenceCommand({ expectedRev: engine2.rev }));
  assert.equal(replay.status, 'replayed', 'evidenceId 自然键在重启后仍防重复');
  assert.equal(engine2.getEvents(0).events.length, eventsBefore, '重发不追加新事件');
});

test('持久化 reset 语义：clear 后新引擎回到种子初态，旧事件不复活', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'v4life-persist-'));
  const log1 = createFileEventLog({ dir });
  const engine1 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: log1 });
  engine1.appendEvidence(evidenceCommand({ expectedRev: engine1.rev }));
  const eventsAfterCommand = engine1.getEvents(0).events.length;
  assert.ok(eventsAfterCommand > 0, '前置：命令事件已入账本');

  log1.clear(CASE);
  const log2 = createFileEventLog({ dir });
  const engine2 = createV4LifeEngine(createV4LifeDemoSeed(), { eventLog: log2 });

  const fresh = createV4LifeEngine(createV4LifeDemoSeed());
  assert.equal(engine2.rev, fresh.rev, 'clear 后重建的引擎 rev 与全新种子引擎一致');
  assert.equal(
    engine2.getEvents(0).events.length,
    fresh.getEvents(0).events.length,
    'clear 后只含种子初始化事件',
  );
  assert.equal(
    JSON.stringify(engine2.getEvents(0).events).includes('ev-persist-supplement'),
    false,
    '旧命令事件不得复活',
  );
});
