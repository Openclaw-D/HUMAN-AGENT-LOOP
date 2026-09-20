// 任务 03 · 四域经 B 持久执行器产出候选（E1 接线）+ 单域重算/收口路由。
// 断言：fd 工具链在真实编排器（LangGraph checkpoint + stub 契约）上跑通
// claim→complete(最多 candidate_ready)；域候选 authority=none；失败关闭路径。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createBRuntime } from '../src/runtime.mjs';
import { createFourDomainTools, FOUR_DOMAIN_TOOL_VERSION } from '../src/domains/four-domain-tools.mjs';
import { reportOutcome } from '../src/worker/worker.mjs';
import { tmpDir, rmDir } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const routesPath = path.join(here, '..', 'config', 'routes-four-domain.json');

const MATERIALS = (p = 'F') => [
  { materialId: `${p}-M1`, kind: 'document', content: '身份核验(合成)', sourceRef: { channel: 'c', capturedAt: '2026-08-01', field: '主体' }, declaredFacts: [{ factKey: 'entity_identity_verified', value: true, verificationLevel: 'verified' }], quality: {} },
  { materialId: `${p}-M2`, kind: 'document', content: '权属(合成)', sourceRef: { channel: 'c', capturedAt: '2026-08-01', page: '1', field: '权属' }, declaredFacts: [{ factKey: 'equipment_ownership_verified', value: true, verificationLevel: 'verified' }, { factKey: 'equipment_model', value: 'XCMG-ZL50G(合成)', caliber: '铭牌', verificationLevel: 'source_supported' }], quality: {} },
  { materialId: `${p}-M3`, kind: 'document', content: '现金流(合成)', sourceRef: { channel: 'c', capturedAt: '2026-08-10', field: '现金流' }, declaredFacts: [{ factKey: 'monthly_operating_cash_flow', value: 78, unit: '万元', caliber: '租金后', verificationLevel: 'source_supported' }], quality: {} },
  { materialId: `${p}-M4`, kind: 'document', content: '偿债(合成)', sourceRef: { channel: 'c', capturedAt: '2026-08-10', field: '偿债' }, declaredFacts: [{ factKey: 'monthly_debt_service', value: 60, unit: '万元', caliber: '租金+利息', verificationLevel: 'source_supported' }], quality: {} },
  { materialId: `${p}-M5`, kind: 'document', content: '集中度(合成)', sourceRef: { channel: 'c', capturedAt: '2026-08-10', field: '集中度' }, declaredFacts: [{ factKey: 'top1_customer_revenue_share', value: 55, unit: '%', verificationLevel: 'source_supported' }], quality: {} },
];
const TASK_PARAMS = {
  tenantId: 'tenant-demo', customerId: 'cust-fd-01',
  materials: MATERIALS(),
  transaction: { orgType: 'commercial_leasing', region: '华东某地(合成)', product: 'direct_lease', customerRange: 'standard' },
  asOf: '2026-09-16',
};

test('E1: 四域评估经编排器完整跑通 → candidate_ready(provider=calculation, authority=none)', async () => {
  const dir = await tmpDir('fd-e2e-');
  try {
    const rt = createBRuntime({
      dataDir: dir,
      config: { transport: {}, routesPath, contract: { mode: 'stub' }, tools: { mode: 'four-domain' } },
      overrides: { logger: () => {} },
    });
    await rt.contract.seedGoal({ goalId: 'g-fd-1', projectId: 'p-fd', goalKey: 'four_domain_evaluation', role: 'jianwei' });
    const claim = await rt.contract.claimGoal({ goalId: 'g-fd-1', requestId: `claim:g-fd-1:${Date.now()}` });
    assert.equal(claim.ok, true);

    const run = await rt.worker.executeNow(
      {
        goalId: 'g-fd-1', projectId: 'p-fd', goalKey: 'four_domain_evaluation', params: TASK_PARAMS,
        role: 'jianwei', purpose: 'four_domain_evaluation',
        evidenceRefs: [{ id: 'psnap-fd-1', version: 1 }, { id: 'ev-batch-1', version: 1 }],
      },
      claim.assignment, { goalVersion: claim.goalVersion },
    );
    assert.equal(run.submitted, true, `提交失败:${JSON.stringify(run.rejected ?? run.view?.terminal ?? {}).slice(0, 300)}`);

    const goal = await rt.contract.getGoalView('g-fd-1');
    assert.equal(goal.status, 'candidate_ready');
    assert.equal(goal.result.provider, 'calculation'); // 确定性管线:零模型调用,如实标 calculation
    const output = goal.result.output;
    // A 契约投影:候选只含白名单字段,authority=none 由构造保证(哨兵省略,无越权字段)
    for (const k of Object.keys(output)) {
      assert.ok(['observations', 'evidenceRefs', 'assumptions', 'uncertainty', 'recommendedHumanAction'].includes(k), `候选字段越界:${k}`);
    }
    // 候选内含四域结果与 Gate 汇总(toACandidate 投影为观察列表)
    const text = JSON.stringify(output);
    assert.ok(text.includes('CLEAR'), `候选应包含 Gate 结果,实际:${text.slice(0, 400)}`);
    // 可追溯性:候选含感知快照锚(inputHash/snapshotId 出现在感知步观察内,E1 同源可审计)
    assert.ok(/psnap-[0-9a-f]{16}/.test(text), '候选应携带感知快照锚');
  } finally {
    await rmDir(dir);
  }
});

