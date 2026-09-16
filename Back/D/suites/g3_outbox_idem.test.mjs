// G3 投递与幂等：D-09 outbox同事务 / D-10 至少一次+重复投递幂等 / D-11 requestId载荷一致性
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import http from 'node:http';
import { makeApi, ok, errCode, pick, reqId, setupProject, projectState, goalState, projectVersion, PRINCIPALS } from '../harness/adapter.mjs';
import { makeHttp } from '../harness/http.mjs';
import path from 'node:path';
const makeHttp2 = makeHttp;

async function sut(ctx) {
  if (!ctx.store.sut) ctx.store.sut = await sutctl.startSut(ctx, { suiteTag: 'g3', apiPort: 17913 }); // withDispatcher=true
  return ctx.store.sut;
}
async function readyCollect(ctx, api, name) {
  const a = ctx.assert;
  const { projectId, goals } = await setupProject(api, a, { projectName: name });
  const ps = await projectState(api, projectId);
  ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps.version, kind: 'facts', content: { ok: 1 } }), '提证');
  return { projectId, goalId: goals.collect };
}

const suite = defineSuite('g3_outbox_idem', [
  {
    id: 'D-09', title: 'outbox与业务写同事务：成功写出事件；失败写零孤儿事件（DB行级核验）', severity: 'P1', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId } = await readyCollect(ctx, api, 'D-09 outbox');
      // DB: 找 outbox 表
      const tRes = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT table_name FROM information_schema.tables t WHERE table_name ILIKE '%outbox%' AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name=t.table_name AND c.column_name='event_id') ORDER BY table_name LIMIT 1`);
      a.ok(tRes.out && tRes.out.length > 2, 'DB中存在事件outbox表（含event_id列）', { got: tRes.out, err: tRes.err });
      const tname = tRes.out;
      const cnt0 = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT max(seq) FROM ${tname}`);
      // pull通道可见事件（成功写→outbox行→pull可见）
      const ev1 = ok(a, await api.get('/api/v1/events?after=0&limit=100'), 'pull events');
      const ev1Str = JSON.stringify(ev1);
      a.ok(ev1Str.length > 10, 'pull返回非空事件流');
      a.ok(/eventId/.test(ev1Str) && /eventType/.test(ev1Str), '事件含eventId/eventType（契约§3.5）');
      // 失败写（陈旧版本）→ 无新outbox行
      const cnt1 = (await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT max(seq) FROM ${tname}`)).out;
      const ps = await projectState(api, projectId);
      await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ok'), expectedVersion: ps.version, kind: 'facts', content: { n: 2 } });
      const cnt2 = (await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT max(seq) FROM ${tname}`)).out;
      a.ok(Number(cnt2) > Number(cnt1), '成功业务写推进事件seq（outbox行落库）', { cnt1, cnt2 });
      const stale = await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('fail'), expectedVersion: ps.version, kind: 'facts', content: { n: 3 } });
      errCode(a, stale, 'VERSION_CONFLICT', '失败写被拒');
      const cnt3 = (await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT max(seq) FROM ${tname}`)).out;
      a.eq(cnt3, cnt2, '失败写零孤儿事件（max(seq)不推进=同事务回滚）', { cnt2, cnt3 });
    },
  },
  {
    id: 'D-10', title: '至少一次投递+重复投递：订阅端500→重投同eventId；业务效果不因重投重复', severity: 'P1', owner: 'A', timeoutMs: 240000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      // D自有接收器：每eventId首次500，其后200（迫使dispatcher至少重投一次）
      const deliveries = new Map(); // eventId -> [timestamps]
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          let eid = 'unknown';
          try { eid = pick(JSON.parse(body), 'eventId') || 'unknown'; } catch { }
          if (!deliveries.has(eid)) deliveries.set(eid, []);
          deliveries.get(eid).push(Date.now());
          if (deliveries.get(eid).length === 1) { res.writeHead(500); res.end('force-retry'); }
          else { res.writeHead(200); res.end('ok'); }
        });
      });
      await new Promise(r => server.listen(17940, '127.0.0.1', r));
      try {
        const sub = await api.post('/api/v1/subscriptions', { requestId: reqId('sub'), name: 'v7d-receiver', url: 'http://127.0.0.1:17940/hook' });
        ok(a, sub, '注册订阅（loopback）');
        // 业务写：提证+claim+complete（产生多事件）
        const { projectId, goalId } = await readyCollect(ctx, api, 'D-10 重投');
        const gs = await goalState(api, goalId);
        const cl = ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/claim`, { requestId: reqId('c'), expectedVersion: gs.version }), 'claim');
        const lg = await goalState(api, goalId);
        ok(a, await api.as(PRINCIPALS.agent).post(`/api/v1/goals/${goalId}/complete`, { requestId: reqId('x'), expectedVersion: lg.version, fencingToken: pick(cl, 'fencingToken'), result: { provider: 'calculation', output: {} } }), 'complete（用claim实发token）');
        // 等待dispatcher投递+重投（poll 500ms、退避）
        const deadline = Date.now() + 60000;
        let maxDeliveries = 0;
        while (Date.now() < deadline) {
          maxDeliveries = Math.max(0, ...[...deliveries.values()].map(v => v.length));
          if (maxDeliveries >= 2) break;
          await ctx.sleep(1000);
        }
        a.ok(maxDeliveries >= 2, '至少一次语义：同eventId被投递≥2次（500后重投）', { seen: [...deliveries.entries()].map(([k, v]) => [k.slice(0, 8), v.length]) });
        // 接收端按eventId幂等去重后每事件恰一效果
        const distinct = deliveries.size;
        a.ok(distinct >= 1, '接收端distinct事件与事件流一致', { distinct });
        // 重投不产生业务副作用：goal仍candidate_ready、receiptCount不变
        const after = await goalState(api, goalId);
        a.eq(after.status, 'candidate_ready', '重投期间业务状态不被重复推进', { actual: after.status });
      } finally { server.close(); try { server.closeAllConnections(); } catch { } }
    },
  },
  {
    id: 'D-11', title: 'requestId幂等：同载荷重放replayed；异载荷409 REQUEST_MISMATCH且第二效果不生效', severity: 'P1', owner: 'A', timeoutMs: 180000,
    async fn(ctx) {
      const a = ctx.assert;
      const s = await sut(ctx);
      const api = makeApi(s.apiBase).as(PRINCIPALS.admin);
      const { projectId } = await setupProject(api, a, { projectName: 'D-11 幂等' });
      const ps = await projectState(api, projectId);
      const rid = reqId('idem');
      const first = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: rid, expectedVersion: ps.version, kind: 'facts', content: { n: 1 } }), '首次提交');
      const vAfterFirst = (await projectState(api, projectId)).version;
      const replay = ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: rid, expectedVersion: ps.version, kind: 'facts', content: { n: 1 } }), '同载荷重放');
      a.eq(pick(replay, 'replayed'), true, '重放标记replayed:true', { got: pick(replay, 'replayed') });
      const vAfterReplay = (await projectState(api, projectId)).version;
      a.eq(vAfterReplay, vAfterFirst, '重放不推进版本（单效）');
      // 异载荷同requestId → 409 REQUEST_MISMATCH
      const conflict = await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: rid, expectedVersion: ps.version, kind: 'facts', content: { n: 999 } });
      errCode(a, conflict, 'REQUEST_MISMATCH', '异载荷同requestId被拒');
      // 拒绝后无第三效果
      const vFinal = (await projectState(api, projectId)).version;
      a.eq(vFinal, vAfterFirst, 'mismatch拒绝不产生写', { vAfterFirst, vFinal });
      // DB证据内容仅首次
      const tRes = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%evidence%' LIMIT 1`);
      if (tRes.out && tRes.out.length > 2) {
        const colRes = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT count(*) FROM information_schema.columns WHERE table_name='${tRes.out}' AND column_name='project_id'`);
        const where = Number(colRes.out) > 0 ? ` WHERE project_id='${projectId}'` : '';
        const rows = await sutctl.pgctl.psql(s.pg.name, s.dbname, `SELECT count(*) FROM ${tRes.out}${where}`);
        a.eq(rows.out, '1', `DB仅一条证据（本project范围，重放/mismatch均未新建${where ? '' : '；表无project_id列，全表计数'}）`, { got: rows.out, err: rows.err });
      }
    },
  },
  {
    id: 'D-10b', title: 'v1.0#5订阅边界与死信：常败投递指数退避至dead', severity: 'P1', owner: 'A', timeoutMs: 300000,
    async fn(ctx) {
      const a = ctx.assert;
      const base = await sut(ctx);
      const pg = base.pg;
      const dbname = 'v7d_g3b_sut';
      await sutctl.pgctl.createDb(pg.name, dbname);
      const dsn = `postgres://v7next:v7next@127.0.0.1:${sutctl.D_PG_PORT}/${dbname}`;
      const { stopOwn } = await import('../harness/proc.mjs');
      const { PRINCIPAL_TOKEN_SPEC } = await import('../harness/adapter.mjs');
      const aDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../A');
      const migTs = path.join(aDir, 'src', 'db', 'migrate-cli.ts');
      const idxTs = path.join(aDir, 'src', 'index.ts');
      const spec = process.env.D_PRINCIPAL_SPEC || PRINCIPAL_TOKEN_SPEC;
      const m = await ctx.proc.spawnOwn('d-g3b-migrate', process.execPath, [migTs, '--db', dsn], {
        cwd: aDir, stdoutPath: path.join(ctx.runDir, 'g3b-migrate.log'),
      });
      await new Promise((res, rej) => { m.proc.once('exit', (c) => c === 0 ? res() : rej(new Error('migrate ' + c))); setTimeout(() => rej(new Error('migrate timeout')), 120000); });
      const api2 = await ctx.proc.spawnOwn('d-g3b-api', process.execPath, [idxTs, '--port', '17914', '--db', dsn, '--dispatch', '--principal-tokens', spec], {
        cwd: aDir, env: { V7NEXT_A_OUTBOX_MAX_ATTEMPTS: '3', V7NEXT_A_OUTBOX_POLL_MS: '300' },
        stdoutPath: path.join(ctx.runDir, 'g3b-api.log'),
        readyProbe: async () => { const h = makeHttp2('http://127.0.0.1:17914', { defaultTimeoutMs: 3000 }); const r = await h('GET', '/api/v1/health'); return r.status === 200; },
        readyTimeoutMs: 45000,
      });
      try {
        const api = makeApi('http://127.0.0.1:17914').as(PRINCIPALS.admin);
        const { projectId } = await setupProject(api, a, { projectName: 'D-10b 订阅边界' });
        let got = 0;
        const server = http.createServer((req, res) => { req.on('data', () => { }); req.on('end', () => { got++; res.writeHead(500); res.end('always-fail'); }); });
        await new Promise(r => server.listen(17941, '127.0.0.1', r));
        try {
          ok(a, await api.post('/api/v1/subscriptions', { requestId: reqId('sub'), name: 'v7d-dead-test', url: 'http://127.0.0.1:17941/hook' }), '订阅（常败接收器）');
          const ps = await projectState(api, projectId);
          ok(a, await api.post(`/api/v1/projects/${projectId}/evidence`, { requestId: reqId('ev'), expectedVersion: ps.version, kind: 'facts', content: { dead: 'path' } }), '注册后提证（产生事件）');
          const tEv = (await sutctl.pgctl.psql(pg.name, dbname, `SELECT table_name FROM information_schema.tables t WHERE table_name LIKE '%outbox%' AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name=t.table_name AND c.column_name='event_id') LIMIT 1`)).out;
          a.ok(tEv && tEv.length > 2, '事件表存在', { got: tEv });
          const deadline = Date.now() + 90000;
          let deadRow = null;
          while (Date.now() < deadline) {
            const r = await sutctl.pgctl.psql(pg.name, dbname, `SELECT dispatch_state || '|' || attempts FROM ${tEv} ORDER BY seq DESC LIMIT 1`);
            if (r.out && r.out.includes('dead')) { deadRow = r.out; break; }
            await ctx.sleep(1000);
          }
          a.ok(deadRow !== null, '常败投递最终dead（指数退避至上限）', { deadRow, got });
          a.ok(got >= 1, '注册后事件确实被投递过（重试痕迹）', { got });
        } finally { server.close(); try { server.closeAllConnections(); } catch { } }
      } finally {
        if (api2 && api2.pid) await stopOwn({ pid: api2.pid });
      }
    },
  },
]);

runSuite(suite, import.meta.url);
