import { useState } from 'react';

/** Only a persisted server terminal record may open this presentation. */
export interface CaseTerminalRecord {
  customerId: string;
  kind: 'completed' | 'rejected';
  roundCount: number;
  recordId: string;
  occurredAt: string;
  archived: boolean;
  archiveRef?: string | null;
}

export function readCaseTerminal(value: unknown): CaseTerminalRecord | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.customerId !== 'string' || (v.kind !== 'completed' && v.kind !== 'rejected') ||
      !Number.isSafeInteger(v.roundCount) || Number(v.roundCount) < 1 ||
      typeof v.recordId !== 'string' || typeof v.occurredAt !== 'string' || v.archived !== true) return null;
  return v as unknown as CaseTerminalRecord;
}

export function verifiedCaseEnding(record: CaseTerminalRecord | null, customerId: string, scenario: '好' | '中' | '差' | null): CaseTerminalRecord | null {
  if (!record || record.customerId !== customerId || !record.recordId || !record.occurredAt || !record.archived) return null;
  // Five/six advances are presentation targets, never a terminal-state predicate.
  // Any of the synthetic cases may have a different authoritative outcome.
  if (scenario && Number.isSafeInteger(record.roundCount) && record.roundCount > 0 &&
      (record.kind === 'completed' || record.kind === 'rejected')) return record;
  return null;
}

export function CaseEnding({ record, onRecords }: { record: CaseTerminalRecord; onRecords: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const rejected = record.kind === 'rejected';
  return <div className={`tk-case-ending${rejected ? ' rejected' : ''}`} role="dialog" aria-modal="true" aria-label={rejected ? '案例已拒绝归档' : '案例本次流程已办结'}>
    <div className="tk-case-ending-symbol" aria-hidden="true">{rejected ? '✕' : <img src="/objects/asset-v1.png" alt=""/>}</div>
    <h1>{rejected ? '信审拒绝 · 已归档' : '本次流程已办结'}</h1>
    <p>{rejected ? '保留拒绝依据与办理记录；后续成功路径不再推进。' : '案例流程办结不等于正式额度批准或资金到账。'}</p>
    <small>服务端记录 {record.recordId} · {record.occurredAt} · 第 {record.roundCount} 轮{record.archiveRef?` · 归档 ${record.archiveRef}`:''}</small>
    <div className="tk-case-ending-actions"><button onClick={() => setDismissed(true)}>返回工作台</button><button onClick={() => { setDismissed(true); onRecords(); }}>查看记录</button></div>
  </div>;
}
