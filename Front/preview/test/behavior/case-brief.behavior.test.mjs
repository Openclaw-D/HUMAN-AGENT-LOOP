import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from './harness.mjs';
const React = await import('react');
const { deriveCaseBrief, gateResultCn, tendencyCn, assessmentStatusCn, arrowStateCn, currentAssessmentOf } = await import('../../../site-mirror/lib/workbench/case-brief.ts');
const { CaseBriefStrip } = await import('../../../site-mirror/app/takeoff/case-brief-strip.tsx');
const { fmtActor } = await import('../../../site-mirror/app/takeoff/work-timeline.tsx');

const base = {
  customerName: '喀什纺织厂',
  currentMaterials: 6,
  factConflicts: 0,
  snapshot: {
    customer: { displayName: '喀什纺织厂', status: 'active' },
    assessments: [{ status: 'candidate_ready', stale: false, requestedAmountMinor: 2_000_000_00 }],
    admission: {
      request: { requestedAmount: 2_000_000_00 },
      candidate: { suggestedAmount: 1_600_000_00, suggestedTermMonths: 36, tendency: 'do_with_adjusted_terms', conditions: ['补齐设备权属登记'] },
    },
    decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } },
    session: { openQuestions: 0 },
  },
};

// admission.arrow 投影夹具（Edge admission-projection 同形状；五区=business/policy/credit/commerce/asset）。
const five = (state, extra = {}) => ['business', 'policy', 'credit', 'commerce', 'asset'].map((domain) => ({ domain, state, ...extra }));
const arrowAwaitConfirm = {
  found: true, processId: 'ap-1', processStatus: 'in_progress',
  domains: five('awaiting_confirmation'),
  candidateDomains: [{
    domain: 'business', roundId: 'r-bus-1', basisVersion: 'bs-1', state: 'awaiting_confirmation',
    tendency: 'do_with_adjusted_terms', summary: '建议额度160万元、期限36个月', zoneCandidateCount: 4,
    zoneCandidateScoreType: 'rule_rank', selection: null,
    semantic: { status: 'succeeded', model: 'deepseek-flash', authority: 'none' },
  }],
  needsReselection: [], affectedDomains: [],
};
const arrowAllCompleted = {
  found: true, processId: 'ap-1', processStatus: 'in_progress',
  domains: five('completed'),
  candidateDomains: five('completed', { selection: { decision: 'adopt' } }).map((c, i) => ({ ...c, roundId: `r-${i}`, basisVersion: 'bs-1' })),
  needsReselection: [], affectedDomains: [],
};
const arrowStaleReselect = {
  found: true, processId: 'ap-1', processStatus: 'in_progress',
  domains: [{ domain: 'credit', state: 'stale' }, { domain: 'policy', state: 'completed' }, { domain: 'commerce', state: 'awaiting_confirmation' }, { domain: 'asset', state: 'awaiting_confirmation' }, { domain: 'business', state: 'completed' }],
  candidateDomains: [
    { domain: 'credit', state: 'stale', selection: { decision: 'adopt' } },
    { domain: 'commerce', state: 'awaiting_confirmation', selection: null },
  ],
  needsReselection: [{ domain: 'credit', reason: 'basis_updated' }],
  affectedDomains: ['asset'],
};
const withArrow = (arrow, over = {}) => ({
  ...base,
  ...over,
  snapshot: { ...base.snapshot, admission: { ...base.snapshot.admission, arrow }, ...(over.snapshot ?? {}) },
});

test('简报固定回答四问：背景/现状/原因/下一步，且金额与期间来自服务端字段', () => {
  const brief = deriveCaseBrief(base);
  assert.ok(brief.background.includes('喀什纺织厂'));
  assert.ok(brief.background.includes('200 万元'));
  const situationText = brief.situation.map((s) => s.text).join('；');
  assert.ok(situationText.includes('已有建议方案'));
  assert.ok(situationText.includes('6 份现行材料'));
  assert.ok(JSON.stringify(brief.reasons).includes('补齐设备权属登记'));
  assert.equal(brief.nextStep.who, '信审专员');
  assert.ok(brief.nextStep.what.includes('提交复核'), 'candidate_ready 的下一步=提交复核再由有权人员确认（真实断言，替换原恒真式）');
  assert.ok(brief.nextStep.what.includes('有权人员') && brief.nextStep.what.includes('确认'));
  assert.ok(brief.caution.includes('不等于正式审批'));
  assert.ok(brief.caution.includes('不显示'));
});

