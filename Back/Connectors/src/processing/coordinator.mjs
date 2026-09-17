// goal-02 · 资料处理与尽调执行协调器（服务级主入口装配；B1/B2/B3 汇聚点）。
// 硬边界（任务书 §二/§三/§四/§五）：
// - 传输/解压/解析/分析/核验进度分开持久化（processing_tasks.stage_cursor + processing_stage_runs）；
//   下载 100% ≠ 解析完成；HTTP 200 只证明传输完成。
// - 同一有效材料版本不重复解析：parse_results 键=租户+客户+sha256+解析器版本（不跨客户共用）；
//   重复工件（duplicate_of）不重跑事实与分析。
// - 局部变化只触发必要重算：B recalc-planner 事件×依赖映射决定受影响域；域结果按
//   (租户,客户,域,inputHash,规则版本) 缓存复用；结果绑定原件引用+感知水位+规则版本；
//   无条件全量重跑被结构禁止（重算必有 because 原因）。
// - 任务持久状态、有限重试、租约认领（FOR UPDATE SKIP LOCKED）、并发与客户级窗口预算；
//   绝不只记进程内"已处理"。
// - 外部请求（A 登记）已发送但结果未知 → 阶段状态 unknown，任务 blocked_unknown，先对账
//   （同 requestId 幂等重放/回执查询），绝不换 ID 重试。
// - 问题准备：C 提问计划 → B question-arbiter 去重（对象|期间|目的|受众|回答权限）+排序+分级；
//   默认 outboundPolicy=suggest_only（只建议零外发）；显式 auto_whitelist 才对白名单目的走
//   send（clientMsgId=question_key 幂等）；敏感类恒 human_gate；无活动通话的语音问题一律排队。
// - answered ≠ 材料取得 ≠ 人工核验：问题状态机三段分离，verified 只能由人工 verify 端点产生。
// - 成本：估算与实际分离；模型调用=0（确定性管线）如实记录；真实账单未接入=actual.billKnown
//   false（未知，不记 0）。
// - 预审产物全部为候选（authority=none），不是正式授信语义；正式收口属 A 内核。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArtifactBytes, parseCacheKey, PARSE_ADAPTERS_VERSION } from '../../../C/src/parse/adapters.mjs';
import { perceptionStage, assessStage, finalizeStage, effectiveRulePack } from '../../../C/domains/pipeline.mjs';
import { planRecalc, isResultCurrent, DEFAULT_DEPENDENCY_MAP } from '../../../B/src/schedule/recalc-planner.mjs';
import { bindQuestions, planDispatch, classifyOutboundTier } from '../../../B/src/schedule/question-arbiter.mjs';
import { extractZip } from '../evidence/zipguard.mjs';
import { audit } from '../wecom/consent.mjs';
import { ConnError } from '../errors.mjs';
import { newId, sha256Hex } from '../ids.mjs';

export const COORDINATOR_VERSION = 'processing-coordinator@1';
const DOMAINS = ['policy', 'credit', 'commerce', 'asset'];
const LEVEL_RANK = ['unknown', 'declared', 'source_supported', 'verified'];

/** 规则包消费的全部事实键（requiredFacts + 条件 fact）——规则评估输入，policy/credit/asset 依赖。 */
function extractPackFactRefs(pack) {
  const s = new Set();
  const collectCond = (c) => {
    if (!c || typeof c !== 'object') return;
    if (Array.isArray(c.allOf)) { c.allOf.forEach(collectCond); return; }
    if (typeof c.fact === 'string') s.add(c.fact);
  };
  for (const r of pack.rules ?? []) {
    for (const f of r.requiredFacts ?? []) s.add(f.factKey);
    collectCond(r.condition);
  }
  return s;
}

/** 域消费面：映射键（声明依赖）∪ 规则评估键（消费 ruleEvaluation 的域）。 */
function consumedFactsFor(domain, packRefs) {
  const mapped = Object.entries(DEFAULT_DEPENDENCY_MAP.byFactKey)
    .filter(([, ds]) => ds.includes(domain)).map(([k]) => k);
  const ruleConsumers = ['policy', 'credit', 'asset'];
  return new Set([...mapped, ...(ruleConsumers.includes(domain) ? [...packRefs] : [])]);
}

export const PROCESSING_VERSION = 'processing-v1';

const DEFAULT_RULE_PACK_PATH = new URL('../../../C/rules/four-domain-rule-pack-v1.json', import.meta.url);

/** 进件真实 kind → recalc 证据 kind（B 依赖映射消费的词汇）。 */
function evidenceKindOf(kind) {
  const known = ['statement', 'tax_filing', 'sales_purchase', 'accounting_ledger', 'equipment_contract', 'site_evidence', 'document', 'transcript', 'message', 'device_observation', 'image', 'video', 'audio'];
  return known.includes(kind) ? kind : 'document';
}

