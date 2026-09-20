import { useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { WbClient } from '../../lib/workbench/wb-client';
import { admissionAmount, admissionEqual, takeoffError, type AdmissionAssessment, type AdmissionRequest } from '../../lib/workbench/takeoff-actions';

type Pending = { requestId: string; request: AdmissionRequest; accepted: boolean };
// 关闭抽屉仍保留未知结果锁；仅在当前会话客户端内存中保存，不泄漏到另一个身份。
const unresolved = new WeakMap<WbClient, Map<string, Pending>>();
const empty = { amount: '', term: '', purpose: '', equipment: '', note: '' };

export function AdmissionRequestPanel({ wb, onOpenProposal }: { wb: WbApi; onOpenProposal: () => void }) {
  const list = wb.snapshot?.assessments ?? [];
  const assessmentId = list[list.length - 1]?.assessmentId ?? null;
  return <AdmissionForm key={`${wb.session?.sessionId}:${wb.customerId}:${assessmentId}`} wb={wb} assessmentId={assessmentId} onOpenProposal={onOpenProposal} />;
}

function AdmissionForm({ wb, assessmentId, onOpenProposal }: { wb: WbApi; assessmentId: string | null; onOpenProposal: () => void }) {
  const client = wb.client;
  const [assessment, setAssessment] = useState<AdmissionAssessment | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const live = useRef(true);
  const lock = useRef(false);
  const canWrite = (wb.session?.roles ?? []).some((role) => ['business', 'credit'].includes(role));
  const pendingMap = client ? (unresolved.get(client) ?? new Map<string, Pending>()) : null;
  if (client && pendingMap) unresolved.set(client, pendingMap);
  const pending = assessmentId ? pendingMap?.get(assessmentId) : null;

  async function readBack(afterSave = false) {
    if (!client || !assessmentId || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const j = await client.read(`/api/jw/v2/assessments/${encodeURIComponent(assessmentId)}`);
      if (!live.current) return;
      const a = j.assessment as AdmissionAssessment | undefined;
      if (!j.ok || !a || a.assessmentId !== assessmentId || a.customerId !== wb.customerId || !Number.isInteger(a.version)) throw new Error('评估读回不完整或归属不匹配。');
      setAssessment(a);
      const waiting = pendingMap?.get(assessmentId);
      if (waiting && !admissionEqual(a.request, waiting.request)) {
        setBlocked(true); setSaved(false);
        setMessage('提交结果尚未核实，当前读回与提交内容不同。请读取最新登记核对，不要重复提交。');
        return;
      }
      if (waiting) pendingMap?.delete(assessmentId);
      setForm({ amount: a.request?.requestedAmountMinor == null ? '' : (a.request.requestedAmountMinor / 100).toFixed(2), term: a.request?.requestedTermMonths == null ? '' : String(a.request.requestedTermMonths), purpose: a.request?.purpose ?? '', equipment: a.request?.equipmentScope.join('\n') ?? '', note: a.request?.note ?? '' });
      setBlocked(false); setSaved(Boolean(afterSave || waiting));
      setMessage(afterSave || waiting ? '已从服务端读回登记内容。' : '已读取服务端当前登记；空白字段仍为待补。');
    } catch (e) {
      if (live.current) { setBlocked(true); setSaved(false); setMessage(`读回未完成：${takeoffError(e).message}`); }
    } finally { lock.current = false; if (live.current) setBusy(false); }
  }

  useEffect(() => { live.current = true; void readBack(); return () => { live.current = false; }; }, [client, assessmentId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!client || !assessment || !assessmentId || !canWrite || busy || blocked || pendingMap?.has(assessmentId) || lock.current) return;
    let request: AdmissionRequest;
    try {
      const term = form.term.trim() ? Number(form.term) : null;
      if (term !== null && (!/^\d+$/.test(form.term.trim()) || !Number.isInteger(term) || term < 1 || term > 240)) throw new Error('申请期限须为 1–240 的整数月；未明确可留空。');
      const equipmentScope = form.equipment.split('\n').map((line) => line.trim()).filter(Boolean);
      if (equipmentScope.length > 50 || equipmentScope.some((line) => line.length > 128)) throw new Error('设备范围最多 50 项，每项最多 128 字。');
      request = { productType: 'sale_leaseback', requestedAmountMinor: admissionAmount(form.amount), currency: assessment.request?.currency ?? 'CNY', requestedTermMonths: term, purpose: form.purpose.trim() || null, equipmentScope, note: form.note.trim() || null };
    } catch (e) { setMessage((e as Error).message); setSaved(false); return; }
    lock.current = true; setBusy(true); setSaved(false);
    const requestId = `admission-${crypto.randomUUID()}`;
    const waiting: Pending = { requestId, request, accepted: false };
    pendingMap?.set(assessmentId, waiting);
    try {
      const r = await client.updateAdmissionRequest(assessmentId, { requestId, assessmentVersion: assessment.version, request });
      if (!r.ok) throw new Error('未取得明确提交回执。');
      waiting.accepted = true;
      if (!live.current) return;
      lock.current = false;
      await readBack(true);
      if (live.current) await wb.refresh();
    } catch (e) {
      const problem = takeoffError(e);
      if (!problem.unknown) pendingMap?.delete(assessmentId);
      if (live.current) {
        setBlocked(problem.unknown || ['VERSION_CONFLICT', 'NOT_READY', 'FORBIDDEN', 'NOT_FOUND'].includes(problem.code));
        setMessage(problem.unknown ? '提交结果未知。请读取最新登记核对，不要重复提交。' : problem.message);
      }
    } finally { lock.current = false; if (live.current) setBusy(false); }
  }

  if (!assessmentId) return <section className="wb-card"><h3>首次回租需求登记</h3><p>当前客户尚无预评估。{wb.session?.roles.includes('credit') ? '核对材料后，可以开始本次预评估。' : '等待信审建立预评估，材料可先上传。'}</p>{wb.session?.roles.includes('credit') && <button className="tk-btn" onClick={onOpenProposal}>准备本次预评估</button>}</section>;
  const terminal = assessment && !['draft', 'collecting', 'candidate_ready', 'awaiting_human_review'].includes(assessment.status);
  return <section aria-label="首次回租需求登记">
    <p>记录客户表述，供准入预评估使用；不创建正式融资申请、额度或敞口。</p>
    {!canWrite && <p role="status">当前角色只读。需求登记需要业务或信审权限。</p>}
    {terminal && <p role="status">预评估已确认或已终结，需求不能再修改。</p>}
    <form className="tk-admission-form" onSubmit={(e) => void submit(e)}>
      <fieldset disabled={!canWrite || !assessment || busy || Boolean(terminal)}>
        <legend>首次回租 · {assessment?.request?.currency ?? 'CNY'}（空白项为待补）</legend>
        <label>申请金额（元）<input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        <label>申请期限（月）<input inputMode="numeric" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} /></label>
        <label>资金用途<textarea maxLength={200} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
        <label>设备范围（每行一项）<textarea value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} /></label>
        <label>补充说明<textarea maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <button className="tk-btn primary" disabled={blocked || Boolean(pending)} type="submit">{busy ? '正在提交与读回…' : '保存需求登记'}</button>
      </fieldset>
    </form>
    <p role="status" className={saved ? 'tk-saved-note' : ''}>{message}</p>
    <button className="tk-btn" disabled={busy} onClick={() => void readBack()}>读取最新登记（替换草稿）</button>
    {pending && <p className="tk-technical">{pending.accepted ? '已提交，正在核对保存结果。' : '保存结果尚未确认，请读取最新登记后再继续。'}</p>}
  </section>;
}
