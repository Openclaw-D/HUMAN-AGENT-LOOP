// 客户目录·最近访问本地记录（任务01 修复面）：按登录身份分区（key 含 principalId），
// 退出登录清理当前身份桶。最近访问只是"本会话打开过哪些客户"的本地便利，不是授权：
// 从最近访问打开仍走 openCustomer 服务端裁决（404=无权或不存在），不因曾访问过而绕过授权。
const KEY_PREFIX = 'jw-wb-recent:';
const MAX_RECENT = 8;

export function recentKey(principalId: string): string {
  return `${KEY_PREFIX}${principalId}`;
}

export function loadRecent(principalId: string): string[] {
  if (!principalId) return [];
  try {
    const raw = sessionStorage.getItem(recentKey(principalId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberCustomer(principalId: string, customerId: string): void {
  if (!principalId || !customerId) return;
  const list = loadRecent(principalId).filter((x) => x !== customerId);
  list.unshift(customerId);
  try { sessionStorage.setItem(recentKey(principalId), JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* 隐私模式忽略 */ }
}

/** 退出登录清理：当前身份的最近访问桶整桶删除（换身份本就看不到别的桶，删除防本机残留）。 */
export function clearRecent(principalId: string): void {
  if (!principalId) return;
  try { sessionStorage.removeItem(recentKey(principalId)); } catch { /* 忽略 */ }
}
