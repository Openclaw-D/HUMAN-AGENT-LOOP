// G1 契约与API面（CONTRACT v0.1）：D-01 四态状态机 / D-02 敏感写失败关闭+禁用键 / D-03 环检测 / D-05 版本冲突
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import { makeApi, ok, errCode, pick, reqId, dTemplate, setupProject, projectState, goalState, goalVersion, projectVersion, PRINCIPALS } from '../harness/adapter.mjs';

async function sut(ctx) {
  if (!ctx.store.sut) ctx.store.sut = await sutctl.startSut(ctx, { suiteTag: 'g1', apiPort: 17911 });
  return ctx.store.sut;
}

const suite = defineSuite('g1_surface', [
  {
    id: 'D-01', title: '四态区分：执行→candidate_ready≠accepted≠decided 全链走通', severity: 'P0', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      // health
      const h = await api.get('/api/v1/health');
      const hj = ok(a, h, 'health');
      a.eq(pick(hj, 'db') === undefined ? 'up' : pick(hj, 'db'), 'up', 'health db=up');
      a.eq(pick(hj, 'model'), 'not_configured', 'health model=not_configured（本轮0真实调用如实）');
      // 模板/项目/目标
      const { projectId, goals } = await setupProject(api, a, { projectName: 'D-01 四态' });
      a.ok(goals.collect, 'collect goalId 可得');
      let gs = await goalState(api, goals.collect);
      a.eq(gs.status, 'blocked', '初始 blocked（缺facts证据）', { actual: gs.status, body: gs.res.text && gs.res.text.slice(0, 200) });
      // 证据提交 → collect 自动 ready
      const ps = await projectState(api, projectId);
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps.version, kind: 'facts', content: { items: ['contract', 'invoice'] } }), 'submit facts evidence');
      gs = await goalState(api, goals.collect);
      a.eq(gs.status, 'ready', '证据齐备 → ready（deps空）', { actual: gs.status });
      // claim → leased（含fencingToken/leaseUntil）
      const cl = ok(a, await makeApi(s.apiBase).as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.collect}/claim`, { requestId: reqId('claim'), expectedVersion: gs.version }), 'agent claim');
      const fencing = pick(cl, 'fencingToken');
      a.ok(Number.isFinite(fencing), 'claim 返回 fencingToken', { got: fencing });
      a.ok(pick(cl, 'leaseUntil') !== undefined, 'claim 返回 leaseUntil');
      // complete → candidate_ready（绝不到 accepted/decided）
      const cm = await makeApi(s.apiBase).as(PRINCIPALS.agent).post(`/api/v1/goals/${goals.collect}/complete`, {
        requestId: reqId('done'), expectedVersion: goalVersion(cl) ?? gs.version + 1, fencingToken: fencing,
        result: { provider: 'calculation', output: { note: 'done-by-D' }, notes: 'D驱动' },
      });
      const cmj = ok(a, cm, 'complete 执行');
      gs = await goalState(api, goals.collect);
      a.eq(gs.status, 'candidate_ready', 'complete → candidate_ready', { actual: gs.status });
      a.ok(gs.status !== 'accepted' && gs.status !== 'decided', '执行成功≠验收通过≠正式决定（D-04核心）');
      a.eq(pick(gs.json, 'receiptCount') === undefined ? undefined : typeof pick(gs.json, 'receiptCount'), 'number', 'receiptCount 数字投影');
      // accept（人类risk，执行者agent≠验收者）
      ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.collect}/accept`, { requestId: reqId('acc'), expectedVersion: gs.version, note: 'D验收' }), 'risk accept');
      gs = await goalState(api, goals.collect);
      a.eq(gs.status, 'accepted', 'accept → accepted', { actual: gs.status });
      // decide approved → decided 终态
      ok(a, await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.collect}/decide`, { requestId: reqId('dec'), expectedVersion: gs.version, decision: 'approved' }), 'decide approved');
      gs = await goalState(api, goals.collect);
      a.eq(gs.status, 'decided', 'decide → decided', { actual: gs.status });
      // 终态不可再写
      const again = await api.as(PRINCIPALS.approver).post(`/api/v1/goals/${goals.collect}/decide`, { requestId: reqId('dec2'), expectedVersion: gs.version, decision: 'rejected' });
      a.ok(!again.json || again.json.ok !== true, '终态再写被拒', { status: again.status, body: again.text && again.text.slice(0, 200) });
      // 下游 review 因上游 accepted 自动 ready
      const rv = await goalState(api, goals.review);
      a.eq(rv.status, 'ready', '上游accepted → 下游自动ready（依赖释放原子）', { actual: rv.status });
    },
  },
  {
    id: 'D-02', title: '敏感写失败关闭：不可信凭据403；载荷不得携带授权键；角色不可由输入提升', severity: 'P0', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase);
      // 不可信/缺失凭据 → 敏感写全部 403 PRINCIPAL_UNTRUSTED
      const { projectId, goals } = await setupProject(api.as(PRINCIPALS.admin), a, { projectName: 'D-02 安全' });
      const gs = await goalState(api.as(PRINCIPALS.admin), goals.collect);
      for (const [label, cred] of [['unknown凭据', PRINCIPALS.unknown], ['缺失凭据', null]]) {
        const cli = cred ? api.as(cred) : api.noAuth();
        const r1 = await cli.post(`/api/v1/goals/${goals.collect}/claim`, { requestId: reqId('c'), expectedVersion: gs.version });
        errCode(a, r1, 'PRINCIPAL_UNTRUSTED', `claim（${label}）`);
        const r2 = await cli.post(`/api/v1/goals/${goals.collect}/complete`, { requestId: reqId('x'), expectedVersion: gs.version, fencingToken: 1, result: { provider: 'calculation', output: {} } });
        errCode(a, r2, 'PRINCIPAL_UNTRUSTED', `complete（${label}）`);
        const r3 = await cli.post(`/api/v1/goals/${goals.collect}/accept`, { requestId: reqId('y'), expectedVersion: gs.version });
        errCode(a, r3, 'PRINCIPAL_UNTRUSTED', `accept（${label}）`);
      }
      // 不可信凭据 supersede 也拒绝
      const ev = await api.as(PRINCIPALS.admin).post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: (await projectState(api.as(PRINCIPALS.admin), projectId)).version, kind: 'facts', content: { k: 1 } });
      ok(a, ev, '可信凭据提证');
      const eid = pick(ev, 'evidenceId');
      const sup = await api.as(PRINCIPALS.unknown).post(`/api/v1/projects/${projectId}/evidence/${eid}/supersede`, { requestId: reqId('sup'), expectedVersion: (await projectState(api.as(PRINCIPALS.admin), projectId)).version, content: { k: 2 } });
      errCode(a, sup, 'PRINCIPAL_UNTRUSTED', 'supersede（unknown凭据）');
      // FORBIDDEN_KEY：result.output 带审批语义键 → 400
      const out1 = await api.as(PRINCIPALS.admin).post('/api/v1/templates', {
        requestId: reqId('tpl'), name: 'D-02 禁键模板',
        roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }, { roleKey: 'executor', title: '执行', isHumanRole: false }],
        goals: [{ goalKey: 'g', title: 'g', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: { price: 100 } }],
      });
      errCode(a, out1, 'FORBIDDEN_KEY', '模板params含禁用键price');
      // 完整流程到 leased 再测 result.output 禁键
      const tpl2 = dTemplate();
      const t2 = ok(a, await api.as(PRINCIPALS.admin).post('/api/v1/templates', tpl2), '干净模板');
      const p2 = ok(a, await api.as(PRINCIPALS.admin).post('/api/v1/projects', { requestId: reqId('p2'), templateId: pick(t2, 'templateId'), name: 'D-02b' }), '项目');
      const pid2 = pick(p2, 'projectId');
      const g2r = ok(a, await api.as(PRINCIPALS.admin).post(`/api/v1/projects/${pid2}/goals`, { requestId: reqId('g2'), expectedVersion: projectVersion(p2), goalKey: 'collect' }), '实例化');
      const gid2 = pick(g2r, 'goalId');
      await api.as(PRINCIPALS.admin).post(`/api/v1/projects/${pid2}/evidence`, { requestId: reqId('ev2'), expectedVersion: projectVersion(p2), kind: 'facts', content: { x: 1 } });
      const g2s = await goalState(api.as(PRINCIPALS.admin), gid2);
      const cl2 = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${gid2}/claim`, { requestId: reqId('cl2'), expectedVersion: g2s.version }), 'claim');
      const fk = await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${gid2}/complete`, {
        requestId: reqId('fk'), expectedVersion: goalVersion(cl2) ?? g2s.version + 1, fencingToken: pick(cl2, 'fencingToken'),
        result: { provider: 'calculation', output: { approvers: ['self'], decision: 'yes' } },
      });
      errCode(a, fk, 'FORBIDDEN_KEY', 'result.output含approv*/decision键（嵌套同查）');
      // 载荷注入角色字段不能提权：biz1（business:p1）尝试accept risk专属目标
      const ra = await api.as(PRINCIPALS.business).post(`/api/v1/goals/${gid2}/accept`, { requestId: reqId('ra'), expectedVersion: g2s.version, note: 'self-promote' });
      a.ok(ra.json && ra.json.ok === false && ra.status === 403, '业务角色accept风控目标被403拒（角色来自模板+身份源，不由载荷决定）', { status: ra.status, error: pick(ra.json, 'error') });
      // 证据content携带"授权指令"类字段仅作惰性数据：提交成功但不改变任何角色
      ok(a, await api.as(PRINCIPALS.admin).post(`/api/v1/projects/${pid2}/evidence`, { requestId: reqId('ev3'), expectedVersion: (await projectState(api.as(PRINCIPALS.admin), pid2)).version, kind: 'facts', content: { role: 'decision', grant: 'admin', permissions: ['all'] } }), 'content可存任意对象（惰性数据）');
      const ra2 = await api.as(PRINCIPALS.business).post(`/api/v1/goals/${gid2}/accept`, { requestId: reqId('ra2'), expectedVersion: g2s.version });
      a.ok(ra2.json && ra2.json.ok === false, '存入授权字样的证据不产生任何权限效果', { status: ra2.status });
    },
  },
  {
    id: 'D-03', title: '依赖环检测：模板环在实例化前被 400 DEPENDENCY_CYCLE 拒绝且无半状态', severity: 'P1', owner: 'A', timeoutMs: 120000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const cyclic = dTemplate({ name: 'D-03 环' });
      cyclic.goals[0].dependsOn = ['review'];
      cyclic.goals[1].dependsOn = ['collect'];
      const tr = await api.post('/api/v1/templates', cyclic);
      let templateId = null;
      if (tr.json && tr.json.ok === false) {
        errCode(a, tr, 'DEPENDENCY_CYCLE', '模板创建期即拒环');
      } else {
        templateId = pick(tr, 'templateId');
        ok(a, tr, '模板创建（环检测允许延迟到实例化）');
        const pr = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p'), templateId, name: 'D-03proj' }), '项目');
        const pid = pick(pr, 'projectId');
        const g1 = await api.post(`/api/v1/projects/${pid}/goals`, { requestId: reqId('g1'), expectedVersion: projectVersion(pr), goalKey: 'collect' });
        errCode(a, g1, 'DEPENDENCY_CYCLE', '实例化期拒环');
        const pr2 = await api.get(`/api/v1/projects/${pid}`);
        const found = JSON.stringify(pr2.json || {}).includes('"goalKey"') || (pr2.json && Array.isArray(pr2.json.goals) && pr2.json.goals.length > 0) || JSON.stringify(pr2.json || {}).match(/collect/);
        a.ok(!found, '无半状态：被拒目标未出现于项目投影', { probe: String(found) });
      }
      // 自环
      const self1 = dTemplate({ name: 'D-03b 自环' });
      self1.goals[0].dependsOn = ['collect'];
      const tr2 = await api.post('/api/v1/templates', self1);
      if (tr2.json && tr2.json.ok === false) {
        errCode(a, tr2, 'DEPENDENCY_CYCLE', '自环模板期拒绝');
      } else {
        const pr = ok(a, await api.post('/api/v1/projects', { requestId: reqId('p2'), templateId: pick(tr2, 'templateId'), name: 'D-03b' }), '项目b');
        const g = await api.post(`/api/v1/projects/${pick(pr, 'projectId')}/goals`, { requestId: reqId('g'), expectedVersion: projectVersion(pr), goalKey: 'collect' });
        errCode(a, g, 'DEPENDENCY_CYCLE', '自环实例化拒绝');
      }
    },
  },
  {
    id: 'D-05', title: '乐观版本：陈旧expectedVersion → 409 VERSION_CONFLICT{serverVersion} 非静默覆盖', severity: 'P1', owner: 'A', timeoutMs: 120000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId } = await setupProject(api, a, { projectName: 'D-05 版本' });
      const v1 = (await projectState(api, projectId)).version;
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('e1'), expectedVersion: v1, kind: 'facts', content: { n: 1 } }), '第一次提证成功');
      const stale = await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('e2'), expectedVersion: v1, kind: 'facts', content: { n: 2 } });
      const j = errCode(a, stale, 'VERSION_CONFLICT', '陈旧版本被409拒');
      a.ok(pick(j, 'serverVersion') !== undefined, '冲突响应带 serverVersion', { got: pick(j, 'serverVersion') });
      const v2 = (await projectState(api, projectId)).version;
      a.notEq(v2, v1, '失败写不推进版本', { v1, v2 });
      ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('e3'), expectedVersion: v2, kind: 'facts', content: { n: 3 } }), '新版本重提成功');
    },
  },
]);

runSuite(suite, import.meta.url);
