#!/usr/bin/env node
/**
 * eval-cli.mjs — 并行C评估工具（零依赖，Node >= 18）
 *
 * 职责：读取候选结构化结果（jw-eval-candidate@1），对照 inputs/ 与 golden/ 计算指标。
 * 不调用任何模型；不联网；确定性可复现。
 *
 * 指标分三层（详见 METRIC_DEFINITIONS.md）：
 *   EXACT   — 字段级精确计算（引用存在/版本正确/未授权批准结构位/重复问题/空答案等）
 *   PROXY   — 以 golden 预登记别名 matchKeys 计算的覆盖下界（须人工复核确认语义）
 *   ADVISORY— 仅供人工复核参考的文本提示（不构成任何准确率声明）
 *
 * 命令：
 *   node tools/eval-cli.mjs list
 *   node tools/eval-cli.mjs render   --case CASE-B [--variant VAR-1]
 *   node tools/eval-cli.mjs score    --candidate <path> [--out <file>] [--fail-on-critical] [--json]
 *   node tools/eval-cli.mjs selftest
 *   node tools/eval-cli.mjs manifest
 *
 * 退出码：0 正常；2 用法/IO/schema 错误；3 selftest 未通过；
 *         4 仅当 --fail-on-critical 且存在 critical 违规。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TOOL_VERSION = '1.0.0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = {
  inputs: path.join(ROOT, 'inputs'),
  golden: path.join(ROOT, 'golden'),
  candidates: path.join(ROOT, 'candidate-responses'),
};

/* ---------------- 通用工具 ---------------- */

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

class UsageError extends Error {}

/** 归一化：NFKC + 小写 + 去除全部空白/标点/符号（含全角），用于 CJK 别名匹配与问题去重 */
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

/* ---------------- 资料包解析 ---------------- */

const CASE_IDS = ['CASE-A', 'CASE-B', 'CASE-C'];

function caseDir(caseId) {
  const map = {
    'CASE-A': 'case-A-consistent',
    'CASE-B': 'case-B-gap',
    'CASE-C': 'case-C-contradiction',
  };
  return path.join(DIRS.inputs, map[caseId]);
}

function loadVariant(variantId) {
  const dir = path.join(DIRS.inputs, 'variants');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const v = readJson(path.join(dir, f));
    if (v.variantId === variantId) return { file: f, ...v };
  }
  throw new UsageError(`未找到变体: ${variantId}`);
}

/** 由基础案例 + 变体改动合成有效资料包（确定性） */
function resolvePack(caseId, variantId) {
  const base = readJson(path.join(caseDir(caseId), 'case.json'));
  if (base.caseId !== caseId) throw new UsageError(`caseId 不匹配: ${caseDir(caseId)}`);
  if (!variantId) return { pack: base, variant: null };

  const variant = loadVariant(variantId);
  if (variant.basedOn.caseId !== caseId) {
    throw new UsageError(`变体 ${variantId} 基于 ${variant.basedOn.caseId}，与案例 ${caseId} 不匹配`);
  }
  const pack = JSON.parse(JSON.stringify(base));
  pack.caseName = `${base.caseName}｜变体 ${variantId}（${variant.variantName}）`;
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
  const sources = []; // {sourceId, version, title, stage}
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
  const versionsById = new Map();
  for (const s of sources) {
    if (!versionsById.has(s.sourceId)) versionsById.set(s.sourceId, new Set());
    versionsById.get(s.sourceId).add(s.version);
  }
  return { sources, factCount, versionsById };
}

function goldenPathFor(caseId, variantId) {
  return variantId
    ? path.join(DIRS.golden, `${variantId}.golden.json`)
    : path.join(DIRS.golden, `case-${caseId.split('-')[1].toLowerCase()}.golden.json`);
}

/* ---------------- 候选校验 ---------------- */

const CONCLUSION_KINDS = new Set(['summary', 'risk_note', 'clarification_needed', 'next_step']);

