// F 轮 · role-mock-adapter 纯逻辑测试（node --experimental-strip-types --test；显式文件路径）。
// 运行：home/preview 下 node --experimental-strip-types --test test/role-mock-adapter.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialCaseState, submitCaseTurn } from '../../site-mirror/app/v5-preview/role-mock-adapter.ts';
import { SEED_SCENARIOS, findSeedScenario } from '../../site-mirror/app/v5-preview/role-cases.ts';

const FIXED_NOW = () => new Date(2026, 8, 15, 10, 0, 0);
const c1 = findSeedScenario('seed-metal-direct');
const c3 = findSeedScenario('seed-molding-title-dispute');
const c4 = findSeedScenario('seed-packaging-caliber');

test('4 个种子案例形状完整：六角色 roleViews/问≤3/脚本/来源', () => {
  assert.equal(SEED_SCENARIOS.length, 4);
  for (const s of SEED_SCENARIOS) {
    assert.equal(s.schemaVersion, 'six-role-v1');
    for (const role of ['jianwei', 'business', 'policy', 'credit', 'commerce', 'asset']) {
      const v = s.roleViews[role];
      assert.ok(v.summary.length > 0, `${s.id} ${role} summary`);
      assert.ok(v.questions.length <= 3, `${s.id} ${role} questions<=3`);
      assert.ok(v.tasks.length > 0, `${s.id} ${role} tasks`);
      assert.ok(['做', '谨慎做', '调整条件后做', '不做', '不做（现状）'].includes(v.tendency));
    }
    assert.ok(s.turns.length >= 2, `${s.id} 至少两步补证`);
    assert.ok(s.sourceRefs.length > 0);
  }
});

test('initialCaseState：系统载入消息 + 事实副本（案例间不共享对象）', () => {
  const a = initialCaseState(c1);
  const b = initialCaseState(c1);
  assert.notEqual(a.facts, b.facts);
  assert.notEqual(a.facts[0], b.facts[0]);
  assert.equal(a.messages.length, 1);
  assert.equal(a.messages[0].origin, 'preset');
});

test('空输入：拒绝且不改状态', async () => {
  const state = initialCaseState(c1);
  const out = await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '   ', now: FIXED_NOW });
  assert.equal(out.accepted, false);
  assert.ok(out.clarification);
  assert.equal(out.state.messages.length, state.messages.length);
});

test('未知自由文本：待澄清，不假装理解、不改事实', async () => {
  const state = initialCaseState(c1);
  const out = await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '今天天气不错', now: FIXED_NOW });
  assert.equal(out.accepted, false);
  assert.ok(out.clarification.includes('未能识别'));
  const fact = out.state.facts.find((f) => f.id === 'equip');
  assert.equal(fact.evidenceVersion, 1);
  const last = out.state.messages.at(-1);
  assert.ok(last.marks.includes('待澄清'));
});

test('案例1 缺证→补证：发票命中 → 证据版本+1、域回复+见微汇总、任务更新', async () => {
  const state = initialCaseState(c1);
  const out = await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '设备增值税发票已拿到', now: FIXED_NOW });
  assert.equal(out.accepted, true);
  const fact = out.state.facts.find((f) => f.id === 'equip');
  assert.equal(fact.evidenceVersion, 2);
  assert.equal(fact.status, 'confirmed');
  assert.ok(out.state.completedTurns.includes('t-invoice'));
  const names = out.appended.map((m) => m.fromName);
  assert.ok(names.includes('资产'), '域角色回复（资产）');
  assert.ok(names.includes('见微'), '见微汇总');
  const assetTask = c1.roleViews.asset.tasks.find((t) => t.evidenceKey === 'invoice');
  assert.equal(out.state.taskStatus[assetTask.id], 'updated');
  // 证据版本消息留档旧值
  const versionMsg = out.state.messages.find((m) => m.marks.includes('证据版本'));
  assert.ok(versionMsg.text.includes('v1'));
});

