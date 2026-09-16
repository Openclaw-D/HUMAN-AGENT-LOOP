// V7 A · 服务层（CONTRACT §2–§4）：项目/证据/规则/运行事实源 + 人工动作 + 请求回执。
// 全部写命令 = reload(重读盘) → 幂等查询 → 版本门 → 同步改写 → 原子落盘（无 await 穿插，单进程天然串行）。
// 权威分离：opinion/calculation 结构校验拒绝禁用键（结构层强制 authority=none）；
// human action 仅接受 actorRole:"human"；正式状态只随 human action 变化。
// 失效按输入版本：opinion 基于 evidence 版本、run 基于 factVersion 快照，读取时现算 stale。

import {
  IdempotencyTable, conflict, forbidden, invalid, notFound, openStore, payloadHash, sha256,
} from './store.mjs';

const SCHEMA_FACTS = 'v7-a-facts@1';
const SCHEMA_RUNS = 'v7-a-runs@1';

const RUN_STATES = ['pending', 'candidate_ready', 'human_required', 'unknown', 'failed', 'resolved'];
const ESCALATION_STATES = ['human_required', 'unknown', 'failed'];
const HUMAN_ACTIONS = ['accept_candidate', 'return_for_evidence', 'take_over'];
const RECOMMENDED_ACTIONS = ['accept_candidate', 'return_for_evidence', 'take_over', 'need_more_evidence'];
const PROVIDERS = ['simulation', 'real_http'];
// 结构层权威分离：candidate 不得携带审批/额度/价格语义键（CONTRACT §2 硬规则）。
const FORBIDDEN_KEY_RE = /approv|decision|quota|price|rate\b|reject/i;
const CANDIDATE_ARRAY_KEYS = ['observations', 'evidenceRefs', 'assumptions', 'uncertainty'];

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function reqString(value, label, max = 2000, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    invalid(`${label} 必须是非空 string（≤${max}）`);
  }
  return value;
}

function reqInt(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid(`${label} 必须是非负整数`);
  return value;
}

function reqStringArray(value, label) {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0)) {
    invalid(`${label} 必须是非空 string 数组`);
  }
  return value;
}

/** 幂等统一入口：miss 返回 null（调用方继续写），replay 返回 {response, replayed:true}，异载荷抛 REQUEST_MISMATCH。 */
function checkIdempotency(state, input) {
  const { requestId, ...rest } = input;
  const hash = payloadHash({ requestId, ...rest });
  const hit = state.idempotency.lookup(requestId, hash);
  if (hit.kind === 'replay') return { response: { ...hit.response, replayed: true } };
  return { hash };
}

// ---------------------------------------------------------------------------
// facts store（projects / evidence / ruleVersions）
// ---------------------------------------------------------------------------

