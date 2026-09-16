// R2 工作包5/6 候选协议测试:
//   - 点名/主动提醒候选协议(src/reminders.mjs)
//   - 人工纠偏记录与规则提升判定(src/human-feedback.mjs)
// 零依赖(node:test);每条协议规则一个独立 test(规则编号对应 PROTOCOL_NOTES.md 规则表)。
// 运行:node --test test/unit/15-protocol.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planReminders,
  ALLOWED_ACTIONS,
  REMINDER_EVENT_KINDS,
} from '../../src/reminders.mjs';
import {
  createCorrectionRecord,
  canPromoteToGlobalRule,
  buildImprovementPlan,
  AWAITING_HUMAN_DECISION,
} from '../../src/human-feedback.mjs';
import { hasCJK } from '../helpers.mjs';

// 合成授权上下文(仅测试用,不代表任何真实会话)。
const AUTH = { sessionId: 'sess-demo-1', generation: 3 };

const ev = (over = {}) => ({
  kind: 'budget_warning',
  key: 'K1',
  importance: 'important',
  at: '2026-09-13T08:00:00Z',
  ...over,
});

// ---- 提醒协议(planReminders)----

test('R1 仅授权上下文才提醒:authorizedContext 为 null/false 返回空计划', () => {
  // 即使含 important 白名单事件与点名,未授权上下文也不产生任何提醒条目。
  const events = [ev(), ev({ kind: 'human_mention', key: 'M1', importance: 'normal' })];
  for (const authorizedContext of [null, false]) {
    const plan = planReminders({ events, authorizedContext });
    assert.deepEqual(plan.items, []);
    assert.equal(plan.generatedBy, 'candidate-protocol-v0');
    assert.equal(plan.requiresHumanAck, true);
  }
});

test('R2 普通事件不打断:白名单 kind 且 importance=normal 不进计划', () => {
  const plan = planReminders({
    events: [
      ev({ importance: 'normal' }),
      ev({ kind: 'evidence_version_changed', key: 'K2', importance: 'normal' }),
    ],
    authorizedContext: AUTH,
  });
  assert.deepEqual(plan.items, []);
});

test('R3 白名单外 kind 一律视为普通事件:即使声明 important 也不进计划(事件源不能自升重要度)', () => {
  const kind = 'model_suggests_increase_limit';
  assert.ok(!REMINDER_EVENT_KINDS.includes(kind));
  const plan = planReminders({
    events: [ev({ kind, importance: 'important' })],
    authorizedContext: AUTH,
  });
  assert.deepEqual(plan.items, []);
});

test('R4 点名例外:human_mention 即使 normal 也进计划(点名是人的主动行为)', () => {
  const plan = planReminders({
    events: [ev({ kind: 'human_mention', key: 'mention-001', importance: 'normal', at: '2026-09-13T09:30:00Z' })],
    authorizedContext: AUTH,
  });
  assert.equal(plan.items.length, 1);
  const item = plan.items[0];
  assert.equal(item.key, 'mention-001');
  assert.equal(item.kind, 'human_mention');
  assert.equal(item.importance, 'normal');
  assert.equal(item.occurrences, 1);
  assert.equal(item.firstAt, '2026-09-13T09:30:00Z');
  assert.equal(item.lastAt, '2026-09-13T09:30:00Z');
  assert.equal(item.action, 'notify_human');
});

