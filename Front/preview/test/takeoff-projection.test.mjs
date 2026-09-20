// TAKEOFF-FA-1.0.0 · 02路 投影单测（接替退休看板测试的覆盖位置，不是把失败预期改绿）：
// 纪律来源 01 §6/§7、03 §4：分母未知=null 不伪造 0；100% 绿只在域收口条件满足；
// 冻结≠拒绝、未知≠零；金额/期限/价格同版；候选 authority=none。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAKEOFF_DOMAINS,
  TAKEOFF_ROWS,
  deriveTakeoffCells,
  deriveTakeoffTop,
  deriveTakeoffTodos,
  cellAriaLabel,
  fmtMinor,
  tendencyLabel,
} from '../../site-mirror/lib/workbench/takeoff-projection.ts';

function src(over = {}) {
  return {
    snapshot: null,
    packageDetail: null,
    channelTasks: [],
    currentMaterials: null,
    factConflicts: 0,
    ...over,
  };
}

test('结构固定：五列四行 20 格；空快照全部为 null 档位白圆（未知≠0、不硬补进度）', () => {
  const cells = deriveTakeoffCells(src());
  assert.equal(TAKEOFF_DOMAINS.length, 5);
  assert.equal(TAKEOFF_ROWS.length, 4);
  assert.equal(cells.length, 20);
  assert.ok(cells.every((c) => c.displayBucket === null), '空数据=进度未知，不得显示 0% 或 100%');
  assert.ok(cells.every((c) => c.completed === false && c.frozen === false));
  assert.ok(cells.every((c) => c.basis.length > 0), '每格必须带状态依据');
});

test('域收口：currency=current → 完成 100% 绿（绿=工作完成≠批准）；changed → 冻结+复核不绿', () => {
  const cells = deriveTakeoffCells(src({
    snapshot: {
      decisionStatus: { basis: { packageId: 'pkg_1', revision: 3, currency: [
        { domain: 'credit', currency: 'current' },
        { domain: 'asset', currency: 'changed', reasons: ['new_evidence'] },
      ] } },
    },
  }));
  const creditDone = cells.find((c) => c.domain === 'credit' && c.row === 'closure');
  assert.equal(creditDone.displayBucket, 100);
  assert.equal(creditDone.completed, true);
  assert.match(creditDone.basis, /pkg_1/);
  assert.match(cellAriaLabel(creditDone), /已完成（绿=工作完成，≠批准）/);
  const assetClosure = cells.find((c) => c.domain === 'asset' && c.row === 'closure');
  assert.equal(assetClosure.displayBucket, null, 'changed 回退为未闭合，不得保留旧绿');
  assert.equal(assetClosure.frozen, true);
  assert.equal(assetClosure.needsReview, true);
  assert.equal(assetClosure.completed, false);
  assert.match(assetClosure.items.map((i) => `${i.label}${i.detail ? ` — ${i.detail}` : ''}`).join('；'), /解冻所需动作/);
  // 受影响域整列不可全绿：asset 智能行提示需更新，但不误标完成
  assert.equal(cells.find((c) => c.domain === 'asset' && c.row === 'analysis').completed, false);
});

test('部分并行（T03）：单格事实局部呈现，不因整行/整列锁死；资产不等待商务', () => {
  const cells = deriveTakeoffCells(src({
    snapshot: {
      decisionStatus: { basis: { packageId: 'pkg', currency: [
        { domain: 'policy', currency: 'current' },
        { domain: 'asset', currency: 'current' },
        { domain: 'commerce', currency: 'missing' },
      ] } },
    },
  }));
  assert.equal(cells.find((c) => c.domain === 'policy' && c.row === 'closure').completed, true);
  assert.equal(cells.find((c) => c.domain === 'asset' && c.row === 'closure').completed, true, '资产可与信审并行收口（撤销商务先行）');
  assert.equal(cells.find((c) => c.domain === 'commerce' && c.row === 'closure').completed, false);
  assert.match(cells.find((c) => c.domain === 'commerce' && c.row === 'closure').items.map((i) => i.label).join(), /结论尚未登记/);
});

