// 任务三 C2·最小前端接线四项（只消费真实后台；不新增完整产品页面）：
//   1 EdgeStatusBar  连接/模式提示：Live·真实后台 / 本地合成演示 / 重连中；录制/回放/训练受限位如实；
//     能力位 chips（模型/视频/录制逐项独立，无 all_ok）+ readiness 逐依赖（任务03 C1.6/C3.5）
//   2 EdgeSessionBar 会话操作条：状态、开始、暂停/恢复自动提问、结束本轮、等待原因（会话块来自服务端）
//   3 EdgeVerifyCards 侧栏核验卡：当前问题/核验项、证据定位（openItems）、需要谁行动
//   4 EdgeCreditPanel 额度/报告区：候选/已批准/可用/可支用、依据包/Gate/决策就绪、阻断位、报告入口
//   5 EdgeObjectLinks 对象清单（C4 二维桥接保底）：objectId/siteSnapshotId/sceneVersion 关联状态
//   6 EdgeChatAudienceToggle live 聊天受众切换（internal/customer）
// 后端拒绝原样显示（error + code）；不本地改灯色/状态/额度。
import { useRef, useState } from 'react';
import type { EdgeLiveApi } from '../../lib/v5-preview/edge/use-edge-live';
import {
  actionRequestId, capabilityChips, deriveCreditLines, deriveDecisionLines, deriveSessionActions, deriveWaitReason, fmtAmount, modeBadge,
} from '../../lib/v5-preview/edge/edge-logic';
import { EdgeHttpError } from '../../lib/v5-preview/edge/edge-client';
import '../../lib/v5-preview/edge/edge-panels.css';

const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: '待处理', waiting_answer: '等回答', answered: '已口述', waiting_evidence: '等材料',
  to_verify: '待人工核验', verified: '已核验', conflict: '冲突', deferred: '转会后待办', stale_review: '需复核',
};

const OPEN_ITEM_LABEL: Record<string, string> = {
  assessment_awaiting_review: '评估待人工复核',
  assessment_stale: '评估依据已失效',
  facility_blocker: '额度阻断位',
  reservation_open: '用信预占中',
  external_reconcile: '外部结果待对账',
  review_queue_open: '决策复核队列开放项',
  decision_blocked_actions: '依据包阻断动作',
};

