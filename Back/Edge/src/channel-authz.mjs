// Connectors 通道逐资源授权（任务04 §三）：
// Edge 是"页面会话 → Connectors 服务令牌"的唯一换权点，转发前必须裁决会话与目标资源的归属关系。
// 本模块只产出 authorize 回调（供 createUpstreamProxy/createReadProxy 与测试共用）：
//   - 角色边界：customer-only 会话仅可执行 access='customer'|'open' 的动作；access='internal'
//     （邀请签发/人工转录/更正/获准复核/暂停恢复）一律 403 ROLE_FORBIDDEN；
//   - 客户归属：带目标客户（customerId/cid）的读写先以本会话凭据经 A checkCustomer 裁决
//     （A 逐请求授权，Edge 不缓存结论）；拒绝 → 不转发；缺失 → 400 失败关闭；
//   - 任务详情归属：页面只持 taskId——服务端先取回任务归属（customer_id）再校验；不可读 →
//     404（不泄露存在性）。仅持有他人 taskId/evidenceId、改 query/body 的 customerId，
//     不得取得他人数据或权限。
//   - 回执归属（IR-T01-3 receipts 面）：页面只持 requestId——服务端先取回回执行（a_links 行内
//     customer_id）再校验；命中且不可读 → 404（不泄露存在性）；未命中 → 原样透传 found:false。

// 可信调用上下文（任务04 ↔ 任务02 IR-04-2A-3 冻结约定；Back/Edge 侧实现）：
// Edge 是页面会话→服务令牌面的唯一换权点，转发时由服务端从会话派生 x-jw-actor-principal /
// x-jw-actor-roles 附加到上游请求。两个代理均重建上游头对象、浏览器请求头一律不透传，故这两个头
// 只可能来自 Edge 服务端——上游 Connectors 的归属判定与留痕必须以此为准；body 自报 actor 只作
// 展示字段，不得作为授权或审计依据。授权裁决仍由 Edge 逐资源预检 + 上游令牌校验共同承担。
export function trustedActorHeaders(session) {
  const principal = session?.principalId;
  if (typeof principal !== 'string' || principal.length === 0) return {};
  const roles = Array.isArray(session?.roles) ? session.roles.filter((r) => typeof r === 'string') : [];
  return {
    'x-jw-actor-principal': principal,
    ...(roles.length > 0 ? { 'x-jw-actor-roles': roles.join(',') } : {}),
  };
}

