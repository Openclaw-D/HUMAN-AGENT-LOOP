// 契约适配层：CONTRACT v0.1 的响应封套、错误码、合成principal、实体工厂。
// 契约升版时只改此文件。零依赖。
import { makeHttp, verbs } from './http.mjs';

// 合成principal目录（对齐 A/scripts/start-kernel.mjs 的官方SPEC词汇；CONTRACT v1.0）
export const PRINCIPALS = {
  admin: 'tok-admin',      // alice:human:admin:all
  agent: 'tok-agent',      // worker1:agent:business:all（agent执行者）
  agent2: 'tok-agent2',    // worker2:agent:business:all
  business: 'tok-business',// bob:human:business+config:all（可supersede/创建）
  approver: 'tok-approver',// carol:human:approver:all（验收/决定）
  unknown: 'v7d-tok-unknown', // 未注册凭据（应为不可信）
};
export const PRINCIPAL_TOKEN_SPEC = [
  'tok-admin=alice:human:admin:all',
  'tok-business=bob:human:business+config:all',
  'tok-agent=worker1:agent:business:all',
  'tok-agent2=worker2:agent:business:all',
  'tok-approver=carol:human:approver:all',
  'tok-jianwei=jane:human:jianwei:all',
  'tok-policy=paul:human:policy:all',
  'tok-credit=cindy:human:credit:all',
  'tok-commerce=connor:human:commerce:all',
  'tok-asset=adam:human:asset:all',
].join(',');
export const PRINCIPAL_HEADER = 'x-principal-credential';

export function makeApi(apiBase) {
  const req = makeHttp(apiBase, { defaultTimeoutMs: 15000 });
  const v = verbs(req);
  const call = (credential) => async (method, path, body, opt = {}) => {
    const headers = { ...(credential ? { [PRINCIPAL_HEADER]: credential } : {}), ...(opt.headers || {}) };
    return method === 'GET' || method === 'DELETE'
      ? req(method, path, { headers, timeoutMs: opt.timeoutMs })
      : req(method, path, { json: body, headers, timeoutMs: opt.timeoutMs });
  };
  const mkClient = (cred) => {
    const c = call(cred);
    return {
      get: (p, opt) => c('GET', p, undefined, opt),
      post: (p, body, opt) => c('POST', p, body, opt),
      put: (p, body, opt) => c('PUT', p, body, opt),
      del: (p, opt) => c('DELETE', p, undefined, opt),
      as: (other) => mkClient(other),
      cred: cred,
    };
  };
  return {
    raw: v,
    as: (cred) => mkClient(cred),
    noAuth: () => mkClient(null),
  };
}

export function ok(a, res, msg) {
  if (!a(res && res.status !== 0, `${msg || 'HTTP'} 可达（status!=0）`, { err: res && res.error })) throw new Error('connection failed');
  const j = res.json;
  a(res.status >= 200 && res.status < 300, `${msg || '请求'} 返回2xx`, { status: res.status, body: res.text.slice(0, 300) });
  a(j && j.ok === true, `${msg || '响应'} ok:true`, { body: res.text.slice(0, 300) });
  return j || {};
}
export function errCode(a, res, code, msg) {
  if (!a(res && res.status !== 0, `${msg || 'HTTP'} 可达`, { err: res && res.error })) throw new Error('connection failed');
  const j = res.json;
  a(j && j.ok === false, `${msg || '错误响应'} ok:false`, { status: res.status, body: res.text.slice(0, 300) });
  a(j && j.error === code, `${msg || '错误码'} = ${code}`, { actual: j && j.error, body: res.text.slice(0, 300) });
  return j || {};
}
// 深度查找字段（对响应封套形状差异鲁棒）
export function pick(json, key) {
  if (json == null || typeof json !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(json, key) && json[key] !== undefined) return json[key];
  for (const v of Object.values(json)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { const r = pick(v, key); if (r !== undefined) return r; }
    if (Array.isArray(v)) { for (const it of v) { const r = pick(it, key); if (r !== undefined) return r; } }
  }
  return undefined;
}
// 项目inputVersion（v1.0：证据/实例化命令的expectedVersion指向它；A投影字段名=projectInputVersion）
export function projectVersion(json) {
  if (!json || typeof json !== 'object') return undefined;
  if (json.project && typeof json.project.projectInputVersion === 'number') return json.project.projectInputVersion;
  if (typeof json.projectInputVersion === 'number') return json.projectInputVersion;
  if (json.project && typeof json.project.inputVersion === 'number') return json.project.inputVersion;
  if (typeof json.inputVersion === 'number') return json.inputVersion;
  const skip = new Set(['goals', 'receipts', 'events', 'assignments', 'humanRequests', 'evidence']);
  for (const [k, v] of Object.entries(json)) {
    if (skip.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) { const r = projectVersion(v); if (r !== undefined) return r; }
  }
  return undefined;
}
export function goalVersion(json) {
  if (!json || typeof json !== 'object') return undefined;
  if (json.goal && typeof json.goal.version === 'number') return json.goal.version;
  if (typeof json.version === 'number') return json.version;
  const skip = new Set(['receipts', 'events', 'assignment', 'humanRequests']);
  for (const [k, v] of Object.entries(json)) {
    if (skip.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) { const r = goalVersion(v); if (r !== undefined) return r; }
  }
  return undefined;
}

