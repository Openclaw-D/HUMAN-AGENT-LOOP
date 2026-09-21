// V0.4 soak-03 · 模型链路长测负载 worker（v3）。
// 被测（只读 import 本包固定快照）：assistant-model（回执围栏/身份）+ glm.mjs（三分发送/预算门/账本）。
// 设计要点：
//   - 响应形态由替身按命中序号循环确定性 pattern 决定（harness 编程），worker 不注入测试头
//     （glm.mjs 不转发任意头，属产品契约，不为测试改动）；形态↔状态断言在对账面按
//     requestId 全量 join（替身命中流 × 注册表），天然免并发窗口竞争。
//   - 进程内守卫只做可同步判定部分：重放一致性（同身份同 requestId 同状态同错误码）、
//     unknown sent=null、预算阻断 sent=false、source.mode='mock'。
//   - 硬不变量在对账面：命中必有预占、每 requestId 恰1次预占、模拟/未知/确定失败⇒恰1命中、
//     未发送家族（预算/429/不可达）⇒0命中、no_usage⇒usage=null。
//   - 确定性混合负载：新出站/近期重放/长历史冷读/未知围栏重放/作用域探针；令牌桶 ≤5 req/s、并发≤8。
// 全部合成数据；模拟标记随 source.mode='mock'/status='simulated' 透出，不称真实模型质量。
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 权重游走：权重表为 [key, weight]（weight 为正数，按总和归一，不要求 ≤1）。 */
const pick = (r, weights) => {
  let total = 0;
  for (const [, w] of weights) total += w;
  let x = r() * total;
  for (const [key, w] of weights) { x -= w; if (x < 0) return key; }
  return weights[weights.length - 1][0];
};
const percentile = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round1 = (v) => v == null ? null : Math.round(v * 10) / 10;

const CUSTOMERS = Array.from({ length: 12 }, (_, i) => `soak-c-${String(i).padStart(2, '0')}`);
const CUSTOMER_WEIGHTS = [['soak-c-00', 4], ['soak-c-01', 3], ...CUSTOMERS.slice(2).map((c) => [c, 1])];
const ASSISTANTS = ['business', 'policy', 'credit', 'commerce', 'asset', 'jianwei'];
const QUESTIONS = Array.from({ length: 48 }, (_, i) => `soak 合成问题${i}：请核对当前候选方案与证据一致性并指出待核验点`);
const ASSISTANT_WEIGHTS = ASSISTANTS.map((a) => [a, 1]);
const QUESTION_WEIGHTS = QUESTIONS.map((q) => [q, 1]);

/** 操作权重：new=新身份出站；dup=近期身份重放；readOld=长历史冷读重放；dupUnknown=未知围栏重放；
 *  scopeProbe=低频客户新身份；tenantProbe=跨租户作用域探针。 */
const OP_WEIGHTS = {
  normal: [['new', .40], ['dup', .45], ['dupUnknown', .05], ['scopeProbe', .05], ['tenantProbe', .05]],
  negative: [['new', .55], ['dup', .30], ['dupUnknown', .05], ['scopeProbe', .05], ['tenantProbe', .05]],
  replay: [['new', .12], ['dup', .73], ['dupUnknown', .05], ['scopeProbe', .05], ['tenantProbe', .05]],
  history: [['new', .10], ['dup', .35], ['readOld', .40], ['dupUnknown', .05], ['scopeProbe', .05], ['tenantProbe', .05]],
};
const FORM_DELAY = { delay50: 50, delay200: 200, delay1000: 1000, delay4000: 4000 };
/** 替身形态 → (期望status, sentFlag, 期望错误码)——glm.mjs 三分发送语义 soak 断言表。
 *  注意：glm 对非 429/401 的 HTTP 错误采用响应体 error 字符串作为 code（stub 错误体即此字符串）。 */
