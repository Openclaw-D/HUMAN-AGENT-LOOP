// jw-demo-state · 确定性演示状态转换模块（任务C candidate，2026-09-14）
//
// 范围声明：
// - 只服务 NIGHT_SIMPLIFY 演示（demo-story.json，schema jw-demo-story@1），不是通用工作流引擎。
// - 纯函数：不改入参、确定性输出、无网络、无时钟、无随机、不读写产品存储、无事件总线。
// - 非法操作一律返回 { ok:false, code, message } 的明确拒绝，不静默、不抛异常（校验函数除外，
//   校验函数也不抛，统一 result 对象）。
// - 与真实模型输入隔离：本模块只消费演示预设数据；预期验证要点/真实模型请求不经过本模块。
//
// 状态语义（对齐产品 lib/v5-preview/shared-types.ts 的既有类型）：
// - 阶段段状态 done/current/pending = SegmentState；判断灯 green/yellow/red/gray = JudgmentStatus。
// - requestId 幂等语义对齐产品 API：同 requestId 同载荷 = 幂等重放（replayed:true，状态不变）；
//   同 requestId 不同载荷 = REQUEST_MISMATCH 明确拒绝；已完成步骤换 requestId = ALREADY_COMPLETED。
// - 人工节点（human-decision）不可被自动推进（advanceAuto）越过；human-action 同样阻塞自动推进。
// - 纠正（correct）产生证据升版：旧版本标记 superseded、不再作为有效引用；基于旧版本的意见作废。
//   历史记录保留原文（可追溯），只是"不再有效"。

export const STORY_SCHEMA = 'jw-demo-story@1';
export const SNAPSHOT_SCHEMA = 'jw-demo-snapshot@1';

/** @typedef {'auto'|'human-action'|'human-decision'} StepKind */
/** @typedef {'close'|'return'} DecisionOutcome */

/**
 * @typedef {Object} OkResult
 * @property {true} ok
 * @property {*} [value]
 * @property {boolean} [replayed]
 */
/**
 * @typedef {Object} ErrResult
 * @property {false} ok
 * @property {string} code
 * @property {string} message
 */

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

const fail = (code, message) => ({ ok: false, code, message });

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 深比较两个可 JSON 值（用于幂等重放判定；键顺序无关）。 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (!deepEqual(ka, kb)) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function reqEntryId(entry) {
  return typeof entry === 'string' ? entry : entry.step;
}

function reqEntryOutcomes(entry) {
  return typeof entry === 'string' ? null : entry.outcome;
}

// ---------------------------------------------------------------------------
// validateStory：静态契约校验（ID 唯一、引用存在、结构完整、静态可达）
// ---------------------------------------------------------------------------

