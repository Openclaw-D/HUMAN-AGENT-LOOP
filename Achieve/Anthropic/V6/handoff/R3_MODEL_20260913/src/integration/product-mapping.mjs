// 产品映射模块(Agent-MAPPING,INTERFACE_R2 §6)| jianwei.dd.analyze/v1 ↔ V5-preview 远程尽调数据模型。
//
// 职责:把主产品(jianwei-v3/site/lib/v5-preview)的远程尽调记录映射为适配器协议字段;
// 纯函数、零副作用、零依赖。字段名以产品源码静态核对为准(逐项出处见 FIELD_MAPPING.md)。
//
// 失败关闭原则:关键字段缺失/非法 → 整体 ok:false,绝不以空串、默认值或猜测补齐;
// fixtureId 不是唯一标识(同一 fixture 可多次采集),单独存在不构成完整证据引用。
//
// 产品源码定位(只读核对,2026-09-13):
// - EvidenceRecord:lib/v5-preview/remote-types.ts:61-81(evidenceId/version/sha256/fixtureId/supersededBy)
//   store 校验:remote-store.ts:158-177(reqStr/reqNum);创建:remote-service.ts:331-347,378-395
// - RemoteSessionRecord:remote-types.ts:44-55(generation 注释"每次 pause_round +1",初始 0)
//   store 校验:remote-store.ts:127-156;legacy 读补 generation:0:remote-store.ts:289-294
//   暂停执行门:remote-service.ts:162-167(requireNotPaused)、849-857(stateRejection)
// - contextVersion:产品会话记录无此字段;产品侧唯一"上下文版本"是 RemoteStoreState.version
//   (remote-store.ts:44-53,每次成功写入 +1,API 以 remoteVersion 暴露:remote-service.ts:203/213/248 等)
// - 协议校验域(下游适配器,src/validate-request.mjs):generation 正整数(49-51 行)、
//   contextVersion 非空字符串或正整数(22-24 行)、evidenceRefs 每项 id/version/hash 非空字符串(61-70 行)。
//   因此 evidence.version(number)必须 String() 转换;产品 generation 初始 0 无法直接过协议(接入缺口,见文档)。

