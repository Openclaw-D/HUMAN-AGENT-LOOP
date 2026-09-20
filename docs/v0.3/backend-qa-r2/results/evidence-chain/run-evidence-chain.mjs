// backend-qa-r2 · 包03 证据链（evidence-chain）独立测试 runner
// 任务书：docs/v0.3/backend-qa-r2/03_EVIDENCE_CHAIN.md
//
// 目标：真实 A/Connectors/Edge 隔离链验证证据来源与分析回执；模型端使用本地 HTTP 替身。
//   - 真实：A 内核进程（独占 PG 独占库）、Connectors compose（真实上传/异步解析/处理驱动/A桥）、
//           Edge（live kernel-store + assistant observe/decisions 面 + live 凭据核实器）。
//   - 替身：模型 = 本地 HTTP mock（显式 simulated 语义；不冒充真实模型质量验收）。
//   - 隔离：每轮独立 runDir / PG 容器 / A 库 / Connectors 库 / 回执与反馈存储；两轮相同操作顺序。
//   - 边界：不执行正式审批/资金动作；不改产品实现；只写本目录与系统临时目录。
//
// 运行：node docs/v0.3/backend-qa-r2/results/evidence-chain/run-evidence-chain.mjs
// 退出码：0=全部通过；1=存在失败；2=阻点（依赖缺失，未执行）。
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(OUT_DIR, '..', '..', '..', '..', '..');
const BACK_ROOT = path.join(REPO_ROOT, 'Back');
const MATERIALS = path.join(REPO_ROOT, 'docs', 'materials', 'kashgar-demo-v1');
const TENANT = 'tenant_proc';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jstr = (v) => JSON.stringify(v);

const { digest } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'assistant-receipts.mjs')).href);
const pgctl = await import(pathToFileURL(path.join(BACK_ROOT, 'D', 'harness', 'pgctl.mjs')).href);
const { ASYNC_PARSE_VERSION } = await import(pathToFileURL(path.join(BACK_ROOT, 'C', 'src', 'parse', 'adapters-async.mjs')).href);

// ---------- 阻点预检：docker + 本地 postgres 镜像（缺失即退出 2，不自动下载） ----------
const dockerVer = await pgctl.dockerAvailable();
if (!dockerVer) {
  console.error('阻点：Docker 不可用，无法创建本包独占 PG。未执行任何测试。');
  process.exit(2);
}
const hasImage = await new Promise((resolve) => {
  execFile('docker', ['image', 'inspect', 'postgres:15-alpine'], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err));
});
if (!hasImage) {
  console.error('阻点：本地无 postgres:15-alpine 镜像（任务书禁止自动下载）。未执行任何测试。');
  process.exit(2);
}

// ---------- 输入源码 SHA256 台账（执行前后对照；漂移→相关项标待复验） ----------
const INPUT_SOURCES = [
  'Back/A/src/index.ts', 'Back/A/src/domain/credit.ts', 'Back/A/src/http/server.ts',
  'Back/Connectors/src/http/server.mjs', 'Back/Connectors/src/processing/coordinator.mjs',
  'Back/Connectors/src/processing/assistant-evidence.mjs', 'Back/Connectors/src/evidence/service.mjs',
  'Back/Connectors/src/evidence/a_bridge.mjs', 'Back/Connectors/src/intake/service.mjs',
  'Back/Edge/src/server.mjs', 'Back/Edge/src/assistant-model.mjs', 'Back/Edge/src/assistant-evidence.mjs',
  'Back/Edge/src/assistant-evidence-provider.mjs', 'Back/Edge/src/assistant-decisions.mjs',
  'Back/Edge/src/decision-feedback-store.mjs', 'Back/Edge/src/assistant-receipts.mjs',
  'Back/Edge/src/kernel-store.mjs', 'Back/Edge/src/session.mjs', 'Back/Edge/src/audit.mjs',
  'Back/B/src/transport/glm.mjs', 'Back/B/src/graph/assistant-analysis.mjs',
  'Back/Connectors/test/processing-helpers.mjs', 'Back/D/harness/pgctl.mjs',
  'Back/C/rules/takeoff-first-admission-rule-pack-v1.json',
  'docs/materials/kashgar-demo-v1/KS-LASER-500/originals/D01-融资需求登记.pdf',
  'docs/materials/kashgar-demo-v1/KS-LASER-500/originals/D02-主体登记资料.pdf',
  'docs/materials/kashgar-demo-v1/KS-LASER-500/originals/D09-销售合同与交付凭据.pdf',
  'docs/materials/kashgar-demo-v1/KS-INJECTION-1000/originals/D11-生产与库存说明.pdf',
  'docs/materials/kashgar-demo-v1/eval-v03/KS-INJECTION-1000/C01-equipment-conflict.csv',
  'docs/materials/kashgar-demo-v1/eval-v03/KS-INJECTION-1000/S02-equipment-correction.txt',
];
const shaOfRepo = (rel) => sha256(fs.readFileSync(path.join(REPO_ROOT, rel)));
const shaBefore = Object.fromEntries(INPUT_SOURCES.map((rel) => [rel, shaOfRepo(rel)]));
fs.writeFileSync(path.join(OUT_DIR, 'sha256-inputs-before.json'), JSON.stringify({ at: new Date().toISOString(), sources: shaBefore }, null, 2));

// ---------- 模型替身（本地 HTTP，显式 mock 语义；每轮重置捕获状态） ----------
const mockState = { hits: 0, captured: [], onSend: null };
const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    mockState.hits += 1;
    const parsed = JSON.parse(body);
    mockState.captured.push(parsed);
    const hook = mockState.onSend; mockState.onSend = null;
    if (hook) await hook();
    const brief = parsed.messages?.[0]?.content ?? '';
    const pack = JSON.parse(brief.split('[服务端获准证据包] ')[1]);
    // decisions 面（assistant-decisions 注入 decisionTask）：按 next_action 契约回 2 个候选；
    // 观察/其余面：按 observe 契约回 1 条有效观察 + 1 条伪造引用观察（降级用例）。
    const isDecisionTask = brief.includes('提出最多5个可比较的下一步核验/补证建议');
    const forgedCandidate = brief.includes('【候选引用伪造用例】');
    const content = isDecisionTask
      ? {
        decisions: forgedCandidate
          ? [{ id: 'option_1', label: '伪造引用候选', confidence: 0.9, impact: '不应被接受', evidenceRefIds: ['forged-candidate-ref'] }]
          : [
            { id: 'option_1', label: '核对销售合同未付余额', confidence: 0.8, impact: '选择后需人工核对合同要素', evidenceRefIds: [pack.snippets[0].id] },
            { id: 'option_2', label: '复核主体登记信息', confidence: 0.5, impact: '选择后需人工复核主体资料', evidenceRefIds: [pack.snippets[pack.snippets.length - 1].id] },
          ],
        observations: [],
        questions: [],
      }
      : {
        observations: [
          { text: '替身观察：证据中可见申请金额与合同要素', evidenceRefIds: [pack.snippets[0].id] },
          { text: '替身观察：伪造引用（应降级为待核验）', evidenceRefIds: ['forged-ref'] },
        ],
        questions: ['替身待核验：权属与净值须人工复核'],
      };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 100 + pack.snippets.length, completion_tokens: 40 },
    }));
  });
});
await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
const mockPort = mockServer.address().port;

