import { appendAuthorityEvent } from './authority-event-ledger.ts';
import { getSharedContextSnapshot } from './evidence-runtime.ts';

export type DecisionAction = 'reject' | 'submit';
export type DecisionReceipt = {
  gateId: string;
  receiptId: string;
  caseId: string;
  stageId: 'policy' | 'credit' | 'commerce' | 'asset';
  flowId: string;
  action: DecisionAction;
  actor: string;
  status: 'recorded';
  requestId: string;
  recordedAt: string;
};

const CASE_ID = 'FL-DEMO-001';
const STAGES = ['policy', 'credit', 'commerce', 'asset'] as const;
const STAGE_SET: ReadonlySet<string> = new Set<string>(STAGES);
const STAGE_FLOW_SET: Readonly<Record<DecisionReceipt['stageId'], ReadonlySet<string>>> = {
  policy: new Set(['policy-material', 'policy-rules', 'policy-quant', 'policy-prereview', 'policy-update']),
  credit: new Set(['credit-parse', 'credit-fact', 'credit-link', 'credit-coordinate', 'credit-review']),
  commerce: new Set(['commerce-contract', 'commerce-logistics', 'commerce-funding', 'commerce-payment-check', 'commerce-final-payment']),
  asset: new Set(['asset-onboard', 'asset-rent', 'asset-warning', 'asset-collection', 'asset-litigation']),
};
const ACTION_SET: ReadonlySet<string> = new Set<string>(['reject', 'submit']);
const MAX_ACTOR_LENGTH = 80;
const MAX_REQUEST_ID_LENGTH = 160;

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

let sequence = 0;
let runtimeEpoch = 0;
const receipts: DecisionReceipt[] = [];
const requests = new Map<string, { signature: string; receipt: DecisionReceipt }>();

/**
 * 同步记录一条具名 Human Gate 决策回执。
 * 验证优先级固定：CASE_NOT_FOUND → INVALID_STAGE → INVALID_FLOW → INVALID_ACTION →
 *   INVALID_ACTOR → INVALID_REQUEST_ID → IDEMPOTENCY_CONFLICT。
 * 所有错误 fail closed，不写入 receipt。
 */
export function recordHumanDecision(input: {
  caseId: string;
  stageId: string;
  flowId: string;
  action: string;
  actor: string;
  requestId: string;
}): DecisionReceipt {
  // 1 CASE_NOT_FOUND
  if (typeof input?.caseId !== 'string' || input.caseId !== CASE_ID) {
    throw failure('CASE_NOT_FOUND', '事项不存在');
  }
  // 2 INVALID_STAGE
  if (typeof input.stageId !== 'string' || !STAGE_SET.has(input.stageId)) {
    throw failure('INVALID_STAGE', '板块无效');
  }
  const stageId = input.stageId as DecisionReceipt['stageId'];
  // 3 INVALID_FLOW
  if (typeof input.flowId !== 'string' || !STAGE_FLOW_SET[stageId].has(input.flowId)) {
    throw failure('INVALID_FLOW', '当前流程无效');
  }
  const flowId = input.flowId;
  // 4 INVALID_ACTION
  if (typeof input.action !== 'string' || !ACTION_SET.has(input.action)) {
    throw failure('INVALID_ACTION', '动作无效');
  }
  const action = input.action as DecisionAction;
  // 5 INVALID_ACTOR（trim 后非空）
  const actor = asTrimmedString(input.actor);
  if (!actor || actor.length > MAX_ACTOR_LENGTH) throw failure('INVALID_ACTOR', '操作人必须是非空且不超过80字符的具名人类');
  // 6 INVALID_REQUEST_ID（trim 后非空）
  const requestId = asTrimmedString(input.requestId);
  if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) throw failure('INVALID_REQUEST_ID', '请求标识无效');

  // 7 IDEMPOTENCY_CONFLICT：同 requestId + 同规范化 payload → replay；异 payload → 冲突
  const signature = [stageId, flowId, action, actor].join('\u0000');
  const existing = requests.get(requestId);
  if (existing) {
    if (existing.signature !== signature) {
      throw failure('IDEMPOTENCY_CONFLICT', '同一请求标识已绑定其他操作');
    }
    return structuredClone(existing.receipt);
  }

  const sharedContextSnapshot = getSharedContextSnapshot();
  const preparation = sharedContextSnapshot.projection.stagePreparations
    .find((stage) => stage.stageId === stageId)?.flows
    .find((flow) => flow.flowId === flowId);
  if (!preparation || preparation.prepState === 'locked') {
    throw failure('FLOW_LOCKED', '当前流程已锁定，等待前序完成');
  }

  sequence += 1;
  const receipt: DecisionReceipt = {
    gateId: `gate-${stageId}-${flowId}`,
    receiptId: `decision-${String(sequence).padStart(4, '0')}`,
    caseId: CASE_ID,
    stageId,
    flowId,
    action,
    actor,
    status: 'recorded',
    requestId,
    recordedAt: new Date().toISOString(),
  };
  appendAuthorityEvent({
    eventId: `human-decision-${runtimeEpoch}-${receipt.receiptId}`,
    caseId: CASE_ID,
    type: 'HUMAN_DECISION_RECORDED',
    actor: { kind: 'human', id: actor, authority: 'confirmed' },
    correlationId: requestId,
    causationId: receipt.gateId,
    contextVersion: sharedContextSnapshot.sharedContext.contextVersion,
    payload: {
      action,
      flowId,
      gateId: receipt.gateId,
      receiptId: receipt.receiptId,
      stageId,
      status: receipt.status,
    },
  });
  receipts.push(receipt);
  requests.set(requestId, { signature, receipt });
  return structuredClone(receipt);
}

/** 返回全部 Receipt 的深克隆。 */
export function getDecisionReceipts(): DecisionReceipt[] {
  return structuredClone(receipts);
}

/** 返回最新 Receipt 的深克隆；无 Receipt 时返回 undefined。 */
export function getLatestDecisionReceipt(): DecisionReceipt | undefined {
  const latest = receipts.at(-1);
  return latest ? structuredClone(latest) : undefined;
}

/** 完全清空 receipts、requests 并重置 sequence。 */
export function resetDecisionRuntime(): void {
  runtimeEpoch += 1;
  sequence = 0;
  receipts.length = 0;
  requests.clear();
}
