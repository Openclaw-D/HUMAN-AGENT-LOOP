// D路自有隔离PostgreSQL容器管理。只操作 `v7d-` 前缀的自有容器，绝不触碰其他容器。
// 端口固定在 15432（冲突时+1探测），数据目录在 D/.run/。零依赖（docker CLI + node:pg协议手工实现太重，改用 docker exec psql 执行SQL）。
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from "node:fs";
import path from 'node:path';
import { createHash } from 'node:crypto';

const IMAGE = 'postgres:15-alpine'; // 本地已有镜像，不拉网络
const NAME_PREFIX = 'v7d-pg-';

function dexec(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile('docker', args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export async function dockerAvailable() {
  const r = await dexec(['info', '--format', '{{.ServerVersion}}'], 15000);
  return !r.err ? r.stdout.trim() : null;
}

export function pickPort(start = 15432) {
  // 简单探测：返回给定起点（绑定检查交给容器启动本身）
  return start;
}

export async function containerState(name) {
  const r = await dexec(['inspect', '-f', '{{.State.Status}}', name], 10000);
  return r.err ? null : r.stdout.trim();
}

export async function ensurePg({ runDir, port = 15432, password = 'v7next', user = 'v7next', db = 'v7d_boot' }) {
  const dataDir = path.join(runDir, 'pgdata');
  mkdirSync(dataDir, { recursive: true });
  const absData = path.resolve(dataDir);
  // 容器名按数据目录哈希派生：跨run同名不同卷的碰撞不再可能
  const name = NAME_PREFIX + createHash('sha256').update(absData.toLowerCase()).digest('hex').slice(0, 10);
  const recreate = async () => {
    await dexec(['rm', '-f', name], 60000);
    const r = await dexec(['run', '-d', '--name', name,
      '-e', `POSTGRES_USER=${user}`,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-e', `POSTGRES_DB=${db}`,
      '-p', `127.0.0.1:${port}:5432`,
      '-v', `${absData}:/var/lib/postgresql/data`,
      IMAGE, '-c', 'fsync=on'], 120000);
    if (r.err) throw new Error(`docker run pg failed: ${r.stderr.slice(0, 300)}`);
  };
  const st = await containerState(name);
  if (!st) {
    await recreate();
  } else if (st !== 'running') {
    await dexec(['start', name], 60000);
  }
  // 就绪=目标库可用（pg_isready在initdb建POSTGRES_DB窗口会误报ready）
  const ready = async () => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const r = await dexec(['exec', name, 'psql', '-U', user, '-d', db, '-c', 'SELECT 1'], 10000);
      if (!r.err) return true;
      await sleep(800);
    }
    return false;
  };
  if (!(await ready())) {
    // 超时仍不可用：先卸容器再清datadir重建（POSTGRES_USER/DB只对空卷生效；Windows须先卸载再删）
    await dexec(['rm', '-f', name], 60000);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    mkdirSync(dataDir, { recursive: true });
    await recreate();
    if (!(await ready())) throw new Error('pg not ready after rebuild (db-level probe)');
  }
  return { name, port, host: '127.0.0.1', user, password, dsn: `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/${db}` };
}

export async function psql(name, db, sql, user = 'v7next') {
  const r = await dexec(['exec', name, 'psql', '-U', user, '-d', db, '-A', '-t', '-c', sql], 30000);
  if (r.err) return { err: r.stderr.slice(0, 500), out: r.stdout };
  return { out: r.stdout.trim(), err: null };
}

export async function createDb(name, dbname, user = 'v7next') {
  const exists = await psql(name, 'postgres', `SELECT 1 FROM pg_database WHERE datname='${dbname}'`, user);
  if (!exists.out.includes('1')) {
    let last = null;
    for (let i = 0; i < 2; i++) {
      const r = await dexec(['exec', name, 'createdb', '-U', user, dbname], 20000);
      if (!r.err) return;
      last = r;
      await sleep(1500);
    }
    throw new Error(`createdb ${dbname}: ${String(last.stderr).slice(0, 200)}`);
  }
}

export async function restartPg(name, { downMs = 2000, user = 'v7next' } = {}) {
  const s1 = await dexec(['stop', name], 60000);
  if (s1.err) throw new Error(`docker stop ${name}: ${s1.stderr.slice(0, 200)}`);
  await sleep(downMs);
  const s2 = await dexec(['start', name], 60000);
  if (s2.err) throw new Error(`docker start ${name}: ${s2.stderr.slice(0, 200)}`);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const r = await dexec(['exec', name, 'pg_isready', '-U', user], 10000);
    if (!r.err && r.stdout.includes('accepting connections')) return true;
    await sleep(700);
  }
  throw new Error('pg not ready after restart');
}

export async function destroyPg(name) {
  const st = await containerState(name);
  if (!st) return false;
  await dexec(['rm', '-f', name], 60000);
  return true;
}
