import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';

const originalModelKey = process.env.JIANWEI_MODEL_API_KEY;
const originalModelName = process.env.JIANWEI_MODEL_NAME;
before(() => {
  delete process.env.JIANWEI_MODEL_API_KEY;
  delete process.env.JIANWEI_MODEL_NAME;
});
after(() => {
  if (originalModelKey === undefined) delete process.env.JIANWEI_MODEL_API_KEY;
  else process.env.JIANWEI_MODEL_API_KEY = originalModelKey;
  if (originalModelName === undefined) delete process.env.JIANWEI_MODEL_NAME;
  else process.env.JIANWEI_MODEL_NAME = originalModelName;
});

const root = new URL('../', import.meta.url);
const expectedFlows = {
  policy: ['材料解析', '规则核验', '量化评估', '智能预审', '智能更新'],
  credit: ['模型解析', '事实核验', '证据回链', '协调沟通', '人工复核'],
  commerce: ['合同审批', '物流查验', '资金匹配', '付款核验', '最终付款'],
  asset: ['起租建档', '租金监测', '风险预警', '催收处置', '诉讼退出'],
};

test('projection exposes shared context, strict preparation order and separate authority', async () => {
  const { getProjection, resetSyntheticRuntime } = await import('../lib/domain.ts');
  resetSyntheticRuntime();
  const projection = getProjection('FL-DEMO-001');
  assert.deepEqual(projection.stages.map((stage) => stage.label), ['政策', '信审', '商务', '资产']);
  assert.deepEqual(projection.stages.map((stage) => stage.prepProgressPercent), [20, 40, 60, 80]);
  assert.deepEqual(projection.stages.map((stage) => stage.completedStepCount), [1, 2, 3, 4]);
  assert.deepEqual(projection.stages.map((stage) => stage.authorityState), ['ready_for_gate', 'ready_for_gate', 'waiting_dependency', 'waiting_dependency']);
  assert.equal(projection.sharedContext.contextVersion, 'CTX-0001');
  assert.equal(projection.sharedContext.consumerCount, 4);
  assert.deepEqual(new Set(projection.stageRuns.map((run) => run.contextVersion)), new Set(['CTX-0001']));
  for (const stage of projection.stages) {
    assert.deepEqual(stage.flows.map((flow) => flow.label), expectedFlows[stage.id]);
    const states = stage.flows.map((flow) => flow.prepState);
    assert.deepEqual(states, [
      ...Array(stage.completedStepCount).fill('completed'),
      ...(stage.completedStepCount < 5 ? ['active'] : []),
      ...Array(Math.max(0, 4 - stage.completedStepCount)).fill('locked'),
    ]);
    assert.ok(stage.flows.every((flow) => flow.workspace.id === flow.id));
    assert.equal(stage.contextVersion, projection.sharedContext.contextVersion);
  }
  assert.equal(projection.globalGraph.nodes.length, 21);
  assert.equal(projection.globalGraph.clusters.length, 4);
  assert.equal(projection.globalGraph.nodes.filter((node) => node.kind === 'flow').length, 20);
  assert.equal(projection.authority.model, 'none');
  assert.deepEqual(projection.modelRuntime, { mode: 'local_candidate', label: '本地候选推理', liveVerified: false });
  assert.throws(() => getProjection('OTHER'), { code: 'CASE_NOT_FOUND' });
});

test('server Context Packet includes shared version and rejects mixed stage-flow content', async () => {
  const { buildContextPacket, resetSyntheticRuntime } = await import('../lib/domain.ts');
  resetSyntheticRuntime();
  const packet = buildContextPacket('FL-DEMO-001', 'commerce', 'commerce-logistics');
  assert.equal(packet.contextVersion, 'CTX-0001');
  assert.equal(packet.evidenceEventId, 'evidence-event-bootstrap');
  assert.equal(packet.stageLabel, '商务');
  assert.equal(packet.flowLabel, '物流查验');
  assert.match(packet.automatedWork[0], /物流|候选/);
  assert.doesNotMatch(JSON.stringify(packet), /车间主照|信审现场材料/);
  assert.throws(() => buildContextPacket('FL-DEMO-001', 'policy', 'credit-review'), { code: 'INVALID_FLOW' });
});

test('server Context Packet arrays are isolated from caller mutation', async () => {
  const { buildContextPacket, resetSyntheticRuntime } = await import('../lib/domain.ts');
  resetSyntheticRuntime();
  const first = buildContextPacket('FL-DEMO-001', 'commerce', 'commerce-logistics');
  first.evidenceGaps.push('WAVE2-POLLUTION');
  first.automatedWork.push('WAVE2-POLLUTION');
  const second = buildContextPacket('FL-DEMO-001', 'commerce', 'commerce-logistics');
  assert.doesNotMatch(JSON.stringify(second), /WAVE2-POLLUTION/);
});

