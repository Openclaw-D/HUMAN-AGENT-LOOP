// 机制行为测试：断言状态机契约（前提门、人工节点不可自动越过、幂等、升版、快照、
// 分支有限性、确定性、不可变性），全部走模块公开 API，不读 JSON 字段凑数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  validateStory,
  createDemoState,
  resetDemo,
  listAvailableActions,
  advance,
  decide,
  advanceAuto,
  views,
  storyMessages,
  evidenceState,
  assertEvidenceCite,
  isOpinionInvalidated,
  snapshot,
  restore,
} from '../candidate/demo-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rawStory = readFileSync(path.join(here, '..', 'demo-story.json'), 'utf8');
const story = JSON.parse(rawStory);

/** 便捷：推进到尽调疑点标记完成（自动段 + DD-01 + DD-02），并行组 DD-03..06 全部可用。 */
function uptoDoubtMarked() {
  let s = createDemoState(story);
  const r1 = advanceAuto(story, s, 'seed-auto-1');
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.completed, ['OPP-01', 'PRE-01', 'PRE-02']);
  assert.deepEqual(r1.stoppedAt, { stepId: 'DD-01', kind: 'human-action' });
  s = r1.state;
  const r2 = advance(story, s, 'DD-01', 'h-dd01');
  assert.equal(r2.ok, true);
  // DD-02 为 auto，可单步手动推进（便于构造"并行组全部待办"状态）
  const r3 = advance(story, r2.state, 'DD-02', 'h-dd02');
  assert.equal(r3.ok, true);
  return r3.state;
}

/** 完成并行组四项（任意给定顺序）。 */
function completeParallel(state, order) {
  let s = state;
  for (const [i, sid] of order.entries()) {
    const r = advance(story, s, sid, `h-${sid}-${i}`);
    assert.equal(r.ok, true, `${sid}: ${r.message ?? ''}`);
    s = r.state;
  }
  return s;
}

test('初始化与重置：resetDemo 与 createDemoState 深比较相等；初态视图=initialView、无可用人工动作', () => {
  const a = createDemoState(story);
  const b = resetDemo(story);
  assert.deepEqual(b, a);
  const v = views(story, a);
  assert.deepEqual(v.stages, story.initialView.stages);
  assert.equal(v.terminal, false);
  const acts = listAvailableActions(story, a);
  assert.deepEqual(acts.map((x) => x.stepId), ['OPP-01'], '初态只有主线起点可用');
});

test('确定性：相同动作序列产生深比较相等的状态（无时钟/随机）', () => {
  const run = () => {
    let s = uptoDoubtMarked();
    s = completeParallel(s, ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
    const d = decide(story, s, 'DD-07', 'h-d07', 'confirm');
    assert.equal(d.ok, true);
    const fin = advanceAuto(story, d.state, 'fin');
    assert.equal(fin.ok, true);
    return { state: fin.state, msgs: storyMessages(story, fin.state) };
  };
  const x = run();
  const y = run();
  assert.deepEqual(y, x);
});

test('不可变性：deepFreeze 输入与状态，全部 API 调用不改变既有对象', () => {
  const frozenStory = JSON.parse(rawStory);
  const freeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) freeze(o[k]);
    }
    return o;
  };
  freeze(frozenStory);
  let s = freeze(createDemoState(frozenStory));
  const before = JSON.stringify(s);
  advanceAuto(frozenStory, s, 'fr-1');
  advance(frozenStory, s, 'DD-01', 'fr-2');
  views(frozenStory, s);
  storyMessages(frozenStory, s);
  assert.equal(JSON.stringify(s), before, '被操作的状态对象不得被改动');
});

test('自动推进语义：一键完成全部可用常规动作（DD-02/DD-04..06），停在人工动作 DD-03，不越过', () => {
  let s = createDemoState(story);
  const r1 = advanceAuto(story, s, 'aa-1');
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.completed, ['OPP-01', 'PRE-01', 'PRE-02']);
  s = advance(story, r1.state, 'DD-01', 'aa-dd01').state;
  const r2 = advanceAuto(story, s, 'aa-2');
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.completed, ['DD-02', 'DD-04', 'DD-05', 'DD-06'], '常规动作一次推进呈现');
  assert.deepEqual(r2.stoppedAt, { stepId: 'DD-03', kind: 'human-action' }, '人工动作不被自动越过');
});