test('R5 重复合并:同 key 合并为一条,occurrences 计数,重要度取最高,kind 取最高重要度者', () => {
  const plan = planReminders({
    events: [
      ev({ kind: 'evidence_version_changed', key: 'EV-003', importance: 'normal', at: 't1' }),
      ev({ kind: 'evidence_version_changed', key: 'EV-003', importance: 'important', at: 't2' }),
      ev({ kind: 'result_stale', key: 'EV-003', importance: 'important', at: 't3' }),
      ev({ key: 'EV-999', importance: 'important', at: 't2' }), // 不同 key 不合并
    ],
    authorizedContext: AUTH,
  });
  assert.equal(plan.items.length, 2);
  const merged = plan.items.find((i) => i.key === 'EV-003');
  // normal 事件(第 1 条)按 R2 不准入:occurrences 只计进入计划的 2 条重要事件。
  assert.equal(merged.occurrences, 2);
  assert.equal(merged.importance, 'important');
  assert.equal(merged.kind, 'evidence_version_changed'); // 同为最高重要度时取先出现者
  assert.equal(merged.firstAt, 't2');
  assert.equal(merged.lastAt, 't3');
  const other = plan.items.find((i) => i.key === 'EV-999');
  assert.equal(other.occurrences, 1);
});

test('R7 动作白名单:条目 action 只能是 notify_human,不存在 approve/decision/retry 类自动动作', () => {
  const plan = planReminders({
    events: [
      ev(),
      ev({ kind: 'human_mention', key: 'M2', importance: 'normal' }),
      ev({ kind: 'session_paused', key: 'S1' }),
    ],
    authorizedContext: AUTH,
  });
  assert.ok(plan.items.length >= 2);
  for (const item of plan.items) {
    assert.equal(item.action, 'notify_human');
    assert.ok(Object.keys(item).every((k) => ['key', 'kind', 'importance', 'occurrences', 'firstAt', 'lastAt', 'action'].includes(k)));
  }
  assert.deepEqual(ALLOWED_ACTIONS, ['notify_human']);
  assert.doesNotMatch(JSON.stringify(plan), /approve|decision|retry/i);
});

test('R6 跨批合并:previousPlan 同 key 未处理继承首次出现时间并累计 occurrences;已确认(acknowledged)不继承', () => {
  const currentEvents = [ev({ key: 'K1', at: 't5' })];
  const carried = planReminders({
    events: currentEvents,
    authorizedContext: AUTH,
    previousPlan: {
      items: [{
        key: 'K1', kind: 'budget_warning', importance: 'important',
        occurrences: 2, firstAt: 't0', lastAt: 't2', action: 'notify_human',
      }],
    },
  });
  assert.equal(carried.items.length, 1);
  assert.equal(carried.items[0].occurrences, 3); // 2(上批)+ 1(本批)
  assert.equal(carried.items[0].firstAt, 't0'); // 继承首次出现时间
  assert.equal(carried.items[0].lastAt, 't5');

  const acked = planReminders({
    events: currentEvents,
    authorizedContext: AUTH,
    previousPlan: {
      items: [{ key: 'K1', occurrences: 2, firstAt: 't0', lastAt: 't2', acknowledged: true }],
    },
  });
  assert.equal(acked.items[0].occurrences, 1); // 已人工确认,不跨批累计
  assert.equal(acked.items[0].firstAt, 't5');
});

test('R9 非法输入:TypeError 且消息为中文(失败关闭,授权上下文必须显式声明)', () => {
  const bad = [
    { args: { events: 'not-array', authorizedContext: AUTH } },
    { args: { authorizedContext: AUTH } }, // events 缺失
    { args: { events: [null], authorizedContext: AUTH } },
    { args: { events: [ev({ key: '' })], authorizedContext: AUTH } },
    { args: { events: [ev({ kind: '' })], authorizedContext: AUTH } },
    { args: { events: [ev({ importance: 'urgent' })], authorizedContext: AUTH } },
    { args: { events: [ev({ at: undefined })], authorizedContext: AUTH } },
    { args: { events: [], authorizedContext: undefined } }, // 缺省 ≠ null:必须显式声明
    { args: { events: [], authorizedContext: '' } },        // 其余 falsy 值视为非法
    { args: { events: [], authorizedContext: AUTH, previousPlan: { items: 'x' } } },
  ];
  for (const { args } of bad) {
    assert.throws(() => planReminders(args), TypeError);
  }
  assert.throws(
    () => planReminders({ events: [], authorizedContext: undefined }),
    (e) => e instanceof TypeError && hasCJK(e.message),
  );
});

