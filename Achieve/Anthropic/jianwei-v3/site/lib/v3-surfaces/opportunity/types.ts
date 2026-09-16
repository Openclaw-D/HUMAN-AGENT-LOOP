import type {
  V3PersistedMessage,
  V3ProfessionalRole,
  V3RoleProjectionId,
  V3ScenarioRef,
  V3SendMessageResult,
  V3SurfaceState,
} from '../shared/contracts.ts';
import type {
  V3CanonicalPrincipalId,
  V3InvitationScope,
  V3RoleApplicationId,
} from '../../v3-role-authority.ts';

export type OpportunityValueClass = 'actual' | 'forecast' | 'scenario';

export type OpportunityNumericObservation =
  | {
      availability: 'available';
      value: number;
      display: string;
      unit: 'evidence-coverage-band';
      valueClass: OpportunityValueClass;
      source: string;
      provenance: string[];
      asOf: string;
    }
  | {
      availability: 'unavailable';
      value: null;
      display: '未提供';
      unit: 'evidence-coverage-band';
      valueClass: null;
      source: null;
      provenance: [];
      asOf: null;
    };

export type OpportunityNodeKind = 'customer' | 'opportunity' | 'supplier' | 'case';

export type OpportunityRelationshipNode = {
  nodeId: string;
  kind: OpportunityNodeKind;
  label: string;
  availability: 'available' | 'unavailable';
  sourceRef: string;
};

export type OpportunityRelationshipEdge = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relationship: 'customer_for' | 'opens_case' | 'supplier_for';
  sourceRef: string;
};

export type OpportunityMaterialItem = {
  materialId: string;
  label: string;
  status: 'needed' | 'provided';
  detail: string;
  sourceRef: string;
};

export type OpportunityOrchestrationAction =
  | 'initiate'
  | 'organize'
  | 'assign'
  | 'remind'
  | 'supplement'
  | 'terminate';

export type OpportunityResponsibilityEntry = {
  role: Extract<V3RoleProjectionId, 'business' | V3ProfessionalRole>;
  responsibility: 'orchestrates' | 'professional-judgment';
  canSubmitProfessionalGate: boolean;
};

export type OpportunitySharedChatContext = {
  availability: 'available';
  contextId: string;
  contextVersion: string;
  messages: V3PersistedMessage[];
  source: 'shared-v3-sqlite-chat';
};

export type OpportunityReadModel = {
  projectionType: 'OpportunityReadModel';
  projectionVersion: string;
  grain: 'Opportunity';
  opportunityId: string;
  caseId: string;
  caseTier: 'golden' | 'background';
  readOnly: boolean;
  scenarioRef: V3ScenarioRef;
  title: string;
  stage: string;
  nextAction: string;
  relationships: {
    nodes: OpportunityRelationshipNode[];
    edges: OpportunityRelationshipEdge[];
    unavailableRelationships: Array<'customer' | 'supplier'>;
  };
  materials: {
    items: OpportunityMaterialItem[];
    completeness: OpportunityNumericObservation;
    emptyDisplay: '未提供';
  };
  responsibilityMatrix: OpportunityResponsibilityEntry[];
  allowedBusinessActions: OpportunityOrchestrationAction[];
  forbiddenBusinessActions: Array<'professional_review' | 'professional_gate'>;
  chatContext: OpportunitySharedChatContext;
};

export type OpportunitySession = {
  sessionId: string;
  principalId: V3CanonicalPrincipalId;
  roleApplicationId: V3RoleApplicationId;
  invitation: V3InvitationScope | null;
};

export type OpportunityChatResult = V3SendMessageResult & {
  chatContext: OpportunitySharedChatContext;
};

export type OpportunityApiState<T> = V3SurfaceState<T>;
