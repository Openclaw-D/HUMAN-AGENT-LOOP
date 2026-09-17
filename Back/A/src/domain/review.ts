// 任务02 · 差异复核（3.2 / B02–B04、B09、B11）：会影响决策的差异必须有处理结果，不能靠聊天沉底。
// 允许的处理结果按现有制度映射：explained_verified（已解释且核验成立）/ adverse_confirmed（已确认不利事实）
// / pending_evidence（仍待补证）/ not_applicable（明确不适用，仅在已批准可豁免范围内）。
// 不变量：口述、模型解释、ack 备注都不能替代所需核验（B04）；硬红线无通用 ack 绕过；
// 四域原意见不在本模块改写（意见采用与否在依据包域结果中记录人/理由/依据）。
import type { PoolClient } from 'pg';
import { conflict, invalid, notFound } from './errors.ts';
import { newId } from './util.ts';
import type { Kernel } from './kernel.ts';
import {
  reqObject, reqString, reqInt, withCommandV2, requireHuman, requireDirectoryRole, requireCustomerScope, lockCustomer, scopeByRow, gradeRank,
  type RequestFrame, type V2Ctx,
} from './v2kit.ts';

const FINDING_TYPES = ['material_conflict', 'caliber_difference', 'adverse_fact', 'verification_gap', 'data_anomaly'] as const;
const SEVERITIES = ['minor', 'major', 'critical'] as const;
const RESOLUTION_OUTCOMES = ['explained_verified', 'adverse_confirmed', 'pending_evidence', 'not_applicable'] as const;
type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

interface FindingRow extends Record<string, unknown> {
  finding_id: string; tenant_id: string; customer_id: string; finding_type: string;
  assertion: string; side_a: unknown; side_b: unknown; rule_ref: unknown;
  responsible_role: string; impact_scope: unknown; required_action: unknown;
  severity: string; status: string; resolution: unknown; version: number;
}

const SEVERITY_RANK: Record<string, number> = { minor: 0, major: 1, critical: 2 };