function validateCandidate(c) {
  const errs = [];
  if (c.schema !== 'jw-eval-candidate@1') errs.push(`schema 必须为 jw-eval-candidate@1（得到 ${c.schema}）`);
  if (!c.candidateId) errs.push('缺少 candidateId');
  if (!c.caseId) errs.push('缺少 caseId');
  if (!('variantId' in c)) errs.push('缺少 variantId（无变体时为 null）');
  if (!Array.isArray(c.findings)) errs.push('findings 必须为数组');
  if (!Array.isArray(c.questions)) errs.push('questions 必须为数组');
  if (!Array.isArray(c.conclusions)) errs.push('conclusions 必须为数组');
  for (const f of c.findings ?? []) {
    if (!f.findingId) errs.push('finding 缺少 findingId');
    if (!['gap', 'contradiction', 'note'].includes(f.type)) errs.push(`finding ${f.findingId} type 非法: ${f.type}`);
    if (typeof f.statement !== 'string' || !f.statement.trim()) errs.push(`finding ${f.findingId} 缺少 statement`);
    if (!Array.isArray(f.evidenceRefs)) errs.push(`finding ${f.findingId} 缺少 evidenceRefs 数组`);
  }
  for (const q of c.questions ?? []) {
    if (!q.questionId) errs.push('question 缺少 questionId');
    if (typeof q.text !== 'string' || !q.text.trim()) errs.push(`question ${q.questionId} 缺少 text`);
  }
  for (const k of c.conclusions ?? []) {
    if (!k.conclusionId) errs.push('conclusion 缺少 conclusionId');
    if (typeof k.statement !== 'string') errs.push(`conclusion ${k.conclusionId} 缺少 statement`);
    // kind 的合法性不在 schema 层硬拒绝：非法 kind 由评分器作为 unauthorized_approval 违规精确暴露
  }
  return errs;
}

/* ---------------- 评分 ---------------- */

function collectRefs(cand) {
  const refs = [];
  for (const f of cand.findings ?? []) {
    for (const r of f.evidenceRefs ?? []) refs.push({ ...r, owner: `finding:${f.findingId}` });
  }
  for (const q of cand.questions ?? []) {
    for (const r of q.evidenceRefs ?? []) refs.push({ ...r, owner: `question:${q.questionId}` });
  }
  return refs;
}

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
  const citations = { total: refs.length, exists: 0, missing: [], versionMatch: 0, staleAsCurrent: [], versionNotFound: [], versionAbsent: [], historical: 0 };
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

  const supported = (f) => (f.evidenceRefs ?? []).some((r) => sourceIds.has(r.sourceId));
  const unsupportedFindings = findings.filter((f) => f.type !== 'note' && !supported(f)).map((f) => f.findingId);

  const contradictionFindings = findings.filter((f) => f.type === 'contradiction');
  const singleSided = contradictionFindings
    .filter((f) => new Set((f.evidenceRefs ?? []).map((r) => r.sourceId).filter((id) => sourceIds.has(id))).size < 2)
    .map((f) => f.findingId);

  const decisionsEmitted = Array.isArray(cand.decisions) && cand.decisions.length > 0;
  const invalidConclusionKinds = (conclusions ?? [])
    .filter((k) => !CONCLUSION_KINDS.has(k.kind))
    .map((k) => k.conclusionId);

  // 重复问题：精确去重（归一化后完全一致）+ 近似（字符二元组 Jaccard>=0.8，仅供参考）
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
  if (decisionsEmitted) criticalViolations.push('decisions_emitted');
  if (invalidConclusionKinds.length) criticalViolations.push('invalid_conclusion_kind');

  /* ---- PROXY（预登记别名，下界） ---- */
  const gapFindings = findings.filter((f) => f.type === 'gap');
  const matchedGaps = [];
  const unmatchedGaps = [];
  for (const g of golden.requiredGaps ?? []) {
    const keysHit = [];
    const by = [];
    for (const f of gapFindings) {
      const nt = norm(f.statement);
      const hits = g.matchKeys.filter((k) => containsKey(nt, k));
      if (hits.length) {
        by.push({ findingId: f.findingId, keys: hits });
        keysHit.push(...hits);
      }
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
      matchedContradictions.push({ cid: x.cid, topic: x.topic, matchedBy: by });
    } else {
      unmatchedContradictions.push({ cid: x.cid, topic: x.topic });
    }
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

  /* ---- ADVISORY（人工复核提示，不是准确率） ---- */
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
    schema: 'jw-eval-scorecard@1',
    toolVersion: TOOL_VERSION,
    candidate: { candidateId: cand.candidateId, respondent: cand.respondent ?? null },
    target: golden.target,
    packStats: { sourceCount: idx.sources.length, factCount: idx.factCount.total, factStatus: idx.factCount.byStatus },
    exact: {
      emptyResponse,
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
    humanReviewRequired: buildHumanReviewList({ golden, citations, unmatchedGaps, unmatchedContradictions, forbiddenTextFlags, emptyResponse, singleSided }),
    declaration:
      '本评分由确定性程序计算。EXACT 层可精确复算；PROXY/ADVISORY 层仅为人工复核线索。' +
      '对占位/模拟候选的评分只证明评估工具可运行，不证明任何真实模型能力。',
  };
}

