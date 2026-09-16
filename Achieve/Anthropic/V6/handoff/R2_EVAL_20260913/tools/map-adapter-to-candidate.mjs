#!/usr/bin/env node
/**
 * map-adapter-to-candidate.mjs — A lane 适配器结果 → jw-eval-candidate@2 离线映射（零依赖）
 *
 * 依据：PARALLEL_MODEL_ADAPTER_20260913/ADAPTER_CONTRACT.md §2/§3（接口 v1）与
 *       R2_EVAL_20260913/docs/SCHEMA_V2_CHANGES.md（候选 schema v2）。golden 不参与映射。
 *
 * 失败关闭原则：
 *   - 仅 status ∈ {succeeded, simulated} 的结果可映射为候选；其余七状态中的另五态
 *     （not_configured/failed/unknown/stale/cancelled）不是分析结果，映射一律拒绝（exit 2）。
 *   - findings/questions 缺字段（id/text/evidenceRefs、ref.id/version）→ 明确报错，不猜默认值。
 *   - type 推断：A 的 findings 不带 gap/contradiction/note 分类 → 一律映射为 "note"，
 *     并在 unresolved 中注明"类型标注缺失，PROXY 覆盖按 note 不计"（诚实降级，不伪造覆盖）。
 *   - A 引用的 hash 字段在候选格式中无对应字段，映射时丢弃（完整性线索由产品层负责）。
 *   - caseId/variantId 是评估端信息，适配器结果不知道自己答的哪个案例 → 必须由 --case/--variant 显式提供。
 *
 * 用法：
 *   node tools/map-adapter-to-candidate.mjs --adapter-result <file> --case CASE-B [--variant EVT-1] [--out <file>]
 * 退出码：0 成功；2 输入/映射错误。
 */
import fs from 'node:fs';
import path from 'node:path';

const CASE_IDS = new Set(['CASE-A', 'CASE-B', 'CASE-C']);
const MAPPABLE_STATUS = new Set(['succeeded', 'simulated']);

function fail(msg) {
  console.error(`[映射失败] ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i] ?? true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args['adapter-result'] || !args.case) {
  fail('用法：map-adapter-to-candidate.mjs --adapter-result <file> --case CASE-X [--variant V] [--out <file>]');
}
if (!CASE_IDS.has(args.case)) fail(`--case 必须是 ${[...CASE_IDS].join('/')}（得到 ${args.case}）`);

let result;
try {
  result = JSON.parse(fs.readFileSync(path.resolve(args['adapter-result']), 'utf8'));
} catch (e) {
  fail(`适配器结果不可读或非法JSON: ${e.message}`);
}
if (result === null || typeof result !== 'object' || Array.isArray(result)) fail('适配器结果必须是JSON对象');

if (!MAPPABLE_STATUS.has(result.status)) {
  fail(`status=${result.status} 不是分析结果（可映射：${[...MAPPABLE_STATUS].join('/')}）。` +
    `not_configured/failed/unknown/stale/cancelled 应作为过程事件记录，不得伪装为候选分析——失败关闭。`);
}
if (result.status === 'simulated' && !result.simulation?.notice) {
  fail('simulated 结果缺少 simulation.notice 显式声明，拒绝映射（不得伪装 succeeded）。');
}

const mapRef = (r, where) => {
  if (r === null || typeof r !== 'object') fail(`${where}: 引用必须为对象`);
  if (typeof r.id !== 'string' || !r.id.trim()) fail(`${where}: 引用缺少非空 id`);
  if (!Number.isInteger(r.version) || r.version < 1) fail(`${where}: 引用 ${r.id} 的 version 必须为>=1整数（得到 ${JSON.stringify(r.version)}；缺失行为=失败关闭，不猜版本）`);
  // hash 字段在候选格式中无对应：丢弃（完整性线索由产品层保留）
  return { sourceId: r.id, version: r.version };
};

const mapItems = (items, kind, prefix) => {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) fail(`${kind} 必须为数组（得到 ${typeof items}）`);
  return items.map((it, i) => {
    if (it === null || typeof it !== 'object') fail(`${kind}[${i}] 必须为对象`);
    const id = it.id ?? `${prefix}-${i + 1}`;
    if (typeof id !== 'string' || !id.trim()) fail(`${kind}[${i}].id 必须为非空字符串`);
    const text = kind === 'findings' ? it.text : it.text;
    if (typeof text !== 'string' || !text.trim()) fail(`${kind}[${i}] (${id}) 的 text 必须为非空字符串`);
    const refs = (it.evidenceRefs ?? []).map((r, j) => mapRef(r, `${kind}[${i}].evidenceRefs[${j}]`));
    return kind === 'findings'
      ? { findingId: id, type: 'note', statement: text, evidenceRefs: refs }
      : { questionId: id, text, evidenceRefs: refs };
  });
};

const findings = mapItems(result.findings, 'findings', 'F');
const questions = mapItems(result.questions, 'questions', 'Q');
const note = findings.length > 0
  ? ['适配器 findings 不带 gap/contradiction/note 分类，映射统一记为 note：PROXY 层缺口/矛盾覆盖按 note 不计入，类型标注需产品映射层补充后再评。']
  : [];

const candidate = {
  schema: 'jw-eval-candidate@2',
  candidateId: `adapter-${result.requestId ?? 'unknown-request'}`,
  caseId: args.case,
  variantId: args.variant ?? null,
  inputPackVersion: `mapped from adapter contract v1, mode=${result.mode ?? 'unknown'}, status=${result.status}`,
  respondent: {
    kind: result.status === 'simulated' ? 'adapter_simulated_output' : 'adapter_output',
    note: result.status === 'simulated'
      ? `受控模拟通道输出（${result.simulation.notice}）；非真实模型调用。`
      : '经A lane适配器结构守门的分析结果映射；映射器不做语义判断。',
  },
  findings,
  questions,
  conclusions: [],
  decisions: [],
  unresolved: note,
};

if (args.out) {
  fs.writeFileSync(path.resolve(args.out), JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  console.log(`已写出 ${path.resolve(args.out)}`);
} else {
  console.log(JSON.stringify(candidate, null, 2));
}
