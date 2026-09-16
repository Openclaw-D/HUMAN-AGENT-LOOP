"use client";

// V5 PREVIEW · 工作详情（F0-R1）：四域共用四阶段骨架（材料合规→模型校验→人工复核→正式通过）。
// 域摘要、格子、详情、待办由同一阶段对象派生；专业细项在各阶段卡内表达。
// 角色守卫：页面按当前视角限制本域动作；跨域可查看但不能代办（预览行为一致性，非生产认证）。
// 草稿单一编辑源：editing=null 回显已存值，'' 为有意清空，保存提交当前显示内容。
// 信审完整闭环：材料依据 → 编辑/保存本地草稿或提出模拟补充要求 → 业务视角回应 → 信审接续。
import { useState, type FormEvent } from 'react';
import styles from './preview.module.css';
import ChatPanel from './chat-panel';
import { DomainGlyph } from './overview-mobile';
import {
  DOMAIN_NAMES, ROLE_LABELS, STAGE_LABELS, STAGE_ORDER, WORK_STATE_LABELS,
  deriveBusinessTodos, deriveCreditTodo, deriveDomainStatus, resolveEditingValue, usePreview,
  type DomainKey, type StageId,
} from './preview-state';
import { stateChipClass } from './overview-mobile';

/** 合成材料引用（与 B0 合成示例一致；全部为合成数据，不指向真实制度或客户材料）。 */
interface Material { ref: string; name: string; summary: string }
const MATERIALS: Material[] = [
  { ref: 'ev-upstream-context', name: '上游项目背景', summary: '（合成）某四足机器人企业申请 500 万设备回租；上游商机/尽调仅作 Context。' },
  { ref: 'ev-financial-statement', name: '财务报表', summary: '（合成）营收下滑，需与合同金额口径互证。' },
  { ref: 'ev-contract-draft', name: '合同草案', summary: '（合成）合同金额 500 万元，回租结构待核。' },
  { ref: 'ev-asset-history-feedback', name: '资产历史反馈', summary: '（合成）租赁物历史使用与权属记录反馈。' },
];

/** 各域相关材料切片（演示差异化输入：不是每域相同材料）。 */
const RELEVANT: Record<DomainKey, string[]> = {
  policy: ['ev-upstream-context'],
  credit: ['ev-financial-statement', 'ev-contract-draft'],
  commerce: ['ev-contract-draft'],
  asset: ['ev-asset-history-feedback'],
};

const LOOP_STEPS = [
  { key: 'credit-drafting', label: '① 信审提出要求' },
  { key: 'request-sent', label: '② 业务查看并回应' },
  { key: 'business-responded', label: '③ 信审接续' },
  { key: 'credit-continued', label: '④ 总览状态同步' },
] as const;

export default function DetailWorkspace({ domain, stage, onBack, chatDefaultOpen }: { domain: DomainKey | 'business'; stage?: StageId; onBack: () => void; chatDefaultOpen: boolean }) {
  const { state } = usePreview();
  const d = domain === 'business' ? null : state.domains[domain];

  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <button type="button" className={styles.backBtn} onClick={onBack}>← 返回总览</button>
        <span className={styles.detailTitle}>
          {domain === 'business'
            ? '业务协调工作台'
            : <><DomainGlyph domain={domain} /> {DOMAIN_NAMES[domain]}工作详情</>}
        </span>
        {d !== null ? (
          <em className={`${styles.stateChip} ${stateChipClass(deriveDomainStatus(d))}`}>{WORK_STATE_LABELS[deriveDomainStatus(d)]}</em>
        ) : (
          <em className={`${styles.stateChip} ${styles.chipWorking}`}>协调视角</em>
        )}
        <span className={styles.detailRole}>当前视角：{ROLE_LABELS[state.role]}（预览切换，非身份认证）</span>
      </header>

      {domain === 'business'
        ? <BusinessWorkspace />
        : <DomainWorkspace domain={domain} highlightStage={stage} />}

      <section className={styles.detailChat}>
        <ChatPanel defaultOpen={chatDefaultOpen} />
      </section>
    </div>
  );
}