/** 1) 连接/模式提示 + 连接表单（off 态）。 */
export function EdgeStatusBar({ edge }: { edge: EdgeLiveApi }) {
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:48200');
  const [credential, setCredential] = useState('');
  const [customerId, setCustomerId] = useState('');
  const badge = modeBadge(edge.phase);
  const live = edge.phase === 'live' || edge.phase === 'reconnecting';
  return (
    <section className="jwEdgeBar" aria-label="连接与模式（真实后台/本地合成）">
      <span className="jwEdgeBadge" data-tone={badge.tone}>{badge.text}</span>
      {edge.buildId ? <span className="jwEdgeMeta">Edge build {edge.buildId}</span> : null}
      {live ? (
        <span className="jwEdgeMeta" title={String(edge.snapshotVersion ?? '')}>
          来源：真实后台 · 快照版本 {String(edge.snapshotVersion ?? '未知')}
          {edge.eventWindow ? ` · 事件窗口 ${edge.eventWindow.buffered} 条${edge.eventWindow.gap ? '（缺号补查中）' : ''}${edge.eventWindow.truncated ? '（更早历史走分页）' : ''}` : ''}
        </span>
      ) : null}
      {live ? (
        <span className="jwEdgeChips" role="list" aria-label="能力位与依赖（逐项独立，无 all_ok 汇总）">
          {capabilityChips(edge.capabilities).map((c) => (
            <span key={c.key} role="listitem" className="jwEdgeChipSm" data-tone={c.tone} title={c.text}>{c.text}</span>
          ))}
          {(edge.readiness?.checks ?? []).map((c) => (
            <span key={c.name} role="listitem" className="jwEdgeChipSm" data-tone={c.ok ? 'info' : 'off'} title={JSON.stringify(c.detail ?? {})}>
              {c.name}:{c.ok ? '就绪' : '不可用'}
            </span>
          ))}
          {Object.entries(edge.freshness ?? {}).map(([k, f]) => (
            <span key={k} role="listitem" className="jwEdgeChipSm" data-tone={f.ok ? 'info' : 'warn'} title={f.code ?? ''}>
              {k}:{f.ok ? '当前' : '不可用'}
            </span>
          ))}
        </span>
      ) : null}
      {live ? (
        <span className="jwEdgeMeta">录制/回放/训练：未建（受限，如实标注）· 画面为二维清单（本交付无三维场区）· 手机上传/实时视频通道未建</span>
      ) : null}
      {edge.error ? <span className="jwEdgeErr" role="alert">{edge.error}</span> : null}
      {edge.reconciling ? <span className="jwEdgeWarn" role="status">关键命令结果未知：对账中（以回执/快照为准，不重复发送）</span> : null}
      {edge.phase === 'off' ? (
        <span className="jwEdgeMeta" title="上游暂无授权客户列表接口（IR-03-A①）">客户目录接口未提供：可办客户范围不完整，需手输客户 ID（缺失≠不存在）</span>
      ) : null}
      {edge.phase === 'live' ? (
        <button type="button" className="jwEdgeBtn" onClick={edge.disconnect}>断开真实后台</button>
      ) : (
        <span className="jwEdgeForm">
          <input className="jwEdgeInput" size={26} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="Edge 地址" placeholder="Edge 地址" />
          <input className="jwEdgeInput" size={14} type="password" autoComplete="off" value={credential} onChange={(e) => setCredential(e.target.value)} aria-label="凭据（仅提交到 Edge 服务端换会话）" placeholder="凭据" />
          <input className="jwEdgeInput" size={18} value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="客户 ID" placeholder="客户 ID" />
          <button
            type="button"
            className="jwEdgeBtn"
            disabled={edge.phase === 'connecting' || credential === '' || customerId === ''}
            onClick={() => { void edge.connect(baseUrl, credential, customerId.trim()); }}
          >
            {edge.phase === 'connecting' ? '连接中…' : '连接真实后台'}
          </button>
        </span>
      )}
    </section>
  );
}

/** 2) 会话操作条：服务端会话快照驱动；可用动作优先投影服务端 availableActions（契约以服务端为准），
 *  未提供时才按 runStatus 本地推导并如实标注；命令经 Edge 动作代理，拒绝原样显示。 */
export function EdgeSessionBar({ edge }: { edge: EdgeLiveApi }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // 复核 P3③：同一（会话×动作）未决尝试复用同一 requestId——502 后重试必须同 ID；
  // 成功或服务端确定性拒绝后清除，之后的再次点击才是新意图、新 ID。
  const ridMapRef = useRef(new Map<string, string>());
  const session = edge.snapshot?.session ?? null;
  if (!session) return null;
  const wait = deriveWaitReason(session);
  const { acts, fromServer } = deriveSessionActions(session);
  const run = (key: string, path: string) => {
    const ridKey = `${session.sessionId ?? 's'}:${key}`;
    let rid = ridMapRef.current.get(ridKey);
    if (!rid) {
      rid = actionRequestId(session.sessionId ?? 's', key, `${Date.now()}`);
      ridMapRef.current.set(ridKey, rid);
    }
    setBusyAction(key);
    setActionError(null);
    edge.client?.action(path, { requestId: rid, expectedVersion: session.version ?? 0 })
      .then(() => { ridMapRef.current.delete(ridKey); return edge.refresh(); })
      .catch((e: unknown) => {
        const err = e as EdgeHttpError;
        if (err.status === 502) {
          edge.setReconciling(true);
          setActionError(`命令结果未知（${err.requestId ?? rid}）：对账中，用同一请求重试（同 ID 复用）`);
        } else {
          ridMapRef.current.delete(ridKey);
          setActionError(`服务端拒绝：${err.code}`);
        }
      })
      .finally(() => setBusyAction(null));
  };
  const paths: Record<string, string> = {
    start: `/api/jw/v2/actions/inspections/${encodeURIComponent(session.sessionId ?? '')}/start`,
    pause: `/api/jw/v2/actions/inspections/${encodeURIComponent(session.sessionId ?? '')}/pause`,
    resume: `/api/jw/v2/actions/inspections/${encodeURIComponent(session.sessionId ?? '')}/resume`,
    end: `/api/jw/v2/actions/inspections/${encodeURIComponent(session.sessionId ?? '')}/end`,
    close: `/api/jw/v2/actions/inspections/${encodeURIComponent(session.sessionId ?? '')}/close`,
  };
  const renderable = acts.filter((a) => paths[a.key] !== undefined);
  return (
    <div className="jwEdgeSessionBar" aria-label="检查会话操作条（真实后台）">
      <span className="jwEdgeSessionTitle">{session.title ?? '检查会话'}</span>
      <span className="jwEdgeChip" data-run={session.runStatus}>运行：{session.runStatus ?? '未知'}</span>
      <span className="jwEdgeChip" data-closure={session.closureStatus}>收口：{session.closureStatus ?? '未知'}</span>
      {renderable.map((a) => (
        <button
          key={a.key}
          type="button"
          className="jwEdgeBtn"
          disabled={busyAction !== null || edge.reconciling}
          onClick={() => run(a.key, paths[a.key])}
        >
          {busyAction === a.key ? '提交中…' : a.label}
        </button>
      ))}
      {!fromServer ? <span className="jwEdgeMeta">（服务端未提供 availableActions：以上为本地推导，仅发起用）</span> : null}
      {wait ? <span className="jwEdgeWait" role="status">等待原因：{wait}</span> : null}
      {actionError ? <span className="jwEdgeErr" role="alert">{actionError}</span> : null}
    </div>
  );
}

