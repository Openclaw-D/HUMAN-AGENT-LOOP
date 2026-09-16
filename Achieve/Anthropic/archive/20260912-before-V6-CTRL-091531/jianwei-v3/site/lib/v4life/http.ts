// V4-LIFE HTTP 层共享辅助（契约 §10 / §12）。
// 统一 JSON 响应（no-store，不缓存权威状态）、错误 envelope（{ error: <CODE> }）、
// 请求体安全读取与命令字段校验。校验失败关闭：不伪造成功，不自行生成权威状态。

import { V4LifeError } from './engine.ts';
import type { V4LifeEngine } from './engine.ts';
import type { V4LifeDecision, V4LifeEvidenceKind, V4LifeVerificationTarget } from './types.ts';
import { readBoundedJsonBody } from '../bounded-json-body.ts';
import {
  getOrCreateV4LifeDemoEngine,
  getV4LifeEngine,
  V4LIFE_DEMO_CASE_ID,
} from './runtime.ts';

// 契约 §12 错误码 → HTTP 状态映射（未知错误一律 INTERNAL_ERROR 500，不泄露内部细节）。
// P1 追加：EVIDENCE_NOT_FOUND 404、CONTEXT_WINDOW_NOT_OPEN 409、CONTEXT_BATCH_NOT_FOUND 404、
// CONTEXT_BATCH_INVALID_TRANSITION 409（§12 错误码总表同步追加）。
const ERROR_STATUSES: Record<string, number> = {
  INVALID_ENGINE_INPUT: 400,
  ACTOR_NOT_FOUND: 400,
  EVIDENCE_INVALID: 400,
  INVALID_JSON: 400,
  CASE_NOT_FOUND: 404,
  WORK_ITEM_NOT_FOUND: 404,
  GATE_NOT_FOUND: 404,
  ROLE_MISMATCH: 403,
  EVIDENCE_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  WORK_ITEM_NOT_ACTIVE: 409,
  GATE_NOT_OPEN: 409,
  GATE_ALREADY_DECIDED: 409,
  EVIDENCE_NOT_FOUND: 404,
  CONTEXT_WINDOW_NOT_OPEN: 409,
  CONTEXT_BATCH_NOT_FOUND: 404,
  CONTEXT_BATCH_INVALID_TRANSITION: 409,
  SEQ_CONFLICT: 500,
  REQUEST_BODY_TOO_LARGE: 413,
  REQUEST_BODY_TIMEOUT: 408,
  INTERNAL_ERROR: 500,
};

export function v4LifeJsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function v4LifeErrorResponse(error: unknown): Response {
  if (error instanceof V4LifeError) {
    return v4LifeJsonResponse({ error: error.code }, ERROR_STATUSES[error.code] ?? 500);
  }
  return v4LifeJsonResponse({ error: 'INTERNAL_ERROR' }, 500);
}

const MAX_JSON_BODY_BYTES = 1_000_000;
const BODY_READ_TIMEOUT_MS = 10_000;

export interface ReadJsonBodyOptions {
  /** 流式读取的字节上限（含 chunked 无声明传输），默认 1MB。超限抛 REQUEST_BODY_TOO_LARGE。 */
  maxBytes?: number;
  /** 宽容模式：仅 demo/reset 使用——非法 JSON 归一为 {}（沿用"省略即默认"语义）；
   *  资源类守卫（413/408）在宽容模式下仍抛出，绝不静默。 */
  lenient?: boolean;
}

/** 请求体安全读取：经 readBoundedJsonBody 执行流式字节上限与读取超时（防护对齐旧路由，
 *  契约 §10/§12），声明超限、实际超限、读超时、非法 JSON 分别以 413/408/408/400 显式失败，
 *  不再静默吞错；非对象 JSON（数组/标量）沿用既有约定归一为 {}，由字段校验失败关闭。 */
export async function readJsonBody(
  request: Request,
  options?: ReadJsonBodyOptions,
): Promise<Record<string, unknown>> {
  const maxBytes = options?.maxBytes ?? MAX_JSON_BODY_BYTES;
  let parsed: unknown;
  try {
    parsed = await readBoundedJsonBody(request, maxBytes, BODY_READ_TIMEOUT_MS);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'REQUEST_BODY_TOO_LARGE') {
      throw new V4LifeError('REQUEST_BODY_TOO_LARGE');
    }
    if (code === 'REQUEST_BODY_TIMEOUT') {
      throw new V4LifeError('REQUEST_BODY_TIMEOUT');
    }
    if (options?.lenient === true) {
      return {};
    }
    throw new V4LifeError('INVALID_JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 字段校验 helper（契约 §6.1：失败关闭）
// ---------------------------------------------------------------------------

/** 非空 string（trim 后非空）；可选长度上限（按 UTF-16 码元计）。 */
export function asNonEmptyString(value: unknown, maxLength?: number): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return undefined;
  }
  return value;
}

