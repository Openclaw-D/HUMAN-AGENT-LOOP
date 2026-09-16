// 产品接入桥(R3):把主产品 remote-store 的真实形状映射为协议 jianwei.dd.analyze/v1 请求,
// 并生成与请求同源的快照回调。纯函数、零依赖、不发请求、不持久化任何业务状态
// (避免复制出第二份业务状态——业务事实始终在产品 store)。
//
// 关键映射(R2 FIELD_MAPPING 遗留裁决的关闭):
//  - generation:协议代次 = 产品代次 + 1(产品 remote-session generation 初始 0、legacy 补 0,
//    协议要求正整数;偏移在桥层完成,不改产品事实、不改协议)。
//  - contextVersion:`rv${store.version}`(store.version 即 API 暴露的 remoteVersion,
//    每次成功写 +1;带 rv 前缀防与产品代次数值混淆)。
//  - 原子读取:桥只接受 storeReader() 单次一致性读(产品 remote-store 单文件 JSON 读满足;
//    分次拼接的读取不得传入)。一次读取同时产出 generation/contextVersion/evidenceRefs,
//    请求载荷内部绝不撕裂;reader 返回缺任一元 → 失败关闭,不用默认常数补齐。
//  - superseded 证据:evidence.supersededBy !== null 的记录被显式过滤(不是静默——
//    bridgeMeta.supersededFiltered 计数回传,调用方可审计)。
import { evidenceToRefs, canonicalRequestId } from '../integration/product-mapping.mjs';
import { payloadHash } from '../dedupe.mjs';

const PROTOCOL_GENERATION_OFFSET = 1;
const BRIDGE_ID = 'jianwei.r3.product-bridge@1';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fail(code, message, details) {
  return { ok: false, code, message, details: details ?? null };
}

/**
 * 单次一致性读取产品 store。
 * storeReader: () => RemoteStoreState 投影 { version, sessions, evidence }。
 *   - 必须是单次调用内一致(remote-store 单文件 JSON 读满足);
 *   - sessions/evidence 为完整数组(桥自行筛选当前会话与有效证据)。
 * 返回 { ok, store|error }。
 */
function readStoreOnce(storeReader) {
  if (typeof storeReader !== 'function') {
    return { ok: false, error: fail('BRIDGE_READER_REQUIRED', '必须传入 storeReader 单次一致性读取函数;禁止用离散字段/默认常数拼装(无法保证原子读取)') };
  }
  let store;
  try {
    store = storeReader();
  } catch (err) {
    return { ok: false, error: fail('BRIDGE_READER_THROWN', `storeReader 读取失败:${(err && err.message) || 'unknown'}`) };
  }
  if (!isPlainObject(store)) {
    return { ok: false, error: fail('MAPPING_MISSING_FIELDS', 'storeReader 必须返回对象 { version, sessions, evidence }') };
  }
  if (!Number.isInteger(store.version)) {
    return { ok: false, error: fail('MAPPING_MISSING_FIELDS', 'store.version(remoteVersion)缺失或非整数;拒绝正式输出,不用默认常数补齐', { field: 'version' }) };
  }
  if (!Array.isArray(store.sessions) || !Array.isArray(store.evidence)) {
    return { ok: false, error: fail('MAPPING_MISSING_FIELDS', 'store.sessions / store.evidence 必须是数组', { sessions: Array.isArray(store.sessions), evidence: Array.isArray(store.evidence) }) };
  }
  return { ok: true, store };
}

function findSession(store, sessionId) {
  const session = store.sessions.find((s) => isPlainObject(s) && s.sessionId === sessionId);
  if (!isPlainObject(session)) {
    return { ok: false, error: fail('MAPPING_MISSING_FIELDS', `sessions 中不存在 sessionId=${sessionId}`, { field: 'sessions' }) };
  }
  if (!Number.isInteger(session.generation) || session.generation < 0) {
    return { ok: false, error: fail('MAPPING_MISSING_FIELDS', 'session.generation 缺失或非法(产品应为非负整数,legacy 补 0);拒绝正式输出', { field: 'generation' }) };
  }
  if (!isPlainObject(session.projectId) && typeof session.projectId !== 'string') {
    // projectId 在类型上必为 string;这里只挡"缺失"
    if (typeof session.projectId !== 'string' || session.projectId.length === 0) {
      return { ok: false, error: fail('MAPPING_MISSING_FIELDS', 'session.projectId 缺失', { field: 'projectId' }) };
    }
  }
  return { ok: true, session };
}

