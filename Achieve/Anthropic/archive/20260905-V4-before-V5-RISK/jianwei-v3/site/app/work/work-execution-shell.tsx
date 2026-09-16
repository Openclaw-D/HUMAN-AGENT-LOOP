import type { DemoWorkProjection } from './demo-work-projection';
import styles from './work-surface.module.css';

type WorkExecutionShellProps = {
  projection: DemoWorkProjection;
  caseFilter: string | null;
};

function CaseContextBar({ projection }: { projection: DemoWorkProjection }) {
  const metadata = [
    ['Case', projection.identity.caseId],
    ['Attempt', projection.identity.attemptId],
    ['Context', projection.identity.contextVersion],
    ['Policy', projection.humanGate.policyVersion],
    ['Owner', projection.handoff.owner],
    ['State', '信审已完成 · 商务待承接'],
  ] as const;

  return (
    <header className={styles.caseBar} aria-label="事项身份与上下文">
      <div className={styles.caseSummary}>
        <span className={styles.demoBadge}>合成 fixture · 只读</span>
        <strong>{projection.summary.title}</strong>
        <small>{projection.identity.businessMode} · {projection.identity.reviewPath}</small>
      </div>
      <dl className={styles.caseMetadata}>
        {metadata.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

function ProcessSpine({ projection }: { projection: DemoWorkProjection }) {
  return (
    <ol className={styles.processSpine} aria-label="事项流程">
      {projection.storyline.map((step, index) => (
        <li key={step.id} data-state={step.state}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <small>{step.label}</small>
            <strong>{step.title}</strong>
          </div>
        </li>
      ))}
    </ol>
  );
}

function EvidenceCards({ projection }: { projection: DemoWorkProjection }) {
  return (
    <section className={styles.materialRegion} aria-labelledby="materials-title">
      <header className={styles.regionHeader}>
        <div>
          <span>材料与证据</span>
          <h2 id="materials-title">当前审查材料</h2>
        </div>
        <small>{projection.evidence.length} 项 · 原材料关系保留</small>
      </header>
      <div className={styles.evidenceGrid}>
        {projection.evidence.map((item) => (
          <article key={item.id}>
            <div><strong>{item.title}</strong><span>{item.status}</span></div>
            <p>{item.detail}</p>
            <small>{item.source} · {item.id}</small>
          </article>
        ))}
      </div>
      <div className={styles.gapStrip}>
        {projection.gaps.map((gap) => (
          <p key={gap.label}><strong>{gap.label}</strong><span>{gap.status}</span>{gap.detail}</p>
        ))}
      </div>
    </section>
  );
}

function RuleAndTask({ projection }: { projection: DemoWorkProjection }) {
  return (
    <section className={styles.taskRegion} aria-labelledby="task-title">
      <div className={styles.ruleCard}>
        <header>
          <span>规则视图</span>
          <code>{projection.ruleException.ruleVersion}</code>
        </header>
        <h2>{projection.ruleException.title}</h2>
        <p>{projection.ruleException.reason}</p>
        <strong>确定性结果：{projection.ruleException.outcome}</strong>
      </div>

      <div className={styles.currentTask}>
        <div>
          <span>当前任务</span>
          <h2 id="task-title">核对商务承接条件</h2>
          <p>信审结果已经形成演示凭证；商务与资产仍需分别完成，起租保持未开始。</p>
        </div>
        <button type="button" disabled aria-disabled="true" title="合成只读 fixture 未接入正式动作">
          确认商务承接
        </button>
        <small>主动作仅为布局假设；真实动作将在后续 Human Gate / Receipt E2E 检查点接入。</small>
      </div>
    </section>
  );
}

function AuthorityChain({ projection }: { projection: DemoWorkProjection }) {
  return (
    <section className={styles.authorityRegion} aria-labelledby="authority-title">
      <header className={styles.regionHeader}>
        <div><span>信审深度案例</span><h2 id="authority-title">建议、人工决定、结果凭证与交接</h2></div>
        <small>Evidence ≠ Candidate ≠ Decision ≠ Receipt</small>
      </header>
      <div className={styles.authorityGrid}>
        <article className={styles.candidateCard}>
          <span>智能建议 · authority none</span>
          <h3>{projection.candidate.title}</h3>
          <p>{projection.candidate.rationale}</p>
          <small>{projection.candidate.boundary}</small>
        </article>
        <article>
          <span>具名 Human Gate</span>
          <h3>{projection.humanGate.actorName}</h3>
          <p>{projection.humanGate.confirmation}</p>
          <small>{projection.humanGate.roleLabel}</small>
        </article>
        <article className={styles.receiptCard}>
          <span>成功 · 结果凭证</span>
          <h3>{projection.receipt.result}</h3>
          <p>{projection.receipt.action}</p>
          <small>{projection.receipt.receiptId}</small>
        </article>
        <article>
          <span>后续承接</span>
          <h3>{projection.handoff.owner}</h3>
          <p>{projection.handoff.nextAction}</p>
          <small>{projection.handoff.guardrail}</small>
        </article>
      </div>
      <div className={styles.lifecycle} aria-label="融资阶段状态">
        <span data-state="done"><b>信审</b>{projection.lifecycle.credit}</span>
        <span data-state="current"><b>商务</b>{projection.lifecycle.commercial}</span>
        <span><b>资产</b>{projection.lifecycle.asset}</span>
        <span><b>起租</b>{projection.lifecycle.commencement}</span>
      </div>
    </section>
  );
}

function CollaborationPanel({ projection }: { projection: DemoWorkProjection }) {
  return (
    <aside className={styles.collaborationPanel} aria-labelledby="collaboration-title">
      <header>
        <div><span>协作上下文</span><h2 id="collaboration-title">事项对话</h2></div>
        <span className={styles.onlineStatus}>3 人在场</span>
      </header>
      <div className={styles.contextLock}>
        <strong>绑定 {projection.identity.contextVersion}</strong>
        <span>消息不能改变 Decision 或 Receipt</span>
      </div>
      <ol className={styles.thread} aria-label="演示协作记录">
        <li>
          <div><strong>周宁</strong><time>09:18</time></div>
          <p>回购安排补充说明已按本次审查要求补齐，原材料未覆盖。</p>
        </li>
        <li>
          <div><strong>规则助手</strong><time>09:21</time></div>
          <p>检测到附加条件超出适用范围。仅标记例外并转人工，不形成决定。</p>
          <small>Agent · authority none</small>
        </li>
        <li>
          <div><strong>周予安</strong><time>09:42</time></div>
          <p>信审确认已形成结果凭证。请商务核验条款与交付条件。</p>
        </li>
      </ol>
      <form className={styles.composer} aria-label="只读演示消息输入">
        <label htmlFor="work-message">协作消息</label>
        <textarea id="work-message" rows={3} disabled placeholder="只读 fixture 未接入消息 API" />
        <div>
          <span>输入与发送控件仅属于右侧协作面板</span>
          <button type="button" disabled aria-disabled="true">发送</button>
        </div>
      </form>
    </aside>
  );
}

function InspectionDrawers({ projection }: { projection: DemoWorkProjection }) {
  return (
    <section className={styles.drawerDock} aria-label="按需检查抽屉">
      <details className={styles.drawer}>
        <summary>证据详情 <span>{projection.evidence.length}</span></summary>
        <div className={styles.drawerPanel}>
          <p className={styles.drawerEyebrow}>Evidence detail</p>
          <h2>证据详情</h2>
          {projection.evidence.map((item) => (
            <article key={item.id}><strong>{item.title}</strong><p>{item.detail}</p><small>{item.source} · {item.id}</small></article>
          ))}
          <p className={styles.drawerHint}>再次激活抽屉标题即可关闭。</p>
        </div>
      </details>
      <details className={styles.drawer}>
        <summary>Context diff <span>0</span></summary>
        <div className={styles.drawerPanel}>
          <p className={styles.drawerEyebrow}>Context diff</p>
          <h2>上下文差异</h2>
          <div className={styles.noChange}>当前投影绑定 {projection.identity.contextVersion}；fixture 未提供前一版本，差异状态为未知。</div>
          <p className={styles.drawerHint}>未知不会被显示为“无变化”。</p>
        </div>
      </details>
      <details className={styles.drawer}>
        <summary>Receipt / audit <span>1</span></summary>
        <div className={styles.drawerPanel}>
          <p className={styles.drawerEyebrow}>Receipt / audit</p>
          <h2>{projection.receipt.receiptId}</h2>
          <dl className={styles.auditList}>
            <div><dt>Actor</dt><dd>{projection.humanGate.actorName}</dd></div>
            <div><dt>Policy</dt><dd>{projection.humanGate.policyVersion}</dd></div>
            <div><dt>Action</dt><dd>{projection.receipt.action}</dd></div>
            <div><dt>Result</dt><dd>{projection.receipt.result}</dd></div>
          </dl>
          <p className={styles.drawerHint}>{projection.receipt.notice}</p>
        </div>
      </details>
      <details className={`${styles.drawer} ${styles.dangerDrawer}`}>
        <summary>危险动作确认 <span>停用</span></summary>
        <div className={styles.drawerPanel}>
          <p className={styles.drawerEyebrow}>Authority confirmation</p>
          <h2>终局否决</h2>
          <p>该动作属于高权威终局确认，不能由模型、普通规则或本地前端状态产生。</p>
          <label><input type="checkbox" disabled /> 我已核对权限、Context 与影响范围</label>
          <button type="button" disabled aria-disabled="true">确认终局否决</button>
          <p className={styles.drawerHint}>合成只读 fixture 中始终停用，不产生 Decision 或 Receipt。</p>
        </div>
      </details>
    </section>
  );
}

export function WorkExecutionShell({ projection, caseFilter }: WorkExecutionShellProps) {
  return (
    <div className={styles.workspace}>
      <CaseContextBar projection={projection} />
      {caseFilter ? <p className={styles.filterNotice}>筛选已命中 <code>{caseFilter}</code>；数据仍来自本地合成只读 fixture。</p> : null}
      <div className={styles.executionGrid}>
        <section className={styles.workSurface} aria-labelledby="work-surface-title">
          <header className={styles.surfaceHeader}>
            <div>
              <span>Work Execution · 当前事项</span>
              <h1 id="work-surface-title">信审例外处理与后续承接</h1>
            </div>
            <p>{projection.projection.notice}</p>
          </header>
          <ProcessSpine projection={projection} />
          <div className={styles.surfaceCanvas}>
            <RuleAndTask projection={projection} />
            <EvidenceCards projection={projection} />
            <AuthorityChain projection={projection} />
          </div>
          <InspectionDrawers projection={projection} />
        </section>
        <CollaborationPanel projection={projection} />
      </div>
      <footer className={styles.stateLegend} aria-label="基础界面状态">
        {projection.safeStates.map((state) => <span key={state.label} title={state.detail}>{state.label}</span>)}
      </footer>
    </div>
  );
}
