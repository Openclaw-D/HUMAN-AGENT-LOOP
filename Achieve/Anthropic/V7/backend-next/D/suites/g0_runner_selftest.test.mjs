// G0：runner/harness 自检。向用户证明测试框架自身的语义（超时/非零退出/零断言不PASS/真实socket）可靠。
// 用 D 自建微型套件文件+真实子进程验证，不依赖 A/B/C。
import { defineSuite, runSuite } from '../harness/runner.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HARNESS_RUNNER_URL = pathToFileURL(fileURLToPath(new URL('../harness/runner.mjs', import.meta.url))).href;

function suiteWrap(name, body) {
  return `import { defineSuite, runSuite } from '${HARNESS_RUNNER_URL}';\nconst s = defineSuite('${name}', [${body}]);\nrunSuite(s, import.meta.url);\n`;
}
const okSuite = () => suiteWrap('mini_ok', `{id:'M-1',title:'ok',fn:async(ctx)=>{ctx.assert.eq(1,1);ctx.assert.ok(true);}}`);
const failSuite = () => suiteWrap('mini_fail', `{id:'M-1',title:'fail',fn:async(ctx)=>{ctx.assert.eq(1,2,'intentional');}}`);
const throwSuite = () => suiteWrap('mini_throw', `{id:'M-1',title:'throw',fn:async(ctx)=>{throw new Error('boom-intentional');}}`);
const zeroSuite = () => suiteWrap('mini_zero', `{id:'M-1',title:'zero',fn:async(ctx)=>{await ctx.sleep(10);}}`);
const slowSuite = () => suiteWrap('mini_slow', `{id:'M-1',title:'slow',timeoutMs:300,fn:async(ctx)=>{await ctx.sleep(5000);}}`);
const blockedSuite = () => suiteWrap('mini_blocked', `{id:'M-1',title:'blocked',fn:async(ctx)=>{ctx.blocked('nothing deployed yet');}}`);

function makeChild(ctx) {
  const dir = path.join(ctx.runDir, 'mini-suites');
  mkdirSync(dir, { recursive: true });
  const run = (file) => {
    const runDir = path.join(ctx.runDir, 'mini-runs', file.replace('.test.mjs', ''));
    mkdirSync(runDir, { recursive: true });
    const r = spawnSync(process.execPath, [path.join(dir, file)], {
      env: { ...process.env, D_RUN_DIR: runDir },
      encoding: 'utf8', timeout: 45000, windowsHide: true,
    });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout, runDir };
  };
  return { dir, run };
}

