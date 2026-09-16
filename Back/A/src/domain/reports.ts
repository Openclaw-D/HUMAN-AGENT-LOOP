// 任务02 · 会后授权视图（3.5 / B12、B13）：三个可复核视图 = 结构化业务数据的确定性投影。
// 不变量：生成是"纯读 + 追加一行"，绝不调用批准/预占命令、绝不反写业务状态（B12）；
// 客户版按白名单字段在服务端组装，内部结论/阈值/元数据不进入客户投影（B13）；
// 同一业务状态重复生成 → 同一内容哈希 → 返回同一行（version 不变，regenerated:true）。
import type { PoolClient } from 'pg';
import { conflict, invalid, notFound } from './errors.ts';
import { canonicalHash, newId, sha256 } from './util.ts';
import type { Kernel } from './kernel.ts';
import {
  reqString, withCommandV2, requireDirectoryRole, lockCustomer, scopeByRow,
  type RequestFrame,
} from './v2kit.ts';

const KINDS = ['internal_summary', 'customer_supplement', 'use_prep_sheet'] as const;
type ReportKind = (typeof KINDS)[number];

const AUDIENCE: Record<ReportKind, 'internal' | 'customer'> = {
  internal_summary: 'internal',
  use_prep_sheet: 'internal',
  customer_supplement: 'customer',
};

const SUBJECT_TYPE: Record<ReportKind, string> = {
  internal_summary: 'decision_package',
  customer_supplement: 'customer',
  use_prep_sheet: 'financing_request',
};

/** 可读内部视图的服务端目录角色（载荷声明无效；A10/A19）。 */
const BUSINESS_AUDIENCE = ['admin', 'business', 'credit', 'policy', 'commerce', 'asset', 'jianwei', 'approver'];

