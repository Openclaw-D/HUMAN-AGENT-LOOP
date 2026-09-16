export type V3RoleId = "leadership" | "business" | "risk" | "external";
export type V3PrincipalId =
  | "collaboration-manager"
  | "leadership-observer"
  | "business-owner"
  | "risk-policy"
  | "risk-credit"
  | "risk-commercial"
  | "risk-asset"
  | "external-customer"
  | "external-supplier";
export type V3ProcessId =
  | "opportunity"
  | "policy"
  | "credit"
  | "commercial"
  | "asset";

export type V3ShellCase = {
  readonly businessItemType: "FinancingLeasingCase";
  readonly caseId: string;
  readonly caseTier: "golden" | "background";
  readonly isGolden: boolean;
  readonly isBackground: boolean;
  readonly readOnly: boolean;
  readonly backendScope: "golden-case-authority" | "background-read-projection";
  readonly canEnterGoldenCaseBackend: boolean;
  readonly readOnlySummary: string;
  readonly display: {
    readonly title: string;
    readonly company: string;
    readonly industry: string;
    readonly region: string;
    readonly amount: string;
    readonly phase: string;
    readonly signal: "normal" | "attention" | "elevated";
    readonly nextMilestone: string;
  };
  readonly commencementBand: 0 | 1 | 2 | 3 | 4 | 5;
  readonly leaseLifecycleStatus: string;
};

export type V3NeutralSlot = {
  readonly processId: V3ProcessId;
  readonly slotId: string;
  readonly presentationIndex: 0 | 1 | 2 | 3 | 4;
  readonly semanticName: null;
  readonly sequence: null;
  readonly configurable: true;
};

export type V3ProcessThread = {
  readonly processId: V3ProcessId;
  readonly weight: string;
  readonly intensity: string;
  readonly roleInV3: string;
  readonly slotCount: 5;
  readonly slots: readonly V3NeutralSlot[];
};

export type V3RoleScope = {
  readonly principalId: V3PrincipalId;
  readonly access: string;
  readonly visibleProcessIds: readonly V3ProcessId[];
  readonly canSubmitHumanGate: boolean;
  readonly canSubmitGateProcessIds: readonly V3ProcessId[];
  readonly canAccessInternalRiskJudgment: boolean;
  readonly canActAsBusinessRole: boolean;
  readonly canSubmitInvitedMaterials: boolean;
  readonly canSubmitManagementAction: boolean;
};

export type V3RoleProjection = {
  readonly businessItemType: "FinancingLeasingCase";
  readonly caseId: string;
  readonly role: V3RoleId;
  readonly roleId: V3RoleId;
  readonly principalId: V3PrincipalId;
  readonly contextVersion: string;
  readonly readOnly: boolean;
  readonly allowedGateModes: readonly string[];
  readonly case: V3ShellCase;
  readonly scope: V3RoleScope;
};

export type V3AiRoute = {
  readonly businessItemType: "FinancingLeasingCase";
  readonly caseId: string;
  readonly role: V3RoleId;
  readonly roleId: V3RoleId;
  readonly principalId: V3PrincipalId;
  readonly process: V3ProcessId;
  readonly processId: V3ProcessId;
  readonly contextVersion: string;
  readonly task: string;
  readonly readOnly: boolean;
  readonly routeAuthorized: boolean;
  readonly allowedGateModes: readonly string[];
  readonly canSubmitHumanGate: boolean;
  readonly canSubmitInvitedMaterials: boolean;
  readonly authority: "backend";
  readonly frontendAuthority: false;
  readonly requiresBackendAuthority: true;
};

export const V3_BUSINESS_ITEM_TYPE = "FinancingLeasingCase" as const;
export const V3_GOLDEN_CASE_ID = "FL-DEMO-001" as const;
export const V3_ROLE_IDS = [
  "leadership",
  "business",
  "risk",
  "external",
] as const;
export const V3_PRINCIPAL_IDS = [
  "collaboration-manager",
  "leadership-observer",
  "business-owner",
  "risk-policy",
  "risk-credit",
  "risk-commercial",
  "risk-asset",
  "external-customer",
  "external-supplier",
] as const;
export const V3_PROCESS_IDS = [
  "opportunity",
  "policy",
  "credit",
  "commercial",
  "asset",
] as const;

