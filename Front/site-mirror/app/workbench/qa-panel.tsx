// goal-03d 问题·补证面板：检查会话问答（A 会话面）+ 处理通道补证问题（Connectors prepared
// questions——IR-02-C 消费面，含回答与获准复核 verified 唯一来源）。上游事实：A 会话快照只含
// openQuestions 计数与 next-actions（IR-03-6 已登记）——A 侧只展示服务端 next-actions/计数 +
// 本会话内创建的问题；通道问题列表为服务端权威面，如实分列显示，不互相冒充。
import { useCallback, useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { canAnswerQuestion, DEMO_TENANT, errorText, wbActionRequestId } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';

interface LocalQuestion {
  questionId: string;
  purpose: string;
  audience: 'customer' | 'internal';
  targetRole: string;
  answered: boolean;
  answerText?: string;
}

interface NextActionRow { title?: string; needRole?: string; detail?: string }

export function QaPanel({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const client = wb.client;
  const session = wb.snapshot?.session ?? null;
  const sessionId = session?.sessionId;
  const myRoles = wb.session?.roles ?? [];
  const [purpose, setPurpose] = useState('');
  const [audience, setAudience] = useState<'customer' | 'internal'>('customer');
  const [targetRole, setTargetRole] = useState('customer_owner');
  const [mine, setMine] = useState<LocalQuestion[]>([]);
  const [nextActions, setNextActions] = useState<NextActionRow[] | null>(null);
  const [channelQuestions, setChannelQuestions] = useState<Array<Record<string, unknown>>>([]);
  const [channelErr, setChannelErr] = useState<string | null>(null);
  const act = useAction();

  const loadChannelQuestions = useCallback(async () => {
    if (!client) return;
    try {
      const j = await client.channelStatus(customerId);
      setChannelQuestions((j.questions ?? []) as Array<Record<string, unknown>>);
      setChannelErr(null);
    } catch (e) {
      setChannelQuestions([]);
      setChannelErr(errorText((e as { code?: string }).code, '处理通道问题读取失败（通道未接入时如实显示）'));
    }
  }, [client, customerId]);

  useEffect(() => { void loadChannelQuestions(); }, [loadChannelQuestions, wb.snapshotVersion]);

  const answerChannelQuestion = (q: Record<string, unknown>, text: string) => {
    if (!client) return;
    const key = String(q.question_key ?? '');
    if (!text || !text.trim()) return;
    const requestId = wbActionRequestId('wb-chans', customerId, `ans:${key}`, String(Date.now()));
    act.open(
      { title: '回答处理通道问题', lines: [`问题：${String(q.note ?? key)}`, `回答：${text.trim()}`], confirmLabel: '提交回答' },
      async () => {
        await client.channelAction('questions/answer', {
          requestId, tenantId: DEMO_TENANT, customerId, questionKey: key, answerText: text.trim(),
          answerer: wb.session?.principalId ?? 'unknown',
        });
        await loadChannelQuestions();
      },
    );
  };

  const verifyChannelQuestion = (q: Record<string, unknown>, note: string) => {
    if (!client) return;
    const key = String(q.question_key ?? '');
    if (!note || !note.trim()) return;
    const requestId = wbActionRequestId('wb-chvfy', customerId, `vfy:${key}`, String(Date.now()));
    act.open(
      { title: '人工复核通道事实（获准复核）', lines: [`问题：${String(q.note ?? key)}`, `复核意见：${note.trim()}`, '复核人与意见进入通道留痕；该操作产生 verified 等级。'], confirmLabel: '确认复核' },
      async () => {
        await client.channelAction('questions/verify', {
          requestId, tenantId: DEMO_TENANT, customerId, questionKey: key, verifiedBy: wb.session?.principalId ?? 'unknown', note: note.trim(),
        });
        await loadChannelQuestions();
      },
    );
  };

  const loadNextActions = useCallback(async () => {
    if (!client || !sessionId) { setNextActions(null); return; }
    try {
      const j = await client.read(`/api/jw/v2/inspections/${encodeURIComponent(sessionId)}/next-actions`);
      setNextActions((Array.isArray(j.nextActions) ? j.nextActions : (j.actions ?? [])) as NextActionRow[]);
    } catch {
      setNextActions(null); // 缺口如实：无 next-actions 时只显示计数，不伪造
    }
  }, [client, sessionId]);

  useEffect(() => { void loadNextActions(); }, [loadNextActions, wb.snapshotVersion]);

  if (!client) return null;

  const ask = () => {
    if (!sessionId || !purpose.trim()) return;
    act.open(
      {
        title: '提出问题（进入检查会话）',
        lines: [
          `内容：${purpose.trim()}`,
          `受众：${audience === 'customer' ? '对客户（客户侧可见）' : '内部（协作可见）'}`,
          `期望回答角色：${targetRole}`,
          '同键问题合并；回答≠材料取得≠核验完成。',
        ],
        confirmLabel: '提出',
      },
      async () => {
        const r = await client.action<{ ok: boolean; questionId?: string; question?: { questionId?: string } }>(
          `/api/jw/v2/actions/inspections/${encodeURIComponent(sessionId)}/questions`,
          { requestId: `wb-q-${sessionId}-${Date.now()}`.slice(0, 128), question: purpose.trim(), audience, targetRole, requiresHuman: true, tenantId: DEMO_TENANT, expectedVersion: session.version },
        );
        const qid = r.questionId ?? r.question?.questionId;
        if (qid) {
          const entry: LocalQuestion = { questionId: qid, purpose: purpose.trim(), audience, targetRole, answered: false };
          setMine((prev) => [entry, ...prev.filter((m) => m.questionId !== qid)]);
        }
        setPurpose('');
        await wb.refresh();
      },
    );
  };

  const answer = (q: LocalQuestion) => {
    if (!sessionId) return;
    const text = window.prompt('回答内容（进入后台记录；人工权威）：');
    if (!text || !text.trim()) return;
    act.open(
      { title: '提交回答', lines: [`问题：${q.purpose}`, `回答：${text.trim()}`], confirmLabel: '提交回答' },
      async () => {
        await client.action(`/api/jw/v2/actions/inspections/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(q.questionId)}/answer`, {
          requestId: `wb-ans-${q.questionId}-${Date.now()}`.slice(0, 128),
          answer: { text: text.trim() },
          expectedVersion: session.version,
        });
        setMine((prev) => prev.map((m) => (m.questionId === q.questionId ? { ...m, answered: true, answerText: text.trim() } : m)));
        await wb.refresh();
      },
    );
  };

  const sessionAction = (verb: 'start' | 'pause' | 'resume' | 'takeover' | 'end') => {
    if (!sessionId) return;
    const titles: Record<string, string> = { start: '开始检查会话', pause: '暂停自动提问', resume: '恢复调度', takeover: '人工接管', end: '结束会话并收口' };
    const notes: Record<string, string> = {
      start: '开始后进入进行中：可提问、收集材料与核验。',
      pause: '暂停后不再有新的自动外发提问；在途授权单独列明、unknown 须对账。',
      resume: '恢复自动调度（按服务代际推进）。',
      takeover: '接管后由人工主导提问与外发授权。',
      end: '结束会话：服务端按事项完成度收口（ready_for_assessment=可进入评估；缺口如实列出）。收口修订将冻结进依据包。',
    };
    act.open(
      {
        title: titles[verb],
        lines: [notes[verb]],
        confirmLabel: '确认',
      },
      async () => {
        await client.action(`/api/jw/v2/actions/inspections/${encodeURIComponent(sessionId)}/${verb}`, {
          requestId: `wb-${verb}-${sessionId}-${Date.now()}`.slice(0, 128),
          expectedVersion: session.version,
        });
        await wb.refresh();
      },
    );
  };

  const outboundPaused = session?.outbound?.paused === true;

  return (
    <div>
      <h3 className="wb-h2">检查会话（服务端 runStatus/closureStatus 权威）</h3>
      {!session && (
        <div className="wb-card dim">
          <p className="wb-note">当前窗口内无检查会话：会话由建档/部署种子场景创建（检查会话挂在 v1 项目下），页面不伪造会话。</p>
        </div>
      )}
      {session && sessionId && (
        <>
          <div className="wb-card">
            <div className="wb-row">
              <span className="wb-badge live">会话 {sessionId.slice(0, 18)}…</span>
              <span>运行：{session.runStatus ?? '—'}</span>
              <span>收口：{session.closureStatus ?? '—'}</span>
              <span>开放问题：{session.openQuestions ?? 0}</span>
              {outboundPaused && <span className="wb-badge off">自动提问已暂停</span>}
              {(session.outbound?.inFlight?.length ?? 0) > 0 && (
                <span className="wb-sub">在途外发 {session.outbound?.inFlight?.length}（unknown 须对账）</span>
              )}
            </div>
            <div className="wb-actions">
              {session.runStatus === 'preparing' && (
                <button className="wb-btn small" onClick={() => sessionAction('start')}>开始会话</button>
              )}
              <button className="wb-btn small ghost" onClick={() => sessionAction('pause')} disabled={outboundPaused}>暂停自动提问</button>
              <button className="wb-btn small ghost" onClick={() => sessionAction('resume')} disabled={!outboundPaused}>恢复调度</button>
              <button className="wb-btn small ghost" onClick={() => sessionAction('takeover')}>人工接管</button>
              {(session.runStatus === 'in_progress' || session.runStatus === 'suspended') && session.closureStatus !== 'closed' && (
                <button className="wb-btn small" onClick={() => sessionAction('end')}>结束会话（收口）</button>
              )}
              <button className="wb-btn small ghost" onClick={() => void loadNextActions()}>刷新下一步</button>
            </div>
          </div>

          <h3 className="wb-h2" style={{ marginTop: 12 }}>下一步（服务端 next-actions：等待谁做什么）</h3>
          {nextActions === null && <p className="wb-note">（无下一步数据：会话未开始或已收口）</p>}
          {nextActions !== null && nextActions.length === 0 && <p className="wb-note">无缺口待办。</p>}
          {nextActions !== null && nextActions.slice(0, 8).map((a, i) => (
            <div key={i} className="wb-card dim">
              <div className="wb-row">
                <span><span className={`wb-dot ${a.needRole ? 'blue' : 'gray'}`} aria-hidden="true" />{a.title ?? a.detail ?? '等待中'}</span>
                {a.needRole && <span className="wb-sub">等待角色：{a.needRole}</span>}
              </div>
            </div>
          ))}

          <h3 className="wb-h2" style={{ marginTop: 12 }}>本会话提出的问题（可回答/已答）</h3>
          {mine.length === 0 && <p className="wb-note">本会话尚未提问。问题明细列表端点待上游（IR-03-6）：此前问题请经会话记录/待办处理。</p>}
          {mine.map((q) => (
            <div key={q.questionId} className={`wb-card ${q.answered ? 'good' : ''}`}>
              <div className="wb-row">
                <span className={`wb-badge ${q.audience === 'customer' ? 'demo' : ''}`}>{q.audience === 'customer' ? '对客户' : '内部'}</span>
                <span className="wb-sub">期望回答：{q.targetRole}</span>
              </div>
              <div>{q.purpose}</div>
              {q.answerText && <div className="wb-note">回答：{q.answerText}</div>}
              {!q.answered && canAnswerQuestion(myRoles, q.targetRole) && (
                <div className="wb-actions"><button className="wb-btn small" onClick={() => answer(q)}>回答（角色匹配 {q.targetRole}）</button></div>
              )}
              {!q.answered && !canAnswerQuestion(myRoles, q.targetRole) && (
                <div className="wb-note">等待 {q.targetRole} 回答（我的角色：{myRoles.join('/') || '无'}；服务端强制校验）</div>
              )}
            </div>
          ))}

          <div className="wb-card dim">
            <h3 className="wb-h2">提出新问题</h3>
            <div className="wb-field"><label>问题内容</label>
              <textarea className="wb-textarea" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="需要谁补充或澄清什么（业务语言）" />
            </div>
            <div className="wb-row">
              <div className="wb-field" style={{ width: 140 }}><label>受众</label>
                <select className="wb-select" value={audience} onChange={(e) => setAudience(e.target.value as 'customer' | 'internal')}>
                  <option value="customer">对客户</option><option value="internal">内部</option>
                </select>
              </div>
              <div className="wb-field" style={{ width: 200 }}><label>期望回答角色</label>
                <select className="wb-select" value={targetRole} onChange={(e) => setTargetRole(e.target.value)}>
                  <option value="customer_owner">客户·实控人</option>
                  <option value="plant_manager">客户·厂长</option>
                  <option value="customer_finance">客户·财务</option>
                  <option value="business">业务（我方）</option>
                  <option value="policy">政策域</option>
                  <option value="credit">信审域</option>
                  <option value="commerce">商务域</option>
                  <option value="asset">资产域</option>
                </select>
              </div>
              <button className="wb-btn" onClick={ask} disabled={!sessionId}>提出</button>
            </div>
            {act.node}
          </div>
        </>
      )}
      <h3 className="wb-h2" style={{ marginTop: 12 }}>处理通道补证问题（服务端 prepared_questions · IR-02-C）</h3>
      <WbError error={channelErr} onDismiss={() => setChannelErr(null)} />
      {channelQuestions.length === 0 && <p className="wb-note">通道内暂无补证问题（无处理任务或问题已收口）。</p>}
      {channelQuestions.map((q) => {
        const status = String(q.status ?? '');
        const actionable = status === 'open' || status === 'suggested';
        const key = String(q.question_key ?? '');
        return (
          <div key={key} className={`wb-card ${actionable ? '' : 'good'}`}>
            <div className="wb-row">
              <span className={`wb-badge ${actionable ? 'off' : 'live'}`}>{status === 'open' || status === 'suggested' ? '待处理（' + status + '）' : status === 'answered' ? '已回答' : status === 'verified' ? '已复核（verified）' : status}</span>
              <span className="wb-sub">层级 {String(q.tier ?? '—')}{q.target_fact ? ` · 目标事实 ${String(q.target_fact).slice(0, 20)}…` : ''}</span>
            </div>
            <div>{String(q.note ?? key)}</div>
            {actionable && <ChannelQuestionActions q={q} onAnswer={(t) => answerChannelQuestion(q, t)} onVerify={(n) => verifyChannelQuestion(q, n)} />}
          </div>
        );
      })}
      {act.node}
      <WbError error={null} />
    </div>
  );
}

// 通道问题行内操作：回答文本与复核意见行内填写（不弹浏览器原生框；获准复核必填意见）。
function ChannelQuestionActions({ q, onAnswer, onVerify }: {
  q: Record<string, unknown>;
  onAnswer: (text: string) => void;
  onVerify: (note: string) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  return (
    <div>
      <div className="wb-row">
        <input className="wb-input" style={{ flex: 1 }} value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder="回答内容（进入通道留痕；回答≠材料取得≠核验完成）" aria-label="回答内容" />
        <button className="wb-btn small" disabled={!answer.trim()} onClick={() => { onAnswer(answer); setAnswer(''); }}>提交回答</button>
      </div>
      <div className="wb-row">
        <input className="wb-input" style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="复核意见（必填；verified 只能由获准复核产生）" aria-label="复核意见" />
        <button className="wb-btn small ghost" disabled={!note.trim()} onClick={() => { onVerify(note); setNote(''); }}>人工复核（获准）</button>
      </div>
    </div>
  );
}
