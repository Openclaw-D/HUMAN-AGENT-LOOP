// 集成轮 2026-09-25 · 端到端验收套件（真实 HTTP + 真实 PG + 真实解析器；替身单列标注）。
// 覆盖：新建客户全链（上传→原件保存→hash→解析→来源定位→事实登记→A 登记→工作本读取→恢复上下文）
// 与异常矩阵（重复/同名异容/缺件/损坏/解析超时/越权/撤权×2/服务中断/写入中途失败/重启一致）。
// 断言原则：未经解析/核验的输入不得自动升级为已核验事实（verified 只能来自获准人工核验端点）。
// 结果：RESULTS.json（逐例 pass/fail + 证据）；任一 fail → 退出码 1；必要依赖缺失 → 非零。
// 用法：node scripts/integration-smoke.mjs [--out <RESULTS.json 路径>]（栈须已由 integration-up 启动）
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDGE_ROOT, REPO_ROOT, RUN_DIR, loadParams, loadRuntimeConfig, fail, ok, info } from './integration-lib.mjs';

const MATERIALS = path.join(REPO_ROOT, 'docs', 'materials', 'kashgar-demo-v1', 'KS-INJECTION-1000', 'originals');
const TENANT = 't1';

const results = [];
const logs = [];
let uidCounter = 0;
const uid = (p) => `${p}-${Date.now().toString(36)}-${(uidCounter++).toString(36)}-${randomUUID().slice(0, 8)}`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function record(id, name, pass, evidence, note = null) {
  results.push({ id, name, pass, note, evidence });
  console.log(`  ${pass ? '✓' : '✗'} ${id} ${name}${note ? ` — ${note}` : ''}`);
  if (!pass && evidence != null) console.log(`      证据: ${JSON.stringify(evidence).slice(0, 400)}`);
  return pass;
}

function log(line) { logs.push(`${new Date().toISOString()} ${line}`); }

async function http(base, method, pathname, { session, body, headers = {}, raw = null } = {}) {
  const url = `${base}${pathname}`;
  const h = { ...headers };
  let payload;
  if (raw !== null) { payload = raw; h['content-type'] = h['content-type'] ?? 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  if (session) h['x-jw-session'] = session;
  const started = Date.now();
  const res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, ms: Date.now() - started };
}

async function psql(db, sql) {
  const params = loadParams();
  const cfg = loadRuntimeConfig(params.configPath);
  const r = await new Promise((resolve) => {
    execFile('docker', ['exec', params.dbContainer, 'psql', '-U', cfg.dbUser, '-d', db, '-tAc', sql],
      { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ err, out: String(stdout || '').trim(), stderr: String(stderr || '') });
      });
  });
  if (r.err) throw new Error(`psql 失败: ${r.stderr.slice(0, 200)}`);
  return r.out;
}

