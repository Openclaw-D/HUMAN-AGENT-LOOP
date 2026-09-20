import { prepareEvidence } from './assistant-evidence.mjs';

export function createAssistantEvidenceProvider({ baseUrl, token, policy }) {
  const endpoint = new URL('/api/connectors/internal/assistant-evidence', baseUrl);
  return async ({ snapshot, tenantId, customerId, revision }) => {
    const snap = snapshot?.snapshot ?? snapshot;
    if (snap?.artifactsReadable !== true) throw new Error('EVIDENCE_INVENTORY_UNAUTHORIZED');
    const artifactIds = (snap.artifacts ?? []).map(a => a.artifactId).filter(id => typeof id === 'string');
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'X-Service-Token': token },
      body: JSON.stringify({ tenantId, customerId, artifactIds }) });
    if (!response.ok) throw new Error('EVIDENCE_UPSTREAM_UNAVAILABLE');
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.materials) || data.materials.some(m => !artifactIds.includes(m.artifactId)))
      throw new Error('EVIDENCE_MAPPING_INVALID');
    return prepareEvidence({ tenantId, customerId, revision, materials: data.materials, ...policy() });
  };
}
