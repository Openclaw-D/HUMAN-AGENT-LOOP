// soak F1 最小复现（缺陷：message-store.mjs 未设 busy_timeout → 跨进程并发写同库时
// SQLITE_BUSY "database is locked" 直接抛出 → 服务 500）。
// 本测试直指产品源码 Back/Edge/src（child-server 以 SOAK_SNAPSHOT_DIR=src 导入）：
//   - 修复前：并发对撞回合中应出现 CHILD_INTERNAL/database is locked（缺陷证据）；
//   - 修复后（PRAGMA busy_timeout）：0 例锁错误，且同 requestId 出站恒 ≤1。
// 该文件同时是长期回归：任何回退（移除忙等超时）都会被本测试抓住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startSink, writeJournalHeader } from './sink.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_SRC = path.resolve(HERE, '..', '..', 'src');

function postJson(base, pathname, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${base}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, body: null }); } });
    });
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, body: null, error: String(e?.message ?? e) }));
    req.write(payload);
    req.end();
  });
}

test('F1 跨进程同库并发写：零 database is locked；同ID出站≤1', { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'soak-f1-'));
  const dbFile = path.join(dir, 'messages.db');
  const journal = path.join(dir, 'sink-journal.jsonl');
  writeJournalHeader(journal);
  const sink = await startSink({ journalFile: journal, chaos: { latencyMaxMs: 300, errorRate: 0 } });
  const env = {
    ...process.env,
    SOAK_SNAPSHOT_DIR: PRODUCT_SRC,
    SOAK_DB: dbFile,
    SOAK_SINK: sink.baseUrl,
    SOAK_LEASE_MS: '8000',
    SOAK_INSTANCE: 'repro',
    SOAK_STORE_OPTS: JSON.stringify({ maxPerCustomer: 500, maxReceipts: 4096 }),
  };
  const start = () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(HERE, 'child-server.mjs')], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const to = setTimeout(() => reject(new Error('child ready timeout')), 15_000);
    p.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n').find((l) => l.includes('"ready"'));
      if (line) { clearTimeout(to); resolve({ p, base: `http://127.0.0.1:${JSON.parse(line).port}` }); }
    });
  });
  const kids = [];
  const a = await start(); kids.push(a.p);
  const b = await start(); kids.push(b.p);
  try {
    let lockErrors = 0;
    const raceIds = [];
    // 40 回合：每回合同 ID 双进程对撞 1 次 + 异 ID 各 1 次（写入点：claim / append / finalize / trim）。
    for (let i = 0; i < 40; i++) {
      const rid = `f1-race-${i}`;
      const payload = { customerId: 'f1-c1', session: { principalId: 'p1', tenantId: 't1', roles: ['business'] }, body: { requestId: rid, audience: 'customer', text: `f1 round ${i}` } };
      const soloA = { customerId: 'f1-c1', session: { principalId: 'p1', tenantId: 't1', roles: ['business'] }, body: { requestId: `f1-a-${i}`, audience: 'customer', text: `f1 a ${i}` } };
      const soloB = { customerId: 'f1-c2', session: { principalId: 'p2', tenantId: 't1', roles: ['business'] }, body: { requestId: `f1-b-${i}`, audience: 'customer', text: `f1 b ${i}` } };
      const [ra, rb, sa, sb] = await Promise.all([
        postJson(a.base, '/messages', payload),
        postJson(b.base, '/messages', payload),
        postJson(a.base, '/messages', soloA),
        postJson(b.base, '/messages', soloB),
      ]);
      for (const r of [ra, rb, sa, sb]) {
        const note = r.body?.note ?? '';
        if (r.status === 500 && (r.body?.error === 'CHILD_INTERNAL' || /locked|busy/i.test(note))) lockErrors += 1;
      }
      raceIds.push({ rid, ra, rb });
    }
    // 同 ID 出站恒 ≤1（对账 sink 日志）
    const perId = new Map();
    for (const l of (await import('node:fs')).readFileSync(journal, 'utf8').split('\n').filter(Boolean)) {
      const rec = JSON.parse(l);
      perId.set(rec.requestId, (perId.get(rec.requestId) ?? 0) + 1);
    }
    const dups = [...perId.entries()].filter(([, c]) => c > 1);
    assert.deepEqual(dups, [], `同requestId多次出站：${JSON.stringify(dups.slice(0, 5))}`);
    // 缺陷断言（修复后必须为 0；修复前的运行记录见本包报告：>0 即复现）
    assert.equal(lockErrors, 0, `跨进程并发写出现 ${lockErrors} 例 database is locked（500 CHILD_INTERNAL）`);
    // 对撞回合恰一次真实发送（200 非重放数 ≤1，其余为 409 或重放）
    for (const { rid, ra, rb } of raceIds) {
      const real = [ra, rb].filter((r) => r.status === 200 && r.body?.ok && !r.body?.replayed);
      assert.ok(real.length <= 1, `${rid} 真实发送 ${real.length} 次`);
    }
    writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify({ lockErrors, dups: dups.length, rounds: 40 }));
  } finally {
    for (const k of kids) { try { process.kill(k.pid, 'SIGKILL'); } catch { /* 已退出 */ } }
    await sink.close();
    await new Promise((r) => setTimeout(r, 800)); // Windows：等句柄释放
    rmSync(dir, { recursive: true, force: true });
  }
});
