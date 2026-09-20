// V0.3-Z4 场景1 独立回归（ZCODE 并行QA·只读产品源码，不改断言放宽）：
// 1) 未开始/缺前置不是 running——cellStatus 对 lock 的裁决优先于 running 标志与前序阻断；
// 2) 计时器与开锁动画不能自行推进业务——StatusObject 视觉计时器走完后 data-state 仍是调用方给的真实状态；
//    旧解锁计时器不能覆盖明确失败；静止展示不重播动画；
// 3) 只有实际 running 才渲染扳手旋转判据（.tk-status-object.wrench，glass.css 唯一旋转动画目标）；
// 4) 明确失败（gate 红项）才红叉；未开始/缺前置/结果未知（黄/灰项）不得红叉；
// 5) 真实完成（completed）才绿勾；档位100或红项未解不得绿勾，失败不被完成掩盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, act } from '../behavior/harness.mjs';

const React = (await import('react')).default;
const { cellStatus, blockingPredecessor } = await import('../../../site-mirror/app/takeoff/cell-status.ts');
const { TakeoffCell } = await import('../../../site-mirror/app/takeoff/takeoff-cell.tsx');
const { StatusObject } = await import('../../../site-mirror/app/takeoff/status-object.tsx');

function cell(over = {}) {
  return {
    domain: 'credit', row: 'human', displayBucket: null,
    running: false, completed: false, needsReview: false, frozen: false,
    allowedActions: [{ key: 'verify', label: '打开核验' }],
    items: [], basis: '测试依据', responsible: 'credit',
    ...over,
  };
}
const item = (key, tone, label = key) => ({ key, tone, label });

test('未开始：无事项无产出不是running（lock灰，不是扳手/绿勾/红叉）', () => {
  const s = cellStatus(cell());
  assert.equal(s.icon, 'lock');
  assert.equal(s.color, 'gray');
  assert.match(s.label, /尚未开始/);
  assert.notEqual(s.icon, 'wrench');
  assert.notEqual(s.icon, 'check');
  assert.notEqual(s.icon, 'cross');
});

test('缺前置：前序行被阻断时即使本格running=true也是lock（先完成前序事项）', () => {
  const blockedInput = cell({ domain: 'credit', row: 'input', frozen: false, items: [item('conf', 'red', '材料冲突')] });
  const human = cell({ domain: 'credit', row: 'human', running: true, items: [] });
  assert.ok(blockingPredecessor(human, [blockedInput, human]), '阻断前序可识别');
  const s = cellStatus(human, [blockedInput, human]);
  assert.equal(s.icon, 'lock');
  assert.equal(s.color, 'gray');
  assert.match(s.label, /尚未开始，先完成前序事项/);
  assert.notEqual(s.icon, 'wrench', 'running标志不能越过缺前置');
});

test('本格卡点（冻结/红项/黄项stale）压过running标志：不是扳手', () => {
  for (const over of [
    { frozen: true },
    { items: [item('conf', 'red', '事实冲突')] },
    { items: [item('stale', 'yellow', '依据已变化')] },
    { needsReview: true, items: [item('fup', 'yellow', '待补件')] },
  ]) {
    const s = cellStatus(cell({ running: true, ...over }));
    assert.equal(s.icon, 'lock', `卡点应得lock：${JSON.stringify(over)}`);
    assert.notEqual(s.icon, 'wrench');
  }
});

test('实际running（无前置阻断、无卡点）才是扳手+蓝', () => {
  const s = cellStatus(cell({ running: true }));
  assert.equal(s.icon, 'wrench');
  assert.equal(s.color, 'blue');
  assert.match(s.label, /正在处理/);
});

test('明确失败才红叉：gate红项=cross；黄/灰未知项不是cross', () => {
  const failed = cellStatus(cell({ items: [item('gate', 'red', '准入规则未通过')] }));
  assert.equal(failed.icon, 'cross');
  assert.equal(failed.color, 'red');
  assert.match(failed.label, /准入检查未通过/);
  for (const over of [
    { items: [item('stale', 'yellow', '材料已变化')] },
    { items: [item('miss', 'gray', '本专业结论尚未登记')] },
    { items: [item('dr0', 'gray', '该域暂无分析产出登记')] },
  ]) {
    const s = cellStatus(cell(over));
    assert.notEqual(s.icon, 'cross', `结果未知/缺前置不得红叉：${JSON.stringify(over)}`);
  }
});

test('真实完成才绿勾：completed=check；档位100不绿；红项未解不绿；失败不被完成掩盖', () => {
  const done = cellStatus(cell({ completed: true }));
  assert.equal(done.icon, 'check');
  assert.equal(done.color, 'green');
  assert.equal(cellStatus(cell({ displayBucket: 100, completed: false })).icon, 'lock', '分母档位100不能冒充绿勾');
  assert.equal(cellStatus(cell({ completed: true, items: [item('conf', 'red', '事实冲突')] })).icon, 'lock', '有未解红项不给绿勾');
  const masked = cellStatus(cell({ completed: true, items: [item('gate', 'red', '准入规则未通过')] }));
  assert.equal(masked.icon, 'cross', 'gate失败不被completed掩盖');
  // 候选建议红项（cand）不算阻断：负面候选可如实显示，不吞掉完成态
  const candDone = cellStatus(cell({ completed: true, items: [item('cand', 'red', '建议：不做')] }));
  assert.equal(candDone.icon, 'check');
});

