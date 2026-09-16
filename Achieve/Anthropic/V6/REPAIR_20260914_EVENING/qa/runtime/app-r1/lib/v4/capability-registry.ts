import type {
  V4CapabilityAdmission,
  V4CapabilityManifest,
  V4CapabilityOutputKind,
  V4CapabilityRegistry,
  V4CapabilityRegistryItem,
} from './capability-types.ts';

type DataObject = Record<string, unknown>;

const MANIFEST_KEYS = [
  'capabilityId',
  'version',
  'owner',
  'businessStages',
  'kind',
  'entryWhen',
  'doNotEnterWhen',
  'exitWhen',
  'handoffTo',
  'inputSchemaRef',
  'outputSchemaRef',
  'permissions',
  'authority',
  'execution',
  'failure',
  'evaluation',
  'governance',
] as const;

const BUSINESS_STAGES: ReadonlySet<string> = new Set([
  'opportunity',
  'due_diligence',
  'credit',
  'commercial',
  'asset',
  'commencement',
  'servicing',
  'closure',
  'governance',
]);

const CAPABILITY_KINDS: ReadonlySet<string> = new Set([
  'SignalSource',
  'Extractor',
  'Analyzer',
  'Recommender',
  'Copilot',
  'Executor',
  'Adapter',
  'Projection',
  'EvolutionTool',
]);

const VERSION_STATES: ReadonlySet<string> = new Set([
  'draft',
  'evaluated',
  'approved',
  'shadow',
  'active',
  'suspended',
  'quarantined',
  'deprecated',
  'removed',
]);

const ADMISSIBLE_STATES: ReadonlySet<string> = new Set(['shadow', 'active']);
const OUTPUT_KINDS: ReadonlySet<string> = new Set([
  'evidence',
  'candidate',
  'action_intent',
]);

const MAX_TIMEOUT_MS = 300_000;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 60_000;

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function invalidManifest(): never {
  throw failure('INVALID_CAPABILITY_MANIFEST', 'Capability manifest shape or value is invalid');
}

function isPlainObject(value: unknown): value is DataObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataObject(value: unknown, expectedKeys: readonly string[]): DataObject {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) {
    return invalidManifest();
  }

  const propertyNames = Object.getOwnPropertyNames(value);
  if (
    propertyNames.length !== expectedKeys.length ||
    !propertyNames.every((key) => expectedKeys.includes(key))
  ) {
    return invalidManifest();
  }

  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return invalidManifest();
    }
  }

  return value;
}

function exactArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) {
    return invalidManifest();
  }

  const expectedNames = Array.from({ length: value.length }, (_, index) => String(index));
  expectedNames.push('length');
  const propertyNames = Object.getOwnPropertyNames(value);
  if (
    propertyNames.length !== expectedNames.length ||
    !propertyNames.every((key) => expectedNames.includes(key))
  ) {
    return invalidManifest();
  }

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return invalidManifest();
    }
  }

  return value;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: unknown, requireItem = false): string[] {
  const values = exactArray(value);
  if ((requireItem && values.length === 0) || !values.every(nonEmptyString)) {
    return invalidManifest();
  }
  return values as string[];
}

function safeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function validateManifestShape(input: unknown): V4CapabilityManifest {
  const manifest = exactDataObject(input, MANIFEST_KEYS);

  if (!nonEmptyString(manifest.capabilityId) || !nonEmptyString(manifest.version)) {
    return invalidManifest();
  }

  const owner = exactDataObject(manifest.owner, ['actorId', 'organizationUnitId']);
  if (!nonEmptyString(owner.actorId) || !nonEmptyString(owner.organizationUnitId)) {
    return invalidManifest();
  }

  const businessStages = stringArray(manifest.businessStages, true);
  if (!businessStages.every((stage) => BUSINESS_STAGES.has(stage))) {
    return invalidManifest();
  }
  if (typeof manifest.kind !== 'string' || !CAPABILITY_KINDS.has(manifest.kind)) {
    return invalidManifest();
  }

  stringArray(manifest.entryWhen);
  stringArray(manifest.doNotEnterWhen);
  stringArray(manifest.exitWhen);
  stringArray(manifest.handoffTo);
  if (!nonEmptyString(manifest.inputSchemaRef) || !nonEmptyString(manifest.outputSchemaRef)) {
    return invalidManifest();
  }

  const permissions = exactDataObject(manifest.permissions, ['read', 'write']);
  stringArray(permissions.read);
  stringArray(permissions.write);
  if (!nonEmptyString(manifest.authority)) {
    return invalidManifest();
  }

  const execution = exactDataObject(manifest.execution, [
    'adapterId',
    'timeoutMs',
    'retry',
    'idempotency',
  ]);
  const retry = exactDataObject(execution.retry, ['maxAttempts', 'backoffMs']);
  if (
    !nonEmptyString(execution.adapterId) ||
    !safeIntegerInRange(execution.timeoutMs, 1, MAX_TIMEOUT_MS) ||
    !safeIntegerInRange(retry.maxAttempts, 1, MAX_RETRY_ATTEMPTS) ||
    !safeIntegerInRange(retry.backoffMs, 0, MAX_BACKOFF_MS) ||
    execution.idempotency !== 'required'
  ) {
    return invalidManifest();
  }

  const failureConfig = exactDataObject(manifest.failure, [
    'mode',
    'fallbackCapabilityId',
  ]);
  if (
    failureConfig.mode !== 'fail_closed' ||
    (failureConfig.fallbackCapabilityId !== null &&
      !nonEmptyString(failureConfig.fallbackCapabilityId))
  ) {
    return invalidManifest();
  }

  const evaluation = exactDataObject(manifest.evaluation, [
    'evaluationSetId',
    'minimumScore',
  ]);
  if (
    !nonEmptyString(evaluation.evaluationSetId) ||
    typeof evaluation.minimumScore !== 'number' ||
    !Number.isFinite(evaluation.minimumScore) ||
    evaluation.minimumScore < 0 ||
    evaluation.minimumScore > 1
  ) {
    return invalidManifest();
  }

  const governance = exactDataObject(manifest.governance, [
    'state',
    'approvalReceiptId',
    'rollbackVersion',
  ]);
  if (
    typeof governance.state !== 'string' ||
    !VERSION_STATES.has(governance.state) ||
    !nonEmptyString(governance.approvalReceiptId) ||
    !nonEmptyString(governance.rollbackVersion)
  ) {
    return invalidManifest();
  }

  return structuredClone(manifest) as V4CapabilityManifest;
}

