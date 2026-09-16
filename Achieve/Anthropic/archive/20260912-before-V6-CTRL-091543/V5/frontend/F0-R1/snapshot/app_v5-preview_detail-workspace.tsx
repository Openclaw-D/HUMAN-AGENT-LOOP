"use client";

// V5 PREVIEW · 工作详情（共用骨架，按角色调整工作重点）。
// 完整演示一条合成信审—业务接续闭环：材料依据 → 编辑/保存本地草稿或提出模拟补充要求
// → 切业务视角查看要求并回应 → 信审接续 → 总览显示相应模拟状态。
// 其他三域保留可进入的轻量详情结构；不捏造完整专业制度、审批链或大型表单。
import { useState, type FormEvent } from 'react';
import styles from './preview.module.css';
import ChatPanel from './chat-panel';
import { DomainGlyph, stateChipClass } from './overview-mobile';
import {
  DOMAIN_NAMES, ROLE_LABELS, WORK_STATE_LABELS, deriveBusinessTodos, deriveCreditTodo, usePreview,
  type DomainKey,
} from './preview-state';

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

/** 其他三域的轻量示例内容（明确标注合成示例，不构成制度）。 */
const LIGHT_EXAMPLES: Record<DomainKey, string> = {
  policy: '灰区复议候选条件（合成示例）：收入口径需第三方佐证；复议材料清单待明确。不改变政策已有五色语义。',
  credit: '（信审走完整闭环演示，本表不使用。）',
  commerce: '前提条件草案（合成示例）：定价依据落实前，商务条件草案仅作准备；正式化依赖信审/政策的有效人工决定。',
  asset: '核对清单（合成示例）：采购合同、发票、权属登记、残值评估。设备采购凭证待补充。',
};

const LOOP_STEPS = [
  { key: 'credit-drafting', label: '① 信审提出要求' },
  { key: 'request-sent', label: '② 业务查看并回应' },
  { key: 'business-responded', label: '③ 信审接续草稿' },
  { key: 'credit-continued', label: '④ 总览状态同步' },
] as const;

export default function DetailWorkspace({ domain, onBack, chatDefaultOpen }: { domain: DomainKey | 'business'; onBack: () => void; chatDefaultOpen: boolean }) {
  const { state } = usePreview();
  const isBusiness = domain === 'business';
  const d = domain === 'business' ? null : state.domains[domain];

  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <button type="button" className={styles.backBtn} onClick={onBack}>← 返回总览</button>
        <span className={styles.detailTitle}>
          {isBusiness ? '业务协调工作台' : <><DomainGlyph domain={domain} /> {DOMAIN_NAMES[domain]}工作详情</>}
        </span>
        {d !== null ? (
          <em className={`${styles.stateChip} ${stateChipClass(d.status)}`}>{WORK_STATE_LABELS[d.status]}</em>
        ) : (
          <em className={`${styles.stateChip} ${styles.chipWorking}`}>协调视角</em>
        )}
        <span className={styles.detailRole}>当前视角：{ROLE_LABELS[state.role]}（预览切换，非身份认证）</span>
      </header>

      {domain === 'business' ? <BusinessWorkspace /> : <DomainWorkspace domain={domain} />}

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
  const canRespond = state.loop.stage === 'request-sent';

  function submitResponse(event: FormEvent) {
    event.preventDefault();
    if (!canRespond || response.trim() === '') return;
    dispatch({ type: 'send-business-response', text: response.trim() });
    setResponse('');
  }

  return (
    <div className={styles.detailBody}>
      <section className={styles.detailSection} aria-label="协调待办">
        <h3>协调待办（合成示例）</h3>
        <ul className={styles.todoList}>
          {todos.map((t) => (
            <li key={t.id} className={styles.todoItem}>
              <b>{t.title}</b>
              <em className={`${styles.stateChip} ${t.state === 'resolved' ? styles.chipReady : t.state === 'awaiting' ? styles.chipAwaiting : styles.chipWorking}`}>
                {t.state === 'resolved' ? '已接续' : WORK_STATE_LABELS[t.state]}
              </em>
              <p>{t.detail}</p>
            </li>
          ))}
        </ul>
        <p className={styles.hint}>业务是协调角色，不是第五风控域；正式决定仍由有权限的人完成。</p>
      </section>

      <section className={styles.detailSection} aria-label="回应信审">
        <h3>回应信审补充要求（模拟转交）</h3>
        {canRespond ? (
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
          <p className={styles.hint}>
            {state.loop.stage === 'credit-drafting'
              ? '信审尚未提出补充要求。可切换到信审视角，在信审详情中发起（合成闭环）。'
              : state.loop.stage === 'business-responded'
                ? '已回应，等待信审接续（模拟）。'
                : '闭环已完成：信审意见候选就绪（模拟），总览状态已同步。'}
          </p>
        )}
      </section>
    </div>
  );
}

