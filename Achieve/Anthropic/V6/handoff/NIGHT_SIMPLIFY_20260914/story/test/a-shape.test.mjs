// A 形状候选 v3 行为测试：以**产品当前数据 + v3 补丁**（candidate/a-shape/demo-story-a-v3.json）
// 为对象，用与产品 demo-story-service.ts 一致的语义驱动（advance=链式自动推进，停于
// holdForHuman/decision 步；decide=选项确定性后继；步骤门/决定门），验证运行行为。
// 运行：node --test test/a-shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(path.join(here, '..', 'candidate', 'a-shape', 'demo-story-a-v3.json'), 'utf8'));
const steps = doc.steps;
const byId = new Map(steps.map((s) => [s.stepId, s]));
const START = steps[0].stepId;
const TERMINAL = steps[steps.length - 1].stepId;

// ---- 与产品 demo-story-types.ts 逐字段一致的签名算法 ----
const sig = (s) =>
  JSON.stringify({
    scenario: s.scenario ?? 'approval',
    todoId: s.todo?.id ?? null,
    todoStatus: s.todo?.status ?? null,
    progressLabel: s.progressLabel,
    domainSig: s.domains
      .map((d) => `${d.domainId}:${d.segments.join(',')}|${d.judgmentStatus}|${d.judgmentText}`)
      .join(';'),
  });

// ---- 链式推进语义（同产品 chainFrom：常规步连穿，holdForHuman/decision 应用后停） ----
function makeWalker() {
  const state = { current: START, visited: [START], messages: [], error: null };
  const applyTo = (applied) => {
    for (const target of applied) {
      state.current = target.stepId;
      state.visited.push(target.stepId);
      state.messages.push(...(target.messages ?? []));
    }
  };
  const fail = (code, message) => {
    state.error = { code, message };
    return false;
  };
  const chainFrom = (step) => {
    // 与产品一致：从后继开始连穿，遇 holdForHuman/decision 应用后停；终点收束
    const applied = [];
    let cur = step;
    let guard = 0;
    for (;;) {
      if (guard++ > steps.length) return fail('STORY_STEP_CHANGED', '后继链异常（环/断链）');
      const nxt = cur.nextStepId !== undefined ? byId.get(cur.nextStepId) : steps[steps.indexOf(cur) + 1];
      if (!nxt) break;
      applied.push(nxt);
      if (nxt.decision !== undefined || nxt.holdForHuman === true) break;
      cur = nxt;
    }
    return applied;
  };
  return {
    state,
    advance(fromStepId) {
      if (state.current !== fromStepId) return fail('STORY_STEP_CHANGED', `步骤已变化：当前 ${state.current} ≠ 请求 ${fromStepId}`);
      const cur = byId.get(fromStepId);
      if (!cur) return fail('STORY_STEP_CHANGED', '未知当前步');
      if (cur.decision) return fail('STORY_DECISION_REQUIRED', '人工决定点必须先决定');
      const applied = chainFrom(cur);
      if (applied.length === 0) return fail('STORY_STEP_CHANGED', '已到终点');
      applyTo(applied);
      return true;
    },
    decide(fromStepId, kind) {
      if (state.current !== fromStepId) return fail('STORY_STEP_CHANGED', `步骤已变化：当前 ${state.current} ≠ 请求 ${fromStepId}`);
      const cur = byId.get(fromStepId);
      if (!cur?.decision) return fail('STORY_STEP_CHANGED', '当前步不是人工决定点');
      const opt = cur.decision.options.find((o) => o.kind === kind);
      if (!opt) return fail('INVALID_INPUT', `decision 非法：${kind}`);
      const target = byId.get(opt.nextStepId);
      if (!target) return fail('STORY_STEP_CHANGED', '决定后继不存在');
      applyTo([target]); // 决定路径只应用分支目标步本身（不自动链，同产品）
      return true;
    },
  };
}

const isDecision = (sid) => byId.get(sid)?.decision !== undefined;

test('签名唯一；s00==approval 种子；终点==settled 种子（重启=既有 seed 的前提，与产品一致）', () => {
  const sigs = steps.map(sig);
  assert.equal(new Set(sigs).size, steps.length, '内容签名必须两两唯一');
  const approvalSig = sig({
    scenario: 'approval',
    todo: { id: 'todo-device-list', status: '待补充' },
    progressLabel: '审批推进中',
    domains: [
      ['policy', 'done,done,done,done', 'green', '已确认'],
      ['credit', 'done,done,pending,pending', 'yellow', '待补充'],
      ['commerce', 'current,pending,pending,pending', 'gray', '准备中'],
      ['asset', 'pending,pending,pending,pending', 'gray', '待启动'],
    ].map(([domainId, segments, judgmentStatus, judgmentText]) => ({ domainId, segments: segments.split(','), judgmentStatus, judgmentText })),
  });
  const settledSig = sig({
    scenario: 'settled',
    todo: null,
    progressLabel: '已结清（演示）',
    domains: [['policy', '已确认'], ['credit', '已通过'], ['commerce', '已结清'], ['asset', '已结清']].map(([domainId, judgmentText]) => ({
      domainId,
      segments: ['done', 'done', 'done', 'done'],
      judgmentStatus: 'green',
      judgmentText,
    })),
  });
  assert.equal(sig(steps[0]), approvalSig);
  assert.equal(sig(steps[steps.length - 1]), settledSig);
});

