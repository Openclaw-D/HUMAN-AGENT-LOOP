// 数据契约测试：断言 demo-story.json 本身的机制契约（不是重复读 JSON——
// 每条断言都对应模块/任务书要求的结构保证）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateStory, STORY_SCHEMA } from '../candidate/demo-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const story = JSON.parse(readFileSync(path.join(here, '..', 'demo-story.json'), 'utf8'));

test('story 通过 validateStory 全部静态契约（schema/ID唯一/引用存在/静态可达）', () => {
  const res = validateStory(story);
  assert.equal(res.ok, true, `静态校验失败：${res.errors.join('；')}`);
  assert.equal(story.schema, STORY_SCHEMA);
});

test('ID 唯一且引用存在（requires/requiresAny/evidenceRefs/stages）', () => {
  const ids = story.steps.map((s) => s.stepId);
  assert.equal(new Set(ids).size, ids.length, '步骤 ID 必须唯一');
  const idSet = new Set(ids);
  for (const s of story.steps) {
    for (const r of [...s.requires, ...s.requiresAny]) {
      const rid = typeof r === 'string' ? r : r.step;
      assert.ok(idSet.has(rid), `${s.stepId} 引用了不存在的步骤 ${rid}`);
    }
  }
  const stageIds = new Set(story.stages.map((x) => x.id));
  for (const s of story.steps) assert.ok(stageIds.has(s.stage), `${s.stepId} 的 stage 非法`);
});

test('五阶段与终态符合任务书：商机/预审/尽调/签约/租后，结清为终态；材料补充不是额外阶段', () => {
  assert.deepEqual(
    story.stages.map((s) => s.label),
    ['商机', '预审', '尽调', '签约', '租后']
  );
  assert.equal(story.terminalStepId, 'PR-03');
  const terminal = story.steps.find((s) => s.stepId === story.terminalStepId);
  assert.equal(terminal.stage, 'postRental');
  assert.match(terminal.messages[0].text, /已结清/);
  // 退回补充步骤必须挂在尽调/签约阶段内，不得另立阶段
  for (const sid of ['DD-RT-1', 'DD-RT-2', 'SG-RT']) {
    const st = story.steps.find((s) => s.stepId === sid);
    assert.ok(st, `${sid} 存在`);
    assert.ok(['dueDiligence', 'signing'].includes(st.stage), `${sid} 是阶段内补充动作，不是新业务阶段`);
  }
});

test('每个主线步骤具备任务书 CP1 要求的字段：触发/预设中文消息/阶段/前提/证据版本/auto人工类型', () => {
  for (const s of story.steps) {
    assert.ok(s.trigger && s.trigger.length > 0, `${s.stepId} 缺触发说明`);
    assert.ok(['auto', 'human-action', 'human-decision'].includes(s.kind), `${s.stepId} 缺自动/人工类型`);
    assert.ok(Array.isArray(s.messages), `${s.stepId} 缺预设消息`);
    for (const m of s.messages) {
      assert.ok(typeof m.text === 'string' && m.text.length > 0, `${s.stepId} 有空消息`);
      assert.ok(story.actors[m.actor], `${s.stepId} 消息 actor 未注册：${m.actor}`);
    }
    assert.ok(Array.isArray(s.requires) && Array.isArray(s.requiresAny), `${s.stepId} 缺前提字段`);
  }
});