/**
 * @param {object} story
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateStory(story) {
  const errors = [];
  const push = (m) => errors.push(m);
  if (!isPlainObject(story)) {
    return { ok: false, errors: ['story 必须是对象'] };
  }
  if (story.schema !== STORY_SCHEMA) push(`schema 必须为 ${STORY_SCHEMA}，实际 ${JSON.stringify(story.schema)}`);
  if (typeof story.storyId !== 'string' || story.storyId.length === 0) push('storyId 必须为非空字符串');

  const stageIds = new Set((story.stages ?? []).map((s) => s.id));
  if (!Array.isArray(story.stages) || story.stages.length === 0) push('stages 必须为非空数组');
  for (const s of story.stages ?? []) {
    if (!s.id || !s.label) push(`阶段缺 id/label：${JSON.stringify(s)}`);
  }

  const domains = story.domains ?? [];
  if (!Array.isArray(domains) || domains.length === 0) push('domains 必须为非空数组');

  const steps = Array.isArray(story.steps) ? story.steps : [];
  if (steps.length === 0) push('steps 必须为非空数组');

  const byId = new Map();
  for (const st of steps) {
    if (!st.stepId) { push(`步骤缺 stepId：${JSON.stringify(st.title ?? '')}`); continue; }
    if (byId.has(st.stepId)) push(`步骤 ID 重复：${st.stepId}`);
    byId.set(st.stepId, st);
  }

  const initialDocIds = new Set((story.evidence ?? []).map((e) => e.docId));
  const addedDocIds = new Set();
  for (const st of steps) {
    for (const add of st.evidenceAdds ?? []) {
      if (addedDocIds.has(add.docId)) push(`证据重复挂接定义：${add.docId}（${st.stepId}）`);
      addedDocIds.add(add.docId);
    }
  }
  const knownDocIds = new Set([...initialDocIds, ...addedDocIds]);

  // 全量里程碑集合（patch ceiling 校验与声明顺序无关）
  const milestoneSeenAll = new Set(
    steps.filter((st) => typeof st.milestoneIndex === 'number').map((st) => st.milestoneIndex)
  );

  const milestoneSeen = new Set();
  const patchChecks = [];
  for (const st of steps) {
    const id = st.stepId;
    if (!byId.get(id)) continue; // 重复 ID 已记录
    if (!stageIds.has(st.stage)) push(`${id}: stage 不存在：${st.stage}`);
    if (!['auto', 'human-action', 'human-decision'].includes(st.kind)) push(`${id}: 非法 kind：${st.kind}`);
    for (const r of st.requires ?? []) {
      const rid = reqEntryId(r);
      if (!byId.has(rid)) push(`${id}: requires 引用不存在的步骤：${rid}`);
      if (rid === id) push(`${id}: requires 自引用`);
      if (typeof r === 'object' && byId.get(rid)?.kind !== 'human-decision') {
        push(`${id}: outcome 前提只能指向 human-decision 步骤：${rid}`);
      }
    }
    for (const r of st.requiresAny ?? []) {
      const rid = reqEntryId(r);
      if (!byId.has(rid)) push(`${id}: requiresAny 引用不存在的步骤：${rid}`);
      if (typeof r === 'object' && byId.get(rid)?.kind !== 'human-decision') {
        push(`${id}: requiresAny 的 outcome 条件只能指向 human-decision 步骤：${rid}`);
      }
    }
    for (const ref of st.evidenceRefs ?? []) {
      if (!knownDocIds.has(ref.docId)) push(`${id}: evidenceRefs 引用不存在的证据：${ref.docId}`);
      if (typeof ref.version !== 'number' || ref.version < 1) push(`${id}: 证据版本非法：${ref.docId} v${ref.version}`);
    }
    if (st.kind === 'human-decision') {
      const opts = st.decisionOptions ?? [];
      if (opts.length === 0) push(`${id}: human-decision 必须有 decisionOptions`);
      const seen = new Set();
      for (const o of opts) {
        if (!o.decision) push(`${id}: 决定选项缺 decision`);
        if (seen.has(o.decision)) push(`${id}: 决定选项重复：${o.decision}`);
        seen.add(o.decision);
        if (!['close', 'return'].includes(o.outcome)) push(`${id}: 决定 ${o.decision} 的 outcome 非法：${o.outcome}`);
        if (!o.label) push(`${id}: 决定 ${o.decision} 缺 label`);
        if (o.viewPatch && !milestoneSeenAll.has(o.viewPatch.ceilingMilestoneIndex)) {
          push(`${id}: 决定 ${o.decision} 的 viewPatch.ceilingMilestoneIndex 引用不存在的里程碑`);
        }
      }
    }
    if (st.milestoneIndex !== null && st.milestoneIndex !== undefined) {
      if (milestoneSeen.has(st.milestoneIndex)) push(`${id}: milestoneIndex 重复：${st.milestoneIndex}`);
      milestoneSeen.add(st.milestoneIndex);
    }
    if (st.view) {
      const vs = Object.keys(st.view.stages ?? {});
      for (const sid of stageIds) if (!vs.includes(sid)) push(`${id}: view.stages 缺阶段 ${sid}`);
      const vd = Object.keys(st.view.domains ?? {});
      for (const d of domains) if (!vd.includes(d)) push(`${id}: view.domains 缺域 ${d}`);
    }
    if (st.viewPatch) {
      patchChecks.push([id, st.viewPatch.ceilingMilestoneIndex]);
    }
  }

  // 二次遍历：patch ceiling 需要在全部里程碑收集后校验（声明顺序无关）。
  for (const [id, ceil] of patchChecks) {
    if (!milestoneSeen.has(ceil)) push(`${id}: viewPatch.ceilingMilestoneIndex 引用不存在的里程碑：${ceil}`);
  }

  if (!byId.has(story.terminalStepId)) push(`terminalStepId 不存在：${story.terminalStepId}`);

  for (const op of story.opinions ?? []) {
    if (!knownDocIds.has(op.basedOn?.docId)) push(`意见 ${op.opinionId} 依据证据不存在：${op.basedOn?.docId}`);
  }

  for (const g of story.parallelGroups ?? []) {
    for (const sid of g.steps ?? []) if (!byId.has(sid)) push(`并行组 ${g.id} 引用不存在的步骤：${sid}`);
  }

  // 静态可达性：从无前提步骤出发沿 requires∪requiresAny 正向可达。
  if (errors.length === 0 && steps.length > 0) {
    const reach = new Set();
    const queue = [];
    for (const st of steps) {
      const needs = [...(st.requires ?? []), ...(st.requiresAny ?? []).map(reqEntryId)];
      if (needs.length === 0) { reach.add(st.stepId); queue.push(st.stepId); }
    }
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const st of steps) {
        if (reach.has(st.stepId)) continue;
        const needs = [...(st.requires ?? []), ...(st.requiresAny ?? []).map(reqEntryId)];
        if (needs.every((n) => reach.has(reqEntryId(n)))) { reach.add(st.stepId); queue.push(st.stepId); }
      }
    }
    for (const st of steps) {
      if (!reach.has(st.stepId)) push(`步骤不可达（分支死路或悬空）：${st.stepId}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 状态初始化 / 基础查询
// ---------------------------------------------------------------------------

function buildEvidenceIndex(story) {
  /** @type {Record<string, {docId:string,title:string,sourceStatus:string,versions:Array<{version:number,state:'valid'|'superseded'}>}>} */
  const idx = {};
  for (const e of story.evidence ?? []) {
    idx[e.docId] = {
      docId: e.docId,
      title: e.title,
      sourceStatus: e.sourceStatus ?? 'recorded',
      versions: [{ version: e.initialVersion ?? 1, state: 'valid' }],
    };
  }
  return idx;
}

