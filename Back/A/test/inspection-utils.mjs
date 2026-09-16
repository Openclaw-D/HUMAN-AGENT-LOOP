// 任务一 · 检查会话测试工具：隔离库 + 内核进程 + 会话脚手架。
// 独立于 utils.mjs（避免与并行任务二的 utils 修改互相踩写）；身份目录自带检查会话九角色。
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const A_ROOT = path.resolve(__dirname, '..');
const ADMIN_DB = process.env.JW_A_ADMIN_DB_URL ?? 'postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres';
const BASE_PORT = 48600;

export const T = {
  admin: 'ix-admin',
  owner: 'ix-owner',        // business（人类会话负责人）
  director: 'ix-director',  // 厂长（人类）
  finance: 'ix-finance',    // 财务（人类）
  customer: 'ix-customer',  // 客户（人类）
  asset: 'ix-asset',        // 资产专员（人类）
  credit: 'ix-credit',      // 信审（人类）
  agent: 'ix-agent',        // 内部 Agent（jianwei 域）
};

export const IX_PRINCIPAL_SPEC = [
  `${T.admin}=adm:human:admin:all`,
  `${T.owner}=own:human:business:all`,
  `${T.director}=dir:human:director:all`,
  `${T.finance}=fin:human:finance:all`,
  `${T.customer}=cus:human:customer:all`,
  `${T.asset}=ast:human:asset:all`,
  `${T.credit}=cre:human:credit:all`,
  `${T.agent}=agt:agent:jianwei:all`,
].join(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };
export const uid = (p = 'r') => `${p}-${randomBytes(6).toString('hex')}`;

