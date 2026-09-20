// 任务01·A2（审核 F02/F03/F06 修复）：可信规则回执通道。
// Gate 结论与四域分析只能以"获准服务身份的运行回执"进入 A：
//   规则版本激活（policy 人类）→ Gate 回执登记（service）→ 分析运行 start/finish（service，开始时 A 盖章输入摘要）。
// A 不重算任何规则语义；登记表为空 = 能力未启用（对应检查不激活，不编造政策值）。
import type { PoolClient } from 'pg';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import { newId } from './util.ts';
import type { Kernel } from './kernel.ts';
import { authenticate, authorizeCustomer, requireVerified } from './principal.ts';
import {
  reqString, reqObject, withCommandV2, requireHuman, requireDirectoryRole, requireCustomerScope,
  requireMatrixPermission, lockCustomer,
  type RequestFrame,
} from './v2kit.ts';
import { computeDomainDigest, DOMAINS } from './decision-support.ts';

export interface AnalysisApi {
  activateRulePack(frame: RequestFrame): Promise<Record<string, unknown>>;
  registerGateReceipt(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  startAnalysisRun(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  finishAnalysisRun(frame: RequestFrame, runId: string): Promise<Record<string, unknown>>;
  /** goal-01 G1：豁免登记（人类 + 矩阵动作 domain-exemption.grant；approved_by 从凭据解析）。 */
  registerDomainExemption(frame: RequestFrame, customerId: string): Promise<Record<string, unknown>>;
  revokeDomainExemption(frame: RequestFrame, exemptionId: string): Promise<Record<string, unknown>>;
  listDomainExemptions(credential: unknown, customerId: string): Promise<Record<string, unknown>>;
}

const GATE_RESULTS = ['CLEAR', 'NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW', 'HARD_BLOCK'] as const;
const RUN_TERMINAL = ['completed', 'failed', 'timeout', 'not_configured', 'input_invalid'] as const;

export function buildAnalysisCommands(kernel: Kernel): AnalysisApi {
  const cfgRef = () => kernel.configForV2();

  return {
    /** A2.7/K10：规则版本正式激活（同一时刻至多一个 active；换版=旧版 retired）。 */
    activateRulePack: (frame: RequestFrame) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'rulepack.activate', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'rulepack.activate');
        requireDirectoryRole(ctx, ['policy', 'admin'], 'rulepack.activate');
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const version = reqString(frame.version, 'version', 64);
        const cfg = cfgRef();
        await tx.query(`UPDATE rule_pack_versions SET status='retired' WHERE status='active'`);
        await tx.query(
          `INSERT INTO rule_pack_versions (version, status, activated_by, activated_at)
           VALUES ($1,'active',$2, now())
           ON CONFLICT (version) DO UPDATE SET status='active', activated_by=$2, activated_at=now()`,
          [version, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'rule_pack_activated', targetType: 'rule_pack_version', targetId: version,
          summary: `规则版本正式激活：${version}${cfg.requiredDomainsPolicyVersion === null ? '' : '（必需域政策 ' + cfg.requiredDomainsPolicyVersion + '）'}`,
          payload: { version },
        });
        await h.emit('RULE_PACK_ACTIVATED', null as unknown as string, { version, activatedBy: ctx.actor });
        return { ok: true, version, status: 'active' };
      });
    },

    /** A2.3/K05a：Gate 结论登记——仅 service 身份；rulesetVersion 必须是当前激活版本。 */
    registerGateReceipt: (frame: RequestFrame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'gate.register', tenantId, async (tx, h, ctx) => {
        if (ctx.kind !== 'service') {
          throw forbidden('PERMISSION_DENIED', 'Gate 回执只能由获准服务身份（kind=service）登记');
        }
        const customer = await lockCustomerRow(tx, customerId, tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const result = reqString(frame.result, 'result', 32);
        if (!(GATE_RESULTS as readonly string[]).includes(result)) {
          throw invalid(`result 必须 ${GATE_RESULTS.join('/')}`);
        }
        const rulesetVersion = reqString(frame.rulesetVersion, 'rulesetVersion', 64);
        const active = await tx.query(`SELECT version FROM rule_pack_versions WHERE status='active' LIMIT 1`);
        const activeVersion = (active.rows[0] as { version: string } | undefined)?.version ?? null;
        if (activeVersion === null || activeVersion !== rulesetVersion) {
          throw conflict('STALE_BASIS', `rulesetVersion ${rulesetVersion} 不是当前激活版本（${activeVersion ?? '无'}）：规则版本须先正式激活`);
        }
        const receiptId = newId('gr');
        const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        await tx.query(
          `INSERT INTO rule_gate_receipts
             (receipt_id, tenant_id, customer_id, result, ruleset_version, reason_codes, rule_ids, blocked_actions, evidence_refs, input_digest, evaluated_at, registered_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`,
          [receiptId, tenantId, customerId, result, rulesetVersion,
           JSON.stringify(strArr(frame.reasonCodes)), JSON.stringify(strArr(frame.ruleIds)),
           JSON.stringify(strArr(frame.blockedActions)), JSON.stringify(Array.isArray(frame.evidenceRefs) ? frame.evidenceRefs : []),
           frame.inputDigest === undefined || frame.inputDigest === null ? null : reqString(frame.inputDigest, 'inputDigest', 128),
           frame.evaluatedAt === undefined || frame.evaluatedAt === null ? null : reqString(frame.evaluatedAt, 'evaluatedAt', 64),
           ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'gate_receipt_registered', targetType: 'rule_gate_receipt', targetId: receiptId,
          summary: `Gate 回执 ${result}（规则 ${rulesetVersion}）`, payload: { result, rulesetVersion },
        });
        return { ok: true, receiptId, result, rulesetVersion };
      });
    },

    /** A2.6/K08：分析运行开始登记——A 按声明依赖对当前 DB 计算并盖章 input_digest。 */
    startAnalysisRun: (frame: RequestFrame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'analysis.start', tenantId, async (tx, h, ctx) => {
        if (ctx.kind !== 'service') {
          throw forbidden('PERMISSION_DENIED', '分析运行登记只能由获准服务身份（kind=service）执行');
        }
        const customer = await lockCustomerRow(tx, customerId, tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const domain = reqString(frame.domain, 'domain', 16);
        if (!(DOMAINS as readonly string[]).includes(domain)) throw invalid(`domain 必须 ${DOMAINS.join('/')}`);
        const deps = reqObject(frame.deps ?? {}, 'deps');
        const strArr = (v: unknown, label: string): string[] => {
          if (v === undefined || v === null) return [];
          if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s.length === 0)) throw invalid(`${label} 必须是非空 string 数组`);
          return v as string[];
        };
        const artifactIds = strArr(deps.artifactIds, 'deps.artifactIds');
        const factKeys = strArr(deps.factKeys, 'deps.factKeys');
        const rulePackVersion = reqString(deps.rulePackVersion, 'deps.rulePackVersion', 64);
        const active = await tx.query(`SELECT version FROM rule_pack_versions WHERE status='active' LIMIT 1`);
        const activeVersion = (active.rows[0] as { version: string } | undefined)?.version ?? null;
        if (activeVersion === null || activeVersion !== rulePackVersion) {
          throw conflict('STALE_BASIS', `运行规则版本 ${rulePackVersion} 不是当前激活版本（${activeVersion ?? '无'}）`);
        }
        // 盖章：执行开始所用输入的摘要（此后材料变化 → 登记/当前性判定按此摘要判 deps_changed）
        const inputDigest = await computeDomainDigest(tx, customerId, { artifactIds, factKeys, rulePackVersion });
        const runId = newId('run');
        await tx.query(
          `INSERT INTO analysis_runs (run_id, tenant_id, customer_id, domain, deps, input_digest, rule_version, provider_mode, status, started_by)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'running',$9)`,
          [runId, tenantId, customerId, domain,
           JSON.stringify({ artifactIds, factKeys, rulePackVersion, inputSnapshotId: frame.inputSnapshotId === undefined ? null : String(frame.inputSnapshotId) }),
           inputDigest, rulePackVersion,
           frame.providerMode === undefined ? 'simulation' : reqString(frame.providerMode, 'providerMode', 32),
           ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'analysis_run_started', targetType: 'analysis_run', targetId: runId,
          summary: `分析运行开始 ${domain}（规则 ${rulePackVersion}；输入摘要已盖章）`, payload: { domain, rulePackVersion },
        });
        return { ok: true, runId, inputDigest, status: 'running' };
      });
    },

    /** A2.6/K09：运行终态登记。非 completed 运行在域结果登记时被拒（ANALYSIS_RUN_NOT_COMPLETED）。 */
    finishAnalysisRun: (frame: RequestFrame, runId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'analysis.finish', tenantId, async (tx, h, ctx) => {
        if (ctx.kind !== 'service') {
          throw forbidden('PERMISSION_DENIED', '分析运行终态只能由获准服务身份（kind=service）登记');
        }
        const r0 = await tx.query(`SELECT tenant_id, customer_id FROM analysis_runs WHERE run_id=$1`, [runId]);
        if (r0.rows.length === 0) throw notFound('分析运行不存在');
        const owner = r0.rows[0] as { tenant_id: string; customer_id: string };
        if (owner.tenant_id !== tenantId) throw notFound('分析运行不存在');
        await requireCustomerScope(ctx, owner.customer_id, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const r1 = await tx.query(`SELECT * FROM analysis_runs WHERE run_id=$1 FOR UPDATE`, [runId]);
        const run = r1.rows[0] as Record<string, unknown>;
        if (String(run.status) !== 'running') {
          throw conflict('NOT_READY', `运行当前 ${run.status}：仅 running 可登记终态`);
        }
        const executionStatus = reqString(frame.executionStatus, 'executionStatus', 32);
        if (!(RUN_TERMINAL as readonly string[]).includes(executionStatus)) {
          throw invalid(`executionStatus 必须 ${RUN_TERMINAL.join('/')}`);
        }
        await tx.query(
          `UPDATE analysis_runs SET status=$2, completed_at=now(), completed_by=$3 WHERE run_id=$1`,
          [runId, executionStatus, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'analysis_run_finished', targetType: 'analysis_run', targetId: runId,
          summary: `分析运行终态 ${executionStatus}`, payload: { executionStatus },
        });
        return { ok: true, runId, status: executionStatus };
      });
    },

    /** goal-01 G1：登记必需域/政策豁免。批准人从凭据解析（approvedBy 载荷字段不存在）；
     *  权限=人类+矩阵动作 domain-exemption.grant（未配置 → POLICY_PENDING fail-closed）。 */
    registerDomainExemption: (frame: RequestFrame, customerId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'domain-exemption.grant', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'domain-exemption.grant');
        const customer = await lockCustomer(tx, customerId, tenantId);
        await requireCustomerScope(ctx, customerId, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        void customer;
        const domain = reqString(frame.domain, 'domain', 16);
        if (!(DOMAINS as readonly string[]).includes(domain)) throw invalid(`domain 必须 ${DOMAINS.join('/')}`);
        const scope = reqString(frame.scope ?? 'package', 'scope', 64);
        const reason = reqString(frame.reason, 'reason', 500);
        const cfg = cfgRef();
        if (cfg.requiredDomainsPolicyVersion === null) {
          throw conflict('POLICY_PENDING', '必需域政策未配置：豁免登记拒绝（fail-closed）');
        }
        // 权限矩阵：豁免是正式例外授予，必须有公司批准的条目（不是目录角色即可为）
        const perm = await requireMatrixPermission(tx, cfg, ctx, 'domain-exemption.grant', null);
        const validUntil = frame.validUntil === undefined || frame.validUntil === null
          ? null
          : reqString(frame.validUntil, 'validUntil', 32);
        if (validUntil !== null) {
          const t = new Date(validUntil).getTime();
          if (Number.isNaN(t)) throw invalid('validUntil 必须是可解析的时间戳');
          if (t <= Date.now()) throw invalid('validUntil 已是过去时间：不得登记即时过期的豁免');
        }
        const exemptionId = newId('exm');
        await tx.query(
          `INSERT INTO domain_exemptions
             (exemption_id, tenant_id, customer_id, domain, scope, reason, policy_version, approved_by, approved_by_roles, valid_until)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
          [exemptionId, tenantId, customerId, domain, scope, reason, cfg.requiredDomainsPolicyVersion,
           ctx.actor, JSON.stringify(ctx.roles), validUntil],
        );
        await h.audit({
          actor: ctx.actor, action: 'domain_exemption_granted', targetType: 'domain_exemption', targetId: exemptionId,
          summary: `豁免登记 ${domain}/${scope}（政策 ${cfg.requiredDomainsPolicyVersion}）`,
          payload: { domain, scope, permissionRef: perm.ref },
        });
        await h.emit('FORMAL_DECISION_RECORDED', customerId, {
          kind: 'domain_exemption_granted', exemptionId, domain, scope, approvedBy: ctx.actor,
          policyVersion: cfg.requiredDomainsPolicyVersion, validUntil,
        });
        return { ok: true, exemptionId, domain, scope, status: 'valid',
          policyVersion: cfg.requiredDomainsPolicyVersion, validUntil };
      });
    },

    /** goal-01 G1：撤销豁免（即刻生效；历史已冻结包不受影响——只阻断新引用）。 */
    revokeDomainExemption: (frame: RequestFrame, exemptionId: string) => {
      const tenantId = reqString(frame.tenantId, 'tenantId', 64);
      return withCommandV2(kernel, frame, 'domain-exemption.revoke', tenantId, async (tx, h, ctx) => {
        requireHuman(ctx, 'domain-exemption.revoke');
        const r0 = await tx.query(`SELECT tenant_id, customer_id, status FROM domain_exemptions WHERE exemption_id=$1`, [exemptionId]);
        if (r0.rows.length === 0) throw notFound('豁免登记不存在');
        const owner = r0.rows[0] as { tenant_id: string; customer_id: string; status: string };
        if (owner.tenant_id !== tenantId) throw notFound('豁免登记不存在');
        await requireCustomerScope(ctx, owner.customer_id, tx);
        const stored = await ctx.replayed(tx);
        if (stored !== null) return stored;
        const cfg = cfgRef();
        await requireMatrixPermission(tx, cfg, ctx, 'domain-exemption.grant', null);
        const r1 = await tx.query(`SELECT * FROM domain_exemptions WHERE exemption_id=$1 FOR UPDATE`, [exemptionId]);
        const row = r1.rows[0] as Record<string, unknown>;
        if (row.status !== 'valid') throw conflict('NOT_READY', `豁免当前 ${row.status}：仅 valid 可撤销`);
        await tx.query(
          `UPDATE domain_exemptions SET status='revoked', revoked_at=now(), revoked_by=$2 WHERE exemption_id=$1`,
          [exemptionId, ctx.actor],
        );
        await h.audit({
          actor: ctx.actor, action: 'domain_exemption_revoked', targetType: 'domain_exemption', targetId: exemptionId,
          summary: `豁免撤销（即刻生效；新引用被拒）`, payload: {},
        });
        await h.emit('FORMAL_DECISION_RECORDED', row.customer_id as string,
          { kind: 'domain_exemption_revoked', exemptionId, revokedBy: ctx.actor });
        return { ok: true, exemptionId, status: 'revoked' };
      });
    },

    listDomainExemptions: async (credential: unknown, customerId: string) => {
      const auth = await authenticate(kernel.verifierForV2(), credential);
      requireVerified(auth);
      await authorizeCustomer(auth.principal, customerId, kernel.pool);
      const res = await kernel.pool.query(
        `SELECT exemption_id AS "exemptionId", tenant_id AS "tenantId", customer_id AS "customerId", domain, scope,
                reason, policy_version AS "policyVersion", approved_by AS "approvedBy", approved_by_roles AS "approvedByRoles",
                valid_until AS "validUntil", status, revoked_at AS "revokedAt", revoked_by AS "revokedBy", created_at AS "createdAt"
         FROM domain_exemptions WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 200`, [customerId]);
      return { ok: true, exemptions: res.rows };
    },
  };
}

// ---------------------------------------------------------------------------
// goal-01 G1：豁免登记（不变量 2——豁免必须引用真实、有效且有权批准的记录）
// 批准人=服务端从凭据解析的 principal，载荷声明无效；消费端（依据包/差异处理）只收引用。
// ---------------------------------------------------------------------------

async function lockCustomerRow(tx: PoolClient, customerId: string, tenantId: string): Promise<Record<string, unknown>> {
  const r = await tx.query(`SELECT * FROM customers WHERE customer_id=$1 FOR UPDATE`, [customerId]);
  if (r.rows.length === 0) throw notFound('客户不存在');
  const row = r.rows[0] as Record<string, unknown>;
  if (row.tenant_id !== tenantId) throw notFound('客户不存在');
  return row;
}
