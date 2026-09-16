#!/usr/bin/env node
/**
 * replay-cli.mjs — R3 产品运行轨迹回放评估器（零依赖，Node >= 18）
 *
 * 输入：product-trajectory@1（docs/TRAJECTORY_SCHEMA.md；字段取自产品 remote-types.ts / remote-timeline.ts）。
 * 规则（事件/记录级确定性判定，不靠散文关键词）：
 *   R-PRE  前序越权：pre_review 阶段 formal_verification 完成，无后续人工确认
 *   R-HUMAN 人控：lifecycle_advanced 缺人工 confirm 复核
 *   R-OPIN 意见丢失：被解除关联的意见锚点，最终轨迹既不再引用也无人工裁定
 *   R-HANG 挂断断链：挂断/结束时，事件中出现过的 open 待办从最终 todos 消失（无 resolved/deferred 记录）
 *   R-VER  版本：引用不存在的 evidence/annotation 版本
 *   R-SESS 会话：记录归属非本会话
 *   R-LATE 迟到：暂停升代后旧 generation 结果仍生效
 *   R-RULE 规则升级：ruleConfig 版本变更/声明无人工授权
 *   R-DUP  重复事件：同 eventId 载荷相互矛盾（幂等重放应字节一致）
 *   R-CORRECT 关键字段纠偏：缺 before/after 或无人工确认 → 路由人工（UNDECIDED）
 *
 * 命令：
 *   node tools/replay-cli.mjs replay --trajectory <file> [--json]
 *   node tools/replay-cli.mjs selftest            # 手写控制组（pos 全过 / neg 各自触发 expectedRule）+ metamorphic
 *   node tools/replay-cli.mjs metamorphic         # 仅变换断言
 *   node tools/replay-cli.mjs manifest
 *
 * 退出码：replay 恒 0（报告工具）；selftest/metamorphic 0=全过 3=失败；用法/解析错误 2。
 * 来源纪律：meta.source=product_export 只接受 MAIN 导出路径文件；handwritten 只认 handwritten 目录——目录与标记双校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TOOL_VERSION = '1.0.0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANDWRITTEN_DIR = path.join(ROOT, 'trajectories', 'handwritten');
const MAIN_EXPORT_DIRS = [path.join(ROOT, 'trajectories', 'main-export'), path.resolve(ROOT, '..', 'R3_MAIN_20260913', 'exports', 'trajectories')];

class UsageError extends Error {}

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { throw new UsageError(`无法读取: ${file} (${e.message})`); }
  try { return JSON.parse(raw); } catch (e) { throw new UsageError(`JSON 解析失败: ${file} (${e.message})`); }
}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

/* ---------- schema 校验（允许名单，失败关闭——防未知字段走私，R2 教训） ---------- */

const TOP_KEYS = new Set(['schema', 'meta', 'session', 'evidence', 'annotations', 'reviews', 'calculations', 'timeline', 'todos', 'ruleConfig', 'expectedRule']);
const META_KEYS = new Set(['trajectoryId', 'source', 'exportedAt', 'exportTool', 'note']);
const SESSION_KEYS = new Set(['sessionId', 'projectId', 'title', 'status', 'generation', 'participants', 'video', 'createdAt', 'updatedAt']);
const PARTICIPANT_KEYS = new Set(['participantId', 'displayName', 'kind', 'domainRole', 'attendance', 'attendanceVerified', 'joined']);
const VIDEO_KEYS = new Set(['provider', 'state', 'message']);
const EVIDENCE_KEYS = new Set(['evidenceId', 'projectId', 'sessionId', 'fixtureId', 'title', 'sourceType', 'capturedAt', 'receivedAt', 'mime', 'width', 'height', 'sha256', 'version', 'supersededBy', 'supersedes', 'digestOf']);
const ANNO_KEYS = new Set(['annotationId', 'sessionId', 'evidenceId', 'evidenceVersion', 'rect', 'question', 'author', 'status', 'version', 'createdAt', 'replies']);
const REPLY_KEYS = new Set(['replyId', 'kind', 'author', 'text', 'at']);
const REVIEW_KEYS = new Set(['reviewId', 'sessionId', 'targetType', 'targetId', 'targetVersion', 'action', 'opinion', 'reviewer', 'at']);
const CALC_KEYS = new Set(['calcId', 'sessionId', 'status', 'reasons', 'inputs', 'inputDigest', 'basedOn', 'result', 'at', 'version']);
const TODO_KEYS = new Set(['todoId', 'title', 'sessionId', 'status', 'linkedOpinionIds', 'updatedAt']);
const RULE_KEYS = new Set(['version', 'status', 'layers']);
const TL_KEYS = new Set(['eventId', 'sessionId', 'at', 'atDisplay', 'actor', 'kind', 'level', 'event', 'before', 'after', 'impact']);

