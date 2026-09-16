// G5 人机环：D-16 缺证等待不冻结无关目标 / D-17 待办跨重启持久 / D-18 越权回应/验收拒绝
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import { makeApi, ok, errCode, pick, reqId, dTemplate, setupProject, projectState, goalState, projectVersion, PRINCIPALS } from '../harness/adapter.mjs';

async function sut(ctx) {
  if (!ctx.store.sut) ctx.store.sut = await sutctl.startSut(ctx, { suiteTag: 'g5', apiPort: 17915 });
  return ctx.store.sut;
}
// 三目标模板：collect(需facts) / notify(无依赖无输入,即ready) / review(依赖collect)
function t3(name) {
  const t = dTemplate({ name });
  t.goals.push({
    goalKey: 'notify', title: '无关通知', description: '与collect无关的独立目标',
    responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver',
    inputEvidenceKinds: [], dependsOn: [], params: {},
  });
  return t;
}
async function fullCycle(ctx, api, goalId, tag) {
  const a = ctx.assert;
  const gs = await goalState(api, goalId);
  ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId(tag + 'c'), expectedVersion: gs.version }), `${tag} claim`);
  const lg = await goalState(api, goalId);
  ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, { requestId: reqId(tag + 'x'), expectedVersion: lg.version, fencingToken: pick(lg, 'fencingToken'), result: { provider: 'calculation', output: {} } }), `${tag} complete`);
  const cd = await goalState(api, goalId);
  ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goalId}/accept`, { requestId: reqId(tag + 'a'), expectedVersion: cd.version }), `${tag} accept`);
  const ac = await goalState(api, goalId);
  ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goalId}/decide`, { requestId: reqId(tag + 'd'), expectedVersion: ac.version, decision: 'approved' }), `${tag} decide`);
  return (await goalState(api, goalId)).status;
}