function validateFacts(parsed, corrupt) {
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.ruleVersions)) {
    throw corrupt('projects/evidence/ruleVersions 必须是数组');
  }
  if (!Number.isInteger(parsed.version) || parsed.version < 0) throw corrupt('version 必须是非负整数');
  for (const [i, p] of parsed.projects.entries()) {
    if (p === null || typeof p !== 'object') throw corrupt(`projects[${i}] 必须是对象`);
    for (const k of ['projectId', 'name', 'createdAt', 'updatedAt']) {
      if (typeof p[k] !== 'string' || p[k].length === 0) throw corrupt(`projects[${i}].${k} 必须是非空 string`);
    }
    if (!Number.isInteger(p.factVersion) || p.factVersion < 1) throw corrupt(`projects[${i}].factVersion 必须是 ≥1 整数`);
  }
  for (const [i, e] of parsed.evidence.entries()) {
    if (e === null || typeof e !== 'object') throw corrupt(`evidence[${i}] 必须是对象`);
    for (const k of ['evidenceId', 'projectId', 'kind', 'sha256', 'capturedAt']) {
      if (typeof e[k] !== 'string' || e[k].length === 0) throw corrupt(`evidence[${i}].${k} 必须是非空 string`);
    }
    if (!Number.isInteger(e.version) || e.version < 1) throw corrupt(`evidence[${i}].version 必须是 ≥1 整数`);
    if (!Number.isInteger(e.factVersion) || e.factVersion < 1) throw corrupt(`evidence[${i}].factVersion 必须是 ≥1 整数`);
    if (e.supersedes !== null && typeof e.supersedes !== 'string') throw corrupt(`evidence[${i}].supersedes 非法`);
    if (e.supersededBy !== null && typeof e.supersededBy !== 'string') throw corrupt(`evidence[${i}].supersededBy 非法`);
    if (e.content === null || typeof e.content !== 'object' || Array.isArray(e.content)) throw corrupt(`evidence[${i}].content 必须是对象`);
  }
  for (const [i, r] of parsed.ruleVersions.entries()) {
    if (r === null || typeof r !== 'object') throw corrupt(`ruleVersions[${i}] 必须是对象`);
    if (!Number.isInteger(r.version) || r.version < 1) throw corrupt(`ruleVersions[${i}].version 必须是 ≥1 整数`);
    if (r.status !== 'published') throw corrupt(`ruleVersions[${i}].status 必须 published`);
    for (const k of ['indicators', 'allowedTools', 'humanEscalation']) {
      if (!Array.isArray(r[k]) || r[k].some((v) => typeof v !== 'string')) throw corrupt(`ruleVersions[${i}].${k} 必须是 string 数组`);
    }
    if (typeof r.notes !== 'string' || typeof r.publishedAt !== 'string') throw corrupt(`ruleVersions[${i}].notes/publishedAt 非法`);
  }
  return { version: parsed.version, projects: parsed.projects, evidence: parsed.evidence, ruleVersions: parsed.ruleVersions };
}

export function openFactsStore(dataDir) {
  return openStore({
    dataDir,
    fileName: 'facts.json',
    schema: SCHEMA_FACTS,
    seed: () => ({ version: 0, projects: [], evidence: [], ruleVersions: [] }),
    validate: validateFacts,
  });
}