// ---- 组件层：二十格按钮的图标/aria 与状态一致；旋转判据只在 running ----

test('组件层：只有实际running格渲染扳手图标类（旋转动画唯一DOM判据）；aria如实可读', () => {
  const cases = [
    { c: cell(), state: 'lock', label: /尚未开始/ },
    { c: cell({ running: true }), state: 'wrench', label: /正在处理/ },
    { c: cell({ completed: true }), state: 'check', label: /已完成/ },
    { c: cell({ items: [item('gate', 'red')] }), state: 'cross', label: /准入检查未通过/ },
    { c: cell({ running: true, frozen: true }), state: 'lock', label: /待复核后继续/ },
  ];
  for (const { c, state, label } of cases) {
    const view = render(React.createElement(TakeoffCell, {
      cell: c, cells: [c], selected: false, highlighted: false, exact: false,
      onSelect: () => {}, onHover: () => {},
    }));
    const btn = view.getByRole('button');
    assert.match(btn.getAttribute('aria-label'), label, `aria应含状态文案：${state}`);
    const scene = btn.querySelector('.tk-status-scene');
    assert.equal(scene.dataset.state, state, `data-state=${state}`);
    const icon = btn.querySelector('.tk-status-object');
    assert.ok(icon.classList.contains(state), `图标类含${state}`);
    assert.equal(!!btn.querySelector('.tk-status-object.wrench'), state === 'wrench', '扳手旋转判据只在实际running出现');
    view.unmount();
  }
});

test('计时器不能自行推进业务：lock静止tick后仍lock；running扳手tick后不变成绿勾；完成格挂载不重播finish', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = (c) => {
    const view = render(React.createElement(TakeoffCell, {
      cell: c, cells: [c], selected: false, highlighted: false, exact: false,
      onSelect: () => {}, onHover: () => {},
    }));
    return view;
  };
  const lockView = h(cell());
  const runView = h(cell({ running: true }));
  const doneView = h(cell({ completed: true }));
  act(() => t.mock.timers.tick(5000));
  const btnOf = (v) => v.container.querySelector('button');
  const aria = (v) => btnOf(v).getAttribute('aria-label');
  assert.match(aria(lockView), /尚未开始/, '计时器不能把未开始推成开始');
  assert.equal(btnOf(lockView).querySelector('.tk-status-scene').dataset.state, 'lock');
  assert.match(aria(runView), /正在处理/, '计时器不能把处理中推成完成');
  assert.equal(btnOf(runView).querySelector('.tk-status-scene').dataset.state, 'wrench');
  assert.match(aria(doneView), /已完成/);
  assert.equal(btnOf(doneView).querySelector('.tk-status-scene').dataset.transition, undefined, '完成态挂载不重播动画');
  lockView.unmount(); runView.unmount(); doneView.unmount();
});

test('StatusObject：开锁动画走完仍停在wrench；旧解锁计时器不能覆盖失败cross；静止挂载无过渡', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = render(React.createElement(StatusObject, { kind: 'lock' }));
  const scene = () => view.container.querySelector('.tk-status-scene');
  assert.equal(scene().dataset.transition, undefined, '首帧无过渡');

  // 未开始→处理中：unlock过渡（含钥匙），计时器走完仍是wrench（视觉不制造完成）
  view.rerender(React.createElement(StatusObject, { kind: 'wrench' }));
  assert.equal(scene().dataset.transition, 'unlock');
  assert.ok(view.container.querySelector('.tk-unlock-key'), '开锁动画含钥匙元素');
  act(() => t.mock.timers.tick(3000));
  assert.equal(scene().dataset.state, 'wrench', '计时器不能把wrench推成check');
  assert.equal(scene().dataset.transition, undefined);
  assert.equal(view.container.querySelector('.tk-unlock-key'), null, '过渡结束钥匙移除');

  // 处理中→明确失败：fail过渡；此前的解锁计时器不能把cross再推走
  view.rerender(React.createElement(StatusObject, { kind: 'cross' }));
  assert.equal(scene().dataset.transition, 'fail');
  act(() => t.mock.timers.tick(3000));
  assert.equal(scene().dataset.state, 'cross', '旧计时器不能覆盖失败状态');
  assert.equal(scene().dataset.transition, undefined);

  // 失败→真实完成：finish过渡走完停在check；卸载重挂不重播
  view.rerender(React.createElement(StatusObject, { kind: 'check' }));
  assert.equal(scene().dataset.transition, 'finish');
  act(() => t.mock.timers.tick(2000));
  assert.equal(scene().dataset.state, 'check');
  view.unmount();
  const fresh = render(React.createElement(StatusObject, { kind: 'check' }));
  assert.equal(fresh.container.querySelector('.tk-status-scene').dataset.transition, undefined, '重挂不重播完成动画');
  fresh.unmount();
  cleanup();
});
