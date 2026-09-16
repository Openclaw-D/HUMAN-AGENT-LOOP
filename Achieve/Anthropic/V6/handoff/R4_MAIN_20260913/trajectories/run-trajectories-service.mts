// R4 · 三条真实运行轨迹执行器（服务层直调 remote-service.ts——HTTP route 的同一代码路径）。
// 隔离：V5_PREVIEW_DATA_DIR 指向 R4 evidence/iso-runtime-data（store 独立落盘；不触 3311/3321/3399）。
// 全部合成演示；真实发生才记录。错误按 throw→code 捕获（与 remoteErrorResponse 同语义）。
import * as svc from '../../../../jianwei-v3/site/lib/v5-preview/remote-service.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const RUNTAG = 'r' + Date.now().toString(36);
const RID = (b) => `${b}-${RUNTAG}`;
const DATA_DIR = process.env.V5_PREVIEW_DATA_DIR;
if (!DATA_DIR) { console.error('需要 V5_PREVIEW_DATA_DIR'); process.exit(2); }

const stateV = () => {
  const d = svc.getRemoteState();
  return d.remoteVersion ?? d.version;
};
function DET(sid) { return svc.getRemoteSessionDetail(sid); }
const annVer = (sid, annId) => DET(sid).annotations.find((a) => a.annotationId === annId)?.version ?? null;

const results: { step: string; ok: boolean; error?: string }[] = [];
/** 捕获式调用：throw/reject → {ok:false,error:code}；与 remoteErrorResponse 同语义。 */
async function call(step: string, fn: () => unknown): Promise<Record<string, unknown>> {
  try {
    const x = await fn();
    return x && typeof x === 'object' ? { ok: true, ...(x as Record<string, unknown>) } : { ok: true, value: x };
  } catch (e) {
    const err = e as { code?: string; name?: string; message?: string };
    return { ok: false, error: err.code ?? err.name ?? 'THROWN', message: String(err.message ?? e).slice(0, 140) };
  }
}
function must(p, label) {
  return p.then((r) => {
    results.push({ step: label, ok: r.ok === true, error: r.ok ? undefined : r.error });
    if (!r.ok) { console.error(`[FAIL] ${label}: ${r.error} ${r.message ?? ''}`); process.exitCode = 3; }
    return r;
  });
}

const out = { runTag: RUNTAG, layer: 'service（与HTTP route同代码路径）', dataDir: DATA_DIR, trajectories: {} };