const suite = defineSuite('g0_runner_selftest', [
  {
    id: 'G0-01', title: '全过套件→exit 0且断言计数', severity: 'P0', owner: 'D', timeoutMs: 60000,
    async fn(ctx) {
      const { dir, run } = makeChild(ctx);
      writeFileSync(path.join(dir, 'mini_ok.test.mjs'), okSuite());
      const r = run('mini_ok.test.mjs');
      ctx.assert.eq(r.status, 0, 'passing suite exits 0', { stderr: r.stderr && r.stderr.slice(-500) });
      const res = JSON.parse(readFileSync(path.join(r.runDir, 'mini_ok.result.json'), 'utf8'));
      ctx.assert.eq(res.pass, 1, 'one pass');
      ctx.assert.eq(res.totalAssertions, 2, 'assertions counted');
    },
  },
  {
    id: 'G0-02', title: '断言失败→exit 1', severity: 'P0', owner: 'D', timeoutMs: 60000,
    async fn(ctx) {
      const { dir, run } = makeChild(ctx);
      writeFileSync(path.join(dir, 'mini_fail.test.mjs'), failSuite());
      const r = run('mini_fail.test.mjs');
      ctx.assert.eq(r.status, 1, 'failing suite exits 1');
      const res = JSON.parse(readFileSync(path.join(r.runDir, 'mini_fail.result.json'), 'utf8'));
      ctx.assert.eq(res.fail, 1, 'one fail recorded');
    },
  },
  {
    id: 'G0-03', title: '测试内异常→FAIL捕获不崩溃，exit 1', severity: 'P0', owner: 'D', timeoutMs: 60000,
    async fn(ctx) {
      const { dir, run } = makeChild(ctx);
      writeFileSync(path.join(dir, 'mini_throw.test.mjs'), throwSuite());
      const r = run('mini_throw.test.mjs');
      ctx.assert.eq(r.status, 1, 'exception captured as FAIL -> exit 1');
      const res = JSON.parse(readFileSync(path.join(r.runDir, 'mini_throw.result.json'), 'utf8'));
      ctx.assert.eq(res.fail, 1, 'one fail');
      ctx.assert.includes(res.results[0].failures.map(f => f.msg + ' ' + (f.detail || '')).join('|'), 'boom-intentional', 'exception detail captured');
    },
  },
  {
    id: 'G0-04', title: '零断言测试→FAIL（逐测守卫）exit 1，绝不PASS', severity: 'P0', owner: 'D', timeoutMs: 60000,
    async fn(ctx) {
      const { dir, run } = makeChild(ctx);
      writeFileSync(path.join(dir, 'mini_zero.test.mjs'), zeroSuite());
      const r = run('mini_zero.test.mjs');
      ctx.assert.eq(r.status, 1, 'zero-assertion test is FAIL -> suite exits 1 (cannot pass)');
      const res = JSON.parse(readFileSync(path.join(r.runDir, 'mini_zero.result.json'), 'utf8'));
      ctx.assert.eq(res.results[0].state, 'fail', 'test marked fail');
      ctx.assert.includes(res.results[0].note, '0 assertions', 'note explains zero-assertion guard');
    },
  },
  {
    id: 'G0-05', title: '测试超时→FAIL(note=timeout)，exit 1', severity: 'P0', owner: 'D', timeoutMs: 60000,
    async fn(ctx) {
      const { dir, run } = makeChild(ctx);
      writeFileSync(path.join(dir, 'mini_slow.test.mjs'), slowSuite());
      const r = run('mini_slow.test.mjs');
      ctx.assert.eq(r.status, 1, 'timeout suite exits 1');
      const res = JSON.parse(readFileSync(path.join(r.runDir, 'mini_slow.result.json'), 'utf8'));
      ctx.assert.eq(res.results[0].note, 'timeout', 'timeout noted');
    },
  },
  {
    id: 'G0-06', title: 'BLOCKED 留门→state=blocked；纯blocked无断言→exit 3不得PASS', severity: 'P1', owner: 'D', timeoutMs: 60000,
    async fn(ctx) {
      const { dir, run } = makeChild(ctx);
      writeFileSync(path.join(dir, 'mini_blocked.test.mjs'), blockedSuite());
      const r = run('mini_blocked.test.mjs');
      const res = JSON.parse(readFileSync(path.join(r.runDir, 'mini_blocked.result.json'), 'utf8'));
      ctx.assert.eq(res.results[0].state, 'blocked', 'state blocked');
      ctx.assert.eq(r.status, 3, 'blocked-only suite (0 assertions) cannot pass -> exit 3');
    },
  },
  {
    id: 'G0-07', title: '真实HTTP回环：200/JSON往返/拒绝连接得0不挂起', severity: 'P0', owner: 'D', timeoutMs: 30000,
    async fn(ctx) {
      const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ pong: true, url: req.url })); });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const api = ctx.http(`http://127.0.0.1:${port}`);
        const res = await api.get('/ping?x=1');
        ctx.assert.status(res, 200);
        ctx.assert.eq(res.json && res.json.pong, true, 'json round-trip');
      } finally { server.close(); }
      try { server.closeAllConnections(); } catch { }
      await new Promise(r => setTimeout(r, 300));
      const api2 = ctx.http(`http://127.0.0.1:${port}`);
      const bad = await api2.get('/x', { timeoutMs: 3000 });
      ctx.assert.eq(bad.status, 0, 'closed port -> connection error status 0 (not hang)');
    },
  },
  {
    id: 'G0-08', title: 'D自有隔离PG容器：起/建库/SQL/重启数据保持/销毁', severity: 'P0', owner: 'D', timeoutMs: 240000,
    skipReason: 'Docker daemon不可用（记录证据，阻塞全部真实DB测试）',
    async fn(ctx) {
      const pg = await import('../harness/pgctl.mjs');
      if (!(await pg.dockerAvailable())) ctx.blocked('docker daemon unavailable');
      const runDir = path.join(ctx.runDir, 'pg-selftest');
      mkdirSync(runDir, { recursive: true });
      let container = null;
      try {
        const c = await pg.ensurePg({ runDir, port: 15499 });
        container = c.name;
        ctx.store.pgContainer = c.name;
        await pg.createDb(c.name, 'v7d_selftest');
        await pg.psql(c.name, 'v7d_selftest', 'CREATE TABLE IF NOT EXISTS t(k text primary key, v text)');
        await pg.psql(c.name, 'v7d_selftest', "INSERT INTO t VALUES('a','1')");
        await pg.restartPg(c.name);
        const after = await pg.psql(c.name, 'v7d_selftest', "SELECT v FROM t WHERE k='a'");
        ctx.assert.eq(after.out, '1', 'data survives PG restart');
        ctx.assert.ok(await pg.destroyPg(c.name), 'destroy own container');
        container = null; ctx.store.pgContainer = null;
      } finally {
        if (container) { try { await pg.destroyPg(container); } catch { } }
      }
    },
  },
]);

runSuite(suite, import.meta.url);
