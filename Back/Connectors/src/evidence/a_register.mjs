import { randomUUID, createHash } from 'node:crypto';
import { ConnError } from '../errors.mjs';

/**
 * A 路登记：只经 A 现有 v1 HTTP API 写入（POST /api/v1/projects/:pid/evidence），
 * 不直写 A 业务表（任务02 §0）。载荷只含受控元数据（无媒体字节、无凭据）。
 * expectedVersion 冲突 → 读新版本重试一次。
 */
export function makeARegistrar({ aBaseUrl, aCredential }) {
  if (!aBaseUrl || !aCredential) throw new ConnError('BLOCKED_EXTERNAL', 'A 登记需要 aBaseUrl/aCredential 配置（本地 A 内核 48080）');

  async function aFetch(path, init) {
    const res = await fetch(`${aBaseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-principal-credential': aCredential, ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async function getProjectInputVersion(projectId) {
    const { status, body } = await aFetch(`/api/v1/projects/${projectId}`);
    if (status !== 200 || body?.ok === false) throw new ConnError('NOT_FOUND', `A project ${projectId}: ${body?.error ?? status}`);
    return body.projectInputVersion ?? body.project?.inputVersion ?? 0;
  }

  async function registerEvidence({ projectId, tenantId, evidenceId, customerId, summary, sha256, sourceProvider, sourceMode }) {
    const requestId = `cnext-${randomUUID()}`;
    const content = {
      connector: 'jw-connectors',
      tenantId, customerId, evidenceId,
      sourceProvider, sourceMode,
      mediaSha256: sha256 ?? null,
      summary,
      // 注意：不含媒体字节、不含内部授信字段；金额/价格字段禁入（A 契约 §3.1）。
    };
    let inputVersion = await getProjectInputVersion(projectId);
    let { status, body } = await aFetch(`/api/v1/projects/${projectId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ requestId, expectedVersion: inputVersion, kind: 'connector_evidence', content }),
    });
    if (status === 409 && body?.error === 'VERSION_CONFLICT') {
      inputVersion = await getProjectInputVersion(projectId);
      ({ status, body } = await aFetch(`/api/v1/projects/${projectId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ requestId: `${requestId}-r`, expectedVersion: inputVersion, kind: 'connector_evidence', content }),
      }));
    }
    if (status !== 200) throw new ConnError('INTERNAL', `A evidence register failed: ${status} ${JSON.stringify(body).slice(0, 200)}`);
    return { aEvidenceId: body.evidence?.evidenceId ?? body.evidenceId ?? null, aProjectId: projectId, requestId };
  }

  return { registerEvidence, getProjectInputVersion };
}

export function sha256Of(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