test('链式推进走查：常规步一次推进，人工动作/决定步停下；确认路径走完到结清', () => {
  const w = makeWalker();
  const landings = [];
  let guard = 0;
  while (!isDecision(w.state.current)) {
    assert.ok(guard++ < steps.length, '推进超限');
    landings.push(w.state.current);
    assert.equal(w.advance(w.state.current), true, JSON.stringify(w.state.error));
  }
  // 人工动作步必须停链：发起访谈(s03)/现场补充(s05)在落点序列中
  assert.ok(landings.includes('s03-dd-01'), `发起访谈必须停链：${landings.join('→')}`);
  assert.ok(landings.includes('s05-dd-03'), '现场补充必须停链');
  const d1 = w.state.current;
  assert.equal(d1, 's09-dd-07');
  const blocked = w.advance(d1);
  assert.equal(blocked, false);
  assert.equal(w.state.error.code, 'STORY_DECISION_REQUIRED', '决定点拦截 advance');
  const stale = w.advance('s00-opp-01');
  assert.equal(stale, false);
  assert.equal(w.state.error.code, 'STORY_STEP_CHANGED', '旧 fromStepId 防跳步');
  w.decide(d1, 'confirm');
  guard = 0;
  while (!isDecision(w.state.current)) {
    assert.ok(guard++ < steps.length);
    assert.equal(w.advance(w.state.current), true);
  }
  assert.equal(w.state.current, 's15-sg-02', '第二个决定点=签约前复核');
  // 签约层：退回→补充说明步(hold)→再判点(仅确认)
  w.decide('s15-sg-02', 'return');
  assert.equal(w.state.current, 's16-sg-rt');
  assert.equal(byId.get('s16-sg-rt').holdForHuman, true, '签约补充说明步停链');
  w.advance('s16-sg-rt');
  assert.equal(w.state.current, 's17-sg-02b');
  w.decide('s17-sg-02b', 'confirm');
  guard = 0;
  while (w.state.current !== TERMINAL) {
    assert.ok(guard++ < steps.length);
    assert.equal(w.advance(w.state.current), true);
  }
  const end = w.advance(TERMINAL);
  assert.equal(end, false, '终点 advance 拒绝');
  assert.equal(w.state.error.code, 'STORY_STEP_CHANGED');
});

test('纠正判断更新可见：correct 落点=效果应用步，更正记录消息+证据引用 v2 入留档流（非仅 note）', () => {
  const w = makeWalker();
  let guard = 0;
  while (!isDecision(w.state.current)) {
    assert.ok(guard++ < steps.length);
    assert.equal(w.advance(w.state.current), true);
  }
  w.decide(w.state.current, 'correct');
  assert.equal(w.state.current, 's13c-dd-08-correct', 'correct 后继=效果应用步');
  const apply = byId.get(w.state.current);
  const allText = (apply.messages ?? []).map((m) => m.text).join('\n');
  assert.match(allText, /人工更正记录/);
  assert.match(allText, /月产值约450万元/);
  assert.match(allText, /升版为 v2/);
  assert.match(allText, /作废/);
  assert.ok((apply.evidenceRefs ?? []).some((r) => r.includes('M1-DOC-01 v2')), '证据引用出现 v2（升版可见）');
  // 应用步推进后进入签约准备（与确认路径在 s14 汇合）
  assert.equal(apply.nextStepId, 's14-sg-01');
  assert.equal(w.advance(apply.stepId), true);
  assert.equal(w.state.current, 's15-sg-02', '链式推进经 s14 汇合后停于签约决定点');
  assert.ok(w.state.visited.includes('s14-sg-01'), '确认与纠正路径在 s14 汇合');
  // 两路径可区分：确认落点 s13 不含更正记录
  const w2 = makeWalker();
  guard = 0;
  while (!isDecision(w2.state.current)) {
    assert.ok(guard++ < steps.length);
    assert.equal(w2.advance(w2.state.current), true);
  }
  w2.decide(w2.state.current, 'confirm');
  assert.equal(w2.state.current, 's13-dd-08');
  const confirmTexts = (byId.get('s13-dd-08').messages ?? []).map((m) => m.text).join('\n');
  assert.ok(!confirmTexts.includes('人工更正记录'), '确认路径不得出现更正记录');
  // s12 再判点的纠正同样走效果应用步
  assert.equal(byId.get('s12-dd-07b').decision.options.find((o) => o.kind === 'correct').nextStepId, 's13c-dd-08-correct');
});

