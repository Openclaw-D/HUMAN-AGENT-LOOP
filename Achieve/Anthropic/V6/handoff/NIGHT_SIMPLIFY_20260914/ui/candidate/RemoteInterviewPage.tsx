"use client";

// 任务B 候选 · 远程尽调页（NIGHT_SIMPLIFY_20260914/ui/candidate）
// 与现行 remote-session/page.tsx 的差异（供 A 审查）：
// 1) 视频/模拟画面为页内常驻主体（原"语音→全屏"三步链路移除；全屏仅保留放大）；
// 2) 新增四域风险提示侧栏（桌面右栏 / 手机手风琴），数据经 props；
// 3) 未确认请求恢复条与反馈行各只有一处渲染（原 empty/ready 双实现合并）；
// 4) 内部技术参数（env 名/provider/session 切片/预算）不在业务面出现，业务按钮 title 只留业务话术；
// 5) 相机面板经 cameraSlot 注入（A 塞现有 CameraPanel 即可），候选不复制相机逻辑；
// 6) 全部数据经 props、写操作经回调：无 fetch、无 RequestRegistry、无 sessionStorage。
// 底线沿用：模拟/未接入如实标注；模型 authority=none；正式人审不跳过。
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  RemoteInterviewProps,
  RivDomain,
  RivEvidence,
} from './remote-interview.types';
import styles from './remote-interview.module.css';

// ---- 细线图标（视觉规范同 se-icons：24 viewBox / 1.8 描边；本文件内联，不新增 site 导出） ----

function iconBase(size: number | undefined, className: string | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className,
  };
}

function ArrowLeftIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
}
function ChevronRightIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></svg>;
}
function CheckIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
}
function ClockIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
}
function CrossIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><path d="m6.5 6.5 11 11m0-11-11 11" /></svg>;
}
function MagnifierIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
}
function WarnIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><path d="M12 4 21 19.5H3L12 4Z" /><path d="M12 10v4.5" /><path d="M12 17.2v.1" /></svg>;
}
function CameraLineIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><path d="M8.5 7 10 4.5h4L15.5 7" /><rect x="3.5" y="7" width="17" height="12.5" rx="2" /><circle cx="12" cy="13.2" r="3.2" /></svg>;
}
function MicLineIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><rect x="9.5" y="3.5" width="5" height="10" rx="2.5" /><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5" /></svg>;
}
function ChatLineIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7Z" /></svg>;
}

// ---- 小组件（同一文件内，均为纯呈现） ----

function StateBadge({ state, children }: { state: 'ok' | 'warn' | 'bad' | 'idle' | 'live' | 'paused'; children: ReactNode }) {
  return (
    <span className={styles.rivBadge} data-state={state}>
      {state === 'ok' ? <CheckIcon size={12} /> : state === 'warn' ? <WarnIcon size={12} /> : state === 'bad' ? <CrossIcon size={12} /> : state === 'live' ? <span className={styles.rivDot} aria-hidden="true" /> : state === 'paused' ? <WarnIcon size={12} /> : <ClockIcon size={12} />}
      {children}
    </span>
  );
}

/** 未确认请求恢复条（唯一渲染点；empty/ready 共用）。 */
function PendingBar({ pending, busy, onRetry, onDiscard }: {
  pending: RemoteInterviewProps['pendingRequests'];
  busy: boolean;
  onRetry?: (requestId: string) => void;
  onDiscard?: (requestId: string) => void;
}) {
  if (pending.length === 0) return null;
  return (
    <div className={styles.rivStatusStrip}>
      {pending.map((u) => (
        <div key={u.requestId} className={styles.rivPendingRow} role="status">
          <span>有一条请求结果未知（{u.op}，发送于 {u.savedAtLabel}）。</span>
          <button type="button" className={styles.rivBtnSmall} disabled={busy} onClick={() => onRetry?.(u.requestId)}>原样重试</button>
          <button type="button" className={styles.rivBtnSmall} disabled={busy} onClick={() => onDiscard?.(u.requestId)}>放弃</button>
        </div>
      ))}
    </div>
  );
}