const CASE_SEEDS: readonly V3ShellCase[] = [
  {
    businessItemType: "FinancingLeasingCase",
    caseId: "FL-DEMO-001",
    caseTier: "golden",
    isGolden: true,
    isBackground: false,
    readOnly: false,
    backendScope: "golden-case-authority",
    canEnterGoldenCaseBackend: true,
    readOnlySummary: "核心演示事项，贯穿商机、政策、信审、商务、资产与管理协同观察。",
    display: {
      title: "智能产线设备直接租赁",
      company: "澄海精工装备有限公司",
      industry: "高端装备制造",
      region: "华东 · 苏州",
      amount: "6,800 万元",
      phase: "信审协同",
      signal: "attention",
      nextMilestone: "补充订单稳定性 Evidence",
    },
    commencementBand: 3,
    leaseLifecycleStatus: "pre-commencement",
  },
  {
    businessItemType: "FinancingLeasingCase",
    caseId: "FL-BG-001",
    caseTier: "background",
    isGolden: false,
    isBackground: true,
    readOnly: true,
    backendScope: "background-read-projection",
    canEnterGoldenCaseBackend: false,
    readOnlySummary: "设备扩产商机已建立，正在形成首轮材料清单。",
    display: {
      title: "精密注塑设备扩产租赁",
      company: "东越新材科技有限公司",
      industry: "新材料",
      region: "华南 · 佛山",
      amount: "2,350 万元",
      phase: "商机导入",
      signal: "normal",
      nextMilestone: "确认购机动机与交付计划",
    },
    commencementBand: 0,
    leaseLifecycleStatus: "material-collection",
  },
  {
    businessItemType: "FinancingLeasingCase",
    caseId: "FL-BG-002",
    caseTier: "background",
    isGolden: false,
    isBackground: true,
    readOnly: true,
    backendScope: "background-read-projection",
    canEnterGoldenCaseBackend: false,
    readOnlySummary: "政策条件已形成，信审仍有两项关键事实待确认。",
    display: {
      title: "冷链仓储自动化改造",
      company: "海川冷链物流有限公司",
      industry: "现代物流",
      region: "华北 · 天津",
      amount: "4,200 万元",
      phase: "信审补件",
      signal: "elevated",
      nextMilestone: "确认关联方资金往来",
    },
    commencementBand: 2,
    leaseLifecycleStatus: "pre-commencement",
  },
  {
    businessItemType: "FinancingLeasingCase",
    caseId: "FL-BG-003",
    caseTier: "background",
    isGolden: false,
    isBackground: true,
    readOnly: true,
    backendScope: "background-read-projection",
    canEnterGoldenCaseBackend: false,
    readOnlySummary: "交易已起租，当前保持正常在租并进入资产观察。",
    display: {
      title: "锂电检测线设备租赁",
      company: "恒策检测技术有限公司",
      industry: "新能源装备",
      region: "西南 · 成都",
      amount: "3,100 万元",
      phase: "正常在租",
      signal: "normal",
      nextMilestone: "下一期租金回收",
    },
    commencementBand: 5,
    leaseLifecycleStatus: "active-lease",
  },
  {
    businessItemType: "FinancingLeasingCase",
    caseId: "FL-BG-004",
    caseTier: "background",
    isGolden: false,
    isBackground: true,
    readOnly: true,
    backendScope: "background-read-projection",
    canEnterGoldenCaseBackend: false,
    readOnlySummary: "本金、利息与开票事项均已结清，保留为组合对照摘要。",
    display: {
      title: "食品包装产线升级租赁",
      company: "南岭食品工业有限公司",
      industry: "食品制造",
      region: "华中 · 武汉",
      amount: "1,980 万元",
      phase: "已关闭",
      signal: "normal",
      nextMilestone: "无未结事项",
    },
    commencementBand: 5,
    leaseLifecycleStatus: "closed",
  },
];

function makeNeutralSlots(processId: V3ProcessId): V3NeutralSlot[] {
  return [0, 1, 2, 3, 4].map((presentationIndex) => ({
    processId,
    slotId: `${processId}-slot-${presentationIndex}`,
    presentationIndex: presentationIndex as 0 | 1 | 2 | 3 | 4,
    semanticName: null,
    sequence: null,
    configurable: true,
  }));
}

