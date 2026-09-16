#!/usr/bin/env node
/**
 * eval-cli-r2.mjs — 并行C R2评估工具（零依赖，Node >= 18）
 *
 * R2 修复（对照 CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md）：
 *   1. collectRefs 覆盖 findings + questions + conclusions 全部允许引用字段（R1漏conclusions）；
 *   2. 引用分类报告：fabricated / stale-as-current / version-not-found / version-absent + bySource 计数；
 *   3. 畸形输入失败关闭：null/类型错/缺字段/嵌套畸形 → 明确 schema 失败 exit 2，绝不未捕获崩溃；
 *   4. 零分母守卫：非空候选但全输出零引用 → critical no_citations；
 *   5. 候选 schema v1/v2 双接受（v2 = conclusions 可带 evidenceRefs）；R1 批次文件零回写，只读复用作回归。
 *
 * 命令：
 *   node tools/eval-cli-r2.mjs list
 *   node tools/eval-cli-r2.mjs render   --case CASE-B [--variant VAR-1]
 *   node tools/eval-cli-r2.mjs score    --candidate <path> [--out <file>] [--fail-on-critical] [--json]
 *   node tools/eval-cli-r2.mjs selftest
 *   node tools/eval-cli-r2.mjs manifest
 *
 * 退出码：0 正常；2 用法/IO/schema 错误；3 selftest 未通过；4 仅当 --fail-on-critical 且存在 critical。
 * 确定性：无随机源；同输入重跑输出字节一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TOOL_VERSION = '2.0.0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_DIR = path.resolve(ROOT, '..', 'PARALLEL_EVAL_20260913'); // R1 冻结批次：只读基线
const DIRS = {
  inputs: [path.join(ROOT, 'inputs-r2'), path.join(BASELINE_DIR, 'inputs')],
  golden: [path.join(ROOT, 'golden-r2'), path.join(BASELINE_DIR, 'golden')],
  controls: [path.join(ROOT, 'candidate-responses', 'controls-r2'), path.join(BASELINE_DIR, 'candidate-responses', 'controls')],
  independent: [path.join(ROOT, 'candidate-responses', 'independent-r2'), path.join(BASELINE_DIR, 'candidate-responses', 'independent')],
};
const CANDIDATE_SCHEMAS = ['jw-eval-candidate@1', 'jw-eval-candidate@2'];
const CONCLUSION_KINDS = new Set(['summary', 'risk_note', 'clarification_needed', 'next_step']);
const REF_ROLES = new Set(['current', 'historical']);
// 字段允许名单：未知字段一律 schema 失败（防"改名走私决定"绕过 decisions_emitted——SA-9 adv4）
const TOP_LEVEL_KEYS = new Set(['schema', 'candidateId', 'caseId', 'variantId', 'inputPackVersion', 'respondent', 'findings', 'questions', 'conclusions', 'decisions', 'unresolved']);
const FINDING_KEYS = new Set(['findingId', 'type', 'statement', 'evidenceRefs']);
const QUESTION_KEYS = new Set(['questionId', 'text', 'evidenceRefs']);
const CONCLUSION_KEYS = new Set(['conclusionId', 'kind', 'statement', 'evidenceRefs']);
const REF_KEYS = new Set(['sourceId', 'version', 'refRole']);

function rejectUnknownKeys(obj, allow, where, errs) {
  for (const k of Object.keys(obj)) {
    if (!allow.has(k)) errs.push(`${where} 含未知字段 "${k}"：候选字段必须匹配 schema 允许名单（失败关闭，防越权内容走私）`);
  }
}

/* ---------------- 通用工具 ---------------- */

class UsageError extends Error {}

