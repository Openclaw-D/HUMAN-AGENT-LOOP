// Lane W3｜四域 Desktop-first Dependency Network（只读网络总览 + 域切换 tablist）。
// 数据一律由 props.projection 现算：本文件内的小型纯 helper 与 workspace-contract.ts
// 的 selector 契约语义对齐，供 DomainWorkbench 复用；不 import workspace-model 实现。
// authority 边界：本组件只做展示与域切换，不持有 canonical state，不产生任何写命令。

import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { DOMAIN_LABELS } from '../workspace-contract.ts';
import type { WorkspaceActionsProps } from '../workspace-contract.ts';
import type {
  V4LifeActor,
  V4LifeActorRole,
  V4LifeCandidate,
  V4LifeDependency,
  V4LifeDomain,
  V4LifeGate,
  V4LifeProjection,
  V4LifeWorkItem,
} from '../../../lib/v4life/types.ts';
import styles from './domains.module.css';

// ---------------------------------------------------------------------------
// W3 内部共享小型 helper（只读纯函数；语义对齐契约 selectors，接口以契约为准）
// ---------------------------------------------------------------------------

/** 四域固定顺序：政策 → 信审 → 商务 → 资产（仅展示顺序，不构成线性进度）。 */
export const DOMAIN_ORDER: readonly V4LifeDomain[] = ['policy', 'credit', 'commerce', 'asset'];

export const ROLE_LABELS: Record<V4LifeActorRole, string> = {
  business: '业务',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
  system: '系统',
};

export const STATUS_ORDER: readonly V4LifeWorkItem['status'][] = [
  'blocked',
  'in_progress',
  'awaiting_gate',
  'completed',
  'stopped_dependency',
];

/** 状态文案 + 图形记号（不单靠颜色表达状态）。 */
export const STATUS_LABELS: Record<V4LifeWorkItem['status'], string> = {
  blocked: '受阻',
  in_progress: '进行中',
  awaiting_gate: '待Gate',
  completed: '已完成',
  stopped_dependency: '已停止',
};

export const STATUS_GLYPHS: Record<V4LifeWorkItem['status'], string> = {
  blocked: '□',
  in_progress: '▶',
  awaiting_gate: '◇',
  completed: '●',
  stopped_dependency: '×',
};

export const DEP_KIND_LABELS: Record<V4LifeDependency['kind'], string> = {
  evidence: 'Evidence',
  workitem: 'WorkItem',
  receipt: 'Receipt',
};

export const GATE_STATUS_LABELS: Record<V4LifeGate['status'], string> = {
  pending: '待开',
  open: '开放',
  decided: '已决',
};

export const GATE_STATUS_GLYPHS: Record<V4LifeGate['status'], string> = {
  pending: '□',
  open: '◆',
  decided: '●',
};

export const DECISION_OUTCOME_LABELS: Record<V4LifeDecisionOutcome, string> = {
  approved: '批准',
  rejected: '否决',
  returned: '退回补充',
};

export type V4LifeDecisionOutcome = 'approved' | 'rejected' | 'returned';

/** W3 两组件共享的域选择 props。 */
export interface DomainSelectionProps {
  selectedDomain: V4LifeDomain;
  onDomainSelect(domain: V4LifeDomain): void;
}

export function actorNameOf(projection: V4LifeProjection, actorId: string): string {
  return projection.actors.find((actor) => actor.actorId === actorId)?.displayName ?? actorId;
}

export function selectDomainActor(projection: V4LifeProjection, domain: V4LifeDomain): V4LifeActor | undefined {
  return projection.actors.find((actor) => actor.role === domain);
}

export function selectDomainItems(projection: V4LifeProjection, domain: V4LifeDomain): V4LifeWorkItem[] {
  return projection.domains.find((entry) => entry.domain === domain)?.workItems ?? [];
}

export function selectDomainGates(projection: V4LifeProjection, domain: V4LifeDomain): V4LifeGate[] {
  return projection.domains.find((entry) => entry.domain === domain)?.gates ?? [];
}

export function selectDomainCandidates(projection: V4LifeProjection, domain: V4LifeDomain): V4LifeCandidate[] {
  return projection.domains.find((entry) => entry.domain === domain)?.candidates ?? [];
}

export function selectAllWorkItems(projection: V4LifeProjection): V4LifeWorkItem[] {
  return projection.domains.flatMap((entry) => entry.workItems);
}