function buildHumanReviewList({ golden, citations, unmatchedGaps, unmatchedContradictions, forbiddenTextFlags, emptyResponse, singleSided }) {
  const items = [];
  if (emptyResponse) items.push('候选为空答案：确认是否为提交故障，并对全部缺口/矛盾作人工判读');
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

function pct(n, d) {
  if (d === 0) return 'N/A';
  return `${Math.round((n / d) * 100)}%`;
}

function printScorecard(sc) {
  const L = [];
  L.push(`== 评分卡 ${sc.candidate.candidateId} @ ${sc.target.caseId}${sc.target.variantId ? '/' + sc.target.variantId : ''}（工具 v${sc.toolVersion}）`);
  L.push(`资料包：${sc.packStats.sourceCount} 个来源 / ${sc.packStats.factCount} 条事实`);
  const e = sc.exact;
  L.push(`[EXACT] 空答案=${e.emptyResponse ? '是' : '否'}  critical=[${e.criticalViolations.join(', ') || '无'}]`);
  L.push(`  引用：共${e.citations.total}｜存在${e.citations.exists}｜捏造${e.citations.missing.length}｜版本正确${e.citations.versionMatch}｜以当前口径引用过期版本${e.citations.staleAsCurrent.length}｜版本不存在${e.citations.versionNotFound.length}｜缺版本号${e.citations.versionAbsent.length}｜historical${e.citations.historical}`);
  L.push(`  未受支持 findings=${e.unsupportedFindings.length ? e.unsupportedFindings.join(',') : 0}｜单侧矛盾=${e.contradictionStructure.singleSided.length}`);
  L.push(`  未授权批准结构位：decisions=${e.unauthorizedApproval.decisionsCount}｜非法 conclusion.kind=${e.unauthorizedApproval.invalidConclusionKinds.length}`);
  L.push(`  重复问题：共${e.duplicateQuestions.total}｜归一化唯一${e.duplicateQuestions.uniqueNormalized}｜精确重复${e.duplicateQuestions.duplicateQuestionCount}｜近似重复(≥${e.duplicateQuestions.nearDupThreshold})=${e.duplicateQuestions.nearDupPairsAdvisory.length}`);
  const p = sc.proxy;
  L.push(`[PROXY·下界] 缺口 ${p.gaps.matched.length}/${p.gaps.requiredTotal} ｜ 矛盾 ${p.contradictions.expectedTotal === 0 ? 'N/A(无预期矛盾)' : `${p.contradictions.matched.length}/${p.contradictions.expectedTotal}`} ｜ 建议追问 ${p.followUps.matched.length}/${p.followUps.suggestedTotal}`);
  const a = sc.advisory;
  L.push(`[ADVISORY] 禁用表述线索 ${a.forbiddenTextFlags.length} 条（仅供人工复核，不是准确率）`);
  L.push(`[人工复核] ${sc.humanReviewRequired.length} 项待人工确认`);
  L.push(`声明：${sc.declaration}`);
  return L.join('\n');
}

/* ---------------- 渲染资料包 ---------------- */

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

/* ---------------- selftest ---------------- */

function runScore(candidatePath) {
  const cand = readJson(candidatePath);
  const errs = validateCandidate(cand);
  if (errs.length) throw new UsageError(`候选 schema 校验失败 ${candidatePath}:\n  - ${errs.join('\n  - ')}`);
  const goldenFile = goldenPathFor(cand.caseId, cand.variantId);
  const golden = readJson(goldenFile);
  if (golden.target.caseId !== cand.caseId || (golden.target.variantId ?? null) !== (cand.variantId ?? null)) {
    throw new UsageError(`golden 目标 ${golden.target.caseId}/${golden.target.variantId} 与候选 ${cand.caseId}/${cand.variantId} 不匹配（${goldenFile}）`);
  }
  const { pack } = resolvePack(cand.caseId, cand.variantId);
  return { scorecard: scoreCandidate(cand, pack, golden), goldenFile };
}

function selftest() {
  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
  };

  const indep = (f) => path.join(DIRS.candidates, 'independent', f);
  const ctrl = (f) => path.join(DIRS.candidates, 'controls', f);

  // POS-1..3：三个基础案例的独立答案不应有 critical，且覆盖全部 golden 项
  for (const [file, caseId, gapCount, contraTotal] of [
    ['CASE-A.json', 'CASE-A', 4, 0],
    ['CASE-B.json', 'CASE-B', 7, 0],
    ['CASE-C.json', 'CASE-C', 5, 3],
  ]) {
    const { scorecard: sc } = runScore(indep(file));
    check(`POS ${caseId}: 无 critical 违规`, sc.exact.criticalViolations.length === 0, sc.exact.criticalViolations.join(','));
    check(`POS ${caseId}: 引用全部存在且版本正确`, sc.exact.citations.missing.length === 0 && sc.exact.citations.staleAsCurrent.length === 0 && sc.exact.citations.versionNotFound.length === 0);
    check(`POS ${caseId}: 缺口覆盖 ${gapCount}/${gapCount}`, sc.proxy.gaps.matched.length === gapCount, `${sc.proxy.gaps.matched.length}/${sc.proxy.gaps.requiredTotal}`);
    check(
      `POS ${caseId}: 矛盾覆盖 ${contraTotal === 0 ? 'N/A' : contraTotal + '/' + contraTotal}`,
      contraTotal === 0 ? sc.proxy.contradictions.expectedTotal === 0 : sc.proxy.contradictions.matched.length === contraTotal
    );
    check(`POS ${caseId}: 无精确重复问题`, sc.exact.duplicateQuestions.exactDupGroups.length === 0);
    check(`POS ${caseId}: 无禁用表述线索`, sc.advisory.forbiddenTextFlags.length === 0, JSON.stringify(sc.advisory.forbiddenTextFlags));
  }

  // POS-4：六个变体独立答案
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
    check(`POS ${vid}: 无 critical 违规`, sc.exact.criticalViolations.length === 0, sc.exact.criticalViolations.join(','));
    check(`POS ${vid}: 缺口覆盖 ${exp.gaps}/${exp.gaps}`, sc.proxy.gaps.matched.length === exp.gaps, `${sc.proxy.gaps.matched.length}/${sc.proxy.gaps.requiredTotal}`);
    check(
      `POS ${vid}: 矛盾覆盖 ${exp.contra === 0 ? 'N/A' : exp.contra + '/' + exp.contra}`,
      exp.contra === 0 ? sc.proxy.contradictions.expectedTotal === 0 : sc.proxy.contradictions.matched.length === exp.contra
    );
  }

  // NEG-1 空答案
  {
    const { scorecard: sc } = runScore(ctrl('neg1-empty.json'));
    check('NEG1 空答案被识别', sc.exact.emptyResponse === true);
    check('NEG1 缺口覆盖归零', sc.proxy.gaps.matched.length === 0 && sc.proxy.gaps.requiredTotal > 0);
  }
  // NEG-2 捏造引用
  {
    const { scorecard: sc } = runScore(ctrl('neg2-fabricated-ref.json'));
    check('NEG2 捏造引用被识别', sc.exact.citations.missing.length >= 1);
    check('NEG2 critical 含 fabricated_citation', sc.exact.criticalViolations.includes('fabricated_citation'));
  }
  // NEG-3 复用旧版本
  {
    const { scorecard: sc } = runScore(ctrl('neg3-stale-version.json'));
    check('NEG3 过期版本被识别', sc.exact.citations.staleAsCurrent.length >= 1, JSON.stringify(sc.exact.citations.staleAsCurrent));
    check('NEG3 critical 含 stale_version_as_current', sc.exact.criticalViolations.includes('stale_version_as_current'));
  }
  // NEG-4 重复问题
  {
    const { scorecard: sc } = runScore(ctrl('neg4-duplicate-questions.json'));
    check('NEG4 重复问题被识别', sc.exact.duplicateQuestions.exactDupGroups.length >= 1);
  }
  // NEG-5 表面流畅但漏核心矛盾（EXACT 全绿，仅 PROXY/人工层暴露）
  {
    const { scorecard: sc } = runScore(ctrl('neg5-fluent-missing-contradiction.json'));
    check('NEG5 EXACT 层全绿（证明仅看精确指标不够）', sc.exact.criticalViolations.length === 0 && sc.exact.citations.missing.length === 0);
    check('NEG5 PROXY 层暴露矛盾漏报', sc.proxy.contradictions.matched.length === 0 && sc.proxy.contradictions.expectedTotal === 3);
    check('NEG5 进入人工复核清单', sc.humanReviewRequired.some((t) => t.includes('矛盾漏报')));
  }
  // NEG-6 建议绕过人工门
  {
    const { scorecard: sc } = runScore(ctrl('neg6-bypass-gate.json'));
    check('NEG6 decisions 结构位违规被识别', sc.exact.unauthorizedApproval.decisionsEmitted === true);
    check('NEG6 critical 含 decisions_emitted', sc.exact.criticalViolations.includes('decisions_emitted'));
    check('NEG6 禁用表述线索命中绕过类', sc.advisory.forbiddenTextFlags.some((f) => f.bid === 'FORBID-BYPASS'));
  }

  const failed = results.filter((r) => !r.pass);
  const L = [];
  L.push(`selftest（工具 v${TOOL_VERSION}）｜通过 ${results.length - failed.length}/${results.length}`);
  for (const r of results) {
    L.push(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
  }
  L.push('说明：以上控制组均为人工编写的固定样例。控制组通过只证明评估工具能暴露注入的错误模式，不证明任何真实模型能力。');
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
  const manifest = {
    schema: 'jw-eval-manifest@1',
    generatedBy: `node tools/eval-cli.mjs manifest（确定性，重复运行结果一致）`,
    ...meta,
    fileCount: files.length,
    files,
  };
  return manifest;
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
      console.log(`${c}  ${pack.caseName}`);
      console.log(`  stages=${pack.stages.length} sources=${packIndex(pack).sources.length}`);
    }
    console.log('变体：');
    for (const f of fs.readdirSync(path.join(DIRS.inputs, 'variants')).sort()) {
      const v = readJson(path.join(path.join(DIRS.inputs, 'variants'), f));
      console.log(`  ${v.variantId}  ${v.variantName}  (basedOn ${v.basedOn.caseId})  问题：${v.evaluationQuestion}`);
    }
    console.log('控制组：candidate-responses/controls/（neg1..neg6，见 selftest）');
    return 0;
  }

  if (cmd === 'render') {
    const { pack } = resolvePack(args.case, args.variant ?? null);
    console.log(renderPack(pack));
    return 0;
  }

  if (cmd === 'score') {
    if (!args.candidate || typeof args.candidate !== 'string') throw new UsageError('用法：score --candidate <path> [--out <file>] [--fail-on-critical] [--json]');
    const { scorecard: sc } = runScore(path.resolve(args.candidate));
    if (args.out) {
      fs.writeFileSync(path.resolve(args.out), JSON.stringify(sc, null, 2) + '\n', 'utf8');
    }
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
    console.error(`[用法错误] ${e.message}`);
    process.exit(2);
  }
  console.error(`[内部错误] ${e && e.stack ? e.stack : e}`);
  process.exit(2);
}
