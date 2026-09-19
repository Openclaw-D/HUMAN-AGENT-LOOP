// goal-03d 方案·决定面板（路径五）：decision-status 权威三行语义（候选≠批准≠可用）+
// 依据包全链——冻结（Gate 回执引用/域依赖声明/收口引用/豁免引用）、包详情（四域意见与当前性）、
// 域结果登记（域目录角色引用真实运行，authority=none 恒定）、包绑定提案、approver 正式决定
// （二次确认+幂等）。全部以 A 服务端裁决为准：条件未满足如实阻断，不提供绕过。
// 任务01 修复面：内部引用（Gate 回执/分析运行/工件/依据包）由系统从客户现行材料清单与
// 处理通道真实回执关联，业务人员只选业务对象、界面显示来源与版本；不再要求手填
// runId/packageId/规则版本。缺真实回执时如实显示并说明（服务端同样拒绝），不生成
// 分析完成/Gate/批准状态。手工引用仅保留为显式例外路径。
import { useCallback, useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import {
  buildConfirmPlan, collectRunRefs, DEMO_TENANT, decisionView, errorText, latestGateReceiptRef,
  pickedFactKeys, summarizeArtifacts, wbActionRequestId,
  type ArtifactRow,
} from '../../lib/workbench/wb-logic';
import { fmtAmount } from '../../lib/v5-preview/edge/edge-logic';
import { WbError, useAction } from './wb-parts';

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
  return `${KIND_TEXT[r.kind] ?? r.kind} · ${r.period ?? '期间—'}`;
}

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
  const act = useAction();

  // 系统关联引用：客户现行材料清单 + 处理通道回执（Gate/运行/规则版本）。读取失败如实显示。
  const [materials, setMaterials] = useState<ArtifactRow[] | null>(null);
  const [gateRef, setGateRef] = useState<{ id: string | null; loaded: boolean }>({ id: null, loaded: false });
  const [runsByDomain, setRunsByDomain] = useState<Record<string, string[]>>({});
  const [chanRuleVersion, setChanRuleVersion] = useState('');
  const [refsTaskId, setRefsTaskId] = useState('');
  const [refsErr, setRefsErr] = useState<string | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);

  // 依据包冻结：勾选业务对象（现行材料），系统组装 artifactIds/factKeys/规则版本
  const [depEnabled, setDepEnabled] = useState<Record<string, boolean>>({ credit: true });
  const [depPicked, setDepPicked] = useState<Record<string, Record<string, boolean>>>({});
  const [manualArtifactIds, setManualArtifactIds] = useState<Record<string, string>>({});
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
        setRefsTaskId(last);
      } else {
        setGateRef({ id: null, loaded: true });
        setRunsByDomain({});
        setRefsTaskId('');
      }
    } catch {
      setGateRef((g) => ({ ...g, loaded: true }));
      setRunsByDomain({});
      setRefsTaskId('');
      setRefsErr('处理通道回执读取失败：无法系统关联 Gate/运行引用（通道未接入或未完成时如实显示，不假装有真实运行）。');
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
    act.open(buildConfirmPlan(action, customerId, lines, requestId), async () => {
      await client.action(path, { requestId, tenantId: DEMO_TENANT, ...extraBody });
      await wb.refresh();
    });
  };

  const freezePackage = () => {
    const domainDeps = DOMAINS
      .filter((d) => depEnabled[d] === true)
      .map((d) => {
        const pickedIds = Object.entries(depPicked[d] ?? {}).filter(([, v]) => v).map(([k]) => k);
        const manual = (manualArtifactIds[d] ?? '').split(/[\s,，;；]+/).filter(Boolean);
        const useManual = manual.length > 0;
        const artifactIds = useManual ? manual : pickedIds;
        const factKeys = useManual ? [] : pickedFactKeys(materials ?? [], pickedIds);
        return { domain: d, artifactIds, factKeys, ...(chanRuleVersion ? { rulePackVersion: chanRuleVersion } : {}) };
      })
      .filter((d) => d.artifactIds.length > 0);
    if (domainDeps.length === 0) { setFreezeMsg('至少为一个域声明材料依赖：勾选该域的现行材料（系统从档案清单关联），或在例外路径手工引用。'); return; }
    const requestId = wbActionRequestId('wb-pkg', customerId, 'freeze', String(Date.now()));
    const lines = [
      gateRef.id
        ? `Gate 回执：${gateRef.id.slice(0, 26)}…（来源：处理通道任务回执${refsTaskId ? ` ${refsTaskId.slice(0, 16)}…` : ''}）`
        : 'Gate 回执：未引用（尚未读到真实 Gate 回执——无 Gate 结论的包不可能就绪）',
      `域依赖：${domainDeps.map((d) => `${DOMAIN_LABEL[d.domain]}×${d.artifactIds.length}件${d.factKeys.length > 0 ? `·事实键${d.factKeys.length}` : ''}`).join('、') || '无'}`,
      `规则版本：${chanRuleVersion || '未读取到（由服务端按当前激活版本裁决）'}`,
      sessionId ? `收口引用：会话 ${sessionId.slice(0, 18)}…（修订号服务端解析）` : '收口引用：无（如政策要求会先被拒）',
      `豁免引用：${Object.entries(pickedExemptions).filter(([, v]) => v).map(([k]) => k.slice(0, 12) + '…').join('、') || '无'}`,
      '工件/Gate/规则版本引用均由系统从真实清单与回执关联；冻结后依据=包版本；候选≠批准。',
    ];
    act.open(buildConfirmPlan('package.freeze', `客户 ${customerId}`, lines, requestId), async () => {
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
    const manual = (manualArtifactIds[effDrDomain] ?? '').split(/[\s,，;；]+/).filter(Boolean);
    const artifactIds = manual.length > 0 ? manual : pickedIds;
    const requestId = wbActionRequestId('wb-dres', customerId, `dr:${effDrDomain}`, String(Date.now()));
    const lines = [
      `包：${basisPackageId.slice(0, 26)}…（当前依据包，系统关联）· 域：${DOMAIN_LABEL[effDrDomain] ?? effDrDomain}`,
      `运行引用：${effRunId.slice(0, 26)}…（来源：处理通道任务回执${refsTaskId ? ` ${refsTaskId.slice(0, 16)}…` : ''}；须为已完成运行，失败运行被服务端拒绝）`,
      `意见：${drSummary.trim().slice(0, 60)}…（authority=none，服务端强制）`,
      drAdopt ? `同时记录采用决定（人 + 理由：${drAdoptNote.trim().slice(0, 40)}…）` : '不记录采用（仅登记意见）',
    ];
    act.open(buildConfirmPlan('package.domain-result', `客户 ${customerId}`, lines, requestId), async () => {
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

      <h3 className="wb-h2" style={{ marginTop: 12 }}>冻结决策依据包（credit/business · 引用系统关联，Gate 只收服务端回执引用）</h3>
      <div className="wb-card dim">
        <div className="wb-row">
          <button className="wb-btn small ghost" onClick={() => void loadRefs()} disabled={refsLoading}>{refsLoading ? '读取中…' : '重新读取现行材料与通道回执'}</button>
          <span className="wb-sub">收口会话：{sessionId ? sessionId.slice(0, 18) + '…' : '无（收口引用可选）'}</span>
        </div>
        <WbError error={refsErr} onDismiss={() => setRefsErr(null)} />
        <WbError error={freezeMsg} onDismiss={() => setFreezeMsg(null)} />
        <div className="wb-kv"><span className="k">Gate 回执（系统关联）</span>
          <span>{gateRef.id
            ? `${gateRef.id.slice(0, 30)}…（来源：处理通道任务回执${refsTaskId ? ` ${refsTaskId.slice(0, 16)}…` : ''}）`
            : gateRef.loaded ? '未读到真实 Gate 回执（通道未完成或未链接 A）——冻结仍可提交，但该包不可能就绪（服务端同口径）' : '读取中…'}</span>
        </div>
        <div className="wb-kv"><span className="k">规则版本（系统关联）</span><span>{chanRuleVersion || '未读取到（由服务端按当前激活版本裁决）'}</span></div>
        <table className="wb-table">
          <thead><tr><th>纳入</th><th>域</th><th>该域依赖的现行材料（勾选即引用，系统从档案清单关联）</th></tr></thead>
          <tbody>
            {DOMAINS.map((d) => (
              <tr key={d}>
                <td><input type="checkbox" checked={depEnabled[d] === true} onChange={(e) => setDepEnabled((prev) => ({ ...prev, [d]: e.target.checked }))} aria-label={`纳入${DOMAIN_LABEL[d]}`} /></td>
                <td>{DOMAIN_LABEL[d]}</td>
                <td>
                  {materials === null && <span className="wb-sub">材料清单读取失败或为空：可用下方例外路径手工引用（服务端仍会校验真实性）。</span>}
                  {materials !== null && materials.length === 0 && <span className="wb-sub">客户档案暂无现行材料。</span>}
                  {materials !== null && materials.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {materials.map((m) => (
                        <label key={m.artifactId} className="wb-sub" title={`${m.artifactId}${m.createdAt ? ` · ${m.createdAt}` : ''}`}>
                          <input type="checkbox" checked={depPicked[d]?.[m.artifactId] === true} onChange={(ev) => setDepPicked((prev) => ({ ...prev, [d]: { ...(prev[d] ?? {}), [m.artifactId]: ev.target.checked } }))} />
                          {' '}{artifactLabel(m)}{m.factKey ? ` · ${m.factKey}` : ''}{m.grade && GRADE_TEXT[m.grade] ? ` · ${GRADE_TEXT[m.grade]}` : ''}
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
        <details style={{ marginTop: 8 }}>
          <summary className="wb-sub">例外路径：手工引用工件 ID（仅当引用不在上方清单；普通办理不需要，服务端仍校验真实性）</summary>
          <div className="wb-row" style={{ marginTop: 6 }}>
            {DOMAINS.map((d) => (
              <div key={d} className="wb-field" style={{ width: 170 }}><label>{DOMAIN_LABEL[d]}</label>
                <input className="wb-input" value={manualArtifactIds[d] ?? ''} onChange={(e) => setManualArtifactIds((prev) => ({ ...prev, [d]: e.target.value }))} placeholder="逗号分隔 artifactId（可选）" aria-label={`${DOMAIN_LABEL[d]}手工工件引用`} />
              </div>
            ))}
          </div>
          <p className="wb-note">手工引用覆盖对应域的勾选；此路径不产生任何分析或 Gate 结论。</p>
        </details>
        <p className="wb-note">必需域来自批准政策（服务端强制）：未登记结果的必需域须有有效豁免；Gate 未登记的包不可能就绪。豁免本身由 admin/业务在 A 登记后在此引用。</p>
      </div>

      <h3 className="wb-h2" style={{ marginTop: 12 }}>登记域意见（域目录角色 · 运行引用系统关联 · authority=none）</h3>
      <div className="wb-card dim">
        {myDomainRoles.length === 0 && <p className="wb-note">我的目录角色不含域专员（policy/credit/commerce/asset）：登记入口不显示（服务端同样拒绝）。</p>}
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
              <div className="wb-field" style={{ flex: 1 }}><label>分析运行（系统从通道任务回执关联{refsTaskId ? ` · 任务 ${refsTaskId.slice(0, 14)}…` : ''}）</label>
                {domainRuns.length > 0 ? (
                  <select className="wb-select" value={effRunId} onChange={(e) => setDrRunId(e.target.value)} aria-label="分析运行引用">
                    {domainRuns.map((r) => <option key={r} value={r}>{r.slice(0, 34)}…（处理通道回执）</option>)}
                  </select>
                ) : (
                  <span className="wb-sub">{refsLoading ? '读取通道回执中…' : '该域暂无已完成的真实分析运行回执——不能登记（服务端同样拒绝非真实运行）。'}</span>
                )}
              </div>
            </div>
            <div className="wb-field"><label>域意见摘要（业务语言）</label>
              <textarea className="wb-textarea" rows={2} value={drSummary} onChange={(e) => setDrSummary(e.target.value)} placeholder="该域对当前材料/事实的结论与关注点（正式性仍属人）" />
            </div>
            <div className="wb-row">
              <label className="wb-sub"><input type="checkbox" checked={drAdopt} onChange={(e) => setDrAdopt(e.target.checked)} /> 同时记录采用决定</label>
              {drAdopt && <input className="wb-input" style={{ flex: 1 }} value={drAdoptNote} onChange={(e) => setDrAdoptNote(e.target.value)} placeholder="采用理由（必填，记录采用人/依据版本由服务端补全）" />}
              <span className="wb-sub">目标包：{basisPackageId ? `${basisPackageId.slice(0, 24)}…（当前依据包，系统关联）` : '未冻结——先冻结依据包'}</span>
              <button className="wb-btn" onClick={registerDomainResult} disabled={domainRuns.length === 0 || !basisPackageId}>登记域意见</button>
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
            <span>依据包（系统关联）：</span>
            <span className="wb-sub">{basisPackageId
              ? `${basisPackageId.slice(0, 24)}…（当前依据包，修订 r${basis?.revision ?? '?'}）`
              : '未冻结——正式提案会被服务端 BASIS_PACKAGE_REQUIRED 拒绝'}</span>
            <button
              className="wb-btn"
              onClick={() => {
                const latest = assessments[assessments.length - 1];
                if (!latest?.assessmentId) return;
                if (!basisPackageId) { setPkgErr('正式提案必须绑定依据包：先冻结依据包（服务端 BASIS_PACKAGE_REQUIRED 强制）。'); return; }
                runAction('facility.propose', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/facilities`, {
                  productType: 'direct_leasing',
                  approvedAmountMinor: Number(amountMinor) || 0,
                  currency: 'CNY',
                  termMonths: Number(months) || undefined,
                  assessmentId: String(latest.assessmentId),
                  packageId: basisPackageId,
                }, [`提案（候选）：${fmtAmount(Number(amountMinor) || 0)} / ${months} 个月`, `绑定评估：${String(latest.assessmentId).slice(0, 20)}…`, `绑定依据包：${basisPackageId.slice(0, 20)}…（系统关联当前依据包）`, '候选≠批准：需有权人正式批准。']);
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
