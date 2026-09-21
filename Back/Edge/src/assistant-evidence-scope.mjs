import { digest } from './assistant-receipts.mjs';

const SELECTION_VERSION = 1;
const fail = (code, detail) => { const e = new Error(code); if (detail) e.detail = detail; throw e; };

/**
 * 显式材料选择的标准化与失败关闭校验。
 * legacy（无 scope）返回 snapshot 全量可读 artifactIds，保持既有请求与返回包不变；
 * explicit（{artifactIds}）要求非空、可去重、逐 ID 属于当前已授权可读集合，任一越权即整次拒绝。
 */
export function normalizeSelection({ snapshot, scope } = {}) {
  const snap = snapshot?.snapshot ?? snapshot;
  if (scope === undefined || scope === null) {
    const artifactIds = (snap?.artifacts ?? []).map(a => a.artifactId).filter(id => typeof id === 'string');
    return { mode: 'legacy', artifactIds, summary: digest({ v: SELECTION_VERSION, mode: 'legacy', artifactIds: [...artifactIds].sort() }) };
  }
  if (typeof scope !== 'object' || Array.isArray(scope) || !Array.isArray(scope.artifactIds))
    fail('EVIDENCE_SCOPE_INVALID');
  if (scope.artifactIds.some(id => typeof id !== 'string' || id.length === 0))
    fail('EVIDENCE_SCOPE_INVALID');
  if (snap?.artifactsReadable !== true) fail('EVIDENCE_INVENTORY_UNAUTHORIZED');
  const authorized = new Set((snap.artifacts ?? []).map(a => a.artifactId).filter(id => typeof id === 'string'));
  const unique = [...new Set(scope.artifactIds)];
  if (!unique.length) fail('EVIDENCE_SCOPE_EMPTY');
  const unauthorized = unique.filter(id => !authorized.has(id));
  if (unauthorized.length) fail('EVIDENCE_SCOPE_UNAUTHORIZED', unauthorized.sort());
  const canonical = [...unique].sort();
  return { mode: 'explicit', artifactIds: canonical, summary: digest({ v: SELECTION_VERSION, mode: 'explicit', artifactIds: canonical }) };
}

/**
 * 上游响应的集合校验（不以“上游说有”为准）：
 * 两种模式都拒绝请求集之外的越界件；explicit 额外要求返回集恰为所选集——
 * Connectors 对被取代/解析缺失/无链接的 ID 静默省略，这里必须补上整次拒绝。
 */
export function validateUpstreamMaterials({ selection, materials }) {
  if (!Array.isArray(materials)) fail('EVIDENCE_MAPPING_INVALID');
  const requested = new Set(selection.artifactIds);
  for (const m of materials)
    if (!m || typeof m !== 'object' || typeof m.artifactId !== 'string' || !requested.has(m.artifactId))
      fail('EVIDENCE_MAPPING_INVALID');
  if (selection.mode === 'explicit') {
    if (new Set(materials.map(m => m.artifactId)).size !== materials.length) fail('EVIDENCE_MAPPING_INVALID');
    const returned = new Set(materials.map(m => m.artifactId));
    const missing = selection.artifactIds.filter(id => !returned.has(id));
    if (missing.length) fail('EVIDENCE_SCOPE_INCOMPLETE', missing);
  }
}