/** 依赖是否已满足：Evidence=已提交；WorkItem=已完成；Receipt=已批准（对齐引擎 dependencySatisfied）。 */
export function isDependencySatisfied(projection: V4LifeProjection, dep: V4LifeDependency): boolean {
  if (dep.kind === 'evidence') {
    return projection.evidence.some((evidence) => evidence.evidenceId === dep.id);
  }
  if (dep.kind === 'workitem') {
    return selectAllWorkItems(projection).some(
      (item) => item.workItemId === dep.id && item.status === 'completed',
    );
  }
  return projection.receipts.some(
    (receipt) => receipt.gateId === dep.id && receipt.decision.outcome === 'approved',
  );
}

/** 依赖来源域中文名：Receipt/WorkItem 按归属域；Evidence 类来自业务补件。 */
export function dependencySourceLabel(projection: V4LifeProjection, dep: V4LifeDependency): string {
  if (dep.kind === 'receipt') {
    for (const entry of projection.domains) {
      const gate = entry.gates.find((item) => item.gateId === dep.id);
      if (gate) return DOMAIN_LABELS[gate.domain];
    }
    return '上游';
  }
  if (dep.kind === 'workitem') {
    for (const entry of projection.domains) {
      const item = entry.workItems.find((work) => work.workItemId === dep.id);
      if (item) return DOMAIN_LABELS[item.domain];
    }
    return '上游';
  }
  return '业务';
}

/** blocked / awaiting_gate / completed / stopped_dependency 项的真实等待或不可操作原因（中文）。 */
export function waitingReasonOf(projection: V4LifeProjection, item: V4LifeWorkItem): string {
  switch (item.status) {
    case 'completed':
      return '已完成：工作产出与贡献已记录。';
    case 'stopped_dependency':
      return '已因上游 Gate 否决停止（原因：upstream_gate_rejected）；本项既有贡献与已完成工作全部保留。';
    case 'awaiting_gate':
      return item.gateId
        ? `工作产出已提交，等待 ${item.gateId} Gate 的具名角色人工决定。`
        : '工作产出已提交，等待 Gate 的人工决定。';
    case 'in_progress':
      return '进行中：可提交工作产出。';
    case 'blocked': {
      const unmet = item.dependencies.filter((dep) => !isDependencySatisfied(projection, dep));
      if (unmet.length === 0) return '依赖核验中，即将开始。';
      const reasons = unmet.map((dep) => {
        if (dep.kind === 'evidence') return `等待 Evidence「${dep.id}」（业务补件）`;
        if (dep.kind === 'workitem') return `等待 WorkItem ${dep.id} 完成`;
        return `等待 ${dep.id} Receipt`;
      });
      return `受阻：${reasons.join('；')}。`;
    }
  }
}

/** 动作可用性：仅由 Projection + selected actor 派生（W3 本地实现，语义同契约 canSubmitWork）。 */
export function canSubmitWorkLocal(
  projection: V4LifeProjection,
  actorId: string,
  item: V4LifeWorkItem,
): { allowed: boolean; reason: string } {
  const actor = projection.actors.find((entry) => entry.actorId === actorId);
  if (!actor) return { allowed: false, reason: '当前未选择有效演示身份。' };
  if (actor.role !== item.assignedRole) {
    const assigned = projection.actors.find((entry) => entry.role === item.assignedRole);
    return {
      allowed: false,
      reason: `当前演示身份为 ${actor.displayName}（${ROLE_LABELS[actor.role]}），该事项 assignedRole=${ROLE_LABELS[item.assignedRole]}（${assigned?.displayName ?? item.assignedRole}），角色不匹配不可提交。`,
    };
  }
  if (item.status !== 'in_progress') {
    return {
      allowed: false,
      reason: `事项状态为「${STATUS_LABELS[item.status]}」，不可提交：${waitingReasonOf(projection, item)}`,
    };
  }
  return { allowed: true, reason: '当前身份与 assignedRole 匹配，可提交工作产出。' };
}

/** 动作可用性：仅由 Projection + selected actor 派生（W3 本地实现，语义同契约 canDecide）。 */
export function canDecideLocal(
  projection: V4LifeProjection,
  actorId: string,
  gate: V4LifeGate,
): { allowed: boolean; reason: string } {
  const actor = projection.actors.find((entry) => entry.actorId === actorId);
  if (!actor) return { allowed: false, reason: '当前未选择有效演示身份。' };
  if (gate.status !== 'open') {
    return {
      allowed: false,
      reason:
        gate.status === 'pending'
          ? `Gate 尚未开启：待 ${gate.workItemId} 完成并提交工作产出后开启。`
          : 'Gate 已决定：Receipt 为不可变记录，不可重复决定。',
    };
  }
  if (actor.role !== gate.requiredRole) {
    return {
      allowed: false,
      reason: `该 Gate 仅限 ${ROLE_LABELS[gate.requiredRole]}（requiredRole）决定，当前演示身份为 ${actor.displayName}（${ROLE_LABELS[actor.role]}），后端会以 ROLE_MISMATCH 拒绝越权。`,
    };
  }
  return { allowed: true, reason: '当前身份与 requiredRole 匹配，可作出批准 / 退回 / 否决决定。' };
}

