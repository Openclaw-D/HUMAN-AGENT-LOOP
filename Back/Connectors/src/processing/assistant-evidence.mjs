import { createHash } from 'node:crypto';
import { ASYNC_PARSE_VERSION } from '../../../C/src/parse/adapters-async.mjs';

/** Internal service route only. A references must come from the caller's authorized A inventory. */
export async function readAssistantEvidence(svc, { tenantId, customerId, artifactIds }) {
  if (!tenantId || !customerId || !Array.isArray(artifactIds) || artifactIds.length > 100 || artifactIds.some(id => typeof id !== 'string'))
    throw new Error('EVIDENCE_INPUT_INVALID');
  if (!artifactIds.length) return [];
  const rows = (await svc.store.query(`
    SELECT DISTINCT ON (a.evidence_id) a.*, l.a_ref, pr.result, pr.parser_version
    FROM evidence_artifacts a
    JOIN a_links l ON l.tenant_id=a.tenant_id AND l.customer_id=a.customer_id AND l.local_id=a.evidence_id
      AND l.entity_type IN ('material','supersede') AND l.status='registered'
    JOIN parse_results pr ON pr.tenant_id=a.tenant_id AND pr.customer_id=a.customer_id AND pr.sha256=a.sha256 AND pr.ok
    WHERE a.tenant_id=$1 AND l.a_customer_id=$2 AND l.a_ref=ANY($3::text[])
      AND a.completeness='complete' AND a.superseded_by IS NULL AND pr.parser_version LIKE $4
    ORDER BY a.evidence_id, pr.created_at DESC`, [tenantId, customerId, artifactIds, ASYNC_PARSE_VERSION + '+%'])).rows;
  const materials = [];
  for (const row of rows) {
    if (!row.object_ref) throw new Error('EVIDENCE_ORIGINAL_MISSING');
    const bytes = await svc.objectStore.get(row.object_ref);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('EVIDENCE_HASH_MISMATCH');
    const parsed = row.result;
    if (!parsed?.ok) throw new Error('EVIDENCE_PARSE_INVALID');
    materials.push({ tenantId, customerId, artifactId: row.a_ref, evidenceId: row.evidence_id,
      hash: row.sha256, parserVersion: row.parser_version, current: true,
      text: parsed.text ?? '', pages: parsed.pages ?? [], facts: (parsed.declaredFacts ?? []).map(f => ({ ...f,
        sourceText: f.sourceRefs?.length === 1 && Number.isInteger(f.sourceRefs[0])
          ? String(parsed.text ?? '').split(/\r?\n/)[f.sourceRefs[0] - 1] : null })),
      limitations: ['机器提取与声明事实仍需人工核验', ...(String(parsed.format).includes('xlsx') ? ['仅首工作表'] : [])] });
  }
  return materials;
}
