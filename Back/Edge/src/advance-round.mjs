// Exact same-origin routes. Session credentials/CSRF remain owned by existing Edge proxies.
// GET browsing never starts a business action, including an as-yet unexecuted domain.
export const ADVANCE_WRITE_ROUTES = [{
  method: 'POST', pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/advance-rounds\/([^/]+)\/decision$/,
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/advance-rounds/${encodeURIComponent(m[2])}/decision`,
}, {
  method: 'POST',
  pattern: /^\/api\/jw\/v2\/actions\/customers\/([^/]+)\/advance-rounds$/,
  upstream: m => `/api/v2/customers/${encodeURIComponent(m[1])}/advance-rounds`,
}];
export const ADVANCE_READ_ROUTES = [{
  pattern: /^\/api\/jw\/v2\/arrow-cases$/, action: 'workspace:read', upstream: () => '/api/v2/arrow-cases',
}, {
  pattern: /^\/api\/jw\/v2\/customers\/([^/]+)\/(advance-plan|advance-rounds(?:\/active|\/by-request\/[^/]+|\/[^/]+)?)$/,
  action: 'workspace:read',
  upstream: (m, search) => `/api/v2/customers/${encodeURIComponent(m[1])}/${m[2]}${search || ''}`,
}];