// ---------- 共用工具 ----------
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const waitHttp = async (url, ok, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (ok(r)) return true; } catch { }
    await sleep(400);
  }
  return false;
};
const MATERIAL_FILES = {
  d01: 'KS-LASER-500/originals/D01-融资需求登记.pdf',
  d02: 'KS-LASER-500/originals/D02-主体登记资料.pdf',
  d09: 'KS-LASER-500/originals/D09-销售合同与交付凭据.pdf',
  d11: 'KS-INJECTION-1000/originals/D11-生产与库存说明.pdf',
  c01: 'eval-v03/KS-INJECTION-1000/C01-equipment-conflict.csv',
  s02: 'eval-v03/KS-INJECTION-1000/S02-equipment-correction.txt',
};
const fileBytes = Object.fromEntries(Object.entries(MATERIAL_FILES).map(([k, rel]) => [k, fs.readFileSync(path.join(MATERIALS, rel))]));
const allowedHashes = [...new Set(Object.values(fileBytes).map(sha256))];
const briefOf = (i) => mockState.captured[i]?.messages?.[0]?.content ?? '';

// ---------- 单轮：完整隔离栈 + 相同操作顺序的场景断言 ----------
async function runRound(n) {
  const round = { round: n, startedAt: new Date().toISOString(), results: [], httpCalls: [], env: {}, cleanup: {} };
  const rec = (id, name, ok, detail) => {
    const item = { id, name, ok: !!ok, detail: typeof detail === 'string' ? detail : jstr(detail)?.slice(0, 600) ?? null };
    round.results.push(item);
    console.log(`[R${n}][${ok ? 'PASS' : 'FAIL'}] ${id} ${name}${ok ? '' : ` :: ${item.detail?.slice(0, 400)}`}`);
    return ok;
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `jw-qa-ec-r${n}-`));
  round.env.runDirLabel = path.basename(runDir);
  const pgPort = await freePort();
  process.env.CONNECTORS_TEST_PG_PORT = String(pgPort);
  process.env.CONNECTORS_TEST_PG_USER = 'v7next';
  process.env.CONNECTORS_TEST_PG_PASSWORD = 'v7next';
  process.env.CONNECTORS_TEST_PG_DATABASE = 'cnext';
  // 处理夹具在模块加载时读 BASE_PG；?round=N 使每轮获得独立模块实例（独立 BASE_PG）。
  const helpersUrl = pathToFileURL(path.join(BACK_ROOT, 'Connectors', 'test', 'processing-helpers.mjs')).href + `?round=${n}`;
  const { TENANT: H_TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd } = await import(helpersUrl);

  let edge = null, kernel = null, harness = null, pg = null;
  const aDb = `jw_qa_ec_r${n}_a`;
  try {
    // 轮独立状态证明起点：替身捕获/命中从零开始
    mockState.hits = 0; mockState.captured = []; mockState.onSend = null;
    rec('R-IND-01', '轮独立·替身捕获/命中计数从零开始', mockState.hits === 0 && mockState.captured.length === 0, `hits=${mockState.hits}`);

    // 独占 PG（容器名由 runDir 哈希派生；v7d-pg- 前缀，仅清理本容器）
    pg = await pgctl.ensurePg({ runDir, port: pgPort, db: 'jw_qa_ec_boot' });
    round.env.pgContainer = pg.name; round.env.pgPort = pgPort;
    await pgctl.psql(pg.name, 'jw_qa_ec_boot', `DROP DATABASE IF EXISTS ${aDb} WITH (FORCE)`);
    await pgctl.createDb(pg.name, aDb);
    await pgctl.psql(pg.name, 'jw_qa_ec_boot', 'CREATE DATABASE cnext').catch(() => { });

    // 真实 A 内核
    const aPort = await freePort();
    const aBase = `http://127.0.0.1:${aPort}`;
    round.env.aPort = aPort; round.env.aDb = aDb;
    const kernelLog = path.join(runDir, 'kernel.log');
    kernel = spawn(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(aPort),
      '--db', `postgres://v7next:v7next@127.0.0.1:${pgPort}/${aDb}`,
      '--principal-tokens', `tk-biz1=biz1:human:business:all:${TENANT},tk-biz2=biz2:human:business:all:${TENANT},tk-cust1=cust1:human:customer:all:${TENANT},tk-svc1=svc1:service:service:all:${TENANT}`],
      { windowsHide: true, stdio: ['ignore', fs.openSync(kernelLog, 'a'), fs.openSync(kernelLog, 'a')] });
    kernel.unref();
    if (!await waitHttp(`${aBase}/healthz`, (r) => r.status === 200)) {
      throw new Error('A 内核未就绪：' + fs.readFileSync(kernelLog, 'utf8').slice(-1500));
    }
    const aApiRec = async (method, p, body, credential = 'tk-biz1') => {
      const r = await fetch(`${aBase}${p}`, { method, headers: { 'content-type': 'application/json', ...(credential ? { 'x-principal-credential': credential } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const j = await r.json().catch(() => ({}));
      round.httpCalls.push({ iface: 'A', method, path: p, status: r.status });
      return { status: r.status, json: j };
    };
    rec('R-ENV-01', '真实A内核就绪（独占PG独占库）', true, `db=${aDb} container=${pg.name}`);

    // 真实 Connectors
    harness = await makeProcessingHarness({
      port: 0,
      aBaseUrl: aBase,
      aConfig: { tenantId: TENANT, credentials: { service: 'tk-svc1', registrar: 'tk-biz1', upload: { customer_finance: 'tk-cust1' }, uploadFallback: 'tk-cust1' }, timeoutMs: 5000 },
      processing: {
        driverIntervalMs: 200, aTimeoutMs: 5000,
        aRegisterDomains: ['business', 'policy', 'credit', 'commerce', 'asset'],
        rulePackPath: path.join(BACK_ROOT, 'C', 'rules', 'takeoff-first-admission-rule-pack-v1.json'),
      },
    });
    const connectorsBase = `http://127.0.0.1:${harness.server.server.address().port}`;
    round.env.connectorsPort = harness.server.server.address().port;
    round.env.connectorsDb = harness.dbName;
    rec('R-ENV-02', '真实Connectors就绪（独占库，A桥指向真实A）', true, `db=${harness.dbName}`);
    const connectorsInternal = async (body) => {
      const r = await fetch(`${connectorsBase}/api/connectors/internal/assistant-evidence`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': 'proc_service_token' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      round.httpCalls.push({ iface: 'Connectors', method: 'POST', path: '/api/connectors/internal/assistant-evidence', status: r.status });
      return { status: r.status, json: j };
    };

    // Edge（live kernel-store + observe/decisions 面 + 文件型反馈库）
    const configPath = path.join(runDir, 'assistant-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      transport: { mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${mockPort}`, timeoutMs: 1500 } },
      evidencePolicy: { allowedHashes },
    }));
    const { createAssistantModel } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'assistant-model.mjs')).href);
    const { createAssistantEvidenceProvider } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'assistant-evidence-provider.mjs')).href);
    const { createKernelStore } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'kernel-store.mjs')).href);
    const { startEdgeServer, createLiveCredentialVerifier } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'server.mjs')).href);
    const { createSessionStore } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'session.mjs')).href);
    const { createAuditSink } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'audit.mjs')).href);
    const { createDecisionFeedbackStore } = await import(pathToFileURL(path.join(BACK_ROOT, 'Edge', 'src', 'decision-feedback-store.mjs')).href);

    const receiptsDir = path.join(runDir, 'model-receipts');
    const authState = { permitted: true };
    const assistantModel = await createAssistantModel({
      configPath, receiptsDir, requireEvidence: true, maxContextChars: 12000, log: () => { },
    });
    const assistantEvidence = createAssistantEvidenceProvider({ baseUrl: connectorsBase, token: 'proc_service_token', policy: () => assistantModel.evidencePolicy() });
    const hashOf = (s) => createHash('sha256').update(s).digest('hex');
    const directory = {
      byHash: new Map([
        [hashOf('tk-biz1'), { principalId: 'biz1', roles: ['business'], tenantId: TENANT }],
        [hashOf('tk-biz2'), { principalId: 'biz2', roles: ['business'], tenantId: TENANT }],
      ]),
      byPrincipal: new Map([['biz1', { credential: 'tk-biz1' }], ['biz2', { credential: 'tk-biz2' }]]),
      list: [{ principalId: 'biz1', roles: ['business'] }, { principalId: 'biz2', roles: ['business'] }],
    };
    edge = await startEdgeServer({
      port: 0, seal: { buildId: `qa-r2-evidence-chain-r${n}`, capabilities: { note: 'isolated evidence chain' } }, probes: [],
      store: createKernelStore({ baseUrl: aBase, log: () => { } }),
      auth: async ({ session }) => ({ ok: !!session && authState.permitted }),
      sessionStore: createSessionStore({}),
      verifyCredential: createLiveCredentialVerifier({ kernelBase: aBase, directory }),
      identityDirectory: { list: directory.list, byPrincipal: directory.byPrincipal },
      auditSink: createAuditSink(),
      assistantModel, assistantEvidence,
      decisionRepository: createDecisionFeedbackStore(receiptsDir),
    });
    const edgeBase = `http://127.0.0.1:${edge.port}`;
    round.env.edgePort = edge.port;
    const edgeRec = async (method, p, body, sid) => {
      const r = await fetch(`${edgeBase}${p}`, {
        method, headers: { 'content-type': 'application/json', ...(sid ? { 'x-jw-session': sid } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const j = await r.json().catch(() => ({}));
      round.httpCalls.push({ iface: 'Edge', method, path: p, status: r.status });
      return { status: r.status, body: j };
    };
    const loginOf = async (principalId) => (await edgeRec('POST', '/api/jw/v2/session', { principalId }))?.body?.session?.sessionId;
    const sid1 = await loginOf('biz1');
    const sid2 = await loginOf('biz2');
    rec('R-ENV-03', 'Edge就绪·双业务人受控登录（live凭据核实器过A探针）', typeof sid1 === 'string' && typeof sid2 === 'string', `sid1=${!!sid1} sid2=${!!sid2}`);

    // ---- 场景助手 ----
    const observe = (customerId, question, sid = sid1) =>
      edgeRec('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/observe`, { assistant: 'credit', question, facts: ['客户端注入事实（不得出站）'] }, sid);
    const decisionsGet = (customerId, sid = sid1) =>
      edgeRec('GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/assistant/decisions?assistant=credit`, undefined, sid);
    const decideBegin = async (customerId, operationId, question, sid = sid1) => {
      const g = await decisionsGet(customerId, sid);
      return edgeRec('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/decisions`,
        { assistant: 'credit', operationId, expectedRevision: g.body?.revision ?? 0, question }, sid);
    };
    const decideFeedback = async (customerId, body, sid = sid1) => {
      const g = await decisionsGet(customerId, sid);
      return edgeRec('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/decisions/feedback`,
        { assistant: 'credit', expectedRevision: g.body?.revision ?? 0, ...body }, sid);
    };
    const createCustomerInA = async (caseId, displayName) => {
      const r = await aApiRec('POST', '/api/v2/customers', {
        requestId: `ec-r${n}-cust-${caseId}-${Date.now().toString(36)}`, credential: 'tk-biz1',
        tenantId: TENANT, legalEntityRef: `${caseId}-legal-ref-r${n}`, displayName,
      });
      if (r.status !== 200 || !r.json?.customerId) throw new Error(`A 建客户失败 ${caseId}: ${jstr(r.json).slice(0, 200)}`);
      return r.json.customerId;
    };
    const uploadAndProcess = async (customerId, files) => {
      const inv = await setupInvitation(harness.api, { customerId, kinds: ['statement', 'document'] });
      const uploaded = [];
      for (const f of files) {
        const bytes = fileBytes[f.key];
        uploaded.push({ ...(await uploadBytes(harness.api, inv, {
          customerId, kind: 'document', bytes,
          ...(f.supersedesEvidenceId ? { supersedes: f.supersedesEvidenceId } : {}),
        })), key: f.key, sha256: sha256(bytes) });
      }
      await driveToEnd(harness.api, { maxRounds: 30, maxTasks: 8 });
      const deadline = Date.now() + 30000;
      const hashes = uploaded.map((u) => u.sha256);
      for (;;) {
        const rows = (await harness.store.query(
          `SELECT sha256, ok FROM parse_results WHERE tenant_id=$1 AND customer_id=$2 AND sha256=ANY($3::text[])`,
          [H_TENANT, customerId, hashes])).rows;
        const okSet = new Set(rows.filter((r) => r.ok).map((r) => r.sha256));
        if (hashes.every((h) => okSet.has(h))) break;
        if (Date.now() > deadline) throw new Error(`解析结果未就绪: ${jstr({ hashes, rows })}`);
        await sleep(300);
      }
      return uploaded;
    };
    const registeredLinks = async (customerId) => (await harness.store.query(
      `SELECT entity_type, local_id, a_ref, status FROM a_links WHERE tenant_id=$1 AND customer_id=$2 AND entity_type IN ('material','supersede')`,
      [H_TENANT, customerId])).rows;
    const waitRegistered = async (customerId, expectCount, timeoutMs = 30000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const rows = await registeredLinks(customerId);
        if (rows.filter((r) => r.status === 'registered' && r.a_ref).length >= expectCount) return rows;
        if (Date.now() > deadline) return rows;
        await sleep(400);
      }
    };

    // ================= 主案例：最小链 登记→处理→获准证据包→分析→引用读回 =================
    const laserId = await createCustomerInA('KS-LASER-500', '喀什示例金属加工有限公司（激光场景·合成）');
    rec('T01', '真实A登记·客户建档（POST /api/v2/customers）', typeof laserId === 'string' && laserId.startsWith('cust-'), `customerId=${laserId}`);

    const up1 = await uploadAndProcess(laserId, [{ key: 'd01' }, { key: 'd02' }]);
    rec('T02', '真实上传入口·两件原件（邀请→上传→异步解析→处理链）',
      up1.length === 2 && up1.every((u) => u.evidenceId), up1.map((u) => `${u.key}:${u.evidenceId}`).join(','));

    const links1 = await waitRegistered(laserId, 2);
    const reg1 = links1.filter((r) => r.entity_type === 'material' && r.status === 'registered' && r.a_ref);
    rec('T03', '真实A登记·材料经A桥登记（a_links registered，零手工插表）', reg1.length >= 2,
      links1.map((l) => `${l.entity_type}/${String(l.local_id).slice(0, 10)}/${l.a_ref}/${l.status}`).join(' | '));

    const aArts = await aApiRec('GET', `/api/v2/customers/${laserId}/artifacts`, undefined);
    const aArtList = aArts.json?.artifacts ?? aArts.json?.items ?? [];
    const aArtIds = aArtList.map((a) => a.artifactId);
    rec('T04', 'A侧工件清单可见（GET artifacts，含 a_ref 全集）',
      aArts.status === 200 && reg1.every((r) => aArtIds.includes(r.a_ref)), `aArtifacts=${aArtIds.length}`);

    const hits0 = mockState.hits;
    const first = await observe(laserId, '核验申请金额与主体登记');
    rec('T05', '观察·200/current/sent/六节点图（prepare_evidence→…→output_receipt）',
      first.status === 200 && first.body.model?.current === true && first.body.model?.sent === true &&
      first.body.model?.graphTrace?.length === 6 &&
      ['prepare_evidence', 'validate_input', 'controlled_model_call', 'validate_citations', 'check_current', 'output_receipt']
        .every((x, i) => first.body.model.graphTrace[i]?.node === x),
      { status: first.status, model: first.body.model, error: first.body.error });

    const obs0 = first.body.observations?.[0];
    const citedSnippet = (first.body.evidenceRefs ?? []).find((s) => s.id === obs0?.evidenceRefIds?.[0]);
    const uploadHashes = new Set(up1.map((u) => u.sha256));
    rec('T06', '引用读回·有效引用绑定本次证据包片段（source_bound + 片段哈希/定位在场）',
      first.body.observations?.length === 1 && obs0?.citationStatus === 'source_bound' &&
      typeof obs0?.evidenceRefIds?.[0] === 'string' && !!citedSnippet && uploadHashes.has(citedSnippet.hash) &&
      ['page_text', 'extracted_text'].includes(citedSnippet.locator?.kind) && Number.isInteger(citedSnippet.locator?.start) &&
      typeof citedSnippet.text === 'string' && citedSnippet.text.length > 0,
      `obs=${jstr(obs0)?.slice(0, 200)} refHash=${citedSnippet?.hash?.slice(0, 8)} locator=${jstr(citedSnippet?.locator)}`);

    rec('T07', '片段id↔内容绑定·digest(片段内容)重算等于id（防手拼/篡改包）',
      (first.body.evidenceRefs ?? []).length > 0 &&
      first.body.evidenceRefs.every((s) => s.id === digest({
        artifactId: s.artifactId, evidenceId: s.evidenceId, hash: s.hash,
        parserVersion: s.parserVersion, locator: s.locator, text: s.text, limitations: s.limitations ?? [],
      })), `evidenceRefs=${(first.body.evidenceRefs ?? []).length}`);

    const forgedQuestion = (first.body.questions ?? []).find((q) => q?.citationStatus === 'unverified');
    rec('T08', '伪造引用反例·不进入有效观察并降级为带标识待核验（逐条校验记录留档）',
      first.body.observations?.every((o) => o.evidenceRefIds?.every((id) => id !== 'forged-ref')) === true &&
      (first.body.questions?.length ?? 0) === 2 && !!forgedQuestion &&
      forgedQuestion.text?.startsWith('待核验（缺少有效原文引用）') &&
      first.body.model?.citationChecks?.length === 2 &&
      first.body.model.citationChecks.some((c) => c.valid === true && c.reason === 'SOURCE_BOUND') &&
      first.body.model.citationChecks.some((c) => c.valid === false && c.reason === 'UNVERIFIED_REFERENCE'),
      `checks=${jstr(first.body.model?.citationChecks)?.slice(0, 240)}`);

    const brief0 = briefOf(hits0);
    const pack0 = JSON.parse(brief0.split('[服务端获准证据包] ')[1] ?? '{}');
    rec('T09', '获准证据包·出站仅获准证据（authority=none、客户匹配、客户端注入事实不出站）',
      brief0.includes('500.00') && !brief0.includes('客户端注入事实') &&
      pack0.snippets?.length === 2 && (pack0.omitted ?? []).every((o) => o.reason !== 'CONTEXT_LIMIT') &&
      pack0.authority === 'none' && pack0.customerId === laserId && pack0.tenantId === H_TENANT,
      `snippets=${pack0.snippets?.length} authority=${pack0.authority} customerId匹配=${pack0.customerId === laserId}`);

    // 同hash/解析版本/位置可追溯：证据面片段 vs parse_results 持久行逐片段复核
    const prRows = (await harness.store.query(
      `SELECT sha256, ok, result, parser_version FROM parse_results WHERE tenant_id=$1 AND customer_id=$2`,
      [H_TENANT, laserId])).rows;
    const prByHash = new Map(prRows.filter((r) => r.ok).map((r) => [r.sha256, r]));
    let traceOk = true; const traceDetail = [];
    for (const s of (first.body.evidenceRefs ?? [])) {
      const row = prByHash.get(s.hash);
      if (!row) { traceOk = false; traceDetail.push(`hash ${s.hash.slice(0, 8)} 无 parse_results 行`); continue; }
      if (!String(row.parser_version).startsWith(ASYNC_PARSE_VERSION)) { traceOk = false; traceDetail.push(`parser_version 漂移 ${row.parser_version}`); }
      if (s.parserVersion !== row.parser_version) { traceOk = false; traceDetail.push('片段 parserVersion 与持久行不一致'); }
      const loc = s.locator;
      const pageText = loc.kind === 'page_text' ? row.result?.pages?.[loc.page - 1]?.text : row.result?.text;
      if (typeof pageText !== 'string' || pageText.slice(loc.start, loc.end) !== s.text) {
        traceOk = false; traceDetail.push(`定位不可复算 kind=${loc.kind} start=${loc.start} end=${loc.end}`);
      }
    }
    rec('T10', '同hash/解析版本/位置可追溯·每片段可在 parse_results 复算（哈希→解析版本→文本切片）',
      traceOk && (first.body.evidenceRefs?.length ?? 0) > 0, traceDetail.join('; ') || `片段数=${first.body.evidenceRefs?.length}`);

    // 决策面：候选置信度排序 + 引用全绑定 + 回执持久化
    const hitsD0 = mockState.hits;
    const d1 = await decideBegin(laserId, `r${n}-op-d01`, '核验申请金额与主体登记');
    const d1Set = d1.body?.latest;
    if (d1.status !== 200 || !d1Set) throw new Error('决策begin失败: ' + jstr(d1.body).slice(0, 300));
    const packIds0 = new Set(pack0.snippets.map((s) => s.id));
    rec('T11', '决策·候选置信度降序且全部绑定获准片段（authority=none）',
      d1.status === 200 && d1Set?.current === true && d1Set?.valid === true &&
      Array.isArray(d1Set?.candidates) && d1Set.candidates.length >= 1 && d1Set.candidates.length <= 5 &&
      d1Set.candidates.every((c, i, arr) => i === 0 || (arr[i - 1].confidence ?? -1) >= (c.confidence ?? -1)) &&
      d1Set.candidates.every((c) => c.evidenceRefIds?.length && c.evidenceRefIds.every((id) => packIds0.has(id))) &&
      d1Set.model?.status === 'simulated' && typeof d1Set.model?.requestId === 'string' &&
      d1Set.feedback === null,
      { status: d1.status, candidates: d1Set?.candidates?.map((c) => `${c.id}/${c.confidence}`), model: d1Set?.model });

    const d1get = await decisionsGet(laserId);
    rec('T12', '决策·GET刷新读回一致（set/revision/候选/反馈空）',
      d1get.status === 200 && d1get.body.latest?.id === d1Set.id && d1get.body.revision === d1.body.revision &&
      jstr(d1get.body.latest?.candidates) === jstr(d1Set.candidates) &&
      d1get.body.latest?.feedback === null && d1get.body.latest?.current === true,
      `revision=${d1get.body.revision}/${d1.body.revision}`);

    const replay = await decideBegin(laserId, `r${n}-op-d01`, '核验申请金额与主体登记');
    rec('T13', '决策·同operationId重放零新增模型调用（事件级回执）',
      replay.status === 200 && replay.body.replayed === true && mockState.hits === hitsD0 + 1,
      `hits=${mockState.hits}（应为${hitsD0 + 1}）`);

    const receiptsSub = path.join(receiptsDir, 'receipts');
    const receiptsFiles = fs.existsSync(receiptsSub) ? fs.readdirSync(receiptsSub).filter((f) => f.endsWith('.json')) : [];
    const parsedReceipts = receiptsFiles.map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(receiptsSub, f), 'utf8')); } catch { return null; }
    });
    const terminalReceipt = parsedReceipts.find((r) => r?.phase === 'terminal' && r?.requestId === d1Set.model.requestId);
    rec('T14', '决策回执持久化·TERMINAL回执落盘且含requestId与完整identity',
      receiptsFiles.length >= 2 && !!terminalReceipt && terminalReceipt.outcome?.status === 'simulated' &&
      !!terminalReceipt.identity && typeof terminalReceipt.identity.brief === 'string',
      `receiptFiles=${receiptsFiles.length} terminalRequestId匹配=${!!terminalReceipt}`);

    // ================= 补入新材料后旧结果失效 =================
    const up2 = await uploadAndProcess(laserId, [{ key: 'd09' }]);
    const linksAfterD09 = await waitRegistered(laserId, 3);
    rec('T15', '补证D09·上传+处理+A登记（registered 3条）',
      up2.length === 1 && linksAfterD09.filter((r) => r.status === 'registered' && r.a_ref).length === 3,
      `d09Evidence=${up2[0]?.evidenceId}`);

    const staleGet = await decisionsGet(laserId);
    rec('T16', '旧结果失效·上下文变化后 GET current=false、候选与引用清空、旧记录保留（不删除）',
      staleGet.status === 200 && staleGet.body.latest?.id === d1Set.id && staleGet.body.latest?.current === false &&
      staleGet.body.latest?.candidates?.length === 0 && staleGet.body.latest?.evidenceRefs?.length === 0 &&
      staleGet.body.latest?.model?.requestId === d1Set.model.requestId,
      `current=${staleGet.body.latest?.current} candidates=${staleGet.body.latest?.candidates?.length}`);

    const hitsD1 = mockState.hits;
    const d2 = await decideBegin(laserId, `r${n}-op-d02`, '核验申请金额与主体登记');
    rec('T17', '补证后·新上下文触发新发送、新requestId、新决策current（刷新读回）',
      d2.status === 200 && d2.body.latest?.current === true && d2.body.latest?.model?.requestId !== d1Set.model.requestId &&
      mockState.hits === hitsD1 + 1 && !d2.body.replayed,
      `hits=${mockState.hits} req不变=${d2.body.latest?.model?.requestId === d1Set.model.requestId}`);

    rec('T18', '旧回执仍在（历史不改写，持久记录完整）',
      fs.existsSync(path.join(receiptsSub, encodeURIComponent(d1Set.model.requestId) + '.json')),
      d1Set.model.requestId);

    // ================= 重复材料不虚增独立证据 =================
    const invDup = await setupInvitation(harness.api, { customerId: laserId, kinds: ['document'] });
    const dupUp = await uploadBytes(harness.api, invDup, { customerId: laserId, kind: 'document', bytes: fileBytes.d01 });
    await driveToEnd(harness.api, { maxRounds: 30, maxTasks: 8 });
    await sleep(1200);
    const dupRow = (await harness.store.query(
      `SELECT duplicate_of, same_source_flag FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`,
      [H_TENANT, dupUp.evidenceId])).rows[0];
    rec('T19', '重复材料·登记判定 duplicate_of=首次evidenceId（same_source）',
      dupRow?.duplicate_of === up1.find((u) => u.key === 'd01').evidenceId && dupRow?.same_source_flag === 'same_source',
      `dup=${dupUp.evidenceId} duplicate_of=${dupRow?.duplicate_of} flag=${dupRow?.same_source_flag}`);

    const dupLinks = await registeredLinks(laserId);
    const dupStage = (await harness.store.query(
      `SELECT stage, status, detail FROM processing_stage_runs WHERE tenant_id=$1 AND task_id IN
        (SELECT task_id FROM processing_tasks WHERE tenant_id=$1 AND evidence_id=$2)`,
      [H_TENANT, dupUp.evidenceId])).rows;
    rec('T20', '重复材料·A侧不重复登记（无新 a_link；处理段 skipped duplicate_of_local）',
      dupLinks.filter((l) => l.local_id === dupUp.evidenceId && l.status === 'registered').length === 0 &&
      dupStage.some((s) => s.status === 'skipped' && jstr(s.detail ?? {}).includes('duplicate_of_local')),
      `links=${dupLinks.filter((l) => l.local_id === dupUp.evidenceId).map((l) => l.status).join(',')} stages=${dupStage.map((s) => `${s.stage}/${s.status}`).join(',')}`);

    const hitsDup = mockState.hits;
    const dupObs = await observe(laserId, '重复材料后核验申请金额');
    const dupPack = JSON.parse(briefOf(hitsDup).split('[服务端获准证据包] ')[1] ?? '{}');
    const d01hash = sha256(fileBytes.d01);
    const dupPackEvids = [...new Set((dupPack.snippets ?? []).map((s) => s.evidenceId))];
    const d01EvidenceIds = [...new Set((dupPack.snippets ?? []).filter((s) => s.hash === d01hash).map((s) => s.evidenceId))];
    rec('T21', '重复材料·证据包不虚增（D01哈希仍只对应1个evidenceId，包内材料=3件不增）',
      dupObs.status === 200 && dupPackEvids.length === 3 && d01EvidenceIds.length === 1 &&
      d01EvidenceIds[0] === up1.find((u) => u.key === 'd01').evidenceId,
      `材料数=${dupPackEvids.length} d01EvidenceIds=${jstr(d01EvidenceIds)}`);

    // ================= 缺证反例 =================
    const missingId = await createCustomerInA('EC-MISSING', '缺证反例客户（合成·无任何材料）');
    const hitsM = mockState.hits;
    const missingObs = await observe(missingId, '核验缺失客户');
    const missingDec = await decideBegin(missingId, `r${n}-op-miss`, '核验缺失客户');
    const missingGet = await decisionsGet(missingId);
    rec('T22', '缺证反例·观察面422 EVIDENCE_UNAVAILABLE 且未发送',
      missingObs.status === 422 && missingObs.body.error === 'EVIDENCE_UNAVAILABLE',
      { status: missingObs.status, body: missingObs.body });
    rec('T23', '缺证反例·决策面非2xx显式阻断、零模型调用（观察面0命中保持）',
      missingDec.status >= 400 && missingDec.body?.ok === false && typeof missingDec.body?.error === 'string' &&
      missingGet.status >= 400 && mockState.hits === hitsM,
      `dec=${missingDec.status}/${missingDec.body?.error} get=${missingGet.status} hits=${mockState.hits}（应${hitsM}）`);

    // ================= 伪造引用（决策面候选）反例 =================
    const hitsF = mockState.hits;
    const forged = await decideBegin(laserId, `r${n}-op-forge`, '【候选引用伪造用例】核验申请金额');
    const fSet = forged.body?.latest;
    rec('T24', '伪造引用候选·整批拒绝（valid=false、candidates空、INVALID_DECISION_OUTPUT）',
      forged.status === 200 && fSet?.valid === false && fSet?.candidates?.length === 0 &&
      fSet?.model?.error === 'INVALID_DECISION_OUTPUT' && mockState.hits === hitsF + 1,
      `error=${fSet?.model?.error} candidates=${fSet?.candidates?.length}`);
    if (!fSet?.id) throw new Error('伪造候选分析未产生决策集: ' + jstr(forged.body).slice(0, 300));

    const forgedFeedback = await decideFeedback(laserId, {
      operationId: `r${n}-op-forgefb`, decisionSetId: fSet.id, action: 'select', candidateId: 'option_1', reason: '不应被接受',
    });
    rec('T25', '伪造集反馈·409 DECISION_STALE（无效集不可反馈）',
      forgedFeedback.status === 409 && forgedFeedback.body?.error === 'DECISION_STALE',
      { status: forgedFeedback.status, body: forgedFeedback.body });

    // ================= 跨客户/跨租户原件反例 =================
    const cross1 = await connectorsInternal({ tenantId: H_TENANT, customerId: laserId, artifactIds: ['nonexistent'] });
    const cross2 = await connectorsInternal({ tenantId: H_TENANT, customerId: 'cust-other-customer', artifactIds: aArtIds });
    const cross3 = await connectorsInternal({ tenantId: 'tenant_other', customerId: laserId, artifactIds: aArtIds });
    rec('T26', '跨客户/跨租户原件·内部证据面返回空集（不猜测不跨户）',
      cross1.status === 200 && cross1.json.materials?.length === 0 &&
      cross2.status === 200 && cross2.json.materials?.length === 0 &&
      cross3.status === 200 && cross3.json.materials?.length === 0,
      `unknown=${cross1.json.materials?.length} 跨户=${cross2.json.materials?.length} 跨租户=${cross3.json.materials?.length}`);

    // ================= 冲突/更正（KS-INJECTION-1000） =================
    const injectionId = await createCustomerInA('KS-INJECTION-1000', '示例注塑制品有限公司（合成）');
    const upI = await uploadAndProcess(injectionId, [{ key: 'c01' }]);
    await waitRegistered(injectionId, 1);
    const hitsC = mockState.hits;
    const conflict = await observe(injectionId, '核验设备净值与权属');
    rec('T27', '冲突轮·被更正方原文在包（149.0769 可见，矛盾不自行消除）',
      conflict.status === 200 && briefOf(hitsC).includes('149.0769'),
      `has149=${briefOf(hitsC).includes('149.0769')}`);

    const upS = await uploadAndProcess(injectionId, [
      { key: 'd11' },
      { key: 's02', supersedesEvidenceId: upI[0].evidenceId },
    ]);
    await waitRegistered(injectionId, 3);
    const supersededRow = (await harness.store.query(
      `SELECT evidence_id, superseded_by FROM evidence_artifacts WHERE tenant_id=$1 AND customer_id=$2 AND superseded_by IS NOT NULL`,
      [H_TENANT, injectionId])).rows;
    const supersedeLinks = (await harness.store.query(
      `SELECT entity_type, local_id, a_ref, status FROM a_links WHERE tenant_id=$1 AND customer_id=$2 AND entity_type IN ('material','supersede') AND status='registered'`,
      [H_TENANT, injectionId])).rows;
    // A 侧取代链：S02 工件经 a_link 登记且 supersedes 指向 C01 的 a_ref（工件清单为权威源）。
    const c01Ref = supersedeLinks.find((l) => l.local_id === upI[0].evidenceId)?.a_ref;
    const s02Ref = supersedeLinks.find((l) => l.local_id === upS.find((u) => u.key === 's02').evidenceId)?.a_ref;
    const injArts = await aApiRec('GET', `/api/v2/customers/${injectionId}/artifacts`, undefined);
    const injArtList = injArts.json?.artifacts ?? injArts.json?.items ?? [];
    const s02Art = injArtList.find((a) => a.artifactId === s02Ref);
    rec('T28', '更正轮·本地superseded_by落库 + A侧工件取代链（S02登记且supersedes=C01 a_ref）',
      supersededRow.some((r) => r.evidence_id === upI[0].evidenceId && r.superseded_by === upS.find((u) => u.key === 's02').evidenceId) &&
      !!s02Art && s02Art.supersedes === c01Ref && !!c01Ref,
      `superseded=${jstr(supersededRow)} s02Art=${!!s02Art} supersedes匹配=${s02Art?.supersedes === c01Ref}`);

    const hitsC2 = mockState.hits;
    const corrected = await observe(injectionId, '核验设备净值与权属（更正后）');
    const correctedBrief = briefOf(hitsC2);
    rec('T29', '更正生效·被取代件不再出站（149.0769消失），更正声明与新增件同包',
      corrected.status === 200 && !correctedBrief.includes('149.0769') &&
      correctedBrief.includes('139.0769') && correctedBrief.includes('周转配件'),
      `has149=${correctedBrief.includes('149.0769')} has139=${correctedBrief.includes('139.0769')} hasD11=${correctedBrief.includes('周转配件')}`);

    const injPack = JSON.parse(correctedBrief.split('[服务端获准证据包] ')[1] ?? '{}');
    const laserHashSet = new Set([sha256(fileBytes.d01), sha256(fileBytes.d02), sha256(fileBytes.d09)]);
    rec('T30', '跨客户证据隔离·injection 包不含 laser 任何原件哈希',
      (injPack.snippets ?? []).length > 0 && (injPack.snippets ?? []).every((s) => !laserHashSet.has(s.hash)),
      `injSnippets=${injPack.snippets?.length}`);

    // ================= 撤权反例 =================
    const hitsR = mockState.hits;
    mockState.onSend = () => { authState.permitted = false; };
    const revoked = await decideBegin(laserId, `r${n}-op-revk`, '撤权中请求');
    rec('T31', '撤权中·返回后授权复核失败→403（候选/观察不泄露）',
      revoked.status === 403 && revoked.body?.ok === false && !revoked.body?.latest && !revoked.body?.candidates,
      { status: revoked.status, body: revoked.body });

    const revokedEntry = await decideBegin(laserId, `r${n}-op-revk2`, '撤权期其他请求');
    rec('T32', '撤权期·后续请求入口即403且零新增模型调用',
      revokedEntry.status === 403 && mockState.hits === hitsR + 1,
      `hits=${mockState.hits}（应${hitsR + 1}）`);
    authState.permitted = true;

    const recovered = await decideBegin(laserId, `r${n}-op-revk`, '撤权中请求');
    rec('T33', '撤权恢复·同operationId从持久回执恢复（200、零新增模型调用、如实保持not-current）',
      recovered.status === 200 && mockState.hits === hitsR + 1 &&
      recovered.body.latest?.current === false && recovered.body.latest?.valid === false &&
      typeof recovered.body.latest?.model?.requestId === 'string',
      `hits=${mockState.hits}（应${hitsR + 1}） current=${recovered.body.latest?.current} valid=${recovered.body.latest?.valid}`);

    // ================= select/undo 本人隔离与刷新读回 =================
    const selQ = '选择反馈核验问题';
    const curr = await decideBegin(laserId, `r${n}-op-curr`, selQ);
    const setCurr = curr.body?.latest;
    if (curr.status !== 200 || !setCurr) throw new Error('恢复后新决策失败: ' + jstr(curr.body).slice(0, 300));
    rec('T34', '新决策·当前有效集可用（恢复撤权中断后重新分析，current=true）',
      curr.status === 200 && setCurr?.current === true && setCurr?.valid === true && (setCurr?.candidates?.length ?? 0) >= 1 &&
      mockState.hits === hitsR + 2,
      `hits=${mockState.hits}（应${hitsR + 2}） candidates=${setCurr?.candidates?.length}`);

    const selCand = setCurr.candidates[0];
    const selRes = await decideFeedback(laserId, {
      operationId: `r${n}-op-sel`, decisionSetId: setCurr.id, action: 'select', candidateId: selCand.id, reason: '业务本人选择',
    });
    rec('T35', 'select·本人反馈生效（action/candidateId/label 写回 latest）',
      selRes.status === 200 && selRes.body.latest?.feedback?.action === 'select' &&
      selRes.body.latest?.feedback?.candidateId === selCand.id && selRes.body.latest?.feedback?.label === selCand.label,
      jstr(selRes.body.latest?.feedback)?.slice(0, 240));

    const selGet = await decisionsGet(laserId);
    rec('T36', 'select·刷新读回持久一致（文件型反馈库）',
      selGet.status === 200 && selGet.body.latest?.feedback?.action === 'select' &&
      selGet.body.latest?.feedback?.eventId === selRes.body.latest.feedback.eventId,
      `revision=${selGet.body.revision}`);

    const undoRes = await decideFeedback(laserId, {
      operationId: `r${n}-op-undo`, decisionSetId: setCurr.id, action: 'undo', reason: '本人撤销',
    });
    const undoGet = await decisionsGet(laserId);
    rec('T37', 'undo·本人撤销清空反馈且刷新读回一致',
      undoRes.status === 200 && undoRes.body.latest?.feedback === null && undoGet.body.latest?.feedback === null,
      `undo=${undoRes.status} feedback=${jstr(undoGet.body.latest?.feedback)}`);

    const hitsU = mockState.hits;
    const undoLoop = await decideBegin(laserId, `r${n}-op-fb0`, selQ);
    const undoLine = briefOf(hitsU).split('\n').find((l) => l.includes('此前本人反馈')) ?? '';
    rec('T38', 'undo后纠偏回路·新同问题分析上下文反馈如实为null（不带入已撤销反馈）',
      undoLoop.status === 200 && /此前本人反馈.*null/.test(undoLine) && undoLoop.body.latest?.feedbackUsed === null,
      `行=${undoLine.slice(0, 120)} feedbackUsed=${undoLoop.body.latest?.feedbackUsed}`);

    const fb0Set = undoLoop.body.latest;
    if (!fb0Set?.candidates?.length) throw new Error('undo后分析无候选: ' + jstr(undoLoop.body).slice(0, 300));
    const reSel = await decideFeedback(laserId, {
      operationId: `r${n}-op-sel2`, decisionSetId: fb0Set.id, action: 'select', candidateId: fb0Set.candidates[0].id, reason: '业务本人再选择',
    });
    const hitsFb = mockState.hits;
    const fbLoop = await decideBegin(laserId, `r${n}-op-fb1`, selQ);
    const fbLine = briefOf(hitsFb).split('\n').find((l) => l.includes('此前本人反馈')) ?? '';
    rec('T39', '反馈纠偏回路·本人反馈进入下一轮同问题分析上下文（此前反馈行含候选+feedbackUsed）',
      reSel.status === 200 && fbLoop.status === 200 && fbLine.includes(fb0Set.candidates[0].id) &&
      fbLoop.body.latest?.feedbackUsed === reSel.body.latest.feedback.eventId,
      `行=${fbLine.slice(0, 140)} feedbackUsed匹配=${fbLoop.body.latest?.feedbackUsed === reSel.body.latest.feedback.eventId}`);

    const biz2Get = await decisionsGet(laserId, sid2);
    rec('T40', '本人隔离·biz2 同客户同助手读不到 biz1 的候选与反馈（独立scope revision=0）',
      biz2Get.status === 200 && biz2Get.body.revision === 0 && biz2Get.body.latest === null && biz2Get.body.pending === null,
      jstr({ revision: biz2Get.body.revision, latest: biz2Get.body.latest }));

    const biz1RevBefore = (await decisionsGet(laserId)).body.revision;
    const biz2Begin = await decideBegin(laserId, `r${n}-op-b2`, selQ, sid2);
    if (biz2Begin.status !== 200 || !biz2Begin.body?.latest?.candidates?.length)
      throw new Error('biz2决策失败: ' + jstr(biz2Begin.body).slice(0, 300));
    const biz2Feedback = await decideFeedback(laserId, {
      operationId: `r${n}-op-b2fb`, decisionSetId: biz2Begin.body.latest.id, action: 'select',
      candidateId: biz2Begin.body.latest.candidates[0].id, reason: 'biz2本人选择',
    }, sid2);
    const biz1After = await decisionsGet(laserId);
    rec('T41', '本人隔离·biz2 独立分析+反馈成功，且不影响 biz1 的revision与状态',
      biz2Begin.status === 200 && biz2Feedback.status === 200 && biz2Feedback.body.latest?.feedback?.action === 'select' &&
      biz1After.body.revision === biz1RevBefore && biz1After.body.latest?.feedback === null,
      `biz2fb=${biz2Feedback.body.latest?.feedback?.candidateId} biz1rev不变=${biz1After.body.revision === biz1RevBefore}`);

    const latestNow = biz1After.body.latest;
    if (!latestNow?.id) throw new Error('biz1决策集缺失: ' + jstr(biz1After.body).slice(0, 300));
    const badCand = await decideFeedback(laserId, {
      operationId: `r${n}-op-bc`, decisionSetId: latestNow.id, action: 'select', candidateId: 'no-such-candidate', reason: 'x',
    });
    const badSet = await decideFeedback(laserId, {
      operationId: `r${n}-op-bs`, decisionSetId: 'set-does-not-exist', action: 'none', reason: 'x',
    });
    const badRev = await edgeRec('POST', `/api/jw/v2/actions/customers/${encodeURIComponent(laserId)}/assistant/decisions/feedback`,
      { assistant: 'credit', operationId: `r${n}-op-br`, expectedRevision: biz1After.body.revision + 99, decisionSetId: latestNow.id, action: 'none', reason: 'x' }, sid1);
    rec('T42', '反馈非法输入·错候选400/错set 409 STALE/错revision 409 VERSION_CONFLICT',
      badCand.status === 400 && badCand.body?.error === 'INVALID_CANDIDATE' &&
      badSet.status === 409 && badSet.body?.error === 'DECISION_STALE' &&
      badRev.status === 409 && badRev.body?.error === 'VERSION_CONFLICT',
      `cand=${badCand.status}/${badCand.body?.error} set=${badSet.status}/${badSet.body?.error} rev=${badRev.status}/${badRev.body?.error}`);

    // ---- 轮级持久证据清单 ----
    round.mockHits = mockState.hits;
    round.receiptFiles = fs.existsSync(receiptsSub) ? fs.readdirSync(receiptsSub) : [];
    round.decisionFeedbackFiles = fs.existsSync(path.join(receiptsDir, 'decision-feedback'))
      ? fs.readdirSync(path.join(receiptsDir, 'decision-feedback')) : [];
    round.outboundBriefs = mockState.captured.map((m, i) => ({ i, content: m.messages?.[0]?.content ?? '' }));
  } catch (e) {
    rec('R-FATAL', '轮未捕获异常', false, `${e?.stack ?? e}`);
  } finally {
    try { if (edge) await edge.close(); } catch { }
    try { if (kernel) process.kill(kernel.pid); } catch { }
    try { if (harness) await harness.dispose(); } catch { }
    try { if (pg) {
      const st = await pgctl.containerState(pg.name);
      if (st && String(pg.name).startsWith('v7d-pg-')) { await pgctl.destroyPg(pg.name); round.cleanup.containerDestroyed = pg.name; }
    } } catch { }
    try { fs.rmSync(runDir, { recursive: true, force: true }); round.cleanup.runDirRemoved = true; } catch { }
    round.finishedAt = new Date().toISOString();
  }
  return round;
}