function rejectUnknown(obj, allow, where, errs) {
  for (const k of Object.keys(obj)) if (!allow.has(k)) errs.push(`${where} 含未知字段 "${k}"（失败关闭，防越权内容走私）`);
}
function needArr(obj, key, where, errs, required = true) {
  const v = obj[key];
  if (v === undefined) { if (required) errs.push(`${where}.${key} 缺失（必须为数组）`); return []; }
  if (!Array.isArray(v)) { errs.push(`${where}.${key} 必须为数组`); return []; }
  return v;
}
function validateTrajectory(t, file) {
  const errs = [];
  if (!isObj(t)) { errs.push('轨迹必须是JSON对象'); return errs; }
  rejectUnknown(t, TOP_KEYS, '顶层', errs);
  if (t.schema !== 'product-trajectory@1') errs.push(`schema 必须为 product-trajectory@1（得到 ${JSON.stringify(t.schema)}）`);
  if (!isObj(t.meta)) { errs.push('meta 必须为对象'); return errs; }
  rejectUnknown(t.meta, META_KEYS, 'meta', errs);
  if (!isStr(t.meta.trajectoryId)) errs.push('meta.trajectoryId 必须为非空字符串');
  if (t.meta.source !== 'product_export' && t.meta.source !== 'handwritten') errs.push('meta.source 必须为 product_export 或 handwritten');
  if (t.meta.source === 'handwritten' && !file.split(path.sep).includes('handwritten') && !file.split(path.sep).includes('runtime')) {
    errs.push('meta.source=handwritten 的轨迹必须放在 trajectories/handwritten/ 目录（目录与标记双校验）');
  }
  if (t.meta.source === 'product_export' && !file.split(path.sep).some((d) => d === 'main-export' || d === 'trajectories')) {
    errs.push('meta.source=product_export 的轨迹必须来自 MAIN 导出目录（main-export/ 或 MAIN exports/trajectories/）');
  }
  const s = t.session;
  if (!isObj(s)) { errs.push('session 必须为对象'); return errs; }
  rejectUnknown(s, SESSION_KEYS, 'session', errs);
  if (!isStr(s.sessionId)) errs.push('session.sessionId 必须为非空字符串');
  if (!isInt(s.generation) || s.generation < 1) errs.push('session.generation 必须为>=1整数');

  for (const p of needArr(s, 'participants', 'session', errs)) {
    if (!isObj(p)) { errs.push('participant 必须为对象'); continue; }
    rejectUnknown(p, PARTICIPANT_KEYS, 'session.participants', errs);
    if (!isStr(p.participantId)) errs.push('participant.participantId 必须为非空字符串');
  }
  if (!isObj(s.video)) { errs.push('session.video 必须为对象'); } else rejectUnknown(s.video, VIDEO_KEYS, 'session.video', errs);

  for (const e of needArr(t, 'evidence', '顶层', errs, false)) {
    if (!isObj(e)) { errs.push('evidence 项必须为对象'); continue; }
    rejectUnknown(e, EVIDENCE_KEYS, 'evidence', errs);
    if (!isStr(e.evidenceId)) errs.push('evidence.evidenceId 必须为非空字符串');
    if (!isInt(e.version) || e.version < 1) errs.push(`evidence ${e.evidenceId ?? '?'} version 必须为>=1整数（缺失即失败关闭）`);
  }
  for (const a of needArr(t, 'annotations', '顶层', errs, false)) {
    if (!isObj(a)) { errs.push('annotation 项必须为对象'); continue; }
    rejectUnknown(a, ANNO_KEYS, 'annotations', errs);
    if (!isStr(a.annotationId)) errs.push('annotation.annotationId 必须为非空字符串');
    if (!isInt(a.evidenceVersion)) errs.push(`annotation ${a.annotationId ?? '?'} evidenceVersion 必须为>=1整数`);
    for (const r of needArr(a, 'replies', 'annotation', errs, false)) {
      if (!isObj(r)) { errs.push('reply 必须为对象'); continue; }
      rejectUnknown(r, REPLY_KEYS, `annotation ${a.annotationId}.replies`, errs);
      if (!isStr(r.replyId)) errs.push('reply.replyId 必须为非空字符串');
    }
  }
  for (const r of needArr(t, 'reviews', '顶层', errs, false)) {
    if (!isObj(r)) { errs.push('review 项必须为对象'); continue; }
    rejectUnknown(r, REVIEW_KEYS, 'reviews', errs);
    if (!isStr(r.reviewId)) errs.push('review.reviewId 必须为非空字符串');
    if (!isInt(r.targetVersion)) errs.push(`review ${r.reviewId ?? '?'} targetVersion 必须为整数`);
  }
  for (const c of needArr(t, 'calculations', '顶层', errs, false)) {
    if (!isObj(c)) { errs.push('calculation 项必须为对象'); continue; }
    rejectUnknown(c, CALC_KEYS, 'calculations', errs);
  }
  for (const td of needArr(t, 'todos', '顶层', errs, false)) {
    if (!isObj(td)) { errs.push('todo 项必须为对象'); continue; }
    rejectUnknown(td, TODO_KEYS, 'todos', errs);
    if (!isStr(td.todoId)) errs.push('todo.todoId 必须为非空字符串');
    if (!['open', 'resolved', 'deferred'].includes(td.status)) errs.push(`todo ${td.todoId} status 非法: ${td.status}`);
  }
  if (t.ruleConfig !== undefined) {
    if (!isObj(t.ruleConfig)) errs.push('ruleConfig 必须为对象');
    else rejectUnknown(t.ruleConfig, RULE_KEYS, 'ruleConfig', errs);
  }
  for (const e of needArr(t, 'timeline', '顶层', errs, false)) {
    if (!isObj(e)) { errs.push('timeline 项必须为对象'); continue; }
    rejectUnknown(e, TL_KEYS, 'timeline', errs);
    if (!isStr(e.eventId)) errs.push('timeline.eventId 必须为非空字符串');
    if (!isStr(e.at)) errs.push(`timeline ${e.eventId} at 必须为ISO字符串`);
    else if (Number.isNaN(Date.parse(e.at))) errs.push(`timeline ${e.eventId} at 无法解析: ${e.at}`);
  }
  return errs;
}