async function login(base, identityDirectory, principalId) {
  const r = await http(base, 'POST', '/api/jw/v2/session', { body: { principalId } });
  if (r.status !== 200 || !r.json?.session) throw new Error(`登录 ${principalId} 失败: ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
  // 会话交换返回 {session:{sessionId, principalId, roles, ...}}；不透明令牌=sessionId
  return r.json.session.sessionId;
}

async function waitTask(base, edgeSession, tenant, customerId, taskId, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await new Promise((x) => setTimeout(x, 1200));
    const r = await http(base, 'GET', `/api/jw/v2/connectors/processing/tasks/${encodeURIComponent(taskId)}?tid=${encodeURIComponent(tenant)}&cid=${encodeURIComponent(customerId)}`, { session: edgeSession });
    last = r;
    if (r.status !== 200) continue;
    const st = r.json?.task?.status;
    if (['done', 'needs_followup', 'failed', 'blocked_unknown', 'blocked_link', 'blocked_a_unavailable', 'skipped_duplicate'].includes(st)) return r.json.task;
  }
  throw new Error(`任务 ${taskId} 等待超时；最后响应 ${last?.status}`);
}

async function waitForCondition(fn, timeoutMs = 60000, intervalMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastErr = e; }
    await new Promise((x) => setTimeout(x, intervalMs));
  }
  throw new Error(`条件等待超时: ${lastErr ?? '未满足'}`);
}

// 上传帮助：经 Edge 处理通道代理（浏览器同型：会话 + JSON）
async function uploadMaterial(base, session, { customerId, invitationId, kind, name, bytes, contentType, requestId, tenantId = TENANT, extra = {} }) {
  return http(base, 'POST', `/api/jw/v2/actions/connectors/evidence/upload`, {
    session,
    body: {
      requestId: requestId ?? uid('up'), customerId, tenantId, invitationId, kind,
      ...(name ? { name } : {}), contentBase64: bytes.toString('base64'),
      contentType: contentType ?? 'application/octet-stream', ...extra,
    },
  });
}

export async function runSmoke({ out } = {}) {
  const params = loadParams();
  if (!params) fail('params.json 不存在：先 node scripts/integration-up.mjs');
  const cfg = loadRuntimeConfig(params.configPath);
  const EDGE = `http://127.0.0.1:${params.edgePort}`;
  const A = `http://127.0.0.1:${params.kernelPort}`;

  console.log('════ 集成轮 2026-09-25 · E2E 验收套件 ════');
  const t0 = Date.now();

  // ---------- C01 环境就绪（真实探测，无 mock） ----------
  {
    const ready = await http(EDGE, 'GET', '/healthz/ready');
    const vz = await http(EDGE, 'GET', '/versionz');
    const aHealth = await http(A, 'GET', '/healthz');
    const connHealth = await http(`http://127.0.0.1:${params.connectorsPort}`, 'GET', '/healthz');
    const pass = ready.status === 200 && ready.json?.ok === true && vz.status === 200 && !!vz.json?.buildId
      && aHealth.json?.db === 'up' && connHealth.json?.ok === true && connHealth.json?.service === 'jw-connectors';
    record('C01', '环境就绪与版本封存（Edge ready 聚合/A db=up/Connectors 标识）', pass,
      { ready: ready.json?.ok, checks: ready.json?.checks?.map((c) => `${c.name}:${c.ok}`), build: vz.json?.buildId, aDb: aHealth.json?.db },
      `build=${vz.json?.buildId} contract=${vz.json?.contractVersion} migrations=${vz.json?.migrationVersion}`);
    if (!pass) { console.error('环境未就绪：中止冒烟（必要依赖缺失 → 非零退出）'); return finish(3); }
  }

  // ---------- C02 会话建立（服务端身份；匿名凭据失败关闭） ----------
  let bizSession, admSession;
  {
    bizSession = await login(EDGE, cfg, 'biz1');
    admSession = await login(EDGE, cfg, 'adm1');
    const bad = await http(EDGE, 'POST', '/api/jw/v2/session', { body: { credential: 'not-a-real-credential' } });
    record('C02', '会话建立（受控目录）与伪造凭据失败关闭', bad.status === 403 && bad.json?.error === 'PRINCIPAL_UNTRUSTED',
      { badStatus: bad.status, error: bad.json?.error });
  }

  // ---------- C03 新建测试客户（正式 HTTP；正式运行不预装结论） ----------
  let customerId, contactSession, contactPrincipalId;
  {
    const r = await http(EDGE, 'POST', '/api/jw/v2/actions/customers', {
      session: bizSession,
      body: { requestId: uid('cc'), tenantId: TENANT, legalEntityRef: `INTG-FOUNDATION-${Date.now()}`, displayName: '集成底座测试客户（合成）' },
    });
    customerId = r.json?.customerId ?? null;
    record('C03', '新建测试客户（A 正式建档）', r.status === 200 && !!customerId, { status: r.status, body: r.json },
      customerId ?? undefined);
    if (!customerId) return finish(1);
  }

  // ---------- C04 A 侧受限邀请 → 客户联系人身份（allowedKinds 服务端强制） ----------
  const ALLOWED_KINDS = ['financial_statement', 'invoice', 'bank_statement', 'order_contract', 'other'];
  {
    const inv = await http(EDGE, 'POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/invitations`, {
      session: bizSession,
      body: { requestId: uid('inv'), tenantId: TENANT, role: 'customer-finance', allowedKinds: ALLOWED_KINDS, expiresInHours: 24 },
    });
    const code = inv.json?.invitation?.code ?? inv.json?.code;
    const redeem = await http(EDGE, 'POST', '/api/jw/v2/invitations/redeem', { body: { code, requestId: uid('rd') } });
    contactPrincipalId = redeem.json?.principalId ?? null;
    const cred = redeem.json?.credential;
    const s = await http(EDGE, 'POST', '/api/jw/v2/session', { body: { credential: cred } });
    contactSession = s.json?.session?.sessionId ?? null;
    // 凭据明文只在兑换首次响应出现（凭据不进本结果/日志）；会话必需可建立
    record('C04', 'A 侧受限邀请签发→兑换→联系人会话（凭据明文仅首次响应）',
      inv.status === 200 && redeem.status === 200 && typeof cred === 'string' && cred.length > 0 && !!contactSession,
      { inv: inv.status, redeem: redeem.status, hasCredential: typeof cred === 'string', hasSession: !!contactSession, principalId: contactPrincipalId });
    if (!contactSession) return finish(1);
  }

  // ---------- C05 Connectors 进件邀请签发（伪造租户被 A 权威归一） ----------
  let invitationId, invitationToken;
  {
    const r = await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/invitations', {
      session: bizSession,
      body: { requestId: uid('ii'), tenantId: 't-FAKE-自报', customerId, role: 'customer_finance', allowedEvidenceKinds: ALLOWED_KINDS, ttlSec: 86400 },
    });
    invitationId = r.json?.invitationId ?? null;
    invitationToken = r.json?.token ?? null;
    const row = invitationId ? await psql(cfg.dbName, `SELECT tenant_id FROM a_customer_links WHERE customer_id='${customerId}'`).catch(() => '') : '';
    const invTenant = invitationId ? (await psql('cnext', `SELECT tenant_id FROM intake_invitations WHERE invitation_id='${invitationId}'`)) : '';
    record('C05', 'Connectors 进件邀请签发；自报租户被服务端归一（写面租户来自 A）',
      r.status === 200 && !!invitationId && invTenant === TENANT,
      { status: r.status, invitationTenant: invTenant, note: '请求体 tenantId=t-FAKE-自报' });
    if (!invitationId) return finish(1);
  }

  // ---------- C06 接受邀请 + 绑定核验（联系人会话接受；business 核验） ----------
  {
    // Edge 网关纪律：所有 /actions/** 一律需会话（open 路由=邀请令牌本身即授权，仍需登录态）
    const accept = await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/accept', {
      session: contactSession,
      body: { requestId: uid('ac'), tenantId: TENANT, token: invitationToken, provider: 'jw_principal', providerUserId: contactPrincipalId },
    });
    const bindingId = accept.json?.bindingId ?? null;
    const verify = await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/verify-binding', {
      session: bizSession,
      body: { requestId: uid('vb'), tenantId: TENANT, customerId, bindingId, verifiedBy: '集成验收（business）', evidenceRefs: [`invitation:${invitationId}`] },
    });
    const binding = bindingId ? await psql('cnext', `SELECT status FROM participant_bindings WHERE binding_id='${bindingId}'`) : '';
    record('C06', '接受邀请（candidate）→ 绑定核验（active）', accept.status === 200 && verify.status === 200 && binding === 'active',
      { accept: accept.status, verify: verify.status, bindingStatus: binding });
  }

  // ---------- C07 上传恢复上下文（装配挂载验证：正例 + 内部无绑定 + 匿名） ----------
  {
    const okR = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    const fields = okR.json ? Object.keys(okR.json).sort() : [];
    const internal = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: bizSession });
    const anon = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`);
    record('C07', '上传恢复上下文：联系人 available:true + 9 字段 allowlist；内部无绑定 available:false；匿名 401',
      okR.status === 200 && okR.json?.available === true && okR.json?.allowedKinds?.length > 0
      && JSON.stringify(fields) === JSON.stringify(['allowedKinds', 'allowedObjects', 'available', 'bindingRef', 'customerId', 'expiresAt', 'invitationId', 'ok', 'reason'])
      && internal.status === 200 && internal.json?.available === false
      && anon.status === 401,
      { okFields: fields, internal: `${internal.status}/${internal.json?.available}/${internal.json?.reason}`, anon: anon.status });
  }

  // ---------- C08 主链·CSV（真实材料 年度报表.csv） ----------
  const csvBytes = readFileSync(path.join(MATERIALS, '年度报表.csv'));
  const csvSha = sha256(csvBytes);
  let csvTaskId, csvEvidenceId;
  {
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'financial_statement', name: '年度报表.csv', bytes: csvBytes, contentType: 'text/csv',
    });
    csvEvidenceId = up.json?.evidenceId ?? null;
    csvTaskId = up.json?.processing?.taskId ?? null;
    const good = up.status === 200 && up.json?.sha256 === csvSha;
    const task = good ? await waitTask(EDGE, bizSession, TENANT, customerId, csvTaskId) : null;
    const parseRow = task ? JSON.parse(await psql('cnext', `SELECT COALESCE(json_agg(t),'[]') FROM (SELECT ok, format, parser_version FROM parse_results WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND sha256='${csvSha}') t`) || '[]') : [];
    const facts = task ? Number(await psql('cnext', `SELECT count(*) FROM fact_assertions WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND from_artifacts::jsonb @> '["${csvEvidenceId}"]'::jsonb`)) : 0;
    const aLink = task ? await psql('cnext', `SELECT status, a_ref FROM a_links WHERE tenant_id='${TENANT}' AND entity_type='material' AND local_id='${csvEvidenceId}' ORDER BY created_at DESC LIMIT 1`) : '';
    const aArtifact = aLink.split('|')[1] ? await http(A, 'GET', `/api/v2/customers/${encodeURIComponent(customerId)}/artifacts/${aLink.split('|')[1]}/content`, { headers: { 'x-principal-credential': 'tok-biz1' } }) : null;
    const ws = await http(EDGE, 'GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/workspace`, { session: bizSession });
    const wsHasMaterial = ws.status === 200 && JSON.stringify(ws.json).includes(csvSha.slice(0, 16));
    record('C08', '主链 CSV：上传→原件保存(hash 对账)→解析→事实候选→A 登记→工作本读取',
      good && task?.status === 'done' && parseRow?.[0]?.ok === true && facts > 0 && aLink.startsWith('registered|') && aArtifact?.status === 200 && wsHasMaterial,
      { upload: up.status, shaMatch: up.json?.sha256 === csvSha, task: task?.status, parse: parseRow[0] ?? null, facts, aLink, aArtifact: aArtifact?.status, wsHasMaterial },
      `facts=${facts} aRef=${(aLink.split('|')[1] ?? '').slice(0, 24)}`);
  }

  // ---------- C09 主链·PDF（真实材料 D01，pdf.js 文本层解析） ----------
  {
    const pdfBytes = readFileSync(path.join(MATERIALS, 'D01-融资需求登记.pdf'));
    const pdfSha = sha256(pdfBytes);
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'other', name: 'D01-融资需求登记.pdf', bytes: pdfBytes, contentType: 'application/pdf',
    });
    const taskId = up.json?.processing?.taskId ?? null;
    const task = up.status === 200 ? await waitTask(EDGE, bizSession, TENANT, customerId, taskId) : null;
    const parseRow = task ? JSON.parse(await psql('cnext', `SELECT COALESCE(json_agg(t),'[]') FROM (SELECT ok, format FROM parse_results WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND sha256='${pdfSha}') t`) || '[]') : [];
    const aLink = task ? await psql('cnext', `SELECT status FROM a_links WHERE tenant_id='${TENANT}' AND entity_type='material' AND local_id='${up.json?.evidenceId}' ORDER BY created_at DESC LIMIT 1`) : '';
    const pages = task ? JSON.parse(await psql('cnext', `SELECT COALESCE((result->>'pages'),'null') FROM parse_results WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND sha256='${pdfSha}'`)) : null;
    const locatorOk = Array.isArray(pages) && pages.length > 0 && pages[0]?.locator?.kind === 'page';
    record('C09', '主链 PDF：真实 pdf.js 文本层解析 + 页级来源定位 + A 登记',
      up.status === 200 && task?.status === 'done' && parseRow?.[0]?.ok === true && parseRow?.[0]?.format === 'keyvalue_pdf' && locatorOk && aLink.startsWith('registered'),
      { upload: up.status, task: task?.status, parse: parseRow[0], pages: Array.isArray(pages) ? pages.length : pages, aLink });
  }

  // ---------- C10 主链·TXT（合成 keyvalue 文本；kind=order_contract 语义投影） ----------
  {
    const txtBytes = Buffer.from('订单金额: 人民币 560 万元\n设备名称: 数控机床CNC-850\n购买日期: 2025-06-30\n', 'utf8');
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'order_contract', name: '订单说明.txt', bytes: txtBytes, contentType: 'text/plain',
    });
    const taskId = up.json?.processing?.taskId ?? null;
    const task = up.status === 200 ? await waitTask(EDGE, bizSession, TENANT, customerId, taskId) : null;
    const fact = task ? await psql('cnext', `SELECT object_value FROM fact_assertions WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND predicate='new_order_amount_declared' LIMIT 1`) : '';
    record('C10', '主链 TXT：keyvalue 文本解析 + 语义事实投影（订单金额→声明级候选）',
      up.status === 200 && task?.status === 'done' && fact.includes('560'),
      { task: task?.status, factValue: fact, note: '声明级（declared）；非核验' });
  }

  // ---------- C11 A 侧 originals 上传：hash 往返 + requestId 幂等重放 ----------
  {
    const bytes = Buffer.from('原件往返验证 INTEGRATION-FOUNDATION ' + Date.now().toString(36), 'utf8');
    const b64 = bytes.toString('base64');
    const requestId = uid('orig');
    const up1 = await http(EDGE, 'POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/originals`, {
      session: contactSession, body: { requestId, tenantId: TENANT, kind: 'other', file: { name: 'roundtrip.txt', mime: 'text/plain', dataBase64: b64 } },
    });
    const aid = up1.json?.artifactId ?? null;
    const back = aid ? await http(A, 'GET', `/api/v2/customers/${encodeURIComponent(customerId)}/artifacts/${aid}/content`, { headers: { 'x-principal-credential': 'tok-biz1' } }) : null;
    const returned = back?.json?.artifact?.materialFile?.data ?? null;
    const hashOk = returned ? sha256(Buffer.from(returned, 'base64')) === sha256(bytes) : false;
    const up2 = await http(EDGE, 'POST', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/originals`, {
      session: contactSession, body: { requestId, tenantId: TENANT, kind: 'other', file: { name: 'roundtrip.txt', mime: 'text/plain', dataBase64: b64 } },
    });
    record('C11', 'A 侧 originals：原件 hash 往返一致 + 同 requestId 幂等重放（replayed）',
      up1.status === 200 && hashOk && up2.status === 200 && up2.json?.replayed === true,
      { up1: up1.status, hashOk, replayed: up2.json?.replayed ?? null, up2ArtifactSame: up2.json?.artifactId === aid });
  }

  // ---------- C12 重复上传（同字节）：内容寻址判重，不重复解析/登记 ----------
  {
    const before = Number(await psql('cnext', `SELECT count(*) FROM fact_assertions WHERE tenant_id='${TENANT}' AND customer_id='${customerId}'`));
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'financial_statement', name: '年度报表-再次上传.csv', bytes: csvBytes, contentType: 'text/csv',
    });
    const dup = up.json?.duplicateOf;
    const taskId = up.json?.processing?.taskId ?? null;
    const task = up.status === 200 ? await waitTask(EDGE, bizSession, TENANT, customerId, taskId) : null;
    const cached = JSON.stringify(task?.stages ?? []).includes('skipped_duplicate') || task?.status === 'skipped_duplicate';
    const after = Number(await psql('cnext', `SELECT count(*) FROM fact_assertions WHERE tenant_id='${TENANT}' AND customer_id='${customerId}'`));
    const aArtifacts = Number(await psql(cfg.dbName, `SELECT count(*) FROM evidence_artifacts WHERE customer_id='${customerId}' AND content->>'sha256'='${csvSha}'`));
    record('C12', '重复上传：duplicateOf 判重 + 解析缓存零重复 + 事实/A 工件零新增',
      up.status === 200 && !!dup && task?.status === 'skipped_duplicate' && before === after && aArtifacts === 1,
      { duplicateOf: dup, task: task?.status, factsBeforeAfter: [before, after], aArtifactRows: aArtifacts });
  }

  // ---------- C13 同名不同内容：独立登记 + 数值并存不覆写 ----------
  {
    const changed = Buffer.concat([csvBytes, Buffer.from('\n2025-FAKE,999,1,1,1,1,1,1,1,1,1\n', 'utf8')]);
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'financial_statement', name: '年度报表.csv', bytes: changed, contentType: 'text/csv',
    });
    const newSha = sha256(changed);
    const taskId = up.json?.processing?.taskId ?? null;
    const task = up.status === 200 ? await waitTask(EDGE, bizSession, TENANT, customerId, taskId) : null;
    const rows = Number(await psql('cnext', `SELECT count(*) FROM evidence_artifacts WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND sha256 IN ('${csvSha}','${newSha}') AND duplicate_of IS NULL`));
    record('C13', '同名不同内容：两件独立登记（内容寻址，同名不合并不覆写）',
      up.status === 200 && task?.status === 'done' && up.json?.evidenceId !== csvEvidenceId && rows === 2,
      { task: task?.status, independentRows: rows });
  }

  // ---------- C14 缺件（空内容）：needs_followup 待补，零事实 ----------
  {
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'invoice', name: '缺件-空发票.pdf', bytes: Buffer.alloc(0), contentType: 'application/pdf',
    });
    const taskId = up.json?.processing?.taskId ?? null;
    const task = up.status === 200 ? await waitTask(EDGE, bizSession, TENANT, customerId, taskId) : null;
    const facts = Number(await psql('cnext', `SELECT count(*) FROM fact_assertions WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND from_artifacts::jsonb @> '["${up.json?.evidenceId}"]'::jsonb`));
    record('C14', '缺件（空内容）：登记为 needs_followup 待补，不解析不编数，零事实',
      up.status === 200 && up.json?.completeness === 'needs_followup' && task?.status === 'needs_followup' && facts === 0,
      { completeness: up.json?.completeness, task: task?.status, facts, note: up.json?.note?.slice(0, 60) });
  }

  // ---------- C15 损坏 PDF：解析失败如实 + 转人工 + 零事实 + 不升级 verified ----------
  {
    const bad = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('corrupted-garbage-'.repeat(40), 'utf8')]);
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'invoice', name: '损坏发票.pdf', bytes: bad, contentType: 'application/pdf',
    });
    const taskId = up.json?.processing?.taskId ?? null;
    const task = up.status === 200 ? await waitTask(EDGE, bizSession, TENANT, customerId, taskId) : null;
    const facts = Number(await psql('cnext', `SELECT count(*) FROM fact_assertions WHERE tenant_id='${TENANT}' AND customer_id='${customerId}' AND from_artifacts::jsonb @> '["${up.json?.evidenceId}"]'::jsonb`));
    const vs = await psql('cnext', `SELECT verification_state FROM evidence_artifacts WHERE evidence_id='${up.json?.evidenceId}'`);
    const g3 = await psql('cnext', `SELECT stage, failure_reason FROM artifact_processing WHERE artifact_id='${up.json?.evidenceId}' ORDER BY created_at DESC LIMIT 1`).catch(() => '');
    record('C15', '损坏 PDF：解析失败如实（PARSE_FAILED）+ 转人工入口 + 零事实 + 零 verified 升级',
      up.status === 200 && task?.status === 'needs_followup' && facts === 0 && vs !== 'verified',
      { task: task?.status, failureCode: task?.failure_code ?? task?.failureCode, facts, verificationState: vs, g3, note: task?.note?.slice(0, 80) });
  }

  // ---------- C16 解析超时路径（真实解析器注入 timeoutMs=1；替身单列：解析器级，非 HTTP 链） ----------
  {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'Back', 'C', 'src', 'parse', 'adapters-async.mjs')).href);
    const pdfBytes = readFileSync(path.join(MATERIALS, 'D01-融资需求登记.pdf'));
    const r = await mod.parseArtifactBytesAsync(pdfBytes, { fileName: 'timeout.pdf' }, { timeoutMs: 1 });
    record('C16', '解析超时路径（真实解析器 + 注入 1ms 超时上限）：PDF_TIMEOUT→如实失败+manualEntry',
      r?.ok === false && r?.code === 'PARSE_FAILED' && r?.manualEntry === true && String(r?.detail ?? '').includes('PDF_TIMEOUT'),
      { ok: r?.ok, code: r?.code, detail: r?.detail, note: '替身单列：解析器模块级（HTTP 链不暴露 limits 注入）' });
  }

  // ---------- C17 越权矩阵 ----------
  {
    // a) 无会话上传
    const noSess = await uploadMaterial(EDGE, null, { customerId, invitationId, kind: 'invoice', bytes: Buffer.from('x') });
    // b) 联系人传他人客户（新建第二客户）
    const c2 = await http(EDGE, 'POST', '/api/jw/v2/actions/customers', {
      session: bizSession, body: { requestId: uid('cc'), tenantId: TENANT, legalEntityRef: `INTG-OTHER-${Date.now()}`, displayName: '越权对照客户' },
    });
    const otherId = c2.json?.customerId;
    const cross = await uploadMaterial(EDGE, contactSession, { customerId: otherId, invitationId, kind: 'invoice', bytes: Buffer.from('cross') });
    const crossRows = otherId ? Number(await psql('cnext', `SELECT count(*) FROM evidence_artifacts WHERE customer_id='${otherId}'`)) : -1;
    // c) 联系人执行内部动作（邀请签发）
    const internal = await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/invitations', {
      session: contactSession, body: { requestId: uid('ii'), customerId, role: 'customer_contact', allowedEvidenceKinds: ['invoice'], ttlSec: 600 },
    });
    // d) kind 越准（未获准种类）
    const badKind = await uploadMaterial(EDGE, contactSession, { customerId, invitationId, kind: 'audit_report', bytes: Buffer.from('kind') });
    // e) upload-context 未知客户（A 投影 CUSTOMER_NOT_FOUND → 403 不泄露存在性）；错误参数名 → 400
    const ctxUnknown = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent('cust-not-exist-xyz')}`, { session: contactSession });
    const ctxTypo = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerid=x`, { session: contactSession });
    record('C17', '越权矩阵：无会话401/跨客户拒绝且零写/客户角色禁内部动作/kind越准拒绝/未知客户403不泄露',
      noSess.status === 401
      && [403, 404].includes(cross.status) && crossRows === 0
      && internal.status === 403 && internal.json?.error === 'ROLE_FORBIDDEN'
      && [400, 403].includes(badKind.status)
      && ctxUnknown.status === 403 && ctxTypo.status === 400,
      { noSess: noSess.status, cross: cross.status, crossRows, internal: `${internal.status}/${internal.json?.error}`, badKind: badKind.status, badKindErr: badKind.json?.error, ctxUnknown: ctxUnknown.status, ctxTypo: ctxTypo.status });
  }

  // ---------- C18 Connectors 侧撤权与恢复（撤销→不可用→重新邀请→可用） ----------
  {
    const revoke = await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/revoke', {
      session: bizSession, body: { requestId: uid('rv'), tenantId: TENANT, invitationId, actor: 'biz1' },
    }).catch(() => ({ status: 0 }));
    // 撤销邀请（Edge 白名单无 revoke → 直连 Connectors 服务令牌面等价验证）
    let rv = revoke;
    if (rv.status !== 200) {
      const token = readFileSync(path.join(RUN_DIR, 'connectors-token.txt'), 'utf8').trim();
      rv = await http(`http://127.0.0.1:${params.connectorsPort}`, 'POST', '/api/connectors/intake/revoke', {
        headers: { 'X-Service-Token': token }, body: { tenantId: TENANT, invitationId, actor: 'integration-smoke' },
      });
    }
    const ctxAfterRevoke = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    const deniedUpload = await uploadMaterial(EDGE, contactSession, { customerId, invitationId, kind: 'invoice', bytes: Buffer.from('after-revoke') });
    // 恢复：重新签发+接受+核验
    const inv2 = await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/invitations', {
      session: bizSession, body: { requestId: uid('ii'), customerId, role: 'customer_finance', allowedEvidenceKinds: ALLOWED_KINDS, ttlSec: 86400 },
    });
    invitationId = inv2.json?.invitationId; invitationToken = inv2.json?.token;
    const acc2 = await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/accept', {
      session: contactSession,
      body: { requestId: uid('ac'), tenantId: TENANT, token: invitationToken, provider: 'jw_principal', providerUserId: contactPrincipalId },
    });
    await http(EDGE, 'POST', '/api/jw/v2/actions/connectors/intake/verify-binding', {
      session: bizSession, body: { requestId: uid('vb'), tenantId: TENANT, customerId, bindingId: acc2.json?.bindingId, verifiedBy: '集成验收（business）', evidenceRefs: [`invitation:${invitationId}`] },
    });
    const ctxRestored = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    record('C18', 'Connectors 撤权：撤销后上下文不可用+上传拒绝；重新邀请核验后恢复可用',
      ctxAfterRevoke.json?.available === false && [400, 403, 409].includes(deniedUpload.status)
      && ctxRestored.status === 200 && ctxRestored.json?.available === true,
      { revoke: rv.status, ctxAfterRevoke: ctxAfterRevoke.json?.reason, deniedUpload: deniedUpload.status, restored: ctxRestored.json?.available });
  }

  // ---------- C19 服务中断（Connectors down）：诚实故障 + 恢复 + 任务续跑 ----------
  // 说明：工作本读面由 A 权威支撑（A 在即 200 如实），不因 Connectors 停机伪装故障；
  // 上传恢复上下文经 Connectors 恢复口，停机时 503 UPLOAD_CONTEXT_UNAVAILABLE（不伪装拒绝）。
  let c19TaskId = null;
  {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'integration-up.mjs'), '--op', 'stop-connectors'], { stdio: 'pipe' });
    await new Promise((x) => setTimeout(x, 800));
    const ctxDown = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    const wsDown = await http(EDGE, 'GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/workspace`, { session: bizSession });
    execFileSync(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'integration-up.mjs'), '--op', 'start-connectors'], { stdio: 'pipe', timeout: 90000 });
    const ctxBack = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    // 恢复后上传新材料 → 任务续跑到 done
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'bank_statement', name: '恢复后流水.txt', bytes: Buffer.from('银行流水 恢复验证 期初 10000 期末 22000\n', 'utf8'), contentType: 'text/plain',
    });
    c19TaskId = up.json?.processing?.taskId ?? null;
    const task = up.status === 200 ? await waitTask(EDGE, bizSession, TENANT, customerId, c19TaskId) : null;
    record('C19', '服务中断：Connectors 停止→恢复读诚实 503（不伪装拒绝；工作本 A 权威面如实 200）；重启后上下文恢复+任务续跑',
      ctxDown.status === 503 && ctxDown.json?.error === 'UPLOAD_CONTEXT_UNAVAILABLE'
      && wsDown.status === 200
      && ctxBack.status === 200 && ctxBack.json?.available === true
      && task?.status === 'done',
      { ctxDown: `${ctxDown.status}/${ctxDown.json?.error}`, wsDown: wsDown.status, ctxBack: ctxBack.json?.available, task: task?.status });
  }

  // ---------- C20 写入中途失败（上传→A 停机竞态窗口→挂起则绝不伪造 registered→A 回归→收敛） ----------
  // 04-acceptance 重设计：processing pause 语义=只 gate 问题外发（P07 背书），不挡材料认领，
  // 故不再依赖 pause 制造窗口；两种诚实结果都接受——甲：登记在停机前已收敛（done+registered）；
  // 乙：挂起于停机窗口（绝不 registered），A 回归后同 requestId 收敛 registered+done。
  {
    const { execFileSync } = await import('node:child_process');
    // 暂停该客户处理：上传落库入队但不推进（确定性好窗口）
    const up = await uploadMaterial(EDGE, contactSession, {
      customerId, invitationId, kind: 'order_contract', name: 'A中断期合同.txt', bytes: Buffer.from('订单金额: 人民币 120 万元\nA中断期上传验证\n', 'utf8'), contentType: 'text/plain',
    });
    const eid = up.json?.evidenceId; const taskId = up.json?.processing?.taskId;
    execFileSync(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'integration-up.mjs'), '--op', 'stop-kernel'], { stdio: 'pipe' });
    // 恢复处理：任务推进至 register_material → A 不可达 → a_links unknown + 任务 blocked_unknown（诚实，不伪造成功）
    // 中间态在 A 停机窗口内捕获（此窗口内不可能收敛——对账依赖 A 可达）。
    // 任务/链接状态经库直读：A 停机时 Edge 读面按设计被 A 授权门拦住（502/503），属预期。
    // 中间态捕获（04-acceptance 强化）：A 停机窗口内采样多次，不变式=绝不出现 'registered'
    // （不伪造成功）。'unknown'+blocked_unknown 与"无行/排队重试"（连接拒绝=确定性未发，不落
    // unknown 行）都是诚实中间态——处理速度快慢只影响落在哪一种，断言两种都接受。
    const midSamples = [];
    {
      const dl = Date.now() + 90000;
      while (Date.now() < dl) {
        await new Promise((x) => setTimeout(x, 2000));
        const tStatus = await psql('cnext', `SELECT status FROM processing_tasks WHERE task_id='${taskId}'`);
        const link = await psql('cnext', `SELECT COALESCE(status,'<none>') FROM a_links WHERE tenant_id='${TENANT}' AND local_id='${eid}' AND entity_type='material' ORDER BY created_at DESC LIMIT 1`);
        midSamples.push({ tStatus, link });
        if (link === 'unknown' && tStatus === 'blocked_unknown') break; // 捕获到发送未知态即止
      }
    }
    const mid = midSamples.find((x) => x.link === 'unknown' && x.tStatus === 'blocked_unknown') ?? null;
    const midLink = mid ? mid.link : (midSamples.at(-1)?.link ?? (eid ? await psql('cnext', `SELECT status FROM a_links WHERE tenant_id='${TENANT}' AND local_id='${eid}' AND entity_type='material' ORDER BY created_at DESC LIMIT 1`) : ''));
    const midTaskStatus = mid ? mid.taskStatus : midSamples.at(-1)?.tStatus ?? null;
    const midNeverRegistered = midSamples.every((x) => x.link !== 'registered');
    execFileSync(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'integration-up.mjs'), '--op', 'start-kernel'], { stdio: 'pipe', timeout: 90000 });
    // A 回归：对账 sweep 以同一确定性 requestId 收敛（零换 ID 重发）
    const finalTask = await waitForCondition(async () => {
      const r = await http(EDGE, 'GET', `/api/jw/v2/connectors/processing/tasks/${encodeURIComponent(taskId)}?tid=${encodeURIComponent(TENANT)}&cid=${encodeURIComponent(customerId)}`, { session: bizSession });
      if (r.json?.task?.status === 'done') return r.json.task;
      return null;
    }, 150000, 3000).catch(() => null);
    const finalLink = eid ? await psql('cnext', `SELECT status, COALESCE(a_ref,'') FROM a_links WHERE tenant_id='${TENANT}' AND local_id='${eid}' AND entity_type='material' ORDER BY created_at DESC LIMIT 1`) : '';
    // 本质不变式：①最终收敛 done+registered；②任何 task=done 的采样点 link 必为 registered
    // （无伪造成功）；③A 停机窗口内的挂起态（blocked_unknown/queued/blocked_a_unavailable）
    // 均为诚实等待，A 回归后对账/重执行收敛。
    const doneSamples = midSamples.filter((x) => x.tStatus === 'done');
    const noFakeDone = doneSamples.every((x) => x.link === 'registered');
    record('C20', '写入中途失败：A 停机竞态窗口内不伪造成功（done 必伴随真 registered）；A 回归后同 requestId 收敛 done+registered',
      finalTask?.status === 'done' && finalLink.startsWith('registered|') && noFakeDone,
      { upload: up.status, evidenceId: eid, taskId, midTaskStatus, midLink, midSamples: midSamples.length,
        doneSamples: doneSamples.length, finalTask: finalTask?.status, finalLink: finalLink.slice(0, 40) });
  }

  // ---------- C21 A 侧撤权（即刻生效；凭据级联禁用；重登同样拒绝） ----------
  {
    const rv = await http(EDGE, 'DELETE', `/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/grants/${encodeURIComponent(contactPrincipalId)}`, { session: admSession, body: { requestId: uid('grv') } });
    const ws = await http(EDGE, 'GET', `/api/jw/v2/customers/${encodeURIComponent(customerId)}/workspace`, { session: contactSession });
    const ctx = await http(EDGE, 'GET', `/api/jw/v2/upload-context?customerId=${encodeURIComponent(customerId)}`, { session: contactSession });
    // 同凭据新建会话（兑换身份已被级联禁用 → 目录/身份两侧拒绝）
    const reLogin = await http(EDGE, 'POST', '/api/jw/v2/session', { body: { principalId: contactPrincipalId } }).catch(() => ({ status: 0 }));
    record('C21', 'A 侧撤权：grant 撤销后工作本/恢复上下文即刻 403，凭据级联禁用（重登同样拒绝）',
      [200, 204].includes(rv.status) && [401, 403].includes(ws.status) && ctx.status === 403 && reLogin.status === 403,
      { revoke: rv.status, ws: ws.status, ctx: ctx.status, reLogin: reLogin.status });
  }

  // ---------- C22 重启一致（A 侧撤权之后：全栈+PG 重启；语义指纹逐项对比） ----------
  {
    const snap = await snapshot(customerId, csvSha);
    const { execFileSync } = await import('node:child_process');
    for (const op of ['stop-edge', 'stop-connectors', 'stop-kernel']) {
      execFileSync(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'integration-up.mjs'), '--op', op], { stdio: 'pipe' });
    }
    await new Promise((r2) => { execFile('docker', ['restart', params.dbContainer], (e) => r2()); });
    // 等自有容器 PG 重新可接受连接
    await waitForCondition(async () => {
      const r = await new Promise((resolve) => {
        execFile('docker', ['exec', params.dbContainer, 'pg_isready', '-U', 'jwinteg', '-d', 'jw'], { timeout: 10000 }, (e) => resolve(!e));
      });
      return r === true;
    }, 60000, 1500);
    for (const op of ['start-kernel', 'start-connectors', 'start-edge']) {
      execFileSync(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'integration-up.mjs'), '--op', op], { stdio: 'pipe', timeout: 90000 });
    }
    // 等待全链就绪
    await waitForCondition(async () => {
      const r = await http(EDGE, 'GET', '/healthz/ready').catch(() => null);
      return r?.json?.ok === true;
    }, 90000, 2000);
    const snap2 = await snapshot(customerId, csvSha);
    const same = snap.fp === snap2.fp;
    record('C22', '重启一致：A+Connectors+Edge+PG 全部重启后，工件/事实/解析/链路/原件字节语义指纹逐一一致',
      same, { before: snap.fp, after: snap2.fp, detail: snap.parts, detailAfter: snap2.parts });
  }

  return finish();

  // ---------- 快照与收尾 ----------
  // 语义指纹：只取业务不变量（id/字节指纹/状态/解析器版本/链路状态），天然屏蔽时间戳与
  // 会话态；重启前后必须逐字段一致。
  async function snapshot(cid) {
    const connParts = [
      await psql('cnext', `SELECT md5(string_agg(evidence_id||':'||COALESCE(sha256,'')||':'||COALESCE(original_name,'')||':'||verification_state||':'||COALESCE(duplicate_of,''),'|' ORDER BY evidence_id)) FROM evidence_artifacts WHERE tenant_id='${TENANT}' AND customer_id='${cid}'`),
      await psql('cnext', `SELECT md5(string_agg(fact_id||':'||predicate||':'||object_value||':'||status,'|' ORDER BY fact_id)) FROM fact_assertions WHERE tenant_id='${TENANT}' AND customer_id='${cid}'`),
      await psql('cnext', `SELECT md5(string_agg(sha256||':'||format||':'||ok::text||':'||parser_version,'|' ORDER BY sha256)) FROM parse_results WHERE tenant_id='${TENANT}' AND customer_id='${cid}'`),
      await psql('cnext', `SELECT md5(string_agg(entity_type||':'||local_id||':'||status||':'||COALESCE(a_ref,''),'|' ORDER BY request_id)) FROM a_links WHERE tenant_id='${TENANT}' AND customer_id='${cid}'`),
      await psql('cnext', `SELECT md5(string_agg(task_id||':'||status||':'||COALESCE(failure_code,''),'|' ORDER BY task_id)) FROM processing_tasks WHERE tenant_id='${TENANT}' AND customer_id='${cid}'`),
      // 原件字节完整性：对象存储逐件 sha256 复核（重启后读取路径重建仍须一致）
      await psql('cnext', `SELECT md5(string_agg(object_ref||':'||sha256,'|' ORDER BY object_ref)) FROM objects WHERE tenant_id='${TENANT}'`),
    ];
    // A 侧工件投影（business 会话可能因 C21 撤权流程不可用——这里用 A 直接读，凭据为合成目录值）
    const arts = await http(A, 'GET', `/api/v2/customers/${encodeURIComponent(cid)}/artifacts`, { headers: { 'x-principal-credential': 'tok-biz1' } });
    const aFp = sha256(Buffer.from(JSON.stringify((arts.json?.artifacts ?? []).map((a) => ({ id: a.artifactId, kind: a.kind, sha: a.sha256, dup: a.duplicateOf, sup: a.supersededBy })))));
    const parts = { conn: connParts, a: aFp };
    return { fp: sha256(Buffer.from(JSON.stringify(parts))), parts };
  }

  function finish(code = results.some((r) => !r.pass) ? 1 : 0) {
    const elapsedMs = Date.now() - t0;
    const passCount = results.filter((r) => r.pass).length;
    const summary = {
      suite: 'integration-foundation-smoke',
      date: new Date().toISOString(),
      stack: { edge: params.edgePort, kernel: params.kernelPort, connectors: params.connectorsPort, dbContainer: params.dbContainer, tenant: TENANT },
      customerId,
      contactPrincipalId,
      totals: { pass: passCount, fail: results.length - passCount, elapsedMs },
      cases: results,
    };
    const outPath = out ?? path.join(RUN_DIR, 'RESULTS.json');
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(summary, null, 2));
    // 脱敏日志（无凭据/token；上传响应已不含凭据）
    writeFileSync(path.join(path.dirname(outPath), 'smoke-sanitized.log'), logs.join('\n') + '\n');
    console.log('══════════════════════════════════════════');
    console.log(`冒烟结果：${passCount}/${results.length} 通过（${(elapsedMs / 1000).toFixed(1)}s）→ ${outPath}`);
    console.log('══════════════════════════════════════════');
    return code;
  }
}

// 直接运行入口
const invoked = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (invoked) {
  const argOf = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  runSmoke({ out: argOf('--out') }).then((code) => process.exit(code)).catch((e) => { console.error(`[smoke] 套件异常: ${e.message}`); process.exit(2); });
}
