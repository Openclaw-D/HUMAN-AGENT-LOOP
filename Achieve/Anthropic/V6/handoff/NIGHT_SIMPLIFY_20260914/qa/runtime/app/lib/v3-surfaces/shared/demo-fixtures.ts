import type {
  V3ContextGrain,
  V3ProfessionalRole,
  V3ScenarioRef,
} from './contracts.ts';

export const V3_SHARED_SCENARIO_REF = Object.freeze<V3ScenarioRef>({
  scenarioId: 'JW-V3-SHARED-GOLDEN-001',
  scenarioVersion: '1.0.0-shared-sqlite',
  dataClass: 'synthetic_deidentified_demo',
});

export const V3_SHARED_PORTFOLIO = Object.freeze({
  portfolioId: 'PORTFOLIO-JW-DEMO',
  label: '融资租赁事项组合',
});

export type V3SharedDemoCase = {
  caseId: string;
  caseTier: 'golden' | 'background';
  readOnly: boolean;
  divisionId: string;
  divisionLabel: string;
  label: string;
  phase: string;
  attention: 'normal' | 'attention' | 'elevated';
  backendProgress: Record<V3ProfessionalRole, number | null>;
  netIncome: number | null;
  unitAssetOutput: number | null;
};

export const V3_SHARED_DEMO_CASES = Object.freeze<readonly V3SharedDemoCase[]>([
  {
    caseId: 'FL-DEMO-001',
    caseTier: 'golden',
    readOnly: false,
    divisionId: 'DIV-EAST',
    divisionLabel: '华东事业部',
    label: '智能产线设备直接租赁',
    phase: '商机事实待确认',
    attention: 'attention',
    backendProgress: { policy: 82, credit: 63, commercial: 44, asset: null },
    netIncome: 126,
    unitAssetOutput: 0.84,
  },
  {
    caseId: 'FL-BG-001',
    caseTier: 'background',
    readOnly: true,
    divisionId: 'DIV-EAST',
    divisionLabel: '华东事业部',
    label: '精密注塑设备扩产租赁',
    phase: '商机导入',
    attention: 'normal',
    backendProgress: { policy: 31, credit: null, commercial: 18, asset: null },
    netIncome: null,
    unitAssetOutput: null,
  },
  {
    caseId: 'FL-BG-002',
    caseTier: 'background',
    readOnly: true,
    divisionId: 'DIV-EAST',
    divisionLabel: '华东事业部',
    label: '冷链仓储自动化改造',
    phase: '信审补件',
    attention: 'elevated',
    backendProgress: { policy: 78, credit: 46, commercial: 25, asset: 12 },
    netIncome: 88,
    unitAssetOutput: null,
  },
  {
    caseId: 'FL-BG-003',
    caseTier: 'background',
    readOnly: true,
    divisionId: 'DIV-CENTRAL',
    divisionLabel: '中部事业部',
    label: '锂电检测线设备租赁',
    phase: '正常在租',
    attention: 'normal',
    backendProgress: { policy: 100, credit: 100, commercial: 100, asset: 91 },
    netIncome: 173,
    unitAssetOutput: 1.06,
  },
  {
    caseId: 'FL-BG-004',
    caseTier: 'background',
    readOnly: true,
    divisionId: 'DIV-CENTRAL',
    divisionLabel: '中部事业部',
    label: '食品包装产线升级租赁',
    phase: '已关闭',
    attention: 'normal',
    backendProgress: { policy: 100, credit: 100, commercial: 100, asset: 100 },
    netIncome: 64,
    unitAssetOutput: 0.71,
  },
]);

export type V3SeedContext = {
  contextId: string;
  grain: V3ContextGrain;
  portfolioId: string;
  divisionId: string | null;
  caseId: string | null;
  contextVersion: string;
  label: string;
  parentContextId: string | null;
};

export function createV3SeedContexts(): V3SeedContext[] {
  const portfolioContext: V3SeedContext = {
    contextId: 'CTX-PORTFOLIO-JW-DEMO',
    grain: 'portfolio',
    portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
    divisionId: null,
    caseId: null,
    contextVersion: 'CTX-P-0001',
    label: V3_SHARED_PORTFOLIO.label,
    parentContextId: null,
  };
  const divisions = new Map<string, string>();
  for (const item of V3_SHARED_DEMO_CASES) divisions.set(item.divisionId, item.divisionLabel);
  const divisionContexts = [...divisions].map<V3SeedContext>(([divisionId, label]) => ({
    contextId: `CTX-${divisionId}`,
    grain: 'division',
    portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
    divisionId,
    caseId: null,
    contextVersion: `CTX-D-${divisionId === 'DIV-EAST' ? '0001' : '0002'}`,
    label,
    parentContextId: portfolioContext.contextId,
  }));
  const caseContexts = V3_SHARED_DEMO_CASES.map<V3SeedContext>((item) => ({
    contextId: `CTX-${item.caseId}`,
    grain: 'case',
    portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
    divisionId: item.divisionId,
    caseId: item.caseId,
    contextVersion: 'CTX-0000',
    label: item.label,
    parentContextId: `CTX-${item.divisionId}`,
  }));
  return [portfolioContext, ...divisionContexts, ...caseContexts];
}