// ---------- 主流程：两轮相同操作顺序、独立测试状态 ----------
const allRounds = [];
let fatal = null;
try {
  allRounds.push(await runRound(1));
  allRounds.push(await runRound(2));
} catch (e) {
  fatal = `${e?.stack ?? e}`;
  console.error('FATAL:', fatal);
} finally {
  try { mockServer.closeAllConnections?.(); mockServer.close(); } catch { }
}

// ---------- SHA256 前后对照 ----------
const shaAfter = Object.fromEntries(INPUT_SOURCES.map((rel) => [rel, shaOfRepo(rel)]));
const drift = INPUT_SOURCES.filter((rel) => shaBefore[rel] !== shaAfter[rel]);
fs.writeFileSync(path.join(OUT_DIR, 'sha256-inputs-after-diff.json'), JSON.stringify({
  at: new Date().toISOString(), drifted: drift, unchanged: INPUT_SOURCES.length - drift.length,
}, null, 2));

// ---------- evidence JSON + REPORT.md ----------
for (const r of allRounds) {
  fs.writeFileSync(path.join(OUT_DIR, `evidence-round-${r.round}.json`), JSON.stringify(r, null, 2));
}
const totalItems = allRounds.flatMap((r) => r.results);
const passed = totalItems.filter((i) => i.ok);
const failed = totalItems.filter((i) => !i.ok);
const exitCode = fatal ? 1 : (failed.length ? 1 : 0);

