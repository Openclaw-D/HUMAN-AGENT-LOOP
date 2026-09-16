// V7 backend-next B 独立 worker:目标执行进程(与编排/checkpoint 分离进程边界)。
// 对齐 A CONTRACT v1.0(§3.4/§6):
//   - A 是唯一 queue owner:worker 经 pollWork(真实侧=events 拉取+claim)领取,不自建队列;
//   - complete/fail 门序由 A 强制;STALE_FENCING_TOKEN/LEASE_EXPIRED = A 未记录效果,
//     "未执行可安全重试路径"——仅当本次执行结果确定(非 unknown)时有界重领(默认 1 次,
//     新 fencing token = A 授权的新执行周期);unknown 永不自动重做(人工核实后显式恢复);
//     VERSION_CONFLICT = 协调冲突 → 丢弃并留人工;
//   - A 无租约续期端点:worker 周期核对 leaseUntil,到期即停写回(lease 过期≠API未执行,
//     效果是否落库以 A 回执为准);
//   - 提交前先查 A 业务回执(requestId 幂等表):已有回执 → 零重复提交;
//   - 出口语义(§0):complete 最多 candidate_ready;failed/unknown/needs_* 走 fail+note,
//     并按需创建人工待办(kind ∈ missing_evidence|clarification);B 永不自报验收/决定;
//   - 并发上限、软超时(步边界取消)、取消均在步边界生效。

import { fs } from '../deps.mjs';
import { atomicWriteJson } from '../ports.mjs';
import { withFileLock } from '../fs-lock.mjs';
import { toACandidate } from '../transport/bridge.mjs';

/**
 * 终局 → A 上报映射([合同 §0/§2]provider ∈ simulation|real_http|calculation;
 * B 永不产生 accepted/decided)。
 * @returns {completed:true, result:{provider, output, evidenceRefs, notes}}
 *          | {completed:false, failNote, humanKind?, humanQuestion?}
 */
export function reportOutcome(view) {
  const t = view.terminal;
  if (!t) return { completed: false, failNote: '运行中断:无终局' };
  const sourceMode = view.steps.some((s) => s.sourceMode === 'mock') ? 'simulation'
    : view.steps.some((s) => s.sourceMode === 'real') ? 'real_http' : 'calculation';
  if (t.kind === 'completed') {
    const hasModel = view.steps.some((s) => s.kind === 'model');
    const candidate = view.candidate ? toACandidate(view.candidate) : null;
    return {
      completed: true,
      result: {
        provider: hasModel ? sourceMode : 'calculation',
        output: candidate ?? { observations: [], evidenceRefs: [], assumptions: [], uncertainty: [] },
        evidenceRefs: (view.evidenceRefs ?? []).map((e) => `${e.id}@v${e.version}`),
        notes: `ruleId=${view.ruleId ?? '-'} generation=${view.generation}`,
      },
    };
  }
  const map = {
    unknown: { humanKind: 'clarification', humanQuestion: `执行结果不可知,需人工核实后显式恢复:${t.reasonZh}` },
    waiting_evidence: { humanKind: 'missing_evidence', humanQuestion: `补证等待:${t.reasonZh}` },
    human_required: { humanKind: 'clarification', humanQuestion: `需人工处理:${t.reasonZh}` },
    failed: { humanKind: null, humanQuestion: null },
  };
  const m = map[t.kind] ?? { humanKind: 'clarification', humanQuestion: t.reasonZh };
  return {
    completed: false,
    failNote: `[${t.kind}] ${t.reasonZh ?? ''}`,
    humanKind: m.humanKind,
    humanQuestion: m.humanQuestion,
  };
}

