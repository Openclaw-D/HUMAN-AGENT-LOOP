// goal-03c 工作本共享小件：分区卡/错误条/确认对话框/状态点。语义色全部带文字，不用颜色单独表义。
import { useState, type ReactNode } from 'react';
import { errorText } from '../../lib/workbench/wb-logic';
import './wb.css';

export function WbError({ error, onDismiss }: { error: string | null; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div className="wb-err" role="alert">
      <span>{error}</span>
      {onDismiss && <button className="wb-btn small ghost" style={{ marginLeft: 8 }} onClick={onDismiss}>知道了</button>}
    </div>
  );
}

export function WbDot({ tone, text }: { tone: 'green' | 'blue' | 'red' | 'gray' | 'yellow'; text: string }) {
  return <span><span className={`wb-dot ${tone}`} aria-hidden="true" />{text}</span>;
}

export function ConfirmDialog({ plan, busy, failed, onCancel, onConfirm }: {
  plan: { title: string; lines: string[]; confirmLabel: string; requestId?: string } | null;
  busy: boolean;
  failed?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!plan) return null;
  return (
    <div className="wb-dialog" role="dialog" aria-modal="true" aria-label={plan.title}>
      <div className="box">
        <h3>{plan.title}</h3>
        <ul>{plan.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        {failed && <p className="wb-note">上次提交尚未确认成功。重试会继续核对原提交，不会另建一笔。</p>}
        <div className="wb-actions">
          <button className="wb-btn" disabled={busy} onClick={onConfirm}>{busy ? '提交中…' : failed ? '重试本次提交' : plan.confirmLabel}</button>
          <button className="wb-btn ghost" disabled={busy} onClick={onCancel}>取消</button>
        </div>
        <p className="wb-note">提交结果会自动保存，重复点击不会重复办理。</p>
      </div>
    </div>
  );
}

/** 动作执行统一封装：二次确认 → 提交 → 错误码业务语言化。
 * requestId 纪律：编号在动作打开时固定并展示在确认框，失败/结果未知保留确认框，
 * 重试沿用同一编号（服务端幂等吸收）；502=结果未知时明确引导对账，不换号盲重。 */
export function useAction() {
  const [confirm, setConfirm] = useState<{ title: string; lines: string[]; confirmLabel: string; requestId?: string; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = (plan: { title: string; lines: string[]; confirmLabel: string; requestId?: string }, run: () => Promise<void>) => {
    setFailed(false);
    setErr(null);
    setConfirm({ ...plan, run });
  };
  const confirmAndRun = async () => {
    if (!confirm) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm.run();
      setConfirm(null);
      setFailed(false);
    } catch (e) {
      const code = (e as { code?: string }).code as string | undefined;
      const status = (e as { status?: number }).status;
      const unknown = status === 502 || code === 'UPSTREAM_UNKNOWN';
      setErr(unknown
        ? '提交结果还未确认。请查看办理记录，或稍后重试本次提交；系统会继续核对原提交，不会另建一笔。'
        : errorText(code, (e as Error).message));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const node: ReactNode = (
    <>
      <ConfirmDialog plan={confirm} busy={busy} failed={failed} onCancel={() => { if (!busy) setConfirm(null); }} onConfirm={() => void confirmAndRun()} />
      <WbError error={err} onDismiss={() => setErr(null)} />
    </>
  );
  return { open, node, busy };
}
