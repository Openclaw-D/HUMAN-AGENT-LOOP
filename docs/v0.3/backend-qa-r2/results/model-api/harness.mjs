// 02_MODEL_API 专项 · 真实 Edge HTTP 装配夹具（qa-r2 02包独占，非产品代码）。
// 复用产品组装面：startEdgeServer + fixture store + 合成获准证据（prepareEvidence 同参）
// + createAssistantModel/createAssistantProfiles + 可记录本地模型替身。
// 每个夹具独立 OS 临时目录与系统分配端口，互不共享状态；结束后自清理自登记资源。
import process from 'node:process';
process.setMaxListeners?.(60); // 多个 Edge 实例各注册 SIGINT/SIGTERM handler，抬高告警阈值（仅测试进程）
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startEdgeServer } from '../../../../../Back/Edge/src/server.mjs';
import { createAssistantModel } from '../../../../../Back/Edge/src/assistant-model.mjs';
import { createAssistantProfiles } from '../../../../../Back/Edge/src/assistant-profiles.mjs';
import { createFixtureStore } from '../../../../../Back/Edge/src/store.mjs';
import { createSessionStore } from '../../../../../Back/Edge/src/session.mjs';
import { createAuditSink } from '../../../../../Back/Edge/src/audit.mjs';
import { createDecisionFeedbackStore } from '../../../../../Back/Edge/src/decision-feedback-store.mjs';
import { prepareEvidence } from '../../../../../Back/Edge/src/assistant-evidence.mjs';
import { digest } from '../../../../../Back/Edge/src/assistant-receipts.mjs';
import { startModelStandin } from './standin.mjs';

// 凭据金丝雀：只允许存在于本包配置文件；任何业务响应/日志/审计/回执/替身请求中出现即为泄漏。
export const SECRET_API_KEY = 'SYNTHETIC-KEY-qa02-do-not-leak-7f3d';
export const SECRET_CREDENTIAL = 'SYNTHETIC-CREDENTIAL-qa02-9a1c';
export const SECRET_CREDENTIAL_B = SECRET_CREDENTIAL + '-b';

export const MATERIAL_TEXT = '合成客户申请设备回租500万元；开票与经营流水期间不同，需核对期间与重复交易。合同未付余额为应收。';
export const materialHash = () => createHash('sha256').update(MATERIAL_TEXT).digest('hex');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(cond, timeoutMs = 5000, step = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await cond()) return true; await sleep(step); }
  return false;
}

export async function makeDir(tag) { return fs.mkdtemp(path.join(os.tmpdir(), 'qa02-modelapi-' + tag + '-')); }

/**
 * 装配一个真实 Edge HTTP 实例（127.0.0.1，系统分配端口）。
 * opts.tag 测试标签；opts.contentType 'observe'|'decisions'（替身载荷）；
 * opts.timeoutMs 模型替身客户端超时；opts.configMaxContextChars 配置文件覆盖上下文上限；
 * opts.decisionRepository 装配决策账本；opts.withProfiles 装配双 profile 注册表（p0/p1 双替身）；
 * opts.oversizedEvidence 证据函数注入超限包（故障注入：模型侧须失败关闭）。
 */
