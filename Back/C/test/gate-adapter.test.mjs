// 任务 02 · B2.1/W05 C→A 契约互验测试：生产者实际输出作为消费者契约输入（禁止手写 fixture）。
// 消费者形状以 Back/A/src/domain/decision-support.ts 的 validateGateInput /
// Back/A/src/domain/package.ts 的 validateAnalysisRunShallow（PR#3 审核固定版）为镜像断言；
// 真实服务端校验仍由 A 执行，本测试只锁"字段形状与投影规则"，防止两端再次漂移（F06/X04）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFourDomainPipeline } from '../domains/pipeline.mjs';
import { toAGateInput, toADomainResultRegistration, toAInputWatermarkString, GATE_ADAPTER_VERSION } from '../src/gate-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pack = JSON.parse(readFileSync(path.join(root, 'rules', 'four-domain-rule-pack-v1.json'), 'utf8'));
const set = JSON.parse(readFileSync(path.join(root, 'scenarios', 'four-domain-cases-v1.json'), 'utf8'));

const PICKS = {
  CLEAR: 'S01-normal-direct-clean',
  NEEDS_EVIDENCE: 'S19-asset-video-no-ownership-doc',
  HOLD_FOR_REVIEW: 'S10-conflict-invoice-contract',
  HARD_BLOCK: 'S20-asset-ownership-third-party',
};

/** 真实管线运行指定场景首轮（生产者实际输出，非手写）。 */
function runReal(caseId) {
  const s = set.scenarios.find((x) => x.caseId === caseId);
  assert.ok(s, `场景 ${caseId} 存在`);
  const r = runFourDomainPipeline({
    tenantId: 'tenant-demo', customerId: s.customerId, materials: s.rounds[0].materials,
    transaction: s.transaction ?? {}, asOf: s.asOf, rulePack: pack,
    ...(s.pipelineArgs ?? {}),
  });
  assert.equal(r.ok, true, `管线应成功：${JSON.stringify(r.problems ?? [])}`);
  return r;
}

/** 镜像 A validateGateInput（decision-support.ts）的形状约束；违规即抛。 */
function assertAValidateGateInput(g) {
  assert.equal(typeof g, 'object');
  assert.ok(['CLEAR', 'NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW', 'HARD_BLOCK'].includes(g.result), `result 枚举: ${g.result}`);
  assert.equal(typeof g.rulePackVersion, 'string', 'rulePackVersion 必须为 string（F06 主缺口）');
  assert.ok(g.rulePackVersion.length >= 1 && g.rulePackVersion.length <= 64);
  assert.ok(Array.isArray(g.blockedActions), 'blockedActions 必须为顶层数组（F06 主缺口）');
  assert.ok(g.blockedActions.every((x) => typeof x === 'string'));
  assert.ok((g.reasonCodes ?? []).every((x) => typeof x === 'string'));
  assert.ok((g.ruleIds ?? []).every((x) => typeof x === 'string'));
  if (g.evaluatedAt !== undefined) assert.equal(typeof g.evaluatedAt, 'string');
  assert.ok(Array.isArray(g.evidenceRefs ?? []));
}

for (const [expected, caseId] of Object.entries(PICKS)) {
  test(`W05 真实场景 ${caseId}（${expected}）→ 适配后满足 A GateInput 形状`, () => {
    const r = runReal(caseId);
    assert.equal(r.gate.result, expected, '场景预期 Gate 结果与生产者输出一致（输入是真管线产物）');
    const a = toAGateInput(r.gate);
    assert.equal(a.ok, true, `适配失败：${JSON.stringify(a.problems ?? [])}`);
    assertAValidateGateInput(a.aGateInput);
    // 投影语义核对：字段来源一一对应，不静默变形
    assert.equal(a.aGateInput.rulePackVersion, r.gate.rulesetVersion);
    assert.equal(a.aGateInput.rulePackVersion, pack.version, '规则包版本必须可溯源到激活包');
    assert.deepEqual(a.aGateInput.blockedActions, r.gate.scope.blockedActions);
    assert.deepEqual(a.aGateInput.reasonCodes, r.gate.reasonCodes);
    assert.deepEqual(a.aGateInput.ruleIds, r.gate.ruleIds);
    // 无损透传与版本声明
    assert.equal(a.aGateInput.cPassthrough.adapterVersion, GATE_ADAPTER_VERSION);
    assert.deepEqual(a.aGateInput.cPassthrough.blockedActionsProposed, r.gate.scope.blockedActionsProposed ?? []);
    // HARD_BLOCK 时顶层 blockedActions 非空且为强制集；非 HARD_BLOCK 时强制集为空
    if (expected === 'HARD_BLOCK') assert.ok(a.aGateInput.blockedActions.length > 0, '硬门必须携带强制阻断动作');
    else assert.deepEqual(a.aGateInput.blockedActions, []);
  });
}

