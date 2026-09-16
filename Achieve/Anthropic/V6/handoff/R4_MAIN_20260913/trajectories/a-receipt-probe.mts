import * as svc from '../../../../jianwei-v3/site/lib/v5-preview/remote-service.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const store = JSON.parse(readFileSync(process.env.V5_PREVIEW_DATA_DIR + '/remote-store.json', 'utf8'));
const t1 = store.sessions.filter((s: any) => s.title.includes('轨迹1')).at(-1);
const det = svc.getRemoteSessionDetail(t1.sessionId);
const ann2 = det.annotations.find((a: any) => (a.question ?? '').includes('第二问'));
const r = await svc.simulateFollowUps({ requestId: 'a-receipt-probe-' + Date.now().toString(36), expectedVersion: det.remoteVersion, sessionId: t1.sessionId, annotationId: ann2.annotationId });
const slim = {
  ok: r.ok, simulated: r.simulated,
  status: r.result?.status, providerKind: r.result?.providerKind,
  notice: r.result?.notice,
  replyCount: r.result?.replies?.length,
  repliesHead: (r.result?.replies ?? []).slice(0, 2).map((x: any) => ({ kind: x.kind, author: x.author, textHead: (x.text ?? '').slice(0, 60) })),
  requestId: r.result?.requestId,
  candidateRequestIds: r.result?.candidate?.requestIds,
  candidateStatus: r.result?.candidate?.status,
};
console.log(JSON.stringify(slim, null, 1));
writeFileSync(process.env.V5_PREVIEW_DATA_DIR + '/a-receipt-simulate.json', JSON.stringify(r, null, 1), 'utf8');
