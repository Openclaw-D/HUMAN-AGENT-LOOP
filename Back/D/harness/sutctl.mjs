// SUT生命周期（对准 CONTRACT v0.1 + A/src/config.ts 参数面）：
// D自有PG容器（v7d-前缀、15433段、D/.run数据目录）→ 建每套件独立库 → A迁移 → A API（D端口段1791x）→ 可选worker/假API。
// 全部子进程由D spawn并跟踪；只杀自己启动的。A的48080/15432部署完全不触碰。零依赖。
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pgctl from './pgctl.mjs';
import { spawnOwn, stopAllOwn, listOwn } from './proc.mjs';
import { makeHttp } from './http.mjs';
import { PRINCIPAL_TOKEN_SPEC, PRINCIPALS, PRINCIPAL_HEADER } from './adapter.mjs';

const D_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_ROOT = path.dirname(D_ROOT);

export const D_PG_PORT = 15433;
export const PG_USER = 'v7next', PG_PASS = 'v7next';

function distEntry(laneDir, rel) {
  const p = path.join(NEXT_ROOT, laneDir, rel);
  return existsSync(p) ? p : null;
}

// 每套件一个独立实例。suiteTag: 'g1' 等。
// A实际入口（A/README + 监督02:05确认）：node直跑 src/index.ts 与 src/db/migrate-cli.ts（Node22类型剥离，无dist构建）。
export async function startSut(ctx, { suiteTag, apiPort = 17910, withDispatcher = true, leaseSeconds = 8, worker = null, fakeApi = null } = {}) {
  const runDir = ctx.runDir;
  const dbname = `v7d_${suiteTag}_sut`;
  // 1) 自有PG（整轮共享容器，每套件独立库）
  const pg = await pgctl.ensurePg({ runDir: path.join(D_ROOT, '.run', 'pg-d'), port: D_PG_PORT, user: PG_USER, password: PG_PASS, db: 'v7d_boot' });
  ctx.store.pgContainer = pg.name;
  await pgctl.createDb(pg.name, dbname);
  const dsn = `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${D_PG_PORT}/${dbname}`;

  // 2) A迁移 + API入口（A源码直跑）
  const migrateTs = distEntry('A', path.join('src', 'db', 'migrate-cli.ts'));
  const indexTs = distEntry('A', path.join('src', 'index.ts'));
  if (!indexTs) throw new Error('BLOCKED: A/src/index.ts 不存在（A路实现未就绪）');

  const principalSpec = process.env.D_PRINCIPAL_SPEC || PRINCIPAL_TOKEN_SPEC;
  const commonEnv = { V7NEXT_A_DB_URL: dsn, V7NEXT_A_LEASE_SECONDS: String(leaseSeconds) };
  if (migrateTs) {
    const m = await spawnOwn(`d-${suiteTag}-migrate`, process.execPath, [migrateTs, '--db', dsn], {
      cwd: path.join(NEXT_ROOT, 'A'), env: commonEnv,
      stdoutPath: path.join(runDir, `${suiteTag}-migrate.log`),
    });
    await new Promise((res, rej) => {
      m.proc.once('exit', (code) => code === 0 ? res() : rej(new Error(`migrate exited ${code}（log=${suiteTag}-migrate.log）`)));
      setTimeout(() => rej(new Error('migrate timeout 180s')), 180000);
    });
  } else {
    ctx.log(`[sut] A/src/db/migrate-cli.ts 不存在，跳过显式迁移（可能API内建迁移）`);
  }

  // 3) A API（D端口段；官方SPEC principal；dispatcher随API进程）
  const apiSpec = {
    cmd: process.execPath,
    args: [indexTs, '--port', String(apiPort), '--db', dsn, '--principal-tokens', principalSpec, ...(withDispatcher ? ['--dispatch'] : [])],
    cwd: path.join(NEXT_ROOT, 'A'), env: commonEnv,
    stdoutPath: path.join(runDir, `${suiteTag}-api.log`),
    apiPort,
  };
  // 端口冲突自动重试：Windows下跨run的TIME_WAIT/残留监听可致EADDRINUSE，向上顺延端口
  const spawnApiAt = (port) => spawnOwn(`d-${suiteTag}-api`, apiSpec.cmd, apiSpec.args.map(a => a === String(apiPort) ? String(port) : a), {
    cwd: apiSpec.cwd, env: { ...apiSpec.env }, stdoutPath: apiSpec.stdoutPath,
    readyProbe: async () => {
      const h = makeHttp(`http://127.0.0.1:${port}`, { defaultTimeoutMs: 3000 });
      const r = await h('GET', '/api/v1/health');
      return r.status === 200;
    },
    readyTimeoutMs: 45000,
  });
  let api = null, usedPort = apiPort;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { api = await spawnApiAt(usedPort); break; }
    catch (e) {
      let tail = '';
      try { tail = readFileSync(apiSpec.stdoutPath, 'utf8').slice(-400); } catch { }
      if (/EADDRINUSE/i.test(tail) && attempt < 5) { usedPort += 1; continue; }
      throw e;
    }
  }
  const apiBase = `http://127.0.0.1:${usedPort}`;

  // 重启API（D-13/D-17/D-21）：停旧进程→同参数（可覆盖principal spec）重启→health就绪
  const restartApi = async (principalSpecOverride) => {
    const { stopOwn } = await import('./proc.mjs');
    if (api && api.pid) await stopOwn({ pid: api.pid });
    const spec = principalSpecOverride || principalSpec;
    const fresh = await spawnOwn(`d-${suiteTag}-api`, process.execPath, [
      indexTs, '--port', String(usedPort), '--db', dsn, '--principal-tokens', spec, ...(withDispatcher ? ['--dispatch'] : []),
    ], {
      cwd: apiSpec.cwd, env: commonEnv, stdoutPath: apiSpec.stdoutPath,
      readyProbe: async () => {
        const h = makeHttp(`http://127.0.0.1:${usedPort}`, { defaultTimeoutMs: 3000 });
        const r = await h('GET', '/api/v1/health');
        return r.status === 200;
      },
      readyTimeoutMs: 45000,
    });
    api.pid = fresh.pid; api.proc = fresh.proc;
    return fresh;
  };

  // 4) 可选worker（B）与假API（C）——由套件显式要求时启动
  let workerProc = null, fakeApiProc = null;
  if (worker && worker.cmd) {
    workerProc = await spawnOwn(`d-${suiteTag}-worker`, worker.cmd, worker.args || [], {
      cwd: worker.cwd, env: { ...commonEnv, ...(worker.env || {}) },
      stdoutPath: path.join(runDir, `${suiteTag}-worker.log`),
    });
  }
  if (fakeApi && fakeApi.cmd) {
    try {
      fakeApiProc = await spawnOwn(`d-${suiteTag}-fakeapi`, fakeApi.cmd, fakeApi.args || [], {
        cwd: fakeApi.cwd, env: fakeApi.env || {},
        stdoutPath: path.join(runDir, `${suiteTag}-fakeapi.log`),
        readyProbe: async () => {
          const h = makeHttp(`http://127.0.0.1:${fakeApi.port}`, { defaultTimeoutMs: 2000 });
          const r = await h('GET', '/');
          return r.status > 0;
        },
        readyTimeoutMs: 20000,
      });
    } catch (e) {
      if (!fakeApi.optional) throw e;
      fakeApiProc = { failed: String(e.message).slice(0, 200) };
    }
  }

  return { pg, dbname, dsn, api, apiBase, workerProc, fakeApiProc, restartApi,
    stopApiOnly: async () => { if (api) await ctx.proc.stopOwn({ pid: api.pid }); if (workerProc && workerProc.pid) await ctx.proc.stopOwn({ pid: workerProc.pid }); } };
}

// 套件收尾：杀本套件进程、清本套件库（容器保留供后续套件复用）
export async function stopSut(ctx, sut, { dropDb = true } = {}) {
  try { await stopAllOwn(); } catch { }
  if (dropDb && sut && sut.dbname && sut.pg) {
    try { await pgctl.psql(sut.pg.name, 'postgres', `DROP DATABASE IF EXISTS ${sut.dbname} WITH (FORCE)`); } catch { }
  }
}

export { pgctl, spawnOwn, stopAllOwn, listOwn, PRINCIPALS, PRINCIPAL_HEADER };
