// board-round-02 任务01·材料·原件面板（方案R 统一链）：
// A 权威材料清单（aBridge 回写结果）+ 单件读回预览（IR-03-3/§11.2）+ A G3 处理状态 +
// 统一提交链（channel-card：一次提交进通道，自动回写 A——不再有 A 直传/通道二选一）。
import { useCallback, useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import {
  base64ToBytes, envelopeDataUrl, errorText, fmtWhen, previewKind, summarizeArtifacts,
  type ArtifactRow, type PreviewKind,
} from '../../lib/workbench/wb-logic';
import { WbError } from './wb-parts';
import { ChannelCard } from './channel-card';

type PreviewState =
  | { artifactId: string; phase: 'loading' }
  | { artifactId: string; phase: 'ready'; kind: PreviewKind; name: string; mime: string; size: number | null; dataUrl?: string; text?: string; bytes?: Uint8Array; supersededBy: string | null; contentJson: string | null };

export function OriginalsPanel({ wb, customerId, onChanged }: { wb: WbApi; customerId: string; onChanged?: () => void }) {
  const client = wb.client;
  const [rows, setRows] = useState<ArtifactRow[] | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ factKey: string; assertionCount: number }>>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [procDetail, setProcDetail] = useState<{ artifactId: string; current: Record<string, unknown> | null; history: Array<Record<string, unknown>> } | null>(null);
  const [procErr, setProcErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const j = await client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`);
      const s = summarizeArtifacts((j.artifacts ?? []) as Array<Record<string, unknown>>);
      setRows(s.rows);
      setConflicts(((j.factConflicts ?? []) as Array<{ factKey: string; assertionCount: number }>));
    } catch (e) {
      setLoadErr(errorText((e as { code?: string }).code, '材料清单读取失败'));
    }
  }, [client, customerId]);

  useEffect(() => { void load(); }, [load]);

  if (!client) return null;

  // A G3 材料处理状态（服务身份回执制；客户侧白名单投影走门户 my/materials——此处为内部读）。
  const loadProcessing = async (artifactId: string) => {
    setProcErr(null);
    try {
      const j = await client.artifactProcessing(customerId, artifactId);
      setProcDetail({ artifactId, current: (j.current ?? null) as Record<string, unknown> | null, history: (j.history ?? []) as Array<Record<string, unknown>> });
    } catch (e) {
      setProcDetail(null);
      setProcErr(errorText((e as { code?: string }).code, '处理状态读取失败（该件可能尚无处理回执）'));
    }
  };

  // 原件预览（goal-03e）：IR-03-3 / CONTRACT §11.2 单件读回——信封件 image/text 内联、其余下载；
  // 非信封件（结构化登记）如实显示无字节原件；上游 404/502 原样业务语言呈现，不伪造预览。
  const openPreview = async (artifactId: string) => {
    setPreviewErr(null);
    setPreview({ artifactId, phase: 'loading' });
    try {
      const j = await client.artifactContent(customerId, artifactId);
      const art = ((j ?? {}).artifact ?? null) as {
        materialFile?: { name?: string; mime?: string; size?: number; encoding?: string; data?: string } | null;
        content?: unknown; supersededBy?: string | null;
      } | null;
      if (!art) { setPreview(null); setPreviewErr('读回为空：该件可能不含可预览内容'); return; }
      const mf = art.materialFile ?? null;
      if (mf && typeof mf.data === 'string' && mf.data.length > 0) {
        const mime = mf.mime ?? 'application/octet-stream';
        const name = mf.name ?? 'original';
        const kind = previewKind(mime, name);
        if (kind === 'image') {
          setPreview({ artifactId, phase: 'ready', kind, name, mime, size: mf.size ?? null, dataUrl: envelopeDataUrl(mime, mf.data), supersededBy: art.supersededBy ?? null, contentJson: null });
        } else if (kind === 'text') {
          const text = new TextDecoder().decode(base64ToBytes(mf.data));
          setPreview({ artifactId, phase: 'ready', kind, name, mime, size: mf.size ?? null, text: text.slice(0, 20000), supersededBy: art.supersededBy ?? null, contentJson: null });
        } else {
          setPreview({ artifactId, phase: 'ready', kind, name, mime, size: mf.size ?? null, bytes: base64ToBytes(mf.data), supersededBy: art.supersededBy ?? null, contentJson: null });
        }
      } else {
        let contentJson: string | null = null;
        if (art.content != null) {
          try { contentJson = JSON.stringify(art.content, null, 1).slice(0, 4000); } catch { contentJson = null; }
        }
        setPreview({ artifactId, phase: 'ready', kind: 'download', name: '(非信封件)', mime: '—', size: null, supersededBy: art.supersededBy ?? null, contentJson });
      }
    } catch (e) {
      setPreview(null);
      setPreviewErr(errorText((e as { code?: string }).code, '原件读回失败（不存在/无权/上游未提供）'));
    }
  };

  const downloadPreview = (p: Extract<PreviewState, { phase: 'ready' }>) => {
    if (!p.bytes) return;
    const url = URL.createObjectURL(new Blob([p.bytes as BlobPart], { type: p.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = p.name || 'original';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div>
      <h3 className="wb-h2">材料清单（服务端权威：A evidence_artifacts · 方案R 下由处理链自动回写）</h3>
      <WbError error={loadErr} onDismiss={() => setLoadErr(null)} />
      {rows === null && <p className="wb-note">加载中…</p>}
      {rows !== null && rows.length === 0 && <p className="wb-note">暂无材料。用下方「材料提交与处理链」上传第一份原件——一次提交，自动登记回本清单并推进处理。</p>}
      {rows !== null && rows.length > 0 && (
        <table className="wb-table">
          <thead><tr><th>种类</th><th>事实键</th><th>等级</th><th>状态</th><th>主体/期间</th><th>对象锚定</th><th>登记时间</th><th>处理</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.artifactId}>
                <td>{r.kind}</td>
                <td>{r.factKey ?? '—'}</td>
                <td><WbGrade grade={r.grade} /></td>
                <td>{r.current
                  ? <span className="wb-badge live">现行</span>
                  : <span className="wb-badge off" title={r.supersededBy ? `已被 ${r.supersededBy} 取代` : ''}>已取代</span>}
                  {r.supersedes && <div className="wb-sub">取代 {r.supersedes}</div>}
                </td>
                <td>{[r.subject, r.period].filter(Boolean).join(' · ') || '—'}</td>
                <td>{r.objectRef ?? '—'}</td>
                <td>{fmtWhen(r.createdAt)}</td>
                <td>
                  <div className="wb-actions">
                    <button className="wb-btn small ghost" onClick={() => void loadProcessing(r.artifactId)}>处理状态</button>
                    <button className="wb-btn small ghost" onClick={() => void openPreview(r.artifactId)}>预览</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <WbError error={previewErr} onDismiss={() => setPreviewErr(null)} />
      {preview && (
        <div className="wb-card" style={{ marginTop: 8 }} aria-label="原件预览">
          <div className="wb-row"><strong>原件预览（A 档案单件读回 · IR-03-3/§11.2）· {preview.artifactId.slice(0, 22)}…</strong>
            <button className="wb-btn small ghost" onClick={() => setPreview(null)}>收起</button>
          </div>
          {preview.phase === 'loading' && <p className="wb-note">读回中…</p>}
          {preview.phase === 'ready' && (
            <>
              <div className="wb-row wb-sub">
                <span>文件：{preview.name}</span>
                <span>类型：{preview.mime}</span>
                {preview.size != null && <span>{preview.size} 字节</span>}
                {preview.supersededBy && <span className="wb-badge off">已被 {preview.supersededBy.slice(0, 14)}… 取代（历史件仍可读）</span>}
              </div>
              {preview.kind === 'image' && preview.dataUrl && (
                <img src={preview.dataUrl} alt={`原件预览 ${preview.name}`} style={{ maxWidth: '100%', maxHeight: 360, border: '1px solid #ddd' }} />
              )}
              {preview.kind === 'text' && preview.text != null && (
                <pre className="wb-note" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{preview.text}</pre>
              )}
              {preview.kind === 'download' && preview.bytes && (
                <div className="wb-row">
                  <button className="wb-btn small" onClick={() => downloadPreview(preview)}>下载原件（该类型不内联展示）</button>
                </div>
              )}
              {preview.kind === 'download' && !preview.bytes && (
                <p className="wb-note">{preview.contentJson ? '非信封件（结构化登记，无字节原件）。结构化内容：' : '该件无字节原件（非信封登记）。'}</p>
              )}
              {preview.contentJson && <pre className="wb-note" style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{preview.contentJson}</pre>}
            </>
          )}
        </div>
      )}
      <WbError error={procErr} onDismiss={() => setProcErr(null)} />
      {procDetail && (
        <div className="wb-card" style={{ marginTop: 8 }}>
          <div className="wb-row"><strong>处理状态（A G3 权威回执）· {procDetail.artifactId.slice(0, 22)}…</strong>
            <button className="wb-btn small ghost" onClick={() => setProcDetail(null)}>收起</button>
          </div>
          {!procDetail.current && <p className="wb-note">尚无处理回执：等待常驻服务推进（received→parsed→analyzed→needs_review/failed）。</p>}
          {procDetail.current && (
            <div className="wb-kv"><span className="k">当前段</span>
              <span>{String((procDetail.current as { stage?: string }).stage ?? 'registered')}
                {(procDetail.current as { failureReason?: string }).failureReason ? ` · 失败原因：${String((procDetail.current as { failureReason?: string }).failureReason)}` : ''}
                {(procDetail.current as { nextAction?: string }).nextAction ? ` · 下一动作：${String((procDetail.current as { nextAction?: string }).nextAction)}` : ''}
              </span>
            </div>
          )}
          {procDetail.history.length > 0 && (
            <ul className="wb-note" style={{ paddingLeft: 18 }}>
              {procDetail.history.map((h, i) => (
                <li key={i}>尝试 {String((h as { runRef?: string }).runRef ?? '?')}：{String((h as { stage?: string }).stage ?? '')}{(h as { failureReason?: string }).failureReason ? `（${String((h as { failureReason?: string }).failureReason)}）` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="wb-card bad">
          <strong>事实冲突（同键多个现行断言，绝不自动取最后）：</strong>
          <ul>{conflicts.map((c) => <li key={c.factKey}>{c.factKey}：{c.assertionCount} 个现行断言，需人工复核</li>)}</ul>
        </div>
      )}
      <p className="wb-note warn">材料提交只有一个入口（下方「材料提交与处理链」）：一次上传进常驻处理链，A 档案登记由后台自动回写——不再提供 A 直传表单，不需要选择链路或重复上传。原件预览已接线：A 档案件走单件读回（IR-03-3/§11.2，上行清单「预览」按钮）；处理链件走 Connectors 签名 URL。上游不可用时如实报错，不提供伪造预览。</p>
      <ChannelCard wb={wb} customerId={customerId} onChanged={() => { void load(); onChanged?.(); }} />
    </div>
  );
}

function WbGrade({ grade }: { grade: string | null }) {
  const map: Record<string, { tone: string; text: string }> = {
    unverified: { tone: 'off', text: '未核验（客户申报）' },
    source_supported: { tone: 'live', text: '来源支撑' },
    verified: { tone: 'live', text: '已核验' },
  };
  const g = grade ? (map[grade] ?? { tone: 'off', text: grade }) : { tone: 'off', text: '—' };
  return <span className={`wb-badge ${g.tone}`}>{g.text}</span>;
}