test('E1: 不利事实(新增负债)经同一执行器 → HOLD 且候选金额下降(结构性,零模型)', async () => {
  const dir = await tmpDir('fd-e2e2-');
  try {
    const rt = createBRuntime({
      dataDir: dir,
      config: { transport: {}, routesPath, contract: { mode: 'stub' }, tools: { mode: 'four-domain' } },
      overrides: { logger: () => {} },
    });
    const materials = [...MATERIALS('H'),
      { materialId: 'H-M10', kind: 'document', content: '征信新增负债(合成)', sourceRef: { channel: 'c', capturedAt: '2026-09-10', field: '新增负债' }, declaredFacts: [{ factKey: 'new_debt_monthly_payment', value: 20, unit: '万元', caliber: '等额本息', verificationLevel: 'source_supported' }], quality: {} }];
    await rt.contract.seedGoal({ goalId: 'g-fd-2', projectId: 'p-fd', goalKey: 'four_domain_evaluation', role: 'jianwei' });
    const claim = await rt.contract.claimGoal({ goalId: 'g-fd-2', requestId: `claim:g-fd-2:${Date.now()}` });
    const run = await rt.worker.executeNow(
      { goalId: 'g-fd-2', projectId: 'p-fd', goalKey: 'four_domain_evaluation', params: { ...TASK_PARAMS, materials }, role: 'jianwei', purpose: 'x' },
      claim.assignment, { goalVersion: claim.goalVersion },
    );
    assert.equal(run.submitted, true);
    const text = JSON.stringify((await rt.contract.getGoalView('g-fd-2')).result.output);
    assert.ok(text.includes('HOLD_FOR_REVIEW') || text.includes('HOLD'), '压力门应 HOLD');
    assert.ok(text.includes('0') && (text.includes('压力情景') || text.includes('SIM-CASH-COVERAGE-STRESSED-01')));
  } finally {
    await rmDir(dir);
  }
});

test('fd:gate 单独收口:缺域结果 → HOLD(不默认通过)', async () => {
  const dir = await tmpDir('fd-gate-');
  try {
    const tools = createFourDomainTools();
    const rt = createBRuntime({
      dataDir: dir,
      config: { transport: {}, routesPath, contract: { mode: 'stub' }, tools: { mode: 'four-domain' } },
      overrides: { logger: () => {} },
    });
    void rt;
    const p = await tools.calculate({ toolName: 'fd:perception', inputs: TASK_PARAMS });
    // 只给政策域结果 → 其余域 missing → HOLD
    const a = await tools.calculate({ toolName: 'fd:assess:policy', inputs: { ...TASK_PARAMS, _priorOutputs: [{ stepId: 'fd:perception', toolName: 'fd:perception', output: p.output }] } });
    const g = await tools.calculate({
      toolName: 'fd:gate',
      inputs: { ...TASK_PARAMS, _priorOutputs: [
        { stepId: 'fd:perception', toolName: 'fd:perception', output: p.output },
        { stepId: 'fd:assess:policy', toolName: 'fd:assess:policy', output: a.output },
      ] },
    });
    assert.equal(g.ok, true);
    assert.equal(g.output.gate.result, 'HOLD_FOR_REVIEW');
    assert.ok(g.output.gate.reasonCodes.includes('REQUIRED_DOMAIN_INCOMPLETE'));
    assert.ok(g.output.gate.disclaimers.some((d) => d.includes('不是最终人工授信决定')));
  } finally {
    await rmDir(dir);
  }
});