test('评估排序：当前评估=清单序首条非 superseded（A 清单最新在前），不盲取末条', () => {
  const src = {
    customerName: '排序厂', currentMaterials: 2, factConflicts: 0,
    snapshot: {
      assessments: [
        { status: 'candidate_ready', stale: false, requestedAmountMinor: 2_000_000_00 },
        { status: 'awaiting_human_review', stale: false },
      ],
    },
  };
  const brief = deriveCaseBrief(src);
  assert.ok(brief.situation.map((s) => s.text).join('；').includes('已有建议方案'), '取首条（最新），不取末条旧评估');
  assert.equal(brief.nextStep.who, '信审专员', '下一步跟随首条评估，不被末条旧状态覆盖');
  // 首条为 superseded：跳过取下一条非 superseded
  const skipped = deriveCaseBrief({ ...src, snapshot: { assessments: [{ status: 'superseded' }, { status: 'collecting', stale: false }] } });
  assert.ok(skipped.situation.map((s) => s.text).join('；').includes('正在收集材料'), '首条 superseded 被跳过，不冒充已撤回状态');
  // 空清单=尚未建立
  assert.equal(currentAssessmentOf([]), null);
  assert.equal(currentAssessmentOf(null), null);
});

test('待人工确认：arrow awaiting_confirmation 驱动下一步=有权人员确认；旧评估状态不冒充', () => {
  const src = withArrow(arrowAwaitConfirm, { snapshot: { assessments: [{ status: 'collecting', stale: false }] } });
  const brief = deriveCaseBrief(src);
  const zones = brief.situation.find((s) => s.key === 'zones');
  assert.ok(zones, 'arrow 可用时显示五区推进行');
  assert.ok(zones.attention, '待人工确认需要人工注意');
  assert.ok(zones.text.includes('候选待人工确认'));
  assert.ok(!zones.text.startsWith('五区推进'), '正文不与标签重复前缀');
  assert.equal(brief.nextStep.who, '客户经理（业务）', 'R3 权限表：业务区候选确认=客户经理（业务），不再一律指向信审');
  assert.ok(brief.nextStep.what.includes('确认'));
  assert.ok(brief.nextStep.what.includes('不等于批准'), '确认动作明确默认建议不等于批准');
  assert.ok(!brief.nextStep.what.includes('重新上传'), '下一步不是回退到上传（旧评估 collecting 不覆盖 arrow 状态）');
  // 原因区说明候选条数与规则排序（非概率），语义来源如实标注
  assert.ok(brief.reasons.some((r) => r.includes('规则排序') && r.includes('4 项候选')));
  assert.ok(brief.reasons.some((r) => r.includes('deepseek-flash') && r.includes('仅供参考')));
});

test('五区推进完成：arrow 全部已确认不被旧 assessments 覆盖为等待确认', () => {
  const src = withArrow(arrowAllCompleted, { snapshot: { assessments: [{ status: 'awaiting_human_review', stale: false }] } });
  const brief = deriveCaseBrief(src);
  const zones = brief.situation.find((s) => s.key === 'zones');
  assert.ok(zones.text.includes('已确认'));
  assert.equal(zones.attention, false, '全部确认后不再标记注意');
  assert.ok(brief.nextStep.what.includes('已全部确认'), '五区推进完成如实呈现');
  assert.ok(!brief.nextStep.what.includes('重新选择'), '完成态不冒充需要重选');
  // 预评估链尚未确认：终点动作=确认预评估结论（两条链各自如实；该终点按权限表=信审角色）
  assert.equal(brief.nextStep.who, '信审专员（有权人员）');
  assert.ok(brief.nextStep.what.includes('预评估结论'));
  // 预评估链状态行与五区行并存且一致
  assert.ok(brief.situation.some((s) => s.key === 'assess' && s.text.includes('等待人工确认')));
});

test('补证后陈旧重选：needsReselection/affectedDomains 驱动重新选择，旧候选不冒充现行', () => {
  const brief = deriveCaseBrief(withArrow(arrowStaleReselect, { snapshot: { assessments: [{ status: 'awaiting_human_review', stale: false }] } }));
  const zones = brief.situation.find((s) => s.key === 'zones');
  assert.ok(zones.attention);
  assert.ok(zones.text.includes('依据已过期'), 'stale 域如实显示依据已过期');
  assert.ok(zones.text.includes('候选待人工确认'), '其他区仍在待确认，五态不合并不掩盖');
  assert.ok(brief.nextStep.what.includes('重新'), '下一步=重新分析/重新选择');
  assert.ok(brief.nextStep.what.includes('信审'), '重选域（credit）落在下一步文案');
  assert.ok(brief.reasons.some((r) => r.includes('不再现行')), '原因说明旧选择失效');
  // 陈旧重选优先于确认动作：whole-case 下一步不跳过重选直接确认
  assert.ok(!brief.nextStep.what.startsWith('确认'), '重选优先，不用确认动作掩盖陈旧状态');
});

