import io
p='site-mirror/app/takeoff/takeoff-screen.tsx'
s=io.open(p,encoding='utf-8').read()

old="import { deriveTakeoffCells, deriveTakeoffTop, takeoffDomainName, takeoffRowName } from '../../lib/workbench/takeoff-projection';"
new="import { CONFIRM_OUTCOME_LABEL, deriveTakeoffCells, deriveTakeoffTop, takeoffDomainName, takeoffRowName } from '../../lib/workbench/takeoff-projection';"
assert old in s, 'import'
s=s.replace(old,new)

i=s.index('function EndDialog({ wb, top, onClose, act }: {')
new_end='''type ConfirmOutcome = 'support' | 'support_with_conditions' | 'not_support';

function EndDialog({ wb, top, onClose, act }: {
  wb: WbApi;
  top: ReturnType<typeof deriveTakeoffTop>;
  onClose: () => void;
  act: ReturnType<typeof useAction>;
}) {
  const client = wb.client;
  const customerId = wb.customerId ?? '';
  const a = top.assessment;
  const confirmed = top.confirmed;
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null);
  const [rationale, setRationale] = useState('');
  const [conditions, setConditions] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);

  // 状态门只做诚实提示（页面不提权、不替服务端裁决）：正/附条件须 awaiting_human_review 且无未解冲突；
  // not_support 允许 collecting/candidate_ready/awaiting_human_review（有依据的负面终结不被冻结阻断）。
  const statusGate = (o: ConfirmOutcome): { ok: boolean; why: string } => {
    if (confirmed) return { ok: false, why: '预评估结论已确认为终态：不可重复确认（撤回同样不再受理，服务端 NOT_READY）' };
    if (!client || !a.id || a.version == null) return { ok: false, why: '评估或版本信息未知：请刷新页面后重试' };
    if (o === 'not_support') {
      const ok = ['collecting', 'candidate_ready', 'awaiting_human_review'].includes(a.status ?? '');
      return { ok, why: ok ? '' : `评估当前 ${a.status ?? '未知'}：已终结/已确认，不可再记录负面结论` };
    }
    if (a.status !== 'awaiting_human_review') {
      return { ok: false, why: `评估当前 ${a.status ?? '未知'}：正/附条件确认前须先提交人工审阅（方案·决定页「提交复核」；服务端 NOT_READY 同口径）` };
    }
    if (a.stale || top.changedDomains.length > 0 || top.factConflicts > 0) {
      return { ok: false, why: '存在依据变化/未解决事实冲突：先按待办补证、更新域结论（服务端 STALE_BASIS/REVIEW_REQUIRED 同口径；不可豁免门不能一键解除）' };
    }
    return { ok: true, why: '' };
  };

  const withdrawGate = confirmed
    ? { ok: false, why: '已确认的预评估结论为终态：行政撤回不再受理（服务端 NOT_READY）' }
    : { ok: Boolean(a.id) && Boolean(client), why: a.id ? '' : '尚无在册评估可撤回' };

  const submit = (o: ConfirmOutcome) => {
    if (!client || !a.id || a.version == null) return;
    if (!rationale.trim()) { setLocalErr('确认理由（rationale）必填：记录当前版本结论的依据（正式性属人）。'); return; }
    const conds = conditions.split('\\n').map((x) => x.trim()).filter(Boolean);
    if (o === 'support_with_conditions' && conds.length === 0) { setLocalErr('附条件支持必须至少给出一条条件（服务端同口径拒绝）。'); return; }
    const requestId = wbActionRequestId('tk-confirm', customerId, `confirm:${o}`, String(Date.now()));
    act.open(
      {
        title: `确认：预评估结论——${CONFIRM_OUTCOME_LABEL[o]}`,
        lines: [
          `评估：${a.id}（版本 v${a.version}${a.candidateRevision != null ? ` · 候选 r${a.candidateRevision}` : ' · 无候选'}${a.inputVersion != null ? ` · 输入 v${a.inputVersion}` : ''}）`,
          `客户：${top.customer.displayName ?? '—'}（${top.customer.customerId ?? '—'}）`,
          o === 'support_with_conditions' ? `条件（${conds.length} 条）：${conds.join('；')}` : '条件：无（附条件只属于 support_with_conditions）',
          `结论依据：${rationale.trim().slice(0, 80)}${rationale.trim().length > 80 ? '…' : ''}`,
          'scope=preassessment_only：不创建/激活/预占任何额度、不建融资申请、不写敞口账本（服务端机器断言零变化）',
          '确认权=服务端目录 credit 角色（服务端重查人类身份与版本/硬门；无权限将得到业务语言拒绝）',
        ],
        confirmLabel: '确认预评估结论',
        requestId,
      },
      async () => {
        await client.confirmPreassessment(a.id, {
          requestId,
          outcome: o,
          assessmentVersion: a.version,
          ...(a.candidateRevision != null ? { candidateRevision: a.candidateRevision } : {}),
          ...(o === 'support_with_conditions' ? { conditions: conds } : {}),
          rationale: rationale.trim(),
        });
        await wb.refresh();
        onClose();
      },
    );
  };

  const withdraw = () => {
    if (!client || !a.id) return;
    const requestId = wbActionRequestId('tk-end', customerId, 'withdraw_assessment', String(Date.now()));
    act.open(
      {
        title: '确认：行政撤回本轮首次预评估',
        lines: [
          `对象：评估 ${a.id.slice(0, 22)}…（客户 ${customerId.slice(0, 16)}…）`,
          '语义：客户撤回=行政结束（superseded），不伪装风险拒绝，不删除客户档案与历史',
          '撤回不产生/不修改任何正式授信设施、融资申请或敞口账本',
        ],
        confirmLabel: '确认撤回本轮',
        requestId,
      },
      async () => {
        await client.action(`/api/jw/v2/actions/assessments/${encodeURIComponent(a.id!)}/decide`, {
          requestId, tenantId: 't1', decision: 'withdraw_assessment',
        });
        await wb.refresh();
        onClose();
      },
    );
  };

  const gates: Array<{ o: ConfirmOutcome; label: string; hint: string }> = [
    { o: 'support', label: '支持（正面预评估结论）', hint: '绑定当前候选修订与评估版本；快照内不得有未解决冲突' },
    { o: 'support_with_conditions', label: '附条件支持（调整条件后支持）', hint: '必须至少给出一条条件（服务端同口径拒绝）' },
    { o: 'not_support', label: '不支持（有依据的负面预评估结论）', hint: '负面终结不要求无价值工作刷绿；不适用正面硬门' },
  ];

  return (
    <div className="wb-dialog" role="dialog" aria-modal="true" aria-label="结束本次预评估（受控结论确认）">
      <div className="box" style={{ maxWidth: 620 }}>
        <h3>结束本次评估：受控预评估结论确认</h3>
        <ul>
          <li>客户：{top.customer.displayName ?? '—'}（{top.customer.customerId ?? '—'}）</li>
          <li>当前候选：{top.suggestedAmount.text}{top.suggestedTerm.text !== '待评估' ? ` · ${top.suggestedTerm.text}` : ''}（金额/期限/价格绑定同一方案版本{a.candidateRevision != null ? `，候选 r${a.candidateRevision}` : ''}）</li>
          <li>{top.suggestedAmount.note}</li>
        </ul>
        {confirmed && (
          <div className={`wb-card ${confirmed.needsReview ? 'bad' : 'good'}`} role="status">
            <div className="wb-kv"><span className="k">已确认结论</span><span>{confirmed.outcomeLabel}（{confirmed.confirmationId ?? 'confirmationId 未知'}）</span></div>
            <div className="wb-kv"><span className="k">确认人/时间</span><span>{confirmed.confirmedBy ?? '有权人'}{confirmed.confirmedAt ? ` · ${new Date(confirmed.confirmedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span></div>
            {confirmed.conditions.length > 0 && <div className="wb-kv"><span className="k">条件</span><span>{confirmed.conditions.join('；')}</span></div>}
            {confirmed.needsReview && <div className="wb-kv"><span className="k">需复核</span><span>{confirmed.reviewReason ?? '确认依据被取代'}（旧确认保留，只显示需复核，不默认重开）</span></div>}
          </div>
        )}
        <div className="tk-end-choices" role="group" aria-label="预评估结论">
          {gates.map((g) => {
            const gate = statusGate(g.o);
            const active = outcome === g.o;
            return (
              <div key={g.o} className="tk-end-choice" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{g.label}<span className="why" style={{ marginLeft: 8 }}>{g.hint}</span></span>
                  <button
                    className="tk-btn small"
                    disabled={!gate.ok}
                    title={gate.ok ? '' : gate.why}
                    onClick={() => { setOutcome(active ? null : g.o); setLocalErr(null); }}
                  >{active ? '收起' : '发起确认'}</button>
                </div>
                {!gate.ok && <div className="why">{gate.why}</div>}
                {active && gate.ok && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <textarea
                      className="wb-textarea"
                      rows={2}
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                      placeholder="确认理由（rationale，必填）：当前版本结论依据哪些材料/事实/域结论"
                      aria-label="确认理由"
                    />
                    {g.o === 'support_with_conditions' && (
                      <textarea
                        className="wb-textarea"
                        rows={2}
                        value={conditions}
                        onChange={(e) => setConditions(e.target.value)}
                        placeholder={'放款前提条件（每行一条，至少一条）：如 补齐设备权属登记后生效'}
                        aria-label="确认条件"
                      />
                    )}
                    <div className="wb-actions">
                      <button className="tk-btn small primary" onClick={() => submit(g.o)}>进入二次确认</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="tk-end-choice">
            <span>行政撤回（客户撤回本轮；与拒绝分开，不删客户）</span>
            <button className="tk-btn small" disabled={!withdrawGate.ok} onClick={withdraw} title={withdrawGate.why}>撤回本轮</button>
          </div>
        </div>
        <WbError error={localErr} onDismiss={() => setLocalErr(null)} />
        <p className="wb-note">确认≠正式授信批准≠额度激活≠可提款；确认后不修改信用设施、融资申请或敞口账本（scope=preassessment_only，服务端机器断言）。后续重要证据推翻确认依据时，旧确认保留、只显示需复核，不默认重开。</p>
        <div className="wb-actions">
          <button className="tk-btn small ghost" onClick={onClose}>取消（继续办理）</button>
        </div>
      </div>
    </div>
  );
}
'''
s=s[:i]+new_end
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('EndDialog ok')