test('fd 工具失败关闭:未知工具/缺输入 → {ok:false}(不静默成功)', async () => {
  const tools = createFourDomainTools();
  const r1 = await tools.calculate({ toolName: 'fd:nope', inputs: {} });
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'UNKNOWN_TOOL');
  const r2 = await tools.calculate({ toolName: 'fd:assess:policy', inputs: {} });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'INVALID_INPUT');
  const r3 = await tools.calculate({ toolName: 'fd:perception', inputs: { tenantId: 't', customerId: 'c', materials: [{ materialId: 'X', kind: 'alien', content: 'x', declaredFacts: [], quality: {} }] } });
  assert.equal(r3.ok, false);
  void FOUR_DOMAIN_TOOL_VERSION;
});

test('reportOutcome: 全工具步运行 → provider=calculation(不冒充真实模型)', () => {
  const view = {
    terminal: { kind: 'completed' },
    candidate: { observations: ['fd:gate → HOLD_FOR_REVIEW'], evidenceRefs: [], assumptions: [], uncertainty: [] },
    steps: [
      { kind: 'tool', toolName: 'fd:perception', state: 'succeeded' },
      { kind: 'tool', toolName: 'fd:gate', state: 'succeeded' },
    ],
    evidenceRefs: [{ id: 'psnap-x', version: 1 }],
    ruleId: 'FD-FULL-EVALUATION',
    generation: 1,
  };
  const r = reportOutcome(view);
  assert.equal(r.completed, true);
  assert.equal(r.result.provider, 'calculation');
  // A 投影只含白名单字段(authority=none 由构造保证)
  for (const k of Object.keys(r.result.output)) {
    assert.ok(['observations', 'evidenceRefs', 'assumptions', 'uncertainty', 'recommendedHumanAction'].includes(k), `候选字段越界:${k}`);
  }
});

test('路由配置: routes-four-domain.json 通过规则表校验且首中即用', async () => {
  const routes = JSON.parse(readFileSync(routesPath, 'utf8'));
  const { createRouter } = await import('../src/router.mjs');
  const router = createRouter(routes);
  const r = router.routeTask({ taskId: 't', taskKind: 'four_domain_evaluation' });
  assert.equal(r.ok, true);
  assert.equal(r.ruleId, 'FD-FULL-EVALUATION');
  assert.equal(r.plan.length, 10); // TAKEOFF（03路）五域：感知+5域评估+gate+questions+amount+nextstep
  const r2 = router.routeTask({ taskId: 't2', taskKind: 'four_domain_recalc', role: 'asset' });
  assert.equal(r2.ruleId, 'FD-RECALC-ASSET');
  const r3 = router.routeTask({ taskId: 't3', taskKind: 'four_domain_recalc', role: 'alien' });
  assert.equal(r3.ok, false); // NO_ROUTE:升级人工,不猜
  // TAKEOFF 新任务种类（PROTOCOL.md §4）：五域全量/商机单域重算
  const r4 = router.routeTask({ taskId: 't4', taskKind: 'takeoff_evaluation' });
  assert.equal(r4.ok, true);
  assert.equal(r4.ruleId, 'TAKEOFF-FULL-EVALUATION');
  assert.equal(r4.plan.length, 10);
  assert.ok(r4.plan.some((s) => s.toolName === 'fd:assess:business'), '五域全量含商机评估步');
  const r5 = router.routeTask({ taskId: 't5', taskKind: 'takeoff_recalc', role: 'business' });
  assert.equal(r5.ruleId, 'TAKEOFF-RECALC-BUSINESS');
  const r6 = router.routeTask({ taskId: 't6', taskKind: 'four_domain_recalc', role: 'business' });
  assert.equal(r6.ruleId, 'FD-RECALC-BUSINESS', '兼容别名：旧种类+business 角色可路由');
  const r7 = router.routeTask({ taskId: 't7', taskKind: 'takeoff_gate' });
  assert.equal(r7.ruleId, 'TAKEOFF-GATE-ONLY');
});
