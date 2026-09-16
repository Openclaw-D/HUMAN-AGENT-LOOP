// 独立复演 R-a(失败关闭验证)+ 打穿尝试:
//   A1 会话消失+version 推进 → 必须 rejected(不得 ok/partial 放行)
//   A2 打穿尝试①:会话消失但 version 不变(直接改文件,产品 API 不可达)→ 观察是否 ok
//   A3 打穿尝试②:在途期间整个 store 文件被删,请求时 version=1 → 观察重播种(version=1)是否逃逸
//   A4 打穿尝试③:在途期间 store 文件损坏 → 观察快照读取异常时的行为(抛错=失败有声,还是 ok=失败开放)
import assert from 'node:assert/strict';
import { writeStoreFile, removeStoreFile, sessionRecord, evidenceRecord, annotationRecord, baseRequest, loadBridge, useStoreDir, deferred } from './helpers.mjs';

const createBridgedModelAdapter = await loadBridge();

function slowTransportHarness() {
  const slow = deferred();
  let capturedRefs = [];
  const transport = async (call) => {
    capturedRefs = call.payload.evidenceRefs.map((r) => ({ ...r }));
    return slow.promise.then(() => ({
      ok: true,
      output: {
        findings: [{ id: 'F1', text: '审计复演:在途期间生成的发现。', evidenceRefs: capturedRefs.map((r) => ({ ...r })) }],
        questions: [],
        evidenceRefs: capturedRefs.map((r) => ({ ...r })),
      },
      usage: { totalTokens: 1 },
    }));
  };
  return { slow, transport };
}

// ---------------- A1:会话消失 + version 推进(产品语义等价:任何写都会 +1) ----------------
{
  const { file } = useStoreDir('ra-a1');
  writeStoreFile(file, { version: 7, sessions: [sessionRecord()], evidence: [evidenceRecord()], annotations: [annotationRecord()] });
  const harness = slowTransportHarness();
  const bridge = createBridgedModelAdapter({ transport: harness.transport, timeoutMs: 5000 });
  const p = bridge.generateFollowUps(baseRequest({ domainRoles: ['credit'] }));
  // 在途期间:删除会话并推进 version(等价一次 store 写入)
  const store = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
  writeStoreFile(file, { version: 8, sessions: [], evidence: store.evidence, annotations: store.annotations });
  harness.slow.resolve(true);
  const r = await p;
  console.log('== A1 会话消失+version推进 ==');
  console.log('status        =', r.status);
  console.log('replies.length=', r.replies.length);
  console.log('failureReason =', r.failureReason);
  assert.equal(r.status, 'rejected', 'A1:会话消失必须失败关闭 rejected');
  assert.equal(r.replies.length, 0, 'A1:拒绝结果不得携带模型回复');
  assert.ok(r.status !== 'ok' && r.status !== 'partial', 'A1:绝不以 ok/partial 放行');
  console.log('RESULT A1: 失败关闭确认(rejected, 0 replies)——与交付判定一致');
}

// ---------------- A2:打穿尝试①会话消失但 version 不变(直接改文件;产品 API 不可达) ----------------
{
  const { file } = useStoreDir('ra-a2');
  writeStoreFile(file, { version: 7, sessions: [sessionRecord()], evidence: [evidenceRecord()], annotations: [annotationRecord()] });
  const harness = slowTransportHarness();
  const bridge = createBridgedModelAdapter({ transport: harness.transport, timeoutMs: 5000 });
  const p = bridge.generateFollowUps(baseRequest({ domainRoles: ['credit'] }));
  const store = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
  writeStoreFile(file, { version: store.version, sessions: [], evidence: store.evidence, annotations: store.annotations }); // 只删会话,version 不动
  harness.slow.resolve(true);
  const r = await p;
  console.log('== A2 打穿尝试①:会话消失+version不变 ==');
  console.log('status        =', r.status);
  console.log('replies.length=', r.replies.length);
  console.log('failureReason =', r.failureReason ?? '(无)');
  if (r.status === 'ok' || r.status === 'partial') {
    console.log('RESULT A2: 逃逸复现——会话消失但结果 ok 放行(兜底完全依赖 version 推进,与会话存在性无关)');
  } else {
    console.log('RESULT A2: 未逃逸(status=' + r.status + ')');
  }
}

// ---------------- A3:打穿尝试②store 文件整删,请求时 version=1(重播种窗口) ----------------
{
  const { file } = useStoreDir('ra-a3');
  writeStoreFile(file, { version: 1, sessions: [sessionRecord()], evidence: [evidenceRecord()], annotations: [annotationRecord()] });
  const harness = slowTransportHarness();
  const bridge = createBridgedModelAdapter({ transport: harness.transport, timeoutMs: 5000 });
  const p = bridge.generateFollowUps(baseRequest({ domainRoles: ['credit'] }));
  await new Promise((res) => setTimeout(res, 20)); // 让桥完成初始读取并进入在途
  removeStoreFile(file); // 整文件删除 → 下次读取触发 readRemoteStoreState 重播种(version=1, sessions=[])
  harness.slow.resolve(true);
  const r = await p;
  console.log('== A3 打穿尝试②:整文件删除(重播种 version=1) ==');
  console.log('status        =', r.status);
  console.log('replies.length=', r.replies.length);
  console.log('failureReason =', r.failureReason ?? '(无)');
  if (r.status === 'ok' || r.status === 'partial') {
    console.log('RESULT A3: 逃逸复现——重播种 version=1 与请求 contextVersion=1 重合 → 无 stale → ok 放行');
  } else {
    console.log('RESULT A3: 未逃逸(status=' + r.status + ',reason=' + (r.failureReason ?? '-') + ')');
  }
}

// ---------------- A4:打穿尝试③在途期间 store 损坏(快照读取抛错) ----------------
{
  const { file } = useStoreDir('ra-a4');
  writeStoreFile(file, { version: 7, sessions: [sessionRecord()], evidence: [evidenceRecord()], annotations: [annotationRecord()] });
  const harness = slowTransportHarness();
  const bridge = createBridgedModelAdapter({ transport: harness.transport, timeoutMs: 5000 });
  const p = bridge.generateFollowUps(baseRequest({ domainRoles: ['credit'] }));
  await new Promise((res) => setTimeout(res, 20));
  (await import('node:fs')).writeFileSync(file, '{corrupted json!!!', 'utf8');
  harness.slow.resolve(true);
  try {
    const r = await p;
    console.log('== A4 store 损坏 ==');
    console.log('status        =', r.status);
    console.log('RESULT A4: ' + (r.status === 'ok' || r.status === 'partial' ? '失败开放(危险!)' : `未 ok 放行(${r.status})`));
  } catch (e) {
    console.log('== A4 store 损坏 ==');
    console.log('RESULT A4: 桥抛错(失败有声,非静默放行):', e instanceof Error ? e.message.split('\n')[0] : e);
  }
}

console.log('AUDIT RA DONE');
