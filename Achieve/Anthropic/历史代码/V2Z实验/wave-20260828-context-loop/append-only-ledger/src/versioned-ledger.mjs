const STAGE_ORDER = Object.freeze([
  'OPPORTUNITY',
  'DUE_DILIGENCE',
  'POLICY',
  'CREDIT_REVIEW',
  'COMMERCIAL',
  'ASSET',
]);

const RECORD_KINDS = new Set([
  'CLAIM',
  'MODEL_CANDIDATE',
  'EVIDENCE',
  'VERIFIED_FACT',
  'HUMAN_DECISION',
  'EXTERNAL_RECEIPT',
]);

const SOURCE_TYPES = new Set(['HUMAN', 'SYSTEM', 'MODEL', 'EXTERNAL']);
const SUBJECT_TYPES = new Set(['HUMAN', 'SYSTEM', 'MODEL']);

const TOP_LEVEL_KEYS = new Set(['caseId', 'ledger', 'command']);
const COMMAND_KEYS = new Set([
  'entryId',
  'idempotencyKey',
  'recordId',
  'kind',
  'content',
  'source',
  'recordedAt',
  'subject',
  'applicability',
  'previousEntryId',
  'changeReason',
  'affectedConclusionIds',
]);
const LEDGER_ENTRY_KEYS = new Set([
  'entryId',
  'idempotencyKey',
  'recordId',
  'kind',
  'content',
  'source',
  'recordedAt',
  'subject',
  'applicability',
  'previousEntryId',
  'changeReason',
  'version',
  'versionLabel',
]);
const CONTENT_KEYS = new Set(['value', 'evidenceRefs']);
const SOURCE_KEYS = new Set(['type', 'sourceId']);
const SUBJECT_KEYS = new Set(['type', 'subjectId', 'role']);
const APPLICABILITY_KEYS = new Set(['stages', 'scopeRef']);

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

class VersionedLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VersionedLedgerError';
    this.code = code;
    this.details = Object.create(null);
  }
}

function fail(code, message) {
  throw new VersionedLedgerError(code, message);
}

function assertPlainObject(value, message) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_INPUT', message);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('INVALID_INPUT', message);
  }

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string') {
      fail('INVALID_INPUT', message);
    }
    if (RESERVED_OBJECT_KEYS.has(key)) {
      fail('INVALID_INPUT', message);
    }
  }
  return keys;
}

function assertExactPlainObject(value, allowedKeys, message) {
  const keys = assertPlainObject(value, message);
  if (keys.length !== allowedKeys.size) {
    fail('INVALID_INPUT', message);
  }
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      fail('INVALID_INPUT', message);
    }
  }
}

function assertArray(value, message) {
  if (!Array.isArray(value)) {
    fail('INVALID_INPUT', message);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype && prototype !== null) {
    fail('INVALID_INPUT', message);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      fail('INVALID_INPUT', message);
    }
    if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      fail('INVALID_INPUT', message);
    }
  }
  return value;
}

function assertNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_INPUT', message);
  }
}

function assertStringArray(value, message) {
  assertArray(value, message);
  for (const item of value) {
    assertNonEmptyString(item, message);
  }
}

function assertPositiveInteger(value, message) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_INPUT', message);
  }
}

function assertEntryShape(entry) {
  assertExactPlainObject(entry, LEDGER_ENTRY_KEYS, 'ledger entry has an invalid shape');
  assertNonEmptyString(entry.entryId, 'ledger entry entryId is invalid');
  assertNonEmptyString(entry.idempotencyKey, 'ledger entry idempotencyKey is invalid');
  assertNonEmptyString(entry.recordId, 'ledger entry recordId is invalid');
  assertNonEmptyString(entry.kind, 'ledger entry kind is invalid');

  assertExactPlainObject(entry.content, CONTENT_KEYS, 'ledger entry content has an invalid shape');
  assertNonEmptyString(entry.content.value, 'ledger entry content value is invalid');
  assertStringArray(entry.content.evidenceRefs, 'ledger entry evidenceRefs are invalid');

  assertExactPlainObject(entry.source, SOURCE_KEYS, 'ledger entry source has an invalid shape');
  assertNonEmptyString(entry.source.type, 'ledger entry source type is invalid');
  assertNonEmptyString(entry.source.sourceId, 'ledger entry sourceId is invalid');

  assertNonEmptyString(entry.recordedAt, 'ledger entry recordedAt is invalid');

  assertExactPlainObject(entry.subject, SUBJECT_KEYS, 'ledger entry subject has an invalid shape');
  assertNonEmptyString(entry.subject.type, 'ledger entry subject type is invalid');
  assertNonEmptyString(entry.subject.subjectId, 'ledger entry subjectId is invalid');
  assertNonEmptyString(entry.subject.role, 'ledger entry subject role is invalid');

  assertExactPlainObject(
    entry.applicability,
    APPLICABILITY_KEYS,
    'ledger entry applicability has an invalid shape',
  );
  assertStringArray(entry.applicability.stages, 'ledger entry stages are invalid');
  assertNonEmptyString(entry.applicability.scopeRef, 'ledger entry scopeRef is invalid');

  if (entry.previousEntryId !== null) {
    assertNonEmptyString(entry.previousEntryId, 'ledger entry previousEntryId is invalid');
  }
  assertNonEmptyString(entry.changeReason, 'ledger entry changeReason is invalid');
  assertPositiveInteger(entry.version, 'ledger entry version is invalid');
  assertNonEmptyString(entry.versionLabel, 'ledger entry versionLabel is invalid');
}

