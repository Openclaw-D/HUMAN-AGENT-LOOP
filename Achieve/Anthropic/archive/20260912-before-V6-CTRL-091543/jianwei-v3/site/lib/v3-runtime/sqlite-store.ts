import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import {
  createV3AuthorityRuntime,
  type V3AuthorityEvent,
  type V3ProcessRun,
  type V3Receipt,
} from '../v3-authority-runtime.ts';
import {
  V3_SCENARIO_CASES,
  V3_SCENARIO_PROCESS_IDS,
  V3_SCENARIO_REF,
  type V3ScenarioCase,
} from '../v3-demo-scenario.ts';
import {
  getV3PrincipalPolicy,
  type V3PrincipalId,
  type V3CanonicalPrincipalId,
  type V3InvitationScope,
  type V3RoleApplicationId,
} from '../v3-role-authority.ts';

import {
  createV3SeedContexts,
  V3_SHARED_DEMO_CASES,
  V3_SHARED_PORTFOLIO,
  V3_SHARED_SCENARIO_REF,
} from '../v3-surfaces/shared/demo-fixtures.ts';
import type { V3SharedDemoCase } from '../v3-surfaces/shared/demo-fixtures.ts';
import type {
  V3CandidateReply,
  V3ChatRouteState,
  V3ContextReadModel,
  V3ContextSelector,
  V3PersistedMessage,
  V3ProfessionalRole,
  V3RoleProjectionId,
  V3ScenarioRef,
  V3SendMessageResult,
} from '../v3-surfaces/shared/contracts.ts';

export type V3StoredCase = V3SharedDemoCase & V3ScenarioCase;

export type V3StoredEvent = {
  eventId: string;
  eventType: string;
  contextId: string;
  caseId: string | null;
  actorRole: string;
  authority: 'none' | 'confirmed_human';
  payload: Record<string, unknown>;
  createdAt: string;
};

export type V3StoredReceipt = {
  receiptId: string;
  receiptType:
    | 'scenario_source'
    | 'message_delivery'
    | 'message_retry'
    | 'evidence'
    | 'context_commit'
    | 'human_gate'
    | 'management_action'
    | 'commencement';
  contextId: string;
  caseId: string | null;
  status: string;
  authority: 'none' | 'confirmed_human';
  formal: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
};

type V3AuthorityOperation =
  | 'acceptEvidence'
  | 'commitContext'
  | 'updateProcessRun'
  | 'recordHumanGate'
  | 'recordManagementAction'
  | 'recordMessage'
  | 'recordCommencement';

type V3AuthorityCommandRow = {
  operation: V3AuthorityOperation;
  input_json: string;
  executed_at: string;
};

type V3AuthorityRuntime = ReturnType<typeof createV3AuthorityRuntime>;
type V3AuthoritySnapshot = ReturnType<V3AuthorityRuntime['snapshot']>;

const V3_SCHEMA_VERSION = 5;
const V3_BUSY_TIMEOUT_MS = 250;

export type V3StoredDemoSession = {
  sessionId: string;
  principalId: V3CanonicalPrincipalId;
  roleApplicationId: V3RoleApplicationId;
  invitation: V3InvitationScope | null;
  createdAt: string;
  expiresAt: string;
};

export type V3HumanGateResult = {
  requestId: string;
  contextVersion: string;
  processId: V3ProfessionalRole;
  principalId: string;
  decision: 'confirm' | 'reject' | 'return_for_evidence';
  eventId: string;
  receiptId: string;
  authority: 'confirmed_human';
  formal: true;
  replayed: boolean;
};

type CandidateDraft = {
  routedTo: V3CandidateReply['routedTo'];
  text: string;
};

type PersistChatInput = {
  requestId: string;
  signature: string;
  context: V3ContextReadModel;
  actorRole: V3RoleProjectionId;
  text: string;
  routes: V3ChatRouteState[];
  candidateDrafts: CandidateDraft[];
  now: string;
};

type PersistRetryInput = {
  requestId: string;
  signature: string;
  originalMessage: V3PersistedMessage;
  routes: V3ChatRouteState[];
  candidateDrafts: CandidateDraft[];
  now: string;
};

type IdempotencyRow = {
  signature: string;
  response_json: string;
};

export type V3DemoResetResult = {
  runtimeEpoch: string;
  scenarioRef: V3ScenarioRef;
  contextCount: number;
  caseCount: number;
  messageCount: number;
  eventCount: number;
  receiptCount: number;
  replayed: boolean;
};

type ContextRow = {
  context_id: string;
  grain: V3ContextReadModel['grain'];
  portfolio_id: string;
  division_id: string | null;
  case_id: string | null;
  context_version: string;
  label: string;
  parent_context_id: string | null;
  scenario_id: string;
  scenario_version: string;
};

type MessageRow = {
  message_id: string;
  context_id: string;
  context_version: string;
  request_id: string;
  actor_kind: 'human' | 'agent';
  actor_role: V3RoleProjectionId | 'jw';
  authority: 'none';
  text: string;
  reply_to_message_id: string | null;
  scenario_id: string;
  scenario_version: string;
  created_at: string;
};

type DemoSessionRow = {
  session_id: string;
  principal_id: string;
  role_application_id: string;
  invitation_json: string | null;
  created_at: string;
  expires_at: string;
};

