// V7 backend-next B 凭据卫生(redaction)。本轮硬要求:
//   凭据不得进入 checkpoint/日志/错误返回(包括 verifier 和 authorizer 抛异常时的异常文本)。
// 教训来源 V7 旧轮 D-10:verifier 异常文本内嵌凭据 → 原样进调用方错误。本轮修复:
//   所有异常文本过 redactText() 再入任何持久面;凭据形状字段在结构化脱敏中整值抹除。
// 原则:宁可过度脱敏(误伤普通文本的可读性),不可漏脱敏(凭据外泄)。
// 本模块为纯函数,无 IO,可独立单测。

/** 值级敏感字段名(结构化对象递归脱敏时,键名命中即整值替换,不看值内容)。 */
const SENSITIVE_KEYS = new Set([
  'apikey', 'api_key', 'key', 'secret', 'token', 'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token', 'password', 'passwd', 'authorization',
  'principalcredential', 'principal_credential', 'credential', 'credentials',
  'cookie', 'setcookie', 'sessionid', 'session_id', 'privatekey', 'private_key',
]);

/** 形状级模式:即使键名不敏感,值本身长得像凭据也抹除(异常文本行内替换)。 */
const SHAPE_PATTERNS = [
  // Bearer / Basic 认证头
  { re: /(bearer|basic)\s+[\w.\-+/=_]{8,}/gi, tag: '$1 <redacted>' },
  // URL/DSN 内嵌凭据 scheme://user:password@host → 抹密码段
  { re: /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)([^@/\s]+)@/gi, tag: '$1<redacted>@' },
  // key=value / key: value 形式(key 名含敏感词)
  { re: /((?:api[_-]?key|secret|token|password|credential|authorization)[\s"':=]{1,4})([\w.\-+/=]{6,})/gi, tag: '$1<redacted>' },
  // sk- 前缀密钥(OpenAI 风格;GLM 网关普遍沿用)
  { re: /sk-[\w.\-+/=]{8,}/g, tag: '<redacted-sk>' },
  // 高熵十六进制串(≥32 位):密钥/摘要常见形状(避免误伤短 hash 引用,阈值放宽为 32)
  { re: /\b[0-9a-f]{32,}\b/gi, tag: '<redacted-hex>' },
  // JWT 三段式
  { re: /\bey[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, tag: '<redacted-jwt>' },
];

/**
 * 文本脱敏:按形状模式逐个替换。幂等(已脱敏文本再过一遍不变)。
 */
export function redactText(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { re, tag } of SHAPE_PATTERNS) out = out.replace(re, tag);
  return out;
}

/**
 * 结构化对象脱敏:递归遍历,敏感键整值替换;字符串值再过形状脱敏。
 * 返回新对象,不改输入。处理循环引用(Seen 集合)与特殊类型(Error→message+code)。
 */
export function redactValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? redactText(value) : value;
  }
  if (value instanceof Error) {
    return { name: value.name, code: value.code, message: redactText(value.message) };
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase().replace(/[\s-]/g, ''))) {
      out[k] = typeof v === 'string' && v.length > 0 ? '<redacted>' : (v === null || v === undefined ? v : '<redacted>');
    } else {
      out[k] = redactValue(v, seen);
    }
  }
  return out;
}

/**
 * 异常 → 可安全外传/落盘的错误对象:{code, message(已脱敏), details(已脱敏|undefined)}。
 * 保留原 code(错误码为协议标识,非敏感);message 必脱敏;details 若存在必脱敏。
 * 用途:verifier/authorizer 异常、transport 异常、A 客户端异常的统一出口。
 */
export function safeError(e, fallbackCode = 'INTERNAL_ERROR') {
  if (e === null || e === undefined) return { code: fallbackCode, message: '未知错误' };
  if (e instanceof Error) {
    return { code: e.code ?? fallbackCode, message: redactText(e.message) };
  }
  if (typeof e === 'object') {
    const v = redactValue(e);
    return { code: v.code ?? fallbackCode, message: v.message ?? JSON.stringify(v).slice(0, 500) };
  }
  return { code: fallbackCode, message: redactText(String(e)) };
}

/**
 * 脱敏日志包装:logger(text|obj) 输出前统一过脱敏。
 * B 全部模块经 createSafeLogger 落日志,不得直接 console.log 原始错误对象。
 */
export function createSafeLogger(write = (line) => console.log(line)) {
  return (entry) => {
    const line = typeof entry === 'string' ? redactText(entry) : JSON.stringify(redactValue(entry));
    write(`[${new Date().toISOString()}] ${line}`);
  };
}

/**
 * checkpoint 写入前的最后防线:状态对象过 redactValue。
 * (凭据按构造本就不进图状态;此函数是纵深防御,防未来改动破坏构造纪律。)
 */
export function sanitizeForCheckpoint(state) {
  return redactValue(state);
}