function assertCommandShape(command) {
  assertExactPlainObject(command, COMMAND_KEYS, 'command has an invalid shape');
  assertNonEmptyString(command.entryId, 'command entryId is invalid');
  assertNonEmptyString(command.idempotencyKey, 'command idempotencyKey is invalid');
  assertNonEmptyString(command.recordId, 'command recordId is invalid');
  assertNonEmptyString(command.kind, 'command kind is invalid');

  assertExactPlainObject(command.content, CONTENT_KEYS, 'command content has an invalid shape');
  assertNonEmptyString(command.content.value, 'command content value is invalid');
  assertStringArray(command.content.evidenceRefs, 'command evidenceRefs are invalid');

  assertExactPlainObject(command.source, SOURCE_KEYS, 'command source has an invalid shape');
  assertNonEmptyString(command.source.type, 'command source type is invalid');
  assertNonEmptyString(command.source.sourceId, 'command sourceId is invalid');

  assertNonEmptyString(command.recordedAt, 'command recordedAt is invalid');

  assertExactPlainObject(command.subject, SUBJECT_KEYS, 'command subject has an invalid shape');
  assertNonEmptyString(command.subject.type, 'command subject type is invalid');
  assertNonEmptyString(command.subject.subjectId, 'command subjectId is invalid');
  assertNonEmptyString(command.subject.role, 'command subject role is invalid');

  assertExactPlainObject(
    command.applicability,
    APPLICABILITY_KEYS,
    'command applicability has an invalid shape',
  );
  assertStringArray(command.applicability.stages, 'command stages are invalid');
  assertNonEmptyString(command.applicability.scopeRef, 'command scopeRef is invalid');

  if (command.previousEntryId !== null) {
    assertNonEmptyString(command.previousEntryId, 'command previousEntryId is invalid');
  }
  assertNonEmptyString(command.changeReason, 'command changeReason is invalid');
  assertStringArray(command.affectedConclusionIds, 'command affectedConclusionIds are invalid');
}

function isValidIso8601WithTimezone(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[8];

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      return false;
    }
  }

  const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function hasUniqueStrings(values) {
  return new Set(values).size === values.length;
}

function normalizeStages(stages) {
  return STAGE_ORDER.filter((stage) => stages.includes(stage));
}

function validateEntryValues(entry) {
  if (!RECORD_KINDS.has(entry.kind)) {
    fail('INVALID_INPUT', 'ledger entry kind is not supported');
  }
  if (!SOURCE_TYPES.has(entry.source.type)) {
    fail('INVALID_INPUT', 'ledger entry source type is not supported');
  }
  if (!SUBJECT_TYPES.has(entry.subject.type)) {
    fail('INVALID_INPUT', 'ledger entry subject type is not supported');
  }
  if (!isValidIso8601WithTimezone(entry.recordedAt)) {
    fail('INVALID_INPUT', 'ledger entry recordedAt is invalid');
  }
  if (!hasUniqueStrings(entry.content.evidenceRefs)) {
    fail('INVALID_INPUT', 'ledger entry evidenceRefs are not unique');
  }
  for (const stage of entry.applicability.stages) {
    if (!STAGE_ORDER.includes(stage)) {
      fail('INVALID_INPUT', 'ledger entry stage is not supported');
    }
  }
  if (!hasUniqueStrings(entry.applicability.stages)) {
    fail('INVALID_INPUT', 'ledger entry stages are not unique');
  }
  if (!arraysEqual(entry.applicability.stages, normalizeStages(entry.applicability.stages))) {
    fail('INVALID_INPUT', 'ledger entry stages are not normalized');
  }
  if (entry.versionLabel !== `V${entry.version}`) {
    fail('INVALID_INPUT', 'ledger entry versionLabel is invalid');
  }
}

