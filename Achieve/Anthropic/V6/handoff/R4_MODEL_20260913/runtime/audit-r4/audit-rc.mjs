// 独立复演 R-c:双角色(credit=succeeded,policy=unknown)直接调产品桥,
// 验证 productAction 是否反映 unknown 专属人控语义;顺带核对 R-b(scope 恒 null)。
import assert from 'node:assert/strict';
import { writeStoreFile, sessionRecord, evidenceRecord, annotationRecord, baseRequest, loadBridge, useStoreDir } from './helpers.mjs';

const { file } = useStoreDir('rc');
writeStoreFile(file, {
  version: 7,
  sessions: [sessionRecord()],
  evidence: [evidenceRecord()],
  annotations: [annotationRecord()],
});

const createBridgedModelAdapter = await loadBridge();
const bridge = createBridgedModelAdapter({
  transport: async (call) => {
    if (call.payload.role === 'credit') {
      // 真实通道形状:simulated 缺省 → 候选 succeeded
      return {
        ok: true,
        output: {
          findings: [{ id: 'F1', text: '审计复演发现(credit):回款周期异常。', evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })) }],
          questions: [],
          evidenceRefs: call.payload.evidenceRefs.map((r) => ({ ...r })),
        },
        usage: { totalTokens: 5 },
      };
    }
    if (call.payload.role === 'policy') {
      return { ok: 'indeterminate' }; // 候选 unknown(外部调用是否发生不可知)
    }
    return { ok: false, sent: false, error: { message: '审计复演:未计划的角色' } };
  },
});

const result = await bridge.generateFollowUps(baseRequest());

console.log('== 独立复演 R-c ==');
console.log('status              =', result.status);
console.log('productAction       =', JSON.stringify(result.productAction));
console.log('failureReason       =', result.failureReason);
console.log('candidate.status    =', result.candidate.status);
console.log('candidate.perRole   =', JSON.stringify(result.candidate.perRole));
console.log('candidate.scope     =', result.candidate.scope);

const policyRole = result.candidate.perRole.find((p) => p.role === 'policy');
const creditRole = result.candidate.perRole.find((p) => p.role === 'credit');
assert.equal(result.status, 'partial', '双角色一成一 unknown → partial');
assert.equal(policyRole.status, 'unknown');
assert.equal(creditRole.status, 'succeeded');
// 缺陷核心证据:productAction 沿用 succeeded 角色的动作
assert.equal(result.productAction.uiAction, 'show_result_pending_review', 'productAction 按 succeeded 表达(R-c 缺陷成立)');
assert.notEqual(result.productAction.uiAction, 'human_verify_before_retry', 'unknown 专属动作丢失');
// 形态修正核实:succeeded.mustHumanVerify 本来就是 true → "mustHumanVerify 丢失"不成立
assert.equal(result.productAction.mustHumanVerify, true, '形态修正:succeeded 动作自带 mustHumanVerify=true,丢失的是 unknown 专属语义而非 mustHumanVerify');
assert.ok(result.failureReason.includes('policy=unknown'), 'unknown 只在 failureReason 文字中');
// R-b 顺带:gate 未传 → scope 恒 null
assert.equal(result.candidate.scope, null, 'R-b:候选 scope 恒 null(gate 不可达)');

console.log('RESULT: R-c 缺陷独立确认(形态=unknown 专属 uiAction/zh 丢失;mustHumanVerify 未丢失);R-b scope=null 独立确认');