export function createFactsService(factsStore) {
  function createProject(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const name = reqString(input.name, 'name', 120);
    const state = factsStore.reload();
    const idem = checkIdempotency(state, { requestId, name, op: 'create-project' });
    if (idem.response) return idem.response;
    const at = nowIso();
    const project = { projectId: newId('p'), name, factVersion: 1, createdAt: at, updatedAt: at };
    state.projects.push(project);
    state.version += 1;
    const response = { ok: true, project, storeVersion: state.version };
    state.idempotency.record(requestId, idem.hash, response);
    factsStore.save(state);
    return response;
  }

  function getProject(projectId) {
    const state = factsStore.reload();
    return projectView(state, projectId);
  }

  function attachEvidence(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const projectId = reqString(input.projectId, 'projectId', 64);
    const expectedVersion = reqInt(input.expectedVersion, 'expectedVersion');
    const kind = reqString(input.kind, 'kind', 64);
    if (input.content === null || typeof input.content !== 'object' || Array.isArray(input.content)) {
      invalid('content 必须是对象');
    }
    const content = input.content;
    const state = factsStore.reload();
    const project = findProject(state, projectId);
    const idem = checkIdempotency(state, { requestId, projectId, expectedVersion, kind, content, op: 'attach-evidence' });
    if (idem.response) return idem.response;
    if (expectedVersion !== project.factVersion) {
      conflict('VERSION_CONFLICT', `项目事实版本已更新：客户端 v${expectedVersion}，服务端 v${project.factVersion}`, project.factVersion);
    }
    const at = nowIso();
    project.factVersion += 1;
    project.updatedAt = at;
    const evidence = {
      evidenceId: newId('ev'), projectId, version: 1, kind, content,
      sha256: sha256(JSON.stringify({ kind, content })),
      supersedes: null, supersededBy: null, factVersion: project.factVersion, capturedAt: at,
    };
    state.evidence.push(evidence);
    state.version += 1;
    const response = { ok: true, evidence, projectFactVersion: project.factVersion, storeVersion: state.version };
    state.idempotency.record(requestId, idem.hash, response);
    factsStore.save(state);
    return response;
  }

  function supersedeEvidence(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const projectId = reqString(input.projectId, 'projectId', 64);
    const evidenceId = reqString(input.evidenceId, 'evidenceId', 64);
    const expectedVersion = reqInt(input.expectedVersion, 'expectedVersion');
    if (input.content === null || typeof input.content !== 'object' || Array.isArray(input.content)) {
      invalid('content 必须是对象');
    }
    const content = input.content;
    const state = factsStore.reload();
    const project = findProject(state, projectId);
    const old = state.evidence.find((e) => e.evidenceId === evidenceId);
    if (old === undefined || old.projectId !== projectId) notFound('证据不存在（跨项目不可访问）');
    const idem = checkIdempotency(state, { requestId, projectId, evidenceId, expectedVersion, content, op: 'supersede-evidence' });
    if (idem.response) return idem.response;
    if (expectedVersion !== project.factVersion) {
      conflict('VERSION_CONFLICT', `项目事实版本已更新：客户端 v${expectedVersion}，服务端 v${project.factVersion}`, project.factVersion);
    }
    if (old.supersededBy !== null) conflict('EVIDENCE_SUPERSEDED', `该证据已被 ${old.supersededBy} 取代`, project.factVersion);
    const at = nowIso();
    project.factVersion += 1;
    project.updatedAt = at;
    const replacement = {
      evidenceId: newId('ev'), projectId, version: 1, kind: old.kind, content,
      sha256: sha256(JSON.stringify({ kind: old.kind, content })),
      supersedes: evidenceId, supersededBy: null, factVersion: project.factVersion, capturedAt: at,
    };
    old.supersededBy = replacement.evidenceId;
    state.evidence.push(replacement);
    state.version += 1;
    const response = { ok: true, evidence: replacement, superseded: evidenceId, projectFactVersion: project.factVersion, storeVersion: state.version };
    state.idempotency.record(requestId, idem.hash, response);
    factsStore.save(state);
    return response;
  }

  function publishRule(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const indicators = reqStringArray(input.indicators, 'indicators');
    const allowedTools = reqStringArray(input.allowedTools, 'allowedTools');
    const humanEscalation = reqStringArray(input.humanEscalation, 'humanEscalation');
    const notes = reqString(input.notes ?? '', 'notes', 2000, 0);
    const state = factsStore.reload();
    const idem = checkIdempotency(state, { requestId, indicators, allowedTools, humanEscalation, notes, op: 'publish-rule' });
    if (idem.response) return idem.response;
    const version = state.ruleVersions.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const rule = { version, status: 'published', indicators, allowedTools, humanEscalation, notes, publishedAt: nowIso() };
    state.ruleVersions.push(rule);
    state.version += 1;
    const response = { ok: true, ruleVersion: rule, storeVersion: state.version };
    state.idempotency.record(requestId, idem.hash, response);
    factsStore.save(state);
    return response;
  }

  function getRule(version) {
    const state = factsStore.reload();
    const rule = state.ruleVersions.find((r) => r.version === version);
    if (rule === undefined) notFound(`规则版本 ${version} 不存在`);
    return { ok: true, ruleVersion: rule };
  }

  function listRules() {
    const state = factsStore.reload();
    return { ok: true, ruleVersions: state.ruleVersions };
  }

  return { createProject, getProject, attachEvidence, supersedeEvidence, publishRule, getRule, listRules };
}

function findProject(state, projectId) {
  const project = state.projects.find((p) => p.projectId === projectId);
  if (project === undefined) notFound('项目不存在');
  return project;
}

/** 项目投影：证据链状态现算（current/superseded），不删除历史。 */
function projectView(state, projectId) {
  const project = findProject(state, projectId);
  const evidence = state.evidence
    .filter((e) => e.projectId === projectId)
    .map((e) => ({ ...e, current: e.supersededBy === null }));
  return { ok: true, project: { ...project }, evidence, projectFactVersion: project.factVersion };
}

