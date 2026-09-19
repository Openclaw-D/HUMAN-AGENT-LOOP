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

export function ConfirmDialog({ plan, busy, onCancel, onConfirm }: {
  plan: { title: string; lines: string[]; confirmLabel: string } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!plan) return null;
  return (
    <div className="wb-dialog" role="dialog" aria-modal="true" aria-label={plan.title}>
      <div className="box">
        <h3>{plan.title}</h3>
        <ul>{plan.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="wb-actions">
          <button className="wb-btn" disabled={busy} onClick={onConfirm}>{busy ? '提交中…' : plan.confirmLabel}</button>
          <button className="wb-btn ghost" disabled={busy} onClick={onCancel}>取消</button>
        </div>
        <p className="wb-note">正式提交进入后台记录；重复点击由幂等编号吸收，不会重复落单。</p>
      </div>
    </div>
  );
}

/** 动作执行统一封装：二次确认 → 提交 → 错误码业务语言化；502 结果未知返回 code 供面板提示对账。 */
export function useAction() {
  const [confirm, setConfirm] = useState<{ title: string; lines: string[]; confirmLabel: string; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = (plan: { title: string; lines: string[]; confirmLabel: string }, run: () => Promise<void>) => setConfirm({ ...plan, run });
  const confirmAndRun = async () => {
    if (!confirm) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm.run();
      setConfirm(null);
    } catch (e) {
      const code = (e as { code?: string }).code as string | undefined;
      setErr(errorText(code, (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const node: ReactNode = (
    <>
      <ConfirmDialog plan={confirm} busy={busy} onCancel={() => { if (!busy) setConfirm(null); }} onConfirm={() => void confirmAndRun()} />
      <WbError error={err} onDismiss={() => setErr(null)} />
    </>
  );
  return { open, node, busy };
}
