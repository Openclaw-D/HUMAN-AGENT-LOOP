// V6 R3-A-INT · R2_MODEL 冻结候选 ↔ 产品桥接回归（真实调用候选 adapter，隔离数据，无网络/无密钥）。
// 覆盖：simulated 通道真实调用、generation +1 转换、contextVersion=同一次权威 store 读取的 remoteVersion、
//       stale/cancelled/unknown/failed 状态映射、probe 预判与迟到改判、dissent 经 aggregateResults 保留、
//       产品既有 createModelProviderAdapter（fixed_stub）行为不变（桥接为可选项）。
// 运行：node --experimental-strip-types --test test/v5-preview-model-bridge.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'model-bridge-data-'));

const svc = await import('../lib/v5-preview/remote-service.ts');
const { createManualClock } = await import('../lib/v5-preview/model-adapter/clock.mjs');

let serial = 0;
const write = (fn, body) => fn({ requestId: `mb-${++serial}`, expectedVersion: svc.getRemoteState().remoteVersion, ...body });

function setupSession({ fixtureId = 'fixture-inspection', question = 'MB 默认问题（合成）' } = {}) {
  const created = write(svc.createRemoteSession, { title: 'MB 桥接（合成）' });
  const sessionId = created.session.sessionId;
  const ev = write(svc.attachEvidence, { sessionId, fixtureId });
  const ann = write(svc.createAnnotation, {
    sessionId, evidenceId: ev.evidence.evidenceId, evidenceVersion: 1, question, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  });
  return { sessionId, evidence: ev.evidence, annotationId: ann.annotation.annotationId };
}

const reqOf = (s, overrides = {}) => ({
  sessionId: s.sessionId,
  annotationId: s.annotationId,
  evidenceRef: { fixtureId: s.evidence.fixtureId, sha256: s.evidence.sha256, version: 1 },
  domainRoles: ['credit'],
  purpose: 'follow_up_generation',
  ...overrides,
});

// ---------------------------------------------------------------------------
// 隔离（本套件首个测试内设置 env；isolation=none 共享进程下避免跨套件互踩）
// ---------------------------------------------------------------------------

test('MB0：隔离数据目录（本套件首个测试内设置 env；isolation=none 共享进程下避免跨套件互踩）', () => {
  process.env.V5_PREVIEW_DATA_DIR = dataDir;
  assert.ok(dataDir.length > 0);
});

// ---------------------------------------------------------------------------