test('输入行：处理链运行=浅黄运行环；待补件/阻断如实入事项；材料读取失败=未知不是 0', () => {
  const cells = deriveTakeoffCells(src({
    channelTasks: [{ status: 'running' }, { status: 'needs_followup' }, { status: 'blocked_link' }],
    currentMaterials: null,
  }));
  const input = cells.filter((c) => c.row === 'input');
  assert.ok(input.every((c) => c.running === true), '处理链在途=输入行运行环（按服务端，不按计时）');
  const policyInput = input.find((c) => c.domain === 'policy');
  const labels = policyInput.items.map((i) => i.label).join('；');
  assert.match(labels, /材料暂时无法读取/, '材料数未知如实标注');
  assert.match(labels, /待补件\/转人工 1 项/);
  assert.match(labels, /被阻断等待恢复 1 项/);
  assert.equal(policyInput.needsReview, false, 'blocked≠卡点!（等待恢复态不染警示）');
});

test('事实冲突：输入行红项+卡点!（同键多断言不按最后上传覆盖）', () => {
  const cells = deriveTakeoffCells(src({ factConflicts: 2, currentMaterials: 4 }));
  const cell = cells.find((c) => c.domain === 'credit' && c.row === 'input');
  assert.equal(cell.needsReview, true);
  const conflict = cell.items.find((i) => i.tone === 'red');
  assert.match(conflict.label, /有 2 处材料内容需要核对/);
  assert.match(conflict.detail, /最后上传者覆盖/);
});

test('人工行：followups 按域落格 + 卡点；采用记录=人工完成信号（authority=none 恒定）', () => {
  const cells = deriveTakeoffCells(src({
    snapshot: {
      session: { openQuestions: 2, followups: [{ ownerRole: 'credit', reason: '流水缺 7 月', nextAction: '补证后复核' }] },
    },
    packageDetail: { domainResults: [{ domain: 'policy', opinionVersion: 2, adoption: { adopted: true } }] },
  }));
  const creditHuman = cells.find((c) => c.domain === 'credit' && c.row === 'human');
  assert.equal(creditHuman.needsReview, true);
  assert.match(creditHuman.items.map((i) => i.label).join('；'), /待办 1 项/);
  assert.match(creditHuman.items.map((i) => i.label).join('；'), /开放补证问题 2 个/);
  const policyHuman = cells.find((c) => c.domain === 'policy' && c.row === 'human');
  assert.match(policyHuman.items.map((i) => i.label).join('；'), /已采用本专业意见/);
  assert.equal(policyHuman.needsReview, false);
});

test('商机列：客户档案=真实输入项；需求登记=§13.5 读回或如实待录入（不用融资申请冒充）', () => {
  const cells = deriveTakeoffCells(src({ snapshot: { customer: { customerId: 'cus_1', displayName: '合成制造', status: 'active' } } }));
  const input = cells.find((c) => c.domain === 'opportunity' && c.row === 'input');
  assert.match(input.items.map((i) => i.label).join('；'), /客户已建档/);
  assert.ok(!input.items.some((i) => i.label.includes('cus_1')), '业务页面不展示客户内部编号');
  assert.match(input.items.map((i) => i.label).join('；'), /首次回租需求登记/);
  // 未登记：detail 必须是「未录入」语义（未知≠0），不得冒用融资申请
  const reqItem = input.items.find((i) => i.key === 'req');
  assert.ok(reqItem.detail.includes('未录入'), '未登记时如实说未录入');
  assert.ok(!reqItem.label.includes('¥'), '未登记不得显示金额');
  // 已登记：§13.5 读回金额（评估级客户需求），明示非融资申请
  const registered = deriveTakeoffCells(src({ snapshot: { customer: { customerId: 'cus_1', status: 'active' }, assessments: [{ assessmentId: 'a1', requestedAmountMinor: 50_000_00 }] } }));
  const reqReg = registered.find((c) => c.domain === 'opportunity' && c.row === 'input').items.find((i) => i.key === 'req');
  assert.match(reqReg.label, /首次回租需求已登记/);
  assert.match(reqReg.label, /5 万元/, '金额按投影既有格式化（分→元/万元）');
  assert.ok(reqReg.label.includes('非融资申请') || reqReg.detail.includes('绝不写 financing_requests'), '登记态仍明示评估级需求≠融资申请');
  const analysis = cells.find((c) => c.domain === 'opportunity' && c.row === 'analysis');
  assert.match(analysis.items[0].label, /尚未取得业务分析结果/);
  assert.equal(analysis.allowedActions.length, 0);
  const closure = cells.find((c) => c.domain === 'opportunity' && c.row === 'closure');
  assert.equal(closure.completed, false);
});