let reqCounter = 0;
export function reqId(tag) { return `v7d-${tag}-${Date.now().toString(36)}-${(++reqCounter).toString(36)}`; }

// D 默认测试模板：business(human,责任)+approver(human,验收/决定)+agent执行，2目标DAG（v1.0角色词汇）
export function dTemplate({ name = 'D 验收模板' } = {}) {
  return {
    requestId: reqId('tpl'),
    name,
    industry: null,
    roles: [
      { roleKey: 'business', title: '业务', isHumanRole: true },
      { roleKey: 'approver', title: '验收决定', isHumanRole: true },
    ],
    goals: [
      {
        goalKey: 'collect', title: '收集材料', description: 'D测试上游目标',
        responsibleRole: 'business', executorKind: 'agent',
        acceptanceRole: 'approver', decisionRole: 'approver',
        inputEvidenceKinds: ['facts'], dependsOn: [], params: { unit: 'test' },
      },
      {
        goalKey: 'review', title: '复核', description: 'D测试下游目标',
        responsibleRole: 'business', executorKind: 'agent',
        acceptanceRole: 'approver', decisionRole: 'approver',
        inputEvidenceKinds: [], dependsOn: ['collect'], params: {},
      },
    ],
  };
}

// 全流程工厂：模板→项目→实例化全部goal→返回ID映射与版本读取器（每次实例化前重读项目版本）
export async function setupProject(api, a, { template, projectName = 'D验收项目', credential = PRINCIPALS.admin } = {}) {
  const tplDef = template || dTemplate();
  const tpl = ok(a, await api.post('/api/v1/templates', tplDef), 'create template');
  const templateId = pick(tpl, 'templateId');
  const proj = ok(a, await api.post('/api/v1/projects', { requestId: reqId('proj'), templateId, name: projectName }), 'create project');
  const projectId = pick(proj, 'projectId');
  const goals = {};
  for (const g of tplDef.goals) {
    const pr = await api.get(`/api/v1/projects/${projectId}`);
    const ver = projectVersion(pr.json);
    const r = ok(a, await api.post(`/api/v1/projects/${projectId}/goals`, { requestId: reqId('goal'), expectedVersion: ver, goalKey: g.goalKey }), `instantiate ${g.goalKey}`);
    goals[g.goalKey] = pick(r, 'goalId');
  }
  return { templateId, projectId, goals };
}
export async function projectState(api, projectId) {
  const r = await api.get(`/api/v1/projects/${projectId}`);
  return { res: r, json: r.json, version: projectVersion(r.json) };
}
export async function goalState(api, goalId) {
  const r = await api.get(`/api/v1/goals/${goalId}`);
  return { res: r, json: r.json, status: pick(r.json, 'status'), version: goalVersion(r.json) };
}

// 轮询直到 goal status 进入集合或超时
export async function waitStatus(api, goalId, statuses, { timeoutMs = 15000, intervalMs = 300, credential = PRINCIPALS.admin } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await api.get(`/api/v1/goals/${goalId}`);
    last = r;
    const st = pick(r.json, 'status');
    if (st && statuses.includes(st)) return { ok: true, status: st, json: r.json, res: r };
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return { ok: false, status: pick(last && last.json, 'status'), json: last && last.json, res: last };
}
