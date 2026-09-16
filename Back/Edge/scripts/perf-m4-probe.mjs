// 任务三 §7·全链路可见性测针（M4 独立版）：真实 A 内核 + Edge live 投影 + SSE，
// 量"业务动作发出 → 其他客户端可见"的时延（含内核 DB 提交段 + Edge 轮询段），20 样本。
// 与 perf-baseline 的 fixture M1–M3 互补；证据写 docs/customer-next/acceptance/evidence/perf-m4-<stamp>/m4.json
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(EDGE_ROOT, '..', '..');
const SAMPLES = 20;
const percentile = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1))]; };
const stats = (arr) => ({ n: arr.length, p50: +percentile(arr, 50).toFixed(1), p95: +percentile(arr, 95).toFixed(1), p99: +percentile(arr, 99).toFixed(1), max: +Math.max(...arr).toFixed(1) });

const { bootStack } = await import('../test/e1/task3-boot.mjs');
const B = await bootStack({ t: null, runName: 'task3-m4probe' });
const result = { measuredAt: new Date().toISOString(), environment: { node: process.version, network: 'loopback 同机', pollIntervalMs: 600, providerMode: 'not_configured' }, target: 'p95<=1s（任务书§7：业务事件提交到其他客户端可见）' };
try {
  const s = B.sessions.biz1;
  const call = async (method, p, body) => {
    const r = await fetch(`${B.base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-jw-session': s.sessionId }, body: body === undefined ? undefined : JSON.stringify(body) });
    return r.json();
  };
  const cust = await call('POST', '/api/jw/v2/actions/customers', { requestId: `m4-c-${Date.now().toString(36)}`, tenantId: 't1', legalEntityRef: `USCC-M4-${Date.now().toString(36)}`, displayName: 'M4 测量客户' });
  const customerId = cust.customerId;

  // 第二个独立会话作为"其他客户端"的 SSE 观察者（cred1），与动作发起者（biz1）不同会话
  const obs = B.sessions.cred1;
  const frames = [];
  const waiters = [];
  const req = http.get({ host: '127.0.0.1', port: B.edge.port, path: `/api/jw/v2/customers/${customerId}/events`, headers: { 'x-jw-session': obs.sessionId } }, (res) => {
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const frame = {};
        for (const line of raw.split('\n')) {
          if (line.startsWith(':')) continue;
          const ci = line.indexOf(':'); if (ci === -1) continue;
          const k = line.slice(0, ci); const v = line.slice(ci + 1).replace(/^ /, '');
          if (k === 'data') frame.data = frame.data ? frame.data + '\n' + v : v; else frame[k] = v;
        }
        if (Object.keys(frame).length) {
          frames.push(frame);
          for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(frames)) { waiters[i].resolve(); waiters.splice(i, 1); }
        }
      }
    });
  });
  const waitFor = (pred, timeoutMs = 8000) => new Promise((resolve, reject) => {
    if (pred(frames)) return resolve();
    waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error('SSE 等待超时')), timeoutMs).unref();
  });
  await waitFor((fs) => fs.some((f) => f.event === 'cursor'), 8000);

  const lat = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    const r = await call('POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
      requestId: `m4-a-${i}`, tenantId: 't1', kind: 'perf_note', factKey: `m4-${i}`,
      content: { i, at: Date.now() }, grade: 'unverified',
    });
    if (r.ok !== true) throw new Error(`材料登记失败: ${JSON.stringify(r)}`);
    await waitFor((fs) => fs.some((f) => f.event === 'business' && f.data.includes(`"factKey":"m4-${i}"`)), 8000);
    lat.push(performance.now() - t0);
  }
  try { req.destroy(); } catch { }
  result.samples = stats(lat);
  result.verdict = result.samples.p95 <= 1000 ? 'WITHIN_TARGET' : 'OVER_TARGET';
  console.log(`[m4] 全链路可见性: ${JSON.stringify(result.samples)} → ${result.verdict}`);
} catch (e) {
  result.verdict = 'ERROR';
  result.error = String(e.message);
  console.error(`[m4] 执行错误: ${e.message}`);
} finally {
  await B.cleanup();
  const dir = path.join(REPO_ROOT, 'docs', 'customer-next', 'acceptance', 'evidence', `perf-m4-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'm4.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`[m4] 报告: ${path.relative(REPO_ROOT, path.join(dir, 'm4.json'))}`);
  process.exit(result.verdict === 'WITHIN_TARGET' ? 0 : result.verdict === 'ERROR' ? 2 : 1);
}