function stepById(story, stepId) {
  return (story.steps ?? []).find((s) => s.stepId === stepId) ?? null;
}

function newStoryState(story) {
  return {
    storyId: story.storyId,
    demoScope: 'demo-only',
    completed: [],
    evidence: buildEvidenceIndex(story),
    invalidatedOpinions: [],
    decisionMessages: [],
  };
}

/**
 * 创建初始演示状态（确定性：同一 story 深比较相等）。
 * @param {object} story
 * @returns {object} DemoState
 */
export function createDemoState(story) {
  return newStoryState(story);
}

/** 演示重置：与 createDemoState 等价；作用域仅限本模块派生的演示状态。 */
export function resetDemo(story) {
  return createDemoState(story);
}

function recordFor(state, stepId) {
  return state.completed.find((r) => r.stepId === stepId) ?? null;
}

function recordForRequest(state, requestId) {
  return state.completed.find((r) => r.requestId === requestId) ?? null;
}

function prereqSatisfied(state, entry) {
  const rid = reqEntryId(entry);
  const rec = recordFor(state, rid);
  if (!rec) return false;
  const outcomes = reqEntryOutcomes(entry);
  if (outcomes !== null && !outcomes.includes(rec.outcome)) return false;
  return true;
}

function stepAvailable(story, state, st) {
  if (recordFor(state, st.stepId)) return false;
  for (const r of st.requires ?? []) if (!prereqSatisfied(state, r)) return false;
  const any = st.requiresAny ?? [];
  if (any.length > 0 && !any.some((r) => prereqSatisfied(state, r))) return false;
  return true;
}

/**
 * 当前可执行动作（按 story 声明序；决策节点附选项）。
 * @returns {Array<{stepId:string,kind:StepKind,title:string,decisionOptions?:Array<{decision:string,label:string,outcome:DecisionOutcome}>}>}
 */