// ===== 轨迹1：正常访谈（提问→业务回复→人工确认→挂断暂停→F2三探针→显式恢复→A桥接追问→人工接续）=====
const t1 = {};
{
  let r = await must(call('t1-create', () => svc.createRemoteSession({ requestId: RID('r4a-create'), expectedVersion: stateV(), title: 'R4轨迹1：正常访谈（合成）' })), 't1-create');
  const sid = r.session.sessionId; let v = r.remoteVersion;
  t1.createGeneration = r.session.generation;
  r = await must(call('t1-attach', () => svc.attachEvidence({ requestId: RID('r4a-ev'), expectedVersion: v, sessionId: sid, fixtureId: 'fixture-inspection' })), 't1-attach');
  const ev = r.evidence.evidenceId; v = r.remoteVersion;
  r = await must(call('t1-annotate', () => svc.createAnnotation({ requestId: RID('r4a-ann'), expectedVersion: v, sessionId: sid, evidenceId: ev, evidenceVersion: 1, question: '轨迹1：请说明设备现状（合成）', rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } })), 't1-annotate');
  const ann = r.annotation.annotationId; v = r.remoteVersion;
  // 预建第二问标注：暂停中的人工补证落此条（补证不受限语义不变），pause/resume 引用的 ann1 终值不再演进
  r = await must(call('t1-ann2pre', () => svc.createAnnotation({ requestId: RID('r4a-ann2pre'), expectedVersion: stateV(), sessionId: sid, evidenceId: ev, evidenceVersion: 1, question: '轨迹1第二问：恢复后接续追问（合成）', rect: { x: 0.4, y: 0.4, w: 0.3, h: 0.2 } })), 't1-ann2pre');
  const ann2 = r.annotation.annotationId;
  r = await must(call('t1-reply', () => svc.replyAnnotation({ requestId: RID('r4a-reply'), expectedVersion: stateV(), sessionId: sid, annotationId: ann, kind: 'business', text: '轨迹1：三台运行正常（合成）' })), 't1-reply');
  r = await must(call('t1-confirm', () => svc.createReview({ requestId: RID('r4a-confirm'), expectedVersion: stateV(), sessionId: sid, targetType: 'evidence', targetId: ev, targetVersion: 1, action: 'confirm', opinion: '轨迹1：人工确认（合成）' })), 't1-confirm');
  const ann1VerBeforePause = annVer(sid, ann);
  r = await must(call('t1-pause', () => svc.createReview({ requestId: RID('r4a-pause'), expectedVersion: stateV(), sessionId: sid, targetType: 'annotation', targetId: ann, targetVersion: ann1VerBeforePause, action: 'pause_round', opinion: '轨迹1：访谈结束挂断暂停（合成）' })), 't1-pause');
  t1.paused = true; t1.pauseTargetAnnotationVersion = ann1VerBeforePause; t1.pauseGeneration = DET(sid).session.generation;
  // F2 三探针：模型推进拒 / 确认通过类拒 / 人工补证允许（设计）
  r = await call('t1-blk-fu', () => svc.simulateFollowUps({ requestId: RID('r4a-blk-fu'), expectedVersion: stateV(), sessionId: sid, annotationId: ann }));
  t1.pausedModelFollowUpRejected = !r.ok && r.error === 'SESSION_PAUSED';
  r = await call('t1-blk-confirm', () => svc.createReview({ requestId: RID('r4a-blk-confirm'), expectedVersion: stateV(), sessionId: sid, targetType: 'evidence', targetId: ev, targetVersion: 1, action: 'confirm', opinion: '轨迹1：暂停中确认（应被拒）' }));
  t1.pausedConfirmRejected = !r.ok && r.error === 'SESSION_PAUSED';
  r = await call('t1-blk-reply', () => svc.replyAnnotation({ requestId: RID('r4a-blk-reply'), expectedVersion: stateV(), sessionId: sid, annotationId: ann2, kind: 'business', text: '轨迹1：暂停中人工补证（设计允许）' }));
  t1.pausedHumanReplyAllowed = r.ok === true;
  // 显式恢复（引用 ann1 终值=当前），恢复后第二问走 A 桥接追问 + 人工接续
  r = await must(call('t1-resume', () => svc.createReview({ requestId: RID('r4a-resume'), expectedVersion: stateV(), sessionId: sid, targetType: 'annotation', targetId: ann, targetVersion: annVer(sid, ann), action: 'resume_round', opinion: '轨迹1：显式恢复（合成）' })), 't1-resume');
  t1.resumeGeneration = DET(sid).session.generation;
  r = await call('t1-fu2', () => svc.simulateFollowUps({ requestId: RID('r4a-fu2'), expectedVersion: stateV(), sessionId: sid, annotationId: ann2 }));
  t1.resumedFollowUpOk = r.ok === true;
  if (r.ok) { t1.followUpResultStatus = r.result?.status ?? r.status; t1.followUpNotice = r.result?.notice ?? r.notice; t1.followUpRequestIds = r.result?.candidate?.requestIds ?? r.candidate?.requestIds; }
  else { t1.followUpError = r.error; }
  r = await must(call('t1-after-resume', () => svc.replyAnnotation({ requestId: RID('r4a-after'), expectedVersion: stateV(), sessionId: sid, annotationId: ann2, kind: 'business', text: '轨迹1：恢复后人工接续（合成）' })), 't1-after-resume');
  t1.ann1FinalVer = annVer(sid, ann);
  t1.session = sid; t1.annotation = ann; t1.endV = stateV();
  out.trajectories.t1_normal = t1;
}