export interface ReviewApi {
  createFinding(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  getFinding(credential: unknown, findingId: string): Promise<Record<string, unknown>>;
  listFindings(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
  resolveFinding(frame: RequestFrame, findingId: string): Promise<Record<string, unknown>>;
  registerObjectRelink(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  listObjectInventory(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
}

export function buildReviewCommands(kernel: Kernel): ReviewApi {
  return {
    createFinding: (frame: RequestFrame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'finding.create', tenantId, async (tx, h, ctx) => {
        const customer = await lockCustomer(tx, customerId, tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const findingType = reqString(frame.findingType, 'findingType', 40);
        if (!(FINDING_TYPES as readonly string[]).includes(findingType)) {
          throw invalid(`findingType 必须 ${FINDING_TYPES.join('/')}`);
        }
        const assertion = reqString(frame.assertion, 'assertion', 4000);
        const sideA = frame.sideA === undefined || frame.sideA === null ? {} : reqObject(frame.sideA, 'sideA');
        const sideB = frame.sideB === undefined || frame.sideB === null ? {} : reqObject(frame.sideB, 'sideB');
        const responsibleRole = reqString(frame.responsibleRole, 'responsibleRole', 64);
        const severity = frame.severity === undefined || frame.severity === null ? 'major' : reqString(frame.severity, 'severity', 16);
        if (!(SEVERITIES as readonly string[]).includes(severity)) throw invalid(`severity 必须 ${SEVERITIES.join('/')}`);
        const impactScope = normalizeImpactScope(frame.impactScope);
        const requiredAction = normalizeRequiredAction(frame.requiredAction);
        let ruleRef: Record<string, unknown> | null = null;
        if (frame.ruleRef !== undefined && frame.ruleRef !== null) {
          const r = reqObject(frame.ruleRef, 'ruleRef');
          const ruleId = reqString(r.ruleId, 'ruleRef.ruleId', 128);
          // nonWaivable 由创建方按 C 规则包声明；解除时服务端再按本字段机械执行（不得事后放宽）
          ruleRef = { ruleId, nonWaivable: r.nonWaivable === true };
        }
        void customer;
        const findingId = newId('fnd');
        await tx.query(
          `INSERT INTO decision_findings
             (finding_id, tenant_id, customer_id, finding_type, assertion, side_a, side_b, rule_ref,
              responsible_role, impact_scope, required_action, severity, created_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12,$13)`,
          [findingId, ctx.tenantId, customerId, findingType, assertion, JSON.stringify(sideA), JSON.stringify(sideB),
           JSON.stringify(ruleRef), responsibleRole, JSON.stringify(impactScope), JSON.stringify(requiredAction), severity, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'finding_created', targetType: 'decision_finding', targetId: findingId,
          summary: `差异登记 ${findingType}（${severity}；影响 ${JSON.stringify(impactScope.actions ?? [])}）`,
          payload: { findingType, severity },
        });
        // 阻断性差异即触发 ReviewRequired（通知/页面只消费）
        if (impactScope.blocking) {
          await h.emit('REVIEW_REQUIRED', customerId, {
            findingId, findingType, severity, actions: impactScope.actions, domains: impactScope.domains,
          });
        }
        return { ok: true, findingId, status: 'open', version: 1 };
      });
    },

    getFinding: async (credential: unknown, findingId: string) => {
      const row = await lookupFinding(kernel, credential, findingId);
      return { ok: true, finding: projectFinding(row) };
    },

    listFindings: async (credential: unknown, customerId: string) => {
      // A1：读口统一从客户授权出发（'grant' 模式 principal 未授权该客户 → 404，不泄露空列表）
      await lookupCustomerForRead(kernel, credential, customerId);
      const res = await kernel.pool.query(
        `SELECT * FROM decision_findings WHERE customer_id=$1 ORDER BY created_at`, [customerId],
      );
      const findings = (res.rows as FindingRow[]).map(projectFinding);
      const open = findings.filter((f) => f.status === 'open')
        .sort((a, b) => (SEVERITY_RANK[b.severity as string] ?? 0) - (SEVERITY_RANK[a.severity as string] ?? 0));
      return { ok: true, reviewQueue: open, findings };
    },

    // ---- B14 对象重关联：显式人工映射，追加式；历史证据恒绑定原始 objectId+sceneVersion ----

    registerObjectRelink: (frame: RequestFrame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'object.relink', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'object.relink');
        requireDirectoryRole(ctx, ['business', 'credit', 'asset'], 'object.relink');
        const customer = await lockCustomer(tx, customerId, tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const mappingsIn = frame.mappings;
        if (!Array.isArray(mappingsIn) || mappingsIn.length === 0 || mappingsIn.length > 100) {
          throw invalid('mappings 必须是 1..100 的数组');
        }
        const relinkIds: string[] = [];
        for (const m of mappingsIn) {
          const obj = reqObject(m, 'mappings[]');
          const fromObjectId = reqString(obj.fromObjectId, 'mappings[].fromObjectId', 128);
          const toObjectId = reqString(obj.toObjectId, 'mappings[].toObjectId', 128);
          const toSceneVersion = reqString(obj.toSceneVersion, 'mappings[].toSceneVersion', 64);
          const rationale = reqString(obj.rationale ?? '', 'mappings[].rationale', 500, 0);
          if (fromObjectId === toObjectId) throw invalid('fromObjectId 与 toObjectId 相同：无意义重关联');
          const relinkId = newId('rln');
          await tx.query(
            `INSERT INTO object_relinks (relink_id, tenant_id, customer_id, from_object_id, to_object_id, to_scene_version, rationale, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [relinkId, tenantId, customerId, fromObjectId, toObjectId, toSceneVersion, rationale, ctx.actor],
          );
          relinkIds.push(relinkId);
        }
        await h.audit({
          actor: ctx.actor, action: 'object_relinked', targetType: 'customer', targetId: customerId,
          summary: `对象显式重关联 ${relinkIds.length} 条（历史绑定不变；双方 id 可追溯）`, payload: { count: relinkIds.length },
        });
        await h.emit('ASSESSMENT_BASIS_REVISED', customerId, { reason: 'object_relink', count: relinkIds.length });
        return { ok: true, relinkIds };
      });
    },

    listObjectInventory: async (credential: unknown, customerId: string) => {
      const cust = await kernel.pool.query(`SELECT tenant_id FROM customers WHERE customer_id=$1`, [customerId]);
      if (cust.rows.length === 0) throw notFound('客户不存在');
      await scopeByRow(kernel, { credential }, (cust.rows[0] as { tenant_id: string }).tenant_id, customerId);
      const arts = await kernel.pool.query(
        `SELECT artifact_id, object_ref, superseded_by, duplicate_of FROM evidence_artifacts
         WHERE customer_id=$1 AND object_ref IS NOT NULL ORDER BY created_at`, [customerId],
      );
      const relinks = await kernel.pool.query(
        `SELECT from_object_id, to_object_id, to_scene_version, created_at FROM object_relinks
         WHERE customer_id=$1 ORDER BY created_at`, [customerId],
      );
      const byObject = new Map<string, { objectId: string; sceneVersions: Set<string>; artifactIds: string[] }>();
      for (const row of arts.rows as Record<string, unknown>[]) {
        const ref = (row.object_ref ?? {}) as { objectId?: string; sceneVersion?: string };
        if (!ref.objectId) continue;
        let entry = byObject.get(ref.objectId);
        if (entry === undefined) {
          entry = { objectId: ref.objectId, sceneVersions: new Set(), artifactIds: [] };
          byObject.set(ref.objectId, entry);
        }
        if (ref.sceneVersion) entry.sceneVersions.add(ref.sceneVersion);
        entry.artifactIds.push(String(row.artifact_id));
      }
      const relinkMap = new Map<string, { toObjectId: string; toSceneVersion: string; at: unknown }>();
      for (const r of relinks.rows as Record<string, unknown>[]) {
        relinkMap.set(String(r.from_object_id), {
          toObjectId: String(r.to_object_id), toSceneVersion: String(r.to_scene_version), at: r.created_at,
        });
      }
      return {
        ok: true,
        objects: [...byObject.values()].map((o) => {
          const relink = relinkMap.get(o.objectId) ?? null;
          return {
            objectId: o.objectId,
            sceneVersions: [...o.sceneVersions],
            artifactIds: o.artifactIds,
            // 场景重建后未显式映射 → relinkRequired=true（待重新关联；绝不模糊匹配）
            relinkRequired: relink === null,
            relinkedTo: relink,
          };
        }),
        relinkCount: relinks.rows.length,
      };
    },

    resolveFinding: (frame: RequestFrame, findingId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'finding.resolve', tenantId, async (tx, h, ctx) => {
        const f0 = await tx.query(`SELECT tenant_id, customer_id FROM decision_findings WHERE finding_id=$1`, [findingId]);
        if (f0.rows.length === 0) throw notFound('差异记录不存在');
        const owner = f0.rows[0] as { tenant_id: string; customer_id: string };
        await scopeByRow(kernel, frame, owner.tenant_id, owner.customer_id);
        const customer = await lockCustomer(tx, owner.customer_id, owner.tenant_id); // 固定锁序：客户 → 差异
        void customer;
        const f1 = await tx.query(`SELECT * FROM decision_findings WHERE finding_id=$1 FOR UPDATE`, [findingId]);
        const row = f1.rows[0] as FindingRow;
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        requireHuman(ctx, 'finding.resolve');
        requireResolverRole(ctx, row.responsible_role);
        const expected = reqInt(frame.expectedVersion, 'expectedVersion', 1_000_000);
        if (expected !== Number(row.version)) {
          throw conflict('VERSION_CONFLICT', `差异记录版本已更新：客户端 v${expected}，服务端 v${row.version}`, { serverVersion: Number(row.version) });
        }
        if (row.status !== 'open') throw conflict('NOT_READY', `差异记录当前 ${row.status}：仅 open 可处理`);
        const outcome = reqString(frame.resolution, 'resolution', 32) as ResolutionOutcome;
        if (!(RESOLUTION_OUTCOMES as readonly string[]).includes(outcome)) {
          throw invalid(`resolution 必须 ${RESOLUTION_OUTCOMES.join('/')}`);
        }
        const rationale = reqString(frame.rationale ?? '', 'rationale', 2000, 0);
        const ackNote = reqString(frame.ackNote ?? '', 'ackNote', 2000, 0); // 仅留痕；永远不满足核验要求
        const ruleRef = (row.rule_ref ?? null) as { ruleId?: string; nonWaivable?: boolean } | null;
        const hardGate = ruleRef?.nonWaivable === true;
        const requiredAction = (row.required_action ?? {}) as { requiredEvidenceKinds?: string[]; minGrade?: string | null };
        const impactScope = (row.impact_scope ?? {}) as { actions?: string[]; domains?: string[]; blocking?: boolean };

        let evidenceRefs: { artifactId: string; sha256: string; kind: string; grade: string }[] = [];
        let waiverResolved: Record<string, unknown> | null = null;
        if (outcome === 'explained_verified') {
          evidenceRefs = await requireClosureEvidence(tx, owner.customer_id, requiredAction, frame.evidenceRefs);
        } else if (outcome === 'not_applicable') {
          // 明确不适用 = 业务例外：只在已登记的有效豁免范围内（硬红线无通用 ack 绕过；P-05 fail-closed）
          if (hardGate) {
            throw conflict('POLICY_PENDING', `差异绑定不可豁免规则 ${ruleRef?.ruleId}：不接受 not_applicable（只能核验成立或确认不利事实）`);
          }
          // goal-01 G1：waiverRef 只收服务端豁免登记引用 {exemptionId}；自报 policyApproved/approvedBy/validUntil 一律拒绝
          const waiver = frame.waiverRef === undefined || frame.waiverRef === null ? null : reqObject(frame.waiverRef, 'waiverRef');
          if (waiver === null) {
            throw conflict('POLICY_PENDING', 'not_applicable 需要豁免依据（waiverRef.exemptionId）：未登记一律拒绝');
          }
          if (waiver.policyApproved !== undefined || waiver.approvedBy !== undefined || waiver.validUntil !== undefined) {
            throw invalid('waiverRef 只接受 {exemptionId}：豁免不可自报（批准人以服务端登记为准）');
          }
          const exemptionId = reqString(waiver.exemptionId, 'waiverRef.exemptionId', 64);
          const rows = await tx.query(`SELECT * FROM domain_exemptions WHERE exemption_id=$1`, [exemptionId]);
          if (rows.rows.length === 0) throw notFound(`豁免登记不存在：${exemptionId}`);
          const ex = rows.rows[0] as Record<string, unknown>;
          if (ex.tenant_id !== owner.tenant_id || ex.customer_id !== owner.customer_id) throw notFound(`豁免登记不存在：${exemptionId}`);
          if (ex.status !== 'valid') {
            throw conflict('POLICY_PENDING', `豁免 ${exemptionId} 已撤销：not_applicable 拒绝`);
          }
          if (ex.valid_until !== null && new Date(ex.valid_until as string).getTime() <= Date.now()) {
            throw conflict('POLICY_PENDING', `豁免 ${exemptionId} 已过期：not_applicable 拒绝`);
          }
          const findingType = row.finding_type as string;
          const ruleId = ruleRef?.ruleId ?? null;
          const scope = String(ex.scope);
          if (scope !== 'any' && scope !== findingType && (ruleId === null || scope !== ruleId)) {
            throw conflict('POLICY_PENDING', `豁免 ${exemptionId} 范围（${scope}）不覆盖本差异（type=${findingType}${ruleId ? `，rule=${ruleId}` : ''}）`);
          }
          waiverResolved = {
            exemptionId, scope, approvedBy: ex.approved_by,
            validUntil: ex.valid_until, policyVersion: ex.policy_version,
          };
        } else if (outcome === 'adverse_confirmed' && hardGate === false && rationale.length === 0 && ackNote.length === 0) {
          throw invalid('adverse_confirmed 需要 rationale 或 ackNote 说明确认内容');
        }
        const closed = outcome === 'explained_verified' || outcome === 'adverse_confirmed' || outcome === 'not_applicable';
        const resolution = {
          outcome, by: ctx.actor, at: new Date().toISOString(), rationale,
          evidenceRefs, waiverRef: waiverResolved, ackNote: ackNote === '' ? null : ackNote,
        };
        await tx.query(
          `UPDATE decision_findings SET status=$2, resolution=$3::jsonb, version=version+1, updated_at=now() WHERE finding_id=$1`,
          [findingId, closed ? 'closed' : 'open', JSON.stringify(resolution)],
        );
        await h.audit({
          actor: ctx.actor, action: 'finding_resolved', targetType: 'decision_finding', targetId: findingId,
          summary: `差异处理结果 ${outcome}${closed ? '（关闭）' : '（保持 open；仍待补证）'}`,
          payload: { outcome, evidenceCount: evidenceRefs.length },
        });
        if (outcome === 'adverse_confirmed') {
          // 不利事实确认 → 依据已实质修订：受影响客户域发出 AssessmentBasisRevised（消费方按 eventId 幂等）
          await h.emit('ASSESSMENT_BASIS_REVISED', owner.customer_id, {
            reason: 'adverse_confirmed', findingId, actions: impactScope.actions ?? [], domains: impactScope.domains ?? [],
          });
        }
        if (!closed && impactScope.blocking !== false) {
          await h.emit('REVIEW_REQUIRED', owner.customer_id, {
            findingId, findingType: row.finding_type, severity: row.severity,
            actions: impactScope.actions ?? [], domains: impactScope.domains ?? [], state: 'pending_evidence',
          });
        }
        return { ok: true, findingId, status: closed ? 'closed' : 'open', resolution: { outcome, by: ctx.actor }, version: Number(row.version) + 1 };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function normalizeImpactScope(v: unknown): { actions: string[]; domains: string[]; blocking: boolean } {
  if (v === undefined || v === null) return { actions: [], domains: [], blocking: true };
  const obj = reqObject(v, 'impactScope');
  const strArr = (x: unknown, label: string): string[] => {
    if (x === undefined || x === null) return [];
    if (!Array.isArray(x) || x.some((s) => typeof s !== 'string' || s.length === 0 || s.length > 64)) {
      throw invalid(`${label} 必须是非空 string 数组`);
    }
    return x as string[];
  };
  return {
    actions: strArr(obj.actions, 'impactScope.actions'),
    domains: strArr(obj.domains, 'impactScope.domains'),
    blocking: obj.blocking === false ? false : true,
  };
}

function normalizeRequiredAction(v: unknown): { kind: string; requiredEvidenceKinds: string[]; minGrade: string | null } {
  if (v === undefined || v === null) return { kind: 'verify', requiredEvidenceKinds: [], minGrade: null };
  const obj = reqObject(v, 'requiredAction');
  const kind = reqString(obj.kind ?? 'verify', 'requiredAction.kind', 32);
  if (!['verify', 'provide_evidence', 'decision'].includes(kind)) throw invalid('requiredAction.kind 必须 verify|provide_evidence|decision');
  const kinds = obj.requiredEvidenceKinds === undefined || obj.requiredEvidenceKinds === null ? [] : obj.requiredEvidenceKinds;
  if (!Array.isArray(kinds) || kinds.some((s) => typeof s !== 'string' || s.length === 0 || s.length > 64)) {
    throw invalid('requiredAction.requiredEvidenceKinds 必须是非空 string 数组');
  }
  const minGrade = obj.minGrade === undefined || obj.minGrade === null ? null : reqString(obj.minGrade, 'requiredAction.minGrade', 32);
  return { kind, requiredEvidenceKinds: kinds as string[], minGrade };
}

/** B04：关闭关键复核必须存在满足声明的现行证据；ack/口述/模型解释不构成证据。 */
async function requireClosureEvidence(
  tx: PoolClient, customerId: string,
  requiredAction: { requiredEvidenceKinds?: string[]; minGrade?: string | null },
  refsIn: unknown,
): Promise<{ artifactId: string; sha256: string; kind: string; grade: string }[]> {
  const wanted = requiredAction.requiredEvidenceKinds ?? [];
  if (!Array.isArray(refsIn) || refsIn.length === 0) {
    throw conflict('REVIEW_EVIDENCE_REQUIRED',
      `关闭该差异需要证据${wanted.length > 0 ? `（kind：${wanted.join('/')}）` : ''}：ack/说明/口述不能替代核验（B04）`,
      { requiredEvidenceKinds: wanted, minGrade: requiredAction.minGrade ?? null });
  }
  const out: { artifactId: string; sha256: string; kind: string; grade: string }[] = [];
  for (const ref of refsIn) {
    const obj = reqObject(ref, 'evidenceRefs[]');
    const artifactId = reqString(obj.artifactId, 'evidenceRefs[].artifactId', 64);
    const r = await tx.query(
      `SELECT a.artifact_id, a.kind, a.sha256, a.customer_id, a.superseded_by, a.duplicate_of,
              (SELECT f.grade FROM fact_assertions f WHERE f.artifact_id = a.artifact_id LIMIT 1) AS grade
       FROM evidence_artifacts a WHERE a.artifact_id=$1`, [artifactId],
    );
    if (r.rows.length === 0) throw notFound(`证据工件不存在：${artifactId}`);
    const a = r.rows[0] as Record<string, unknown>;
    if (a.customer_id !== customerId) throw notFound(`证据工件不属于该客户：${artifactId}`);
    if (a.superseded_by !== null || a.duplicate_of !== null) {
      throw conflict('ARTIFACT_SUPERSEDED', `证据工件已失效：${artifactId}`);
    }
    if (wanted.length > 0 && !wanted.includes(String(a.kind))) {
      throw conflict('REVIEW_EVIDENCE_REQUIRED',
        `证据 kind 不匹配：需要 ${wanted.join('/')}，收到 ${String(a.kind)}`,
        { requiredEvidenceKinds: wanted, actualKind: a.kind });
    }
    if (requiredAction.minGrade != null && gradeRank(String(a.grade)) < gradeRank(String(requiredAction.minGrade))) {
      throw conflict('REVIEW_EVIDENCE_REQUIRED',
        `证据核验等级不足：需要 ≥ ${String(requiredAction.minGrade)}，${artifactId} 为 ${String(a.grade)}`,
        { minGrade: requiredAction.minGrade, actualGrade: a.grade, artifactId });
    }
    out.push({ artifactId, sha256: String(a.sha256), kind: String(a.kind), grade: String(a.grade) });
  }
  return out;
}

/** 处理人角色：finding 指定 A 目录角色（business/credit）时必须由该角色处理；其余限客户域业务角色。 */
function requireResolverRole(ctx: V2Ctx, responsibleRole: string): void {
  const directory = ['business', 'credit'];
  if (directory.includes(responsibleRole)) {
    requireDirectoryRole(ctx, [responsibleRole], 'finding.resolve');
    return;
  }
  requireDirectoryRole(ctx, [...directory, 'admin'], 'finding.resolve');
}

async function lookupFinding(kernel: Kernel, credential: unknown, findingId: string): Promise<FindingRow> {
  const res = await kernel.pool.query(`SELECT * FROM decision_findings WHERE finding_id=$1`, [findingId]);
  if (res.rows.length === 0) throw notFound('差异记录不存在');
  const row = res.rows[0] as FindingRow;
  await scopeByRow(kernel, { credential }, row.tenant_id, row.customer_id);
  return row;
}

async function lookupCustomerForRead(kernel: Kernel, credential: unknown, customerId: string): Promise<void> {
  const res = await kernel.pool.query(`SELECT tenant_id FROM customers WHERE customer_id=$1`, [customerId]);
  if (res.rows.length === 0) throw notFound('客户不存在');
  await scopeByRow(kernel, { credential }, (res.rows[0] as { tenant_id: string }).tenant_id, customerId);
}

function projectFinding(row: FindingRow): Record<string, unknown> {
  return {
    findingId: row.finding_id, customerId: row.customer_id, findingType: row.finding_type,
    assertion: row.assertion, sideA: row.side_a, sideB: row.side_b, ruleRef: row.rule_ref,
    responsibleRole: row.responsible_role, impactScope: row.impact_scope, requiredAction: row.required_action,
    severity: row.severity, status: row.status, resolution: row.resolution, version: Number(row.version),
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