export function listAvailableActions(story, state) {
  const out = [];
  for (const st of story.steps ?? []) {
    if (!stepAvailable(story, state, st)) continue;
    const item = { stepId: st.stepId, kind: st.kind, title: st.title };
    if (st.kind === 'human-decision') {
      item.decisionOptions = (st.decisionOptions ?? []).map((o) => ({
        decision: o.decision,
        label: o.label,
        outcome: o.outcome,
      }));
    }
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 副作用应用（证据升版 / 意见作废）
// ---------------------------------------------------------------------------

function applyEffects(state, effects) {
  const next = { ...state };
  let evidence = state.evidence;
  let invalidated = state.invalidatedOpinions;
  let decisionMessages = state.decisionMessages;

  for (const u of effects?.evidenceUpdates ?? []) {
    const doc = evidence[u.docId];
    if (!doc) continue; // validateStory 保证存在；防御式跳过
    const alreadyValid = doc.versions.some((v) => v.version === u.newVersion && v.state === 'valid');
    if (alreadyValid) continue; // 重复纠正幂等：同目标版本不重复升版
    evidence = {
      ...evidence,
      [u.docId]: {
        ...doc,
        versions: [
          ...doc.versions.map((v) => (v.version === u.supersedesVersion ? { ...v, state: 'superseded' } : v)),
          { version: u.newVersion, state: 'valid' },
        ],
      },
    };
  }

  const inv = effects?.invalidateOpinions ?? [];
  if (inv.length > 0) invalidated = [...new Set([...invalidated, ...inv])];

  for (const m of effects?.messages ?? []) decisionMessages = [...decisionMessages, m];

  next.evidence = evidence;
  next.invalidatedOpinions = invalidated;
  next.decisionMessages = decisionMessages;
  return next;
}

function commit(story, state, record) {
  const st = record._step;
  let next = { ...state, completed: [...state.completed, record] };
  // 步骤级证据挂接（任何类型步骤都可声明 evidenceAdds）
  const adds = st.evidenceAdds ?? [];
  if (adds.length > 0) {
    let evidence = next.evidence;
    for (const add of adds) {
      if (evidence[add.docId]) continue; // 已存在则幂等跳过
      evidence = {
        ...evidence,
        [add.docId]: {
          docId: add.docId,
          title: add.title,
          sourceStatus: add.sourceStatus ?? 'recorded',
          versions: [{ version: add.version, state: 'valid' }],
        },
      };
    }
    next = { ...next, evidence };
  }
  if (record.decision !== undefined) {
    const opt = (st.decisionOptions ?? []).find((o) => o.decision === record.decision);
    if (opt) next = applyEffects(next, opt.effects ?? {});
  }
  return next;
}

// ---------------------------------------------------------------------------
// advance / decide / advanceAuto
// ---------------------------------------------------------------------------

function checkRequest(state, stepId, requestId, kind, decision) {
  if (typeof requestId !== 'string' || requestId.length === 0) {
    return fail('INVALID_INPUT', 'requestId 必须为非空字符串');
  }
  const byReq = recordForRequest(state, requestId);
  if (byReq) {
    const same = byReq.stepId === stepId && byReq.kind === kind && (byReq.decision ?? null) === (decision ?? null);
    return same ? { replay: true } : fail('REQUEST_MISMATCH', `requestId ${requestId} 已被不同操作使用，拒绝复用`);
  }
  const byStep = recordFor(state, stepId);
  if (byStep) return fail('ALREADY_COMPLETED', `步骤 ${stepId} 已完成（requestId ${byStep.requestId}），不接受新请求`);
  return null;
}

/**
 * 推进一个 auto / human-action 步骤。
 * @returns {{ok:true,state:object,replayed?:boolean}|{ok:false,code:string,message:string}}
 */
export function advance(story, state, stepId, requestId) {
  const st = stepById(story, stepId);
  if (!st) return fail('UNKNOWN_STEP', `未知步骤：${stepId}`);
  if (st.kind === 'human-decision') {
    return fail('MUST_DECIDE', `步骤 ${stepId} 是人工决定节点，必须通过 decide() 给出明确决定，不可直接推进`);
  }
  const req = checkRequest(state, stepId, requestId, st.kind, undefined);
  if (req) {
    if (req.replay) return { ok: true, state, replayed: true };
    return req;
  }
  for (const r of st.requires ?? []) {
    if (!prereqSatisfied(state, r)) {
      return fail('PREREQ_UNMET', `步骤 ${stepId} 前提未满足：${reqEntryId(r)} 未按所需结果完成`);
    }
  }
  const any = st.requiresAny ?? [];
  if (any.length > 0 && !any.some((r) => prereqSatisfied(state, r))) {
    return fail('PREREQ_UNMET', `步骤 ${stepId} 的可选前提均未满足`);
  }
  const record = { stepId, requestId, kind: st.kind };
  return { ok: true, state: commit(story, state, { ...record, _step: st }) };
}

/**
 * 人工决定（human-decision 专用）。
 * @returns {{ok:true,state:object,replayed?:boolean}|{ok:false,code:string,message:string}}
 */
export function decide(story, state, stepId, requestId, decision) {
  const st = stepById(story, stepId);
  if (!st) return fail('UNKNOWN_STEP', `未知步骤：${stepId}`);
  if (st.kind !== 'human-decision') {
    return fail('NOT_DECISION', `步骤 ${stepId} 不是人工决定节点（kind=${st.kind}），请用 advance()`);
  }
  const req = checkRequest(state, stepId, requestId, st.kind, decision);
  if (req) {
    if (req.replay) return { ok: true, state, replayed: true };
    return req;
  }
  for (const r of st.requires ?? []) {
    if (!prereqSatisfied(state, r)) {
      return fail('PREREQ_UNMET', `步骤 ${stepId} 前提未满足：${reqEntryId(r)} 未按所需结果完成`);
    }
  }
  const any = st.requiresAny ?? [];
  if (any.length > 0 && !any.some((r) => prereqSatisfied(state, r))) {
    return fail('PREREQ_UNMET', `步骤 ${stepId} 的可选前提均未满足`);
  }
  const opt = (st.decisionOptions ?? []).find((o) => o.decision === decision);
  if (!opt) {
    const valid = (st.decisionOptions ?? []).map((o) => o.decision).join('、');
    return fail('INVALID_DECISION', `步骤 ${stepId} 不接受决定「${decision}」（可选：${valid}）`);
  }
  const record = {
    stepId,
    requestId,
    kind: st.kind,
    decision,
    outcome: opt.outcome,
  };
  return { ok: true, state: commit(story, state, { ...record, _step: st }) };
}

/**
 * 一键推进常规动作：按 story 声明序反复完成当前可用的 auto 步骤，
 * 遇到 human-action / human-decision 即停（人工节点不可被自动越过）。
 * 每步 requestId = base + ':' + stepId（确定性）。
 * @returns {{ok:true,state:object,completed:string[],stoppedAt:{stepId:string,kind:StepKind}|null}}
 */
export function advanceAuto(story, state, baseRequestId) {
  if (typeof baseRequestId !== 'string' || baseRequestId.length === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'baseRequestId 必须为非空字符串' };
  }
  let cur = state;
  const completed = [];
  for (;;) {
    const st = (story.steps ?? []).find((s) => s.kind === 'auto' && stepAvailable(story, cur, s));
    if (!st) {
      const blocker = (story.steps ?? []).find((s) => s.kind !== 'auto' && stepAvailable(story, cur, s));
      return {
        ok: true,
        state: cur,
        completed,
        stoppedAt: blocker ? { stepId: blocker.stepId, kind: blocker.kind } : null,
      };
    }
    const res = advance(story, cur, st.stepId, `${baseRequestId}:${st.stepId}`);
    if (!res.ok) {
      return { ok: false, code: res.code, message: `自动推进在 ${st.stepId} 被拒绝：${res.message}` };
    }
    cur = res.state;
    completed.push(st.stepId);
  }
}

// ---------------------------------------------------------------------------
// 视图（阶段 / 四域 / 整体标签）—— 完成集合的纯函数，与完成顺序无关
// ---------------------------------------------------------------------------

function cloneView(v) {
  return {
    stages: { ...v.stages },
    domains: Object.fromEntries(Object.entries(v.domains).map(([k, d]) => [k, { ...d }])),
    overallLabel: v.overallLabel,
    overallNote: undefined,
    terminal: false,
  };
}

/**
 * 演示视图：取已完成步骤中最新的里程碑 view 为基底，再叠加"窗口仍开启"的分支 patch。
 * patch 窗口：完成里程碑序号 < ceilingMilestoneIndex 时生效（退回未闭环期间不错误全绿）。
 */
export function views(story, state) {
  let maxMilestone = -Infinity;
  for (const rec of state.completed) {
    const st = stepById(story, rec.stepId);
    if (st && st.view && typeof st.milestoneIndex === 'number') {
      maxMilestone = Math.max(maxMilestone, st.milestoneIndex);
    }
  }
  const base = maxMilestone === -Infinity ? story.initialView : (story.steps ?? []).find((s) => s.milestoneIndex === maxMilestone && s.view)?.view;
  const view = cloneView(base);
  const applyPatch = (p) => {
    for (const [d, row] of Object.entries(p.domains ?? {})) {
      view.domains[d] = { ...view.domains[d], ...row };
    }
    for (const [sid, seg] of Object.entries(p.stagesPatch ?? {})) {
      view.stages[sid] = seg;
    }
    if (p.overallNote) view.overallNote = p.overallNote;
  };
  for (const rec of state.completed) {
    const st = stepById(story, rec.stepId);
    // 步骤级 patch（补充动作挂出的"未通过"状态）
    if (st?.viewPatch && maxMilestone < st.viewPatch.ceilingMilestoneIndex) {
      applyPatch(st.viewPatch.patch ?? {});
    }
    // 决定级 patch：退回决定立即生效（不等到补充动作完成），窗口到汇合里程碑
    if (rec.decision !== undefined && st?.kind === 'human-decision') {
      const opt = (st.decisionOptions ?? []).find((o) => o.decision === rec.decision);
      if (opt?.viewPatch && maxMilestone < opt.viewPatch.ceilingMilestoneIndex) {
        applyPatch(opt.viewPatch.patch ?? {});
      }
    }
  }
  view.terminal = state.completed.some((r) => r.stepId === story.terminalStepId);
  return view;
}

/**
 * 演示消息流（完成顺序）：已完成步骤的预设消息 + 决定效果消息。
 * 不含任何时间戳（确定性）；展示层可自行标注显示时间。
 */
export function storyMessages(story, state) {
  const actors = story.actors ?? {};
  const mapMsg = (m, stepId) => {
    const a = actors[m.actor] ?? { fromKind: 'system', fromName: m.actor };
    return { stepId, fromKind: a.fromKind, fromName: a.fromName, text: m.text, marks: [...(m.marks ?? [])] };
  };
  const out = [];
  for (const rec of state.completed) {
    const st = stepById(story, rec.stepId);
    if (!st) continue;
    for (const m of st.messages ?? []) out.push(mapMsg(m, st.stepId));
    if (rec.decision !== undefined) {
      const opt = (st.decisionOptions ?? []).find((o) => o.decision === rec.decision);
      for (const m of opt?.effects?.messages ?? []) out.push(mapMsg(m, st.stepId));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 证据版本查询 / 引用校验
// ---------------------------------------------------------------------------

/**
 * @returns {{docId:string,title:string,validVersion:number,versions:Array<{version:number,state:string}>}|null}
 */
export function evidenceState(state, docId) {
  const doc = state.evidence[docId];
  if (!doc) return null;
  const valid = [...doc.versions].filter((v) => v.state === 'valid').sort((a, b) => b.version - a.version)[0];
  return { docId: doc.docId, title: doc.title, validVersion: valid?.version ?? null, versions: doc.versions.map((v) => ({ ...v })) };
}

/** 引用校验：引用已作废版本 → 明确拒绝（纠正后旧版本不再有效）。 */
export function assertEvidenceCite(state, docId, version) {
  const doc = state.evidence[docId];
  if (!doc) return fail('UNKNOWN_DOC', `未知证据：${docId}`);
  const v = doc.versions.find((x) => x.version === version);
  if (!v) return fail('UNKNOWN_DOC', `证据 ${docId} 无版本 v${version}`);
  if (v.state === 'superseded') {
    const valid = doc.versions.filter((x) => x.state === 'valid').map((x) => `v${x.version}`).join('、');
    return fail('EVIDENCE_VERSION_SUPERSEDED', `证据 ${docId} v${version} 已被更正取代，不再有效（当前有效版本：${valid}）；历史原文保留可追溯，引用请使用当前有效版本`);
  }
  return { ok: true, value: { docId, version, state: v.state } };
}

/** 意见是否已作废。 */
export function isOpinionInvalidated(state, opinionId) {
  return state.invalidatedOpinions.includes(opinionId);
}

// ---------------------------------------------------------------------------
// 快照 / 恢复
// ---------------------------------------------------------------------------

/**
 * 可序列化快照（只含完成记录；其余状态由 story 确定性重建）。
 */
export function snapshot(state) {
  return {
    schema: SNAPSHOT_SCHEMA,
    storyId: state.storyId,
    completed: state.completed.map((r) => ({
      stepId: r.stepId,
      requestId: r.requestId,
      kind: r.kind,
      ...(r.decision !== undefined ? { decision: r.decision } : {}),
      ...(r.outcome !== undefined ? { outcome: r.outcome } : {}),
    })),
  };
}

/**
 * 校验并恢复快照。任何不一致（schema/story 不符、记录损坏、决定非法、请求重复）
 * 都返回明确错误码，不猜测、不部分恢复。
 * @returns {{ok:true,state:object}|{ok:false,code:string,message:string}}
 */
export function restore(story, snap) {
  if (!isPlainObject(snap)) return fail('SNAPSHOT_CORRUPT', '快照必须是对象');
  if (snap.schema !== SNAPSHOT_SCHEMA) return fail('SNAPSHOT_CORRUPT', `快照 schema 非法：${JSON.stringify(snap.schema)}`);
  if (snap.storyId !== story.storyId) return fail('STORY_MISMATCH', `快照属于 ${snap.storyId}，与当前 story ${story.storyId} 不匹配`);
  if (!Array.isArray(snap.completed)) return fail('SNAPSHOT_CORRUPT', '快照 completed 必须为数组');

  let state = newStoryState(story);
  const seenRequests = new Set();
  for (const rec of snap.completed) {
    if (!isPlainObject(rec) || typeof rec.stepId !== 'string' || typeof rec.requestId !== 'string' || rec.requestId.length === 0) {
      return fail('SNAPSHOT_CORRUPT', '完成记录缺少 stepId/requestId');
    }
    if (seenRequests.has(rec.requestId)) return fail('SNAPSHOT_CORRUPT', `快照内 requestId 重复：${rec.requestId}`);
    seenRequests.add(rec.requestId);
    const st = stepById(story, rec.stepId);
    if (!st) return fail('SNAPSHOT_CORRUPT', `快照引用不存在的步骤：${rec.stepId}`);
    if (recordFor(state, rec.stepId)) return fail('SNAPSHOT_CORRUPT', `快照内步骤重复：${rec.stepId}`);
    const kind = rec.kind ?? st.kind;
    if (kind !== st.kind) return fail('SNAPSHOT_CORRUPT', `步骤 ${rec.stepId} kind 与 story 不符：${kind} ≠ ${st.kind}`);
    if (st.kind === 'human-decision') {
      const opt = (st.decisionOptions ?? []).find((o) => o.decision === rec.decision);
      if (!opt) return fail('SNAPSHOT_CORRUPT', `步骤 ${rec.stepId} 的决定「${rec.decision}」不在可选项内`);
      if (rec.outcome !== opt.outcome) return fail('SNAPSHOT_CORRUPT', `步骤 ${rec.stepId} 的 outcome 与 story 不符`);
    } else if (rec.decision !== undefined) {
      return fail('SNAPSHOT_CORRUPT', `非决定步骤 ${rec.stepId} 携带 decision`);
    }
    // 按快照顺序重放（不校验前提顺序：快照可能来自任意合法路径的终态，
    // 前提一致性由重放后的整体校验兜底——见下方前置检查）。
    const record = {
      stepId: rec.stepId,
      requestId: rec.requestId,
      kind: st.kind,
      ...(st.kind === 'human-decision' ? { decision: rec.decision, outcome: rec.outcome } : {}),
    };
    state = commit(story, state, { ...record, _step: st });
  }
  // 重放完成后整体校验：每个完成步骤的前提必须被更早完成的步骤满足
  //（完成序 = 快照序，前提若被满足则必然在其之前完成）。
  for (let i = 0; i < state.completed.length; i++) {
    const rec = state.completed[i];
    const st = stepById(story, rec.stepId);
    const prior = { ...state, completed: state.completed.slice(0, i) };
    for (const r of st.requires ?? []) {
      if (!prereqSatisfied(prior, r)) {
        return fail('SNAPSHOT_CORRUPT', `快照顺序非法：${rec.stepId} 的前提 ${reqEntryId(r)} 未在其之前按所需结果完成`);
      }
    }
    const any = st.requiresAny ?? [];
    if (any.length > 0 && !any.some((r) => prereqSatisfied(prior, r))) {
      return fail('SNAPSHOT_CORRUPT', `快照顺序非法：${rec.stepId} 的可选前提均未在其之前完成`);
    }
  }
  return { ok: true, state };
}
