// E1-D02 真实变体（任务04 §6 / 已由 E0 覆盖语义的真实服务版）：
//   自有隔离 PG（v7d- 前缀、15434、Edge/.run 数据目录）→ 应用 Back/A 全部迁移 →
//   启动 JW A 内核（17919 段，显式跳过旧 48080/15432）→ 启动 Edge（探针指向该栈）→
//   停 PG 容器 → 断言 /healthz/live 仍 ok 且 /healthz/ready 翻为不 ok 并给出 db 原因 →
//   重启 PG → ready 恢复 ok → 全部清理。
// 冻结门未过时：整组用例如实 skip（不伪造 PASS）；门判定原因写入输出。
// 运行：node --test test/e1/e1-d02-real.test.mjs（本机 node --test <目录> 有 MODULE_NOT_FOUND 怪癖，用显式文件）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFreezeGate } from './e1-gate.mjs';

const gate = await checkFreezeGate();
const skipReason = gate.frozen ? false : `E1 门未过: ${gate.reasons.join('; ')}`;

test('E1-D02 真实变体：真实 PG 停库时 liveness 保持、readiness 逐依赖如实翻转', { skip: skipReason }, async (t) => {
  const { execFile, spawn } = await import('node:child_process');
  const { mkdirSync, openSync, rmSync } = await import('node:fs');
    const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
  const REPO_ROOT = path.resolve(BACK_ROOT, '..');
  const RUN_DIR = path.join(EDGE_ROOT, '.run', 'e1-d02-pg');
  const DB = 'v7d_e1_d02', PORT = 15434, API_PORT = 17919;
  const pgctl = await import('../../../D/harness/pgctl.mjs');

  const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { windowsHide: true, timeout: opts.timeout || 60000, maxBuffer: 16 * 1024 * 1024, ...(opts.execOpts || {}) }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} exit: ${String(stderr || err.message).slice(0, 200)}`));
      resolve({ stdout, stderr });
    });
    if (opts.input !== undefined) { child.stdin.write(opts.input); child.stdin.end(); }
  });

  const waitHttp = async (url, ok, timeoutMs = 45000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (ok(r)) return true; } catch { }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  };

  let pg = null;
  let api = null;
  let edge = null;
  const cleanup = async () => {
    if (api) { try { process.kill(api.pid); } catch { } }
    if (edge) { try { await edge.close(); } catch { } }
    if (pg) { try { await pgctl.destroyPg(pg.name); } catch { } }
    // 现场日志保留在 RUN_DIR/kernel.log（.run/ 被 Git 排除），供失败诊断
  };
  t.after(cleanup);

  // 1) 自有隔离 PG + 全部迁移（迁移非幂等：每轮先重建库，保证从零开始）
  mkdirSync(RUN_DIR, { recursive: true });
  pg = await pgctl.ensurePg({ runDir: RUN_DIR, port: PORT, db: 'v7d_boot' });
  await pgctl.psql(pg.name, 'postgres', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await pgctl.psql(pg.name, 'postgres', `CREATE DATABASE ${DB}`);
  await pgctl.createDb(pg.name, DB);
  // 迁移由内核启动时自动执行（空库 → 001..00N）；测试不预迁移避免重复建表。

  // 2) 启动 JW A 内核（合成 principal 公开值；D 端口段，不碰 48080）
  const dsn = `postgres://v7next:v7next@127.0.0.1:${PORT}/${DB}`;
  const out = openSync(path.join(RUN_DIR, 'kernel.log'), 'a');
  api = spawn(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(API_PORT), '--db', dsn,
    '--principal-tokens', 'tok-admin=alice:human:admin:all,tok-approver=carol:human:approver:all'], { windowsHide: true, stdio: ['ignore', out, out] });
  api.unref();
  let apiExit = null;
  api.once('exit', (code, sig) => { apiExit = `exit=${code} sig=${sig}`; });
  const ready = await waitHttp(`http://127.0.0.1:${API_PORT}/healthz`, (r) => r.status === 200);
  assert.ok(ready, `A 内核未就绪（${apiExit ?? '仍在运行'}；日志 ${RUN_DIR}\kernel.log）`);

  // 3) Edge 真实探针指向该栈
  const { startEdgeServer } = await import('../../src/server.mjs');
  const { tcpProbe, httpProbe, aKernelReadyPass } = await import('../../src/probes.mjs');
  const { collectVersionSeal } = await import('../../src/version.mjs');
  const { createFixtureStore } = await import('../../src/store.mjs');
  const seal = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: { note: 'E1-D02' } });
  edge = await startEdgeServer({
    port: 0, seal, store: createFixtureStore(),
    probes: [
      httpProbe({ name: 'kernel-a', url: `http://127.0.0.1:${API_PORT}/healthz`, pass: aKernelReadyPass }),
      tcpProbe({ name: 'db', port: PORT }),
    ],
  });
  const base = `http://127.0.0.1:${edge.port}`;

  // 4) 基线：全依赖在线 → ready ok
  const before = await (await fetch(`${base}/healthz/ready`)).json();
  assert.equal(before.ok, true, '全依赖在线时 readiness 应为 ok');

  // 5) 停真实 PG → live 保持 ok，ready 翻不 ok 且给出 db/kernel 原因
  await pgctl.restartPg(pg.name, { downMs: 400 }).catch(() => { });
  await run('docker', ['stop', pg.name], { timeout: 60000 });
  const dbDownReady = await (async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const body = await (await fetch(`${base}/healthz/ready`)).json();
      if (body.ok === false && body.checks.some((c) => c.name === 'db' && c.ok === false)) return body;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  })();
  assert.ok(dbDownReady, '停库后 readiness 必须翻为不 ok 且 db 检查失败');
  const live = await (await fetch(`${base}/healthz/live`)).json();
  assert.equal(live.ok, true, '进程存活时 liveness 必须 ok（D02）');
  assert.equal(dbDownReady.capabilities.all_ok, undefined, '禁止 all_ok 汇总');

  // 6) 恢复 PG → ready 回到 ok
  await run('docker', ['start', pg.name], { timeout: 60000 });
  const deadline = Date.now() + 60000;
  let recovered = null;
  while (Date.now() < deadline) {
    recovered = await (await fetch(`${base}/healthz/ready`)).json();
    if (recovered.ok === true) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  assert.equal(recovered.ok, true, '依赖恢复后 readiness 应回到 ok');
});
