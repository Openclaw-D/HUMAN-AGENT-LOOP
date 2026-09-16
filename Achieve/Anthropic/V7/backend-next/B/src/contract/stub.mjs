// V7 backend-next B ⇄ A 契约适配层(stub v2,对齐 A CONTRACT v1.0)。
// A 合同已冻结(V7/backend-next/CONTRACT.md v1.0 FROZEN);本桩是 B 本地测试替身,
// 让 worker/编排器在无 A 实例时可比测。语义按合同从严实现:
//   - claim/complete/fail 以 goalId 为粒度;complete/fail 门序 = 终态门 → fencing 门 →
//     状态门 → 版本门 → 载荷一致性(§3.4);
//   - 过期租约可被重领(token 递增;lease 到期≠API未执行,也不冻结任务);
//   - STALE_FENCING_TOKEN/LEASE_EXPIRED = A 未记录效果,安全重试路径;
//     VERSION_CONFLICT = 协调冲突(§6 对 B 的语义);
//   - requestId 载荷一致性:同载荷 replayed:true,异载荷 REQUEST_MISMATCH;
//   - complete 的 result.provider ∈ simulation|real_http|calculation;B 永不报 accepted/decided。
// 存储 B 目录内隔离文件,不是共享 schema,不是产品事实源。

import { fs } from '../deps.mjs';
import { atomicWriteJson, sha256hex } from '../ports.mjs';
import { stableJson } from '../graph/decision.mjs';

const STUB_VERSION = 'b-contract-stub@0.2.0(对齐A CONTRACT v1.0)';

