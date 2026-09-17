// 静态资源服务（任务04 S3 browser-harness E0；goal-03 泛化支持同源前端托管）：
// 只服务白名单目录，路径穿越防护，no-store + 基础 CSP；无视觉装饰。
// urlPrefix='/harness'（默认，行为不变）；urlPrefix='' 时托管站点根（'/' 与未知非资源路径 →
// index.html 的 SPA 回退），供 `--serve-front <dir>` 把 Front/dist 作为受控同源入口
//（页面与 API 同源，无 CORS 依赖；CSP connect-src 'self' 不放宽）。
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'";

export function createStaticHandler({ rootDir, urlPrefix = '/harness' }) {
  const normalizedRoot = path.normalize(rootDir);
  const relOf = (pathname) => {
    if (urlPrefix === '') {
      return pathname === '/' || pathname === '' ? 'index.html' : pathname.slice(1);
    }
    return pathname === urlPrefix || pathname === `${urlPrefix}/`
      ? 'index.html'
      : pathname.slice(urlPrefix.length + 1);
  };
  const send = (res, abs, status = 200) => {
    res.writeHead(status, {
      'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // 只连本源 API；不加载任何外部资源。
      'Content-Security-Policy': CSP,
    });
    createReadStream(abs).pipe(res);
  };
  return {
    handle({ res, urlObj }) {
      const rel = relOf(urlObj.pathname);
      const abs = path.normalize(path.join(rootDir, rel));
      if (!abs.startsWith(normalizedRoot + path.sep) && abs !== normalizedRoot) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'FORBIDDEN' }));
        return;
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        // 根挂载形态：未知非资源路径回退 index.html（SPA 无服务端路由）；其余 404。
        const fallback = urlPrefix === '' ? path.join(normalizedRoot, 'index.html') : null;
        if (!fallback || !existsSync(fallback)) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
          return;
        }
        send(res, fallback);
        return;
      }
      send(res, abs);
    },
  };
}