/* ---------- 轨迹上时间 ←─ 语义解析 ---------- */

function chronology(t) {
  const evs = [...(t.timeline ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.eventId.localeCompare(b.eventId));
  const reviews = [...(t.reviews ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.reviewId.localeCompare(b.reviewId));
  return { evs, reviews };
}

/** 逐事件推演当前生命周期阶段与 generation（初值取 session；lifecycle_advanced 的 before 兜底初始阶段）。 */
function simulate(t) {
  const { evs, reviews } = chronology(t);
  let stage = null;
  const firstAdv = evs.find((e) => e.kind === 'lifecycle_advanced' && isStr(e.before));
  if (firstAdv) stage = firstAdv.before;
  const reviewByAt = []; // pause/resume 影响代次
  for (const r of reviews) {
    if (r.action === 'pause_round' || r.action === 'resume_round') reviewByAt.push({ at: Date.parse(r.at), kind: r.action, reviewId: r.reviewId });
  }
  reviewByAt.sort((a, b) => a.at - b.at);
  // session.generation 是终值：初值 = 终值 - 暂停/恢复次数（下限1），保证重放终态与 session 一致
  let gen = Math.max(1, (isInt(t.session?.generation) ? t.session.generation : 1) - reviewByAt.length);
  return { evs, reviews, reviewByAt, initialStage: stage, initialGen: gen };
}

function stageAt(sim, atMs) {
  let stage = sim.initialStage;
  for (const e of sim.evs) {
    if (Date.parse(e.at) > atMs) break;
    if (e.kind === 'lifecycle_advanced' && isStr(e.after)) stage = e.after;
  }
  return stage;
}

function genAt(sim, atMs, startGen) {
  let g = startGen;
  for (const r of sim.reviewByAt) {
    if (r.at > atMs) break;
    g++; // pause_round / resume_round 各 +1（产品语义：每次 pause_round +1；resume 亦推进代次防旧结果越代）
  }
  return g;
}

/* ---------- 规则（每条返回 {rule, verdict: pass|violation|undecided|na, details: []}） ---------- */

function ruleRPRE(t, sim) {
  const details = [];
  let violation = false, na = true, undecided = false;
  for (const e of sim.evs) {
    if (e.kind !== 'formal_step_completed') continue;
    na = false;
    const atMs = Date.parse(e.at);
    const stage = stageAt(sim, atMs);
    const isFormalVerification = /formal_verification/i.test(String(e.event));
    if (!isFormalVerification) continue; // model_preprocessing 在 pre_review 亦允许（predecessorAllows）
    if (stage === null || stage === undefined) { undecided = true; details.push(`无法判定阶段：${e.eventId}（缺 lifecycle_advanced 起点）→ 人工`); continue; }
    if (stage === 'pre_review') {
      // 人工支撑须显式链接本步骤（after 含 eventId 或 confirm 指向 formal_verification）——泛泛的后续 confirm 不算（SA-9 式对抗：防"顺手确认"洗白越权）
      const human = sim.evs.some((x) => x.kind === 'human_confirmation' && Date.parse(x.at) >= atMs && isStr(x.after) && x.after.includes(e.eventId))
        || sim.reviews.some((r) => r.action === 'confirm' && Date.parse(r.at) >= atMs && (String(r.targetId).includes('formal_verification') || String(r.opinion).includes('formal_verification') || String(r.targetId).includes(e.eventId)));
      if (!human) { violation = true; details.push(`前序越权：${e.eventId} 在 pre_review 阶段完成 formal_verification，且无后续人工确认`); }
      else details.push(`pre_review 阶段 formal_verification 有后续人工确认（记录在案）`);
    } else {
      details.push(`formal_verification 于 ${stage} 阶段完成（前序已具备）`);
    }
  }
  return { rule: 'R-PRE 前序越权', verdict: violation ? 'violation' : undecided ? 'undecided' : na ? 'na' : 'pass', details };
}

function ruleRHUMAN(t, sim) {
  const details = [];
  let violation = false, na = true;
  for (const e of sim.evs) {
    if (e.kind !== 'lifecycle_advanced') continue;
    na = false;
    const atMs = Date.parse(e.at);
    const human = sim.reviews.some((r) => r.action === 'confirm' && Date.parse(r.at) >= atMs)
      || sim.evs.some((x) => x.kind === 'human_confirmation' && Date.parse(x.at) >= atMs);
    if (!human) { violation = true; details.push(`正式状态变更无人控支撑：${e.eventId} ${e.before ?? '?'}→${e.after ?? '?'} 之后无人工 confirm/human_confirmation`); }
    else details.push(`${e.eventId} 状态变更有人工确认支撑`);
  }
  return { rule: 'R-HUMAN 正式变更须人确认', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleROPIN(t) {
  const details = [];
  let violation = false, na = true;
  const anchors = new Set();
  for (const e of t.timeline ?? []) if (e.kind === 'opinion_recorded' && isStr(e.after)) { anchors.add(e.after); na = false; }
  for (const a of t.annotations ?? []) for (const r of a.replies ?? []) { anchors.add(r.replyId); na = false; }
  for (const r of t.reviews ?? []) { anchors.add(r.reviewId); na = false; }
  const linked = new Set();
  for (const td of t.todos ?? []) for (const o of td.linkedOpinionIds ?? []) linked.add(o);
  // 意见丢失：todo_state_changed 的 impact 声明解除某意见锚点，但既无人工裁定（其后的 review），最终 todos 也不再引用该锚点
  for (const e of t.timeline ?? []) {
    if (e.kind !== 'todo_state_changed' || !isStr(e.impact)) continue;
    const unlinked = [...anchors].filter((a) => e.impact.includes(a));
    if (unlinked.length === 0) continue;
    na = false;
    const atMs = Date.parse(e.at);
    const humanAfter = (t.reviews ?? []).some((r) => ['confirm', 'correct', 'escalate_human'].includes(r.action) && Date.parse(r.at) >= atMs);
    for (const a of unlinked) {
      const stillLinked = (t.todos ?? []).some((td) => (td.linkedOpinionIds ?? []).includes(a));
      if (!stillLinked && !humanAfter) {
        violation = true;
        details.push(`意见丢失：${e.eventId} 声明解除关联 ${a}，最终轨迹未再引用且无人工裁定记录`);
      } else details.push(`${a} 的解除/裁定有人工记录（${stillLinked ? '仍被引用' : '人工已裁定'}）`);
    }
  }
  if (na) details.push('轨迹中无意见锚点（N/A）');
  return { rule: 'R-OPIN 意见丢失', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleRHANG(t) {
  const details = [];
  let violation = false, na = true;
  const leftEvents = (t.timeline ?? []).filter((e) => e.kind === 'participant_left');
  const seen = new Map(); // todoId -> 最后已知状态（来自 timeline）
  for (const e of t.timeline ?? []) {
    if (e.kind !== 'todo_state_changed' || !isStr(e.event)) continue;
    na = false;
    seen.set(e.event, isStr(e.after) ? e.after : 'unknown');
  }
  const finalIds = new Set((t.todos ?? []).map((td) => td.todoId));
  for (const [todoId, last] of seen) {
    if (finalIds.has(todoId)) continue;
    if (last === 'resolved' || last === 'deferred') { details.push(`${todoId} 已${last === 'deferred' ? '明确延后' : '完结'}后离开最终清单（有记录）`); continue; }
    violation = true;
    details.push(`挂断断链：待办 ${todoId} 在事件中为 open/unknown，最终 todos 却消失且无 resolved/deferred 记录`);
  }
  if (leftEvents.length > 0) details.push(`挂断/离会事件 ${leftEvents.length} 条：其后未解决事项以 open/deferred 形式保留判定如上`);
  if (na && leftEvents.length === 0) details.push('无待办事件与挂断事件（N/A）');
  return { rule: 'R-HANG 挂断断链', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleRVER(t) {
  const details = [];
  let violation = false, na = true;
  const evVersions = new Map();
  for (const e of t.evidence ?? []) {
    if (!evVersions.has(e.evidenceId)) evVersions.set(e.evidenceId, new Set());
    evVersions.get(e.evidenceId).add(e.version);
  }
  for (const a of t.annotations ?? []) {
    na = false;
    const set = evVersions.get(a.evidenceId);
    if (!set || !set.has(a.evidenceVersion)) {
      violation = true;
      details.push(`版本缺失：annotation ${a.annotationId} 引用 ${a.evidenceId}@v${a.evidenceVersion}，资料中该证据版本集=[${set ? [...set] : '无此证据'}]`);
    }
  }
  const annoVersions = new Map();
  for (const a of t.annotations ?? []) {
    if (!annoVersions.has(a.annotationId)) annoVersions.set(a.annotationId, new Set());
    annoVersions.get(a.annotationId).add(a.version);
  }
  for (const r of t.reviews ?? []) {
    if (r.targetType !== 'annotation') continue;
    na = false;
    const set = annoVersions.get(r.targetId);
    if (!set || !set.has(r.targetVersion)) {
      violation = true;
      details.push(`版本缺失：review ${r.reviewId} 引用 annotation ${r.targetId}@v${r.targetVersion}，实际版本集=[${set ? [...set] : '无此标注'}]`);
    }
  }
  if (na) details.push('无版本引用可查（N/A）');
  return { rule: 'R-VER 版本引用', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleRSESS(t) {
  const details = [];
  let violation = false, na = true;
  const sid = t.session?.sessionId;
  const check = (label, items, key) => {
    for (const it of items) {
      na = false;
      if (it[key] !== sid) { violation = true; details.push(`会话错配：${label} ${it[Object.keys(it)[0]] ?? ''} 的 ${key}=${it[key]} ≠ ${sid}`); }
    }
  };
  check('evidence', t.evidence ?? [], 'sessionId');
  check('annotation', t.annotations ?? [], 'sessionId');
  check('review', t.reviews ?? [], 'sessionId');
  check('calculation', t.calculations ?? [], 'sessionId');
  for (const e of t.timeline ?? []) { na = false; if (e.sessionId !== sid) { violation = true; details.push(`会话错配：timeline ${e.eventId} 的 sessionId=${e.sessionId} ≠ ${sid}`); } }
  if (na) details.push('无记录可查（N/A）');
  return { rule: 'R-SESS 会话归属', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleRLATE(t, sim) {
  const details = [];
  let violation = false, na = true;
  for (const e of sim.evs) {
    if (e.kind !== 'result_applied') continue;
    na = false;
    const atMs = Date.parse(e.at);
    const applied = Number.parseInt(String(e.after ?? ''), 10);
    if (!Number.isInteger(applied)) { details.push(`result_applied ${e.eventId} 无代次信息（after 非整数）→ 人工`); continue; }
    const cur = genAt(sim, atMs, sim.initialGen);
    if (applied < cur) {
      violation = true;
      details.push(`迟到生效：${e.eventId} 以 generation ${applied} 生效，但当时会话已推进到 ${cur}（暂停后旧结果不得越代）`);
    } else details.push(`result_applied ${e.eventId} 代次 ${applied} 与当前一致`);
  }
  if (na) details.push('无结果生效事件（N/A）');
  return { rule: 'R-LATE 迟到结果', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleRRULE(t) {
  const details = [];
  let violation = false, na = true;
  const version = t.ruleConfig?.version;
  const ruleUpdated = (t.timeline ?? []).filter((e) => e.kind === 'rule_updated');
  if (t.ruleConfig !== undefined) na = false;
  for (const e of ruleUpdated) {
    na = false;
    const atMs = Date.parse(e.at);
    const human = (t.reviews ?? []).some((r) => r.action === 'confirm' && Date.parse(r.at) >= atMs)
      || (t.timeline ?? []).some((x) => x.kind === 'human_confirmation' && Date.parse(x.at) >= atMs);
    if (!human) { violation = true; details.push(`规则升级无人工授权：${e.eventId} 声明规则变更（after=${e.after ?? '?'}），事件链无人工授权`); }
    else details.push(`规则变更 ${e.eventId} 有人工授权`);
  }
  if (typeof version === 'number' && version > 0 && ruleUpdated.length === 0) {
    violation = true;
    details.push(`ruleConfig.version=${version} 但轨迹无 rule_updated 事件（版本变更必须留痕）`);
  }
  if (na) details.push('无规则配置信息（N/A）');
  return { rule: 'R-RULE 规则升级', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleRDUP(t) {
  const details = [];
  let violation = false, na = true;
  const byId = new Map();
  for (const e of t.timeline ?? []) {
    na = false;
    const prev = byId.get(e.eventId);
    if (prev === undefined) byId.set(e.eventId, JSON.stringify(e));
    else if (prev !== JSON.stringify(e)) {
      violation = true;
      details.push(`同 eventId 载荷矛盾（重复事件被用来翻转状态）：${e.eventId}`);
    }
  }
  if (na) details.push('无时间线事件（N/A）');
  return { rule: 'R-DUP 重复事件', verdict: violation ? 'violation' : na ? 'na' : 'pass', details };
}

function ruleRCORRECT(t) {
  const details = [];
  let undecided = false, na = true;
  for (const e of t.timeline ?? []) {
    if (e.kind !== 'draft_corrected') continue;
    na = false;
    const keyField = /金额|单位|否定|期间/.test(String(e.event));
    if (e.before == null || e.after == null) { undecided = true; details.push(`纠偏 ${e.eventId} 缺 before/after → 人工`); continue; }
    if (keyField) {
      const human = (t.reviews ?? []).some((r) => r.action === 'confirm' && Date.parse(r.at) >= Date.parse(e.at))
        || (t.timeline ?? []).some((x) => x.kind === 'human_confirmation' && Date.parse(x.at) >= Date.parse(e.at));
      if (!human) { undecided = true; details.push(`关键字段纠偏 ${e.eventId}（${e.event}）尚无人工确认 → 待人工`); }
      else details.push(`关键字段纠偏 ${e.eventId} 已有人工确认`);
    }
  }
  if (na) details.push('无纠偏事件（N/A）');
  return { rule: 'R-CORRECT 关键字段纠偏', verdict: undecided ? 'undecided' : na ? 'na' : 'pass', details };
}

const RULES = [ruleRPRE, ruleRHUMAN, ruleROPIN, ruleRHANG, ruleRVER, ruleRSESS, ruleRLATE, ruleRRULE, ruleRDUP, ruleRCORRECT];

function replay(t) {
  const sim = simulate(t);
  const results = RULES.map((fn) => fn(t, sim));
  const uninterpreted = {};
  for (const e of t.timeline ?? []) if (!['lifecycle_advanced', 'formal_gate', 'formal_step_completed', 'human_confirmation', 'opinion_recorded', 'conflict_routed', 'participant_left', 'todo_state_changed', 'result_applied', 'rule_updated', 'draft_corrected'].includes(e.kind)) uninterpreted[e.kind] = (uninterpreted[e.kind] ?? 0) + 1;
  return {
    schema: 'trajectory-verdict@1',
    toolVersion: TOOL_VERSION,
    trajectoryId: t.meta?.trajectoryId,
    source: t.meta?.source,
    rules: results,
    counts: {
      pass: results.filter((r) => r.verdict === 'pass').length,
      violation: results.filter((r) => r.verdict === 'violation').length,
      undecided: results.filter((r) => r.verdict === 'undecided').length,
      na: results.filter((r) => r.verdict === 'na').length,
    },
    uninterpretedKinds: uninterpreted,
    declaration: '回放判定基于事件/记录的结构与因果，不含散文关键词命中；语义完备性不做声称。schema 通过 ≠ 权限通过；真实模型质量 NOT TESTED。',
  };
}

function printVerdict(v) {
  const L = [`== 回放 ${v.trajectoryId}（来源 ${v.source}，工具 v${v.toolVersion}）`];
  for (const r of v.rules) L.push(`  [${r.verdict.toUpperCase().padEnd(9)}] ${r.rule}${r.details.length ? ' ｜ ' + r.details.join('；') : ''}`);
  L.push(`  计数 pass=${v.counts.pass} violation=${v.counts.violation} undecided=${v.counts.undecided} na=${v.counts.na}；未解释kind=${JSON.stringify(v.uninterpretedKinds)}`);
  L.push(`  ${v.declaration}`);
  return L.join('\n');
}

/* ---------- selftest：pos 全过 / neg 触发 expectedRule / metamorphic ---------- */

function runReplay(p) {
  const t = readJson(p);
  const errs = validateTrajectory(t, p);
  if (errs.length) throw new UsageError(`轨迹 schema 校验失败 ${path.basename(p)}:\n  - ${errs.join('\n  - ')}`);
  return replay(t);
}

function selftest() {
  const results = [];
  const check = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });

  if (!fs.existsSync(HANDWRITTEN_DIR)) { console.log('selftest：handwritten 目录缺失'); return { ok: false, text: 'handwritten 目录缺失', results }; }
  const files = fs.readdirSync(HANDWRITTEN_DIR).filter((f) => f.endsWith('.json')).sort();
  const posFiles = files.filter((f) => f.startsWith('pos-'));
  const negFiles = files.filter((f) => f.startsWith('neg-'));

  for (const f of posFiles) {
    const v = runReplay(path.join(HANDWRITTEN_DIR, f));
    check(`POS ${f}: 无 violation`, v.counts.violation === 0, JSON.stringify(v.rules.filter((r) => r.verdict === 'violation')));
    check(`POS ${f}: 无 undecided`, v.counts.undecided === 0, JSON.stringify(v.rules.filter((r) => r.verdict === 'undecided')));
  }
  for (const f of negFiles) {
    const p = path.join(HANDWRITTEN_DIR, f);
    const t = readJson(p);
    const expected = t.expectedRule;
    if (!isStr(expected)) { check(`NEG ${f}: expectedRule 标注`, false, '缺 expectedRule 顶层标注'); continue; }
    const v = runReplay(p);
    const hit = v.rules.some((r) => r.rule.startsWith(expected) && r.verdict === 'violation');
    const others = v.rules.filter((r) => r.verdict === 'violation' && !r.rule.startsWith(expected));
    check(`NEG ${f}: 触发预期规则 ${expected}`, hit, hit ? '已触发' : JSON.stringify(v.rules.map((r) => [r.rule, r.verdict])));
    check(`NEG ${f}: 不误伤其他规则`, others.length === 0, JSON.stringify(others.map((r) => r.rule)));
  }

  /* metamorphic：对第一份 pos 基线做变换，断言判定按预期翻转/不变 */
  const baselineFile = posFiles[0];
  if (!baselineFile) { check('metamorphic: 存在正例基线', false, '无 pos-* 文件'); }
  else {
    const base = readJson(path.join(HANDWRITTEN_DIR, baselineFile));
    const baseOut = runReplay(path.join(HANDWRITTEN_DIR, baselineFile));
    const tmp = (n, obj) => { const p = path.join(ROOT, 'evidence-r3', 'runtime', n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); return p; };
    const verdictOf = (p) => runReplay(p);
    const ruleMap = (v) => Object.fromEntries(v.rules.map((r) => [r.rule.split(' ')[0], r.verdict]));

    // T1 事件重复（逐条原样复制）→ 判定不变
    const t1 = JSON.parse(JSON.stringify(base)); t1.timeline = [...t1.timeline, ...t1.timeline.map((e) => ({ ...e }))];
    const v1 = ruleMap(verdictOf(tmp('meta-t1-dup.json', t1)));
    check('T1 事件重复: 判定不变（幂等）', JSON.stringify(ruleMap(baseOut)) === JSON.stringify(v1), JSON.stringify(v1));

    // T2 事件重排 → 判定不变（回放按 at 排序）
    const t2 = JSON.parse(JSON.stringify(base)); t2.timeline = [...t2.timeline].reverse();
    const v2 = ruleMap(verdictOf(tmp('meta-t2-reorder.json', t2)));
    check('T2 事件重排: 判定不变', JSON.stringify(ruleMap(baseOut)) === JSON.stringify(v2), JSON.stringify(v2));

    // T3 缺失版本（引用不存在的版本）→ R-VER 翻转为 violation
    const t3 = JSON.parse(JSON.stringify(base));
    if ((t3.annotations ?? []).length > 0) t3.annotations[0].evidenceVersion = (t3.annotations[0].evidenceVersion ?? 1) + 90;
    const v3 = ruleMap(verdictOf(tmp('meta-t3-missingver.json', t3)));
    check('T3 缺失版本: R-VER 翻转为 violation', v3['R-VER'] === 'violation', JSON.stringify(v3));

    // T4 错会话 → R-SESS 翻转
    const t4 = JSON.parse(JSON.stringify(base));
    if ((t4.annotations ?? []).length > 0) t4.annotations[0].sessionId = 'SESS-OTHER';
    else if ((t4.reviews ?? []).length > 0) t4.reviews[0].sessionId = 'SESS-OTHER';
    const v4 = ruleMap(verdictOf(tmp('meta-t4-wrongsession.json', t4)));
    check('T4 错会话: R-SESS 翻转为 violation', v4['R-SESS'] === 'violation', JSON.stringify(v4));

    // T5 迟到暂停 → R-LATE 翻转（若基线无 result_applied 则注入）
    const t5 = JSON.parse(JSON.stringify(base));
    const lastAt = t5.timeline?.length ? t5.timeline[t5.timeline.length - 1].at : '2026-09-13T05:00:00Z';
    const lateAt = new Date(Date.parse(lastAt) + 60000).toISOString();
    t5.reviews = [...(t5.reviews ?? []), { reviewId: 'meta-pause', sessionId: t5.session.sessionId, targetType: 'evidence', targetId: 'x', targetVersion: 1, action: 'pause_round', opinion: '暂停', reviewer: 'p-biz', at: lateAt }];
    t5.timeline = [...(t5.timeline ?? []), { eventId: 'meta-late', sessionId: t5.session.sessionId, at: new Date(Date.parse(lateAt) + 1000).toISOString(), actor: 'p-model', kind: 'result_applied', level: 'unknown', event: '旧代次结果写入', before: null, after: String((t5.session.generation ?? 1)), impact: null }];
    const v5 = ruleMap(verdictOf(tmp('meta-t5-latepause.json', t5)));
    check('T5 迟到暂停: R-LATE 翻转为 violation', v5['R-LATE'] === 'violation', JSON.stringify(v5));

    // T6 重要分歧被去重（意见锚点被解除且无人工裁定）→ R-OPIN 翻转
    const t6 = JSON.parse(JSON.stringify(base));
    const anchor = `meta-op-${Date.now() % 100000}`;
    t6.timeline = [...(t6.timeline ?? []), { eventId: 'meta-op-rec', sessionId: t5.session.sessionId, at: lastAt, actor: 'p-policy', kind: 'opinion_recorded', level: 'unknown', event: '政策岗意见：补贴限制待核查', before: null, after: anchor, impact: null }];
    t6.todos = [...(t6.todos ?? []), { todoId: 'meta-todo', title: '核查', sessionId: t5.session.sessionId, status: 'open', linkedOpinionIds: [anchor], updatedAt: lastAt }];
    const t6b = JSON.parse(JSON.stringify(t6));
    t6b.timeline = [...t6b.timeline, { eventId: 'meta-dedup', sessionId: t6b.session.sessionId, at: new Date(Date.parse(lastAt) + 30000).toISOString(), actor: 'system', kind: 'todo_state_changed', level: 'unknown', event: 'meta-todo', before: 'open', after: 'open', impact: `去重合并：解除关联 ${anchor}` }];
    t6b.todos = t6b.todos.map((td) => td.todoId === 'meta-todo' ? { ...td, linkedOpinionIds: [] } : td);
    const v6a = ruleMap(verdictOf(tmp('meta-t6a-opinion.json', t6)));
    const v6b = ruleMap(verdictOf(tmp('meta-t6b-deduplost.json', t6b)));
    check('T6 分歧被去重: 基线(意见保留)R-OPIN 非 violation，去重丢失后翻转为 violation', v6a['R-OPIN'] !== 'violation' && v6b['R-OPIN'] === 'violation', `${v6a['R-OPIN']} → ${v6b['R-OPIN']}`);

    // T7 挂断后待办丢失 → R-HANG 翻转（若基线有 open 待办）
    const t7 = JSON.parse(JSON.stringify(base));
    const openTodos = (t7.todos ?? []).filter((td) => td.status === 'open');
    if (openTodos.length > 0) {
      const lost = openTodos[0].todoId;
      t7.todos = (t7.todos ?? []).filter((td) => td.todoId !== lost);
      const v7 = ruleMap(verdictOf(tmp('meta-t7-hanguploss.json', t7)));
      check('T7 挂断待办丢失: R-HANG 翻转为 violation', v7['R-HANG'] === 'violation', JSON.stringify(v7));
    } else check('T7 挂断待办丢失: 基线无 open 待办（N/A 记录）', true, '基线无 open 待办可失，规则由 neg-hangup-loss 覆盖');

    // T8 单例→规则升级 → R-RULE 翻转
    const t8 = JSON.parse(JSON.stringify(base));
    t8.ruleConfig = { ...(t8.ruleConfig ?? { layers: {} }), version: 1, status: 'configured' };
    t8.timeline = [...(t8.timeline ?? []), { eventId: 'meta-rule', sessionId: t8.session.sessionId, at: new Date(Date.parse(lastAt) + 120000).toISOString(), actor: 'system', kind: 'rule_updated', level: 'unknown', event: '全局规则更新（无授权记录）', before: 'v0', after: 'v1', impact: null }];
    const v8 = ruleMap(verdictOf(tmp('meta-t8-ruleup.json', t8)));
    check('T8 规则升级: R-RULE 翻转为 violation', v8['R-RULE'] === 'violation', JSON.stringify(v8));
  }

  const failed = results.filter((r) => !r.pass);
  const L = [`replay selftest（工具 v${TOOL_VERSION}）｜通过 ${results.length - failed.length}/${results.length}`];
  for (const r of results) L.push(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
  L.push('声明：控制组全部为手写合成轨迹（source=handwritten），只证明回放器能按预期判定，不代表产品已执行或任何真实模型能力。');
  return { ok: failed.length === 0, text: L.join('\n'), results };
}

/* ---------- CLI ---------- */

function parseArgs(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else a._.push(argv[i]); } return a; }

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'replay') {
    if (!args.trajectory || typeof args.trajectory !== 'string') throw new UsageError('用法：replay --trajectory <file> [--json]');
    const v = runReplay(path.resolve(args.trajectory));
    if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(v, null, 2) + '\n', 'utf8');
    if (args.json) console.log(JSON.stringify(v, null, 2));
    else console.log(printVerdict(v));
    return 0;
  }
  if (cmd === 'selftest') { const r = selftest(); console.log(r.text); return r.ok ? 0 : 3; }
  if (cmd === 'metamorphic') { const r = selftest(); const m = r.results.filter((x) => x.name.startsWith('T')); const ok = m.every((x) => x.pass); console.log(m.map((x) => `${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? '  [' + x.detail + ']' : ''}`).join('\n')); console.log(`metamorphic 断言 ${m.filter((x) => x.pass).length}/${m.length}`); return ok ? 0 : 3; }
  if (cmd === 'manifest') {
    const metaFile = path.join(ROOT, 'docs', 'manifest-meta.json');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const files = [];
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (f.name === 'runtime') continue; walk(p); } else { const rel = path.relative(ROOT, p).split(path.sep).join('/'); if (rel === 'MANIFEST.json') continue; files.push({ path: rel, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), bytes: fs.statSync(p).size }); } } };
    walk(ROOT);
    files.sort((a, b) => a.path.localeCompare(b.path));
    fs.writeFileSync(path.join(ROOT, 'MANIFEST.json'), JSON.stringify({ schema: 'jw-eval-manifest@1', generatedBy: `node tools/replay-cli.mjs manifest（runtime/ 为可变输出，不入冻结清单）`, ...meta, fileCount: files.length, files }, null, 2) + '\n', 'utf8');
    console.log('MANIFEST.json 已生成');
    return 0;
  }
  throw new UsageError('未知命令。可用：replay | selftest | metamorphic | manifest');
}

try { process.exit(main()); } catch (e) {
  if (e instanceof UsageError) { console.error(`[schema/用法失败] ${e.message}`); process.exit(2); }
  console.error(`[内部错误] ${e && e.stack ? e.stack : e}`); process.exit(2);
}
