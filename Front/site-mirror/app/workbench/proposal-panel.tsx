// goal-03d 方案·决定面板（路径五）：decision-status 权威三行语义（候选≠批准≠可用）+
// 依据包全链——冻结（Gate 回执引用/域依赖声明/收口引用/豁免引用）、包详情（四域意见与当前性）、
// 域结果登记（域目录角色引用真实运行，authority=none 恒定）、评估候选登记。
// 全部以 A 服务端裁决为准：条件未满足如实阻断，不提供绕过。
// TAKEOFF-FA-1.0.0（02路）：按 01_TAKEOFF_CORE_AUTHORITY §4/§5 与 ADAPTATION_MAP「停用」行，
// 正式额度/用信入口（facility.propose/approve/activate/suspend、fr.create/reserve/commit/release/disburse）
// 已从本轮默认页面与调用路径移除（底层兼容代码保留在 A/Edge，不属本面板）；预评估确认/撤回
// 收口在 TAKEOFF 主屏「结束」对话框（正面确认待01契约接入）。任务01 修复面保留：内部引用
// （Gate 回执/分析运行/工件/依据包）由系统从客户现行材料清单与处理通道真实回执关联，业务人员
// 只选业务对象；缺真实回执时如实显示并说明，不生成分析完成/Gate/批准状态。
import { useCallback, useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import {
  buildConfirmPlan, collectRunRefs, DEMO_TENANT, errorText, latestGateReceiptRef,
  pickedFactKeys, summarizeArtifacts, wbActionRequestId,
  type ArtifactRow,
} from '../../lib/workbench/wb-logic';
import { fmtAmount } from '../../lib/v5-preview/edge/edge-logic';
import { WbError, useAction } from './wb-parts';
import { materialKindName } from '../../lib/workbench/material-labels';
import { tendencyLabel } from '../../lib/workbench/takeoff-projection';

const DOMAINS = ['policy', 'credit', 'commerce', 'asset'] as const;
const DOMAIN_LABEL: Record<string, string> = { policy: '政策域', credit: '信审域', commerce: '商务域', asset: '资产域' };
const DOMAIN_ROLE: Record<string, string> = { policy: 'policy', credit: 'credit', commerce: 'commerce', asset: 'asset' };

const KIND_TEXT: Record<string, string> = {
  purchase_contract: '购销合同', invoice: '发票', equipment_list: '设备清单',
  bank_statement: '银行流水', financial_statement: '财务报表', original_upload: '其他原件',
  ledger_book: '账表', entity_register: '主体登记', device_photo: '设备照片', site_photo: '现场照片', document_sample: '其他文件',
};
const GRADE_TEXT: Record<string, string> = { unverified: '未核验', source_supported: '来源支撑', verified: '已核验' };

function artifactLabel(r: ArtifactRow): string {
  return `${KIND_TEXT[r.kind] ?? materialKindName(r.kind)} · ${r.period ?? '期间—'}`;
}

export function ProposalPanel({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const client = wb.client;
  const snap = wb.snapshot;
  const customerName = snap?.customer?.displayName || '当前客户';
  const latest = snap?.assessments?.at(-1);
  const gateResult = snap?.decisionStatus?.basis?.gate?.result;
  const roles = wb.session?.roles ?? [];
  const assessments = snap?.assessments ?? [];
  const sessionId = (snap?.session as { sessionId?: string } | null)?.sessionId ?? '';
  const basis = (snap?.decisionStatus as { basis?: { packageId?: string; basisVersion?: string; revision?: number } | null } | null)?.basis ?? null;

  const act = useAction();

  // 系统关联引用：客户现行材料清单 + 处理通道回执（Gate/运行/规则版本）。读取失败如实显示。
  const [materials, setMaterials] = useState<ArtifactRow[] | null>(null);
  const [gateRef, setGateRef] = useState<{ id: string | null; loaded: boolean }>({ id: null, loaded: false });
  const [runsByDomain, setRunsByDomain] = useState<Record<string, string[]>>({});
  const [chanRuleVersion, setChanRuleVersion] = useState('');
  
  const [refsErr, setRefsErr] = useState<string | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);

  // 依据包冻结：勾选业务对象（现行材料），系统组装 artifactIds/factKeys/规则版本
  const [depEnabled, setDepEnabled] = useState<Record<string, boolean>>({ credit: true });
  const [depPicked, setDepPicked] = useState<Record<string, Record<string, boolean>>>({});
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);
  const [exemptions, setExemptions] = useState<Array<{ exemptionId: string; domain: string; status: string }>>([]);
  const [pickedExemptions, setPickedExemptions] = useState<Record<string, boolean>>({});

  // 域结果登记：运行引用由下拉选择（通道回执），目标包=当前依据包（系统关联）
  const [drDomain, setDrDomain] = useState('');
  const [drRunId, setDrRunId] = useState('');
  const [drSummary, setDrSummary] = useState('');
  const [drFindingType, setDrFindingType] = useState('observation');
  const [drAdopt, setDrAdopt] = useState(false);
  const [drAdoptNote, setDrAdoptNote] = useState('');

  // 包详情
  const [pkgDetail, setPkgDetail] = useState<Record<string, unknown> | null>(null);
  const [pkgErr, setPkgErr] = useState<string | null>(null);

  const isCredit = roles.includes('credit') || roles.includes('admin');
  // Gate/分析运行绑定来源材料；parse_extraction 是派生记录，不是额外独立证据。
  const assessmentMaterials = (materials ?? []).filter((m) => m.kind.startsWith('material.'));
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

  // 系统关联引用加载：现行材料清单 + 最新通道任务回执（Gate/各域运行/规则版本）。
  const loadRefs = useCallback(async () => {
    if (!client) return;
    setRefsLoading(true);
    setRefsErr(null);
    try {
      const j = await client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`);
      setMaterials(summarizeArtifacts((j.artifacts ?? []) as Array<Record<string, unknown>>).rows.filter((r) => r.current));
    } catch { setMaterials(null); }
    try {
      const st = await client.channelStatus(customerId);
      const tasks = (st.tasks ?? []) as Array<Record<string, unknown>>;
      setChanRuleVersion(String((st as { rulesetVersion?: string }).rulesetVersion ?? ''));
      const last = tasks.length > 0 ? String(tasks[tasks.length - 1].task_id ?? '') : '';
      if (last) {
        const tr = await client.channelTask(last);
        const body = ((tr.task ?? tr) as Record<string, unknown>);
        const ops = (body.aOps ?? []) as Array<Record<string, unknown>>;
        setGateRef({ id: latestGateReceiptRef(ops), loaded: true });
        setRunsByDomain(collectRunRefs(ops));

      } else {
        setGateRef({ id: null, loaded: true });
        setRunsByDomain({});

      }
    } catch {
      setGateRef((g) => ({ ...g, loaded: true }));
      setRunsByDomain({});

      setRefsErr('材料处理结果暂时无法读取，请稍后重试。');
    } finally {
      setRefsLoading(false);
    }
  }, [client, customerId]);

  useEffect(() => { void loadRefs(); }, [loadRefs]);

  if (!client) return null;

  const effDrDomain = drDomain || myDomainRoles[0] || '';
  const domainRuns = runsByDomain[effDrDomain] ?? [];
  const effRunId = drRunId && domainRuns.includes(drRunId) ? drRunId : (domainRuns[0] ?? '');
  const basisPackageId = basis?.packageId ?? '';

  const runAction = (action: string, path: string, extraBody: Record<string, unknown>, lines: string[]) => {
    const requestId = wbActionRequestId('wb-act', customerId, action, String(Date.now()));
    act.open(buildConfirmPlan(action, customerName, lines, requestId), async () => {
      await client.action(path, { requestId, tenantId: DEMO_TENANT, ...extraBody });
      await wb.refresh();
    });
  };

  const freezePackage = () => {
    const domainDeps = DOMAINS
      .filter((d) => depEnabled[d] === true)
      .map((d) => {
        const pickedIds = Object.entries(depPicked[d] ?? {}).filter(([, v]) => v).map(([k]) => k);
        const artifactIds = pickedIds;
        const factKeys = pickedFactKeys(materials ?? [], pickedIds);
        return { domain: d, artifactIds, factKeys, ...(chanRuleVersion ? { rulePackVersion: chanRuleVersion } : {}) };
      })
      .filter((d) => d.artifactIds.length > 0);
    if (domainDeps.length === 0) { setFreezeMsg('请至少选择一个专业，并勾选本次采用的材料。'); return; }
    const requestId = wbActionRequestId('wb-pkg', customerId, 'freeze', String(Date.now()));
    const lines = [
      gateRef.id ? '准入检查结果已关联。' : '准入检查尚未完成，本次材料整理不能视为可以办结。',
      `本次材料：${domainDeps.map((d) => `${DOMAIN_LABEL[d.domain]}×${d.artifactIds.length}件`).join('、')}`,
      sessionId ? '已关联本次核验记录。' : '尚无核验记录。',
      `采用已登记的有效豁免 ${Object.values(pickedExemptions).filter(Boolean).length} 项。`,
      '材料后续变化时需要重新核对。',
    ];
    act.open(buildConfirmPlan('package.freeze', customerName, lines, requestId), async () => {
      await client.freezePackage(customerId, {
        requestId,
        ...(gateRef.id ? { gateReceiptId: gateRef.id } : {}),
        domainDeps,
        ...(sessionId ? { inspectionRevision: { sessionId } } : {}),
        ...(Object.values(pickedExemptions).some(Boolean) ? { exemptions: Object.entries(pickedExemptions).filter(([, v]) => v).map(([exemptionId]) => ({ exemptionId })) } : {}),
      });
      setFreezeMsg(null);
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
    if (!basisPackageId) { setPkgErr('尚无依据包：先冻结依据包，再登记域意见。'); return; }
    if (!effDrDomain) { setPkgErr('选择要登记的域（须与我的目录角色一致）。'); return; }
    if (!effRunId) { setPkgErr('该域尚无已完成的真实分析运行回执：不能登记（服务端也会拒绝非真实运行）。'); return; }
    if (!drSummary.trim()) { setPkgErr('填写域意见摘要（业务语言；正式效力仍属人）。'); return; }
    const pickedIds = Object.entries(depPicked[effDrDomain] ?? {}).filter(([, v]) => v).map(([k]) => k);
    const artifactIds = pickedIds;
    const requestId = wbActionRequestId('wb-dres', customerId, `dr:${effDrDomain}`, String(Date.now()));
    const lines = [
      `专业：${DOMAIN_LABEL[effDrDomain] ?? '当前专业'}；已关联本次材料和已完成的分析。`,
      `意见：${drSummary.trim()}`,
      drAdopt ? `同时采用此意见，理由：${drAdoptNote.trim()}` : '仅保存意见，尚未人工采用。',
    ];
    act.open(buildConfirmPlan('package.domain-result', customerName, lines, requestId), async () => {
      await client.recordDomainResult(basisPackageId, {
        requestId,
        domain: effDrDomain,
        analysisRun: { runId: effRunId },
        opinion: { findingType: drFindingType, summary: drSummary.trim(), domain: effDrDomain, authority: 'none' },
        deps: {
          artifactIds,
          factKeys: pickedFactKeys(materials ?? [], pickedIds),
          ...(chanRuleVersion ? { rulePackVersion: chanRuleVersion } : {}),
        },
        ...(drAdopt && drAdoptNote.trim() ? { adoption: { adopted: true, rationale: drAdoptNote.trim() } } : {}),
      });
      setDrSummary('');
      await openPackage(basisPackageId);
      await wb.refresh();
    });
  };

  return (
    <div>
      <h3 className="wb-h2">本次办理</h3>
      <div className="wb-card dim">
        <div className="wb-kv"><span className="k">办理状态</span><span>{snap?.decisionStatus?.basis?.decisionReadiness ? '材料与专业意见已齐备，可以核对后确认' : '仍有材料或专业意见待完成'}</span></div>
        <div className="wb-kv"><span className="k">准入检查</span><span>{gateResult === 'approved' ? '已通过' : gateResult === 'rejected' ? '未通过' : '尚未完成'}</span></div>
        <div className="wb-kv"><span className="k">建议额度</span><span>{latest?.candidate?.supportableAmountMinor != null ? fmtAmount(latest.candidate.supportableAmountMinor) : '待评估'}</span></div>
        <div className="wb-actions">
          {basis?.packageId && <button className="wb-btn small ghost" onClick={() => void openPackage(String(basis.packageId))}>查看各专业意见</button>}
        </div>
      </div>
      <WbError error={pkgErr} onDismiss={() => setPkgErr(null)} />
      {pkgDetail && (
        <div className="wb-card" style={{ marginTop: 8 }}>
          <div className="wb-row"><strong>本次专业意见</strong>
            <button className="wb-btn small ghost" onClick={() => setPkgDetail(null)}>收起</button>
          </div>
          <div className="wb-kv"><span className="k">就绪</span><span>{pkgDetail.decisionReadiness === true ? '当前且必需域齐备' : '存在缺口（如实显示）'}</span></div>
          {Array.isArray(pkgDetail.gaps) && (pkgDetail.gaps as string[]).length > 0 && (
            <div className="wb-kv"><span className="k">缺口</span><span>{`还有 ${(pkgDetail.gaps as string[]).length} 项待核对`}</span></div>
          )}
          <h3 className="wb-h2">各专业意见</h3>
          {(!Array.isArray(pkgDetail.domainResults) || (pkgDetail.domainResults as unknown[]).length === 0) && <p className="wb-note">尚未取得专业意见。</p>}
          {Array.isArray(pkgDetail.domainResults) && (pkgDetail.domainResults as Array<Record<string, unknown>>).map((r, i) => {
            const op = (r.opinion ?? {}) as { summary?: string; findingType?: string };
            const ad = (r.adoption ?? null) as { adopted?: boolean; rationale?: string; adoptedBy?: string } | null;
            return (
              <div key={i} className="wb-card dim">
                <div className="wb-row">
                  <span className="wb-badge">{DOMAIN_LABEL[String(r.domain)] ?? String(r.domain)}</span>
                  {ad && <span className={`wb-badge ${ad.adopted ? 'live' : 'off'}`}>{ad.adopted ? '已采用' : '不采用'}</span>}
                </div>
                <div>{String(op.summary ?? '')}</div>
                {ad?.rationale && <div className="wb-note">采用理由：{ad.rationale}</div>}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="wb-h2" style={{ marginTop: 12 }}>选择本次采用的材料</h3>
      <div className="wb-card dim">
        <div className="wb-row">
          <button className="wb-btn small ghost" onClick={() => void loadRefs()} disabled={refsLoading}>{refsLoading ? '读取中…' : '刷新材料与分析'}</button>
          <span className="wb-sub">{sessionId ? '已有核验记录' : '尚无核验记录'}</span>
        </div>
        <WbError error={refsErr} onDismiss={() => setRefsErr(null)} />
        <WbError error={freezeMsg} onDismiss={() => setFreezeMsg(null)} />
        <div className="wb-kv"><span className="k">准入检查记录</span><span>{gateRef.id ? '已关联准入检查记录' : gateRef.loaded ? '尚未取得准入检查记录' : '读取中…'}</span></div>
        <div className="wb-kv"><span className="k">适用规则</span><span>{chanRuleVersion ? '已关联现行规则' : '等待现行规则'}</span></div>
        <table className="wb-table">
          <thead><tr><th>纳入</th><th>域</th><th>本次采用的材料</th></tr></thead>
          <tbody>
            {DOMAINS.map((d) => (
              <tr key={d}>
                <td><input type="checkbox" checked={depEnabled[d] === true} onChange={(e) => setDepEnabled((prev) => ({ ...prev, [d]: e.target.checked }))} aria-label={`纳入${DOMAIN_LABEL[d]}`} /></td>
                <td>{DOMAIN_LABEL[d]}</td>
                <td>
                  {materials === null && <span className="wb-sub">材料清单暂时不可读，请刷新。</span>}
                  {materials !== null && materials.length === 0 && <span className="wb-sub">客户档案暂无现行材料。</span>}
                  {materials !== null && materials.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {materials.map((m) => (
                        <label key={m.artifactId} className="wb-sub" title={m.createdAt ?? undefined}>
                          <input type="checkbox" checked={depPicked[d]?.[m.artifactId] === true} onChange={(ev) => setDepPicked((prev) => ({ ...prev, [d]: { ...(prev[d] ?? {}), [m.artifactId]: ev.target.checked } }))} />
                          {' '}{artifactLabel(m)}{m.grade && GRADE_TEXT[m.grade] ? ` · ${GRADE_TEXT[m.grade]}` : ''}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {exemptions.length > 0 && (
          <div className="wb-row">
            <span className="wb-sub">已登记的有效豁免：</span>
            {exemptions.map((e) => (
              <label key={e.exemptionId} className="wb-sub">
                <input type="checkbox" checked={pickedExemptions[e.exemptionId] === true} onChange={(ev) => setPickedExemptions((prev) => ({ ...prev, [e.exemptionId]: ev.target.checked }))} />
                {' '}{DOMAIN_LABEL[e.domain] ?? '专业意见'}
              </label>
            ))}
          </div>
        )}
        {(roles.includes("credit") || roles.includes("business") || roles.includes("admin")) && <button className="wb-btn" onClick={freezePackage}>保存本次材料依据</button>}
        <p className="wb-note">确认办理前，需要完成准入检查和必需的专业意见。</p>
      </div>

      <h3 className="wb-h2" style={{ marginTop: 12 }}>记录本专业意见</h3>
      <div className="wb-card dim">
        {myDomainRoles.length === 0 && <p className="wb-note">请由对应专业人员核对并记录意见。</p>}
        {myDomainRoles.length > 0 && (
          <>
            <div className="wb-row">
              <div className="wb-field" style={{ width: 130 }}><label>域</label>
                <select className="wb-select" aria-label="登记域" value={effDrDomain} onChange={(e) => { setDrDomain(e.target.value); setDrRunId(''); }}>
                  {myDomainRoles.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
                </select>
              </div>
              <div className="wb-field" style={{ width: 150 }}><label>意见类型</label>
                <select className="wb-select" aria-label="意见类型" value={drFindingType} onChange={(e) => setDrFindingType(e.target.value)}>
                  <option value="observation">观察</option>
                  <option value="concern">关注</option>
                  <option value="blocker">阻断项</option>
                </select>
              </div>
              <div className="wb-field" style={{ flex: 1 }}><label>采用的分析结果</label>
                {domainRuns.length > 0 ? (
                  <select className="wb-select" value={effRunId} onChange={(e) => setDrRunId(e.target.value)} aria-label="分析运行引用">
                    {domainRuns.map((r, index) => <option key={r} value={r}>已完成的{DOMAIN_LABEL[effDrDomain]}分析 {index + 1}</option>)}
                  </select>
                ) : (
                  <span className="wb-sub">{refsLoading ? '读取分析结果…' : '本专业分析尚未完成，暂不能记录意见。'}</span>
                )}
              </div>
            </div>
            <div className="wb-field"><label>域意见摘要（业务语言）</label>
              <textarea className="wb-textarea" rows={2} value={drSummary} onChange={(e) => setDrSummary(e.target.value)} placeholder="该域对当前材料/事实的结论与关注点（正式性仍属人）" />
            </div>
            <div className="wb-row">
              <label className="wb-sub"><input type="checkbox" checked={drAdopt} onChange={(e) => setDrAdopt(e.target.checked)} /> 同时记录采用决定</label>
              {drAdopt && <input className="wb-input" style={{ flex: 1 }} value={drAdoptNote} onChange={(e) => setDrAdoptNote(e.target.value)} placeholder="采用理由（必填，记录采用人/依据版本由服务端补全）" />}
              <span className="wb-sub">{basisPackageId ? '已关联本次材料依据' : '请先保存本次材料依据'}</span>
              <button className="wb-btn" onClick={registerDomainResult} disabled={domainRuns.length === 0 || !basisPackageId}>保存专业意见</button>
            </div>
          </>
        )}
      </div>

      <h3 className="wb-h2" style={{ marginTop: 12 }}>本次建议方案</h3>
      {isCredit && (
        <div className="wb-actions" style={{ marginBottom: 8 }}>
          <button className="wb-btn small ghost" onClick={() => runAction('assessment.create', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assessments`, {
            ruleVersion: chanRuleVersion,
            evidenceSnapshot: assessmentMaterials.map((m) => ({ artifactId: m.artifactId })),
          }, ['按当前规则与材料快照创建预评估，候选仅供参考。'])}
            disabled={refsLoading || !chanRuleVersion || !gateRef.id || assessmentMaterials.length === 0}>创建评估</button>
          {(!chanRuleVersion || !gateRef.id) && <span className="wb-sub">等待当前规则回执后创建评估。</span>}
        </div>
      )}
      {assessments.length === 0 && <p className="wb-note">暂无评估记录（事件窗口内）。</p>}
      {assessments.map((a) => (
        <div key={String(a.assessmentId)} className="wb-card dim">
          <div className="wb-row">
            <span className="wb-badge">预评估</span>
            <span>状态：{({collecting:'材料收集中',review_pending:'待复核',candidate_ready:'已有建议',preassessment_confirmed:'已确认',rejected:'不支持',superseded:'已撤回'} as Record<string,string>)[String(a.status)] ?? '待核对'}</span>
            {a.stale === true && <span className="wb-badge off">依据已过时</span>}
            <span className="wb-sub">候选：{a.candidate ? tendencyLabel(a.candidate.tendency) : '待分析'} {a.candidate?.supportableAmountMinor != null ? `· 支撑金额 ${fmtAmount(a.candidate.supportableAmountMinor)}` : '· 金额未知（未知明确标未知）'}</span>
          </div>
          {isCredit && (a.status === 'collecting' || a.status === 'review_pending' || a.status === 'candidate_ready') && (
            <CandidateForm
              assessmentId={String(a.assessmentId)}
              status={String(a.status ?? '')}
              onSubmit={(tendency, amount, term, price, rationale) => runAction(
                tendency === 'skip' ? 'assessment.decide' : 'assessment.candidate',
                tendency === 'skip'
                  ? `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/submit-review`
                  : `/api/jw/v2/actions/assessments/${encodeURIComponent(String(a.assessmentId))}/candidate`,
                tendency === 'skip' ? {} : {
                  candidate: {
                    tendency,
                    ...(amount != null ? { supportableAmountMinor: amount } : {}),
                    ...(term != null ? { suggestedTermMonths: term } : {}),
                    ...(price != null ? { referencePriceMinor: price.minor, priceUnit: price.unit, priceBasis: price.basis } : {}),
                    currency: 'CNY',
                    rationale,
                    producedBy: `page:${wb.session?.principalId ?? 'credit'}(synthetic)`,
                    conditions: [], warnings: [],
                  },
                },
                tendency === 'skip'
                  ? ['提交信审复核：进入送审记录（正/附条件预评估确认的前置）。']
                  : [`候选倾向：${tendency}`,
                     amount != null ? `支撑金额：${fmtAmount(amount)}（未知则留空）` : '支撑金额：不填（如实未知）',
                     term != null ? `建议期限：${term} 个月（融资期限，非授信有效期）` : '建议期限：不填（待评估）',
                     price != null ? `参考价格：${fmtAmount(price.minor)} / ${price.unit}（口径：${price.basis}）` : '参考价格：不填（口径未配置，不编造利率）',
                     '金额/期限/价格绑定同一候选版本（§13.2）；建议须经有权人员确认。'],
              )}
            />
          )}
        </div>
      ))}

      {act.node}
      <WbError error={wb.error && wb.error.includes('刷新失败') ? wb.error : null} />

    </div>
  );
}

