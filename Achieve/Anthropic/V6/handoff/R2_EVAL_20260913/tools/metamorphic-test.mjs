#!/usr/bin/env node
/**
 * metamorphic-test.mjs — 评估器 metamorphic 测试（零依赖；变换只落在 evidence-r2/metamorphic/ 副本，冻结 inputs 零改动）
 *
 * 目的：验证"评分器"在输入变换下的预期性质（不是模型能力测试）：
 *   T1 语义改写（候选侧）  ：候选statement同义改写 → EXACT 指标必须不变；PROXY 别名覆盖允许下降（人工代理指标，如实验证别名依赖）。
 *   T2 无关文字（资料包侧）：添加无关来源     → EXACT 评分不变（仅 packStats 变化）。
 *   T3 同源重复（资料包侧）：添加同源重复来源 → 不产生新 critical；packStats 变化。
 *   T4 顺序变化（资料包侧）：stages/sources 洗牌 → 评分卡字节一致（评分与呈现顺序无关）。
 *   T5 版本替换（资料包侧）：给某来源加更高版本 → 引用旧版本的候选被翻转判 stale（版本逻辑敏感）。
 *
 * 用法：node tools/metamorphic-test.mjs
 * 退出码：0 全部 EXACT 断言成立；3 有断言失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.resolve(ROOT, '..', 'PARALLEL_EVAL_20260913');
const OUT_DIR = path.join(ROOT, 'evidence-r2', 'metamorphic');
const CLI = path.join(ROOT, 'tools', 'eval-cli-r2.mjs');
const PROBE_CANDIDATE = path.join(BASELINE, 'candidate-responses', 'independent', 'CASE-B.json'); // 固定探针候选（R1正控制，稳定）

fs.mkdirSync(OUT_DIR, { recursive: true });

const basePack = JSON.parse(fs.readFileSync(path.join(BASELINE, 'inputs', 'case-B-gap', 'case.json'), 'utf8'));

function score(candidatePath, packPath) {
  const args = [CLI, 'score', '--candidate', candidatePath, '--json'];
  if (packPath) args.push('--pack', packPath);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`score 失败 exit=${r.status}: ${r.stderr.slice(0, 400)}`);
  return JSON.parse(r.stdout);
}

function writePack(name, pack) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  return p;
}

/* 变换构造（全部只作用于副本） */

const t2Pack = JSON.parse(JSON.stringify(basePack));
t2Pack.stages[t2Pack.stages.length - 1].sources.push({
  sourceId: 'B-NEWS-90', version: 1, sourceType: 'written_document', title: '园区通告摘录（与租赁标的无直接关系）',
  facts: [{ factId: 'B-NEWS-90-F1', text: '园区物业管理处发布春节值班安排通告（与本单设备、财务均无直接关系）。', status: 'recorded' }],
});

const t3Pack = JSON.parse(JSON.stringify(basePack));
t3Pack.stages[t3Pack.stages.length - 1].sources.push({
  sourceId: 'B-SUP-09', version: 1, sourceType: 'supplement', title: '银行流水确认函（同源重排版）',
  facts: [{ factId: 'B-SUP-09-F1', text: '内容与 B-DOC-05 为同一银行同一账户同一期间，仅排版不同（同源重复，非独立佐证）。', status: 'recorded' }],
});

const t4Pack = JSON.parse(JSON.stringify(basePack));
t4Pack.stages = [...t4Pack.stages].reverse();
for (const st of t4Pack.stages) st.sources = [...st.sources].reverse();

const t5Pack = JSON.parse(JSON.stringify(basePack));
t5Pack.stages[1].sources.push({
  sourceId: 'B-DOC-05', version: 2, sourceType: 'written_document', title: '银行流水摘要 v2（补充9个月期间）',
  facts: [{ factId: 'B-DOC-05-V2-F1', text: '补充2025-09至2026-05期间流水（合成设定：版本更新以测试版本逻辑）。', status: 'recorded' }],
});

/* T1：候选语义改写（不改动资料包） */
const cand = JSON.parse(fs.readFileSync(PROBE_CANDIDATE, 'utf8'));
const t1CandPath = path.join(OUT_DIR, 'probe-rewritten.json');
const rewritten = JSON.parse(JSON.stringify(cand));
const SYNONYMS = [['缺口', '缺失'], ['追问', '询问'], ['受让', '承接'], ['流水', '账目'], ['过期', '失效']];
for (const f of rewritten.findings) for (const [a, b] of SYNONYMS) f.statement = f.statement.split(a).join(b);
for (const q of rewritten.questions) for (const [a, b] of SYNONYMS) q.text = q.text.split(a).join(b);
fs.writeFileSync(t1CandPath, JSON.stringify(rewritten, null, 2) + '\n', 'utf8');

