// V6 REMOTE_DD_LONG_RUN · 事件时间线与项目阶段（SA-R2-B1）纯逻辑 + 服务端接线回归。
// 全部合成演示语义：生命周期阶段/进度仅是阶段标记，不构成审批依据；模型 authority=none。
// 运行：node --experimental-strip-types --test test/v5-preview-remote-timeline.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 数据目录必须在导入被测模块后、调用任何服务函数前指向隔离临时目录（共享进程时放入首个测试）。
const dataDir = mkdtempSync(join(tmpdir(), 'remote-timeline-data-'));

const svc = await import('../lib/v5-preview/remote-service.ts');
const timeline = await import('../lib/v5-preview/remote-timeline.ts');

function expectError(action, code) {
  let caught = null;
  try { action(); } catch (e) { caught = e; }
  assert.ok(caught !== null, `应当抛出 ${code}`);
  assert.equal(caught.code, code, `错误码应为 ${code}，实际 ${caught && caught.code}：${caught && caught.message}`);
}

test('T0：隔离数据目录（本套件首个测试内设置 env；共享进程下避免跨套件互踩）', () => {
  process.env.V5_PREVIEW_DATA_DIR = dataDir;
});

// ---------------------------------------------------------------------------
// projectLifecycle：生命周期四段 + settled 完整终点
// ---------------------------------------------------------------------------

test('T1：projectLifecycle——四段推进 + 结清终点；进度标记（租后≈75/结清=100）必须携带"不构成审批依据"声明', () => {
  const pre = timeline.projectLifecycle('pre_review');
  assert.equal(pre.ok, true);
  assert.equal(pre.label, '预审');
  assert.equal(pre.sequenceIndex, 0);
  assert.equal(pre.isTerminal, false);
  const dd = timeline.projectLifecycle('due_diligence');
  assert.equal(dd.ok, true);
  assert.equal(dd.label, '尽调');
  assert.equal(dd.sequenceIndex, 1);
  const sign = timeline.projectLifecycle('signing');
  assert.equal(sign.sequenceIndex, 2);
  const post = timeline.projectLifecycle('post_rental');
  assert.equal(post.sequenceIndex, 3);
  assert.equal(post.progressPercent, 75, '起租（租后开始）≈75（阶段标记）');
  const settled = timeline.projectLifecycle('settled');
  assert.equal(settled.ok, true);
  assert.equal(settled.label, '结清');
  assert.equal(settled.isTerminal, true, 'settled 是完整终点');
  assert.equal(settled.sequenceIndex, null, 'settled 不在四段推进序列内');
  assert.equal(settled.progressPercent, 100, '结清 = 100');
  // 进度声明必须随行；且映射单调（仅演示，不承载时间/工作量含义）
  for (const r of [pre, dd, sign, post, settled]) assert.match(r.progressNote, /不构成审批依据/);
  assert.ok(pre.progressPercent < dd.progressPercent && dd.progressPercent < sign.progressPercent
    && sign.progressPercent < post.progressPercent && post.progressPercent < settled.progressPercent);
});

test('T2：未知 stage 失败关闭（ok:false 不猜测）；标签函数未知输入返回安全回退', () => {
  const bad = timeline.projectLifecycle('pre_review_typo');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /未知生命周期阶段/);
  const empty = timeline.projectLifecycle('');
  assert.equal(empty.ok, false);
  assert.equal(timeline.lifecycleStageLabel('signing'), '签约');
  assert.equal(timeline.lifecycleStageLabel('nope'), '未知阶段');
  assert.equal(timeline.lifecycleStageLabel(''), '未知阶段');
});

// ---------------------------------------------------------------------------
// domainCollaborationSteps：四域点阵语义 ≠ 生命周期四段（类型层区分）
// ---------------------------------------------------------------------------

test('T3：domainCollaborationSteps——每域四步 接收/处理/协同/核验；与生命周期键集不相交、说明语义不同', () => {
  const steps = timeline.domainCollaborationSteps();
  assert.equal(steps.length, 4, '每域四步');
  assert.deepEqual(steps.map((s) => s.step), ['received', 'processing', 'collaborating', 'verified']);
  assert.deepEqual(steps.map((s) => s.label), ['接收', '处理', '协同', '核验']);
  for (const s of steps) assert.match(s.note, /语义不同/, '必须显式声明与生命周期语义不同');
  // 语义区分的可观察面：协作步骤键与生命周期键零交集
  const overlap = steps.map((s) => s.step).filter((k) => timeline.LIFECYCLE_ORDER.includes(k) || k === 'settled');
  assert.equal(overlap.length, 0);
  assert.equal(timeline.collaborationStepLabel('verified'), '核验');
  assert.equal(timeline.collaborationStepLabel('pre_review'), '未知协作步骤', '生命周期阶段值不是协作步骤');
  assert.equal(timeline.collaborationStepLabel(''), '未知协作步骤');
});

// ---------------------------------------------------------------------------
// appendTimelineEvent：只追加、24h ISO 时间在先、level 不推断
// ---------------------------------------------------------------------------

