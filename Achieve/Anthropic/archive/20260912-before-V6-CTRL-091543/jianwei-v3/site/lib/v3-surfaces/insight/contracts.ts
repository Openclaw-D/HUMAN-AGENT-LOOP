import type {
  V3AuthorityEvent,
  V3ContextRef,
  V3ProcessRun,
  V3Receipt,
} from '../../v3-authority-runtime.ts';

export type InsightGrain = 'system-runtime' | 'case';
export type InsightNodeKind = 'human' | 'agent' | 'system' | 'task';
export type InsightAuthorityType = 'event' | 'proposal' | 'decision' | 'task';
export type InsightAuthorityLevel = 'none' | 'confirmed';
export type InsightSourceKind = 'human' | 'agent' | 'system';
export type InsightValueClass = 'actual' | 'forecast' | 'scenario';

export type InsightSource = {
  sourceType: 'shared-runtime' | 'shared-chat' | 'not-provided';
  sourceMode: 'in_memory_demo' | 'not_connected';
  system: string;
  refs: Array<string>;
};

export type InsightProvenance = {
  derivedBy: string;
  runtimeEpoch: string;
  contextVersion: string;
};

export type InsightMetricValue = {
  valueClass: InsightValueClass;
  availability: 'provided' | 'unavailable';
  value: number | null;
  displayValue: number | '未提供';
  unit: string;
  source: InsightSource;
  provenance: InsightProvenance;
  asOf: string | null;
};

export type InsightNode = {
  id: string;
  kind: InsightNodeKind;
  label: string;
  caseId: string | null;
  processId: string | null;
  status: string;
  authority: InsightAuthorityLevel;
  source: InsightSource;
  provenance: InsightProvenance;
  asOf: string | null;
};

export type InsightEdge = {
  id: string;
  source: string;
  target: string;
  relation: 'controls' | 'supports' | 'owns' | 'projects-to';
  authority: 'none';
};

export type InsightAuthorityRecord = {
  id: string;
  authorityType: InsightAuthorityType;
  authority: InsightAuthorityLevel;
  caseId: string;
  processId: string | null;
  source: {
    kind: InsightSourceKind;
    principalId: string;
    refId: string;
  };
  status: string;
  asOf: string | null;
};

export type InsightCollaborationMember = {
  principalId: string;
  processId: string;
  label: string;
  ownerLabel: string;
};

export type InsightCollaborationEntry = {
  entryId: string;
  actorLabel: string;
  processId: string | null;
  text: string;
  kind: string;
  contextVersion: string;
  recordedAt: string | null;
  authority: 'none';
};

export type InsightWorkItem = {
  processId: string;
  label: string;
  task: string;
  runStatus: string;
  gateState: string;
};

export type InsightRuntimeInput = {
  scenarioRef: {
    caseId: string;
    scenarioId: string;
    scenarioVersion: string;
    dataClass: string;
  };
  runtimeEpoch: string;
  currentContext: V3ContextRef;
  cases: Array<{ caseId: string }>;
  processRuns: Array<V3ProcessRun>;
  receipts: Array<V3Receipt>;
  events: Array<V3AuthorityEvent>;
  collaboration: {
    threadId: string;
    members: Array<InsightCollaborationMember>;
    entries: Array<InsightCollaborationEntry>;
    workItems: Array<InsightWorkItem>;
  } | null;
  sourceMode: 'in_memory_demo';
  telemetryContract: {
    humanTakeoverDenominatorComplete: boolean;
    slaTargetMinutes: number | null;
    forecastThroughputPerHour: number | null;
    scenarioThroughputPerHour: number | null;
  };
};

export type InsightChatContext = {
  caseId: string;
  contextVersion: string;
  runtimeEpoch: string;
  threadId: string;
  entries: Array<InsightCollaborationEntry>;
  asOf: string | null;
};

export type InsightChatRequest = {
  requestId: string;
  caseId: string;
  message: string;
};

export type InsightChatReply = {
  requestId: string;
  caseId: string;
  contextVersion: string;
  reply: {
    actorId: '@JW';
    actorKind: 'agent';
    authorityType: 'candidate';
    authority: 'none';
    persistence: 'non_persistent_candidate';
    text: string;
  };
  source: InsightSource;
  provenance: InsightProvenance;
  asOf: string | null;
  idempotency: {
    key: string;
    replayed: boolean;
  };
};