// ---------------------------------------------------------------------------
// runs store（run / opinions / humanActions）
// ---------------------------------------------------------------------------

function validateRuns(parsed, corrupt) {
  if (!Array.isArray(parsed.runs)) throw corrupt('runs 必须是数组');
  if (!Number.isInteger(parsed.version) || parsed.version < 0) throw corrupt('version 必须是非负整数');
  for (const [i, r] of parsed.runs.entries()) {
    if (r === null || typeof r !== 'object') throw corrupt(`runs[${i}] 必须是对象`);
    for (const k of ['runId', 'projectId', 'createdAt', 'updatedAt']) {
      if (typeof r[k] !== 'string' || r[k].length === 0) throw corrupt(`runs[${i}].${k} 必须是非空 string`);
    }
    if (!Number.isInteger(r.ruleVersion) || r.ruleVersion < 1) throw corrupt(`runs[${i}].ruleVersion 必须 ≥1 整数`);
    if (!Number.isInteger(r.factVersion) || r.factVersion < 1) throw corrupt(`runs[${i}].factVersion 必须 ≥1 整数`);
    if (!Number.isInteger(r.version) || r.version < 1) throw corrupt(`runs[${i}].version 必须 ≥1 整数`);
    if (!RUN_STATES.includes(r.state)) throw corrupt(`runs[${i}].state 非法`);
    if (!Array.isArray(r.inputs)) throw corrupt(`runs[${i}].inputs 必须是数组`);
    if (!Array.isArray(r.opinions)) throw corrupt(`runs[${i}].opinions 必须是数组`);
    if (!Array.isArray(r.humanActions)) throw corrupt(`runs[${i}].humanActions 必须是数组`);
    for (const [j, o] of r.opinions.entries()) {
      if (o === null || typeof o !== 'object') throw corrupt(`runs[${i}].opinions[${j}] 必须是对象`);
      if (o.authority !== 'none') throw corrupt(`runs[${i}].opinions[${j}].authority 必须 "none"`);
      if (!PROVIDERS.includes(o.provider)) throw corrupt(`runs[${i}].opinions[${j}].provider 非法`);
      if (typeof o.requestReceipt !== 'string' || o.requestReceipt.length === 0) throw corrupt(`runs[${i}].opinions[${j}].requestReceipt 非法`);
      validateCandidateShape(o.candidate, `runs[${i}].opinions[${j}].candidate`, corrupt);
    }
    for (const [j, h] of r.humanActions.entries()) {
      if (h === null || typeof h !== 'object') throw corrupt(`runs[${i}].humanActions[${j}] 必须是对象`);
      if (!HUMAN_ACTIONS.includes(h.action)) throw corrupt(`runs[${i}].humanActions[${j}].action 非法`);
      if (h.actorRole !== 'human') throw corrupt(`runs[${i}].humanActions[${j}].actorRole 必须 "human"`);
      if (typeof h.actorName !== 'string' || h.actorName.length === 0) throw corrupt(`runs[${i}].humanActions[${j}].actorName 非法`);
    }
  }
  return { version: parsed.version, runs: parsed.runs };
}

/** candidate 结构校验：键白名单 + 数组类型 + 推荐动作枚举 + 禁用键（权威分离，结构层强制）。 */
function validateCandidateShape(candidate, label, thrower = invalid) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    thrower(`${label} 必须是对象`);
  }
  const allowed = new Set([...CANDIDATE_ARRAY_KEYS, 'recommendedHumanAction']);
  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_KEY_RE.test(key)) thrower(`${label} 携带禁用键 "${key}"（模型/计算不得承载审批语义字段）`);
    if (!allowed.has(key)) thrower(`${label} 携带未登记键 "${key}"（candidate 只允许 ${[...allowed].join('/')}）`);
  }
  for (const key of CANDIDATE_ARRAY_KEYS) {
    if (candidate[key] !== undefined) reqStringArray(candidate[key], `${label}.${key}`);
  }
  const action = candidate.recommendedHumanAction;
  if (action !== undefined && !RECOMMENDED_ACTIONS.includes(action)) {
    thrower(`${label}.recommendedHumanAction 必须是 ${RECOMMENDED_ACTIONS.join('/')} 之一`);
  }
  return candidate;
}