function expectOf(form) {
  switch (form) {
    case 'ok': case 'delay50': case 'delay200': case 'delay1000':
      return { status: 'simulated', sent: true, code: null };
    case 'no_usage': return { status: 'simulated', sent: true, code: null, usageNull: true };
    case 'delay4000': return { status: 'unknown', sent: null, code: 'RESULT_UNKNOWN_TIMEOUT' };
    case 'status429': return { status: 'failed', sent: false, code: 'RATE_LIMITED' };
    case 'status500': return { status: 'failed', sent: true, code: 'UPSTREAM_SYNTHETIC_500' };
    case 'error_json503': return { status: 'failed', sent: true, code: 'UPSTREAM_SYNTHETIC_503' };
    case 'malformed': return { status: 'failed', sent: true, code: 'RESPONSE_CORRUPTED' };
    case 'truncated': return { status: 'unknown', sent: null, code: 'RESULT_UNKNOWN_TRUNCATED' };
    case 'destroy': return { status: 'unknown', sent: null, code: 'RESULT_UNKNOWN_INTERRUPTED' };
    default: return null; // 未知形态（不应出现）由对账面报告
  }
}
const notSentFamily = (errorCode) => (errorCode ?? '').startsWith('BUDGET_') || errorCode === 'TRANSPORT_UNREACHABLE';
// 注意命中数语义：RATE_LIMITED(429) 请求已到达替身（1命中）但按契约属"未被处理"家族（sentFlag=false）；
// 真正的 0 命中只属于：预算阻断（未出进程）与 TRANSPORT_UNREACHABLE（连接未建立）。

/** 身份字段包 → observe 输入（确定性；cv 即材料版本，变化 = 新身份，旧身份回执仍可重放）。 */
function buildObserveInput({ customerId, assistant, question, cv, tenantId }) {
  cv = Number(cv) ?? 0;
  const k = CUSTOMERS.indexOf(customerId) + 1;
  return {
    customerId, tenantId: tenantId ?? 'soak-tenant-A', assistant, question,
    context: {
      customerName: `soak 合成客户 ${customerId}`,
      contextVersion: String(cv),
      assessmentState: 'awaiting_human_review',
      candidate: { version: cv + 1, suggestedAmount: 1000000 + cv * 1000 + k * 137, suggestedTermMonths: 36, tendency: 'cautious_do' },
      blockersCount: k % 3,
      materialsByDomain: { credit: 1 + (cv % 2), commerce: 1 },
      evidenceRefs: [],
    },
  };
}
const identityKeyOf = (bag) => `${bag.customerId}|${bag.assistant}|${bag.question}|cv${Number(bag.cv) ?? 0}|${bag.tenantId ?? 'soak-tenant-A'}`;

class TokenBucket {
  constructor({ ratePerSec, burst }) { this.rate = ratePerSec; this.tokens = burst; this.burst = burst; this.last = Date.now(); }
  setRate(r) { this.rate = Math.max(0.5, Math.min(5, r)); }
  async take() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await sleep(25);
    }
  }
}

