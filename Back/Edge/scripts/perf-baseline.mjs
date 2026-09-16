// Edge 层性能基线（任务04 §6 S4 提案的首轮测量，范围限定本 Edge 服务）：
//   基线环境如实声明；按提案规模造数（100 合成客户、10 万历史事件）；测量
//     M1 客户快照 GET p50/p95/p99（提案目标 ≤500ms）
//     M2 简单事务命令（会话交换/消息发送）p95（提案目标 ≤1s）
//     M3 事件追加→SSE 客户端可见 p95，5 并行会话（提案目标 ≤1s；注：不含内核 DB 提交段，内核集成后补测全程）
//     S  60s 受控浸泡烟测：RSS/heap 采样（任务书 2 小时浸泡为 NOT_RUN，另行安排）
// 目标值为"待确认的测试目标"而非承诺；对照结果如实记录。退出码：0=完成测量，2=执行错误。
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(EDGE_ROOT, '..', '..');
const CUSTOMERS = 100;
const EVENTS_TOTAL = 100000;

const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1))];
};
const stats = (arr) => arr.length === 0 ? null : {
  n: arr.length, p50: +percentile(arr, 50).toFixed(2), p95: +percentile(arr, 95).toFixed(2),
  p99: +percentile(arr, 99).toFixed(2), max: +Math.max(...arr).toFixed(2),
};

const getAsync = (port, p) => new Promise((resolve, reject) => {
  const t0 = performance.now();
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    res.resume();
    res.on('end', () => resolve({ ms: performance.now() - t0, status: res.statusCode }));
  }).on('error', reject);
});

const postAsync = (port, p, body, headers = {}) => new Promise((resolve, reject) => {
  const t0 = performance.now();
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
    let b = '';
    res.on('data', (d) => (b += d));
    res.on('end', () => resolve({ ms: performance.now() - t0, status: res.statusCode, body: b ? JSON.parse(b) : null }));
  });
  req.on('error', reject);
  req.end(JSON.stringify(body));
});