/** ≥0 整数（expectedRev / afterSeq / limit）。 */
export function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

const EVIDENCE_KINDS: readonly V4LifeEvidenceKind[] = [
  'upstream_context',
  'financial_statement',
  'contract_draft',
  'asset_history_feedback',
  'supplement',
];

export function asEvidenceKind(value: unknown): V4LifeEvidenceKind | undefined {
  return EVIDENCE_KINDS.includes(value as V4LifeEvidenceKind) ? (value as V4LifeEvidenceKind) : undefined;
}

const DECISION_OUTCOMES: readonly V4LifeDecision['outcome'][] = ['approved', 'rejected', 'returned'];

export function asDecisionOutcome(value: unknown): V4LifeDecision['outcome'] | undefined {
  return DECISION_OUTCOMES.includes(value as V4LifeDecision['outcome'])
    ? (value as V4LifeDecision['outcome'])
    : undefined;
}

/** tags：数组 ≤20 项，每项非空 string ≤64 字符；空数组合法。 */
export function asTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 20) {
    return undefined;
  }
  const tags: string[] = [];
  for (const item of value) {
    const tag = asNonEmptyString(item, 64);
    if (tag === undefined) {
      return undefined;
    }
    tags.push(tag);
  }
  return tags;
}

/** amountCny：缺省或有限数 ≥0。 */
export function isOptionalAmountCny(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

// ---------------------------------------------------------------------------
// 请求体 → 引擎命令（契约 §6 命令形状）；返回结构化校验结果，由路由统一失败关闭。
// ---------------------------------------------------------------------------

export type V4LifeBodyParseCode = 'INVALID_ENGINE_INPUT' | 'EVIDENCE_INVALID';

export type V4LifeBodyParseResult<T> = { ok: true; command: T } | { ok: false; code: V4LifeBodyParseCode };

export interface V4LifeHttpAppendEvidenceCommand {
  commandId: string;
  expectedRev: number;
  evidenceId: string;
  kind: V4LifeEvidenceKind;
  title: string;
  submittedBy: string;
  payload: { summary: string; tags: string[]; amountCny?: number };
}

export interface V4LifeHttpSubmitWorkCommand {
  commandId: string;
  expectedRev: number;
  workItemId: string;
  actorId: string;
  outputSummary: string;
}

export interface V4LifeHttpRecordDecisionCommand {
  commandId: string;
  expectedRev: number;
  gateId: string;
  actorId: string;
  outcome: V4LifeDecision['outcome'];
  reason: string;
}

function parseEvidencePayload(value: unknown): V4LifeHttpAppendEvidenceCommand['payload'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const summary = asNonEmptyString(record.summary, 2000);
  const tags = asTags(record.tags);
  if (summary === undefined || tags === undefined) {
    return undefined;
  }
  if (!isOptionalAmountCny(record.amountCny)) {
    return undefined;
  }
  return record.amountCny === undefined ? { summary, tags } : { summary, tags, amountCny: record.amountCny };
}

/** Evidence 载荷（payload.summary/tags/amountCny）问题 → EVIDENCE_INVALID；其余字段问题 → INVALID_ENGINE_INPUT。 */
export function parseAppendEvidenceBody(body: Record<string, unknown>): V4LifeBodyParseResult<V4LifeHttpAppendEvidenceCommand> {
  const commandId = asNonEmptyString(body.commandId);
  const expectedRev = asNonNegativeInteger(body.expectedRev);
  const evidenceId = asNonEmptyString(body.evidenceId);
  const kind = asEvidenceKind(body.kind);
  const title = asNonEmptyString(body.title, 200);
  const submittedBy = asNonEmptyString(body.submittedBy);
  if (
    commandId === undefined ||
    expectedRev === undefined ||
    evidenceId === undefined ||
    kind === undefined ||
    title === undefined ||
    submittedBy === undefined
  ) {
    return { ok: false, code: 'INVALID_ENGINE_INPUT' };
  }
  const payload = parseEvidencePayload(body.payload);
  if (payload === undefined) {
    return { ok: false, code: 'EVIDENCE_INVALID' };
  }
  return {
    ok: true,
    command: { commandId, expectedRev, evidenceId, kind, title, submittedBy, payload },
  };
}

export function parseSubmitWorkBody(body: Record<string, unknown>): V4LifeBodyParseResult<V4LifeHttpSubmitWorkCommand> {
  const commandId = asNonEmptyString(body.commandId);
  const expectedRev = asNonNegativeInteger(body.expectedRev);
  const workItemId = asNonEmptyString(body.workItemId);
  const actorId = asNonEmptyString(body.actorId);
  const outputSummary = asNonEmptyString(body.outputSummary, 2000);
  if (
    commandId === undefined ||
    expectedRev === undefined ||
    workItemId === undefined ||
    actorId === undefined ||
    outputSummary === undefined
  ) {
    return { ok: false, code: 'INVALID_ENGINE_INPUT' };
  }
  return { ok: true, command: { commandId, expectedRev, workItemId, actorId, outputSummary } };
}

export function parseRecordDecisionBody(body: Record<string, unknown>): V4LifeBodyParseResult<V4LifeHttpRecordDecisionCommand> {
  const commandId = asNonEmptyString(body.commandId);
  const expectedRev = asNonNegativeInteger(body.expectedRev);
  const gateId = asNonEmptyString(body.gateId);
  const actorId = asNonEmptyString(body.actorId);
  const outcome = asDecisionOutcome(body.outcome);
  const reason = asNonEmptyString(body.reason, 2000);
  if (
    commandId === undefined ||
    expectedRev === undefined ||
    gateId === undefined ||
    actorId === undefined ||
    outcome === undefined ||
    reason === undefined
  ) {
    return { ok: false, code: 'INVALID_ENGINE_INPUT' };
  }
  return { ok: true, command: { commandId, expectedRev, gateId, actorId, outcome, reason } };
}

// ---------------------------------------------------------------------------
// P1 核验命令 body 解析（仅追加；既有解析器不得改名/改签名/改行为）
// ---------------------------------------------------------------------------

const VERIFICATION_TARGETS: readonly V4LifeVerificationTarget[] = ['unverified', 'verified', 'contradicted', 'stale'];

/** changeVerification 目标状态（'claimed' 只能是 append 初始值，本命令禁止 → 视为非法输入） */
export function asVerificationTarget(value: unknown): V4LifeVerificationTarget | undefined {
  return VERIFICATION_TARGETS.includes(value as V4LifeVerificationTarget)
    ? (value as V4LifeVerificationTarget)
    : undefined;
}

export interface V4LifeHttpChangeVerificationCommand {
  commandId: string;
  expectedRev: number;
  evidenceId: string;
  actorId: string;
  verificationStatus: V4LifeVerificationTarget;
  reason: string;
}

/** changeVerification body 解析（P1 核验命令）：目标状态非法（含 'claimed'）→ INVALID_ENGINE_INPUT 失败关闭。 */
export function parseChangeVerificationBody(body: Record<string, unknown>): V4LifeBodyParseResult<V4LifeHttpChangeVerificationCommand> {
  const commandId = asNonEmptyString(body.commandId);
  const expectedRev = asNonNegativeInteger(body.expectedRev);
  const evidenceId = asNonEmptyString(body.evidenceId);
  const actorId = asNonEmptyString(body.actorId);
  const verificationStatus = asVerificationTarget(body.verificationStatus);
  const reason = asNonEmptyString(body.reason, 2000);
  if (
    commandId === undefined ||
    expectedRev === undefined ||
    evidenceId === undefined ||
    actorId === undefined ||
    verificationStatus === undefined ||
    reason === undefined
  ) {
    return { ok: false, code: 'INVALID_ENGINE_INPUT' };
  }
  return {
    ok: true,
    command: { commandId, expectedRev, evidenceId, actorId, verificationStatus, reason },
  };
}

// ---------------------------------------------------------------------------
// 路由共享的引擎解析：已注册（含测试注入）优先；demo case 懒创建；其余视为不存在。
// ---------------------------------------------------------------------------

export function resolveV4LifeCaseEngine(caseId: string): V4LifeEngine | undefined {
  return getV4LifeEngine(caseId) ?? (caseId === V4LIFE_DEMO_CASE_ID ? getOrCreateV4LifeDemoEngine() : undefined);
}