test('已上传待分析：材料已登记+处理链在途 → 下一步为分析进行中，不要求重新上传', () => {
  const brief = deriveCaseBrief({
    customerName: '在建厂', currentMaterials: 6, factConflicts: 0,
    channelTasks: [{ status: 'running' }, { status: 'queued' }],
    snapshot: {
      customer: { displayName: '在建厂', status: 'active' },
      assessments: [{ status: 'collecting', stale: false }],
      admission: null,
      decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } },
    },
  });
  assert.equal(brief.nextStep.who, '系统（处理链）');
  assert.ok(brief.nextStep.what.includes('分析进行中') || brief.nextStep.what.includes('登记与分析进行中'));
  assert.ok(!brief.nextStep.what.includes('上传第一份'), '已有材料时不再要求上传第一份');
  // 无通道在途（通道未知）但评估=collecting：如实说按事件触发登记分析
  const quiet = deriveCaseBrief({ ...base, snapshot: { ...base.snapshot, assessments: [{ status: 'collecting', stale: false }], admission: null } });
  assert.ok(quiet.nextStep.what.includes('登记分析') || quiet.nextStep.what.includes('核对'), 'collecting 态下一步指向登记分析/核对回执，不冒充完成');
});

test('加载中：快照未读到时如实显示加载，不冒充“未开始”', () => {
  const brief = deriveCaseBrief({ customerName: null, currentMaterials: null, factConflicts: 0, snapshot: null });
  assert.ok(brief.background.includes('正在读取'));
  const loading = brief.situation.find((s) => s.key === 'loading');
  assert.ok(loading, '加载态有独立标识');
  assert.ok(loading.text.includes('尚未读到'));
  assert.ok(!brief.situation.some((s) => s.text.includes('尚未开始') || s.text.includes('预评估尚未')), '加载≠未开始');
  assert.ok(brief.caution.includes('加载中'));
});

test('权限失败：材料清单 403 如实显示无权读取，不冒充“没有材料”，不臆称已授权', () => {
  const brief = deriveCaseBrief({
    customerName: '受限厂', currentMaterials: null, materialsReadError: 403, factConflicts: 0,
    snapshot: { customer: { displayName: '受限厂' }, assessments: [{ status: 'collecting', stale: false }] },
  });
  const materials = brief.situation.find((s) => s.key === 'materials');
  assert.ok(materials.attention);
  assert.ok(materials.text.includes('无权读取'));
  assert.ok(materials.text.includes('权限不足'), '如实说明是权限不足');
  assert.ok(!materials.text.includes('还没有登记任何材料'), '权限不足≠没有材料');
  assert.equal(brief.nextStep.who, '业务人员或管理员');
  assert.ok(brief.nextStep.what.includes('核对授权'), '下一步指向授权核对，不编造已授权');
  // 非 403 失败：如实显示读取失败与状态码
  const failed = deriveCaseBrief({ ...base, currentMaterials: null, materialsReadError: 502 });
  assert.ok(failed.situation.find((s) => s.key === 'materials').text.includes('读取失败（状态 502）'));
});

test('未知如实：无材料/读取失败/无评估时不说“0”不编造下一步动作', () => {
  const brief = deriveCaseBrief({ customerName: '某厂', currentMaterials: null, factConflicts: 0, snapshot: {} });
  const materials = brief.situation.find((s) => s.key === 'materials');
  assert.ok(materials.text.includes('无法读取'));
  assert.ok(!materials.text.includes('0 份'));
  assert.ok(brief.background.includes('需求金额尚未登记'));
  assert.ok(brief.reasons.some((r) => r.includes('尚未形成正式判断原因')));
});