/* 运行与断言 */
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

const base = score(PROBE_CANDIDATE);

// T1 语义改写
const t1 = score(t1CandPath);
check('T1 语义改写: EXACT critical 不变', JSON.stringify(base.exact.criticalViolations) === JSON.stringify(t1.exact.criticalViolations), `${JSON.stringify(base.exact.criticalViolations)} vs ${JSON.stringify(t1.exact.criticalViolations)}`);
check('T1 语义改写: 引用计数不变', base.exact.citations.total === t1.exact.citations.total && JSON.stringify(base.exact.citations.bySource) === JSON.stringify(t1.exact.citations.bySource));
const proxyDrop = base.proxy.gaps.matched.length - t1.proxy.gaps.matched.length;
check('T1 语义改写: PROXY 允许下降（人工代理指标——实证别名依赖，不是准确率）', proxyDrop >= 0, `缺口下界命中 ${base.proxy.gaps.matched.length}→${t1.proxy.gaps.matched.length}（下降 ${proxyDrop}，须人工复核语义等价）`);

// T2 无关文字
const t2PackPath = writePack('pack-t2-irrelevant.json', t2Pack);
const t2 = score(PROBE_CANDIDATE, t2PackPath);
check('T2 无关文字: EXACT 评分不变（仅 packStats 变化）', JSON.stringify({ ...base, packStats: null }) === JSON.stringify({ ...t2, packStats: null }), '剔除packStats后评分卡应字节一致');
check('T2 无关文字: packStats 来源数 +1', t2.packStats.sourceCount === base.packStats.sourceCount + 1);

// T3 同源重复
const t3PackPath = writePack('pack-t3-duplicate.json', t3Pack);
const t3 = score(PROBE_CANDIDATE, t3PackPath);
check('T3 同源重复: 不产生新 critical', JSON.stringify(base.exact.criticalViolations) === JSON.stringify(t3.exact.criticalViolations), `${JSON.stringify(t3.exact.criticalViolations)}`);
check('T3 同源重复: packStats 变化被记录', t3.packStats.sourceCount === base.packStats.sourceCount + 1 && t3.packStats.factCount === base.packStats.factCount + 1);

// T4 顺序变化
const t4PackPath = writePack('pack-t4-reordered.json', t4Pack);
const t4 = score(PROBE_CANDIDATE, t4PackPath);
check('T4 顺序变化: 评分卡字节一致', JSON.stringify(base) === JSON.stringify(t4), base.packStats.sourceCount !== t4.packStats.sourceCount ? 'packStats不一致' : '一致');

// T5 版本替换
const t5PackPath = writePack('pack-t5-version-bump.json', t5Pack);
const t5 = score(PROBE_CANDIDATE, t5PackPath);
const becameStale = t5.exact.citations.staleAsCurrent.filter((m) => m.sourceId === 'B-DOC-05');
check('T5 版本替换: 引用旧版本的候选被翻转判 stale（golden 无覆盖时以包内最大版本为当前）', becameStale.length >= 1 && becameStale.every((m) => m.expectedCurrent === 2), JSON.stringify(becameStale));
check('T5 版本替换: critical 含 stale_version_as_current', t5.exact.criticalViolations.includes('stale_version_as_current'));

/* 报告 */
const failed = results.filter((r) => !r.pass);
const report = {
  schema: 'jw-eval-metamorphic-report@1',
  tool: 'metamorphic-test.mjs',
  probeCandidate: 'PARALLEL_EVAL_20260913/candidate-responses/independent/CASE-B.json（固定人工样例）',
  declaration: '本套件验证评分器在输入变换下的确定性性质；不测试、也不证明任何真实模型能力。T1 的 PROXY 下降是有意的诚实实证：别名覆盖属人工代理指标。',
  packsWritten: fs.readdirSync(OUT_DIR).filter((f) => f.startsWith('pack-')),
  assertions: results,
  passed: results.length - failed.length,
  total: results.length,
};
fs.writeFileSync(path.join(OUT_DIR, 'metamorphic-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`metamorphic（v1）｜通过 ${report.passed}/${report.total}`);
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
process.exit(failed.length === 0 ? 0 : 3);
