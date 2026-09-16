import type { V3ProcessProjectionDto, V3RoleProjectionDto } from '../../../lib/v3-client';

export type V3SurfaceEntryId =
  | 'collaboration'
  | 'value'
  | 'opportunity'
  | 'insight'
  | 'business'
  | 'policy'
  | 'credit'
  | 'commercial'
  | 'asset';

export type V3SurfaceFamily = 'leadership' | 'opportunity' | 'insight' | 'workbench';
export type SurfaceMode = 'relationship' | 'path' | 'matrix';

export const V3_SURFACE_ENTRY_IDS = [
  'collaboration',
  'value',
  'opportunity',
  'insight',
  'business',
  'policy',
  'credit',
  'commercial',
  'asset',
] as const satisfies readonly V3SurfaceEntryId[];

export const V3_SURFACE_FAMILIES = [
  'leadership',
  'opportunity',
  'insight',
  'workbench',
] as const satisfies readonly V3SurfaceFamily[];

export type SurfacePrincipalId =
  | 'collaboration-manager'
  | 'business-owner'
  | 'risk-policy'
  | 'risk-credit'
  | 'risk-commercial'
  | 'risk-asset'
  | 'external-customer'
  | 'external-supplier';

export type V3SurfaceRoleOption = {
  principalId: string;
  label: string;
  application: string;
};

export type V3QuarterProgress = Record<'policy' | 'credit' | 'commercial' | 'asset', 0 | 1 | 2 | 3 | 4 | null>;

export const SURFACE_ROLES = [
  { principalId: 'collaboration-manager', label: '领导', application: '领导观察' },
  { principalId: 'business-owner', label: '业务', application: 'Case Owner' },
  { principalId: 'risk-policy', label: '政策', application: '专业 Projection' },
  { principalId: 'risk-credit', label: '信审', application: '专业 Projection' },
  { principalId: 'risk-commercial', label: '商务', application: '专业 Projection' },
  { principalId: 'risk-asset', label: '资产', application: '专业 Projection' },
  { principalId: 'external-customer', label: '客户', application: '受邀协同' },
  { principalId: 'external-supplier', label: '供应商', application: '受邀协同' },
] as const satisfies ReadonlyArray<{
  principalId: SurfacePrincipalId;
  label: string;
  application: string;
}>;

export const PROFESSIONAL_QUADRANTS = [
  { processId: 'asset', label: '资产', area: 'top-left' },
  { processId: 'policy', label: '政策', area: 'top-right' },
  { processId: 'commercial', label: '商务', area: 'bottom-left' },
  { processId: 'credit', label: '信审', area: 'bottom-right' },
] as const;

export const PROFESSIONAL_PATH = ['材料', '规则', '模型', '人审'] as const;

export function progressLevelForProcess(
  projection: V3RoleProjectionDto | null,
  processId: 'policy' | 'credit' | 'commercial' | 'asset',
): 0 | 1 | 2 | 3 | 4 | null {
  const process = projection?.processProjections.find((item) => item.processId === processId);
  return process ? process.evidenceCoverageBand : null;
}

export function processProjectionFor(
  projection: V3RoleProjectionDto | null,
  processId: V3ProcessProjectionDto['processId'],
): V3ProcessProjectionDto | null {
  return projection?.processProjections.find((item) => item.processId === processId) ?? null;
}

export function visibleThresholdLabel(level: 0 | 1 | 2 | 3 | 4 | null): string {
  if (level === null) return '未提供';
  if (level === 0) return '尚未推进';
  return `已到第 ${level} 档`;
}

export function valueChartCount(mode: SurfaceMode): number {
  if (mode === 'relationship') return 3;
  if (mode === 'path') return 2;
  return 0;
}