function validateCommandValues(command) {
  if (!RECORD_KINDS.has(command.kind)) {
    fail('INVALID_INPUT', 'command kind is not supported');
  }
  if (!SOURCE_TYPES.has(command.source.type)) {
    fail('INVALID_INPUT', 'command source type is not supported');
  }
  if (!SUBJECT_TYPES.has(command.subject.type)) {
    fail('INVALID_INPUT', 'command subject type is not supported');
  }
  if (!isValidIso8601WithTimezone(command.recordedAt)) {
    fail('INVALID_INPUT', 'command recordedAt is invalid');
  }
  if (!hasUniqueStrings(command.content.evidenceRefs)) {
    fail('INVALID_INPUT', 'command evidenceRefs are not unique');
  }
  for (const stage of command.applicability.stages) {
    if (!STAGE_ORDER.includes(stage)) {
      fail('INVALID_INPUT', 'command stage is not supported');
    }
  }
  if (!hasUniqueStrings(command.applicability.stages)) {
    fail('INVALID_INPUT', 'command stages are not unique');
  }
  if (!hasUniqueStrings(command.affectedConclusionIds)) {
    fail('INVALID_INPUT', 'command affectedConclusionIds are not unique');
  }
}

function validateLedgerIdentifiersAndChain(entries) {
  const entryIds = new Set();
  const entriesByIdempotencyKey = new Map();

  for (const entry of entries) {
    if (entryIds.has(entry.entryId)) {
      fail('DUPLICATE_ID', 'ledger entryId is not unique');
    }
    entryIds.add(entry.entryId);

    if (entriesByIdempotencyKey.has(entry.idempotencyKey)) {
      fail('IDEMPOTENCY_CONFLICT', 'ledger idempotencyKey is not unique');
    }
    entriesByIdempotencyKey.set(entry.idempotencyKey, entry);
  }

  const records = new Map();
  for (const entry of entries) {
    const state = records.get(entry.recordId);
    if (!state) {
      if (entry.version !== 1 || entry.previousEntryId !== null) {
        fail('INVALID_LEDGER_CHAIN', 'ledger record does not start at V1');
      }
    } else if (
      entry.version !== state.nextVersion ||
      entry.previousEntryId !== state.latestEntryId
    ) {
      fail('INVALID_LEDGER_CHAIN', 'ledger version chain is invalid');
    }

    records.set(entry.recordId, {
      latestEntryId: entry.entryId,
      nextVersion: entry.version + 1,
    });
  }

  return { entryIds, entriesByIdempotencyKey, records };
}

function validateSubjectAuthority(record) {
  const kind = record.kind;
  const subjectType = record.subject.type;

  if (kind === 'MODEL_CANDIDATE' && subjectType !== 'MODEL') {
    fail('UNAUTHORIZED_SUBJECT', 'subject cannot create a model candidate');
  }
  if (kind === 'VERIFIED_FACT' && subjectType !== 'HUMAN' && subjectType !== 'SYSTEM') {
    fail('UNAUTHORIZED_SUBJECT', 'subject cannot create a verified fact');
  }
  if (kind === 'HUMAN_DECISION' && subjectType !== 'HUMAN') {
    fail('UNAUTHORIZED_SUBJECT', 'subject cannot create a human decision');
  }
  if (
    kind === 'EXTERNAL_RECEIPT' &&
    (subjectType !== 'SYSTEM' || record.source.type !== 'EXTERNAL')
  ) {
    fail('UNAUTHORIZED_SUBJECT', 'subject cannot create an external receipt');
  }
}

function commandSemanticsEqual(command, entry) {
  return (
    command.entryId === entry.entryId &&
    command.idempotencyKey === entry.idempotencyKey &&
    command.recordId === entry.recordId &&
    command.kind === entry.kind &&
    command.content.value === entry.content.value &&
    arraysEqual(command.content.evidenceRefs, entry.content.evidenceRefs) &&
    command.source.type === entry.source.type &&
    command.source.sourceId === entry.source.sourceId &&
    command.recordedAt === entry.recordedAt &&
    command.subject.type === entry.subject.type &&
    command.subject.subjectId === entry.subject.subjectId &&
    command.subject.role === entry.subject.role &&
    arraysEqual(
      normalizeStages(command.applicability.stages),
      entry.applicability.stages,
    ) &&
    command.applicability.scopeRef === entry.applicability.scopeRef &&
    command.previousEntryId === entry.previousEntryId &&
    command.changeReason === entry.changeReason
  );
}