test('不为六方齐全而让所有人每步发言：并行组四步各只发言一次，其余步骤不堆砌角色', () => {
  for (const s of story.steps) {
    assert.ok(s.messages.length <= 3, `${s.stepId} 消息过多（${s.messages.length}），应使用必要消息`);
  }
  const pg = story.parallelGroups[0];
  assert.deepEqual(pg.steps, ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  const actorSpeak = {};
  for (const s of story.steps) for (const m of s.messages) actorSpeak[m.actor] = (actorSpeak[m.actor] ?? 0) + 1;
  // 四域各在其必要节点发言，不在主线每步重复
  assert.equal(actorSpeak.policy, 1, '政策岗只在必要节点发言');
  assert.equal(actorSpeak.commerce, 1, '商务岗只在必要节点发言');
});

test('部分并行结构：疑点标记后四项仅依赖 DD-02，可任意顺序；人工判断节点汇合', () => {
  for (const sid of ['DD-03', 'DD-04', 'DD-05', 'DD-06']) {
    const st = story.steps.find((x) => x.stepId === sid);
    assert.deepEqual(st.requires, ['DD-02'], `${sid} 应只依赖 DD-02（并行）`);
  }
  const gate = story.steps.find((x) => x.stepId === 'DD-07');
  assert.ok(gate.kind === 'human-decision');
  assert.deepEqual(
    [...gate.requires].sort(),
    ['DD-03', 'DD-04', 'DD-05', 'DD-06'],
    'DD-07 必须等并行四项全部完成'
  );
});

test('远程尽调矛盾场景存在且双侧来源绑定：满负荷 vs 一半产能 + 电费张力，并标合成', () => {
  const dd02 = story.steps.find((x) => x.stepId === 'DD-02');
  const allText = dd02.messages.map((m) => m.text).join('\n');
  assert.match(allText, /满负荷/);
  assert.match(allText, /一半产能在跑/);
  assert.match(allText, /M1-DOC-01 v1/);
  assert.match(allText, /M1-DOC-08 v1/);
  assert.match(allText, /不判定哪次为真/);
  assert.ok(dd02.evidenceAdds.some((e) => e.docId === 'M1-DOC-08'), '现场问答证据已挂接');
  const scene = story.steps.find((x) => x.stepId === 'DD-01');
  assert.match(scene.messages[0].text, /实控人在经营现场/);
  assert.match(scene.messages[0].text, /我方远程参与/);
  assert.match(scene.messages[0].text, /财务、生产人员在现场或实时入会/);
});

test('人工决定节点齐备：确认/纠正/退回三选项在 DD-07；再入节点收窄为确认/纠正；签约复核含确认/退回', () => {
  const d07 = story.steps.find((x) => x.stepId === 'DD-07');
  assert.deepEqual(d07.decisionOptions.map((o) => o.decision), ['confirm', 'correct', 'return']);
  const d07b = story.steps.find((x) => x.stepId === 'DD-07B');
  assert.deepEqual(d07b.decisionOptions.map((o) => o.decision), ['confirm', 'correct']);
  const sg02 = story.steps.find((x) => x.stepId === 'SG-02');
  assert.deepEqual(sg02.decisionOptions.map((o) => o.decision), ['confirm', 'return']);
  const sg02b = story.steps.find((x) => x.stepId === 'SG-02B');
  assert.deepEqual(sg02b.decisionOptions.map((o) => o.decision), ['confirm']);
});

test('纠正选项声明证据升版与意见作废；退回选项 outcome=return 且指向补充路径', () => {
  const correct = story.steps.find((x) => x.stepId === 'DD-07').decisionOptions.find((o) => o.decision === 'correct');
  const up = correct.effects.evidenceUpdates[0];
  assert.equal(up.docId, 'M1-DOC-01');
  assert.equal(up.newVersion, 2);
  assert.equal(up.supersedesVersion, 1);
  assert.deepEqual(correct.effects.invalidateOpinions, ['OP-CAP-ENERGY']);
  const ret = story.steps.find((x) => x.stepId === 'DD-07').decisionOptions.find((o) => o.decision === 'return');
  assert.equal(ret.outcome, 'return');
  const rt1 = story.steps.find((x) => x.stepId === 'DD-RT-1');
  assert.deepEqual(rt1.requires, [{ step: 'DD-07', outcome: ['return'] }], '退回路径仅由 return 结果解锁');
});

test('退回后不得错误全绿：补充步骤带 viewPatch（信审红灯 + 整体注记），窗口在汇合里程碑前', () => {
  const rt1 = story.steps.find((x) => x.stepId === 'DD-RT-1');
  assert.equal(rt1.viewPatch.patch.domains.credit.judgment, 'red');
  assert.match(rt1.viewPatch.patch.overallNote, /未通过/);
  assert.equal(rt1.viewPatch.ceilingMilestoneIndex, 6, 'patch 窗口在 DD-08（里程碑6）前生效');
  const dd08 = story.steps.find((x) => x.stepId === 'DD-08');
  assert.equal(dd08.milestoneIndex, 6);
});

test('判断节点不可被自动越过：human-decision/human-action 步骤标记齐全', () => {
  for (const sid of ['DD-01', 'DD-07', 'DD-07B', 'SG-02', 'SG-02B']) {
    const st = story.steps.find((x) => x.stepId === sid);
    assert.ok(['human-action', 'human-decision'].includes(st.kind), `${sid} 必须是人工节点`);
  }
});

test('合成声明与隔离：synthetic=true，演示数据不引用 expected/model-input 内容', () => {
  assert.equal(story.synthetic, true);
  assert.match(story.syntheticNotice, /匿名合成/);
  const raw = JSON.stringify(story);
  assert.ok(!raw.includes('expected'), '演示数据不得包含预期验证要点内容');
  assert.ok(!raw.includes('.model-input.json'), '演示数据不读取 model-input 文件');
  for (const s of story.steps) {
    for (const m of s.messages) {
      if ((story.actors[m.actor]?.fromName ?? '').includes('模型')) {
        assert.ok(m.marks.includes('模型（模拟）'), '模型角色消息必须带模型（模拟）标记');
      }
    }
  }
});
