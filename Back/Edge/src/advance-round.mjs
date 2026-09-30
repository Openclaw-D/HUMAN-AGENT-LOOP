// Exact same-origin routes. Session credentials/CSRF remain owned by existing Edge proxies.
// GET browsing never starts a business action, including an as-yet unexecuted domain.
// 02-execution 增量：语义辅助重跑（POST）与业务周期（开立/履约/外部回执/结清/关闭）读写面。
export const ADVANCE_WRITE_ROUTES = [{
  method: 'POST', pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/advance-rounds\/([^/]+)\/decision$/,
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/advance-rounds/${encodeURIComponent(m[2])}/decision`,
}, {
  method: 'POST',
  pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/advance-rounds$/,
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/advance-rounds`,
}, {
  method: 'POST', pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/advance-rounds\/([^/]+)\/semantic$/,
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/advance-rounds/${encodeURIComponent(m[2])}/semantic`,
}, {
  method: 'POST', pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/cycles$/,
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/cycles`,
}, {
  method: 'POST', pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/cycles\/([^/]+)\/(fulfill|external-receipt|settle|close)$/,
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/cycles/${encodeURIComponent(m[2])}/${m[3]}`,
}];
export const ADVANCE_READ_ROUTES = [{
  // A 权威案例目录（收尾02落地；DEF-03-01 关闭）。03 路旧 fallback404 双来源已退役（2026-09-30）。
  pattern: /^\/api\/jw\/v2\/arrow-cases$/, action: 'workspace:read', upstream: () => '/api/v2/arrow-cases',
}, {
  pattern: /^\/api\/jw\/v2\/arrow-cases\/([^/]+)$/, action: 'workspace:read', upstream: (m) => `/api/v2/arrow-cases/${encodeURIComponent(m[1])}`,
}, {
  pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/(advance-plan|advance-rounds(?:\/active|\/by-request\/[^/]+|\/[^/]+)?)$/,
  action: 'workspace:read',
  upstream: (m, search) => `/api/v2/customers/${encodeURIComponent(m[1])}/${m[2]}${search || ''}`,
}, {
  pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/cycles$/, action: 'workspace:read',
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/cycles`,
}];