test('chat is contextual, idempotent, concurrent and fail closed', async () => {
  const { handleCandidateMessage, resetSyntheticRuntime } = await import('../lib/domain.ts');
  resetSyntheticRuntime();
  const input = { caseId: 'FL-DEMO-001', stageId: 'asset', flowId: 'asset-rent', message: '请说明当前证据缺口', requestId: 'req-1' };
  const first = await handleCandidateMessage(input);
  assert.deepEqual(await handleCandidateMessage(input), first);
  assert.equal(first.contextPacket.contextVersion, 'CTX-0001');
  assert.equal(first.modelRuntime.mode, 'local_candidate');
  assert.match(first.modelRuntime.label, /本地候选推理/);
  const x8 = await Promise.all(Array.from({ length: 8 }, () => handleCandidateMessage({ ...input, requestId: 'req-x8' })));
  assert.ok(x8.every((value) => JSON.stringify(value) === JSON.stringify(x8[0])));
  x8[0].contextPacket.automatedWork.push('污染');
  assert.doesNotMatch(JSON.stringify(await handleCandidateMessage({ ...input, requestId: 'req-x8' })), /污染/);
  await assert.rejects(handleCandidateMessage({ ...input, message: '不同内容' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(handleCandidateMessage({ ...input, requestId: 'empty', message: ' ' }), { code: 'EMPTY_MESSAGE' });
  await assert.rejects(handleCandidateMessage({ ...input, requestId: 'mixed', stageId: 'policy' }), { code: 'INVALID_FLOW' });
  await assert.rejects(handleCandidateMessage({ ...input, requestId: 'error', message: '[error]' }), { code: 'ADAPTER_FAILURE' });
  await assert.rejects(handleCandidateMessage({ ...input, requestId: 'timeout', message: '[timeout]' }), { code: 'ADAPTER_TIMEOUT' });
});

test('formal facts require named confirmation and projection reads server state', async () => {
  const { confirmCandidateFact, getProjection, resetSyntheticRuntime, simulateEvidenceLoop } = await import('../lib/domain.ts');
  resetSyntheticRuntime();
  const before = getProjection('FL-DEMO-001');
  const factId = before.materials[0].facts[0].id;
  assert.equal(before.materials[0].facts[0].status, 'candidate');
  assert.equal(simulateEvidenceLoop({ confirm: false }).receipt.status, 'unknown');
  await assert.rejects(confirmCandidateFact({ caseId: 'FL-DEMO-001', factId, actor: ' ', requestId: 'bad' }), { code: 'INVALID_ACTOR' });
  const versionBefore = before.sharedContext.contextVersion;
  assert.equal((await confirmCandidateFact({ caseId: 'FL-DEMO-001', factId, actor: '业务人员·林澈', requestId: 'confirm-1' })).status, 'confirmed');
  const confirmed = getProjection('FL-DEMO-001');
  assert.equal(confirmed.materials[0].facts[0].confirmedBy, '业务人员·林澈');
  assert.notEqual(confirmed.sharedContext.contextVersion, versionBefore);
  assert.ok(confirmed.stageRuns.every((run) => run.contextVersion === confirmed.sharedContext.contextVersion));
  await confirmCandidateFact({ caseId: 'FL-DEMO-001', factId, actor: '业务人员·林澈', requestId: 'confirm-1' });
  await confirmCandidateFact({ caseId: 'FL-DEMO-001', factId, actor: '业务人员·林澈', requestId: 'confirm-2' });
  assert.equal(getProjection('FL-DEMO-001').sharedContext.contextVersion, confirmed.sharedContext.contextVersion);
});

test('UI source implements exact grid, six progress tones, graph interaction and receipt isolation', async () => {
  const [page, css, graph, evidenceRoute] = await Promise.all([
    readFile(new URL('app/workbench.tsx', root), 'utf8'),
    readFile(new URL('app/globals.css', root), 'utf8'),
    readFile(new URL('app/global-graph-canvas.tsx', root), 'utf8'),
    readFile(new URL('app/api/cases/[caseId]/evidence/route.ts', root), 'utf8'),
  ]);
  for (const text of ['关系图谱', '业务矩阵', '否决', '提交', '具名 Human Gate', '受控 Context Packet', '共享 Context Version', '接入共享信息']) assert.match(page, new RegExp(text));
  assert.match(page, /currentStage\.id === 'credit'/);
  assert.match(page, /receipt && receipt\.stageId === currentStage\?\.id && receipt\.flowId === currentFlow\?\.id \? receipt : null/);
  assert.match(page, /currentReceipt \? <section className="receipt-card"/);
  assert.match(page, /const PROGRESS_TONES.*0: '#ffffff'.*20: '#eeeeee'.*40: '#d4d4d4'.*60: '#a9a9a9'.*80: '#686868'.*100: '#000000'/s);
  assert.doesNotMatch(page, /ZAI_API_KEY|模型已完成正式|生产数据库/);
  assert.match(css, /grid-template-columns:\s*104px\s+minmax\(0,\s*1fr\)\s+10px\s+var\(--continuation-width\)/);
  assert.match(css, /\.view-switch\s*\{\s*height:\s*48px/);
  assert.match(css, /font-size:\s*15px/);
  assert.match(css, /overflow:\s*hidden/);
  for (const token of ['onWheel', "type: 'pan'", "type: 'node'", 'graph-fit', 'graph-focus', 'localStorage', 'graph.edges.map']) assert.match(graph, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(evidenceRoute, /acceptCanonicalEvidence/);
  assert.match(evidenceRoute, /IDEMPOTENCY_CONFLICT/);
});