function insertDemoSession(database: DatabaseSync, session: V3StoredDemoSession): V3StoredDemoSession {
  const sessionId = session.sessionId.trim();
  const createdAt = Date.parse(session.createdAt);
  const expiresAt = Date.parse(session.expiresAt);
  if (!sessionId || Number.isNaN(createdAt) || Number.isNaN(expiresAt) || expiresAt <= createdAt) {
    throw failure('INVALID_SESSION_RECORD', '演示会话记录无效');
  }
  database.prepare(`
    INSERT INTO demo_sessions (
      session_id, principal_id, role_application_id, invitation_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    session.principalId,
    session.roleApplicationId,
    session.invitation ? JSON.stringify(session.invitation) : null,
    session.createdAt,
    session.expiresAt,
  );
  return structuredClone({ ...session, sessionId });
}

function readDemoSession(database: DatabaseSync, sessionId: string, now: string): V3StoredDemoSession {
  const resolvedNow = Date.parse(now);
  if (Number.isNaN(resolvedNow)) throw failure('INVALID_SESSION_TIME', '演示会话时间无效');
  const row = database.prepare(`
    SELECT session_id, principal_id, role_application_id, invitation_json, created_at, expires_at
    FROM demo_sessions WHERE session_id = ?
  `).get(sessionId) as DemoSessionRow | undefined;
  if (!row) throw failure('DEMO_SESSION_NOT_FOUND', '演示会话不存在');
  if (Date.parse(row.expires_at) <= resolvedNow) {
    throw failure('DEMO_SESSION_EXPIRED', '演示会话已过期');
  }
  let invitation: V3InvitationScope | null = null;
  try {
    invitation = row.invitation_json === null
      ? null
      : JSON.parse(row.invitation_json) as V3InvitationScope;
  } catch {
    throw failure('DEMO_SESSION_MISMATCH', '演示会话授权记录不一致');
  }
  let policy: ReturnType<typeof getV3PrincipalPolicy>;
  try {
    policy = getV3PrincipalPolicy(row.principal_id);
  } catch {
    throw failure('DEMO_SESSION_MISMATCH', '演示会话授权记录不一致');
  }
  if (
    policy.principalId !== row.principal_id ||
    policy.roleApplicationId !== row.role_application_id ||
    policy.requiresInvitation !== Boolean(invitation)
  ) {
    throw failure('DEMO_SESSION_MISMATCH', '演示会话授权记录不一致');
  }
  if (invitation) {
    if (
      invitation.status !== 'active' ||
      invitation.principalId !== row.principal_id ||
      !Array.isArray(invitation.allowedActionTypes)
    ) {
      throw failure('DEMO_SESSION_MISMATCH', '演示会话邀请范围不一致');
    }
    const caseRow = database.prepare(`
      SELECT case_tier, read_only FROM cases WHERE case_id = ?
    `).get(invitation.caseId) as { case_tier: string; read_only: number } | undefined;
    if (!caseRow || caseRow.case_tier !== 'golden' || caseRow.read_only === 1) {
      throw failure('DEMO_SESSION_MISMATCH', '演示会话事项范围无效');
    }
  }
  return {
    sessionId: row.session_id,
    principalId: policy.principalId,
    roleApplicationId: policy.roleApplicationId,
    invitation: structuredClone(invitation),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function normalizedSqliteError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code.includes('BUSY') || code.includes('LOCKED') || /database is (?:busy|locked)/i.test(message)) {
    return Object.assign(new Error('SQLite 暂时被锁定，请重试'), {
      code: 'SQLITE_BUSY_RETRYABLE',
      retryable: true,
      cause: error,
    });
  }
  return error;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function scenarioRef(row: { scenario_id: string; scenario_version: string }): V3ScenarioRef {
  return {
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    dataClass: 'synthetic_deidentified_demo',
  };
}

function mapContext(row: ContextRow): V3ContextReadModel {
  return {
    contextId: row.context_id,
    grain: row.grain,
    portfolioId: row.portfolio_id,
    divisionId: row.division_id,
    caseId: row.case_id,
    contextVersion: row.context_version,
    label: row.label,
    parentContextId: row.parent_context_id,
    scenarioRef: scenarioRef(row),
  };
}

function mapMessage(row: MessageRow): V3PersistedMessage {
  return {
    messageId: row.message_id,
    contextId: row.context_id,
    contextVersion: row.context_version,
    requestId: row.request_id,
    actorKind: row.actor_kind,
    actorRole: row.actor_role,
    authority: row.authority,
    text: row.text,
    replyToMessageId: row.reply_to_message_id,
    scenarioRef: scenarioRef(row),
    createdAt: row.created_at,
  };
}

function fileTarget(filePath: string): string | URL {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return new URL(`file:///${normalized}`);
  if (normalized.startsWith('/')) return new URL(`file://${normalized}`);
  return filePath;
}

function sqliteTarget(databasePath: string): string | URL {
  return databasePath === ':memory:' ? databasePath : fileTarget(databasePath);
}

export function defaultV3SqlitePath(): string {
  const configured = process.env.JIANWEI_V3_SQLITE_PATH?.trim();
  if (configured) return configured;
  if (process.env.NODE_TEST_CONTEXT) {
    return join(tmpdir(), 'jianwei-v3-tests', `shared-${process.pid}.sqlite`);
  }
  return join(process.cwd(), '.data', 'jianwei-v3-shared.sqlite');
}

export class V3SqliteStore {
  readonly databasePath: string;
  private readonly database: DatabaseSync;

  constructor(databasePath = defaultV3SqlitePath()) {
    this.databasePath = databasePath;
    const databaseDirectory = dirname(databasePath);
    if (databasePath !== ':memory:' && !existsSync(fileTarget(databaseDirectory))) {
      mkdirSync(fileTarget(databaseDirectory), { recursive: true });
    }
    this.database = new DatabaseSync(sqliteTarget(databasePath));
    try {
      this.database.exec(`PRAGMA busy_timeout = ${V3_BUSY_TIMEOUT_MS}`);
      this.database.exec('PRAGMA foreign_keys = ON');
      this.createSchema();
      if (databasePath !== ':memory:') this.database.exec('PRAGMA journal_mode = WAL');
      this.ensureSeeded();
      this.assertDatabaseIntegrity();
    } catch (error) {
      try { this.database.close(); } catch { /* constructor failure cleanup */ }
      throw normalizedSqliteError(error);
    }
  }

  close(): void {
    this.database.close();
  }

  getRuntimeEpoch(): string {
    return this.getMetadata('runtime_epoch') ?? 'DEMO-EPOCH-0001';
  }

  createDemoSession(session: V3StoredDemoSession): V3StoredDemoSession {
    return this.inTransaction(() => insertDemoSession(this.database, session));
  }

  resolveDemoSession(sessionId: string, now: string): V3StoredDemoSession {
    return readDemoSession(this.database, sessionId, now);
  }

  resolveContext(selector: V3ContextSelector): V3ContextReadModel {
    const clauses = ['grain = ?', 'portfolio_id = ?'];
    const values: Array<string | null> = [selector.grain, selector.portfolioId];
    if (selector.grain === 'portfolio') {
      clauses.push('division_id IS NULL', 'case_id IS NULL');
    } else if (selector.grain === 'division') {
      if (!selector.divisionId || selector.caseId !== null) {
        throw failure('INVALID_CONTEXT_SELECTOR', 'division grain 需要 divisionId 且不能包含 caseId');
      }
      clauses.push('division_id = ?', 'case_id IS NULL');
      values.push(selector.divisionId);
    } else {
      if (!selector.divisionId || !selector.caseId) {
        throw failure('INVALID_CONTEXT_SELECTOR', 'case grain 需要 divisionId 与 caseId');
      }
      clauses.push('division_id = ?', 'case_id = ?');
      values.push(selector.divisionId, selector.caseId);
    }
    const row = this.database.prepare(`
      SELECT context_id, grain, portfolio_id, division_id, case_id, context_version,
             label, parent_context_id, scenario_id, scenario_version
      FROM contexts WHERE ${clauses.join(' AND ')}
    `).get(...values) as ContextRow | undefined;
    if (!row) throw failure('CONTEXT_NOT_FOUND', '上下文不存在');
    return mapContext(row);
  }

  listContexts(): V3ContextReadModel[] {
    const rows = this.database.prepare(`
      SELECT context_id, grain, portfolio_id, division_id, case_id, context_version,
             label, parent_context_id, scenario_id, scenario_version
      FROM contexts
      ORDER BY CASE grain WHEN 'portfolio' THEN 0 WHEN 'division' THEN 1 ELSE 2 END,
               division_id, case_id
    `).all() as unknown as ContextRow[];
    return rows.map(mapContext);
  }

  listCases(selector?: Pick<V3ContextSelector, 'grain' | 'divisionId' | 'caseId'>): V3StoredCase[] {
    const rows = this.database.prepare(`
      SELECT case_id, case_tier, read_only, division_id, payload_json
      FROM cases ORDER BY case_id
    `).all() as unknown as Array<{
      case_id: string;
      case_tier: V3StoredCase['caseTier'];
      read_only: number;
      division_id: string;
      payload_json: string;
    }>;
    const all = rows.map((row) => ({
      ...(parseRecord(row.payload_json) as V3StoredCase),
      caseId: row.case_id,
      caseTier: row.case_tier,
      readOnly: row.read_only === 1,
      divisionId: row.division_id,
    }));
    if (!selector || selector.grain === 'portfolio') return all;
    if (selector.grain === 'division') return all.filter((item) => item.divisionId === selector.divisionId);
    return all.filter((item) => item.caseId === selector.caseId);
  }

  getCase(caseId: string): V3StoredCase {
    const item = this.listCases().find((candidate) => candidate.caseId === caseId);
    if (!item) throw failure('CASE_NOT_FOUND', '事项不存在');
    return structuredClone(item);
  }

  listMessages(contextId: string): V3PersistedMessage[] {
    const rows = this.database.prepare(`
      SELECT message_id, context_id, context_version, request_id, actor_kind, actor_role,
             authority, text, reply_to_message_id, scenario_id, scenario_version, created_at
      FROM messages WHERE context_id = ? ORDER BY sequence ASC
    `).all(contextId) as unknown as MessageRow[];
    return rows.map(mapMessage);
  }

  getMessage(messageId: string): V3PersistedMessage {
    const row = this.database.prepare(`
      SELECT message_id, context_id, context_version, request_id, actor_kind, actor_role,
             authority, text, reply_to_message_id, scenario_id, scenario_version, created_at
      FROM messages WHERE message_id = ?
    `).get(messageId) as MessageRow | undefined;
    if (!row) throw failure('MESSAGE_NOT_FOUND', '消息不存在');
    return mapMessage(row);
  }

  getIdempotentMessageResult(
    operation: 'chat' | 'retry',
    requestId: string,
    signature: string,
  ): V3SendMessageResult | null {
    const replay = this.readIdempotentResult<V3SendMessageResult>(operation, requestId, signature);
    return replay ? { ...replay, replayed: true } : null;
  }

  listEvents(): V3StoredEvent[] {
    const rows = this.database.prepare(`
      SELECT event_id, event_type, context_id, case_id, actor_role, authority, payload_json, created_at
      FROM events ORDER BY sequence ASC
    `).all() as unknown as Array<{
      event_id: string;
      event_type: string;
      context_id: string;
      case_id: string | null;
      actor_role: string;
      authority: V3StoredEvent['authority'];
      payload_json: string;
      created_at: string;
    }>;
    const shared = rows.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      contextId: row.context_id,
      caseId: row.case_id,
      actorRole: row.actor_role,
      authority: row.authority,
      payload: parseRecord(row.payload_json),
      createdAt: row.created_at,
    }));
    const authority = this.getAuthoritySnapshot().events.map<V3StoredEvent>((event) => ({
      eventId: event.eventId,
      eventType: event.type,
      contextId: `CTX-${event.caseId}`,
      caseId: event.caseId,
      actorRole: event.actor.roleApplicationId,
      authority: event.actor.authority === 'confirmed' ? 'confirmed_human' : 'none',
      payload: {
        correlationId: event.correlationId,
        causationId: event.causationId,
        contextVersion: event.contextVersion ?? null,
        principalId: event.actor.principalId,
        ...structuredClone(event.payload),
      },
      createdAt: event.recordedAt,
    }));
    return [...shared, ...authority].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId));
  }

  listReceipts(): V3StoredReceipt[] {
    const rows = this.database.prepare(`
      SELECT receipt_id, receipt_type, context_id, case_id, status, authority, formal,
             payload_json, created_at FROM receipts ORDER BY sequence ASC
    `).all() as unknown as Array<{
      receipt_id: string;
      receipt_type: V3StoredReceipt['receiptType'];
      context_id: string;
      case_id: string | null;
      status: string;
      authority: V3StoredReceipt['authority'];
      formal: number;
      payload_json: string;
      created_at: string;
    }>;
    const shared = rows.map((row) => ({
      receiptId: row.receipt_id,
      receiptType: row.receipt_type,
      contextId: row.context_id,
      caseId: row.case_id,
      status: row.status,
      authority: row.authority,
      formal: row.formal === 1,
      payload: parseRecord(row.payload_json),
      createdAt: row.created_at,
    }));
    const authority = this.getAuthoritySnapshot().receipts.map<V3StoredReceipt>((receipt) => ({
      receiptId: receipt.receiptId,
      receiptType: receipt.receiptType,
      contextId: `CTX-${receipt.caseId}`,
      caseId: receipt.caseId,
      status: receipt.status,
      authority: 'confirmed_human',
      formal: true,
      payload: {
        eventId: receipt.eventId,
        contextVersion: receipt.contextVersion,
        principalId: receipt.principalId,
        processId: receipt.processId ?? null,
        actionType: receipt.actionType ?? null,
        invitationId: receipt.invitationId ?? null,
        evidenceReceiptIds: [...receipt.evidenceReceiptIds],
        ...structuredClone(receipt.details),
      },
      createdAt: receipt.recordedAt,
    }));
    return [...shared, ...authority].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.receiptId.localeCompare(right.receiptId));
  }

  getAuthoritySnapshot(): V3AuthoritySnapshot {
    return this.buildAuthorityRuntime().snapshot();
  }

  listAuthorityEvents(afterSequence = 0, limit = 100) {
    return this.buildAuthorityRuntime().listEvents(afterSequence, limit);
  }

  authorityAcceptEvidence(
    input: Parameters<V3AuthorityRuntime['acceptEvidence']>[0] & { caseId?: string },
    now: string,
  ): V3Receipt {
    return this.executeAuthorityCommand('acceptEvidence', input, now) as V3Receipt;
  }

  authorityCommitContext(
    input: Parameters<V3AuthorityRuntime['commitContext']>[0] & { caseId?: string },
    now: string,
  ): ReturnType<V3AuthorityRuntime['commitContext']> {
    return this.executeAuthorityCommand('commitContext', input, now) as ReturnType<V3AuthorityRuntime['commitContext']>;
  }

  authorityUpdateProcessRun(
    input: Parameters<V3AuthorityRuntime['updateProcessRun']>[0] & { caseId?: string },
    now: string,
  ): V3ProcessRun {
    return this.executeAuthorityCommand('updateProcessRun', input, now) as V3ProcessRun;
  }

  authorityRecordHumanGate(
    input: Parameters<V3AuthorityRuntime['recordHumanGate']>[0] & { caseId?: string },
    now: string,
  ): V3Receipt {
    this.assertGateEvidenceLineage(input.caseId ?? V3_SCENARIO_REF.caseId, input.expectedContextVersion, input.evidenceReceiptIds);
    return this.executeAuthorityCommand('recordHumanGate', input, now) as V3Receipt;
  }

  authorityRecordManagementAction(
    input: Parameters<V3AuthorityRuntime['recordManagementAction']>[0] & { caseId?: string },
    now: string,
  ): V3Receipt {
    return this.executeAuthorityCommand('recordManagementAction', input, now) as V3Receipt;
  }

  authorityRecordMessage(
    input: Parameters<V3AuthorityRuntime['recordMessage']>[0] & { caseId?: string },
    now: string,
  ): V3AuthorityEvent {
    return this.executeAuthorityCommand('recordMessage', input, now) as V3AuthorityEvent;
  }

  authorityRecordCommencement(
    input: Parameters<V3AuthorityRuntime['recordCommencement']>[0] & { caseId?: string },
    now: string,
  ): V3Receipt {
    return this.executeAuthorityCommand('recordCommencement', input, now) as V3Receipt;
  }

  persistChat(input: PersistChatInput): V3SendMessageResult {
    const replay = this.readIdempotentResult<V3SendMessageResult>('chat', input.requestId, input.signature);
    if (replay) return { ...replay, replayed: true };
    return this.inTransaction(() => {
      const concurrentReplay = this.readIdempotentResult<V3SendMessageResult>('chat', input.requestId, input.signature);
      if (concurrentReplay) return { ...concurrentReplay, replayed: true };
      const message = this.insertMessage({
        context: input.context,
        requestId: input.requestId,
        actorKind: 'human',
        actorRole: input.actorRole,
        text: input.text,
        replyToMessageId: null,
        createdAt: input.now,
      });
      this.insertEvent(
        'CHAT_MESSAGE_RECEIVED',
        input.context,
        input.actorRole,
        { messageId: message.messageId, requestId: input.requestId },
        input.now,
      );
      const candidates = input.candidateDrafts.map((draft) =>
        this.insertCandidate(draft, message, input.context, input.now));
      const receiptId = this.insertReceipt(
        'message_delivery',
        input.context,
        'delivered',
        { messageId: message.messageId, routeStates: input.routes.map((route) => route.status) },
        input.now,
      );
      const result: V3SendMessageResult = {
        status: 'accepted',
        completion: 'message_persisted',
        authority: 'none',
        message,
        routes: structuredClone(input.routes),
        candidates,
        receiptId,
        replayed: false,
      };
      this.rememberIdempotentResult('chat', input.requestId, input.signature, result, input.now);
      return structuredClone(result);
    });
  }

  persistRetry(input: PersistRetryInput): V3SendMessageResult {
    const replay = this.readIdempotentResult<V3SendMessageResult>('retry', input.requestId, input.signature);
    if (replay) return { ...replay, replayed: true };
    return this.inTransaction(() => {
      const concurrentReplay = this.readIdempotentResult<V3SendMessageResult>('retry', input.requestId, input.signature);
      if (concurrentReplay) return { ...concurrentReplay, replayed: true };
      const context = this.getContextById(input.originalMessage.contextId);
      this.insertEvent(
        'CHAT_ROUTE_RETRIED',
        context,
        input.originalMessage.actorRole,
        { messageId: input.originalMessage.messageId, retryRequestId: input.requestId },
        input.now,
      );
      const candidates = input.candidateDrafts.map((draft) =>
        this.insertCandidate(draft, input.originalMessage, context, input.now));
      const receiptId = this.insertReceipt(
        'message_retry',
        context,
        'delivered',
        { messageId: input.originalMessage.messageId, routeStates: input.routes.map((route) => route.status) },
        input.now,
      );
      const result: V3SendMessageResult = {
        status: 'accepted',
        completion: 'message_persisted',
        authority: 'none',
        message: structuredClone(input.originalMessage),
        routes: structuredClone(input.routes),
        candidates,
        receiptId,
        replayed: false,
      };
      this.rememberIdempotentResult('retry', input.requestId, input.signature, result, input.now);
      return structuredClone(result);
    });
  }

  persistHumanGate(input: {
    requestId: string;
    actorRole: V3ProfessionalRole;
    principalId: string;
    processId: V3ProfessionalRole;
    context: V3ContextSelector;
    expectedContextVersion: string;
    decision: 'confirm' | 'reject' | 'return_for_evidence';
    rationale: string;
    evidenceReceiptIds: string[];
    now: string;
  }): V3HumanGateResult {
    const expectedPrincipal: Record<V3ProfessionalRole, string> = {
      policy: 'risk-policy', credit: 'risk-credit', commercial: 'risk-commercial', asset: 'risk-asset',
    };
    if (input.actorRole !== input.processId || input.principalId !== expectedPrincipal[input.processId]) {
      throw failure('ACTION_SCOPE_DENIED', '只有本专业具名角色可提交 Human Gate');
    }
    if (!input.requestId.trim() || !input.rationale.trim() || input.evidenceReceiptIds.length === 0) {
      throw failure('INVALID_INPUT', 'Human Gate 需要 requestId、rationale 与 Evidence Receipt');
    }
    const evidenceReceiptIds = [...new Set(input.evidenceReceiptIds.map((value) => value.trim()).filter(Boolean))];
    if (evidenceReceiptIds.length === 0) throw failure('EVIDENCE_REQUIRED', 'Human Gate 必须引用具名 Evidence Receipt');
    const context = this.resolveContext(input.context);
    if (!context.caseId || this.getCase(context.caseId).readOnly) throw failure('BACKGROUND_CASE_READ_ONLY', '背景 Case 不允许写入 Human Gate');
    const before = this.database.prepare(`
      SELECT response_json FROM authority_idempotency
      WHERE runtime_epoch = ? AND operation = 'recordHumanGate' AND request_id = ?
    `).get(this.getRuntimeEpoch(), input.requestId.trim()) as { response_json: string } | undefined;
    const receipt = this.authorityRecordHumanGate({
      caseId: context.caseId,
      requestId: input.requestId.trim(),
      principalId: input.principalId as V3PrincipalId,
      roleApplicationId: 'risk',
      expectedContextVersion: input.expectedContextVersion.trim(),
      processId: input.processId,
      gateMode: input.decision === 'confirm' ? 'HUMAN_CONFIRM' : 'HUMAN_DECIDE',
      decision: input.decision,
      rationale: input.rationale.trim(),
      evidenceReceiptIds,
    }, input.now);
    return {
      requestId: input.requestId.trim(),
      contextVersion: receipt.contextVersion,
      processId: input.processId,
      principalId: input.principalId,
      decision: input.decision,
      eventId: receipt.eventId,
      receiptId: receipt.receiptId,
      authority: 'confirmed_human',
      formal: true,
      replayed: Boolean(before),
    };
  }

  demoReset(input: {
    requestId: string;
    actorRole: V3RoleProjectionId;
    confirmation: string;
    now: string;
  }): V3DemoResetResult {
    if (input.actorRole !== 'leadership') throw failure('ACTION_SCOPE_DENIED', '仅 leadership demo controller 可重置');
    if (input.confirmation !== 'RESET_DEMO') throw failure('RESET_CONFIRMATION_REQUIRED', '需要明确 Demo Reset 确认');
    const requestId = input.requestId.trim();
    if (!requestId) throw failure('INVALID_INPUT', 'Demo Reset requestId 不能为空');
    const signature = stableJson({ actorRole: input.actorRole, confirmation: input.confirmation });
    const existing = this.database.prepare(
      'SELECT signature, response_json FROM demo_resets WHERE request_id = ?',
    ).get(requestId) as IdempotencyRow | undefined;
    if (existing) {
      if (existing.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一 requestId 的 Demo Reset 载荷不一致');
      return { ...(JSON.parse(existing.response_json) as V3DemoResetResult), replayed: true };
    }
    return this.inTransaction(() => {
      const nextResetSequence = Number(this.getMetadata('reset_sequence') ?? '1') + 1;
      this.database.exec(`
        DELETE FROM authority_evidence;
        DELETE FROM authority_receipts;
        DELETE FROM authority_events;
        DELETE FROM authority_process_runs;
        DELETE FROM authority_context_versions;
        DELETE FROM authority_idempotency;
        DELETE FROM authority_commands;
        DELETE FROM idempotency;
        DELETE FROM messages;
        DELETE FROM events;
        DELETE FROM receipts;
        DELETE FROM contexts;
        DELETE FROM cases;
      `);
      this.setMetadata('reset_sequence', String(nextResetSequence));
      this.setMetadata('runtime_epoch', `DEMO-EPOCH-${String(nextResetSequence).padStart(4, '0')}`);
      this.setMetadata('authority_baseline_at', input.now);
      this.resetCounters();
      this.seed(input.now);
      this.syncAuthorityProjection(this.buildAuthorityRuntime().snapshot());
      const response = {
        runtimeEpoch: this.getRuntimeEpoch(),
        scenarioRef: structuredClone(V3_SHARED_SCENARIO_REF),
        contextCount: this.count('contexts'),
        caseCount: this.count('cases'),
        messageCount: this.count('messages'),
        eventCount: this.count('events'),
        receiptCount: this.count('receipts'),
        replayed: false,
      };
      this.database.prepare(`
        INSERT INTO demo_resets (request_id, signature, response_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(requestId, signature, JSON.stringify(response), input.now);
      return response;
    });
  }

  private createSchema(): void {
    const version = Number((this.database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version > V3_SCHEMA_VERSION) {
      throw failure('SCHEMA_VERSION_UNSUPPORTED', `SQLite schema v${version} 高于当前支持的 v${V3_SCHEMA_VERSION}`);
    }
    try {
      this.database.exec('BEGIN IMMEDIATE');
      this.database.exec(`
      CREATE TABLE IF NOT EXISTS migration_ledger (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cases (
        case_id TEXT PRIMARY KEY,
        case_tier TEXT NOT NULL CHECK (case_tier IN ('golden', 'background')),
        read_only INTEGER NOT NULL CHECK (read_only IN (0, 1)),
        portfolio_id TEXT NOT NULL,
        division_id TEXT NOT NULL,
        label TEXT NOT NULL,
        phase TEXT NOT NULL,
        attention TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        scenario_version TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS contexts (
        context_id TEXT PRIMARY KEY,
        grain TEXT NOT NULL CHECK (grain IN ('portfolio', 'division', 'case')),
        portfolio_id TEXT NOT NULL,
        division_id TEXT,
        case_id TEXT,
        context_version TEXT NOT NULL,
        label TEXT NOT NULL,
        parent_context_id TEXT,
        scenario_id TEXT NOT NULL,
        scenario_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (parent_context_id) REFERENCES contexts(context_id),
        FOREIGN KEY (case_id) REFERENCES cases(case_id)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS contexts_selector_unique
        ON contexts(grain, portfolio_id, COALESCE(division_id, ''), COALESCE(case_id, ''));
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        context_id TEXT NOT NULL,
        context_version TEXT NOT NULL,
        request_id TEXT NOT NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent')),
        actor_role TEXT NOT NULL,
        authority TEXT NOT NULL CHECK (authority = 'none'),
        text TEXT NOT NULL,
        reply_to_message_id TEXT,
        scenario_id TEXT NOT NULL,
        scenario_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (context_id) REFERENCES contexts(context_id),
        FOREIGN KEY (reply_to_message_id) REFERENCES messages(message_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        context_id TEXT NOT NULL,
        case_id TEXT,
        actor_role TEXT NOT NULL,
        authority TEXT NOT NULL CHECK (authority IN ('none', 'confirmed_human')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (context_id) REFERENCES contexts(context_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS receipts (
        receipt_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        receipt_type TEXT NOT NULL CHECK (receipt_type IN ('scenario_source', 'message_delivery', 'message_retry', 'human_gate')),
        context_id TEXT NOT NULL,
        case_id TEXT,
        status TEXT NOT NULL,
        authority TEXT NOT NULL CHECK (authority IN ('none', 'confirmed_human')),
        formal INTEGER NOT NULL CHECK (formal IN (0, 1)),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (context_id) REFERENCES contexts(context_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS idempotency (
        operation TEXT NOT NULL,
        request_id TEXT NOT NULL,
        signature TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (operation, request_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS demo_resets (
        request_id TEXT PRIMARY KEY,
        signature TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS demo_sessions (
        session_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        role_application_id TEXT NOT NULL CHECK (role_application_id IN ('leadership', 'business', 'risk', 'external')),
        invitation_json TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS demo_sessions_expires_at ON demo_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS authority_commands (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_epoch TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_id TEXT NOT NULL,
        signature TEXT NOT NULL,
        input_json TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        UNIQUE(runtime_epoch, operation, request_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_idempotency (
        runtime_epoch TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_id TEXT NOT NULL,
        signature TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(runtime_epoch, operation, request_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_context_versions (
        runtime_epoch TEXT NOT NULL,
        case_id TEXT NOT NULL,
        context_version TEXT NOT NULL,
        context_seq INTEGER NOT NULL,
        previous_context_version TEXT,
        transition_code TEXT NOT NULL,
        diff_id TEXT NOT NULL,
        source_receipt_ids_json TEXT NOT NULL,
        PRIMARY KEY(runtime_epoch, case_id, context_version),
        FOREIGN KEY(case_id) REFERENCES cases(case_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_process_runs (
        run_id TEXT PRIMARY KEY,
        runtime_epoch TEXT NOT NULL,
        case_id TEXT NOT NULL,
        process_id TEXT NOT NULL,
        context_version TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(case_id) REFERENCES cases(case_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_events (
        event_id TEXT PRIMARY KEY,
        runtime_epoch TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        case_id TEXT NOT NULL,
        context_version TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        UNIQUE(runtime_epoch, sequence),
        FOREIGN KEY(case_id) REFERENCES cases(case_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_receipts (
        receipt_id TEXT PRIMARY KEY,
        runtime_epoch TEXT NOT NULL,
        receipt_type TEXT NOT NULL,
        event_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        context_version TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        process_id TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES authority_events(event_id),
        FOREIGN KEY(case_id) REFERENCES cases(case_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_evidence (
        evidence_id TEXT PRIMARY KEY,
        runtime_epoch TEXT NOT NULL,
        case_id TEXT NOT NULL,
        context_version TEXT NOT NULL,
        receipt_id TEXT NOT NULL UNIQUE,
        source_ref TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        as_of TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('accepted', 'revoked', 'expired')),
        FOREIGN KEY(case_id) REFERENCES cases(case_id),
        FOREIGN KEY(receipt_id) REFERENCES authority_receipts(receipt_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS authority_evidence_case_context
        ON authority_evidence(case_id, context_version, status);
    `);
      const appliedAt = new Date().toISOString();
      const ledger = this.database.prepare(`
        INSERT OR IGNORE INTO migration_ledger(version, name, applied_at) VALUES (?, ?, ?)
      `);
      for (const [migrationVersion, name] of [
        [1, 'shared-kernel-base'],
        [2, 'authority-command-ledger'],
        [3, 'evidence-lineage'],
        [4, 'hardening-indexes'],
        [5, 'persistent-demo-sessions'],
      ] as const) ledger.run(migrationVersion, name, appliedAt);
      this.database.exec(`PRAGMA user_version = ${V3_SCHEMA_VERSION}`);
      this.database.exec('COMMIT');
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* transaction may not be active */ }
      throw normalizedSqliteError(error);
    }
    this.migrateAuthoritySchema();
  }

  private migrateAuthoritySchema(): void {
    const eventSql = this.database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'events'").get() as { sql: string } | undefined;
    const receiptSql = this.database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'receipts'").get() as { sql: string } | undefined;
    if (eventSql?.sql.includes("authority IN ('none', 'confirmed_human')") && receiptSql?.sql.includes("'human_gate'")) return;
    this.database.exec('PRAGMA foreign_keys = OFF');
    try {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE events_v3_authority (
          event_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, event_type TEXT NOT NULL,
          context_id TEXT NOT NULL, case_id TEXT, actor_role TEXT NOT NULL,
          authority TEXT NOT NULL CHECK (authority IN ('none', 'confirmed_human')),
          payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY (context_id) REFERENCES contexts(context_id)
        ) STRICT;
        INSERT INTO events_v3_authority SELECT * FROM events;
        DROP TABLE events;
        ALTER TABLE events_v3_authority RENAME TO events;
        CREATE TABLE receipts_v3_authority (
          receipt_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE,
          receipt_type TEXT NOT NULL CHECK (receipt_type IN ('scenario_source', 'message_delivery', 'message_retry', 'human_gate')),
          context_id TEXT NOT NULL, case_id TEXT, status TEXT NOT NULL,
          authority TEXT NOT NULL CHECK (authority IN ('none', 'confirmed_human')),
          formal INTEGER NOT NULL CHECK (formal IN (0, 1)), payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL, FOREIGN KEY (context_id) REFERENCES contexts(context_id)
        ) STRICT;
        INSERT INTO receipts_v3_authority SELECT * FROM receipts;
        DROP TABLE receipts;
        ALTER TABLE receipts_v3_authority RENAME TO receipts;
        COMMIT;
      `);
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      this.database.exec('PRAGMA foreign_keys = ON');
    }
  }

  private ensureSeeded(): void {
    if (this.count('cases') > 0) {
      if (!this.getMetadata('authority_baseline_at')) this.setMetadata('authority_baseline_at', new Date().toISOString());
      if (this.countAuthorityProjection('authority_context_versions') === 0) {
        this.inTransaction(() => this.syncAuthorityProjection(this.buildAuthorityRuntime().snapshot()));
      }
      return;
    }
    const now = new Date().toISOString();
    this.inTransaction(() => {
      this.setMetadata('reset_sequence', this.getMetadata('reset_sequence') ?? '1');
      this.setMetadata('runtime_epoch', this.getMetadata('runtime_epoch') ?? 'DEMO-EPOCH-0001');
      this.setMetadata('authority_baseline_at', this.getMetadata('authority_baseline_at') ?? now);
      this.resetCounters();
      this.seed(now);
      this.syncAuthorityProjection(this.buildAuthorityRuntime().snapshot());
    });
  }

  private seed(now: string): void {
    const insertCase = this.database.prepare(`
      INSERT INTO cases (
        case_id, case_tier, read_only, portfolio_id, division_id, label, phase, attention,
        payload_json, scenario_id, scenario_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of V3_SHARED_DEMO_CASES) {
      const scenarioCase = V3_SCENARIO_CASES.find((candidate) => candidate.caseId === item.caseId);
      if (!scenarioCase) throw failure('SEED_CASE_MISMATCH', `缺少 ${item.caseId} 的 canonical Case seed`);
      insertCase.run(
        item.caseId,
        item.caseTier,
        item.readOnly ? 1 : 0,
        V3_SHARED_PORTFOLIO.portfolioId,
        item.divisionId,
        item.label,
        item.phase,
        item.attention,
        JSON.stringify({ ...scenarioCase, ...item }),
        V3_SHARED_SCENARIO_REF.scenarioId,
        V3_SHARED_SCENARIO_REF.scenarioVersion,
      );
    }
    const insertContext = this.database.prepare(`
      INSERT INTO contexts (
        context_id, grain, portfolio_id, division_id, case_id, context_version, label,
        parent_context_id, scenario_id, scenario_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const context of createV3SeedContexts()) {
      insertContext.run(
        context.contextId,
        context.grain,
        context.portfolioId,
        context.divisionId,
        context.caseId,
        context.contextVersion,
        context.label,
        context.parentContextId,
        V3_SHARED_SCENARIO_REF.scenarioId,
        V3_SHARED_SCENARIO_REF.scenarioVersion,
        now,
      );
    }
    const portfolio = this.resolveContext({
      grain: 'portfolio',
      portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
      divisionId: null,
      caseId: null,
    });
    this.insertEvent(
      'DEMO_SCENARIO_INITIALIZED',
      portfolio,
      'system',
      { scenarioRef: V3_SHARED_SCENARIO_REF, caseCount: V3_SHARED_DEMO_CASES.length },
      now,
    );
    for (const item of V3_SHARED_DEMO_CASES) {
      const context = this.resolveContext({
        grain: 'case',
        portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
        divisionId: item.divisionId,
        caseId: item.caseId,
      });
      this.insertReceipt(
        'scenario_source',
        context,
        'scenario_only',
        { caseId: item.caseId, scenarioRef: V3_SHARED_SCENARIO_REF },
        now,
      );
    }
  }

  private createAuthorityReducer(clock: { value: string }): V3AuthorityRuntime {
    return createV3AuthorityRuntime({
      scenario: {
        scenarioRef: { ...V3_SCENARIO_REF },
        cases: V3_SCENARIO_CASES.map((item) => ({
          caseId: item.caseId,
          caseTier: item.caseTier,
          readOnly: item.readOnly,
          commencementBand: item.commencementBand,
          lifecycleStatus: item.lifecycleStatus,
        })),
        processIds: [...V3_SCENARIO_PROCESS_IDS],
      },
      now: () => clock.value,
      runtimeEpochFactory: () => this.getRuntimeEpoch(),
    });
  }

  private buildAuthorityRuntime(nextOperationAt?: string): V3AuthorityRuntime {
    const clock = { value: this.getMetadata('authority_baseline_at') ?? new Date(0).toISOString() };
    const runtime = this.createAuthorityReducer(clock);
    const commands = this.database.prepare(`
      SELECT operation, input_json, executed_at
      FROM authority_commands
      WHERE runtime_epoch = ?
      ORDER BY sequence ASC
    `).all(this.getRuntimeEpoch()) as unknown as V3AuthorityCommandRow[];
    for (const command of commands) {
      clock.value = command.executed_at;
      this.invokeAuthorityReducer(runtime, command.operation, JSON.parse(command.input_json) as Record<string, unknown>);
    }
    if (nextOperationAt) clock.value = nextOperationAt;
    return runtime;
  }

  private invokeAuthorityReducer(
    runtime: V3AuthorityRuntime,
    operation: V3AuthorityOperation,
    input: Record<string, unknown>,
  ): unknown {
    const callable = runtime[operation] as unknown as (value: Record<string, unknown>) => unknown;
    return callable(input);
  }

  private executeAuthorityCommand(
    operation: V3AuthorityOperation,
    rawInput: Record<string, unknown>,
    now: string,
  ): unknown {
    const requestId = typeof rawInput.requestId === 'string' ? rawInput.requestId.trim() : '';
    if (!requestId) throw failure('INVALID_INPUT', 'requestId 无效');
    const caseId = typeof rawInput.caseId === 'string' ? rawInput.caseId : V3_SCENARIO_REF.caseId;
    const storedCase = this.getCase(caseId);
    if (storedCase.readOnly) throw failure('BACKGROUND_CASE_READ_ONLY', '背景 Case 只允许读取投影');
    if (caseId !== V3_SCENARIO_REF.caseId) throw failure('CASE_NOT_FOUND', '事项不存在');
    const input = structuredClone(rawInput);
    delete input.caseId;
    input.requestId = requestId;
    const signature = stableJson({ caseId, ...input });
    const epoch = this.getRuntimeEpoch();
    const replay = this.database.prepare(`
      SELECT signature, response_json FROM authority_idempotency
      WHERE runtime_epoch = ? AND operation = ? AND request_id = ?
    `).get(epoch, operation, requestId) as IdempotencyRow | undefined;
    if (replay) {
      if (replay.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一 requestId 的载荷不一致');
      return JSON.parse(replay.response_json);
    }
    return this.inTransaction(() => {
      const concurrentReplay = this.database.prepare(`
        SELECT signature, response_json FROM authority_idempotency
        WHERE runtime_epoch = ? AND operation = ? AND request_id = ?
      `).get(epoch, operation, requestId) as IdempotencyRow | undefined;
      if (concurrentReplay) {
        if (concurrentReplay.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一 requestId 的载荷不一致');
        return JSON.parse(concurrentReplay.response_json);
      }
      if (operation === 'recordHumanGate') {
        this.assertGateEvidenceLineage(
          caseId,
          String(input.expectedContextVersion ?? ''),
          Array.isArray(input.evidenceReceiptIds) ? input.evidenceReceiptIds.map(String) : [],
        );
      }
      const runtime = this.buildAuthorityRuntime(now);
      const result = this.invokeAuthorityReducer(runtime, operation, input);
      this.database.prepare(`
        INSERT INTO authority_commands(runtime_epoch, operation, request_id, signature, input_json, executed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(epoch, operation, requestId, signature, JSON.stringify(input), now);
      this.syncAuthorityProjection(runtime.snapshot());
      this.database.prepare(`
        INSERT INTO authority_idempotency(runtime_epoch, operation, request_id, signature, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(epoch, operation, requestId, signature, JSON.stringify(result), now);
      return structuredClone(result);
    });
  }

  private assertGateEvidenceLineage(caseId: string, expectedContextVersion: string, receiptIds: string[]): void {
    const snapshot = this.buildAuthorityRuntime().snapshot();
    if (caseId !== snapshot.scenarioRef.caseId) throw failure('EVIDENCE_CASE_MISMATCH', 'Evidence 不属于当前 Case');
    if (expectedContextVersion !== snapshot.currentContext.contextVersion) {
      throw failure('CONTEXT_VERSION_CONFLICT', 'Context Version 已变化');
    }
    const allowedSourceReceipts = new Set(snapshot.currentContext.sourceReceiptIds);
    for (const receiptId of receiptIds) {
      const row = this.database.prepare(`
        SELECT case_id, context_version, status FROM authority_evidence WHERE receipt_id = ?
      `).get(receiptId) as { case_id: string; context_version: string; status: string } | undefined;
      if (!row) throw failure('EVIDENCE_RECEIPT_NOT_FOUND', 'Gate 仅接受 canonical Evidence Receipt');
      if (row.case_id !== caseId) throw failure('EVIDENCE_CASE_MISMATCH', 'Evidence 不属于当前 Case');
      if (row.status !== 'accepted') throw failure('EVIDENCE_STATUS_INVALID', 'Evidence 状态不是 accepted');
      if (row.context_version !== expectedContextVersion && !allowedSourceReceipts.has(receiptId)) {
        throw failure('EVIDENCE_CONTEXT_EXPIRED', 'Evidence 不在当前允许的 Context Version lineage');
      }
    }
  }

  private syncAuthorityProjection(snapshot: V3AuthoritySnapshot): void {
    const epoch = snapshot.runtimeEpoch;
    this.database.exec(`
      DELETE FROM authority_evidence;
      DELETE FROM authority_receipts;
      DELETE FROM authority_events;
      DELETE FROM authority_process_runs;
      DELETE FROM authority_context_versions;
    `);
    const insertContext = this.database.prepare(`
      INSERT INTO authority_context_versions(
        runtime_epoch, case_id, context_version, context_seq, previous_context_version,
        transition_code, diff_id, source_receipt_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const context of snapshot.contexts) {
      insertContext.run(
        epoch,
        snapshot.scenarioRef.caseId,
        context.contextVersion,
        context.contextSeq,
        context.previousContextVersion,
        context.transitionCode,
        context.diffId,
        JSON.stringify(context.sourceReceiptIds),
      );
    }
    const insertRun = this.database.prepare(`
      INSERT INTO authority_process_runs(
        run_id, runtime_epoch, case_id, process_id, context_version, status, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const run of snapshot.processRuns) {
      insertRun.run(run.runId, epoch, run.caseId, run.processId, run.boundContextVersion, run.status, JSON.stringify(run));
    }
    const insertEvent = this.database.prepare(`
      INSERT INTO authority_events(
        event_id, runtime_epoch, sequence, case_id, context_version, event_type, payload_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of snapshot.events) {
      insertEvent.run(
        event.eventId,
        epoch,
        event.sequence,
        event.caseId,
        event.contextVersion ?? null,
        event.type,
        JSON.stringify(event),
        event.recordedAt,
      );
    }
    const insertReceipt = this.database.prepare(`
      INSERT INTO authority_receipts(
        receipt_id, runtime_epoch, receipt_type, event_id, case_id, context_version,
        principal_id, process_id, status, payload_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const receipt of snapshot.receipts) {
      insertReceipt.run(
        receipt.receiptId,
        epoch,
        receipt.receiptType,
        receipt.eventId,
        receipt.caseId,
        receipt.contextVersion,
        receipt.principalId,
        receipt.processId ?? null,
        receipt.status,
        JSON.stringify(receipt),
        receipt.recordedAt,
      );
    }
    const insertEvidence = this.database.prepare(`
      INSERT INTO authority_evidence(
        evidence_id, runtime_epoch, case_id, context_version, receipt_id, source_ref,
        content_hash, provenance_json, as_of, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')
    `);
    for (const receipt of snapshot.receipts.filter((item) => item.receiptType === 'evidence')) {
      const details = receipt.details;
      insertEvidence.run(
        String(details.evidenceId),
        epoch,
        receipt.caseId,
        receipt.contextVersion,
        receipt.receiptId,
        String(details.sourceRef),
        String(details.contentHash),
        JSON.stringify({
          evidenceType: details.evidenceType ?? 'unclassified',
          principalId: receipt.principalId,
          invitationId: receipt.invitationId ?? null,
        }),
        receipt.recordedAt,
      );
    }
    this.database.prepare(`
      UPDATE contexts SET context_version = ? WHERE case_id = ? AND grain = 'case'
    `).run(snapshot.currentContext.contextVersion, snapshot.scenarioRef.caseId);
  }

  private insertMessage(input: {
    context: V3ContextReadModel;
    requestId: string;
    actorKind: 'human' | 'agent';
    actorRole: V3RoleProjectionId | 'jw';
    text: string;
    replyToMessageId: string | null;
    createdAt: string;
  }): V3PersistedMessage {
    const sequence = this.nextCounter('message_sequence');
    const messageId = `${this.getRuntimeEpoch()}-MSG-${String(sequence).padStart(6, '0')}`;
    this.database.prepare(`
      INSERT INTO messages (
        message_id, sequence, context_id, context_version, request_id, actor_kind, actor_role,
        authority, text, reply_to_message_id, scenario_id, scenario_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?)
    `).run(
      messageId,
      sequence,
      input.context.contextId,
      input.context.contextVersion,
      input.requestId,
      input.actorKind,
      input.actorRole,
      input.text,
      input.replyToMessageId,
      V3_SHARED_SCENARIO_REF.scenarioId,
      V3_SHARED_SCENARIO_REF.scenarioVersion,
      input.createdAt,
    );
    return {
      messageId,
      contextId: input.context.contextId,
      contextVersion: input.context.contextVersion,
      requestId: input.requestId,
      actorKind: input.actorKind,
      actorRole: input.actorRole,
      authority: 'none',
      text: input.text,
      replyToMessageId: input.replyToMessageId,
      scenarioRef: structuredClone(V3_SHARED_SCENARIO_REF),
      createdAt: input.createdAt,
    };
  }

  private insertCandidate(
    draft: CandidateDraft,
    originalMessage: V3PersistedMessage,
    context: V3ContextReadModel,
    now: string,
  ): V3CandidateReply {
    const candidateMessage = this.insertMessage({
      context,
      requestId: originalMessage.requestId,
      actorKind: 'agent',
      actorRole: draft.routedTo === 'jw' ? 'jw' : draft.routedTo,
      text: draft.text,
      replyToMessageId: originalMessage.messageId,
      createdAt: now,
    });
    const candidate: V3CandidateReply = {
      candidateId: candidateMessage.messageId,
      kind: 'ai_candidate',
      status: 'candidate',
      completion: 'not_formal_completion',
      authority: 'none',
      routedTo: draft.routedTo,
      text: draft.text,
      result: { text: draft.text },
      disclaimer: 'AI candidate · authority none',
      contextVersion: context.contextVersion,
      createdAt: now,
    };
    this.insertEvent(
      'AI_CANDIDATE_CREATED',
      context,
      draft.routedTo,
      { candidateId: candidate.candidateId, replyToMessageId: originalMessage.messageId, authority: 'none' },
      now,
    );
    return candidate;
  }

  private insertEvent(
    eventType: string,
    context: V3ContextReadModel,
    actorRole: string,
    payload: Record<string, unknown>,
    now: string,
    authority: V3StoredEvent['authority'] = 'none',
  ): string {
    const sequence = this.nextCounter('event_sequence');
    const eventId = `${this.getRuntimeEpoch()}-EVT-${String(sequence).padStart(6, '0')}`;
    this.database.prepare(`
      INSERT INTO events (
        event_id, sequence, event_type, context_id, case_id, actor_role, authority, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      sequence,
      eventType,
      context.contextId,
      context.caseId,
      actorRole,
      authority,
      JSON.stringify(payload),
      now,
    );
    return eventId;
  }

  private insertReceipt(
    receiptType: V3StoredReceipt['receiptType'],
    context: V3ContextReadModel,
    status: string,
    payload: Record<string, unknown>,
    now: string,
    authority: V3StoredReceipt['authority'] = 'none',
    formal = false,
  ): string {
    const sequence = this.nextCounter('receipt_sequence');
    const receiptId = `${this.getRuntimeEpoch()}-RCP-${String(sequence).padStart(6, '0')}`;
    this.database.prepare(`
      INSERT INTO receipts (
        receipt_id, sequence, receipt_type, context_id, case_id, status, authority, formal,
        payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receiptId,
      sequence,
      receiptType,
      context.contextId,
      context.caseId,
      status,
      authority,
      formal ? 1 : 0,
      JSON.stringify(payload),
      now,
    );
    return receiptId;
  }

  private getContextById(contextId: string): V3ContextReadModel {
    const row = this.database.prepare(`
      SELECT context_id, grain, portfolio_id, division_id, case_id, context_version,
             label, parent_context_id, scenario_id, scenario_version
      FROM contexts WHERE context_id = ?
    `).get(contextId) as ContextRow | undefined;
    if (!row) throw failure('CONTEXT_NOT_FOUND', '上下文不存在');
    return mapContext(row);
  }

  private readIdempotentResult<T>(
    operation: string,
    requestId: string,
    signature: string,
  ): T | null {
    const row = this.database.prepare(`
      SELECT signature, response_json FROM idempotency WHERE operation = ? AND request_id = ?
    `).get(operation, requestId) as IdempotencyRow | undefined;
    if (!row) return null;
    if (row.signature !== signature) throw failure('IDEMPOTENCY_CONFLICT', '同一 requestId 的载荷不一致');
    return JSON.parse(row.response_json) as T;
  }

  private rememberIdempotentResult<T>(
    operation: string,
    requestId: string,
    signature: string,
    result: T,
    now: string,
  ): void {
    this.database.prepare(`
      INSERT INTO idempotency (operation, request_id, signature, response_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(operation, requestId, signature, JSON.stringify(result), now);
  }

  private nextCounter(key: 'message_sequence' | 'event_sequence' | 'receipt_sequence'): number {
    const next = Number(this.getMetadata(key) ?? '0') + 1;
    this.setMetadata(key, String(next));
    return next;
  }

  private resetCounters(): void {
    this.setMetadata('message_sequence', '0');
    this.setMetadata('event_sequence', '0');
    this.setMetadata('receipt_sequence', '0');
  }

  private getMetadata(key: string): string | null {
    const row = this.database.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMetadata(key: string, value: string): void {
    this.database.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  private count(table: 'cases' | 'contexts' | 'messages' | 'events' | 'receipts'): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return Number(row.count);
  }

  private countAuthorityProjection(
    table: 'authority_context_versions' | 'authority_process_runs' | 'authority_events' | 'authority_receipts' | 'authority_evidence',
  ): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return Number(row.count);
  }

  private assertDatabaseIntegrity(): void {
    const integrity = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw failure('SQLITE_INTEGRITY_FAILED', integrity.integrity_check);
    const foreignKeyViolation = this.database.prepare('PRAGMA foreign_key_check').get();
    if (foreignKeyViolation) throw failure('SQLITE_FOREIGN_KEY_FAILED', 'SQLite foreign key check 未通过');
  }

  private inTransaction<T>(operation: () => T): T {
    let begun = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      begun = true;
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (begun) {
        try { this.database.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      }
      throw normalizedSqliteError(error);
    }
  }
}

export function persistV3DemoSession(session: V3StoredDemoSession): V3StoredDemoSession {
  const databasePath = defaultV3SqlitePath();
  let database = new DatabaseSync(sqliteTarget(databasePath));
  try {
    const hasCore = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'cases'").get();
    const hasSessions = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'demo_sessions'").get();
    if (!hasCore || !hasSessions) {
      database.close();
      const store = new V3SqliteStore(databasePath);
      store.close();
      database = new DatabaseSync(sqliteTarget(databasePath));
    }
    database.exec(`PRAGMA busy_timeout = ${V3_BUSY_TIMEOUT_MS}`);
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = insertDemoSession(database, session);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw normalizedSqliteError(error);
    }
  } finally {
    database.close();
  }
}

export function lookupV3DemoSession(sessionId: string, now: string): V3StoredDemoSession {
  const databasePath = defaultV3SqlitePath();
  let database = new DatabaseSync(sqliteTarget(databasePath));
  try {
    const hasCore = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'cases'").get();
    const hasSessions = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'demo_sessions'").get();
    if (!hasCore || !hasSessions) {
      database.close();
      const store = new V3SqliteStore(databasePath);
      store.close();
      database = new DatabaseSync(sqliteTarget(databasePath));
    }
    database.exec(`PRAGMA busy_timeout = ${V3_BUSY_TIMEOUT_MS}`);
    return readDemoSession(database, sessionId, now);
  } finally {
    database.close();
  }
}

export { stableJson as stableV3Json };