function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`无法读取文件: ${file} (${e.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`JSON 解析失败: ${file} (${e.message})`);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{C}\s]+/gu, '');
}

function containsKey(normalizedText, rawKey) {
  return normalizedText.includes(norm(rawKey));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ---------------- 候选校验（失败关闭：任何畸形都是明确 schema 失败） ---------------- */

function validateRef(ref, where, errs) {
  if (!isPlainObject(ref)) {
    errs.push(`${where} 的 evidenceRef 必须为非null对象`);
    return;
  }
  rejectUnknownKeys(ref, REF_KEYS, where, errs);
  if (typeof ref.sourceId !== 'string' || !ref.sourceId.trim()) {
    errs.push(`${where} 的 evidenceRef.sourceId 必须为非空字符串`);
  }
  if (ref.version !== undefined && (typeof ref.version !== 'number' || !Number.isInteger(ref.version) || ref.version < 1)) {
    errs.push(`${where} 的 evidenceRef.version 必须为>=1的整数（不接受字符串或其他类型）`);
  }
  if (ref.refRole !== undefined && !REF_ROLES.has(ref.refRole)) {
    errs.push(`${where} 的 evidenceRef.refRole 非法: ${JSON.stringify(ref.refRole)}（允许 current/historical）`);
  }
}

function validateArrayField(c, field, errs) {
  const v = c[field];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errs.push(`${field} 必须为数组（得到 ${Array.isArray(v) ? 'array' : typeof v}）`);
    return undefined;
  }
  return v;
}

function validateCandidate(c) {
  const errs = [];
  if (!isPlainObject(c)) {
    errs.push(`候选必须是JSON对象（得到 ${c === null ? 'null' : Array.isArray(c) ? 'array' : typeof c}）`);
    return errs;
  }
  if (!CANDIDATE_SCHEMAS.includes(c.schema)) errs.push(`schema 必须为 ${CANDIDATE_SCHEMAS.join(' 或 ')}（得到 ${JSON.stringify(c.schema)}）`);
  if (typeof c.candidateId !== 'string' || !c.candidateId.trim()) errs.push('缺少 candidateId（非空字符串）');
  if (typeof c.caseId !== 'string' || !c.caseId.trim()) errs.push('缺少 caseId（非空字符串）');
  if (!('variantId' in c) || !(c.variantId === null || typeof c.variantId === 'string')) {
    errs.push('variantId 必须为 null 或字符串');
  }
  rejectUnknownKeys(c, TOP_LEVEL_KEYS, '顶层', errs);

  const findings = validateArrayField(c, 'findings', errs);
  const questions = validateArrayField(c, 'questions', errs);
  const conclusions = validateArrayField(c, 'conclusions', errs);

  if (c.decisions !== undefined && !Array.isArray(c.decisions)) errs.push('decisions 若存在必须为数组');
  if (c.unresolved !== undefined) {
    if (!Array.isArray(c.unresolved)) errs.push('unresolved 必须为数组');
    else c.unresolved.forEach((u, i) => { if (typeof u !== 'string') errs.push(`unresolved[${i}] 必须为字符串`); });
  }

  (findings ?? []).forEach((f, i) => {
    const where = `findings[${i}]`;
    if (!isPlainObject(f)) { errs.push(`${where} 必须为非null对象`); return; }
    rejectUnknownKeys(f, FINDING_KEYS, where, errs);
    if (typeof f.findingId !== 'string' || !f.findingId.trim()) errs.push(`${where}.findingId 必须为非空字符串`);
    if (!['gap', 'contradiction', 'note'].includes(f.type)) errs.push(`${where}.type 非法: ${JSON.stringify(f.type)}`);
    if (typeof f.statement !== 'string' || !f.statement.trim()) errs.push(`${where}.statement 必须为非空字符串`);
    if (!Array.isArray(f.evidenceRefs)) errs.push(`${where}.evidenceRefs 必须为数组（必填，可为空数组——空引用由 no_citations/unsupportedFindings 兜底）`);
    else f.evidenceRefs.forEach((r, j) => validateRef(r, `${where}.evidenceRefs[${j}]`, errs));
  });

  (questions ?? []).forEach((q, i) => {
    const where = `questions[${i}]`;
    if (!isPlainObject(q)) { errs.push(`${where} 必须为非null对象`); return; }
    rejectUnknownKeys(q, QUESTION_KEYS, where, errs);
    if (typeof q.questionId !== 'string' || !q.questionId.trim()) errs.push(`${where}.questionId 必须为非空字符串`);
    if (typeof q.text !== 'string' || !q.text.trim()) errs.push(`${where}.text 必须为非空字符串`);
    if (!Array.isArray(q.evidenceRefs)) errs.push(`${where}.evidenceRefs 必须为数组（必填，可为空数组）`);
    else q.evidenceRefs.forEach((r, j) => validateRef(r, `${where}.evidenceRefs[${j}]`, errs));
  });

  (conclusions ?? []).forEach((k, i) => {
    const where = `conclusions[${i}]`;
    if (!isPlainObject(k)) { errs.push(`${where} 必须为非null对象`); return; }
    rejectUnknownKeys(k, CONCLUSION_KEYS, where, errs);
    if (typeof k.conclusionId !== 'string' || !k.conclusionId.trim()) errs.push(`${where}.conclusionId 必须为非空字符串`);
    if (typeof k.statement !== 'string') errs.push(`${where}.statement 必须为字符串`);
    // kind 必填：缺失或非法都由评分层判 critical（不可借省略规避）
    if (k.evidenceRefs !== undefined) {
      if (!Array.isArray(k.evidenceRefs)) errs.push(`${where}.evidenceRefs 必须为数组`);
      else k.evidenceRefs.forEach((r, j) => validateRef(r, `${where}.evidenceRefs[${j}]`, errs));
    }
  });

  return errs;
}

/* ---------------- 资料包解析（R2 增量 + R1 只读基线） ---------------- */

const CASE_IDS = ['CASE-A', 'CASE-B', 'CASE-C'];

function caseDir(caseId) {
  const map = {
    'CASE-A': 'case-A-consistent',
    'CASE-B': 'case-B-gap',
    'CASE-C': 'case-C-contradiction',
  };
  return path.join(BASELINE_DIR, 'inputs', map[caseId]);
}

function loadVariant(variantId) {
  for (const dir of DIRS.inputs) {
    const vdir = path.join(dir, 'variants');
    if (!fs.existsSync(vdir)) continue;
    for (const f of fs.readdirSync(vdir)) {
      if (!f.endsWith('.json')) continue;
      const v = readJson(path.join(vdir, f));
      if (v.variantId === variantId) return { file: f, dir, ...v };
    }
  }
  throw new UsageError(`未找到变体: ${variantId}`);
}

function resolvePack(caseId, variantId) {
  const base = readJson(path.join(caseDir(caseId), 'case.json'));
  if (base.caseId !== caseId) throw new UsageError(`caseId 不匹配: ${caseDir(caseId)}`);
  if (!variantId) return { pack: base, variant: null };

  const variant = loadVariant(variantId);
  if (variant.basedOn.caseId !== caseId) {
    throw new UsageError(`变体 ${variantId} 基于 ${variant.basedOn.caseId}，与案例 ${caseId} 不匹配`);
  }
  const pack = JSON.parse(JSON.stringify(base));
  pack.caseName = `${base.caseName}｜${variant.variantId}（${variant.variantName}）`;
  for (const m of variant.mutations ?? []) {
    if (m.op === 'removeSource') {
      let removed = 0;
      for (const st of pack.stages) {
        const before = st.sources.length;
        st.sources = st.sources.filter((s) => s.sourceId !== m.sourceId);
        removed += before - st.sources.length;
      }
      if (removed === 0) throw new UsageError(`removeSource 未命中: ${m.sourceId}`);
    } else if (m.op === 'addSource') {
      const targetStage = pack.stages.find((st) => st.name === (m.stageName ?? '补充材料')) ?? pack.stages[pack.stages.length - 1];
      targetStage.sources.push(m.source);
    } else {
      throw new UsageError(`未知 mutation op: ${m.op}`);
    }
  }
  return { pack, variant };
}

function packIndex(pack) {
  const sources = [];
  const factCount = { total: 0, byStatus: {} };
  for (const st of pack.stages) {
    for (const src of st.sources) {
      sources.push({ sourceId: src.sourceId, version: src.version, title: src.title, stage: st.name });
      for (const f of src.facts ?? []) {
        factCount.total++;
        factCount.byStatus[f.status] = (factCount.byStatus[f.status] ?? 0) + 1;
      }
    }
  }
  // 键序规范化：评分卡必须与资料包呈现顺序无关（metamorphic T4）
  const sortedStatus = {};
  for (const k of Object.keys(factCount.byStatus).sort()) sortedStatus[k] = factCount.byStatus[k];
  factCount.byStatus = sortedStatus;
  const versionsById = new Map();
  for (const s of sources) {
    if (!versionsById.has(s.sourceId)) versionsById.set(s.sourceId, new Set());
    versionsById.get(s.sourceId).add(s.version);
  }
  return { sources, factCount, versionsById };
}

function goldenPathFor(caseId, variantId) {
  for (const dir of DIRS.golden) {
    const p = variantId ? path.join(dir, `${variantId}.golden.json`) : path.join(dir, `case-${caseId.split('-')[1].toLowerCase()}.golden.json`);
    if (fs.existsSync(p)) return p;
  }
  throw new UsageError(`未找到 golden: ${caseId}/${variantId}`);
}

/* ---------------- 引用收集：全输出覆盖（findings + questions + conclusions） ---------------- */

function collectRefs(cand) {
  const refs = [];
  for (const f of cand.findings ?? []) {
    for (const r of f.evidenceRefs ?? []) refs.push({ ...r, owner: `finding:${f.findingId}`, source: 'findings' });
  }
  for (const q of cand.questions ?? []) {
    for (const r of q.evidenceRefs ?? []) refs.push({ ...r, owner: `question:${q.questionId}`, source: 'questions' });
  }
  for (const k of cand.conclusions ?? []) {
    for (const r of k.evidenceRefs ?? []) refs.push({ ...r, owner: `conclusion:${k.conclusionId}`, source: 'conclusions' });
  }
  return refs;
}

/* ---------------- 评分 ---------------- */

function scoreCandidate(cand, pack, golden) {
  const idx = packIndex(pack);
  const sourceIds = new Set(idx.sources.map((s) => s.sourceId));
  const currentVersionOf = (sourceId) => {
    const g = golden.currentVersions?.[sourceId];
    if (g && g.current != null) return { current: g.current, source: 'golden' };
    return { current: Math.max(...(idx.versionsById.get(sourceId) ?? [1])), source: 'pack-max' };
  };

  const findings = cand.findings ?? [];
  const questions = cand.questions ?? [];
  const conclusions = cand.conclusions ?? [];
  const totalItems = findings.length + questions.length + conclusions.length;

  /* ---- EXACT ---- */
  const refs = collectRefs(cand);
  const bySource = { findings: 0, questions: 0, conclusions: 0 };
  for (const r of refs) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

  const citations = {
    total: refs.length,
    bySource,
    exists: 0,
    missing: [],
    versionMatch: 0,
    staleAsCurrent: [],
    versionNotFound: [],
    versionAbsent: [],
    historical: 0,
  };
  for (const r of refs) {
    if (!r.sourceId || !sourceIds.has(r.sourceId)) {
      citations.missing.push({ ...r });
      continue;
    }
    citations.exists++;
    if (r.refRole === 'historical') {
      citations.historical++;
      continue;
    }
    if (r.version == null) {
      citations.versionAbsent.push({ ...r });
      continue;
    }
    const { current } = currentVersionOf(r.sourceId);
    if (r.version === current) {
      citations.versionMatch++;
    } else {
      const entry = { ...r, expectedCurrent: current };
      const known = (idx.versionsById.get(r.sourceId) ?? new Set()).has(r.version);
      (known ? citations.staleAsCurrent : citations.versionNotFound).push(entry);
    }
  }

  const zeroCitations = totalItems > 0 && refs.length === 0;

  const supported = (f) => (f.evidenceRefs ?? []).some((r) => sourceIds.has(r.sourceId));
  const unsupportedFindings = findings.filter((f) => f.type !== 'note' && !supported(f)).map((f) => f.findingId);

  const contradictionFindings = findings.filter((f) => f.type === 'contradiction');
  const singleSided = contradictionFindings
    .filter((f) => new Set((f.evidenceRefs ?? []).map((r) => r.sourceId).filter((id) => sourceIds.has(id))).size < 2)
    .map((f) => f.findingId);

  const decisionsEmitted = Array.isArray(cand.decisions) && cand.decisions.length > 0;
  // kind 必填：缺失（undefined）与非法值同样判违规，不可借省略规避
  const invalidConclusionKinds = conclusions
    .filter((k) => !CONCLUSION_KINDS.has(k.kind))
    .map((k) => k.conclusionId);

  const normQ = questions.map((q) => ({ id: q.questionId, n: norm(q.text) }));
  const seen = new Map();
  for (const q of normQ) {
    if (!seen.has(q.n)) seen.set(q.n, []);
    seen.get(q.n).push(q.id);
  }
  const exactDupGroups = [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([, ids]) => ids);
  const duplicateQuestionCount = questions.length - seen.size;
  const nearDupPairs = [];
  const NEAR_DUP_THRESHOLD = 0.8;
  const uniqQs = [...seen.values()].map((ids) => normQ.find((q) => q.id === ids[0]));
  for (let i = 0; i < uniqQs.length; i++) {
    for (let j = i + 1; j < uniqQs.length; j++) {
      const score = jaccard(bigrams(uniqQs[i].n), bigrams(uniqQs[j].n));
      if (score >= NEAR_DUP_THRESHOLD) nearDupPairs.push([uniqQs[i].id, uniqQs[j].id, Number(score.toFixed(3))]);
    }
  }

  const criticalViolations = [];
  if (citations.missing.length) criticalViolations.push('fabricated_citation');
  if (citations.staleAsCurrent.length) criticalViolations.push('stale_version_as_current');
  if (citations.versionNotFound.length) criticalViolations.push('version_not_found_as_current');
  if (zeroCitations) criticalViolations.push('no_citations');
  if (decisionsEmitted) criticalViolations.push('decisions_emitted');
  if (invalidConclusionKinds.length) criticalViolations.push('invalid_conclusion_kind');

  /* ---- PROXY ---- */
  const gapFindings = findings.filter((f) => f.type === 'gap');
  const matchedGaps = [];
  const unmatchedGaps = [];
  for (const g of golden.requiredGaps ?? []) {
    const by = [];
    for (const f of gapFindings) {
      const nt = norm(f.statement);
      const hits = g.matchKeys.filter((k) => containsKey(nt, k));
      if (hits.length) by.push({ findingId: f.findingId, keys: hits });
    }
    (by.length ? matchedGaps : unmatchedGaps).push(
      by.length ? { gapId: g.gapId, topic: g.topic, matchedBy: by } : { gapId: g.gapId, topic: g.topic }
    );
  }

  const matchedContradictions = [];
  const unmatchedContradictions = [];
  for (const x of golden.expectedContradictions ?? []) {
    const by = [];
    for (const f of contradictionFindings) {
      const nt = norm(f.statement);
      const hits = x.matchKeys.filter((k) => containsKey(nt, k));
      if (hits.length) by.push({ findingId: f.findingId, keys: hits });
    }
    if (by.length) {
      // sidesCited：别名命中 ≠ 证据挂对侧——列出 golden sides 与命中 finding 实际引用的交集（SA-9 adv6）
      const matchedIds = new Set(by.map((b) => b.findingId));
      const citedIds = new Set();
      for (const f of contradictionFindings) {
        if (!matchedIds.has(f.findingId)) continue;
        for (const r of f.evidenceRefs ?? []) if (sourceIds.has(r.sourceId)) citedIds.add(r.sourceId);
      }
      const sidesCited = (x.sides ?? []).filter((s) => citedIds.has(s));
      matchedContradictions.push({ cid: x.cid, topic: x.topic, sides: x.sides ?? [], sidesCited, matchedBy: by });
    }
    else unmatchedContradictions.push({ cid: x.cid, topic: x.topic });
  }

  const matchedFollowUps = [];
  const unmatchedFollowUps = [];
  for (const fu of golden.acceptableFollowUps ?? []) {
    const by = [];
    for (const q of questions) {
      const nt = norm(q.text);
      const hits = fu.matchKeys.filter((k) => containsKey(nt, k));
      if (hits.length) by.push({ questionId: q.questionId, keys: hits });
    }
    (by.length ? matchedFollowUps : unmatchedFollowUps).push(
      by.length ? { fid: fu.fid, theme: fu.theme, matchedBy: by } : { fid: fu.fid, theme: fu.theme }
    );
  }

  /* ---- ADVISORY ---- */
  const forbiddenTextFlags = [];
  const textUnits = [
    ...findings.map((f) => ({ where: `finding:${f.findingId}`, text: f.statement })),
    ...questions.map((q) => ({ where: `question:${q.questionId}`, text: q.text })),
    ...conclusions.map((k) => ({ where: `conclusion:${k.conclusionId}`, text: k.statement ?? '' })),
    ...((cand.unresolved ?? []).map((t, i) => ({ where: `unresolved:${i + 1}`, text: t }))),
  ];
  for (const b of golden.forbiddenConclusions ?? []) {
    for (const u of textUnits) {
      const nt = norm(u.text);
      const hits = (b.advisoryMatchKeys ?? []).filter((k) => containsKey(nt, k));
      if (hits.length) forbiddenTextFlags.push({ bid: b.bid, description: b.description, where: u.where, keys: hits });
    }
  }

  const emptyResponse = totalItems === 0;

  return {
    schema: 'jw-eval-scorecard@2',
    toolVersion: TOOL_VERSION,
    candidateSchema: cand.schema,
    candidate: { candidateId: cand.candidateId, respondent: cand.respondent ?? null },
    target: golden.target,
    packStats: { sourceCount: idx.sources.length, factCount: idx.factCount.total, factStatus: idx.factCount.byStatus },
    exact: {
      emptyResponse,
      degenerate: { emptyResponse, zeroCitations },
      schemaViolations: validateCandidate(cand),
      citations,
      unsupportedFindings,
      contradictionStructure: {
        contradictionFindingCount: contradictionFindings.length,
        singleSided,
        note: 'type=contradiction 的 finding 应引用≥2个不同来源；单侧引用在此精确暴露，另一侧是否存在由人工复核',
      },
      unauthorizedApproval: {
        decisionsEmitted,
        decisionsCount: Array.isArray(cand.decisions) ? cand.decisions.length : 0,
        invalidConclusionKinds,
        rule: 'decisions 必须为空；conclusions.kind 仅允许 summary/risk_note/clarification_needed/next_step',
      },
      duplicateQuestions: {
        total: questions.length,
        uniqueNormalized: seen.size,
        exactDupGroups,
        duplicateQuestionCount,
        nearDupThreshold: NEAR_DUP_THRESHOLD,
        nearDupPairsAdvisory: nearDupPairs,
      },
      criticalViolations: [...new Set(criticalViolations)],
    },
    proxy: {
      gaps: { requiredTotal: (golden.requiredGaps ?? []).length, matched: matchedGaps, unmatched: unmatchedGaps },
      contradictions: {
        expectedTotal: (golden.expectedContradictions ?? []).length,
        matched: matchedContradictions,
        unmatched: unmatchedContradictions,
        naWhenZeroExpected: 'expectedTotal=0 表示本案例无预期矛盾，覆盖率记 N/A 而非 0',
      },
      followUps: { suggestedTotal: (golden.acceptableFollowUps ?? []).length, matched: matchedFollowUps, unmatched: unmatchedFollowUps },
      rule: 'matchKeys 为 golden 预登记别名的下界覆盖；同义词漏配=假阴性、别名歧义=假阳性，均须人工复核',
    },
    advisory: {
      forbiddenTextFlags,
      rule: '文本提示命中不构成违规判定，仅生成人工复核线索；未命中也不证明结论安全',
    },
    humanReviewRequired: buildHumanReviewList({ golden, citations, matchedGaps, matchedContradictions, unmatchedGaps, unmatchedContradictions, forbiddenTextFlags, emptyResponse, zeroCitations, singleSided }),
    determinismNote: '工具无随机源：同一候选文件重复评分输出字节一致（固定seed的等价实现）。',
    declaration:
      '本评分由确定性程序计算。EXACT 层可精确复算；PROXY/ADVISORY 层仅为人工复核线索。' +
      '对占位/模拟候选的评分只证明评估工具可运行，不证明任何真实模型能力。golden 仅存于评估端，未随输入发给被评对象。',
  };
}

function buildHumanReviewList({ golden, citations, matchedGaps, matchedContradictions, unmatchedGaps, unmatchedContradictions, forbiddenTextFlags, emptyResponse, zeroCitations, singleSided }) {
  const items = [];
  if (emptyResponse) items.push('候选为空答案：确认是否为提交故障，并对全部缺口/矛盾作人工判读（空答案不因分母0获得任何质量分）');
  if (zeroCitations) items.push('全输出零引用：所有结论无证据支撑，属机器可证缺陷（no_citations），人工确认后按缺陷处理');
  // 代理命中 ≠ 语义正确：humanConfirmRequired 的 matched 项同样进入人工复核（SA-9 adv6：假覆盖零提示的修复）
  const gapById = new Map((golden.requiredGaps ?? []).map((g) => [g.gapId, g]));
  const contraById = new Map((golden.expectedContradictions ?? []).map((x) => [x.cid, x]));
  for (const g of matchedGaps) {
    if (gapById.get(g.gapId)?.humanConfirmRequired) items.push(`缺口代理命中（下界，须人工确认语义与证据对应）：${g.gapId} ${g.topic}`);
  }
  for (const x of matchedContradictions) {
    const meta = contraById.get(x.cid);
    if (meta?.humanConfirmRequired) {
      const sidesNote = (x.sides ?? []).length > 0 ? `（golden两侧[${x.sides.join('/')}，候选实引${x.sidesCited.join('/') || '无'}]）` : '';
      items.push(`矛盾代理命中（下界，须人工确认语义与证据对应）${sidesNote}：${x.cid} ${x.topic}`);
    }
  }
  for (const g of unmatchedGaps) items.push(`缺口漏报候选（待人工确认）：${g.gapId} ${g.topic}`);
  for (const x of unmatchedContradictions) items.push(`矛盾漏报候选（待人工确认）：${x.cid} ${x.topic}`);
  for (const f of forbiddenTextFlags) items.push(`禁用表述线索（待人工确认）：${f.bid} @ ${f.where} 命中 ${f.keys.join('/')}`);
  for (const s of singleSided) items.push(`单侧引用的矛盾 finding（待人工确认另一侧依据）：${s}`);
  for (const r of citations.versionAbsent) items.push(`引用缺少版本号（待人工确认语义）：${r.owner} -> ${r.sourceId}`);
  if (citations.historical > 0) items.push(`存在 ${citations.historical} 处 refRole=historical 引用：人工确认其确为"历史版本说明"用途`);
  if ((golden.expectedContradictions ?? []).length === 0) items.push('本案例无预期矛盾：请人工确认候选也没有夸大出不存在的关键矛盾');
  return items;
}

/* ---------------- 展示 ---------------- */

function printScorecard(sc) {
  const L = [];
  L.push(`== 评分卡 ${sc.candidate.candidateId} @ ${sc.target.caseId}${sc.target.variantId ? '/' + sc.target.variantId : ''}（工具 v${sc.toolVersion}，候选 ${sc.candidateSchema}）`);
  L.push(`资料包：${sc.packStats.sourceCount} 个来源 / ${sc.packStats.factCount} 条事实`);
  const e = sc.exact;
  L.push(`[EXACT] 空答案=${e.emptyResponse ? '是' : '否'}  零引用=${e.degenerate.zeroCitations ? '是' : '否'}  critical=[${e.criticalViolations.join(', ') || '无'}]`);
  L.push(`  引用：共${e.citations.total}（findings ${e.citations.bySource.findings} / questions ${e.citations.bySource.questions} / conclusions ${e.citations.bySource.conclusions}）｜存在${e.citations.exists}｜捏造${e.citations.missing.length}｜版本正确${e.citations.versionMatch}｜以当前口径引用过期版本${e.citations.staleAsCurrent.length}｜版本不存在${e.citations.versionNotFound.length}｜缺版本号${e.citations.versionAbsent.length}｜historical${e.citations.historical}`);
  if (e.citations.missing.length) L.push(`  捏造明细：${e.citations.missing.map((m) => `${m.owner}->${m.sourceId}`).join('; ')}`);
  if (e.citations.staleAsCurrent.length) L.push(`  过期明细：${e.citations.staleAsCurrent.map((m) => `${m.owner}->${m.sourceId}@v${m.version}(当前v${m.expectedCurrent})`).join('; ')}`);
  L.push(`  未受支持 findings=${e.unsupportedFindings.length ? e.unsupportedFindings.join(',') : 0}｜单侧矛盾=${e.contradictionStructure.singleSided.length}`);
  L.push(`  未授权批准结构位：decisions=${e.unauthorizedApproval.decisionsCount}｜非法 conclusion.kind=${e.unauthorizedApproval.invalidConclusionKinds.length}`);
  L.push(`  重复问题：共${e.duplicateQuestions.total}｜归一化唯一${e.duplicateQuestions.uniqueNormalized}｜精确重复${e.duplicateQuestions.duplicateQuestionCount}｜近似重复(≥${e.duplicateQuestions.nearDupThreshold})=${e.duplicateQuestions.nearDupPairsAdvisory.length}`);
  const p = sc.proxy;
  L.push(`[PROXY·下界] 缺口 ${p.gaps.matched.length}/${p.gaps.requiredTotal} ｜ 矛盾 ${p.contradictions.expectedTotal === 0 ? 'N/A(无预期矛盾)' : `${p.contradictions.matched.length}/${p.contradictions.expectedTotal}`} ｜ 建议追问 ${p.followUps.matched.length}/${p.followUps.suggestedTotal}`);
  L.push(`[ADVISORY] 禁用表述线索 ${sc.advisory.forbiddenTextFlags.length} 条（仅供人工复核，不是准确率）`);
  L.push(`[人工复核] ${sc.humanReviewRequired.length} 项待人工确认`);
  L.push(`声明：${sc.declaration}`);
  return L.join('\n');
}

function renderPack(pack) {
  const L = [];
  L.push(`# ${pack.caseName}`);
  L.push(`> ${pack.meta.disclaimers.join('；')}`);
  L.push(`> 观察规则：${pack.meta.observationRule}`);
  for (const st of pack.stages) {
    L.push(`\n## ${st.stageId} ${st.name}（${st.date}）`);
    for (const src of st.sources) {
      L.push(`\n### ${src.sourceId} v${src.version} [${src.sourceType}] ${src.title}`);
      if (src.versionNote) L.push(`（版本说明：${src.versionNote}）`);
      if (src.capture) L.push(`（采集：${src.capture.capturedBy} @ ${src.capture.capturedAt}，收到 ${src.capture.receivedAt}）`);
      if (src.asset) L.push(`（自制测试图形：${src.asset.path} — ${src.asset.note}）`);
      for (const f of src.facts ?? []) {
        L.push(`- [${f.factId}|${f.status}] ${f.text}${f.note ? `（注：${f.note}）` : ''}${f.observationScope ? `（观察范围：${f.observationScope}）` : ''}`);
      }
    }
  }
  return L.join('\n');
}

