// 任务02 · 评估依据包（3.3 / B05–B07）：可冻结、可复核的决策依据。
// 冻结的是"依据"（证据/事实摘要、Gate、域依赖声明、候选与条件），不是工作流状态；
// 新材料进新修订（revision+1，旧行保留当时依据），正式动作在提交点按包重算当前性（3.4）。
// 本模块不承载任何规则语义：Gate 结论由 C 路规则包产出（A 只做结构消费与机械复查）。
import type { PoolClient } from 'pg';
import { conflict, invalid, notFound } from './errors.ts';
import { canonicalHash, newId } from './util.ts';
import type { Kernel } from './kernel.ts';
import {
  reqInt, reqObject, reqString, reqCurrency, withCommandV2, requireHuman, requireDirectoryRole, lockCustomer, scopeByRow,
  type RequestFrame,
} from './v2kit.ts';
import type { ArtifactLite } from './decision-support.ts';
import {
  computeDomainDigest, evaluateDomainCurrency, evaluateReadiness, independentProofCount, provenanceRoots,
  validateGateInput, DOMAINS, type DomainDeps, type FrozenDomainState, type GateInput, type OpenFindingLite,
} from './decision-support.ts';

const MAX_DOMAIN_DEPS = 16;
const OPEN_CLOSURE_STATUSES = ['ready_for_assessment', 'closed', 'pending_evidence', 'pending_review', 'open'];

interface PackageRow extends Record<string, unknown> {
  package_id: string; tenant_id: string; customer_id: string; revision: number; prev_package_id: string | null;
  status: string; assessment_id: string | null; inspection_revision: unknown; evidence_refs: unknown;
  independent_proofs: number; snapshot_hash: string; gate: unknown; candidate: unknown;
  unknown_costs: unknown; domain_states: unknown; required_reviews: unknown; open_items: unknown; version?: number;
}

