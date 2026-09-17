// goal-04 完整新业务链（E1 级）：goal-04 独立验收路自有链路模块。
// 与 task3-boot 同端口纪律但使用独立段：PG 15438 / A 内核 17923（避开任务三 E1 段 15434/17919
// 与其自验段 15436/17921，防止并行 writer 互撞）；资源用后即毁。
// 关键差异：内核【不带 --allow-legacy-basis】，带 --required-domains-policy（synthetic 种子）——
// 验收的是 v2.2 新前提全链：进件→材料→四域（Gate 回执+分析运行+域结果）→检查会话→定向提问→
// 回答/补证→对象级核验→依据包冻结→人工决定→两笔共同预占→不利证据阻断→中断恢复。
// 全部业务推进经真实 HTTP API；白盒注入仅限权限矩阵/必需域政策种子（psql，标 synthetic）。
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NINE_PRINCIPALS, run, waitHttp } from './task3-boot.mjs';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');

export const G04_PG_PORT = 15438;
export const G04_API_PORT = 17923;
export const TENANT = 't1';
export const RULE_PACK_V1 = 'sim-pack-g04-1';
export const POLICY_VERSION = 'domreq-g04-synthetic';
export const MATRIX_VERSION = 'm-g04';

// 九角色 + admin(setup) + 合成服务身份（四域登记执行者，authority=none）+ grant 制业务二槽（撤权判据用）
export const G04_PRINCIPALS = [
  NINE_PRINCIPALS,
  'tok-fin1=fin1:human:finance:all:t1',                     // 财务（任务书九角色之财务口径回答者）
  'tok-svc=svc1:service:policy+credit+commerce+asset:all:t1',
  'tok-biz2=biz2:human:business:all:t1:grant',
].join(',');

const wan = (n) => n * 1_000_000;
const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const DOMAINS = ['policy', 'credit', 'commerce', 'asset'];

/** 等待自家内核日志出现 listening——比 healthz 更强：healthz 可能打到上一轮幸存内核。 */
async function waitKernelListening(logFile, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (readFileSync(logFile, 'utf8').includes('listening http')) return true;
    } catch { }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** 读取 SSE 帧直到超时；返回 {event,data,id} 数组。 */
export async function readSse(base, pathUrl, headers, { timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const frames = [];
  try {
    const res = await fetch(`${base}${pathUrl}`, { headers, signal: controller.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = { event: null, data: null, id: null };
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) ev.event = line.slice(6).trim();
            else if (line.startsWith('data:')) ev.data = line.slice(5).trim();
            else if (line.startsWith('id:')) ev.id = line.slice(3).trim();
          }
          if (ev.event) frames.push(ev);
        }
      }
    } catch { /* 超时中断即停止读取 */ }
  } catch { /* abort */ }
  clearTimeout(timer);
  return frames;
}