/** 确定性时间显示：不依赖本地时区/locale，避免 SSR 水合差异。 */
export function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export function StatusChip({ status }: { status: V4LifeWorkItem['status'] }) {
  return (
    <span className={styles.statusChip} data-status={status}>
      <span aria-hidden="true" className={styles.statusGlyph}>{STATUS_GLYPHS[status]}</span>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function GateStatusChip({ status }: { status: V4LifeGate['status'] }) {
  return (
    <span className={styles.statusChip} data-gate-chip={status}>
      <span aria-hidden="true" className={styles.statusGlyph}>{GATE_STATUS_GLYPHS[status]}</span>
      {GATE_STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 域网络节点现算（纯 selector，全部来自 canonical Projection）
// ---------------------------------------------------------------------------

export interface DomainNetworkNode {
  domain: V4LifeDomain;
  label: string;
  actor?: V4LifeActor;
  statusCounts: Record<V4LifeWorkItem['status'], number>;
  gateCounts: Record<V4LifeGate['status'], number>;
  openGate?: V4LifeGate;
  candidateCount: number;
  contributionCount: number;
  waitingReason: string;
  nextItem?: V4LifeWorkItem;
  upstreamDeps: ReadonlyArray<{ dep: V4LifeDependency; sourceLabel: string; satisfied: boolean }>;
}

export function computeDomainNodes(projection: V4LifeProjection): DomainNetworkNode[] {
  return DOMAIN_ORDER.map((domain) => {
    const items = selectDomainItems(projection, domain);
    const gates = selectDomainGates(projection, domain);
    const statusCounts: Record<V4LifeWorkItem['status'], number> = {
      blocked: 0,
      in_progress: 0,
      awaiting_gate: 0,
      completed: 0,
      stopped_dependency: 0,
    };
    for (const item of items) statusCounts[item.status] += 1;
    const gateCounts: Record<V4LifeGate['status'], number> = { pending: 0, open: 0, decided: 0 };
    for (const gate of gates) gateCounts[gate.status] += 1;

    const depIndex = new Map<string, { dep: V4LifeDependency; sourceLabel: string; satisfied: boolean }>();
    for (const item of items) {
      for (const dep of item.dependencies) {
        const key = `${dep.kind}:${dep.id}`;
        if (!depIndex.has(key)) {
          depIndex.set(key, {
            dep,
            sourceLabel: dependencySourceLabel(projection, dep),
            satisfied: isDependencySatisfied(projection, dep),
          });
        }
      }
    }

    const firstBlocked = items.find((item) => item.status === 'blocked');
    const firstAwaiting = items.find((item) => item.status === 'awaiting_gate');
    let waitingReason: string;
    if (firstBlocked) {
      waitingReason = waitingReasonOf(projection, firstBlocked);
    } else if (firstAwaiting) {
      waitingReason = waitingReasonOf(projection, firstAwaiting);
    } else if (statusCounts.stopped_dependency > 0) {
      waitingReason = '正式承接已因上游否决停止；既有贡献与已完成工作全部保留。';
    } else if (items.length > 0 && statusCounts.completed === items.length) {
      waitingReason = '本域事项均已完成。';
    } else {
      waitingReason = '当前无受阻或待决定事项。';
    }

    return {
      domain,
      label: DOMAIN_LABELS[domain],
      actor: selectDomainActor(projection, domain),
      statusCounts,
      gateCounts,
      openGate: gates.find((gate) => gate.status === 'open'),
      candidateCount: selectDomainCandidates(projection, domain).length,
      contributionCount: projection.contributions.filter((entry) => entry.domain === domain).length,
      waitingReason,
      nextItem: items.find((item) => item.status === 'in_progress'),
      upstreamDeps: [...depIndex.values()],
    };
  });
}

// ---------------------------------------------------------------------------
// DomainNetwork 组件
// ---------------------------------------------------------------------------

export function DomainNetwork(props: WorkspaceActionsProps & DomainSelectionProps) {
  const { projection, selectedDomain, onDomainSelect } = props;
  const nodes = computeDomainNodes(projection);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = DOMAIN_ORDER.indexOf(selectedDomain);
    let nextIndex: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % DOMAIN_ORDER.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + DOMAIN_ORDER.length) % DOMAIN_ORDER.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = DOMAIN_ORDER.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    onDomainSelect(DOMAIN_ORDER[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <section className={`${styles.tokens} ${styles.networkRoot}`} aria-label="四域依赖网络">
      <header className={styles.networkHeader}>
        <p className={styles.kicker}>Domain Network · 全域状态始终可见</p>
        <h2 className={styles.sectionTitle}>四域依赖网络</h2>
        <p className={styles.headerNote}>
          每个域当前能做什么、在等什么；依赖以 Evidence / WorkItem / Receipt 三类标签表达，
          ✓=已满足、○=未满足。点击任一域切换下方作业面，方向键可在域间移动。
        </p>
      </header>
      <div className={styles.networkGrid} role="tablist" aria-label="选择当前作业域" onKeyDown={handleTablistKeyDown}>
        {nodes.map((node, index) => {
          const selected = node.domain === selectedDomain;
          const statusSummary = STATUS_ORDER.map((status) => `${STATUS_LABELS[status]} ${node.statusCounts[status]}`).join('，');
          const tone =
            node.statusCounts.stopped_dependency > 0 ? 'stopped' : node.statusCounts.blocked > 0 || node.statusCounts.awaiting_gate > 0 ? 'warn' : 'calm';
          return (
            <button
              key={node.domain}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`domain-tab-${node.domain}`}
              aria-selected={selected}
              aria-controls="domain-workbench-panel"
              tabIndex={selected ? 0 : -1}
              className={styles.domainTab}
              data-selected={selected ? 'true' : 'false'}
              onClick={() => onDomainSelect(node.domain)}
              aria-label={`${node.label}域 · ${statusSummary} · Gate 待开 ${node.gateCounts.pending} 开放 ${node.gateCounts.open} 已决 ${node.gateCounts.decided}`}
            >
              <span className={styles.domainTabHead}>
                <span className={styles.domainName}>{node.label}域</span>
                <span className={styles.domainActor}>
                  {node.actor ? `具名 Actor：${node.actor.displayName} · ${ROLE_LABELS[node.actor.role]}` : '未配置具名 Actor'}
                </span>
              </span>
              <span className={styles.statusRow}>
                {STATUS_ORDER.map((status) => (
                  <span
                    key={status}
                    className={styles.statusChip}
                    data-status={status}
                    data-zero={node.statusCounts[status] === 0 ? 'true' : 'false'}
                  >
                    <span aria-hidden="true" className={styles.statusGlyph}>{STATUS_GLYPHS[status]}</span>
                    {STATUS_LABELS[status]} {node.statusCounts[status]}
                  </span>
                ))}
              </span>
              <span className={styles.metaRow}>
                <span className={styles.metaItem}>
                  Gate：
                  {(['pending', 'open', 'decided'] as const).map((gateStatus) => (
                    <span key={gateStatus} className={styles.gateChip} data-gate={gateStatus}>
                      <span aria-hidden="true">{GATE_STATUS_GLYPHS[gateStatus]}</span>
                      {GATE_STATUS_LABELS[gateStatus]} {node.gateCounts[gateStatus]}
                    </span>
                  ))}
                </span>
                <span className={styles.metaItem}>Candidate {node.candidateCount} 条（authority=none）</span>
                <span className={styles.metaItem}>贡献保留 {node.contributionCount} 条</span>
              </span>
              <span className={styles.waitReason} data-tone={tone}>等待：{node.waitingReason}</span>
              <span className={styles.nextItem}>
                {node.nextItem ? (
                  <>
                    可立即处理：<code className={styles.mono}>{node.nextItem.workItemId}</code> {node.nextItem.title}
                  </>
                ) : (
                  '无可立即处理事项：等待依赖满足或 Gate 决定。'
                )}
              </span>
              {node.upstreamDeps.length > 0 ? (
                <span className={styles.depRow}>
                  {node.upstreamDeps.map(({ dep, sourceLabel, satisfied }) => (
                    <span key={`${dep.kind}:${dep.id}`} className={styles.depTag} data-satisfied={satisfied ? 'yes' : 'no'}>
                      <span className={styles.depKind}>{DEP_KIND_LABELS[dep.kind]}</span>
                      <code className={styles.mono}>{dep.id}</code>
                      <span>← {sourceLabel}</span>
                      <span aria-hidden="true" className={styles.depState}>{satisfied ? '✓' : '○'}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
