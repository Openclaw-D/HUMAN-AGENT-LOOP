// V0.3 串行收尾 · 步骤2 隔离全链路验收（2026-09-20）
// 链路：真实 A 内核登记（建客户/材料登记经 Connectors A 桥，零手工插表）→
//       Connectors 真实上传入口+异步解析+处理链 → Edge(live kernel-store + assistant 观察面) →
//       本地 HTTP 模型替身（显式 mock，source=mock/status=simulated，不冒充真实模型）。
// 案例：KS-LASER-500 补证前后各一轮；KS-TEXTILE-200 缺件；KS-INJECTION-1000 冲突/更正/撤权。
// 门：旧结果失效、刷新一致、合法重放只发送一次、未知不重发、撤权拒绝。
// 边界：模型为本地替身；不调用付费模型；不改共享运行环境；独占 PG 随起随毁。
// 运行：node Back/Edge/test/serial-remainder/full-chain.e2e.mjs
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const MATERIALS = path.join(REPO_ROOT, 'Materials', 'kashgar-demo-v1');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'v0.3', 'zcode', 'serial-remainder');
const TENANT = 'tenant_proc';

// Connectors 处理夹具在模块加载时读 BASE_PG —— 必须先设 env 再动态 import。
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-serial-e2e-'));
const pgPort = await new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
process.env.CONNECTORS_TEST_PG_PORT = String(pgPort);
process.env.CONNECTORS_TEST_PG_USER = 'v7next';
process.env.CONNECTORS_TEST_PG_PASSWORD = 'v7next';
process.env.CONNECTORS_TEST_PG_DATABASE = 'cnext';
const { TENANT: H_TENANT, makeProcessingHarness, setupInvitation, uploadBytes, driveToEnd } = await import('../../../Connectors/test/processing-helpers.mjs');
const pgctl = await import('../../../D/harness/pgctl.mjs');

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 500) ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail && !ok ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 模型替身（本地 HTTP，显式 mock 语义） ----------
const mockState = { hits: 0, captured: [], onSend: null, hangNext: false };
const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    mockState.hits += 1;
    const parsed = JSON.parse(body);
    mockState.captured.push(parsed);
    const hook = mockState.onSend; mockState.onSend = null;
    if (hook) await hook();
    if (mockState.hangNext) { mockState.hangNext = false; setTimeout(() => req.destroy(), 10000); return; } // 悬置：客户端超时→发送后未知
    const brief = parsed.messages?.[0]?.content ?? '';
    const pack = JSON.parse(brief.split('[服务端获准证据包] ')[1]);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        observations: [
          { text: '替身观察：证据中可见申请金额与合同要素', evidenceRefIds: [pack.snippets[0].id] },
          { text: '替身观察：伪造引用（应降级为待核验）', evidenceRefIds: ['forged-ref'] },
        ],
        questions: ['替身待核验：权属与净值须人工复核'],
      }) } }],
      usage: { prompt_tokens: 100 + pack.snippets.length, completion_tokens: 40 },
    }));
  });
});
const mockPort = await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port)));

// ---------- 独占 PG + A 内核 ----------
const A_DB = 'jw_serial_e2e_a';
const pg = await pgctl.ensurePg({ runDir, port: pgPort, db: 'jw_serial_e2e_boot' });
await pgctl.psql(pg.name, 'jw_serial_e2e_boot', `DROP DATABASE IF EXISTS ${A_DB} WITH (FORCE)`);
await pgctl.createDb(pg.name, A_DB);
// Connectors 夹具的 createTestDatabase 用名为 cnext 的管理库建测试库：先预建
await pgctl.psql(pg.name, 'jw_serial_e2e_boot', 'CREATE DATABASE cnext').catch(() => { });
const aPort = await new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const aBase = `http://127.0.0.1:${aPort}`;
const kernelLog = path.join(runDir, 'kernel.log');
const kernel = spawn(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(aPort),
  '--db', `postgres://v7next:v7next@127.0.0.1:${pgPort}/${A_DB}`,
  '--principal-tokens', `tk-biz1=biz1:human:business:all:${TENANT},tk-cust1=cust1:human:customer:all:${TENANT},tk-svc1=svc1:service:service:all:${TENANT}`],
{ windowsHide: true, stdio: ['ignore', fs.openSync(kernelLog, 'a'), fs.openSync(kernelLog, 'a')] });
kernel.unref();
const waitHttp = async (url, ok, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (ok(r)) return true; } catch { }
    await sleep(400);
  }
  return false;
};
const kernelUp = await waitHttp(`${aBase}/healthz`, (r) => r.status === 200);
if (!kernelUp) { console.error(fs.readFileSync(kernelLog, 'utf8').slice(-2000)); throw new Error('A 内核未就绪'); }
console.log(`[env] A 内核 ${aBase}（独占容器 ${pg.name}:${pgPort}，库 ${A_DB}）；模型替身 :${mockPort}` );