// 信审候选表单（collecting→candidate；review_pending→提交复核）。AI/页面候选 authority 恒 none。
function CandidateForm({ assessmentId, status, onSubmit }: {
  assessmentId: string;
  status: string;
  onSubmit: (tendency: string, amountMinor: number | null, termMonths: number | null, price: { minor: number; unit: string; basis: string } | null, rationale: string) => void;
}) {
  const [tendency, setTendency] = useState('do');
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('');
  const [priceMinor, setPriceMinor] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [priceBasis, setPriceBasis] = useState('');
  const [rationale, setRationale] = useState('');
  // §13.2：价格三字段一体——提供价格时单位与口径必填（客户端先按与 Edge 相同规则预检，不触网）。
  const buildPrice = (): { minor: number; unit: string; basis: string } | null | 'invalid' => {
    if (!priceMinor.trim() && !priceUnit.trim() && !priceBasis.trim()) return null;
    const minor = Number(priceMinor);
    if (!Number.isFinite(minor) || minor < 0 || !priceUnit.trim() || !priceBasis.trim()) return 'invalid';
    return { minor, unit: priceUnit.trim(), basis: priceBasis.trim() };
  };
  return (
    <div className="wb-card dim" style={{ marginTop: 6 }}>
      <div className="wb-row">
        <span className="wb-sub">{status === 'collecting' ? '核对建议方案' : '已送审'}</span>
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
            <div className="wb-field" style={{ width: 120 }}><label>建议期限（月，可空）</label>
              <input className="wb-input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="如 36" aria-label="建议期限（月）" />
            </div>
            <div className="wb-field" style={{ width: 150 }}><label>参考价格（数值，可空）</label>
              <input className="wb-input" value={priceMinor} onChange={(e) => setPriceMinor(e.target.value)} placeholder="如 78000000（分）" aria-label="参考价格数值" />
            </div>
            <div className="wb-field" style={{ width: 110 }}><label>价格单位</label>
              <input className="wb-input" value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="如 元/年" aria-label="价格单位" />
            </div>
            <div className="wb-field" style={{ width: 160 }}><label>价格口径</label>
              <input className="wb-input" value={priceBasis} onChange={(e) => setPriceBasis(e.target.value)} placeholder="如 固定租金口径" aria-label="价格口径" />
            </div>
            <div className="wb-field" style={{ flex: 1 }}><label>理由（业务语言）</label>
              <input className="wb-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="依据哪些材料/事实（正式性仍属人）" />
            </div>
          </div>
          <div className="wb-actions">
            <button className="wb-btn small" disabled={!rationale.trim()} onClick={() => {
              const t = term.trim() ? Number(term) : null;
              if (t != null && (!Number.isInteger(t) || t < 1 || t > 240)) { setRationale(''); return; }
              const pr = buildPrice();
              if (pr === 'invalid') { setRationale(''); return; }
              onSubmit(tendency, amount.trim() ? Number(amount) : null, t, pr, rationale.trim());
            }}>登记候选意见（同版金额/期限/价格）</button>
            <button className="wb-btn small ghost" onClick={() => onSubmit('skip', null, null, null, '')}>直接提交复核</button>
          </div>
        </>
      )}
      {(status === 'review_pending' || status === 'candidate_ready') && (
        <div className="wb-actions">
          <button className="wb-btn small ghost" onClick={() => onSubmit('skip', null, null, null, '')}>提交复核</button>
        </div>
      )}
    </div>
  );
}
