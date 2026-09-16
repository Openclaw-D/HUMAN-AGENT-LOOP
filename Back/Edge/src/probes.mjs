// readiness 探针工厂（任务04 S1）：每个依赖独立结果，绝不汇总成单一 all_ok。
// 注意：A 内核 /healthz 在 db down 时也返回 ok:true（liveness/readiness 混淆的历史行为），
// 业务 readiness 探针必须显式检查 db==='up'，不能透传 ok 字段。
import net from 'node:net';

// TCP 连通探针：PG 等纯 TCP 依赖的最小检查（不代表认证/库存在，如实标注 detail）。
export function tcpProbe({ name, host = '127.0.0.1', port, timeoutMs = 2000 }) {
  return async () => {
    const started = Date.now();
    return await new Promise((resolve) => {
      let settled = false;
      const s = net.connect({ host, port });
      const done = (ok, detail) => {
        if (settled) return;
        settled = true;
        try { s.destroy(); } catch { }
        resolve({ name, ok, detail, latencyMs: Date.now() - started });
      };
      s.setTimeout(timeoutMs, () => done(false, `timeout ${timeoutMs}ms`));
      s.once('connect', () => done(true, 'tcp connect ok'));
      s.once('error', (e) => done(false, String(e.code || e.message)));
    });
  };
}

// HTTP JSON 探针：pass(body, status) 决定 ok；默认 status===200 且 body.ok===true。
// body 只保留白名单小字段进 detail，避免把上游响应整包回显。
export function httpProbe({ name, url, timeoutMs = 3000, headers = {}, pass, detailFields = ['ok', 'db', 'model'] }) {
  return async () => {
    const started = Date.now();
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      let body = null;
      try { body = await res.json(); } catch { /* 非 JSON 响应按 null 处理 */ }
      const verdict = pass ? pass(body, res.status) : res.status === 200 && body && body.ok === true;
      const detail = {};
      if (body && typeof body === 'object') {
        for (const k of detailFields) if (k in body) detail[k] = body[k];
      }
      return { name, ok: verdict === true, detail: { status: res.status, ...detail }, latencyMs: Date.now() - started };
    } catch (e) {
      const reason = e.name === 'TimeoutError' ? `timeout ${timeoutMs}ms` : String(e.cause?.code || e.message);
      return { name, ok: false, detail: { error: reason }, latencyMs: Date.now() - started };
    }
  };
}

// A 内核业务就绪判据：/healthz 200 且 ok===true 且 db==='up'。db down 不能包装为业务就绪。
export const aKernelReadyPass = (body, status) => status === 200 && !!body && body.ok === true && body.db === 'up';
