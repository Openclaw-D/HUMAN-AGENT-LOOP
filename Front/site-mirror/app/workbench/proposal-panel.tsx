// goal-03d 方案·决定面板（路径五）：decision-status 权威三行语义（候选≠批准≠可用）+
// 依据包全链——冻结（Gate 回执引用/域依赖声明/收口引用/豁免引用）、包详情（四域意见与当前性）、
// 域结果登记（域目录角色引用真实运行，authority=none 恒定）、包绑定提案、approver 正式决定
// （二次确认+幂等）。全部以 A 服务端裁决为准：条件未满足如实阻断，不提供绕过。
import { useCallback, useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import {
  buildConfirmPlan, completedRunRefs, DEMO_TENANT, decisionView, errorText, latestGateReceiptRef,
  wbActionRequestId,
} from '../../lib/workbench/wb-logic';
import { fmtAmount } from '../../lib/v5-preview/edge/edge-logic';
import { WbError, useAction } from './wb-parts';

const DOMAINS = ['policy', 'credit', 'commerce', 'asset'] as const;
const DOMAIN_LABEL: Record<string, string> = { policy: '政策域', credit: '信审域', commerce: '商务域', asset: '资产域' };
const DOMAIN_ROLE: Record<string, string> = { policy: 'policy', credit: 'credit', commerce: 'commerce', asset: 'asset' };

interface DepRow { domain: string; artifactIds: string; factKeys: string; rulePackVersion: string; enabled: boolean }

export function ProposalPanel({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const client = wb.client;
  const snap = wb.snapshot;
  const dv = decisionView(snap ?? {}, fmtAmount);
  const roles = wb.session?.roles ?? [];
  const assessments = snap?.assessments ?? [];
  const facilities = snap?.facilities ?? [];
  const sessionId = (snap?.session as { sessionId?: string } | null)?.sessionId ?? '';
  const basis = (snap?.decisionStatus as { basis?: { packageId?: string; basisVersion?: string; revision?: number } | null } | null)?.basis ?? null;

  const [amountMinor, setAmountMinor] = useState('50000000');
  const [months, setMonths] = useState('36');
  const [frAmount, setFrAmount] = useState('100000000');
  const [frType, setFrType] = useState('direct_leasing');
  const [proposePackageId, setProposePackageId] = useState('');
  const act = useAction();

  // 依据包冻结表单
  const [gateReceiptId, setGateReceiptId] = useState('');
  const [depRows, setDepRows] = useState<DepRow[]>(DOMAINS.map((d) => ({ domain: d, artifactIds: '', factKeys: '', rulePackVersion: '', enabled: d === 'credit' })));
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);
  const [exemptions, setExemptions] = useState<Array<{ exemptionId: string; domain: string; status: string }>>([]);
  const [pickedExemptions, setPickedExemptions] = useState<Record<string, boolean>>({});

  // 域结果登记表单
  const [drDomain, setDrDomain] = useState('');
  const [drRunId, setDrRunId] = useState('');
  const [drSummary, setDrSummary] = useState('');
  const [drFindingType, setDrFindingType] = useState('observation');
  const [drPackageId, setDrPackageId] = useState('');
  const [drAdopt, setDrAdopt] = useState(false);
  const [drAdoptNote, setDrAdoptNote] = useState('');

  // 包详情
  const [pkgDetail, setPkgDetail] = useState<Record<string, unknown> | null>(null);
  const [pkgErr, setPkgErr] = useState<string | null>(null);

  const isCredit = roles.includes('credit') || roles.includes('admin');
  const isApprover = roles.includes('admin') || roles.includes('approver') || roles.includes('business');
  const isBusiness = roles.includes('business') || roles.includes('credit') || roles.includes('admin');
  const myDomainRoles = DOMAINS.filter((d) => roles.includes(DOMAIN_ROLE[d]));

  const loadExemptions = useCallback(async () => {
    if (!client) return;
    try {
      const j = await client.listDomainExemptions(customerId);
      setExemptions(((j.exemptions ?? []) as Array<Record<string, unknown>>)
        .filter((e) => e.status === 'valid')
        .map((e) => ({ exemptionId: String(e.exemptionId ?? ''), domain: String(e.domain ?? ''), status: String(e.status ?? '') })));
    } catch { setExemptions([]); }
  }, [client, customerId]);

  useEffect(() => { void loadExemptions(); }, [loadExemptions]);

  if (!client) return null;

  const runAction = (action: string, path: string, extraBody: Record<string, unknown>, lines: string[]) => {
    const requestId = wbActionRequestId('wb-act', customerId, action, String(Date.now()));
    act.open(buildConfirmPlan(action, customerId, lines, requestId), async () => {
      await client.action(path, { requestId, tenantId: DEMO_TENANT, ...extraBody });
      await wb.refresh();
    });
  };

  // 从处理通道回执读 Gate 回执/运行引用/规则版本（真实链产物；读不到如实提示）。
  const syncFromChannel = async () => {
    setFreezeMsg(null);
    try {
      const st = await client.channelStatus(customerId);
      const tasks = (st.tasks ?? []) as Array<Record<string, unknown>>;
      const last = tasks.length > 0 ? String(tasks[tasks.length - 1].task_id ?? '') : '';
      if (!last) { setFreezeMsg('通道内暂无处理任务：先在材料页把原件送进处理通道并等其完成。'); return; }
      const taskRes = await client.channelTask(last);
      const taskBody = ((taskRes.task ?? taskRes) as Record<string, unknown>);
      const ops = (taskBody.aOps ?? []) as Array<Record<string, unknown>>;
      const gate = latestGateReceiptRef(ops);
      const runs = completedRunRefs(ops);
      setGateReceiptId(gate ?? '');
      const ruleV = String((st as { rulesetVersion?: string }).rulesetVersion ?? '');
      setDepRows((prev) => prev.map((r) => ({
        ...r,
        enabled: r.enabled || Boolean(runs[r.domain]),
        rulePackVersion: r.rulePackVersion || ruleV,
      })));
      setDrRunId(Object.values(runs)[0] ?? '');
      setFreezeMsg(gate
        ? `已从通道任务回执读取：Gate 回执 ${gate.slice(0, 24)}…、${Object.keys(runs).length} 个域运行引用、规则版本 ${ruleV || '—'}`
        : '通道回执中尚无已登记的 Gate 回执（处理未完成或未链接 A 客户）——冻结将被服务端拒绝，请等处理链完成。');
    } catch (e) {
      setFreezeMsg(errorText((e as { code?: string }).code, '处理通道读取失败：可手动粘贴 Gate 回执引用'));
    }
  };

  const freezePackage = () => {
    const domainDeps = depRows
      .filter((r) => r.enabled)
      .map((r) => ({
        domain: r.domain,
        artifactIds: r.artifactIds.split(/[\s,，;；]+/).filter(Boolean),
        factKeys: r.factKeys.split(/[\s,，;；]+/).filter(Boolean),
        ...(r.rulePackVersion ? { rulePackVersion: r.rulePackVersion } : {}),
      }));
    if (domainDeps.length === 0) { setFreezeMsg('至少声明一个域依赖（必需域须有结果或有效豁免，服务端按政策强制）。'); return; }
    const requestId = wbActionRequestId('wb-pkg', customerId, 'freeze', String(Date.now()));
    const lines = [
      `Gate 回执：${gateReceiptId || '（未引用——无 Gate 结论的包不可能就绪）'}`,
      `域依赖：${domainDeps.map((d) => `${DOMAIN_LABEL[d.domain]}×${d.artifactIds.length}件`).join('、') || '无'}`,
      sessionId ? `收口引用：会话 ${sessionId.slice(0, 18)}…（修订号服务端解析）` : '收口引用：无（如政策要求会先被拒）',
      `豁免引用：${Object.entries(pickedExemptions).filter(([, v]) => v).map(([k]) => k.slice(0, 12) + '…').join('、') || '无'}`,
      '冻结后依据=包版本；候选≠批准。',
    ];
    act.open(buildConfirmPlan('package.freeze', `客户 ${customerId}`, lines, requestId), async () => {
      const r = await client.freezePackage(customerId, {
        requestId,
        ...(gateReceiptId ? { gateReceiptId } : {}),
        domainDeps,
        ...(sessionId ? { inspectionRevision: { sessionId } } : {}),
        ...(Object.values(pickedExemptions).some(Boolean) ? { exemptions: Object.entries(pickedExemptions).filter(([, v]) => v).map(([exemptionId]) => ({ exemptionId })) } : {}),
      });
      setFreezeMsg(null);
      const pkgId = String(r.packageId ?? '');
      if (pkgId) {
        setProposePackageId(pkgId);
        setDrPackageId(pkgId);
        setDepRows((prev) => prev.map((row) => {
          const declared = domainDeps.find((d) => d.domain === row.domain);
          return declared ? { ...row, artifactIds: declared.artifactIds.join(', '), factKeys: declared.factKeys.join(', '), rulePackVersion: declared.rulePackVersion ?? row.rulePackVersion } : row;
        }));
      }
      await wb.refresh();
    });
  };

  const openPackage = async (packageId: string) => {
    setPkgErr(null);
    try {
      const j = await client.packageDetail(packageId);
      setPkgDetail(j);
    } catch (e) {
      setPkgDetail(null);
      setPkgErr(errorText((e as { code?: string }).code, '依据包读取失败'));
    }
  };

  const registerDomainResult = () => {
    const packageId = drPackageId || basis?.packageId || '';
    if (!packageId) { setPkgErr('尚无依据包：先冻结依据包，再登记域意见。'); return; }
    if (!drDomain) { setPkgErr('选择要登记的域（须与我的目录角色一致）。'); return; }
    if (!drRunId) { setPkgErr('填写真实分析运行引用（材料页处理通道回执中的 A 运行 a_ref）。'); return; }
    if (!drSummary.trim()) { setPkgErr('填写域意见摘要（业务语言；正式效力仍属人）。'); return; }
    const row = depRows.find((r) => r.domain === drDomain);
    const requestId = wbActionRequestId('wb-dres', customerId, `dr:${drDomain}`, String(Date.now()));
    const lines = [
      `包：${packageId} · 域：${DOMAIN_LABEL[drDomain] ?? drDomain}`,
      `运行引用：${drRunId.slice(0, 26)}…（须为已完成运行；失败运行被服务端拒绝）`,
      `意见：${drSummary.trim().slice(0, 60)}…（authority=none，服务端强制）`,
      drAdopt ? `同时记录采用决定（人 + 理由：${drAdoptNote.trim().slice(0, 40)}…）` : '不记录采用（仅登记意见）',
    ];
    act.open(buildConfirmPlan('package.domain-result', `客户 ${customerId}`, lines, requestId), async () => {
      await client.recordDomainResult(packageId, {
        requestId,
        domain: drDomain,
        analysisRun: { runId: drRunId },
        opinion: { findingType: drFindingType, summary: drSummary.trim(), domain: drDomain, authority: 'none' },
        deps: {
          artifactIds: (row?.artifactIds ?? '').split(/[\s,，;；]+/).filter(Boolean),
          factKeys: (row?.factKeys ?? '').split(/[\s,，;；]+/).filter(Boolean),
          ...(row?.rulePackVersion ? { rulePackVersion: row.rulePackVersion } : {}),
        },
        ...(drAdopt && drAdoptNote.trim() ? { adoption: { adopted: true, rationale: drAdoptNote.trim() } } : {}),
      });
      setDrSummary('');
      await openPackage(packageId);
      await wb.refresh();
    });
  };

  const activeFacility = facilities.find((f) => f.status === 'active');
  const facilityId = activeFacility?.facilityId ?? facilities[0]?.facilityId;

  return (
    <div>
      <h3 className="wb-h2">当前方案与决策状态（服务端权威 decision-status）</h3>
      <div className={`wb-card ${dv.readinessTone === 'good' ? 'good' : dv.readinessTone === 'bad' ? 'bad' : 'dim'}`}>
        <div className="wb-kv"><span className="k">就绪状态</span><span>{dv.readinessText}</span></div>
        <div className="wb-kv"><span className="k">依据</span><span>{dv.basisText}</span></div>
        <div className="wb-kv"><span className="k">规则 Gate</span><span>{dv.gateText}</span></div>
        <div className="wb-kv"><span className="k">测算金额</span><span>{dv.candidateText}</span></div>
        <div className="wb-kv"><span className="k">批准与可用</span><span>{dv.approvedText}</span></div>
        <div className="wb-kv"><span className="k">可用敞口</span><span>{dv.availableText}</span></div>
        {dv.blockers.length > 0 && (
          <div className="wb-kv"><span className="k">阻断动作</span><span>{dv.blockers.join('、')}（服务端强制；条件未满足不能假装可用）</span></div>
        )}
        <div className="wb-actions">
          {basis?.packageId && <button className="wb-btn small ghost" onClick={() => void openPackage(String(basis.packageId))}>查看依据包（四域意见/当前性/缺口）</button>}
        </div>
      </div>
      <WbError error={pkgErr} onDismiss={() => setPkgErr(null)} />
      {pkgDetail && (
        <div className="wb-card" style={{ marginTop: 8 }}>
          <div className="wb-row"><strong>依据包 {String((pkgDetail.package as { packageId?: string })?.packageId ?? '').slice(0, 22)}…（r{String((pkgDetail.package as { revision?: number })?.revision ?? '?')}）</strong>
            <button className="wb-btn small ghost" onClick={() => setPkgDetail(null)}>收起</button>
          </div>
          <div className="wb-kv"><span className="k">就绪</span><span>{pkgDetail.decisionReadiness === true ? '当前且必需域齐备' : '存在缺口（如实显示）'}</span></div>
          {Array.isArray(pkgDetail.gaps) && (pkgDetail.gaps as string[]).length > 0 && (
            <div className="wb-kv"><span className="k">缺口</span><span>{(pkgDetail.gaps as string[]).join('、')}</span></div>
          )}
          <h3 className="wb-h2">四域意见（authority=none；正式采用另留人/理由/依据）</h3>
          {(!Array.isArray(pkgDetail.domainResults) || (pkgDetail.domainResults as unknown[]).length === 0) && <p className="wb-note">包内尚无域结果：域目录角色可在下方登记（引用真实运行）。</p>}
          {Array.isArray(pkgDetail.domainResults) && (pkgDetail.domainResults as Array<Record<string, unknown>>).map((r, i) => {
            const op = (r.opinion ?? {}) as { summary?: string; findingType?: string };
            const ad = (r.adoption ?? null) as { adopted?: boolean; rationale?: string; adoptedBy?: string } | null;
            return (
              <div key={i} className="wb-card dim">
                <div className="wb-row">
                  <span className="wb-badge">{DOMAIN_LABEL[String(r.domain)] ?? String(r.domain)}</span>
                  <span className="wb-sub">v{String(r.opinionVersion ?? '?')} · 运行 {String((r.analysisRun as { runId?: string })?.runId ?? '').slice(0, 18)}…</span>
                  {ad && <span className={`wb-badge ${ad.adopted ? 'live' : 'off'}`}>{ad.adopted ? '已采用' : '不采用'}</span>}
                </div>
                <div>{String(op.summary ?? '')}</div>
                {ad?.rationale && <div className="wb-note">采用理由：{ad.rationale}{ad.adoptedBy ? `（${ad.adoptedBy}）` : ''}</div>}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="wb-h2" style={{ marginTop: 12 }}>冻结决策依据包（credit/business · Gate 只收服务端回执引用）</h3>
      <div className="wb-card dim">
        <div className="wb-row">
          <button className="wb-btn small ghost" onClick={() => void syncFromChannel()}>从处理通道回执读取 Gate/运行/规则版本</button>
          <span className="wb-sub">收口会话：{sessionId ? sessionId.slice(0, 18) + '…' : '无（收口引用可选）'}</span>
        </div>
        <WbError error={freezeMsg} onDismiss={() => setFreezeMsg(null)} />
        <div className="wb-field"><label>Gate 回执引用（gateReceiptId，来自处理链 A 回执）</label>
          <input className="wb-input" value={gateReceiptId} onChange={(e) => setGateReceiptId(e.target.value)} placeholder="从处理通道读取或粘贴" />
        </div>
        <table className="wb-table">
          <thead><tr><th>纳入</th><th>域</th><th>工件（逗号分隔 artifactId）</th><th>事实键（可选）</th><th>规则版本</th></tr></thead>
          <tbody>
            {depRows.map((r) => (
              <tr key={r.domain}>
                <td><input type="checkbox" checked={r.enabled} onChange={(e) => setDepRows((prev) => prev.map((x) => (x.domain === r.domain ? { ...x, enabled: e.target.checked } : x)))} aria-label={`纳入${DOMAIN_LABEL[r.domain]}`} /></td>
                <td>{DOMAIN_LABEL[r.domain]}</td>
                <td><input className="wb-input" style={{ width: '100%' }} value={r.artifactIds} onChange={(e) => setDepRows((prev) => prev.map((x) => (x.domain === r.domain ? { ...x, artifactIds: e.target.value } : x)))} placeholder="现行工件 ID" /></td>
                <td><input className="wb-input" style={{ width: '100%' }} value={r.factKeys} onChange={(e) => setDepRows((prev) => prev.map((x) => (x.domain === r.domain ? { ...x, factKeys: e.target.value } : x)))} placeholder="可选" /></td>
                <td><input className="wb-input" style={{ width: 150 }} value={r.rulePackVersion} onChange={(e) => setDepRows((prev) => prev.map((x) => (x.domain === r.domain ? { ...x, rulePackVersion: e.target.value } : x)))} placeholder="如 sim-pack@1" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {exemptions.length > 0 && (
          <div className="wb-row">
            <span className="wb-sub">有效豁免（服务端登记；冻结时按 {`{exemptionId}`} 引用）：</span>
            {exemptions.map((e) => (
              <label key={e.exemptionId} className="wb-sub">
                <input type="checkbox" checked={pickedExemptions[e.exemptionId] === true} onChange={(ev) => setPickedExemptions((prev) => ({ ...prev, [e.exemptionId]: ev.target.checked }))} />
                {' '}{DOMAIN_LABEL[e.domain] ?? e.domain}·{e.exemptionId.slice(0, 10)}…
              </label>
            ))}
          </div>
        )}
        {(isCredit || isBusiness) && <button className="wb-btn" onClick={freezePackage}>冻结依据包</button>}
        <p className="wb-note">必需域来自批准政策（服务端强制）：未登记结果的必需域须有有效豁免；Gate 未登记的包不可能就绪。豁免本身由 admin/业务在 A 登记后在此引用。</p>
      </div>

      <h3 className="wb-h2" style={{ marginTop: 12 }}>登记域意见（域目录角色 · 引用真实运行 · authority=none）</h3>
      <div className="wb-card dim">
        {myDomainRoles.length === 0 && <p className="wb-note">我的目录角色不含域专员（policy/credit/commerce/asset）：登记入口不显示（服务端同样拒绝）。</p>}
        {myDomainRoles.length > 0 && (
          <>
            <div className="wb-row">
              <div className="wb-field" style={{ width: 130 }}><label>域</label>
                <select className="wb-select" value={drDomain || myDomainRoles[0]} onChange={(e) => setDrDomain(e.target.value)}>
                  {myDomainRoles.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
                </select>
              </div>
              <div className="wb-field" style={{ width: 150 }}><label>意见类型</label>
                <select className="wb-select" value={drFindingType} onChange={(e) => setDrFindingType(e.target.value)}>
                  <option value="observation">观察</option>
                  <option value="concern">关注</option>
                  <option value="blocker">阻断项</option>
                </select>
              </div>
              <div className="wb-field" style={{ flex: 1 }}><label>分析运行引用（runId，处理通道回执）</label>
                <input className="wb-input" value={drRunId} onChange={(e) => setDrRunId(e.target.value)} placeholder="如 run-xxx（须为已完成运行）" />
              </div>
            </div>
            <div className="wb-field"><label>域意见摘要（业务语言）</label>
              <textarea className="wb-textarea" rows={2} value={drSummary} onChange={(e) => setDrSummary(e.target.value)} placeholder="该域对当前材料/事实的结论与关注点（正式性仍属人）" />
            </div>
            <div className="wb-row">
              <label className="wb-sub"><input type="checkbox" checked={drAdopt} onChange={(e) => setDrAdopt(e.target.checked)} /> 同时记录采用决定</label>
              {drAdopt && <input className="wb-input" style={{ flex: 1 }} value={drAdoptNote} onChange={(e) => setDrAdoptNote(e.target.value)} placeholder="采用理由（必填，记录采用人/依据版本由服务端补全）" />}
              <div className="wb-field" style={{ width: 220 }}><label>目标包</label>
                <input className="wb-input" value={drPackageId || basis?.packageId || ''} onChange={(e) => setDrPackageId(e.target.value)} placeholder="默认当前依据包" />
              </div>
              <button className="wb-btn" onClick={registerDomainResult}>登记域意见</button>
            </div>
          </>
        )}
      </div>

      <h3 className="wb-h2" style={{ marginTop: 12 }}>评估与候选（AI 意见 authority=none，仅供人参考）</h3>
      {isCredit && (
        <div className="wb-actions" style={{ marginBottom: 8 }}>
          <button className="wb-btn small ghost" onClick={() => runAction('assessment.create', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assessments`, {
            ruleVersion: 'rules-delivery-demo',
          }, ['创建信审评估：AI 评估将产出候选意见（authority=none），正式性仍属人。'])}>创建评估</button>
        </div>
      )}
      {assessments.length === 0 && <p className="wb-note">暂无评估记录（事件窗口内）。</p>}
      {assessments.map((a) => (
        <div key={String(a.assessmentId)} className="wb-card dim">
          <div className="wb-row">
            <span className="wb-badge">{String(a.assessmentId ?? '').slice(0, 22)}</span>
            <span>状态：{String(a.status ?? '—')}</span>
            {a.stale === true && <span className="wb-badge off">依据已过时</span>}
            <span className="wb-sub">候选：{a.candidate?.tendency ?? '—'} {a.candidate?.supportableAmountMinor != null ? `· 支撑金额 ${fmtAmount(a.candidate.supportableAmountMinor)}` : '· 金额未知（未知明确标未知）'}</span>
          </div>
          {isCredit && (a.status === 'collecting' || a.status === 'review_pending' || a.status === 'candidate_ready') && (
            <CandidateForm
              assessmentId={String(a.assessmentId)}
              status={String(a.status ?? '')}
              onSubmit={(tendency, amount, rationale) => runAction(
                tendency === 'skip' ? 'assessment.decide' : 'assessment.candidate',
                tendency === 'skip'
                  ? `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/submit-review`
                  : `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/candidate`,
                tendency === 'skip' ? {} : {
                  candidate: {
                    tendency,
                    ...(amount != null ? { supportableAmountMinor: amount } : {}),
                    currency: 'CNY',
                    rationale,
                    producedBy: `page:${wb.session?.principalId ?? 'credit'}(synthetic)`,
                    conditions: [], warnings: [],
                  },
                },
                tendency === 'skip'
                  ? ['提交信审复核：进入送审记录。']
                  : [`候选倾向：${tendency}`, amount != null ? `支撑金额：${fmtAmount(amount)}（未知则留空）` : '支撑金额：不填（如实未知）', '候选 authority=none（服务端强制）：正式性仍属人。'],
              )}
            />
          )}
        </div>
      ))}

      <h3 className="wb-h2" style={{ marginTop: 12 }}>正式动作（有权人操作 · 二次确认 · 幂等）</h3>
      <div className="wb-card">
        <div className="wb-row">
          <span className="wb-sub">角色：{roles.join('/') || '无'}（服务端权限矩阵裁决，页面不提权）</span>
        </div>
        {isCredit && (
          <div className="wb-row">
            <span>提案金额（分）：</span>
            <input className="wb-input" style={{ width: 150 }} value={amountMinor} onChange={(e) => setAmountMinor(e.target.value)} />
            <span>期限（月）：</span>
            <input className="wb-input" style={{ width: 80 }} value={months} onChange={(e) => setMonths(e.target.value)} />
            <span>依据包：</span>
            <input className="wb-input" style={{ width: 220 }} value={proposePackageId || basis?.packageId || ''} onChange={(e) => setProposePackageId(e.target.value)} placeholder="包绑定提案（BASIS_PACKAGE_REQUIRED 门）" />
            <button
              className="wb-btn"
              onClick={() => {
                const latest = assessments[assessments.length - 1];
                const packageId = proposePackageId || basis?.packageId || '';
                if (!latest?.assessmentId) return;
                if (!packageId) { setPkgErr('正式提案必须绑定依据包：先冻结依据包（服务端 BASIS_PACKAGE_REQUIRED 强制）。'); return; }
                runAction('facility.propose', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/facilities`, {
                  productType: 'direct_leasing',
                  approvedAmountMinor: Number(amountMinor) || 0,
                  currency: 'CNY',
                  termMonths: Number(months) || undefined,
                  assessmentId: String(latest.assessmentId),
                  packageId,
                }, [`提案（候选）：${fmtAmount(Number(amountMinor) || 0)} / ${months} 个月`, `绑定评估：${String(latest.assessmentId).slice(0, 20)}…`, `绑定依据包：${packageId.slice(0, 20)}…`, '候选≠批准：需有权人正式批准。']);
              }}
            >提交额度提案（候选）</button>
            {assessments.length === 0 && <span className="wb-note">提案须绑定评估：请先创建评估。</span>}
          </div>
        )}
        {isApprover && facilityId && (
          <div className="wb-actions">
            <button className="wb-btn" onClick={() => runAction('facility.approve', `/api/jw/v2/actions/facilities/${encodeURIComponent(String(facilityId))}/approve`, {}, [`设施 ${facilityId}`, '正式批准：Gate/依据/差异由服务端机械复查，失败零写入。'])}>正式批准</button>
            <button className="wb-btn" onClick={() => runAction('facility.activate', `/api/jw/v2/actions/facilities/${encodeURIComponent(String(facilityId))}/activate`, {}, [`设施 ${facilityId}`, '激活后客户方可实际用信。'])}>激活</button>
            <button className="wb-btn danger" onClick={() => runAction('facility.suspend', `/api/jw/v2/actions/facilities/${encodeURIComponent(String(facilityId))}/suspend`, {}, [`设施 ${facilityId}`, '暂停新用信（存量负债不受影响）。'])}>暂停</button>
          </div>
        )}
        {isBusiness && (
          <div className="wb-row" style={{ marginTop: 8 }}>
            <span>用信申请（分）：</span>
            <input className="wb-input" style={{ width: 150 }} value={frAmount} onChange={(e) => setFrAmount(e.target.value)} />
            <select className="wb-select" style={{ width: 150 }} value={frType} onChange={(e) => setFrType(e.target.value)}>
              <option value="direct_leasing">直租</option><option value="sale_leaseback">售后回租</option>
            </select>
            <button
              className="wb-btn ghost"
              onClick={() => runAction('fr.create', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/financing-requests`, {
                productType: frType,
                amountMinor: Number(frAmount) || 0,
                currency: 'CNY',
              }, [`申请 ${fmtAmount(Number(frAmount) || 0)}（${frType === 'direct_leasing' ? '直租' : '售后回租'}）`])}
            >创建用信申请</button>
          </div>
        )}
        {act.node}
      </div>

      <h3 className="wb-h2" style={{ marginTop: 12 }}>在途用信申请（事件窗口内，非权威清单 IR-03-4）</h3>
      {(snap?.financingRequests ?? []).length === 0 && <p className="wb-note">无在途申请记录。</p>}
      {(snap?.financingRequests ?? []).map((fr) => {
        const frId = String(fr.frId ?? fr.financingRequestId ?? '');
        const st = String(fr.status ?? '');
        return (
          <div key={frId} className="wb-card dim">
            <div className="wb-row">
              <span className="wb-badge">{frId.slice(0, 22)}</span>
              <span>{String(fr.productType ?? '—')} · {fmtAmount(fr.amountMinor)}</span>
              <span>状态：{st}</span>
            </div>
            {isBusiness && st === 'created' && (
              <div className="wb-actions">
                <button className="wb-btn small" onClick={() => runAction('fr.reserve', `/api/jw/v2/actions/financing-requests/${encodeURIComponent(frId)}/reserve`, {}, [`预占 ${fmtAmount(fr.amountMinor)}`, '预占受可用额与设施状态约束（INSUFFICIENT_AVAILABLE_AMOUNT/FACILITY_NOT_ACTIVE 显式拒绝）。'])}>预占额度</button>
              </div>
            )}
            {isBusiness && st === 'reserved' && (
              <div className="wb-actions">
                <button className="wb-btn small" onClick={() => runAction('fr.commit', `/api/jw/v2/actions/financing-requests/${encodeURIComponent(frId)}/commit`, {}, [`承诺 ${fmtAmount(fr.amountMinor)}`, '承诺点机械复查：设施硬状态→未决差异→依据包当前性。'])}>承诺用信</button>
                <button className="wb-btn small ghost" onClick={() => runAction('fr.release', `/api/jw/v2/actions/financing-requests/${encodeURIComponent(frId)}/release`, {}, [`释放预占 ${fmtAmount(fr.amountMinor)}`])}>释放预占</button>
              </div>
            )}
            {isBusiness && st === 'committed' && (
              <div className="wb-actions">
                <button className="wb-btn small" onClick={() => runAction('fr.disburse', `/api/jw/v2/actions/financing-requests/${encodeURIComponent(frId)}/disburse`, {}, [`出账 ${fmtAmount(fr.amountMinor)}`, '出账为受控模拟（simulation_only），非真实资金。'])}>出账（模拟）</button>
              </div>
            )}
          </div>
        );
      })}
      <WbError error={wb.error && wb.error.includes('刷新失败') ? wb.error : null} />
      <p className="wb-note">条件未满足（POLICY_PENDING/GATE_BLOCKED/STALE_BASIS/REVIEW_REQUIRED…）会以业务语言显示，绿色仅表示指定事项完成，不等于授信通过。</p>
    </div>
  );
}

// 信审候选表单（collecting→candidate；review_pending→提交复核）。AI/页面候选 authority 恒 none。
function CandidateForm({ assessmentId, status, onSubmit }: {
  assessmentId: string;
  status: string;
  onSubmit: (tendency: string, amountMinor: number | null, rationale: string) => void;
}) {
  const [tendency, setTendency] = useState('do');
  const [amount, setAmount] = useState('');
  const [rationale, setRationale] = useState('');
  return (
    <div className="wb-card dim" style={{ marginTop: 6 }}>
      <div className="wb-row">
        <span className="wb-sub">评估 {assessmentId.slice(0, 18)}… · {status === 'collecting' ? '登记候选意见（authority=none）' : '已送审'}</span>
      </div>
      {status === 'collecting' && (
        <>
          <div className="wb-row">
            <div className="wb-field" style={{ width: 200 }}><label>候选倾向</label>
              <select className="wb-select" value={tendency} onChange={(e) => setTendency(e.target.value)}>
                <option value="do">可做</option>
                <option value="do_with_adjusted_terms">可做（调整条件）</option>
                <option value="do_not">不做</option>
                <option value="review">待复核</option>
              </select>
            </div>
            <div className="wb-field" style={{ width: 180 }}><label>支撑金额（分，可空=未知）</label>
              <input className="wb-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如 50000000" />
            </div>
            <div className="wb-field" style={{ flex: 1 }}><label>理由（业务语言）</label>
              <input className="wb-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="依据哪些材料/事实（正式性仍属人）" />
            </div>
          </div>
          <div className="wb-actions">
            <button className="wb-btn small" disabled={!rationale.trim()} onClick={() => onSubmit(tendency, amount.trim() ? Number(amount) : null, rationale.trim())}>登记候选意见</button>
            <button className="wb-btn small ghost" onClick={() => onSubmit('skip', null, '')}>直接提交复核</button>
          </div>
        </>
      )}
      {(status === 'review_pending' || status === 'candidate_ready') && (
        <div className="wb-actions">
          <button className="wb-btn small ghost" onClick={() => onSubmit('skip', null, '')}>提交复核</button>
        </div>
      )}
    </div>
  );
}