test('缺件/冲突/红线：冲突与红线进入现状并标记 attention，不被藏进更多菜单', () => {
  const conflicted = structuredClone(base);
  conflicted.factConflicts = 2;
  conflicted.snapshot.decisionStatus.basis.gate = { result: 'rejected' };
  const brief = deriveCaseBrief(conflicted);
  const conflict = brief.situation.find((s) => s.key === 'conflict');
  const gate = brief.situation.find((s) => s.key === 'gate');
  assert.ok(conflict.attention && conflict.text.includes('2 处'));
  assert.ok(gate.attention && gate.text.includes('不能通过'));
  assert.equal(brief.nextStep.who, '业务人员');
  assert.ok(brief.nextStep.what.includes('不能通过'));
  // 缺件（0 份材料）进入现状并成为下一步（无候选的收集期客户）
  const empty = deriveCaseBrief({
    customerName: '新厂', currentMaterials: 0, factConflicts: 0,
    snapshot: { customer: { displayName: '新厂' }, assessments: [{ status: 'collecting', stale: false }], admission: null, decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } } },
  });
  assert.ok(empty.situation.find((s) => s.key === 'materials').text.includes('还没有登记任何材料原件'));
  assert.ok(empty.nextStep.what.includes('上传第一份'));
});

test('术语中文化：gate/tendency/status/arrowState 映射，未知值不冒充', () => {
  assert.equal(gateResultCn('rejected'), '未通过');
  assert.equal(gateResultCn('pass'), '通过');
  assert.equal(tendencyCn('do_with_adjusted_terms'), '可做（调整条件后支持）');
  assert.equal(tendencyCn('weird_value'), '倾向：weird_value');
  assert.equal(assessmentStatusCn('awaiting_human_review'), '等待人工确认');
  assert.equal(assessmentStatusCn(null), '状态未登记');
  assert.equal(arrowStateCn('awaiting_confirmation'), '候选待人工确认');
  assert.equal(arrowStateCn('completed'), '已确认');
  assert.equal(arrowStateCn('waiting_evidence'), '等待补证');
  assert.equal(arrowStateCn('stale'), '依据已过期');
  assert.equal(arrowStateCn('unknown'), '结果核对中');
  assert.equal(arrowStateCn('mystery'), '状态：mystery');
  assert.equal(arrowStateCn(null), '状态未登记');
});

test('合同 v1.1 §5 示例形状：waiting_evidence 归补证出口；not_started/waiting_dependency 如实中文', () => {
  // 与 01-back BUSINESS_EXPLANATION.md §5 由 deriveAdmission 生成的示例同形状
  const brief = deriveCaseBrief(withArrow({
    found: true, processId: 'ap-v06demo01', processStatus: 'in_progress',
    domains: [
      { domain: 'business', state: 'awaiting_confirmation', roundId: 'round-biz-01' },
      { domain: 'asset', state: 'waiting_evidence', roundId: 'round-asset-01' },
      { domain: 'credit', state: 'not_started', roundId: null },
      { domain: 'policy', state: 'waiting_dependency', roundId: null },
      { domain: 'commerce', state: 'not_started', roundId: null },
    ],
    candidateDomains: [{
      domain: 'business', roundId: 'round-biz-01', basisVersion: 'bv-3f9a21c4', state: 'awaiting_confirmation',
      tendency: null, summary: '年销售额约480万元的设备回租，经营性现金流可覆盖租金，建议进入人工确认',
      zoneCandidateCount: 4, zoneCandidateScoreType: 'rule_rank', selection: null,
      semantic: { status: 'succeeded', model: 'deepseek-flash', authority: 'none' },
    }],
    needsReselection: [],
    affectedDomains: ['asset'],
  }));
  const zones = brief.situation.find((s) => s.key === 'zones');
  assert.ok(zones.text.includes('未开始') && zones.text.includes('等待前序办理'), 'not_started/waiting_dependency 如实中文，不冒充未知码');
  assert.ok(zones.text.includes('等待补证'));
  assert.equal(brief.nextStep.who, '客户经理（业务）', 'business 区现行候选可独立确认（对应专业角色）');
  assert.ok(brief.nextStep.what.includes('业务'), '确认对象=业务区');
  assert.ok(brief.reasons.some((r) => r.includes('等待补证') || r.includes('资产')), '资产等待补证在原因区可见（不用旧评估候选补位）');
  assert.ok(brief.reasons.some((r) => r.includes('年销售额约480万元')), '候选摘要来自 arrow.candidateDomains.summary');
});

