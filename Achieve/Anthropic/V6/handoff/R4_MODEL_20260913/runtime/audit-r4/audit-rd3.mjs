// D3:区分 pre-gate 与 post-await 复核。
// 有状态 probe:第 1 次调用(pre-gate)返回 live/v7;第 2 次调用(post-await)返回 paused/v7。
// 期望:候选真实被调用 → 成功结果在返回前被 post-await 复核降级 rejected,
//       downgrade 文字含 'post-await'(证明交付 18 R-d(2) 注释所称机制可真实触发)。
import assert from 'node:assert/strict';
import { writeStoreFile, sessionRecord, evidenceRecord, annotationRecord, baseRequest, loadBridge, useStoreDir } from './helpers.mjs';

const { file } = useStoreDir('rd-d3');
writeStoreFile(file, { version: 7, sessions: [sessionRecord()], evidence: [evidenceRecord()], annotations: [annotationRecord()] });

const createBridgedModelAdapter = await loadBridge();
const bridge = createBridgedModelAdapter({
  transport: async (call) => ({
    ok: true,
    output: {
      findings: [{ id: 'F1', text: '审计复演 D3:立即成功,随后被 post 复核降级。', evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })) }],
      questions: [],
      evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })),
    },
    usage: { totalTokens: 1 },
  }),
  timeoutMs: 5000,
});

let probeCalls = 0;
const r = await bridge.generateFollowUps(
  baseRequest({ domainRoles: ['credit'] }),
  () => {
    probeCalls += 1;
    return probeCalls === 1
      ? { sessionStatus: 'live', currentEvidenceVersion: 1 } // pre-gate:放行(证据版本一致)
      : { sessionStatus: 'paused', currentEvidenceVersion: 1 }; // post-await:抓暂停
  },
);

console.log('== D3 有状态 probe:post-await 复核 ==');
console.log('probeCalls    =', probeCalls);
console.log('status        =', r.status);
console.log('failureReason =', r.failureReason);
console.log('downgrade     =', r.candidate?.downgrade);
assert.equal(probeCalls, 2, 'probe 应被调用两次(pre-gate + post-await)');
assert.equal(r.status, 'rejected', 'post-await 复核必须降级 rejected');
assert.ok(/post-await/i.test(r.candidate?.downgrade ?? ''), '降级留痕必须标注 post-await 复核');
assert.ok(/session paused/.test(r.failureReason ?? ''), '降级原因指明暂停');
console.log('RESULT D3: post-await 复核分支(bridge.ts:440-455)真实有效,可被双态 probe 触发');