function copyEntry(entry) {
  return {
    entryId: entry.entryId,
    idempotencyKey: entry.idempotencyKey,
    recordId: entry.recordId,
    kind: entry.kind,
    content: {
      value: entry.content.value,
      evidenceRefs: [...entry.content.evidenceRefs],
    },
    source: {
      type: entry.source.type,
      sourceId: entry.source.sourceId,
    },
    recordedAt: entry.recordedAt,
    subject: {
      type: entry.subject.type,
      subjectId: entry.subject.subjectId,
      role: entry.subject.role,
    },
    applicability: {
      stages: [...entry.applicability.stages],
      scopeRef: entry.applicability.scopeRef,
    },
    previousEntryId: entry.previousEntryId,
    changeReason: entry.changeReason,
    version: entry.version,
    versionLabel: entry.versionLabel,
  };
}

function makeEntryFromCommand(command, version) {
  return copyEntry({
    entryId: command.entryId,
    idempotencyKey: command.idempotencyKey,
    recordId: command.recordId,
    kind: command.kind,
    content: {
      value: command.content.value,
      evidenceRefs: command.content.evidenceRefs,
    },
    source: command.source,
    recordedAt: command.recordedAt,
    subject: command.subject,
    applicability: {
      stages: normalizeStages(command.applicability.stages),
      scopeRef: command.applicability.scopeRef,
    },
    previousEntryId: command.previousEntryId,
    changeReason: command.changeReason,
    version,
    versionLabel: `V${version}`,
  });
}

function makeReplayOutput(input, entry) {
  return {
    schemaVersion: 'versioned-ledger.lab.v0',
    caseId: input.caseId,
    status: 'IDEMPOTENT_REPLAY',
    appendedEntry: copyEntry(entry),
    ledger: input.ledger.map(copyEntry),
    affectedConclusionCandidates: [],
    authority: {
      modelAuthority: 'NONE',
      automaticConclusionRewrite: false,
      projectDecisionAuthority: 'NONE',
    },
  };
}

export function appendVersionedLedger(input) {
  assertExactPlainObject(input, TOP_LEVEL_KEYS, 'input has an invalid shape');
  assertNonEmptyString(input.caseId, 'caseId is invalid');
  assertArray(input.ledger, 'ledger must be an array');

  for (const entry of input.ledger) {
    assertEntryShape(entry);
  }
  assertCommandShape(input.command);

  for (const entry of input.ledger) {
    validateEntryValues(entry);
  }
  validateCommandValues(input.command);

  const { entryIds, entriesByIdempotencyKey, records } =
    validateLedgerIdentifiersAndChain(input.ledger);

  for (const entry of input.ledger) {
    validateSubjectAuthority(entry);
  }
  validateSubjectAuthority(input.command);

  const replayedEntry = entriesByIdempotencyKey.get(input.command.idempotencyKey);
  if (replayedEntry) {
    if (!commandSemanticsEqual(input.command, replayedEntry)) {
      fail('IDEMPOTENCY_CONFLICT', 'command semantics differ for the same idempotencyKey');
    }
    return makeReplayOutput(input, replayedEntry);
  }

  if (entryIds.has(input.command.entryId)) {
    fail('DUPLICATE_ID', 'command entryId already exists');
  }

  const recordState = records.get(input.command.recordId);
  const version = recordState ? recordState.nextVersion : 1;
  const expectedPreviousEntryId = recordState ? recordState.latestEntryId : null;
  if (
    input.command.previousEntryId !== expectedPreviousEntryId ||
    (recordState && input.command.previousEntryId === null) ||
    (!recordState && input.command.previousEntryId !== null)
  ) {
    fail('VERSION_CONFLICT', 'command is not based on the record predecessor');
  }

  const appendedInternal = makeEntryFromCommand(input.command, version);
  const affectedConclusionCandidates = input.command.affectedConclusionIds
    .slice()
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((conclusionId) => ({
      conclusionId,
      reason: 'LEDGER_VERSION_CHANGED',
      recordId: input.command.recordId,
      fromEntryId: input.command.previousEntryId,
      toEntryId: input.command.entryId,
    }));

  return {
    schemaVersion: 'versioned-ledger.lab.v0',
    caseId: input.caseId,
    status: 'APPENDED',
    appendedEntry: copyEntry(appendedInternal),
    ledger: [...input.ledger.map(copyEntry), copyEntry(appendedInternal)],
    affectedConclusionCandidates,
    authority: {
      modelAuthority: 'NONE',
      automaticConclusionRewrite: false,
      projectDecisionAuthority: 'NONE',
    },
  };
}

export { VersionedLedgerError };
