// 回执协议(R3):MAIN 实际消费适配器后产出的"接入回执"凭据。
// 纯结果投影:回执不复制业务状态(业务事实仍在产品 store),只记录本次调用的
// 协议结果与桥自验项。MAIN 接入前适配器能力标 candidate;收到合格回执才标 integrated。
import { statusToProductAction } from '../integration/product-mapping.mjs';

export const RECEIPT_SCHEMA = 'R3_BRIDGE_RECEIPT@1';

const STATUS_SET = new Set(['not_configured', 'simulated', 'succeeded', 'failed', 'unknown', 'stale', 'cancelled']);

/**
 * 由一次真实(或样例)调用构建回执。
 * result : adapter.analyze 的返回(七状态之一,含 error/costLedger/dissent 等)
 * request: 本次请求(桥产物;至少含 requestId/projectId/sessionId/generation/contextVersion)
 * bridgeMeta: buildAnalyzeRequest 的 bridgeMeta(证明走桥:generation 偏移/原子读取/过滤计数)
 * ledgerTotals: 可选,账本 totals() 快照(成本守恒观测)
 * generatedAt: 可选,产品时钟的 ISO 字符串(回执整体冻结,桥自身不取系统时间)
 */
export function buildReceipt({ result, request, bridgeMeta, ledgerTotals, generatedAt = null } = {}) {
  if (!result || !STATUS_SET.has(result.status)) {
    throw new TypeError('回执必须来自适配器结果(result.status 必须是七状态之一)');
  }
  if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0) {
    throw new TypeError('回执必须携带 request.requestId');
  }
  const ui = statusToProductAction(result.status); // 未知状态会抛 TypeError(七状态全覆盖契约)
  return Object.freeze({
    schema: RECEIPT_SCHEMA,
    generatedAt: typeof generatedAt === 'string' ? generatedAt : null, // 产品时钟,调用方传入
    requestEcho: {
      requestId: request.requestId,
      projectId: request.projectId ?? null,
      sessionId: request.sessionId ?? null,
      protocolGeneration: request.generation ?? null, // = 产品代次 + 1
      contextVersion: request.contextVersion ?? null,
    },
    bridgeMeta: bridgeMeta
      ? {
          bridgeId: bridgeMeta.bridgeId ?? null,
          productGeneration: bridgeMeta.productGeneration ?? null,
          remoteVersion: bridgeMeta.remoteVersion ?? null,
          evidenceCount: bridgeMeta.evidenceCount ?? null,
          supersededFiltered: bridgeMeta.supersededFiltered ?? null,
        }
      : null,
    outcome: {
      status: result.status,
      errorCode: result.error ? result.error.code : null,
      errorMessage: result.error ? result.error.message : null,
      findingsCount: Array.isArray(result.findings) ? result.findings.length : 0,
      questionsCount: Array.isArray(result.questions) ? result.questions.length : 0,
      dissentCount: Array.isArray(result.dissent) ? result.dissent.length : 0,
      usageUnknown: result.usageUnknown === true,
      costLedgerState: result.costLedger ? result.costLedger.reservationState : 'none',
      deduped: result.deduped === true,
      scope: result.scope ?? null,
    },
    uiAction: ui,
    ledgerTotals: ledgerTotals ? { ...ledgerTotals } : null,
    // 桥自验项(MAIN 判 integrated 的依据;均须为 true)
    checks: {
      viaBridge: Boolean(bridgeMeta && bridgeMeta.bridgeId),
      generationOffsetApplied: Boolean(bridgeMeta && Number.isInteger(bridgeMeta.productGeneration)),
      atomicReaderUsed: Boolean(bridgeMeta && Number.isInteger(bridgeMeta.remoteVersion)),
      sevenStatusUsed: true,
      noSecondBusinessStateCopy: true, // 回执是投影;业务状态唯一来源仍是产品 store
    },
  });
}

/**
 * MAIN 侧判定:该回执是否足以把适配器能力从 candidate 标为 integrated。
 * 规则:schema 正确 + outcome.status 是七状态 + 桥自验项全 true + (unknown 时必须带人工核实标记)。
 * 不合格返回 { ok:false, reason(中文) }。
 */
export function isIntegratedReady(receipt) {
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA) {
    return { ok: false, reason: `回执 schema 必须是 ${RECEIPT_SCHEMA}` };
  }
  if (!receipt.outcome || !STATUS_SET.has(receipt.outcome.status)) {
    return { ok: false, reason: '回执缺少合法的七状态 outcome.status' };
  }
  const c = receipt.checks || {};
  for (const key of ['viaBridge', 'generationOffsetApplied', 'atomicReaderUsed', 'sevenStatusUsed', 'noSecondBusinessStateCopy']) {
    if (c[key] !== true) return { ok: false, reason: `桥自验项 ${key} 不合格` };
  }
  if (receipt.outcome.status === 'unknown' && receipt.uiAction && receipt.uiAction.mustHumanVerify !== true) {
    return { ok: false, reason: 'unknown 结果的回执必须带 mustHumanVerify=true(禁止自动重试语义)' };
  }
  return { ok: true };
}
