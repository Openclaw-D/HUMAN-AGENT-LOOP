import { prepareEvidence } from './assistant-evidence.mjs';
import { normalizeSelection, validateUpstreamMaterials } from './assistant-evidence-scope.mjs';

export function createAssistantEvidenceProvider({ baseUrl, token, policy }) {
  const endpoint = new URL('/api/connectors/internal/assistant-evidence', baseUrl);
  return async ({ snapshot, tenantId, customerId, revision, scope }) => {
    const snap = snapshot?.snapshot ?? snapshot;
    if (snap?.artifactsReadable !== true) throw new Error('EVIDENCE_INVENTORY_UNAUTHORIZED');
    const selection = normalizeSelection({ snapshot, scope });
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'X-Service-Token': token },
      body: JSON.stringify({ tenantId, customerId, artifactIds: selection.artifactIds }) });
    if (!response.ok) throw new Error('EVIDENCE_UPSTREAM_UNAVAILABLE');
    const data = await response.json();
    if (!data?.ok) throw new Error('EVIDENCE_MAPPING_INVALID');
    validateUpstreamMaterials({ selection, materials: data.materials });
    const pack = prepareEvidence({ tenantId, customerId, revision, materials: data.materials, ...policy() });
    if (selection.mode === 'explicit')
      pack.selection = { mode: 'explicit', artifactIds: selection.artifactIds, summary: selection.summary };
    return pack;
  };
}
