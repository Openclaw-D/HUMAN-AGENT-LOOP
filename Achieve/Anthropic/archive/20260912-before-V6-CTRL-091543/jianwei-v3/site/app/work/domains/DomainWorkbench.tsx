// Lane W3｜当前选中域的 Desktop 作业面：WorkItem 列表 + 提交工作表单 + Human GatePanel
// + Candidate 列表 + Contribution 保留提示。
// authority 纪律（自查）：
//  - 提交工作仅在 selected actor role === assignedRole 且 item in_progress（canSubmitWork.allowed）时渲染表单；
//  - GatePanel 仅对 open Gate 且 requiredRole 与当前 selected actor 匹配时启用；
//  - approved / returned 必填理由；rejected 必填理由并二次确认（确认步列出将被停止的依赖项）；
//  - 无任何「自动通过」；视图状态只来自 props.projection / props.feedback，不持有 canonical 第二状态。
// 共享小型 helper 从 ./DomainNetwork 导入（语义对齐 workspace-contract.ts selectors）。

import { useState } from 'react';
import { DOMAIN_LABELS } from '../workspace-contract.ts';
import type { CommandFeedback, WorkspaceActionsProps } from '../workspace-contract.ts';
import type {
  V4LifeCandidate,
  V4LifeContribution,
  V4LifeDecision,
  V4LifeGate,
  V4LifeProjection,
  V4LifeWorkItem,
} from '../../../lib/v4life/types.ts';
import {
  actorNameOf,
  canDecideLocal,
  canSubmitWorkLocal,
  DECISION_OUTCOME_LABELS,
  DEP_KIND_LABELS,
  formatTimestamp,
  GateStatusChip,
  isDependencySatisfied,
  ROLE_LABELS,
  selectAllWorkItems,
  selectDomainActor,
  selectDomainCandidates,
  selectDomainGates,
  selectDomainItems,
  STATUS_LABELS,
  StatusChip,
  type DomainSelectionProps,
  type V4LifeDecisionOutcome,
} from './DomainNetwork';
import styles from './domains.module.css';

const CANDIDATE_KIND_LABELS: Record<V4LifeCandidate['kind'], string> = {
  contradiction: '矛盾点',
  missing_document: '缺失材料',
};

const CONTRIBUTION_KIND_LABELS: Record<V4LifeContribution['kind'], string> = {
  evidence_review: '证据核验',
  cross_check: '交叉核验',
  material_prep: '材料准备',
  risk_finding: '风险发现',
};

/** 若该 Gate 被否决，将被停止的尚未完成依赖项（preview 文案，真实结果以服务端为准）。 */
function previewStoppedItems(projection: V4LifeProjection, gate: V4LifeGate): V4LifeWorkItem[] {
  return selectAllWorkItems(projection).filter(
    (item) =>
      item.dependencies.some((dep) => dep.kind === 'receipt' && dep.id === gate.gateId) &&
      item.status !== 'completed' &&
      item.status !== 'stopped_dependency',
  );
}

