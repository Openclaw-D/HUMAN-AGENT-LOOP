// V7-B adapter 桥单测:七状态映射/未发送-失败-未知三分/越权分类/白名单/A-C 边界转换。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bridgeAdapterResult, toWhitelistedCandidate, toACandidate, toCCandidate,
  buildModelRequest, toolOutcomeToCandidate,
} from '../src/adapter-bridge.mjs';
import { aggregateCandidates } from '../src/graph-def.mjs';

const base = { deduped: false, warnings: [] };

test('bridge: succeeded → 步 succeeded,候选白名单,findings→observations', () => {
  const r = bridgeAdapterResult({
    ...base, status: 'succeeded',
    findings: [{ id: 'f1', text: '观察一', evidenceRefs: [{ id: 'e1', version: '1', hash: 'h' }] }],
    questions: [{ id: 'q1', text: '问题?' }],
    evidenceRefs: [{ id: 'e1', version: '1', hash: 'h' }],
    costLedger: { reservationState: 'committed' },
  });
  assert.equal(r.state, 'succeeded');
  assert.equal(r.sentFlag, true);
  assert.deepEqual(r.candidate.observations, ['观察一']);
  assert.deepEqual(r.candidate.uncertainty, ['问题?']);
  assert.equal(r.candidate.recommendedHumanAction, 'return_for_evidence'); // 有未答问题
});

test('bridge: simulated 显式标记,不与真实混写', () => {
  const r = bridgeAdapterResult({
    ...base, status: 'simulated',
    findings: [{ id: 'f1', text: '模拟观察', evidenceRefs: [{ id: 'e1', version: '1', hash: 'h' }] }],
    questions: [], evidenceRefs: [], costLedger: { reservationState: 'committed' },
  });
  assert.equal(r.state, 'simulated');
  assert.equal(r.simulated, true);
});

test('bridge: not_configured → 确定未发送(sent=false)', () => {
  const r = bridgeAdapterResult({ ...base, status: 'not_configured' });
  assert.equal(r.state, 'not_configured');
  assert.equal(r.sentFlag, false);
});

test('bridge: cancelled(证明未送达) → sent=false;unknown → sent 不可判定', () => {
  const c = bridgeAdapterResult({ ...base, status: 'cancelled', costLedger: { reservationState: 'released' } });
  assert.equal(c.state, 'cancelled');
  assert.equal(c.sentFlag, false);
  const u = bridgeAdapterResult({ ...base, status: 'unknown', costLedger: { reservationState: 'unknown_hold' } });
  assert.equal(u.state, 'unknown');
  assert.equal(u.sentFlag, null);
});

test('bridge: failed 按错误分类——越权/结构违规 → human_violation;transport 错误 → failed', () => {
  const v = bridgeAdapterResult({ ...base, status: 'failed', error: { code: 'UNAUTHORIZED_OUTPUT', message: '越权' } });
  assert.equal(v.state, 'human_violation');
  const t = bridgeAdapterResult({ ...base, status: 'failed', error: { code: 'TRANSPORT_ERROR', message: '网络' }, costLedger: { reservationState: 'released' } });
  assert.equal(t.state, 'failed');
  assert.equal(t.sentFlag, false);
});

test('bridge: stale → 结果不得当现行(sent=true)', () => {
  const r = bridgeAdapterResult({ ...base, status: 'stale', costLedger: { reservationState: 'committed' } });
  assert.equal(r.state, 'stale');
  assert.equal(r.sentFlag, true);
  assert.equal(r.candidate, null);
});

test('bridge: 仅提问无观察 → waiting_evidence(补证等待)', () => {
  const r = bridgeAdapterResult({
    ...base, status: 'succeeded',
    findings: [], questions: [{ id: 'q1', text: '缺证据' }],
    costLedger: { reservationState: 'committed' },
  });
  assert.equal(r.state, 'waiting_evidence');
});

test('边界转换:toA 数组转字符串且 none 省略;toC 对象引用且 none 按 whenNone 投影', () => {
  const cand = {
    observations: ['观察'], evidenceRefs: [{ id: 'ev-1', version: 2, hash: 'h' }],
    assumptions: ['假设'], uncertainty: ['不确定'], recommendedHumanAction: 'none',
  };
  const a = toACandidate(cand);
  assert.deepEqual(a.evidenceRefs, ['ev-1@v2']);
  assert.equal(a.recommendedHumanAction, undefined); // A 枚举无 none → 省略
  assert.ok(!('recommendedHumanAction' in a));
  const c = toCCandidate(cand); // C v1.1.0 枚举无 none:缺省保守投影 need_more_evidence
  assert.deepEqual(c.evidenceRefs, [{ evidenceId: 'ev-1', version: 2 }]);
  assert.equal(c.recommendedHumanAction, 'need_more_evidence');
});

test('边界转换:return_for_evidence 在 A/C 两侧都保留', () => {
  const cand = { observations: [], evidenceRefs: [], assumptions: [], uncertainty: [], recommendedHumanAction: 'return_for_evidence' };
  assert.equal(toACandidate(cand).recommendedHumanAction, 'return_for_evidence');
  assert.equal(toCCandidate(cand).recommendedHumanAction, 'return_for_evidence');
});

test('buildModelRequest:确定性——同输入逐字节同载荷同指纹;version 数字转字符串', () => {
  const args = {
    runId: 'r1', stepId: 'model:credit:risk_review', attempt: 0, role: 'credit', purpose: 'risk_review',
    projectId: 'p1', eventType: 'new_application', eventLabel: '新申请', factVersion: '3',
    evidenceRefs: [{ id: 'e1', version: 2, hash: 'h' }], generation: 1,
  };
  const a = buildModelRequest(args);
  const b = buildModelRequest(args);
  assert.equal(a.payloadHash, b.payloadHash);
  assert.equal(a.request.evidenceRefs[0].version, '2'); // V6 adapter 边界要求字符串
  assert.equal(a.request.contextVersion, '3');
});

test('汇总:模拟来源整包标记;推荐动作取最高优先级', () => {
  const steps = [
    { id: 's1', role: 'credit', state: 'simulated', candidate: { observations: ['a'], evidenceRefs: [], assumptions: [], uncertainty: [], recommendedHumanAction: 'none' } },
    { id: 's2', role: 'policy', state: 'succeeded', candidate: { observations: ['b'], evidenceRefs: [], assumptions: [], uncertainty: [], recommendedHumanAction: 'return_for_evidence' } },
  ];
  const merged = aggregateCandidates(steps);
  assert.equal(merged.sourceMode, 'simulated');
  assert.equal(merged.authority, 'none');
  assert.equal(merged.recommendedHumanAction, 'return_for_evidence');
  assert.equal(merged.observations.length, 2);
});

test('工具候选:纯计算无风险结论,推荐动作 none', () => {
  const cand = toolOutcomeToCandidate({ ok: true, toolVersion: 't@1', inputHash: 'h', output: { ratio: 1.2 }, assumptions: ['假设'] }, 'tool:x');
  assert.equal(cand.recommendedHumanAction, 'none');
  assert.match(cand.observations[0], /1\.2/);
});
