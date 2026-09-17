// F 轮 · 角色视角面板（下半"当前待办"页签内容）：当前所选角色的视角摘要、最值得验证的
// 问题（≤3）、任务（补证后状态联动更新）、候选倾向与控制条件、共享事实（含证据版本）。
// 见微额外显示全局缺口（跨域矛盾/缺证/未知，实时从运行态推导）。
// 倾向是模型/模拟候选，不是正式审批；见微不是上级或超级审批人。
// 任务三 C2：live 模式下追加"核验卡（真实后台）"与"额度与依据（真实后台）"两个块——
// 只消费 Edge workspace 投影；本地模拟块原样保留（两种来源并列、各自标注，不互相冒充）。
import type { CaseScenario, CaseState, RoleId } from './role-contract';
import { FACT_STATUS_LABEL, ROLE_LABEL } from './role-contract';
import { jianweiGaps } from './role-mock-adapter';
import type { EdgeLiveApi } from '../../lib/v5-preview/edge/use-edge-live';
import { EdgeCreditPanel, EdgeObjectLinks, EdgeVerifyCards } from './edge-panels';
import styles from './home-overview.module.css';

const TASK_STATUS_LABEL: Record<string, string> = {
  open: '待补证',
  updated: '已更新',
  done: '闭环',
};

const TENDENCY_LABEL: Record<string, string> = {
  做: '做',
  谨慎做: '谨慎做',
  '调整条件后做': '调整条件后做',
  不做: '不做',
  '不做（现状）': '不做（现状）',
};

export function HomeRoleView({
  scenario,
  state,
  roleId,
  edge,
}: {
  scenario: CaseScenario;
  state: CaseState;
  roleId: RoleId;
  edge?: EdgeLiveApi;
}) {
  const view = scenario.roleViews[roleId];
  const isJianwei = roleId === 'jianwei';
  const gaps = isJianwei ? jianweiGaps(scenario, state) : [];
  return (
    <div className={styles.roleViewPane} aria-label={`${ROLE_LABEL[roleId]}视角（演示视角）`}>
      <p className={styles.roleViewHead}>
        当前视角：<strong>{ROLE_LABEL[roleId]}</strong>（演示视角·非登录身份；与各角色共享同一项目事实）
      </p>
      <p className={styles.roleViewSummary}>{view.summary}</p>

      {isJianwei && gaps.length > 0 ? (
        <div className={styles.roleViewBlock} role="status">
          <h3 className={styles.roleViewTitle}>全局缺口（跨域）</h3>
          <ul className={styles.gapList}>
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.roleViewBlock}>
        <h3 className={styles.roleViewTitle}>本角色任务</h3>
        <ul className={styles.taskList}>
          {view.tasks.map((t) => {
            const status = state.taskStatus[t.id] ?? t.status;
            return (
              <li key={t.id} className={styles.taskItem} data-status={status}>
                <span className={styles.taskStatus} data-status={status}>{TASK_STATUS_LABEL[status] ?? status}</span>
                <span className={styles.taskTitle}>{t.title}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {view.questions.length > 0 ? (
        <div className={styles.roleViewBlock}>
          <h3 className={styles.roleViewTitle}>最值得验证（至多 3 问）</h3>
          <ol className={styles.questionList}>
            {view.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className={styles.roleViewBlock}>
        <h3 className={styles.roleViewTitle}>候选倾向（模型/模拟候选·非正式审批）</h3>
        <p className={styles.tendencyLine}>
          <span className={styles.tendencyChip} data-tendency={view.tendency}>{TENDENCY_LABEL[view.tendency] ?? view.tendency}</span>
          {view.conditions.length > 0 ? <span className={styles.tendencyCond}>条件：{view.conditions.join('；')}</span> : null}
        </p>
      </div>

      {edge ? <EdgeVerifyCards edge={edge} /> : null}
      {edge ? <EdgeCreditPanel edge={edge} /> : null}
      {edge ? <EdgeObjectLinks edge={edge} /> : null}

      <div className={styles.roleViewBlock}>
        <h3 className={styles.roleViewTitle}>共享项目事实（全角色一致·含证据版本）</h3>
        <ul className={styles.factList}>
          {state.facts.map((f) => (
            <li key={f.id} className={styles.factItem}>
              <span className={styles.factLabel}>{f.label}</span>
              <span className={styles.factValue}>
                {f.value}
                <em className={styles.factMeta}>
                  v{f.evidenceVersion} · {FACT_STATUS_LABEL[f.status]}
                </em>
              </span>
            </li>
          ))}
        </ul>
        {scenario.unknowns.length > 0 ? (
          <p className={styles.unknownLine}>未验证/未知：{scenario.unknowns.join('；')}</p>
        ) : null}
      </div>
    </div>
  );
}