test('前序未满足不完成：跳步推进被明确拒绝（PREREQ_UNMET / UNKNOWN_STEP）', () => {
  const s = createDemoState(story);
  const r1 = advance(story, s, 'DD-02', 'x1');
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'PREREQ_UNMET');
  const r2 = advance(story, s, 'NO-SUCH', 'x2');
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'UNKNOWN_STEP');
  // 未完成并行组时判断节点不可达
  let s2 = uptoDoubtMarked();
  const r3 = decide(story, s2, 'DD-07', 'x3', 'confirm');
  assert.equal(r3.ok, false);
  assert.equal(r3.code, 'PREREQ_UNMET');
});

test('人工节点不可被自动越过：advanceAuto 停在 DD-01/DD-03/DD-07；对决定节点 advance 报 MUST_DECIDE', () => {
  let s = uptoDoubtMarked();
  const r = advance(story, s, 'DD-07', 'x1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MUST_DECIDE');
  // 决定节点也绝不因自动推进完成
  s = completeParallel(s, ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  const acts = listAvailableActions(story, s);
  assert.deepEqual(acts.map((a) => a.stepId), ['DD-07'], '只剰人工决定节点');
  assert.deepEqual(acts[0].decisionOptions.map((o) => o.decision), ['confirm', 'correct', 'return']);
  const fin = advanceAuto(story, s, 'x2');
  assert.equal(fin.ok, true);
  assert.deepEqual(fin.completed, [], '自动推进不得完成任何节点');
  assert.deepEqual(fin.stoppedAt, { stepId: 'DD-07', kind: 'human-decision' });
});

test('重复动作：同 requestId 同载荷=幂等重放（状态不变）；不同载荷=REQUEST_MISMATCH；已完成步骤新请求=ALREADY_COMPLETED', () => {
  let s = uptoDoubtMarked();
  const r1 = advance(story, s, 'DD-03', 'dup-1');
  assert.equal(r1.ok, true);
  const r2 = advance(story, r1.state, 'DD-03', 'dup-1');
  assert.equal(r2.ok, true);
  assert.equal(r2.replayed, true);
  assert.deepEqual(r2.state, r1.state, '幂等重放不改变状态');
  const r3 = decide(story, r1.state, 'DD-07', 'dup-1', 'confirm');
  assert.equal(r3.ok, false);
  assert.equal(r3.code, 'REQUEST_MISMATCH');
  const r4 = advance(story, r1.state, 'DD-03', 'dup-2');
  assert.equal(r4.ok, false);
  assert.equal(r4.code, 'ALREADY_COMPLETED');
  // 空 requestId 明确拒绝
  const r5 = advance(story, r1.state, 'DD-04', '');
  assert.equal(r5.ok, false);
  assert.equal(r5.code, 'INVALID_INPUT');
});

test('部分并行：DD-02 后 DD-03..06 同时可用；任意完成顺序产生相同视图（完成顺序无关）', () => {
  const s = uptoDoubtMarked();
  const ids = listAvailableActions(story, s).map((a) => a.stepId);
  assert.deepEqual([...ids].sort(), ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  const viaA = views(story, completeParallel(structuredClone(s), ['DD-03', 'DD-04', 'DD-05', 'DD-06']));
  const viaB = views(story, completeParallel(structuredClone(s), ['DD-06', 'DD-05', 'DD-04', 'DD-03']));
  assert.deepEqual(viaB, viaA, '并行组完成顺序不得影响视图');
});

test('确认路径：确认后疑点挂账、证据不变、DD-08 可用且汇总无审批结论', () => {
  let s = completeParallel(uptoDoubtMarked(), ['DD-04', 'DD-03', 'DD-06', 'DD-05']);
  const d = decide(story, s, 'DD-07', 'h-confirm', 'confirm');
  assert.equal(d.ok, true);
  assert.equal(d.state.completed.find((r) => r.stepId === 'DD-07').outcome, 'close');
  assert.equal(evidenceState(d.state, 'M1-DOC-01').validVersion, 1, '确认不改动证据版本');
  assert.ok(!isOpinionInvalidated(d.state, 'OP-CAP-ENERGY'));
  const next = listAvailableActions(story, d.state).map((a) => a.stepId);
  assert.deepEqual(next, ['DD-08']);
  const fin = advanceAuto(story, d.state, 'c-fin');
  assert.equal(fin.ok, true);
  assert.ok(fin.completed.includes('DD-08'));
  assert.deepEqual(fin.stoppedAt, { stepId: 'SG-02', kind: 'human-decision' }, '签约前人工复核必须停');
  const msgs = storyMessages(story, fin.state);
  const summary = msgs.find((m) => m.stepId === 'DD-08');
  assert.match(summary.text, /无正式审批结论/);
});

test('纠正路径：证据升版 v1→v2、旧版本引用被拒、旧口径意见作废、更正消息入流', () => {
  let s = completeParallel(uptoDoubtMarked(), ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  const before = assertEvidenceCite(s, 'M1-DOC-01', 1);
  assert.equal(before.ok, true, '纠正前 v1 有效');
  const d = decide(story, s, 'DD-07', 'h-correct', 'correct');
  assert.equal(d.ok, true);
  const ev = evidenceState(d.state, 'M1-DOC-01');
  assert.equal(ev.validVersion, 2);
  assert.deepEqual(ev.versions, [
    { version: 1, state: 'superseded' },
    { version: 2, state: 'valid' },
  ]);
  const cite = assertEvidenceCite(d.state, 'M1-DOC-01', 1);
  assert.equal(cite.ok, false);
  assert.equal(cite.code, 'EVIDENCE_VERSION_SUPERSEDED');
  assert.ok(isOpinionInvalidated(d.state, 'OP-CAP-ENERGY'), '基于年产值口径的意见已作废');
  const msgs = storyMessages(story, d.state);
  const corr = msgs.find((m) => m.stepId === 'DD-07' && m.fromName.includes('复核人'));
  assert.ok(corr, '更正消息进入消息流');
  assert.match(corr.text, /月产值/);
  // 纠正同 requestId 重放幂等（对已包含该决定的当前状态重试），且证据不重复升版
  const d2 = decide(story, d.state, 'DD-07', 'h-correct', 'correct');
  assert.equal(d2.ok, true);
  assert.equal(d2.replayed, true);
  assert.deepEqual(evidenceState(d2.state, 'M1-DOC-01').versions, ev.versions);
});

test('退回路径：退回后 DD-08 不可达、视图红灯不全绿；补证后重新判断（仅确认/纠正）；闭环回归主线', () => {
  let s = completeParallel(uptoDoubtMarked(), ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  const d = decide(story, s, 'DD-07', 'h-ret', 'return');
  assert.equal(d.ok, true);
  assert.equal(d.state.completed.find((r) => r.stepId === 'DD-07').outcome, 'return');
  // 退回不进入汇总
  assert.ok(!listAvailableActions(story, d.state).some((a) => a.stepId === 'DD-08'));
  assert.ok(!listAvailableActions(story, d.state).some((a) => a.stepId === 'SG-01'));
  // 视图：信审红灯 + 注记，阶段不得全绿
  const v = views(story, d.state);
  assert.equal(v.domains.credit.judgment, 'red');
  assert.match(v.overallNote, /未通过/);
  assert.equal(v.stages.dueDiligence, 'current', '尽调不显示完成');
  assert.equal(v.stages.signing, 'pending');
  // 补证路径
  const rt1 = advance(story, d.state, 'DD-RT-1', 'h-rt1');
  assert.equal(rt1.ok, true);
  assert.equal(evidenceState(rt1.state, 'M1-DOC-09').validVersion, 1, '补交材料入证据簿');
  const rt2 = advanceAuto(story, rt1.state, 'rt-auto');
  assert.equal(rt2.ok, true);
  assert.deepEqual(rt2.completed, ['DD-RT-2']);
  assert.deepEqual(rt2.stoppedAt, { stepId: 'DD-07B', kind: 'human-decision' });
  // 再入节点：退回被明确拒绝（有限路径）
  const again = decide(story, rt2.state, 'DD-07B', 'h-ret2', 'return');
  assert.equal(again.ok, false);
  assert.equal(again.code, 'INVALID_DECISION');
  // 确认后闭环回主线：汇总推进后退回注记撤销（patch 窗口随 DD-08 完成关闭）
  const d2 = decide(story, rt2.state, 'DD-07B', 'h-d07b', 'confirm');
  assert.equal(d2.ok, true);
  assert.equal(listAvailableActions(story, d2.state)[0].stepId, 'DD-08');
  const fin = advanceAuto(story, d2.state, 'h-d07b-fin');
  assert.equal(fin.ok, true);
  assert.ok(fin.completed.includes('DD-08'));
  const v2 = views(story, fin.state);
  assert.ok(!v2.overallNote, '闭环后退回注记撤销（patch 窗口关闭）');
  assert.equal(v2.domains.credit.judgment, 'yellow', '汇总后退回红灯解除、保留待核实黄灯');
});

test('退回后纠正路径证据仍只升版一次（跨节点效果幂等）', () => {
  let s = completeParallel(uptoDoubtMarked(), ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  s = decide(story, s, 'DD-07', 'r1', 'return').state;
  s = advance(story, s, 'DD-RT-1', 'r2').state;
  s = advanceAuto(story, s, 'r3').state;
  const d = decide(story, s, 'DD-07B', 'r4', 'correct');
  assert.equal(d.ok, true);
  const ev = evidenceState(d.state, 'M1-DOC-01');
  assert.deepEqual(ev.versions, [
    { version: 1, state: 'superseded' },
    { version: 2, state: 'valid' },
  ], '只升版一次');
  assert.equal(assertEvidenceCite(d.state, 'M1-DOC-01', 1).code, 'EVIDENCE_VERSION_SUPERSEDED');
});

test('签约退回路径：退回→补充→仅确认；自动推进全程不越过 SG-02/SG-02B', () => {
  // 主线走到 SG-02（确认路径到尽调汇总）
  let s = completeParallel(uptoDoubtMarked(), ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  s = decide(story, s, 'DD-07', 's1', 'confirm').state;
  s = advanceAuto(story, s, 's2').state; // DD-08 + SG-01，停 SG-02
  const ret = decide(story, s, 'SG-02', 's3', 'return');
  assert.equal(ret.ok, true);
  const v = views(story, ret.state);
  assert.equal(v.domains.credit.judgment, 'red');
  assert.match(v.overallNote, /签约退回/);
  assert.equal(listAvailableActions(story, ret.state)[0].stepId, 'SG-RT');
  s = advance(story, ret.state, 'SG-RT', 's4').state;
  const fin = advanceAuto(story, s, 's5');
  assert.equal(fin.ok, true);
  assert.deepEqual(fin.completed, [], 'SG-02B 是决定节点，自动不停');
  assert.deepEqual(fin.stoppedAt, { stepId: 'SG-02B', kind: 'human-decision' });
  const bad = decide(story, fin.state, 'SG-02B', 's6', 'return');
  assert.equal(bad.ok, false, '签约退回仅一次');
  assert.equal(bad.code, 'INVALID_DECISION');
  const ok = decide(story, fin.state, 'SG-02B', 's6', 'confirm');
  assert.equal(ok.ok, true);
  const rest = advanceAuto(story, ok.state, 's7');
  assert.equal(rest.ok, true);
  assert.equal(rest.stoppedAt, null, '无剩余人工节点');
  assert.equal(views(story, rest.state).terminal, true, '到达结清终态');
});

test('分支无死路：从初态出发每个可达状态要么可达终态、要么至少有一个可执行动作（全空间 BFS）', () => {
  const canon = (s) => advanceAuto(story, s, `bfs-${s.completed.length}`);
  const key = (s) => s.completed.map((r) => `${r.stepId}${r.outcome ? ':' + r.outcome : ''}`).join('|');
  const seen = new Map();
  const queue = [createDemoState(story)];
  const terminalViews = [];
  const WIN = 'w-' + Math.abs(rawStory.length); // 确定性盐，避免 requestId 冲突
  let guard = 0;
  while (queue.length > 0) {
    if (++guard > 20000) assert.fail('状态空间探索超限');
    const cur = canon(queue.shift()).state;
    const k = key(cur);
    if (seen.has(k)) continue;
    seen.set(k, true);
    if (views(story, cur).terminal) {
      terminalViews.push(views(story, cur));
      continue;
    }
    const acts = listAvailableActions(story, cur);
    assert.ok(acts.length > 0, `死路状态：${k}`);
    let n = 0;
    for (const a of acts) {
      if (a.kind === 'human-decision') {
        for (const o of a.decisionOptions) {
          const r = decide(story, cur, a.stepId, `${WIN}:${k}:${n++}`, o.decision);
          assert.equal(r.ok, true, `分支 ${a.stepId}/${o.decision} 应可执行：${r.message ?? ''}`);
          queue.push(r.state);
        }
      } else {
        const r = advance(story, cur, a.stepId, `${WIN}:${k}:${n++}`);
        assert.equal(r.ok, true);
        queue.push(r.state);
      }
    }
  }
  assert.ok(seen.size >= 10, `状态空间过小（${seen.size}），探索不充分`);
  assert.ok(terminalViews.length >= 4, `终态路径过少（${terminalViews.length}）：确认/纠正 × 直达/退回后 应至少四条`);
  for (const v of terminalViews) {
    assert.deepEqual(v, terminalViews[0], '所有分支的结清终态视图必须一致（同一终态，不错误差异）');
  }
});

test('快照恢复：任意合法中间态 roundtrip 深比较相等；恢复态可继续推进', () => {
  let s = completeParallel(uptoDoubtMarked(), ['DD-03', 'DD-04', 'DD-05', 'DD-06']);
  s = decide(story, s, 'DD-07', 'snap-1', 'correct').state;
  s = advanceAuto(story, s, 'snap-2').state;
  const snap = snapshot(s);
  const json = JSON.stringify(snap);
  const back = restore(story, JSON.parse(json));
  assert.equal(back.ok, true, back.message ?? '');
  assert.deepEqual(back.state, s, '恢复态与原态深比较相等');
  const cont = advanceAuto(story, back.state, 'snap-3');
  assert.equal(cont.ok, true);
  assert.deepEqual(cont.stoppedAt, { stepId: 'SG-02', kind: 'human-decision' }, '恢复后可继续');
});

test('快照校验恢复：损坏/异story/非法决定/重复请求/顺序非法 均明确拒绝', () => {
  let s = uptoDoubtMarked();
  s = advance(story, s, 'DD-03', 'z1').state;
  const snap = snapshot(s);
  assert.equal(restore(story, { ...snap, schema: 'other@1' }).code, 'SNAPSHOT_CORRUPT');
  assert.equal(restore(story, { ...snap, storyId: 'OTHER' }).code, 'STORY_MISMATCH');
  assert.equal(restore(story, { ...snap, completed: 'nope' }).code, 'SNAPSHOT_CORRUPT');
  assert.equal(
    restore(story, { ...snap, completed: [{ stepId: 'GHOST', requestId: 'g1', kind: 'auto' }] }).code,
    'SNAPSHOT_CORRUPT'
  );
  assert.equal(
    restore(story, { ...snap, completed: [...snap.completed, { stepId: 'DD-03', requestId: 'g2', kind: 'auto' }] }).code,
    'SNAPSHOT_CORRUPT'
  );
  // 合法快照 = 从真实状态生成；在其上追加非法决定应被拒
  const legalSnap = snapshot(s);
  const r = restore(story, legalSnap);
  assert.equal(r.ok, true, `合法快照应恢复成功：${r.message ?? ''}`);
  assert.equal(
    restore(story, {
      ...legalSnap,
      completed: [
        ...legalSnap.completed,
        { stepId: 'DD-07', requestId: 'ok3', kind: 'human-decision', decision: ' teleport', outcome: 'close' },
      ],
    }).code,
    'SNAPSHOT_CORRUPT',
    '非法决定明确拒绝'
  );
  // 顺序非法：DD-02 在 DD-01 之前
  assert.equal(
    restore(story, {
      schema: 'jw-demo-snapshot@1',
      storyId: story.storyId,
      completed: [
        { stepId: 'DD-02', requestId: 'q1', kind: 'auto' },
        { stepId: 'DD-01', requestId: 'q2', kind: 'human-action' },
      ],
    }).code,
    'SNAPSHOT_CORRUPT'
  );
});

test('主线全绿走查：确认路径一键推进与人工节点交替，直至结清；正文与状态一致', () => {
  let s = createDemoState(story);
  const steps = [];
  const human = (stepId, requestId, decision) => {
    const r = decision ? decide(story, s, stepId, requestId, decision) : advance(story, s, stepId, requestId);
    assert.equal(r.ok, true, `${stepId}: ${r.message ?? ''}`);
    s = r.state;
    steps.push(stepId);
  };
  const auto = (base) => {
    const r = advanceAuto(story, s, base);
    assert.equal(r.ok, true);
    s = r.state;
    steps.push(...r.completed);
  };
  auto('w1');
  human('DD-01', 'w2');
  auto('w3'); // 一次推进完成 DD-02 + 并行组 auto 三项，停在 DD-03
  human('DD-03', 'w-dd03');
  human('DD-07', 'w4', 'confirm');
  auto('w5');
  human('SG-02', 'w6', 'confirm');
  auto('w7');
  assert.equal(views(story, s).terminal, true);
  assert.deepEqual(views(story, s).stages, {
    opportunity: 'done',
    preReview: 'done',
    dueDiligence: 'done',
    signing: 'done',
    postRental: 'done',
  });
  assert.equal(steps.filter((x) => x === 'PR-03').length, 1);
  // 消息流覆盖六方必要发言且模型消息带模拟标记
  const msgs = storyMessages(story, s);
  const names = new Set(msgs.map((m) => m.fromName));
  for (const n of ['业务', '政策岗', '信审岗', '商务岗', '资产岗', '信审复核人（人工）']) {
    assert.ok(names.has(n), `消息流缺少 ${n} 的必要发言`);
  }
  for (const m of msgs) {
    if (m.fromName.includes('模型')) assert.ok(m.marks.includes('模型（模拟）'));
  }
});