/** 现场画面区：模拟/未接入两种诚实态 + 当前问题浮层 + 控制条。 */
function StageView(props: RemoteInterviewProps & { fullscreen: boolean; onSetFullscreen: (v: boolean) => void }) {
  const {
    simulationOn, onSimulateToggle, currentQuestion, paused, fullscreen, onSetFullscreen,
    onToggleVoiceNote, voiceNote, viewMode = 'business',
  } = props;
  return (
    <section className={styles.rivStageWrap} aria-label="现场画面（模拟演示）">
      <div className={styles.rivStage} data-sim={simulationOn ? 'on' : 'off'}>
        <div className={styles.rivStageTop}>
          <StateBadge state={paused ? 'paused' : 'live'}>{paused ? '已暂停' : '访谈中'}</StateBadge>
          <span className={styles.rivSimTag} data-sim={simulationOn ? 'on' : 'off'}>
            {simulationOn ? '模拟会议视图 · 非真实画面' : '视频未接入 · 合成演示（不申请摄像头/麦克风）'}
          </span>
        </div>
        <div className={styles.rivStageAvatar} aria-hidden="true">
          {simulationOn ? '实控人（合成头像位）' : '实控人画面位'}
        </div>
        {currentQuestion !== null ? (
          <div className={styles.rivStageQuestion}>
            <p className={styles.rivStageQuestionText}>
              <span className={styles.rivStageQuestionLabel}>当前关键问题</span>
              {currentQuestion.question}
            </p>
            {viewMode !== 'customer' ? (
              <p className={styles.rivStageBasis}>{currentQuestion.basis}</p>
            ) : null}
            {viewMode !== 'customer' && currentQuestion.risk !== '' ? (
              <p className={styles.rivStageRisk}>{currentQuestion.risk}</p>
            ) : null}
          </div>
        ) : (
          <p className={styles.rivStageQuestion}>当前待办：补充设备清单，请实控人现场说明设备现状。</p>
        )}
      </div>
      <div className={styles.rivStageControls}>
        <label className={styles.rivToggle}>
          <input
            type="checkbox"
            checked={simulationOn}
            onChange={(e) => onSimulateToggle?.(e.target.checked)}
          />
          模拟画面
        </label>
        <button type="button" className={styles.rivBtnSmall} onClick={() => onSetFullscreen(!fullscreen)} aria-expanded={fullscreen}>
          {fullscreen ? '退出放大' : '放大画面'}
        </button>
        <button type="button" className={styles.rivBtnSmall} onClick={onToggleVoiceNote} aria-expanded={voiceNote !== null}>
          <MicLineIcon size={13} />
          语音说明（未接入）
        </button>
      </div>
      {voiceNote !== null ? (
        <p className={styles.rivNote} role="status">{voiceNote}</p>
      ) : null}
    </section>
  );
}

