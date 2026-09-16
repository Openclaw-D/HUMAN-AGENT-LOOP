"use client";

// C 路候选 · 远程尽调现场页 v3（REPAIR_20260914_EVENING/remote/candidate）
// 布局（COMMON 20260914 · 尽调条）：上部现场区域约半屏视觉参考（左主画面 + 右紧凑工具：
// 四域/证据/参会信息），下部进度 → 当前操作 → 聊天；顶部不机械占 50%。
// 相对旧 ui 候选 v2 的关键差异（供 A 审查）：
// 1) F2：header 标题静态（远程尽调访谈 · 项目号），当前问题文本只在画面浮层主要呈现一次；
//    画面下方细节条只呈现 依据/风险（不含问题文本，不再三现）。
// 2) F1：关键字段核对默认折叠为一行开关（aria-expanded + 条件渲染）。
// 3) 右侧紧凑工具单开面板（四域/证据/参会）；手机为工具行 + 展开面板；小屏保留画面可理解面积。
// 4) 聊天=访谈对话流（数据来自 questions 的 replies，来源标签连续同源只标一次）；
//    当前问题的回复不带问题文本（问题在画面浮层）；历史问答折叠保留（历史消息可保留）。
// 5) 进度行为只读汇总（闭环数/轮次/待办/人工待处理/旧版证据），不做业务推导。
// 底线沿用：模拟/未接入如实标注；模型 authority=none；正式人审不跳过；
// 全部数据经 props、写操作经回调：无 fetch、无 RequestRegistry、无 sessionStorage（业务事实不落地第二份）。
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  RemoteInterviewProps,
  RivDrafts,
  RivDomain,
  RivEvidence,
  RivParticipant,
  RivReply,
  RivToolId,
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
function UsersIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M15.5 5.8a3.2 3.2 0 0 1 0 5.4M17.6 14.9c1.6.7 2.6 2.3 2.9 4.6" /></svg>;
}
function GridIcon({ size, className }: { size?: number; className?: string }) {
  return <svg {...iconBase(size, className)}><rect x="4" y="4" width="7" height="7" rx="1.2" /><rect x="13" y="4" width="7" height="7" rx="1.2" /><rect x="4" y="13" width="7" height="7" rx="1.2" /><rect x="13" y="13" width="7" height="7" rx="1.2" /></svg>;
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

/** 回复来源标签（如实区分：模型输出标注模拟/真实；不把预设标成真实模型）。 */
function replyKindLabel(kind: string): string {
  if (kind === 'model_real') return '模型辅助（真实）';
  if (kind === 'model_simulation') return '模型（模拟）';
  if (kind === 'business') return '业务';
  if (kind === 'domain') return '专业域';
  if (kind === 'controller') return '实控人';
  return kind;
}

/** 聊天来源去重：连续同源回复只标一次标签（避免重复系统标签）。 */
function groupByKind(replies: RivReply[]): { kind: string; items: RivReply[] }[] {
  const groups: { kind: string; items: RivReply[] }[] = [];
  for (const r of replies) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.kind === r.kind) {
      last.items.push(r);
    } else {
      groups.push({ kind: r.kind, items: [r] });
    }
  }
  return groups;
}

function ReplyGroup({ group, showLabel }: { group: { kind: string; items: RivReply[] }; showLabel: boolean }) {
  return (
    <div className={styles.rivChatGroup} data-kind={group.kind}>
      {showLabel ? <span className={styles.rivChatKind}>{replyKindLabel(group.kind)}</span> : null}
      <div className={styles.rivChatBubbles}>
        {group.items.map((r) => (
          <p key={r.replyId} className={styles.rivChatText}>
            {r.text}
            {r.at !== undefined ? <time className={styles.rivChatTime}> {r.at}</time> : null}
          </p>
        ))}
      </div>
    </div>
  );
}

function evidenceBadge(e: RivEvidence) {
  if (e.expired) return <StateBadge state="bad">已过期</StateBadge>;
  if (e.verificationStatus === 'human_verified') return <StateBadge state="ok">已核实</StateBadge>;
  if (e.verificationStatus === 'contested') return <StateBadge state="warn">有争议</StateBadge>;
  return <StateBadge state="idle">未核实</StateBadge>;
}