async function stubStats(stubUrl) {
  return new Promise((resolve, reject) => {
    http.get(`${stubUrl}/__control/stats`, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function drainHits(stubUrl, after, sink) {
  return new Promise((resolve, reject) => {
    http.get(`${stubUrl}/__control/hits?after=${after}`, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { const j = JSON.parse(text); for (const it of j.items) sink(it); resolve(j.next); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

export async function runWorker(args) {
  const {
    runDir, workerDir, snapshotEdgeDir, ledgerPath, stubUrl,
    seed, phaseName, durationMs, concurrency,
    profilePlan, mode = 'load', probes = [],
    tenantId = 'soak-tenant-A', tenantProbeId = 'soak-tenant-B',
    shedFile = null, maxNewRecords = 7000,
  } = args;
  await fs.mkdir(workerDir, { recursive: true });
  await fs.mkdir(path.join(workerDir, 'model-state', 'receipts'), { recursive: true });
  const configPath = path.join(workerDir, 'model-config.json');
  await fs.writeFile(configPath, JSON.stringify({
    transport: { mode: 'mock', mock: { baseUrl: stubUrl, timeoutMs: 2500 } },
    budget: { maxTotalCost: 200, perCallEstimate: 0.01, customerMax: 8, maxCalls: 20000, maxCallsPerSession: 5000 },
  }));
  const modelMod = await import(pathToFileURL(path.resolve(snapshotEdgeDir, 'assistant-model.mjs')).href);
  const model = await modelMod.createAssistantModel({
    configPath,
    receiptsDir: path.join(workerDir, 'model-state'),
    costLedgerPath: ledgerPath,
    log: () => {},
  });
  const registryPath = path.join(workerDir, 'registry.jsonl');
  const samplesPath = path.join(workerDir, 'samples.jsonl');
  const log5Path = path.join(workerDir, 'log5min.jsonl');
  const resultPath = path.join(workerDir, `phase-result-${phaseName}.json`);

  const r = rng(seed);
  const bucket = new TokenBucket({ ratePerSec: 5, burst: 8 });
  const counters = {
    ops: 0, success: 0, expectedReject: 0, unexpectedError: 0, replayedCount: 0,
    unknownCount: 0, budgetBlocked: 0, newOutbound: 0, mergedConcurrent: 0,
    probesOk: 0, probesFailed: 0, controlErrors: 0,
    violations: [], formStatus: {}, latencyByClass: { success: [], unknown: [], failed: [] },
    overheadByForm: {}, statusByCode: {},
  };
  let controlErrors = 0;
  process.on('unhandledRejection', (e) => {
    controlErrors++; counters.controlErrors = controlErrors;
    counters.violations.push({ at: new Date().toISOString(), kind: 'CONTROL', why: String(e?.stack ?? e).slice(0, 300) });
    if (controlErrors > 500) process.exit(4);
  });
  let lastControlError = null;
  const tolerant = async (fn, fallback) => {
    try { return await fn(); } catch (e) { controlErrors++; counters.controlErrors = controlErrors; lastControlError = String(e?.message ?? e).slice(0, 200); counters.lastControlError = lastControlError; return fallback; }
  };

  const registry = new Map();  // requestId → record
  const registryArr = [];
  const byIdKey = new Map();   // identityKey → record
  const unknownArr = [];
  const pendingIdKeys = new Set(); // 在途身份（并发同身份 → 合并分类，既有契约 RF-05）
  const cvOf = new Map(CUSTOMERS.map((c) => [c, 0]));
  let newOpCounter = 0;

  if (mode === 'load') {
    try {
      const text = await fs.readFile(registryPath, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line);
        if (!registry.has(rec.requestId)) {
          registry.set(rec.requestId, rec); registryArr.push(rec);
          if (!byIdKey.has(rec.idKey)) byIdKey.set(rec.idKey, rec);
          if (rec.status === 'unknown') unknownArr.push(rec);
        }
      }
      counters.resumedRegistry = registry.size;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  const remember = async (rec) => {
    if (registry.has(rec.requestId)) return;
    registry.set(rec.requestId, rec); registryArr.push(rec);
    if (!byIdKey.has(rec.idKey)) byIdKey.set(rec.idKey, rec);
    if (rec.status === 'unknown') unknownArr.push(rec);
    await fs.appendFile(registryPath, JSON.stringify(rec) + '\n', 'utf8');
  };

  const bumpMatrix = (form, cell) => {
    const m = counters.formStatus;
    m[form] = m[form] ?? {};
    m[form][cell] = (m[form][cell] ?? 0) + 1;
  };
  function guardFail(input, why, out) {
    const v = {
      at: new Date().toISOString(), kind: 'GUARD', why,
      requestId: out?.requestId ?? null, status: out?.status ?? null, sent: out?.sent ?? null,
      code: out?.error?.code ?? null, customerId: input.customerId, tenantId: input.tenantId,
    };
    counters.violations.push(v);
    counters.unexpectedError++;
    return 'unexpected_error';
  }

  // ---- 替身命中增量缓存：requestId → {n, form} ----
  const hitCache = new Map();
  let hitsCursor = 0;
  let hitsDraining = false;
  async function drainStubHits() {
    if (hitsDraining) return;
    hitsDraining = true;
    try {
      hitsCursor = await drainHits(stubUrl, hitsCursor, (it) => {
        const requestId = it.requestId;
        const form = it.form;
        const cur = hitCache.get(requestId) ?? { n: 0, form: null };
        cur.n++; cur.form = form ?? cur.form;
        hitCache.set(requestId, cur);
      });
    } finally { hitsDraining = false; }
  }
  const hitsOf = (requestId) => hitCache.get(requestId) ?? { n: 0, form: null };

  /** 单次调用 + 进程内守卫。 */
  async function executeOp({ input, seedRec = null, expectMerge = false }) {
    const t0 = Date.now();
    const out = await model.observe(input);
    const latency = Date.now() - t0;
    await tolerant(() => drainStubHits());
    const requestId = out.requestId ?? null;
    counters.ops++;
    let cell;
    const code = out.error?.code ?? null;
    const fail = (why) => guardFail(input, why, out);
    if (out.replayed === true) {
      counters.replayedCount++; cell = 'replayed';
      if (seedRec) {
        if (seedRec.requestId !== requestId) cell = fail('同身份重放 requestId 漂移');
        else if (seedRec.status !== out.status) cell = fail(`重放状态漂移 ${seedRec.status}→${out.status}`);
        else if (seedRec.status === 'unknown' && seedRec.errorCode && out.error?.code !== seedRec.errorCode) cell = fail('未知重放错误码漂移');
      }
    } else if (expectMerge) {
      counters.mergedConcurrent++;
      cell = out.status === 'failed' ? 'failed_expected' : (out.status === 'unknown' ? 'unknown' : 'simulated');
      if (out.status === 'unknown' && out.sent !== null) cell = fail('合并路径 unknown 但 sent 非 null');
    } else if (out.status === 'simulated') {
      counters.success++; counters.latencyByClass.success.push(latency); cell = 'simulated'; counters.newOutbound++;
      if (out.source?.mode !== 'mock') cell = fail(`source.mode 非 mock: ${out.source?.mode ?? 'null'}`);
    } else if (out.status === 'unknown') {
      counters.unknownCount++; counters.latencyByClass.unknown.push(latency); cell = 'unknown';
      if (out.sent !== null) cell = fail(`unknown 但 sent=${out.sent}`);
    } else if (out.status === 'failed') {
      counters.expectedReject++; counters.latencyByClass.failed.push(latency);
      if (typeof code === 'string' && code.startsWith('BUDGET_')) {
        counters.budgetBlocked++; cell = 'budget_blocked';
        if (out.sent !== false) cell = fail(`预算阻断但 sent=${out.sent}`);
      } else cell = 'failed_expected';
    } else cell = fail(`意外 status=${out.status}`);
    counters.statusByCode[code ?? out.status] = (counters.statusByCode[code ?? out.status] ?? 0) + 1;
    return { out, cell, latency };
  }

  // ---- 身份/操作选择（权重表按总和归一）----
  function nextCv(customerId) {
    newOpCounter++;
    if (newOpCounter % 1200 === 0) {
      const c = CUSTOMERS[((newOpCounter / 1200) - 1) % CUSTOMERS.length];
      cvOf.set(c, cvOf.get(c) + 1);
    }
    return cvOf.get(customerId);
  }
  const pickBag = (over = {}) => {
    const customerId = over.customerId ?? pick(r, CUSTOMER_WEIGHTS);
    return {
      customerId,
      assistant: pick(r, ASSISTANT_WEIGHTS),
      question: pick(r, QUESTION_WEIGHTS),
      cv: nextCv(customerId),
      tenantId: over.tenantId ?? tenantId,
    };
  };
  const rebuildInput = (rec) => buildObserveInput(rec);

  /** 新身份族公共路径：同步占位 → 出站 → 登记。返回 null 表示按合并/重放处理已完成。 */
  async function freshNew({ bag, opKind }) {
    const idKey = identityKeyOf(bag);
    const existing = byIdKey.get(idKey);
    // 长历史上限护栏：注册表达到上限后新身份退化为既有身份重放（契约：长历史最多 10000 事件）
    if (!existing && registry.size >= maxNewRecords && registryArr.length) {
      const rec = registryArr[Math.floor(r() * registryArr.length)];
      await executeOp({ input: rebuildInput(rec), seedRec: rec });
      return;
    }
    if (existing && !pendingIdKeys.has(idKey)) {
      await executeOp({ input: buildObserveInput(bag), seedRec: existing });
      return;
    }
    if (pendingIdKeys.has(idKey)) {
      await executeOp({ input: buildObserveInput(bag), expectMerge: true });
      return;
    }
    pendingIdKeys.add(idKey);
    try {
      const { out, latency } = await executeOp({ input: buildObserveInput(bag) });
      await remember({
        requestId: out.requestId, idKey, customerId: bag.customerId, assistant: bag.assistant,
        question: bag.question, cv: bag.cv, tenantId: bag.tenantId, status: out.status,
        errorCode: out.error?.code ?? null,
        sentFalse: out.status === 'failed' && out.sent === false,
        usageNull: out.usage == null, latency, opKind, at: new Date().toISOString(),
      });
      if (out.status === 'unknown') { /* unknownArr 由 remember 维护 */ }
    } finally {
      pendingIdKeys.delete(idKey);
    }
  }

  // ---- 账本增量对账（硬不变量 + 形态↔状态 join）----
  async function readLedger() {
    let text;
    try { text = await fs.readFile(ledgerPath, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const entries = [];
    for (const line of text.split('\n')) { if (line.trim()) entries.push(JSON.parse(line)); }
    return entries;
  }
  async function reconcile() {
    await drainStubHits();
    const stats = await stubStats(stubUrl);
    const entries = await readLedger();
    const reserveCount = new Map();
    let reserveSum = 0, actualCount = 0, actualSum = 0;
    const ledgerProblems = [];
    for (const e of entries) {
      if (e.type === 'reserve') {
        reserveCount.set(e.requestId, (reserveCount.get(e.requestId) ?? 0) + 1);
        reserveSum += e.amount;
        if (!(typeof e.amount === 'number' && Number.isFinite(e.amount) && e.amount >= 0)) ledgerProblems.push(`reserve amount 非法 ${e.requestId}`);
      } else if (e.type === 'actual') { actualCount++; actualSum += e.amount ?? 0; }
      else ledgerProblems.push(`未知账本条目 type=${e.type}`);
    }
    let hitWithoutReserve = 0, dupReserve = 0, reserveWithoutHit = 0;
    for (const [reqId, h] of hitCache) if (h.n > 0 && !reserveCount.get(reqId)) hitWithoutReserve++;
    for (const [reqId, n] of reserveCount) {
      if (n > 1) dupReserve++;
      else if (!hitCache.get(reqId)) reserveWithoutHit++;
    }
    // 注册表 × 命中流 join：命中数规则 + 形态↔状态映射 + 开销
    let regChecked = 0, regBad = 0, regBadSample = null;
    const formCells = {}; const overhead = {};
    for (const rec of registryArr) {
      const h = hitsOf(rec.requestId);
      const notSent = notSentFamily(rec.errorCode); // 仅预算阻断/不可达=0命中；429 已到达未处理=1
      const expectN = notSent ? 0 : 1;
      let bad = h.n !== expectN;
      let why = null;
      if (!bad && h.n === 1) {
        const exp = expectOf(h.form);
        if (!exp) { bad = true; why = `未知替身形态 ${h.form}`; }
        else if (exp.status === 'simulated') {
          if (rec.status !== 'simulated') { bad = true; why = `形态${h.form}期望simulated实际${rec.status}/${rec.errorCode}`; }
          else if (exp.usageNull && !rec.usageNull) { bad = true; why = 'no_usage 形态出现 usage'; }
        } else if (exp.status === 'unknown') {
          if (rec.status !== 'unknown' || rec.errorCode !== exp.code) { bad = true; why = `形态${h.form}期望${exp.status}/${exp.code}实际${rec.status}/${rec.errorCode}`; }
        } else if (exp.status === 'failed') {
          if (rec.status !== 'failed' || rec.errorCode !== exp.code || rec.sentFalse !== (exp.sent === false)) {
            bad = true; why = `形态${h.form}期望failed/${exp.code}/sent${exp.sent}实际${rec.status}/${rec.errorCode}`;
          }
        }
        if (!bad && FORM_DELAY[h.form] != null && rec.status !== 'failed' && rec.latency != null) {
          (overhead[h.form] ??= []).push(Math.max(0, rec.latency - FORM_DELAY[h.form]));
        }
      }
      regChecked++;
      if (bad) {
        regBad++;
        if (!regBadSample) regBadSample = { requestId: rec.requestId, status: rec.status, errorCode: rec.errorCode, hits: h.n, form: h.form, why };
      }
      if (h.n === 1) {
        const cell = rec.status === 'unknown' ? 'unknown' : rec.status === 'failed' ? (notSent ? 'notsent' : 'failed') : 'simulated';
        formCells[h.form] = formCells[h.form] ?? {};
        formCells[h.form][cell] = (formCells[h.form][cell] ?? 0) + 1;
      }
    }
    const rec = {
      at: new Date().toISOString(), stubHits: stats.hits, localHitKeys: hitCache.size,
      reserveRequestIds: reserveCount.size, reserveSum: round1(reserveSum),
      actualCount, actualSum: round1(actualSum),
      hitWithoutReserve, dupReserve, reserveWithoutHit, dupHitRequestIds: stats.duplicateRequestIds,
      registryChecked: regChecked, registryHitsBad: regBad, registryBadSample: regBadSample,
      ledgerProblems: ledgerProblems.slice(0, 10),
    };
    counters.formStatus = formCells;
    counters.overheadByForm = Object.fromEntries(Object.entries(overhead).map(([k, v]) => [k, {
      n: v.length, p50: percentile(v, 50), p95: percentile(v, 95), intendedMs: FORM_DELAY[k],
    }]));
    if (hitWithoutReserve > 0 || dupReserve > 0 || ledgerProblems.length || regBad > 0) {
      counters.violations.push({ at: rec.at, kind: 'RECONCILE', why: '账本↔替身↔注册表对账破坏', rec });
    }
    return rec;
  }

  // ---- 采样 ----
  let lagAccum = [];
  const lagTimer = setInterval(() => {
    const t0 = process.hrtime.bigint();
    setImmediate(() => { lagAccum.push(Number(process.hrtime.bigint() - t0) / 1e6); });
  }, 5000);
  lagTimer.unref?.();
  let lastSampleAt = Date.now();
  async function sampleMinute(label) {
    const mem = process.memoryUsage();
    const lag = lagAccum; lagAccum = [];
    const sample = {
      at: new Date().toISOString(), phase: label, pid: process.pid,
      rssMB: round1(mem.rss / 1048576), heapUsedMB: round1(mem.heapUsed / 1048576), externalMB: round1(mem.external / 1048576),
      lagMaxMs: round1(lag.length ? Math.max(...lag) : 0), lagAvgMs: round1(lag.reduce((a, b) => a + b, 0) / Math.max(1, lag.length)),
      handles: (process.getActiveResourcesInfo?.() ?? []).length,
      ops: counters.ops, success: counters.success, replayed: counters.replayedCount,
      unknown: counters.unknownCount, expectedReject: counters.expectedReject, unexpected: counters.unexpectedError,
      ratePerSec: round1((counters.ops - (counters._opsMark ?? 0)) / Math.max(1, (Date.now() - lastSampleAt) / 1000)),
    };
    counters._opsMark = counters.ops;
    lastSampleAt = Date.now();
    await fs.appendFile(samplesPath, JSON.stringify(sample) + '\n', 'utf8');
    return sample;
  }
  async function aggregate5min(label, sample) {
    const line = {
      at: sample.at, phase: label, window: '5min',
      opsTotal: counters.ops, success: counters.success, replayed: counters.replayedCount,
      unknown: counters.unknownCount, expectedReject: counters.expectedReject, unexpected: counters.unexpectedError,
      violations: counters.violations.length,
    };
    await fs.appendFile(log5Path, JSON.stringify(line) + '\n', 'utf8');
  }

  // ---- 探针模式（恢复周期：重启后围栏验证；探针期望 0 新出站 + 身份一致）----
  if (mode === 'probe') {
    const probeResults = [];
    for (const p of probes) {
      const input = rebuildInput(p);
      const before = await tolerant(() => stubStats(stubUrl), null);
      const out = await model.observe(input);
      await tolerant(() => drainStubHits());
      const after = before ? await tolerant(() => stubStats(stubUrl), null) : null;
      const delta = before && after ? after.hits - before.hits : -1;
      const ok = delta === 0 && out.requestId === p.requestId;
      const rec = {
        requestId: p.requestId, prevStatus: p.status, gotStatus: out.status, replayed: out.replayed,
        code: out.error?.code ?? null, hitsDelta: delta, ok,
        why: ok ? null : `探针出站增量=${delta} 或 requestId 漂移（${p.requestId}→${out.requestId}）`,
      };
      probeResults.push(rec);
      if (ok) counters.probesOk++;
      else { counters.probesFailed++; counters.violations.push({ at: new Date().toISOString(), kind: 'PROBE', rec }); }
    }
    await fs.writeFile(resultPath, JSON.stringify({ mode, probeResults, probesOk: counters.probesOk, probesFailed: counters.probesFailed, violations: counters.violations.slice(0, 50) }, null, 1));
    console.log(JSON.stringify({ ev: 'done', mode, probesOk: counters.probesOk, probesFailed: counters.probesFailed }));
    return;
  }

  // ---- 负载主循环 ----
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  const plan = profilePlan ?? [{ profile: 'normal', ms: durationMs }];
  let planIdx = 0, planStart = Date.now();
  let stop = false;
  process.on('SIGTERM', () => { stop = true; });
  process.on('SIGINT', () => { stop = true; });
  console.log(JSON.stringify({ ev: 'start', phase: phaseName, pid: process.pid, seed, concurrency, durationMs }));

  const lane = async () => {
    while (!stop && Date.now() < deadline) {
      await bucket.take();
      if (stop || Date.now() >= deadline) break;
      const prof = plan[planIdx]?.profile ?? 'normal';
      const opKind = pick(r, OP_WEIGHTS[prof] ?? OP_WEIGHTS.normal);
      try {
        if (opKind === 'new' || opKind === 'scopeProbe' || opKind === 'tenantProbe') {
          const bag = pickBag(opKind === 'tenantProbe' ? { tenantId: tenantProbeId } : {});
          await freshNew({ bag, opKind });
        } else {
          let rec = null;
          if (opKind === 'dup') rec = registryArr.length ? registryArr[Math.floor(r() * registryArr.length)] : null;
          else if (opKind === 'readOld') {
            const cut = Math.max(1, Math.floor(registryArr.length * 0.25));
            rec = registryArr.length ? registryArr[Math.floor(r() * cut)] : null;
          } else if (opKind === 'dupUnknown') rec = unknownArr.length ? unknownArr[Math.floor(r() * unknownArr.length)] : null;
          if (!rec) {
            await freshNew({ bag: pickBag(), opKind: 'new' });
          } else {
            await executeOp({ input: rebuildInput(rec), seedRec: rec });
          }
        }
      } catch (e) {
        counters.unexpectedError++;
        counters.violations.push({ at: new Date().toISOString(), kind: 'LOOP', why: String(e?.stack ?? e).slice(0, 400) });
        if (counters.violations.length > 200) stop = true;
      }
    }
  };

  const heartbeat = (async () => {
    let minute = 0;
    while (!stop && Date.now() < deadline) {
      await sleep(Math.max(1000, 60000 - (Date.now() - lastSampleAt)));
      if (stop || Date.now() >= deadline) break;
      minute++;
      try {
        const label = plan[planIdx]?.profile ?? phaseName;
        const sample = await sampleMinute(label);
        if (minute % 5 === 0) await aggregate5min(label, sample);
        await tolerant(() => reconcile());
        if (Date.now() - planStart >= (plan[planIdx]?.ms ?? durationMs)) { planIdx++; planStart = Date.now(); }
        if (shedFile) {
          try {
            const shed = JSON.parse(await fs.readFile(shedFile, 'utf8'));
            bucket.setRate(shed.rate === 2 ? 2 : 5);
          } catch { bucket.setRate(5); }
        }
        if ((process.memoryUsage().rss / 1048576) > 900) bucket.setRate(2); else bucket.setRate(5);
        console.log(JSON.stringify({ ev: 'tick', sample }));
      } catch (e) {
        counters.violations.push({ at: new Date().toISOString(), kind: 'HEARTBEAT', why: String(e?.stack ?? e).slice(0, 300) });
      }
    }
  })();

  await Promise.all(Array.from({ length: concurrency }, lane).concat([heartbeat]));
  await tolerant(() => drainStubHits());
  const finalReconcile = await tolerant(() => reconcile(), { note: '控制面不可用，终局对账跳过' });
  const result = {
    phase: phaseName, mode, startedAt: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(),
    effectiveMs: Date.now() - startedAt, seed, concurrency, plan,
    counters: {
      ops: counters.ops, success: counters.success, replayed: counters.replayedCount,
      unknown: counters.unknownCount, expectedReject: counters.expectedReject, budgetBlocked: counters.budgetBlocked,
      unexpected: counters.unexpectedError, mergedConcurrent: counters.mergedConcurrent, controlErrors,
      lastControlError: counters.lastControlError ?? null,
      newOutbound: counters.newOutbound, probesOk: counters.probesOk, probesFailed: counters.probesFailed,
      resumedRegistry: counters.resumedRegistry ?? 0,
      formStatus: counters.formStatus, statusByCode: counters.statusByCode,
      overheadByForm: counters.overheadByForm,
      latencyByClass: Object.fromEntries(Object.entries(counters.latencyByClass).map(([k, v]) => [k, {
        n: v.length, p50: percentile(v, 50), p95: percentile(v, 95), p99: percentile(v, 99), max: v.length ? Math.max(...v) : null,
      }])),
      violations: counters.violations.slice(0, 100), violationCount: counters.violations.length,
    },
    finalReconcile, registrySize: registry.size,
  };
  await fs.writeFile(resultPath, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ ev: 'done', phase: phaseName, ops: counters.ops, success: counters.success,
    replayed: counters.replayedCount, unknown: counters.unknownCount, expectedReject: counters.expectedReject,
    unexpected: counters.unexpectedError, violations: counters.violationCount, effectiveMs: result.effectiveMs }));
}

const isMain = process.argv[1] && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await runWorker(JSON.parse(process.argv[2] ?? '{}'));