// ---- 纠偏协议(createCorrectionRecord / canPromoteToGlobalRule / buildImprovementPlan)----

test('C1 decidedBy 仅允许 human:传 model/ai 一律 TypeError(模型不自升权限的结构化表达)', () => {
  const base = {
    id: 'CR-001', scope: 'local', targetKind: 'evidence_item', targetId: 'EV-014',
    reason: '实控人现场照片模糊,无法核对经营场所', sample: { photoId: 'SYN-P-001' },
    impact: '本项目该项证据须现场补拍', decidedBy: 'human',
  };
  for (const decidedBy of ['model', 'ai', 'credit_model', 'auto', 1, true]) {
    assert.throws(() => createCorrectionRecord({ ...base, decidedBy }), TypeError);
  }
  const noDecider = { ...base };
  delete noDecider.decidedBy;
  assert.throws(() => createCorrectionRecord(noDecider), TypeError); // decidedBy 缺失同样非法
  let caught = null;
  try {
    createCorrectionRecord({ ...base, decidedBy: 'model' });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof TypeError);
  assert.ok(hasCJK(caught.message), '错误消息必须为中文');
  assert.match(caught.message, /human/);
});

test('C2 缺必填字段/空串/非法 scope:TypeError', () => {
  const base = {
    id: 'CR-002', scope: 'global', targetKind: 'rule', targetId: 'R-101',
    reason: '同一问题跨项目复现', sample: '合成样本A', impact: '规则更新须人工评审', decidedBy: 'human',
  };
  for (const field of ['id', 'scope', 'targetKind', 'targetId', 'reason', 'sample', 'impact', 'decidedBy']) {
    const broken = { ...base };
    delete broken[field];
    assert.throws(() => createCorrectionRecord(broken), TypeError, `缺字段 ${field} 应抛 TypeError`);
  }
  assert.throws(() => createCorrectionRecord({ ...base, reason: '' }), TypeError);
  assert.throws(() => createCorrectionRecord({ ...base, sample: null }), TypeError);
  assert.throws(() => createCorrectionRecord({ ...base, scope: 'team' }), TypeError);
  // 合法 scope:local / global 均可创建
  assert.equal(createCorrectionRecord({ ...base, scope: 'local' }).scope, 'local');
  assert.equal(createCorrectionRecord({ ...base, scope: 'global' }).scope, 'global');
});

test('C3 记录冻结:篡改任意字段抛 TypeError;样本/反例深冻结;decidedBy 恒为 human', () => {
  const record = createCorrectionRecord({
    id: 'CR-003', scope: 'local', targetKind: 'evidence_item', targetId: 'EV-014',
    reason: '实控人现场照片模糊,无法核对经营场所',
    sample: { photoId: 'SYN-P-001', note: '合成样本' },
    counterExample: { photoId: 'SYN-P-002', note: '另一项目同类照片清晰可核' },
    impact: '仅本项目该证据须补拍,不改全局规则',
    decidedBy: 'human',
  });
  assert.equal(record.decidedBy, 'human');
  assert.equal(record.counterExample === null, false);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.sample));
  assert.ok(Object.isFrozen(record.counterExample));
  assert.throws(() => { record.scope = 'global'; }, TypeError);
  assert.throws(() => { record.decidedBy = 'model'; }, TypeError);
  assert.throws(() => { record.sample.photoId = 'tampered'; }, TypeError);
  assert.throws(() => { record.counterExample.photoId = 'tampered'; }, TypeError);
});