// ===== 轨迹2：迟到旧版被拒→同ID新版本重试成功→版本推进后再迟到→重试→挂断暂停/恢复 =====
const t2 = {};
{
  let r = await must(call('t2-create', () => svc.createRemoteSession({ requestId: RID('r4b-create'), expectedVersion: stateV(), title: 'R4轨迹2：迟到与重试（合成）' })), 't2-create');
  const sid = r.session.sessionId; let v = r.remoteVersion;
  t2.createGeneration = r.session.generation;
  r = await must(call('t2-attach', () => svc.attachEvidence({ requestId: RID('r4b-ev'), expectedVersion: v, sessionId: sid, fixtureId: 'fixture-equipment' })), 't2-attach');
  const ev = r.evidence.evidenceId; v = r.remoteVersion;
  const body = { requestId: RID('r4b-ann'), sessionId: sid, evidenceId: ev, evidenceVersion: 1, question: '轨迹2问题（合成）', rect: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } };
  const stale = await call('t2-stale', () => svc.createAnnotation({ ...body, expectedVersion: v - 1 })); // 迟到：旧 expectedVersion
  t2.staleRejected = !stale.ok && stale.error === 'VERSION_CONFLICT'; t2.staleError = stale.error;
  r = await must(call('t2-retry', () => svc.createAnnotation({ ...body, expectedVersion: stateV() })), 't2-retry'); // 同ID新版本重试
  const ann = r.annotation.annotationId; t2.retrySameIdOk = true; t2.annId = ann;
  r = await must(call('t2-ann2', () => svc.createAnnotation({ requestId: RID('r4b-ann2'), expectedVersion: stateV(), sessionId: sid, evidenceId: ev, evidenceVersion: 1, question: '轨迹2第二问（合成）', rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } })), 't2-ann2');
  const ann2 = r.annotation.annotationId;
  const stale2 = await call('t2-stale-reply', () => svc.replyAnnotation({ requestId: RID('r4b-stale-reply'), expectedVersion: DET(sid).remoteVersion - 1, sessionId: sid, annotationId: ann, kind: 'business', text: '轨迹2迟到回复（应被拒）' }));
  t2.lateReplyRejected = !stale2.ok && stale2.error === 'VERSION_CONFLICT';
  r = await must(call('t2-retry-reply', () => svc.replyAnnotation({ requestId: RID('r4b-stale-reply'), expectedVersion: stateV(), sessionId: sid, annotationId: ann, kind: 'business', text: '轨迹2同ID重试回复（合成）' })), 't2-retry-reply');
  t2.retryReplyOk = true;
  // 挂断暂停（ann2 为目标）→ 暂停中模型推进拒 → 显式恢复；此后无写入（ann1/ann2 终值=resume 引用）
  r = await must(call('t2-pause', () => svc.createReview({ requestId: RID('r4b-pause'), expectedVersion: stateV(), sessionId: sid, targetType: 'annotation', targetId: ann2, targetVersion: annVer(sid, ann2), action: 'pause_round', opinion: '轨迹2：挂断暂停（合成）' })), 't2-pause');
  r = await call('t2-blk-fu', () => svc.simulateFollowUps({ requestId: RID('r4b-blk-fu'), expectedVersion: stateV(), sessionId: sid, annotationId: ann2 }));
  t2.pausedModelFollowUpRejected = !r.ok && r.error === 'SESSION_PAUSED';
  r = await must(call('t2-resume', () => svc.createReview({ requestId: RID('r4b-resume'), expectedVersion: stateV(), sessionId: sid, targetType: 'annotation', targetId: ann2, targetVersion: annVer(sid, ann2), action: 'resume_round', opinion: '轨迹2：显式恢复（合成）' })), 't2-resume');
  t2.endV = stateV();
  out.trajectories.t2_late_retry = t2;
}

// ===== 轨迹3：分歧并存（业务 vs 信审不同结论）→ 人工确认 → 人工纠偏 =====
const t3 = {};
{
  let r = await must(call('t3-create', () => svc.createRemoteSession({ requestId: RID('r4c-create'), expectedVersion: stateV(), title: 'R4轨迹3：分歧并存（合成）' })), 't3-create');
  const sid = r.session.sessionId; let v = r.remoteVersion;
  t3.createGeneration = r.session.generation;
  r = await must(call('t3-attach', () => svc.attachEvidence({ requestId: RID('r4c-ev'), expectedVersion: v, sessionId: sid, fixtureId: 'fixture-contract' })), 't3-attach');
  const ev = r.evidence.evidenceId; v = r.remoteVersion;
  r = await must(call('t3-annotate', () => svc.createAnnotation({ requestId: RID('r4c-ann'), expectedVersion: v, sessionId: sid, evidenceId: ev, evidenceVersion: 1, question: '轨迹3：合同要素核对（合成）', rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 } })), 't3-annotate');
  const ann = r.annotation.annotationId; v = r.remoteVersion;
  r = await must(call('t3-r1', () => svc.replyAnnotation({ requestId: RID('r4c-r1'), expectedVersion: v, sessionId: sid, annotationId: ann, kind: 'business', text: '业务意见：条款无误（合成）' })), 't3-r1'); v = r.remoteVersion;
  r = await must(call('t3-r2', () => svc.replyAnnotation({ requestId: RID('r4c-r2'), expectedVersion: v, sessionId: sid, annotationId: ann, kind: 'domain', text: '信审不同结论：付款节点需复核（合成）' })), 't3-r2');
  const cf = await call('t3-confirm', () => svc.createReview({ requestId: RID('r4c-confirm'), expectedVersion: stateV(), sessionId: sid, targetType: 'evidence', targetId: ev, targetVersion: 1, action: 'confirm', opinion: '轨迹3：业务侧确认（合成）' }));
  t3.confirmOk = cf.ok === true; t3.confirmError = cf.error ?? null;
  const co = await call('t3-correct', () => svc.createReview({ requestId: RID('r4c-correct'), expectedVersion: stateV(), sessionId: sid, targetType: 'evidence', targetId: ev, targetVersion: 1, action: 'correct', opinion: '轨迹3：纠正——付款节点实为季度（合成）', before: '付款节点为月度（合成）', after: '付款节点为季度（合成）' }));
  t3.correctOk = co.ok === true; t3.correctError = co.error ?? null;
  t3.session = sid; t3.annotation = ann; t3.endV = stateV();
  out.trajectories.t3_dissent = t3;
}

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(DATA_DIR + '/r4-trajectory-run.json', JSON.stringify(out, null, 1), 'utf8');
console.log(JSON.stringify(out.trajectories, null, 1));