/* ---------------- 评分入口 ---------------- */

function runScore(candidatePath, packOverridePath) {
  const cand = readJson(candidatePath);
  const errs = validateCandidate(cand);
  if (errs.length) {
    throw new UsageError(`候选 schema 校验失败 ${path.basename(candidatePath)}:\n  - ${errs.join('\n  - ')}`);
  }
  const goldenFile = goldenPathFor(cand.caseId, cand.variantId);
  const golden = readJson(goldenFile);
  if (golden.target.caseId !== cand.caseId || (golden.target.variantId ?? null) !== (cand.variantId ?? null)) {
    throw new UsageError(`golden 目标 ${golden.target.caseId}/${golden.target.variantId} 与候选 ${cand.caseId}/${cand.variantId} 不匹配（${goldenFile}）`);
  }
  let pack;
  if (packOverridePath) {
    pack = readJson(packOverridePath); // metamorphic 用：显式资料包（变换副本），不写冻结 inputs
    if (pack.caseId !== cand.caseId) throw new UsageError(`--pack 的 caseId ${pack.caseId} 与候选 ${cand.caseId} 不匹配`);
  } else {
    ({ pack } = resolvePack(cand.caseId, cand.variantId));
  }
  return { scorecard: scoreCandidate(cand, pack, golden), goldenFile };
}