const THREAD_SEEDS: readonly V3ProcessThread[] = [
  {
    processId: "opportunity",
    weight: "primary",
    intensity: "heavy",
    roleInV3: "opportunity-heavy",
    slotCount: 5,
    slots: makeNeutralSlots("opportunity"),
  },
  {
    processId: "policy",
    weight: "rules",
    intensity: "exception",
    roleInV3: "rules-exception",
    slotCount: 5,
    slots: makeNeutralSlots("policy"),
  },
  {
    processId: "credit",
    weight: "primary",
    intensity: "heavy",
    roleInV3: "credit-heavy",
    slotCount: 5,
    slots: makeNeutralSlots("credit"),
  },
  {
    processId: "commercial",
    weight: "commencement",
    intensity: "execution",
    roleInV3: "commencement-execution",
    slotCount: 5,
    slots: makeNeutralSlots("commercial"),
  },
  {
    processId: "asset",
    weight: "auxiliary",
    intensity: "prediction",
    roleInV3: "auxiliary-prediction",
    slotCount: 5,
    slots: makeNeutralSlots("asset"),
  },
];

const ROLE_POLICIES: Record<
  V3RoleId,
  {
    readOnly: boolean;
    allowedGateModes: string[];
    scope: V3RoleScope;
  }
> = {
  leadership: {
    readOnly: false,
    allowedGateModes: ["view", "management-action"],
    scope: {
      access: "combined-observation",
      principalId: "collaboration-manager",
      visibleProcessIds: [...V3_PROCESS_IDS],
      canSubmitHumanGate: false,
      canSubmitGateProcessIds: [],
      canAccessInternalRiskJudgment: true,
      canActAsBusinessRole: false,
      canSubmitInvitedMaterials: false,
      canSubmitManagementAction: true,
    },
  },
  business: {
    readOnly: false,
    allowedGateModes: ["view", "material-submit"],
    scope: {
      access: "full-project-operation",
      principalId: "business-owner",
      visibleProcessIds: [...V3_PROCESS_IDS],
      canSubmitHumanGate: false,
      canSubmitGateProcessIds: [],
      canAccessInternalRiskJudgment: true,
      canActAsBusinessRole: true,
      canSubmitInvitedMaterials: false,
      canSubmitManagementAction: false,
    },
  },
  risk: {
    readOnly: false,
    allowedGateModes: ["view", "submit"],
    scope: {
      access: "specialized-professional",
      principalId: "risk-credit",
      visibleProcessIds: [...V3_PROCESS_IDS],
      canSubmitHumanGate: true,
      canSubmitGateProcessIds: ["credit"],
      canAccessInternalRiskJudgment: true,
      canActAsBusinessRole: false,
      canSubmitInvitedMaterials: false,
      canSubmitManagementAction: false,
    },
  },
  external: {
    readOnly: false,
    allowedGateModes: ["view", "material-submit"],
    scope: {
      access: "invited-material-collaboration",
      principalId: "external-customer",
      visibleProcessIds: ["opportunity"],
      canSubmitHumanGate: false,
      canSubmitGateProcessIds: [],
      canAccessInternalRiskJudgment: false,
      canActAsBusinessRole: false,
      canSubmitInvitedMaterials: true,
      canSubmitManagementAction: false,
    },
  },
};

const PRINCIPAL_ROLE: Record<V3PrincipalId, V3RoleId> = {
  "collaboration-manager": "leadership",
  "leadership-observer": "leadership",
  "business-owner": "business",
  "risk-policy": "risk",
  "risk-credit": "risk",
  "risk-commercial": "risk",
  "risk-asset": "risk",
  "external-customer": "external",
  "external-supplier": "external",
};

const DEFAULT_PRINCIPAL: Record<V3RoleId, V3PrincipalId> = {
  leadership: "collaboration-manager",
  business: "business-owner",
  risk: "risk-credit",
  external: "external-customer",
};

