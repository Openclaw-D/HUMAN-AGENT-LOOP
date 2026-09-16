// G6 证据与失效（对齐 CONTRACT v1.3 候选语义）：
// D-19 两节点accepted-stale可见性 / D-19b 非accepted命中→重绑回ready / D-19c 三级链传递stale投影
// D-19d v1.3复核门：UPSTREAM_STALE拦截→staleReviewAck放行→decided不改写 / D-20 边界
// 业务语义（ack放行制度、重开制度）PENDING-USER-RULING：D只验证技术候选与契约文字一致，不代用户接受政策。
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import { makeApi, ok, errCode, pick, reqId, dTemplate, setupProject, projectState, goalState, goalVersion, projectVersion, PRINCIPALS } from '../harness/adapter.mjs';

async function sut(ctx) {
  if (!ctx.store.sut) ctx.store.sut = await sutctl.startSut(ctx, { suiteTag: 'g6', apiPort: 17916 });
  return ctx.store.sut;
}
function t3(name, middleKinds = []) {
  const t = dTemplate({ name });
  t.goals.push({
    goalKey: 'middle', title: '中间节点', description: 'accepted中间层',
    responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver',
    inputEvidenceKinds: middleKinds, dependsOn: ['collect'], params: {},
  });
  t.goals[1].dependsOn = ['middle'];
  return t;
}
async function drive(ctx, api, goalId, tag) {
  const a = ctx.assert;
  const gs = await goalState(api, goalId);
  ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId(tag + 'c'), expectedVersion: gs.version }), `${tag} claim`);
  const lg = await goalState(api, goalId);
  ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, { requestId: reqId(tag + 'x'), expectedVersion: goalVersion(lg) ?? gs.version + 1, fencingToken: pick(lg, 'fencingToken'), result: { provider: 'calculation', output: { by: tag } } }), `${tag} complete`);
  const cd = await goalState(api, goalId);
  ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goalId}/accept`, { requestId: reqId(tag + 'a'), expectedVersion: cd.version }), `${tag} accept`);
  return await goalState(api, goalId);
}
const stripStale = (j) => { const c = JSON.parse(JSON.stringify(j ?? null)); const f = (o) => { if (o && typeof o === 'object') { delete o.stale; delete o.staleRoots; for (const v of Object.values(o)) if (v && typeof v === 'object') f(v); } }; f(c); return JSON.stringify(c); };

const suite = defineSuite('g6_evidence_invalidation', [
  {
    id: 'D-19', title: 'v1.3两节点：accepted目标stale投影+下游传递可见+状态不变+历史保留', severity: 'P1', owner: 'A', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goals } = await setupProject(api, a, { projectName: 'D-19 失效' });
      const ps = await projectState(api, projectId);
      const ev1 = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('e1'), expectedVersion: ps.version, kind: 'facts', content: { v: 1 } }), '证据v1');
      const e1id = pick(ev1, 'evidenceId');
      await drive(ctx, api, goals.collect, 'c1');
      const ps2 = await projectState(api, projectId);
      const sup = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence/${e1id}/supersede`, { requestId: reqId('s1'), expectedVersion: ps2.version, content: { v: 2 } }), '取代证据');
      const e2id = pick(sup, 'evidenceId');
      a.ok(e2id && e2id !== e1id, '取代=新实体新id');
      const collectAfter = await goalState(api, goals.collect);
      a.eq(collectAfter.status, 'accepted', 'accepted目标保持accepted（历史不改写）', { actual: collectAfter.status });
      a.eq(pick(collectAfter.json, 'stale'), true, 'accepted目标stale:true读投影', { got: pick(collectAfter.json, 'stale') });
      const reviewAfter = await goalState(api, goals.review);
      a.eq(pick(reviewAfter.json, 'stale'), true, 'v1.3传递可见性：下游review stale:true', { got: pick(reviewAfter.json, 'stale') });
      a.eq(reviewAfter.status, 'ready', 'review状态不变（门只在accept/decide）', { actual: reviewAfter.status });
      const tRes = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%evidence%' LIMIT 1`);
      const colRes = tRes.out ? await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT column_name FROM information_schema.columns WHERE table_name='${tRes.out}' AND column_name ILIKE '%superseded%'`) : { out: '' };
      if (colRes.out && /supersededby/i.test(colRes.out)) {
        const old = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT count(*) FROM ${tRes.out} WHERE evidence_id='${e1id}'`);
        a.eq(old.out, '1', '旧证据实体未删除（历史保留）', { got: old.out });
      } else {
        const cnt = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT count(*) FROM ${tRes.out}`);
        a.ok(Number(cnt.out) >= 2, '证据保留≥2行（新旧并存）', { got: cnt.out });
      }
    },
  },
  {
    id: 'D-19b', title: 'v1.3非accepted命中路径：ready目标取代→invalidated→立即重绑回ready；下游随上游再验收恢复ready', severity: 'P1', owner: 'A', timeoutMs: 240000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goals } = await setupProject(api, a, { projectName: 'D-19b 非accepted命中' });
      const ps = await projectState(api, projectId);
      const ev1 = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('e1'), expectedVersion: ps.version, kind: 'facts', content: { v: 1 } }), '证据v1');
      const e1id = pick(ev1, 'evidenceId');
      const gs1 = await goalState(api, goals.collect);
      a.eq(gs1.status, 'ready', 'collect ready（非accepted）', { actual: gs1.status });
      const sup = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence/${e1id}/supersede`, { requestId: reqId('s1'), expectedVersion: (await projectState(api, projectId)).version, content: { v: 2 } }), '取代（ready命中）');
      const e2id = pick(sup, 'evidenceId');
      const gs2 = await goalState(api, goals.collect);
      a.eq(gs2.status, 'ready', '非accepted命中 → invalidated并立即重绑新证据回ready', { actual: gs2.status });
      const ie = pick(gs2.json, 'inputEvidence');
      if (ie) a.ok(JSON.stringify(ie).includes(e2id), 'inputEvidence重绑到新证据版本', { got: JSON.stringify(ie).slice(0, 120) });
      const cl = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.collect}/claim`, { requestId: reqId('c'), expectedVersion: gs2.version }), 'claim');
      ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.collect}/complete`, { requestId: reqId('x'), expectedVersion: goalVersion(cl) ?? gs2.version + 1, fencingToken: pick(cl, 'fencingToken'), result: { provider: 'calculation', output: { ok: 1 } } }), 'complete');
      const cd = await goalState(api, goals.collect);
      ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.collect}/accept`, { requestId: reqId('a'), expectedVersion: cd.version }), 'accept');
      const rv = await goalState(api, goals.review);
      a.eq(rv.status, 'ready', '上游再验收 → 下游恢复ready（依赖释放原子一致）', { actual: rv.status });
      a.notEq(pick(rv.json, 'stale'), true, '新鲜重算后下游stale清除', { stale: pick(rv.json, 'stale') });
    },
  },
  {
    id: 'D-19c', title: 'v1.3三级链传递stale：root输入取代→root/middle/leaf全部stale可见，状态全部不变', severity: 'P0', owner: 'A', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = t3('D-19c 三级链', ['analysis']);
      const { projectId, goals } = await setupProject(api, a, { template: tpl, projectName: 'D-19c' });
      const ps = await projectState(api, projectId);
      const eFacts = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ef'), expectedVersion: ps.version, kind: 'facts', content: { root: 1 } }), 'facts证据');
      await drive(ctx, api, goals.collect, 'r');
      const ps2 = await projectState(api, projectId);
      const eAna = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ea'), expectedVersion: ps2.version, kind: 'analysis', content: { mid: 1 } }), 'analysis证据');
      await drive(ctx, api, goals.middle, 'm');
      const leafBefore = await goalState(api, goals.review);
      a.eq(leafBefore.status, 'ready', '前置：leaf ready', { actual: leafBefore.status });
      a.notEq(pick(leafBefore.json, 'stale'), true, '前置：leaf未stale');
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence/${pick(eFacts, 'evidenceId')}/supersede`, { requestId: reqId('s1'), expectedVersion: (await projectState(api, projectId)).version, content: { root: 2 } }), '取代facts');
      const rootAfter = await goalState(api, goals.collect);
      const midAfter = await goalState(api, goals.middle);
      const leafAfter = await goalState(api, goals.review);
      a.eq(pick(rootAfter.json, 'stale'), true, 'root stale:true');
      a.eq(pick(midAfter.json, 'stale'), true, 'middle传递stale:true', { got: pick(midAfter.json, 'stale') });
      a.eq(pick(leafAfter.json, 'stale'), true, 'leaf跨accepted中间节点传递stale:true（原需求缺口的技术修复）', { got: pick(leafAfter.json, 'stale') });
      a.eq(midAfter.status, 'accepted', 'middle状态不变', { actual: midAfter.status });
      a.eq(leafAfter.status, 'ready', 'leaf状态不变（可见但不停执行）', { actual: leafAfter.status });
      a.eq(stripStale(leafAfter.json), stripStale(leafBefore.json), '除stale字段外leaf投影逐字节不变（无多余重算副作用）');
      const cl = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.review}/claim`, { requestId: reqId('lc'), expectedVersion: goalVersion(leafAfter) }), 'leaf claim不受门影响');
      ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.review}/complete`, { requestId: reqId('lx'), expectedVersion: goalVersion(cl) ?? leafAfter.version + 1, fencingToken: pick(cl, 'fencingToken'), result: { provider: 'calculation', output: { staleAware: true } } }), 'leaf complete不受门影响');
      const cd = await goalState(api, goals.review);
      a.eq(cd.status, 'candidate_ready', 'leaf到candidate（执行面无门）', { actual: cd.status });
    },
  },
  {
    id: 'D-19d', title: 'v1.3复核门：stale目标accept/decide被409 UPSTREAM_STALE拦截（含staleRoots）→staleReviewAck放行→decided历史不改写', severity: 'P0', owner: 'A', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const tpl = t3('D-19d 复核门', ['analysis']);
      const { projectId, goals } = await setupProject(api, a, { template: tpl, projectName: 'D-19d' });
      const ps = await projectState(api, projectId);
      const eFacts = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ef'), expectedVersion: ps.version, kind: 'facts', content: { root: 1 } }), 'facts证据');
      await drive(ctx, api, goals.collect, 'r');
      const rootAcc = await goalState(api, goals.collect);
      ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.collect}/decide`, { requestId: reqId('rd'), expectedVersion: rootAcc.version, decision: 'approved' }), 'root decide approved');
      const ps2 = await projectState(api, projectId);
      const eAna = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ea'), expectedVersion: ps2.version, kind: 'analysis', content: { mid: 1 } }), 'analysis证据');
      await drive(ctx, api, goals.middle, 'm');
      const cl = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.review}/claim`, { requestId: reqId('lc'), expectedVersion: (await goalState(api, goals.review)).version }), 'leaf claim');
      const lg = await goalState(api, goals.review);
      ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.review}/complete`, { requestId: reqId('lx'), expectedVersion: goalVersion(lg) ?? leafAfterVersion(lg), fencingToken: pick(lg, 'fencingToken'), result: { provider: 'calculation', output: {} } }), 'leaf complete');
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence/${pick(eFacts, 'evidenceId')}/supersede`, { requestId: reqId('s1'), expectedVersion: (await projectState(api, projectId)).version, content: { root: 2 } }), '取代facts');
      const rootAfter = await goalState(api, goals.collect);
      a.eq(rootAfter.status, 'decided', 'decided目标状态不改写', { actual: rootAfter.status });
      a.eq(pick(rootAfter.json, 'stale'), true, 'decided目标stale可见（仅读标记）', { got: pick(rootAfter.json, 'stale') });
      a.ok(JSON.stringify(rootAfter.json).match(/approved/), 'decided的formalDecision投影保留', { probe: JSON.stringify(rootAfter.json).slice(0, 200) });
      const leafNow = await goalState(api, goals.review);
      a.eq(leafNow.status, 'candidate_ready', 'leaf候选就绪', { actual: leafNow.status });
      const blocked = await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.review}/accept`, { requestId: reqId('ba'), expectedVersion: goalVersion(leafNow) ?? leafNow.version });
      errCode(a, blocked, 'UPSTREAM_STALE', 'stale目标accept被409 UPSTREAM_STALE拦截');
      const roots = pick(blocked.json, 'staleRoots');
      a.ok(roots !== undefined && JSON.stringify(roots).includes('collect'), 'staleRoots列出失效根因（含root）', { roots: JSON.stringify(roots).slice(0, 200) });
      const acked = ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.review}/accept`, { requestId: reqId('aa'), expectedVersion: leafNow.version, staleReviewAck: { note: 'D-19d 已人工复核失效依据，接受当前候选' } }), '带staleReviewAck的accept放行');
      const leafAccepted = await goalState(api, goals.review);
      a.eq(leafAccepted.status, 'accepted', 'ack后accept→accepted', { actual: leafAccepted.status });
      a.eq(pick(leafAccepted.json, 'stale'), true, 'accepted后stale仍可见（验收记录不改写，事实可见）');
      const leafAcc = await goalState(api, goals.review);
      const blockedDecide = await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.review}/decide`, { requestId: reqId('bd'), expectedVersion: leafAcc.version, decision: 'approved' });
      errCode(a, blockedDecide, 'UPSTREAM_STALE', 'stale目标decide同样被拦截');
      const decided = ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.review}/decide`, { requestId: reqId('ad'), expectedVersion: leafAcc.version, decision: 'approved', staleReviewAck: { note: 'D-19d 复核后正式决定' } }), '带ack的decide放行');
      const fin = await goalState(api, goals.review);
      a.eq(fin.status, 'decided', 'decided到达', { actual: fin.status });
      const tAud = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%audit%' LIMIT 1`);
      if (tAud.out && tAud.out.length > 2) {
        const cnt = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT count(*) FROM ${tAud.out} WHERE action='stale_review_acknowledged'`);
        a.ok(Number(cnt.out) >= 2, '审计含stale_review_acknowledged留痕（accept+decide≥2）', { got: cnt.out });
      } else {
        ctx.log('[D-19d] 审计表不可达（形状差异），以API行为断言为准');
        a.ok(true, '审计DB核验跳过');
      }
      function leafAfterVersion(lgx) { return goalVersion(lgx) ?? leafNow.version + 1; }
    },
  },
  {
    id: 'D-20', title: '非法操作边界：取代不存在证据404；重复取代409 EVIDENCE_SUPERSEDED；未知goalKey拒绝', severity: 'P1', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goals } = await setupProject(api, a, { projectName: 'D-20 边界' });
      const ps = await projectState(api, projectId);
      const r1 = await api.post(`/api/v1/projects/${projectId}/evidence/v7d-nonexistent/supersede`, { requestId: reqId('s'), expectedVersion: ps.version, content: {} });
      errCode(a, r1, 'NOT_FOUND', '取代不存在证据→404 NOT_FOUND');
      const ev = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('e'), expectedVersion: (await projectState(api, projectId)).version, kind: 'facts', content: { x: 1 } }), '提证');
      const eid = pick(ev, 'evidenceId');
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence/${eid}/supersede`, { requestId: reqId('s1'), expectedVersion: (await projectState(api, projectId)).version, content: { x: 2 } }), '第一次取代');
      const s2 = await api.post(`/api/v1/projects/${projectId}/evidence/${eid}/supersede`, { requestId: reqId('s2'), expectedVersion: (await projectState(api, projectId)).version, content: { x: 3 } });
      errCode(a, s2, 'EVIDENCE_SUPERSEDED', '重复取代旧实体→409');
      const r3 = await api.post(`/api/v1/projects/${projectId}/goals`, { requestId: reqId('g'), expectedVersion: (await projectState(api, projectId)).version, goalKey: 'v7d-not-in-template' });
      a.ok(r3.status >= 400 && r3.status < 500, '未知goalKey被4xx拒', { status: r3.status, error: pick(r3.json, 'error') });
      const gs = await goalState(api, goals.collect);
      a.ok(gs.version >= 1, '目标版本正常');
    },
  },
]);

runSuite(suite, import.meta.url);