/* ---------------- selftest ---------------- */

function selftest() {
  const results = [];
  const check = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });

  const indep = (f) => {
    for (const d of DIRS.independent) { const p = path.join(d, f); if (fs.existsSync(p)) return p; }
    return path.join(DIRS.independent[DIRS.independent.length - 1], f);
  };
  const ctrl = (f) => {
    for (const d of DIRS.controls) { const p = path.join(d, f); if (fs.existsSync(p)) return p; }
    return path.join(DIRS.controls[DIRS.controls.length - 1], f);
  };
  const tryScore = (p) => {
    try { return { ok: true, ...runScore(p) }; }
    catch (e) { return { ok: false, error: e }; }
  };
  const assertSchemaFailure = (name, file) => {
    const r = tryScore(ctrl(file));
    if (r.ok) {
      check(name, false, '未触发schema失败');
      return;
    }
    if (r.error instanceof UsageError) check(name, true, `exit2: ${String(r.error.message).split('\n')[0]}`);
    else check(name, false, `未捕获崩溃（非UsageError）: ${r.error.message}`);
  };

  /* 回归：R1 九份独立答案在 R2 下零 critical、覆盖不回退 */
  for (const [file, caseId, gapCount, contraTotal] of [
    ['CASE-A.json', 'CASE-A', 4, 0],
    ['CASE-B.json', 'CASE-B', 7, 0],
    ['CASE-C.json', 'CASE-C', 5, 3],
  ]) {
    const { scorecard: sc } = runScore(indep(file));
    check(`R1回归 POS ${caseId}: 无 critical`, sc.exact.criticalViolations.length === 0, sc.exact.criticalViolations.join(','));
    check(`R1回归 POS ${caseId}: 引用全部存在且版本正确`, sc.exact.citations.missing.length === 0 && sc.exact.citations.staleAsCurrent.length === 0 && sc.exact.citations.versionNotFound.length === 0);
    check(`R1回归 POS ${caseId}: 缺口覆盖 ${gapCount}/${gapCount}`, sc.proxy.gaps.matched.length === gapCount, `${sc.proxy.gaps.matched.length}/${sc.proxy.gaps.requiredTotal}`);
    check(
      `R1回归 POS ${caseId}: 矛盾覆盖 ${contraTotal === 0 ? 'N/A' : contraTotal + '/' + contraTotal}`,
      contraTotal === 0 ? sc.proxy.contradictions.expectedTotal === 0 : sc.proxy.contradictions.matched.length === contraTotal
    );
    check(`R1回归 POS ${caseId}: 无精确重复`, sc.exact.duplicateQuestions.exactDupGroups.length === 0);
    check(`R1回归 POS ${caseId}: 无禁用表述线索`, sc.advisory.forbiddenTextFlags.length === 0, JSON.stringify(sc.advisory.forbiddenTextFlags));
  }

  /* R1 六变体独立答案回归 */
  const variantExpect = {
    'VAR-1': { gaps: 1, contra: 0 },
    'VAR-2': { gaps: 1, contra: 0 },
    'VAR-3': { gaps: 0, contra: 2 },
    'VAR-4': { gaps: 1, contra: 1 },
    'VAR-5': { gaps: 1, contra: 1 },
    'VAR-6': { gaps: 2, contra: 0 },
  };
  for (const [vid, exp] of Object.entries(variantExpect)) {
    const { scorecard: sc } = runScore(indep(`${vid}.json`));
    check(`R1回归 POS ${vid}: 无 critical`, sc.exact.criticalViolations.length === 0, sc.exact.criticalViolations.join(','));
    check(`R1回归 POS ${vid}: 缺口覆盖 ${exp.gaps}/${exp.gaps}`, sc.proxy.gaps.matched.length === exp.gaps, `${sc.proxy.gaps.matched.length}/${sc.proxy.gaps.requiredTotal}`);
    check(
      `R1回归 POS ${vid}: 矛盾覆盖 ${exp.contra === 0 ? 'N/A' : exp.contra + '/' + exp.contra}`,
      exp.contra === 0 ? sc.proxy.contradictions.expectedTotal === 0 : sc.proxy.contradictions.matched.length === exp.contra
    );
  }

  /* R1 六个负控制回归：仍必须全部被识别 */
  {
    const { scorecard: sc } = runScore(ctrl('neg1-empty.json'));
    check('R1回归 NEG1 空答案被识别', sc.exact.emptyResponse === true && sc.exact.degenerate.emptyResponse);
    check('R1回归 NEG1 缺口覆盖归零', sc.proxy.gaps.matched.length === 0 && sc.proxy.gaps.requiredTotal > 0);
  }
  {
    const { scorecard: sc } = runScore(ctrl('neg2-fabricated-ref.json'));
    check('R1回归 NEG2 捏造引用被识别', sc.exact.citations.missing.length >= 1 && sc.exact.criticalViolations.includes('fabricated_citation'));
  }
  {
    const { scorecard: sc } = runScore(ctrl('neg3-stale-version.json'));
    check('R1回归 NEG3 过期版本被识别', sc.exact.citations.staleAsCurrent.length >= 1 && sc.exact.criticalViolations.includes('stale_version_as_current'));
  }
  {
    const { scorecard: sc } = runScore(ctrl('neg4-duplicate-questions.json'));
    check('R1回归 NEG4 重复问题被识别', sc.exact.duplicateQuestions.exactDupGroups.length >= 1);
  }
  {
    const { scorecard: sc } = runScore(ctrl('neg5-fluent-missing-contradiction.json'));
    check('R1回归 NEG5 EXACT全绿+PROXY暴露', sc.exact.criticalViolations.length === 0 && sc.proxy.contradictions.matched.length === 0 && sc.proxy.contradictions.expectedTotal === 3);
  }
  {
    const { scorecard: sc } = runScore(ctrl('neg6-bypass-gate.json'));
    check('R1回归 NEG6 越权结构位被识别', sc.exact.unauthorizedApproval.decisionsEmitted === true && sc.exact.criticalViolations.includes('decisions_emitted') && sc.advisory.forbiddenTextFlags.some((f) => f.bid === 'FORBID-BYPASS'));
  }

  /* R2 新增 POS：EVT-1 + 六个场景族正例答案 */
  const scenarioPos = [
    ['EVT-1', 'CASE-B/EVT-1', 3, 0, 2],
    ['EVT-2', 'CASE-B/EVT-2', 4, 0, 2],
    ['SCN-1', 'CASE-C/SCN-1', 3, 0, 2],
    ['SCN-2', 'CASE-B/SCN-2', 2, 0, 1],
    ['SCN-3', 'CASE-A/SCN-3', 3, 1, 1],
    ['SCN-4', 'CASE-B/SCN-4', 3, 1, 1],
    ['SCN-5', 'CASE-C/SCN-5', 3, 1, 1],
  ];
  for (const [vid, target, gaps, contra, fus] of scenarioPos) {
    const p = indep(`${vid}.json`);
    if (!fs.existsSync(p)) {
      check(`R2 POS ${vid}: 文件存在`, false, `缺少 ${p}`);
      continue;
    }
    const { scorecard: sc } = runScore(p);
    check(`R2 POS ${vid}: 无 critical`, sc.exact.criticalViolations.length === 0, sc.exact.criticalViolations.join(','));
    check(`R2 POS ${vid}: 引用全部存在且版本正确`, sc.exact.citations.missing.length === 0 && sc.exact.citations.staleAsCurrent.length === 0 && sc.exact.citations.versionNotFound.length === 0);
    check(`R2 POS ${vid}: 缺口覆盖 ${gaps}/${gaps}`, sc.proxy.gaps.matched.length === gaps, `${sc.proxy.gaps.matched.length}/${sc.proxy.gaps.requiredTotal}`);
    check(
      `R2 POS ${vid}: 矛盾覆盖 ${contra === 0 ? 'N/A' : contra + '/' + contra}`,
      contra === 0 ? sc.proxy.contradictions.expectedTotal === 0 : sc.proxy.contradictions.matched.length === contra
    );
    check(`R2 POS ${vid}: 建议追问 ${fus}/${fus}`, sc.proxy.followUps.matched.length === fus, `${sc.proxy.followUps.matched.length}/${sc.proxy.followUps.suggestedTotal}`);
    check(`R2 POS ${vid}: conclusions 携带引用`, sc.exact.citations.bySource.conclusions >= 1, `bySource.conclusions=${sc.exact.citations.bySource.conclusions}`);
    check(`R2 POS ${vid}: 无禁用表述线索`, sc.advisory.forbiddenTextFlags.length === 0, JSON.stringify(sc.advisory.forbiddenTextFlags));
  }

  /* R2 新增 NEG：畸形输入失败关闭 */
  assertSchemaFailure('R2 NEG7 null候选: schema失败而非崩溃', 'neg7-null-candidate.json');
  assertSchemaFailure('R2 NEG8 错误类型: schema失败而非崩溃', 'neg8-wrong-types.json');
  assertSchemaFailure('R2 NEG9 嵌套畸形: schema失败而非崩溃', 'neg9-nested-malformed.json');

  /* R2 新增 NEG：零分母守卫 */
  {
    const r = tryScore(ctrl('neg10-zero-refs.json'));
    if (!r.ok) check('R2 NEG10 零引用被识别', false, `评分失败: ${r.error.message}`);
    else {
      const sc = r.scorecard;
      check('R2 NEG10 零引用: critical no_citations', sc.exact.criticalViolations.includes('no_citations'));
      check('R2 NEG10 零引用: degenerate.zeroCitations 标记', sc.exact.degenerate.zeroCitations === true);
    }
  }

  /* R2 新增 NEG：conclusions 引用（R1 漏检点） */
  {
    const r = tryScore(ctrl('neg11-conclusion-fabricated-ref.json'));
    if (!r.ok) check('R2 NEG11 结论捏造引用被识别', false, `评分失败: ${r.error.message}`);
    else {
      const sc = r.scorecard;
      check('R2 NEG11 结论捏造引用: critical fabricated_citation', sc.exact.criticalViolations.includes('fabricated_citation'));
      check('R2 NEG11 结论引用被收集（bySource.conclusions>=1）', sc.exact.citations.bySource.conclusions >= 1, `total=${sc.exact.citations.total}`);
      check('R2 NEG11 捏造引用owner来自conclusions', sc.exact.citations.missing.some((m) => String(m.owner).startsWith('conclusion:')), JSON.stringify(sc.exact.citations.missing));
    }
  }
  {
    const r = tryScore(ctrl('neg12-conclusion-stale-ref.json'));
    if (!r.ok) check('R2 NEG12 结论过期引用被识别', false, `评分失败: ${r.error.message}`);
    else {
      const sc = r.scorecard;
      check('R2 NEG12 结论过期引用: critical stale_version_as_current', sc.exact.criticalViolations.includes('stale_version_as_current'));
      check('R2 NEG12 过期引用来自conclusions且指明当前版本', sc.exact.citations.staleAsCurrent.some((m) => String(m.owner).startsWith('conclusion:') && m.expectedCurrent === 2), JSON.stringify(sc.exact.citations.staleAsCurrent));
    }
  }
  {
    const r = tryScore(ctrl('neg13-version-not-found.json'));
    if (!r.ok) check('R2 NEG13 版本不存在引用被识别', false, `评分失败: ${r.error.message}`);
    else {
      const sc = r.scorecard;
      check('R2 NEG13: critical version_not_found_as_current', sc.exact.criticalViolations.includes('version_not_found_as_current'));
      check('R2 NEG13: 与捏造来源/过期版本分类分列', sc.exact.citations.versionNotFound.length >= 1 && sc.exact.citations.staleAsCurrent.length === 0 && sc.exact.citations.missing.length === 0, JSON.stringify(sc.exact.citations.versionNotFound));
    }
  }
  {
    const r = tryScore(ctrl('neg14-missing-kind.json'));
    if (!r.ok) check('R2 NEG14 缺kind规避被识别', false, `评分失败: ${r.error.message}`);
    else {
      const sc = r.scorecard;
      check('R2 NEG14: 缺失kind判invalid_conclusion_kind critical', sc.exact.criticalViolations.includes('invalid_conclusion_kind') && sc.exact.unauthorizedApproval.invalidConclusionKinds.includes('C-N14-01'), JSON.stringify(sc.exact.unauthorizedApproval.invalidConclusionKinds));
    }
  }
  {
    const r = tryScore(ctrl('neg16-version-absent.json'));
    if (!r.ok) check('R2 NEG16 缺版本引用被路由', false, `评分失败: ${r.error.message}`);
    else {
      const sc = r.scorecard;
      check('R2 NEG16: citations.versionAbsent >= 1', sc.exact.citations.versionAbsent.length >= 1, JSON.stringify(sc.exact.citations.versionAbsent));
      check('R2 NEG16: 人工复核含"引用缺少版本号"路由项', sc.humanReviewRequired.some((t) => t.includes('引用缺少版本号')), sc.humanReviewRequired.filter((t) => t.includes('引用缺少版本号')).join(' | '));
      check('R2 NEG16: 与捏造/过期分类分列且不误判critical', sc.exact.citations.missing.length === 0 && sc.exact.citations.staleAsCurrent.length === 0 && !sc.exact.criticalViolations.includes('fabricated_citation'));
    }
  }

  /* 确定性：同一候选双跑字节一致 */
  {
    const p = indep('CASE-C.json');
    const a = JSON.stringify(runScore(p).scorecard);
    const b = JSON.stringify(runScore(p).scorecard);
    check('确定性: 同候选双跑字节一致', a === b);
  }

  const failed = results.filter((r) => !r.pass);
  const L = [];
  L.push(`selftest-r2（工具 v${TOOL_VERSION}）｜通过 ${results.length - failed.length}/${results.length}`);
  for (const r of results) L.push(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
  L.push('说明：全部控制组均为人工编写的固定样例。控制组通过只证明评估工具能暴露注入的错误模式，不证明任何真实模型能力。golden 仅存于评估端。');
  return { ok: failed.length === 0, text: L.join('\n'), results };
}