export function admitV4CapabilityManifest(input: unknown): V4CapabilityAdmission {
  const manifest = validateManifestShape(input);

  if (manifest.authority !== 'none') {
    throw failure(
      'CAPABILITY_AUTHORITY_FORBIDDEN',
      'A capability cannot claim decision authority',
    );
  }
  if (!manifest.permissions.write.every((output) => OUTPUT_KINDS.has(output))) {
    throw failure(
      'CAPABILITY_OUTPUT_FORBIDDEN',
      'A capability may only write evidence, candidate, or action intent output',
    );
  }
  if (!ADMISSIBLE_STATES.has(manifest.governance.state)) {
    throw failure(
      'CAPABILITY_NOT_ADMISSIBLE',
      'Only approved shadow or active capability versions are admissible',
    );
  }

  return {
    manifest: structuredClone(manifest),
    admission: {
      status: 'admitted',
      checks: [
        'manifest-exact-shape',
        'authority-none',
        'output-boundary',
        'governance-eligible',
      ],
    },
  };
}

function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function registryItem(admission: V4CapabilityAdmission): V4CapabilityRegistryItem {
  const { manifest } = admission;
  return {
    capabilityId: manifest.capabilityId,
    version: manifest.version,
    owner: structuredClone(manifest.owner),
    businessStages: structuredClone(manifest.businessStages),
    kind: manifest.kind,
    governanceState: manifest.governance.state as 'shadow' | 'active',
    authority: 'none',
    outputs: structuredClone(manifest.permissions.write) as V4CapabilityOutputKind[],
  };
}

export function createV4CapabilityRegistry(input: unknown): V4CapabilityRegistry {
  const config = exactDataObject(input, ['registryVersion', 'manifests']);
  if (!nonEmptyString(config.registryVersion)) {
    return invalidManifest();
  }

  const manifests = exactArray(config.manifests);
  const admissions = manifests.map((manifest) => admitV4CapabilityManifest(manifest));
  const byIdentity = new Map<string, V4CapabilityAdmission>();

  for (const admission of admissions) {
    const { capabilityId, version } = admission.manifest;
    const identity = JSON.stringify([capabilityId, version]);
    if (byIdentity.has(identity)) {
      throw failure(
        'DUPLICATE_CAPABILITY_VERSION',
        'A capability version may be registered only once',
      );
    }
    byIdentity.set(identity, structuredClone(admission));
  }

  const sortedAdmissions = [...byIdentity.values()].sort((left, right) => {
    const capabilityOrder = compareOrdinal(
      left.manifest.capabilityId,
      right.manifest.capabilityId,
    );
    return capabilityOrder !== 0
      ? capabilityOrder
      : compareOrdinal(left.manifest.version, right.manifest.version);
  });
  const registryVersion = config.registryVersion;

  return {
    registryVersion,
    list() {
      return structuredClone(sortedAdmissions);
    },
    get(capabilityId: string, version: string) {
      const identity = JSON.stringify([capabilityId, version]);
      const admission = byIdentity.get(identity);
      if (!admission) {
        throw failure('CAPABILITY_NOT_FOUND', 'Capability version was not found');
      }
      return structuredClone(admission);
    },
    snapshot() {
      return {
        registryVersion,
        capabilities: sortedAdmissions.map(registryItem),
      };
    },
  };
}
