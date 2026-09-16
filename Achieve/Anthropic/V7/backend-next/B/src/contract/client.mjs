// V7 backend-next B ⇄ A 契约 HTTP 客户端(对齐 V7/backend-next/CONTRACT.md v1.0 FROZEN)。
// 与 stub.mjs 实现同一 B 侧接口(createBRuntime 按 mode 选择),worker/编排器不感知差异。
// 合同要点落点:
//   - 身份:X-Principal-Credential 头(合成测试 principal 由 A 发布,如 tok-agent);
//   - claim:POST /api/v1/goals/:goalId/claim {requestId, expectedVersion} → {status:"leased",
//     fencingToken, leaseUntil, goalVersion}(§3.4:过期租约可重领,token 递增);
//   - complete/fail 门序:终态→fencing→状态→版本→载荷;STALE_FENCING_TOKEN/LEASE_EXPIRED
//     = 未执行可安全重试路径;VERSION_CONFLICT = 协调冲突;
//   - 幂等:requestId 全局幂等表,同载荷 replayed:true,异载荷 409 REQUEST_MISMATCH;
//   - 事实权威:A 的 goal.version/输入版本;B 只读;
//   - 传输语义:连接未建立 → err.notSent=true;超时中止 → 不可判未发送(A_UNKNOWN)。
// 本模块只做传输与错误归一,不做任何业务重试(重试策略在 worker,且受合同门序约束)。

import { redactText } from '../redact.mjs';

