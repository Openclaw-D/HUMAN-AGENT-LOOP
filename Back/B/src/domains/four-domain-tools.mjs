// 任务 03 · B 路域工具适配器：把 C 的确定性域流水线接入现有持久执行器
// （ToolsPort.calculate 形状）。目标 E1：各域用同一可追溯输入，经现有持久执行器
// （claim→complete、checkpoint、fencing、恢复）产出候选——本模块只做确定性编排适配，
// 不实现业务计算、不做外部调用（provider 恒为 calculation，authority 恒 none）。
// 步间传递：前序工具输出经编排器注入的 inputs._priorOutputs 读取；各步只做本阶段计算
// （感知一次规范化；单域评估只算该域；收口只算收口），满足“少重复感知、少无关重算”。
// 工具清单（路由配置 config/routes-four-domain.json 按任务种类编排为线性计划）：
//   fd:perception   材料 → 共享感知快照
//   fd:assess:business|policy|credit|commerce|asset   快照 → 该域 AnalysisRun+DomainAssessment
//   fd:gate         快照+五域结果 → 业务门（含规则评估）
//   fd:questions / fd:amount / fd:nextstep   收口三件（提问计划/金额候选/单一下一步）
//   calc:cash-flow-coverage / calc:ratio     委托 C 原生确定性工具
// TAKEOFF-FA-1.0.0（03路）：域表扩为五域（商机/政策/信审/商务/资产，列序对齐看板）；
// rulePackPath 可经 config.tools.rulePackPath 指向 TAKEOFF 五域规则包（缺省仍为旧四域包，回归兼容）。
// 失败语义：输入非法/结构违规 → {ok:false, code} → 编排器标 failed（失败关闭），不静默成功（C15）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  perceptionStage, assessStage, finalizeStage, effectiveRulePack,
} from '../../../C/domains/pipeline.mjs';
import { DOMAINS } from '../../../C/domains/schema.mjs';
import { calculateCashFlowCoverage } from '../../../C/src/calculation-tool.mjs';
import { calculateRatio } from '../../../C/src/ratio-tool.mjs';
import { sha256hex } from '../ports.mjs';
import { stableJson } from '../graph/decision.mjs';

export const FOUR_DOMAIN_TOOL_VERSION = 'fd-tools@1.1.0';
const DEFAULT_PACK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'C', 'rules', 'four-domain-rule-pack-v1.json');

function priorOf(inputs, toolName) {
  const list = Array.isArray(inputs?._priorOutputs) ? inputs._priorOutputs : [];
  return list.filter((x) => x.toolName === toolName);
}
function lastOf(list) { return list[list.length - 1] ?? null; }
function priorSnapshot(inputs) {
  return lastOf(priorOf(inputs, 'fd:perception'))?.output?.snapshot ?? null;
}

