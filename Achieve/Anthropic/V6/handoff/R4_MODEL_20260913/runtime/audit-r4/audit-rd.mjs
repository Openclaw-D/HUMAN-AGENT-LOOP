// 独立对照 R-d:暂停轴两分支。
//   D1 不传 probe:在途期间会话 paused(status 翻转,generation 不变,version 推进)→ 期望 rejected
//   D2 传 probe:transport 立即成功,probe 返回 paused → 期望 rejected + 'session paused' + downgrade 留痕
import assert from 'node:assert/strict';
import { writeStoreFile, sessionRecord, evidenceRecord, annotationRecord, baseRequest, loadBridge, useStoreDir, deferred } from './helpers.mjs';

const createBridgedModelAdapter = await loadBridge();

// D1:paused-only + version 推进(无 probe)
{
  const { file } = useStoreDir('rd-d1');
  writeStoreFile(file, { version: 7, sessions: [sessionRecord()], evidence: [evidenceRecord()], annotations: [annotationRecord()] });
  const slow = deferred();
  const bridge = createBridgedModelAdapter({
    transport: async (call) => slow.promise.then(() => ({
      ok: true,
      output: {
        findings: [{ id: 'F1', text: '审计复演 D1:暂停前生成。', evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })) }],
        questions: [],
        evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })),
      },
      usage: { totalTokens: 1 },
    })),
    timeoutMs: 5000,
  });
  const p = bridge.generateFollowUps(baseRequest({ domainRoles: ['credit'] }));
  const store = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
  writeStoreFile(file, {
    version: 8,
    sessions: [sessionRecord({ status: 'paused' })], // 仅翻状态,generation 不变;version +1
    evidence: store.evidence,
    annotations: store.annotations,
  });
  slow.resolve(true);
  const r = await p;
  console.log('== D1 不传 probe:paused-only + version推进 ==');
  console.log('status        =', r.status);
  console.log('failureReason =', r.failureReason);
  assert.equal(r.status, 'rejected', 'D1:暂停必须被内部快照兜住(降级 rejected),不得放行');
  console.log('RESULT D1: 未逃逸——contextVersion 兜底捕获 paused-only 变化');
}

// D2:传 probe,post 复核降级
{
  const { file } = useStoreDir('rd-d2');
  writeStoreFile(file, { version: 7, sessions: [sessionRecord()], evidence: [evidenceRecord()], annotations: [annotationRecord()] });
  const bridge = createBridgedModelAdapter({
    transport: async (call) => ({
      ok: true,
      output: {
        findings: [{ id: 'F1', text: '审计复演 D2:立即成功。', evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })) }],
        questions: [],
        evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })),
      },
      usage: { totalTokens: 1 },
    }),
    timeoutMs: 5000,
  });
  const r = await bridge.generateFollowUps(
    baseRequest({ domainRoles: ['credit'] }),
    () => ({ sessionStatus: 'paused', currentEvidenceVersion: 1 }),
  );
  console.log('== D2 传 probe:post 复核 ==');
  console.log('status          =', r.status);
  console.log('failureReason   =', r.failureReason);
  console.log('downgrade       =', r.candidate?.downgrade);
  assert.equal(r.status, 'rejected', 'D2:probe post 复核必须把成功降级 rejected');
  assert.ok(/session paused/.test(r.failureReason ?? ''), 'D2:降级原因须指明暂停');
  assert.ok(typeof r.candidate?.downgrade === 'string' && r.candidate.downgrade.length > 0, 'D2:降级必须留痕');
  console.log('RESULT D2: probe 机制有效降级并留痕');
}

console.log('AUDIT RD DONE');