export function createChannelAuthorizers({ store, log = () => { } }) {
  const customerOnly = (session) => (session?.roles ?? []).length > 0 && (session?.roles ?? []).every((r) => r === 'customer');

  const checkCustomerOrReject = async (session, customerId, { notFoundOnDeny = false, tenantOut = null } = {}) => {
    if (typeof store?.checkCustomer !== 'function') {
      return { status: 503, body: { ok: false, error: 'AUTHZ_SOURCE_UNAVAILABLE', note: 'live 模式要求上游客户授权裁决面（store.checkCustomer）：失败关闭' } };
    }
    const target = await store.checkCustomer(customerId, { credential: session.credential }).catch((e) => ({ ok: false, code: 'UPSTREAM_UNKNOWN', status: 502, reason: String(e?.message || e) }));
    if (target?.ok) {
      // TAKEOFF：把 A 权威租户带给调用方（读面 tid 归一用；页面/调用方自报 tid 不采信）
      if (tenantOut && typeof target.tenantId === 'string' && target.tenantId) tenantOut.tenantId = target.tenantId;
      return null;
    }
    if (notFoundOnDeny) return { status: 404, body: { ok: false, error: 'NOT_FOUND' } };
    const status = target?.status === 403 ? 403 : target?.status === 404 ? 404 : 502;
    return { status, body: { ok: false, error: target?.code || 'TARGET_UNVERIFIED', note: '目标客户对本会话不可读或校验失败：不转发' } };
  };

  const writeAuthorize = async ({ route, urlObj, body, session }) => {
    if (route.access === 'internal' && customerOnly(session)) {
      log(`[channel-authz] write ${urlObj.pathname} role-forbidden principal=${session?.principalId ?? 'unknown'}`);
      return { status: 403, body: { ok: false, error: 'ROLE_FORBIDDEN', note: '客户联系人身份不可执行内部处理动作（邀请签发/人工转录/更正/获准复核/暂停恢复）' } };
    }
    if (typeof route.customerOf !== 'function') return null; // access='open'：邀请令牌本身就是授权
    const customerId = route.customerOf(null, urlObj, body);
    if (!customerId || typeof customerId !== 'string') {
      return { status: 400, body: { ok: false, error: 'CUSTOMER_REQUIRED', note: '本动作必须携带目标客户 customerId：逐资源授权失败关闭' } };
    }
    return await checkCustomerOrReject(session, customerId);
  };

  const readAuthorize = async ({ route, m, urlObj, session, fetchImpl, baseUrl, headerName, credentialFor }) => {
    if (route.ownership === 'task') {
      const tid = urlObj.searchParams.get('tid');
      if (!tid) return { status: 400, body: { ok: false, error: 'TENANT_REQUIRED', note: 'tid（tenantId）必填' } };
      let upRes;
      try {
        upRes = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/connectors/processing/tasks/${encodeURIComponent(m[1])}?tid=${encodeURIComponent(tid)}`, {
          headers: { [headerName]: credentialFor(session) },
          signal: AbortSignal.timeout(5000),
        });
      } catch (e) {
        const reason = e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message);
        return { status: 502, body: { ok: false, error: 'UPSTREAM_UNKNOWN', reason, note: '任务归属预检失败：不转发' } };
      }
      if (upRes.status === 404) return { status: 404, body: { ok: false, error: 'NOT_FOUND' } };
      if (upRes.status !== 200) {
        return { status: 502, body: { ok: false, error: 'UPSTREAM_UNKNOWN', reason: `ownership preflight status ${upRes.status}`, note: '任务归属预检失败：不转发' } };
      }
      let upBody = null;
      try { upBody = await upRes.json(); } catch { /* 归属缺失按不可转发处理 */ }
      const ownerId = upBody?.task?.customer_id ?? upBody?.task?.customerId ?? null;
      if (!ownerId) return { status: 502, body: { ok: false, error: 'UPSTREAM_UNKNOWN', reason: 'task row lacks customer ownership', note: '任务归属预检失败：不转发' } };
      return await checkCustomerOrReject(session, ownerId, { notFoundOnDeny: true });
    }
    if (route.ownership === 'receipt') {
      // IR-T01-3 receipts 面：requestId 全租户可查——Edge 预检回执行归属，命中且不可读一律 404
      // （回执不能凭 requestId 越权查询）；未命中原样转发（上游 found:false，无额外信息泄露）。
      const tid = urlObj.searchParams.get('tid');
      if (!tid) return { status: 400, body: { ok: false, error: 'TENANT_REQUIRED', note: 'tid（tenantId）必填' } };
      let upRes;
      try {
        upRes = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/connectors/processing/receipts/${encodeURIComponent(m[1])}?tid=${encodeURIComponent(tid)}`, {
          headers: { [headerName]: credentialFor(session) },
          signal: AbortSignal.timeout(5000),
        });
      } catch (e) {
        const reason = e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message);
        return { status: 502, body: { ok: false, error: 'UPSTREAM_UNKNOWN', reason, note: '回执归属预检失败：不转发' } };
      }
      if (upRes.status !== 200) {
        return { status: 502, body: { ok: false, error: 'UPSTREAM_UNKNOWN', reason: `receipt preflight status ${upRes.status}`, note: '回执归属预检失败：不转发' } };
      }
      let upBody = null;
      try { upBody = await upRes.json(); } catch { /* 解析失败按不可转发处理 */ }
      if (upBody?.found !== true) return null;
      const ownerId = upBody?.receipt?.customer_id ?? upBody?.receipt?.customerId ?? null;
      if (!ownerId) return { status: 502, body: { ok: false, error: 'UPSTREAM_UNKNOWN', reason: 'receipt row lacks customer ownership', note: '回执归属预检失败：不转发' } };
      return await checkCustomerOrReject(session, ownerId, { notFoundOnDeny: true });
    }
    if (typeof route.customerOf !== 'function') return null;
    const customerId = route.customerOf(null, urlObj);
    if (!customerId || typeof customerId !== 'string') {
      return { status: 400, body: { ok: false, error: 'CUSTOMER_REQUIRED', note: '本读面必须携带目标客户 cid：逐资源授权失败关闭' } };
    }
    const tenantBox = {};
    const verdict = await checkCustomerOrReject(session, customerId, { tenantOut: tenantBox });
    if (verdict) return verdict;
    // TAKEOFF：tid 以 A 权威租户归一（客户归属从权威上下文确定；urlObj.search 随 searchParams 联动，
    // readproxy 以 urlObj.search 构造上游 URL——页面自报 tid 即使错误也已被纠正）。
    if (tenantBox.tenantId) urlObj.searchParams.set('tid', tenantBox.tenantId);
    return null;
  };

  return { writeAuthorize, readAuthorize };
}