/** 3) 核验卡：开放事项（服务端 openItems）+ 核验项状态 + 会后待办。 */
export function EdgeVerifyCards({ edge }: { edge: EdgeLiveApi }) {
  const snap = edge.snapshot;
  if (!snap) return null;
  const openItems = snap.openItems ?? [];
  const session = snap.session ?? null;
  const unverified = (session?.items ?? []).filter((i) => i.status && i.status !== 'verified');
  const followups = session?.followups ?? [];
  if (openItems.length === 0 && unverified.length === 0 && followups.length === 0) {
    return <p className="jwEdgeMuted">真实后台：当前无开放核验事项。</p>;
  }
  return (
    <div className="jwEdgeCards" aria-label="核验卡（真实后台）">
      {openItems.map((o) => (
        <div key={`${o.kind}-${o.ref ?? ''}`} className="jwEdgeCard" data-tone={o.kind === 'external_reconcile' || o.kind === 'assessment_stale' ? 'warn' : 'info'}>
          <p className="jwEdgeCardTitle">{OPEN_ITEM_LABEL[o.kind] ?? o.kind}{o.needRole ? ` · 需要谁行动：${o.needRole}` : ''}</p>
          <p className="jwEdgeCardBody">{o.detail ?? ''}{o.ref ? `（${o.ref}）` : ''}</p>
        </div>
      ))}
      {unverified.map((i) => (
        <div key={i.itemId} className="jwEdgeCard" data-tone={i.status === 'conflict' ? 'warn' : 'info'}>
          <p className="jwEdgeCardTitle">{i.title ?? i.itemKey} · {ITEM_STATUS_LABEL[i.status ?? ''] ?? i.status}</p>
          <p className="jwEdgeCardBody">负责：{i.responsibleRole ?? '未知'}</p>
        </div>
      ))}
      {followups.map((f) => (
        <div key={f.followupId} className="jwEdgeCard" data-tone="warn">
          <p className="jwEdgeCardTitle">会后待办 · {f.ownerRole ?? '未知'}</p>
          <p className="jwEdgeCardBody">{f.reason ?? ''}{f.nextAction ? ` → ${f.nextAction}` : ''}</p>
        </div>
      ))}
    </div>
  );
}