/**
 * 构建协议请求 + 同源快照回调(接口 v1)。
 * 输入:
 *   storeReader : () => { version:number, sessions:RemoteSessionRecord[], evidence:EvidenceRecord[] }
 *   sessionId   : 目标会话
 *   op / seq    : 操作名与序号(与 sessionId/generation 共同派生确定性 requestId)
 *   role/purpose: 协议角色与用途(适配器侧再做角色配置校验)
 *   text        : 经允许的合成/去标识文本(脱敏责任在业务层,桥原样透传)
 * 返回:
 *   { ok:true,
 *     request:{ requestId, projectId, sessionId, generation, contextVersion, role, purpose, text, evidenceRefs },
 *     snapshot: () => ({ generation, contextVersion, paused }),   // 每次调用 fresh 单次读取(供适配器 stale 核对)
 *     payloadHash,                                                   // 请求载荷指纹(去重观测用)
 *     bridgeMeta: { bridgeId, productGeneration, remoteVersion, evidenceCount, supersededFiltered } }
 *   | { ok:false, code, message(中文), details }
 */
export function buildAnalyzeRequest({ storeReader, sessionId, op, seq, role, purpose, text }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return fail('MAPPING_MISSING_FIELDS', 'sessionId 缺失', { field: 'sessionId' });
  }
  if (typeof op !== 'string' || op.length === 0 || !Number.isInteger(seq) || seq <= 0) {
    return fail('MAPPING_MISSING_FIELDS', 'op/seq 缺失或非法(op 非空字符串,seq 正整数)', { field: 'op,seq' });
  }
  if (typeof text !== 'string') {
    return fail('MAPPING_MISSING_FIELDS', 'text 必须是字符串(允许空串)', { field: 'text' });
  }

  const read = readStoreOnce(storeReader);
  if (!read.ok) return read.error;
  const store = read.store;

  const found = findSession(store, sessionId);
  if (!found.ok) return found.error;
  const session = found.session;

  // 证据:当前会话 + 未被取代(supersededBy === null);过滤显式计数,不静默。
  const sessionEvidence = store.evidence.filter((e) => isPlainObject(e) && e.sessionId === sessionId);
  const activeEvidence = sessionEvidence.filter((e) => e.supersededBy === null);
  const supersededFiltered = sessionEvidence.length - activeEvidence.length;
  const refs = evidenceToRefs(activeEvidence, { source: `${BRIDGE_ID}:${sessionId}` });
  if (!refs.ok) return refs; // 失败关闭:缺 version/sha256 等映射错误原样拒绝(R2 product-mapping 已实现)

  const productGeneration = session.generation;
  const protocolGeneration = productGeneration + PROTOCOL_GENERATION_OFFSET;
  const contextVersion = `rv${store.version}`;
  const paused = session.status === 'paused';

  const request = {
    requestId: canonicalRequestId({ sessionId, generation: protocolGeneration, op, seq }),
    projectId: session.projectId,
    sessionId,
    generation: protocolGeneration,
    contextVersion,
    role,
    purpose,
    text,
    evidenceRefs: refs.evidenceRefs,
  };

  // 快照回调:每次调用重新单次读取(适配器在发起前与返回时各核对一次);
  // 会话消失/读取失败 → 保守停摆(generation 0 + paused:true),必然 stale,绝不放行旧结果。
  const snapshot = () => {
    try {
      const fresh = readStoreOnce(storeReader);
      if (!fresh.ok) return { generation: 0, contextVersion: '', paused: true };
      const s = fresh.store.sessions.find((x) => isPlainObject(x) && x.sessionId === sessionId);
      if (!isPlainObject(s) || !Number.isInteger(s.generation)) return { generation: 0, contextVersion: '', paused: true };
      return { generation: s.generation + PROTOCOL_GENERATION_OFFSET, contextVersion: `rv${fresh.store.version}`, paused: s.status === 'paused' };
    } catch {
      return { generation: 0, contextVersion: '', paused: true };
    }
  };

  return {
    ok: true,
    request,
    snapshot,
    payloadHash: payloadHash(request),
    bridgeMeta: {
      bridgeId: BRIDGE_ID,
      productGeneration,
      remoteVersion: store.version,
      evidenceCount: request.evidenceRefs.length,
      supersededFiltered,
    },
  };
}

/** 供适配器 analyze 的第二参:桥组装好的 context(snapshot 权威;signal 由调用方并入)。 */
export function bridgeContext(snapshot, { signal } = {}) {
  const ctx = { snapshot };
  if (signal) ctx.signal = signal;
  return ctx;
}
