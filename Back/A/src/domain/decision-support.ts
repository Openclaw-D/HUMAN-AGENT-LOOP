// 任务02 · 决策闭环确定性支持：证据同源归并、域依赖当前性判据、Gate 结构校验、依据包就绪评估。
// 本文件是纯计算/查询辅助，不承载任何业务政策：规则与阈值留在 C 路规则包（单一事实源）；
// A 只按包内冻结的声明做机械复查（谁依赖什么、变了没有、还缺什么）。
import type { PoolClient } from 'pg';
import { canonicalHash } from './util.ts';
import { gradeRank } from './v2kit.ts';

export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** C 路 Gate 的四种业务门结果（对齐 Back/C rules/gate.mjs；A 只做结构消费，不重算规则）。 */
export const GATE_RESULTS = ['CLEAR', 'NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW', 'HARD_BLOCK'] as const;
export type GateResult = (typeof GATE_RESULTS)[number];

export const DOMAINS = ['policy', 'credit', 'commerce', 'asset'] as const;
export type Domain = (typeof DOMAINS)[number];

// ---------------------------------------------------------------------------
// 证据同源（3.1）：派生材料（模型依据清单、生成场景、渲染截图等）不增加独立证明。
// 独立证明计数与依赖摘要都按"根工件"归并；核验等级继承封顶（派生件不得高于上游）。
// ---------------------------------------------------------------------------

export interface ArtifactLite {
  artifactId: string;
  sha256: string;
  kind: string;
  factKey: string | null;
  grade: string;
  provenance: { derivedFrom?: string[] } | null;
  supersededBy: string | null;
  duplicateOf: string | null;
}

/** 并查式求根：derivedFrom 链向上追溯到第一个非派生工件；环/缺失按自根处理（保守，不模糊匹配）。 */
export function provenanceRoots(artifacts: ArtifactLite[]): Map<string, string> {
  const byId = new Map(artifacts.map((a) => [a.artifactId, a]));
  const rootOf = new Map<string, string>();
  const visiting = new Set<string>();
  const resolve = (id: string): string => {
    const known = rootOf.get(id);
    if (known !== undefined) return known;
    const a = byId.get(id);
    if (a === undefined) return id;
    if (visiting.has(id)) return id; // 环防御：不模糊转移，按自根
    visiting.add(id);
    const parents = (a.provenance?.derivedFrom ?? []).filter((p) => byId.has(p));
    let root = id;
    if (parents.length > 0) {
      // 多上游取全部上游根中字典序最小者做归并键；关系本身保留在 provenance 字段，不丢失
      const parentRoots = parents.map(resolve).sort();
      root = parentRoots[0] ?? id;
    }
    visiting.delete(id);
    rootOf.set(id, root);
    return root;
  };
  for (const a of artifacts) resolve(a.artifactId);
  return rootOf;
}

/** 独立证明计数：非取代、非重复工件按根归并后的根数。 */
export function independentProofCount(artifacts: ArtifactLite[]): number {
  const live = artifacts.filter((a) => a.supersededBy === null && a.duplicateOf === null);
  const roots = provenanceRoots(live);
  return new Set(live.map((a) => roots.get(a.artifactId) ?? a.artifactId)).size;
}

// ---------------------------------------------------------------------------
// 域依赖声明与当前性（3.3 / B05、B06）：允许各域完成时间与水位不同；
// 只要能证明该域依赖的证据/事实/规则版本未变即可复用，变了只标该域 changed。
// ---------------------------------------------------------------------------

export interface DomainDeps {
  domain: string;
  /** 该域分析实际依赖的工件（冻结 sha256）；空数组=不依赖工件。 */
  artifactIds: string[];
  /** 该域分析实际依赖的事实键（按客户当前断言集合整体摘要）；空数组=不依赖事实。 */
  factKeys: string[];
  rulePackVersion: string | null;
  required: boolean;
}

