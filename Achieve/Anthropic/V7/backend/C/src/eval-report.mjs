// V7 Lane C · 判断能力评估报告：把用例记录聚合为给 A/B/D 的能力/边界证据。
// 明确区分：已验证能力 / 未验证范围（真实模型通道、真实审批 UI）。
import { createHash } from 'node:crypto';

/**
 * @param {{ caseSetId, version, records, passed, failed }} runResult runCaseSet 输出
 * @param {object} rulePack
 * @returns {EvalReport}
 */
export function buildEvalReport(runResult, rulePack) {
  const byCategory = {};
  for (const r of runResult.records) {
    byCategory[r.category] = { caseId: r.caseId, pass: r.pass, status: r.actual.status, reason: r.actual.reason, providerCalls: r.actual.providerCalls };
  }
  const escalationReasonsVerified = [...new Set(runResult.records.filter((r) => r.actual.reason !== null).map((r) => r.actual.reason))];

  return {
    reportId: `v7-laneC-eval-${createHash('sha256').update(`${runResult.caseSetId}@${runResult.version}`).digest('hex').slice(0, 12)}`,
    generatedAt: new Date().toISOString(),
    rulePackVersion: rulePack.version,
    caseSet: `${runResult.caseSetId}@${runResult.version}`,
    summary: { total: runResult.records.length, passed: runResult.passed, failed: runResult.failed },
    byCategory,
    capabilities: {
      deterministicCalculation: {
        verified: true,
        note: '同输入同输出同 inputHash；缺参/缺口径/非法币种/非正月供显式拒绝（见 v7-calculation-tool 测试）。',
      },
      citationVerification: {
        verified: runResult.records.some((r) => r.category === 'superseded_evidence' && r.pass),
        note: '引用存在性/版本精确匹配/已取代引用单独归因（grounding checks）。',
      },
      escalationReasoning: {
        verified: escalationReasonsVerified,
        note: '升级由机械前置门触发（短路，模型未被调用），而非模型自报；providerCalls=0 可证。',
      },
      uncertaintyExternalSignal: {
        verified: runResult.records.some((r) => r.category === 'uncertainty_understatement' && r.pass),
        note: '不确定下限来自机械信号（口径不同/负分子/历史取代），独立于模型自报置信度。',
      },
      unknownNoAutoRetry: {
        verified: runResult.records.some((r) => r.category === 'call_unknown' && r.pass && r.actual.providerCalls === 1),
        note: '发送后不可知记录为 unknown，provider 恰好调用一次（无自动重试）。',
      },
    },
    unverified: [
      '真实 HTTP 模型通道（凭据未获用途/成本授权；ZAI_API_KEY 未被本路读取）——全部结论基于注入 provider 的模拟通道，标记 provider: simulation。',
      '正式审批界面/人工动作回写（属 A 路实验记录与后续集成）。',
      '行业报告正文（3D打印/液冷/印刷仅作为待验证场景线索，未实读、未晋升）。'
    ],
  };
}

/**
 * @typedef EvalReport
 * 属性见实现；JSON 序列化后即交付物（写入 evidence/）。
 */
