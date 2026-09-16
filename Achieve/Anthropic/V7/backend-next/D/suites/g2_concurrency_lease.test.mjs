// G2 并发与租约：D-06 双客户端争抢 / D-07 并发提交幂等单效 / D-08 过期租约写拒绝+fencing单调
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import { makeApi, ok, errCode, pick, reqId, dTemplate, setupProject, projectState, goalState, goalVersion, projectVersion, PRINCIPALS } from '../harness/adapter.mjs';

async function sut(ctx) {
  if (!ctx.store.sut) ctx.store.sut = await sutctl.startSut(ctx, { suiteTag: 'g2', apiPort: 17912, leaseSeconds: 8 });
  return ctx.store.sut;
}
// 准备一个已 ready 的 agent 目标
async function readyGoal(ctx, api, name) {
  const a = ctx.assert;
  const { projectId, goals } = await setupProject(api, a, { projectName: name });
  const ps = await projectState(api, projectId);
  ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps.version, kind: 'facts', content: { ok: true } }), '提证→ready');
  return { projectId, goalId: goals.collect };
}

const suite = defineSuite('g2_concurrency_lease', [
  {
    id: 'D-06', title: '两客户端同时领取同一任务：恰一2xx，唯一assignee', severity: 'P0', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goalId } = await readyGoal(ctx, api, 'D-06 争抢');
      const gs = await goalState(api, goalId);
      a.eq(gs.status, 'ready', '前置ready', { actual: gs.status });
      // 两独立客户端（两个连接句柄）同时 claim
      const c1 = makeApi(s.apiBase).as(PRINCIPALS.agent);
      const c2 = makeApi(s.apiBase).as(PRINCIPALS.agent);
      const [r1, r2] = await Promise.all([
        c1.post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId('c1'), expectedVersion: gs.version }),
        c2.post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId('c2'), expectedVersion: gs.version }),
      ]);
      const wins = [r1, r2].filter(r => r.json && r.json.ok === true);
      const losses = [r1, r2].filter(r => !(r.json && r.json.ok === true));
      a.eq(wins.length, 1, '恰好一方claim成功', { ok1: r1.json && r1.json.ok, ok2: r2.json && r2.json.ok, s1: r1.status, s2: r2.status });
      a.eq(losses.length, 1, '另一方明确失败');
      for (const l of losses) {
        a.ok(l.status === 409, '失败方409冲突', { status: l.status, body: l.text.slice(0, 150) });
        a.ok(pick(l.json, 'error') !== undefined, '失败方带契约错误码', { error: pick(l.json, 'error') });
      }
      // 投影：唯一assignee；DB行级核验（自适应表名+列名，不可判定时降级为API投影并记录）
      const after = await goalState(api, goalId);
      a.eq(after.status, 'leased', '状态leased', { actual: after.status });
      const assignee = pick(after.json, 'assignedTo');
      a.eq(assignee, 'worker1', 'assignee唯一且=agent principal', { got: assignee });
      const tname = (await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%task%' OR table_name LIKE '%assignment%' ORDER BY table_name LIMIT 1`)).out;
      const colOk = tname && (await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT count(*) FROM information_schema.columns WHERE table_name='${tname}' AND column_name IN ('goal_id','goalId')`)).out;
      if (tname && Number(colOk) > 0) {
        const col = (await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT column_name FROM information_schema.columns WHERE table_name='${tname}' AND column_name IN ('goal_id','goalId') LIMIT 1`)).out;
        const rowq = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT count(*) FROM ${tname} WHERE ${col}='${goalId}'`);
        a.eq(rowq.out, '1', `DB行级唯一（${tname}.${col}）`, { got: rowq.out, err: rowq.err });
      } else {
        ctx.log(`[D-06] DB核验降级：task/assignment表或goal_id列未找到（tname=${tname}），以API投影判定`);
        a.ok(true, 'DB表形状探测记录');
      }
    },
  },
  {
    id: 'D-07', title: '两客户端并发提交同目标：恰一成功，版本恰+1，效果不重复', severity: 'P1', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goalId } = await readyGoal(ctx, api, 'D-07 并发提交');
      const gs = await goalState(api, goalId);
      const c1 = makeApi(s.apiBase).as(PRINCIPALS.agent);
      const cl = ok(a, await c1.post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId('c'), expectedVersion: gs.version }), 'claim');
      const fencing = pick(cl, 'fencingToken');
      const ver = goalVersion(cl) ?? gs.version + 1;
      // 并发两个 accept（人类侧竞写同一目标）
      ok(a, await c1.post(`/api/v1/goals/${goalId}/complete`, { requestId: reqId('done'), expectedVersion: ver, fencingToken: fencing, result: { provider: 'calculation', output: { v: 1 } } }), 'complete→candidate');
      const cand = await goalState(api, goalId);
      a.eq(cand.status, 'candidate_ready', '候选就绪', { actual: cand.status });
      const rk1 = makeApi(s.apiBase).as(PRINCIPALS.approver);
      const rk2 = makeApi(s.apiBase).as(PRINCIPALS.approver);
      const [a1, a2] = await Promise.all([
        rk1.post(`/api/v1/goals/${goalId}/accept`, { requestId: reqId('a1'), expectedVersion: cand.version }),
        rk2.post(`/api/v1/goals/${goalId}/accept`, { requestId: reqId('a2'), expectedVersion: cand.version }),
      ]);
      const okCount = [a1, a2].filter(r => r.json && r.json.ok === true).length;
      a.eq(okCount, 1, '并发accept恰一成功', { s1: a1.status, s2: a2.status });
      for (const r of [a1, a2]) {
        if (!(r.json && r.json.ok === true)) a.eq(r.status, 409, '失败方409（VERSION_CONFLICT/TERMINAL_STATE）', { error: pick(r.json, 'error') });
      }
      const fin = await goalState(api, goalId);
      a.eq(fin.status, 'accepted', '终态accepted一次达成', { actual: fin.status });
      a.eq(fin.version, cand.version + 1, '版本恰+1（单效，无双写）', { got: fin.version, expect: cand.version + 1 });
    },
  },
  {
    id: 'D-08', title: '过期租约写回拒绝 + fencing单调：过期complete/旧token均被结构性拒绝且零写副作用', severity: 'P0', owner: 'A', timeoutMs: 240000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx); // leaseSeconds=8
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId, goalId } = await readyGoal(ctx, api, 'D-08 租约');
      const gs = await goalState(api, goalId);
      const cl = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId('c1'), expectedVersion: gs.version }), 'claim1');
      const f1 = pick(cl, 'fencingToken');
      a.ok(Number.isFinite(f1), 'fencingToken#1', { got: f1 });
      // 等租约过期（8s租约 + 余量）
      await ctx.sleep(10500);
      const before = await goalState(api, goalId);
      // 过期后直接complete → 409（LEASE_EXPIRED 或 STALE_FENCING_TOKEN，均为结构性拒绝）
      const late = await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, {
        requestId: reqId('late'), expectedVersion: before.version, fencingToken: f1,
        result: { provider: 'calculation', output: { late: true } },
      });
      a.ok(late.status === 409, '过期租约complete→409', { status: late.status, error: pick(late.json, 'error') });
      a.ok(['LEASE_EXPIRED', 'STALE_FENCING_TOKEN'].includes(pick(late.json, 'error')), '契约错误码', { error: pick(late.json, 'error') });
      // v1.1#4：到期租约可被任意合格执行者直接重领（无takeover），token递增
      const reclaim = ok(a, await makeApi(s.apiBase).as(PRINCIPALS.agent2).post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId('reclaim'), expectedVersion: before.version }), '另一合格执行者到期重领');
      const f1r = pick(reclaim, 'fencingToken');
      a.ok(Number.isFinite(f1r) && f1r > f1, '重领token递增（fencing保护原worker）', { f1, f1r });
      const nowLeased = await goalState(api, goalId);
      a.eq(nowLeased.status, 'leased', '重领后回到leased', { actual: nowLeased.status });
      // takeover → token+1 清assignee；旧token写回 → STALE_FENCING_TOKEN
      const tk = ok(a, await api.as(PRINCIPALS.business).post(`/api/v1/goals/${goalId}/takeover`, { requestId: reqId('tk'), expectedVersion: before.version }), 'takeover');
      const f2 = pick(tk, 'fencingToken');
      a.ok(Number.isFinite(f2) && f2 > f1, 'fencing单调递增', { f1, f2 });
      // 零副作用断言只括住本次stale拒绝（重领/接管本身产生合法回执，不计入）
      const rcS1 = pick((await goalState(api, goalId)).json, 'receiptCount');
      const stale = await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, {
        requestId: reqId('stale'), expectedVersion: (await goalState(api, goalId)).version, fencingToken: f1,
        result: { provider: 'calculation', output: { stale: true } },
      });
      errCode(a, stale, 'STALE_FENCING_TOKEN', '旧token写回结构性拒绝');
      const after = await goalState(api, goalId);
      a.eq(pick(after.json, 'result'), pick(before.json, 'result'), 'result未被污染', { before: pick(before.json, 'result'), after: pick(after.json, 'result') });
      const rc2 = pick(after.json, 'receiptCount');
      if (typeof rcS1 === 'number' && typeof rc2 === 'number') a.eq(rc2, rcS1, 'stale拒绝零回执增长', { rcS1, rc2 });
      // 新claim token继续单调
      const st2 = await goalState(api, goalId);
      const cl2 = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId('c2'), expectedVersion: st2.version }), 'claim2（takeover后重新可领）');
      const f3 = pick(cl2, 'fencingToken');
      a.ok(Number.isFinite(f3) && f3 >= f2, '新claim token≥takeover token（单调不回退）', { f2, f3 });
    },
  },
]);

runSuite(suite, import.meta.url);