/** 4) 额度/报告区：候选/已批准/可用/可支用、依据版本、阻断位；会后报告入口（服务端 audience 分权）。 */
export function EdgeCreditPanel({ edge }: { edge: EdgeLiveApi }) {
  const snap = edge.snapshot;
  if (!snap) return null;
  const lines = deriveCreditLines(snap);
  const decisionLines = deriveDecisionLines(snap);
  if (lines.length === 0 && decisionLines.length === 0) return null;
  return (
    <div className="jwEdgeCredit" aria-label="额度与依据（真实后台）">
      <h3 className="jwEdgeCreditTitle">额度与依据（服务端账本推导；候选 ≠ 正式审批）</h3>
      <ul className="jwEdgeCreditList">
        {decisionLines.map((l) => (
          <li key={`d-${l.label}`} className="jwEdgeCreditLine" data-tone={l.tone}>
            <span className="jwEdgeCreditLabel">{l.label}</span>
            <span className="jwEdgeCreditValue">{l.value}</span>
          </li>
        ))}
        {lines.map((l) => (
          <li key={l.label} className="jwEdgeCreditLine" data-tone={l.tone}>
            <span className="jwEdgeCreditLabel">{l.label}</span>
            <span className="jwEdgeCreditValue">{l.value}</span>
          </li>
        ))}
      </ul>
      {snap.totalsMinor ? (
        <p className="jwEdgeCreditMeta">
          预占合计 {fmtAmount(snap.totalsMinor.reserved, 'CNY')} · 承诺 {fmtAmount(snap.totalsMinor.committed, 'CNY')} · 在途敞口 {fmtAmount(snap.totalsMinor.exposureNow, 'CNY')}
        </p>
      ) : null}
      <p className="jwEdgeCreditMeta">
        会后报告入口：检查小结按 internal/customer 双受众由服务端分权投影（当前部署经 Edge harness 或 A 直连查看；客户视图不含内部风险策略）。
      </p>
    </div>
  );
}

/** 5) 对象清单（C4.3 二维桥接保底）：objectId/siteSnapshotId/sceneVersion 关联状态（服务端 object-inventory）。
 *  三维场区本交付未建（D27-S BLOCKED）——本面板是二维清单事实源，不冒充三维视图。 */
export function EdgeObjectLinks({ edge }: { edge: EdgeLiveApi }) {
  const snap = edge.snapshot;
  if (!snap) return null;
  const objects = snap.objectInventory ?? [];
  const truncated = snap.listTruncated?.objectInventory === true;
  return (
    <div className="jwEdgeObjects" aria-label="对象清单（真实后台·二维桥接保底）">
      <h3 className="jwEdgeCreditTitle">对象清单（objectId/sceneVersion 锚定 · 二维保底）</h3>
      {objects.length === 0 ? (
        <p className="jwEdgeMuted">服务端对象清单为空或本会话不可见（灰色=未知，不虚构设备/现场）。</p>
      ) : (
        <ul className="jwEdgeObjectList">
          {objects.map((o, i) => (
            <li key={o.objectId ?? `obj-${i}`} className="jwEdgeObjectRow">
              <span className="jwEdgeObjectId">{o.objectId ?? '未知ID'}</span>
              <span className="jwEdgeObjectMeta">
                {o.objectType ?? '类型未知'} · 场景 {o.siteSnapshotId ?? '未锚定'}@{o.sceneVersion ?? '未知'}
                {o.linkState ? ` · ${o.linkState}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {truncated ? <p className="jwEdgeMuted">清单超过快照上限：仅显示前若干条（服务端分页为准，不静默丢弃）。</p> : null}
      <p className="jwEdgeCreditMeta">
        三维多人场区本交付未建（D27-S BLOCKED，如实标注）：采集新现场须走 CaptureRequest（未建，不开放）；
        本清单不读取业务库之外的数据，不向客户端转发内部风险图层。
      </p>
    </div>
  );
}

/** 6) live 聊天受众切换（C2.5）：显式选择 internal/customer，不随角色视角隐式变化。 */
export function EdgeChatAudienceToggle({ value, onChange, disabled }: {
  value: 'customer' | 'internal';
  onChange: (v: 'customer' | 'internal') => void;
  disabled?: boolean;
}) {
  return (
    <div className="jwEdgeAudience" role="radiogroup" aria-label="消息受众">
      <span className="jwEdgeMeta">受众：</span>
      {(['internal', 'customer'] as const).map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a ? 'true' : 'false'}
          className="jwEdgeBtn"
          data-active={value === a ? 'true' : 'false'}
          disabled={disabled}
          onClick={() => onChange(a)}
        >
          {a === 'internal' ? '内部沟通' : '发往客户'}
        </button>
      ))}
      <span className="jwEdgeMeta">内部内容外发客户需服务端外发权限，默认拒绝（留审计）</span>
    </div>
  );
}
