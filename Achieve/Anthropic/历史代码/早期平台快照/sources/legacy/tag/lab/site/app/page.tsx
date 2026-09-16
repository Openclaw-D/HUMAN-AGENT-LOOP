'use client';

import { useCallback, useEffect, useState } from 'react';

const serviceBase = 'http://127.0.0.1:4174';
const projectId = 'demo-project';
type Identifier = string;
type Actor = { id: string; class: string };
type EventRecord = { sequence: number; type: string; actor?: Actor; aggregateId: string; aggregateType: string; payload?: Record<string, unknown> };
type EvidenceRef = { evidenceId?: string; id?: string };
type ChallengeState = { challengeId: string; status: string };
type Snapshot = { id: Identifier; reviewRoundId: Identifier; threadVersion?: number; sourceThreadVersion?: number; evidence?: EvidenceRef[]; evidenceConfidence?: number | string; challengeState?: ChallengeState[] };
type Challenge = { id: Identifier; reviewRoundId: Identifier; status: string; prompt?: string };
type Artifact = { id: Identifier; reviewRoundId: Identifier; snapshotId: Identifier; advisoryOnly: boolean };
type Decision = { id: Identifier; reviewRoundId: Identifier; snapshotId: Identifier; outcome: string; rationale?: string };
type ReviewRound = { id: Identifier; number: number; status: string; snapshotId?: Identifier; challengeIds?: Identifier[]; decisionId?: Identifier };
type Message = { id: Identifier; sequence: number; content: string; actor?: Actor; authorId?: string };
type Thread = { id: Identifier; title: string; version: number; messages: Message[] };
type StateResponse = { project?: { title?: string }; threads: Thread[]; reviewRounds: ReviewRound[]; snapshots: Snapshot[]; challenges: Challenge[]; artifacts: Artifact[]; decisions: Decision[] };
type GraphResponse = { nodes: { id: string; type: string; label: string }[]; edges: { id: string; source: string; target: string; type: string }[] };
type Dimension = '输入' | '规则' | '模型' | '输出';
type PhaseId = 'precheck' | 'review' | 'decision';
type ViewMode = 'case' | 'blueprint';
type ActionSpec = readonly [command: string, actor: string, capability: string, label: string];
type Explanation = { who: string; what: string; input: string; effect: string; next: string };
type KeyMoment = { id: string; who: string; summary: string; effect: string; result: string; sequences: number[] };
type TrackNode = { lane: Dimension; phase: PhaseId; attempt: number; label: string; occurred: boolean; note: string };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const canonicalize = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonicalize)
  : isRecord(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]))
    : value;
const makeHash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalize(value)))))).map(byte => byte.toString(16).padStart(2, '0')).join('');
const errorCode = (reason: unknown) => reason instanceof Error ? reason.message : '请求失败';
const evidenceId = (item: EvidenceRef) => item.evidenceId ?? item.id ?? '未知材料';
const statusText = (status?: string) => ({ submitted: '已发起', needs_input: '待补证', under_review: '审查中', decided: '已完成决定', open: '待回答', reopened: '重新打开', answered: '已回答', resolved: '已解决', pass: '通过', veto: '否决' }[status || ''] || '暂无');

const dimensions: Dimension[] = ['输入', '规则', '模型', '输出'];
const phases: { id: PhaseId; label: string; weight: string; attempts: string[] }[] = [
  { id: 'precheck', label: '预审', weight: '60%', attempts: ['第 1 次', '第 2 次', '第 3 次'] },
  { id: 'review', label: '正审', weight: '30%', attempts: ['第 1 轮', '第 2 轮'] },
  { id: 'decision', label: '决定', weight: '10%', attempts: ['唯一终决'] },
];
const blueprintCopy: Record<PhaseId, Record<Dimension, string[]>> = {
  precheck: {
    输入: ['首次材料', '补充材料', '风险回应'],
    规则: ['完整性检查', '硬条件检查', '剩余风险检查'],
    模型: ['材料识别', '一致性对照', '风险倾向与引用'],
    输出: ['反馈补全', '确认材料就绪', '形成预审结论'],
  },
  review: {
    输入: ['审查材料', '补证材料'],
    规则: ['版本与引用校验', '补证重新校验'],
    模型: ['倾向对照', '偏差复核'],
    输出: ['提出补证', '复核补证'],
  },
  decision: {
    输入: ['最终判断快照'],
    规则: ['权限校验'],
    模型: ['模型不作决定'],
    输出: ['人类终决'],
  },
};

