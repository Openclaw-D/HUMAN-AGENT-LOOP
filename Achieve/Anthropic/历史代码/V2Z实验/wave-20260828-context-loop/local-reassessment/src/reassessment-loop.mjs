export class ReassessmentLoopError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReassessmentLoopError';
    this.code = code;
    this.details = { code };
  }
}

const STAGES = new Set([
  'OPPORTUNITY',
  'DUE_DILIGENCE',
  'POLICY',
  'CREDIT_REVIEW',
  'COMMERCIAL',
  'ASSET',
]);

const ROUTES = new Set([
  'CREDIT_REVIEW>DUE_DILIGENCE',
  'DUE_DILIGENCE>OPPORTUNITY',
  'COMMERCIAL>DUE_DILIGENCE',
  'COMMERCIAL>CREDIT_REVIEW',
  'ASSET>CREDIT_REVIEW',
  'ASSET>POLICY',
]);

const ACTOR_TYPES = new Set(['HUMAN', 'SYSTEM', 'MODEL']);
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function invalid(message) {
  return new ReassessmentLoopError('INVALID_INPUT', message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactObject(value, keys, label) {
  if (!isObject(value)) throw invalid(`${label} must be an object`);

  const ownKeys = Reflect.ownKeys(value);
  const expected = new Set(keys);
  if (ownKeys.length !== expected.size) throw invalid(`${label} has an invalid shape`);

  for (const key of ownKeys) {
    if (typeof key === 'symbol' || RESERVED_KEYS.has(key) || !expected.has(key)) {
      throw invalid(`${label} has an invalid key`);
    }
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${label} must be a non-empty string`);
  }
  return value;
}

function assertStringArray(value, label) {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array`);

  const ownKeys = Reflect.ownKeys(value);
  const expected = new Set(['length']);
  for (let index = 0; index < value.length; index += 1) expected.add(String(index));
  if (ownKeys.length !== expected.size) throw invalid(`${label} has an invalid shape`);
  for (const key of ownKeys) {
    if (typeof key === 'symbol' || !expected.has(key)) {
      throw invalid(`${label} has an invalid key`);
    }
  }

  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw invalid(`${label} must not be sparse`);
    const item = nonEmptyString(value[index], `${label}[${index}]`);
    if (seen.has(item)) throw invalid(`${label} must be unique`);
    seen.add(item);
  }
}

function assertStage(value, label) {
  if (typeof value !== 'string' || !STAGES.has(value)) {
    throw invalid(`${label} must be a stage`);
  }
}

function validateIso8601WithTimezone(value, label) {
  nonEmptyString(value, label);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) throw invalid(`${label} must be ISO8601 with a timezone`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetSign = match[8];
  const offsetHour = offsetSign === undefined ? 0 : Number(match[9]);
  const offsetMinute = offsetSign === undefined ? 0 : Number(match[10]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    throw invalid(`${label} contains an invalid time component`);
  }

  const probe = new Date(Date.UTC(2000, 0, 1));
  probe.setUTCFullYear(year);
  probe.setUTCMonth(month - 1);
  probe.setUTCDate(day);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw invalid(`${label} must contain a real date`);
  }
}

function validateActor(value, label) {
  assertExactObject(value, ['type', 'actorId', 'role'], label);
  nonEmptyString(value.actorId, `${label}.actorId`);
  nonEmptyString(value.role, `${label}.role`);
  if (typeof value.type !== 'string' || !ACTOR_TYPES.has(value.type)) {
    throw invalid(`${label}.type is invalid`);
  }
}

function validateOpenCommand(command) {
  assertExactObject(command, [
    'type',
    'loopId',
    'idempotencyKey',
    'sourceStage',
    'targetStage',
    'reason',
    'questions',
    'requiredEvidence',
    'affectedConclusionIds',
    'owner',
    'requestedBy',
    'openedAt',
  ], 'command');

  if (command.type !== 'OPEN') throw invalid('command.type is invalid');
  nonEmptyString(command.loopId, 'command.loopId');
  nonEmptyString(command.idempotencyKey, 'command.idempotencyKey');
  assertStage(command.sourceStage, 'command.sourceStage');
  assertStage(command.targetStage, 'command.targetStage');
  nonEmptyString(command.reason, 'command.reason');
  assertStringArray(command.questions, 'command.questions');
  assertStringArray(command.requiredEvidence, 'command.requiredEvidence');
  assertStringArray(command.affectedConclusionIds, 'command.affectedConclusionIds');
  validateActor(command.owner, 'command.owner');
  validateActor(command.requestedBy, 'command.requestedBy');
  validateIso8601WithTimezone(command.openedAt, 'command.openedAt');
}