function WorkItemCard(props: {
  projection: V4LifeProjection;
  item: V4LifeWorkItem;
  actorId: string;
  pending: boolean;
  outputDraft: string;
  onOutputDraftChange(workItemId: string, value: string): void;
  onSubmitWork(item: V4LifeWorkItem, summary: string): void;
}) {
  const { projection, item, actorId, pending, outputDraft } = props;
  const submitCheck = canSubmitWorkLocal(projection, actorId, item);
  const trimmed = outputDraft.trim();
  const gate = item.gateId
    ? selectDomainGates(projection, item.domain).find((entry) => entry.gateId === item.gateId)
    : undefined;
  return (
    <article className={styles.itemCard} data-status={item.status}>
      <header className={styles.itemHead}>
        <code className={styles.mono}>{item.workItemId}</code>
        <h4 className={styles.itemTitle}>{item.title}</h4>
        <StatusChip status={item.status} />
      </header>
      <p className={styles.itemDeps}>
        <span className={styles.depsLabel}>依赖：</span>
        {item.dependencies.map((dep) => {
          const satisfied = isDependencySatisfied(projection, dep);
          return (
            <span key={`${dep.kind}:${dep.id}`} className={styles.depTag} data-satisfied={satisfied ? 'yes' : 'no'}>
              <span className={styles.depKind}>{DEP_KIND_LABELS[dep.kind]}</span>
              <code className={styles.mono}>{dep.id}</code>
              <span aria-hidden="true" className={styles.depState}>{satisfied ? '✓' : '○'}</span>
            </span>
          );
        })}
        {item.dependencies.length === 0 ? <span>无外部依赖</span> : null}
      </p>
      {gate ? (
        <p className={styles.itemGateLine}>
          关联 Gate：<code className={styles.mono}>{gate.gateId}</code> {gate.title}（
          <GateStatusChip status={gate.status} /> · 决定角色：{ROLE_LABELS[gate.requiredRole]}）
        </p>
      ) : null}
      {item.outputSummary ? (
        <p className={styles.itemOutput}>
          已提交产出：{item.outputSummary}
          <span className={styles.outputMeta}>
            （{actorNameOf(projection, item.submittedBy ?? '')}
            {item.submittedAt ? ` · ${formatTimestamp(item.submittedAt)}` : ''}）
          </span>
        </p>
      ) : null}
      {submitCheck.allowed ? (
        <form
          className={styles.workForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length > 0 && !pending) props.onSubmitWork(item, trimmed);
          }}
        >
          <label className={styles.fieldLabel} htmlFor={`work-output-${item.workItemId}`}>
            工作产出摘要（必填）
          </label>
          <textarea
            id={`work-output-${item.workItemId}`}
            className={styles.textArea}
            rows={2}
            value={outputDraft}
            placeholder="简述本事项已完成的专业工作与结论"
            onChange={(event) => props.onOutputDraftChange(item.workItemId, event.target.value)}
          />
          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.button}
              data-variant="primary"
              disabled={pending || trimmed.length === 0}
            >
              {pending ? '提交中…' : '提交工作产出'}
            </button>
            <span className={styles.formHint}>
              {item.gateId
                ? `提交后事项进入待 Gate 状态并打开 ${item.gateId}，由 ${ROLE_LABELS[gate?.requiredRole ?? item.assignedRole]} 决定`
                : '提交后该事项直接完成，贡献被记录'}
            </span>
          </div>
        </form>
      ) : (
        <p className={styles.itemReason} data-tone={item.status === 'stopped_dependency' ? 'stopped' : 'muted'}>
          当前不可提交：{submitCheck.reason}
        </p>
      )}
    </article>
  );
}