test('重复提交同证据：已登记提示，不重复记账', async () => {
  let state = initialCaseState(c1);
  state = (await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '发票来了', now: FIXED_NOW })).state;
  const before = state.facts.find((f) => f.id === 'equip').evidenceVersion;
  const out = await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '发票扫描件再次发送', now: FIXED_NOW });
  assert.equal(out.accepted, false);
  assert.equal(out.state.facts.find((f) => f.id === 'equip').evidenceVersion, before);
  assert.ok(out.state.messages.at(-1).text.includes('已登记'));
});

test('案例1 两步全走完：发票→合同，见微最终汇总', async () => {
  let state = initialCaseState(c1);
  state = (await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '发票已开', now: FIXED_NOW })).state;
  state = (await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '购销合同签好了', now: FIXED_NOW })).state;
  assert.deepEqual(state.completedTurns.sort(), ['t-contract', 't-invoice']);
  const lastJw = state.messages.filter((m) => m.fromName === '见微').at(-1);
  assert.ok(lastJw.text.includes('闭环'));
  assert.ok(lastJw.marks.includes('模型建议（模拟）'));
});

test('发言归属：不同视角的输入记录不同角色，且不混成正式身份', async () => {
  const state = initialCaseState(c1);
  const asBusiness = await submitCaseTurn({ scenario: c1, state, roleId: 'business', text: '今天天气不错', now: FIXED_NOW });
  assert.equal(asBusiness.appended[0].fromName, '业务 · 我（演示视角）');
  assert.equal(asBusiness.appended[0].origin, 'human');
  const asCredit = await submitCaseTurn({ scenario: c1, state, roleId: 'credit', text: '今天天气不错', now: FIXED_NOW });
  assert.equal(asCredit.appended[0].fromName, '信审 · 我（演示视角）');
  // 模拟回复不得是 human 来源
  for (const m of asBusiness.appended.slice(1)) {
    assert.notEqual(m.origin, 'human');
  }
});

test('案例3 权属疑点：确权函解除阻塞（asset 红线 → 可推进）', async () => {
  const state = initialCaseState(c3);
  const out = await submitCaseTurn({ scenario: c3, state, roleId: 'business', text: '经销商确权函和结清证明都拿到了', now: FIXED_NOW });
  assert.equal(out.accepted, true);
  const title = out.state.facts.find((f) => f.id === 'title');
  assert.equal(title.evidenceVersion, 2);
  assert.equal(title.status, 'confirmed');
  assert.ok(out.appended.map((m) => m.text).join('|').includes('权属疑点解除'));
});

test('案例4 口径差异：书面解释 → 信审复算 + 见微跨域矛盾解除', async () => {
  const state = initialCaseState(c4);
  const out = await submitCaseTurn({ scenario: c4, state, roleId: 'business', text: '贸易剥离的合同和结算说明补充给你', now: FIXED_NOW });
  assert.equal(out.accepted, true);
  assert.ok(out.appended.map((m) => m.text).join('|').includes('矛盾可解释'));
});

test('角色切换零副作用：同状态不同视角提交只影响发言归属，不触发证据/任务变化', async () => {
  const state = initialCaseState(c1);
  const a = await submitCaseTurn({ scenario: c1, state, roleId: 'policy', text: '今天天气不错', now: FIXED_NOW });
  const b = await submitCaseTurn({ scenario: c1, state, roleId: 'asset', text: '今天天气不错', now: FIXED_NOW });
  // 都未命中脚本：事实与完成集完全一致（仅消息归属不同）
  assert.deepEqual(a.state.facts, b.state.facts);
  assert.deepEqual(a.state.completedTurns, b.state.completedTurns);
  assert.deepEqual(a.state.taskStatus, b.state.taskStatus);
  assert.notEqual(a.appended[0].fromName, b.appended[0].fromName);
});