test('MB1：产品既有 createModelProviderAdapter 行为不变（无候选注入 → fixed_stub；桥接是可选项）', async () => {
  const plain = svc.createModelProviderAdapter({});
  assert.equal(plain.providerKind, 'fixed_stub');
  assert.equal(plain.state(), 'ready');
  const ok = await plain.generateFollowUps({
    sessionId: 's-x', annotationId: 'an-x',
    evidenceRef: { fixtureId: 'fixture-inspection', sha256: 'x', version: 1 },
    domainRoles: ['credit'], purpose: 'follow_up_generation',
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.replies[0].kind, 'model_simulation', 'fixed stub 输出仍显式模拟标注');
  // 桥接入口已从服务面暴露，但不改变默认工厂行为
  assert.equal(typeof svc.createBridgedModelAdapter, 'function');
});

test('MB2：simulated 通道真实调用候选 adapter——SIMULATION 声明显著、候选七状态/契约版本透出、重复调用命中候选缓存复核', async () => {
  const s = setupSession();
  const adapter = svc.createBridgedModelAdapter();
  assert.equal(adapter.providerKind, 'simulation');
  assert.equal(adapter.state(), 'ready');

  const first = await adapter.generateFollowUps(reqOf(s, { requestId: 'mb2-first' }));
  assert.equal(first.status, 'ok');
  assert.equal(first.providerKind, 'simulation');
  // 候选真实执行（不是转发 stub）：候选契约版本、七状态、派生 requestId、SIMULATION notice 全部透出
  assert.equal(first.candidate.status, 'simulated');
  assert.equal(first.candidate.contractVersion, 'v1');
  assert.ok(first.candidate.requestIds[0].startsWith('brid-'), '候选侧 requestId 由桥接派生');
  assert.ok(first.notice.includes('SIMULATED'), '结果自带中文 SIMULATION 声明');
  assert.ok(first.replies.length >= 2, '首条为声明，其后为内容');
  assert.equal(first.replies[0].author, '模型通道声明（SIMULATED · 显著标记）');
  assert.ok(first.replies[0].text.includes('SIMULATED'), '声明不可隐藏（in-band 首条 reply）');
  for (const r of first.replies) {
    assert.equal(r.kind, 'model_simulation');
    assert.ok(['coordinator', 'business', 'policy', 'credit', 'commerce', 'asset'].includes(r.domainRole));
  }
  // 证据映射用 evidenceId（非 fixtureId）：模拟输出文本携带 evidenceId 与版本
  assert.ok(first.replies.some((r) => r.text.includes(s.evidence.evidenceId)), `回复引用 evidenceId=${s.evidence.evidenceId}`);
  assert.ok(first.replies.some((r) => r.text.includes('(版本 1)')), '引用版本来自三元组映射');
  // 同上下文重放 → 候选缓存命中且复核后仍有效（deduped:true）
  const second = await adapter.generateFollowUps(reqOf(s, { requestId: 'mb2-first' }));
  assert.equal(second.status, 'ok');
  assert.equal(second.candidate.status, 'simulated');
  assert.equal(second.candidate.deduped, true, '同身份同上下文重放命中候选缓存（复核后返回）');
  assert.deepEqual(second.replies, first.replies, '重放输出稳定');
});

test('MB3a：generation +1 转换（产品 gen=0 → 候选 gen=1；请求与快照一致）', async () => {
  const s = setupSession();
  const adapter = svc.createBridgedModelAdapter();
  const productGen = svc.getRemoteSessionDetail(s.sessionId).session.generation;
  assert.equal(productGen, 0, '产品会话 generation 0 基（产品语义，C 回放契约非负整数）；候选侧 +1 转换');
  const result = await adapter.generateFollowUps(reqOf(s));
  assert.equal(result.status, 'ok');
  assert.equal(result.candidate.generation, productGen + 1, '候选代次 = 产品代次 + 1');
});

test('MB3b：暂停→显式恢复推进代次后，+1 转换保持一致、重试是新调用身份（无 REQUEST_MISMATCH）', async () => {
  const s = setupSession();
  const adapter = svc.createBridgedModelAdapter();
  const first = await adapter.generateFollowUps(reqOf(s));
  assert.equal(first.status, 'ok');
  // pause_round：gen 0→1；resume_round：gen 1→2（显式人工留痕恢复）
  write(svc.createReview, { sessionId: s.sessionId, targetType: 'evidence', targetId: s.evidence.evidenceId, targetVersion: 1, action: 'pause_round', opinion: 'MB3b 暂停（合成）' });
  write(svc.createReview, { sessionId: s.sessionId, targetType: 'evidence', targetId: s.evidence.evidenceId, targetVersion: 1, action: 'resume_round', opinion: 'MB3b 恢复（合成）' });
  const productGen = svc.getRemoteSessionDetail(s.sessionId).session.generation;
  assert.equal(productGen, 2);
  const second = await adapter.generateFollowUps(reqOf(s));
  assert.equal(second.status, 'ok', '代次/版本推进后的重试是完整新调用，不落入 REQUEST_MISMATCH');
  assert.equal(second.candidate.status, 'simulated');
  assert.equal(second.candidate.generation, productGen + 1, '候选代次跟随产品推进（+1 转换一致）');
  assert.equal(second.candidate.deduped, false, '新调用身份不误命中旧缓存');
});

test('MB4：contextVersion = 调用时同一次权威 store 读取的 remoteVersion', async () => {
  const s = setupSession();
  const adapter = svc.createBridgedModelAdapter();
  const versionAtCall = svc.getRemoteState().remoteVersion;
  const result = await adapter.generateFollowUps(reqOf(s));
  assert.equal(result.status, 'ok');
  assert.equal(result.candidate.contextVersion, versionAtCall, '候选 contextVersion 即 store remoteVersion');
});

test('MB5：stale 映射——调用中途 store 推进 → 候选 stale → 产品 rejected，findings 保留供人工比对', async () => {
  const s = setupSession();
  let driftSeq = 0;
  const adapter = svc.createBridgedModelAdapter({
    transport: async (call) => {
      // 模拟"外部调用期间证据/资料推进"：store 版本前进 → 候选返回时复核判定 stale
      write(svc.attachEvidence, { sessionId: call.payload.sessionId, fixtureId: 'fixture-contract', requestId: `mb5-drift-${++driftSeq}` });
      const refs = call.payload.evidenceRefs.map((r) => ({ ...r }));
      return {
        ok: true, simulated: true, simulatedMode: 'simulated',
        output: { findings: [{ id: 'SF1', text: `【模拟】${refs[0].id} 观察点（合成）`, evidenceRefs: refs }], questions: [], evidenceRefs: refs },
        usage: { totalTokens: 0 },
      };
    },
  });
  const result = await adapter.generateFollowUps(reqOf(s));
  assert.equal(result.status, 'rejected', '过期结果不得当现行（结构化拒绝）');
  assert.equal(result.replies.length, 0, 'rejected 不携带冒充成功回复');
  assert.equal(result.candidate.status, 'stale');
  assert.equal(result.candidate.errorCode, 'CONTEXT_VERSION_CHANGED');
  assert.ok(result.candidate.errorMessage.includes('过期'), '候选中文 message 透出');
  assert.ok(Array.isArray(result.candidate.preservedFindings) && result.candidate.preservedFindings.length === 1, 'stale 结果保留 findings 供人工比对');
  assert.equal(result.productAction.uiAction, 'show_stale_for_review');
  assert.equal(result.productAction.allowRetry, true);
  assert.equal(result.productAction.mustHumanVerify, true);
});

test('MB6：cancelled 映射——会话暂停中发起 → 候选取消（确定未送达）→ 产品 rejected', async () => {
  const s = setupSession();
  write(svc.createReview, { sessionId: s.sessionId, targetType: 'evidence', targetId: s.evidence.evidenceId, targetVersion: 1, action: 'pause_round', opinion: 'MB6 暂停（合成）' });
  const adapter = svc.createBridgedModelAdapter();
  const result = await adapter.generateFollowUps(reqOf(s));
  assert.equal(result.status, 'rejected');
  assert.equal(result.candidate.status, 'cancelled');
  assert.equal(result.candidate.errorCode, 'SESSION_PAUSED');
  assert.ok(result.failureReason.includes('暂停'), '候选中文 message 透出（恢复须显式人工动作）');
  assert.equal(result.productAction.uiAction, 'show_cancelled');
});

test('MB7：unknown 映射——送出后超时 → 候选 unknown → 产品 failed + 强制人工核实、禁止自动重试', async () => {
  const s = setupSession();
  const clock = createManualClock();
  const adapter = svc.createBridgedModelAdapter({
    transport: () => new Promise(() => {}), // 永不返回：外部调用状态不可知
    clock,
    timeoutMs: 50,
  });
  const pending = adapter.generateFollowUps(reqOf(s));
  clock.advance(51);
  const result = await pending;
  assert.equal(result.status, 'failed');
  assert.equal(result.replies.length, 0, '结果不可知绝不生成冒充回复');
  assert.equal(result.candidate.status, 'unknown');
  assert.equal(result.candidate.errorCode, 'TIMEOUT');
  assert.ok(result.failureReason.includes('结果未知'), 'unknown 语义显式（外部调用可能已发生）');
  assert.equal(result.productAction.uiAction, 'human_verify_before_retry');
  assert.equal(result.productAction.mustHumanVerify, true, '须人工核实');
  assert.equal(result.productAction.allowRetry, false, '禁止自动重试（保守侧编码）');
});

test('MB8：failed 映射——未登记用途被候选 PURPOSE_NOT_ALLOWED 失败关闭（中文 message 透出）', async () => {
  const s = setupSession();
  const adapter = svc.createBridgedModelAdapter();
  const result = await adapter.generateFollowUps(reqOf(s, { purpose: 'made_up_purpose' }));
  assert.equal(result.status, 'failed');
  assert.equal(result.candidate.status, 'failed');
  assert.equal(result.candidate.errorCode, 'PURPOSE_NOT_ALLOWED');
  assert.ok(result.failureReason.includes('不允许用途'), '候选中文校验 message 透出');
  assert.equal(result.productAction.allowRetry, true);
});

test('MB9：dissent 经候选 aggregateResults 全量保留、冲突只列待人决定（不裁决）', async () => {
  const s = setupSession();
  const outputFor = (refs) => ({
    findings: [{ id: 'SF1', text: '原意见：按现有证据口径记录观察（合成）', evidenceRefs: refs }],
    questions: [{ id: 'SQ1', text: '追问：请补充书面凭证编号（合成）', evidenceRefs: refs }],
    dissent: [{ id: 'DS1', position: 'dissenting', text: '不同结论（合成）：该证据不足以支持上述观察', evidenceRefs: refs, conflictsWith: ['SF1'] }],
    evidenceRefs: refs,
  });
  const adapter = svc.createBridgedModelAdapter({
    transport: async (call) => ({
      ok: true, simulated: true, simulatedMode: 'simulated',
      output: outputFor(call.payload.evidenceRefs.map((r) => ({ ...r }))),
      usage: { totalTokens: 0 },
    }),
  });
  const result = await adapter.generateFollowUps(reqOf(s, { domainRoles: ['credit', 'policy'] }));
  assert.equal(result.status, 'ok');
  assert.equal(result.candidate.status, 'simulated');
  assert.equal(result.candidate.perRole.length, 2);
  assert.equal(result.candidate.dissent.length, 2, '聚合层绝不抹异议：两个角色各一条全量保留');
  for (const d of result.candidate.dissent) {
    assert.equal(d.position, 'dissenting');
    assert.ok(d.text.includes('不同结论'));
    assert.ok(typeof d.sourceRequestId === 'string' && d.sourceRequestId.startsWith('brid-'), '异议可回溯来源请求');
  }
  assert.equal(result.candidate.pendingDecisions.length, 2, '冲突进入待人决定列表');
  for (const pd of result.candidate.pendingDecisions) {
    assert.ok(pd.sides.includes('SF1'), '待定条目列出冲突双方 id');
    assert.equal(pd.decision, undefined, '绝不裁决：无任何决定性字段');
  }
});

test('MB10：probe 预判——证据版本过期直接结构化拒绝，不调用候选（transport 0 次调用）', async () => {
  const s = setupSession();
  let transportCalls = 0;
  const adapter = svc.createBridgedModelAdapter({
    transport: async (call) => { transportCalls += 1; return { ok: true, simulated: true, output: { findings: [{ id: 'SF1', text: 'x', evidenceRefs: call.payload.evidenceRefs }], questions: [], evidenceRefs: call.payload.evidenceRefs }, usage: { totalTokens: 0 } }; },
  });
  const result = await adapter.generateFollowUps(reqOf(s), () => ({ currentEvidenceVersion: 999 }));
  assert.equal(result.status, 'rejected');
  assert.match(result.failureReason, /evidence version expired/);
  assert.equal(result.candidate.status, 'state_gate', '候选未被调用（产品侧状态门语义）');
  assert.equal(result.candidate.downgrade.includes('未调用候选'), true);
  assert.equal(transportCalls, 0);
});

test('MB11：probe 迟到改判——await 期间会话暂停 → 候选成功结果改判 rejected，绝不把过期结果当成功', async () => {
  const s = setupSession();
  let paused = false;
  const adapter = svc.createBridgedModelAdapter();
  const pending = adapter.generateFollowUps(reqOf(s), () => (paused ? { sessionStatus: 'paused' } : null));
  paused = true; // 同步置位先于任何微任务完成：等待期间的会话变化
  const result = await pending;
  assert.equal(result.status, 'rejected');
  assert.match(result.failureReason, /session paused/);
  assert.equal(result.candidate.status, 'simulated', '候选侧原状态保留在元数据');
  assert.ok(result.candidate.downgrade.includes('post-await'), '改判来源显式可审计');
});

test('MB12：未知证据引用 → rejected（与产品语义对齐）；部分角色失败 → partial', async () => {
  const s = setupSession();
  const adapter = svc.createBridgedModelAdapter();
  const badRef = await adapter.generateFollowUps(reqOf(s, { annotationId: 'an-none', evidenceRef: { fixtureId: 'nope', sha256: '', version: 0 } }));
  assert.equal(badRef.status, 'rejected');
  assert.match(badRef.failureReason, /unknown evidence reference/);

  const failingAdapter = svc.createBridgedModelAdapter({
    transport: async (call) => {
      if (call.role === 'policy') throw new Error('synthetic provider error');
      const refs = call.payload.evidenceRefs.map((r) => ({ ...r }));
      return { ok: true, simulated: true, simulatedMode: 'simulated', output: { findings: [{ id: 'SF1', text: `观察（合成）${refs[0].id}`, evidenceRefs: refs }], questions: [], evidenceRefs: refs }, usage: { totalTokens: 0 } };
    },
  });
  const partial = await failingAdapter.generateFollowUps(reqOf(s, { domainRoles: ['credit', 'policy'] }));
  assert.equal(partial.status, 'partial', '部分角色失败 → partial，不整体冒充成功');
  assert.ok(partial.failureReason.includes('部分角色结果未采纳'));
  assert.ok(partial.failureReason.includes('policy=failed'));
  assert.equal(partial.candidate.perRole.find((e) => e.role === 'policy').status, 'failed');
  assert.equal(partial.candidate.perRole.find((e) => e.role === 'credit').status, 'simulated');
  assert.ok(partial.replies.every((r) => r.domainRole === 'credit'), '失败角色不产出回复');
});