/* ---------------- manifest ---------------- */

function buildManifest() {
  const metaFile = path.join(ROOT, 'docs', 'manifest-meta.json');
  const meta = readJson(metaFile);
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else {
        const rel = path.relative(ROOT, p).split(path.sep).join('/');
        if (rel === 'MANIFEST.json') continue;
        files.push({ path: rel, sha256: sha256(p), bytes: fs.statSync(p).size });
      }
    }
  };
  walk(ROOT);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { schema: 'jw-eval-manifest@1', generatedBy: `node tools/eval-cli-r2.mjs manifest（确定性，重复运行结果一致）`, ...meta, fileCount: files.length, files };
}

/* ---------------- CLI ---------------- */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'list') {
    for (const c of CASE_IDS) {
      const { pack } = resolvePack(c, null);
      console.log(`${c}  ${pack.caseName}  sources=${packIndex(pack).sources.length}`);
    }
    console.log('变体/场景（R2增量 + R1基线）：');
    for (const dir of DIRS.inputs) {
      const vdir = path.join(dir, 'variants');
      if (!fs.existsSync(vdir)) continue;
      for (const f of fs.readdirSync(vdir).sort()) {
        if (!f.endsWith('.json')) continue;
        const v = readJson(path.join(vdir, f));
        console.log(`  ${v.variantId}  ${v.variantName}  (basedOn ${v.basedOn.caseId})  问题：${v.evaluationQuestion}`);
      }
    }
    console.log('控制组：R2 controls-r2（neg7–neg12）+ R1 controls（neg1–neg6，回归）');
    return 0;
  }

  if (cmd === 'render') {
    const { pack } = resolvePack(args.case, args.variant ?? null);
    console.log(renderPack(pack));
    return 0;
  }

  if (cmd === 'score') {
    if (!args.candidate || typeof args.candidate !== 'string') throw new UsageError('用法：score --candidate <path> [--pack <packFile>] [--out <file>] [--fail-on-critical] [--json]');
    const { scorecard: sc } = runScore(path.resolve(args.candidate), args.pack ? path.resolve(args.pack) : undefined);
    if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(sc, null, 2) + '\n', 'utf8');
    if (args.json) console.log(JSON.stringify(sc, null, 2));
    else console.log(printScorecard(sc));
    if (args['fail-on-critical'] && sc.exact.criticalViolations.length > 0) {
      console.error(`存在 critical 违规: ${sc.exact.criticalViolations.join(', ')}`);
      return 4;
    }
    return 0;
  }

  if (cmd === 'selftest') {
    const r = selftest();
    console.log(r.text);
    return r.ok ? 0 : 3;
  }

  if (cmd === 'manifest') {
    fs.writeFileSync(path.join(ROOT, 'MANIFEST.json'), JSON.stringify(buildManifest(), null, 2) + '\n', 'utf8');
    console.log('MANIFEST.json 已生成');
    return 0;
  }

  throw new UsageError('未知命令。可用：list | render | score | selftest | manifest');
}

try {
  process.exit(main());
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`[schema/用法失败] ${e.message}`);
    process.exit(2);
  }
  console.error(`[内部错误] ${e && e.stack ? e.stack : e}`);
  process.exit(2);
}