export interface ReportsApi {
  generateReport(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  getReport(credential: unknown, reportId: string, format: string | null): Promise<Record<string, unknown>>;
  listReports(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
}

export function buildReportCommands(kernel: Kernel): ReportsApi {
  return {
    generateReport: (frame: RequestFrame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'report.generate', tenantId, async (tx, h, ctx) => {
        const customer = await lockCustomer(tx, customerId, tenantId);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const kind = reqString(frame.kind, 'kind', 32) as ReportKind;
        if (!(KINDS as readonly string[]).includes(kind)) throw invalid(`kind 必须 ${KINDS.join('/')}`);
        const subjectId = reqString(frame.subjectId, 'subjectId', 64);
        // 生成权限：内部视图需要业务目录角色（客户 principal 不能生成/触达内部视图）
        if (kind !== 'customer_supplement') {
          requireAudienceRole(ctx.roles, BUSINESS_AUDIENCE, `report.generate:${kind}`);
        } else {
          requireAudienceRole(ctx.roles, [...BUSINESS_AUDIENCE], `report.generate:${kind}`);
        }
        const contentCore = await buildContent(tx, kind, customerId, subjectId);
        // 幂等键只含业务状态（生成时间等展示字段不入哈希）：同一状态重复生成 → 同一行
        const basedOnHash = canonicalHash({ kind, subjectId, contentSha: sha256(JSON.stringify(contentCore)) });
        const content: Record<string, unknown> = { ...contentCore, generatedAt: new Date().toISOString() };
        const contentStr = JSON.stringify(content);
        const contentSha = sha256(JSON.stringify(contentCore));
        // 幂等重生成（B12）：同一业务状态 → 同一 based_on_hash → 返回既有行，不开新版本
        const prior = await tx.query(
          `SELECT * FROM report_views WHERE kind=$1 AND subject_id=$2 AND based_on_hash=$3`,
          [kind, subjectId, basedOnHash],
        );
        if (prior.rows.length > 0) {
          const row = prior.rows[0] as Record<string, unknown>;
          return { ok: true, reportId: row.report_id, version: Number(row.version), regenerated: true };
        }
        const verRes = await tx.query(
          `SELECT COALESCE(MAX(version),0) AS v FROM report_views WHERE kind=$1 AND subject_id=$2`,
          [kind, subjectId],
        );
        const version = Number((verRes.rows[0] as { v: string | number }).v) + 1;
        const reportId = newId('rep');
        const markdown = renderMarkdown(kind, content);
        await tx.query(
          `INSERT INTO report_views
             (report_id, tenant_id, customer_id, kind, audience, subject_type, subject_id, version,
              based_on_hash, content, markdown, content_sha256, generated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
          [reportId, tenantId, customerId, kind, AUDIENCE[kind], SUBJECT_TYPE[kind], subjectId, version,
           basedOnHash, contentStr, markdown, contentSha, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'report_generated', targetType: 'report_view', targetId: reportId,
          summary: `生成 ${kind} v${version}（${subjectId}）`, payload: { kind, version, subjectId },
        });
        return { ok: true, reportId, version, regenerated: false, audience: AUDIENCE[kind] };
      });
    },

    /** B13：受众在服务端裁决；客户 principal 请求内部视图 → 统一拒绝，不泄露存在性/元数据。 */
    getReport: async (credential: unknown, reportId: string, format: string | null) => {
      const res = await kernel.pool.query(`SELECT * FROM report_views WHERE report_id=$1`, [reportId]);
      if (res.rows.length === 0) throw notFound('报告不存在');
      const row = res.rows[0] as Record<string, unknown>;
      const kind = String(row.kind) as ReportKind;
      const { authenticate, requireVerified } = await import('./principal.ts');
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      try {
        const { authorizeTenant } = await import('./principal.ts');
        authorizeTenant(auth.principal, String(row.tenant_id));
      } catch {
        throw notFound('报告不存在');
      }
      if (AUDIENCE[kind] === 'internal') {
        requireAudienceRole([...auth.principal.roles], BUSINESS_AUDIENCE, 'report.get:internal');
      }
      const fmt = format ?? 'json';
      if (fmt !== 'json' && fmt !== 'markdown' && fmt !== 'md') throw invalid('format 必须 json|markdown');
      return {
        ok: true,
        report: {
          reportId, kind, audience: AUDIENCE[kind], subjectType: row.subject_type, subjectId: row.subject_id,
          version: Number(row.version), customerId: row.customer_id, contentSha256: row.content_sha256,
          createdAt: row.created_at,
          content: fmt === 'json' ? row.content : undefined,
          markdown: fmt !== 'json' ? row.markdown : undefined,
        },
      };
    },

    listReports: async (credential: unknown, customerId: string) => {
      const c = await kernel.pool.query(`SELECT tenant_id FROM customers WHERE customer_id=$1`, [customerId]);
      if (c.rows.length === 0) throw notFound('客户不存在');
      await scopeByRow(kernel, { credential }, (c.rows[0] as { tenant_id: string }).tenant_id);
      const { authenticate, requireVerified } = await import('./principal.ts');
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      requireAudienceRole([...auth.principal.roles], BUSINESS_AUDIENCE, 'report.list');
      const res = await kernel.pool.query(
        `SELECT report_id, kind, audience, subject_type, subject_id, version, content_sha256, created_at
         FROM report_views WHERE customer_id=$1 ORDER BY created_at DESC`, [customerId],
      );
      return {
        ok: true,
        reports: (res.rows as Record<string, unknown>[]).map((r) => ({
          reportId: r.report_id, kind: r.kind, audience: r.audience, subjectType: r.subject_type,
          subjectId: r.subject_id, version: Number(r.version), contentSha256: r.content_sha256, createdAt: r.created_at,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 内容构建（服务端白名单投影；客户版绝不内嵌内部字段）
// ---------------------------------------------------------------------------

type Tx = PoolClient;

async function buildContent(tx: Tx, kind: ReportKind, customerId: string, subjectId: string): Promise<Record<string, unknown>> {
  const cust = await tx.query(`SELECT display_name, legal_entity_ref, status FROM customers WHERE customer_id=$1`, [customerId]);
  if (cust.rows.length === 0) throw notFound('客户不存在');
  const c = cust.rows[0] as Record<string, unknown>;
  // 生成时间不入 content 基准（幂等哈希只含业务状态；展示时间在存储前由调用方补齐）
  const base = { customerDisplayName: c.display_name, legalEntityRef: c.legal_entity_ref };
  if (kind === 'internal_summary') {
    const pkg = await tx.query(`SELECT * FROM decision_packages WHERE package_id=$1 AND customer_id=$2`, [subjectId, customerId]);
    if (pkg.rows.length === 0) throw notFound('依据包不存在');
    const p = pkg.rows[0] as Record<string, unknown>;
    const results = await tx.query(
      `SELECT domain, opinion, opinion_version, adoption, analysis_run FROM package_domain_results
       WHERE package_id=$1 ORDER BY domain, opinion_version`, [subjectId],
    );
    const findings = await tx.query(
      `SELECT finding_id, finding_type, severity, status, resolution FROM decision_findings WHERE customer_id=$1 ORDER BY created_at`,
      [customerId],
    );
    const decisions = await tx.query(
      `SELECT decision_id, action, subject_type, subject_id, actor_principal, decided_at FROM decision_records
       WHERE customer_id=$1 ORDER BY decided_at DESC LIMIT 20`, [customerId],
    );
    return {
      ...base,
      view: 'internal_assessment_summary',
      basisVersion: `${String(p.package_id)}:${Number(p.revision)}`,
      packageStatus: p.status, snapshotHash: p.snapshot_hash,
      inspectionRevision: p.inspection_revision,
      gate: p.gate,
      candidate: p.candidate,
      unknownCosts: p.unknown_costs,
      independentProofs: Number(p.independent_proofs),
      domainResults: (results.rows as Record<string, unknown>[]).map((r) => ({
        domain: r.domain, opinionVersion: Number(r.opinion_version), opinion: r.opinion,
        adoption: r.adoption, runId: (r.analysis_run as Record<string, unknown> | null)?.runId ?? null,
      })),
      findings: (findings.rows as Record<string, unknown>[]).map((r) => ({
        findingId: r.finding_id, findingType: r.finding_type, severity: r.severity, status: r.status, resolution: r.resolution,
      })),
      formalDecisions: (decisions.rows as Record<string, unknown>[]).map((r) => ({
        decisionId: r.decision_id, action: r.action, subjectType: r.subject_type, subjectId: r.subject_id,
        actor: r.actor_principal, decidedAt: r.decided_at,
      })),
    };
  }
  if (kind === 'customer_supplement') {
    // 客户可见补证/处理说明：白名单字段；不含 ruleId/Gate/阈值/内部意见/内部角色
    const findings = await tx.query(
      `SELECT finding_id, finding_type, status, resolution, required_action FROM decision_findings
       WHERE customer_id=$1 AND finding_type IN ('material_conflict','caliber_difference','verification_gap')
       ORDER BY created_at`, [customerId],
    );
    const supplements: Record<string, unknown>[] = [];
    const notes: Record<string, unknown>[] = [];
    for (const r of findings.rows as Record<string, unknown>[]) {
      const required = (r.required_action ?? {}) as { requiredEvidenceKinds?: string[] };
      const resolution = (r.resolution ?? null) as Record<string, unknown> | null;
      if (r.status === 'open') {
        supplements.push({
          ref: String(r.finding_id).slice(0, 8),
          topic: customerTopic(String(r.finding_type)),
          neededDocuments: required.requiredEvidenceKinds ?? ['相关证明材料'],
          status: '待补充或说明',
        });
      } else if (resolution !== null) {
        const outcome = String(resolution.outcome ?? '');
        notes.push({
          ref: String(r.finding_id).slice(0, 8),
          topic: customerTopic(String(r.finding_type)),
          status: outcome === 'explained_verified' ? '已说明并核验成立'
            : outcome === 'adverse_confirmed' ? '已确认（按贵司提交的资料记录）'
            : outcome === 'not_applicable' ? '经核实与本业务无关'
            : '仍待补充材料',
        });
      }
    }
    return {
      ...base,
      view: 'customer_supplement_request',
      supplements, handlingNotes: notes,
      note: '本说明由结构化业务记录生成；材料可通过服务人员提交，提交后进入人工核验流程。',
    };
  }
  // use_prep_sheet（逐笔用信准备单）
  const fr = await tx.query(`SELECT * FROM financing_requests WHERE fr_id=$1 AND customer_id=$2`, [subjectId, customerId]);
  if (fr.rows.length === 0) throw notFound('融资申请不存在');
  const f = fr.rows[0] as Record<string, unknown>;
  const facility = await tx.query(`SELECT * FROM credit_facilities WHERE facility_id=$1`, [f.facility_id as string]);
  const fac = facility.rows[0] as Record<string, unknown> | undefined;
  const decisions = await tx.query(
    `SELECT decision_id, action, actor_principal, decided_at FROM decision_records
     WHERE subject_type='facility' AND subject_id=$1 ORDER BY decided_at DESC LIMIT 5`, [f.facility_id as string],
  );
  return {
    ...base,
    view: 'use_preparation_sheet',
    frId: f.fr_id, status: f.status, externalState: f.external_state,
    productType: f.product_type, amountMinor: Number(f.amount_minor), currency: f.currency,
    equipmentRefCount: Array.isArray(f.equipment_refs) ? (f.equipment_refs as unknown[]).length : 0,
    contractRefCount: Array.isArray(f.contract_refs) ? (f.contract_refs as unknown[]).length : 0,
    facility: fac === undefined ? null : {
      facilityId: fac.facility_id, status: fac.status, approvedAmountMinor: Number(fac.approved_amount_minor),
      currency: fac.currency, conditions: fac.conditions,
      basis: fac.basis, coolingUntil: fac.cooling_until ?? null,
    },
    facilityDecisions: (decisions.rows as Record<string, unknown>[]).map((r) => ({
      decisionId: r.decision_id, action: r.action, actor: r.actor_principal, decidedAt: r.decided_at,
    })),
    reservedUntil: f.reserved_until ?? null,
  };
}

function customerTopic(findingType: string): string {
  switch (findingType) {
    case 'material_conflict': return '材料信息需要澄清';
    case 'caliber_difference': return '材料口径/期间需要统一说明';
    case 'verification_gap': return '尚缺必要证明材料';
    default: return '资料需要补充说明';
  }
}

function requireAudienceRole(roles: string[], allowed: string[], action: string): void {
  if (!roles.some((r) => allowed.includes(r))) {
    // 统一拒绝文案：不泄露视图存在性与内部结构（B13）
    throw conflict('PERMISSION_DENIED', `无权访问该资源（${action}）`);
  }
}

// ---------------------------------------------------------------------------
// Markdown 渲染（可从结构化 content 确定性重建；不引入新文档体系）
// ---------------------------------------------------------------------------

function renderMarkdown(kind: ReportKind, content: Record<string, unknown>): string {
  const lines: string[] = [];
  const j = (v: unknown): string => JSON.stringify(v ?? null, null, 2);
  lines.push(kind === 'internal_summary' ? '# 内部评估摘要' : kind === 'customer_supplement' ? '# 补充材料与处理说明' : '# 逐笔用信准备单');
  lines.push('');
  lines.push(`- 客户：${String(content.customerDisplayName ?? '')}（${String(content.legalEntityRef ?? '')}）`);
  lines.push(`- 生成时间：${String(content.generatedAt ?? '')}`);
  if (kind === 'internal_summary') {
    lines.push(`- 依据版本：${String(content.basisVersion ?? '')}`);
    lines.push(`- 包状态：${String(content.packageStatus ?? '')}`);
    lines.push(`- 独立证明数：${String(content.independentProofs ?? 0)}`);
    if (content.gate) lines.push(`- Gate：${j(content.gate)}`);
    if (content.candidate) lines.push(`- 候选与条件：${j(content.candidate)}`);
    for (const d of (content.domainResults as Record<string, unknown>[] | undefined) ?? []) {
      lines.push(`- 域结果 ${String(d.domain)} v${String(d.opinionVersion)}：${String((d.adoption as Record<string, unknown> | null)?.decision ?? '未采用决定')}`);
    }
    for (const f of (content.findings as Record<string, unknown>[] | undefined) ?? []) {
      lines.push(`- 差异 ${String(f.findingId)}：${String(f.findingType)} / ${String(f.status)}`);
    }
    for (const d of (content.formalDecisions as Record<string, unknown>[] | undefined) ?? []) {
      lines.push(`- 正式决定 ${String(d.decisionId)}：${String(d.action)} by ${String(d.actor)}`);
    }
  } else if (kind === 'customer_supplement') {
    for (const s of (content.supplements as Record<string, unknown>[] | undefined) ?? []) {
      lines.push(`- 待补充【${String(s.topic)}】：请提供 ${(s.neededDocuments as string[] | undefined)?.join('、') ?? '相关证明材料'}`);
    }
    for (const n of (content.handlingNotes as Record<string, unknown>[] | undefined) ?? []) {
      lines.push(`- 处理说明【${String(n.topic)}】：${String(n.status)}`);
    }
    if (lines.length === 3) lines.push('- 当前无待补充事项。');
    lines.push('');
    lines.push(String(content.note ?? ''));
  } else {
    lines.push(`- 申请：${String(content.frId ?? '')}（${String(content.productType ?? '')}，${String(content.amountMinor ?? 0)} 分 ${String(content.currency ?? '')}）`);
    lines.push(`- 状态：${String(content.status ?? '')}（外部出账：${String(content.externalState ?? '')}）`);
    const fac = content.facility as Record<string, unknown> | null | undefined;
    if (fac) {
      lines.push(`- 额度：${String(fac.facilityId)}（${String(fac.status)}，批准 ${String(fac.approvedAmountMinor)} 分）`);
    }
    lines.push(`- 交易要件：设备引用 ${String(content.equipmentRefCount ?? 0)} 项，合同引用 ${String(content.contractRefCount ?? 0)} 项`);
  }
  lines.push('');
  lines.push('> 本文档由结构化业务记录确定性生成；重新生成不改变任何业务状态。');
  return lines.join('\n');
}
