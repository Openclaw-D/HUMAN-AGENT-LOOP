// Case Chat（主 Agent 整合层，2026-09-04）
// 契约边界（ZCODE_OVERNIGHT_WORKSPACE_GOAL §6.10 / CONTROL Revision 0001 §5）：
// - 只解释当前状态、总结 Evidence、形成草案/Candidate/补件建议；不持有 canonical state；
//   不执行 Human Gate、不生成 Receipt；
// - 未接真实模型：明确显示「协同框架 / 未连接模型」，只呈现由真实 Projection 派生的状态摘要；
//   不预写对话、不显示假在线/假已读；输入框禁用并说明原因。

import React from 'react';

import { selectOpenGatesBrief, selectChatSummary } from './chat-derivation';
import type { V4LifeProjection, WorkActorId } from './workspace-contract';
import styles from './work-shell.module.css';

export function CaseChat({
  projection,
  actorId,
}: {
  projection: V4LifeProjection | null;
  actorId: WorkActorId;
}) {
  const summary = React.useMemo(
    () => (projection === null ? null : selectChatSummary(projection, actorId)),
    [projection, actorId],
  );
  const openGates = React.useMemo(
    () => (projection === null ? [] : selectOpenGatesBrief(projection)),
    [projection],
  );

  return (
    <section className={styles.chatPanel} aria-label="Case 协同框架">
      <div className={styles.chatHeader}>
        <h2 className={styles.chatTitle}>Case 协同</h2>
        <span className={styles.chatBadge}>协同框架 / 未连接模型</span>
      </div>

      {projection === null || summary === null ? (
        <p className={styles.chatNote}>等待 canonical Projection 加载后显示状态摘要。</p>
      ) : (
        <>
          <p className={styles.chatNote}>
            以下摘要由当前 Projection 实时派生；Chat 不持有正式状态、不审批、不产生 Receipt。
            正式动作请在左侧事项工作区完成并经服务端 API。
          </p>

          <h3 className={styles.chatSection}>当前等待</h3>
          {openGates.length === 0 ? (
            <p className={styles.chatLine}>暂无等待决定的 Human Gate。</p>
          ) : (
            <ul className={styles.chatList}>
              {openGates.map((gate) => (
                <li key={gate.gateId} className={styles.chatLine}>
                  <b>{gate.title}</b>（{gate.gateId}）· 必经角色：{gate.requiredRoleName}
                </li>
              ))}
            </ul>
          )}

          <h3 className={styles.chatSection}>给 {summary.actorName} 的状态要点</h3>
          <ul className={styles.chatList}>
            {summary.lines.map((line) => (
              <li key={line} className={styles.chatLine}>
                {line}
              </li>
            ))}
          </ul>

          <h3 className={styles.chatSection}>草案（框架占位）</h3>
          <p className={styles.chatNote}>
            模型未连接：草拟、解释与补件建议暂不可生成。上方的状态要点全部来自服务端真实数据，
            不包含任何预写回答。
          </p>
        </>
      )}

      <div className={styles.chatInputRow}>
        <input
          type="text"
          className={styles.chatInput}
          placeholder="协同框架 / 未连接模型，暂无法对话"
          disabled
          aria-label="Case 协同输入（未连接模型）"
        />
        <button type="button" className={styles.chatSend} disabled>
          发送
        </button>
      </div>
    </section>
  );
}
