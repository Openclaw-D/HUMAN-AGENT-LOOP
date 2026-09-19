// goal-03c 结果面板（路径六）：正式记录留存与导出——决策回执对账（requestId）、
// 报告三视图生成与导出（json/markdown，按 A 受众分权）、最近事件（正式历史只追加）。
import { useCallback, useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { errorText, fmtWhen } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';

export function ResultPanel({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const client = wb.client;
  const [reports, setReports] = useState<Array<{ reportId?: string; kind?: string; version?: number; audience?: string; createdAt?: string }> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [requestId, setRequestId] = useState('');
  const [receiptText, setReceiptText] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ eventId: string; eventType?: string; at?: string }> | null>(null);
  const names: Record<string, string> = { internal_summary: '内部小结', customer_supplement: '客户补充材料', use_prep_sheet: '用信准备表' };
  const act = useAction();

  const loadReports = useCallback(async () => {
    if (!client) return;
    try {
      const j = await client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/reports`);
      setReports((j.reports ?? []) as typeof reports);
    } catch (e) {
      setLoadErr(errorText((e as { code?: string }).code, '报告清单读取失败（客户受众或权限不足时如实显示）'));
    }
  }, [client, customerId]);

  useEffect(() => { void loadReports(); }, [loadReports]);

  if (!client) return null;

  const generate = (kind: string) => {
    // 主体绑定：内部小结→决策依据包；用信准备表→用信申请；客户补充材料→客户本身。
    // 前提不满足时显式提示（服务端同样结构校验），不伪造可生成。
    const subjects: Record<string, string> = { internal_summary: '决策依据包', use_prep_sheet: '在途用信申请' };
    const subjectId = kind === 'customer_supplement'
      ? customerId
      : kind === 'internal_summary'
        ? String(wb.snapshot?.decisionStatus?.basis?.packageId ?? '')
        : String(wb.snapshot?.financingRequests?.find((f) => f.frId)?.frId ?? '');
    if (!subjectId) {
      setLoadErr(`生成「${names[kind] ?? kind}」需要${subjects[kind] ?? '主体'}：当前尚不存在（服务端结构校验同口径）。`);
      return;
    }
    act.open(
      { title: `生成报告：${names[kind] ?? kind}`, lines: ['同状态重生成返回同一份（幂等）；分受众查看权由服务端裁决。'], confirmLabel: '生成' },
      async () => {
        await client.action(`/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/reports`, {
          requestId: `wb-rep-${customerId}-${Date.now()}`.slice(0, 128),
          tenantId: 't1',
          kind,
          subjectId,
        });
        await loadReports();
      },
    );
  };

  const exportReport = async (reportId: string, format: 'json' | 'markdown') => {
    try {
      const j = await client.read(`/api/jw/v2/reports/${encodeURIComponent(reportId)}?format=${format}`);
      const content = format === 'json' ? JSON.stringify(j, null, 2) : String((j as { markdown?: string; content?: string }).markdown ?? (j as { content?: string }).content ?? JSON.stringify(j, null, 2));
      const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${customerId}-${reportId}.${format === 'json' ? 'json' : 'md'}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setLoadErr(errorText((e as { code?: string }).code, '报告导出失败'));
    }
  };

  const reconcile = async () => {
    setReceiptText(null);
    if (!requestId.trim()) return;
    try {
      const r = await client.receipt(requestId.trim());
      setReceiptText(r.found ? `找到正式回执：${JSON.stringify(r.receipt, null, 2)}` : '未找到该编号的回执（可能属于其他身份，或命令未到达后台）。');
    } catch (e) {
      setReceiptText(errorText((e as { code?: string }).code, '对账查询失败'));
    }
  };

  const loadEvents = async () => {
    try {
      const j = await client.eventsPage(customerId, '0', 50);
      setEvents((j.events ?? []).slice(-20).reverse().map((e) => ({ eventId: e.eventId, eventType: e.payloadRef?.type, at: undefined })));
    } catch (e) {
      setLoadErr(errorText((e as { code?: string }).code, '事件读取失败'));
    }
  };

  return (
    <div>
      <h3 className="wb-h2">报告（分受众导出 · 服务端白名单组装）</h3>
      <WbError error={loadErr} onDismiss={() => setLoadErr(null)} />
      <div className="wb-actions">
        <button className="wb-btn ghost" onClick={() => generate('internal_summary')}>生成·内部小结</button>
        <button className="wb-btn ghost" onClick={() => generate('customer_supplement')}>生成·客户补充材料</button>
        <button className="wb-btn ghost" onClick={() => generate('use_prep_sheet')}>生成·用信准备表</button>
      </div>
      {reports === null && <p className="wb-note">加载中…</p>}
      {reports !== null && reports.length === 0 && <p className="wb-note">尚无报告。生成后可在此导出。</p>}
      {reports !== null && reports.length > 0 && (
        <table className="wb-table">
          <thead><tr><th>编号</th><th>类型</th><th>版本</th><th>导出</th></tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={String(r.reportId)}>
                <td>{String(r.reportId ?? '').slice(0, 26)}</td>
                <td>{String(r.kind ?? '—')}</td>
                <td>v{String(r.version ?? '—')}</td>
                <td>
                  <button className="wb-btn small ghost" onClick={() => void exportReport(String(r.reportId), 'markdown')}>Markdown</button>{' '}
                  <button className="wb-btn small ghost" onClick={() => void exportReport(String(r.reportId), 'json')}>JSON</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="wb-h2" style={{ marginTop: 14 }}>提交结果对账（requestId）</h3>
      <p className="wb-note">关键提交结果未知时：保留编号，不换号重发。在此查询正式回执。</p>
      <div className="wb-row">
        <input className="wb-input" style={{ width: 320 }} value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="粘贴提交时的幂等编号" />
        <button className="wb-btn ghost" onClick={() => void reconcile()}>查询回执</button>
      </div>
      {receiptText && <pre className="wb-card" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{receiptText}</pre>}

      <h3 className="wb-h2" style={{ marginTop: 14 }}>正式历史（只追加，不静默改写）</h3>
      <div className="wb-actions"><button className="wb-btn ghost" onClick={() => void loadEvents()}>加载最近事件（≤50 条窗口）</button></div>
      {events !== null && (
        <ul className="wb-note" style={{ paddingLeft: 18 }}>
          {events.map((e) => <li key={e.eventId}>{e.eventType ?? '事件'} · {e.eventId.slice(0, 14)}… {e.at ? fmtWhen(e.at) : ''}</li>)}
        </ul>
      )}
      {act.node}
    </div>
  );
}