// SSE 订阅：返回 {frames, waitFor(pred), close}。
function sseOpen(port, pathname) {
  const frames = [];
  const waiters = [];
  const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const frame = {};
        for (const line of raw.split('\n')) {
          const ci = line.indexOf(':');
          if (ci === -1) continue;
          const k = line.slice(0, ci);
          const v = line.slice(ci + 1).replace(/^ /, '');
          if (k === 'data') frame.data = frame.data ? frame.data + '\n' + v : v;
          else frame[k] = v;
        }
        if (Object.keys(frame).length) {
          frames.push(frame);
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].pred(frames)) { waiters[i].resolve(); waiters.splice(i, 1); }
          }
        }
      }
    });
  });
  const closed = new Promise((resolve) => req.on('close', resolve));
  return {
    frames,
    waitFor: (pred, timeoutMs = 5000) => new Promise((resolve, reject) => {
      if (pred(frames)) return resolve();
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error('SSE 等待超时')), timeoutMs).unref();
    }),
    close: () => { try { req.destroy(); } catch { } return closed; },
  };
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const evidenceDir = path.join(REPO_ROOT, 'docs', 'customer-next', 'acceptance', 'evidence', `perf-baseline-${stamp}`);
  const steps = [];
  const record = (name, detail) => { steps.push({ name, detail, at: new Date().toISOString() }); console.log(`[perf] ${name}: ${JSON.stringify(detail)}`); };

  const { startEdgeServer } = await import('../src/server.mjs');
  const { createFixtureStore } = await import('../src/store.mjs');
  const store = createFixtureStore();

  const tSeed0 = performance.now();
  const perCustomer = EVENTS_TOTAL / CUSTOMERS;
  for (let c = 0; c < CUSTOMERS; c++) {
    const cid = `perf-${String(c).padStart(4, '0')}`;
    store.upsertCustomer(cid, {
      name: `合成客户${c}`,
      domains: { policy: 'in_progress', credit: 'candidate_ready', commerce: 'in_progress', asset: 'not_started' },
      missing: [{ kind: 'invoice', status: 'missing' }],
    });
    for (let e = 0; e < perCustomer; e++) {
      store.appendEvent(cid, { type: 'seed.event', payload: { seq: e }, scope: { session: 'seed' } });
    }
  }
  const seedMs = Math.round(performance.now() - tSeed0);

  const edge = await startEdgeServer({ port: 0, seal: { buildId: 'perf', capabilities: { note: 'perf baseline' } }, probes: [], store, auth: async () => ({ ok: true }) });

  try {
    // M1 快照读
    const snap = [];
    for (let i = 0; i < 500; i++) {
      const cid = `perf-${String(i % CUSTOMERS).padStart(4, '0')}`;
      const r = await getAsync(edge.port, `/api/jw/v2/customers/${cid}/workspace`);
      if (r.status !== 200) throw new Error(`workspace ${r.status}`);
      snap.push(r.ms);
    }
    record('M1 快照读(100客户;store含10万事件)', { target: 'p95<=500ms(提案)', ...stats(snap) });

    // M2 简单事务命令（带写面的服务实例：会话交换×200、消息发送×200）
    const { createSessionStore } = await import('../src/session.mjs');
    const { createAuditSink } = await import('../src/audit.mjs');
    const { createMessageRouter } = await import('../src/messages.mjs');
    const sent = [];
    const messages = createMessageRouter({
      deliver: async (m) => { sent.push(m); return { messageId: `m-${sent.length}`, state: 'sent_local_sink' }; },
      auditSink: createAuditSink(),
    });
    const verifyCredential = async ({ credential }) => (credential === 'perf-cred'
      ? { ok: true, principalId: 'perf', roles: ['admin'] }
      : { ok: false });
    const edge2 = await startEdgeServer({
      port: 0, seal: { buildId: 'perf', capabilities: {} }, probes: [], store,
      sessionStore: createSessionStore({}), verifyCredential, messages,
      auth: async ({ session }) => (session ? { ok: true } : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' }),
    });
    const sessMs = [];
    const msgs = [];
    let sid = null;
    for (let i = 0; i < 200; i++) {
      const r = await postAsync(edge2.port, '/api/jw/v2/session', { credential: 'perf-cred' });
      if (r.status !== 200) throw new Error(`session ${r.status}`);
      if (i === 0) sid = r.body.session.sessionId;
      else sessMs.push(r.ms); // 首轮含连接建立，不计入延迟样本
    }
    for (let i = 0; i < 200; i++) {
      const r = await postAsync(edge2.port, '/api/jw/v2/customers/perf-0001/messages',
        { requestId: `perf-m-${i}`, audience: 'internal', text: 'perf' }, { 'x-jw-session': sid });
      if (r.status !== 200) throw new Error(`message ${r.status}`);
      msgs.push(r.ms);
    }
    record('M2 简单事务命令(会话交换199/消息发送200)', {
      target: 'p95<=1s(提案)',
      sessionExchange: stats(sessMs),
      messageSend: stats(msgs),
    });
    await edge2.close();

    // M3 SSE 端到端投递（store 追加→5 路并行客户端可见）
    const streams = [];
    for (let s = 0; s < 5; s++) {
      streams.push(sseOpen(edge.port, '/api/jw/v2/customers/perf-0001/events'));
      await streams[s].waitFor((fs) => fs.some((f) => f.event === 'cursor'), 5000);
    }
    const lat = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const env = store.appendEvent('perf-0001', { type: 'perf.latency', payload: { i } });
      const pred = (fs) => fs.some((f) => f.event === 'business' && f.data.includes(env.eventId));
      await Promise.all(streams.map((s) => s.waitFor(pred, 5000)));
      lat.push(performance.now() - t0);
    }
    record('M3 事件追加→5路SSE客户端可见', { target: 'p95<=1s(提案;不含内核DB提交段)', ...stats(lat) });
    for (const s of streams) await s.close();

    // M4（任务三扩展）：全链路可见性——真实 A 内核 + Edge live 投影（含内核 DB 提交与 Edge 轮询段）。
    // 量法：经 Edge 动作代理登记材料（请求发出）→ SSE 订阅端看到对应业务事件，20 样本串行。
    if (process.argv.includes('--with-kernel')) {
      const { bootStack } = await import('../test/e1/task3-boot.mjs');
      const B = await bootStack({ t: null, runName: 'task3-perf' });
      try {
        const s = B.sessions.biz1;
        const call = async (method, path, body) => {
          const r = await fetch(`${B.base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-jw-session': s.sessionId }, body: body === undefined ? undefined : JSON.stringify(body) });
          return r.json();
        };
        const cust = await call('POST', '/api/jw/v2/actions/customers', { requestId: 'perf-k-c', tenantId: 't1', legalEntityRef: `USCC-P-${Date.now()}`, displayName: '性能测量客户' });
        const customerId = cust.customerId;
        // 带会话头的 SSE 订阅（live 投影要求会话；sseOpen 不支持自定义头，这里内联实现）
        const frames2 = [];
        const waiters2 = [];
        const sseReq = http.get({ host: '127.0.0.1', port: B.edge.port, path: `/api/jw/v2/customers/${customerId}/events`, headers: { 'x-jw-session': s.sessionId } }, (res) => {
          res.setEncoding('utf8');
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const frame = {};
              for (const line of raw.split('\n')) {
                if (line.startsWith(':')) continue;
                const ci = line.indexOf(':');
                if (ci === -1) continue;
                const k = line.slice(0, ci);
                const v = line.slice(ci + 1).replace(/^ /, '');
                if (k === 'data') frame.data = frame.data ? frame.data + '\n' + v : v;
                else frame[k] = v;
              }
              if (Object.keys(frame).length) {
                frames2.push(frame);
                for (let i = waiters2.length - 1; i >= 0; i--) {
                  if (waiters2[i].pred(frames2)) { waiters2[i].resolve(); waiters2.splice(i, 1); }
                }
              }
            }
          });
        });
        const stream = {
          waitFor: (pred, timeoutMs = 8000) => new Promise((resolve, reject) => {
            if (pred(frames2)) return resolve();
            waiters2.push({ pred, resolve });
            setTimeout(() => reject(new Error('SSE 等待超时')), timeoutMs).unref();
          }),
          close: () => { try { sseReq.destroy(); } catch { } },
        };
        await stream.waitFor((fs) => fs.some((f) => f.event === 'cursor'), 8000);
        const full = [];
        for (let i = 0; i < 20; i++) {
          const t0 = performance.now();
          const r = await call('POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
            requestId: `perf-k-a-${i}`, tenantId: 't1', kind: 'perf_note', factKey: `perf-${i}`,
            content: { i, at: Date.now() }, grade: 'unverified',
          });
          if (r.ok !== true) throw new Error(`材料登记失败: ${JSON.stringify(r)}`);
          await stream.waitFor((fs) => fs.some((f) => f.event === 'business' && f.data.includes(`"factKey":"perf-${i}"`)), 8000);
          full.push(performance.now() - t0);
        }
        stream.close();
        record('M4 全链路可见性(A内核DB提交+Edge轮询+SSE, 真实投影)', {
          target: 'p95<=1s(任务书§7业务事件跨客户端可见)', samples: full.length, ...stats(full),
          pollIntervalMs: 600,
        });
      } finally {
        await B.cleanup();
      }
    }

    // S 浸泡烟测 60s：受控负载 + 内存采样（任务书 2 小时浸泡 NOT_RUN，另行安排）
    const samples = [];
    const loadTimers = [];
    let appended = 0;
    const soakMs = 60000;
    const t0 = Date.now();
    loadTimers.push(setInterval(() => {
      const cid = `perf-${String((appended++) % CUSTOMERS).padStart(4, '0')}`;
      store.appendEvent(cid, { type: 'soak.event', payload: { n: appended } });
    }, 100));
    loadTimers.push(setInterval(() => samples.push({ t: Date.now() - t0, rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed }), 5000));
    while (Date.now() - t0 < soakMs) await new Promise((r) => setTimeout(r, 1000));
    for (const t of loadTimers) clearInterval(t);
    const first = samples[0], last = samples[samples.length - 1];
    record('S 浸泡烟测60s', {
      note: '任务书要求 2 小时受控运行——NOT_RUN 另行安排；本项仅为烟测',
      rssFirstMB: +(first.rss / 1048576).toFixed(1), rssLastMB: +(last.rss / 1048576).toFixed(1),
      heapGrowthMB: +((last.heap - first.heap) / 1048576).toFixed(1),
      eventsAppendedDuringSoak: appended,
    });

    const report = {
      schemaVersion: 'jw.perf-baseline.v1',
      measuredAt: new Date().toISOString(),
      environment: {
        cpu: `${os.cpus().length}x ${os.cpus()[0].model.trim()}`,
        ramGB: +(os.totalmem() / 2 ** 30).toFixed(1),
        os: `${os.type()} ${os.release()}`,
        node: process.version,
        network: 'loopback 同机',
        providerMode: 'not_configured（外部模型/ASR/RTC 时延不在本测量内）',
        dataScale: { customers: CUSTOMERS, events: EVENTS_TOTAL },
        seedMs,
      },
      targetsNote: '目标为任务书"待确认的测试提案"，不是生产容量承诺；SLO 全链路（内核DB提交段）待任务01集成后补测',
      steps,
    };
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, 'perf.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`[perf] 报告: ${path.relative(REPO_ROOT, path.join(evidenceDir, 'perf.json'))}`);
    process.exit(0);
  } catch (e) {
    console.error(`[perf] 执行错误: ${e.message}`);
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, 'perf.json'), JSON.stringify({ verdict: 'ERROR', error: String(e.message), steps }, null, 2));
    process.exit(2);
  } finally {
    await edge.close().catch(() => { });
  }
}

main();