export async function assemble(t, {
  tag, contentType = 'observe', timeoutMs = 2000, configMaxContextChars = null,
  decisionRepository = false, withProfiles = false, oversizedEvidence = false,
} = {}) {
  const dir = await makeDir(tag);
  const cleanups = [];
  t.after(async () => {
    for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* 尽力清理 */ } }
    await fs.rm(dir, { recursive: true, force: true });
  });

  const standinA = await startModelStandin({ label: tag + '-p0' });
  cleanups.push(standinA.close);
  const standinB = withProfiles ? await startModelStandin({ label: tag + '-p1' }) : null;
  if (standinB) cleanups.push(standinB.close);
  if (standinB) standinB.control.contentType = contentType;
  standinA.control.contentType = contentType;

  const configPath = path.join(dir, 'model-config.json');
  const writeConfig = async (mutate = () => {}) => {
    let config;
    try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
    catch {
      config = {
        ...(configMaxContextChars ? { maxContextChars: configMaxContextChars } : {}),
        transport: { mode: 'mock', mock: { baseUrl: standinA.url, timeoutMs, apiKey: SECRET_API_KEY } },
        evidencePolicy: { allowedHashes: [materialHash()] },
        budget: { maxTotalCost: 10, perCallEstimate: 0.01 },
      };
    }
    mutate(config);
    await fs.writeFile(configPath, JSON.stringify(config));
    return config;
  };
  await writeConfig();

  const logs = [];
  const modelArgs = {
    configPath, receiptsDir: path.join(dir, 'model-state'),
    costLedgerPath: path.join(dir, 'cost-ledger.jsonl'),
    requireEvidence: true, log: (m) => logs.push(String(m)),
  };

  // 超限证据故障注入：手拼超大包（绕过 prepareEvidence 截断，模拟上游错配），
  // 模型侧必须 EVIDENCE_CONTEXT_LIMIT 失败关闭且零出站。
  const oversizedPack = (tenantId, customerId, revision) => {
    const ref = { artifactId: 'big-qa', evidenceId: 'big-qa', hash: materialHash(), parserVersion: 'qa-v1',
      locator: { kind: 'extracted_text', start: 0, end: 100 }, text: 'X'.repeat(20000), limitations: [] };
    const pack = { tenantId, customerId, revision, snippets: [{ id: digest(ref), ...ref }],
      facts: [], omitted: [], authority: 'none' };
    return { ...pack, hash: digest(pack) };
  };

  let assistantModel;
  if (withProfiles) {
    const p0 = path.join(dir, 'config-p0.json');
    const p1 = path.join(dir, 'config-p1.json');
    await fs.writeFile(p0, JSON.stringify({ transport: { mode: 'mock', mock: { baseUrl: standinA.url, timeoutMs, apiKey: SECRET_API_KEY } }, evidencePolicy: { allowedHashes: [materialHash()] }, budget: { maxTotalCost: 10, perCallEstimate: 0.01 } }));
    await fs.writeFile(p1, JSON.stringify({ transport: { mode: 'mock', mock: { baseUrl: standinB.url, timeoutMs, apiKey: SECRET_API_KEY } }, evidencePolicy: { allowedHashes: [materialHash()] }, budget: { maxTotalCost: 10, perCallEstimate: 0.01 } }));
    const registryPath = path.join(dir, 'registry.json');
    await fs.writeFile(registryPath, JSON.stringify({
      profiles: [{ id: 'p0', revision: 1, configPath: 'config-p0.json' }, { id: 'p1', revision: 1, configPath: 'config-p1.json' }],
      active: { id: 'p0', revision: 1 },
    }));
    const profileOptions = { registryPath, stateDir: path.join(dir, 'profile-state'), modelOptions: modelArgs };
    assistantModel = await createAssistantProfiles(profileOptions);
    var profileOptionsRef = profileOptions;
  } else {
    assistantModel = await createAssistantModel(modelArgs);
  }

  const makeEvidence = (modelLike) => async ({ snapshot, tenantId, customerId, revision }) => {
    if (oversizedEvidence) return oversizedPack(tenantId, customerId, revision);
    const pol = modelLike.evidencePolicy();
    return prepareEvidence({ tenantId, customerId, revision, allowedHashes: pol.allowedHashes, maxChars: pol.maxChars,
      materials: [{ tenantId, customerId, hash: materialHash(), artifactId: 'orig-qa', evidenceId: 'ev-qa',
        parserVersion: 'qa-v1', current: true, text: MATERIAL_TEXT }] });
  };

  const store = createFixtureStore();
  const snapshotOf = (customerId, tenantId) => ({ customer: { name: '合成客户-' + customerId },
    admission: { inputVersion: 0, scope: { revision: 0, tenantId }, assessmentState: 'awaiting_human_review',
      candidate: { version: 1, suggestedAmount: 1000000, suggestedTermMonths: 36, tendency: 'cautious_do' },
      cells: [], blockers: [] } });
  store.upsertCustomer('qa-cust-1', snapshotOf('qa-cust-1', 'qa-tenant-A'));

  const sessionStore = createSessionStore({});
  const control = { permitted: true };
  const verifyCredential = async ({ credential }) => {
    if (credential === SECRET_CREDENTIAL) return { ok: true, principalId: 'qa-operator', roles: ['admin'], tenantId: 'qa-tenant-A' };
    if (credential === SECRET_CREDENTIAL_B) return { ok: true, principalId: 'qa-operator-b', roles: ['admin'], tenantId: 'qa-tenant-B' };
    if (credential === 'qa-credential-nonadmin') return { ok: true, principalId: 'qa-business', roles: ['business'], tenantId: 'qa-tenant-A' };
    return { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
  };
  const audit = createAuditSink();
  const edge = await startEdgeServer({
    port: 0, seal: { buildId: 'qa02-model-api' }, probes: [], store, sessionStore, verifyCredential,
    auth: async ({ session }) => ({ ok: !!session && control.permitted }),
    assistantModel, assistantEvidence: makeEvidence(assistantModel),
    decisionRepository: decisionRepository ? createDecisionFeedbackStore(dir) : null,
    auditSink: audit, log: (m) => logs.push(String(m)),
  });
  cleanups.push(() => { edge.server.closeAllConnections(); return new Promise((r) => edge.server.close(r)); });

  const base = `http://127.0.0.1:${edge.port}`;
  const responses = []; // 业务响应留痕（凭据泄漏扫描用）
  const tracked = async (r) => { const text = await r.text(); responses.push({ status: r.status, text }); return { status: r.status, json: text ? JSON.parse(text) : null }; };

  // 同目录重启一个真实 Edge（新模型实例读同一回执目录）：验证持久回执重放/损坏 fail-closed。
  const respawn = async (t2) => {
    const freshModel = withProfiles
      ? await createAssistantProfiles(profileOptionsRef)
      : await createAssistantModel(modelArgs);
    const e2 = await startEdgeServer({
      port: 0, seal: { buildId: 'qa02-model-api' }, probes: [], store, sessionStore, verifyCredential,
      auth: async ({ session }) => ({ ok: !!session && control.permitted }),
      assistantModel: freshModel, assistantEvidence: makeEvidence(freshModel),
      decisionRepository: decisionRepository ? createDecisionFeedbackStore(dir) : null,
      auditSink: audit, log: (m) => logs.push(String(m)),
    });
    const close2 = () => { e2.server.closeAllConnections(); return new Promise((r) => e2.server.close(r)); };
    if (t2) t2.after(async () => { try { await close2(); } catch { /* 尽力清理 */ } });
    else cleanups.push(close2);
    return { edge: e2, base: `http://127.0.0.1:${e2.port}`, model: freshModel };
  };

  return {
    dir, base, edge, store, snapshotOf, control, logs, audit, responses, tracked,
    standinA, standinB, configPath, writeConfig, modelArgs,
    model: assistantModel, evidence: makeEvidence(assistantModel), respawn,
    profileOptions: withProfiles ? profileOptionsRef : null,
    async login(credential) {
      const r = await fetch(base + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
      const body = await r.json();
      if (!body?.session?.sessionId) throw new Error(`session exchange failed: ${r.status} ${JSON.stringify(body)}`);
      return body.session.sessionId;
    },
    observePost(customerId, sid, body = {}, extra = {}) {
      return fetch(`${base}/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/observe`,
        { method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid, ...(extra.headers ?? {}) },
          body: JSON.stringify({ assistant: 'credit', question: '请核对当前候选方案', ...body }) });
    },
  };
}

// 验收台账：每例记录实际HTTP状态、出站计数、回执身份、current，供 REPORT.md 引用。
export const ledger = [];
export function recordCase(entry) { ledger.push({ at: new Date().toISOString(), ...entry }); }
export async function flushLedger(file) {
  await fs.writeFile(file, JSON.stringify({
    package: 'backend-qa-r2/02_model_api', node: process.version, platform: process.platform,
    recordedAt: new Date().toISOString(), cases: ledger,
  }, null, 2));
}
