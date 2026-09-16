import type { V3CollaborationReadyDto } from '../../../lib/v3-collaboration-client';

export type InsightViewMode = 'relationship' | 'path' | 'matrix';

export type InsightProcessRow = {
  processId: string;
  label: string;
  ownerLabel: string;
  task: string;
  runStatus: string;
  runStatusLabel: string;
  gateState: string;
  gateStateLabel: string;
};

export type InsightRuntimeModel = {
  caseId: string;
  contextVersion: string;
  projectionVersion: string;
  focusProcessId: string;
  processRows: InsightProcessRow[];
  exceptionBars: Array<{ id: string; label: string; value: number | null }>;
  throughputScenario: number[];
  sla: { targetMinutes: number; actualMinutes: null; forecastMinutes: null };
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  queued: '已排队',
  running: '处理中',
  partial: '部分完成',
  needs_input: '待补充',
  ready_for_gate: '待人类 Gate',
  completed: '已完成',
  failed: '失败',
  not_started: '未开始',
};

export const GATE_STATE_LABELS: Record<string, string> = {
  not_ready: '未就绪',
  ready: '待具名决定',
  confirmed: '已有人类回执',
  rejected: '已有人类退回',
  returned_for_evidence: '待补证',
};

const FOCUS_PRIORITY: Record<string, number> = {
  failed: 0,
  needs_input: 1,
  ready_for_gate: 2,
  running: 3,
  partial: 4,
  queued: 5,
  not_started: 6,
  completed: 7,
};

function safeLabel(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '未提供';
}

export function buildInsightRuntime(ready: V3CollaborationReadyDto): InsightRuntimeModel {
  const memberByProcess = new Map(
    ready.thread.members.map((member) => [String(member.processId), safeLabel(member.ownerLabel)]),
  );
  const processRows = ready.workItems.map((item) => ({
    processId: String(item.processId),
    label: safeLabel(item.label),
    ownerLabel: memberByProcess.get(String(item.processId)) ?? '未提供',
    task: safeLabel(item.task),
    runStatus: item.runStatus,
    runStatusLabel: RUN_STATUS_LABELS[item.runStatus] ?? '未提供',
    gateState: item.gateState,
    gateStateLabel: GATE_STATE_LABELS[item.gateState] ?? '未提供',
  }));
  const focusProcessId = [...processRows]
    .sort((left, right) => (FOCUS_PRIORITY[left.runStatus] ?? 99) - (FOCUS_PRIORITY[right.runStatus] ?? 99))[0]
    ?.processId ?? '';
  const hasCompleteRuntimeSet = processRows.length > 0;

  return {
    caseId: safeLabel(ready.caseId),
    contextVersion: safeLabel(ready.contextVersion),
    projectionVersion: safeLabel(ready.projectionVersion),
    focusProcessId,
    processRows,
    exceptionBars: [
      {
        id: 'needs-input',
        label: '待补充',
        value: hasCompleteRuntimeSet
          ? processRows.filter((row) => row.runStatus === 'needs_input').length
          : null,
      },
      {
        id: 'failed',
        label: '失败',
        value: hasCompleteRuntimeSet
          ? processRows.filter((row) => row.runStatus === 'failed').length
          : null,
      },
      {
        id: 'human-gate',
        label: '待人类 Gate',
        value: hasCompleteRuntimeSet
          ? processRows.filter((row) => row.runStatus === 'ready_for_gate' || row.gateState === 'ready').length
          : null,
      },
    ],
    throughputScenario: [5, 7, 6, 9, 8, 11, 10, 12],
    sla: {
      targetMinutes: 15,
      actualMinutes: null,
      forecastMinutes: null,
    },
  };
}
