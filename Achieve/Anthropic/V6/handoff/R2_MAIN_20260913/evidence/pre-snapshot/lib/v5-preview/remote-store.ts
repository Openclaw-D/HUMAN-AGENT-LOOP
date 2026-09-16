// V6 远程尽调 · 独立存储（remote-store.json，schema v5-preview-remote-store@1）。
// 与 rows-store.json@1 完全独立：零迁移、既有 API 兼容。失败关闭：结构不符 → REMOTE_STORE_CORRUPT，
// 不部分修复、不静默重置。原子写（temp+rename）；每次调用重新读盘（外部改坏立即暴露）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type AnnotationRecord,
  type CalculationRecord,
  type EvidenceRecord,
  type RemoteIdempotencyEntry,
  type RemoteSessionRecord,
  type ReviewRecord,
  type RuleConfigRecord,
} from './remote-types.ts';

export const REMOTE_STORE_SCHEMA = 'v5-preview-remote-store@1';
const REMOTE_STORE_FILE_NAME = 'remote-store.json';

export class RemoteStoreError extends Error {
  readonly code: 'REMOTE_STORE_CORRUPT' | 'REMOTE_STORE_UNAVAILABLE';
  constructor(code: 'REMOTE_STORE_CORRUPT' | 'REMOTE_STORE_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'RemoteStoreError';
    this.code = code;
  }
}

function corrupt(detail: string): RemoteStoreError {
  return new RemoteStoreError('REMOTE_STORE_CORRUPT', `远程尽调存储损坏：${detail}`);
}

function unavailable(op: string): RemoteStoreError {
  return new RemoteStoreError('REMOTE_STORE_UNAVAILABLE', `远程尽调存储${op}失败（合成演示存储不可用）`);
}

/** 与 rows 数据目录共置但文件独立；V5_PREVIEW_DATA_DIR 语义不变。 */
function storeFile(): string {
  const dir = process.env.V5_PREVIEW_DATA_DIR ?? join(process.cwd(), '.v5-preview-data');
  return join(dir, REMOTE_STORE_FILE_NAME);
}

export interface RemoteStoreState {
  version: number;
  sessions: RemoteSessionRecord[];
  evidence: EvidenceRecord[];
  annotations: AnnotationRecord[];
  reviews: ReviewRecord[];
  calculations: CalculationRecord[];
  ruleConfig: RuleConfigRecord;
  idempotency: RemoteIdempotencyTable;
}

export const REMOTE_IDEMPOTENCY_CAPACITY = 500;

export class RemoteIdempotencyTable {
  private entries = new Map<string, { hash: string; response: unknown }>();

  lookup(requestId: string): { hash: string; response: unknown } | undefined {
    return this.entries.get(requestId);
  }

  record(entry: { requestId: string; hash: string; response: unknown }): void {
    if (this.entries.size >= REMOTE_IDEMPOTENCY_CAPACITY) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(entry.requestId, { hash: entry.hash, response: entry.response });
  }

  toJSON(): RemoteIdempotencyEntry[] {
    return [...this.entries.entries()].map(([requestId, v]) => ({ requestId, hash: v.hash, response: v.response }));
  }

  static fromJSON(list: unknown): RemoteIdempotencyTable {
    const table = new RemoteIdempotencyTable();
    if (!Array.isArray(list)) throw corrupt('idempotency 必须是数组');
    for (const item of list) {
      if (typeof item !== 'object' || item === null) throw corrupt('idempotency 项必须是对象');
      const o = item as Record<string, unknown>;
      if (typeof o.requestId !== 'string' || o.requestId.length === 0 || typeof o.hash !== 'string' || o.hash.length === 0) {
        throw corrupt('idempotency 项字段非法');
      }
      table.entries.set(o.requestId, { hash: o.hash, response: o.response });
    }
    return table;
  }
}

// ---------------------------------------------------------------------------
// 失败关闭校验（关键枚举与必备字段；只接收已知结构，不猜）
// ---------------------------------------------------------------------------