/** 四域风险提示：桌面右栏（全展开）/ 手机一行收起头 + 展开列表（避免挤压画面主区）。 */
function DomainTips({ domains }: { domains: RivDomain[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [colOpen, setColOpen] = useState(false); // 手机默认收起；桌面由 CSS 强制展开
  const totalTips = domains.reduce((n, d) => n + d.tips.length, 0);
  return (
    <aside className={styles.rivDomainCol} aria-label="四域风险提示（合成演示）" data-open={colOpen ? 'true' : 'false'}>
      <div className={styles.rivDomainHeader}>
        <p className={styles.rivSecKicker}>四域风险提示</p>
        <button
          type="button"
          className={styles.rivDomainToggle}
          aria-expanded={colOpen}
          onClick={() => setColOpen((v) => !v)}
        >
          {colOpen ? '收起' : `${totalTips} 条`}
        </button>
      </div>
      <div className={styles.rivDomainList}>
        {domains.map((d) => {
          const empty = d.tips.length === 0;
          const head = (
            <>
              <span className={styles.rivDomainName} data-state={d.state ?? 'pending'}>
                {d.state === 'done' ? <CheckIcon size={12} /> : d.state === 'current' ? <span className={styles.rivDot} aria-hidden="true" /> : null}
                {d.label}
              </span>
              <span className={styles.rivDomainCount}>{empty ? '暂无提示' : `${d.tips.length} 条`}</span>
            </>
          );
          const items = (
            <ul className={styles.rivDomainTips}>
              {empty ? <li className={styles.rivNote}>该域暂无与本次尽调相关的提示。</li> : d.tips.map((t) => (
                <li key={t.id} className={styles.rivDomainTip} data-level={t.level}>{t.text}</li>
              ))}
            </ul>
          );
          // 同一 DOM 双端复用：手机由 CSS 收缩（.rivDomainHead[aria-expanded='false'] + 列表隐藏），
          // 桌面媒体查询强制展开显示全部条目。
          return (
            <div key={d.domainId} className={styles.rivDomainItem}>
              <button
                type="button"
                className={styles.rivDomainHead}
                aria-expanded={openId === d.domainId}
                onClick={() => setOpenId((v) => (v === d.domainId ? null : d.domainId))}
              >
                {head}
                <ChevronRightIcon size={13} className={styles.rivChevron} />
              </button>
              {items}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function evidenceBadge(e: RivEvidence) {
  if (e.expired) return <StateBadge state="bad">已过期</StateBadge>;
  if (e.verificationStatus === 'human_verified') return <StateBadge state="ok">已核实</StateBadge>;
  if (e.verificationStatus === 'contested') return <StateBadge state="warn">有争议</StateBadge>;
  return <StateBadge state="idle">未核实</StateBadge>;
}

function replyKindLabel(kind: string): string {
  if (kind === 'model_real') return '模型辅助（真实）';
  if (kind === 'model_simulation') return '模型（模拟）';
  if (kind === 'business') return '业务';
  if (kind === 'domain') return '专业域';
  return kind;
}

/** 记录层：证据与拍照 / 历史问答与转写，两个折叠区（沿用 details 交互，去 tabs 复杂度）。 */
function RecordSections(props: RemoteInterviewProps) {
  const {
    evidence, questions, transcript, cameraSlot, busy, paused,
    onAttachEvidence, onSelectEvidence, onAnalyzeQuestion, onSimulateFollowups,
    modelAnalysisAvailable, modelAnalysisReason,
  } = props;
  return (
    <>
      <details className={styles.rivDetails}>
        <summary>
          <MagnifierIcon size={15} className={styles.rivSummaryLead} />
          <span className={styles.rivSummaryTxt}>证据（{evidence.length}）与本地拍照</span>
          <ChevronRightIcon size={15} className={styles.rivChevron} />
        </summary>
        <div className={styles.rivDetailsBody}>
          <div className={styles.rivBtnRow}>
            <button type="button" className={styles.rivBtnSmall} disabled={busy} onClick={() => onAttachEvidence?.('fixture-inspection')}>附着现场巡检（合成）</button>
            <button type="button" className={styles.rivBtnSmall} disabled={busy} onClick={() => onAttachEvidence?.('fixture-equipment')}>附着设备清单（合成）</button>
          </div>
          <ul className={styles.rivEvidenceList}>
            {evidence.map((e) => (
              <li key={e.evidenceId} className={styles.rivEvidenceItem}>
                <button type="button" className={styles.rivEvidenceBtn} onClick={() => onSelectEvidence?.(e.evidenceId)}>{e.title}</button>
                {evidenceBadge(e)}
              </li>
            ))}
            {evidence.length === 0 ? <li className={styles.rivNote}>尚无证据。</li> : null}
          </ul>
          {cameraSlot ?? (
            <p className={styles.rivNote}>本地拍照入口由集成方注入（现有相机面板可原位复用；模拟演示场景不打开摄像头）。</p>
          )}
        </div>
      </details>

      <details className={styles.rivDetails}>
        <summary>
          <ChatLineIcon size={15} className={styles.rivSummaryLead} />
          <span className={styles.rivSummaryTxt}>历史问答（{questions.length}）与转写（{transcript.length}）</span>
          <ChevronRightIcon size={15} className={styles.rivChevron} />
        </summary>
        <div className={styles.rivDetailsBody}>
          <ul className={styles.rivQuestionList}>
            {questions.map((q) => (
              <li key={q.annotationId} className={styles.rivQuestionItem} data-expired={q.expired ? 'yes' : 'no'}>
                <p className={styles.rivQuestionText}>【证据 v{q.evidenceVersion}{q.expired ? ' · 证据已过期' : ''}】{q.question}</p>
                {q.replies.map((r) => (
                  <p key={r.replyId} className={styles.rivReply} data-kind={r.kind}>
                    <span className={styles.rivReplyKind}>{replyKindLabel(r.kind)}</span>
                    <span>{r.text}</span>
                  </p>
                ))}
                <div className={styles.rivBtnRow}>
                  <button
                    type="button"
                    className={styles.rivBtnSmall}
                    disabled={busy || paused || !modelAnalysisAvailable}
                    title={modelAnalysisAvailable ? '真实模型信审辅助分析（结果仅疑点线索，须人工复核）' : (modelAnalysisReason ?? '真实模型通道未启用：可用后开放')}
                    onClick={() => onAnalyzeQuestion?.(q.annotationId)}
                  >
                    {modelAnalysisAvailable ? '模型辅助分析（真实）' : '模型辅助分析（未启用）'}
                  </button>
                  <button
                    type="button"
                    className={styles.rivBtnSmall}
                    disabled={busy || paused}
                    title={paused ? '本轮判断已暂停：模型推进被服务端阻断' : '生成模拟追问（SIMULATION，非真实模型）'}
                    onClick={() => onSimulateFollowups?.(q.annotationId)}
                  >
                    模拟追问（SIMULATION）
                  </button>
                </div>
              </li>
            ))}
            {questions.length === 0 ? <li className={styles.rivNote}>暂无历史问答。</li> : null}
          </ul>
          {transcript.length > 0 ? (
            <ul className={styles.rivTranscriptList} aria-label="转写记录（合成事件）">
              {transcript.slice().reverse().map((t, i) => (
                <li key={`${t.at}-${i}`} className={styles.rivTranscriptItem}>
                  <time className={styles.rivTranscriptTime}>{t.at}</time>
                  <span className={styles.rivTranscriptWho}>{t.who}</span>
                  <span className={styles.rivTranscriptText}>{t.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </>
  );
}

/** 内部交流：半开（最近 3 条 + 输入行）；完整历史在"历史问答"折叠区（去重：不再有第二套聊天）。 */
function InternalChat(props: RemoteInterviewProps & { draft: string; onDraftChange: (v: string) => void }) {
  const { internalMessages, onSendInternalMessage, busy, draft, onDraftChange } = props;
  const recent = internalMessages.slice(-3);
  return (
    <section className={styles.rivChat} aria-label="内部交流（业务与四域，合成演示）">
      <p className={styles.rivSecKicker}>内部交流 · 业务与四域共同跟进（客户不可见）</p>
      <ul className={styles.rivChatList}>
        {recent.map((m) => (
          <li key={m.id} className={styles.rivChatItem}>
            <span className={styles.rivChatWho}>{m.who}</span>
            <span className={styles.rivChatKind}>{m.kindLabel}</span>
            <span className={styles.rivChatText}>{m.text}</span>
            <time className={styles.rivChatTime}>{m.at}</time>
          </li>
        ))}
        {recent.length === 0 ? <li className={styles.rivNote}>暂无内部交流记录。</li> : null}
      </ul>
      <form
        className={styles.rivChatForm}
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text === '' || busy) return;
          onSendInternalMessage?.(text);
          onDraftChange('');
        }}
      >
        <label className={styles.rivSrOnly} htmlFor="riv-chat-input">发送内部交流（合成演示）</label>
        <input
          id="riv-chat-input"
          className={styles.rivChatInput}
          value={draft}
          maxLength={2000}
          placeholder="向四域同事留言（内部可见，客户不可见）…"
          onChange={(e) => onDraftChange(e.target.value)}
        />
        <button type="submit" className={styles.rivBtnSmall} disabled={busy || draft.trim() === ''}>发送</button>
      </form>
    </section>
  );
}

export default function RemoteInterviewPage(props: RemoteInterviewProps) {
  const {
    title, backHref, phase, loadError,
    viewMode = 'business',
    projectId, live, paused, currentQuestion, openQuestionCount,
    domains, evidence, questions, reviews, pendingRequests, transcript, internalMessages,
    humanPendingCount, simulationOn, modelAnalysisAvailable, modelAnalysisReason,
    busy, notice, actionError, voiceNote, cameraSlot,
    onRetryLoad, onCreateSession, onSubmitRecord, onPauseRound, onResumeRound, onEscalateHuman,
    onAskQuestion, onAttachEvidence, onSelectEvidence, onSimulateToggle, onToggleVoiceNote,
    onAnalyzeQuestion, onSimulateFollowups, onSendInternalMessage, onRetryPending, onDiscardPending,
  } = props;
  const customer = viewMode === 'customer';

  const [fullscreen, setFullscreen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [askDraft, setAskDraft] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fields, setFields] = useState({ deviceCount: '', quote: '' });

  // ---- 非ready四态骨架（顶部返回 + 状态徽章，路径不变） ----
  if (phase !== 'ready') {
    return (
      <div className={styles.rivRoot}>
        <header className={styles.rivTop}>
          <Link className={styles.rivTopBack} href={backHref} aria-label="返回项目总览"><ArrowLeftIcon size={18} /></Link>
          <b className={styles.rivTopTitle}>{title}</b>
          <StateBadge state={phase === 'error' ? 'bad' : phase === 'empty' ? 'idle' : 'idle'}>
            {phase === 'error' ? '加载失败' : phase === 'empty' ? '未开始' : '加载中'}
          </StateBadge>
        </header>
        <PendingBar pending={pendingRequests} busy={busy} onRetry={onRetryPending} onDiscard={onDiscardPending} />
        <div className={styles.rivScroll}>
          <section className={styles.rivPanel}>
            {phase === 'error' ? (
              <section role="alert" className={styles.rivSection}>
                <p className={styles.rivQ}>加载失败：{loadError ?? '未知错误'}</p>
                <div className={styles.rivBtnRow}>
                  <button type="button" className={styles.rivPrimary} onClick={onRetryLoad}>重试</button>
                </div>
              </section>
            ) : phase === 'empty' ? (
              <section className={styles.rivSection}>
                <p className={styles.rivQ}>尚无访谈会话</p>
                <p className={styles.rivNote}>创建后：业务与实控人围绕关键问题访谈；证据用显著标记的合成图形；视频/语音未接入会如实显示。</p>
                <div className={styles.rivBtnRow}>
                  <button type="button" className={styles.rivPrimary} disabled={busy} onClick={onCreateSession}>开始访谈会话</button>
                </div>
              </section>
            ) : (
              <section role="status" className={styles.rivSection}>
                <p className={styles.rivQ}>正在加载访谈会话（合成演示）…</p>
              </section>
            )}
          </section>
        </div>
      </div>
    );
  }

  const canSubmit = currentQuestion !== null && answer.trim() !== '';

  return (
    <div className={styles.rivRoot} data-view={viewMode}>
      <header className={styles.rivTop}>
        <Link className={styles.rivTopBack} href={backHref} aria-label="返回项目总览（状态与草稿保留）"><ArrowLeftIcon size={18} /></Link>
        <StateBadge state={paused ? 'paused' : 'live'}>{paused ? '已暂停' : '进行中'}</StateBadge>
        <b className={styles.rivTopTitle}>{title}{projectId ? ` · ${projectId}` : ''}</b>
        {customer ? (
          <StateBadge state="idle">客户视图 · 展示切换 · 非生产权限隔离</StateBadge>
        ) : humanPendingCount > 0 ? (
          <StateBadge state="warn">人工待处理 {humanPendingCount}</StateBadge>
        ) : null}
      </header>

      <PendingBar pending={customer ? [] : pendingRequests} busy={busy} onRetry={onRetryPending} onDiscard={onDiscardPending} />

      <div className={styles.rivMain}>
        {/* 左主列：画面 → 记录折叠 → 内部交流；右栏：四域提示（桌面）。客户视图仅保留画面/问题/转写。 */}
        <div className={styles.rivScroll}>
          <div className={styles.rivPanel}>
            <StageView {...props} fullscreen={fullscreen} onSetFullscreen={setFullscreen} />

            {/* 人工待处理区（唯一渲染点；客户视图不出现） */}
            {!customer && reviews.length > 0 ? (
              <section className={styles.rivSection} aria-label="人工待处理与复核留痕">
                <p className={styles.rivSecKicker}>
                  人工待处理 · 复核留痕（模型无审批权，正式人审不跳过）
                </p>
                <ul className={styles.rivReviewList}>
                  {reviews.slice(-4).reverse().map((r) => (
                    <li key={r.reviewId} className={styles.rivReviewItem}>
                      <b>{r.label}</b> · 针对 v{r.targetVersion} · {r.opinion}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {!customer ? <RecordSections {...props} /> : null}

            {/* 客户视图仅保留转写回看（与实控人共同可见的访谈内容） */}
            {customer ? (
              <details className={styles.rivDetails}>
                <summary>
                  <ChatLineIcon size={15} className={styles.rivSummaryLead} />
                  <span className={styles.rivSummaryTxt}>访谈转写回看（{transcript.length}）</span>
                  <ChevronRightIcon size={15} className={styles.rivChevron} />
                </summary>
                <div className={styles.rivDetailsBody}>
                  <ul className={styles.rivTranscriptList} aria-label="转写记录（合成事件）">
                    {transcript.length === 0 ? <li className={styles.rivNote}>暂无转写事件。</li> : transcript.slice().reverse().map((t, i) => (
                      <li key={`${t.at}-${i}`} className={styles.rivTranscriptItem}>
                        <time className={styles.rivTranscriptTime}>{t.at}</time>
                        <span className={styles.rivTranscriptWho}>{t.who}</span>
                        <span className={styles.rivTranscriptText}>{t.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : (
              <InternalChat {...props} draft={chatDraft} onDraftChange={setChatDraft} />
            )}

            <p className={styles.rivFooter}>合成演示 · 不执行正式审批 · 视频/语音未接入如实显示 · 模型输出仅为模拟（authority=none）</p>
          </div>
        </div>

        {!customer ? <DomainTips domains={domains} /> : null}
      </div>

      {/* 操作坞：常驻底部（≥44px）；反馈行唯一渲染点 */}
      <div className={styles.rivDock}>
        {customer ? (
          // 客户视图：无任何业务写操作，仅如实说明当前等待点。
          <p className={styles.rivNote} role="status">
            {currentQuestion !== null
              ? '请实控人围绕当前问题现场说明；业务人员正在记录（合成演示，无真实录制）。'
              : '当前无待回答问题；等待业务发起（合成演示）。'}
          </p>
        ) : currentQuestion !== null ? (
          <>
            <label className={styles.rivFieldLabel} htmlFor="riv-answer">访谈记录（转写草稿 · 文字输入）</label>
            <textarea
              id="riv-answer"
              className={styles.rivTextarea}
              value={answer}
              rows={2}
              maxLength={2000}
              placeholder="记录实控人现场说明要点（合成演示）…"
              onChange={(e) => setAnswer(e.target.value)}
            />
            {/* 关键字段核对 = 低频人工纠正，默认折叠为一行（避免常驻占据手机首屏近半）。 */}
            <button
              type="button"
              className={styles.rivFieldsToggle}
              aria-expanded={fieldsOpen}
              onClick={() => setFieldsOpen((v) => !v)}
            >
              关键字段核对（人工纠正 · 可选）
              <ChevronRightIcon size={13} className={styles.rivChevron} />
            </button>
            {fieldsOpen ? (
              <div className={styles.rivFields}>
                <label className={styles.rivField}>
                  设备数量（台）
                  <input className={styles.rivInput} inputMode="numeric" value={fields.deviceCount} placeholder="待口述确认"
                    onChange={(e) => setFields((p) => ({ ...p, deviceCount: e.target.value }))} />
                </label>
                <label className={styles.rivField}>
                  报价（万元）
                  <input className={styles.rivInput} inputMode="decimal" value={fields.quote} placeholder="待口述确认"
                    onChange={(e) => setFields((p) => ({ ...p, quote: e.target.value }))} />
                </label>
              </div>
            ) : null}
            <div className={styles.rivActions}>
              <button type="button" className={styles.rivPrimary} disabled={busy || !canSubmit} onClick={() => onSubmitRecord?.(answer.trim(), fields)}>
                {busy ? '提交中…' : '提交访谈记录'}
              </button>
              <button type="button" className={styles.rivSecondary} disabled={busy || paused} title={paused ? '本轮已处于暂停状态' : '暂停本轮判断（服务端门）'} onClick={onPauseRound}>暂停本轮</button>
              {paused ? (
                <button type="button" className={styles.rivSecondary} disabled={busy} onClick={onResumeRound}>恢复本轮</button>
              ) : null}
              <button type="button" className={styles.rivSecondary} disabled={busy || paused} title={paused ? '本轮判断已暂停：转人工被服务端阻断（补证/纠正仍可用）' : '关键问题转人工复核'} onClick={onEscalateHuman}>转人工</button>
            </div>
          </>
        ) : (
          <>
            <label className={styles.rivFieldLabel} htmlFor="riv-ask">业务发起关键问题（绑定现场证据）</label>
            <textarea
              id="riv-ask"
              className={styles.rivTextarea}
              value={askDraft}
              rows={2}
              maxLength={2000}
              placeholder="例：请说明照片区块中设备的现状与数量（合成演示）…"
              onChange={(e) => setAskDraft(e.target.value)}
            />
            <div className={styles.rivActions}>
              <button type="button" className={styles.rivPrimary} disabled={busy || askDraft.trim() === ''} onClick={() => { onAskQuestion?.(askDraft.trim()); setAskDraft(''); }}>
                发起关键问题
              </button>
            </div>
          </>
        )}
        <div className={styles.rivFeedback}>
          {paused ? <p className={styles.rivNote} role="status">本轮判断已暂停：模型推进与确认类动作被服务端阻断；补证/纠正仍可用。</p> : null}
          {notice !== null ? <p className={styles.rivNotice} role="status">{notice}</p> : null}
          {actionError !== null ? <p className={styles.rivError} role="alert">{actionError}</p> : null}
        </div>
      </div>

      {/* 放大覆盖层（同一数据，仅画面与转写放大；无第二套状态） */}
      {fullscreen ? (
        <div className={styles.rivFull} role="dialog" aria-label="放大画面（模拟演示）">
          <div className={styles.rivStage} data-sim={simulationOn ? 'on' : 'off'} data-full="yes">
            <div className={styles.rivStageTop}>
              <StateBadge state={paused ? 'paused' : 'live'}>{paused ? '已暂停' : '访谈中'}</StateBadge>
              <span className={styles.rivSimTag} data-sim={simulationOn ? 'on' : 'off'}>
                {simulationOn ? '模拟会议视图 · 非真实画面' : '视频未接入 · 合成演示'}
              </span>
            </div>
            <div className={styles.rivStageAvatar} aria-hidden="true">
              {simulationOn ? '实控人（合成头像位）' : '实控人画面位'}
            </div>
            <ul className={styles.rivTranscriptList} aria-label="转写记录（合成事件）">
              {transcript.length === 0 ? <li className={styles.rivNote}>暂无转写事件。</li> : transcript.slice().reverse().slice(0, 6).map((t, i) => (
                <li key={`${t.at}-${i}`} className={styles.rivTranscriptItem}>
                  <time className={styles.rivTranscriptTime}>{t.at}</time>
                  <span className={styles.rivTranscriptWho}>{t.who}</span>
                  <span className={styles.rivTranscriptText}>{t.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.rivFullControls}>
            <button type="button" className={styles.rivPrimary} onClick={() => setFullscreen(false)}>退出放大</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