/** 产品会话状态枚举(remote-types.ts:6,'paused' 是唯一暂停态)。 */
const PRODUCT_SESSION_STATUSES = Object.freeze(['scheduled', 'live', 'paused', 'ended']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 与下游适配器 src/validate-request.mjs:22-24 完全一致:非空字符串或正整数。 */
function isValidContextVersion(v) {
  return isNonEmptyString(v) || (Number.isInteger(v) && v > 0);
}

function freezeRef(ref) {
  return Object.freeze({ id: ref.id, version: ref.version, hash: ref.hash });
}

function missingFailure(source, index, missing, reason) {
  return {
    ok: false,
    code: 'MAPPING_MISSING_FIELDS',
    message: `产品数据映射失败关闭(来源:${source}):${reason};缺失/非法字段:[${missing.join(', ')}]` +
      (index >= 0 ? `(第 ${index} 项)` : '') +
      '。不猜测默认值、不用空串补齐;fixtureId 单独存在不构成完整证据引用(须 evidenceId+version+sha256)。',
    details: { index, missing: [...missing], source },
  };
}

/**
 * 产品证据记录数组 → 协议 evidenceRefs([{id,version,hash}],version 转为非空字符串)。
 *
 * 映射(产品字段 → 协议字段):
 *   evidenceId → id        (remote-types.ts:62;每条证据唯一,创建于 remote-service.ts:332)
 *   version    → version   (remote-types.ts:74;number,String() 转换以过协议非空字符串要求)
 *   sha256     → hash      (remote-types.ts:73;服务端实际返回原件字节的 SHA256,remote-service.ts:329-343)
 *
 * 失败关闭(返回第一个不合格项,不输出部分成功):
 *   - 任一证据缺 evidenceId / version / sha256(或空串、类型非法)→ ok:false;
 *   - version 缺失、非有限数或负数 → ok:false(产品创建恒为 1,原件不可变);
 *   - 仅 fixtureId(或含 fixtureId 但缺 version/sha256)→ 不构成完整引用,ok:false;
 *     fixtureId 是合成图形"种类"标识,同一 fixtureId 可对应多条证据(remote-service.ts:328,336),
 *     绝不当作 id 使用。
 * supersededBy 非空(已被取代的过期证据)不在此过滤——映射层保持纯映射,
 * 过期证据应由调用方在组装清单时排除(见 FIELD_MAPPING.md 缺口清单)。
 *
 * @param products {Array<object>} 产品 EvidenceRecord 数组(允许空数组 → 空引用清单)
 * @param options {{ source?: string }} 来源标注(仅进 message/details,便于定位)
 */
export function evidenceToRefs(productEvidence, { source = 'unknown' } = {}) {
  if (!Array.isArray(productEvidence)) {
    return missingFailure(source, -1, ['evidence'], '产品证据必须是数组(允许空数组)');
  }
  for (let i = 0; i < productEvidence.length; i += 1) {
    const item = productEvidence[i];
    if (!isPlainObject(item)) {
      return missingFailure(source, i, ['id(evidenceId)', 'version', 'hash(sha256)'], `第 ${i} 项不是对象`);
    }
    const missing = [];
    if (!isNonEmptyString(item.evidenceId)) missing.push('id(evidenceId)');
    if (typeof item.version !== 'number' || !Number.isFinite(item.version) || item.version < 0) missing.push('version');
    if (!isNonEmptyString(item.sha256)) missing.push('hash(sha256)');
    if (missing.length > 0) {
      const hint = isNonEmptyString(item.fixtureId) && missing.length > 0
        ? `;该记录仅有 fixtureId="${item.fixtureId}",不构成完整引用`
        : '';
      const failure = missingFailure(source, i, missing, `证据记录缺少完整引用三元组${hint}`);
      return failure;
    }
  }
  const evidenceRefs = Object.freeze(productEvidence.map((item) => freezeRef({
    id: item.evidenceId,
    version: String(item.version),
    hash: item.sha256,
  })));
  return { ok: true, evidenceRefs };
}

/**
 * 产品远程会话记录 → 协议会话快照 { generation, contextVersion, paused }。
 *
 * 映射(产品字段 → 协议字段):
 *   generation     → snapshot.generation  (remote-types.ts:49-50;store 校验 remote-store.ts:132-137)
 *   (无产品字段)   → snapshot.contextVersion:产品会话记录没有 contextVersion 字段。
 *                    产品侧唯一语义对应的值是 RemoteStoreState.version(每次成功写入 +1,
 *                    API 响应字段名 remoteVersion)。因此必须由调用方供给:
 *                    优先 options.contextVersion,兼容产品词汇别名 options.remoteVersion,
 *                    再前向兼容 remoteSession.contextVersion(产品将来若加字段)。
 *   status==='paused' → snapshot.paused     (remote-types.ts:48;产品暂停执行门 remote-service.ts:162-167)
 *
 * 失败关闭:
 *   - 缺 generation / generation 非正整数(含产品初始 0、legacy 读取补的 0)→ ok:false。
 *     理由:协议要求正整数(src/validate-request.mjs:49-51),产品初始代次为 0
 *     (remote-service.ts:187)、legacy 记录缺 generation 由 store 读侧补 0(remote-store.ts:289-294)
 *     ——这正是 Codex 点名的"旧会话缺 generation"问题;映射层不猜默认值、不擅自 +1 偏移,
 *     偏移或放宽协议由主任务显式决定后在其接入层执行(见 FIELD_MAPPING.md 缺口清单)。
 *   - 无法取得 contextVersion → ok:false(空快照会让"上下文变化 → stale"检测整体失效,没有安全缺省)。
 *   - status 存在但不是产品会话状态枚举值 → ok:false(不能从非法值可靠推导 paused)。
 *
 * 安全缺省(唯一):status 字段缺失 → paused:false。
 * 理由:(1) 声称"暂停"会无依据地虚构状态并阻断业务,"未暂停"是不虚构的方向;
 * (2) 产品的暂停是服务端强制执行门(requireNotPaused,remote-service.ts:162-167;异步路径再判定
 * remote-service.ts:849-857),不依赖映射层兜底;(3) 经产品 store 读出的记录必带 status
 * (remote-store.ts:131 reqEnum 强制),缺省路径仅覆盖异常/前向兼容输入。
 *
 * @param remoteSession {object} 产品 RemoteSessionRecord
 * @param options {{ source?: string, contextVersion?: string|number, remoteVersion?: string|number }}
 */
export function sessionToSnapshot(remoteSession, { source = 'unknown', contextVersion, remoteVersion } = {}) {
  if (!isPlainObject(remoteSession)) {
    return {
      ok: false,
      code: 'MAPPING_MISSING_FIELDS',
      message: `产品数据映射失败关闭(来源:${source}):远程会话必须是对象;缺失/非法字段:[session]`,
      details: { missing: ['session'], source },
    };
  }
  const missing = [];
  if (!Number.isInteger(remoteSession.generation) || remoteSession.generation <= 0) {
    missing.push('generation');
  }
  if (remoteSession.status !== undefined && !PRODUCT_SESSION_STATUSES.includes(remoteSession.status)) {
    missing.push('status');
  }
  // contextVersion 解析顺序:调用方显式供给(协议词汇)→ 产品词汇别名 → 记录上前向兼容字段。
  const resolvedContextVersion = isValidContextVersion(contextVersion)
    ? contextVersion
    : isValidContextVersion(remoteVersion)
      ? remoteVersion
      : isValidContextVersion(remoteSession.contextVersion)
        ? remoteSession.contextVersion
        : undefined;
  if (resolvedContextVersion === undefined) {
    missing.push('contextVersion');
  }
  if (missing.length > 0) {
    const genNote = missing.includes('generation')
      ? '产品会话 generation 为正整数才可映射(产品初始为 0、legacy 记录缺 generation 补 0:均失败关闭;' +
        '偏移或放宽协议须由主任务显式决定)。'
      : '';
    const cvNote = missing.includes('contextVersion')
      ? '产品会话记录无 contextVersion 字段:须由调用方传入 options.contextVersion(或 options.remoteVersion),' +
        '取值为 RemoteStoreState.version(API 响应中的 remoteVersion)。'
      : '';
    return {
      ok: false,
      code: 'MAPPING_MISSING_FIELDS',
      message: `产品数据映射失败关闭(来源:${source}):缺失/非法字段:[${missing.join(', ')}]。${genNote}${cvNote}`,
      details: { missing: [...missing], source },
    };
  }
  const snapshot = Object.freeze({
    generation: remoteSession.generation,
    contextVersion: resolvedContextVersion,
    paused: remoteSession.status === 'paused',
  });
  return { ok: true, snapshot };
}

/**
 * 七状态 → 产品 UI 动作建议(状态语义与 R1 契约 ADAPTER_CONTRACT.md §3 一致)。
 * allowRetry = 允许业务层在人工确认后以同一 requestId 重新发起完整调用
 * (适配器对 failed/stale/unknown 不缓存,重试即新调用;自动重试任何状态下都是 0)。
 * unknown 的"仅人工核实后重试"编码为 allowRetry:false + mustHumanVerify:true(理由:布尔无法表达
 * 条件重试,禁止自动重试 + 强制人工核实 + zh 说明,是对"核实后方可重试"的忠实且保守的编码)。
 * 未知状态抛 TypeError(协议七状态之外不存在合法输入)。
 */
const STATUS_ACTIONS = Object.freeze({
  not_configured: Object.freeze({
    uiAction: 'configure_provider',
    zh: '模型服务未配置：本次未发起任何外部调用、无费用；请先完成 provider 配置后再使用分析功能。',
    allowRetry: false,
    mustHumanVerify: false,
  }),
  simulated: Object.freeze({
    uiAction: 'show_simulated_banner',
    zh: '结果来自受控模拟通道：界面必须显著标注“模拟”，输出仅供参考，不得当作真实尽调结论或成功结果。',
    allowRetry: false,
    mustHumanVerify: true,
  }),
  succeeded: Object.freeze({
    uiAction: 'show_result_pending_review',
    zh: '分析完成：模型输出无审批效力（authority=none），须经人工复核确认后方可采信。',
    allowRetry: false,
    mustHumanVerify: true,
  }),
  failed: Object.freeze({
    uiAction: 'show_failed_reason',
    zh: '分析失败：请向人工展示失败原因；修复请求或配置后可由人工决定重试（重试为新的一次完整调用）。',
    allowRetry: true,
    mustHumanVerify: false,
  }),
  unknown: Object.freeze({
    uiAction: 'human_verify_before_retry',
    zh: '结果不可知：请求可能已送达外部，禁止自动重试；须先人工核实外部是否实际发生，核实后方可决定是否重试。',
    allowRetry: false,
    mustHumanVerify: true,
  }),
  stale: Object.freeze({
    uiAction: 'show_stale_for_review',
    zh: '结果已过期：返回时会话代次/上下文版本或暂停态已变化，仅供人工核对、不得当作现行结果；人工确认后可重新发起。',
    allowRetry: true,
    mustHumanVerify: true,
  }),
  cancelled: Object.freeze({
    uiAction: 'show_cancelled',
    zh: '已取消：请求确定未送达外部，无外部调用与费用；可重新发起。',
    allowRetry: true,
    mustHumanVerify: false,
  }),
});

/**
 * @param status {string} 协议七状态之一(not_configured/simulated/succeeded/failed/unknown/stale/cancelled)
 * @returns {{ uiAction: string, zh: string, allowRetry: boolean, mustHumanVerify: boolean }}
 * @throws {TypeError} 状态不是七状态之一
 */
export function statusToProductAction(status) {
  const action = typeof status === 'string' ? STATUS_ACTIONS[status] : undefined;
  if (action === undefined) {
    throw new TypeError(`statusToProductAction:未知状态 ${String(status)};必须是七状态之一(not_configured/simulated/succeeded/failed/unknown/stale/cancelled)`);
  }
  return action;
}

/**
 * 确定性 requestId 建议:`r<sessionId>-g<generation>-<op>-<seq>`。
 * 同一(会话,代次,操作,序号)永远得到同一 requestId,供幂等/去重使用。
 * 产品 generation 域为非负整数但协议请求要求正整数,故此处同样要求正整数(与 sessionToSnapshot 一致)。
 * 参数非法抛 TypeError。
 *
 * @param params {{ sessionId: string, generation: number, op: string, seq: number }}
 * @returns {string}
 * @throws {TypeError}
 */
export function canonicalRequestId({ sessionId, generation, op, seq } = {}) {
  const invalid = [];
  if (!isNonEmptyString(sessionId)) invalid.push('sessionId(非空字符串)');
  if (!Number.isInteger(generation) || generation <= 0) invalid.push('generation(正整数)');
  if (!isNonEmptyString(op)) invalid.push('op(非空字符串)');
  if (!Number.isInteger(seq) || seq < 0) invalid.push('seq(非负整数)');
  if (invalid.length > 0) {
    throw new TypeError(`canonicalRequestId:参数非法——${invalid.join('、')}`);
  }
  return `r${sessionId}-g${generation}-${op}-${seq}`;
}