export interface PackageApi {
  createPackage(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  revisePackage(frame: RequestFrame, packageId: string): Promise<Record<string, unknown>>;
  recordDomainResult(frame: RequestFrame, packageId: string): Promise<Record<string, unknown>>;
  adoptDomainOpinion(frame: RequestFrame, packageId: string): Promise<Record<string, unknown>>;
  recordGateResult(frame: RequestFrame, packageId: string): Promise<Record<string, unknown>>;
  refreshPackageCurrency(frame: RequestFrame, packageId: string): Promise<Record<string, unknown>>;
  getPackage(credential: unknown, packageId: string): Promise<Record<string, unknown>>;
  getCustomerDecisionStatus(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
}

export function buildPackageCommands(kernel: Kernel): PackageApi {
  const loadPkg = async (tx: PoolClient, packageId: string): Promise<PackageRow> => {
    const r = await tx.query(`SELECT * FROM decision_packages WHERE package_id=$1 FOR UPDATE`, [packageId]);
    if (r.rows.length === 0) throw notFound('依据包不存在');
    return r.rows[0] as PackageRow;
  };
  const loadPkgRead = async (packageId: string): Promise<PackageRow> => {
    const r = await kernel.pool.query(`SELECT * FROM decision_packages WHERE package_id=$1`, [packageId]);
    if (r.rows.length === 0) throw notFound('依据包不存在');
    return r.rows[0] as PackageRow;
  };

  /** 冻结输入解析（create/revise 共用）。 */
  async function parseFreezeInput(tx: PoolClient, customerId: string, frame: RequestFrame): Promise<{
    assessmentId: string | null; inspectionRevision: Record<string, unknown> | null;
    gate: GateInput | null; candidate: Record<string, unknown>; domainDeps: DomainDeps[];
    evidenceRefs: Record<string, unknown>[]; independentProofs: number; snapshotHash: string;
    unknownCosts: string[]; openItems: Record<string, unknown>[]; requiredReviews: Record<string, unknown>[];
    domainStates: FrozenDomainState[];
  }> {
    let assessmentId: string | null = null;
    if (frame.assessmentId !== undefined && frame.assessmentId !== null) {
      assessmentId = reqString(frame.assessmentId, 'assessmentId', 64);
      const a = await tx.query(`SELECT customer_id, stale FROM credit_assessments WHERE assessment_id=$1`, [assessmentId]);
      if (a.rows.length === 0) throw notFound('依据评估不存在');
      const ar = a.rows[0] as { customer_id: string; stale: boolean };
      if (ar.customer_id !== customerId) throw notFound('评估不属于该客户');
      if (ar.stale === true) throw conflict('STALE_BASIS', '评估依据已失效：请重评后再冻结依据包');
    }
    let inspectionRevision: Record<string, unknown> | null = null;
    if (frame.inspectionRevision !== undefined && frame.inspectionRevision !== null) {
      const obj = reqObject(frame.inspectionRevision, 'inspectionRevision');
      const closureStatus = reqString(obj.closureStatus, 'inspectionRevision.closureStatus', 32);
      if (!OPEN_CLOSURE_STATUSES.includes(closureStatus)) {
        throw invalid(`inspectionRevision.closureStatus 必须 ${OPEN_CLOSURE_STATUSES.join('/')}`);
      }
      inspectionRevision = {
        sessionId: obj.sessionId === undefined || obj.sessionId === null ? null : reqString(obj.sessionId, 'inspectionRevision.sessionId', 64),
        closureRevision: obj.closureRevision === undefined || obj.closureRevision === null ? null : reqInt(obj.closureRevision, 'inspectionRevision.closureRevision', 1_000_000),
        closureStatus,
        summaryRef: obj.summaryRef === undefined || obj.summaryRef === null ? null : reqString(obj.summaryRef, 'inspectionRevision.summaryRef', 128),
        checkedAt: obj.checkedAt === undefined || obj.checkedAt === null ? null : reqString(obj.checkedAt, 'inspectionRevision.checkedAt', 64),
      };
    }
    const gate = frame.gate === undefined || frame.gate === null ? null : validateGateInput(frame.gate);
    const candidate = normalizeCandidate(frame.candidate);
    // 域依赖声明（各域允许不同水位与依赖集合；本轮"要求的域"以 required=true 声明）
    const depsIn = frame.domainDeps === undefined || frame.domainDeps === null ? [] : frame.domainDeps;
    if (!Array.isArray(depsIn) || depsIn.length > MAX_DOMAIN_DEPS) throw invalid(`domainDeps 必须是 ≤${MAX_DOMAIN_DEPS} 的数组`);
    const domainDeps: DomainDeps[] = [];
    const seen = new Set<string>();
    for (const d of depsIn) {
      const obj = reqObject(d, 'domainDeps[]');
      const domain = reqString(obj.domain, 'domainDeps[].domain', 16);
      if (!(DOMAINS as readonly string[]).includes(domain)) throw invalid(`domainDeps[].domain 必须 ${DOMAINS.join('/')}`);
      if (seen.has(domain)) throw invalid(`domainDeps 重复域：${domain}`);
      seen.add(domain);
      const artifactIds = stringArray(obj.artifactIds, `domainDeps[${domain}].artifactIds`, 64);
      const factKeys = stringArray(obj.factKeys, `domainDeps[${domain}].factKeys`, 128);
      domainDeps.push({
        domain, artifactIds, factKeys,
        rulePackVersion: obj.rulePackVersion === undefined || obj.rulePackVersion === null ? gate?.rulePackVersion ?? null : reqString(obj.rulePackVersion, 'rulePackVersion', 64),
        required: obj.required !== false,
      });
    }
    // 证据集 = 域依赖工件 ∪ 评估快照工件 ∪ 显式附加（全部须属本客户且未被取代/重复）
    const artifactIdSet = new Set<string>();
    for (const d of domainDeps) for (const id of d.artifactIds) artifactIdSet.add(id);
    if (assessmentId !== null) {
      const snap = await tx.query(`SELECT evidence_snapshot FROM credit_assessments WHERE assessment_id=$1`, [assessmentId]);
      const snapshot = (snap.rows[0] as { evidence_snapshot?: { artifactId: string }[] } | undefined)?.evidence_snapshot ?? [];
      for (const ref of snapshot) artifactIdSet.add(ref.artifactId);
    }
    for (const id of stringArray(frame.extraEvidenceIds ?? [], 'extraEvidenceIds', 64)) artifactIdSet.add(id);
    const artifacts: ArtifactLite[] = [];
    for (const id of artifactIdSet) {
      const r = await tx.query(
        `SELECT a.artifact_id, a.customer_id, a.sha256, a.kind, a.fact_key, a.provenance, a.superseded_by, a.duplicate_of,
                (SELECT f.grade FROM fact_assertions f WHERE f.artifact_id = a.artifact_id LIMIT 1) AS grade
         FROM evidence_artifacts a WHERE a.artifact_id=$1`, [id],
      );
      if (r.rows.length === 0) throw notFound(`证据工件不存在：${id}`);
      const a = r.rows[0] as Record<string, unknown>;
      if (a.customer_id !== customerId) throw notFound(`证据工件不属于该客户：${id}`);
      if (a.superseded_by !== null || a.duplicate_of !== null) {
        throw conflict('ARTIFACT_SUPERSEDED', `依据包不能引用已失效工件：${id}（请先补正后再冻结）`, { artifactId: id });
      }
      artifacts.push({
        artifactId: String(a.artifact_id), sha256: String(a.sha256), kind: String(a.kind),
        factKey: a.fact_key === null ? null : String(a.fact_key), grade: String(a.grade),
        provenance: (a.provenance ?? null) as ArtifactLite['provenance'],
        supersededBy: null, duplicateOf: null,
      });
    }
    const roots = provenanceRoots(artifacts);
    const evidenceRefs = artifacts.map((a) => ({
      artifactId: a.artifactId, sha256: a.sha256, rootArtifactId: roots.get(a.artifactId) ?? a.artifactId,
      factKey: a.factKey, grade: a.grade,
    }));
    const independentProofs = independentProofCount(artifacts);
    const snapshotHash = canonicalHash({ evidenceRefs, domainDeps, assessmentId });
    // 冻结各域摘要（允许各域依赖不同；就绪判定读时逐域复算）
    const domainStates: FrozenDomainState[] = [];
    for (const d of domainDeps) {
      const depsDigest = (d.artifactIds.length === 0 && d.factKeys.length === 0)
        ? await computeDomainDigest(tx, customerId, { artifactIds: [], factKeys: [], rulePackVersion: d.rulePackVersion })
        : await computeDomainDigest(tx, customerId, d);
      domainStates.push({
        domain: d.domain, required: d.required, artifactIds: d.artifactIds, factKeys: d.factKeys,
        rulePackVersion: d.rulePackVersion, depsDigest, analysisRunRef: null, opinionVersion: 0,
      });
    }
    const unknownCosts = stringArray(frame.unknownCosts ?? [], 'unknownCosts', 500);
    const openItems = objectArray(frame.openItems ?? [], 'openItems');
    const requiredReviews = objectArray(frame.requiredReviews ?? [], 'requiredReviews');
    return {
      assessmentId, inspectionRevision, gate, candidate, domainDeps, evidenceRefs,
      independentProofs, snapshotHash, unknownCosts, openItems, requiredReviews, domainStates,
    };
  }

  /** 冻结写入（create/revise 共用）：包行不可变（除 status/gate/domain_states 的版本引用）。 */
  async function insertPackage(
    tx: PoolClient, h: { audit: (e: { actor: string; action: string; targetType: string; targetId: string; summary: string; payload?: unknown }) => Promise<void> },
    ctx: { actor: string; tenantId: string }, customerId: string, prev: PackageRow | null,
    frozen: Awaited<ReturnType<typeof parseFreezeInput>>,
  ): Promise<{ packageId: string; revision: number; readiness: ReturnType<typeof evaluateReadiness> }> {
    const revision = prev === null ? 1 : Number(prev.revision) + 1;
    const domainStates = frozen.domainStates;
    const packageId = newId('pkg');
    // 就绪初判（创建时点的机械结论；此后读时逐域复算当前性）
    const openFindings = await openBlockingFindings(tx, customerId);
    const readiness = evaluateReadiness({
      domains: await evaluateDomainCurrency(tx, customerId, domainStates),
      gate: frozen.gate,
      openFindings,
      inspectionRevision: frozen.inspectionRevision,
      action: 'approve_facility',
    });
    const status = readiness.decisionReadiness ? 'ready' : 'draft';
    await tx.query(
      `INSERT INTO decision_packages
         (package_id, tenant_id, customer_id, revision, prev_package_id, status, assessment_id, inspection_revision,
          evidence_refs, independent_proofs, snapshot_hash, gate, candidate, unknown_costs, domain_states,
          required_reviews, open_items, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18)`,
      [packageId, ctx.tenantId, customerId, revision, prev?.package_id ?? null, status, frozen.assessmentId,
       JSON.stringify(frozen.inspectionRevision), JSON.stringify(frozen.evidenceRefs), frozen.independentProofs,
       frozen.snapshotHash, JSON.stringify(frozen.gate), JSON.stringify(frozen.candidate),
       JSON.stringify(frozen.unknownCosts), JSON.stringify(domainStates),
       JSON.stringify(frozen.requiredReviews), JSON.stringify(frozen.openItems), ctx.actor],
    );
    if (prev !== null) {
      await tx.query(`UPDATE decision_packages SET status='superseded' WHERE package_id=$1 AND status <> 'superseded'`, [prev.package_id]);
    }
    await h.audit({
      actor: ctx.actor, action: prev === null ? 'package_created' : 'package_revised', targetType: 'decision_package', targetId: packageId,
      summary: `评估依据包 ${prev === null ? '冻结' : '修订'} r${revision}（独立证明 ${frozen.independentProofs}；${status}）`,
      payload: { revision, status, snapshotHash: frozen.snapshotHash },
    });
    if (revision > 1) {
      // 依据实质修订：通知消费方（任务一/三按 eventId 幂等消费）
      await kernelEvent(tx, 'ASSESSMENT_BASIS_REVISED', customerId, { packageId, revision, prevPackageId: prev?.package_id ?? null });
    }
    if (status === 'ready') {
      await kernelEvent(tx, 'DECISION_PACKAGE_READY', customerId, { packageId, revision, basisVersion: `${packageId}:${revision}` });
    }
    return { packageId, revision, readiness };
  }

  return {
    createPackage: (frame: RequestFrame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'package.create', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'package.create');
        requireDirectoryRole(ctx, ['credit', 'business'], 'package.create');
        const customer = await lockCustomer(tx, customerId, tenantId);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const frozen = await parseFreezeInput(tx, customerId, frame);
        const latest = await tx.query(
          `SELECT * FROM decision_packages WHERE customer_id=$1 ORDER BY revision DESC LIMIT 1`, [customerId],
        );
        const prev = (latest.rows[0] as PackageRow | undefined) ?? null;
        const { packageId, revision, readiness } = await insertPackage(tx, h, ctx, customerId, prev, frozen);
        return {
          ok: true, packageId, revision, basisVersion: `${packageId}:${revision}`,
          status: readiness.decisionReadiness ? 'ready' : 'draft',
          independentProofs: frozen.independentProofs,
          decisionReadiness: readiness.decisionReadiness, gaps: readiness.gaps,
        };
      });
    },