function validateReceipt(value, label) {
  assertExactObject(value, [
    'receiptId',
    'status',
    'sourceSystem',
    'receivedAt',
    'evidenceRefs',
  ], label);

  nonEmptyString(value.receiptId, `${label}.receiptId`);
  if (value.status !== 'CONFIRMED') throw invalid(`${label}.status is invalid`);
  nonEmptyString(value.sourceSystem, `${label}.sourceSystem`);
  validateIso8601WithTimezone(value.receivedAt, `${label}.receivedAt`);
  assertStringArray(value.evidenceRefs, `${label}.evidenceRefs`);
}

function validateCloseCommand(command) {
  assertExactObject(command, [
    'type',
    'loopId',
    'idempotencyKey',
    'closedAt',
    'closedBy',
    'resolution',
    'closeReceipt',
  ], 'command');

  if (command.type !== 'CLOSE') throw invalid('command.type is invalid');
  nonEmptyString(command.loopId, 'command.loopId');
  nonEmptyString(command.idempotencyKey, 'command.idempotencyKey');
  validateIso8601WithTimezone(command.closedAt, 'command.closedAt');
  validateActor(command.closedBy, 'command.closedBy');
  nonEmptyString(command.resolution, 'command.resolution');
  validateReceipt(command.closeReceipt, 'command.closeReceipt');
}

function validateLoop(loop, index) {
  const label = `loops[${index}]`;
  assertExactObject(loop, [
    'loopId',
    'openIdempotencyKey',
    'sourceStage',
    'targetStage',
    'reason',
    'questions',
    'requiredEvidence',
    'affectedConclusionIds',
    'owner',
    'requestedBy',
    'openedAt',
    'attempt',
    'status',
    'closedAt',
    'closedBy',
    'resolution',
    'closeIdempotencyKey',
    'closeReceipt',
  ], label);

  nonEmptyString(loop.loopId, `${label}.loopId`);
  nonEmptyString(loop.openIdempotencyKey, `${label}.openIdempotencyKey`);
  assertStage(loop.sourceStage, `${label}.sourceStage`);
  assertStage(loop.targetStage, `${label}.targetStage`);
  nonEmptyString(loop.reason, `${label}.reason`);
  assertStringArray(loop.questions, `${label}.questions`);
  assertStringArray(loop.requiredEvidence, `${label}.requiredEvidence`);
  assertStringArray(loop.affectedConclusionIds, `${label}.affectedConclusionIds`);
  validateActor(loop.owner, `${label}.owner`);
  validateActor(loop.requestedBy, `${label}.requestedBy`);
  validateIso8601WithTimezone(loop.openedAt, `${label}.openedAt`);

  if (!Number.isSafeInteger(loop.attempt) || loop.attempt <= 0) {
    throw invalid(`${label}.attempt must be a positive integer`);
  }
  if (loop.status !== 'OPEN' && loop.status !== 'CLOSED') {
    throw invalid(`${label}.status is invalid`);
  }

  if (loop.status === 'OPEN') {
    if (
      loop.closedAt !== null ||
      loop.closedBy !== null ||
      loop.resolution !== null ||
      loop.closeIdempotencyKey !== null ||
      loop.closeReceipt !== null
    ) {
      throw invalid(`${label} has invalid close fields`);
    }
    return;
  }

  validateIso8601WithTimezone(loop.closedAt, `${label}.closedAt`);
  validateActor(loop.closedBy, `${label}.closedBy`);
  nonEmptyString(loop.resolution, `${label}.resolution`);
  nonEmptyString(loop.closeIdempotencyKey, `${label}.closeIdempotencyKey`);
  validateReceipt(loop.closeReceipt, `${label}.closeReceipt`);

  if (compareIso(loop.closedAt, loop.openedAt) < 0) {
    throw invalid(`${label}.closedAt is earlier than openedAt`);
  }
  if (compareIso(loop.closeReceipt.receivedAt, loop.openedAt) < 0) {
    throw invalid(`${label}.closeReceipt.receivedAt is earlier than openedAt`);
  }
}

function timestampParts(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) throw invalid('value must be ISO8601 with a timezone');

  const fraction = (match[7] || '').slice(0, 3).padEnd(3, '0');
  const offsetMinutes = match[8] === undefined
    ? 0
    : (match[8] === '-' ? -1 : 1) * (Number(match[9]) * 60 + Number(match[10]));
  const base = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    Number(fraction),
  );
  return base - offsetMinutes * 60000;
}

function compareIso(left, right) {
  return timestampParts(left) - timestampParts(right);
}

function assertCommandAuthority(command) {
  if (command.owner.type !== 'HUMAN') {
    throw new ReassessmentLoopError('UNAUTHORIZED_SUBJECT', 'owner must be HUMAN');
  }

  if (command.type === 'OPEN' && command.requestedBy.type === 'MODEL') {
    throw new ReassessmentLoopError(
      'UNAUTHORIZED_SUBJECT',
      'MODEL cannot open a loop',
    );
  }

  if (command.type === 'CLOSE' && command.closedBy.type !== 'HUMAN') {
    throw new ReassessmentLoopError(
      'UNAUTHORIZED_SUBJECT',
      'only HUMAN can close a loop',
    );
  }
}

function sameValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]));
  }

  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => (
    Object.hasOwn(right, key) && sameValue(left[key], right[key])
  ));
}

function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (!isObject(value)) return value;

  const copy = {};
  for (const key of Object.keys(value)) copy[key] = copyValue(value[key]);
  return copy;
}

function openSemanticMatches(loop, command) {
  return sameValue({
    loopId: loop.loopId,
    idempotencyKey: loop.openIdempotencyKey,
    sourceStage: loop.sourceStage,
    targetStage: loop.targetStage,
    reason: loop.reason,
    questions: loop.questions,
    requiredEvidence: loop.requiredEvidence,
    affectedConclusionIds: loop.affectedConclusionIds,
    owner: loop.owner,
    requestedBy: loop.requestedBy,
    openedAt: loop.openedAt,
  }, {
    loopId: command.loopId,
    idempotencyKey: command.idempotencyKey,
    sourceStage: command.sourceStage,
    targetStage: command.targetStage,
    reason: command.reason,
    questions: command.questions,
    requiredEvidence: command.requiredEvidence,
    affectedConclusionIds: command.affectedConclusionIds,
    owner: command.owner,
    requestedBy: command.requestedBy,
    openedAt: command.openedAt,
  });
}

function closeSemanticMatches(loop, command) {
  return sameValue({
    loopId: loop.loopId,
    idempotencyKey: loop.closeIdempotencyKey,
    closedAt: loop.closedAt,
    closedBy: loop.closedBy,
    resolution: loop.resolution,
    closeReceipt: loop.closeReceipt,
  }, {
    loopId: command.loopId,
    idempotencyKey: command.idempotencyKey,
    closedAt: command.closedAt,
    closedBy: command.closedBy,
    resolution: command.resolution,
    closeReceipt: command.closeReceipt,
  });
}

function success(input, loops, affectedLoop) {
  return {
    schemaVersion: 'local-reassessment.lab.v0',
    caseId: input.caseId,
    status: 'IDEMPOTENT_REPLAY',
    mainStage: input.currentStage,
    loops,
    loop: affectedLoop,
    authority: {
      mainStageChanged: false,
      modelAuthority: 'NONE',
      automaticLooping: false,
      projectDecisionAuthority: 'NONE',
    },
  };
}

