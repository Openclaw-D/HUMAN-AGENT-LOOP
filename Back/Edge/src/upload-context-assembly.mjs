// V0.4 R2-02：上传恢复装配（契约：docs/v0.4/results/r2-02-upload/CONTRACT.md）。
// 把三段既有能力注入合成一个可挂载的恢复读面：A 上传授权投影（正式 HTTP 面）→
// Edge 恢复 reader（upload-context.mjs）→ Connectors 恢复模块（intake/upload-context.mjs read）。
// 全部依赖可注入；共享 server.mjs 的最终挂载留串行集成，本文件不修改任何共享入口。
// 失败关闭口径（与 01 路契约 §4 一致）：A 的结构化拒绝（200+ok:false 与 4xx）一律映射为
// 授权拒绝（reader → 403 UPLOAD_FORBIDDEN），绝不伪装成上游故障；仅网络不可达、A 5xx 与
// 响应畸形才上抛（reader → 503 UPLOAD_CONTEXT_UNAVAILABLE）。
import { createUploadContextReader } from './upload-context.mjs';

/**
 * A 授权投影 HTTP 适配。credential 原样经 x-principal-credential 转交 A 复核——
 * 会话身份（principalId）只作一致性声明，绝不作为授权来源；租户以 A 按客户行
 * 判定的 tenantId 为准（仅 ok:true 时返回），本层不自创任何权限判断。
 */
export function createAuthorizeUploadViaA({ aBaseUrl, fetchImpl = fetch } = {}) {
  if (typeof aBaseUrl !== 'string' || !aBaseUrl) throw new TypeError('createAuthorizeUploadViaA: aBaseUrl 必须是非空字符串');
  if (typeof fetchImpl !== 'function') throw new TypeError('createAuthorizeUploadViaA: fetchImpl 必须是函数');
  const base = aBaseUrl.replace(/\/+$/, '');
  return async function authorizeUpload({ credential, principalId, customerId }) {
    if (typeof customerId !== 'string' || !customerId) throw new TypeError('authorizeUpload: customerId 必须是非空字符串');
    let url = `${base}/api/v2/customers/${encodeURIComponent(customerId)}/upload-authorization`;
    if (typeof principalId === 'string' && principalId) url += `?principalId=${encodeURIComponent(principalId)}`;
    let res;
    try {
      res = await fetchImpl(url, { headers: { 'x-principal-credential': String(credential) } });
    } catch (cause) {
      const err = new Error('A authorization projection unreachable');
      err.code = 'A_AUTHZ_UNREACHABLE';
      err.cause = cause;
      throw err;
    }
    if (res.status >= 500) {
      // A 内部故障（如 DB 异常）不是授权拒绝：上抛 → reader 503，不把故障伪装成无权限。
      const err = new Error(`A authorization projection upstream failure (HTTP ${res.status})`);
      err.code = 'A_AUTHZ_UPSTREAM_FAILURE';
      err.status = res.status;
      throw err;
    }
    if (res.status >= 200 && res.status < 300) {
      let grant;
      try {
        grant = await res.json();
      } catch (cause) {
        const err = new Error('A authorization projection returned malformed JSON');
        err.code = 'A_AUTHZ_UPSTREAM_FAILURE';
        err.cause = cause;
        throw err;
      }
      // 200 + ok:false 的结构化拒绝原样返回，由 reader 统一映射 403 UPLOAD_FORBIDDEN。
      return grant;
    }
    // 其余 4xx 是 A 的结构化拒绝（403 PRINCIPAL_UNTRUSTED=凭据失效、400 INVALID_INPUT=入参非法）：
    // 映射为授权拒绝形状（reason=A 错误码），reader 回 403 —— 拒绝保持失败关闭，不落入 503。
    let reason = 'UPLOAD_FORBIDDEN';
    try {
      const body = await res.json();
      if (typeof body?.error === 'string' && body.error) reason = body.error;
    } catch { /* 非错误体：保留默认 reason */ }
    return { ok: false, canRead: false, canUpload: false, customerId,
      principalId: typeof principalId === 'string' ? principalId : null, tenantId: null, reason };
  };
}

/**
 * Connectors 恢复模块适配：注入真实 store（需 .query）时进程内组装 makeUploadContextService.read。
 * 动态 import：仅直连形态加载 Connectors 源；分进程部署可改为注入 fetchContext（HTTP 适配），
 * 不拖入该源依赖。只读 read：不新建/续期/接受邀请，不触碰对象存储。
 */
export async function createFetchContextFromConnectors({ connectorsStore, now } = {}) {
  if (!connectorsStore || typeof connectorsStore.query !== 'function') {
    throw new TypeError('createFetchContextFromConnectors: connectorsStore.query 必须存在');
  }
  const mod = await import('../../Connectors/src/intake/upload-context.mjs');
  const service = mod.makeUploadContextService(connectorsStore, { now });
  return ({ tenantId, customerId, principalId }) => service.read({ tenantId, customerId, principalId });
}

/**
 * 可注入装配工厂（async）。
 * @param {object} deps
 *  - sessionOf(req)                          必填：Edge 会话解析（server.mjs 同款；缺会话 reader 回 401）。
 *  - authorizeUpload ｜ aBaseUrl(+fetchImpl)  必填其一：A 授权投影来源。
 *  - fetchContext     ｜ connectorsStore(+now) 必填其一：Connectors 恢复读来源。
 * @returns {Promise<{reader, authorizeUpload, fetchContext}>}
 *   reader: async ({ req, customerId }) => { status, body }（共享 server 挂载示例见同目录契约 MOUNTING.md）。
 */
export async function createUploadContextAssembly({ sessionOf, authorizeUpload, aBaseUrl, fetchImpl, fetchContext, connectorsStore, now } = {}) {
  if (typeof sessionOf !== 'function') throw new TypeError('createUploadContextAssembly: sessionOf(req) 必填');
  const authz = typeof authorizeUpload === 'function'
    ? authorizeUpload
    : (aBaseUrl ? createAuthorizeUploadViaA({ aBaseUrl, fetchImpl }) : null);
  if (typeof authz !== 'function') throw new TypeError('createUploadContextAssembly: 需要 authorizeUpload 或 aBaseUrl');
  let ctx = typeof fetchContext === 'function' ? fetchContext : null;
  if (ctx === null) {
    if (!connectorsStore) throw new TypeError('createUploadContextAssembly: 需要 fetchContext 或 connectorsStore');
    ctx = await createFetchContextFromConnectors({ connectorsStore, now });
  }
  const reader = createUploadContextReader({ sessionOf, authorizeUpload: authz, fetchContext: ctx });
  return { reader, authorizeUpload: authz, fetchContext: ctx };
}
