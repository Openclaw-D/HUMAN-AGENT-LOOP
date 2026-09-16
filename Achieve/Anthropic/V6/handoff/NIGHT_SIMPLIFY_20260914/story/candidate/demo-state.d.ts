// jw-demo-state 类型声明（供 A 集成到产品 TS 代码；随实现 demo-state.mjs 手工维护）
// 阶段/域/段状态类型对齐 lib/v5-preview/shared-types.ts 既有类型（SegmentState / JudgmentStatus / DomainId）。

export declare const STORY_SCHEMA: 'jw-demo-story@1';
export declare const SNAPSHOT_SCHEMA: 'jw-demo-snapshot@1';

export type StepKind = 'auto' | 'human-action' | 'human-decision';
export type DecisionOutcome = 'close' | 'return';
export type SegmentState = 'done' | 'current' | 'pending';
export type JudgmentStatus = 'green' | 'yellow' | 'red' | 'gray';

export interface StoryMessagePreset {
  actor: string;
  text: string;
  marks?: string[];
}

export interface DecisionEffect {
  evidenceUpdates?: Array<{
    docId: string;
    newVersion: number;
    supersedesVersion: number;
    recordDocId?: string;
    reason?: string;
  }>;
  invalidateOpinions?: string[];
  messages?: StoryMessagePreset[];
}

export interface DecisionOptionPreset {
  decision: string;
  label: string;
  outcome: DecisionOutcome;
  effects?: DecisionEffect;
  viewPatch?: {
    ceilingMilestoneIndex: number;
    patch: {
      domains?: Record<string, Partial<DomainView>>;
      stagesPatch?: Record<string, SegmentState>;
      overallNote?: string;
    };
  };
  detail?: string;
}

export interface DomainView {
  state: SegmentState;
  judgment: JudgmentStatus;
  judgmentText: string;
}

export interface StepView {
  stages: Record<string, SegmentState>;
  domains: Record<string, DomainView>;
  overallLabel: string;
  overallNote?: string;
}

export type Requirement = string | { step: string; outcome: DecisionOutcome[] };

export interface DemoStep {
  stepId: string;
  stage: string;
  title: string;
  kind: StepKind;
  trigger: string;
  actorRole?: string;
  milestoneIndex?: number | null;
  requires: Requirement[];
  requiresAny: Requirement[];
  messages?: StoryMessagePreset[];
  evidenceAdds?: Array<{ docId: string; title: string; sourceStatus: string; version: number }>;
  evidenceRefs?: Array<{ docId: string; version: number }>;
  decisionOptions?: DecisionOptionPreset[];
  view?: StepView | null;
  viewPatch?: {
    ceilingMilestoneIndex: number;
    patch: {
      domains?: Record<string, Partial<DomainView>>;
      stagesPatch?: Record<string, SegmentState>;
      overallNote?: string;
    };
  };
  notes?: string;
}

export interface DemoStory {
  schema: 'jw-demo-story@1';
  storyId: string;
  synthetic: true;
  syntheticNotice: string;
  stages: Array<{ id: string; label: string }>;
  terminalStepId: string;
  terminalLabel: string;
  domains: string[];
  domainLabels: Record<string, string>;
  actors: Record<string, { fromKind: 'business' | 'domain' | 'system'; fromName: string }>;
  initialView: StepView;
  evidence: Array<{ docId: string; title: string; sourceStatus: string; initialVersion: number }>;
  opinions: Array<{ opinionId: string; text: string; basedOn: { docId: string; version: number } }>;
  parallelGroups: Array<{ id: string; note: string; steps: string[] }>;
  steps: DemoStep[];
}

export interface CompletionRecord {
  stepId: string;
  requestId: string;
  kind: StepKind;
  decision?: string;
  outcome?: DecisionOutcome;
}

export interface DemoState {
  storyId: string;
  demoScope: 'demo-only';
  completed: CompletionRecord[];
  evidence: Record<
    string,
    { docId: string; title: string; sourceStatus: string; versions: Array<{ version: number; state: 'valid' | 'superseded' }> }
  >;
  invalidatedOpinions: string[];
  decisionMessages: StoryMessagePreset[];
}

export type Ok<T> = { ok: true; value?: T; state?: DemoState; replayed?: boolean };
export type Err = { ok: false; code: string; message: string };
export type Result<T> = Ok<T> | Err;

export declare function validateStory(story: DemoStory): { ok: boolean; errors: string[] };
export declare function createDemoState(story: DemoStory): DemoState;
export declare function resetDemo(story: DemoStory): DemoState;

export interface AvailableAction {
  stepId: string;
  kind: StepKind;
  title: string;
  decisionOptions?: Array<{ decision: string; label: string; outcome: DecisionOutcome }>;
}

export declare function listAvailableActions(story: DemoStory, state: DemoState): AvailableAction[];
export declare function advance(story: DemoStory, state: DemoState, stepId: string, requestId: string): Result<DemoState>;
export declare function decide(
  story: DemoStory,
  state: DemoState,
  stepId: string,
  requestId: string,
  decision: string
): Result<DemoState>;
export declare function advanceAuto(
  story: DemoStory,
  state: DemoState,
  baseRequestId: string
): { ok: true; state: DemoState; completed: string[]; stoppedAt: { stepId: string; kind: StepKind } | null } | Err;

export interface DemoView {
  stages: Record<string, SegmentState>;
  domains: Record<string, DomainView>;
  overallLabel: string;
  overallNote?: string;
  terminal: boolean;
}

export declare function views(story: DemoStory, state: DemoState): DemoView;

export interface DemoMessage {
  stepId: string;
  fromKind: 'business' | 'domain' | 'system';
  fromName: string;
  text: string;
  marks: string[];
}

export declare function storyMessages(story: DemoStory, state: DemoState): DemoMessage[];

export declare function evidenceState(
  state: DemoState,
  docId: string
): { docId: string; title: string; validVersion: number | null; versions: Array<{ version: number; state: string }> } | null;
export declare function assertEvidenceCite(state: DemoState, docId: string, version: number): Result<{ docId: string; version: number; state: string }>;
export declare function isOpinionInvalidated(state: DemoState, opinionId: string): boolean;

export interface DemoSnapshot {
  schema: 'jw-demo-snapshot@1';
  storyId: string;
  completed: CompletionRecord[];
}

export declare function snapshot(state: DemoState): DemoSnapshot;
export declare function restore(story: DemoStory, snap: DemoSnapshot): Result<DemoState>;