export function createFourDomainTools({ rulePackPath = DEFAULT_PACK } = {}) {
  const pack = JSON.parse(readFileSync(rulePackPath, 'utf8'));

  async function calculate({ toolName, inputs = {} }) {
    const started = Date.now();
    const done = (output, assumptions = []) => ({
      ok: true,
      toolVersion: FOUR_DOMAIN_TOOL_VERSION,
      inputHash: sha256hex(stableJson({ toolName, snapshot: output?.snapshot?.inputHash ?? output?.gate?.gateId ?? output?.questionPlan?.questions?.length ?? null })),
      output,
      assumptions,
      durationMs: Date.now() - started,
    });
    try {
      if (toolName === 'calc:cash-flow-coverage') {
        const r = calculateCashFlowCoverage(inputs);
        if (!r.ok) return { ok: false, code: r.error.code, messageZh: r.error.message };
        return { ok: true, toolVersion: r.result.toolVersion, inputHash: r.result.inputHash, output: r.result, assumptions: r.result.assumptions };
      }
      if (toolName === 'calc:ratio') {
        const r = calculateRatio(inputs);
        if (!r.ok) return { ok: false, code: r.error.code, messageZh: r.error.message };
        return { ok: true, toolVersion: r.result.toolVersion, inputHash: r.result.inputHash, output: r.result, assumptions: r.result.assumptions ?? [] };
      }
      if (toolName === 'fd:perception') {
        const { tenantId, customerId, materials } = inputs;
        if (!tenantId || !customerId || !Array.isArray(materials) || materials.length === 0) {
          return { ok: false, code: 'INVALID_INPUT', messageZh: 'fd:perception 需要 tenantId/customerId/materials' };
        }
        const r = perceptionStage({ tenantId, customerId, materials, rulePack: pack });
        if (!r.ok) return { ok: false, code: 'INVALID_INPUT', messageZh: `感知构建失败(${r.stage}):${JSON.stringify(r.problems ?? []).slice(0, 200)}` };
        return done({ snapshot: r.snapshot }, ['一次规范化;四域按投影读取,不重复上传']);
      }
      if (toolName.startsWith('fd:assess:')) {
        const domain = toolName.split(':')[2];
        if (!DOMAINS.includes(domain)) return { ok: false, code: 'UNKNOWN_TOOL', messageZh: `未知域 ${domain}` };
        const snapshot = priorSnapshot(inputs);
        if (!snapshot) return { ok: false, code: 'INVALID_INPUT', messageZh: `${toolName} 缺前序感知快照(_priorOutputs 无 fd:perception)` };
        const r = assessStage({
          snapshot,
          transaction: inputs.transaction ?? {},
          asOf: inputs.asOf ?? new Date().toISOString().slice(0, 10),
          rulePack: pack,
          domains: [domain], // 选择性评估：只算本域（其余标记 skipped,不重算）
        });
        if (!r.ok) return { ok: false, code: 'INVALID_INPUT', messageZh: `评估失败(${r.stage})` };
        const out = r.analyses[domain];
        if (!out?.analysisRun) return { ok: false, code: 'DOMAIN_NOT_COMPLETED', messageZh: `${domain} 域未完成(${out?.status ?? 'unknown'})` };
        if (out.analysisRun.inputHash !== snapshot.inputHash) {
          return { ok: false, code: 'SNAPSHOT_MISMATCH', messageZh: '域分析输入哈希与感知快照不一致(E1 同源约束)' };
        }
        return done(out, [`${domain} 域评估(确定性,authority=none)`]);
      }
      if (toolName === 'fd:gate' || toolName === 'fd:questions' || toolName === 'fd:amount' || toolName === 'fd:nextstep') {
        const snapshot = priorSnapshot(inputs);
        if (!snapshot) return { ok: false, code: 'INVALID_INPUT', messageZh: `${toolName} 缺前序感知快照` };
        const assessments = {};
        for (const d of DOMAINS) {
          const out = lastOf(priorOf(inputs, `fd:assess:${d}`))?.output ?? null;
          if (out?.analysisRun && out?.assessment) assessments[d] = out;
          else assessments[d] = { status: 'missing', reasonCode: 'REQUIRED_DOMAIN_INCOMPLETE' };
        }
        const as = assessStage({
          snapshot,
          transaction: inputs.transaction ?? {},
          asOf: inputs.asOf ?? new Date().toISOString().slice(0, 10),
          rulePack: pack,
          domains: [], // 收口步不做域评估（只复用前序结果 + 规则评估）
          domainOverrides: Object.fromEntries(DOMAINS.map((d) => [d, { status: 'missing' }])),
        });
        if (!as.ok) return { ok: false, code: 'INVALID_INPUT', messageZh: `收口失败(${as.stage})` };
        if (toolName === 'fd:gate') {
          const fin = finalizeStage({
            snapshot, transaction: inputs.transaction ?? {}, pack: as.pack, thresholds: as.thresholds,
            assessments, ruleEvaluation: as.ruleEvaluation, derived: as.derived, projections: as.projections,
          });
          if (!fin.ok) return { ok: false, code: 'INVALID_INPUT', messageZh: 'Gate 收口失败' };
          return done({
            gate: fin.gate,
            ruleEvaluation: {
              rulesetVersion: as.ruleEvaluation.rulesetVersion, asOf: as.ruleEvaluation.asOf,
              policyPending: as.ruleEvaluation.policyPending, results: as.ruleEvaluation.results,
            },
          }, ['Gate=业务门结果,非模型运行状态,非正式授信决定']);
        }
        const gateOut = lastOf(priorOf(inputs, 'fd:gate'))?.output ?? null;
        if (!gateOut?.gate) return { ok: false, code: 'INVALID_INPUT', messageZh: `${toolName} 需要前序 fd:gate 输出` };
        const fin = finalizeStage({
          snapshot, transaction: inputs.transaction ?? {}, pack: as.pack, thresholds: as.thresholds,
          assessments, ruleEvaluation: as.ruleEvaluation, derived: as.derived, projections: as.projections,
        });
        if (!fin.ok) return { ok: false, code: 'INVALID_INPUT', messageZh: '收口失败' };
        if (toolName === 'fd:questions') return done({ questionPlan: fin.questionPlan, gate: fin.gate }, ['已核验事实不重复索要(C16)']);
        if (toolName === 'fd:amount') return done({ amountCandidate: fin.amountCandidate }, ['金额候选=确定性约束结果,非批准、非报价']);
        return done({ nextStep: fin.nextStep }, ['见微=汇总协调;不自动拥有正式审批权']);
      }
      return { ok: false, code: 'UNKNOWN_TOOL', messageZh: `未知工具 ${toolName}` };
    } catch (e) {
      return { ok: false, code: e.code ?? 'TOOL_ERROR', messageZh: `四域工具异常(失败关闭):${e.message}` };
    }
  }

  return {
    calculate,
    toolVersion: FOUR_DOMAIN_TOOL_VERSION,
    rulesetVersion: effectiveRulePack(pack).ok ? pack.version : null,
  };
}