test('C4 canPromoteToGlobalRule 四个 false 条件各一例(单例不能触发规则替换)', () => {
  const valid = { scope: 'global', sampleCount: 3, distinctCases: 2, counterExamples: ['反例1'] };
  const cases = [
    { ...valid, scope: 'local' },          // 条件1:scope 非 global
    { ...valid, sampleCount: 1 },          // 条件2:单例
    { ...valid, distinctCases: 1 },        // 条件3:同一情形重复
    { ...valid, counterExamples: [] },     // 条件4:反例为空
    { ...valid, counterExamples: null },   // 条件4':反例缺失
  ];
  for (const r of cases.map((args) => canPromoteToGlobalRule(args))) {
    assert.equal(r.allowed, false);
    assert.ok(typeof r.reason === 'string' && hasCJK(r.reason));
  }
});

test('C5 canPromoteToGlobalRule 合法输入 allowed=true,且 reason 说明生效仍需人工决策记录', () => {
  const r = canPromoteToGlobalRule({
    scope: 'global',
    sampleCount: 5,
    distinctCases: 3,
    counterExamples: [{ case: '逆光' }, { case: '翻拍屏幕' }],
  });
  assert.equal(r.allowed, true);
  assert.ok(hasCJK(r.reason));
  assert.match(r.reason, /human/);
  assert.ok(Object.isFrozen(r));
});

test('C6/C7 buildImprovementPlan:四要素齐全,status 恒 awaiting_human_decision,planId 确定性派生且不可篡改', () => {
  const args = {
    ruleId: 'rule-photo-verify',
    samples: ['样本1:某贸易公司现场照片模糊(合成)', '样本2:另一项目门牌照片逆光(合成)'],
    counterExamples: ['反例1:现场实时视频核验清晰的项目'],
    impact: '远程照片核验证据采信标准需评估;修订前按现状执行',
    humanDecision: '由信审负责人评审;未经人工签发不得生效',
  };
  const plan = buildImprovementPlan(args);
  assert.equal(plan.planId, 'improvement-plan:rule-photo-verify');
  assert.equal(plan.status, AWAITING_HUMAN_DECISION);
  assert.deepEqual(plan.samples, args.samples);                 // 要素一:样本
  assert.deepEqual(plan.counterExamples, args.counterExamples); // 要素二:反例
  assert.equal(plan.impact, args.impact);                       // 要素三:影响
  assert.equal(plan.humanDecision, args.humanDecision);         // 要素四:人工决策
  assert.ok(plan.samples.length >= 1 && plan.counterExamples.length >= 1 && plan.impact && plan.humanDecision);
  assert.ok(Object.isFrozen(plan));
  assert.throws(() => { plan.status = 'auto_applied'; }, TypeError); // 不可篡改为自动执行

  // 即便 humanDecision 传入"同意"字样,状态仍恒为待人工决策(本层无自动训练/自动执行入口)。
  const stillAwaiting = buildImprovementPlan({ ...args, humanDecision: '同意提升' });
  assert.equal(stillAwaiting.status, 'awaiting_human_decision');
});

test('C8/R8 确定性:三个纯函数同输入两次调用 JSON 相等(无时间戳、无随机数)', () => {
  const remindArgs = {
    events: [ev(), ev({ kind: 'human_mention', key: 'M1', importance: 'normal', at: 't0' })],
    authorizedContext: AUTH,
  };
  assert.equal(JSON.stringify(planReminders(remindArgs)), JSON.stringify(planReminders(remindArgs)));

  const recordArgs = {
    id: 'CR-DET', scope: 'local', targetKind: 'evidence_item', targetId: 'EV-014',
    reason: '照片模糊', sample: { a: 1 }, impact: '补拍', decidedBy: 'human',
  };
  assert.equal(JSON.stringify(createCorrectionRecord(recordArgs)), JSON.stringify(createCorrectionRecord(recordArgs)));

  const planArgs = {
    ruleId: 'r1', samples: ['s1'], counterExamples: ['c1'], impact: '影响说明', humanDecision: '由人签发',
  };
  assert.equal(JSON.stringify(buildImprovementPlan(planArgs)), JSON.stringify(buildImprovementPlan(planArgs)));
});