function DomainWorkspace({ domain }: { domain: DomainKey }) {
  const { state, dispatch } = usePreview();
  const d = state.domains[domain];
  const todo = deriveCreditTodo(state);
  const [draft, setDraft] = useState('');
  const [lightDraft, setLightDraft] = useState('');
  const [request, setRequest] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isCredit = domain === 'credit';
  const stepIndex = LOOP_STEPS.findIndex((s) => s.key === state.loop.stage);
  const requestHint = state.loop.supplementRequest === null
    ? '尚未提出补充要求。'
    : `已提出：${state.loop.supplementRequest}${state.loop.stage === 'credit-drafting' ? '' : '（等待/已获业务回应，见待办卡）'}`;

  function saveDraft() {
    if (isCredit) {
      dispatch({ type: 'save-credit-draft', text: draft });
    }
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  }

  function sendRequest(event: FormEvent) {
    event.preventDefault();
    if (request.trim() === '') return;
    dispatch({ type: 'send-supplement-request', text: request.trim() });
    setRequest('');
  }

  return (
    <div className={styles.detailBody}>
      <section className={styles.detailSection} aria-label="材料依据">
        <MaterialSection domain={domain} />
      </section>

      {isCredit ? (
        <>
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

          <section className={styles.detailSection} aria-label="意见草稿">
            <h3>意见草稿（本地模拟保存）</h3>
            <label className={styles.fieldLabel}>
              信审意见草稿
              <textarea
                value={draft === '' && state.loop.creditDraft !== '' ? state.loop.creditDraft : draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                placeholder="示例：营收与合同金额口径矛盾，需按不含税口径复核（合成示例）"
              />
            </label>
            <div className={styles.btnRow}>
              <button type="button" className={styles.primaryBtn} onClick={saveDraft} disabled={draft.trim() === '' && state.loop.creditDraft === ''}>
                保存草稿（本地模拟）
              </button>
              {savedAt !== null ? <em className={styles.savedTag}>草稿已保存（本地模拟 · {savedAt}）</em> : null}
            </div>
          </section>

          <section className={styles.detailSection} aria-label="补充要求">
            <h3>向业务提出补充要求（模拟转交）</h3>
            {state.loop.stage === 'credit-drafting' ? (
              <form className={styles.inlineForm} onSubmit={sendRequest}>
                <label className={styles.fieldLabel}>
                  补充要求内容
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
              <p className={styles.hint}>{requestHint}</p>
            )}
          </section>

          <section className={styles.detailSection} aria-label="信审接续">
            <h3>接续（收到业务回应后）</h3>
            {state.loop.stage === 'business-responded' ? (
              <button type="button" className={styles.primaryBtn} onClick={() => dispatch({ type: 'continue-credit' })}>
                按业务回应接续更新意见草稿（模拟）
              </button>
            ) : (
              <p className={styles.hint}>
                {state.loop.stage === 'credit-continued'
                  ? '闭环完成：意见候选就绪（模拟）。总览中信审状态已同步为候选就绪。'
                  : '等待业务回应后可接续（模拟）。'}
              </p>
            )}
            <p className={styles.hint}>候选就绪不是正式完成；正式化只能由有权限的人完成，本预览禁用。</p>
          </section>
        </>
      ) : (
        <section className={styles.detailSection} aria-label="轻量工作示例">
          <h3>{DOMAIN_NAMES[domain]}·轻量详情结构（演示）</h3>
          <p className={styles.lightExample}>{LIGHT_EXAMPLES[domain]}</p>
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
          <p className={styles.hint}>本域为轻量结构演示：不捏造完整制度、审批链或大型表单；卡点：{d.blocker}</p>
        </section>
      )}
    </div>
  );
}
