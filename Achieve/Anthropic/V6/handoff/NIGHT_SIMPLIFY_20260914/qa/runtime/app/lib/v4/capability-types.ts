export type V4CapabilityKind =
  | 'SignalSource'
  | 'Extractor'
  | 'Analyzer'
  | 'Recommender'
  | 'Copilot'
  | 'Executor'
  | 'Adapter'
  | 'Projection'
  | 'EvolutionTool';

export type V4BusinessStage =
  | 'opportunity'
  | 'due_diligence'
  | 'credit'
  | 'commercial'
  | 'asset'
  | 'commencement'
  | 'servicing'
  | 'closure'
  | 'governance';

export type V4CapabilityOutputKind = 'evidence' | 'candidate' | 'action_intent';

export type V4CapabilityVersionState =
  | 'draft'
  | 'evaluated'
  | 'approved'
  | 'shadow'
  | 'active'
  | 'suspended'
  | 'quarantined'
  | 'deprecated'
  | 'removed';

export type V4CapabilityManifest = {
  capabilityId: string;
  version: string;
  owner: {
    actorId: string;
    organizationUnitId: string;
  };
  businessStages: V4BusinessStage[];
  kind: V4CapabilityKind;
  entryWhen: string[];
  doNotEnterWhen: string[];
  exitWhen: string[];
  handoffTo: string[];
  inputSchemaRef: string;
  outputSchemaRef: string;
  permissions: {
    read: string[];
    write: V4CapabilityOutputKind[];
  };
  authority: 'none';
  execution: {
    adapterId: string;
    timeoutMs: number;
    retry: {
      maxAttempts: number;
      backoffMs: number;
    };
    idempotency: 'required';
  };
  failure: {
    mode: 'fail_closed';
    fallbackCapabilityId: string | null;
  };
  evaluation: {
    evaluationSetId: string;
    minimumScore: number;
  };
  governance: {
    state: V4CapabilityVersionState;
    approvalReceiptId: string;
    rollbackVersion: string;
  };
};

export type V4CapabilityAdmission = {
  manifest: V4CapabilityManifest;
  admission: {
    status: 'admitted';
    checks: [
      'manifest-exact-shape',
      'authority-none',
      'output-boundary',
      'governance-eligible',
    ];
  };
};

export type V4CapabilityRegistryItem = {
  capabilityId: string;
  version: string;
  owner: V4CapabilityManifest['owner'];
  businessStages: V4BusinessStage[];
  kind: V4CapabilityKind;
  governanceState: 'shadow' | 'active';
  authority: 'none';
  outputs: V4CapabilityOutputKind[];
};

export type V4CapabilityRegistrySnapshot = {
  registryVersion: string;
  capabilities: V4CapabilityRegistryItem[];
};

export type V4CapabilityRegistry = {
  registryVersion: string;
  list(): V4CapabilityAdmission[];
  get(capabilityId: string, version: string): V4CapabilityAdmission;
  snapshot(): V4CapabilityRegistrySnapshot;
};