export function openRunsStore(dataDir) {
  return openStore({
    dataDir,
    fileName: 'runs.json',
    schema: SCHEMA_RUNS,
    seed: () => ({ version: 0, runs: [] }),
    validate: validateRuns,
  });
}

export function openRunsService(runsStore, factsStore, { principalVerifier = null } = {}) {
  function createRun(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const projectId = reqString(input.projectId, 'projectId', 64);
    const ruleVersion = reqInt(input.ruleVersion, 'ruleVersion');
    if (!Array.isArray(input.inputEvidence)) invalid('inputEvidence 必须是数组');
    const inputEvidence = input.inputEvidence.map((e, i) => ({
      evidenceId: reqString(e?.evidenceId, `inputEvidence[${i}].evidenceId`, 64),
      version: reqInt(e?.version, `inputEvidence[${i}].version`),
    }));
    const state = runsStore.reload();
    const idem = checkIdempotency(state, { requestId, projectId, ruleVersion, inputEvidence, op: 'create-run' });
    if (idem.response) return idem.response;

    // 对 facts 只读校验（跨存储无事务：本命令只写 runs store）。
    const facts = factsStore.reload();
    const project = facts.projects.find((p) => p.projectId === projectId);
    if (project === undefined) notFound('项目不存在');
    const rule = facts.ruleVersions.find((r) => r.version === ruleVersion);
    if (rule === undefined) notFound(`规则版本 ${ruleVersion} 不存在`);
    for (const ref of inputEvidence) {
      const ev = facts.evidence.find((e) => e.evidenceId === ref.evidenceId);
      if (ev === undefined || ev.projectId !== projectId) notFound(`证据 ${ref.evidenceId} 不存在（跨项目不可访问）`);
      if (ev.version !== ref.version) {
        conflict('VERSION_CONFLICT', `证据 ${ref.evidenceId} 版本已变化：请求 v${ref.version}，服务端 v${ev.version}`, project.factVersion);
      }
      if (ev.supersededBy !== null) conflict('EVIDENCE_SUPERSEDED', `证据 ${ref.evidenceId} 已被 ${ev.supersededBy} 取代，不可作为运行输入`, project.factVersion);
    }

    const at = nowIso();
    const run = {
      runId: newId('run'), projectId, ruleVersion, factVersion: project.factVersion,
      inputs: inputEvidence, state: 'pending', calculation: null, opinions: [], humanActions: [],
      version: 1, createdAt: at, updatedAt: at,
    };
    state.runs.push(run);
    state.version += 1;
    const response = { ok: true, run, storeVersion: state.version };
    state.idempotency.record(requestId, idem.hash, response);
    runsStore.save(state);
    return response;
  }

  function getRun(runId) {
    const runs = runsStore.reload();
    const facts = factsStore.reload();
    return runView(runs, facts, runId);
  }

  function addOpinion(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const runId = reqString(input.runId, 'runId', 64);
    const expectedVersion = reqInt(input.expectedVersion, 'expectedVersion');
    const provider = reqString(input.provider, 'provider', 20);
    if (!PROVIDERS.includes(provider)) invalid(`provider 必须是 ${PROVIDERS.join('/')} 之一`);
    const requestReceipt = reqString(input.requestReceipt, 'requestReceipt', 200);
    validateCandidateShape(input.candidate, 'candidate');
    if (!Array.isArray(input.basedOnEvidence)) invalid('basedOnEvidence 必须是数组');
    const basedOnEvidence = input.basedOnEvidence.map((e, i) => ({
      evidenceId: reqString(e?.evidenceId, `basedOnEvidence[${i}].evidenceId`, 64),
      version: reqInt(e?.version, `basedOnEvidence[${i}].version`),
    }));
    const state = runsStore.reload();
    const run = findRun(state, runId);
    const idem = checkIdempotency(state, { requestId, runId, expectedVersion, provider, requestReceipt, candidate: input.candidate, basedOnEvidence, op: 'add-opinion' });
    if (idem.response) return idem.response;
    requireVersion(run, expectedVersion);
    // D-4（CONTRACT v0.2 码位澄清）：升级态（human_required/unknown/failed）= 已交回人 → 409 RUN_ESCALATED；
    // resolved = 终态 → 409 RUN_RESOLVED（与人工动作终态保护同码；消费方按码分支不混淆）。
    // 意见仅可写入 pending/candidate_ready；状态门先于证据引用校验（同批伪造引用在升级态返回状态码）。
    if (run.state === 'resolved') {
      conflict('RUN_RESOLVED', '运行已由人工动作结束（resolved，终态）：意见不可写入；如需重新处理请新建运行', run.version);
    }
    if (run.state !== 'pending' && run.state !== 'candidate_ready') {
      conflict('RUN_ESCALATED', `运行当前状态为 ${run.state}：意见仅在 pending/candidate_ready 可写（升级态已交回人工）`, run.version);
    }
    // D-5（REPAIR v0.1）：证据引用失败关闭——basedOnEvidence 必须指向同项目存在且版本一致的证据；
    // candidate.evidenceRefs 每个 token（@vN 前缀）必须指向存在的证据。伪造引用一律 400。
    const facts = factsStore.reload();
    for (const ref of basedOnEvidence) {
      const ev = facts.evidence.find((e) => e.evidenceId === ref.evidenceId);
      if (ev === undefined || ev.projectId !== run.projectId) {
        invalid(`basedOnEvidence 引用不存在的证据：${ref.evidenceId}（伪造引用被拒绝）`);
      }
      if (ev.version !== ref.version) {
        invalid(`basedOnEvidence 版本不符：${ref.evidenceId} 请求 v${ref.version}，服务端 v${ev.version}`);
      }
    }
    for (const token of input.candidate.evidenceRefs ?? []) {
      const evidenceId = String(token).split('@')[0];
      const ev = facts.evidence.find((e) => e.evidenceId === evidenceId);
      if (ev === undefined || ev.projectId !== run.projectId) {
        invalid(`candidate.evidenceRefs 引用不存在的证据：${token}（伪造引用被拒绝）`);
      }
    }
    const opinion = {
      opinionId: newId('op'), authority: 'none', provider, requestReceipt,
      candidate: input.candidate, basedOnEvidence, at: nowIso(),
    };
    run.opinions.push(opinion);
    if (run.state === 'pending') run.state = 'candidate_ready';
    run.version += 1;
    run.updatedAt = nowIso();
    const response = { ok: true, opinion, runVersion: run.version, runState: run.state };
    state.idempotency.record(requestId, idem.hash, response);
    runsStore.save(state);
    return response;
  }

  function setCalculation(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const runId = reqString(input.runId, 'runId', 64);
    const expectedVersion = reqInt(input.expectedVersion, 'expectedVersion');
    const toolVersion = reqString(input.toolVersion, 'toolVersion', 64);
    const inputHash = reqString(input.inputHash, 'inputHash', 128);
    if (input.output === null || typeof input.output !== 'object' || Array.isArray(input.output)) invalid('output 必须是对象');
    const assumptions = reqStringArray(input.assumptions ?? [], 'assumptions');
    const computedBy = reqString(input.computedBy ?? 'calculation-tool', 'computedBy', 64, 1);
    const state = runsStore.reload();
    const run = findRun(state, runId);
    const idem = checkIdempotency(state, { requestId, runId, expectedVersion, toolVersion, inputHash, output: input.output, assumptions, computedBy, op: 'set-calculation' });
    if (idem.response) return idem.response;
    requireVersion(run, expectedVersion);
    run.calculation = { toolVersion, inputHash, output: input.output, assumptions, computedAt: nowIso(), computedBy };
    run.version += 1;
    run.updatedAt = nowIso();
    const response = { ok: true, calculation: run.calculation, runVersion: run.version };
    state.idempotency.record(requestId, idem.hash, response);
    runsStore.save(state);
    return response;
  }

  function escalate(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const runId = reqString(input.runId, 'runId', 64);
    const expectedVersion = reqInt(input.expectedVersion, 'expectedVersion');
    const nextState = input.state;
    if (!ESCALATION_STATES.includes(nextState)) invalid(`state 必须是 ${ESCALATION_STATES.join('/')} 之一`);
    const reason = reqString(input.reason, 'reason', 500);
    const state = runsStore.reload();
    const run = findRun(state, runId);
    const idem = checkIdempotency(state, { requestId, runId, expectedVersion, state: nextState, reason, op: 'escalate' });
    if (idem.response) return idem.response;
    requireVersion(run, expectedVersion);
    if (run.state === 'resolved') invalid('运行已由人工动作结束（resolved），不可再升级');
    run.state = nextState;
    run.version += 1;
    run.updatedAt = nowIso();
    const response = { ok: true, runState: run.state, runVersion: run.version, reason };
    state.idempotency.record(requestId, idem.hash, response);
    runsStore.save(state);
    return response;
  }

  function addHumanAction(input) {
    const requestId = reqString(input.requestId, 'requestId', 64);
    const runId = reqString(input.runId, 'runId', 64);
    const expectedVersion = reqInt(input.expectedVersion, 'expectedVersion');
    const action = input.action;
    if (!HUMAN_ACTIONS.includes(action)) invalid(`action 必须是 ${HUMAN_ACTIONS.join('/')} 之一`);
    // 权威分离第一层：正式动作仅人类角色字段（模型/Agent 自称即拒）。
    if (input.actorRole !== 'human') forbidden('正式动作仅授权人类角色（actorRole 必须 "human"；模型/Agent 无审批权）');
    const actorName = reqString(input.actorName, 'actorName', 64);
    const note = reqString(input.note ?? '', 'note', 2000, 0);
    // D-6（REPAIR v0.1）权威分离第二层：actorRole 字段不是认证。正式动作必须携带可信
    // principal 凭据，经注入的 principalVerifier 验证；未配置身份源 = 默认失败关闭
    //（403 PRINCIPAL_UNTRUSTED），自声明 "human" 不构成授权。模块层调用与 HTTP 同界，不可绕过。
    if (typeof principalVerifier !== 'function') {
      conflict('PRINCIPAL_UNTRUSTED', '无可信服务端身份验证：正式动作失败关闭。需在服务构造时注入 principalVerifier 并提供凭据');
    }
    const credential = input.principalCredential;
    if (typeof credential !== 'string' || credential.length === 0) {
      conflict('PRINCIPAL_UNTRUSTED', '缺少 principalCredential：正式动作需要可信身份凭据（自声明 actorRole 不构成授权）');
    }
    let verdict;
    try {
      verdict = principalVerifier(credential); // 同步验证器（写路径保持全同步串行纪律；异步身份源属 v0.1 后升级项）
    } catch (error) {
      conflict('PRINCIPAL_UNTRUSTED', `principal 验证器异常：${error instanceof Error ? error.message : String(error)}（失败关闭）`);
    }
    if (!verdict || verdict.ok !== true || verdict.role !== 'human') {
      conflict('PRINCIPAL_UNTRUSTED', 'principal 凭据验证失败：正式动作被拒绝');
    }
    const principalId = verdict.principalId ?? 'principal';
    const state = runsStore.reload();
    const run = findRun(state, runId);
    const idem = checkIdempotency(state, { requestId, runId, expectedVersion, action, actorRole: input.actorRole, actorName, note, op: 'human-action' });
    if (idem.response) return idem.response;
    requireVersion(run, expectedVersion);
    // D-3（REPAIR v0.1）：resolved 为终态——不可追加人工动作（追加会改写 formalOutcome）；
    // 重新处理 = 以当前项目事实新建运行（不发明业务重开制度）。
    if (run.state === 'resolved') {
      conflict('RUN_RESOLVED', '运行已由人工动作结束（resolved，终态）：不可追加动作或改写正式结果；如需重新处理请新建运行', run.version);
    }
    const record = { actionId: newId('ha'), action, actorRole: 'human', actorName, principalId, note, basedOnRunVersion: run.version, at: nowIso() };
    run.humanActions.push(record);
    run.state = action === 'return_for_evidence' ? 'pending' : 'resolved';
    run.version += 1;
    run.updatedAt = nowIso();
    const response = { ok: true, humanAction: record, runState: run.state, runVersion: run.version, formalOutcome: record };
    state.idempotency.record(requestId, idem.hash, response);
    runsStore.save(state);
    return response;
  }

  /** 回执查询（跨端一致性辅助）：两 store 各自幂等表按 requestId 查找。 */
  function getReceipt(requestId, store) {
    if (store === 'facts' || store === undefined) {
      const state = factsStore.reload();
      const entry = state.idempotency.entries.get(requestId);
      if (entry !== undefined) {
        const hit = state.idempotency.lookup(requestId, entry.hash);
        if (hit.kind === 'replay') return { ok: true, found: true, store: 'facts', receipt: hit.response, replayed: true };
      }
    }
    if (store === 'runs' || store === undefined) {
      const state = runsStore.reload();
      const entry = state.idempotency.entries.get(requestId);
      if (entry !== undefined) {
        const hit = state.idempotency.lookup(requestId, entry.hash);
        if (hit.kind === 'replay') return { ok: true, found: true, store: 'runs', receipt: hit.response, replayed: true };
      }
    }
    return { ok: true, found: false };
  }

  return { createRun, getRun, addOpinion, setCalculation, escalate, addHumanAction, getReceipt };
}

