// V7 Lane C · SIMULATION 模型桩（仅测试/演示用；与真实 HTTP 通道严格分离）。
// 不读取任何密钥/环境变量；不做网络请求。A/B 集成时以真实网关注入替换，本文件不进生产路径。
// 语义对齐 provider 契约：
//   { ok:true, receiptId, text } | { ok:false, phase:'not_sent', code, message } | { ok:false, phase:'sent_unknown', code, message }
// 计数器记录调用次数（供"unknown 后不自动重试"断言）。

/**
 * @param {object} opts
 * @param {object|((req)=>object)|null} opts.script 固定返回（对象）或按 requestId 取脚本；null = 未配置
 * @param {string} [opts.notConfiguredMessage] 未配置时的说明
 */
export function createMockProvider(opts = {}) {
  const calls = [];
  return {
    calls,
    /** provider 契约入口 */
    async provider(req) {
      calls.push({ requestId: req.requestId, promptLength: req.prompt.length, at: new Date().toISOString() });
      if (opts.script === null || (opts.script === undefined && opts.notConfigured)) {
        return { ok: false, phase: 'not_sent', code: 'MODEL_NOT_CONFIGURED', message: opts.notConfiguredMessage ?? '模型通道未配置：请求未发出' };
      }
      const scripted = typeof opts.script === 'function' ? opts.script(req) : opts.script;
      if (scripted === undefined || scripted === null) {
        return { ok: false, phase: 'not_sent', code: 'NO_SCRIPT', message: '模拟桩无该请求的脚本' };
      }
      if (scripted.phase === 'sent_unknown') {
        return { ok: false, phase: 'sent_unknown', code: scripted.code ?? 'TIMEOUT_AFTER_SEND', message: scripted.message ?? '发送后结果不可知' };
      }
      return { ok: true, receiptId: `mock-receipt-${req.requestId}`, text: typeof scripted.text === 'string' ? scripted.text : JSON.stringify(scripted.text ?? scripted) };
    },
  };
}

/** 常用合成候选构造器（默认全字段合法；测试按需覆写）。 */
export function makeCandidate(patch = {}) {
  return {
    observations: ['两张证据的设备数量口径一致；计算结果：覆盖率 1.4，处于可覆盖区间（算术事实）。'],
    evidenceRefs: [{ evidenceId: 'ev-001', version: 2 }],
    assumptions: ['输入口径与计算声明一致。'],
    uncertainty: ['月度数值为单期采样，未覆盖季节波动。'],
    recommendedHumanAction: 'need_more_evidence',
    ...patch,
  };
}