export function createContractStub({ dataDir } = {}) {
  const dir = dataDir ?? null;
  const state = {
    goals: new Map(),      // goalId → goal projection + assignment/receipts/invalidated
    receipts: new Map(),   // requestId → execution receipt
    humanRequests: new Map(),
    sentBodies: new Map(), // requestId → payloadHash
    events: [],            // [对账项] 极简 outbox 投影(pollWork 语义依赖)
  };

  async function persist() {
    if (!dir) return;
    await fs.mkdir(dir, { recursive: true });
    const plain = {
      goals: [...state.goals.entries()],
      receipts: [...state.receipts.entries()],
      humanRequests: [...state.humanRequests.entries()],
      events: state.events.slice(-200),
    };
    await atomicWriteJson(`${dir}/stub-state.json`, { version: STUB_VERSION, state: plain });
  }

  async function restore() {
    if (!dir) return;
    try {
      const raw = JSON.parse(await fs.readFile(`${dir}/stub-state.json`, 'utf8'));
      if (raw?.version !== STUB_VERSION) return; // 版本不符:失败关闭,不猜兼容
      for (const [k, v] of raw.state.goals) state.goals.set(k, v);
      for (const [k, v] of raw.state.receipts) state.receipts.set(k, v);
      for (const [k, v] of raw.state.humanRequests) state.humanRequests.set(k, v);
      for (const e of raw.state.events ?? []) state.events.push(e);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  let readyPromise = null;
  function ensureReady() {
    if (!readyPromise) readyPromise = restore();
    return readyPromise;
  }

  function emitGoalEvent(goalId, eventType) {
    state.events.push({ seq: state.events.length + 1, eventId: `ev-${state.events.length + 1}`, eventType, goalId, at: new Date().toISOString() });
  }

  // ---- 测试/装配辅助(B 不生产业务事实;桩数据由装配方显式注入) ----
  async function seedGoal(goal) {
    await ensureReady();
    state.goals.set(goal.goalId, {
      version: 1, status: 'ready', stale: false, executorKind: 'agent',
      projectId: 'p', goalKey: 'g', inputVersions: { factVersion: '1', ruleVersion: '1' },
      ...goal,
    });
    emitGoalEvent(goal.goalId, 'GOAL_READY');
    await persist();
  }
  async function invalidateGoals(goalIds) {
    await ensureReady();
    for (const id of goalIds) {
      const g = state.goals.get(id);
      if (g) { g.invalidated = true; g.status = 'invalidated'; }
    }
    await persist();
  }

  return {
    stubVersion: STUB_VERSION,
    _state: state, // 测试检视用;不是契约接口
    seedGoal, invalidateGoals, restore,

    async health() { await ensureReady(); return { ok: true, stubVersion: STUB_VERSION }; },

    /** [A §2/§3] 目标版本投影:factVersion=goal.version(乐观锁),ruleVersion=项目输入版本。 */
    async getGoalVersions(projectId, goalId) {
      await ensureReady();
      const g = goalId ? state.goals.get(goalId) : [...state.goals.values()].find((x) => x.projectId === projectId);
      if (!g) throw Object.assign(new Error('FACT_STORE_MISSING: 目标不可见,失败关闭'), { code: 'FACT_STORE_MISSING' });
      return { factVersion: String(g.version), ruleVersion: String(g.inputVersions?.ruleVersion ?? g.projectInputVersion ?? '0'), stale: !!g.stale };
    },

    async getGoalView(goalId) {
      await ensureReady();
      const g = state.goals.get(goalId);
      return g ? { ...g, assignment: g.assignment ? { ...g.assignment } : null } : null;
    },

    /** [A §4] pollWork:worker 领取入口。stub 直接扫 ready 目标(A 真实侧为 events 拉取+claim)。 */
    async pollWork({ workerId, now = new Date().toISOString(), leaseMs = 60000 } = {}) {
      await ensureReady();
      for (const g of state.goals.values()) {
        if (g.invalidated || g.status !== 'ready') continue;
        const r = await this.claimGoal({ goalId: g.goalId, requestId: `claim:${g.goalId}:${workerId}:${Date.now()}`, now, leaseMs });
        if (r.ok) return r;
      }
      return { ok: false, code: 'NO_CLAIMABLE_GOAL' };
    },

    async getEventHead() {
      await ensureReady();
      return { seq: state.events.length };
    },

    async claimGoal({ goalId, requestId, expectedVersion, now = new Date().toISOString(), leaseMs = 60000 }) {
      await ensureReady();
      const g = state.goals.get(goalId);
      if (!g) return { ok: false, code: 'NOT_FOUND' };
      if (g.invalidated || g.status === 'invalidated') return { ok: false, code: 'NOT_READY', messageZh: '目标已被失效' };
      // 授权门/项目门由 A 真实侧执行(身份头+验证器);stub 以调用方自律
      if (expectedVersion !== undefined && Number(expectedVersion) !== Number(g.version)) {
        return { ok: false, code: 'VERSION_CONFLICT', serverVersion: g.version };
      }
      const a = g.assignment;
      if (g.status === 'leased' && a && new Date(a.leaseUntil) > new Date(now)) {
        return { ok: false, code: 'NOT_READY', messageZh: `目标被 ${a.assignee} 持有至 ${a.leaseUntil}` };
      }
      // 过期租约可重领:token 递增(§3.4 恢复语义)
      const fencingToken = (g.fencingSeq ?? 0) + 1;
      g.fencingSeq = fencingToken;
      g.assignment = { goalId, assignee: requestId ?? 'worker', fencingToken, leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString(), claimedAt: now };
      g.status = 'leased';
      emitGoalEvent(goalId, 'GOAL_CLAIMED');
      await persist();
      return {
        ok: true,
        status: 'leased',
        task: { goalId: g.goalId, projectId: g.projectId, goalKey: g.goalKey, params: g.params ?? {}, executorKind: g.executorKind, role: g.role ?? null, purpose: g.purpose ?? null },
        assignment: { ...g.assignment },
        goalVersion: g.version,
      };
    },

    /** [A §3.4] complete 门序:终态门 → fencing 门 → 状态门 → 版本门 → 载荷一致性。 */
    async completeGoal({ goalId, requestId, expectedVersion, fencingToken, result, now = new Date().toISOString() }) {
      await ensureReady();
      const g = state.goals.get(goalId);
      if (!g) return { ok: false, code: 'NOT_FOUND' };
      if (['decided', 'invalidated'].includes(g.status) || g.invalidated) return { ok: false, code: 'TERMINAL_STATE', messageZh: '目标已终态' };
      // 0) 全局幂等表先于门序:A 合同 §3——同载荷重放原响应 replayed:true(§3.4 门序之前的中间件层)
      const bodyHash = sha256hex(stableJson({ goalId, result }));
      const prev = state.sentBodies.get(requestId);
      if (prev !== undefined) {
        if (prev !== bodyHash) return { ok: false, code: 'REQUEST_MISMATCH', messageZh: `requestId ${requestId} 已绑定不同载荷` };
        return { ok: true, receipt: state.receipts.get(requestId), goalVersion: g.version, replayed: true };
      }

      const a = g.assignment;
      if (!a || a.fencingToken !== fencingToken) return { ok: false, code: 'STALE_FENCING_TOKEN' };
      if (g.status !== 'leased') return { ok: false, code: 'NOT_READY', messageZh: `状态 ${g.status} 不可 complete` };
      if (new Date(a.leaseUntil) <= new Date(now)) return { ok: false, code: 'LEASE_EXPIRED' };
      if (expectedVersion !== undefined && Number(expectedVersion) !== Number(g.version)) {
        return { ok: false, code: 'VERSION_CONFLICT', serverVersion: g.version };
      }
      state.sentBodies.set(requestId, bodyHash);
      const receipt = {
        requestId, goalId, fencingToken,
        kind: 'execution_completed',
        result, at: now,
      };
      state.receipts.set(requestId, receipt);
      g.status = 'candidate_ready';
      g.result = result;
      g.version = Number(g.version) + 1;
      g.receiptCount = (g.receiptCount ?? 0) + 1;
      emitGoalEvent(goalId, 'GOAL_CANDIDATE_READY');
      await persist();
      return { ok: true, receipt, goalVersion: g.version, replayed: false };
    },

    /** [A §3.4] fail 门序同 complete(§6:B 对 unknown/needs_* 以 fail+note 出口,由人工 resume)。 */
    async failGoal({ goalId, requestId, expectedVersion, fencingToken, note, now = new Date().toISOString() }) {
      await ensureReady();
      const g = state.goals.get(goalId);
      if (!g) return { ok: false, code: 'NOT_FOUND' };
      if (['decided', 'invalidated'].includes(g.status) || g.invalidated) return { ok: false, code: 'TERMINAL_STATE' };
      // 0) 全局幂等表先于门序(同 complete)
      const bodyHash = sha256hex(stableJson({ goalId, note }));
      const prev = state.sentBodies.get(requestId);
      if (prev !== undefined) {
        if (prev !== bodyHash) return { ok: false, code: 'REQUEST_MISMATCH' };
        return { ok: true, receipt: state.receipts.get(requestId), goalVersion: g.version, replayed: true };
      }
      const a = g.assignment;
      if (!a || a.fencingToken !== fencingToken) return { ok: false, code: 'STALE_FENCING_TOKEN' };
      if (g.status !== 'leased') return { ok: false, code: 'NOT_READY', messageZh: `状态 ${g.status} 不可 fail` };
      if (new Date(a.leaseUntil) <= new Date(now)) return { ok: false, code: 'LEASE_EXPIRED' };
      if (expectedVersion !== undefined && Number(expectedVersion) !== Number(g.version)) {
        return { ok: false, code: 'VERSION_CONFLICT', serverVersion: g.version };
      }
      state.sentBodies.set(requestId, bodyHash);
      const receipt = { requestId, goalId, fencingToken, kind: 'execution_failed', note, at: now };
      state.receipts.set(requestId, receipt);
      g.status = 'failed';
      g.version = Number(g.version) + 1;
      g.receiptCount = (g.receiptCount ?? 0) + 1;
      emitGoalEvent(goalId, 'GOAL_FAILED');
      await persist();
      return { ok: true, receipt, goalVersion: g.version, replayed: false };
    },

    async getExecutionReceipt(requestId) {
      await ensureReady();
      return state.receipts.get(requestId) ?? null;
    },

    /** [A §4] 人工待办(kind ∈ missing_evidence|decision|clarification;同 goal+kind 幂等)。 */
    async createHumanRequest({ projectId, goalId, kind, question, requestedRole = 'business', requiredEvidenceKinds = [], now = new Date().toISOString() }) {
      await ensureReady();
      const id = `hr:${goalId ?? 'na'}:${kind}`;
      const existing = state.humanRequests.get(id);
      if (existing) return { ok: true, humanRequest: existing, replayed: true };
      const hr = { hrequestId: id, projectId, goalId: goalId ?? null, kind, question, requestedRole, requiredEvidenceKinds, status: 'open', createdAt: now };
      state.humanRequests.set(id, hr);
      await persist();
      return { ok: true, humanRequest: hr, replayed: false };
    },

    async getHumanRequest(hrequestId) {
      await ensureReady();
      return state.humanRequests.get(hrequestId) ?? null;
    },
  };
}