test('T4：appendTimelineEvent——24 小时制 ISO 时间在先、人员、level、事件、前后变化、影响；只追加不改写', () => {
  const state = { events: [] };
  const e1 = timeline.appendTimelineEvent(state, {
    sessionId: 'rs-1',
    actor: '政策 · 楊政策（合成）',
    kind: 'chat_confirmed',
    level: 'major',
    event: '聊天确认后改变正式状态',
    before: '待确认',
    after: '已确认',
    impact: '信审可引用该结论',
  });
  assert.match(e1.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, '24 小时制 ISO 时间');
  assert.equal(Number.isNaN(Date.parse(e1.at)), false, 'at 可解析为有效时间');
  assert.match(e1.atDisplay, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, 'atDisplay 为 24 小时制 YYYY-MM-DD HH:mm');
  assert.equal(e1.atDisplay, `${e1.at.slice(0, 10)} ${e1.at.slice(11, 16)}`);
  assert.equal(e1.actor, '政策 · 楊政策（合成）');
  assert.equal(e1.level, 'major', '申报 level 原样保留');
  assert.equal(e1.event, '聊天确认后改变正式状态');
  assert.equal(e1.before, '待确认');
  assert.equal(e1.after, '已确认');
  assert.equal(e1.impact, '信审可引用该结论');
  // 只追加：追加第二条不改写第一条
  const firstBefore = JSON.parse(JSON.stringify(state.events[0]));
  const e2 = timeline.appendTimelineEvent(state, { sessionId: 'rs-1', actor: '信审 · 张信审（合成）', kind: 'review', event: '出具信审意见' });
  assert.equal(state.events.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(state.events[0])), firstBefore, '既有事件未被改写');
  assert.equal(state.events[1].eventId, e2.eventId);
  assert.notEqual(e1.eventId, e2.eventId, '事件 ID 不重复');
});

test('T5：appendTimelineEvent 边界——level 缺失/空 → unknown（不推断）；非法字段失败关闭不部分写入；展示行时间在先', () => {
  const state = { events: [] };
  const noLevel = timeline.appendTimelineEvent(state, { sessionId: 'rs-2', actor: '模型（模拟，authority=none）', kind: 'model_simulation', event: '模型预处理（模拟）' });
  assert.equal(noLevel.level, 'unknown', '未知 level 保留 unknown，不从身份推断权限/职级');
  const emptyLevel = timeline.appendTimelineEvent(state, { sessionId: 'rs-2', actor: 'x（合成）', kind: 'note', level: '', event: '空 level' });
  assert.equal(emptyLevel.level, 'unknown');
  assert.equal(noLevel.before, null);
  assert.equal(noLevel.after, null);
  assert.equal(noLevel.impact, null);
  // 非法字段：失败关闭，不产生部分写入
  for (const bad of [
    { sessionId: '', actor: 'a', kind: 'k', event: 'e' },
    { sessionId: 's', actor: '', kind: 'k', event: 'e' },
    { sessionId: 's', actor: 'a', kind: '', event: 'e' },
    { sessionId: 's', actor: 'a', kind: 'k', event: '' },
    { sessionId: 's', actor: 'a', kind: 'k', event: 'e', level: 42 },
  ]) {
    assert.throws(() => timeline.appendTimelineEvent(state, bad), /非法/);
  }
  assert.throws(() => timeline.appendTimelineEvent({ events: 'nope' }, { sessionId: 's', actor: 'a', kind: 'k', event: 'e' }), /state\.events 必须是数组/);
  assert.equal(state.events.length, 2, '失败尝试不追加');
  // 展示行：时间在先 → 人员 → level → 事件 →（前 → 后）→（影响）
  const line = timeline.formatTimelineEvent(noLevel);
  assert.match(line, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · /, '展示行时间在先');
  assert.match(line, /level=unknown/);
  const full = timeline.formatTimelineEvent(timeline.appendTimelineEvent(state, {
    sessionId: 'rs-2', actor: '商务 · 陈商务（合成）', kind: 'conflict_routed', level: 'major', event: '冲突路由', before: '报价 A', after: '报价 B', impact: '待商务裁定',
  }));
  assert.match(full, /（前：报价 A → 后：报价 B）/);
  assert.match(full, /；影响：待商务裁定/);
});

// ---------------------------------------------------------------------------
// predecessorAllows：前序依赖（信审 × 政策域前序）
// ---------------------------------------------------------------------------