const suite = defineSuite('g5_human_loop', [
  {
    id: 'D-16', title: '人工缺证等待：waiting_human不冻结无关目标；回应后恢复', severity: 'P1', owner: 'A', timeoutMs: 240000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = t3('D-16 等待');
      const { projectId, goals } = await setupProject(api, a, { template: tpl, projectName: 'D-16' });
      // collect 还没有 facts 证据 → blocked；发起 missing_evidence 人工待办
      const hr = ok(a, await api.post(`/api/v1/projects/${projectId}/human-requests`, {
        requestId: reqId('hr'), goalId: goals.collect, kind: 'missing_evidence',
        question: '缺少合同扫描件，请补', requestedRole: 'approver', requiredEvidenceKinds: ['facts'],
      }), '创建人工待办');
      const hrequestId = pick(hr, 'hrequestId');
      a.ok(hrequestId, 'hrequestId可得');
      // 无关目标 notify 完整走通（不被冻结）
      const notifyStatus = await fullCycle(ctx, api, goals.notify, 'n');
      a.eq(notifyStatus, 'decided', '无关目标notify完整走通到decided', { actual: notifyStatus });
      // collect 仍等待（不因别处完成而误动）
      const gs1 = await goalState(api, goals.collect);
      a.ok(['blocked', 'waiting_human'].includes(gs1.status), '缺证目标保持等待态', { actual: gs1.status });
      // 回应（risk人类，带证据引用）→ 相关目标重算
      const ps = await projectState(api, projectId);
      const ev = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps.version, kind: 'facts', content: { scan: 'contract-v2' } }), '补证据');
      const eid = pick(ev, 'evidenceId');
      const resp = ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/human-requests/${hrequestId}/respond`, {
        requestId: reqId('resp'), answer: { text: '已补扫描件', evidenceRefs: [{ evidenceId: eid, version: 1 }] },
      }), '人工回应');
      const gs2 = await goalState(api, goals.collect);
      a.eq(gs2.status, 'ready', '回应+证据齐备 → collect ready', { actual: gs2.status });
      // 回应后待办关闭，重复回应拒绝
      const resp2 = await api.as(PRINCIPALS.approver).post(`/api/v1/human-requests/${hrequestId}/respond`, { requestId: reqId('resp2'), answer: { text: 'again' } });
      errCode(a, resp2, 'HUMAN_REQUEST_CLOSED', '已回应待办再回应被拒');
    },
  },
  {
    id: 'D-17', title: '人工待办跨重启持久：杀API重启后待办在、可回应生效', severity: 'P1', owner: 'A', timeoutMs: 240000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goals } = await setupProject(api, a, { projectName: 'D-17 重启' });
      const hr = ok(a, await api.post(`/api/v1/projects/${projectId}/human-requests`, {
        requestId: reqId('hr'), goalId: goals.collect, kind: 'clarification',
        question: '请澄清参数单位', requestedRole: 'approver',
      }), '创建澄清待办');
      const hrequestId = pick(hr, 'hrequestId');
      // 杀API→重启（同库）
      await s.restartApi();
      await ctx.sleep(500);
      // 待办仍在
      const list = ok(a, await api.get(`/api/v1/projects/${projectId}/human-requests`), '重启后取待办列表');
      const str = JSON.stringify(list);
      a.ok(str.includes(hrequestId), '待办跨重启仍存在', { hrequestId, probeLen: str.length });
      // 重启后待办列表含目标状态：collect仍未被误放行
      const gs = await goalState(api, goals.collect);
      a.ok(['blocked', 'waiting_human'].includes(gs.status), '重启后目标不丢失等待语义', { actual: gs.status });
      // 回应生效
      const resp = await api.as(PRINCIPALS.approver).post(`/api/v1/human-requests/${hrequestId}/respond`, { requestId: reqId('r'), answer: { text: '单位为万元' } });
      ok(a, resp, '重启后回应成功');
      const st = pick((await api.get(`/api/v1/projects/${projectId}/human-requests`).then(r => r.json)), 'status');
      a.ok(st === undefined || st === 'answered', '待办状态answered（或列表投影可得）', { got: st });
    },
  },
  {
    id: 'D-18', title: '越权回应/验收拒绝：非requestedRole与不可信凭据均403且零状态变化', severity: 'P1', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goals } = await setupProject(api, a, { projectName: 'D-18 越权' });
      const hr = ok(a, await api.post(`/api/v1/projects/${projectId}/human-requests`, {
        requestId: reqId('hr'), goalId: goals.collect, kind: 'decision',
        question: '是否放行', requestedRole: 'approver',
      }), '待办');
      const hrequestId = pick(hr, 'hrequestId');
      const gs0 = await goalState(api, goals.collect);
      // business角色回应（requestedRole=risk）→ 403 ROLE_FORBIDDEN
      const r1 = await api.as(PRINCIPALS.business).post(`/api/v1/human-requests/${hrequestId}/respond`, { requestId: reqId('x'), answer: { text: '我是业务我答应' } });
      errCode(a, r1, 'ROLE_FORBIDDEN', '非requestedRole回应403');
      // 不可信凭据 → PRINCIPAL_UNTRUSTED
      const r2 = await api.as(PRINCIPALS.unknown).post(`/api/v1/human-requests/${hrequestId}/respond`, { requestId: reqId('y'), answer: { text: '我是隐身人' } });
      errCode(a, r2, 'PRINCIPAL_UNTRUSTED', '不可信凭据回应403');
      // 状态零变化
      const gs1 = await goalState(api, goals.collect);
      a.eq(gs1.status, gs0.status, '目标状态未被越权操作改变');
      const list = JSON.stringify(await api.get(`/api/v1/projects/${projectId}/human-requests`).then(r => r.json));
      a.ok(!list.includes('"status":"answered"'), '待办未被置为answered', { probe: list.slice(0, 200) });
    },
  },
]);

runSuite(suite, import.meta.url);
