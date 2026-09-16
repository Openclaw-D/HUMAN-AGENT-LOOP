import { V3_SHARED_PORTFOLIO, V3_SHARED_SCENARIO_REF } from '../shared/demo-fixtures.ts';
import {
  V3_PROFESSIONAL_PATH_LABELS,
  V3_PROFESSIONAL_PATH_STEPS,
  V3_SHARED_SCHEMA_VERSION,
  missingChartDatum,
  toFrontendQuarterThreshold,
  type V3ChartDatum,
  type V3ChartSeries,
  type V3ContextSelector,
  type V3ProfessionalPath,
  type V3ProfessionalRole,
  type V3RoleProjectionId,
  type V3SharedReadModel,
} from '../shared/contracts.ts';
import { getV3RolePolicy } from '../shared/role-policies.ts';
import type { V3SqliteStore, V3StoredCase } from '../../v3-runtime/sqlite-store.ts';

export type V3SurfaceKind = 'collaboration' | 'value';

export type V3ContextHierarchyItem = {
  contextId: string;
  grain: 'portfolio' | 'division' | 'case';
  label: string;
  divisionId: string | null;
  caseId: string | null;
  parentContextId: string | null;
};

export type V3LeadershipSurfaceProjection = {
  surface: V3SurfaceKind;
  defaultContextGrain: 'portfolio';
  hierarchy: V3ContextHierarchyItem[];
  readModel: V3SharedReadModel;
};

const PROFESSIONAL_ROLES: V3ProfessionalRole[] = ['policy', 'credit', 'commercial', 'asset'];

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function average(values: Array<number | null>): number | null {
  const provided = values.filter((value): value is number => value !== null);
  if (provided.length === 0) return null;
  return Number((provided.reduce((total, value) => total + value, 0) / provided.length).toFixed(1));
}

function scenarioSourceRefs(store: V3SqliteStore, cases: V3StoredCase[]): string[] {
  const caseIds = new Set(cases.map((item) => item.caseId));
  return store.listReceipts()
    .filter((receipt) => receipt.receiptType === 'scenario_source' && caseIds.has(String(receipt.payload.caseId ?? '')))
    .map((receipt) => receipt.receiptId);
}

function providedDatum(
  datumId: string,
  label: string,
  value: number,
  unit: string,
  sourceRefs: string[],
): V3ChartDatum {
  return {
    datumId,
    label,
    value,
    displayValue: value,
    unit,
    provenance: {
      sourceKind: 'derived',
      sourceRefs,
      observedAt: null,
      asOf: '2026-08-30T00:00:00.000Z',
      dataClass: 'synthetic_deidentified_demo',
      connectionStatus: 'scenario_only',
      availability: 'provided',
    },
  };
}

function professionalPaths(cases: V3StoredCase[]): V3ProfessionalPath[] {
  return PROFESSIONAL_ROLES.map((role) => {
    const backendContinuousProgress = average(cases.map((item) => item.backendProgress[role]));
    return {
      role,
      steps: V3_PROFESSIONAL_PATH_STEPS,
      stepLabels: V3_PROFESSIONAL_PATH_LABELS,
      backendContinuousProgress,
      frontendQuarterThreshold: toFrontendQuarterThreshold(backendContinuousProgress),
      missingDisplay: backendContinuousProgress === null ? '未提供' : null,
    };
  });
}

function collaborationCharts(store: V3SqliteStore, cases: V3StoredCase[]): V3ChartSeries[] {
  const refs = scenarioSourceRefs(store, cases);
  const attentionCounts = ['normal', 'attention', 'elevated'].map((attention) => ({
    attention,
    value: cases.filter((item) => item.attention === attention).length,
  }));
  const pathData = PROFESSIONAL_ROLES.map((role) => {
    const value = average(cases.map((item) => item.backendProgress[role]));
    return value === null
      ? missingChartDatum(`progress-${role}`, role, refs)
      : providedDatum(`progress-${role}`, role, value, 'backend_progress_points', refs);
  });
  return [
    {
      chartId: 'case-attention-distribution',
      title: '事项关注分布',
      chartKind: 'bar',
      data: attentionCounts.map((item) =>
        providedDatum(`attention-${item.attention}`, item.attention, item.value, 'cases', refs)),
    },
    {
      chartId: 'professional-path-progress',
      title: '四专业路径进展',
      chartKind: 'matrix',
      data: pathData,
    },
  ];
}

function valueCharts(store: V3SqliteStore, cases: V3StoredCase[]): V3ChartSeries[] {
  const refs = scenarioSourceRefs(store, cases);
  const netIncomeValues = cases.map((item) => item.netIncome).filter((value): value is number => value !== null);
  const netIncome = netIncomeValues.length > 0
    ? Number(netIncomeValues.reduce((total, value) => total + value, 0).toFixed(1))
    : null;
  const unitAssetOutput = average(cases.map((item) => item.unitAssetOutput));
  return [
    {
      chartId: 'verifiable-net-income',
      title: '本期可验证净收入',
      chartKind: 'bar',
      data: [netIncome === null
        ? missingChartDatum('net-income', '净收入', refs)
        : providedDatum('net-income', '净收入', netIncome, '万元', refs)],
    },
    {
      chartId: 'unit-asset-output',
      title: '单位资产产出效率',
      chartKind: 'line',
      data: [unitAssetOutput === null
        ? missingChartDatum('unit-asset-output', '单位资产产出', refs)
        : providedDatum('unit-asset-output', '单位资产产出', unitAssetOutput, '场景指数', refs)],
    },
    {
      chartId: 'full-cycle-profit-forecast',
      title: '全周期利润预测',
      chartKind: 'line',
      data: [missingChartDatum('full-cycle-profit', '全周期利润', refs)],
    },
  ];
}

export function leadershipDefaultContextSelector(): V3ContextSelector {
  return {
    grain: 'portfolio',
    portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
    divisionId: null,
    caseId: null,
  };
}

export function createV3SurfaceProjection(input: {
  store: V3SqliteStore;
  surface: V3SurfaceKind;
  role: V3RoleProjectionId;
  context?: V3ContextSelector;
}): V3LeadershipSurfaceProjection {
  const selector = input.context ?? leadershipDefaultContextSelector();
  const policy = getV3RolePolicy(input.role);
  if (!policy.visibleGrains.includes(selector.grain)) {
    throw failure('CONTEXT_SCOPE_DENIED', '当前 Role Projection 不可读取该粒度');
  }
  const context = input.store.resolveContext(selector);
  const cases = input.store.listCases(selector);
  const charts = input.surface === 'collaboration'
    ? collaborationCharts(input.store, cases)
    : valueCharts(input.store, cases);
  if (charts.length > 4) throw failure('CHART_LIMIT_EXCEEDED', '单页图表不得超过 4 个');
  const visibleContexts = policy.visibleGrains.includes('portfolio')
    ? input.store.listContexts()
    : [context];
  const hierarchy = visibleContexts.map((item) => ({
    contextId: item.contextId,
    grain: item.grain,
    label: item.label,
    divisionId: item.divisionId,
    caseId: item.caseId,
    parentContextId: item.parentContextId,
  }));
  return {
    surface: input.surface,
    defaultContextGrain: 'portfolio',
    hierarchy,
    readModel: {
      schemaVersion: V3_SHARED_SCHEMA_VERSION,
      scenarioRef: structuredClone(V3_SHARED_SCENARIO_REF),
      context,
      roleProjection: policy,
      professionalPaths: professionalPaths(cases),
      charts,
      messages: input.store.listMessages(context.contextId),
    },
  };
}