test('T6：predecessorAllows——信审模型预处理可在政策未结束时进行；正式核验完成越前序被拒；未知输入失败关闭', () => {
  // 允许：政策未结束（预审中）信审可做模型预处理（authority=none，仅供参考）
  const pre = timeline.predecessorAllows('model_preprocessing', 'pre_review');
  assert.equal(pre.allowed, true);
  assert.match(pre.reason, /不依赖政策域结论/);
  // 拒绝：预审阶段不得越过前序出具正式核验完成
  const gate = timeline.predecessorAllows('formal_verification', 'pre_review');
  assert.equal(gate.allowed, false, '核验越前序被拒');
  assert.match(gate.reason, /前序/);
  // 尽调及以后：前序视为已具备
  const ok = timeline.predecessorAllows('formal_verification', 'due_diligence');
  assert.equal(ok.allowed, true);
  assert.equal(timeline.predecessorAllows('formal_verification', 'post_rental').allowed, true);
  // settled：完整终点仅留痕
  const settled = timeline.predecessorAllows('formal_verification', 'settled');
  assert.equal(settled.allowed, true);
  assert.match(settled.reason, /结清/);
  // 失败关闭：未知步骤 / 未知阶段一律不允许
  assert.equal(timeline.predecessorAllows('unknown_step', 'due_diligence').allowed, false);
  assert.equal(timeline.predecessorAllows('', 'due_diligence').allowed, false);
  assert.equal(timeline.predecessorAllows('formal_verification', 'nope').allowed, false);
  assert.equal(timeline.predecessorAllows('model_preprocessing', '').allowed, false);
});

// ---------------------------------------------------------------------------
// routeConflict：重大新旧冲突 → 专业域人工裁定，系统不认定新内容天然正确
// ---------------------------------------------------------------------------

test('T7：routeConflict——重大新旧冲突交回专业域且 resolved=false；一致/缺失不路由', () => {
  const c = timeline.routeConflict('设备台账 30 台（正式结论）', '客户现场口述：28 台');
  assert.equal(c.conflict, true);
  assert.equal(c.route, 'domain_professional');
  assert.equal(c.resolved, false, '系统不代裁，不认定新内容天然正确');
  assert.match(c.reason, /并存/);
  // 一致：无冲突
  const same = timeline.routeConflict('同一结论', '同一结论');
  assert.equal(same.conflict, false);
  assert.equal(same.route, 'none');
  assert.equal(same.resolved, true);
  // 一方缺失：不算分歧，不路由、不补齐
  for (const [o, n] of [['原结论', ''], ['', '新值'], [null, '新值'], ['原结论', undefined], [42, '新值']]) {
    const r = timeline.routeConflict(o, n);
    assert.equal(r.conflict, false);
    assert.equal(r.route, 'none');
    assert.match(r.reason, /缺失/);
  }
});

// ---------------------------------------------------------------------------
// remote-service 接线：re-export 可用 + 服务端 INVALID_INPUT 约束入口
// ---------------------------------------------------------------------------

test('T8：remote-service 接线——re-export 可用；appendRemoteTimelineEvent 服务端校验（INVALID_INPUT）与只追加', () => {
  // re-export（既有函数行为未改：仅追加导出面）
  for (const name of ['projectLifecycle', 'lifecycleStageLabel', 'domainCollaborationSteps', 'collaborationStepLabel', 'appendTimelineEvent', 'formatTimelineEvent', 'predecessorAllows', 'routeConflict']) {
    assert.equal(typeof svc[name], 'function', `remote-service 应 re-export ${name}`);
  }
  assert.equal(svc.LIFECYCLE_PROGRESS_DISCLAIMER.match(/不构成审批依据/) !== null, true);
  assert.equal(svc.projectLifecycle('signing').label, '签约');
  assert.equal(svc.predecessorAllows('formal_verification', 'pre_review').allowed, false);
  assert.equal(svc.routeConflict('a', 'b').route, 'domain_professional');
  // 服务端约束入口：INVALID_INPUT 语义（V5PreviewServiceError）
  expectError(() => svc.appendRemoteTimelineEvent([], { sessionId: 's', actor: 'a', kind: 'k', event: '' }), 'INVALID_INPUT');
  expectError(() => svc.appendRemoteTimelineEvent([], { sessionId: '', actor: 'a', kind: 'k', event: 'e' }), 'INVALID_INPUT');
  expectError(() => svc.appendRemoteTimelineEvent('nope', { sessionId: 's', actor: 'a', kind: 'k', event: 'e' }), 'INVALID_INPUT');
  expectError(() => svc.appendRemoteTimelineEvent([], { sessionId: 's', actor: 'a', kind: 'k', event: 'e', level: 42 }), 'INVALID_INPUT');
  expectError(() => svc.appendRemoteTimelineEvent([], { sessionId: 's', actor: 'a', kind: 'k', event: 'e', before: 42 }), 'INVALID_INPUT');
  // 合法追加：level 缺省 → unknown（不推断）；只追加
  const events = [];
  const { event } = svc.appendRemoteTimelineEvent(events, {
    sessionId: 'rs-9', actor: '商务 · 陈商务（合成）', kind: 'conflict_routed', event: '新旧冲突已路由专业域', before: '报价 A', after: '报价 B', impact: '待商务裁定',
  });
  assert.equal(event.level, 'unknown');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventId, event.eventId);
  expectError(() => svc.appendRemoteTimelineEvent(events, { sessionId: 'rs-9', actor: 'a', kind: 'k', event: 'e', impact: [] }), 'INVALID_INPUT');
  assert.equal(events.length, 1, '失败调用不追加');
});
