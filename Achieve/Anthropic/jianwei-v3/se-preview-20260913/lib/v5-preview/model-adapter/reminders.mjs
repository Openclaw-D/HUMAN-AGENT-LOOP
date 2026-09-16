// 点名/主动提醒候选协议(R2 工作包5)。纯函数、零依赖、不发网络。
// 定位:候选协议层(candidate-protocol-v0),不接产品事件流,最终以人控为准。
// 本层唯一动作是 notify_human,不存在 approve/decision/retry 等自动动作;
// 白名单外的 kind 一律降级为普通事件——事件源(含模型)不能借未知事件类型自升重要度。
// 协议标识英文,面向人的错误消息一律中文。规则表见 PROTOCOL_NOTES.md。

export const GENERATED_BY = 'candidate-protocol-v0';

/** 计划级标记:每条计划都必须经人工确认,协议层不代人确认、不产生正式批准。 */
export const REQUIRES_HUMAN_ACK = true;

/** 动作白名单:协议层不存在 approve/decision/retry 等自动动作。 */
export const ALLOWED_ACTIONS = Object.freeze(['notify_human']);
export const NOTIFY_HUMAN = 'notify_human';

/** 事件 kind 白名单;白名单外的 kind 一律视为普通事件(不进计划)。 */
export const REMINDER_EVENT_KINDS = Object.freeze([
  'evidence_version_changed',
  'session_paused',
  'result_unknown',
  'result_stale',
  'human_mention',
  'budget_warning',
]);

const IMPORTANCE_RANK = Object.freeze({ normal: 0, important: 1 });