test('顶部摘要：候选金额来自同一方案；未配置=待评估/待补/待估，不是 0，不编造价格', () => {
  const top = deriveTakeoffTop(src({ snapshot: { assessments: [{ assessmentId: 'a1', candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY' } }] } }));
  assert.equal(top.suggestedAmount.text, '50 万元');
  assert.equal(top.requestedAmount.text, '待补');
  assert.match(top.requestedAmount.note, /未录入/);
  assert.equal(top.suggestedTerm.text, '待评估');
  assert.equal(top.referencePrice.text, '口径未配置');
  assert.equal(top.expect.text, '待估');
  assert.ok(top.planMarks.some((m) => m.includes('可做（支持）') && m.includes('authority=none')));
  assert.ok(top.planMarks.some((m) => m.includes('≠ 正式批准')));
  const empty = deriveTakeoffTop(src());
  assert.equal(empty.suggestedAmount.text, '待评估', '无候选=待评估，绝不显示 0');
});

test('参考价格：货币单位不重复，设备与期间分母保留', () => {
  for (const [priceUnit, suffix] of [['元/年','年'],['CNY/月','月'],['元/台/年','台/年'],['cny_per_annum','年'],['每期','每期']]) {
    const top = deriveTakeoffTop(src({ snapshot: { assessments: [{ candidate: { referencePriceMinor: 96_000_000, priceUnit } }] } }));
    assert.equal(top.referencePrice.text, `96 万元 / ${suffix}`);
  }
});

test('顶部摘要：changed 域 → 冻结影响标记 + 待复核；Gate 拒绝不改写为通过', () => {
  const top = deriveTakeoffTop(src({
    snapshot: {
      decisionStatus: { basis: { packageId: 'p', revision: 2, gate: { result: 'rejected' }, currency: [{ domain: 'asset', currency: 'changed' }] } },
    },
  }));
  assert.deepEqual(top.changedDomains, ['asset']);
  assert.ok(top.planMarks.some((m) => m.includes('待复核') && m.includes('资产')));
  assert.equal(top.gateResult, 'rejected');
});

test('待办：openItems/followups/处理链/冲突/changed 域各自成行，可回原格子或指定入口', () => {
  const rows = deriveTakeoffTodos(src({
    snapshot: {
      openItems: [{ kind: 'followup', needRole: 'credit', detail: '补充流水' }],
      session: { followups: [{ ownerRole: 'asset', reason: '权属文件未核验', nextAction: '复核' }] },
    },
    channelTasks: [{ status: 'needs_followup' }],
    factConflicts: 1,
    packageDetail: null,
  }));
  const credit = rows.find((r) => r.key.startsWith('oi-'));
  assert.deepEqual(credit.cell, { domain: 'credit', row: 'human' });
  assert.equal(credit.who, 'credit');
  const asset = rows.find((r) => r.key.startsWith('fu-'));
  assert.deepEqual(asset.cell, { domain: 'asset', row: 'human' });
  assert.match(asset.doneWhen, /复核/);
  assert.ok(rows.some((r) => r.key === 'chan-fup' && r.entry === 'materials'));
  assert.ok(rows.some((r) => r.key === 'conf' && r.entry === 'materials'));
  const chg = rows.find((r) => r.key === 'chg-asset');
  assert.ok(!chg || chg === undefined, '无 changed 域时不生成解冻待办');
  const withChanged = deriveTakeoffTodos(src({
    snapshot: { decisionStatus: { basis: { packageId: 'p', currency: [{ domain: 'asset', currency: 'changed' }] } } },
  }));
  const chg2 = withChanged.find((r) => r.key === 'chg-asset');
  assert.deepEqual(chg2.cell, { domain: 'asset', row: 'closure' });
  assert.match(chg2.doneWhen, /重新登记域结果/);
});

test('展示小工具：金额分→万元串；未知倾向原样保守展示', () => {
  assert.equal(fmtMinor(1_000_000), '1 万元');
  assert.equal(fmtMinor(123_456), '1,234.56 元');
  assert.equal(fmtMinor(null), '待评估');
  assert.equal(tendencyLabel('do_not'), '不做（负面）');
  assert.equal(tendencyLabel('weird_state'), '未知倾向：weird_state');
  assert.equal(tendencyLabel(null), '未登记');
});