function GatePanel(props: {
  projection: V4LifeProjection;
  actorId: string;
  gates: V4LifeGate[];
  gateReason: string;
  pendingGateId: string | null;
  confirmRejectGateId: string | null;
  onGateReasonChange(value: string): void;
  onConfirmRejectGate(gateId: string | null): void;
  onDecide(gate: V4LifeGate, outcome: V4LifeDecision['outcome'], reason: string): void;
}) {
  const { projection, actorId, gates, gateReason, pendingGateId, confirmRejectGateId } = props;
  if (gates.length === 0) {
    return (
      <section className={styles.panel} aria-labelledby="gate-panel-title">
        <header className={styles.panelHeader}>
          <h3 className={styles.panelTitle} id="gate-panel-title">Human Gate</h3>
        </header>
        <p className={styles.emptyLine}>本域当前没有 Human Gate。</p>
      </section>
    );
  }
  return (
    <section className={styles.panel} aria-labelledby="gate-panel-title">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle} id="gate-panel-title">Human Gate</h3>
        <span className={styles.panelMeta}>
          只有 open Gate 且匹配 requiredRole 的具名角色可决定；无自动通过
        </span>
      </header>
      <div className={styles.gateList}>
        {gates.map((gate) => {
          const decisionCheck = canDecideLocal(projection, actorId, gate);
          const receipt = projection.receipts.find((entry) => entry.gateId === gate.gateId);
          const trimmedReason = gateReason.trim();
          const pending = pendingGateId === gate.gateId;
          const confirming = confirmRejectGateId === gate.gateId;
          const stoppedPreview = previewStoppedItems(projection, gate);
          return (
            <article
              key={gate.gateId}
              className={styles.gateCard}
              data-status={gate.status}
              data-confirming={confirming ? 'true' : 'false'}
            >
              <header className={styles.gateHead}>
                <code className={styles.mono}>{gate.gateId}</code>
                <h4 className={styles.gateTitle}>{gate.title}</h4>
                <GateStatusChip status={gate.status} />
              </header>
              <p className={styles.itemGateLine}>
                决定角色：{ROLE_LABELS[gate.requiredRole]} · 关联事项：
                <code className={styles.mono}>{gate.workItemId}</code>
                {gate.openedAt ? ` · 开启于 ${formatTimestamp(gate.openedAt)}` : ''}
              </p>
              {gate.status === 'decided' && receipt ? (
                <p className={styles.receiptLine}>
                  {DECISION_OUTCOME_LABELS[receipt.decision.outcome]} · 决定人{' '}
                  {actorNameOf(projection, receipt.decision.actorId)} · 理由：{receipt.decision.reason} ·{' '}
                  <code className={styles.mono}>{receipt.receiptId}</code>
                  {receipt.decision.decidedAt ? ` · ${formatTimestamp(receipt.decision.decidedAt)}` : ''}
                </p>
              ) : null}
              {gate.status === 'decided' && !receipt ? (
                <p className={styles.receiptLine}>本轮决定为退回补充：未产生 Receipt，事项回到可继续状态。</p>
              ) : null}
              {gate.status === 'pending' ? (
                <p className={styles.itemReason} data-tone="muted">{decisionCheck.reason}</p>
              ) : null}
              {gate.status === 'open' && !decisionCheck.allowed ? (
                <p className={styles.itemReason} data-tone="muted">当前不可决定：{decisionCheck.reason}</p>
              ) : null}
              {gate.status === 'open' && decisionCheck.allowed ? (
                confirming ? (
                  <div className={styles.rejectConfirm} role="alert">
                    <p>
                      <strong>确认否决（终局动作）</strong>：否决 {gate.gateId} 将产生不可变 Receipt，
                      并停止以下尚未完成的依赖项：
                    </p>
                    <ul className={styles.rejectList}>
                      {stoppedPreview.length > 0 ? (
                        stoppedPreview.map((item) => (
                          <li key={item.workItemId}>
                            <code className={styles.mono}>{item.workItemId}</code> {item.title}（
                            {STATUS_LABELS[item.status]}）
                          </li>
                        ))
                      ) : (
                        <li>当前没有处于进行中的依赖项；否决仍为终局动作，不可撤销。</li>
                      )}
                    </ul>
                    <p className={styles.rejectNote}>
                      否决不清零既有贡献：已形成的 Evidence、Candidate、Contribution 与 Event 全部保留。
                    </p>
                    <div className={styles.formActions}>
                      <button
                        type="button"
                        className={styles.button}
                        data-variant="danger"
                        disabled={pending}
                        onClick={() => props.onDecide(gate, 'rejected', trimmedReason)}
                      >
                        {pending ? '提交中…' : `确认否决 ${gate.gateId}`}
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        data-variant="secondary"
                        disabled={pending}
                        onClick={() => props.onConfirmRejectGate(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.decisionForm}>
                    <label className={styles.fieldLabel} htmlFor={`gate-reason-${gate.gateId}`}>
                      决定理由（批准 / 退回 / 否决均为必填）
                    </label>
                    <textarea
                      id={`gate-reason-${gate.gateId}`}
                      className={styles.textArea}
                      rows={2}
                      value={gateReason}
                      placeholder="记录本次人工决定的依据"
                      onChange={(event) => props.onGateReasonChange(event.target.value)}
                    />
                    <div className={styles.decisionActions}>
                      <button
                        type="button"
                        className={styles.button}
                        data-variant="primary"
                        disabled={pending || trimmedReason.length === 0}
                        onClick={() => props.onDecide(gate, 'approved', trimmedReason)}
                      >
                        批准（产生 Receipt）
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        data-variant="secondary"
                        disabled={pending || trimmedReason.length === 0}
                        onClick={() => props.onDecide(gate, 'returned', trimmedReason)}
                      >
                        退回补充（不产生 Receipt）
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        data-variant="dangerOutline"
                        disabled={pending || trimmedReason.length === 0}
                        onClick={() => props.onConfirmRejectGate(gate.gateId)}
                      >
                        否决…
                      </button>
                    </div>
                    <p className={styles.formHint}>
                      批准产生 Receipt；退回不产生 Receipt、事项可继续；否决为终局动作，需二次确认并停止真实依赖项。
                    </p>
                  </div>
                )
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CandidatePanel(props: { candidates: V4LifeCandidate[] }) {
  const { candidates } = props;
  return (
    <section className={styles.panel} aria-labelledby="candidate-panel-title">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle} id="candidate-panel-title">Candidate（规则建议）</h3>
        <span className={styles.panelMeta}>authority=none · 不改变正式状态</span>
      </header>
      {candidates.length === 0 ? (
        <p className={styles.emptyLine}>本域当前没有 Candidate。</p>
      ) : (
        <ul className={styles.candidateList}>
          {candidates.map((candidate) => (
            <li key={candidate.candidateId} className={styles.candidateCard}>
              <header className={styles.candidateHead}>
                <span className={styles.candidateKind} data-kind={candidate.kind}>
                  {CANDIDATE_KIND_LABELS[candidate.kind]}
                </span>
                <span className={styles.authorityTag}>
                  {candidate.authority === 'none' ? 'authority=none' : `authority=${candidate.authority}`}
                </span>
              </header>
              <p className={styles.candidateSummary}>{candidate.summary}</p>
              <ul className={styles.basisList}>
                {candidate.basis.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
              <p className={styles.candidateMeta}>
                producedBy <code className={styles.mono}>{candidate.producedBy}</code> ·{' '}
                {formatTimestamp(candidate.createdAt)}
                {candidate.workItemId ? (
                  <>
                    {' '}· 关联 <code className={styles.mono}>{candidate.workItemId}</code>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContributionPanel(props: { projection: V4LifeProjection; contributions: V4LifeContribution[]; hasStoppedItems: boolean }) {
  const { projection, contributions, hasStoppedItems } = props;
  return (
    <section className={styles.panel} aria-labelledby="contribution-panel-title">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle} id="contribution-panel-title">贡献保留（Contribution）</h3>
        <span className={styles.panelMeta}>retainedAfterVeto · 否决不清零既有贡献</span>
      </header>
      <p className={styles.contributionNote} data-tone={hasStoppedItems ? 'stopped' : 'calm'}>
        {hasStoppedItems
          ? '本域存在因上游否决停止的事项：被停止的只是后续正式承接，已记录的贡献与已完成工作全部保留，人的既有工作价值不归零。'
          : '本域全部贡献均带 retainedAfterVeto 标记：即使后续出现否决，既有贡献也不会清零。'}
      </p>
      {contributions.length === 0 ? (
        <p className={styles.emptyLine}>本域当前没有已记录贡献。</p>
      ) : (
        <ul className={styles.contributionList}>
          {contributions.map((contribution) => (
            <li key={contribution.contributionId} className={styles.contributionCard}>
              <span className={styles.contributionSummary}>{contribution.summary}</span>
              <span className={styles.contributionMeta}>
                {CONTRIBUTION_KIND_LABELS[contribution.kind]} · {actorNameOf(projection, contribution.actorId)} ·{' '}
                {formatTimestamp(contribution.recordedAt)} · <code className={styles.mono}>{contribution.workItemId}</code>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DomainFeedback(props: { projection: V4LifeProjection; feedback: CommandFeedback }) {
  const { projection, feedback } = props;
  const statusLabel =
    feedback.status === 'accepted' ? '命令已接受' : feedback.status === 'replayed' ? '重复命令（幂等重放，未双写）' : '命令失败';
  return (
    <div className={styles.feedbackBar} data-status={feedback.status} role="status" aria-live="polite">
      <strong>{statusLabel}</strong>
      <span>{feedback.message}</span>
      {feedback.errorCode ? <code className={styles.mono}>{feedback.errorCode}</code> : null}
      {feedback.receipt ? (
        <span className={styles.receiptLine}>
          Receipt <code className={styles.mono}>{feedback.receipt.receiptId}</code> ·{' '}
          {DECISION_OUTCOME_LABELS[feedback.receipt.decision.outcome]} · 决定人{' '}
          {actorNameOf(projection, feedback.receipt.decision.actorId)}
          {feedback.receipt.decision.decidedAt ? ` · ${formatTimestamp(feedback.receipt.decision.decidedAt)}` : ''}
        </span>
      ) : null}
      {feedback.stoppedWorkItemIds && feedback.stoppedWorkItemIds.length > 0 ? (
        <span className={styles.stopLine}>
          因否决停止的依赖项：{feedback.stoppedWorkItemIds.join('、')}（既有贡献保留）
        </span>
      ) : null}
    </div>
  );
}

export function DomainWorkbench(props: WorkspaceActionsProps & DomainSelectionProps & { className?: string }) {
  const { projection, actorId, actions, feedback, selectedDomain, className } = props;
  const [outputDrafts, setOutputDrafts] = useState<Record<string, string>>({});
  const [pendingWorkItemId, setPendingWorkItemId] = useState<string | null>(null);
  const [gateReasonByDomain, setGateReasonByDomain] = useState<{ domain: string; text: string }>({
    domain: selectedDomain,
    text: '',
  });
  const gateReason = gateReasonByDomain.domain === selectedDomain ? gateReasonByDomain.text : '';
  const setGateReason = (text: string) => setGateReasonByDomain({ domain: selectedDomain, text });
  const [pendingGateId, setPendingGateId] = useState<string | null>(null);
  // 否决二次确认绑定「域 + Gate」：切换域时通过 domain 键派生失效，避免 effect 内 setState。
  const [confirmReject, setConfirmReject] = useState<{ domain: string; gateId: string | null }>({
    domain: selectedDomain,
    gateId: null,
  });
  const confirmRejectGateId = confirmReject.domain === selectedDomain ? confirmReject.gateId : null;
  const setConfirmRejectGateId = (gateId: string | null) =>
    setConfirmReject({ domain: selectedDomain, gateId });

  const actor = projection.actors.find((entry) => entry.actorId === actorId);
  const items = selectDomainItems(projection, selectedDomain);
  const gates = selectDomainGates(projection, selectedDomain);
  const candidates = selectDomainCandidates(projection, selectedDomain);
  const contributions = projection.contributions.filter((entry) => entry.domain === selectedDomain);
  const domainActor = selectDomainActor(projection, selectedDomain);
  const hasStoppedItems = items.some((item) => item.status === 'stopped_dependency');
  const label = DOMAIN_LABELS[selectedDomain];

  const handleSubmitWork = (item: V4LifeWorkItem, summary: string) => {
    if (pendingWorkItemId) return;
    setPendingWorkItemId(item.workItemId);
    void actions.submitWork(item.workItemId, summary).then((result) => {
      setPendingWorkItemId(null);
      if (result.status !== 'error') {
        setOutputDrafts((prev) => {
          const next = { ...prev };
          delete next[item.workItemId];
          return next;
        });
      }
    });
  };

  const executeDecision = (gate: V4LifeGate, outcome: V4LifeDecisionOutcome, reason: string) => {
    if (pendingGateId) return;
    setPendingGateId(gate.gateId);
    void actions.decide(gate.gateId, outcome, reason).then((result) => {
      setPendingGateId(null);
      if (result.status !== 'error') {
        setGateReason('');
        setConfirmRejectGateId(null);
      }
    });
  };

  return (
    <section
      id="domain-workbench-panel"
      role="tabpanel"
      aria-label={`${label}域作业面`}
      className={`${styles.tokens} ${styles.workbenchRoot}${className ? ` ${className}` : ''}`}
    >
      <header className={styles.workHeader}>
        <div className={styles.workHeading}>
          <p className={styles.kicker}>Domain Workbench · 当前选中域</p>
          <h2 className={styles.sectionTitle}>{label}域作业面</h2>
          <p className={styles.headerNote}>
            本域负责人：{domainActor ? `${domainActor.displayName}（${ROLE_LABELS[domainActor.role]}）` : '未配置'}。
            动作可用性由 Projection 与当前演示身份现算，越权操作由后端拒绝。
          </p>
        </div>
        <div className={styles.actorCard}>
          <span className={styles.actorMain}>{actor ? actor.displayName : '未选择演示身份'}</span>
          <span className={styles.actorSub}>
            {actor ? `角色：${ROLE_LABELS[actor.role]} · ` : ''}
            <code className={styles.mono}>{actorId}</code>
          </span>
          <span className={styles.demoNote}>演示身份切换，不代表生产认证</span>
        </div>
      </header>
      {actor && actor.role === 'business' ? (
        <p className={styles.viewerNote}>
          当前为业务演示身份：可查看全域状态与反馈，但不能提交四域工作产出，也不能决定任何 Human Gate。
        </p>
      ) : null}
      {feedback && (feedback.kind === 'work' || feedback.kind === 'decision') ? (
        <DomainFeedback projection={projection} feedback={feedback} />
      ) : null}
      <div className={styles.workMain}>
        <section className={styles.panel} aria-labelledby="workitem-panel-title">
          <header className={styles.panelHeader}>
            <h3 className={styles.panelTitle} id="workitem-panel-title">WorkItem（{items.length}）</h3>
            <span className={styles.panelMeta}>
              依赖分 Evidence / WorkItem / Receipt 三类；仅进行中且身份匹配可提交
            </span>
          </header>
          <div className={styles.itemList}>
            {items.map((item) => (
              <WorkItemCard
                key={item.workItemId}
                projection={projection}
                item={item}
                actorId={actorId}
                pending={pendingWorkItemId === item.workItemId}
                outputDraft={outputDrafts[item.workItemId] ?? ''}
                onOutputDraftChange={(workItemId, value) => {
                  setOutputDrafts((prev) => ({ ...prev, [workItemId]: value }));
                }}
                onSubmitWork={handleSubmitWork}
              />
            ))}
            {items.length === 0 ? <p className={styles.emptyLine}>本域当前没有 WorkItem。</p> : null}
          </div>
        </section>
        <GatePanel
          projection={projection}
          actorId={actorId}
          gates={gates}
          gateReason={gateReason}
          pendingGateId={pendingGateId}
          confirmRejectGateId={confirmRejectGateId}
          onGateReasonChange={setGateReason}
          onConfirmRejectGate={setConfirmRejectGateId}
          onDecide={executeDecision}
        />
      </div>
      <div className={styles.workSide}>
        <CandidatePanel candidates={candidates} />
        <ContributionPanel projection={projection} contributions={contributions} hasStoppedItems={hasStoppedItems} />
      </div>
    </section>
  );
}