function MaterialSection({ domain }: { domain: DomainKey }) {
  const relevant = new Set(RELEVANT[domain]);
  const ordered = [...MATERIALS].sort((a, b) => Number(relevant.has(b.ref)) - Number(relevant.has(a.ref)));
  return (
    <section className={styles.detailSection} aria-label="材料依据">
      <h3>材料依据（合成示例；靠前为该域相关切片）</h3>
      <ul className={styles.materialList}>
        {ordered.map((m) => (
          <li key={m.ref} className={relevant.has(m.ref) ? styles.materialRelevant : styles.materialItem}>
            <details>
              <summary>
                <code>{m.ref}</code> {m.name}
                {relevant.has(m.ref) ? <em className={styles.relevantTag}>本域相关</em> : null}
              </summary>
              <p>{m.summary}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BusinessWorkspace() {
  const { state, dispatch } = usePreview();
  const todos = deriveBusinessTodos(state);
  const [response, setResponse] = useState('');
  const canRespond = state.role === 'business' && state.loop.stage === 'request-sent';

  function submitResponse(event: FormEvent) {
    event.preventDefault();
    if (!canRespond || response.trim() === '') return;
    dispatch({ type: 'send-business-response', text: response.trim() });
    setResponse('');
  }

  return (
    <div className={styles.detailBody}>
      <section className={styles.detailSection} aria-label="协调待办">
        <h3>协调待办（由四域阶段状态派生 · 合成示例）</h3>
        <ul className={styles.todoList}>
          {todos.map((t) => (
            <li key={t.id} className={styles.todoItem}>
              <b>{t.title}</b>
              <em className={`${styles.stateChip} ${t.state === 'resolved' ? styles.chipDone : stateChipClass(t.state)}`}>
                {t.state === 'resolved' ? '已接续' : WORK_STATE_LABELS[t.state]}
              </em>
              <p>{t.detail}</p>
            </li>
          ))}
        </ul>
        <p className={styles.hint}>业务是协调角色，不是第五风控域；业务的完成指整个项目主体结束（判定未冻结），正式决定仍由有权限的人完成。</p>
      </section>

      <section className={styles.detailSection} aria-label="回应信审">
        <h3>回应信审补充要求（模拟转交）</h3>
        {state.loop.stage === 'request-sent' ? (
          state.role === 'business' ? (
            <form className={styles.inlineForm} onSubmit={submitResponse}>
              <label className={styles.fieldLabel}>
                定价依据说明
                <textarea
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  rows={3}
                  placeholder="示例：定价按不含税口径复核（合成示例）"
                />
              </label>
              <button type="submit" className={styles.primaryBtn} disabled={response.trim() === ''}>
                提交回应（模拟转交信审）
              </button>
            </form>
          ) : (
            <p className={styles.hint}>信审已提出补充要求；当前视角为{ROLE_LABELS[state.role]}——切换到业务视角可回应（预览角色约束，跨域可查看不可代办）。</p>
          )
        ) : (
          <p className={styles.hint}>
            {state.loop.stage === 'credit-drafting'
              ? '信审尚未提出补充要求。可切换到信审视角，在信审详情中发起（合成闭环）。'
              : state.loop.stage === 'business-responded'
                ? '已回应，等待信审接续（模拟）。'
                : '闭环已完成：信审人工复核候选就绪（模拟），总览状态已同步；正式通过仍禁用。'}
          </p>
        )}
      </section>
    </div>
  );
}

function DomainWorkspace({ domain, highlightStage }: { domain: DomainKey; highlightStage?: StageId }) {
  const { state, dispatch } = usePreview();
  const d = state.domains[domain];
  const todo = deriveCreditTodo(state);
  const [draftEditing, setDraftEditing] = useState<string | null>(null);
  const [lightDraft, setLightDraft] = useState('');
  const [request, setRequest] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isCredit = domain === 'credit';
  const canActCredit = state.role === 'credit';
  const shownDraft = resolveEditingValue(draftEditing, state.loop.creditDraft);
  const stepIndex = LOOP_STEPS.findIndex((s) => s.key === state.loop.stage);

  function saveDraft() {
    if (!isCredit || !canActCredit) return;
    dispatch({ type: 'save-credit-draft', text: shownDraft });
    setDraftEditing(null);
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  }

  function sendRequest(event: FormEvent) {
    event.preventDefault();
    if (!canActCredit || request.trim() === '') return;
    dispatch({ type: 'send-supplement-request', text: request.trim() });
    setRequest('');
  }

  return (
    <div className={styles.detailBody}>
      <section className={styles.detailSection} aria-label="材料依据">
        <MaterialSection domain={domain} />
      </section>

      {isCredit ? (
        <section className={styles.detailSection} aria-label="信审待办与闭环进度">
          <h3>信审待办（合成闭环演示）</h3>
          <ol className={styles.loopSteps}>
            {LOOP_STEPS.map((s, i) => (
              <li key={s.key} className={i <= stepIndex ? styles.loopStepDone : styles.loopStep}>{s.label}</li>
            ))}
          </ol>
          <div className={styles.todoCard}>
            <b>{todo.title}</b>
            <em className={`${styles.stateChip} ${stateChipClass(todo.state)}`}>{WORK_STATE_LABELS[todo.state]}</em>
            <p>{todo.detail}</p>
          </div>
        </section>
      ) : null}

      {/* 四阶段卡片：与总览格子/域摘要同一阶段对象派生 */}
      <section className={styles.detailSection} aria-label={`${DOMAIN_NAMES[domain]}四阶段`}>
        <h3>{DOMAIN_NAMES[domain]}·四阶段（共同 stageId；专业细项在此表达）</h3>
        <div className={styles.stageCards}>
          {STAGE_ORDER.map((id) => (
            <div key={id} className={`${styles.stageCard} ${highlightStage === id ? styles.stageHighlight : ''}`}>
              <div className={styles.stageCardHead}>
                <b>{STAGE_LABELS[id]}</b>
                <em className={`${styles.stateChip} ${stateChipClass(d.stages[id].state)}`}>{WORK_STATE_LABELS[d.stages[id].state]}</em>
                {highlightStage === id ? <em className={styles.relevantTag}>自总览定位</em> : null}
              </div>
              <p className={styles.stageNote}>{d.stages[id].note}</p>

              {isCredit && id === 'material' ? (
                <div className={styles.stageActions}>
                  {state.loop.stage === 'credit-drafting' ? (
                    canActCredit ? (
                      <form className={styles.inlineForm} onSubmit={sendRequest}>
                        <label className={styles.fieldLabel}>
                          向业务提出补充要求（模拟转交）
                          <textarea
                            value={request}
                            onChange={(e) => setRequest(e.target.value)}
                            rows={2}
                            placeholder="示例：请提供定价依据（不含税口径）（合成示例）"
                          />
                        </label>
                        <button type="submit" className={styles.primaryBtn} disabled={request.trim() === ''}>
                          提出（模拟转交业务）
                        </button>
                      </form>
                    ) : (
                      <p className={styles.hint}>当前视角为{ROLE_LABELS[state.role]}——切换到信审视角可发起补充要求（预览角色约束）。</p>
                    )
                  ) : (
                    <p className={styles.hint}>
                      {state.loop.supplementRequest !== null ? `已提出：${state.loop.supplementRequest}（等待/已获业务回应，见待办与阶段卡）` : null}
                    </p>
                  )}
                  {state.loop.stage === 'business-responded' ? (
                    canActCredit ? (
                      <button type="button" className={styles.primaryBtn} onClick={() => dispatch({ type: 'continue-credit' })}>
                        按业务回应接续（推进模型校验与人工复核 · 模拟）
                      </button>
                    ) : (
                      <p className={styles.hint}>业务已回应；当前视角为{ROLE_LABELS[state.role]}——切换到信审视角可接续（预览角色约束）。</p>
                    )
                  ) : null}
                </div>
              ) : null}

              {isCredit && id === 'model' ? (
                <p className={styles.hint}>模型校验由 Agent 完成基础逻辑；校验完成仍可含问题，不能替代人工复核，更不能自动正式通过。</p>
              ) : null}
              {isCredit && id === 'review' ? (
                <p className={styles.hint}>候选就绪不是正式完成；正式化只能由有权限的人完成。</p>
              ) : null}
              {id === 'formal' ? (
                <div className={styles.stageActions}>
                  <button type="button" className={styles.formalBtn} disabled title={state.formalNotice ?? '正式审批待权限及对象约定——预览禁用，不产生 Decision/Receipt。'}>
                    正式通过
                  </button>
                  <p className={styles.hint}>正式通过禁用：待权限及对象约定；不产生 Decision/Receipt（合成只读情景表达）。</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.detailSection} aria-label="意见草稿">
        <h3>意见草稿（本地模拟保存；单一编辑源）</h3>
        {isCredit ? (
          <>
            <label className={styles.fieldLabel}>
              信审意见草稿
              <textarea
                value={shownDraft}
                onChange={(e) => setDraftEditing(e.target.value)}
                rows={4}
                placeholder="示例：营收与合同金额口径矛盾，需按不含税口径复核（合成示例）"
              />
            </label>
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={saveDraft}
                disabled={!canActCredit || (shownDraft.trim() === '' && state.loop.creditDraft === '')}
              >
                保存草稿（本地模拟）
              </button>
              {savedAt !== null ? <em className={styles.savedTag}>草稿已保存（本地模拟 · {savedAt}）</em> : null}
            </div>
            {!canActCredit ? <p className={styles.hint}>当前视角为{ROLE_LABELS[state.role]}——切换到信审视角可编辑/保存（预览角色约束）。</p> : null}
          </>
        ) : (
          <>
            <label className={styles.fieldLabel}>
              {DOMAIN_NAMES[domain]}意见草稿（本地模拟）
              <textarea value={lightDraft} onChange={(e) => setLightDraft(e.target.value)} rows={3} placeholder="草稿仅存于本页内存（合成预览）" />
            </label>
            <div className={styles.btnRow}>
              <button type="button" className={styles.primaryBtn} onClick={() => setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))} disabled={lightDraft.trim() === ''}>
                保存草稿（本地模拟）
              </button>
              {savedAt !== null ? <em className={styles.savedTag}>草稿已保存（本地模拟 · {savedAt}）</em> : null}
            </div>
            <p className={styles.hint}>轻量结构演示：不捏造完整制度、审批链或大型表单。</p>
          </>
        )}
      </section>
    </div>
  );
}