test('操作者如实：未知/内部代号=身份未记录（不证明已授权或系统），服务身份才显示系统登记', () => {
  assert.equal(fmtActor(null), '操作者身份未记录', 'null 不能证明系统操作');
  assert.equal(fmtActor(''), '操作者身份未记录');
  assert.equal(fmtActor('0f4c9a2b-33d1-4e5f-8a6b-7c8d9e0f1a2b'), '操作者身份未记录', '内部ID不能证明已授权');
  assert.equal(fmtActor('0f4c9a2b33d14e5f8a6b7c8d9e0f1a2b'), '操作者身份未记录', '十六进制长代号同样不证明授权');
  assert.equal(fmtActor('张三'), '张三');
  assert.equal(fmtActor('svcexec'), '系统登记（服务身份）', '有可靠事件来源的服务身份才显示系统登记');
  assert.equal(fmtActor('SYSTEM'), '系统登记（服务身份）');
  assert.ok(fmtActor(null, ['credit', 'customer']).includes('信审'));
  assert.ok(fmtActor(null, ['credit']).includes('身份代号'));
});

test('R3 权限表：五区确认各绑各域专业角色，多域并列；信审区确认才指信审', () => {
  // 政策+商务两区待确认：who=两域专业并列，不出现信审
  const twoZones = withArrow({
    ...arrowAwaitConfirm,
    domains: five('awaiting_confirmation'),
    candidateDomains: [
      { domain: 'policy', state: 'awaiting_confirmation', selection: null },
      { domain: 'commerce', state: 'awaiting_confirmation', selection: null },
    ],
  });
  const briefTwo = deriveCaseBrief(twoZones);
  assert.equal(briefTwo.nextStep.who, '政策合规专员、商务专员');
  assert.ok(briefTwo.nextStep.what.includes('政策') && briefTwo.nextStep.what.includes('商务'));
  assert.ok(!briefTwo.nextStep.who.includes('信审'), '政策/商务确认不指向信审审批');
  // 信审区待确认：who=信审专员（该域自己的专业）
  const creditOnly = withArrow({
    ...arrowAwaitConfirm,
    candidateDomains: [{ domain: 'credit', state: 'awaiting_confirmation', selection: null }],
  });
  assert.equal(deriveCaseBrief(creditOnly).nextStep.who, '信审专员', '信审区确认=信审专员（域角色，非“有权信审人员”泛称）');
  // 资产区失败重跑：who=资产评估专员
  const assetFailed = withArrow({
    found: true, processId: 'ap-1', processStatus: 'in_progress',
    domains: [{ domain: 'asset', state: 'failed' }, ...['business', 'policy', 'credit', 'commerce'].map((d) => ({ domain: d, state: 'completed' }))],
    candidateDomains: [],
  });
  const briefFailed = deriveCaseBrief(assetFailed);
  assert.equal(briefFailed.nextStep.who, '资产评估专员');
  assert.ok(briefFailed.nextStep.what.includes('失败'), '失败如实显示');
});

test('简报条四页常驻渲染：四问标签可见，注意态有标记', (t) => {
  t.after(cleanup);
  render(React.createElement(CaseBriefStrip, { source: base, customerName: '喀什纺织厂' }));
  for (const label of ['客户背景', '现在怎么样', '为什么', '下一步']) assert.ok(screen.getByText(label));
  assert.ok(screen.getByText(/喀什纺织厂/));
  cleanup();
  render(React.createElement(CaseBriefStrip, { source: { ...base, factConflicts: 1 }, customerName: '喀什纺织厂' }));
  assert.ok(screen.getAllByText(/互相矛盾/).length > 0);
});

test('简报条渲染 arrow 现行状态：待确认/完成跨页可见，旧评估不冒充（R2 阻断项1 回归）', (t) => {
  t.after(cleanup);
  render(React.createElement(CaseBriefStrip, { source: withArrow(arrowAwaitConfirm), customerName: '喀什纺织厂' }));
  assert.ok(screen.getAllByText(/候选待人工确认/).length > 0, '五区待确认状态在简报条可见');
  assert.ok(screen.getAllByText(/客户经理（业务）/).length > 0, '下一步=业务区对应专业角色（客户经理）');
  cleanup();
  render(React.createElement(CaseBriefStrip, { source: withArrow(arrowAllCompleted, { snapshot: { assessments: [{ status: 'awaiting_human_review', stale: false }] } }), customerName: '喀什纺织厂' }));
  assert.ok(screen.getAllByText(/已全部确认/).length > 0, '五区推进完成如实呈现');
  assert.equal(screen.queryAllByText('办理进度').length, 0, 'arrow 可用时旧评估“办理进度”行不出现（不被旧评估冒充）');
  cleanup();
  render(React.createElement(CaseBriefStrip, { source: { customerName: '加载厂', currentMaterials: null, factConflicts: 0, snapshot: null }, customerName: null }));
  assert.ok(screen.getAllByText(/正在读取/).length > 0, '加载态渲染为正在读取');
});