const SESSION_STATUSES: readonly string[] = ['scheduled', 'live', 'paused', 'ended'];
const DOMAIN_ROLES: readonly string[] = ['coordinator', 'business', 'policy', 'credit', 'commerce', 'asset', 'customer-actual-controller', 'customer-finance', 'customer-production'];
const PARTICIPANT_KINDS: readonly string[] = ['jianwei', 'business', 'domain', 'customer'];
const ATTENDANCE: readonly string[] = ['on_site_declared', 'on_site_confirmed', 'live_only', 'pending', 'absent'];
const VIDEO_STATES: readonly string[] = ['not_configured', 'connecting', 'connected', 'reconnecting', 'failed', 'ended'];
const VIDEO_PROVIDERS: readonly string[] = ['none', 'simulation'];
const SOURCE_TYPES: readonly string[] = ['simulation_fixture'];
const REVIEW_ACTIONS: readonly string[] = ['confirm', 'correct', 'request_resupply', 'request_retake', 'pause_round', 'escalate_human', 'resume_round'];
const CALC_STATUSES: readonly string[] = ['not_configured', 'missing_inputs', 'ready_for_review', 'blocked', 'stale'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reqStr(o: Record<string, unknown>, key: string, path: string): void {
  if (typeof o[key] !== 'string' || (o[key] as string).length === 0) throw corrupt(`${path}.${key} 必须是非空 string`);
}

function reqEnum(o: Record<string, unknown>, key: string, allowed: readonly string[], path: string): void {
  if (typeof o[key] !== 'string' || !allowed.includes(o[key] as string)) throw corrupt(`${path}.${key} 非法`);
}

function reqNum(o: Record<string, unknown>, key: string, path: string): void {
  if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) throw corrupt(`${path}.${key} 必须是有限 number`);
}

function reqDate(o: Record<string, unknown>, key: string, path: string): void {
  if (typeof o[key] !== 'string' || (o[key] as string).length === 0 || Number.isNaN(Date.parse(o[key] as string))) {
    throw corrupt(`${path}.${key} 必须是可解析时间字符串`);
  }
}

function validateSession(o: Record<string, unknown>, path: string): void {
  reqStr(o, 'sessionId', path);
  reqStr(o, 'projectId', path);
  reqStr(o, 'title', path);
  reqEnum(o, 'status', SESSION_STATUSES, path);
  if (typeof o.generation !== 'number' || !Number.isInteger(o.generation) || (o.generation as number) < 0) {
    throw corrupt(`${path}.generation 必须是非负整数`);
  }
  reqDate(o, 'createdAt', path);
  reqDate(o, 'updatedAt', path);
  if (!Array.isArray(o.participants)) throw corrupt(`${path}.participants 必须是数组`);
  for (const [i, p] of (o.participants as unknown[]).entries()) {
    if (!isPlainObject(p)) throw corrupt(`${path}.participants[${i}] 必须是对象`);
    const pp = `${path}.participants[${i}]`;
    reqStr(p, 'participantId', pp);
    reqStr(p, 'displayName', pp);
    reqEnum(p, 'kind', PARTICIPANT_KINDS, pp);
    reqEnum(p, 'domainRole', DOMAIN_ROLES, pp);
    reqEnum(p, 'attendance', ATTENDANCE, pp);
    if (typeof p.attendanceVerified !== 'boolean') throw corrupt(`${pp}.attendanceVerified 必须是 boolean`);
    if (typeof p.joined !== 'boolean') throw corrupt(`${pp}.joined 必须是 boolean`);
  }
  if (!isPlainObject(o.video)) throw corrupt(`${path}.video 必须是对象`);
  reqEnum(o.video, 'provider', VIDEO_PROVIDERS, `${path}.video`);
  reqEnum(o.video, 'state', VIDEO_STATES, `${path}.video`);
  reqStr(o.video, 'message', `${path}.video`);
}

function validateEvidence(o: Record<string, unknown>, path: string): void {
  reqStr(o, 'evidenceId', path);
  reqStr(o, 'projectId', path);
  reqStr(o, 'sessionId', path);
  reqStr(o, 'fixtureId', path);
  reqStr(o, 'title', path);
  reqEnum(o, 'sourceType', SOURCE_TYPES, path);
  reqDate(o, 'capturedAt', path);
  reqDate(o, 'receivedAt', path);
  if (o.mime !== 'image/svg+xml') throw corrupt(`${path}.mime 非法`);
  reqNum(o, 'width', path);
  reqNum(o, 'height', path);
  reqStr(o, 'sha256', path);
  reqNum(o, 'version', path);
  if (o.supersededBy !== null && typeof o.supersededBy !== 'string') throw corrupt(`${path}.supersededBy 必须是 null 或 string`);
  if (o.digestOf !== undefined && o.digestOf !== 'fixture_bytes' && o.digestOf !== 'fixture_meta_legacy') {
    throw corrupt(`${path}.digestOf 非法`);
  }
  // 兼容：缺 digestOf 的历史记录按 legacy 语义读取（读取侧补默认），不拒绝。
}