export async function createTestDb() {
  const name = `v7next_a_ix_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: ADMIN_DB });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const base = new URL(ADMIN_DB);
  base.pathname = `/${name}`;
  return { name, url: base.toString() };
}

export async function dropTestDb(name) {
  const admin = new pg.Pool({ connectionString: ADMIN_DB });
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}

/** 启动内核（keepDb=true 供重启恢复测试复用同一库）。 */
export async function startKernel({ dbUrl = null, keepDb = false, leaseSeconds = 90, extraArgs = [] } = {}) {
  const db = dbUrl === null ? await createTestDb() : { name: null, url: dbUrl };
  const port = BASE_PORT + Math.floor(Math.random() * 500);
  const args = ['src/index.ts', '--port', String(port), '--db', db.url, '--principal-tokens', IX_PRINCIPAL_SPEC, '--lease-seconds', String(leaseSeconds), ...extraArgs];
  const child = spawn('node', args, { cwd: A_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.status === 200) { up = true; break; }
    } catch { /* 未起 */ }
    await sleep(250);
  }
  if (!up) {
    child.kill();
    throw new Error(`kernel 启动失败：\n${logs.join('')}`);
  }
  const pool = new pg.Pool({ connectionString: db.url });
  return {
    port, base, dbUrl: db.url, dbName: db.name, child, logs, pool,
    async stop() {
      child.kill('SIGTERM');
      await sleep(300);
      if (!child.killed) child.kill('SIGKILL');
      try { await pool.end(); } catch { /* 已断 */ }
      if (db.name !== null && !keepDb) await dropTestDb(db.name);
    },
  };
}

/** HTTP 客户端（默认带凭据）。 */
export function client(base, token = T.admin) {
  return async (method, path, body) => {
    const headers = { 'content-type': 'application/json' };
    if (token !== null) headers['x-principal-credential'] = token;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON */ }
    return { status: res.status, json };
  };
}

/** 标准九角色名册（A12 并行场景也用它裁剪）。 */
export function fullRoster() {
  return [
    { roleKey: 'business', kind: 'human' },
    { roleKey: 'customer', kind: 'human' },
    { roleKey: 'director', kind: 'human' },
    { roleKey: 'finance', kind: 'human' },
    { roleKey: 'policy', kind: 'human' },
    { roleKey: 'credit', kind: 'human' },
    { roleKey: 'commerce', kind: 'human' },
    { roleKey: 'asset', kind: 'human' },
    { roleKey: 'jianwei', kind: 'agent' },
  ];
}

/** 标准计划：3 个必要核验项 + 1 个可选（覆盖财务答复/资产看设备/业务陪同/信审对账）。 */
export function standardItems() {
  return [
    {
      itemKey: 'equipment_verify', title: '设备实物核验（锚定车床-01）', required: true,
      responsibleRole: 'asset', targetRole: 'director', requiresHumanVerification: true,
      expectedEvidenceKinds: ['equipment_photo'], objectRef: 'lathe-01',
      detail: { whyNeeded: '设备权属与在用状态是租合物基础', stopCondition: '人工核验 confirmed 或 conflict' },
    },
    {
      itemKey: 'financial_answers', title: '财务口径问答', required: true,
      responsibleRole: 'credit', targetRole: 'finance', requiresHumanVerification: true,
      expectedEvidenceKinds: ['bank_statement'], objectRef: null,
      detail: { whyNeeded: '现金流口径须由财务确认并附流水', stopCondition: '人工核验' },
    },
    {
      itemKey: 'business_accompany', title: '业务陪同记录', required: false,
      responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false,
      expectedEvidenceKinds: [], objectRef: null,
      detail: { whyNeeded: '陪同过程留痕' },
    },
  ];
}

/** 全套脚手架：客户 → 最小模板+项目 → 会话（preparing）。 */
export async function scaffold({ base, items = standardItems(), roster = fullRoster(), planSnapshot = {}, title = '联合尽调·标准会话', sceneVersion = 'scene-1' } = {}) {
  const call = client(base, T.admin);
  const own = client(base, T.owner);
  const cus = client(base, T.customer);
  const custRes = await call('POST', '/api/v2/customers', {
    requestId: uid('cust'), tenantId: 't-inspect', legalEntityRef: `LE-${randomBytes(4).toString('hex')}`,
    displayName: '合成制造有限公司',
  });
  if (custRes.status !== 200) throw new Error(`createCustomer 失败: ${JSON.stringify(custRes)}`);
  const customerId = custRes.json.customerId;
  const tplRes = await call('POST', '/api/v1/templates', {
    requestId: uid('tpl'), name: 'ix-min', industry: null,
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }, { roleKey: 'approver', title: '审批', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g1', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  if (tplRes.status !== 200) throw new Error(`createTemplate 失败: ${JSON.stringify(tplRes)}`);
  const projRes = await call('POST', '/api/v1/projects', { requestId: uid('p'), templateId: tplRes.json.templateId, name: '尽调项目' });
  if (projRes.status !== 200) throw new Error(`createProject 失败: ${JSON.stringify(projRes)}`);
  const projectId = projRes.json.projectId;
  const sesRes = await own('POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: uid('ins'), customerId, title, sceneVersion, roles: roster, ownerRole: 'business',
    items, planSnapshot: { inspectionPlanVersion: 7, source: 'pre_review_v2', ...planSnapshot },
  });
  if (sesRes.status !== 200) throw new Error(`createSession 失败: ${JSON.stringify(sesRes)}`);
  const sessionId = sesRes.json.sessionId;
  const snap = async () => (await client(base, T.admin)('GET', `/api/v1/inspections/${sessionId}`)).json.snapshot;
  const itemsByIdKey = async () => {
    const s = await snap();
    return s; // 快照未内联 items；用 DB 直查由测试自定
  };
  return {
    call, own, cus,
    customerId, projectId, sessionId,
    snapshot: snap,
    snapAdmin: snap,
    next: async () => (await own('GET', `/api/v1/inspections/${sessionId}/next-actions`)).json,
  };
}

/** 注册客户工件（材料登记；回答 evidenceRefs 指向它）。 */
export async function registerArtifact(base, customerId, kind, content = {}) {
  const call = client(base, T.asset);
  const r = await call('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: uid('art'), tenantId: 't-inspect', kind, content: { takenAt: '2026-09-17T10:00:00Z', ...content },
  });
  if (r.status !== 200) throw new Error(`registerArtifact(${kind}) 失败: ${JSON.stringify(r)}`);
  return r.json.artifactId;
}

/** 白盒时钟：把某会话的问题与外发记录时间往前拨（模拟等待超时，不用长 sleep）。 */
export async function backdateQuestionCreated(pool, sessionId, seconds) {
  await pool.query(
    `UPDATE inspection_questions SET created_at = created_at - make_interval(secs => $2) WHERE session_id = $1`,
    [sessionId, seconds],
  );
  await pool.query(
    `UPDATE inspection_outbound SET created_at = created_at - make_interval(secs => $2) WHERE session_id = $1`,
    [sessionId, seconds],
  );
}

export function assertOk(t, res, label) {
  if (res.status !== 200) {
    throw new Error(`${label} 预期 200，实际 ${res.status}: ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

export function assertCode(t, res, code, label) {
  if (res.status === 200 || res.json?.error !== code) {
    throw new Error(`${label} 预期 ${code}，实际 ${res.status}: ${JSON.stringify(res.json)}`);
  }
  return res.json;
}
