// 独立HTTP客户端：真实socket请求，带超时。零依赖（Node22 内建fetch）。
export function makeHttp(baseUrl, { defaultTimeoutMs = 15000, headers = {} } = {}) {
  const base = baseUrl.replace(/\/$/, '');
  return async function req(method, path, { json, body, headers: h2 = {}, timeoutMs } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || defaultTimeoutMs);
    const started = Date.now();
    try {
      const init = { method, signal: ctl.signal, headers: { ...headers, ...h2 } };
      if (json !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(json); }
      else if (body !== undefined) { init.body = body; }
      const res = await fetch(base + path, init);
      const text = await res.text();
      let parsed = null, parseErr = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (e) { parseErr = String(e.message || e); }
      return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), text, json: parsed, parseErr, ms: Date.now() - started };
    } catch (e) {
      return { status: 0, ok: false, error: String(e.message || e), name: e.name, ms: Date.now() - started, text: '', json: null, headers: {} };
    } finally { clearTimeout(t); }
  };
}
export const http = makeHttp;
// 便捷动词
export function verbs(req) {
  return {
    get: (p, o) => req('GET', p, o),
    post: (p, json, o) => req('POST', p, { json, ...o }),
    put: (p, json, o) => req('PUT', p, { json, ...o }),
    patch: (p, json, o) => req('PATCH', p, { json, ...o }),
    del: (p, o) => req('DELETE', p, o),
  };
}