const PARTICIPANT_KIND_LABEL: Record<string, string> = {
  business: '业务',
  controller: '实控人',
  domain: '专业域',
  model: '模型（无审批权）',
};

/** 参会信息（诚实呈现到场/核实状态；不发明在线状态）。 */
function ParticipantsPanel({ participants }: { participants: RivParticipant[] }) {
  return (
    <ul className={styles.rivAttendList}>
      {participants.map((p) => (
        <li key={p.participantId} className={styles.rivAttendItem}>
          <b className={styles.rivAttendName}>{p.displayName}</b>
          <span className={styles.rivAttendRole}>{PARTICIPANT_KIND_LABEL[p.kind] ?? p.kind}{p.domainRole !== '' ? ` · ${p.domainRole}` : ''}</span>
          <span className={styles.rivAttendState}>
            {p.joined ? '已入会' : '未入会'}
            {p.attendanceVerified ? ' · 到场已核实' : ''}
            {!p.joined && p.attendance !== '' ? ` · ${p.attendance}` : ''}
          </span>
        </li>
      ))}
      {participants.length === 0 ? <li className={styles.rivNote}>暂无参会人记录。</li> : null}
      <li className={styles.rivNote}>到场要求：实控人须在经营现场，财务/生产人员现场或实时入会（合成演示，不做真实核验）。</li>
    </ul>
  );
}

/** 四域面板（业务侧）：四域当前判断的紧凑提示（与项目总览一致，只读）。 */
function DomainsPanel({ domains }: { domains: RivDomain[] }) {
  return (
    <div className={styles.rivToolPanelBody}>
      {domains.map((d) => (
        <div key={d.domainId} className={styles.rivToolDomain} data-state={d.state ?? 'pending'}>
          <p className={styles.rivToolDomainHead}>
            <span className={styles.rivDot} aria-hidden="true" />
            <b>{d.label}</b>
          </p>
          {d.tips.length === 0 ? (
            <p className={styles.rivNote}>暂无与本次尽调相关的提示。</p>
          ) : d.tips.map((t) => (
            <p key={t.id} className={styles.rivToolTip} data-level={t.level}>{t.text}</p>
          ))}
        </div>
      ))}
      {domains.length === 0 ? <p className={styles.rivNote}>四域提示暂不可用（只读数据未就绪，不臆造）。</p> : null}
    </div>
  );
}

/** 证据面板：附着合成证据 + 清单（含当前版本/状态）+ 本地拍照（cameraSlot 注入现有 CameraPanel）。 */
function EvidencePanel(props: RemoteInterviewProps) {
  const { evidence, supersededEvidenceCount, busy, cameraSlot, onAttachEvidence, onSelectEvidence } = props;
  return (
    <div className={styles.rivToolPanelBody}>
      <div className={styles.rivBtnRow}>
        <button type="button" className={styles.rivBtnSmall} disabled={busy} onClick={() => onAttachEvidence?.('fixture-inspection')}>附着现场巡检（合成）</button>
        <button type="button" className={styles.rivBtnSmall} disabled={busy} onClick={() => onAttachEvidence?.('fixture-equipment')}>附着设备清单（合成）</button>
      </div>
      <ul className={styles.rivEvidenceList}>
        {evidence.map((e) => (
          <li key={e.evidenceId} className={styles.rivEvidenceItem}>
            <button type="button" className={styles.rivEvidenceBtn} onClick={() => onSelectEvidence?.(e.evidenceId)}>
              {e.title}
              <span className={styles.rivEvidenceVer}>v{e.version}</span>
            </button>
            {evidenceBadge(e)}
          </li>
        ))}
        {evidence.length === 0 ? <li className={styles.rivNote}>尚无证据。</li> : null}
      </ul>
      {supersededEvidenceCount > 0 ? (
        <p className={styles.rivNote}>已更新 {supersededEvidenceCount} 条旧版本证据；基于旧版本的结论以「待复核」呈现。</p>
      ) : null}
      {cameraSlot ?? (
        <p className={styles.rivNote}>本地拍照入口由集成方注入（现有相机面板可原位复用；模拟演示场景不打开摄像头）。</p>
      )}
    </div>
  );
}