export default function Home() {
  const [state, setState] = useState<StateResponse>();
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [] });
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [connection, setConnection] = useState('正在连接服务…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [manualReview, setManualReview] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<PhaseId>();
  const [viewMode, setViewMode] = useState<ViewMode>('blueprint');
  const [message, setMessage] = useState('');
  const [evidence, setEvidence] = useState({ title: '', locator: '', content: '' });
  const [challengePrompt, setChallengePrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerEvidence, setAnswerEvidence] = useState({ title: '', locator: '', content: '' });

  const load = useCallback(async () => {
    try {
      const [stateResponse, graphResponse, eventResponse] = await Promise.all([
        fetch(`${serviceBase}/api/projects/${projectId}/state`),
        fetch(`${serviceBase}/api/projects/${projectId}/graph`),
        fetch(`${serviceBase}/api/projects/${projectId}/events?after=0`),
      ]);
      if (!stateResponse.ok || !graphResponse.ok || !eventResponse.ok) throw new Error('读取失败');
      setState(await stateResponse.json() as StateResponse);
      setGraph(await graphResponse.json() as GraphResponse);
      setEvents(await eventResponse.json() as EventRecord[]);
      setError('');
      setConnection(previous => previous.startsWith('实时') ? previous : '轮询已恢复，正在恢复实时连接');
    } catch (reason: unknown) {
      setError(errorCode(reason)); setConnection('服务暂不可用，正在轮询重连');
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const polling = window.setInterval(() => void load(), 5000);
    let stream: EventSource | undefined;
    let retry: number | undefined;
    const connect = () => {
      stream?.close();
      stream = new EventSource(`${serviceBase}/api/projects/${projectId}/events/stream`);
      stream.onopen = () => setConnection('实时连接正常');
      stream.onmessage = () => void load();
      stream.onerror = () => {
        stream?.close(); setConnection('实时连接已降级，正在重连');
        if (retry === undefined) retry = window.setTimeout(() => { retry = undefined; connect(); }, 5000);
      };
    };
    connect();
    return () => { window.clearTimeout(initial); window.clearInterval(polling); if (retry !== undefined) window.clearTimeout(retry); stream?.close(); };
  }, [load]);

  const thread = state?.threads[0];
  const round = state?.reviewRounds.at(-1);
  const roundChallenges = state?.challenges.filter(item => round?.challengeIds?.includes(item.id)) ?? [];
  const challenge = roundChallenges.at(-1);
  const roundSnapshots = state?.snapshots.filter(item => item.reviewRoundId === round?.id).sort((left, right) => (left.sourceThreadVersion ?? left.threadVersion ?? 0) - (right.sourceThreadVersion ?? right.threadVersion ?? 0)) ?? [];
  const currentSnapshot = roundSnapshots.find(item => item.id === round?.snapshotId) ?? roundSnapshots.at(-1);
  const roundArtifacts = state?.artifacts.filter(item => item.reviewRoundId === round?.id) ?? [];
  const artifact = roundArtifacts.at(-1);
  const roundDecisions = state?.decisions.filter(item => item.reviewRoundId === round?.id) ?? [];
  const decision = state?.decisions.find(item => item.id === round?.decisionId) ?? roundDecisions.at(-1);
  const roundIds = new Set([round?.id, ...roundChallenges.map(item => item.id), ...roundSnapshots.map(item => item.id), ...roundArtifacts.map(item => item.id), ...roundDecisions.map(item => item.id)].filter((item): item is string => Boolean(item)));
  const roundEvents = events.filter(item => item.payload?.reviewRoundId === round?.id || roundIds.has(item.aggregateId));
  const eventOf = (type: string) => roundEvents.find(item => item.type === type);
  const enterEvent = eventOf('RiskReviewSubmitted') ?? eventOf('RiskDecisionReconsidered');
  const communicatedEvent = eventOf('RiskChallengeCommunicated');
  const answeredEvent = eventOf('RiskChallengeAnswered');
  const snapshotEvent = [...roundEvents].reverse().find(item => item.type === 'ContextSnapshotCreated');
  const resolvedEvent = eventOf('RiskChallengeResolved');
  const advisoryEvent = eventOf('AdvisoryArtifactCreated');
  const decisionEvent = eventOf('RiskDecisionRecorded');

  const action: ActionSpec = manualReview && !decision
    ? ['recordRiskDecision', 'risk', 'decide', '由风控人员记录决定']
    : !round ? ['submitForRiskReview', 'business', 'submit', '发起风险审查']
      : round.status === 'decided' ? ['reconsiderRiskDecision', 'risk', 'reconsider', '发起重新审查']
        : !challenge ? ['communicateRiskChallenge', 'risk', 'communicate', '提出补证要求']
          : ['open', 'reopened'].includes(challenge.status) ? ['answerChallenge', 'business', 'answer', '回答并补证']
            : challenge.status === 'answered' ? ['resolveRiskChallenge', 'risk', 'resolve', '确认补证完成']
              : !artifact ? ['invokeDeterministicAdvisory', 'business', 'invoke', '请求智能建议']
                : ['recordRiskDecision', 'risk', 'decide', '由风控人员记录决定'];
  const currentPhase: PhaseId = !round ? 'precheck' : ['recordRiskDecision', 'reconsiderRiskDecision'].includes(action[0]) ? 'decision' : 'review';
  const visiblePhase = selectedPhase ?? currentPhase;
  const explanations: Record<PhaseId, Explanation> = {
    precheck: {
      who: '业务人员、规则系统、智能模型与风控人员（流程能力）',
      what: '后端尚未记录权威预审次数；此处只展示最多三次的接力容量',
      input: thread?.messages.length ? `${thread.messages.length} 条真实业务消息及已提交材料` : '暂无已记录业务消息',
      effect: '不从数组位置或本地状态推断真实预审轮次',
      next: round ? '真实案件已进入正审，请查看正审阶段' : '材料就绪后可由业务人员发起风险审查',
    },
    review: {
      who: challenge?.status === 'answered' || challenge?.status === 'resolved' ? '业务人员、规则系统与风控人员' : '风控人员与业务人员',
      what: resolvedEvent ? '风控人员已复核补证并确认要求解决' : answeredEvent ? '业务人员已在同一轮审查内回答并补证' : communicatedEvent ? '风控人员已提出补证要求' : enterEvent ? '案件已进入风险审查' : '暂无真实正审记录',
      input: challenge?.prompt || (currentSnapshot ? `${currentSnapshot.evidence?.length ?? 0} 项真实材料与当前判断快照` : '暂无'),
      effect: currentSnapshot ? `当前轮共有 ${roundSnapshots.length} 份不可变判断快照` : '暂无权威状态变化',
      next: ['recordRiskDecision', 'reconsiderRiskDecision'].includes(action[0]) ? '进入决定阶段' : action[3],
    },
    decision: {
      who: '拥有决定权限的风控人员',
      what: decision ? `已由风控人员记录${statusText(decision.outcome)}` : '尚未记录最终通过或否决',
      input: currentSnapshot ? `最新真实判断快照、权限校验${artifact ? '与仅供参考的智能建议' : ''}` : '暂无最终判断快照',
      effect: decision ? '形成不可改写的最终决定记录' : '尚未改变权威决定状态',
      next: decision ? '如需改变结果，只能发起新一轮重新审查' : '仅风控人员可向后端记录通过或否决',
    },
  };
  const explanation = explanations[visiblePhase];

  const occurredFor = (phase: PhaseId, lane: Dimension, attempt: number) => {
    if (phase === 'precheck') return false;
    if (phase === 'review' && attempt === 0) {
      return lane === '输入' ? Boolean(enterEvent || roundSnapshots[0])
        : lane === '规则' ? Boolean(roundSnapshots[0])
          : lane === '模型' ? Boolean(artifact && !answeredEvent)
            : Boolean(communicatedEvent);
    }
    if (phase === 'review') {
      return lane === '输入' ? Boolean(answeredEvent)
        : lane === '规则' ? Boolean(answeredEvent && roundSnapshots.length > 1)
          : lane === '模型' ? Boolean(artifact && answeredEvent)
            : Boolean(resolvedEvent);
    }
    return lane === '输入' ? Boolean(currentSnapshot && (artifact || manualReview || decision))
      : lane === '规则' ? Boolean(decision)
        : lane === '模型' ? Boolean(artifact)
          : Boolean(decision);
  };
  const noteFor = (phase: PhaseId, lane: Dimension, attempt: number) => {
    if (phase === 'precheck') return '后端未记录该次数';
    if (phase === 'review' && attempt === 1 && ['输入', '规则', '输出'].includes(lane)) return '同一轮审查内的补证复核';
    if (phase === 'decision' && lane === '输入') return decision ? '最终决定绑定此真实快照' : '使用最新真实快照';
    if (phase === 'decision' && lane === '模型') return artifact ? '仅供参考，不拥有决定权' : '不参与最终决定';
    return occurredFor(phase, lane, attempt) ? '后端已有真实记录' : '尚未发生';
  };
  const trackNodes: TrackNode[] = phases.flatMap(phase => dimensions.flatMap(lane => phase.attempts.map((_, attempt) => ({
    lane,
    phase: phase.id,
    attempt,
    label: blueprintCopy[phase.id][lane][attempt],
    occurred: occurredFor(phase.id, lane, attempt),
    note: noteFor(phase.id, lane, attempt),
  }))));
  const reviewPassCount = answeredEvent || resolvedEvent || roundSnapshots.length > 1 ? 2 : round ? 1 : 0;
  const visibleAttempts = (phase: typeof phases[number]) => {
    if (viewMode === 'blueprint') return phase.attempts;
    if (phase.id === 'precheck') return ['次数未记录'];
    if (phase.id === 'review') return phase.attempts.slice(0, Math.max(1, reviewPassCount));
    return phase.attempts;
  };

  const keyMoments: KeyMoment[] = [];
  const addMoment = (source: EventRecord[], who: string, summary: string, effect: string, momentResult: string) => source.length && keyMoments.push({ id: source.map(item => item.sequence).join('-'), who, summary, effect, result: momentResult, sequences: source.map(item => item.sequence) });
  addMoment(enterEvent ? [enterEvent] : [], enterEvent?.actor?.id === 'risk' ? '风控人员' : '业务人员', enterEvent?.type === 'RiskDecisionReconsidered' ? '基于前一决定发起重新审查' : '提交材料并发起风险审查', `第 ${round?.number ?? '—'} 轮开始`, '新的审查轮次');
  addMoment(communicatedEvent ? [communicatedEvent] : [], '风控人员', '提出需要补充材料的要求', '进入待补证状态', '补证要求');
  addMoment(answeredEvent ? [answeredEvent, ...(snapshotEvent ? [snapshotEvent] : [])] : [], '业务人员与规则系统', '回答补证要求并形成新判断快照', '补充材料进入当前轮次', '新的不可变判断快照');
  addMoment(resolvedEvent ? [resolvedEvent] : [], '风控人员', '确认补证完成', '审查可以继续', '已解决的补证要求');
  addMoment(advisoryEvent ? [advisoryEvent] : [], '智能模型', '生成仅供参考的建议', '最终决定权保持在人', '智能建议记录');
  addMoment(decisionEvent ? [decisionEvent] : [], '风控人员', `记录最终${statusText(decision?.outcome)}`, '当前轮次完成决定', '最终决定记录');

  const executeCommand = async (command: string, payload: Record<string, unknown>, actor = 'business', capability = 'submit') => {
    if (!thread) return;
    setBusy(true); setError(''); setResult('');
    try {
      const response = await fetch(`${serviceBase}/api/projects/${projectId}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command, payload, envelope: { actor: { id: actor, class: 'human' }, capability, idempotencyKey: `front-${crypto.randomUUID()}`, requestHash: await makeHash(payload), expectedVersion: thread.version } }) });
      const body = await response.json() as { error?: { code?: string } };
      if (!response.ok) {
        const code = body.error?.code || `HTTP_${response.status}`;
        setResult('操作被拒绝，请展开技术明细查看原因'); setError(code);
        if (code === 'ADVISORY_UNAVAILABLE') setManualReview(true);
        return;
      }
      setResult('操作已被后端接受'); await load();
    } catch (reason: unknown) {
      const code = errorCode(reason); setResult('操作被拒绝，请展开技术明细查看原因'); setError(code);
    } finally { setBusy(false); }
  };

  const sendAction = async (outcome?: 'pass' | 'veto') => {
    if (!thread) return;
    const [command, actor, capability] = action;
    let payload: Record<string, unknown> = { threadId: thread.id };
    if (command === 'communicateRiskChallenge') payload = { ...payload, reviewRoundId: round?.id, prompt: challengePrompt || '请补充材料', mandatory: true, challengeId: null };
    if (command === 'answerChallenge') payload = { ...payload, reviewRoundId: round?.id, challengeId: challenge?.id, answer, evidence: [answerEvidence], messageRefs: [] };
    if (command === 'resolveRiskChallenge') payload = { ...payload, reviewRoundId: round?.id, challengeId: challenge?.id };
    if (command === 'invokeDeterministicAdvisory') payload = { ...payload, reviewRoundId: round?.id, snapshotId: currentSnapshot?.id, instruction: '请审核', citations: currentSnapshot?.evidence || [], agentId: 'synthetic-agent' };
    if (command === 'recordRiskDecision') payload = { ...payload, reviewRoundId: round?.id, snapshotId: currentSnapshot?.id, outcome, rationale: '风险人员人工审查' };
    if (command === 'reconsiderRiskDecision') payload = { threadId: thread.id, decisionId: decision?.id };
    await executeCommand(command, payload, actor, capability);
  };

  if (!state) return <main className="loading-shell"><strong>TAG</strong><span>正在加载审查状态…</span></main>;

  const currentResponsibility = action[1] === 'risk' ? '风控人员' : '业务人员';
  const previousSnapshot = roundSnapshots.at(-2);
  const latestSnapshot = roundSnapshots.at(-1);
  const previousEvidence = previousSnapshot?.evidence?.map(evidenceId) ?? [];
  const latestEvidence = latestSnapshot?.evidence?.map(evidenceId) ?? [];
  const addedEvidence = latestEvidence.filter(id => !previousEvidence.includes(id)).length;

  return <main className="screen-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">T</span><span>TAG 风险审查台</span></div><div className="connection-badge"><span />{connection}</div></header>
    <section className="summary-strip"><div><small>当前轮次</small><strong>第 {round?.number ?? '—'} 轮风险审查</strong></div><div><small>当前状态</small><strong>{statusText(round?.status)}</strong></div><div><small>当前责任方</small><strong>{currentResponsibility}</strong></div><div className="authority"><small>最终决定权</small><strong>只由风控人员记录通过或否决</strong></div></section>
    {result && <p className="result-banner">{result}</p>}{error && <p className="error-banner">请求被拒绝，未创建本地成功记录。</p>}

    <section className="track-card"><div className="track-toolbar"><div><strong>四泳道三阶段审查轨道</strong><span>每个次数／轮次都是独立的输入 → 模型 → 规则 → 输出接力簇</span></div><div className="view-toggle" aria-label="流程视图"><button className={viewMode === 'case' ? 'active' : ''} aria-pressed={viewMode === 'case'} onClick={() => setViewMode('case')}>当前案件</button><button className={viewMode === 'blueprint' ? 'active' : ''} aria-pressed={viewMode === 'blueprint'} onClick={() => setViewMode('blueprint')}>完整流程</button></div></div><div className="track-scroll"><div className="track-canvas"><div className="phase-row"><span>阶段</span>{phases.map(phase => <button key={phase.id} className={`${visiblePhase === phase.id ? 'selected' : ''} ${currentPhase === phase.id ? 'current' : ''}`} aria-pressed={visiblePhase === phase.id} onClick={() => setSelectedPhase(phase.id)}><b>{phase.label}</b><small>{phase.weight} · {phase.id === 'precheck' && viewMode === 'case' ? '能力上限三次／真实次数未记录' : phase.attempts.join('／')}</small></button>)}</div><div className="attempt-row"><span />{phases.map(phase => { const attempts = visibleAttempts(phase); return <div className={`attempts count-${attempts.length}`} key={phase.id}>{attempts.map(attempt => <b key={attempt}>{attempt}</b>)}</div>; })}</div><div className="flow-field"><div className="lane-labels">{dimensions.map((lane, laneIndex) => <div className={`lane-label lane-${laneIndex}`} key={lane}><b>{lane}</b><small>{lane === '输入' ? '业务与材料' : lane === '规则' ? '确定性控制' : lane === '模型' ? '仅供参考' : '风控终决'}</small></div>)}</div><div className="flow-board"><div className="lane-bands" aria-hidden="true">{dimensions.map((lane, laneIndex) => <span className={`lane-band lane-${laneIndex}`} key={lane} />)}</div>{phases.map(phase => { const attempts = visibleAttempts(phase); return <div className={`phase-clusters count-${attempts.length} ${visiblePhase === phase.id ? 'focused' : ''}`} key={phase.id}>{attempts.map((attemptLabel, attempt) => <article className="attempt-cluster" key={`${phase.id}-${attemptLabel}`}><span className="cluster-label">{attemptLabel}</span><i className="cluster-link link-input-model" aria-hidden="true" /><i className="cluster-link link-model-rule" aria-hidden="true" /><i className="cluster-link link-rule-output" aria-hidden="true" />{dimensions.map((lane, laneIndex) => { const node = trackNodes.find(item => item.phase === phase.id && item.lane === lane && item.attempt === attempt); if (!node) return null; const visibility = node.occurred ? 'occurred' : viewMode === 'blueprint' ? 'optional' : 'absent'; return <span className={`cluster-node node-${laneIndex} lane-${laneIndex} ${visibility} ${currentPhase === phase.id && node.occurred ? 'current-node' : ''}`} key={lane}><b>{node.label}</b><small>{node.occurred ? node.note : viewMode === 'blueprint' ? '可选／未发生' : node.note}</small></span>; })}{attempt < attempts.length - 1 && <span className="feedback-loop" aria-label={`${attemptLabel}输出返回下一次输入`}><small>补证返回</small></span>}</article>)}</div>; })}<span className="phase-advance advance-review" aria-label="预审进入正审" /><span className="phase-advance advance-decision" aria-label="正审汇聚到决定" /></div></div><div className="snapshot-alignment"><div className="snapshot-label"><b>真实快照</b><small>后端不可变记录</small></div><div className="snapshot-phase snapshot-precheck"><span>{viewMode === 'blueprint' ? '结构说明：预审可产生材料版本，但不是当前后端权威快照' : '预审次数未记录，不虚构判断快照'}</span></div><div className={`snapshot-phase snapshot-review count-${Math.max(1, Math.min(3, roundSnapshots.length))}`}>{roundSnapshots.length ? roundSnapshots.map((snapshot, index) => { const prior = roundSnapshots[index - 1]; const priorIds = prior?.evidence?.map(evidenceId) ?? []; const ids = snapshot.evidence?.map(evidenceId) ?? []; const delta = ids.filter(id => !priorIds.includes(id)).length; return <article className="snapshot-card" key={snapshot.id}><b>真实判断快照 {index + 1}</b><span>材料 {ids.length} 项 · 新增 {index ? delta : ids.length} 项</span><span>置信度 {snapshot.evidenceConfidence ?? '暂无'} · 补证 {snapshot.challengeState?.map(item => statusText(item.status)).join('、') || '无'}</span>{artifact?.snapshotId === snapshot.id && <em>绑定仅供参考的建议</em>}{decision?.snapshotId === snapshot.id && <em>绑定风控决定：{statusText(decision.outcome)}</em>}</article>; }) : <span>暂无真实判断快照</span>}</div><div className="snapshot-phase snapshot-decision"><span>{decision && currentSnapshot ? '决定复用最新真实快照，不生成决定专属新快照' : '尚未形成最终决定绑定'}</span></div></div></div></div></section>

    <section className="explain-strip"><div><small>谁参与</small><strong>{explanation.who}</strong></div><div><small>实际动作</small><strong>{explanation.what}</strong></div><div><small>使用材料</small><strong>{explanation.input}</strong></div><div><small>状态影响</small><strong>{explanation.effect}</strong></div><div><small>下一步</small><strong>{explanation.next}</strong></div></section>

    <section className="action-strip"><div><small>下一项允许操作</small><strong>{action[3]}</strong><span>{manualReview ? '智能建议不可用，已转人工审查；决定仍需后端确认。' : '输出不是模型自动审批。'}</span></div>{action[0] === 'recordRiskDecision' ? <div className="action-buttons"><button onClick={() => void sendAction('pass')} disabled={busy}>通过</button><button onClick={() => void sendAction('veto')} disabled={busy}>否决</button></div> : ['answerChallenge', 'communicateRiskChallenge'].includes(action[0]) ? <span className="detail-hint">请在下方“协作与操作”中填写材料</span> : <button onClick={() => void sendAction()} disabled={busy}>{busy ? '处理中…' : action[3]}</button>}</section>

    <section className="compact-bottom"><article className="moments-compact"><header><div><small>当前轮次关键时刻</small><strong>{Math.min(keyMoments.length, 5)} 个</strong></div><span>原始日志仍在折叠的技术明细中</span></header><ol>{keyMoments.slice(-5).map(moment => <li key={moment.id}><b>{moment.who}</b><span>{moment.summary}</span><small>来源事件 {moment.sequences.map(sequence => `#${sequence}`).join('、')}</small></li>)}</ol><p>最新快照差异：新增材料 {addedEvidence} 项；置信度 {previousSnapshot?.evidenceConfidence ?? '暂无'} → {latestSnapshot?.evidenceConfidence ?? '暂无'}。</p></article></section>

    <details className="operations details-card"><summary>协作记录与操作</summary><div className="details-body"><section><h3>真实协作记录</h3>{thread?.messages.map(item => <p key={item.id}>{item.sequence} · 业务消息：{item.content}</p>)}{roundChallenges.map(item => <p key={item.id}>风控补证要求：{item.prompt || '暂无说明'} · {statusText(item.status)}</p>)}{roundArtifacts.map(item => <p key={item.id}>智能建议：仅供参考</p>)}{roundDecisions.map(item => <p key={item.id}>最终决定：{statusText(item.outcome)}</p>)}</section><section className="form-grid"><label>业务消息<textarea value={message} onChange={event => setMessage(event.target.value)} /></label><button onClick={() => void executeCommand('appendHumanMessage', { threadId: thread?.id, content: message, replyToMessageId: null, citations: [] }, 'business', 'message')} disabled={busy || !thread || !message}>发送消息</button><label>材料标题<input value={evidence.title} onChange={event => setEvidence({ ...evidence, title: event.target.value })} /></label><label>材料位置<input value={evidence.locator} onChange={event => setEvidence({ ...evidence, locator: event.target.value })} /></label><label>材料内容<textarea value={evidence.content} onChange={event => setEvidence({ ...evidence, content: event.target.value })} /></label><button onClick={() => void executeCommand('addEvidence', { threadId: thread?.id, ...evidence }, 'business', 'addEvidence')} disabled={busy || !thread || !evidence.title || !evidence.locator || !evidence.content}>添加材料</button><label>补证要求<input value={challengePrompt} onChange={event => setChallengePrompt(event.target.value)} /></label>{action[0] === 'communicateRiskChallenge' && <button onClick={() => void sendAction()} disabled={busy}>提出补证要求</button>}<label>补证回答<textarea value={answer} onChange={event => setAnswer(event.target.value)} /></label><label>补证标题<input value={answerEvidence.title} onChange={event => setAnswerEvidence({ ...answerEvidence, title: event.target.value })} /></label><label>补证位置<input value={answerEvidence.locator} onChange={event => setAnswerEvidence({ ...answerEvidence, locator: event.target.value })} /></label><label>补证内容<textarea value={answerEvidence.content} onChange={event => setAnswerEvidence({ ...answerEvidence, content: event.target.value })} /></label>{action[0] === 'answerChallenge' && <button onClick={() => void sendAction()} disabled={busy || !answer || !answerEvidence.title || !answerEvidence.locator || !answerEvidence.content}>回答并补证</button>}</section></div></details>

    <details className="technical details-card"><summary>技术明细</summary><div className="details-body technical-body"><section><h3>字段与控制说明</h3><p>命令：{action[0]}（后端允许的下一项操作）</p><p>状态：{round?.status || 'none'}（审查轮次枚举）</p><p>最近错误：{error || 'none'}（稳定错误码）</p><p>策略：只有 risk/decide 可写入 pass 或 veto；模型输出必须 advisoryOnly。</p><p>测试边界：拒绝请求不得创建本地成功记录。</p></section><section><h3>原始事件</h3><ol>{events.map(item => <li key={item.sequence}>#{item.sequence} · {item.type} · {item.actor?.id || 'system'}</li>)}</ol></section><section><h3>关系图</h3><ul>{graph.nodes.map(node => <li key={node.id}>{node.type} · {node.label} · {node.id}</li>)}</ul><ul>{graph.edges.map(edge => <li key={edge.id}>{edge.source} → {edge.target} · {edge.type}</li>)}</ul></section></div></details>
  </main>;
}