export interface FrozenDomainState {
  domain: string;
  required: boolean;
  artifactIds: string[];
  factKeys: string[];
  rulePackVersion: string | null;
  /** 冻结时按当时 DB 状态计算的摘要。 */
  depsDigest: string;
  analysisRunRef: string | null;
  opinionVersion: number;
}

/** 对给定域依赖声明计算当前摘要（工件现行 sha256 + 事实断言集合 + 规则版本）。 */
export async function computeDomainDigest(tx: Queryable, customerId: string, deps: { artifactIds: string[]; factKeys: string[]; rulePackVersion: string | null }): Promise<string> {
  const artPart: Record<string, unknown> = {};
  for (const id of deps.artifactIds) {
    const r = await tx.query(
      `SELECT artifact_id, sha256, superseded_by, duplicate_of FROM evidence_artifacts WHERE artifact_id=$1`,
      [id],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    artPart[id] = row === undefined
      ? { missing: true }
      : { sha256: row.sha256, invalidated: row.superseded_by !== null || row.duplicate_of !== null };
  }
  const factPart: Record<string, unknown> = {};
  for (const key of deps.factKeys) {
    const r = await tx.query(
      `SELECT f.assertion_id, f.artifact_id, f.grade, f.value
       FROM fact_assertions f JOIN evidence_artifacts a ON a.artifact_id = f.artifact_id
       WHERE f.customer_id=$1 AND f.fact_key=$2 AND a.superseded_by IS NULL AND a.duplicate_of IS NULL
       ORDER BY f.assertion_id`,
      [customerId, key],
    );
    factPart[key] = r.rows.map((row) => ({
      assertionId: row.assertion_id, artifactId: row.artifact_id, grade: row.grade, value: row.value,
    }));
  }
  return canonicalHash({ artifacts: artPart, facts: factPart, rulePackVersion: deps.rulePackVersion });
}

export type DomainCurrency = 'current' | 'changed' | 'missing';

/** 当前激活规则版本（rule_pack_versions；登记表无行 = 未启用版本登记 → null）。 */
export async function activeRulePackVersionOf(tx: Queryable): Promise<string | null> {
  const r = await tx.query(`SELECT version FROM rule_pack_versions WHERE status='active' LIMIT 1`);
  return (r.rows[0] as { version: string } | undefined)?.version ?? null;
}

export interface DomainVerdict {
  domain: string;
  required: boolean;
  currency: DomainCurrency;
  /** changed 的具体原因（工件失效/事实变化/规则版本变化/域结果缺失）。 */
  reasons: string[];
  /** false=该域本轮必须更新后包才可就绪。 */
  reusable: boolean;
  opinionVersion: number | null;
  analysisRunRef: string | null;
}

/** 读时逐域判定：依赖已变的域必须更新；依赖未变的域允许复用（不为水位一致强迫全量重跑）。
 *  任务01 A2.7/K10：规则当前性查询实际已激活版本（rule_pack_versions）；冻结声明中的规则版本
 *  不再是现行版本 → 该域 changed（reason: rule_version_changed），旧意见/Gate 随之失效。 */
export async function evaluateDomainCurrency(tx: Queryable, customerId: string, frozen: FrozenDomainState[]): Promise<DomainVerdict[]> {
  const activeRes = await tx.query(`SELECT version FROM rule_pack_versions WHERE status='active' LIMIT 1`);
  const activeVersion = (activeRes.rows[0] as { version: string } | undefined)?.version ?? null;
  const verdicts: DomainVerdict[] = [];
  for (const f of frozen) {
    const reasons: string[] = [];
    let currency: DomainCurrency = 'current';
    if (activeVersion !== null && f.rulePackVersion !== null && f.rulePackVersion !== activeVersion) {
      currency = 'changed';
      reasons.push('rule_version_changed');
    } else if (f.depsDigest === '') {
      // 无域结果记录：required 域 = 缺失；非 required 域 = 未声明（不阻断）
      currency = f.required ? 'missing' : 'current';
      if (f.required) reasons.push('domain_state_missing');
    } else {
      const nowDigest = await computeDomainDigest(tx, customerId, {
        artifactIds: f.artifactIds, factKeys: f.factKeys, rulePackVersion: f.rulePackVersion,
      });
      if (nowDigest !== f.depsDigest) {
        currency = 'changed';
        reasons.push('deps_changed');
      } else if (f.required && f.opinionVersion === 0) {
        // 依赖未变但本轮要求的域尚无结果记录：不拼接"全域已更新"（3.3）
        currency = 'missing';
        reasons.push('domain_result_missing');
      }
    }
    verdicts.push({
      domain: f.domain, required: f.required, currency, reasons,
      reusable: currency === 'current',
      opinionVersion: f.opinionVersion,
      analysisRunRef: f.analysisRunRef,
    });
  }
  return verdicts;
}

// ---------------------------------------------------------------------------
// Gate 结构校验（3.3）：A 不重算规则，只消费 C 语义的 Gate 结论并做结构闭合检查。
// ---------------------------------------------------------------------------

export interface GateInput {
  result: string;
  reasonCodes?: string[];
  ruleIds?: string[];
  rulePackVersion: string;
  evaluatedAt?: string;
  blockedActions?: string[];
  evidenceRefs?: unknown[];
}

/** 结构校验：结果枚举、规则包版本必填。语义正确性由 C 路（规则包唯一事实源）负责。 */
export function validateGateInput(g: unknown): GateInput {
  if (g === null || typeof g !== 'object' || Array.isArray(g)) {
    throw new Error('gate 必须是对象');
  }
  const gate = g as Record<string, unknown>;
  if (!(GATE_RESULTS as readonly string[]).includes(String(gate.result))) {
    throw new Error(`gate.result 必须 ${GATE_RESULTS.join('/')}`);
  }
  if (typeof gate.rulePackVersion !== 'string' || gate.rulePackVersion.length === 0 || gate.rulePackVersion.length > 64) {
    throw new Error('gate.rulePackVersion 必须是 1..64 长度的 string');
  }
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    result: String(gate.result) as GateResult,
    reasonCodes: strArr(gate.reasonCodes),
    ruleIds: strArr(gate.ruleIds),
    rulePackVersion: gate.rulePackVersion,
    evaluatedAt: typeof gate.evaluatedAt === 'string' ? gate.evaluatedAt : undefined,
    blockedActions: strArr(gate.blockedActions),
    evidenceRefs: Array.isArray(gate.evidenceRefs) ? gate.evidenceRefs : [],
  };
}