export default function RemoteInterviewStagePage(props: RemoteInterviewProps) {
  const {
    title, backHref, phase, loadError,
    viewMode = 'business', onViewModeChange,
    projectId, live, paused, currentQuestion, openQuestionCount,
    domains, evidence, questions, participants, progress,
    reviews, pendingRequests, transcript,
    humanPendingCount, supersededEvidenceCount, expiredOpinionCount,
    simulationOn, modelAnalysisAvailable, modelAnalysisReason,
    busy, notice, actionError, voiceNote, cameraSlot,
    drafts: draftsProp, onDraftsChange,
    techNote, modelStatusLine, calculations, onAttemptCalculation,
    defaultToolOpen = null,
    onRetryLoad, onCreateSession, onSubmitRecord, onPauseRound, onResumeRound, onEscalateHuman,
    onAskQuestion, onSelectEvidence, onSimulateToggle, onToggleVoiceNote,
    onAnalyzeQuestion, onSimulateFollowups, onRetryPending, onDiscardPending, onAddTranscriptDemo,
  } = props;
  const customer = viewMode === 'customer';

  // 受控/非受控双模草稿：不传 drafts 时组件自持（仅输入草稿，非业务事实）；传入时由页面层持久。
  const [localDrafts, setLocalDrafts] = useState<RivDrafts>({ answer: '', ask: '', fields: { deviceCount: '', quote: '' } });
  const drafts = draftsProp ?? localDrafts;
  function setDrafts(patch: Partial<RivDrafts>): void {
    if (draftsProp !== undefined) onDraftsChange?.(patch);
    else setLocalDrafts((p) => ({ ...p, ...patch }));
  }

  const [fullscreen, setFullscreen] = useState(false);
  const [toolOpen, setToolOpen] = useState<RivToolId | null>(defaultToolOpen); // 右侧紧凑工具：单开
  const [historyOpen, setHistoryOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false); // F1：关键字段核对默认收起

  // ---- 非ready四态骨架（顶部返回 + 状态徽章，路径不变） ----
  if (phase !== 'ready') {
    return (
      <div className={styles.rivRoot}>
        <header className={styles.rivTop}>
          <Link className={styles.rivTopBack} href={backHref} aria-label="返回项目总览"><ArrowLeftIcon size={18} /></Link>
          <b className={styles.rivTopTitle}>{title}</b>
          <StateBadge state={phase === 'error' ? 'bad' : 'idle'}>
            {phase === 'error' ? '加载失败' : phase === 'empty' ? '未开始' : '加载中'}
          </StateBadge>
        </header>
        <PendingBar pending={pendingRequests} busy={busy} onRetry={onRetryPending} onDiscard={onDiscardPending} />
        <div className={styles.rivFallback}>
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

  const canSubmit = currentQuestion !== null && drafts.answer.trim() !== '';
  const closedQuestions = questions.filter((q) => q.status === 'closed' && !q.expired);
  const currentReplies = currentQuestion !== null
    ? (questions.find((q) => q.annotationId === currentQuestion.annotationId)?.replies ?? [])
    : [];
  const visibleCurrentReplies = customer
    ? currentReplies.filter((r) => r.kind !== 'model_real' && r.kind !== 'model_simulation')
    : currentReplies;
  const totalQuestions = progress.total;
  const answeredPct = totalQuestions > 0 ? Math.round((progress.answered / totalQuestions) * 100) : 0;

  const toolDefs: { id: RivToolId; label: string; icon: ReactNode }[] = [
    { id: 'domains', label: '四域', icon: <GridIcon size={15} /> },
    { id: 'evidence', label: `证据（${evidence.length}）`, icon: <MagnifierIcon size={15} /> },
    { id: 'participants', label: `参会（${participants.length}）`, icon: <UsersIcon size={15} /> },
  ];
  const toolsForView: { id: RivToolId; label: string; icon: ReactNode }[] = customer
    ? toolDefs.filter((t) => t.id === 'participants')
    : toolDefs;

  return (
    <div className={styles.rivRoot} data-view={viewMode}>
      {/* 顶部：返回 + 状态 + 静态标题（F2：不含当前问题文本）+ 视图切换 */}
      <header className={styles.rivTop}>
        <Link className={styles.rivTopBack} href={backHref} aria-label="返回项目总览（状态与草稿保留）"><ArrowLeftIcon size={18} /></Link>
        <StateBadge state={paused ? 'paused' : 'live'}>{paused ? '已暂停' : '进行中'}</StateBadge>
        <b className={styles.rivTopTitle}>{title}{projectId ? ` · ${projectId}` : ''}</b>
        {customer ? (
          <StateBadge state="idle">客户视图 · 非生产权限隔离</StateBadge>
        ) : humanPendingCount > 0 ? (
          <StateBadge state="warn">人工待处理 {humanPendingCount}</StateBadge>
        ) : null}
        <div className={styles.rivViewToggle} role="group" aria-label="视图切换（展示切换·非生产权限隔离）">
          <button
            type="button"
            className={styles.rivViewBtn}
            data-active={!customer ? 'yes' : 'no'}
            aria-pressed={!customer}
            disabled={onViewModeChange === undefined}
            onClick={() => onViewModeChange?.('business')}
          >
            业务视图
          </button>
          <button
            type="button"
            className={styles.rivViewBtn}
            data-active={customer ? 'yes' : 'no'}
            aria-pressed={customer}
            disabled={onViewModeChange === undefined}
            onClick={() => onViewModeChange?.('customer')}
          >
            客户视图
          </button>
        </div>
      </header>

      {customer ? (
        <div className={styles.rivViewNote} role="note">客户视图 · 展示切换 · 非生产权限隔离（合成演示）</div>
      ) : null}

      {!customer ? <PendingBar pending={pendingRequests} busy={busy} onRetry={onRetryPending} onDiscard={onDiscardPending} /> : null}

      {/* 上部：现场画面（首要视觉，约半屏参考） + 右侧紧凑工具 */}
      <div className={styles.rivStageRow}>
        <div className={styles.rivStageCol}>
          <section className={styles.rivStage} aria-label="现场画面（模拟演示）" data-sim={simulationOn ? 'on' : 'off'}>
            <div className={styles.rivStageTop}>
              <StateBadge state={paused ? 'paused' : 'live'}>{paused ? '已暂停' : '访谈中'}</StateBadge>
              <span className={styles.rivSimTag} data-sim={simulationOn ? 'on' : 'off'}>
                {simulationOn ? '模拟会议视图 · 非真实画面' : '视频未接入 · 合成演示（不申请摄像头/麦克风）'}
              </span>
            </div>
            <div className={styles.rivStageAvatar} aria-hidden="true">
              {simulationOn ? '实控人（合成头像位）' : '实控人画面位'}
            </div>
            {/* 当前问题：全页唯一主要呈现点（F2） */}
            {currentQuestion !== null ? (
              <div className={styles.rivStageQuestion}>
                <p className={styles.rivStageQuestionText}>
                  <span className={styles.rivStageQuestionLabel}>当前关键问题{openQuestionCount > 0 ? `（另有 ${openQuestionCount} 个待办）` : ''}</span>
                  {currentQuestion.question}
                </p>
              </div>
            ) : (
              <p className={styles.rivStageQuestion}>当前待办：补充设备清单，请实控人现场说明设备现状。</p>
            )}
          </section>
          {!customer ? (
            <div className={styles.rivStageCtrl}>
              <label className={styles.rivToggle}>
                <input type="checkbox" checked={simulationOn} onChange={(e) => onSimulateToggle?.(e.target.checked)} />
                模拟画面
              </label>
              <button type="button" className={styles.rivBtnSmall} onClick={() => setFullscreen(true)}>放大画面</button>
              <button type="button" className={styles.rivBtnSmall} onClick={() => setToolOpen((v) => (v === 'evidence' ? null : 'evidence'))} aria-expanded={toolOpen === 'evidence'}>拍照/选图</button>
              <span className={styles.rivStageConn}><CameraLineIcon size={13} />连接状态：未配置（不采集）</span>
            </div>
          ) : null}
          {/* 画面细节条：只呈现 依据/风险（不含问题文本；风险提示属业务侧内部信息） */}
          {currentQuestion !== null ? (
            <div className={styles.rivStageDetail}>
              <p className={styles.rivStageBasis}>{currentQuestion.basis}</p>
              {!customer && currentQuestion.risk !== '' ? <p className={styles.rivStageRisk}>{currentQuestion.risk}</p> : null}
            </div>
          ) : null}
          {voiceNote !== null && !customer ? (
            <div className={styles.rivVoiceNote} role="status">
              <p className={styles.rivNote}>{voiceNote}</p>
              <p className={styles.rivNote}>语音接口已冻结：接入需媒体权限与 ASR 服务授权（另行 Gate），不以普通文本框冒称已支持语音。</p>
              {onAddTranscriptDemo !== undefined ? (
                <button type="button" className={styles.rivBtnSmall} onClick={onAddTranscriptDemo}>添加合成转写事件（演示 · 非真实 ASR）</button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 右侧紧凑工具：单开面板；手机为工具行（CSS 收缩） */}
        <div className={styles.rivToolCol} data-open={toolOpen !== null ? 'yes' : 'no'}>
          <div className={styles.rivToolBtns} role="group" aria-label="现场工具（四域/证据/参会信息）">
            {toolsForView.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.rivToolBtn}
                data-active={toolOpen === t.id ? 'yes' : 'no'}
                aria-expanded={toolOpen === t.id}
                onClick={() => setToolOpen((v) => (v === t.id ? null : t.id))}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          {toolOpen === 'domains' && !customer ? <div className={styles.rivToolPanel} aria-label="四域提示（业务侧·合成演示）"><DomainsPanel domains={domains} /></div> : null}
          {toolOpen === 'evidence' && !customer ? <div className={styles.rivToolPanel} aria-label="证据与本地拍照"><EvidencePanel {...props} /></div> : null}
          {toolOpen === 'participants' ? <div className={styles.rivToolPanel} aria-label="参会信息"><ParticipantsPanel participants={participants} /></div> : null}
        </div>
      </div>

      {/* 下部 1：进度（只读汇总 + 旧意见待复核简短提示；客户视图不展示内部口径） */}
      {!customer ? (
        <div className={styles.rivProgress} role="status" aria-label="访谈进度（只读汇总）">
          <div className={styles.rivProgressTrack} aria-hidden="true"><span style={{ width: `${answeredPct}%` }} /></div>
          <p className={styles.rivProgressText}>
            已闭环 {progress.answered}/{totalQuestions} · 轮次 {progress.round} · 待办问题 {openQuestionCount + (currentQuestion !== null ? 1 : 0)}
            {humanPendingCount > 0 ? ` · 人工待处理 ${humanPendingCount}` : ''}
            {supersededEvidenceCount > 0 ? ` · 旧版证据 ${supersededEvidenceCount} 条已更新` : ''}
          </p>
          {expiredOpinionCount > 0 ? (
            <p className={styles.rivProgressWarn}>有 {expiredOpinionCount} 条旧意见基于过期证据 · 待复核（旧结论不自动失效为有效）。</p>
          ) : null}
        </div>
      ) : null}

      {/* 下部 2：当前操作（操作坞；反馈行唯一渲染点；hit area≥44px） */}
      <div className={styles.rivDock}>
        {customer ? (
          <p className={styles.rivNote} role="status">
            {currentQuestion !== null
              ? '请实控人围绕当前问题现场说明；业务人员正在记录（合成演示，无真实录制）。'
              : '当前无待回答问题；等待业务发起（合成演示）。'}
          </p>
        ) : currentQuestion !== null ? (
          <>
            <div className={styles.rivDockLabelRow}>
              <label className={styles.rivFieldLabel} htmlFor="riv-answer">当前操作 · 访谈记录（转写草稿 · 文字输入）</label>
              <button type="button" className={styles.rivVoiceBtn} aria-label="语音输入（未接入，点击查看说明）" aria-expanded={voiceNote !== null} onClick={onToggleVoiceNote}>
                <MicLineIcon size={14} />
                语音 · 未接入
              </button>
            </div>
            <textarea
              id="riv-answer"
              className={styles.rivTextarea}
              value={drafts.answer}
              rows={2}
              maxLength={2000}
              placeholder="记录实控人现场说明要点（合成演示）…"
              onChange={(e) => setDrafts({ answer: e.target.value })}
            />
            {/* F1：关键字段核对 = 低频人工纠正，默认折叠为一行（避免常驻占据手机首屏近半） */}
            <button type="button" className={styles.rivFieldsToggle} aria-expanded={fieldsOpen} onClick={() => setFieldsOpen((v) => !v)}>
              关键字段核对（人工纠正 · 可选）
              <ChevronRightIcon size={13} className={styles.rivChevron} />
            </button>
            {fieldsOpen ? (
              <div className={styles.rivFields}>
                <label className={styles.rivField}>
                  设备数量（台）
                  <input className={styles.rivInput} inputMode="numeric" value={drafts.fields.deviceCount} placeholder="待口述确认"
                    onChange={(e) => setDrafts({ fields: { ...drafts.fields, deviceCount: e.target.value } })} />
                </label>
                <label className={styles.rivField}>
                  报价（万元）
                  <input className={styles.rivInput} inputMode="decimal" value={drafts.fields.quote} placeholder="待口述确认"
                    onChange={(e) => setDrafts({ fields: { ...drafts.fields, quote: e.target.value } })} />
                </label>
              </div>
            ) : null}
            <div className={styles.rivActions}>
              <button type="button" className={styles.rivPrimary} disabled={busy || !canSubmit} onClick={() => onSubmitRecord?.(drafts.answer.trim(), drafts.fields)}>
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
            <label className={styles.rivFieldLabel} htmlFor="riv-ask">当前操作 · 业务发起关键问题（绑定现场证据）</label>
            <textarea
              id="riv-ask"
              className={styles.rivTextarea}
              value={drafts.ask}
              rows={2}
              maxLength={2000}
              placeholder="例：请说明照片区块中设备的现状与数量（合成演示）…"
              onChange={(e) => setDrafts({ ask: e.target.value })}
            />
            <div className={styles.rivActions}>
              <button type="button" className={styles.rivPrimary} disabled={busy || drafts.ask.trim() === ''} onClick={() => { onAskQuestion?.(drafts.ask.trim()); setDrafts({ ask: '' }); }}>
                发起关键问题
              </button>
            </div>
          </>
        )}
        <div className={styles.rivFeedback}>
          {paused && !customer ? <p className={styles.rivNote} role="status">本轮判断已暂停：模型推进与确认类动作被服务端阻断；补证/纠正仍可用。</p> : null}
          {notice !== null ? <p className={styles.rivNotice} role="status">{notice}</p> : null}
          {actionError !== null ? <p className={styles.rivError} role="alert">{actionError}</p> : null}
        </div>
      </div>

      {/* 下部 3：聊天（访谈对话流；来源标签连续同源只标一次；客户视图仅转写回看） */}
      <section className={styles.rivChat} aria-label="聊天 · 访谈对话（合成演示）">
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
          <>
            <p className={styles.rivSecKicker}>
              访谈对话 · 来源如实标注（模型输出仅为模拟 · authority=none）
            </p>
            {currentQuestion !== null ? (
              <div className={styles.rivBtnRow}>
                <button
                  type="button"
                  className={styles.rivBtnSmall}
                  disabled={busy || paused || !modelAnalysisAvailable}
                  title={modelAnalysisAvailable ? '真实模型信审辅助分析（结果仅疑点线索，须人工复核）' : (modelAnalysisReason ?? '真实模型通道未启用：可用后开放')}
                  onClick={() => onAnalyzeQuestion?.(currentQuestion.annotationId)}
                >
                  {modelAnalysisAvailable ? '模型辅助分析（真实）' : '模型辅助分析（未启用）'}
                </button>
                <button
                  type="button"
                  className={styles.rivBtnSmall}
                  disabled={busy || paused}
                  title={paused ? '本轮判断已暂停：模型推进被服务端阻断' : '生成模拟追问（SIMULATION，非真实模型）'}
                  onClick={() => onSimulateFollowups?.(currentQuestion.annotationId)}
                >
                  模拟追问（SIMULATION）
                </button>
              </div>
            ) : null}
            <div className={styles.rivChatFeed}>
              {visibleCurrentReplies.length === 0 && currentQuestion !== null ? (
                <p className={styles.rivNote}>暂无回复；等待实控人现场说明（问题见画面）。</p>
              ) : null}
              {groupByKind(visibleCurrentReplies).map((g, gi) => (
                <ReplyGroup key={`${g.kind}-${gi}`} group={g} showLabel />
              ))}
              {currentQuestion === null ? <p className={styles.rivNote}>当前无进行中问题；历史问答见下方折叠区。</p> : null}
            </div>
            <button type="button" className={styles.rivHistoryToggle} aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
              历史问答（{closedQuestions.length} 已闭环{expiredOpinionCount > 0 ? ` · 旧意见待复核 ${expiredOpinionCount}` : ''}）与复核留痕（{reviews.length}）
              <ChevronRightIcon size={13} className={styles.rivChevron} />
            </button>
            {historyOpen ? (
              <div className={styles.rivHistoryBody}>
                <ul className={styles.rivQuestionList}>
                  {closedQuestions.map((q) => (
                    <li key={q.annotationId} className={styles.rivQuestionItem}>
                      <p className={styles.rivQuestionText}>【证据 v{q.evidenceVersion}】{q.question}</p>
                      {groupByKind(q.replies).map((g, gi) => (
                        <ReplyGroup key={`${g.kind}-${gi}`} group={g} showLabel />
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
                  {closedQuestions.length === 0 ? <li className={styles.rivNote}>暂无已闭环问答。</li> : null}
                </ul>
                {expiredOpinionCount > 0 ? (
                  <p className={styles.rivNote}>另有 {expiredOpinionCount} 条基于过期证据的旧意见未展示；结论以当前证据版本为准，旧意见待复核。</p>
                ) : null}
                <ul className={styles.rivReviewList} aria-label="复核留痕（人工动作，模型无审批权）">
                  {reviews.slice(-4).reverse().map((r) => (
                    <li key={r.reviewId} className={styles.rivReviewItem}>
                      <b>{r.label}</b> · 针对 v{r.targetVersion} · {r.opinion}
                    </li>
                  ))}
                  {reviews.length === 0 ? <li className={styles.rivNote}>暂无复核留痕。</li> : null}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* 演示设置（业务视图；折叠：技术摘要/模型通道/核算尝试——能力经 A 接口保留） */}
      {!customer ? (
        <details className={styles.rivDetails} data-tech="yes" open={techOpen} onToggle={(e) => setTechOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            <ClockIcon size={15} className={styles.rivSummaryLead} />
            <span className={styles.rivSummaryTxt}>演示设置（技术详情 · 合成演示控制）</span>
            <ChevronRightIcon size={15} className={styles.rivChevron} />
          </summary>
          <div className={styles.rivDetailsBody}>
            {techNote !== null && techNote !== undefined && techNote !== '' ? <p className={styles.rivNote}>{techNote}</p> : null}
            {modelStatusLine !== null && modelStatusLine !== undefined && modelStatusLine !== '' ? <p className={styles.rivNote}>{modelStatusLine}</p> : null}
            {techNote === undefined && modelStatusLine === undefined && calculations === undefined && onAttemptCalculation === undefined ? (
              <p className={styles.rivNote}>技术细节（会话/版本/provider/模型通道状态）由页面层经 props 注入或保留原实现；本候选不重复渲染。</p>
            ) : null}
            {onAttemptCalculation !== undefined ? (
              <div className={styles.rivBtnRow}>
                <button type="button" className={styles.rivBtnSmall} disabled={busy} onClick={onAttemptCalculation}>
                  尝试核算（未配置 → 如实显示）
                </button>
              </div>
            ) : null}
            {calculations !== undefined && calculations.length > 0 ? (
              <ul className={styles.rivCalcList}>
                {calculations.slice(-1).reverse().map((c) => (
                  <li key={c.calcId} className={styles.rivCalcItem} data-status={c.status} data-stale={c.stale === true ? 'yes' : 'no'}>
                    <b>{c.status}{c.stale === true ? '（已过期）' : ''}</b>
                    <ul>{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}

      <p className={styles.rivFooter}>合成演示 · 不执行正式审批 · 视频/语音未接入如实显示 · 模型输出仅为模拟（authority=none）</p>

      {/* 放大覆盖层（同一数据，仅画面与转写放大；无第二套状态） */}
      {fullscreen && !customer ? (
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
            {currentQuestion !== null ? (
              <p className={styles.rivStageQuestionText}>{currentQuestion.question}</p>
            ) : null}
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