const PRINCIPAL_PROCESS_SCOPE: Record<V3PrincipalId, {
  visibleProcessIds: readonly V3ProcessId[];
  gateProcessIds: readonly V3ProcessId[];
}> = {
  "collaboration-manager": { visibleProcessIds: V3_PROCESS_IDS, gateProcessIds: [] },
  "leadership-observer": { visibleProcessIds: V3_PROCESS_IDS, gateProcessIds: [] },
  "business-owner": { visibleProcessIds: V3_PROCESS_IDS, gateProcessIds: [] },
  "risk-policy": { visibleProcessIds: V3_PROCESS_IDS, gateProcessIds: ["policy"] },
  "risk-credit": { visibleProcessIds: V3_PROCESS_IDS, gateProcessIds: ["credit"] },
  "risk-commercial": { visibleProcessIds: V3_PROCESS_IDS, gateProcessIds: ["commercial"] },
  "risk-asset": { visibleProcessIds: V3_PROCESS_IDS, gateProcessIds: ["asset"] },
  "external-customer": { visibleProcessIds: ["opportunity"], gateProcessIds: [] },
  "external-supplier": { visibleProcessIds: ["commercial"], gateProcessIds: [] },
};

function fail(code: string, message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  throw error;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function readInputField(
  input: unknown,
  fieldName: string,
  errorCode: string,
): string {
  let value: unknown;
  try {
    value = typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)[fieldName]
      : undefined;
  } catch {
    fail(errorCode, `${fieldName} must be readable`);
  }
  return nonEmptyString(value) ?? fail(errorCode, `${fieldName} must be a non-empty string`);
}

function requireEnumValue<T extends string>(
  value: string,
  allowedValues: readonly T[],
  errorCode: string,
  fieldName: string,
): T {
  if (!allowedValues.includes(value as T)) {
    fail(errorCode, `${fieldName} is not recognized`);
  }
  return value as T;
}

function findCase(caseId: string): V3ShellCase {
  const found = V3_CASES.find((candidate) => candidate.caseId === caseId);
  if (!found) {
    fail("INVALID_CASE_ID", "caseId is not a configured V3 FinancingLeasingCase");
  }
  return found;
}

function resolvePrincipalId(input: unknown, roleId: V3RoleId): V3PrincipalId {
  let candidate: unknown;
  try {
    candidate = typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).principalId
      : undefined;
  } catch {
    fail("INVALID_PRINCIPAL_ID", "principalId must be readable");
  }
  if (candidate === undefined) return DEFAULT_PRINCIPAL[roleId];
  const requestedPrincipalId = requireEnumValue(
    nonEmptyString(candidate) ?? fail("INVALID_PRINCIPAL_ID", "principalId must be a non-empty string"),
    V3_PRINCIPAL_IDS,
    "INVALID_PRINCIPAL_ID",
    "principalId",
  );
  if (PRINCIPAL_ROLE[requestedPrincipalId] !== roleId) {
    fail("INVALID_PRINCIPAL_ID", "principalId does not belong to roleId");
  }
  return requestedPrincipalId === "leadership-observer"
    ? "collaboration-manager"
    : requestedPrincipalId;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const propertyValue of Object.values(value)) {
      deepFreeze(propertyValue);
    }
    Object.freeze(value);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function backgroundScope(scope: V3RoleScope): V3RoleScope {
  return {
    ...scope,
    access: "background-summary-only",
    visibleProcessIds: [],
    canSubmitHumanGate: false,
    canSubmitGateProcessIds: [],
    canAccessInternalRiskJudgment: false,
    canActAsBusinessRole: false,
    canSubmitInvitedMaterials: false,
    canSubmitManagementAction: false,
  };
}

function effectiveGateModes(
  caseModel: V3ShellCase,
  policy: (typeof ROLE_POLICIES)[V3RoleId],
): string[] {
  if (caseModel.isBackground || policy.readOnly) {
    return caseModel.isBackground ? [] : ["view"];
  }
  return [...policy.allowedGateModes];
}

export const V3_CASES = deepFreeze(CASE_SEEDS);
export const V3_GOLDEN_CASE = deepFreeze(findCase(V3_GOLDEN_CASE_ID));
export const V3_BACKGROUND_CASES = deepFreeze(
  V3_CASES.filter((caseModel) => caseModel.isBackground),
);
export const V3_PROCESS_THREADS = deepFreeze(THREAD_SEEDS);
export const V3_ROLE_POLICIES = deepFreeze(ROLE_POLICIES);

export type V3RoleProjectionInput = {
  caseId: string;
  roleId: V3RoleId;
  principalId?: V3PrincipalId;
  contextVersion: string;
};