function validateAnnotation(o: Record<string, unknown>, path: string): void {
  reqStr(o, 'annotationId', path);
  reqStr(o, 'sessionId', path);
  reqStr(o, 'evidenceId', path);
  reqNum(o, 'evidenceVersion', path);
  if (!isPlainObject(o.rect)) throw corrupt(`${path}.rect 必须是对象`);
  for (const k of ['x', 'y', 'w', 'h']) reqNum(o.rect, k, `${path}.rect`);
  reqStr(o, 'question', path);
  reqStr(o, 'author', path);
  reqEnum(o, 'status', ['open', 'resolved'], path);
  reqNum(o, 'version', path);
  reqDate(o, 'createdAt', path);
  if (!Array.isArray(o.replies)) throw corrupt(`${path}.replies 必须是数组`);
  for (const [i, r] of (o.replies as unknown[]).entries()) {
    if (!isPlainObject(r)) throw corrupt(`${path}.replies[${i}] 必须是对象`);
    reqStr(r, 'replyId', `${path}.replies[${i}]`);
    reqEnum(r, 'kind', ['model_simulation', 'business', 'domain'], `${path}.replies[${i}]`);
    reqStr(r, 'author', `${path}.replies[${i}]`);
    reqStr(r, 'text', `${path}.replies[${i}]`);
    reqDate(r, 'at', `${path}.replies[${i}]`);
  }
}

function validateReview(o: Record<string, unknown>, path: string): void {
  reqStr(o, 'reviewId', path);
  reqStr(o, 'sessionId', path);
  reqEnum(o, 'targetType', ['evidence', 'annotation'], path);
  reqStr(o, 'targetId', path);
  reqNum(o, 'targetVersion', path);
  reqEnum(o, 'action', REVIEW_ACTIONS, path);
  reqStr(o, 'opinion', path);
  reqStr(o, 'reviewer', path);
  reqDate(o, 'at', path);
}

function validateCalculation(o: Record<string, unknown>, path: string): void {
  reqStr(o, 'calcId', path);
  reqStr(o, 'sessionId', path);
  reqEnum(o, 'status', CALC_STATUSES, path);
  if (!Array.isArray(o.reasons)) throw corrupt(`${path}.reasons 必须是数组`);
  if (!Array.isArray(o.inputs)) throw corrupt(`${path}.inputs 必须是数组`);
  for (const [i, input] of (o.inputs as unknown[]).entries()) {
    if (!isPlainObject(input)) throw corrupt(`${path}.inputs[${i}] 必须是对象`);
    reqStr(input, 'label', `${path}.inputs[${i}]`);
    reqStr(input, 'unit', `${path}.inputs[${i}]`);
    reqEnum(input, 'source', ['test_fixture', 'unconfigured'], `${path}.inputs[${i}]`);
    reqNum(input, 'version', `${path}.inputs[${i}]`);
    const v = input.value;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) throw corrupt(`${path}.inputs[${i}].value 必须是 null 或有限数`);
  }
  reqStr(o, 'inputDigest', path);
  if (!isPlainObject(o.basedOn)) throw corrupt(`${path}.basedOn 必须是对象`);
  reqNum(o.basedOn, 'remoteVersion', `${path}.basedOn`);
  if (typeof o.basedOn.ruleConfigStatus !== 'string') throw corrupt(`${path}.basedOn.ruleConfigStatus 必须是 string`);
  reqNum(o.basedOn, 'generation', `${path}.basedOn`);
  if (!isPlainObject(o.result)) throw corrupt(`${path}.result 必须是对象`);
  reqEnum(o.result, 'kind', ['none', 'test_arithmetic_observation'], `${path}.result`);
  if (o.result.kind === 'test_arithmetic_observation') {
    reqNum(o.result, 'totalCashFlow', `${path}.result`);
    reqNum(o.result, 'totalCost', `${path}.result`);
    reqNum(o.result, 'net', `${path}.result`);
  }
  reqDate(o, 'at', path);
  reqNum(o, 'version', path);
}

