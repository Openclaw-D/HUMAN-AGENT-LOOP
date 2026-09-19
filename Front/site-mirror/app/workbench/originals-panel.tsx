// goal-03d/e 材料·原件面板：A 档案（权威材料清单/受限上传 ≤512KB/版本取代链）+ 处理通道卡
// （常驻解析链分段进度/A 侧回执留痕/签名 URL 预览——IR-02-C 消费面）。goal-03e：A 档案件预览
// 经单件读回（IR-03-3 / CONTRACT §11.2）接线——信封件内联/下载，非信封件如实显示无字节，不伪造预览。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import {
  base64ToBytes, buildOriginalEnvelope, envelopeDataUrl, errorText, fmtWhen, previewKind, summarizeArtifacts,
  type ArtifactRow, type PreviewKind,
} from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';
import { ChannelCard } from './channel-card';

type PreviewState =
  | { artifactId: string; phase: 'loading' }
  | { artifactId: string; phase: 'ready'; kind: PreviewKind; name: string; mime: string; size: number | null; dataUrl?: string; text?: string; bytes?: Uint8Array; supersededBy: string | null; contentJson: string | null };

const KINDS = [
  { v: 'purchase_contract', t: '购销合同' },
  { v: 'invoice', t: '发票' },
  { v: 'equipment_list', t: '设备清单' },
  { v: 'bank_statement', t: '银行流水' },
  { v: 'financial_statement', t: '财务报表' },
  { v: 'original_upload', t: '其他原件' },
];

export function OriginalsPanel({ wb, customerId, onChanged }: { wb: WbApi; customerId: string; onChanged?: () => void }) {
  const client = wb.client;
  const [rows, setRows] = useState<ArtifactRow[] | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ factKey: string; assertionCount: number }>>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [kind, setKind] = useState('original_upload');
  const [factKey, setFactKey] = useState('');
  const [subject, setSubject] = useState('');
  const [period, setPeriod] = useState('');
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [procDetail, setProcDetail] = useState<{ artifactId: string; current: Record<string, unknown> | null; history: Array<Record<string, unknown>> } | null>(null);
  const [procErr, setProcErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const act = useAction();

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

  const submit = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) { setFileMsg('请先选择文件'); return; }
    void f.arrayBuffer().then(async (buf) => {
      const pre = buildOriginalEnvelope({ name: f.name, mime: f.type, bytes: new Uint8Array(buf) });
      if (!pre.ok) { setFileMsg(pre.message); return; }
      setFileMsg(null);
      act.open(
        {
          title: '上传原件（受限通道）',
          lines: [
            `文件：${pre.envelope.name}（${pre.envelope.mime || '未知类型'}，${pre.envelope.size} 字节）`,
            `材料种类：${KINDS.find((k) => k.v === kind)?.t ?? kind}${factKey ? ` · 事实键 ${factKey}` : ''}`,
            subject ? `主体：${subject}` : '主体：未填',
            period ? `期间：${period}` : '期间：未填',
            '说明：原件字节经受限通道登记入客户档案（≤512KB）；核验等级由后台核定，客户申报不产生等级。',
          ],
          confirmLabel: '确认上传',
        },
        async () => {
          await client.uploadOriginal(customerId, {
            requestId: `wb-up-${customerId}-${Date.now()}`.slice(0, 128),
            kind,
            factKey: factKey || undefined,
            materialMeta: { ...(subject ? { subjectRef: subject } : {}), ...(period ? { period } : {}) },
            file: { name: pre.envelope.name, mime: pre.envelope.mime, dataBase64: pre.envelope.data },
          });
          if (fileRef.current) fileRef.current.value = '';
          await load();
          onChanged?.();
        },
      );
    });
  };

  return (
    <div>
      <h3 className="wb-h2">材料清单（服务端权威：A evidence_artifacts）</h3>
      <WbError error={loadErr} onDismiss={() => setLoadErr(null)} />
      {rows === null && <p className="wb-note">加载中…</p>}
      {rows !== null && rows.length === 0 && <p className="wb-note">暂无材料。用下方表单上传第一份原件。</p>}
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
      <div className="wb-card dim" style={{ marginTop: 10 }}>
        <h3 className="wb-h2">上传原件（受限通道 ≤512KB）</h3>
        <p className="wb-note warn">说明：原件预览已接线——A 档案件走单件读回（IR-03-3/§11.2，上行清单「预览」按钮）；处理通道件走 Connectors 签名 URL（下方通道卡）。上游不可用时如实报错，不提供伪造预览。</p>
        <div className="wb-row">
          <div className="wb-field" style={{ width: 160 }}><label>材料种类</label>
            <select className="wb-select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
            </select>
          </div>
          <div className="wb-field" style={{ width: 160 }}><label>事实键（可选）</label>
            <input className="wb-input" value={factKey} onChange={(e) => setFactKey(e.target.value)} placeholder="如 invoice_total" />
          </div>
          <div className="wb-field" style={{ width: 150 }}><label>主体（可选）</label>
            <input className="wb-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="如 远山精密" />
          </div>
          <div className="wb-field" style={{ width: 130 }}><label>期间（可选）</label>
            <input className="wb-input" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="如 2026-07" />
          </div>
        </div>
        <div className="wb-row">
          <input type="file" ref={fileRef} aria-label="选择原件文件" />
          <button className="wb-btn" onClick={submit}>上传登记</button>
        </div>
        <WbError error={fileMsg} onDismiss={() => setFileMsg(null)} />
        {act.node}
      </div>
      <ChannelCard wb={wb} customerId={customerId} onChanged={onChanged} />
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
