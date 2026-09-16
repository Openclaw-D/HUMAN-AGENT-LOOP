import type {
  BusinessActionType,
  ProfessionalActionType,
  QuarterThreshold,
  WorkbenchPathStep,
  WorkbenchPerspective,
} from '../../../lib/v3-surfaces/workbench/types';

export const WORKBENCH_ROUTE_IDS = ['business', 'policy', 'credit', 'commercial', 'asset'] as const satisfies readonly WorkbenchPerspective[];

export type WorkbenchRouteId = (typeof WORKBENCH_ROUTE_IDS)[number];
export type ProfessionalId = Exclude<WorkbenchRouteId, 'business'>;
export type WorkbenchMode = 'relationship' | 'path' | 'matrix';

export const WORKBENCH_ROUTES = {
  business: { label: '业务', pageTitle: 'Case Workbench', heading: '业务作战工作台', icon: 'crown', defaultMode: 'relationship' },
  policy: { label: '政策', pageTitle: '政策专业视角', heading: '政策专业工作台', icon: 'x', defaultMode: 'path' },
  credit: { label: '信审', pageTitle: '信审专业视角', heading: '信审专业工作台', icon: 'shield', defaultMode: 'path' },
  commercial: { label: '商务', pageTitle: '商务专业视角', heading: '商务专业工作台', icon: 'contract', defaultMode: 'path' },
  asset: { label: '资产', pageTitle: '资产专业视角', heading: '资产专业工作台', icon: 'diamond', defaultMode: 'path' },
} as const satisfies Record<WorkbenchRouteId, {
  label: string;
  pageTitle: string;
  heading: string;
  icon: 'crown' | 'x' | 'shield' | 'contract' | 'diamond';
  defaultMode: WorkbenchMode;
}>;

export const ROUTE_PRINCIPAL = {
  business: 'business-owner', policy: 'risk-policy', credit: 'risk-credit',
  commercial: 'risk-commercial', asset: 'risk-asset',
} as const;

export const PRINCIPAL_ROLE = {
  'collaboration-manager': 'leadership', 'business-owner': 'business', 'risk-policy': 'policy',
  'risk-credit': 'credit', 'risk-commercial': 'commercial', 'risk-asset': 'asset',
  'external-customer': 'customer', 'external-supplier': 'supplier',
} as const;

export const BUSINESS_ACTION_LABELS: Record<BusinessActionType, string> = {
  initiate: '发起', organize: '组织', assign: '分派', remind: '提醒',
  'request-supplement': '补充', terminate: '终止请求',
};

export const PROFESSIONAL_ACTION_LABELS: Record<ProfessionalActionType, string> = {
  confirm: '确认 Gate', return: '退回补证', reject: '拒绝', 'request-evidence': '请求补证',
};

export function quarterThresholdLevel(value: QuarterThreshold | null): 0 | 1 | 2 | 3 | 4 | null {
  if (value === null) return null;
  if (value === 0) return 0;
  if (value === 25) return 1;
  if (value === 50) return 2;
  if (value === 75) return 3;
  return 4;
}

export function coarseProgressLabel(value: QuarterThreshold | null): string {
  const level = quarterThresholdLevel(value);
  if (level === null) return '未提供';
  if (level === 0) return '尚未推进';
  return `已到第 ${level} 档`;
}

export function pathStateLabel(step: WorkbenchPathStep): string {
  if (step.completionPercent === null) return '未提供';
  if (step.status === 'completed') return '已完成';
  if (step.status === 'in_progress') return '处理中';
  if (step.status === 'blocked') return '受阻';
  if (step.status === 'failed') return '失败';
  return '尚未开始';
}

export function safeDisplay(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() ? value : '未提供';
}