function validateRuleConfig(value: unknown, path: string): void {
  if (!isPlainObject(value)) throw corrupt(`${path} 必须是对象`);
  if (value.version !== 0 || value.status !== 'unconfigured') throw corrupt(`${path} 当前必须为 version 0 / unconfigured`);
  if (!isPlainObject(value.layers)) throw corrupt(`${path}.layers 必须是对象`);
  for (const k of ['technicalQuality', 'evidenceSufficiency', 'businessRisk', 'economics']) {
    if (value.layers[k] !== null) throw corrupt(`${path}.layers.${k} 当前必须为 null（未配置）`);
  }
}

function parseStored(parsed: unknown): RemoteStoreState {
  if (!isPlainObject(parsed)) throw corrupt('顶层必须是 JSON 对象');
  if (parsed.schema !== REMOTE_STORE_SCHEMA) throw corrupt(`schema 必须是 ${REMOTE_STORE_SCHEMA}`);
  reqNum(parsed, 'version', 'store');
  if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.annotations) || !Array.isArray(parsed.reviews) || !Array.isArray(parsed.calculations)) {
    throw corrupt('sessions/evidence/annotations/reviews/calculations 必须是数组');
  }
  (parsed.sessions as unknown[]).forEach((s, i) => { if (!isPlainObject(s)) throw corrupt(`sessions[${i}] 必须是对象`); validateSession(s, `sessions[${i}]`); });
  (parsed.evidence as unknown[]).forEach((e, i) => { if (!isPlainObject(e)) throw corrupt(`evidence[${i}] 必须是对象`); validateEvidence(e, `evidence[${i}]`); });
  (parsed.annotations as unknown[]).forEach((a, i) => { if (!isPlainObject(a)) throw corrupt(`annotations[${i}] 必须是对象`); validateAnnotation(a, `annotations[${i}]`); });
  (parsed.reviews as unknown[]).forEach((r, i) => { if (!isPlainObject(r)) throw corrupt(`reviews[${i}] 必须是对象`); validateReview(r, `reviews[${i}]`); });
  (parsed.calculations as unknown[]).forEach((c, i) => { if (!isPlainObject(c)) throw corrupt(`calculations[${i}] 必须是对象`); validateCalculation(c, `calculations[${i}]`); });
  validateRuleConfig(parsed.ruleConfig, 'ruleConfig');
  return {
    version: parsed.version as number,
    sessions: parsed.sessions as unknown as RemoteSessionRecord[],
    evidence: parsed.evidence as unknown as EvidenceRecord[],
    annotations: parsed.annotations as unknown as AnnotationRecord[],
    reviews: parsed.reviews as unknown as ReviewRecord[],
    calculations: parsed.calculations as unknown as CalculationRecord[],
    ruleConfig: parsed.ruleConfig as unknown as RuleConfigRecord,
    idempotency: RemoteIdempotencyTable.fromJSON(parsed.idempotency),
  };
}

export function emptyRemoteState(): RemoteStoreState {
  return {
    version: 1,
    sessions: [],
    evidence: [],
    annotations: [],
    reviews: [],
    calculations: [],
    ruleConfig: { version: 0, status: 'unconfigured', layers: { technicalQuality: null, evidenceSufficiency: null, businessRisk: null, economics: null } },
    idempotency: new RemoteIdempotencyTable(),
  };
}

/** 读取远程尽调状态；文件不存在 → 空状态落盘；损坏 → REMOTE_STORE_CORRUPT（不静默重置）。 */
export function readRemoteStoreState(): RemoteStoreState {
  const file = storeFile();
  if (!existsSync(file)) {
    const seeded = emptyRemoteState();
    persistRemoteStoreState(seeded);
    return seeded;
  }
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw unavailable('读取');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw corrupt(`文件不是合法 JSON（${error instanceof Error ? error.message : String(error)}）`);
  }
  return parseStored(parsed);
}

export function persistRemoteStoreState(state: RemoteStoreState): void {
  const file = storeFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const stored = {
      schema: REMOTE_STORE_SCHEMA,
      version: state.version,
      sessions: state.sessions,
      evidence: state.evidence,
      annotations: state.annotations,
      reviews: state.reviews,
      calculations: state.calculations,
      ruleConfig: state.ruleConfig,
      idempotency: state.idempotency.toJSON(),
    };
    writeFileSync(tmp, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    throw unavailable('写入');
  }
}