test('W05 坏 schema 明确拒绝：缺 rulesetVersion / scope.blockedActions 非法', () => {
  const r = runReal('S01-normal-direct-clean');
  const mutated = { ...r.gate, rulesetVersion: undefined };
  const a1 = toAGateInput(mutated);
  assert.equal(a1.ok, false);
  assert.ok(a1.problems.some((p) => p.includes('rulesetVersion')));

  const a2 = toAGateInput({ ...r.gate, scope: { ...r.gate.scope, blockedActions: 'approve_all' } });
  assert.equal(a2.ok, false);
  assert.ok(a2.problems.some((p) => p.includes('blockedActions')));

  const a3 = toAGateInput(null);
  assert.equal(a3.ok, false);
});

test('W05 域结果登记帧：真实完成 Run 可投影，watermark 投影为可核字符串', () => {
  const r = runReal('S01-normal-direct-clean');
  const entry = r.analyses.credit;
  assert.ok(entry?.analysisRun && entry?.assessment, '真实域分析包存在');
  const factKeys = [...new Set(r.projections.credit.items.map((i) => i.factKey))];
  const reg = toADomainResultRegistration({
    domain: 'credit', analysisRun: entry.analysisRun, assessment: entry.assessment,
    deps: { artifactIds: r.projections.credit.items.map((i) => i.materialId), factKeys, rulePackVersion: pack.version },
  });
  assert.equal(reg.ok, true, `登记帧构造失败：${JSON.stringify(reg.problems ?? [])}`);
  // 镜像 A validateAnalysisRunShallow：runId/inputHash/inputWatermark/rulesetVersion 非空 string
  const ar = reg.frame.analysisRun;
  for (const k of ['runId', 'inputHash', 'inputWatermark', 'rulesetVersion']) {
    assert.equal(typeof ar[k], 'string', `analysisRun.${k} 必须为 string（A 侧要求）`);
    assert.ok(ar[k].length > 0);
  }
  assert.equal(ar.executionStatus, 'completed');
  assert.equal(reg.frame.deps.rulePackVersion, pack.version, '登记冻结版本=显式提供的规则包版本');
  // 域 Run 自身版本戳（信审域=阈值包版本 sim-business@0.3）原样保留，不被冒充为规则包版本
  assert.equal(ar.rulesetVersion, entry.analysisRun.rulesetVersion);
  assert.notEqual(entry.analysisRun.rulesetVersion, pack.version, '前置事实：信审域自身盖的是阈值包版本');
  // 水位投影可由原件重算核对
  assert.equal(ar.inputWatermark, toAInputWatermarkString(entry.analysisRun.inputWatermark));
  assert.equal(reg.frame.opinion.authority, 'none');
  assert.ok(reg.frame.cOriginal.inputWatermarkObject, '对象水位原件保留在 cOriginal');
});

test('W05 非 completed Run 拒绝登记为有效候选（B2.5 失败关闭）', () => {
  const r = runReal('S19-asset-video-no-ownership-doc');
  const entry = r.analyses.credit;
  const broken = { ...entry.analysisRun, executionStatus: 'timeout' };
  const reg = toADomainResultRegistration({
    domain: 'credit', analysisRun: broken, assessment: entry.assessment,
    deps: { artifactIds: [], factKeys: [] },
  });
  assert.equal(reg.ok, false);
  assert.ok(reg.problems.some((p) => p.includes('timeout') && p.includes('不得登记')));
  // authority 非 none 一并拒绝
  const bad = toADomainResultRegistration({
    domain: 'credit', analysisRun: entry.analysisRun,
    assessment: { ...entry.assessment, authority: 'auto' },
    deps: { artifactIds: [], factKeys: [] },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.includes('authority')));
});