function hash16(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function nowIso() { return new Date().toISOString(); }

export function loadDefaultRulePack() {
  return JSON.parse(readFileSync(DEFAULT_RULE_PACK_PATH, 'utf8'));
}

export function makeProcessingCoordinator(store, evidence, {
  objectStore, rulePack = null, aRegister = null, sendService = null, config = {},
} = {}) {
  const pack = rulePack ?? loadDefaultRulePack();
  const packOk = effectiveRulePack(pack);
  if (!packOk.ok) throw Object.assign(new Error(`规则包非法：${packOk.problems?.join(';')}`), { code: 'RULE_PACK_INVALID' });
  const rulesetVersion = String(pack.version);
  const packFactRefs = extractPackFactRefs(pack);

  /** 域消费面签名：该域实际消费的事实键状态（取值+等级+口径）+不可读/冲突结构。
   *  签名不变 ⇒ 该域评估结论不变；是否复用还须“参与材料一致”（见 stageAnalyze）——
   *  值相同但来源件更替时保守重算并记原因，不冒充复用。 */
  function domainSignature(snapshot, domain) {
    const keys = consumedFactsFor(domain, packFactRefs);
    const state = snapshot.items
      .filter((it) => keys.has(it.factKey))
      .map((it) => [it.factKey, String(it.value), it.verificationLevel, it.caliber ?? null])
      .sort();
    return hash16({
      d: domain, state,
      unreadable: snapshot.unreadable.length,
      conflictKeys: snapshot.conflicts.filter((c) => keys.has(c.factKey)).length,
      ruleset: rulesetVersion,
    });
  }

  /** 该域消费面的参与材料（值签名相同但来源件更替 → 不复用，保守重算）。 */
  function contributingMaterials(snapshot, domain) {
    const keys = consumedFactsFor(domain, packFactRefs);
    return [...new Set(snapshot.items.filter((it) => keys.has(it.factKey)).map((it) => it.materialId))].sort();
  }

  const cfg = {
    strategy: 'selective',                    // selective（默认：去重+选择性重算）| naive_full（现状基线形态：每件全解析+全域重算，仅用于对照测量）
    concurrency: 2,
    maxAttempts: 3,
    leaseSec: 120,
    maxZipDepth: 2,
    outboundPolicy: 'suggest_only',          // suggest_only（默认，只建议零外发）| auto_whitelist
    maxTasksPerCustomerPerHour: null,        // null=不设窗口上限
    aTimeoutMs: 5000,
    aProjectByCustomer: {},
    maxStoredTextBytes: 65536,
    // 交易适用面声明（simulation 输入；规则 scope 按此判定适用性，缺失=applicability_unknown）：
    // 生产环境须来自商机/产品登记，不由材料解析推断。
    transaction: { orgType: 'commercial_leasing', region: '*', product: 'direct_lease', customerRange: 'standard' },
    workerId: `proc-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    ...config,
  };

  let driverTimer = null;
  let driving = false;

  // ---------- 登记 → 入队 ----------

  /** 上传登记后调用（幂等）：同证据只会有一个处理任务。 */
  async function enqueueArtifact({ tenantId, customerId, evidenceId, kind, depth = 0 }) {
    if (!tenantId || !customerId || !evidenceId || !kind) throw new ConnError('INVALID_INPUT', 'enqueueArtifact: tenantId/customerId/evidenceId/kind required');
    const taskId = `ptk-${hash16({ tenantId, evidenceId })}`;
    const r = await store.query(
      `INSERT INTO processing_tasks (task_id, tenant_id, customer_id, evidence_id, kind, depth, stage_cursor)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, evidence_id) DO NOTHING
       RETURNING task_id`,
      [taskId, tenantId, customerId, evidenceId, kind, depth, depth > 0 ? 'parse' : 'unzip'],
    );
    await recordCost({ tenantId, customerId, taskId, stage: 'enqueue', estimate: { modelCalls: 0, estMs: 0, estBytes: 0 } });
    return { taskId, existed: r.rows.length === 0 };
  }

  async function getTask({ tenantId, taskId }) {
    const t = (await store.query(`SELECT * FROM processing_tasks WHERE tenant_id=$1 AND task_id=$2`, [tenantId, taskId])).rows[0];
    if (!t) return null;
    const stages = (await store.query(
      `SELECT stage, status, attempt, detail, started_at, finished_at FROM processing_stage_runs WHERE task_id=$1 ORDER BY id`,
      [taskId],
    )).rows;
    return { ...t, stages };
  }

  async function statusForCustomer({ tenantId, customerId }) {
    const tasks = (await store.query(
      `SELECT task_id, evidence_id, kind, status, stage_cursor, attempts, failure_code, note, created_at, updated_at
       FROM processing_tasks WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`,
      [tenantId, customerId],
    )).rows;
    const questions = (await store.query(
      `SELECT question_key, tier, status, binding, stop_condition, target_fact, note, updated_at
       FROM prepared_questions WHERE tenant_id=$1 AND customer_id=$2 ORDER BY first_seen_at`,
      [tenantId, customerId],
    )).rows;
    const pause = await getPauseState({ tenantId, customerId });
    return { tasks, questions, pause, coordinatorVersion: COORDINATOR_VERSION, rulesetVersion };
  }

  // ---------- 阶段留痕/游标 ----------

  async function recordStage(task, stage, status, detail = {}) {
    await store.query(
      `INSERT INTO processing_stage_runs (tenant_id, task_id, stage, status, attempt, detail, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (task_id, stage, attempt) DO NOTHING`,
      [task.tenant_id, task.task_id, stage, status, task.attempts, JSON.stringify(detail).slice(0, 8000)],
    );
    await store.query(`UPDATE processing_tasks SET updated_at=now() WHERE task_id=$1`, [task.task_id]);
  }

  async function moveCursor(task, cursor) {
    await store.query(`UPDATE processing_tasks SET stage_cursor=$3, updated_at=now() WHERE task_id=$1 AND tenant_id=$2`, [task.task_id, task.tenant_id, cursor]);
  }

  async function finishTask(task, status, { failureCode = null, note = null, lastError = null } = {}) {
    await store.query(
      `UPDATE processing_tasks SET status=$3, stage_cursor='done', failure_code=$4, note=$5, last_error=$6, leased_until=NULL, leased_by=NULL, updated_at=now()
       WHERE task_id=$1 AND tenant_id=$2`,
      [task.task_id, task.tenant_id, status, failureCode, note, lastError],
    );
  }

  async function recordCost({ tenantId, customerId, taskId, stage, estimate, actual = null }) {
    await store.query(
      `INSERT INTO processing_costs (tenant_id, customer_id, task_id, stage, estimate, actual)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, customerId, taskId, stage, JSON.stringify({ modelCalls: 0, ...estimate }), actual ?? JSON.stringify({ modelCalls: 0, costAmount: null, billKnown: false, note: '真实账单未接入：实际费用未知，不记 0' })],
    );
  }

  // ---------- 暂停旗标 ----------

  async function setPause({ tenantId, customerId = null, paused, actor = 'api' }) {
    const key = customerId ? `customer:${tenantId}:${customerId}` : `tenant:${tenantId}`;
    await store.query(
      `INSERT INTO processing_flags (flag_key, paused, dispatch_generation, updated_at)
       VALUES ($1,$2,CASE WHEN $2 THEN 1 ELSE 0 END, now())
       ON CONFLICT (flag_key) DO UPDATE SET
         paused=$2,
         dispatch_generation=CASE WHEN $2 THEN processing_flags.dispatch_generation+1 ELSE processing_flags.dispatch_generation END,
         updated_at=now()`,
      [key, paused === true],
    );
    await audit(store, { tenantId, actor, action: 'PROCESSING_PAUSE_CHANGED', targetType: 'processing_flag', targetId: key, summary: `paused=${paused === true}` });
    return { ok: true, key, paused: paused === true };
  }

  async function getPauseState({ tenantId, customerId = null }) {
    const keys = customerId ? [`tenant:${tenantId}`, `customer:${tenantId}:${customerId}`] : [`tenant:${tenantId}`];
    const rows = (await store.query(`SELECT flag_key, paused, dispatch_generation FROM processing_flags WHERE flag_key = ANY($1)`, [keys])).rows;
    const tenant = rows.find((r) => r.flag_key === `tenant:${tenantId}`);
    const cust = customerId ? rows.find((r) => r.flag_key === `customer:${tenantId}:${customerId}`) : null;
    return {
      outboundPaused: (tenant?.paused === true) || (cust?.paused === true),
      dispatchGeneration: Math.max(tenant?.dispatch_generation ?? 0, cust?.dispatch_generation ?? 0),
    };
  }

  // ---------- STAGE：unzip ----------

  async function artifactRow(tenantId, evidenceId) {
    return (await store.query(`SELECT * FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`, [tenantId, evidenceId])).rows[0];
  }

  async function stageUnzip(task) {
    const art = await artifactRow(task.tenant_id, task.evidence_id);
    if (!art) { await finishTask(task, 'failed', { failureCode: 'ARTIFACT_MISSING', lastError: '登记行缺失' }); return null; }
    if (!art.object_ref) { await recordStage(task, 'unzip', 'skipped', { reason: 'no_object_ref' }); await moveCursor(task, 'parse'); return true; }
    const bytes = await objectStore.get(art.object_ref);
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
    if (!isZip) { await recordStage(task, 'unzip', 'skipped', { reason: 'not_zip' }); await moveCursor(task, 'parse'); return true; }
    if (task.depth >= cfg.maxZipDepth) {
      await recordStage(task, 'unzip', 'needs_followup', { reason: 'depth_over_limit', depth: task.depth });
      await finishTask(task, 'needs_followup', { failureCode: 'ZIP_DEPTH_OVER_LIMIT', note: '嵌套容器超过处理深度：转人工，不解析' });
      return null;
    }
    const children = [];
    try {
      await extractZip(bytes, {
        onEntry: async ({ name, data }) => {
          const childRef = newId('up');
          const put = await objectStore.put(childRef, data, { tenantId: task.tenant_id, contentType: 'application/octet-stream' });
          const nestedZip = data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03;
          const reg = await evidence.registerArtifact({
            tenantId: task.tenant_id, customerId: task.customer_id,
            sourceProvider: 'zip_entry', kind: art.kind,
            objectRef: childRef, sha256: put.sha256,
            sourceGroup: art.source_group, derivedFrom: task.evidence_id,
            capturedAt: art.captured_at, periodFrom: art.period_from, periodTo: art.period_to,
            currency: art.currency, unit: art.unit, caliber: art.caliber,
            uploaderRef: art.uploader_ref, uploadSource: art.upload_source ?? 'customer_upload',
            objectRefs: art.object_refs ?? [],
            completeness: 'complete', readable: true,
            sourceMode: art.source_mode ?? 'real',
          });
          await enqueueArtifact({ tenantId: task.tenant_id, customerId: task.customer_id, evidenceId: reg.evidenceId, kind: art.kind, depth: task.depth + 1 });
          children.push({ name, evidenceId: reg.evidenceId, nestedZip });
        },
      });
    } catch (e) {
      await recordStage(task, 'unzip', 'failed', { code: e.code ?? 'ZIP_ERROR', message: String(e.message).slice(0, 200) });
      await finishTask(task, 'failed', { failureCode: e.code ?? 'ZIP_ERROR', lastError: String(e.message).slice(0, 200) });
      return null;
    }
    await recordStage(task, 'unzip', 'done', { dispatched: children.length, children });
    // 容器本体不再解析（无自身内容语义）：完成，后续由派生任务推进
    await finishTask(task, 'done', { note: `container: dispatched ${children.length} entries（下载≠解析：逐 entry 各自推进）` });
    return null;
  }

  // ---------- STAGE：parse（含缓存去重） ----------

  async function stageParse(task) {
    const art = await artifactRow(task.tenant_id, task.evidence_id);
    if (!art) { await finishTask(task, 'failed', { failureCode: 'ARTIFACT_MISSING' }); return null; }
    if (art.completeness !== 'complete') {
      await recordStage(task, 'parse', 'needs_followup', { completeness: art.completeness });
      await finishTask(task, 'needs_followup', { failureCode: 'MATERIAL_INCOMPLETE', note: '待补材料不解析、不编数（补齐重传后走新件）' });
      return null;
    }
    const naive = cfg.strategy === 'naive_full';
    if (art.duplicate_of && !naive) {
      await recordStage(task, 'parse', 'skipped_duplicate', { duplicateOf: art.duplicate_of, sameSourceFlag: art.same_source_flag });
      await finishTask(task, 'skipped_duplicate', { note: `重复材料：与 ${art.duplicate_of} 同字节/同源，不重复处理` });
      return null;
    }
    const parserVersion = PARSE_ADAPTERS_VERSION;
    const parseKey = parseCacheKey({ tenantId: task.tenant_id, customerId: task.customer_id, sha256: art.sha256 ?? task.evidence_id, parserVersion });
    const hit = naive ? null : (await store.query(`SELECT result, format, ok FROM parse_results WHERE parse_key=$1`, [parseKey])).rows[0];
    if (hit) {
      await recordStage(task, 'parse', 'skipped_duplicate', { parseKey, format: hit.format, cached: true });
      await moveCursor(task, 'facts');
      return { fromCache: true, ...hit.result };
    }
    const bytes = art.object_ref ? await objectStore.get(art.object_ref) : Buffer.alloc(0);
    const meta = {
      fileName: art.object_ref ?? '', contentType: '', periodFrom: art.period_from, periodTo: art.period_to,
      currency: art.currency, unit: art.unit, caliber: art.caliber,
    };
    const r = parseArtifactBytes(bytes, meta);
    // naive_full 基线也落库解析结果（材料集 join 需要），但从不读它复用——不重用即基线
    await store.query(
      `INSERT INTO parse_results (parse_key, tenant_id, customer_id, sha256, parser_version, format, ok, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (parse_key) DO NOTHING`,
      [parseKey, task.tenant_id, task.customer_id, art.sha256 ?? task.evidence_id, parserVersion, r.format ?? r.code ?? null, r.ok === true,
       JSON.stringify({ ...r, text: r.text != null ? String(r.text).slice(0, cfg.maxStoredTextBytes) : undefined, rows: r.rows != null ? r.rows.slice(0, 5000) : undefined })],
    );
    if (!r.ok) {
      const manual = r.manualEntry === true;
      await recordStage(task, 'parse', 'needs_followup', { code: r.code, detail: r.detail, manualEntry: manual });
      await finishTask(task, 'needs_followup', {
        failureCode: r.code,
        note: manual ? `${r.detail}：转人工入口（如实不支持，不推断内容）` : r.detail,
      });
      await enqueueManualEntryQuestion(task, r.code, r.detail);
      return null;
    }
    await recordStage(task, 'parse', 'done', { format: r.format, parserVersion: r.parserVersion, parseKey, facts: r.declaredFacts?.length ?? 0, qualityFlags: r.qualityFlags ?? [] });
    await moveCursor(task, 'facts');
    return r;
  }

  async function enqueueManualEntryQuestion(task, code, detail) {
    const binding = {
      questionKey: `qk-${hash16({ object: task.evidence_id, period: null, purpose: 'manual_entry_required', audience: 'internal', permission: 'internal' })}`,
      dedupKey: [task.evidence_id, '*', 'manual_entry_required', 'internal', 'internal'].join('|'),
      questionId: `q-manual-${task.evidence_id}`,
      sessionId: 'processing', customerId: task.customer_id,
      objectRef: task.evidence_id, objectRefKind: 'objectId', period: null,
      purpose: 'manual_entry_required', audience: 'internal', targetAnswerer: null,
      requiredEvidence: { kind: 'document', note: String(detail ?? '').slice(0, 200) },
      answerPermission: 'internal', basisVersion: null, priority: 'high', mode: 'thread',
      mergedFrom: [], domainSources: ['processing'],
    };
    await upsertQuestion(task.tenant_id, task.customer_id, binding, 'human_gate', 'needs_human', null,
      `${code}：解析白名单外/失败，转人工（materials 仍可人工核验登记）`);
  }

  // ---------- STAGE：facts（观测+事实候选，幂等） ----------

  async function stageFacts(task, parseResult) {
    if (!parseResult || parseResult.ok !== true) {
      await recordStage(task, 'facts', 'skipped', { reason: 'parse_not_ok' });
      await moveCursor(task, 'analyze');
      return true;
    }
    const art = await artifactRow(task.tenant_id, task.evidence_id);
    // 观测（幂等）：同 segment 同内容不重复追加修订
    const segmentId = `parse:${task.evidence_id}`;
    const text = String(parseResult.text ?? '').slice(0, cfg.maxStoredTextBytes);
    const textHash = sha256Hex(text);
    const existing = (await store.query(
      `SELECT observation_id, text FROM evidence_observations WHERE tenant_id=$1 AND segment_id=$2 AND superseded_by IS NULL ORDER BY revision DESC LIMIT 1`,
      [task.tenant_id, segmentId],
    )).rows[0];
    if (!existing) {
      await evidence.addObservation({
        tenantId: task.tenant_id, artifactId: task.evidence_id, obsKind: 'parse_extraction',
        segmentId, state: 'final', text, quality: (parseResult.qualityFlags ?? []).map((f) => f.flag ?? f),
      });
    } else if (sha256Hex(existing.text) !== textHash) {
      await evidence.addObservation({
        tenantId: task.tenant_id, artifactId: task.evidence_id, obsKind: 'parse_extraction',
        segmentId, state: 'final', text, quality: (parseResult.qualityFlags ?? []).map((f) => f.flag ?? f),
      });
    }
    // 事实候选：确定性 fact id（内容键）→ 重放零新增
    const anchor = Array.isArray(art?.object_refs) && art.object_refs.length > 0 ? art.object_refs[0] : null;
    let inserted = 0; let existedCount = 0;
    for (const f of parseResult.declaredFacts ?? []) {
      const periodFrom = f.periodFrom ?? art?.period_from ?? null;
      const periodTo = f.periodTo ?? art?.period_to ?? null;
      const contentKey = sha256Hex(JSON.stringify({
        t: task.tenant_id, c: task.customer_id, s: anchor ?? `customer:${task.customer_id}`,
        p: f.factKey, v: f.value, u: f.unit ?? null, pf: periodFrom, pt: periodTo, src: task.evidence_id,
      }));
      const res = await evidence.assertFact({
        tenantId: task.tenant_id, customerId: task.customer_id,
        contentKey,
        subject: anchor ?? `customer:${task.customer_id}`, predicate: f.factKey,
        objectValue: f.value, unit: f.unit ?? null,
        fromArtifacts: [task.evidence_id],
        objectRef: anchor, periodFrom, periodTo,
        sourceMode: 'real',
      });
      if (res.existed) existedCount += 1; else inserted += 1;
    }
    await recordStage(task, 'facts', 'done', { observations: existing ? 'reused' : 'appended', factsInserted: inserted, factsExisted: existedCount });
    await recordCost({ tenantId: task.tenant_id, customerId: task.customer_id, taskId: task.task_id, stage: 'facts', estimate: { modelCalls: 0, estMs: 1, estBytes: Buffer.byteLength(text) } });
    await moveCursor(task, 'analyze');
    return true;
  }

  // ---------- STAGE：analyze（感知一次+选择性域重算+收口缓存） ----------

  async function currentMaterials(tenantId, customerId) {
    const rows = (await store.query(
      `SELECT a.evidence_id, a.kind, a.period_from, a.period_to, a.currency, a.unit, a.caliber, a.object_refs, pr.result
       FROM evidence_artifacts a
       JOIN parse_results pr ON pr.tenant_id=a.tenant_id AND pr.customer_id=a.customer_id AND pr.sha256=a.sha256 AND pr.ok
       WHERE a.tenant_id=$1 AND a.customer_id=$2 AND a.completeness='complete' AND a.superseded_by IS NULL
       ORDER BY a.created_at`,
      [tenantId, customerId],
    )).rows;
    return rows;
  }

  function toPerceptionMaterials(rows) {
    return rows.map((r) => {
      const pr = r.result ?? {};
      return {
        materialId: r.evidence_id,
        kind: 'document',
        content: String(pr.text ?? '').slice(0, cfg.maxStoredTextBytes) || `(无文本内容 ${r.evidence_id})`,
        version: 1,
        declaredFacts: (pr.declaredFacts ?? []).map((f) => ({
          factKey: f.factKey, value: f.value, verificationLevel: f.verificationLevel,
          unit: f.unit ?? null, caliber: f.caliber ?? null,
        })),
        // location 必须含 page/field/timeSpan 之一（C schema：发现定位强制）
        sourceRef: { channel: 'customer_upload', uri: String(r.evidence_id), field: String(pr.format ?? 'parse_extraction') },
      };
    });
  }

  async function latestFin(tenantId, customerId) {
    return (await store.query(
      `SELECT * FROM analysis_finalizations WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, customerId],
    )).rows[0] ?? null;
  }

  async function stageAnalyze(task) {
    const art = await artifactRow(task.tenant_id, task.evidence_id);
    // naive_full 基线：重复件也全量重算（不因 duplicate_of 跳过）；selective 只算唯一内容
    if (!art || (art.duplicate_of && cfg.strategy !== 'naive_full')) {
      await recordStage(task, 'analyze', 'skipped', { reason: 'duplicate_or_missing' });
      await moveCursor(task, 'questions');
      return true;
    }
    const myParse = (await store.query(
      `SELECT 1 FROM parse_results pr JOIN evidence_artifacts a ON a.tenant_id=pr.tenant_id AND a.sha256=pr.sha256
       WHERE pr.tenant_id=$1 AND pr.customer_id=$2 AND a.evidence_id=$3 AND pr.ok`,
      [task.tenant_id, task.customer_id, task.evidence_id],
    )).rows[0];
    if (!myParse) {
      await recordStage(task, 'analyze', 'skipped', { reason: 'no_parse_output' });
      await moveCursor(task, 'questions');
      return true;
    }
    const started = Date.now();
    const rows = await currentMaterials(task.tenant_id, task.customer_id);
    if (rows.length === 0) {
      await recordStage(task, 'analyze', 'skipped', { reason: 'no_materials' });
      await moveCursor(task, 'questions');
      return true;
    }
    const materials = toPerceptionMaterials(rows);
    const ps = perceptionStage({ tenantId: task.tenant_id, customerId: task.customer_id, materials, rulePack: pack });
    if (!ps.ok) {
      await recordStage(task, 'analyze', 'failed', { stage: ps.stage, problems: ps.problems });
      await finishTask(task, 'failed', { failureCode: 'PERCEPTION_INVALID', lastError: JSON.stringify(ps.problems ?? []).slice(0, 200) });
      return null;
    }
    const snapshot = ps.snapshot;

    // 选择性重算规划：本任务的事件（新证据 kind + 本件产出的事实键）→ 受影响域
    const myFacts = (rows.find((r) => r.evidence_id === task.evidence_id)?.result?.declaredFacts ?? []).map((f) => f.factKey);
    const plan = planRecalc({
      event: { type: 'evidence_submitted', evidenceKind: evidenceKindOf(art.kind), factKeys: myFacts },
      currentDomainStatus: {},
    });

    const artifactRefs = rows.map((r) => r.evidence_id);
    const reused = [];
    const computed = [];
    const assessments = {};
    for (const domain of DOMAINS) {
      const sig = domainSignature(snapshot, domain);
      const contributing = contributingMaterials(snapshot, domain);
      const cacheId = `dan-${hash16({ t: task.tenant_id, c: task.customer_id, d: domain, s: sig })}`;
      const naive = cfg.strategy === 'naive_full';
      const row = naive ? null : (await store.query(
        `SELECT * FROM domain_analyses WHERE analysis_id=$1`,
        [cacheId],
      )).rows[0];
      const affected = plan.recompute.includes(domain);
      if (row) {
        // JSONB 列 node-pg 已反序列化；兼容历史字符串形态
        const prevContributing = Array.isArray(row.artifact_refs) ? row.artifact_refs : JSON.parse(row.artifact_refs ?? '[]');
        const sameProvenance = JSON.stringify(prevContributing) === JSON.stringify(contributing);
        if (sameProvenance) {
          reused.push({ domain, because: 'consumed_facts_unchanged' });
          assessments[domain] = row.result;
          continue;
        }
        // 值态相同但来源件更替：结果结论不变，但证据引用须落在现行件上 → 保守重算（记原因）
      }
      // 未命中消费面缓存（或参与材料更替）→ 只算该域，并记录原因
      const because = naive
        ? 'naive_full_baseline'
        : (row ? 'values_identical_provenance_changed'
          : (affected ? (plan.reasons.find((x) => x.domain === domain)?.because ?? 'affected') : 'conservative_signature_miss'));
      const as = assessStage({
        snapshot, transaction: cfg.transaction, asOf: nowIso().slice(0, 10), rulePack: pack,
        domains: [domain],
      });
      if (!as.ok) {
        await recordStage(task, 'analyze', 'failed', { stage: as.stage, domain, problems: as.problems });
        await finishTask(task, 'failed', { failureCode: `ASSESS_${domain.toUpperCase()}`, lastError: JSON.stringify(as.problems ?? []).slice(0, 200) });
        return null;
      }
      const out = as.analyses[domain];
      if (!out?.analysisRun || out.analysisRun.inputHash !== snapshot.inputHash) {
        await recordStage(task, 'analyze', 'failed', { domain, reason: 'snapshot_mismatch' });
        await finishTask(task, 'failed', { failureCode: 'SNAPSHOT_MISMATCH', lastError: `${domain} 域输入哈希与感知快照不一致` });
        return null;
      }
      await store.query(
        `INSERT INTO domain_analyses (analysis_id, tenant_id, customer_id, domain, input_hash, snapshot_hash, watermark_generation, ruleset_version, result, artifact_refs, recomputed_because)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (analysis_id) DO UPDATE SET
           result=EXCLUDED.result, artifact_refs=EXCLUDED.artifact_refs,
           recomputed_because=EXCLUDED.recomputed_because,
           watermark_generation=EXCLUDED.watermark_generation,
           snapshot_hash=EXCLUDED.snapshot_hash, created_at=now()`,
        [cacheId, task.tenant_id, task.customer_id, domain, sig, snapshot.inputHash, snapshot.watermark.generation, rulesetVersion,
         JSON.stringify(out), JSON.stringify(contributing), JSON.stringify([{ because, at: nowIso() }])],
      );
      computed.push({ domain, because });
      assessments[domain] = out;
    }

    // 收口（Gate/提问/金额/下一步）：同输入同规则幂等复用
    const finId = `fin-${hash16({ t: task.tenant_id, c: task.customer_id, h: snapshot.inputHash, r: rulesetVersion })}`;
    const finExisting = (await store.query(`SELECT * FROM analysis_finalizations WHERE fin_id=$1`, [finId])).rows[0];
    if (!finExisting) {
      const as = assessStage({ snapshot, transaction: cfg.transaction, asOf: nowIso().slice(0, 10), rulePack: pack, domains: [], domainOverrides: Object.fromEntries(DOMAINS.map((d) => [d, { status: 'missing' }])) });
      if (!as.ok) {
        await recordStage(task, 'analyze', 'failed', { stage: as.stage });
        await finishTask(task, 'failed', { failureCode: 'FINALIZE_FAILED' });
        return null;
      }
      const fin = finalizeStage({
        snapshot, transaction: {}, pack: as.pack, thresholds: as.thresholds,
        assessments, ruleEvaluation: as.ruleEvaluation, derived: as.derived, projections: as.projections,
      });
      if (!fin.ok) {
        await recordStage(task, 'analyze', 'failed', { stage: 'finalize' });
        await finishTask(task, 'failed', { failureCode: 'FINALIZE_FAILED' });
        return null;
      }
      await store.query(
        `INSERT INTO analysis_finalizations (fin_id, tenant_id, customer_id, input_hash, ruleset_version, watermark_generation, gate, question_plan, amount_candidate, next_step, artifact_refs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, customer_id, input_hash, ruleset_version) DO NOTHING`,
        [finId, task.tenant_id, task.customer_id, snapshot.inputHash, rulesetVersion, snapshot.watermark.generation,
         JSON.stringify(fin.gate), JSON.stringify(fin.questionPlan), JSON.stringify(fin.amountCandidate), JSON.stringify(fin.nextStep), JSON.stringify(artifactRefs)],
      );
    }
    await recordStage(task, 'analyze', 'done', {
      inputHash: snapshot.inputHash, generation: snapshot.watermark.generation,
      planRecompute: plan.recompute, computed, reused, materials: rows.length,
      durationMs: Date.now() - started,
    });
    await recordCost({ tenantId: task.tenant_id, customerId: task.customer_id, taskId: task.task_id, stage: 'analyze', estimate: { modelCalls: 0, estMs: Date.now() - started, estBytes: Buffer.byteLength(JSON.stringify(materials)) } });
    await moveCursor(task, 'questions');
    return true;
  }

  // ---------- STAGE：questions（去重/排序/默认只建议；暂停=零新外发） ----------

  function mapPurpose(whyType) {
    switch (whyType) {
      case 'rule_precondition': return 'evidence_request';
      case 'stale_materials': return 'evidence_request';
      case 'transaction_scope_unknown': return 'clarification';
      case 'rule_input_type_error': return 'clarification';
      case 'domain_incomplete': return 'internal_domain_rerun';
      case 'unsupported_rule_ref': return 'internal_governance';
      default: return 'fact_verification';
    }
  }

  async function upsertQuestion(tenantId, customerId, binding, tier, status, inputHash, note = null) {
    await store.query(
      `INSERT INTO prepared_questions (question_key, tenant_id, customer_id, binding, tier, status, dispatch_generation, basis_input_hash, stop_condition, target_fact, merged_from, note)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10::jsonb,$11)
       ON CONFLICT (tenant_id, customer_id, question_key) DO UPDATE SET
         binding=EXCLUDED.binding, tier=EXCLUDED.tier,
         merged_from=EXCLUDED.merged_from,
         note=COALESCE(prepared_questions.note, EXCLUDED.note),
         updated_at=now()
       WHERE prepared_questions.status IN ('suggested','queued_outbound','needs_human','outbound_paused','send_failed','send_unknown')`,
      [binding.questionKey, tenantId, customerId, JSON.stringify(binding), tier, status, inputHash,
       binding.stopCondition ?? null, binding.objectRefKind === 'factKey' ? binding.objectRef : null,
       JSON.stringify(binding.mergedFrom ?? []), note],
    );
  }

  async function stageQuestions(task) {
    const fin = await latestFin(task.tenant_id, task.customer_id);
    if (!fin) { await recordStage(task, 'questions', 'skipped', { reason: 'no_finalization' }); await moveCursor(task, 'register_a'); return true; }
    const plan = fin.question_plan ?? { questions: [] };
    const arbiterInput = plan.questions.map((q) => ({
      questionId: q.questionId,
      factKey: q.targetFact ?? null,
      period: null,
      purpose: mapPurpose(q.whyNeeded?.type),
      audience: q.audience ?? 'internal',
      domain: 'four-domain',
      priority: q.priority ?? 'normal',
      requiredEvidence: q.expectedEvidence ?? null,
      // 补件/文件类请求走客户线程（材料是文件，不适合口头语音）；其余客户问题默认语音仲裁
      mode: (q.audience === 'customer' && q.expectedEvidence?.kind === 'document') ? 'thread' : undefined,
      sensitivity: null,
    }));
    const pause = await getPauseState({ tenantId: task.tenant_id, customerId: task.customer_id });
    const bound = bindQuestions({ sessionId: 'processing', customerId: task.customer_id, questions: arbiterInput });
    if (!bound.ok && bound.bindings.length === 0) {
      await recordStage(task, 'questions', 'done', { problems: bound.problems, bindings: 0 });
      await moveCursor(task, 'register_a');
      return true;
    }
    const dispatch = planDispatch({ bindings: bound.bindings, session: { outboundPaused: pause.outboundPaused, dispatchGeneration: pause.dispatchGeneration }, callState: { activeCallId: null } });
    let sentOk = 0; let sendUnknown = 0; let sendFailed = 0;
    for (const item of dispatch.plan.outbound) {
      // 同键问题幂等：已发出/在途未知/已推进的问题不再重复外发（unknown 先对账，不盲重发）
      const existingStatus = (await store.query(
        `SELECT status FROM prepared_questions WHERE tenant_id=$1 AND customer_id=$2 AND question_key=$3`,
        [task.tenant_id, task.customer_id, item.questionKey],
      )).rows[0]?.status;
      const sentAlready = ['sent_ok', 'send_unknown', 'answered', 'material_received', 'verified'].includes(existingStatus);
      if (sentAlready && cfg.strategy !== 'naive_full') continue; // naive_full 基线：无同键幂等，重复外发如实发生
      // 默认只建议：auto_whitelist 策略下才真正外发（tier=auto 且 customer 受众线程）
      const autoAllowed = cfg.outboundPolicy === 'auto_whitelist' && item.tier === 'auto_outbound';
      if (autoAllowed && item.audience === 'customer' && item.dispatchMode === 'customer_thread' && sendService) {
        const text = composeQuestionText(item);
        try {
          const r = await sendService.send({
            tenantId: task.tenant_id, actor: 'processing', customerId: task.customer_id,
            // selective：clientMsgId=question_key 幂等（重发被通道层拦截）；naive_full 基线：每次新 msgid（无去重纪律）
            audience: 'customer', text,
            clientMsgId: cfg.strategy === 'naive_full'
              ? `pq-${item.questionKey}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
              : `pq-${item.questionKey}`,
          });
          const state = r?.delivery?.state ?? 'unknown';
          if (state === 'sent_ok') sentOk += 1; else if (state === 'send_failed') sendFailed += 1; else sendUnknown += 1;
          await upsertQuestionWithStatus(task.tenant_id, task.customer_id, item, state === 'sent_ok' ? 'sent_ok' : state === 'send_failed' ? 'send_failed' : 'send_unknown', fin.input_hash, `delivery=${state}`);
        } catch (e) {
          await upsertQuestionWithStatus(task.tenant_id, task.customer_id, item, 'send_unknown', fin.input_hash, `send error: ${String(e.message).slice(0, 120)}（unknown：不换 ID 重试，先对账）`);
        }
        continue;
      }
      // 建议态（默认）：只登记，不外发
      await upsertQuestionWithStatus(task.tenant_id, task.customer_id, item, 'suggested', fin.input_hash,
        cfg.outboundPolicy === 'suggest_only' ? 'suggest_only 策略：仅建议不外发' : `dispatchMode=${item.dispatchMode}`);
    }
    for (const item of dispatch.plan.queued) {
      const isHumanGate = (item.queueReason ?? '').includes('HUMAN_GATE') || item.tier === 'human_gate' || (item.tier ?? classifyOutboundTier(item).tier) === 'human_gate';
      await upsertQuestionWithStatus(task.tenant_id, task.customer_id, item, isHumanGate ? 'needs_human' : 'queued_outbound', fin.input_hash,
        isHumanGate ? (item.queueReason ?? 'human_gate') : `${item.queueReason ?? 'queued'}（语音窗口/并发仲裁排队，不抢话）`);
    }
    for (const item of dispatch.plan.blocked) {
      await upsertQuestionWithStatus(task.tenant_id, task.customer_id, item, 'outbound_paused', fin.input_hash, `OUTBOUND_PAUSED@gen${pause.dispatchGeneration}（在途单列，恢复后按代际推进）`);
    }
    // 晚到材料满足停止条件：不再出现在当前计划中的事实问题 → material_received（≠人工核验）
    await markSatisfiedQuestions(task.tenant_id, task.customer_id, plan);
    await recordStage(task, 'questions', 'done', {
      bindings: bound.bindings.length, merged: bound.mergedCount,
      outbound: dispatch.plan.outbound.length, queued: dispatch.plan.queued.length, blocked: dispatch.plan.blocked.length,
      sentOk, sendFailed, sendUnknown, policy: cfg.outboundPolicy, paused: pause.outboundPaused,
    });
    await moveCursor(task, 'register_a');
    return true;
  }

  async function upsertQuestionWithStatus(tenantId, customerId, binding, status, inputHash, note) {
    await upsertQuestion(tenantId, customerId, binding, binding.tier ?? classifyOutboundTier(binding).tier, status, inputHash, note);
    // 状态前移（WHERE 守卫：answered/material_received/verified 不会被分析轮次回退）
    await store.query(
      `UPDATE prepared_questions SET status=$4, note=$5, updated_at=now()
       WHERE tenant_id=$1 AND customer_id=$2 AND question_key=$3
         AND status IN ('suggested','queued_outbound','needs_human','outbound_paused','send_failed','send_unknown')`,
      [tenantId, customerId, binding.questionKey, status, note],
    );
  }

  function composeQuestionText(b) {
    const ev = b.requiredEvidence?.kind ? `（所需：${b.requiredEvidence.kind}${b.requiredEvidence.minLevel ? ` 达 ${b.requiredEvidence.minLevel} 级` : ''}）` : '';
    return `【资料核验请求】关于 ${b.objectRef}${b.period ? `（期间 ${b.period}）` : ''}：需要补充或说明（目的 ${b.purpose}）${ev}。回复不等于材料核验完成。`;
  }

  async function markSatisfiedQuestions(tenantId, customerId, currentPlan) {
    const currentTargets = new Set(currentPlan.questions.map((q) => q.targetFact).filter(Boolean));
    const open = (await store.query(
      `SELECT question_key, target_fact, stop_condition FROM prepared_questions
       WHERE tenant_id=$1 AND customer_id=$2 AND target_fact IS NOT NULL
         AND status IN ('suggested','queued_outbound','needs_human','outbound_paused','send_failed','send_unknown')`,
      [tenantId, customerId],
    )).rows;
    for (const q of open) {
      if (!currentTargets.has(q.target_fact)) {
        await store.query(
          `UPDATE prepared_questions SET status='material_received',
             note=COALESCE(note,'')||' | 晚到材料满足停止条件（材料取得≠人工核验）', updated_at=now()
           WHERE tenant_id=$1 AND customer_id=$2 AND question_key=$3`,
          [tenantId, customerId, q.question_key],
        );
      }
    }
  }

  // ---------- 人工核验（verified 只能由人产生） ----------

  async function verifyQuestion({ tenantId, customerId, questionKey, verifiedBy, note }) {
    if (!verifiedBy || !note) throw new ConnError('INVALID_INPUT', 'verifyQuestion: verifiedBy/note 必填（核验意见可回溯）');
    const r = await store.query(
      `UPDATE prepared_questions SET status='verified', note=COALESCE(note,'')||$5||'（人工核验：' || $4 || '）', updated_at=now()
       WHERE tenant_id=$1 AND customer_id=$2 AND question_key=$3 AND status IN ('material_received','answered','suggested') RETURNING question_key`,
      [tenantId, customerId, questionKey, verifiedBy, ` ${String(note).slice(0, 120)}`],
    );
    if (r.rows.length === 0) throw new ConnError('INVALID_STATE', `问题 ${questionKey} 不在可核验状态`);
    return { ok: true, questionKey, status: 'verified' };
  }

  async function recordAnswer({ tenantId, customerId, questionKey, answerText, answerer }) {
    if (!answerText) throw new ConnError('INVALID_INPUT', 'recordAnswer: answerText 必填');
    const r = await store.query(
      `UPDATE prepared_questions SET status='answered', note=COALESCE(note,'')||$4, updated_at=now()
       WHERE tenant_id=$1 AND customer_id=$2 AND question_key=$3 AND status IN ('suggested','queued_outbound','sent_ok','send_unknown','outbound_paused') RETURNING question_key`,
      [tenantId, customerId, questionKey, ` | 回答（≠材料取得≠核验）：${String(answerText).slice(0, 80)} by ${answerer ?? 'customer'}`],
    );
    if (r.rows.length === 0) throw new ConnError('INVALID_STATE', `问题 ${questionKey} 不在可回答状态`);
    return { ok: true, questionKey, status: 'answered', note: '回答只是回答；材料取得与人工核验分别推进' };
  }

  // ---------- STAGE：register_a（确定性 requestId；unknown 先对账，不换 ID） ----------

  async function stageRegisterA(task) {
    const projectId = cfg.aProjectByCustomer[task.customer_id];
    if (!aRegister || !projectId) {
      await recordStage(task, 'register_a', 'skipped', { reason: aRegister ? 'no_project_mapping' : 'a_not_configured' });
      await moveCursor(task, 'done');
      await finishTask(task, 'done');
      return null;
    }
    const requestId = `ptx-${task.task_id}`; // 确定性：重放同 ID 幂等，绝不换 ID
    // 先对账：本任务此前若处于 unknown，先查回执
    const prev = (await store.query(
      `SELECT status FROM processing_stage_runs WHERE task_id=$1 AND stage='register_a' ORDER BY id DESC LIMIT 1`,
      [task.task_id],
    )).rows[0];
    if (prev?.status === 'unknown') {
      const receipt = await aRegister.getReceipt?.(requestId).catch(() => null);
      if (receipt?.found) {
        await recordStage(task, 'register_a', 'done', { reconciled: true, requestId, receipt });
        await moveCursor(task, 'done');
        await finishTask(task, 'done', { note: 'A 登记经回执对账确认（unknown→done，未换 ID 重发）' });
        return null;
      }
      // 回执未见：保持 unknown（等待下一次对账），不自动重发
      await recordStage(task, 'register_a', 'unknown', { requestId, reconcile: 'receipt_not_found_stay_unknown' });
      await finishTask(task, 'blocked_unknown', { failureCode: 'A_REGISTER_UNKNOWN', note: 'A 登记结果未知：等待回执对账，不换 ID 重试' });
      return null;
    }
    try {
      const summary = `evidence ${task.evidence_id} parsed+preaudited (processing)`;
      const r = await aRegister.registerEvidence({
        projectId, tenantId: task.tenant_id, evidenceId: task.evidence_id, customerId: task.customer_id,
        summary, sha256: (await artifactRow(task.tenant_id, task.evidence_id))?.sha256 ?? null,
        sourceProvider: 'processing', sourceMode: 'real', requestId,
        timeoutMs: cfg.aTimeoutMs,
      });
      await recordStage(task, 'register_a', 'done', { requestId, aEvidenceId: r.aEvidenceId, aProjectId: r.aProjectId });
      await moveCursor(task, 'done');
      await finishTask(task, 'done', { note: `已登记 A（${r.aProjectId}）` });
    } catch (e) {
      const unknown = e.code === 'TIMEOUT_UNKNOWN' || e.name === 'AbortError' || e.code === 'ECONNRESET';
      if (unknown) {
        await recordStage(task, 'register_a', 'unknown', { requestId, reason: String(e.message).slice(0, 120) });
        await finishTask(task, 'blocked_unknown', { failureCode: 'A_REGISTER_UNKNOWN', note: 'A 登记已发出但结果未知：保持 unknown，先对账' });
      } else {
        await recordStage(task, 'register_a', 'failed', { requestId, reason: String(e.message).slice(0, 120) });
        await finishTask(task, 'failed', { failureCode: e.code ?? 'A_REGISTER_FAILED', lastError: String(e.message).slice(0, 200) });
      }
    }
    return null;
  }

  // ---------- 驱动：认领/恢复/预算/有限重试 ----------

  async function reclaimExpired() {
    const r = await store.query(
      `UPDATE processing_tasks SET status='queued', leased_until=NULL, leased_by=NULL, updated_at=now()
       WHERE status='running' AND leased_until < now() RETURNING task_id`,
    );
    return r.rows.length;
  }

  async function claimDue(limit) {
    // 客户级窗口预算在认领 SQL 内强制：达上限的客户任务不被认领（排队不丢弃，不靠事后回收）
    const rows = (await store.query(
      `UPDATE processing_tasks SET status='running', attempts=attempts+1, leased_until=now() + ($3 || ' seconds')::interval, leased_by=$2, updated_at=now()
       WHERE task_id IN (
         SELECT pt.task_id FROM processing_tasks pt
         WHERE pt.status='queued' AND pt.attempts < pt.max_attempts AND (pt.leased_until IS NULL OR pt.leased_until < now())
           AND ($4::int IS NULL OR (
             SELECT count(*)::int FROM processing_tasks c
             WHERE c.tenant_id=pt.tenant_id AND c.customer_id=pt.customer_id
               AND date_trunc('hour', c.created_at)=date_trunc('hour', now())
               AND c.status IN ('running','done','needs_followup','failed','blocked_unknown','skipped_duplicate')
           ) < $4::int)
         ORDER BY pt.created_at
         LIMIT $1
         FOR UPDATE OF pt SKIP LOCKED
       ) RETURNING *`,
      [limit, cfg.workerId, String(cfg.leaseSec), cfg.maxTasksPerCustomerPerHour],
    )).rows;
    return rows;
  }

  /** 对账 sweep：blocked_unknown（A 登记结果未知）任务先查回执——同 requestId 幂等，绝不换 ID 重发。 */
  async function reconcileUnknown() {
    const rows = (await store.query(`SELECT * FROM processing_tasks WHERE status='blocked_unknown' ORDER BY updated_at LIMIT 10`)).rows;
    let reconciled = 0;
    for (const task of rows) {
      const requestId = `ptx-${task.task_id}`;
      const receipt = await aRegister?.getReceipt?.(requestId).catch(() => null);
      if (receipt?.found) {
        await recordStage(task, 'register_a', 'done', { reconciled: true, requestId, receipt: { requestId: receipt.requestId } });
        await finishTask(task, 'done', { note: 'A 登记经回执对账确认（unknown→done，未换 ID 重发）' });
        reconciled += 1;
      } else if (task.attempts >= task.max_attempts + 3) {
        await finishTask(task, 'failed', { failureCode: 'A_REGISTER_UNRESOLVED', note: '对账超界：保持人工介入（从未换 ID 自动重发）' });
      }
    }
    return reconciled;
  }

  /** 单任务推进：按游标执行到终态或需等待。cfg.hookAfterStage（测试/故障注入缝）在每段成功后调用。 */
  async function runTask(task) {
    let cur = task.stage_cursor;
    for (let guard = 0; guard < 8; guard++) {
      if (cur === 'unzip') { const cont = await stageUnzip(task); if (!cont) return; if (cfg.hookAfterStage) await cfg.hookAfterStage(task, 'unzip'); cur = 'parse'; task.stage_cursor = 'parse'; continue; }
      if (cur === 'parse') {
        const pr = await stageParse(task);
        if (pr === null) return;
        task._parseResult = pr;
        if (cfg.hookAfterStage) await cfg.hookAfterStage(task, 'parse');
        cur = 'facts'; task.stage_cursor = 'facts';
        continue;
      }
      if (cur === 'facts') {
        let parseResult = task._parseResult ?? null;
        if (!parseResult) {
          // 恢复场景：parse 段已完成但结果不在内存 → 从缓存按内容键取回
          const cached = (await store.query(
            `SELECT pr.result FROM parse_results pr JOIN evidence_artifacts a ON a.tenant_id=pr.tenant_id AND a.customer_id=pr.customer_id AND a.sha256=pr.sha256
             WHERE a.evidence_id=$1 AND pr.ok`,
            [task.evidence_id],
          )).rows[0];
          parseResult = cached?.result ?? null;
        }
        const cont = await stageFacts(task, parseResult);
        if (!cont) return;
        if (cfg.hookAfterStage) await cfg.hookAfterStage(task, 'facts');
        cur = 'analyze'; task.stage_cursor = 'analyze';
        continue;
      }
      if (cur === 'analyze') { const cont = await stageAnalyze(task); if (!cont) return; if (cfg.hookAfterStage) await cfg.hookAfterStage(task, 'analyze'); cur = 'questions'; task.stage_cursor = 'questions'; continue; }
      if (cur === 'questions') { const cont = await stageQuestions(task); if (!cont) return; if (cfg.hookAfterStage) await cfg.hookAfterStage(task, 'questions'); cur = 'register_a'; task.stage_cursor = 'register_a'; continue; }
      if (cur === 'register_a') { await stageRegisterA(task); return; }
      if (cur === 'done') { await finishTask(task, task.status === 'running' ? 'done' : task.status); return; }
      await finishTask(task, 'failed', { failureCode: 'UNKNOWN_CURSOR', lastError: `未知游标 ${cur}` });
      return;
    }
    await finishTask(task, 'failed', { failureCode: 'STAGE_LOOP_GUARD', lastError: '阶段循环超保护上限' });
  }

  /** 驱动一次：对账 unknown → 恢复过期租约 → 认领 → 推进。 */
  async function tick({ maxTasks = cfg.concurrency } = {}) {
    if (driving) return { skipped: 'already_driving' };
    driving = true;
    try {
      const reconciled = await reconcileUnknown();
      const reclaimed = await reclaimExpired();
      const queuedBefore = (await store.query(
        `SELECT count(*)::int AS n FROM processing_tasks WHERE status='queued' AND attempts < max_attempts AND (leased_until IS NULL OR leased_until < now())`,
      )).rows[0].n;
      const result = { reconciled, reclaimed, claimed: 0, budgetHeld: 0, done: 0, needsFollowup: 0, failed: 0 };
      // 逐任务认领推进：客户窗口预算在每次认领时重新生效（达上限客户任务留在队列，不丢弃）
      for (let i = 0; i < maxTasks; i++) {
        const claimed = await claimDue(1);
        if (claimed.length === 0) break;
        result.claimed += 1;
        const task = claimed[0];
        try {
          await runTask(task);
          const after = (await store.query(`SELECT status FROM processing_tasks WHERE task_id=$1`, [task.task_id])).rows[0];
          if (after?.status === 'done' || after?.status === 'skipped_duplicate') result.done += 1;
          else if (after?.status === 'needs_followup' || after?.status === 'blocked_unknown') result.needsFollowup += 1;
          else if (after?.status === 'failed') result.failed += 1;
        } catch (e) {
          const attempts = task.attempts;
          if (attempts >= task.max_attempts) {
            await finishTask(task, 'failed', { failureCode: e.code ?? 'TASK_ERROR', lastError: String(e.message).slice(0, 200) });
            result.failed += 1;
          } else {
            await store.query(
              `UPDATE processing_tasks SET status='queued', leased_until=NULL, leased_by=NULL, last_error=$3, updated_at=now() WHERE task_id=$1 AND tenant_id=$2`,
              [task.task_id, task.tenant_id, String(e.message).slice(0, 200)],
            );
          }
        }
      }
      result.budgetHeld = Math.max(0, queuedBefore - result.claimed);
      return result;
    } finally {
      driving = false;
    }
  }

  /** 常驻驱动（主入口 start-connectors 用；测试用手动 tick）。 */
  function startDriver(intervalMs = 2000) {
    if (driverTimer) return;
    driverTimer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
    driverTimer.unref?.();
  }
  function stopDriver() {
    if (driverTimer) { clearInterval(driverTimer); driverTimer = null; }
  }

  return {
    version: COORDINATOR_VERSION, rulesetVersion,
    enqueueArtifact, getTask, statusForCustomer,
    tick, startDriver, stopDriver,
    setPause, getPauseState,
    verifyQuestion, recordAnswer,
    _cfg: cfg,
  };
}
