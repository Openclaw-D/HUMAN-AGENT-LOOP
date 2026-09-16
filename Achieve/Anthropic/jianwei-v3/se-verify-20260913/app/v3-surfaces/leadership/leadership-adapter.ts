import {
  createV3ClientSession,
  v3Api,
  type V3CasePanelDto,
  type V3KpiMetricDto,
  type V3PortfolioCaseDto,
  type V3RoleProjectionDto,
} from '../../../lib/v3-client';
import {
  V3_COLLABORATION_CASE_ID,
  createV3CollaborationClient,
  type V3CollaborationReadyDto,
} from '../../../lib/v3-collaboration-client';
import type { SurfacePrincipalId } from '../shared/surface-model';

export type SurfacePortfolioProjection = {
  projectionType: 'PortfolioProjection';
  roleApplicationId: 'leadership' | 'business' | 'risk';
  principalId: SurfacePrincipalId;
  runtimeEpoch: string;
  projectionVersion: string;
  currentContextVersion: string;
  northStar: string;
  caseCount: number;
  cases: V3PortfolioCaseDto[];
  organizationPath: string[];
  viewMode: 'god-view' | 'case-operations' | 'professional-risk';
  kpis: V3KpiMetricDto[];
  kpiWindows?: Record<'day' | 'week' | 'month' | 'quarter' | 'half-year' | 'year', V3KpiMetricDto[]>;
  drilldown?: {
    portfolioId: string;
    businessUnitId: string;
    largestDeviation: string;
    focusCaseId: string;
  };
};

export type SurfaceRoleSnapshot = {
  sessionId: string;
  principalId: SurfacePrincipalId;
  projection: V3RoleProjectionDto;
  casePanel: V3CasePanelDto;
  portfolio: SurfacePortfolioProjection | null;
  portfolioAccess: 'available' | 'denied-by-contract';
};

export type LeadershipSurfaceData = {
  collaboration: V3CollaborationReadyDto;
  role: SurfaceRoleSnapshot;
};

const collaborationClient = createV3CollaborationClient();

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function assertRoleSnapshot(
  principalId: SurfacePrincipalId,
  sessionId: string,
  projection: V3RoleProjectionDto,
  casePanel: V3CasePanelDto,
) {
  if (
    !sessionId ||
    projection.caseId !== V3_COLLABORATION_CASE_ID ||
    projection.principalId !== principalId ||
    casePanel.principalId !== principalId ||
    !Array.isArray(casePanel.items)
  ) {
    fail('ROLE_PROJECTION_MISMATCH', 'Role Projection 与当前演示主体不一致');
  }
  if (principalId.startsWith('external-')) {
    if (casePanel.items.some((item) => item.caseId !== V3_COLLABORATION_CASE_ID)) {
      fail('EXTERNAL_SCOPE_LEAK', '外部角色投影包含邀请范围外事项');
    }
    return;
  }
  const goldenCount = casePanel.items.filter((item) => item.caseTier === 'golden').length;
  const backgroundCount = casePanel.items.filter((item) => item.caseTier === 'background').length;
  if (goldenCount !== 1 || backgroundCount < 4 || backgroundCount > 6) {
    fail('INVALID_SCENARIO_CASE_SET', 'Scenario 事项集合不满足 1 个 Golden 与 4–6 个 background 的边界');
  }
}

function assertPortfolio(
  principalId: SurfacePrincipalId,
  casePanel: V3CasePanelDto,
  portfolio: SurfacePortfolioProjection,
) {
  const expectedIds = new Set(casePanel.items.map((item) => item.caseId));
  if (
    portfolio.projectionType !== 'PortfolioProjection' ||
    portfolio.principalId !== principalId ||
    !Array.isArray(portfolio.cases) ||
    portfolio.cases.some((item) => !expectedIds.has(item.caseId)) ||
    portfolio.caseCount !== portfolio.cases.length ||
    !Array.isArray(portfolio.kpis)
  ) {
    fail('INVALID_PORTFOLIO_PROJECTION', '经营组合 Projection 与当前 Role/Case 集合不一致');
  }
  if (principalId === 'collaboration-manager') {
    if (
      portfolio.viewMode !== 'god-view' ||
      portfolio.kpis.length !== 3 ||
      !portfolio.kpiWindows ||
      !portfolio.drilldown
    ) {
      fail('INVALID_LEADERSHIP_VALUE_PROJECTION', '领导价值 Projection 缺少 KPI 窗口或下钻边界');
    }
  } else if (portfolio.kpis.length !== 0) {
    fail('ROLE_VALUE_SCOPE_LEAK', '非领导 Role Projection 不应返回组合 KPI');
  }
}

async function readRoleSnapshot(
  principalId: SurfacePrincipalId,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SurfaceRoleSnapshot> {
  const [projection, casePanel] = await Promise.all([
    v3Api<V3RoleProjectionDto>(`/api/v3/cases/${V3_COLLABORATION_CASE_ID}/projection`, { sessionId, signal }),
    v3Api<V3CasePanelDto>('/api/v3/cases', { sessionId, signal }),
  ]);
  assertRoleSnapshot(principalId, sessionId, projection, casePanel);

  if (principalId.startsWith('external-')) {
    return {
      sessionId,
      principalId,
      projection,
      casePanel,
      portfolio: null,
      portfolioAccess: 'denied-by-contract',
    };
  }

  const portfolio = await v3Api<SurfacePortfolioProjection>('/api/v3/portfolio/projection', {
    sessionId,
    signal,
  });
  assertPortfolio(principalId, casePanel, portfolio);
  return {
    sessionId,
    principalId,
    projection,
    casePanel,
    portfolio,
    portfolioAccess: 'available',
  };
}

export async function initializeLeadershipSurface(signal?: AbortSignal): Promise<LeadershipSurfaceData> {
  const collaboration = await collaborationClient.initialize(signal);
  const role = await readRoleSnapshot('collaboration-manager', collaboration.sessionId, signal);
  if (
    role.projection.contextVersion !== collaboration.contextVersion ||
    role.portfolio?.currentContextVersion !== collaboration.contextVersion
  ) {
    fail('INITIAL_PROJECTION_COHERENCE_FAILED', '初始协同、价值与 Role Projection 不属于同一 Context');
  }
  return { collaboration, role };
}

export async function loadSurfaceRole(
  principalId: SurfacePrincipalId,
  signal?: AbortSignal,
): Promise<SurfaceRoleSnapshot> {
  const { session } = await createV3ClientSession(principalId, signal);
  if (session.principalId !== principalId) {
    fail('SESSION_PRINCIPAL_MISMATCH', '新会话主体与所选 Role Projection 不一致');
  }
  return readRoleSnapshot(principalId, session.sessionId, signal);
}

export function getCollaborationClient() {
  return collaborationClient;
}