function fail(message) {
  throw new TypeError(message);
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} 必须为非空字符串`);
}

function isValidAt(value) {
  return (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isFinite(value));
}

/** a 是否早于 b。假设同质(同为 ISO 字符串或同为毫秒数);混用时仅保证确定性,不保证时序语义。 */
function isEarlier(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  return String(a) < String(b);
}

function normalizeEvent(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`events[${index}] 必须为对象`);
  }
  requireNonEmptyString(raw.kind, `events[${index}].kind`);
  requireNonEmptyString(raw.key, `events[${index}].key`);
  if (raw.importance !== 'normal' && raw.importance !== 'important') {
    fail(`events[${index}].importance 必须为 'normal' 或 'important'(收到 ${JSON.stringify(raw.importance)})`);
  }
  if (!isValidAt(raw.at)) fail(`events[${index}].at 必须为非空字符串或有限数字`);
  return { kind: raw.kind, key: raw.key, importance: raw.importance, at: raw.at, index };
}

/**
 * 准入判定(每条一个可测规则,见 PROTOCOL_NOTES.md 规则表):
 * - human_mention(点名)无条件准入:点名是人的主动行为,即使 normal 也提醒;
 * - 白名单外的 kind 一律视为普通事件:即使声明 important 也不准入(不因模型输出自升权限);
 * - 白名单内其余 kind 须 importance='important' 才准入(普通事件不打断)。
 */
function isAdmitted(ev) {
  if (ev.kind === 'human_mention') return true;
  if (!REMINDER_EVENT_KINDS.includes(ev.kind)) return false;
  return ev.importance === 'important';
}

function emptyPlan() {
  return Object.freeze({
    generatedBy: GENERATED_BY,
    requiresHumanAck: REQUIRES_HUMAN_ACK,
    items: Object.freeze([]),
  });
}

function validatePreviousPlan(previousPlan) {
  if (previousPlan === null || previousPlan === undefined) return;
  if (typeof previousPlan !== 'object' || Array.isArray(previousPlan)) fail('previousPlan 必须为计划对象或 null');
  if (!Array.isArray(previousPlan.items)) fail('previousPlan.items 必须为数组');
  previousPlan.items.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) fail(`previousPlan.items[${i}] 必须为对象`);
    requireNonEmptyString(item.key, `previousPlan.items[${i}].key`);
    if (item.occurrences !== undefined
      && !(typeof item.occurrences === 'number' && Number.isInteger(item.occurrences) && item.occurrences >= 1)) {
      fail(`previousPlan.items[${i}].occurrences 必须为正整数`);
    }
    if (item.firstAt !== undefined && !isValidAt(item.firstAt)) {
      fail(`previousPlan.items[${i}].firstAt 必须为非空字符串或有限数字`);
    }
  });
}

/**
 * planReminders({ events, authorizedContext, previousPlan }) → plan
 *
 * plan 形如:
 * {
 *   generatedBy: 'candidate-protocol-v0',
 *   requiresHumanAck: true,
 *   items: [{ key, kind, importance, occurrences, firstAt, lastAt, action: 'notify_human' }]
 * }
 * items 按 key 字典序稳定排序;整个 plan 深冻结;不含任何时间戳/随机数(确定性)。
 *
 * - authorizedContext 必须显式声明:null/false = 未授权 → 空计划;
 *   undefined(缺省)或其它 falsy 值(''、0、NaN)= 非法输入 → TypeError(失败关闭,
 *   不允许"没说"被解释为"已授权"或"未授权")。
 * - 非法输入(结构校验)优先于授权短路:先 TypeError,后判授权。
 * - previousPlan 可选:同 key 且未处理(acknowledged !== true)→ 继承首次出现时间、
 *   累计 occurrences(跨批合并);本批未再现的旧条目不自动重发,再提醒策略由调用方决定。
 */
export function planReminders({ events, authorizedContext, previousPlan = null } = {}) {
  // 失败关闭:结构校验(TypeError)优先于授权短路。
  if (!Array.isArray(events)) fail('events 必须为数组');
  const normalized = events.map(normalizeEvent);
  validatePreviousPlan(previousPlan);

  // R1 仅授权上下文才提醒。
  if (authorizedContext === null || authorizedContext === false) return emptyPlan();
  if (authorizedContext === undefined || !authorizedContext) {
    fail("authorizedContext 必须显式传入:未授权请传 null 或 false,已授权请传 truthy 上下文(对象/非空字符串/true)");
  }

  // R2/R3/R4 准入过滤 + R5 同 key 合并(occurrences 计数,重要度取最高)。
  const mergedByKey = new Map();
  for (const ev of normalized) {
    if (!isAdmitted(ev)) continue;
    const cur = mergedByKey.get(ev.key);
    if (!cur) {
      mergedByKey.set(ev.key, {
        key: ev.key,
        kind: ev.kind, // 最高重要度者(同重要度取先出现者)
        importance: ev.importance,
        occurrences: 1,
        firstAt: ev.at,
        lastAt: ev.at,
      });
      continue;
    }
    cur.occurrences += 1;
    if (isEarlier(ev.at, cur.firstAt)) cur.firstAt = ev.at;
    if (isEarlier(cur.lastAt, ev.at)) cur.lastAt = ev.at;
    if (IMPORTANCE_RANK[ev.importance] > IMPORTANCE_RANK[cur.importance]) {
      cur.importance = ev.importance;
      cur.kind = ev.kind;
    }
  }

  // R6 跨批合并:同 key 且未处理 → 继承首次出现时间、累计 occurrences。
  if (previousPlan !== null) {
    for (const prev of previousPlan.items) {
      if (prev.acknowledged === true) continue; // 已人工确认:不再跨批累计
      const cur = mergedByKey.get(prev.key);
      if (!cur) continue; // 本批未再现的旧条目不自动重发
      const prevCount = typeof prev.occurrences === 'number'
        && Number.isInteger(prev.occurrences) && prev.occurrences >= 1 ? prev.occurrences : 1;
      cur.occurrences += prevCount;
      if (isValidAt(prev.firstAt) && isEarlier(prev.firstAt, cur.firstAt)) cur.firstAt = prev.firstAt;
    }
  }

  // R7 动作白名单 + R8 确定性:按 key 排序、深冻结、无时间戳。
  const items = [...mergedByKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((m) => Object.freeze({
      key: m.key,
      kind: m.kind,
      importance: m.importance,
      occurrences: m.occurrences,
      firstAt: m.firstAt,
      lastAt: m.lastAt,
      action: NOTIFY_HUMAN, // 协议层不存在 approve/decision/retry 自动动作
    }));

  return Object.freeze({
    generatedBy: GENERATED_BY,
    requiresHumanAck: REQUIRES_HUMAN_ACK,
    items: Object.freeze(items),
  });
}