function findRun(state, runId) {
  const run = state.runs.find((r) => r.runId === runId);
  if (run === undefined) notFound('运行不存在');
  return run;
}

function requireVersion(run, expectedVersion) {
  if (expectedVersion !== run.version) {
    conflict('VERSION_CONFLICT', `运行版本已更新：客户端 v${expectedVersion}，服务端 v${run.version}`, run.version);
  }
}

/** run 投影：失效按输入版本现算——opinion 引用的证据被取代 → stale；项目 factVersion 前进 → run 顶层 stale。
 *  正式结果 formalOutcome = 最近一条 humanAction（模型意见永不改变它）。 */
function runView(runsState, factsState, runId) {
  const run = findRun(runsState, runId);
  const project = factsState.projects.find((p) => p.projectId === run.projectId);
  const evidenceById = new Map(factsState.evidence.map((e) => [e.evidenceId, e]));
  const isSuperseded = (ref) => {
    const ev = evidenceById.get(ref.evidenceId);
    return ev === undefined ? true : ev.supersededBy !== null;
  };
  const opinions = run.opinions.map((o) => ({
    ...o,
    stale: o.basedOnEvidence.length > 0 && o.basedOnEvidence.some(isSuperseded),
  }));
  const runStale = project !== undefined && project.factVersion > run.factVersion;
  const formalOutcome = run.humanActions.length > 0 ? run.humanActions[run.humanActions.length - 1] : null;
  return {
    ok: true,
    run: { ...run, opinions },
    stale: runStale,
    currentProjectFactVersion: project?.factVersion ?? null,
    formalOutcome,
  };
}

/** 组装：开两个 store 并返回完整服务（HTTP 与 assembly 共用同一模块层）。
 *  opts.principalVerifier：可注入可信 principal 验证器（同步：(credential) → {ok,principalId,role}）；
 *  未注入 = 无可信身份源 → 正式动作默认失败关闭（D-6，CONTRACT §2.1）。 */
export function openServices(dataDir, opts = {}) {
  const factsStore = openFactsStore(dataDir);
  const runsStore = openRunsStore(dataDir);
  const facts = createFactsService(factsStore);
  const runs = openRunsService(runsStore, factsStore, opts);
  return { facts, runs };
}