export function createContractClient({ baseUrl, principalCredential, projectFilter = null, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!baseUrl) throw new Error('A 契约客户端:缺少 baseUrl');
  const base = baseUrl.replace(/\/$/, '');
  // 部署范围护栏(可选):worker 只消费这些项目的目标;其余项目跳过不领取
  // (留给其他 worker;游标仍前进,不回放)。生产部署建议用 A 的项目受限 principal + 此过滤双保险。
  const filter = Array.isArray(projectFilter) && projectFilter.length > 0 ? new Set(projectFilter.map(String)) : null;

  async function call(method, path, body, { notSentMatters = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(principalCredential ? { 'x-principal-credential': principalCredential } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e?.name === 'AbortError';
      const err = new Error(redactText(`A 服务不可达(${method} ${path}):${aborted ? '超时中止(发送状态不可判定)' : (e.cause?.code ?? e.message)}`));
      err.code = aborted ? 'A_UNKNOWN' : 'A_UNAVAILABLE';
      err.notSent = notSentMatters && !aborted;
      throw err;
    }
    clearTimeout(timer);
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.ok !== true) {
      const err = new Error(redactText(`A ${method} ${path} 失败(${res.status}):${payload?.error ?? 'UNKNOWN'} ${payload?.message ?? ''}`));
      err.code = payload?.error ?? `HTTP_${res.status}`;
      err.status = res.status;
      err.serverVersion = payload?.serverVersion;
      err.notSent = false; // 已送达 A 但被拒:A 有记录
      throw err;
    }
    return payload;
  }

  // 错误归一:契约错误码 → {ok:false, code,...} 形状(与 stub 同形,worker 不感知传输差异)
  function normalize(promise) {
    return promise.catch((e) => ({ ok: false, code: e.code ?? 'A_ERROR', messageZh: e.message, serverVersion: e.serverVersion }));
  }

  return {
    transport: 'http',
    contractVersion: 'v1.0',

    async health() {
      const r = await call('GET', '/api/v1/health', undefined, { notSentMatters: false });
      return { ok: true, db: r.db, model: r.model };
    },

    /** [§2] 目标版本投影(B 的 stale 判据:goal.version 变化 + goal.stale)。 */
    async getGoalView(goalId) {
      const r = await call('GET', `/api/v1/goals/${encodeURIComponent(goalId)}`);
      const g = r.goal ?? r;
      return { ...g, assignment: r.assignment ?? g.assignment ?? null };
    },

    async getGoalVersions(projectId, goalId) {
      const g = await this.getGoalView(goalId);
      return { factVersion: String(g.version), ruleVersion: String(g.projectInputVersion ?? '0'), stale: !!g.stale };
    },

    /**
     * [§3.5/§4] worker 领取入口:events 拉取(GOAL_READY/GOAL_RESUMED/GOAL_INVALIDATED)
     * + 目标状态核实 + claim。cursor 由调用方持久化(B worker 传 afterSeq)。
     * 返回 {ok:true, task, assignment:{fencingToken, leaseUntil}, goalVersion, cursor}
     * | {ok:false, code:'NO_CLAIMABLE_GOAL', cursor}。
     */
    async pollWork({ workerId, afterSeq = 0, expectedVersionByGoal = {}, now = new Date().toISOString() } = {}) {
      let cursor = Number(afterSeq) || 0;
      const ev = await call('GET', `/api/v1/events?after=${cursor}&limit=100`, undefined, { notSentMatters: false });
      const events = ev.events ?? [];
      let claimed = null;
      const newCursorBase = events.length > 0 ? events[events.length - 1].seq : cursor;
      for (const e of [...events].reverse()) { // 从最新往回找可领目标
        if (!['GOAL_READY', 'GOAL_RESUMED'].includes(e.eventType) || !e.goalId) continue;
        cursor = Math.max(cursor, newCursorBase);
        const goal = await this.getGoalView(e.goalId).catch(() => null);
        if (!goal || goal.status !== 'ready' || goal.executorKind !== 'agent') continue;
        if (filter) {
          // 范围外项目:跳过不领取(不消耗该目标的可领性;只是本 worker 不接)
          const pid = String(e.projectId ?? goal.projectId ?? '');
          if (!pid || !filter.has(pid)) continue;
        }
        const expectedVersion = expectedVersionByGoal[e.goalId] ?? goal.version;
        const r = await normalize(call('POST', `/api/v1/goals/${encodeURIComponent(e.goalId)}/claim`, {
          requestId: `claim:${e.goalId}:${workerId}:${Date.now()}`, expectedVersion,
        }));
        if (r.ok) {
          claimed = {
            ok: true, status: r.status ?? 'leased',
            // A 的 goal 投影不含 projectId:从 outbox 事件取(OutboxEvent.projectId,§2)
            task: { goalId: e.goalId, projectId: e.projectId ?? null, goalKey: goal.goalKey, params: goal.params ?? {}, executorKind: goal.executorKind, role: goal.responsibleRole ?? null, purpose: null },
            assignment: { fencingToken: r.fencingToken, leaseUntil: r.leaseUntil, claimedAt: now },
            goalVersion: r.goalVersion ?? expectedVersion,
          };
          break;
        }
        if (!['NOT_READY', 'VERSION_CONFLICT', 'PROJECT_PAUSED'].includes(r.code)) {
          return { ok: false, code: r.code, messageZh: r.messageZh, cursor };
        }
      }
      if (!claimed) cursor = Math.max(cursor, newCursorBase);
      return claimed ?? { ok: false, code: 'NO_CLAIMABLE_GOAL', cursor };
    },

    /** [A §3.5 对齐订阅语义] 事件头游标:worker 首跑从当前头开始,不回放历史。 */
    async getEventHead() {
      try {
        const r = await call('GET', '/api/v1/events?after=0&limit=500', undefined, { notSentMatters: false });
        const events = r.events ?? [];
        return { seq: events.length ? Number(events[events.length - 1].seq) : 0 };
      } catch {
        return { seq: 0 };
      }
    },

    async claimGoal({ goalId, requestId, expectedVersion, now = new Date().toISOString() }) {
      const r = await normalize(call('POST', `/api/v1/goals/${encodeURIComponent(goalId)}/claim`, { requestId, expectedVersion }));
      if (!r.ok) return r;
      return {
        ok: true, status: r.status ?? 'leased',
        task: { goalId, projectId: r.projectId, goalKey: r.goalKey, params: r.params ?? {}, executorKind: 'agent', role: r.responsibleRole ?? null, purpose: null },
        assignment: { fencingToken: r.fencingToken, leaseUntil: r.leaseUntil, claimedAt: now },
        goalVersion: r.goalVersion,
      };
    },

    async completeGoal({ goalId, requestId, expectedVersion, fencingToken, result, now = new Date().toISOString() }) {
      return normalize(call('POST', `/api/v1/goals/${encodeURIComponent(goalId)}/complete`, { requestId, expectedVersion, fencingToken, result }));
    },

    async failGoal({ goalId, requestId, expectedVersion, fencingToken, note, now = new Date().toISOString() }) {
      return normalize(call('POST', `/api/v1/goals/${encodeURIComponent(goalId)}/fail`, { requestId, expectedVersion, fencingToken, note }));
    },

    async getExecutionReceipt(requestId) {
      try {
        const r = await call('GET', `/api/v1/receipts/${encodeURIComponent(requestId)}`, undefined, { notSentMatters: false });
        return r.receipt ?? null;
      } catch {
        return null; // 回执查询失败按"无回执"处理(调用方保守路径)
      }
    },

    /** [A §4] kind ∈ missing_evidence|decision|clarification。 */
    async createHumanRequest({ projectId, goalId, kind, question, requestedRole, requiredEvidenceKinds }) {
      return normalize(call('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/human-requests`, {
        requestId: `hr:${goalId ?? 'na'}:${kind}:${Date.now()}`,
        goalId, kind, question,
        requestedRole: requestedRole ?? 'business', // A 要求必填 1..64;缺省由 B 兜底为业务角色
        requiredEvidenceKinds: requiredEvidenceKinds ?? [],
      }));
    },

    async getHumanRequest(hrequestId) {
      try {
        const r = await call('GET', `/api/v1/projects/na/human-requests`, undefined, { notSentMatters: false });
        return (r.humanRequests ?? []).find((h) => h.hrequestId === hrequestId) ?? null;
      } catch {
        return null;
      }
    },
  };
}