test('R3 顶部收敛：默认仅状态+下一步两行，背景/为什么/口径收进展开区，关键金额仍在顶部', (t) => {
  t.after(cleanup);
  render(React.createElement(CaseBriefStrip, { source: base, customerName: '喀什纺织厂' }));
  // 顶部只保留两条常驻行（现在怎么样 / 下一步），其余收进 details
  const section = document.querySelector('.tk-case-brief');
  const topRows = [...section.querySelectorAll(':scope > .tk-brief-row')];
  assert.equal(topRows.length, 2, `顶部常驻行=2（实际 ${topRows.length}）`);
  assert.ok(topRows[0].textContent.includes('现在怎么样'));
  assert.ok(topRows[1].textContent.includes('下一步'));
  // 背景与依据展开区存在且默认不展开，内容仍在 DOM（按需可见，不是删除）
  const more = section.querySelector('details.tk-brief-more');
  assert.ok(more, '背景与依据展开区存在');
  assert.equal(more.open, false, '默认收起');
  assert.ok(more.textContent.includes('客户背景') && more.textContent.includes('为什么') && more.textContent.includes('不等于正式审批'), '背景/原因/口径在展开区内按需可读');
  // 关键金额不藏：现行候选（建议额度）常驻顶部行
  assert.ok(topRows[0].textContent.includes('建议额度'), '建议额度常驻顶部');
  assert.ok(topRows[0].textContent.includes('160'), '金额数值来自服务端候选');
  // 注意态（冲突/红线/无权）不被折叠
  cleanup();
  render(React.createElement(CaseBriefStrip, { source: { ...base, factConflicts: 2 }, customerName: '喀什纺织厂' }));
  const warned = [...document.querySelectorAll('.tk-case-brief > .tk-brief-row')].map((r) => r.textContent).join('');
  assert.ok(warned.includes('互相矛盾'), '冲突警示常驻顶部（不折叠）');
});

// ---- NIGHT-02 F3（03 终验发现）：有已上传并核验登记的原件时，下一步不得再说“先上传材料”----

test('F3 材料就绪：有现行材料且无分析时，下一步=提交材料并分析（不以数量冒充核验完成）', () => {
  const brief = deriveCaseBrief({
    customerName: '就绪厂', currentMaterials: 72, factConflicts: 0,
    snapshot: { customer: { displayName: '就绪厂', status: 'active' }, assessments: [], admission: null, decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } }, session: { openQuestions: 0 } },
  });
  assert.equal(brief.nextStep.who, '业务人员');
  assert.ok(brief.nextStep.what.includes('提交材料并分析'), '指向真实页面动作');
  assert.ok(brief.nextStep.what.includes('72'), '如实报现行材料数');
  assert.ok(brief.nextStep.what.includes('登记不等于核验完成'), '不以材料数量冒充核验完成');
  assert.equal(brief.nextStep.what.includes('先上传'), false, '不再误导为先上传材料');
});

test('F3 缺件优先级不变：0 份材料仍指向先上传', () => {
  const brief = deriveCaseBrief({
    customerName: '空厂', currentMaterials: 0, factConflicts: 0,
    snapshot: { customer: { displayName: '空厂', status: 'active' }, assessments: [], admission: null, decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } }, session: { openQuestions: 0 } },
  });
  assert.ok(brief.nextStep.what.includes('上传第一份'));
});

test('F3 切客户状态各自独立：就绪厂与空厂简报互不串用', () => {
  const src = (materials, name) => ({
    customerName: name, currentMaterials: materials, factConflicts: 0,
    snapshot: { customer: { displayName: name, status: 'active' }, assessments: [], admission: null, decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } }, session: { openQuestions: 0 } },
  });
  const ready = deriveCaseBrief(src(72, '就绪厂'));
  const empty = deriveCaseBrief(src(0, '空厂'));
  assert.ok(ready.nextStep.what.includes('提交材料并分析'));
  assert.ok(empty.nextStep.what.includes('上传第一份'));
  // 未知材料数（读取中）→ 中性兜底，不冒充缺件也不冒充就绪
  const unknown = deriveCaseBrief(src(null, '未知厂'));
  assert.ok(unknown.nextStep.what.includes('材料清单暂时无法读取'));
});
