// 任务 03 · S2 压力阈值拆分：业务风险阈值与系统负载阈值严格分离，永不合成“压力指数”。
// - 业务风险阈值：有公式、有单位、有数据来源、有政策版本（本包全部为 simulation 演示值）。
// - 系统负载阈值：队列长度、模型超时、预算剩余、录制健康——只影响执行状态（unknown/待核验），
//   不改变业务风险结论：超时/低清 → 未知/待核验，不得把客户自动判成高风险；
//   同时未完成的分析不得默认为通过（双向失败关闭）。

export function createThresholds({ business, system }) {
  for (const [name, pack] of [['business', business], ['system', system]]) {
    if (!pack || typeof pack !== 'object') throw new Error(`${name} 阈值包必须为对象`);
    if (typeof pack.version !== 'string' || pack.version.trim() === '') throw new Error(`${name}.version 必填`);
    for (const t of pack.thresholds ?? []) {
      if (typeof t.key !== 'string' || t.key.trim() === '') throw new Error(`${name} 阈值缺 key`);
      if (typeof t.value !== 'number' || !Number.isFinite(t.value)) throw new Error(`${name} 阈值 ${t.key} 必须为有限数值`);
      if (typeof t.unit !== 'string' || t.unit.trim() === '') throw new Error(`${name} 阈值 ${t.key} 缺单位`);
      if (typeof t.source !== 'string' || t.source.trim() === '') throw new Error(`${name} 阈值 ${t.key} 缺数据来源`);
    }
  }
  const bMap = new Map(business.thresholds.map((t) => [t.key, t]));
  const sMap = new Map(system.thresholds.map((t) => [t.key, t]));

  return {
    versions: { business: business.version, system: system.version },
    /** 业务阈值（只进确定性公式，不进执行器健康判断）。 */
    business(key) { return bMap.get(key) ?? null; },
    /** 系统阈值（只进执行状态归类，不进业务风险结论）。 */
    system(key) { return sMap.get(key) ?? null; },
    /**
     * 系统信号 → 执行状态归类（单向：系统负载永不产生/消除业务风险结论）。
     * timeout/预算不足/录制异常 → domainStatus=unknown + 待核验；分析未完成绝不默认 CLEAR。
     */
    classifySystemSignal(signal) {
      const s = sMap.get(signal.key) ?? null;
      if (!s) return { status: 'unknown', reasonCode: 'SYSTEM_SIGNAL_UNRECOGNIZED', messageZh: `系统信号 ${String(signal.key)} 未登记：按未知处理` };
      switch (signal.key) {
        case 'model_timeout':
          return { status: 'unknown', reasonCode: 'DOMAIN_TIMEOUT', messageZh: '模型超时：该域分析标记不完整（未知/待核验），不推断为高风险，也不默认通过' };
        case 'budget_exhausted':
          return { status: 'unknown', reasonCode: 'BUDGET_HELD', messageZh: '预算不足：出站未发送，该域待重算' };
        case 'recording_unhealthy':
          return { status: 'unknown', reasonCode: 'RECORDING_UNHEALTHY', messageZh: '录制健康异常：媒体完整性未知，待重新采集' };
        default:
          return { status: 'unknown', reasonCode: 'SYSTEM_SIGNAL_UNCLASSIFIED', messageZh: `系统信号 ${signal.key} 未归类：按未知处理` };
      }
    },
    fingerprint: { business: business.version, system: system.version, note: '两包独立版本号，禁止合并指标' },
  };
}