    revisePackage: (frame: RequestFrame, packageId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'package.revise', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'package.revise');
        requireDirectoryRole(ctx, ['credit', 'business'], 'package.revise');
        const base = await loadPkg(tx, packageId);
        const customer = await lockCustomer(tx, base.customer_id as string, tenantId);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        if (base.tenant_id !== tenantId) throw notFound('依据包不存在');
        if (base.status === 'superseded') throw conflict('NOT_READY', '依据包已被更新修订取代：请对最新修订操作');
        const frozen = await parseFreezeInput(tx, base.customer_id as string, frame);
        const { packageId: newId_, revision, readiness } = await insertPackage(tx, h, ctx, base.customer_id as string, base, frozen);
        return {
          ok: true, packageId: newId_, revision, basisVersion: `${newId_}:${revision}`,
          status: readiness.decisionReadiness ? 'ready' : 'draft',
          decisionReadiness: readiness.decisionReadiness, gaps: readiness.gaps,
        };
      });
    },

    // ---- 四域结果与意见采用（3.2：原意见不改写；采用与否留人/理由/依据） ----

    recordDomainResult: (frame: RequestFrame, packageId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'package.domain-result', tenantId, async (tx, h, ctx) => {
        const base = await loadPkg(tx, packageId);
        await scopeByRow(kernel, frame, base.tenant_id as string);
        const customer = await lockCustomer(tx, base.customer_id as string, base.tenant_id as string);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        if (base.status === 'superseded') throw conflict('NOT_READY', '依据包已被更新修订取代');
        const domain = reqString(frame.domain, 'domain', 16);
        if (!(DOMAINS as readonly string[]).includes(domain)) throw invalid(`domain 必须 ${DOMAINS.join('/')}`);
        const analysisRun = validateAnalysisRunShallow(reqObject(frame.analysisRun, 'analysisRun'), domain);
        const opinion = reqObject(frame.opinion, 'opinion');
        if (opinion.authority !== undefined && opinion.authority !== 'none') {
          throw invalid('opinion.authority 必须恒为 none（服务端强制；候选意见无正式效力）');
        }
        const deps = reqObject(frame.deps ?? {}, 'deps');
        const declared = (base.domain_states as FrozenDomainState[]).find((s) => s.domain === domain);
        if (declared === undefined) {
          throw invalid(`依据包未声明域 ${domain} 的依赖：请以新修订补充 domainDeps 后再登记结果`);
        }
        const resultDeps = {
          artifactIds: stringArray(deps.artifactIds ?? [], 'deps.artifactIds', 64),
          factKeys: stringArray(deps.factKeys ?? [], 'deps.factKeys', 128),
          rulePackVersion: deps.rulePackVersion === undefined || deps.rulePackVersion === null ? null : reqString(deps.rulePackVersion, 'deps.rulePackVersion', 64),
        };
        if (JSON.stringify([...resultDeps.artifactIds].sort()) !== JSON.stringify([...declared.artifactIds].sort())) {
          throw invalid('deps.artifactIds 与冻结声明不一致：域结果必须登记在其声明依赖上');
        }
        if (JSON.stringify([...resultDeps.factKeys].sort()) !== JSON.stringify([...declared.factKeys].sort())) {
          throw invalid('deps.factKeys 与冻结声明不一致：域结果必须登记在其声明依赖上');
        }
        if ((resultDeps.rulePackVersion ?? null) !== (declared.rulePackVersion ?? null)) {
          throw invalid('deps.rulePackVersion 与冻结声明不一致：规则版本变化请发布新修订');
        }
        let adoption: Record<string, unknown> | null = null;
        if (frame.adoption !== undefined && frame.adoption !== null) {
          requireHuman(ctx, 'package.domain-result.adoption');
          adoption = normalizeAdoption(frame.adoption, ctx.actor);
        }
        const verRes = await tx.query(
          `SELECT COALESCE(MAX(opinion_version),0) AS v FROM package_domain_results WHERE package_id=$1 AND domain=$2`,
          [packageId, domain],
        );
        const opinionVersion = Number((verRes.rows[0] as { v: string | number }).v) + 1;
        // 结果自带水位：登记时按"当前"依赖重新冻结该域摘要（历史冻结保留在上一版结果行中，可追溯）
        const currentDigest = await computeDomainDigest(tx, base.customer_id as string, resultDeps);
        const resultId = newId('dres');
        await tx.query(
          `INSERT INTO package_domain_results
             (result_id, package_id, domain, analysis_run, opinion, opinion_version, deps, adoption, created_by)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9)`,
          [resultId, packageId, domain, JSON.stringify(analysisRun), JSON.stringify(opinion), opinionVersion,
           JSON.stringify({ ...resultDeps, required: declared.required, depsDigest: currentDigest }),
           JSON.stringify(adoption), ctx.actor],
        );
        // 包内域状态推进到本结果的引用与新水位（旧行保留在 package_domain_results，不改写）
        const newStates = (base.domain_states as FrozenDomainState[]).map((s) => s.domain === domain
          ? { ...s, opinionVersion, analysisRunRef: String(analysisRun.runId), depsDigest: currentDigest }
          : s);
        await tx.query(`UPDATE decision_packages SET domain_states=$2::jsonb WHERE package_id=$1`, [packageId, JSON.stringify(newStates)]);
        // 就绪重判（required 域补齐后可能就绪）
        const openFindings = await openBlockingFindings(tx, base.customer_id as string);
        const verdicts = await evaluateDomainCurrency(tx, base.customer_id as string, newStates);
        const readiness = evaluateReadiness({
          domains: verdicts, gate: (base.gate ?? null) as GateInput | null, openFindings,
          inspectionRevision: (base.inspection_revision ?? null) as Record<string, unknown> | null,
          action: 'approve_facility',
        });
        const newStatus = readiness.decisionReadiness ? 'ready' : 'draft';
        if (newStatus !== base.status && base.status !== 'superseded') {
          await tx.query(`UPDATE decision_packages SET status=$2 WHERE package_id=$1`, [packageId, newStatus]);
        }
        await h.audit({
          actor: ctx.actor, action: 'domain_result_recorded', targetType: 'decision_package', targetId: packageId,
          summary: `域结果登记 ${domain} v${opinionVersion}（run ${analysisRun.runId}；authority=none${adoption ? `；${String(adoption.decision)}` : ''}）`,
          payload: { domain, opinionVersion, runId: analysisRun.runId },
        });
        if (newStatus === 'ready' && base.status !== 'ready') {
          await kernelEvent(tx, 'DECISION_PACKAGE_READY', base.customer_id as string, {
            packageId, revision: Number(base.revision), basisVersion: `${packageId}:${Number(base.revision)}`,
          });
        }
        return { ok: true, resultId, domain, opinionVersion, status: newStatus, decisionReadiness: readiness.decisionReadiness };
      });
    },

    adoptDomainOpinion: (frame: RequestFrame, packageId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'package.adopt', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'package.adopt');
        requireDirectoryRole(ctx, ['credit', 'business', 'policy', 'commerce', 'asset'], 'package.adopt');
        const base = await loadPkg(tx, packageId);
        await scopeByRow(kernel, frame, base.tenant_id as string);
        const customer = await lockCustomer(tx, base.customer_id as string, base.tenant_id as string);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const domain = reqString(frame.domain, 'domain', 16);
        const latest = await tx.query(
          `SELECT result_id, opinion_version FROM package_domain_results
           WHERE package_id=$1 AND domain=$2 ORDER BY opinion_version DESC LIMIT 1`, [packageId, domain],
        );
        if (latest.rows.length === 0) throw notFound(`该包尚无域 ${domain} 的结果记录`);
        const hit = latest.rows[0] as { result_id: string; opinion_version: number };
        const adoption = normalizeAdoption(frame, ctx.actor);
        await tx.query(`UPDATE package_domain_results SET adoption=$2::jsonb WHERE result_id=$1`, [hit.result_id, JSON.stringify(adoption)]);
        await h.audit({
          actor: ctx.actor, action: 'domain_opinion_adoption', targetType: 'decision_package', targetId: packageId,
          summary: `域意见 ${domain} v${hit.opinion_version} ${String(adoption.decision)}（决定人 ${ctx.actor}）`,
          payload: { domain, opinionVersion: hit.opinion_version, decision: adoption.decision },
        });
        return { ok: true, resultId: hit.result_id, domain, opinionVersion: hit.opinion_version, adoption };
      });
    },

    recordGateResult: (frame: RequestFrame, packageId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'package.gate', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'package.record-gate');
        requireDirectoryRole(ctx, ['credit', 'business', 'policy'], 'package.record-gate');
        const base = await loadPkg(tx, packageId);
        await scopeByRow(kernel, frame, base.tenant_id as string);
        const customer = await lockCustomer(tx, base.customer_id as string, base.tenant_id as string);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        if (base.gate !== null && base.gate !== undefined) {
          throw conflict('NOT_READY', '该包已记录 Gate 结论：规则/Gate 变化请发布新修订（包依据不可改写）');
        }
        const gate = validateGateInput(frame.gate);
        await tx.query(`UPDATE decision_packages SET gate=$2::jsonb WHERE package_id=$1`, [packageId, JSON.stringify(gate)]);
        const openFindings = await openBlockingFindings(tx, base.customer_id as string);
        const verdicts = await evaluateDomainCurrency(tx, base.customer_id as string, base.domain_states as FrozenDomainState[]);
        const readiness = evaluateReadiness({
          domains: verdicts, gate, openFindings,
          inspectionRevision: (base.inspection_revision ?? null) as Record<string, unknown> | null,
          action: 'approve_facility',
        });
        const newStatus = readiness.decisionReadiness ? 'ready' : 'draft';
        if (newStatus !== base.status) {
          await tx.query(`UPDATE decision_packages SET status=$2 WHERE package_id=$1`, [packageId, newStatus]);
        }
        await h.audit({
          actor: ctx.actor, action: 'gate_recorded', targetType: 'decision_package', targetId: packageId,
          summary: `Gate 结论登记 ${gate.result}（规则包 ${gate.rulePackVersion}）`, payload: { result: gate.result },
        });
        if (newStatus === 'ready' && base.status !== 'ready') {
          await kernelEvent(tx, 'DECISION_PACKAGE_READY', base.customer_id as string, {
            packageId, revision: Number(base.revision), basisVersion: `${packageId}:${Number(base.revision)}`,
          });
        }
        if (gate.result === 'HARD_BLOCK') {
          await kernelEvent(tx, 'REVIEW_REQUIRED', base.customer_id as string, {
            packageId, gateResult: gate.result, ruleIds: gate.ruleIds ?? [],
          });
        }
        return { ok: true, gate, status: newStatus, decisionReadiness: readiness.decisionReadiness, gaps: readiness.gaps };
      });
    },

    /** 当前性刷新（3.3/B05）：逐域复算；changed 的 required 域 → 包退出 ready + ReviewRequired。 */
    refreshPackageCurrency: (frame: RequestFrame, packageId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'package.refresh', tenantId, async (tx, h, ctx) => {
        const base = await loadPkg(tx, packageId);
        await scopeByRow(kernel, frame, base.tenant_id as string);
        const customer = await lockCustomer(tx, base.customer_id as string, base.tenant_id as string);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        if (base.status === 'superseded') throw conflict('NOT_READY', '依据包已被更新修订取代');
        const states = base.domain_states as FrozenDomainState[];
        const verdicts = await evaluateDomainCurrency(tx, base.customer_id as string, states);
        const openFindings = await openBlockingFindings(tx, base.customer_id as string);
        const readiness = evaluateReadiness({
          domains: verdicts, gate: (base.gate ?? null) as GateInput | null, openFindings,
          inspectionRevision: (base.inspection_revision ?? null) as Record<string, unknown> | null,
          action: 'approve_facility',
        });
        const newStatus = readiness.decisionReadiness ? 'ready' : 'draft';
        const changedRequired = verdicts.filter((v) => v.required && v.currency !== 'current');
        if (newStatus !== base.status) {
          await tx.query(`UPDATE decision_packages SET status=$2 WHERE package_id=$1`, [packageId, newStatus]);
        }
        await h.audit({
          actor: ctx.actor, action: 'package_currency_refreshed', targetType: 'decision_package', targetId: packageId,
          summary: `当前性刷新 → ${newStatus}（changed：${changedRequired.map((c) => c.domain).join('/') || '无'}）`,
          payload: { status: newStatus },
        });
        if (changedRequired.length > 0) {
          await kernelEvent(tx, 'REVIEW_REQUIRED', base.customer_id as string, {
            packageId, changedDomains: changedRequired.map((c) => c.domain),
            reuse: verdicts.filter((v) => v.reusable).map((v) => v.domain),
          });
        } else if (newStatus === 'ready' && base.status !== 'ready') {
          await kernelEvent(tx, 'DECISION_PACKAGE_READY', base.customer_id as string, {
            packageId, revision: Number(base.revision), basisVersion: `${packageId}:${Number(base.revision)}`,
          });
        }
        return {
          ok: true, status: newStatus, currency: verdicts, decisionReadiness: readiness.decisionReadiness,
          gaps: readiness.gaps, blockedActions: readiness.blockedActions, requiredActions: readiness.requiredActions,
        };
      });
    },

    getPackage: async (credential: unknown, packageId: string) => {
      const base = await loadPkgRead(packageId);
      await scopeByRow(kernel, { credential }, base.tenant_id as string);
      const verdicts = await evaluateDomainCurrency(kernel.pool, base.customer_id as string, base.domain_states as FrozenDomainState[]);
      const openFindings = await openBlockingFindings(kernel.pool, base.customer_id as string);
      const readiness = evaluateReadiness({
        domains: verdicts, gate: (base.gate ?? null) as GateInput | null, openFindings,
        inspectionRevision: (base.inspection_revision ?? null) as Record<string, unknown> | null,
        action: 'approve_facility',
      });
      const results = await kernel.pool.query(
        `SELECT domain, analysis_run, opinion, opinion_version, adoption, created_at FROM package_domain_results
         WHERE package_id=$1 ORDER BY domain, opinion_version`, [packageId],
      );
      return {
        ok: true,
        package: {
          packageId, customerId: base.customer_id, revision: Number(base.revision),
          basisVersion: `${packageId}:${Number(base.revision)}`,
          prevPackageId: base.prev_package_id, status: base.status,
          assessmentId: base.assessment_id, inspectionRevision: base.inspection_revision,
          evidenceRefs: base.evidence_refs, independentProofs: Number(base.independent_proofs),
          snapshotHash: base.snapshot_hash, gate: base.gate, candidate: base.candidate,
          unknownCosts: base.unknown_costs, requiredReviews: base.required_reviews, openItems: base.open_items,
          createdBy: base.created_by, createdAt: base.created_at,
        },
        domainResults: (results.rows as Record<string, unknown>[]).map((r) => ({
          domain: r.domain, analysisRun: r.analysis_run, opinion: r.opinion,
          opinionVersion: Number(r.opinion_version), adoption: r.adoption, createdAt: r.created_at,
        })),
        currency: verdicts,
        decisionReadiness: readiness.decisionReadiness,
        gaps: readiness.gaps,
        blockedActions: readiness.blockedActions,
        requiredActions: readiness.requiredActions,
        domainReuse: readiness.domainReuse,
      };
    },

    /** 任务一/三消费面（§4）：candidate/approved/available 状态 + 当前依据与队列引用。 */
    getCustomerDecisionStatus: async (credential: unknown, customerId: string) => {
      const c = await kernel.pool.query(`SELECT tenant_id FROM customers WHERE customer_id=$1`, [customerId]);
      if (c.rows.length === 0) throw notFound('客户不存在');
      await scopeByRow(kernel, { credential }, (c.rows[0] as { tenant_id: string }).tenant_id);
      const latest = await kernel.pool.query(
        `SELECT * FROM decision_packages WHERE customer_id=$1 AND status <> 'superseded' ORDER BY revision DESC LIMIT 1`,
        [customerId],
      );
      const pkg = (latest.rows[0] as PackageRow | undefined) ?? null;
      let currency: Awaited<ReturnType<typeof evaluateDomainCurrency>> = [];
      let readiness = null as ReturnType<typeof evaluateReadiness> | null;
      if (pkg !== null) {
        currency = await evaluateDomainCurrency(kernel.pool, customerId, pkg.domain_states as FrozenDomainState[]);
        const openFindings = await openBlockingFindings(kernel.pool, customerId);
        readiness = evaluateReadiness({
          domains: currency, gate: (pkg.gate ?? null) as GateInput | null, openFindings,
          inspectionRevision: (pkg.inspection_revision ?? null) as Record<string, unknown> | null,
          action: 'approve_facility',
        });
      }
      const fac = await kernel.pool.query(
        `SELECT status, COALESCE(SUM(approved_amount_minor),0) AS total FROM credit_facilities
         WHERE customer_id=$1 AND status IN ('proposed','approved_inactive','active','suspended') GROUP BY status`,
        [customerId],
      );
      const byStatus: Record<string, number> = {};
      for (const r of fac.rows as { status: string; total: string }[]) byStatus[r.status] = Number(r.total);
      // 可用额（§4 消费面）：与用信准备同一推导（账本推导值，只读、不惰性过期）
      const facRows = await kernel.pool.query(
        `SELECT * FROM credit_facilities WHERE customer_id=$1 AND status IN ('proposed','approved_inactive','active','suspended')`,
        [customerId],
      );
      const { facilityView } = await import('./credit.ts');
      const exClient = await kernel.pool.connect();
      let availableMinor = 0;
      try {
        for (const f of facRows.rows as Record<string, unknown>[]) {
          const view = await facilityView(exClient, f, { expire: false });
          availableMinor += view.availableForNewDrawMinor;
        }
      } finally {
        exClient.release();
      }
      const queue = await kernel.pool.query(
        `SELECT finding_id, finding_type, severity, status FROM decision_findings WHERE customer_id=$1 AND status='open'`,
        [customerId],
      );
      const reports = await kernel.pool.query(
        `SELECT report_id, kind, version, subject_id FROM report_views WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20`,
        [customerId],
      );
      return {
        ok: true,
        customerId,
        basis: pkg === null ? null : {
          packageId: pkg.package_id, revision: Number(pkg.revision), basisVersion: `${pkg.package_id}:${Number(pkg.revision)}`,
          status: pkg.status, currency, decisionReadiness: readiness?.decisionReadiness ?? false,
          gaps: readiness?.gaps ?? [], requiredActions: readiness?.requiredActions ?? [],
          blockedActions: readiness?.blockedActions ?? [],
          candidate: pkg.candidate, inspectionRevision: pkg.inspection_revision, gate: pkg.gate,
        },
        facilityTotalsMinor: {
          proposed: byStatus['proposed'] ?? 0,
          approvedInactive: byStatus['approved_inactive'] ?? 0,
          active: byStatus['active'] ?? 0,
          suspended: byStatus['suspended'] ?? 0,
          available: availableMinor,
        },
        reviewQueue: (queue.rows as Record<string, unknown>[]).map((r) => ({
          findingId: r.finding_id, findingType: r.finding_type, severity: r.severity, status: r.status,
        })),
        reportRefs: (reports.rows as Record<string, unknown>[]).map((r) => ({
          reportId: r.report_id, kind: r.kind, version: Number(r.version), subjectId: r.subject_id,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

async function kernelEvent(tx: PoolClient, eventType: string, customerId: string, payload: Record<string, unknown>): Promise<void> {
  await tx.query(
    `INSERT INTO outbox_events (event_id, event_type, customer_id, payload) VALUES (gen_random_uuid(), $1, $2, $3)`,
    [eventType, customerId, JSON.stringify(payload)],
  );
}

interface PkgQueryable { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }

async function openBlockingFindings(tx: PkgQueryable, customerId: string): Promise<OpenFindingLite[]> {
  const r = await tx.query(
    `SELECT finding_id, finding_type, impact_scope, rule_ref FROM decision_findings WHERE customer_id=$1 AND status='open'`,
    [customerId],
  );
  return (r.rows as Record<string, unknown>[]).map((row) => ({
    findingId: String(row.finding_id),
    findingType: String(row.finding_type),
    impactScope: (row.impact_scope ?? {}) as OpenFindingLite['impactScope'],
    ruleRef: (row.rule_ref ?? null) as OpenFindingLite['ruleRef'],
  }));
}

function stringArray(v: unknown, label: string, maxLen: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s.length === 0 || s.length > maxLen)) {
    throw invalid(`${label} 必须是非空 string 数组（每项 ≤${maxLen}）`);
  }
  return v as string[];
}

function objectArray(v: unknown, label: string): Record<string, unknown>[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw invalid(`${label} 必须是对象数组`);
  return v.map((x, i) => reqObject(x, `${label}[${i}]`));
}

function normalizeCandidate(v: unknown): Record<string, unknown> {
  if (v === undefined || v === null) return { authority: 'none', producedBy: 'unspecified' };
  const obj = reqObject(v, 'candidate');
  const out: Record<string, unknown> = { authority: 'none' };
  out.producedBy = reqString(obj.producedBy ?? 'unspecified', 'candidate.producedBy', 128);
  if (obj.amountMinor !== undefined && obj.amountMinor !== null) out.amountMinor = reqInt(obj.amountMinor, 'candidate.amountMinor');
  if (obj.currency !== undefined && obj.currency !== null) out.currency = reqCurrency(obj.currency);
  if (obj.termMonths !== undefined && obj.termMonths !== null) out.termMonths = reqInt(obj.termMonths, 'candidate.termMonths', 240);
  if (obj.conditions !== undefined && obj.conditions !== null) out.conditions = stringArray(obj.conditions, 'candidate.conditions', 500);
  if (obj.rationale !== undefined && obj.rationale !== null) out.rationale = reqString(obj.rationale, 'candidate.rationale', 4000, 0);
  const unknownKeys = Object.keys(obj).filter((k) => !['authority', 'amountMinor', 'currency', 'termMonths', 'conditions', 'rationale', 'producedBy'].includes(k));
  if (unknownKeys.length > 0) throw invalid(`candidate 含未声明字段：${unknownKeys.join(', ')}（严格 Schema；authority 由服务端强制 none）`);
  return out;
}

function normalizeAdoption(v: unknown, actor: string): Record<string, unknown> {
  const obj = reqObject(v, 'adoption');
  const decision = reqString(obj.decision, 'adoption.decision', 16);
  if (!['adopt', 'set_aside'].includes(decision)) throw invalid('adoption.decision 必须 adopt|set_aside');
  return {
    decision, by: actor, at: new Date().toISOString(),
    rationale: reqString(obj.rationale ?? '', 'adoption.rationale', 2000, 0),
    basisRefs: Array.isArray(obj.basisRefs) ? obj.basisRefs : [],
  };
}

/** AnalysisRun 浅校验（对齐 C domains/schema.mjs 必填项；语义由 C 负责）。 */
function validateAnalysisRunShallow(v: Record<string, unknown>, domain: string): Record<string, unknown> {
  for (const k of ['runId', 'inputHash', 'inputWatermark', 'rulesetVersion']) {
    if (typeof v[k] !== 'string' || (v[k] as string).length === 0) throw invalid(`analysisRun.${k} 必须为非空 string`);
  }
  if (v.domain !== undefined && v.domain !== domain) throw invalid(`analysisRun.domain 与登记域不一致`);
  const status = v.executionStatus === undefined || v.executionStatus === null ? 'completed' : String(v.executionStatus);
  if (!['completed', 'failed', 'timeout', 'not_configured', 'input_invalid'].includes(status)) {
    throw invalid('analysisRun.executionStatus 必须 completed|failed|timeout|not_configured|input_invalid');
  }
  return {
    runId: String(v.runId), domain, inputHash: String(v.inputHash),
    inputWatermark: v.inputWatermark, rulesetVersion: String(v.rulesetVersion),
    executionStatus: status,
    providerMode: v.providerMode === undefined ? 'simulation' : String(v.providerMode),
    completedAt: v.completedAt === undefined ? new Date().toISOString() : String(v.completedAt),
  };
}

// ---------------------------------------------------------------------------
// 提交点复查（3.4）：正式命令与用信准备共用的机械闸门。
// 判定全部来自包内冻结声明 + 当前 DB 事实；不带任何政策语义（规则在 C 路规则包）。
// ---------------------------------------------------------------------------

export interface ActionBlocker { code: 'STALE_BASIS' | 'REVIEW_REQUIRED' | 'GATE_BLOCKED' | 'NOT_FOUND'; message: string; gap?: string }

function gapToBlocker(gap: { code: string; detail?: string; domain?: string; findingId?: string }): ActionBlocker {
  if (gap.code === 'DOMAIN_DEPS_CHANGED' || gap.code === 'REQUIRED_DOMAIN_MISSING') {
    return { code: 'STALE_BASIS', message: `有效依据已变更（${gap.domain ?? gap.code}${gap.detail ? `：${gap.detail}` : ''}）：须更新后再正式动作`, gap: gap.code };
  }
  if (gap.code === 'GATE_HARD_BLOCK' || gap.code === 'GATE_NEEDS_EVIDENCE') {
    return { code: 'GATE_BLOCKED', message: `Gate 阻断（${gap.code}${gap.detail ? `：${gap.detail}` : ''}）：事实纠正重算或治理更新规则，无通用放行`, gap: gap.code };
  }
  return { code: 'REVIEW_REQUIRED', message: `复核未完成（${gap.code}${gap.detail ? `：${gap.detail}` : ''}）`, gap: gap.code };
}

/** 非抛出版：返回阻断清单（用信准备视图复用）。 */
export async function packageActionBlockers(
  q: { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> },
  customerId: string, packageId: string, action: string,
): Promise<ActionBlocker[]> {
  const r = await q.query(`SELECT * FROM decision_packages WHERE package_id=$1`, [packageId]);
  if (r.rows.length === 0) return [{ code: 'NOT_FOUND', message: `依据包不存在：${packageId}` }];
  const pkg = r.rows[0] as Record<string, unknown>;
  if (pkg.customer_id !== customerId) return [{ code: 'NOT_FOUND', message: '依据包不存在' }];
  if (pkg.status === 'superseded') return [{ code: 'STALE_BASIS', message: '依据包已被更新修订取代：正式动作须绑定最新修订' }];
  const verdicts = await evaluateDomainCurrency(q, customerId, pkg.domain_states as FrozenDomainState[]);
  const openFindings = await openBlockingFindings(q, customerId);
  const readiness = evaluateReadiness({
    domains: verdicts, gate: (pkg.gate ?? null) as GateInput | null, openFindings,
    inspectionRevision: (pkg.inspection_revision ?? null) as Record<string, unknown> | null,
    action,
  });
  return readiness.gaps.map(gapToBlocker);
}

/** 客户级未决差异对指定动作的阻断（3.2/3.4）：与依据包绑定无关，正式动作一律机械复查。 */
export async function assertNoBlockingFindings(
  tx: PkgQueryable, customerId: string, action: string,
): Promise<void> {
  const open = await openBlockingFindings(tx, customerId);
  const hits = open.filter((f) => {
    if (f.impactScope.blocking === false) return false;
    const actions = f.impactScope.actions ?? [];
    return actions.length === 0 || actions.includes(action);
  });
  if (hits.length > 0) {
    throw conflict('REVIEW_REQUIRED',
      `存在未处理的关键差异（影响动作 ${action}）：${hits.map((f) => f.findingId).join(', ')}——复核不等待冷却/审批（B04/B11）`,
      { action, findingIds: hits.map((f) => f.findingId) });
  }
}

/** 抛出版：正式命令在事务内调用；任一阻断 → 对应错误码（零写入，事务回滚）。 */
export async function checkPackageForAction(
  q: { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> },
  customerId: string, packageId: string, action: string,
): Promise<void> {
  const blockers = await packageActionBlockers(q, customerId, packageId, action);
  if (blockers.length === 0) return;
  const first = blockers[0];
  if (first === undefined) return;
  throw conflict(first.code, `依据包提交点复查未通过（动作 ${action}）：${blockers.map((b) => b.gap ?? b.code).join(', ')}`,
    { packageId, action, blockers });
}
