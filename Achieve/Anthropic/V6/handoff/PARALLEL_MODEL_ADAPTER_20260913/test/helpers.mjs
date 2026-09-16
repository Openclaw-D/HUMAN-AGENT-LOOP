// 测试公共件:合成证据/请求/transport 工具。全部数据为合成,不含真实客户信息。
import { createHash } from 'node:crypto';
import { createModelAdapter } from '../src/adapter.mjs';
import { createMemoryLedger } from '../src/ledger.mjs';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 合成证据清单:hash 为合成字节的真 SHA256。 */
export function makeEvidence(count = 2, seed = 'synthetic-bytes') {
  return Array.from({ length: count }, (_, i) => ({
    id: `EV-${String(i + 1).padStart(3, '0')}`,
    version: 'v1',
    hash: sha256(`${seed}:${i}`),
  }));
}

export function makeRequest(overrides = {}, { evidence = makeEvidence(2) } = {}) {
  return {
    requestId: 'req-0001',
    projectId: 'proj-demo-1',
    sessionId: 'sess-demo-1',
    generation: 1,
    contextVersion: 'ctx-1',
    role: 'credit',
    purpose: 'risk_review',
    text: '【合成】某贸易公司申请流动资金周转,提供上年度报表与银行流水节选,待核回款周期。',
    evidenceRefs: evidence.map((r) => ({ ...r })),
    ...overrides,
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 记录调用的 transport 包装:calls[i] = { payload, signal, deadlineMs }。 */
export function recordingTransport(impl) {
  const calls = [];
  async function transport(call) {
    calls.push(call);
    return impl(call, calls.length);
  }
  return { transport, calls };
}

/** 合法输出(中文文本;引用默认为给定清单全部)。 */
export function goodOutput(evidenceRefs, overrides = {}) {
  const refs = (evidenceRefs || []).map((r) => ({ ...r }));
  return {
    findings: [
      { id: 'F1', text: '示例发现:客户提供的资料与现场访谈口径一致,未见明显异常。', evidenceRefs: refs },
    ],
    questions: [{ id: 'Q1', text: '请补充下季度回款计划与主要客户结算条款。', evidenceRefs: [] }],
    evidenceRefs: refs,
    ...overrides,
  };
}

export function okTransport(output, usage) {
  return async () => ({ ok: true, output, usage });
}

export function buildGoodAdapter(deps = {}) {
  const evidence = deps.__evidence || makeEvidence(2);
  delete deps.__evidence;
  return createModelAdapter({
    transport: okTransport(goodOutput(evidence), { totalTokens: 42 }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
    ...deps,
  });
}

export function hasCJK(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff]/.test(s);
}
