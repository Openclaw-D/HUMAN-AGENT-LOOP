import { randomUUID, createHash } from 'node:crypto';
import { ConnError } from '../errors.mjs';

/**
 * A 路登记：只经 A 现有 v1 HTTP API 写入（POST /api/v1/projects/:pid/evidence），
 * 不直写 A 业务表（任务02 §0）。载荷只含受控元数据（无媒体字节、无凭据）。
 * expectedVersion 冲突 → 读新版本重试一次。
 * goal-02：支持确定性 requestId（处理任务重放同 ID 幂等，绝不换 ID 重试）+ 注入 fetch
 * （测试故障注入）+ 超时显式 TIMEOUT_UNKNOWN（调用方保持 unknown 先对账）+ getReceipt 回执查询。
 */
export function makeARegistrar({ aBaseUrl, aCredential, fetchImpl = null }) {
  if (!aBaseUrl || !aCredential) throw new ConnError('BLOCKED_EXTERNAL', 'A 登记需要 aBaseUrl/aCredential 配置（本地 A 内核 48080）');
  const doFetch = fetchImpl ?? fetch;

  async function aFetch(path, init = {}, { timeoutMs = 0 } = {}) {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    let res;
    try {
      res = await doFetch(`${aBaseUrl}${path}`, {
        ...init,
        signal,
        headers: { 'content-type': 'application/json', 'x-principal-credential': aCredential, ...(init.headers ?? {}) },
      });
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw Object.assign(new Error(`A 请求超时（结果未知）：${path}`), { code: 'TIMEOUT_UNKNOWN' });
      throw Object.assign(new Error(`A 请求网络失败（结果未知）：${String(e.message).slice(0, 120)}`), { code: 'NETWORK_UNKNOWN' });
    }
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  /** 幂等回执查询（对账用）：found=true 表示该 requestId 的写命令确已生效。 */
  async function getReceipt(requestId) {
    const { status, body } = await aFetch(`/api/v1/receipts/${encodeURIComponent(requestId)}`);
    if (status === 200 && body?.ok !== false && (body?.requestId ?? body?.receipt?.requestId)) {
      return { found: true, requestId: body.requestId ?? body.receipt?.requestId, replayed: body.replayed ?? null };
    }
    if (status === 404) return { found: false, requestId };
    return { found: false, requestId, status };
  }

  async function getProjectInputVersion(projectId) {
    const { status, body } = await aFetch(`/api/v1/projects/${projectId}`);
    if (status !== 200 || body?.ok === false) throw new ConnError('NOT_FOUND', `A project ${projectId}: ${body?.error ?? status}`);
    return body.projectInputVersion ?? body.project?.inputVersion ?? 0;
  }

  async function registerEvidence({ projectId, tenantId, evidenceId, customerId, summary, sha256, sourceProvider, sourceMode, requestId = null, timeoutMs = 0 }) {
    const rid = requestId ?? `cnext-${randomUUID()}`;
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
      body: JSON.stringify({ requestId: rid, expectedVersion: inputVersion, kind: 'connector_evidence', content }),
    }, { timeoutMs });
    if (status === 409 && body?.error === 'VERSION_CONFLICT') {
      inputVersion = await getProjectInputVersion(projectId);
      ({ status, body } = await aFetch(`/api/v1/projects/${projectId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ requestId: rid, expectedVersion: inputVersion, kind: 'connector_evidence', content }),
      }, { timeoutMs }));
    }
    if (status !== 200) throw new ConnError('INTERNAL', `A evidence register failed: ${status} ${JSON.stringify(body).slice(0, 200)}`);
    return { aEvidenceId: body.evidence?.evidenceId ?? body.evidenceId ?? null, aProjectId: projectId, requestId: rid };
  }

  return { registerEvidence, getProjectInputVersion, getReceipt };
}

export function sha256Of(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
