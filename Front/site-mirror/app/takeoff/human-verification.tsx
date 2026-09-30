// 人工核验登记（2026-09-30-final · 01-front · 修 DEF-03-05）：
// 收入（业务）/主体（政策）/权属（资产）三类事实核验的正式页面入口。调用既有授权接口
// registerArtifact（grade=confirmed），登记后按 RoundSupplement 同型触发受影响区重评
// （advance-plan→advance，requestId 幂等）。纪律：确认内容/依据/版本明确（勾选+理由必填），
// 不绕过权限（403 原样提示切角色），不把采用候选当作核验——本组件登记的是事实核验结论，
// 与意见采用（advance-rounds decision）是两类事件。
import { useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { DEMO_TENANT, wbActionRequestId } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from '../workbench/wb-parts';

type VerifyDomain = 'opportunity' | 'policy' | 'asset';

interface FactConfig {
  factKey: string;
  label: string;
  question: string;
  kind: 'number' | 'boolean';
  unit: 'wan' | null;
  valueHint: string;
}

const FACTS: Record<VerifyDomain, FactConfig> = {
  opportunity: { factKey: 'revenue_annual_declared', label: '年收入核验', question: '核验年度报表原件后，申报年收入是多少（万元）？', kind: 'number', unit: 'wan', valueHint: '与原件一致的年收入（万元）' },
  policy: { factKey: 'entity_identity_verified', label: '主体身份核验', question: '核对登记材料后，主体身份是否核验通过？', kind: 'boolean', unit: null, valueHint: '通过与不通过与原件/登记信息一致' },
  asset: { factKey: 'equipment_ownership_verified', label: '设备权属核验', question: '核对权属材料与外部登记后，设备权属是否核验通过？（申报与核验不一致时如实登记不通过）', kind: 'boolean', unit: null, valueHint: '权属清晰为通过；存在在先负担/冲突为不通过' },
};

type Pending = { customerId: string; factKey: string; phase: 'registering' | 'registered' | 'advancing'; requestId: string; advanceRequestId?: string; domain?: string; registration?: Record<string, unknown> };

const DOMAIN_BACKEND: Record<VerifyDomain, string> = { opportunity: 'business', policy: 'policy', asset: 'asset' };

export function HumanVerificationRegister({ wb, customerId, domain }: { wb: WbApi; customerId: string; domain: VerifyDomain }) {
  const fact = FACTS[domain];
  const backendDomain = DOMAIN_BACKEND[domain];
  const key = `jw:fact-verify:${customerId}:${fact.factKey}`;
  const readPending = (): Pending | null => {
    try { const p = JSON.parse(localStorage.getItem(key) ?? 'null'); return p?.customerId === customerId && p.factKey === fact.factKey ? p : null; } catch { return null; }
  };
  const original = readPending()?.registration?.content as { value?: unknown; unit?: string; note?: string } | undefined;
  const [boolValue, setBoolValue] = useState<'pass' | 'fail' | null>(typeof original?.value === 'boolean' ? original.value ? 'pass' : 'fail' : null);
  const [numValue, setNumValue] = useState(typeof original?.value === 'number' ? String(original.unit === 'CNY' ? original.value / 10000 : original.value) : '');
  const [basis, setBasis] = useState(original?.note ?? '');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const act = useAction();

  const pending = readPending;
  const persisted = pending();
  const valueText = fact.kind === 'number'
    ? (numValue.trim() ? `${numValue.trim()} 万元` : '')
    : boolValue === 'pass' ? '通过' : boolValue === 'fail' ? '不通过' : '';

  async function submit() {
    if (busy || saved) return;
    const value = fact.kind === 'number' ? Number(numValue.trim()) : boolValue === 'pass';
    if (fact.kind === 'number' && (!numValue.trim() || !Number.isFinite(value))) { setFormErr('请填写与原件一致的年收入数值。'); return; }
    if (fact.kind === 'boolean' && boolValue === null) { setFormErr('请先选择核验结论（通过/不通过）。'); return; }
    if (!basis.trim()) { setFormErr('请填写核验依据（原件/登记信息的核对说明，写入留痕）。'); return; }
    if (!verified) { setFormErr('请先勾选确认：我已核对上述材料并明确登记该结论。'); return; }
    setFormErr(null);
    const existing = pending();
    if (existing?.phase === 'registering' && !existing.registration) { setFormErr('旧核验请求缺少原始载荷，不能更换内容重发；请先从办理记录核对原请求。'); return; }
    let supersedes: string | undefined;
    if (!existing && wb.client?.read) {
      setBusy(true);
      try {
        const current = await wb.client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`);
        const sources = (Array.isArray(current.artifacts) ? current.artifacts : []).filter((a: Record<string, unknown>) => a.factKey === fact.factKey && a.current === true && !a.duplicateOf);
        if (sources.length > 1) { setFormErr('本事实存在多个现行来源，请先在材料页核实具体更正对象；核验不能默认覆盖冲突。'); return; }
        if (sources.length === 1) supersedes = String(sources[0].artifactId);
      } catch { setFormErr('未能核对现行材料版本，请稍后重试；未提交核验。'); return; }
      finally { setBusy(false); }
    }
    const requestId = existing?.requestId ?? wbActionRequestId('fact-verify', customerId, fact.factKey, String(Date.now()));
    const registration = existing?.registration ?? {
      tenantId: wb.session?.tenantId ?? DEMO_TENANT, requestId, kind: 'document', factKey: fact.factKey, grade: 'confirmed', ...(supersedes ? { supersedes } : {}),
      content: { value: fact.unit === 'wan' ? Number(value) * 10000 : value, ...(fact.unit ? { unit: 'CNY' } : {}), sourceMode: 'human_verified_document', factKey: fact.factKey, note: basis.trim() },
      materialMeta: { subjectRef: customerId, ...(fact.unit ? { unit: 'CNY' } : {}), caliber: '人工核验原件后登记（confirmed）' },
    };
    act.open(
      {
        title: `确认：${fact.label}——登记核验结论`,
        lines: [
          `核验对象：${fact.factKey}`,
          `结论：${valueText}`,
          `依据：${basis.trim().slice(0, 80)}${basis.trim().length > 80 ? '…' : ''}`,
          ...((registration.supersedes as string | undefined) ? ['本次核验更新唯一现行断言，原件及其历史保留。'] : []),
          '等级：confirmed（人工核验原件/登记信息后登记）',
          existing ? `复用原请求编号 ${requestId.slice(0, 18)}…（同载荷单次生效）` : '登记后自动重评受影响专业；本动作不等于采用任何候选意见。',
        ],
        confirmLabel: '登记核验结论',
        requestId,
      },
      async () => {
        setBusy(true); setNote('正在登记核验结论…');
        try {
          let p: Pending = existing ?? { customerId, factKey: fact.factKey, phase: 'registering', requestId, registration };
          localStorage.setItem(key, JSON.stringify(p));
          if (p.phase === 'registering') {
            const result = await wb.client!.registerArtifact(customerId, registration);
            if (result.ok !== true) throw new Error('登记结果尚未确认');
            p = { ...p, phase: 'registered' };
            localStorage.setItem(key, JSON.stringify(p));
          }
          const api = wb.client?.advance;
          if (api) {
            if (p.phase === 'advancing') {
              const recovered = await api.recover(customerId, p.advanceRequestId!);
              if (!recovered) throw new Error('原重评请求尚未确认，保留请求标识继续核对');
            } else {
              if (localStorage.getItem(`jw:column-advance:pending:${customerId}`)) throw new Error('另一办理请求尚待核对，请先等待其收敛');
              const plan = await api.plan(customerId, backendDomain);
              if (!plan.available || plan.allowedActions.some((a) => a.requiresHumanConfirmation)) throw new Error(plan.reason ?? '当前重评计划不可执行');
              p = { ...p, phase: 'advancing', advanceRequestId: crypto.randomUUID(), domain: plan.affectedDomains?.[0] ?? backendDomain };
              localStorage.setItem(key, JSON.stringify(p));
              await api.advance(customerId, plan, p.advanceRequestId!);
            }
          }
          localStorage.removeItem(key);
          setSaved(true);
          setNote('核验结论已登记，受影响专业已发起重评；可到平台页查看新状态。');
          await wb.refresh();
          window.dispatchEvent(new CustomEvent('jw:round-supplement', { detail: { customerId, domain: p.domain ?? backendDomain } }));
        } catch (e) {
          const err = e as { status?: number; message?: string };
          setNote(err.status === 403
            ? '当前身份无核验登记权限：请切换到对应专业角色后重试（原请求已保留，重试不换号）。'
            : `结果未确认：${err.message ?? '未知错误'}。原请求已保留，继续核对不会换 ID 重复登记。`);
        } finally { setBusy(false); }
      },
    );
  }

  return <section className="wb-card" aria-label={`${fact.label}（人工核验登记）`}>
    <h3>{fact.label} · 登记核验结论</h3>
    <p className="wb-note">{fact.question}{persisted ? '（发现未确认登记，继续提交复用原请求与内容。）' : ''}</p>
    {fact.kind === 'number'
      ? <label>{fact.valueHint}<input aria-label={`${fact.label}数值（万元）`} type="number" inputMode="decimal" value={numValue} disabled={busy || saved || !!persisted} onChange={(e) => setNumValue(e.target.value)} /></label>
      : <div role="radiogroup" aria-label={`${fact.label}结论`} style={{ display: 'flex', gap: 14 }}>
        <label><input type="radio" name={`fv-${fact.factKey}`} checked={boolValue === 'pass'} disabled={busy || saved || !!persisted} onChange={() => setBoolValue('pass')} /> 通过</label>
        <label><input type="radio" name={`fv-${fact.factKey}`} checked={boolValue === 'fail'} disabled={busy || saved || !!persisted} onChange={() => setBoolValue('fail')} /> 不通过（如实登记，不刷绿）</label>
      </div>}
    <label>核验依据（必填，写入留痕）<textarea aria-label="核验依据说明" rows={2} value={basis} disabled={busy || saved || !!persisted} onChange={(e) => setBasis(e.target.value)} placeholder="如：与年度报表原件第X行一致／动产融资统一登记显示存在在先租赁负担" /></label>
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <input type="checkbox" checked={verified} disabled={busy || saved} onChange={(e) => setVerified(e.target.checked)} />
      <span>我已核对上述材料及结论，明确登记为已核验（confirmed）；登记后受影响专业将按新事实重评。</span>
    </label>
    <button className="tk-btn" disabled={busy || saved} onClick={submit}>{persisted ? '继续核对原核验登记' : '提交核验结论并重评'}</button>
    <WbError error={formErr} onDismiss={() => setFormErr(null)} />
    <p role="status">{note || (saved ? '本事实核验已登记。' : '')}</p>
    {act.node}
  </section>;
}

/** 该格子是否应显示核验登记表单：三类事实域的"人工/核验"行且未完成时。 */
export function isVerificationRegisterCell(domain: string, row: string, completed: boolean): boolean {
  return !completed && row === 'human' && domain in FACTS;
}
