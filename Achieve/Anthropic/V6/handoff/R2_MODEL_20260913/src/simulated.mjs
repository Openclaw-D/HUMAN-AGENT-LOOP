// 受控模拟 provider(显式 SIMULATED)。
// 契约:返回 ok:true + simulated:true,适配器据此把状态定为 simulated(而非 succeeded);
// 模拟输出同样必须通过输出守门(证据引用/越权拦截),不合格同样 failed。
export function createSimulatedTransport({ script, notice = null } = {}) {
  return async function simulatedTransport(call) {
    let output;
    if (typeof script === 'function') {
      output = script(call);
    } else {
      const refs = call.payload.evidenceRefs.map((r) => ({ ...r }));
      output = {
        findings: refs.map((r, i) => ({
          id: `SF${i + 1}`,
          text: `【模拟】针对证据 ${r.id}(版本 ${r.version})的示例发现:该证据与本次分析目的 ${call.payload.purpose} 相关,细节需以真实模型复核。`,
          evidenceRefs: [r],
        })),
        questions: refs.length > 0
          ? [{ id: 'SQ1', text: `【模拟】请补充说明证据 ${refs[0].id} 的取得方式与时间。`, evidenceRefs: [refs[0]] }]
          : [{ id: 'SQ1', text: '【模拟】本次未提供证据引用,请先补充证据。', evidenceRefs: [] }],
        evidenceRefs: refs,
      };
    }
    return {
      ok: true,
      simulated: true,
      simulatedMode: 'simulated',
      output,
      usage: { totalTokens: 0, providerReported: true, note: 'simulated-no-external-call' },
    };
  };
}