test('退回仅一次（有限路径）：再判点无 return 选项；每圈必经补交材料(hold)+复核；确认/纠正退出', () => {
  const w = makeWalker();
  let guard = 0;
  while (!isDecision(w.state.current)) {
    assert.ok(guard++ < steps.length);
    assert.equal(w.advance(w.state.current), true);
  }
  w.decide(w.state.current, 'return');
  assert.equal(w.state.current, 's10-dd-rt-1', '退回→补交材料步（人工补充条件）');
  assert.equal(byId.get('s10-dd-rt-1').holdForHuman, true, '补交材料步停链');
  w.advance('s10-dd-rt-1');
  assert.equal(w.state.current, 's12-dd-07b', '链式推进经系统复核落再判点');
  // 再判点：无 return 选项（与 prompt「不再提供退回选项」一致；有判别力的负样本断言）
  const opts = byId.get('s12-dd-07b').decision.options.map((o) => o.kind);
  assert.deepEqual(opts, ['confirm', 'correct'], '再判点恰为确认/纠正');
  assert.ok(!/不再提供退回|仅提供确认/.test(byId.get('s12-dd-07b').decision.prompt) || !opts.includes('return'), 'prompt 与选项不得矛盾');
  const again = w.decide('s12-dd-07b', 'return');
  assert.equal(again, false, '再退回必须被拒（有限路径）');
  assert.equal(w.state.error.code, 'INVALID_INPUT');
  // 纠正退出 → 效果应用步 → 汇总
  w.decide('s12-dd-07b', 'correct');
  assert.equal(w.state.current, 's13c-dd-08-correct');
  w.advance('s13c-dd-08-correct');
  assert.equal(w.state.current, 's15-sg-02', '纠正退出循环后链式推进停于签约决定点');
  assert.ok(w.state.visited.includes('s14-sg-01'), '经 s14 汇合');
});

test('判断灯单调不回退：确认主线绿灯集不缩小；s06→s07→s08→s09 并行段无域状态倒退；红灯仅限补充分支步', () => {
  const w = makeWalker();
  const greenCount = (sid) => byId.get(sid).domains.filter((d) => d.judgmentStatus === 'green').length;
  let prev = greenCount(w.state.current);
  let guard = 0;
  while (w.state.current !== TERMINAL) {
    assert.ok(guard++ < steps.length * 2);
    if (isDecision(w.state.current)) w.decide(w.state.current, 'confirm');
    else assert.equal(w.advance(w.state.current), true);
    const c = greenCount(w.state.current);
    assert.ok(c >= prev, `主线绿灯集缩小：${w.state.visited.at(-2)}(${prev}) → ${w.state.current}(${c})`);
    prev = c;
  }
  // 灯色逐域不回退（green>yellow>red/gray 的严格序只允许在补充分支内出现 red）
  const rank = { green: 3, yellow: 2, red: 1, gray: 1 };
  for (const domainId of ['policy', 'credit', 'commerce', 'asset']) {
    let best = 0;
    for (const s of steps) {
      const row = s.domains.find((d) => d.domainId === domainId);
      const r = rank[row.judgmentStatus];
      if (r > best) best = r;
      if (r < best && !['s10-dd-rt-1', 's11-dd-rt-2', 's12-dd-07b', 's16-sg-rt', 's17-sg-02b'].includes(s.stepId)) {
        assert.fail(`${s.stepId} ${domainId} 判断灯回退（${row.judgmentStatus}，此前已达 ${best} 级）`);
      }
    }
  }
});

test('四域全绿仅在终态；各步恰 4 域；诚实标注与无越权结论', () => {
  for (const s of steps.slice(0, -1)) {
    assert.ok(!s.domains.every((d) => d.judgmentStatus === 'green'), `${s.stepId} 终点前全绿`);
    assert.equal(s.domains.length, 4);
  }
  assert.ok(steps[steps.length - 1].domains.every((d) => d.judgmentStatus === 'green'));
  for (const s of steps) {
    for (const o of s.decision?.options ?? []) {
      assert.ok(!['确认', '纠正', '退回'].includes(o.label), `${s.stepId} 裸标签`);
    }
    for (const m of s.messages ?? []) {
      if (m.fromName.includes('模型')) {
        assert.ok(m.fromName.includes('模拟') && /模拟/.test(m.text) && m.text.includes('authority=none'), `${s.stepId} 模型消息须自证模拟`);
      }
      const positive = m.text
        .replace(/(?:不|非|无)(?:应批准|应否决|建议(?:额度|价格)?|给出(?:批准|否决|额度|价格)?|填默认值)/g, '〇')
        .replace(/不(?:构成|作|得出|给出)[^。；]*/g, '〇');
      assert.ok(!/应批准|应否决|建议额度|建议价格|建议批准|建议否决/.test(positive), `${s.stepId} 越权结论表述`);
    }
  }
});
