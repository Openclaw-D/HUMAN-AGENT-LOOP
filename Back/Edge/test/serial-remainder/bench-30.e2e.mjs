// V0.3 串行收尾 · 步骤3 三十次顺序测量（2026-09-20）
// 固定合成输入（KS-LASER-500/D02 主体登记 PDF）· 独占 PG + 真实 A 内核 + Connectors + Edge + 本地 HTTP 模型替身。
// 分相：冷启动（首个观察全链）/ 解析（固定字节直接过异步解析器×30）/ 编排（图内五节点耗时+请求侧分相）/
//       HTTP替身等待（替身 arrive→depart 实测）/ 回执重放（同问题重放×14）/ 端到端（全部观察请求）。
// 策略：16 次独立冷请求（互不相同的问题，同一冻结上下文）+ 14 次合法重放 = 30 次顺序观察。
//       并发仅用于防重发专项（同问题 10 并发 → 恰 1 次模型调用）。
// 边界：替身延迟为本地实测（毫秒级），不代表真实模型或页面完成时间（后者归 Codex）。
// 运行：node Back/Edge/test/serial-remainder/bench-30.e2e.mjs
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const MATERIALS = path.join(REPO_ROOT, 'docs', 'materials', 'kashgar-demo-v1');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'v0.3', 'zcode', 'serial-remainder');
const TENANT = 'tenant_proc';
const now = () => performance.now();

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-serial-bench-'));
const pgPort = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
process.env.CONNECTORS_TEST_PG_PORT = String(pgPort);
process.env.CONNECTORS_TEST_PG_USER = 'v7next';
process.env.CONNECTORS_TEST_PG_PASSWORD = 'v7next';
process.env.CONNECTORS_TEST_PG_DATABASE = 'cnext';
const { TENANT: H_TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd } = await import('../../../Connectors/test/processing-helpers.mjs');
const pgctl = await import('../../../D/harness/pgctl.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 模型替身：记录 arrive/depart 相位 ----------
const mockHits = [];
const mockState = { onSend: null };
const mockServer = http.createServer((req, res) => {
  let body = ''; const arrive = now();
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    const parsed = JSON.parse(body);
    mockHits.push({ arrive, depart: null, briefChars: parsed.messages?.[0]?.content?.length ?? 0 });
    const hook = mockState.onSend; mockState.onSend = null;
    if (hook) await hook();
    const brief = parsed.messages?.[0]?.content ?? '';
    const pack = JSON.parse(brief.split('[服务端获准证据包] ')[1]);
    const out = { choices: [{ message: { content: JSON.stringify({
      observations: [{ text: '替身观察', evidenceRefIds: [pack.snippets[0].id] }], questions: ['替身待核验'],
    }) } }], usage: { prompt_tokens: 100 + pack.snippets.length, completion_tokens: 40 } };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out), () => { mockHits[mockHits.length - 1].depart = now(); });
  });
});
const mockPort = await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port)));

// ---------- 独占环境 ----------
const A_DB = 'jw_serial_bench_a';
const pg = await pgctl.ensurePg({ runDir, port: pgPort, db: 'jw_serial_bench_boot' });
await pgctl.psql(pg.name, 'jw_serial_bench_boot', `DROP DATABASE IF EXISTS ${A_DB} WITH (FORCE)`);
await pgctl.createDb(pg.name, A_DB);
await pgctl.psql(pg.name, 'jw_serial_bench_boot', 'CREATE DATABASE cnext').catch(() => { });
const aPort = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const aBase = `http://127.0.0.1:${aPort}`;
const kernel = spawn(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(aPort),
  '--db', `postgres://v7next:v7next@127.0.0.1:${pgPort}/${A_DB}`,
  '--principal-tokens', `tk-biz1=biz1:human:business:all:${TENANT},tk-cust1=cust1:human:customer:all:${TENANT},tk-svc1=svc1:service:service:all:${TENANT}`],
{ windowsHide: true, stdio: ['ignore', fs.openSync(path.join(runDir, 'kernel.log'), 'a'), fs.openSync(path.join(runDir, 'kernel.log'), 'a')] });
kernel.unref();
const waitHttp = async (url, ok, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (ok(r)) return true; } catch { } await sleep(400); }
  return false;
};
if (!await waitHttp(`${aBase}/healthz`, (r) => r.status === 200)) throw new Error('A 内核未就绪');
const harness = await makeProcessingHarness({
  port: 0, aBaseUrl: aBase,
  aConfig: { tenantId: TENANT, credentials: { service: 'tk-svc1', registrar: 'tk-biz1', upload: { customer_finance: 'tk-cust1' }, uploadFallback: 'tk-cust1' }, timeoutMs: 5000 },
  processing: { driverIntervalMs: 200, aTimeoutMs: 5000, aRegisterDomains: ['business', 'policy', 'credit', 'commerce', 'asset'],
    rulePackPath: path.join(BACK_ROOT, 'C', 'rules', 'takeoff-first-admission-rule-pack-v1.json') },
});
const connectorsBase = `http://127.0.0.1:${harness.server.server.address().port}`;

