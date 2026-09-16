export type AuthorityEventInput = {
  eventId: string;
  caseId: string;
  type:
    | 'EVIDENCE_ACCEPTED'
    | 'FACT_CONFIRMED'
    | 'HUMAN_DECISION_RECORDED'
    | 'MESSAGE_RECEIVED'
    | 'CANDIDATE_ANSWER_RECORDED'
    | 'STAGE_RUNS_STARTED';
  actor: {
    kind: 'human' | 'system' | 'agent';
    id: string;
    authority: 'confirmed' | 'none';
  };
  correlationId: string;
  causationId: string;
  contextVersion?: string;
  payload: Record<string, string>;
};

export type AuthorityEvent = AuthorityEventInput & {
  sequence: number;
  recordedAt: string;
};

export type AuthorityEventPage = {
  items: Array<AuthorityEvent>;
  nextCursor: number | null;
  hasMore: boolean;
};

type LedgerActor = AuthorityEventInput['actor'];
type LedgerPayload = Record<string, string>;

const CASE_ID = 'FL-DEMO-001';
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_ACTOR_ID_LENGTH = 80;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'EVIDENCE_ACCEPTED',
  'FACT_CONFIRMED',
  'HUMAN_DECISION_RECORDED',
  'MESSAGE_RECEIVED',
  'CANDIDATE_ANSWER_RECORDED',
  'STAGE_RUNS_STARTED',
]);

const ACTOR_KINDS: ReadonlySet<string> = new Set(['human', 'system', 'agent']);
const ACTOR_AUTHORITIES: ReadonlySet<string> = new Set(['confirmed', 'none']);
const DANGEROUS_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

let nextSequence = 1;
let events: Array<AuthorityEvent> = [];
let eventsByEventId = new Map<string, AuthorityEvent>();
let canonicalSignaturesByEventId = new Map<string, string>();

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownEnumerableDataString(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return Boolean(
    descriptor &&
      descriptor.enumerable === true &&
      descriptor.get === undefined &&
      descriptor.set === undefined &&
      Object.hasOwn(descriptor, 'value') &&
      typeof descriptor.value === 'string',
  );
}

function validateActor(value: unknown): LedgerActor {
  if (!isPlainObject(value)) {
    throw failure('INVALID_ACTOR', '操作者无效');
  }

  const ownKeys = Object.getOwnPropertyNames(value);
  const symbolKeys = Object.getOwnPropertySymbols(value);
  const expectedKeys = ['kind', 'id', 'authority'];
  if (
    symbolKeys.length !== 0 ||
    ownKeys.length !== expectedKeys.length ||
    !ownKeys.every((key) => expectedKeys.includes(key)) ||
    !ownEnumerableDataString(value, 'kind') ||
    !ownEnumerableDataString(value, 'id') ||
    !ownEnumerableDataString(value, 'authority')
  ) {
    throw failure('INVALID_ACTOR', '操作者无效');
  }

  const kind = value.kind as string;
  const actorId = trimmed(value.id);
  const authority = value.authority as string;

  if (!ACTOR_KINDS.has(kind)) {
    throw failure('INVALID_ACTOR', '操作者无效');
  }
  if (!actorId || actorId.length > MAX_ACTOR_ID_LENGTH) {
    throw failure('INVALID_ACTOR', '操作者标识无效');
  }
  if (!ACTOR_AUTHORITIES.has(authority)) {
    throw failure('INVALID_ACTOR', '操作者无效');
  }
  if (kind !== 'human' && authority !== 'none') {
    throw failure('INVALID_ACTOR', '系统与代理操作者不具备确认权威');
  }

  return {
    kind: kind as LedgerActor['kind'],
    id: actorId,
    authority: authority as LedgerActor['authority'],
  };
}

function validatePayload(value: unknown): LedgerPayload {
  if (!isPlainObject(value)) {
    throw failure('INVALID_PAYLOAD', '事件负载必须是扁平字符串映射');
  }

  const propertyNames = Object.getOwnPropertyNames(value);
  const propertySymbols = Object.getOwnPropertySymbols(value);
  if (propertySymbols.length !== 0) {
    throw failure('INVALID_PAYLOAD', '事件负载不接受 symbol 属性');
  }

  for (const key of propertyNames) {
    if (DANGEROUS_PAYLOAD_KEYS.has(key) || !ownEnumerableDataString(value, key)) {
      throw failure('INVALID_PAYLOAD', '事件负载必须是扁平字符串映射');
    }
  }

  // Store a fresh object with stable key order. Payload values remain exact
  // strings; canonical ordering is only used for replay comparison.
  const normalized: LedgerPayload = {};
  for (const key of [...propertyNames].sort()) {
    normalized[key] = value[key] as string;
  }
  return normalized;
}