export function buildRoleProjection(input: V3RoleProjectionInput): V3RoleProjection {
  const caseIdInput = readInputField(input, "caseId", "INVALID_CASE_ID");
  const roleInput = readInputField(input, "roleId", "INVALID_ROLE_ID");
  const contextVersion = readInputField(
    input,
    "contextVersion",
    "INVALID_CONTEXT_VERSION",
  );
  const caseId = requireEnumValue(
    caseIdInput,
    V3_CASES.map((caseModel) => caseModel.caseId),
    "INVALID_CASE_ID",
    "caseId",
  );
  const roleId = requireEnumValue(
    roleInput,
    V3_ROLE_IDS,
    "INVALID_ROLE_ID",
    "roleId",
  );
  const caseModel = findCase(caseId);
  const policy = ROLE_POLICIES[roleId];
  const principalId = resolvePrincipalId(input, roleId);
  const principalScope = PRINCIPAL_PROCESS_SCOPE[principalId];
  const readOnly = caseModel.isBackground || policy.readOnly;
  const scopedPolicy = {
    ...policy,
    scope: {
      ...policy.scope,
      principalId,
      visibleProcessIds: [...principalScope.visibleProcessIds],
      canSubmitHumanGate: principalScope.gateProcessIds.length > 0,
      canSubmitGateProcessIds: [...principalScope.gateProcessIds],
    },
  };

  return deepFreeze({
    businessItemType: V3_BUSINESS_ITEM_TYPE,
    caseId: caseModel.caseId,
    role: roleId,
    roleId,
    principalId,
    contextVersion,
    readOnly,
    allowedGateModes: effectiveGateModes(caseModel, scopedPolicy),
    case: cloneJson(caseModel),
    scope: caseModel.isBackground ? backgroundScope(scopedPolicy.scope) : { ...scopedPolicy.scope },
  });
}

export type V3AiRouteInput = {
  caseId: string;
  roleId: V3RoleId;
  principalId?: V3PrincipalId;
  processId: V3ProcessId;
  contextVersion: string;
  task: string;
};

export function buildAiRoute(input: V3AiRouteInput): V3AiRoute {
  const caseIdInput = readInputField(input, "caseId", "INVALID_CASE_ID");
  const roleInput = readInputField(input, "roleId", "INVALID_ROLE_ID");
  const processInput = readInputField(input, "processId", "INVALID_PROCESS_ID");
  const contextVersion = readInputField(
    input,
    "contextVersion",
    "INVALID_CONTEXT_VERSION",
  );
  const task = readInputField(input, "task", "INVALID_TASK");
  const caseId = requireEnumValue(
    caseIdInput,
    V3_CASES.map((caseModel) => caseModel.caseId),
    "INVALID_CASE_ID",
    "caseId",
  );
  const roleId = requireEnumValue(
    roleInput,
    V3_ROLE_IDS,
    "INVALID_ROLE_ID",
    "roleId",
  );
  const processId = requireEnumValue(
    processInput,
    V3_PROCESS_IDS,
    "INVALID_PROCESS_ID",
    "processId",
  );
  const caseModel = findCase(caseId);
  const policy = ROLE_POLICIES[roleId];
  const principalId = resolvePrincipalId(input, roleId);
  const principalScope = PRINCIPAL_PROCESS_SCOPE[principalId];
  const routeAuthorized =
    caseModel.isGolden &&
    principalScope.visibleProcessIds.includes(processId);
  const readOnly = caseModel.isBackground || policy.readOnly || !routeAuthorized;
  const canSubmitHumanGate =
    routeAuthorized && principalScope.gateProcessIds.includes(processId);
  const allowedGateModes = !routeAuthorized
    ? []
    : canSubmitHumanGate ||
        policy.scope.canSubmitInvitedMaterials ||
        policy.scope.canActAsBusinessRole ||
        policy.scope.canSubmitManagementAction
      ? [...policy.allowedGateModes]
      : ["view"];

  return deepFreeze({
    businessItemType: V3_BUSINESS_ITEM_TYPE,
    caseId: caseModel.caseId,
    role: roleId,
    roleId,
    principalId,
    process: processId,
    processId,
    contextVersion,
    task,
    readOnly,
    routeAuthorized,
    allowedGateModes,
    canSubmitHumanGate,
    canSubmitInvitedMaterials:
      routeAuthorized && policy.scope.canSubmitInvitedMaterials,
    authority: "backend",
    frontendAuthority: false,
    requiresBackendAuthority: true,
  });
}