// 固定合成输入：D02 主体登记 PDF
const fixedRel = 'KS-LASER-500/originals/D02-主体登记资料.pdf';
const fixedBytes = fs.readFileSync(path.join(MATERIALS, fixedRel));
const allowedHashes = [createHash('sha256').update(fixedBytes).digest('hex')];

// Edge + 助手
const configPath = path.join(runDir, 'assistant-config.json');
fs.writeFileSync(configPath, JSON.stringify({ transport: { mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${mockPort}`, timeoutMs: 5000 } }, evidencePolicy: { allowedHashes } }));
const { createAssistantModel } = await import('../../src/assistant-model.mjs');
const { createAssistantEvidenceProvider } = await import('../../src/assistant-evidence-provider.mjs');
const { createKernelStore } = await import('../../src/kernel-store.mjs');
const { startEdgeServer, createLiveCredentialVerifier } = await import('../../src/server.mjs');
const { createSessionStore } = await import('../../src/session.mjs');
const { createAuditSink } = await import('../../src/audit.mjs');
const assistantModel = await createAssistantModel({ configPath, receiptsDir: path.join(runDir, 'model-receipts'), requireEvidence: true, maxContextChars: 12000, log: () => { } });
const assistantEvidence = createAssistantEvidenceProvider({ baseUrl: connectorsBase, token: 'proc_service_token', policy: () => assistantModel.evidencePolicy() });
const bizHash = createHash('sha256').update('tk-biz1').digest('hex');
const directory = { byHash: new Map([[bizHash, { principalId: 'biz1', roles: ['business'], tenantId: TENANT }]]),
  byPrincipal: new Map([['biz1', { credential: 'tk-biz1' }]]), list: [{ principalId: 'biz1', roles: ['business'] }] };
const edge = await startEdgeServer({
  port: 0, seal: { buildId: 'serial-bench', capabilities: { note: 'bench' } }, probes: [],
  store: createKernelStore({ baseUrl: aBase, log: () => { } }),
  auth: async ({ session }) => ({ ok: !!session }), sessionStore: createSessionStore({}),
  verifyCredential: createLiveCredentialVerifier({ kernelBase: aBase, directory }),
  identityDirectory: { list: directory.list, byPrincipal: directory.byPrincipal },
  auditSink: createAuditSink(), assistantModel, assistantEvidence,
});
const edgeBase = `http://127.0.0.1:${edge.port}`;
const sid = (await (await fetch(`${edgeBase}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principalId: 'biz1' }) })).json()).session.sessionId;

// 建客户 + 上传固定输入 + 处理到 A 登记（测量不含建链准备）
const cust = await (await fetch(`${aBase}/api/v2/customers`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-principal-credential': 'tk-biz1' }, body: JSON.stringify({ requestId: `bench-cust-${Date.now().toString(36)}`, credential: 'tk-biz1', tenantId: TENANT, legalEntityRef: 'bench-legal-ref', displayName: '测量客户（合成）' }) })).json();
console.log('[env] 建客户响应:', JSON.stringify(cust).slice(0, 200));
const customerId = cust.customerId;
if (!customerId) throw new Error('A 建客户失败');
const wsProbe = await fetch(`${aBase}/api/v2/customers/${encodeURIComponent(customerId)}`, { headers: { 'x-principal-credential': 'tk-biz1' } });
console.log('[env] A workspace 探针:', wsProbe.status, JSON.stringify(await wsProbe.json()).slice(0, 150));
const inv = await setupInvitation(harness.api, { customerId, kinds: ['document'] });
await uploadBytes(harness.api, inv, { customerId, kind: 'document', bytes: fixedBytes });
await driveToEnd(harness.api, { maxRounds: 30, maxTasks: 8 });
console.log(`[env] A=${aPort} Connectors=${harness.server.server.address().port} Edge=${edge.port} mock=${mockPort} customer=${customerId}`);

const observeTimed = async (question) => {
  const t0 = now();
  const r = await fetch(`${edgeBase}/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/observe`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid },
    body: JSON.stringify({ assistant: 'credit', question }),
  });
  const body = await r.json();
  return { t0, t1: now(), status: r.status, body };
};
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1)); return Math.round(s[i] * 100) / 100; };
const stats = (arr) => arr.length ? { n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), min: Math.round(Math.min(...arr) * 100) / 100, max: Math.round(Math.max(...arr) * 100) / 100 } : { n: 0 };

try {
  // ---------- 解析分相：固定字节直接过异步解析器 ×30（组件测量） ----------
  const { parseArtifactBytesAsync, ASYNC_PARSE_VERSION } = await import('../../../C/src/parse/adapters-async.mjs');
  const parseMs = [];
  let parseOk = 0;
  for (let i = 0; i < 30; i++) { const t = now(); const r = await parseArtifactBytesAsync(fixedBytes, { name: 'D02.pdf' }); if (r?.ok !== false && (r?.text ?? '').length > 0) parseOk++; parseMs.push(now() - t); }
  console.log(`[parse] 30×直接解析 ok=${parseOk} version=${ASYNC_PARSE_VERSION} p50=${pct(parseMs, 50)}ms p95=${pct(parseMs, 95)}ms`);

  // ---------- 30 次顺序观察（单一顺序窗口）----------
  // 桶定义（定向复核#2/#3 修正）：
  //   first_request  = 第1次观察：进程首次真实调用（含一次性 LangGraph 图编译）。
  //   independent    = #2..#16 共15次独立冷请求（互不相同的问题、同一冻结上下文、各自真实发送）。
  //   replay         = #17..#30 共14次合法回执重放（首问题重复，零外部调用）。
  // 编排/等待分相覆盖全部16次独立发送（first_request + independent），无缺样本。
  const e2e = [], firstReq = [], independent = [], orchestration = [], modelWait = [], replayMs = [], graphNodeSum = [];
  const COLD_N = 16, REPLAY_N = 14;
  for (let i = 0; i < 30; i++) {
    const question = i === 0 || i >= COLD_N ? '冷启动问题：核验主体登记要素' : `独立冷请求 ${i}：核验要素 ${i}`;
    const m = await observeTimed(question);
    if (m.status !== 200) { console.error(`[bench] 观察 ${i} 异常 ${m.status}: ${JSON.stringify(m.body).slice(0, 200)}`); continue; }
    const dur = m.t1 - m.t0;
    e2e.push(dur);
    const trace = m.body.model.graphTrace ?? [];
    if (i < COLD_N) {
      (i === 0 ? firstReq : independent).push(dur);
      const wait = mockHits.at(-1) ? (mockHits.at(-1).depart - mockHits.at(-1).arrive) : 0;
      modelWait.push(wait);
      // 计时范围（定向复核#4）：modelWait = 替身服务端处理窗口（arrive→depart，含HTTP往返+替身处理）；
      // orchestration = 端到端 − modelWait（请求侧：图节点+回执I/O+HTTP栈）。首请求含一次性图编译。
      orchestration.push(Math.max(0, dur - wait));
      graphNodeSum.push(trace.reduce((a, n) => a + (n.elapsedMs ?? 0), 0));
    } else {
      if (!m.body.model.replayed) console.error(`[bench] 重放轮 ${i} 未命中回执（replayed=false）`);
      replayMs.push(dur);
    }
  }
  // 顺序窗口计数在此固化；防重发并发专项是另一个独立窗口，两者不得混算（定向复核#3）。
  const sequentialWindow = { requests: e2e.length, model_sends: mockHits.length, receipt_replays: replayMs.length };
  const usage = { promptTokens: null, completionTokens: null, note: 'tokens 未实测（替身名义用量不计入实测；真实模型用量见 real-loop 调用清单）' };
  console.log('\n===== 三十次顺序测量结果（ms） =====');
  const report = {
    at: new Date().toISOString(), input: { file: fixedRel, bytes: fixedBytes.length, sha256: allowedHashes[0] },
    strategy: { sequential_observes: 30, first_request: firstReq.length, independent_cold: independent.length, receipt_replays: replayMs.length,
      note: 'first_request=进程首次调用（含一次性图编译）；independent=互不相同问题的独立发送；replay=首问题重复（零外部调用）' },
    timing_scope: { model_wait: '替身 arrive→depart：服务端处理窗口（HTTP往返+替身处理），非真实模型耗时',
      orchestration: '端到端−model_wait：请求侧图节点+回执I/O+HTTP栈；first_request 样本含一次性 LangGraph 编译',
      e2e: '客户端 fetch 发起至响应体解析完成' },
    parse: { component: 'parseArtifactBytesAsync 直接解析固定字节×30（流水线内每个工件仅解析一次，内容寻址判重）', ...stats(parseMs), ok: parseOk },
    first_request: { bucket: '进程首次观察全链（含图编译+工作本+证据读取+发送+回执）', ...stats(firstReq) },
    independent: { bucket: '独立冷请求（#2..#16，互不相同的问题）', ...stats(independent) },
    orchestration: { bucket: '请求侧编排=端到端−替身等待（覆盖16次独立发送）', samples: orchestration.length, ...stats(orchestration), graph_node_sum: stats(graphNodeSum) },
    stand_in_wait: { bucket: 'HTTP替身 arrive→depart（本地实测，不代表真实模型）', samples: modelWait.length, ...stats(modelWait) },
    replay: { bucket: '合法回执重放（同问题，零模型调用）', ...stats(replayMs) },
    e2e: { bucket: '全部30次观察端到端', ...stats(e2e) },
    usage, sequential_window: sequentialWindow, anti_resend_concurrent: null,
  };
  console.log('首次请求 ', JSON.stringify(report.first_request));
  console.log('独立请求 ', JSON.stringify(report.independent));
  console.log('编排     ', JSON.stringify(report.orchestration));
  console.log('替身等待 ', JSON.stringify(report.stand_in_wait));
  console.log('回执重放 ', JSON.stringify(report.replay));
  console.log('端到端   ', JSON.stringify(report.e2e));

  // ---------- 防重发并发专项（独立窗口）：同问题 10 并发 → 恰 1 次模型调用 ----------
  const hitsBefore = mockHits.length;
  const concurQ = `防重发并发专项 ${Date.now()}`;
  const burst = await Promise.all(Array.from({ length: 10 }, () => observeTimed(concurQ)));
  const okBurst = burst.filter((b) => b.status === 200);
  const modelCalls = mockHits.length - hitsBefore;
  const consistent = okBurst.every((b) => b.body.model.requestId === okBurst[0].body.model.requestId);
  const sendOnce = okBurst.filter((b) => b.body.model.replayed === false).length >= 1;
  report.anti_resend_concurrent = { window: '独立于顺序30次窗口（定向复核#3：两窗口分列，不混算）',
    concurrency: 10, responses_200: okBurst.length, model_calls: modelCalls, single_requestId: consistent,
    note: '进程内 flight 去重：并发同请求只允许一次发送，其余共享同一在途结果' };
  console.log(`\n[防重发专项·独立窗口] 10并发 → 200×${okBurst.length} 模型调用×${modelCalls} 单一requestId=${consistent}`);
  const concurPass = okBurst.length === 10 && modelCalls === 1 && consistent && sendOnce;
  console.log(`[防重发专项] ${concurPass ? 'PASS' : 'FAIL'}`);
  // 用量与窗口汇总：替身名义用量不作为实测 tokens（定向复核#4）
  report.usage.model_calls_sequential_window = sequentialWindow.model_sends;
  report.usage.model_calls_anti_resend_window = modelCalls;
  report.usage.note = '替身名义用量 prompt=100+片段数 completion=40/次为名义值，非实测；实测 tokens 仅存在于真实模型调用清单';
  fs.writeFileSync(path.join(OUT_DIR, 'bench-30-result.json'), JSON.stringify(report, null, 2));
  console.log(`\n结果已写入 ${path.join(OUT_DIR, 'bench-30-result.json')}`);
  console.log(`[bench] 顺序窗口=${sequentialWindow.requests}（首次${firstReq.length}+独立${independent.length}+重放${replayMs.length}） 发送${sequentialWindow.model_sends}次；防重发专项=${concurPass ? 'PASS' : 'FAIL'}`);
  if (!concurPass) process.exitCode = 1;
} catch (e) {
  console.error('[bench] 异常:', e?.stack ?? e);
  process.exitCode = 1;
} finally {
  try { await edge.close(); } catch { }
  try { process.kill(kernel.pid); } catch { }
  try { mockServer.closeAllConnections?.(); mockServer.close(); } catch { }
  try { await harness.dispose(); } catch { }
  try { await pgctl.destroyPg(pg.name); } catch { }
  try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { }
}
process.exit(process.exitCode ?? 0);