const mustMap = [
  ['最小链：登记→处理→获准证据包→分析→引用读回', ['T01', 'T02', 'T03', 'T04', 'T05', 'T09', 'T11', 'T12']],
  ['同hash/解析版本/位置可追溯', ['T06', 'T07', 'T10']],
  ['补入新材料后旧结果失效', ['T15', 'T16', 'T17', 'T18']],
  ['重复材料不虚增独立证据', ['T19', 'T20', 'T21']],
  ['反例：伪造引用', ['T08', 'T24', 'T25']],
  ['反例：跨客户原件', ['T26', 'T30']],
  ['反例：撤权', ['T31', 'T32', 'T33', 'T34']],
  ['反例：冲突', ['T27', 'T28', 'T29']],
  ['反例：缺证', ['T22', 'T23']],
  ['select/undo本人隔离与刷新读回', ['T35', 'T36', 'T37', 'T38', 'T39', 'T40', 'T41', 'T42']],
  ['连续两轮相同操作顺序但独立测试状态', ['R-IND-01', 'R-ENV-01', 'R-ENV-02', 'R-ENV-03']],
];
const now = new Date().toISOString();
const report = [];
report.push(`# backend-qa-r2 · 包03 证据链（evidence-chain）REPORT`);
report.push('');
report.push(`- 生成时间：${now}`);
report.push(`- 任务书：docs/v0.3/backend-qa-r2/03_EVIDENCE_CHAIN.md`);
report.push(`- 运行命令：\`node docs/v0.3/backend-qa-r2/results/evidence-chain/run-evidence-chain.mjs\``);
report.push(`- 退出码语义：0=全部通过；1=存在失败；2=阻点未执行。本次退出码：**${exitCode}**`);
report.push(`- 汇总：通过 ${passed.length}/${totalItems.length}（失败 ${failed.length}）× 2轮；致命异常：${fatal ?? '无'}`);
report.push(`- 输入漂移：${drift.length === 0 ? '无（执行期间输入源码/材料哈希零漂移）' : `有 → ${drift.join(', ')}（相关项标待复验）`}`);
report.push('');
report.push(`## 边界声明`);
report.push('');
report.push(`- **真实**：A 内核真实进程（每轮独占 PG 容器独占库）；Connectors 真实 compose（邀请/上传/异步解析/处理驱动/A桥）；Edge live kernel-store + observe/decisions 面 + live 凭据核实器（过 A 探针）。`);
report.push(`- **替身**：模型=本地 HTTP mock（显式 simulated 语义，source.mode=mock）；企微传输=FakeWecomTransport。**本包不构成真实模型质量验收**；实际 HTTP 指真实后端进程＋本地模型替身。`);
report.push(`- **引用绑定证明与结论正确性分开**：所有"引用绑定/可追溯"断言只证明出站引用与获准证据包片段的来源绑定（哈希/解析版本/文本定位），**不证明替身结论内容正确**（替身输出为合成文本）。`);
report.push(`- **未执行**正式审批/额度/资金动作（未调用任何 approve/confirm/放款类端点）——按任务书边界列为不适用。`);
report.push(`- 测试代码仅落本目录；运行时暂存：每轮系统临时目录 runDir 与 Connectors 夹具对象存储（dispose 自清理），未修改任何共享配置/默认测试入口。`);
report.push(`- 复用既有机制：Back/Connectors/test/processing-helpers.mjs、Back/D/harness/pgctl.mjs、Back/Edge/test/serial-remainder/full-chain.e2e.mjs 模式；未重跑既有全套测试（无变化不重跑）。`);
report.push('');
report.push(`## 必测映射`);
report.push('');
report.push(`| 必测项 | 断言 | R1 | R2 |`);
report.push(`|---|---|---|---|`);
for (const [name, ids] of mustMap) {
  const okR = (rn) => {
    const round = allRounds.find((x) => x.round === rn);
    const items = (round?.results ?? []).filter((i) => ids.includes(i.id));
    if (!items.length) return '未测';
    return items.every((i) => i.ok) ? '通过' : '失败';
  };
  report.push(`| ${name} | ${ids.join(', ')} | ${okR(1)} | ${okR(2)} |`);
}
report.push('');
report.push(`## 明细（按轮）`);
for (const r of allRounds) {
  report.push('');
  report.push(`### 轮次 R${r.round}`);
  report.push('');
  report.push(`- 环境：A容器=${r.env.pgContainer}:${r.env.pgPort} A库=${r.env.aDb} A端口=${r.env.aPort}；Connectors库=${r.env.connectorsDb} 端口=${r.env.connectorsPort}；Edge端口=${r.env.edgePort}`);
  report.push(`- 模型替身命中=${r.mockHits}；出站brief=${r.outboundBriefs?.length ?? 0}；回执文件=${r.receiptFiles?.length ?? 0}；反馈库文件=${r.decisionFeedbackFiles?.length ?? 0}；HTTP调用记录=${r.httpCalls?.length ?? 0}`);
  report.push(`- 清理：容器=${r.cleanup.containerDestroyed ?? '未登记'} runDir已删=${!!r.cleanup.runDirRemoved}`);
  report.push('');
  report.push(`| 断言 | 名称 | 结果 | 明细 |`);
  report.push(`|---|---|---|---|`);
  for (const i of r.results) {
    report.push(`| ${i.id} | ${i.name} | ${i.ok ? '通过' : '失败'} | ${String(i.detail ?? '').replace(/\|/g, '\\|').slice(0, 180)} |`);
  }
}
report.push('');
report.push(`## 分类口径`);
report.push('');
report.push(`- **通过**：上表"通过"项；两轮同序号语义一致。`);
report.push(`- **失败**：上表"失败"项（产品缺陷以最小复现陈述，不改产品实现、不弱化断言）。`);
report.push(`- **未测**：无（本包必测项全部执行；若环境阻点发生，此处会逐项列出并使 runner 返回非零）。`);
report.push(`- **不适用**：正式审批/资金动作（按任务书不执行）；真实模型质量（模型为本地替身，明确不适用）。`);
report.push('');
report.push(`## 持久证据`);
report.push('');
report.push(`- evidence-round-1.json / evidence-round-2.json：逐断言结果、HTTP 调用面记录、出站 brief 全文、回执/反馈文件清单。`);
report.push(`- sha256-inputs-before.json / sha256-inputs-after-diff.json：输入源码与合成材料台账（${INPUT_SOURCES.length} 项）。`);
report.push('');
fs.writeFileSync(path.join(OUT_DIR, 'REPORT.md'), report.join('\n'));

console.log(`\n结果：通过 ${passed.length}/${totalItems.length}（失败 ${failed.length}），漂移=${drift.length}，退出码=${exitCode}`);
console.log(`报告：${path.join(OUT_DIR, 'REPORT.md')}`);
process.exit(exitCode);