const aApi = async (method, p, body, credential = 'tk-biz1') => {
  const r = await fetch(`${aBase}${p}`, { method, headers: { 'content-type': 'application/json', ...(credential ? { 'x-principal-credential': credential } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
};
const createCustomerInA = async (caseId, displayName) => {
  const r = await aApi('POST', '/api/v2/customers', {
    requestId: `e2e-cust-${caseId}-${Date.now().toString(36)}`, credential: 'tk-biz1',
    tenantId: TENANT, legalEntityRef: `${caseId}-legal-ref`, displayName,
  });
  if (r.status !== 200 || !r.json?.customerId) throw new Error(`A 建客户失败 ${caseId}: ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json.customerId;
};

// ---------- Connectors（真实 compose：A 桥指向真实 A；处理驱动真实） ----------
const harness = await makeProcessingHarness({
  port: 0,
  aBaseUrl: aBase,
  aConfig: { tenantId: TENANT, credentials: { service: 'tk-svc1', registrar: 'tk-biz1', upload: { customer_finance: 'tk-cust1' }, uploadFallback: 'tk-cust1' }, timeoutMs: 5000 },
  processing: {
    driverIntervalMs: 200, aTimeoutMs: 5000,
    aRegisterDomains: ['business', 'policy', 'credit', 'commerce', 'asset'],
    rulePackPath: path.join(BACK_ROOT, 'C', 'rules', 'takeoff-first-admission-rule-pack-v1.json'),
  },
});
console.log(`[env] Connectors :${harness.server.server.address().port}（独占库 ${harness.dbName}）`);
const connectorsBase = `http://127.0.0.1:${harness.server.server.address().port}`;

// 全部将上传原件的哈希 → 模型配置 allowedHashes（出站白名单）
const CASE_FILES = {
  laser: ['KS-LASER-500/originals/D01-融资需求登记.pdf', 'KS-LASER-500/originals/D02-主体登记资料.pdf', 'KS-LASER-500/originals/D09-销售合同与交付凭据.pdf'],
  textile: ['KS-TEXTILE-200/originals/D01-融资需求登记.pdf'],
  injection: ['KS-INJECTION-1000/originals/D11-生产与库存说明.pdf'],
};
const conflictCsv = 'eval-v03/KS-INJECTION-1000/C01-equipment-conflict.csv';
const correctionTxt = 'eval-v03/KS-INJECTION-1000/S02-equipment-correction.txt';
const allFiles = [...new Set([...Object.values(CASE_FILES).flat(), conflictCsv, correctionTxt])];
const fileBytes = Object.fromEntries(allFiles.map((rel) => [rel, fs.readFileSync(path.join(MATERIALS, rel))]));
const allowedHashes = [...new Set(Object.values(fileBytes).map(sha256))];

// ---------- Edge（live kernel-store + assistant 面域 + 分类修复后的 live 凭据核实器） ----------
const configPath = path.join(runDir, 'assistant-config.json');
fs.writeFileSync(configPath, JSON.stringify({
  transport: { mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${mockPort}`, timeoutMs: 1500 } },
  evidencePolicy: { allowedHashes },
}));
const { createAssistantModel } = await import('../../src/assistant-model.mjs');
const { createAssistantEvidenceProvider } = await import('../../src/assistant-evidence-provider.mjs');
const { createKernelStore } = await import('../../src/kernel-store.mjs');
const { startEdgeServer, createLiveCredentialVerifier } = await import('../../src/server.mjs');
const { createSessionStore } = await import('../../src/session.mjs');
const { createAuditSink } = await import('../../src/audit.mjs');

const authState = { permitted: true };
const assistantModel = await createAssistantModel({
  // maxContextChars 对齐真实部署（12000）：默认 6000 会把策略上限压到 2800 字符，
  // 多材料装包时第二份整份被 CONTEXT_LIMIT 省略，且哪份出局取决于随机 evidenceId 排序。
  configPath, receiptsDir: path.join(runDir, 'model-receipts'), requireEvidence: true, maxContextChars: 12000, log: (m) => console.log(m),
});
const assistantEvidence = createAssistantEvidenceProvider({
  baseUrl: connectorsBase, token: 'proc_service_token', policy: () => assistantModel.evidencePolicy(),
});
const bizHash = createHash('sha256').update('tk-biz1').digest('hex');
const directory = {
  byHash: new Map([[bizHash, { principalId: 'biz1', roles: ['business'], tenantId: TENANT }]]),
  byPrincipal: new Map([['biz1', { credential: 'tk-biz1' }]]),
  list: [{ principalId: 'biz1', roles: ['business'] }],
};
const edge = await startEdgeServer({
  port: 0, seal: { buildId: 'serial-e2e', capabilities: { note: 'isolated full chain' } }, probes: [],
  store: createKernelStore({ baseUrl: aBase, log: (m) => console.error(m) }),
  auth: async ({ session }) => ({ ok: !!session && authState.permitted }),
  sessionStore: createSessionStore({}),
  verifyCredential: createLiveCredentialVerifier({ kernelBase: aBase, directory }),
  identityDirectory: { list: directory.list, byPrincipal: directory.byPrincipal },
  auditSink: createAuditSink(),
  assistantModel, assistantEvidence,
});
const edgeBase = `http://127.0.0.1:${edge.port}`;
const login = await (await fetch(`${edgeBase}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principalId: 'biz1' }) })).json();
if (!login?.session?.sessionId) throw new Error(`Edge 登录失败: ${JSON.stringify(login).slice(0, 200)}`);
const sid = login.session.sessionId;
record('步骤0·live核实器放行真实凭据（A探针200→会话建立）', true, `principal=${login.session.principalId} tenant=${login.session.tenantId}`);

const observe = async (customerId, question, assistant = 'credit') => {
  const r = await fetch(`${edgeBase}/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/observe`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid },
    body: JSON.stringify({ assistant, question, facts: ['客户端注入事实（不得出站）'] }),
  });
  return { status: r.status, body: await r.json() };
};
const uploadAndProcess = async (customerId, files, { kinds = null } = {}) => {
  const inv = await setupInvitation(harness.api, { customerId, kinds: kinds ?? ['statement', 'document'] });
  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rel = typeof f === 'string' ? f : f.rel;
    const bytes = typeof f === 'string' ? fileBytes[rel] : f.bytes;
    uploaded.push({ ...(await uploadBytes(harness.api, inv, {
      customerId, kind: 'document', bytes,
      ...(typeof f === 'object' && f.supersedes ? { supersedes: f.supersedes } : {}),
    })), sha256: sha256(bytes) });
  }
  await driveToEnd(harness.api, { maxRounds: 30, maxTasks: 8 });
  // driveToEnd 只保证无在途任务领取；显式等待每个原件的 parse_results 落库（ok）后再继续，
  // 消除"a_links 已登记但解析结果未就绪"的观察窗口竞态。
  const deadline = Date.now() + 30000;
  const hashes = uploaded.map((u) => u.sha256);
  for (;;) {
    const rows = (await harness.store.query(
      `SELECT sha256, ok FROM parse_results WHERE tenant_id=$1 AND customer_id=$2 AND sha256=ANY($3::text[])`,
      [H_TENANT, customerId, hashes])).rows;
    const okSet = new Set(rows.filter((r) => r.ok).map((r) => r.sha256));
    if (hashes.every((h) => okSet.has(h))) break;
    if (Date.now() > deadline) throw new Error(`解析结果未就绪: ${JSON.stringify({ hashes, rows })}`);
    await sleep(300);
  }
  return uploaded;
};
const waitRegistered = async (customerId, expectCount, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await harness.store.query(
      `SELECT entity_type, local_id, a_ref, status FROM a_links WHERE tenant_id=$1 AND customer_id=$2 AND entity_type IN ('material','supersede')`,
      [H_TENANT, customerId])).rows;
    if (rows.filter((r) => r.status === 'registered' && r.a_ref).length >= expectCount) return rows;
    await sleep(400);
  }
  return (await harness.store.query(
    `SELECT entity_type, local_id, a_ref, status FROM a_links WHERE tenant_id=$1 AND customer_id=$2`,
    [H_TENANT, customerId])).rows;
};
const briefOf = (i) => mockState.captured[i]?.messages?.[0]?.content ?? '';

try {
  // ============ 主案例 KS-LASER-500 ============
  const laserId = await createCustomerInA('KS-LASER-500', '喀什示例金属加工有限公司（激光场景·合成）');
  record('真实A登记·客户建档（POST /api/v2/customers，business 人类凭据）', typeof laserId === 'string' && laserId.startsWith('cust-'), `aCustomerId=${laserId}`);

  // 补证前：D01+D02
  const up1 = await uploadAndProcess(laserId, CASE_FILES.laser.filter((f) => !f.includes('D09')));
  record('真实上传入口·补证前两件原件（invitation→upload→处理链）', up1.length === 2 && up1.every((u) => u.evidenceId), up1.map((u) => u.evidenceId).join(','));
  const links1 = await waitRegistered(laserId, 2);
  const reg1 = links1.filter((r) => r.entity_type === 'material' && r.status === 'registered' && r.a_ref);
  record('真实A登记·材料经A桥登记（a_links.status=registered 且 a_ref 来自A；零手工插表）', reg1.length >= 2, links1);
  const aArts = await aApi('GET', `/api/v2/customers/${laserId}/artifacts`, undefined);
  const aArtIds = (aArts.json?.artifacts ?? aArts.json?.items ?? []).map((a) => a.artifactId);
  record('A侧工件清单可见（GET artifacts）', aArts.status === 200 && reg1.every((r) => aArtIds.includes(r.a_ref)), `aArtifacts=${aArtIds.length}`);

  const first = await observe(laserId, '核验申请金额与主体登记');
  record('补证前观察·200/current/sent/六节点图', first.status === 200 && first.body.model.current === true &&
    first.body.model.sent === true && first.body.model.graphTrace?.length === 6 &&
    ['prepare_evidence', 'validate_input', 'controlled_model_call', 'validate_citations', 'check_current', 'output_receipt']
      .every((n, i) => first.body.model.graphTrace[i]?.node === n),
    { status: first.status, model: first.body.model, error: first.body.error });
  // 引用校验逐项断言（定向复核#1）：有效观察必须绑定本次证据包内真实片段 id（source_bound）；
  // 伪造引用不得进入有效观察，必须降级为带明确标识的待核验问题；引用逐条留校验记录。
  const obs0 = first.body.observations?.[0];
  const forgedQuestion = (first.body.questions ?? []).find((q) => q?.citationStatus === 'unverified');
  const citedSnippet = (first.body.evidenceRefs ?? []).find((s) => s.id === obs0?.evidenceRefIds?.[0]);
  const uploadHashes = new Set(up1.map((u) => u.sha256));
  record('补证前观察·有效引用逐项绑定本次证据包片段（source_bound 且片段哈希/定位在场）',
    first.body.observations?.length === 1 && obs0?.citationStatus === 'source_bound' &&
    typeof obs0?.evidenceRefIds?.[0] === 'string' && !!citedSnippet &&
    uploadHashes.has(citedSnippet.hash) &&
    ['page_text', 'extracted_text'].includes(citedSnippet.locator?.kind) && Number.isInteger(citedSnippet.locator?.start) &&
    typeof citedSnippet.text === 'string' && citedSnippet.text.length > 0,
    `obs=${JSON.stringify(obs0)?.slice(0, 200)} refHash=${citedSnippet?.hash?.slice(0, 8)} locator=${citedSnippet?.locator?.kind}`);
  record('补证前观察·伪造引用不进入有效观察并降级为带标识待核验问题',
    first.body.observations?.every((o) => o.evidenceRefIds?.every((id) => id !== 'forged-ref')) === true &&
    (first.body.questions?.length ?? 0) === 2 && !!forgedQuestion &&
    forgedQuestion.text?.startsWith('待核验（缺少有效原文引用）'),
    `q=${JSON.stringify(first.body.questions)?.slice(0, 240)}`);
  record('补证前观察·逐条引用校验记录（1 有效 SOURCE_BOUND + 1 无效 UNVERIFIED_REFERENCE）',
    first.body.model.citationChecks?.length === 2 &&
    first.body.model.citationChecks.some((c) => c.valid === true && c.reason === 'SOURCE_BOUND') &&
    first.body.model.citationChecks.some((c) => c.valid === false && c.reason === 'UNVERIFIED_REFERENCE'),
    JSON.stringify(first.body.model.citationChecks)?.slice(0, 240));
  const packPart0 = (briefOf(0).split('[服务端获准证据包] ')[1] ?? '');
  const pack0 = JSON.parse(packPart0);
  record('补证前观察·出站仅获准证据（两件原件金额/主体文本均在包；客户端注入事实不出站）',
    briefOf(0).includes('500.00') && !briefOf(0).includes('客户端注入事实') &&
    pack0.snippets?.length === 2 && pack0.omitted?.every((o) => o.reason !== 'CONTEXT_LIMIT'),
    `brief含500.00=${briefOf(0).includes('500.00')}；含注入事实=${briefOf(0).includes('客户端注入事实')}；snippets=${pack0.snippets?.length} omitted=${JSON.stringify(pack0.omitted)}；含D01哈希=${briefOf(0).includes(sha256(fileBytes['KS-LASER-500/originals/D01-融资需求登记.pdf']).slice(0, 8))}`);

  // 刷新一致/合法重放：同问题再次 → 回执重放零新增调用
  const hitsBeforeReplay = mockState.hits;
  const replay = await observe(laserId, '核验申请金额与主体登记');
  record('合法重放·只发送一次（hits 不增）且 current=true', replay.body.model.replayed === true && mockState.hits === hitsBeforeReplay && replay.body.model.current === true,
    `hits=${mockState.hits} replayed=${replay.body.model.replayed}`);

  // 补证：D09 合同 → 处理链 → A 登记
  const up2 = await uploadAndProcess(laserId, ['KS-LASER-500/originals/D09-销售合同与交付凭据.pdf']);
  await waitRegistered(laserId, 3);
  const second = await observe(laserId, '核验合同未付余额');
  record('补证后观察·新上下文触发新发送（非重放）', second.status === 200 && second.body.model.replayed === false && second.body.model.sent === true && mockState.hits === hitsBeforeReplay + 1,
    `hits=${mockState.hits} req1=${first.body.model.requestId} req2=${second.body.model.requestId}`);
  record('补证后观察·请求身份随证据变化（旧requestId失效）', second.body.model.requestId !== first.body.model.requestId);
  record('补证后观察·brief 含新补合同内容', briefOf(mockState.hits - 1).includes('D09') || briefOf(mockState.hits - 1).includes('合同'), 'brief 含合同要素');

  // ============ KS-TEXTILE-200 缺件 ============
  const textileId = await createCustomerInA('KS-TEXTILE-200', '示例纺织有限公司（合成）');
  const missing = await observe(textileId, '核验纺织主体');
  record('缺件阻断·无任何登记工件→422 EVIDENCE_UNAVAILABLE（未发送）', missing.status === 422 && missing.body.error === 'EVIDENCE_UNAVAILABLE',
    { status: missing.status, body: missing.body });
  const upT = await uploadAndProcess(textileId, CASE_FILES.textile);
  await waitRegistered(textileId, 1);
  const textile = await observe(textileId, '核验纺织主体登记');
  record('补件后观察·200 且出站含纺织主体原文', textile.status === 200 && textile.body.model.sent === true && briefOf(mockState.hits - 1).includes('纺织'),
    { status: textile.status });

  // ============ KS-INJECTION-1000 冲突/更正/撤权/未知 ============
  const injectionId = await createCustomerInA('KS-INJECTION-1000', '示例注塑制品有限公司（合成）');
  // 冲突轮：仅 C01 冲突声明入包（净值 149.0769 为被更正方；S02 更正轮再验证冲突消除）
  const upI = await uploadAndProcess(injectionId, [{ rel: conflictCsv, bytes: fileBytes[conflictCsv] }]);
  await waitRegistered(injectionId, 1);
  const conflict = await observe(injectionId, '核验设备净值与权属');
  const conflictBrief = briefOf(mockState.hits - 1);
  record('冲突值出站·被更正方原文在包（149.0769 可见）', conflict.status === 200 && conflictBrief.includes('149.0769'),
    { status: conflict.status, has149: conflictBrief.includes('149.0769'), brief: conflictBrief.slice(0, 600) });

  // 更正轮：S02 取代 C01（superseded_by → 证据读取排除旧件），并补 D11 多材料打包
  const s02Bytes = fileBytes[correctionTxt];
  await uploadAndProcess(injectionId, [
    'KS-INJECTION-1000/originals/D11-生产与库存说明.pdf',
    { rel: correctionTxt, bytes: s02Bytes, supersedes: upI[0].evidenceId },
  ]);
  await waitRegistered(injectionId, 3);
  const corrected = await observe(injectionId, '核验设备净值与权属（更正后）');
  const correctedBrief = briefOf(mockState.hits - 1);
  record('更正生效·被取代件不再出站（149.0769 消失）且更正声明与新增件同包', corrected.status === 200 &&
    !correctedBrief.includes('149.0769') && correctedBrief.includes('139.0769') && correctedBrief.includes('周转配件'),
    { status: corrected.status, has149: correctedBrief.includes('149.0769'), has139: correctedBrief.includes('139.0769'), hasD11: correctedBrief.includes('周转配件') });
  record('更正生效·更正轮为新请求（当前性推进）', corrected.body.model.requestId !== conflict.body.model.requestId);

  // 撤权拒绝：模型返回后路由再授权失败 → 403 且不泄露观察
  const hitsBeforeRevoke = mockState.hits;
  mockState.onSend = () => { authState.permitted = false; };
  const revoked = await observe(injectionId, '撤权中请求');
  record('撤权拒绝·返回后授权复核失败→403（观察不泄露）', revoked.status === 403 && (revoked.body.observations ?? []).length === 0,
    { status: revoked.status });
  const afterRevoke = await observe(injectionId, '撤权后请求');
  record('撤权后·后续请求入口即403（不再触发模型调用）', afterRevoke.status === 403 && mockState.hits === hitsBeforeRevoke + 1, `hits=${mockState.hits}`);
  authState.permitted = true;

  // 未知不重发：悬置替身 → 发送后未知；恢复后重放仍 unknown 且零新增调用
  const hitsBeforeUnknown = mockState.hits;
  mockState.hangNext = true;
  const unknownRes = await observe(laserId, '未知路径专用问题');
  record('发送后未知·悬置超时→status=unknown sent=null', unknownRes.status === 200 && unknownRes.body.model.status === 'unknown' && unknownRes.body.model.sent === null,
    { status: unknownRes.status, model: unknownRes.body.model });
  mockState.hangNext = false;
  const unknownReplay = await observe(laserId, '未知路径专用问题');
  record('未知不重发·恢复后重放仍 unknown（hits 不增，不换ID重发）', unknownReplay.body.model.status === 'unknown' && mockState.hits === hitsBeforeUnknown + 1,
    `hits=${mockState.hits}（悬置轮+1后不再增）`);

  // 证据身份/跨客户
  const crossPair = (await harness.api('/api/connectors/internal/assistant-evidence', { tenantId: H_TENANT, customerId: laserId, artifactIds: ['nonexistent'] }, { token: 'proc_service_token' })).materials;
  record('证据面·未知工件返回空集（不猜测）', Array.isArray(crossPair) && crossPair.length === 0);
} catch (e) {
  record('e2e 未捕获异常', false, `${e?.stack ?? e}`);
} finally {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'e2e-result.json'), JSON.stringify({
    at: new Date().toISOString(), boundary: {
      real: ['A 内核（真实进程+独占PG，客户/材料/分析/Gate 全真实登记）', 'Connectors（真实 compose：邀请/上传/异步解析/处理驱动/A桥）', 'Edge（live kernel-store+assistant 观察面+凭据核实器）'],
      stand_in: ['模型=本地HTTP替身（显式 mock 语义，source.mode=mock，不冒充真实模型）', '企微传输=FakeWecomTransport（本就 blocked_external_access）'],
    }, results,
    // 出站 brief 全文留档（合成材料）：断言失败时可逐字段核对装配结果，消除不可诊断的偶发。
    outbound_briefs: mockState.captured.map((m, i) => ({ i, content: m.messages?.[0]?.content ?? '' })),
  }, null, 2));
  console.log(`\n结果：${results.filter((r) => r.ok).length}/${results.length} 通过 → ${path.join(OUT_DIR, 'e2e-result.json')}`);
  try { await edge.close(); } catch { }
  try { process.kill(kernel.pid); } catch { }
  try { mockServer.closeAllConnections?.(); mockServer.close(); } catch { }
  try { await harness.dispose(); } catch { }
  try { await pgctl.destroyPg(pg.name); } catch { }
  try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { }
}
process.exit(process.exitCode ?? 0);
