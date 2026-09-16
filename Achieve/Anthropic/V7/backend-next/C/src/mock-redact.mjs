// V7 backend-next Lane C · mock 服务凭据脱敏工具。
// 纪律：任何日志/回显/错误信息不得包含完整 API key；只允许掩码形式。
// 服务不读取环境变量密钥；key 只能经启动参数注入（内存中保存）。

/** 掩码一个密钥：保留前 4 后 4（长度>12 时），其余以 *** 代替；短 key 全掩码。 */
export function maskSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return '<none>';
  if (secret.length <= 12) return '***';
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

/** 从 Authorization 头提取 Bearer key（无则 null）。 */
export function bearerKey(authHeader) {
  if (typeof authHeader !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

/**
 * 将文本中出现的完整密钥替换为掩码（供日志/回显脱敏）。
 * keys: 需要脱敏的字符串数组（去空）。
 */
export function redactSecrets(text, keys) {
  let out = String(text ?? '');
  for (const k of keys) {
    if (typeof k === 'string' && k.length >= 4 && out.includes(k)) {
      out = out.split(k).join(maskSecret(k));
    }
  }
  return out;
}

/** 请求日志用的 auth 摘要：只含 scheme 与掩码 key。 */
export function describeAuth(authHeader) {
  const key = bearerKey(authHeader);
  if (key === null) return authHeader ? `non-bearer(${String(authHeader).length}b)` : '<absent>';
  return `Bearer ${maskSecret(key)}`;
}