// ---------------------------------------------------------------------------
// 依据包就绪评估（3.3）：只有本轮要求的域与核验项满足其规则，包才可提交审批。
// ---------------------------------------------------------------------------

export interface OpenFindingLite {
  findingId: string;
  findingType: string;
  impactScope: { actions?: string[]; domains?: string[]; blocking?: boolean };
  ruleRef: { ruleId?: string; nonWaivable?: boolean } | null;
}

export interface ReadinessInput {
  domains: DomainVerdict[];
  gate: GateInput | null;
  openFindings: OpenFindingLite[];
  /** 任务一检查收口修订；null = 未知（显式缺口，绝不当作通过）。 */
  inspectionRevision: Record<string, unknown> | null;
  /** 提交审批面向的动作（默认 approve_facility）。 */
  action: string;
  /** 当前激活规则版本（rule_pack_versions）；null = 未启用版本登记（不参与 Gate 失效判定）。 */
  activeRulePackVersion?: string | null;
}

export interface ReadinessVerdict {
  decisionReadiness: boolean;
  gaps: { code: string; detail?: string; domain?: string; findingId?: string }[];
  blockedActions: string[];
  requiredActions: string[];
  domainReuse: { domain: string; reusable: boolean }[];
}

/** 包级就绪：域依赖全部 current + Gate 非 HARD_BLOCK/NEEDS_EVIDENCE + 阻断性差异全部有处理结果 + 收口已知。 */
export function evaluateReadiness(input: ReadinessInput): ReadinessVerdict {
  const gaps: ReadinessVerdict['gaps'] = [];
  const blockedActions = new Set<string>();
  const requiredActions = new Set<string>();
  for (const d of input.domains) {
    if (d.required && d.currency !== 'current') {
      gaps.push({ code: d.currency === 'missing' ? 'REQUIRED_DOMAIN_MISSING' : 'DOMAIN_DEPS_CHANGED', domain: d.domain, detail: d.reasons.join(',') });
      requiredActions.add(`update_domain_analysis:${d.domain}`);
    }
    if (d.currency === 'changed') blockedActions.add('submit_package');
  }
  const gate = input.gate;
  if (gate === null) {
    gaps.push({ code: 'GATE_NOT_RECORDED', detail: '依据包未记录任何 Gate 结论' });
    requiredActions.add('record_gate_result');
  } else {
    if (gate.result === 'HARD_BLOCK') {
      gaps.push({ code: 'GATE_HARD_BLOCK', detail: (gate.ruleIds ?? []).join(','), });
      for (const a of gate.blockedActions ?? []) blockedActions.add(a);
    } else if (gate.result === 'NEEDS_EVIDENCE') {
      gaps.push({ code: 'GATE_NEEDS_EVIDENCE', detail: (gate.reasonCodes ?? []).join(',') });
    } else if (gate.result === 'HOLD_FOR_REVIEW') {
      // 任务01 A2.4/K06：HOLD 是"待人工复核"，不是通过——不得静默产生 ready/正式效果
      gaps.push({ code: 'GATE_HOLD_FOR_REVIEW', detail: (gate.reasonCodes ?? []).join(',') });
      for (const a of gate.blockedActions ?? []) blockedActions.add(a);
      requiredActions.add('resolve_hold_review');
    }
    // A2.7/K10：Gate 所依据的规则版本已被正式换版 → Gate 失效（须按新版本重新评估）
    if (input.activeRulePackVersion !== null && input.activeRulePackVersion !== undefined
      && gate.rulePackVersion !== input.activeRulePackVersion) {
      gaps.push({ code: 'GATE_STALE_RULES', detail: `gate@${gate.rulePackVersion} ≠ active@${input.activeRulePackVersion}` });
      requiredActions.add('rerecord_gate_result');
    }
  }
  if (input.inspectionRevision === null) {
    gaps.push({ code: 'INSPECTION_REVISION_UNKNOWN', detail: '缺少任务一检查收口修订引用：未知不当作通过' });
  } else {
    const closureStatus = String((input.inspectionRevision as Record<string, unknown>).closureStatus ?? '');
    // 任务一契约（Back/A/docs/INSPECTION_SESSION_V1.md §1）：仅 ready_for_assessment/closed 视为收口可评估
    if (!['ready_for_assessment', 'closed'].includes(closureStatus)) {
      gaps.push({ code: 'INSPECTION_NOT_CLOSED', detail: `closureStatus=${closureStatus || 'unknown'}` });
    }
  }
  for (const f of input.openFindings) {
    const actions = f.impactScope.actions ?? [];
    const blocking = f.impactScope.blocking !== false;
    if (blocking && (actions.length === 0 || actions.includes(input.action))) {
      gaps.push({ code: 'OPEN_BLOCKING_REVIEW', findingId: f.findingId, detail: f.findingType });
      requiredActions.add(`resolve_finding:${f.findingId}`);
      for (const a of actions) blockedActions.add(a);
    }
  }
  return {
    decisionReadiness: gaps.length === 0,
    gaps,
    blockedActions: [...blockedActions],
    requiredActions: [...requiredActions],
    domainReuse: input.domains.map((d) => ({ domain: d.domain, reusable: d.reusable })),
  };
}