export function applyReassessmentCommand(input) {
  assertExactObject(input, ['caseId', 'currentStage', 'loops', 'command'], 'input');
  nonEmptyString(input.caseId, 'input.caseId');
  assertStage(input.currentStage, 'input.currentStage');
  if (!Array.isArray(input.loops)) throw invalid('input.loops must be an array');

  if (!isObject(input.command)) throw invalid('input.command must be an object');
  if (input.command.type === 'OPEN') validateOpenCommand(input.command);
  else if (input.command.type === 'CLOSE') validateCloseCommand(input.command);
  else throw invalid('input.command.type is invalid');

  input.loops.forEach((loop, index) => validateLoop(loop, index));

  const loopIds = new Map();
  const idempotencyKeys = new Map();
  const receiptIds = new Map();
  for (const loop of input.loops) {
    if (loopIds.has(loop.loopId)) {
      throw new ReassessmentLoopError('DUPLICATE_ID', 'loopId is duplicated');
    }
    loopIds.set(loop.loopId, loop);

    const openKey = loop.openIdempotencyKey;
    if (idempotencyKeys.has(openKey)) {
      throw new ReassessmentLoopError('DUPLICATE_ID', 'idempotencyKey is duplicated');
    }
    idempotencyKeys.set(openKey, loop);

    const closeKey = loop.closeIdempotencyKey;
    if (closeKey !== null) {
      if (idempotencyKeys.has(closeKey)) {
        throw new ReassessmentLoopError('DUPLICATE_ID', 'idempotencyKey is duplicated');
      }
      idempotencyKeys.set(closeKey, loop);
    }

    const receiptId = loop.closeReceipt === null ? null : loop.closeReceipt.receiptId;
    if (receiptId !== null) {
      if (receiptIds.has(receiptId)) {
        throw new ReassessmentLoopError('DUPLICATE_ID', 'receiptId is duplicated');
      }
      receiptIds.set(receiptId, loop);
    }
  }

  for (const loop of input.loops) {
    if (loop.owner.type !== 'HUMAN' || loop.requestedBy.type === 'MODEL') {
      throw new ReassessmentLoopError('UNAUTHORIZED_SUBJECT', 'loop actor is unauthorized');
    }
    if (loop.status === 'CLOSED' && loop.closedBy.type !== 'HUMAN') {
      throw new ReassessmentLoopError('UNAUTHORIZED_SUBJECT', 'loop closer is unauthorized');
    }
  }
  assertCommandAuthority(input.command);

  for (const loop of input.loops) {
    if (!ROUTES.has(`${loop.sourceStage}>${loop.targetStage}`)) {
      throw new ReassessmentLoopError('INVALID_ROUTE', 'loop route is not allowed');
    }
  }

  const command = input.command;
  if (command.type === 'OPEN') {
    if (
      !ROUTES.has(`${command.sourceStage}>${command.targetStage}`) ||
      command.sourceStage !== input.currentStage
    ) {
      throw new ReassessmentLoopError('INVALID_ROUTE', 'open route is not allowed');
    }

    const keyMatch = idempotencyKeys.get(command.idempotencyKey);
    const idMatch = loopIds.get(command.loopId);
    const isReplay = keyMatch !== undefined &&
      keyMatch.openIdempotencyKey === command.idempotencyKey &&
      openSemanticMatches(keyMatch, command);
    if (isReplay) {
      const copiedLoops = input.loops.map(copyValue);
      return success(input, copiedLoops, copiedLoops[input.loops.indexOf(keyMatch)]);
    }
    if (idMatch !== undefined) {
      throw new ReassessmentLoopError('DUPLICATE_ID', 'loopId already exists');
    }
    if (keyMatch !== undefined) {
      throw new ReassessmentLoopError('IDEMPOTENCY_CONFLICT', 'open idempotency conflict');
    }

    const sameRoute = input.loops.filter((loop) => (
      loop.sourceStage === command.sourceStage &&
      loop.targetStage === command.targetStage
    ));
    if (sameRoute.some((loop) => loop.status === 'OPEN')) {
      throw new ReassessmentLoopError('ACTIVE_LOOP_EXISTS', 'same-route loop is active');
    }
    if (sameRoute.length >= 3) {
      throw new ReassessmentLoopError('LOOP_LIMIT_REACHED', 'route loop limit has been reached');
    }

    const newLoop = {
      loopId: command.loopId,
      openIdempotencyKey: command.idempotencyKey,
      sourceStage: command.sourceStage,
      targetStage: command.targetStage,
      reason: command.reason,
      questions: copyValue(command.questions),
      requiredEvidence: copyValue(command.requiredEvidence),
      affectedConclusionIds: copyValue(command.affectedConclusionIds),
      owner: copyValue(command.owner),
      requestedBy: copyValue(command.requestedBy),
      openedAt: command.openedAt,
      attempt: sameRoute.length + 1,
      status: 'OPEN',
      closedAt: null,
      closedBy: null,
      resolution: null,
      closeIdempotencyKey: null,
      closeReceipt: null,
    };
    const copiedLoops = input.loops.map(copyValue);
    copiedLoops.push(newLoop);
    return {
      ...success(input, copiedLoops, newLoop),
      status: 'OPENED',
    };
  }

  const target = loopIds.get(command.loopId);
  if (target === undefined) {
    throw new ReassessmentLoopError('LOOP_NOT_FOUND', 'close loop was not found');
  }

  if (target.status === 'CLOSED') {
    if (
      target.closeIdempotencyKey === command.idempotencyKey &&
      closeSemanticMatches(target, command)
    ) {
      const copiedLoops = input.loops.map(copyValue);
      return success(input, copiedLoops, copiedLoops[input.loops.indexOf(target)]);
    }
    throw new ReassessmentLoopError('IDEMPOTENCY_CONFLICT', 'close idempotency conflict');
  }

  if (
    idempotencyKeys.has(command.idempotencyKey) ||
    receiptIds.has(command.closeReceipt.receiptId)
  ) {
    throw new ReassessmentLoopError('IDEMPOTENCY_CONFLICT', 'close idempotency conflict');
  }
  if (
    compareIso(command.closedAt, target.openedAt) < 0 ||
    compareIso(command.closeReceipt.receivedAt, target.openedAt) < 0
  ) {
    throw new ReassessmentLoopError('INVALID_TRANSITION', 'close time precedes open time');
  }

  const copiedLoops = input.loops.map(copyValue);
  const copiedTarget = copiedLoops[input.loops.indexOf(target)];
  copiedTarget.status = 'CLOSED';
  copiedTarget.closedAt = command.closedAt;
  copiedTarget.closedBy = copyValue(command.closedBy);
  copiedTarget.resolution = command.resolution;
  copiedTarget.closeIdempotencyKey = command.idempotencyKey;
  copiedTarget.closeReceipt = copyValue(command.closeReceipt);

  return {
    ...success(input, copiedLoops, copiedTarget),
    status: 'CLOSED',
  };
}