/** goal-04 自有栈引导：隔离 PG(15438) → 全迁移(A 内核自动) → 合成种子 → A 内核(17923，无 legacy 开关) → live Edge。 */
export async function bootG04({ runName, onProgress = () => { } } = {}) {
  const RUN_DIR = path.join(EDGE_ROOT, '.run', runName);
  const DB = `v7d_${runName.replace(/-/g, '_')}`;
  mkdirSync(RUN_DIR, { recursive: true });
  const cleanupTasks = [];

  const pgctl = await import('../../../D/harness/pgctl.mjs');
  const pg = await pgctl.ensurePg({ runDir: RUN_DIR, port: G04_PG_PORT, db: 'v7d_boot' });
  cleanupTasks.push(() => pgctl.destroyPg(pg.name));
  // 中途失败（内核起不来等）也回收已创建资源，不再遗留占 15438
  const bail = async (err) => { for (const fn of [...cleanupTasks].reverse()) { try { await fn(); } catch { } } throw err; };
  await run('docker', ['exec', pg.name, 'psql', '-U', 'v7next', '-d', 'v7d_boot', '-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
  await pgctl.createDb(pg.name, DB);

  const applied = readdirSync(path.join(BACK_ROOT, 'A', 'migrations')).filter((f) => f.endsWith('.sql')).sort();

  const dsn = `postgres://v7next:v7next@127.0.0.1:${G04_PG_PORT}/${DB}`;
  const kernelLogFd = openSync(path.join(RUN_DIR, 'kernel.log'), 'w');
  const kernelArgs = [path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(G04_API_PORT), '--db', dsn,
    '--principal-tokens', G04_PRINCIPALS, '--credit-matrix', MATRIX_VERSION, '--credit-concentration', `c-${MATRIX_VERSION}`,
    '--required-domains-policy', POLICY_VERSION];
  const api = spawn(process.execPath, kernelArgs, { windowsHide: true, stdio: ['ignore', kernelLogFd, kernelLogFd] });
  api.unref();
  // F-13 会 kill+restart 内核：清理必须瞄准"当前"内核进程，而不是最初那个（否则 restart child
  // 存活占住 17923，后续轮 healthz 打到旧内核、种子落在未迁移新库——2026-09-17 实测竞态根因）
  let currentApi = api;
  cleanupTasks.push(() => { try { process.kill(currentApi.pid); } catch { } });
  const kernelBase = `http://127.0.0.1:${G04_API_PORT}`;
  const kernelListening = await waitKernelListening(path.join(RUN_DIR, 'kernel.log'));
  if (!kernelListening) return bail(new Error('g04 A 内核未就绪（kernel.log 无 listening；详见 kernel.log）'));
  onProgress({ step: 'kernel-up', applied });

  // 白盒 synthetic 种子：权限矩阵 + 必需域政策（非公司制度，演示边界；生产矩阵须公司批准录入）
  await run('docker', ['exec', pg.name, 'psql', '-U', 'v7next', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c', `
    INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
      ('${MATRIX_VERSION}','approver','facility.approve',true,${wan(1000)}),
      ('${MATRIX_VERSION}','approver','facility.activate',true,NULL),
      ('${MATRIX_VERSION}','approver','facility.suspend',true,NULL),
      ('${MATRIX_VERSION}','business','fr.confirm-external',true,${wan(1000)})
    ON CONFLICT (matrix_version, role, action) DO NOTHING;
    INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
      ('${POLICY_VERSION}','policy',true),('${POLICY_VERSION}','credit',true),
      ('${POLICY_VERSION}','commerce',true),('${POLICY_VERSION}','asset',true)
    ON CONFLICT DO NOTHING;`]);
  onProgress({ step: 'seeds-applied', synthetic: true });

  // live Edge（与 scripts/server main --live 相同组件，进程内组装）
  const { startEdgeServer } = await import('../../src/server.mjs');
  const { createKernelStore } = await import('../../src/kernel-store.mjs');
  const { tcpProbe, httpProbe, aKernelReadyPass } = await import('../../src/probes.mjs');
  const { collectVersionSeal } = await import('../../src/version.mjs');
  const { createSessionStore } = await import('../../src/session.mjs');
  const { createAuditSink } = await import('../../src/audit.mjs');
  const { createUpstreamProxy } = await import('../../src/proxy.mjs');
  const { createMessageRouter } = await import('../../src/messages.mjs');

  const seal = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: { note: `g04-${runName}` } });
  const store = createKernelStore({ baseUrl: kernelBase, log: () => { } });
  const sessionStore = createSessionStore({});
  const principalByToken = new Map();
  for (const entry of G04_PRINCIPALS.split(',')) {
    const [token, spec] = entry.split('=');
    const [principalId, kind, rolesSpec] = spec.split(':');
    principalByToken.set(token, { principalId, kind, roles: rolesSpec.split('+') });
  }
  const verifyCredential = async ({ credential }) => {
    const hit = principalByToken.get(String(credential));
    return hit ? { ok: true, ...hit } : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
  };
  const auditSink = createAuditSink();
  const proxy = createUpstreamProxy({ baseUrl: kernelBase, credentialFor: (s) => s.credential });
  const sent = [];
  const messages = createMessageRouter({ deliver: async (m) => { sent.push(m); return { messageId: `m-${sent.length}`, state: 'sent_local_sink' }; }, auditSink });
  const edge = await startEdgeServer({
    port: 0, seal, store,
    probes: [
      httpProbe({ name: 'kernel-a', url: `${kernelBase}/healthz`, pass: aKernelReadyPass }),
      tcpProbe({ name: 'db', port: G04_PG_PORT }),
    ],
    auth: async ({ session }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'SESSION_REQUIRED' }),
    sessionStore, verifyCredential, proxy, messages, auditSink, staticHandler: null,
  });
  cleanupTasks.push(() => edge.close());
  const base = `http://127.0.0.1:${edge.port}`;

  const sessions = {};
  for (const [token, info] of principalByToken) {
    const r = await fetch(`${base}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: token }) });
    const j = await r.json();
    if (!j.ok) return bail(new Error(`会话交换失败 ${info.principalId}: ${JSON.stringify(j)}`));
    sessions[info.principalId] = { sessionId: j.session.sessionId, roles: j.session.roles, token };
  }

  const call = async (who, method, path, body) => {
    const s = sessions[who];
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(s ? { 'x-jw-session': s.sessionId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { }
    return { status: r.status, json };
  };
  // 直连 A（v2 新机器面：包/Gate/分析运行/检查会话/授权管理；setup 与政策种子类调用）
  const aCall = async (who, method, path, body) => {
    const token = who ? sessions[who].token : 'tok-adm1';
    const r = await fetch(`${kernelBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-principal-credential': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { }
    return { status: r.status, json };
  };

  let restartSeq = 0;
  const killKernel = () => { try { process.kill(currentApi.pid); } catch { } };
  const restartKernel = async () => {
    restartSeq += 1;
    const fd = openSync(path.join(RUN_DIR, `kernel-restart-${restartSeq}.log`), 'w');
    const child = spawn(process.execPath, kernelArgs, { windowsHide: true, stdio: ['ignore', fd, fd] });
    child.unref();
    const ok2 = await waitKernelListening(path.join(RUN_DIR, `kernel-restart-${restartSeq}.log`));
    if (!ok2) throw new Error('g04 内核重启未就绪'); // 重启失败时清理仍由外层 cleanup 承担
    currentApi = child; // 清理靶点切换到新内核进程
    return child;
  };

  return {
    base, kernelBase, sessions, call, aCall, sent, auditSink, store, seal,
    api, pg, dbName: DB, RUN_DIR, applied, cleanupTasks,
    killKernel, restartKernel,
    async cleanup() {
      for (const fn of [...cleanupTasks].reverse()) { try { await fn(); } catch { } }
    },
  };
}

/**
 * 完整新链一轮（F-01..F-22）。assert 来自调用方注入（node:test 或独立脚本）。
 * timers: {stepName: ms} 累计；meta: 返回业务 id 集合供证据落盘。
 */
export async function runFullChain(B, assert, { timers = {}, notes = [] } = {}) {
  const t0 = (k) => { timers[k] = timers[k] || 0; return performance.now(); };
  const t1 = (k, s) => { timers[k] += performance.now() - s; };
  const { call, aCall } = B;
  const T1 = TENANT;

  // ---- 版本可核对 + readiness 分立（C01/C06） ----
  const vz = await (await fetch(`${B.base}/versionz`)).json();
  assert.match(vz.buildId, /^[0-9a-f]{16}$/, 'versionz buildId 可核对');
  const ready0 = await (await fetch(`${B.base}/healthz/ready`)).json();
  assert.equal(ready0.ok, true, '全依赖在线 readiness ok');
  assert.equal(ready0.capabilities.all_ok, undefined, '禁止 all_ok 汇总');

  // ---- [F-01] 新前提生效证明：无包提案必拒 ----
  // （先建一个最小客户只为触发该拒绝路径；主客户在下节建档）
  let s = t0('t_setup_probe');
  const probe = await aCall('biz1', 'POST', '/api/v2/customers', { requestId: rid('probe'), tenantId: T1, legalEntityRef: `USCC-G04-${rid('p')}`, displayName: 'g04无包探针客户' });
  assert.equal(probe.status, 200, `探针建档: ${JSON.stringify(probe.json)}`);
  const probeArt = await aCall('cred1', 'POST', `/api/v2/customers/${probe.json.customerId}/artifacts`, {
    requestId: rid('part'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
  });
  assert.equal(probeArt.status, 200, `探针材料: ${JSON.stringify(probeArt.json)}`);
  const probeAss = await aCall('cred1', 'POST', `/api/v2/customers/${probe.json.customerId}/assessments`, {
    requestId: rid('pass'), tenantId: T1, ruleVersion: RULE_PACK_V1, evidenceSnapshot: [{ artifactId: probeArt.json.artifactId }],
  });
  assert.equal(probeAss.status, 200, `探针评估: ${JSON.stringify(probeAss.json)}`);
  await aCall('cred1', 'POST', `/api/v2/assessments/${probeAss.json.assessmentId}/candidate`, {
    requestId: rid('pcand'), tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: wan(100), producedBy: 'g04-probe' },
  });
  await aCall('cred1', 'POST', `/api/v2/assessments/${probeAss.json.assessmentId}/submit-review`, { requestId: rid('psr'), tenantId: T1 });
  const noPkg = await aCall('cred1', 'POST', `/api/v2/customers/${probe.json.customerId}/facilities`, {
    requestId: rid('prop'), tenantId: T1, assessmentId: probeAss.json.assessmentId, approvedAmountMinor: wan(100), currency: 'CNY',
  });
  assert.equal(noPkg.status, 409, `无包提案应 409: ${JSON.stringify(noPkg.json)}`);
  assert.match(String(noPkg.json?.error ?? ''), /BASIS_PACKAGE_REQUIRED/, '无包提案=BASIS_PACKAGE_REQUIRED（证明未启用 allow-legacy-basis）');
  t1('t_setup_probe', s);

  // ---- [F-02] 受控进件（经 Edge 动作代理）+ 幂等/冲突 ----
  s = t0('t_intake');
  const custRid = rid('cust');
  const custPayload = { requestId: custRid, tenantId: T1, legalEntityRef: `USCC-G04-${rid('e')}`, displayName: '合成精密机械（g04验收链）' };
  const c1 = await call('biz1', 'POST', '/api/jw/v2/actions/customers', custPayload);
  assert.equal(c1.status, 200, `建档失败: ${JSON.stringify(c1.json)}`);
  const customerId = c1.json.customerId;
  const c1replay = await call('biz1', 'POST', '/api/jw/v2/actions/customers', { ...custPayload });
  assert.equal(c1replay.json.replayed, true, '同 requestId 同载荷重放 → replayed:true');
  const c1conflict = await call('biz1', 'POST', '/api/jw/v2/actions/customers', { ...custPayload, requestId: rid('cust') });
  assert.equal(c1conflict.status, 409, '同租户同主体新 requestId → 409');
  assert.equal(c1conflict.json.error, 'CUSTOMER_EXISTS');
  t1('t_intake', s);

  // ---- [F-15a] 匿名/未知客户边界 ----
  const wsAnon = await call(null, 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(wsAnon.status, 403, '无会话 workspace → 403');
  assert.equal(wsAnon.json.error, 'SESSION_REQUIRED');
  const wsNone = await call('biz1', 'GET', `/api/jw/v2/customers/cust-not-exist/workspace`);
  assert.equal(wsNone.status, 404, '未知客户 404 不泄露存在性');

  // ---- [F-14/F-22] SSE 订阅（保持到链尾；帧scope 全部必须属于本客户） ----
  const sseHeaders = { 'x-jw-session': B.sessions.biz1.sessionId, accept: 'text/event-stream' };
  const ssePromise = readSse(B.base, `/api/jw/v2/customers/${customerId}/events`, sseHeaders, { timeoutMs: 15000 });
  await new Promise((r) => setTimeout(r, 600));

  // ---- [F-03] 材料登记 + 核验等级边界 ----
  s = t0('t_artifact_register');
  const art1Rid = rid('art');
  const art1 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: art1Rid, tenantId: T1, kind: 'purchase_contract', factKey: 'profile',
    content: { device: 'DEV-1', contractNo: `HT-${rid('c')}`, amountMinor: wan(120) }, grade: 'source_supported',
  });
  assert.equal(art1.status, 200, `材料登记失败: ${JSON.stringify(art1.json)}`);
  t1('t_artifact_register', s);
  const custElevate = await call('cust1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'customer_profile', factKey: 'self_profile',
    content: { self: '客户自证高等级' }, grade: 'source_supported',
  });
  assert.ok(custElevate.status >= 400, `客户申报件不得自证高等级: ${JSON.stringify(custElevate.json)}`);

  // ---- 检查会话：计划→定向提问→回答→补证→对象级核验→收口（F-04/05/06/21） ----
  s = t0('t_inspection');
  const tpl = await aCall('adm1', 'POST', '/api/v1/templates', {
    requestId: `tpl-${rid('g')}`, name: 'tpl-g04', industry: null,
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }, { roleKey: 'director', title: '厂长', isHumanRole: true }, { roleKey: 'asset', title: '资产', isHumanRole: true }, { roleKey: 'finance', title: '财务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: '尽调协作', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, `建模板(setup): ${JSON.stringify(tpl.json)}`);
  const proj = await aCall('adm1', 'POST', '/api/v1/projects', { requestId: `proj-${rid('g')}`, templateId: tpl.json.templateId, name: 'proj-g04' });
  assert.equal(proj.status, 200, `建项目(setup): ${JSON.stringify(proj.json)}`);
  const projectId = proj.json.projectId;

  const sess = await aCall('biz1', 'POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: `sess-${rid('g')}`, customerId, title: 'g04 联合尽调',
    roles: [{ roleKey: 'business', kind: 'human' }, { roleKey: 'director', kind: 'human' }, { roleKey: 'asset', kind: 'human' }, { roleKey: 'finance', kind: 'human' }],
    ownerRole: 'business',
    items: [
      { itemKey: 'equipment_verify', title: '设备在用核验', required: true, responsibleRole: 'business', targetRole: 'director', requiresHumanVerification: true, expectedEvidenceKinds: ['equipment_photo'] },
      { itemKey: 'financial_answers', title: '财务口径', required: true, responsibleRole: 'business', targetRole: 'finance', requiresHumanVerification: false, expectedEvidenceKinds: ['bank_flow'] },
    ],
  });
  assert.equal(sess.status, 200, `建会话: ${JSON.stringify(sess.json)}`);
  const sessionId = sess.json.sessionId;
  let snap = (await aCall('biz1', 'GET', `/api/v1/inspections/${sessionId}`)).json;
  const st = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/start`, { requestId: rid('st'), expectedVersion: snap.snapshot.version, acceptedPlanVersion: snap.snapshot.planVersion });
  assert.equal(st.status, 200, `开始会话: ${JSON.stringify(st.json)}`);

  const eqItem = snap.snapshot.items.find((i) => i.itemKey === 'equipment_verify');
  // F-04 定向提问（客户受众 → 厂长）
  const q1 = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/questions`, {
    requestId: rid('q'), itemId: eqItem.itemId, audience: 'customer', targetRole: 'director', purpose: 'equipment_confirm', objectRef: 'lathe-01',
    question: '车床-01 在用并附照片？',
  });
  assert.equal(q1.status, 200, `定向提问: ${JSON.stringify(q1.json)}`);
  const g1 = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/outbound/grant`, { requestId: rid('g'), questionId: q1.json.questionId, generation: 0, channel: 'chat' });
  assert.equal(g1.status, 200, `外发授权: ${JSON.stringify(g1.json)}`);
  const photo = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'equipment_photo', factKey: 'equipment', content: { deviceId: 'lathe-01' }, grade: 'unverified',
  });
  assert.equal(photo.status, 200, `设备照片登记: ${JSON.stringify(photo.json)}`);
  const ans1 = await aCall('dir1', 'POST', `/api/v1/inspections/${sessionId}/questions/${q1.json.questionId}/answer`, {
    requestId: rid('a'), answer: { text: '确认在用。', evidenceRefs: [{ artifactId: photo.json.artifactId }] },
  });
  assert.equal(ans1.status, 200, `厂长回答: ${JSON.stringify(ans1.json)}`);
  // F-21 未知外发：第二问结果 unknown → 直接重问被拒（先对账）
  const q2 = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/questions`, {
    requestId: rid('q'), itemId: eqItem.itemId, audience: 'customer', targetRole: 'director', purpose: 'equipment_confirm_b', objectRef: 'lathe-01',
    question: '车床-01 附属工装在位？',
  });
  assert.equal(q2.status, 200, `第二问: ${JSON.stringify(q2.json)}`);
  await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/outbound/grant`, { requestId: rid('g'), questionId: q2.json.questionId, generation: 0, channel: 'chat' });
  snap = (await aCall('biz1', 'GET', `/api/v1/inspections/${sessionId}`)).json;
  const send2 = snap.snapshot.outbound.inFlight.find((x) => x.questionId === q2.json.questionId);
  assert.ok(send2, '第二问在途外发可见');
  const uk = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/outbound/${send2.sendId}/result`, { requestId: rid('r'), outcome: 'unknown', note: '渠道超时无回执（synthetic 注入）' });
  assert.equal(uk.status, 200, `unknown 回执: ${JSON.stringify(uk.json)}`);
  const reask = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/questions/${q2.json.questionId}/reask`, { requestId: rid('rk') });
  assert.equal(reask.status, 409, `未知不盲重问: ${JSON.stringify(reask.json)}`);
  assert.equal(reask.json.error, 'SEND_UNKNOWN_RECONCILE');
  // 对象级核验：requiresHuman 事项由责任角色人工核验（结构拒绝非责任角色代验）
  const vfDenied = await aCall('dir1', 'POST', `/api/v1/inspections/${sessionId}/items/${eqItem.itemId}/verify`, { requestId: rid('vd'), verdict: 'confirmed' });
  assert.equal(vfDenied.status, 403, `非责任角色核验应 403: ${JSON.stringify(vfDenied.json)}`);
  const vf = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/items/${eqItem.itemId}/verify`, { requestId: rid('v'), verdict: 'confirmed' });
  assert.equal(vf.status, 200, `对象级人工核验: ${JSON.stringify(vf.json)}`);
  // F-05 财务项：先回答缺材料 → waiting_evidence → 补证解除
  snap = (await aCall('biz1', 'GET', `/api/v1/inspections/${sessionId}`)).json;
  const finItem = snap.snapshot.items.find((i) => i.itemKey === 'financial_answers');
  const q3 = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/questions`, {
    requestId: rid('q'), itemId: finItem.itemId, audience: 'internal', targetRole: 'finance', purpose: 'cashflow', question: '流水口径确认？',
  });
  assert.equal(q3.status, 200, `内部提问: ${JSON.stringify(q3.json)}`);
  const ans3 = await aCall('fin1', 'POST', `/api/v1/inspections/${sessionId}/questions/${q3.json.questionId}/answer`, {
    requestId: rid('a'), answer: { text: '财务口径确认：流水为经营性入账口径。' },
  });
  assert.equal(ans3.status, 200, `回答: ${JSON.stringify(ans3.json)}`);
  let snapNow = (await aCall('biz1', 'GET', `/api/v1/inspections/${sessionId}`)).json;
  const finStateNoEvidence = snapNow.snapshot.items.find((i) => i.itemKey === 'financial_answers').status;
  assert.equal(finStateNoEvidence, 'waiting_evidence', `回答≠材料取得（waiting_evidence）: got ${finStateNoEvidence}`);
  const bank = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'bank_flow', factKey: 'cashflow', content: { period: '2026-08', inflowMinor: wan(300) }, grade: 'source_supported',
  });
  assert.equal(bank.status, 200, `流水登记: ${JSON.stringify(bank.json.json ?? bank.json)}`);
  const late = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/evidence`, { requestId: rid('ev'), artifactId: bank.json.artifactId });
  assert.equal(late.status, 200, `补证解除等待: ${JSON.stringify(late.json)}`);
  // 收口
  snapNow = (await aCall('biz1', 'GET', `/api/v1/inspections/${sessionId}`)).json;
  const end = await aCall('biz1', 'POST', `/api/v1/inspections/${sessionId}/end`, { requestId: rid('end'), expectedVersion: snapNow.snapshot.version });
  assert.equal(end.status, 200, `结束会话: ${JSON.stringify(end.json)}`);
  assert.equal(end.json.closureStatus, 'ready_for_assessment', `收口=ready_for_assessment: ${JSON.stringify(end.json)}`);
  const closureRevision = end.json.closureRevision ?? 1;
  t1('t_inspection', s);

  // ---- [F-07] 可信 Gate 回执 ----
  s = t0('t_gate');
  const humanGate = await aCall('biz1', 'POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: RULE_PACK_V1,
  });
  assert.equal(humanGate.status, 403, `human 自报 gate 拒绝: ${JSON.stringify(humanGate.json)}`);
  const badVer = await aCall('svc1', 'POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: 'sim-pack-unactivated',
  });
  assert.ok(badVer.status >= 400, `未激活规则版本登记拒: ${JSON.stringify(badVer.json)}`);
  const act = await aCall('pol1', 'POST', '/api/v2/rule-pack-versions/activate', { requestId: rid('rp'), tenantId: T1, version: RULE_PACK_V1 });
  assert.equal(act.status, 200, `激活规则版本(policy): ${JSON.stringify(act.json)}`);
  const grR = await aCall('svc1', 'POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: RULE_PACK_V1,
  });
  assert.equal(grR.status, 200, `service 登记 CLEAR 回执: ${JSON.stringify(grR.json)}`);
  const gateReceiptId = grR.json.receiptId;
  t1('t_gate', s);

  // ---- [F-09] 依据包冻结（四必需域 + 分析运行 + 域结果） ----
  const freezePackage = async ({ gateResult, creditArtifactIds, label }) => {
    const gr = await aCall('svc1', 'POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
      requestId: rid('gr'), tenantId: T1, result: gateResult, rulesetVersion: RULE_PACK_V1,
    });
    assert.equal(gr.status, 200, `[${label}] Gate 回执 ${gateResult}: ${JSON.stringify(gr.json)}`);
    const deps = DOMAINS.map((domain) => ({ domain, artifactIds: domain === 'credit' ? creditArtifactIds : [], factKeys: [], rulePackVersion: RULE_PACK_V1 }));
    const created = await aCall('biz1', 'POST', `/api/v2/customers/${customerId}/decision-packages`, {
      requestId: `pkg-${rid(label)}`, tenantId: T1, domainDeps: deps, gateReceiptId: gr.json.receiptId,
      inspectionRevision: { sessionId },
    });
    assert.equal(created.status, 200, `[${label}] 冻结: ${JSON.stringify(created.json)}`);
    const packageId = created.json.packageId;
    for (const domain of DOMAINS) {
      const rStart = performance.now();
      const run2 = await aCall('svc1', 'POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
        requestId: `run-${domain}-${rid(label)}`, tenantId: T1, domain,
        deps: { artifactIds: domain === 'credit' ? creditArtifactIds : [], factKeys: [], rulePackVersion: RULE_PACK_V1 },
      });
      assert.equal(run2.status, 200, `[${label}] 运行开始 ${domain}: ${JSON.stringify(run2.json)}`);
      const fin = await aCall('svc1', 'POST', `/api/v2/analysis-runs/${run2.json.runId}/finish`, {
        requestId: `fin-${domain}-${rid(label)}`, tenantId: T1, executionStatus: 'completed',
      });
      assert.equal(fin.status, 200, `[${label}] 运行完成 ${domain}: ${JSON.stringify(fin.json)}`);
      const rr = await aCall('svc1', 'POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
        requestId: `dr-${domain}-${rid(label)}`, tenantId: T1, domain,
        analysisRun: { runId: run2.json.runId, rulesetVersion: RULE_PACK_V1 },
        opinion: { findingType: 'observation', summary: `${domain} 域意见（synthetic，authority=none）`, domain, authority: 'none' },
        deps: { artifactIds: domain === 'credit' ? creditArtifactIds : [], factKeys: [], rulePackVersion: RULE_PACK_V1 },
      });
      assert.equal(rr.status, 200, `[${label}] 域结果 ${domain}: ${JSON.stringify(rr.json)}`);
      timers['t_domain_result'] = (timers['t_domain_result'] || 0) + (performance.now() - rStart);
    }
    const got = await aCall('biz1', 'GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got.status, 200, `[${label}] 读包: ${JSON.stringify(got.json)}`);
    return { packageId, got: got.json };
  };

  s = t0('t_package_freeze');
  const pkgOk = await freezePackage({ gateResult: 'CLEAR', creditArtifactIds: [art1.json.artifactId], label: 'ok' });
  assert.equal(pkgOk.got.decisionReadiness, true, `CLEAR 包就绪: ${JSON.stringify(pkgOk.got.gaps)}`);
  t1('t_package_freeze', s);

  // [F-08] failed 运行不得满足必需域
  const failRun = await aCall('svc1', 'POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
    requestId: rid('run'), tenantId: T1, domain: 'credit', deps: { artifactIds: [], factKeys: [], rulePackVersion: RULE_PACK_V1 },
  });
  await aCall('svc1', 'POST', `/api/v2/analysis-runs/${failRun.json.runId}/finish`, { requestId: rid('fin'), tenantId: T1, executionStatus: 'failed' });
  const rrFail = await aCall('svc1', 'POST', `/api/v2/decision-packages/${pkgOk.packageId}/domain-results`, {
    requestId: rid('dr'), tenantId: T1, domain: 'credit', analysisRun: { runId: failRun.json.runId, rulesetVersion: RULE_PACK_V1 },
    opinion: { findingType: 'observation', summary: 'failed 运行结果', domain: 'credit', authority: 'none' },
    deps: { artifactIds: [art1.json.artifactId], factKeys: [], rulePackVersion: RULE_PACK_V1 },
  });
  assert.equal(rrFail.status, 409, `failed 运行登记域结果应 409: ${JSON.stringify(rrFail.json)}`);
  assert.equal(rrFail.json.error, 'ANALYSIS_RUN_NOT_COMPLETED');

  // [F-17] 伪豁免/假收口结构拒绝
  const grFake = await aCall('svc1', 'POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, { requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: RULE_PACK_V1 });
  const exemptNoApproval = await aCall('biz1', 'POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: rid('pkg'), tenantId: T1, gateReceiptId: grFake.json.receiptId, inspectionRevision: { sessionId },
    domainDeps: [{ domain: 'policy', artifactIds: [], factKeys: [], rulePackVersion: RULE_PACK_V1 }],
    exemptions: [{ domain: 'credit', reason: '口头说不需要', approvedBy: '' }],
  });
  assert.equal(exemptNoApproval.status, 400, `无批准人豁免应 400: ${JSON.stringify(exemptNoApproval.json)}`);
  const fakeSessionPkg = await aCall('biz1', 'POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: rid('pkg'), tenantId: T1, gateReceiptId: grFake.json.receiptId,
    inspectionRevision: { sessionId: 'sess-not-exist' }, domainDeps: [],
  });
  assert.equal(fakeSessionPkg.status, 404, `假收口引用应 404: ${JSON.stringify(fakeSessionPkg.json)}`);
  const freeGatePkg = await aCall('biz1', 'POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: rid('pkg'), tenantId: T1, gate: { result: 'CLEAR', rulePackVersion: RULE_PACK_V1 }, domainDeps: [],
  });
  assert.equal(freeGatePkg.status, 400, `自由 JSON gate 应 400: ${JSON.stringify(freeGatePkg.json)}`);

  // ---- [F-10] 信用链：评估→候选→待审→包绑定提案→批准→激活 ----
  s = t0('t_credit_chain');
  const ass = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, {
    requestId: rid('as'), tenantId: T1, ruleVersion: RULE_PACK_V1, evidenceSnapshot: [{ artifactId: art1.json.artifactId }],
  });
  assert.equal(ass.status, 200, `评估创建失败: ${JSON.stringify(ass.json)}`);
  const assessmentId = ass.json.assessmentId;
  const cand = await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${assessmentId}/candidate`, {
    requestId: rid('cd'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: wan(500), currency: 'CNY', rationale: 'g04', producedBy: 'g04-automated(synthetic)', conditions: [], warnings: [] },
  });
  assert.equal(cand.status, 200, `候选失败: ${JSON.stringify(cand.json)}`);
  assert.equal(cand.json.candidate?.authority ?? 'none', 'none', '候选 authority 恒 none');
  const sr = await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: T1 });
  assert.equal(sr.status, 200, `提交待审失败: ${JSON.stringify(sr.json)}`);
  const prop = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/facilities`, {
    requestId: rid('pf'), tenantId: T1, assessmentId, approvedAmountMinor: wan(500), currency: 'CNY', packageId: pkgOk.packageId,
  });
  assert.equal(prop.status, 200, `包绑定提案失败: ${JSON.stringify(prop.json)}`);
  const facilityId = prop.json.facilityId;
  const jwApprove = await call('jw1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: '越权尝试' });
  assert.equal(jwApprove.status, 409, '见微批准 → 409');
  assert.equal(jwApprove.json.error, 'POLICY_PENDING');
  const ap1 = await call('app1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: 'g04 有权人类' });
  assert.equal(ap1.status, 200, `批准失败: ${JSON.stringify(ap1.json)}`);
  const ac1 = await call('app1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/activate`, { requestId: rid('ac'), tenantId: T1, rationale: 'g04' });
  assert.equal(ac1.status, 200, `激活失败: ${JSON.stringify(ac1.json)}`);
  t1('t_credit_chain', s);

  // ---- [F-11/F-20] 两笔共同占额 + 并发 + 超占 + 重放/异载荷 ----
  s = t0('t_reserve');
  const fr1 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor: wan(100), currency: 'CNY', equipmentRefs: ['DEV-1'],
  });
  assert.equal(fr1.status, 200, `FR1 失败: ${JSON.stringify(fr1.json)}`);
  const fr2 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'sale_leaseback', amountMinor: wan(80), currency: 'CNY', equipmentRefs: ['DEV-2'],
  });
  assert.equal(fr2.status, 200, `FR2 失败: ${JSON.stringify(fr2.json)}`);
  const ridFr1 = rid('res'); const ridFr2 = rid('res');
  const sRes = t0('t_reserve_concurrent');
  const [res1, res2] = await Promise.all([
    call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: T1 }),
    call('cred1', 'POST', `/api/jw/v2/actions/financing-requests/${fr2.json.frId}/reserve`, { requestId: ridFr2, tenantId: T1 }),
  ]);
  t1('t_reserve_concurrent', sRes);
  assert.equal(res1.status, 200, `FR1 预占失败: ${JSON.stringify(res1.json)}`);
  assert.equal(res2.status, 200, `FR2 预占失败: ${JSON.stringify(res2.json)}`);
  const ws2 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  const fac2 = ws2.json.snapshot.facilities.find((f) => f.facilityId === facilityId);
  assert.equal(fac2.reservedMinor, wan(180), '两笔并发预占累计同一客户桶');
  assert.equal(fac2.availableForNewDrawMinor, wan(320), '可用额=批准−预占');
  const fr3 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor: wan(400), currency: 'CNY', equipmentRefs: ['DEV-1'],
  });
  const res3 = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr3.json.frId}/reserve`, { requestId: rid('res'), tenantId: T1 });
  assert.equal(res3.status, 409, `超预占拒绝: ${JSON.stringify(res3.json)}`);
  assert.equal(res3.json.error, 'INSUFFICIENT_AVAILABLE_AMOUNT');
  // F-20 同申请重放/异载荷
  const res1Replay = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: T1 });
  assert.equal(res1Replay.json.replayed, true, '同 requestId 重放 → replayed');
  const res1Dup = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: rid('res'), tenantId: T1 });
  assert.equal(res1Dup.status, 409, `同申请第二笔预占(新 requestId)应 409: ${JSON.stringify(res1Dup.json)}`);
  const res1CrossT = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: 't-other' });
  assert.equal(res1CrossT.status, 403, `异租户载荷先撞授权门（鉴权先于幂等缓存）: ${JSON.stringify(res1CrossT.json)}`);
  assert.equal(res1CrossT.json.error, 'CUSTOMER_SCOPE_VIOLATION');
  const res1Mismatch = await call('cred1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: T1 });
  assert.equal(res1Mismatch.status, 409, `跨主体同 requestId 应 409（观测语义 NOT_READY，零双效应）: ${JSON.stringify(res1Mismatch.json)}`);
  const wsAfterMismatch = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(wsAfterMismatch.json.snapshot.facilities.find((f) => f.facilityId === facilityId).reservedMinor, wan(180), '跨主体重放零业务效应');
  const receipt = await call('biz1', 'GET', `/api/jw/v2/receipts/${ridFr1}`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.json.found, true, '回执经 Edge 可查');
  t1('t_reserve', s);

  // ---- [F-19] 错设备证据：当前无设备登记/校验结构 → 如实记录缺口（不判 PASS） ----
  const frGhost = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor: wan(10), currency: 'CNY', equipmentRefs: ['DEV-GHOST-404'],
  });
  notes.push({ code: 'GAP-DEVICE-REGISTRY', detail: `未登记设备 DEV-GHOST-404 的 FR 创建返回 ${frGhost.status}（equipmentRefs 仅存储，无对象登记/校验结构）` });

  // ---- [F-16] 客户级授权：授予→可写→撤权→即刻失效（重放不借缓存） ----
  const biz2Sess = await call('biz2', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.ok(biz2Sess.status === 404 || biz2Sess.status === 403, `未授权 biz2 初始不可见: ${JSON.stringify(biz2Sess.json)}`);
  const gOK = await aCall('adm1', 'POST', `/api/v2/customers/${customerId}/grants`, { requestId: rid('grant'), tenantId: T1, principalId: 'biz2' });
  assert.equal(gOK.status, 200, `授权 biz2: ${JSON.stringify(gOK.json)}`);
  const biz2ArtRid = rid('art');
  const biz2Art = await call('biz2', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: biz2ArtRid, tenantId: T1, kind: 'customer_profile', factKey: 'biz2_note', content: { v: 1 }, grade: 'unverified',
  });
  assert.equal(biz2Art.status, 200, `授权后 biz2 可写: ${JSON.stringify(biz2Art.json)}`);
  const rvk = await aCall('adm1', 'DELETE', `/api/v2/customers/${customerId}/grants/biz2`, { requestId: rid('rvk'), tenantId: T1 });
  assert.equal(rvk.status, 200, `撤权 biz2: ${JSON.stringify(rvk.json)}`);
  const biz2After = await call('biz2', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.ok(biz2After.status === 404 || biz2After.status === 403, `撤权后即刻失效: ${JSON.stringify(biz2After.json)}`);
  const biz2Replay = await call('biz2', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: biz2ArtRid, tenantId: T1, kind: 'customer_profile', factKey: 'biz2_note', content: { v: 1 }, grade: 'unverified',
  });
  assert.ok(biz2Replay.status === 404 || biz2Replay.status === 403, `撤权后重放不借缓存: ${JSON.stringify(biz2Replay.json)}`);

  // ---- [F-09 HOLD 臂] HOLD 包 → 批准 409 GATE_BLOCKED 零副作用 ----
  const pkgHold = await freezePackage({ gateResult: 'HOLD_FOR_REVIEW', creditArtifactIds: [], label: 'hold' });
  assert.equal(pkgHold.got.decisionReadiness, false, 'HOLD 包不得 ready');
  assert.ok(pkgHold.got.gaps.some((g) => g.code === 'GATE_HOLD_FOR_REVIEW'), `HOLD 缺口: ${JSON.stringify(pkgHold.got.gaps)}`);
  const assH = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, {
    requestId: rid('as'), tenantId: T1, ruleVersion: RULE_PACK_V1, evidenceSnapshot: [{ artifactId: bank.json.artifactId }],
  });
  await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${assH.json.assessmentId}/candidate`, {
    requestId: rid('cd'), tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: wan(200), producedBy: 'g04-hold-arm' },
  });
  await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${assH.json.assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: T1 });
  const propHold = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/facilities`, {
    requestId: rid('pf'), tenantId: T1, assessmentId: assH.json.assessmentId, approvedAmountMinor: wan(200), currency: 'CNY', packageId: pkgHold.packageId,
  });
  assert.equal(propHold.status, 200, `HOLD 包提案(允许提案): ${JSON.stringify(propHold.json)}`);
  const apHold = await call('app1', 'POST', `/api/jw/v2/actions/facilities/${propHold.json.facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: 'HOLD 下尝试批准' });
  assert.equal(apHold.status, 409, `HOLD 批准应 409: ${JSON.stringify(apHold.json)}`);
  assert.match(String(apHold.json?.error ?? ''), /GATE_BLOCKED/);


  // ---- [F-12/F-18] 不利证据 → STALE_BASIS；晚到材料 → 包 deps_changed ----
  s = t0('t_stale');
  const art2 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'litigation_record', factKey: 'litigation',
    content: { case: `LA-${rid('l')}`, amountMinor: wan(300), adverse: true }, grade: 'source_supported',
  });
  assert.equal(art2.status, 200);
  const ass2 = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, {
    requestId: rid('as'), tenantId: T1, ruleVersion: RULE_PACK_V1, evidenceSnapshot: [{ artifactId: art2.json.artifactId }],
  });
  assert.equal(ass2.status, 200);
  await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${ass2.json.assessmentId}/candidate`, {
    requestId: rid('cd'), tenantId: T1, candidate: { tendency: 'do_with_adjusted_terms', supportableAmountMinor: wan(200), producedBy: 'g04-adverse', conditions: [], warnings: [] },
  });
  await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${ass2.json.assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: T1 });
  const prop2 = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/facilities`, {
    requestId: rid('pf'), tenantId: T1, assessmentId: ass2.json.assessmentId, approvedAmountMinor: wan(200), currency: 'CNY', packageId: pkgOk.packageId,
  });
  assert.equal(prop2.status, 200, `提案2(绑定现行包): ${JSON.stringify(prop2.json)}`);
  // 更正取代不利材料
  const sup = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'litigation_record', factKey: 'litigation',
    content: { settled: true, reconcile: `RC-${rid('r')}` }, grade: 'source_supported', supersedes: art2.json.artifactId,
  });
  assert.equal(sup.status, 200, `更正取代: ${JSON.stringify(sup.json)}`);
  const ap2 = await call('app1', 'POST', `/api/jw/v2/actions/facilities/${prop2.json.facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: '依据已变化仍尝试批准' });
  assert.equal(ap2.status, 409, `批准3被阻断: ${JSON.stringify(ap2.json)}`);
  assert.equal(ap2.json.error, 'STALE_BASIS', `阻断码=STALE_BASIS: ${JSON.stringify(ap2.json)}`);
  // F-18 晚到分析：取代上游后包读时判 deps_changed（credit 域依赖了 art1——本取代直接证明水位机制；
  // 用独立 pkgCur 验证 credit deps 变化可见性）
  const pkgCur = await freezePackage({ gateResult: 'CLEAR', creditArtifactIds: [art1.json.artifactId], label: 'cur' });
  assert.equal(pkgCur.got.decisionReadiness, true, `pkgCur 初始就绪: ${JSON.stringify(pkgCur.got.gaps)}`);
  const sup1 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'purchase_contract', factKey: 'profile',
    content: { device: 'DEV-1', contractNo: `HT-fix-${rid('c')}`, amountMinor: wan(120), corrected: true }, grade: 'source_supported', supersedes: art1.json.artifactId,
  });
  assert.equal(sup1.status, 200, `取代 art1: ${JSON.stringify(sup1.json)}`);
  const pkgCurAfter = await aCall('biz1', 'GET', `/api/v2/decision-packages/${pkgCur.packageId}`);
  assert.equal(pkgCurAfter.status, 200);
  const curJson = JSON.stringify(pkgCurAfter.json);
  assert.ok(curJson.includes('deps_changed'), `晚到材料 → 域水位 deps_changed 可见: ${curJson.slice(0, 400)}`);
  // 不利信息后，新的后续动作被当前性门阻断（取代 art1 后 pkgOk 也不再 current）
  const fr4 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor: wan(10), currency: 'CNY', equipmentRefs: ['DEV-1'],
  });
  const res4 = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr4.json.frId}/reserve`, { requestId: rid('res'), tenantId: T1 });
  assert.equal(res4.status, 409, `依据变化后新用信动作被阻断: ${JSON.stringify(res4.json)}`);
  notes.push({ code: 'POST-STALE-RESERVE', detail: `取代后新预占返回 ${res4.status} ${res4.json.error ?? ''}` });
  // 历史决定保留
  const ws4 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  const fac4 = ws4.json.snapshot.facilities.find((f) => f.facilityId === facilityId);
  assert.equal(fac4.status, 'active', '历史设施1 仍 active');
  assert.equal(fac4.approvedAmountMinor, wan(500), '批准额不变');
  assert.equal(fac4.reservedMinor, wan(180), '预占不变');
  t1('t_stale', s);

  // ---- [F-13] 中断恢复 ----
  s = t0('t_recovery');
  const preCursor = ws4.json.eventCursor;
  B.killKernel();
  const downReady = await (async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const r = await (await fetch(`${B.base}/healthz/ready`)).json();
      if (r.ok === false && (r.checks ?? []).some((c) => c.name === 'kernel-a' && c.ok === false)) return r;
      await new Promise((x) => setTimeout(x, 500));
    }
    return null;
  })();
  assert.ok(downReady, '内核停止后 readiness 如实翻转（kernel-a fail）');
  const liveChk = await (await fetch(`${B.base}/healthz/live`)).json();
  assert.equal(liveChk.ok, true, 'Edge liveness 保持 ok');
  const wsDown = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(wsDown.status, 502, `内核不可达如实 502: ${JSON.stringify(wsDown.json)}`);
  assert.equal(wsDown.json.error, 'UPSTREAM_UNAVAILABLE');
  await B.restartKernel();
  const upReady = await (async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const r = await (await fetch(`${B.base}/healthz/ready`)).json();
      if (r.ok === true) return r;
      await new Promise((x) => setTimeout(x, 600));
    }
    return null;
  })();
  assert.ok(upReady, '内核重启后 readiness 恢复 ok');
  const ws5 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(ws5.status, 200, '重启后 workspace 恢复');
  const fac5 = ws5.json.snapshot.facilities.find((f) => f.facilityId === facilityId);
  assert.equal(fac5.reservedMinor, wan(180), '重启后预占无丢失');
  assert.equal(ws5.json.snapshot.customer.customerId, customerId, '客户档案无丢失');
  const res1Post = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: T1 });
  assert.equal(res1Post.json.replayed, true, '重启后同 requestId 仍幂等');
  assert.ok(BigInt(ws5.json.snapshotVersion) >= BigInt(ws4.json.snapshotVersion), '事件水位不回退');
  assert.ok(preCursor, '重启前游标已记录');
  t1('t_recovery', s);

  // ---- [F-14/F-22] SSE 帧核验 ----
  const frames = await ssePromise;
  const bizFrames = frames.filter((f) => f.event === 'business' && f.data);
  assert.ok(bizFrames.length >= 1, `订阅期间收到业务事件 ${bizFrames.length} 帧`);
  const envs = bizFrames.map((f) => ({ f, env: JSON.parse(f.data) }));
  for (const { f, env } of envs) {
    assert.equal(env.schemaVersion, 'jw.event.v1', '信封 schemaVersion');
    assert.equal(env.scope?.customer, customerId, `事件 scope.customer 全部为本客户（零串线）: ${env.scope?.customer}`);
    assert.equal(env.eventId, f.id, 'eventId 与 SSE id 一致');
  }
  assert.ok(frames.some((f) => f.event === 'cursor'), 'SSE 先收到 cursor 基线');

  return {
    customerId, facilityId, assessmentId,
    fr1: fr1.json.frId, fr2: fr2.json.frId,
    packages: { ok: pkgOk.packageId, hold: pkgHold.packageId, cur: pkgCur.packageId },
    sessionId, closureRevision,
    sseFrames: bizFrames.length,
    notes,
  };
}