function requiredIdentifier(value: unknown, code: string, message: string): string {
  const normalized = trimmed(value);
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw failure(code, message);
  }
  return normalized;
}

function canonicalEventSignature(event: AuthorityEventInput): string {
  return JSON.stringify([
    event.caseId,
    event.type,
    event.actor.kind,
    event.actor.id,
    event.actor.authority,
    event.correlationId,
    event.causationId,
    event.contextVersion === undefined
      ? { present: false }
      : { present: true, value: event.contextVersion },
    Object.keys(event.payload)
      .sort()
      .map((key) => [key, event.payload[key]]),
  ]);
}

function validateInput(input: unknown): AuthorityEventInput {
  if (!isPlainObject(input) || trimmed(input.caseId) !== CASE_ID) {
    throw failure('CASE_NOT_FOUND', '事项不存在');
  }

  const eventId = requiredIdentifier(input.eventId, 'INVALID_EVENT_ID', '事件标识无效');

  if (typeof input.type !== 'string' || !EVENT_TYPES.has(input.type)) {
    throw failure('INVALID_EVENT_TYPE', '事件类型无效');
  }
  const type = input.type as AuthorityEventInput['type'];

  const actor = validateActor(input.actor);
  const correlationId = requiredIdentifier(
    input.correlationId,
    'INVALID_CORRELATION_ID',
    '关联标识无效',
  );
  const causationId = requiredIdentifier(
    input.causationId,
    'INVALID_CAUSATION_ID',
    '因果标识无效',
  );

  let contextVersion: string | undefined;
  if (input.contextVersion !== undefined) {
    contextVersion = requiredIdentifier(
      input.contextVersion,
      'INVALID_CONTEXT_VERSION',
      '上下文版本无效',
    );
    if (!/^CTX-\d{4,}$/.test(contextVersion)) {
      throw failure('INVALID_CONTEXT_VERSION', '上下文版本无效');
    }
  }

  const payload = validatePayload(input.payload);

  return {
    eventId,
    caseId: CASE_ID,
    type,
    actor,
    correlationId,
    causationId,
    ...(contextVersion === undefined ? {} : { contextVersion }),
    payload,
  };
}

function storedEventIndex(eventId: string): AuthorityEvent | undefined {
  return eventsByEventId.get(eventId);
}

export function appendAuthorityEvent(input: AuthorityEventInput): AuthorityEvent {
  const normalizedInput = validateInput(input);
  const canonicalSignature = canonicalEventSignature(normalizedInput);
  const existing = storedEventIndex(normalizedInput.eventId);
  if (existing) {
    if (canonicalSignaturesByEventId.get(existing.eventId) !== canonicalSignature) {
      throw failure('EVENT_ID_CONFLICT', '同一事件标识已绑定其他规范化事件输入');
    }
    return structuredClone(existing);
  }

  const event: AuthorityEvent = {
    ...structuredClone(normalizedInput),
    sequence: nextSequence,
    recordedAt: new Date().toISOString(),
  };
  events.push(event);
  eventsByEventId.set(event.eventId, event);
  canonicalSignaturesByEventId.set(event.eventId, canonicalSignature);
  nextSequence += 1;
  return structuredClone(event);
}

export function getAuthorityEvent(eventId: string): AuthorityEvent | undefined {
  const normalizedEventId = requiredIdentifier(
    eventId,
    'INVALID_EVENT_ID',
    '事件标识无效',
  );
  const event = eventsByEventId.get(normalizedEventId);
  return event ? structuredClone(event) : undefined;
}

export function getAuthorityEventCount(): number {
  return events.length;
}

export function listAuthorityEvents(options: {
  caseId: string;
  afterSequence?: number;
  limit?: number;
}): AuthorityEventPage {
  if (!isPlainObject(options) || trimmed(options.caseId) !== CASE_ID) {
    throw failure('CASE_NOT_FOUND', '事项不存在');
  }

  const afterSequence = options.afterSequence === undefined ? 0 : options.afterSequence;
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw failure('INVALID_AFTER_SEQUENCE', '分页起始序号无效');
  }

  const limit = options.limit === undefined ? DEFAULT_LIMIT : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw failure('INVALID_LIMIT', '分页数量无效');
  }

  const items = events
    .filter((event) => event.sequence > afterSequence)
    .slice(0, limit)
    .map((event) => structuredClone(event));
  const hasMore = events.length > afterSequence + items.length;
  const nextCursor = hasMore ? items[items.length - 1].sequence : null;

  return structuredClone({ items, nextCursor, hasMore });
}

export function resetAuthorityEventLedger(): void {
  nextSequence = 1;
  events = [];
  eventsByEventId = new Map();
  canonicalSignaturesByEventId = new Map();
}
