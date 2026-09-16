// Lane L1｜文件持久化事件账本适配器 测试
// 契约：docs/v4/CONTRACT.md §9（V4LifeEventLog port 的文件持久化实现）
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-file-event-log.test.mjs
// 说明：每个用例用 mkdtemp 建独立临时目录，结束后清理；适配器对 payload 只做形状校验、
//       不解释内容，因此 fixtures 用真实事件类型的最小合成载荷即可，不依赖 engine/replay。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileEventLog } from '../lib/v4life/file-event-log.ts';

const CASE_ID = 'file-case-01';
const T = (suffix) => `2026-09-04T00:00:${suffix}.000Z`;

function ev(seq, at, actor, payload) {
  return { seq, at, actor, payload };
}

function baseEvents() {
  return [
    ev(1, T('01'), 'system', { type: 'CASE_INITIALIZED', caseId: CASE_ID }),
    ev(2, T('02'), 'actor-business-chen', {
      type: 'EVIDENCE_ACCEPTED',
      evidence: {
        evidenceId: 'ev-1', caseId: CASE_ID, kind: 'supplement', title: '补充材料（合成）',
        submittedBy: 'actor-business-chen', submittedAt: T('02'), version: 1,
        payload: { summary: '合成载荷。', tags: ['synthetic'] },
      },
    }),
    ev(3, T('03'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' }),
  ];
}

const dirs = [];
function newDir() {
  const dir = mkdtempSync(join(tmpdir(), 'v4life-file-event-log-'));
  dirs.push(dir);
  return dir;
}

function filePathOf(dir, caseId) {
  return join(dir, `${caseId}.jsonl`);
}

function fileLineCount(dir, caseId) {
  return readFileSync(filePathOf(dir, caseId), 'utf8').split('\n').filter((line) => line !== '').length;
}

function invalidErrorOf(fn) {
  try {
    fn();
    return { code: null, detail: '' };
  } catch (error) {
    return { code: error?.code ?? null, detail: error?.detail ?? '' };
  }
}

// ---------- 1. 空目录与 port 基线 ----------

test('空目录：loadAll → []、exportSnapshot → null、listCaseIds → []，读操作不创建文件', () => {
  const dir = newDir();
  const log = createFileEventLog({ dir });
  assert.deepEqual(log.loadAll(CASE_ID), []);
  assert.equal(log.exportSnapshot(CASE_ID), null);
  assert.deepEqual(log.listCaseIds(), []);
  assert.equal(existsSync(filePathOf(dir, CASE_ID)), false, 'loadAll 不得创建文件');
});

// ---------- 2. append 往返、深克隆边界、跨实例持久化 ----------

test('append/loadAll 往返一致；读取与快照均为深克隆；新实例从文件恢复并按实际 lastSeq 续写', () => {
  const dir = newDir();
  const log = createFileEventLog({ dir });
  const events = baseEvents();
  assert.deepEqual(log.append(CASE_ID, 0, events.slice(0, 1)), { ok: true });
  assert.deepEqual(log.append(CASE_ID, 1, events.slice(1)), { ok: true });
  assert.deepEqual(log.loadAll(CASE_ID), events);
  assert.equal(fileLineCount(dir, CASE_ID), 3, '每事件一行 jsonl');

  // 读取是深克隆：改返回值不影响内部与文件
  const loaded = log.loadAll(CASE_ID);
  loaded[0].payload.caseId = 'HACKED';
  loaded[1].payload.evidence.payload.tags.push('MUTATED');
  assert.deepEqual(log.loadAll(CASE_ID), events);
  const firstLine = JSON.parse(readFileSync(filePathOf(dir, CASE_ID), 'utf8').split('\n')[0]);
  assert.equal(firstLine.payload.caseId, CASE_ID, '文件内容不受调用方突变影响');

  // exportSnapshot 也是深克隆
  const snapshot = log.exportSnapshot(CASE_ID);
  assert.notEqual(snapshot, null);
  snapshot[2].payload.workItemId = 'HACKED';
  assert.deepEqual(log.exportSnapshot(CASE_ID)[2].payload, { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' });

  // 新实例（同 dir）从文件恢复完整事件流并续写
  const reopened = createFileEventLog({ dir });
  assert.deepEqual(reopened.loadAll(CASE_ID), events);
  assert.deepEqual(reopened.append(CASE_ID, 3, [
    ev(4, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }),
  ]), { ok: true });
  assert.deepEqual(reopened.loadAll(CASE_ID).map((event) => event.seq), [1, 2, 3, 4]);

  assert.deepEqual(log.listCaseIds(), [CASE_ID]);
});

// ---------- 3. SEQ_CONFLICT：绝不写文件 + 双重核对 ----------

test('SEQ_CONFLICT：过期/超前 expectedLastSeq 返回冲突且文件字节级不变；内存计数与文件行数分歧时以文件为准', () => {
  const dir = newDir();
  const log = createFileEventLog({ dir });
  const events = baseEvents();
  assert.deepEqual(log.append(CASE_ID, 0, events), { ok: true });
  const before = readFileSync(filePathOf(dir, CASE_ID), 'utf8');

  // 过期 expectedLastSeq → 冲突，lastSeq = 3
  assert.deepEqual(log.append(CASE_ID, 0, [
    ev(4, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }),
  ]), { ok: false, reason: 'SEQ_CONFLICT', lastSeq: 3 });
  // expected 命中但首事件 seq 不接续 → 冲突
  assert.deepEqual(log.append(CASE_ID, 3, [
    ev(5, T('05'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' }),
  ]), { ok: false, reason: 'SEQ_CONFLICT', lastSeq: 3 });
  // 命中的空批 → ok 且不产生文件变化
  assert.deepEqual(log.append(CASE_ID, 3, []), { ok: true });

  assert.equal(readFileSync(filePathOf(dir, CASE_ID), 'utf8'), before, '冲突路径绝不写文件');
  assert.equal(log.loadAll(CASE_ID).length, 3);

  // 外部进程把文件改短（模拟并发写）：内存计数过期 → 双重核对必须以文件实际行数为准
  writeFileSync(filePathOf(dir, CASE_ID), `${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}\n`, 'utf8');
  assert.deepEqual(log.append(CASE_ID, 3, [
    ev(4, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }),
  ]), { ok: false, reason: 'SEQ_CONFLICT', lastSeq: 2 }, '内存计数已过期，必须按文件实际 lastSeq 判冲突');
  assert.deepEqual(log.append(CASE_ID, 2, [
    ev(3, T('03'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' }),
  ]), { ok: true }, '按文件实际 lastSeq 条件写入命中');
  assert.deepEqual(log.loadAll(CASE_ID).map((event) => event.seq), [1, 2, 3]);
});

// ---------- 4. 损坏行失败关闭 ----------

test('损坏行失败关闭：非 JSON 行 / 形状非法行 → INVALID_ENGINE_INPUT，detail 含行号；append 同样被挡', () => {
  // 非 JSON 行
  const dir1 = newDir();
  const log1 = createFileEventLog({ dir: dir1 });
  assert.deepEqual(log1.append(CASE_ID, 0, baseEvents().slice(0, 2)), { ok: true });
  appendFileSync(filePathOf(dir1, CASE_ID), '{broken json\n', 'utf8');
  const bad1 = invalidErrorOf(() => log1.loadAll(CASE_ID));
  assert.equal(bad1.code, 'INVALID_ENGINE_INPUT');
  assert.match(bad1.detail, /第 3 行/);

  // 合法 JSON 但形状非法（缺 actor）
  const dir2 = newDir();
  const log2 = createFileEventLog({ dir: dir2 });
  assert.deepEqual(log2.append(CASE_ID, 0, baseEvents().slice(0, 2)), { ok: true });
  appendFileSync(filePathOf(dir2, CASE_ID), `${JSON.stringify({
    seq: 3, at: T('03'), payload: { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' },
  })}\n`, 'utf8');
  const bad2 = invalidErrorOf(() => log2.loadAll(CASE_ID));
  assert.equal(bad2.code, 'INVALID_ENGINE_INPUT');
  assert.match(bad2.detail, /第 3 行/);

  // 失败关闭同样约束 append：append 先完整校验既有文件
  const bad3 = invalidErrorOf(() => log1.append(CASE_ID, 2, [
    ev(3, T('03'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-P1' }),
  ]));
  assert.equal(bad3.code, 'INVALID_ENGINE_INPUT');
});

// ---------- 5. clear ----------

test('clear：删除文件后 loadAll → []；重复 clear / clear 不存在的 case 静默；之后可从 0 重放', () => {
  const dir = newDir();
  const log = createFileEventLog({ dir });
  assert.deepEqual(log.append(CASE_ID, 0, baseEvents()), { ok: true });
  assert.deepEqual(log.listCaseIds(), [CASE_ID]);

  log.clear(CASE_ID);
  assert.equal(existsSync(filePathOf(dir, CASE_ID)), false);
  assert.deepEqual(log.loadAll(CASE_ID), []);
  assert.equal(log.exportSnapshot(CASE_ID), null);
  assert.deepEqual(log.listCaseIds(), []);
  assert.doesNotThrow(() => log.clear(CASE_ID), '重复 clear 必须静默');
  assert.doesNotThrow(() => log.clear('never-existed'), 'clear 不存在的 case 必须静默');

  assert.deepEqual(log.append(CASE_ID, 0, baseEvents().slice(0, 1)), { ok: true });
  assert.equal(log.loadAll(CASE_ID).length, 1);
});

// ---------- 6. importSnapshot 覆写 ----------

test('importSnapshot：整文件覆写往返；seq 违反从 1 连续拒绝且不覆写；import 后可按 lastSeq 续写', () => {
  const dir = newDir();
  const log = createFileEventLog({ dir });
  const first = baseEvents();
  log.importSnapshot(CASE_ID, first);
  assert.deepEqual(log.loadAll(CASE_ID), first);
  assert.equal(fileLineCount(dir, CASE_ID), 3);

  // 覆写为更短的另一组事件
  const second = [
    ev(1, T('11'), 'system', { type: 'CASE_INITIALIZED', caseId: CASE_ID }),
    ev(2, T('12'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' }),
  ];
  log.importSnapshot(CASE_ID, second);
  assert.deepEqual(log.loadAll(CASE_ID), second);
  assert.equal(fileLineCount(dir, CASE_ID), 2);

  // 跳号导入拒绝，文件保持不变
  const gap = structuredClone(second);
  gap[1].seq = 4;
  const rejected = invalidErrorOf(() => log.importSnapshot(CASE_ID, gap));
  assert.equal(rejected.code, 'INVALID_ENGINE_INPUT');
  assert.deepEqual(log.loadAll(CASE_ID), second, '被拒绝的导入不得覆写文件');

  // import 后按 lastSeq 续写
  assert.deepEqual(log.append(CASE_ID, 2, [
    ev(3, T('13'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-B1' }),
  ]), { ok: true });
  assert.deepEqual(log.loadAll(CASE_ID).map((event) => event.seq), [1, 2, 3]);

  // exportSnapshot 往返进新实例 deepEqual
  const target = createFileEventLog({ dir: newDir() });
  target.importSnapshot(CASE_ID, log.exportSnapshot(CASE_ID));
  assert.deepEqual(target.loadAll(CASE_ID), log.loadAll(CASE_ID));
});

// ---------- 7. 非法 caseId（防路径穿越） ----------

test('非法 caseId（空串、.、..、路径分隔符、非法字符）全入口 INVALID_ENGINE_INPUT，且不留文件', () => {
  const dir = newDir();
  const log = createFileEventLog({ dir });
  const event = baseEvents()[0];
  for (const bad of ['', '.', '..', 'a/b', '..\\evil', 'case id', '案例-01', 'a\nb']) {
    assert.equal(invalidErrorOf(() => log.append(bad, 0, [event])).code, 'INVALID_ENGINE_INPUT', `append caseId=${JSON.stringify(bad)}`);
    assert.equal(invalidErrorOf(() => log.loadAll(bad)).code, 'INVALID_ENGINE_INPUT', `loadAll caseId=${JSON.stringify(bad)}`);
    assert.equal(invalidErrorOf(() => log.exportSnapshot(bad)).code, 'INVALID_ENGINE_INPUT', `exportSnapshot caseId=${JSON.stringify(bad)}`);
    assert.equal(invalidErrorOf(() => log.importSnapshot(bad, [event])).code, 'INVALID_ENGINE_INPUT', `importSnapshot caseId=${JSON.stringify(bad)}`);
    assert.equal(invalidErrorOf(() => log.clear(bad)).code, 'INVALID_ENGINE_INPUT', `clear caseId=${JSON.stringify(bad)}`);
  }
  assert.deepEqual(log.listCaseIds(), [], '非法 caseId 不得留下任何文件');

  // 合法字符集内的名字可用（含点、横线、下划线）
  assert.deepEqual(log.append('Case_v2.1-beta', 0, [event]), { ok: true });
  assert.deepEqual(log.listCaseIds(), ['Case_v2.1-beta']);
});

// ---------- 8. 批校验失败关闭 ----------

test('append 批内 seq 不连续 / 事件形状非法 / expectedLastSeq 与 options 非法 → INVALID_ENGINE_INPUT 且不写文件', () => {
  const dir = newDir();
  const log = createFileEventLog({ dir });
  assert.deepEqual(log.append(CASE_ID, 0, baseEvents()), { ok: true });

  // 批内跳号（4 → 6）→ INVALID_ENGINE_INPUT（文件适配器本地强化，区别于内存版的 SEQ_CONFLICT）
  const gap = invalidErrorOf(() => log.append(CASE_ID, 3, [
    ev(4, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }),
    ev(6, T('06'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-A1' }),
  ]));
  assert.equal(gap.code, 'INVALID_ENGINE_INPUT');
  assert.match(gap.detail, /不连续/);
  assert.equal(fileLineCount(dir, CASE_ID), 3, '非法批不得写文件');

  // 形状非法：seq 非从 1 起的整数
  assert.equal(invalidErrorOf(() => log.append(CASE_ID, 3, [
    ev(4.5, T('04'), 'system', { type: 'WORK_ITEM_STARTED', workItemId: 'WI-C1' }),
  ])).code, 'INVALID_ENGINE_INPUT');
  assert.equal(invalidErrorOf(() => log.append(CASE_ID, 3, ['not-an-event'])).code, 'INVALID_ENGINE_INPUT');
  // events 非数组
  assert.equal(invalidErrorOf(() => log.append(CASE_ID, 3, 'nope')).code, 'INVALID_ENGINE_INPUT');
  // expectedLastSeq 非法
  assert.equal(invalidErrorOf(() => log.append(CASE_ID, -1, [])).code, 'INVALID_ENGINE_INPUT');
  assert.equal(invalidErrorOf(() => log.append(CASE_ID, 1.5, [])).code, 'INVALID_ENGINE_INPUT');
  // options 非法
  assert.equal(invalidErrorOf(() => createFileEventLog({ dir: '' })).code, 'INVALID_ENGINE_INPUT');
  assert.equal(invalidErrorOf(() => createFileEventLog(null)).code, 'INVALID_ENGINE_INPUT');
});

// 测试结束后清理临时目录
test('cleanup: 移除全部临时目录', () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(dirs.length > 0);
});