export function createWorker({
  contract, orchestrator, logger = () => {}, now = () => new Date().toISOString(),
  workerId = 'b-worker-1', concurrency = 2, pollIntervalMs = 200,
  taskTimeoutMs = 120000, maxReclaims = 1, registryDir = null,
  cancellationsDir = null,
}) {
  if (!contract || !orchestrator) throw new Error('worker:缺少 contract/orchestrator');
  const active = new Map(); // taskRunId → record
  let running = false;
  let loopPromise = null;
  let eventCursor = 0; // outbox 拉取游标(registry 持久化)

  // ---- 运行登记(崩溃恢复入口;registryDir 落盘) ----
  async function loadRegistry() {
    if (!registryDir) return {};
    try {
      return JSON.parse(await fs.readFile(`${registryDir}/runs.json`, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw e;
    }
  }
  async function saveRegistry(reg) {
    if (!registryDir) return;
    await fs.mkdir(registryDir, { recursive: true });
    // 任务 03(崩溃恢复竞态修复):多 worker/恢复进程并发读改写 runs.json 会互相覆盖
    // (丢失状态机推进)。统一经跨进程文件锁串行化写侧;读侧无锁(原子写保证读到完整旧/新态)。
    const lock = await withFileLock({
      lockPath: `${registryDir}/registry.lock`,
      fn: () => atomicWriteJson(`${registryDir}/runs.json`, reg),
      timeoutMs: 8000,
    });
    if (!lock.ok) {
      throw Object.assign(new Error(`registry 写入未获得锁:${lock.blocked.code}(失败关闭,不带病写)`), { code: 'REGISTRY_LOCK_HELD' });
    }
  }
  async function registrySet(taskRunId, rec) {
    const reg = await loadRegistry();
    reg[taskRunId] = { ...(reg[taskRunId] ?? {}), ...rec };
    await saveRegistry(reg);
  }
  async function registryGetCursor() {
    const reg = await loadRegistry();
    return reg['#cursor'] === undefined ? null : Number(reg['#cursor']);
  }
  async function registrySetCursor(seq) {
    await registrySet('#cursor', { eventSeq: seq });
  }

  // ---- 单目标执行(一个 fencing 周期) ----
  async function executeCycle({ goalId, projectId, goalKey, params, role, purpose, assignment, goalVersion, reclaimLeft }) {
    // 周期标识:fencing token + claimedAt。A 侧 resume→重领可能复用相同 token(实测 1→1),
    // 只用 token 会让新旧周期碰撞同一 requestId(旧失败回执拦截新周期);claimedAt 每 claim 唯一,
    // 同周期内重放仍确定性同 id(幂等),跨周期必不同。
    const cycleTag = `${assignment.fencingToken}-${Date.parse(assignment.claimedAt ?? now())}`;
    const taskRunId = `${workerId}:${goalId}:c${cycleTag}`;
    const submitRequestId = `${taskRunId}::complete`;
    const rec = { goalId, fencingToken: assignment.fencingToken, startedAt: now(), leaseLost: false };
    active.set(taskRunId, rec);
    await registrySet(taskRunId, { status: 'running', goalId, fencingToken: assignment.fencingToken, startedAt: rec.startedAt, leaseUntil: assignment.leaseUntil, claimedAt: assignment.claimedAt ?? null });

    // 租约自检(A 无续期端点):到期即孤儿,停止写回;效果是否落库以 A 回执为准
    const leaseTimer = setInterval(() => {
      if (assignment.leaseUntil && Date.parse(assignment.leaseUntil) <= Date.now()) {
        rec.leaseLost = true;
        logger(`[lease-lost] ${taskRunId}:租约已到期 → 本 worker 停止写回,结果按 stale 处理`);
      }
    }, Math.max(1000, Math.min(5000, taskTimeoutMs / 4)));

    try {
      // 业务回执前置检查(恢复时节点重入必须检查业务回执):同 taskRun 完成回执已存在 → 零重复提交
      const priorReceipt = await contract.getExecutionReceipt(submitRequestId);
      if (priorReceipt) {
        logger(`[receipt-hit] ${taskRunId}:A 已有完成回执,跳过执行提交`);
        await registrySet(taskRunId, { status: 'already-submitted', at: now() });
        return { taskRunId, skipped: true, receipt: priorReceipt };
      }

      const task = { goalId, projectId, goalKey, params, role, purpose };
      const deadlineTimer = setTimeout(() => {
        orchestrator.cancel(taskRunId, `任务软超时(${taskTimeoutMs}ms),剩余未发送调用取消`).catch(() => {});
      }, taskTimeoutMs);

      let view;
      try {
        view = await orchestrator.start({ taskRunId, taskId: goalId, goalId, projectId, assignment, task });
      } finally {
        clearTimeout(deadlineTimer);
      }

      if (rec.leaseLost) {
        // 孤儿:结果按 stale 丢弃,不提交(写回会被 A fencing/lease 门拒绝)
        await registrySet(taskRunId, { status: 'discarded-lease-lost', outcomeState: view.terminal?.kind ?? view.state, at: now() });
        logger(`[orphan] ${taskRunId}:执行完成但租约已失,结果不提交(stale 丢弃)`);
        return { taskRunId, discarded: 'lease_lost', view };
      }

      const report = reportOutcome(view);

      // 需人工的终局:创建人工待办(幂等;B 不打断他人任务,本目标出口后由人工 resume)
      if (!report.completed && report.humanKind) {
        await contract.createHumanRequest({
          projectId, goalId, kind: report.humanKind, question: report.humanQuestion ?? report.failNote,
          requestedRole: role ?? 'business',
          requiredEvidenceKinds: [],
        }).catch((e) => logger(`[human-request-error] ${taskRunId}: ${e.code ?? ''} ${e.message}`));
      }

      const submit = report.completed
        ? await contract.completeGoal({
            goalId, requestId: submitRequestId, expectedVersion: goalVersion,
            fencingToken: assignment.fencingToken, result: report.result, now: now(),
          })
        : await contract.failGoal({
            goalId, requestId: submitRequestId, expectedVersion: goalVersion,
            fencingToken: assignment.fencingToken, note: report.failNote, now: now(),
          });

      if (!submit.ok) {
        // [§3.4/§6] STALE_FENCING_TOKEN/LEASE_EXPIRED = A 未记录效果,未执行可安全重试路径:
        // 仅当结果确定(非 unknown 语义)时,有界重领(新 token = A 授权的新执行周期)
        const unknownOutcome = !report.completed && view.terminal?.kind === 'unknown';
        if (['STALE_FENCING_TOKEN', 'LEASE_EXPIRED'].includes(submit.code) && !unknownOutcome && reclaimLeft > 0 && !rec.leaseLost) {
          logger(`[safe-retry] ${taskRunId}:${submit.code} → 有界重领(剩 ${reclaimLeft - 1} 次)`);
          await registrySet(taskRunId, { status: `reclaiming:${submit.code}`, at: now() });
          const re = await contract.claimGoal({ goalId, requestId: `claim:${goalId}:${workerId}:re${Date.now()}`, now: now() });
          if (re.ok) {
            return executeCycle({ goalId, projectId, goalKey, params, role, purpose, assignment: re.assignment, goalVersion: re.goalVersion, reclaimLeft: reclaimLeft - 1 });
          }
          logger(`[safe-retry-stop] ${taskRunId}:重领未成(${re.code}) → 留 A 队列/人工`);
        }
        await registrySet(taskRunId, { status: `rejected:${submit.code}`, at: now() });
        logger(`[submit-rejected] ${taskRunId}:${submit.code} → 丢弃(不当作未执行;效果以 A 回执为准)`);
        return { taskRunId, rejected: submit.code, view };
      }

      await registrySet(taskRunId, { status: submit.replayed ? 'submitted-replayed' : 'submitted', outcomeState: report.completed ? 'candidate_ready' : view.terminal?.kind, aGoalVersion: submit.goalVersion, at: now() });
      logger(`[submit] ${taskRunId} → ${report.completed ? `candidate_ready(provider=${report.result.provider})` : `fail(${view.terminal?.kind})`}${submit.replayed ? '(replayed 幂等)' : ''} goalVersion=${submit.goalVersion}`);
      return { taskRunId, submitted: true, replayed: submit.replayed, report, view };
    } finally {
      clearInterval(leaseTimer);
      active.delete(taskRunId);
    }
  }

  // ---- 单 run 恢复(由 recoverAll 在恢复锁内调用;返回 entry) ----
  async function recoverOne(taskRunId, meta, entry) {
    try {
      const recovered = await orchestrator.recover(taskRunId);
      if (!recovered) { entry.skipped = 'no-checkpoint'; return entry; }
      entry.recoveryNotes = recovered.recoveryNotes ?? [];
      entry.aSubmitReceipt = recovered.aSubmitReceipt ?? null;
      // 续跑(无 pending interrupt 时;有中断的 run 留给人工 resume,不自动续)
      if (recovered.state === 'running') {
        const cont = await orchestrator.continueRun(taskRunId);
        entry.afterContinue = cont.state;
        entry.finalView = cont;
      } else {
        entry.finalView = recovered;
      }
      const view = entry.finalView;
      const submitRequestId = `${taskRunId}::complete`;
      const prior = await contract.getExecutionReceipt(submitRequestId);
      if (prior) {
        entry.settled = 'already-submitted';
      } else if (view.terminal && meta.fencingToken) {
        const report = reportOutcome(view);
        await contract.createHumanRequest({
          projectId: view.projectId, goalId: view.goalId, kind: report.humanKind ?? 'clarification',
          question: report.humanQuestion ?? report.failNote,
          requestedRole: 'business',
          requiredEvidenceKinds: [],
        }).catch(() => {});
        if (view.terminal.kind === 'unknown') {
          // unknown:持牌待授权重试——不抢先 fail(否则 B 本地可信 retry_step 无法在 A 上收口,
          // 只能走 A resume 腿);clarification 待办已如实上报,goal 留在 leased 由人工决断:
          //   B CLI: B_RESUME_CREDENTIAL=cred:<id> resume <taskRunId> retry_step --step <stepId>
          //   A 腿:  A resume → GOAL_RESUMED → 常驻 worker 新周期执行
          entry.settled = 'held-unknown-for-retry';
          logger(`[recover] ${taskRunId}:unknown 持牌待授权重试(待办已建,goal 留 leased)`);
        } else {
          // expectedVersion 取当前目标版本(A 必填乐观版本;恢复窗口内被第三方改动则如实被拒)
          const gv = await contract.getGoalView?.(view.goalId).catch(() => null);
          const expectedVersion = gv?.version;
          const submit = report.completed
            ? await contract.completeGoal({ goalId: view.goalId, requestId: submitRequestId, expectedVersion, fencingToken: meta.fencingToken, result: report.result })
            : await contract.failGoal({ goalId: view.goalId, requestId: submitRequestId, expectedVersion, fencingToken: meta.fencingToken, note: report.failNote });
          entry.settled = submit.ok ? (submit.replayed ? 'submitted-replayed' : 'submitted') : `rejected:${submit.code}`;
        }
      } else {
        entry.settled = 'left-for-human';
      }
      await registrySet(taskRunId, { status: `recovered:${entry.settled}`, at: now() });
    } catch (e) {
      entry.error = `${e.code ?? ''} ${e.message}`;
    }
    return entry;
  }

  // ---- 主循环 ----
  // 跨进程取消通道:CLI/运维在 ${dataDir}/cancellations/<goalId>.flag 放标志,worker 每 tick
  // 消费(对活动 taskRunId 调 orchestrator.cancel → 步边界生效)后删除标志。
  async function processCancellations() {
    const dir = cancellationsDir;
    if (!dir) return;
    let flags;
    try { flags = await fs.readdir(dir); } catch { return; }
    for (const f of flags) {
      if (!f.endsWith('.flag')) continue;
      const goalId = decodeURIComponent(f.slice(0, -'.flag'.length));
      for (const taskRunId of [...active.keys()]) {
        if (taskRunId.includes(`:${goalId}:`)) {
          try {
            const r = await orchestrator.cancel(taskRunId, '人工取消(CLI 标志)');
            logger(`[cancel-flag] ${taskRunId}: ${r.ok ? '已请求(步边界生效)' : `不适用(cancelApplied=false)`}`);
          } catch (e) {
            logger(`[cancel-flag-error] ${taskRunId}: ${e.code ?? ''} ${e.message}`);
          }
        }
      }
      await fs.rm(`${dir}/${f}`, { force: true }).catch(() => {});
    }
  }

  async function loop() {
    eventCursor = await registryGetCursor();
    // 首跑游标 = 当前事件头(对齐 A 订阅语义"只接收注册之后产生的事件";不回放历史目标)
    if (eventCursor === null) {
      eventCursor = (await contract.getEventHead?.().catch(() => ({ seq: 0 })) ?? { seq: 0 }).seq;
      await registrySetCursor(eventCursor);
      logger(`[worker] ${workerId} 首跑:事件游标快进到头 ${eventCursor}`);
    }
    while (running) {
      try {
        await processCancellations();
        if (active.size < concurrency) {
          const claim = await contract.pollWork({ workerId, afterSeq: eventCursor, now: now() });
          if (claim?.ok) {
            if (typeof claim.cursor === 'number') { eventCursor = claim.cursor; await registrySetCursor(eventCursor); }
            const taskRunId = `${workerId}:${claim.task.goalId}:c${claim.assignment.fencingToken}-${Date.parse(claim.assignment.claimedAt ?? now())}`;
            const p = executeCycle({
              goalId: claim.task.goalId, projectId: claim.task.projectId, goalKey: claim.task.goalKey,
              params: claim.task.params, role: claim.task.role, purpose: claim.task.purpose,
              assignment: claim.assignment, goalVersion: claim.goalVersion,
              reclaimLeft: maxReclaims,
            }).catch((e) => logger(`[run-error] ${claim.task.goalId}: ${e.code ?? ''} ${e.message}`));
            active.set(taskRunId, { placeholder: true, promise: p });
            p.finally(() => active.delete(taskRunId));
            continue; // 立即尝试填满并发槽
          }
          if (typeof claim?.cursor === 'number') { eventCursor = claim.cursor; await registrySetCursor(eventCursor); }
        }
      } catch (e) {
        logger(`[poll-error] ${e.code ?? ''} ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  return {
    workerId,
    activeCount() { return active.size; },
    async startLoop() {
      if (running) return;
      running = true;
      loopPromise = loop();
      logger(`[worker] ${workerId} 启动:concurrency=${concurrency},timeout=${taskTimeoutMs}ms,maxReclaims=${maxReclaims}`);
    },
    async stopLoop() {
      running = false;
      if (loopPromise) await loopPromise.catch(() => {});
      const pending = [...active.values()].map((a) => a.promise).filter(Boolean);
      await Promise.allSettled(pending);
      logger(`[worker] ${workerId} 停止`);
    },
    /** 崩溃恢复:列出 registry 中未正常收尾的 run,逐一 recover + 对账 + 续跑 + 补提交。
     *  任务 03(恢复竞态修复):每 run 取恢复锁(recover-locks/<id>.lock,pid 存活探测),
     *  两个恢复进程并发 recover 同一 run 时后到者跳过(recover-locked),不重复续跑/重复提交;
     *  A 侧 requestId 幂等仍是第二道防线。 */
    async recoverAll() {
      const reg = await loadRegistry();
      const results = [];
      for (const [taskRunId, meta] of Object.entries(reg)) {
        if (taskRunId === '#cursor') continue;
        if (['submitted', 'submitted-replayed', 'already-submitted', 'discarded-lease-lost'].some((s) => meta.status?.startsWith(s))) continue;
        const entry = { taskRunId, priorStatus: meta.status };
        const lockDir = `${registryDir ?? ''}/recover-locks`;
        if (registryDir) await fs.mkdir(lockDir, { recursive: true }).catch(() => {});
        const lock = registryDir
          ? await withFileLock({
            lockPath: `${lockDir}/${encodeURIComponent(taskRunId)}.lock`,
            fn: () => recoverOne(taskRunId, meta, entry),
            timeoutMs: 15000,
          })
          : { ok: true, value: await recoverOne(taskRunId, meta, entry) };
        if (!lock.ok) {
          entry.settled = `recover-locked:${lock.blocked.code}`;
          entry.note = '另一进程正恢复本 run(活锁不抢):跳过,避免重复续跑/重复提交';
          results.push(entry);
          continue;
        }
        results.push(lock.value);
      }
      return results;
    },
    /** 手动投递(测试/CLI):绕过队列直接执行一个 assignment。 */
    async executeNow(task, assignment, { goalVersion, reclaimLeft = maxReclaims } = {}) {
      return executeCycle({
        goalId: task.goalId, projectId: task.projectId, goalKey: task.goalKey, params: task.params,
        role: task.role, purpose: task.purpose,
        assignment, goalVersion, reclaimLeft,
      });
    },
  };
}

/**
 * DEF-03 修复:人工授权 resume(D-9)重跑后的 A 收口。
 * CLI `resume` 在图内完成授权重试(新 attempt/requestId,恰一次重发)后调用本函数把终局
 * 提交回 A:complete→candidate_ready / fail→诚实上报。
 * - fencing 刷新:goal 仍 leased 但租约已过期 → claimGoal 重领(A 授权的新周期)后用新 token 提交;
 *   提交 requestId 带 retry 序号(`${taskRunId}::complete:rN`,N=humanActions 数),与恢复期
 *   `::complete` 及后续再授权互不碰撞。
 * - goal 已 failed(A 状态门)→ 不跨门:返回 needs-a-resume 指引走 A resume 腿(零额外调用)。
 * 幂等:同周期重放同 requestId → replayed;重复授权在 D-9/状态门拒绝,零额外调用。
 */
export async function settleAfterResume({ contract, registryDir, taskRunId, view, logger = () => {}, now = () => new Date().toISOString() }) {
  if (!view?.terminal) return { settled: 'still-running', view };
  let meta = null;
  if (registryDir) {
    try {
      const reg = JSON.parse(await fs.readFile(`${registryDir}/runs.json`, 'utf8'));
      meta = reg[taskRunId] ?? null;
    } catch { meta = null; }
  }
  if (!meta?.fencingToken) return { settled: 'no-assignment', view };
  const report = reportOutcome(view);
  const gv = await contract.getGoalView?.(view.goalId).catch(() => null);
  if (gv?.status === 'failed') {
    return {
      settled: 'needs-a-resume', view,
      guidance: 'goal 在 A 侧已是 failed:B 本地 retry 不跨 A 状态门;请以 business 人工凭据走 A resume(HumanRequest 链),goal→ready 后常驻 worker 自动新周期执行',
    };
  }
  // 本次授权重试是第 N 次 humanAction(首次重试 N=1 → r1;再次授权 → r2,互不碰撞)
  const retrySeq = Math.max(1, view.humanActions?.length ?? 1);
  const requestId = `${taskRunId}::complete:r${retrySeq}`;
  const expectedVersion = gv?.version;
  const attemptSettle = (fencingToken) => report.completed
    ? contract.completeGoal({ goalId: view.goalId, requestId, expectedVersion, fencingToken, result: report.result, now: now() })
    : contract.failGoal({ goalId: view.goalId, requestId, expectedVersion, fencingToken, note: report.failNote, now: now() });
  let submit = await attemptSettle(meta.fencingToken);
  if (!submit.ok && ['LEASE_EXPIRED', 'STALE_FENCING_TOKEN'].includes(submit.code)) {
    const re = await contract.claimGoal({ goalId: view.goalId, requestId: `claim:${view.goalId}:resume-retry:${Date.now()}`, now: now() });
    if (re.ok) submit = await attemptSettle(re.assignment.fencingToken);
    else submit = { ok: false, code: `reclaim:${re.code}` };
  }
  if (registryDir) {
    try {
      const reg = JSON.parse(await fs.readFile(`${registryDir}/runs.json`, 'utf8'));
      reg[taskRunId] = { ...(reg[taskRunId] ?? {}), status: submit.ok ? (submit.replayed ? 'submitted-after-resume(replayed)' : 'submitted-after-resume') : `rejected-after-resume:${submit.code}`, at: now() };
      await fs.mkdir(registryDir, { recursive: true });
      await atomicWriteJson(`${registryDir}/runs.json`, reg);
    } catch { /* 登记失败不影响收口结果 */ }
  }
  logger(`[resume-settle] ${taskRunId} → ${submit.ok ? (report.completed ? 'candidate_ready(已提交 A)' : 'failed(已上报 A)') : submit.code}`);
  return { settled: submit.ok ? (submit.replayed ? 'submitted-replayed' : 'submitted') : `rejected:${submit.code}`, submit, view };
}
