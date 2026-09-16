// 静态资源服务（任务04 S3 browser-harness E0）：只服务白名单目录，路径穿越防护，
// no-store + 基础 CSP；无视觉装饰——harness 只验证真实操作，不做全站前端。
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function createStaticHandler({ rootDir, urlPrefix = '/harness' }) {
  return {
    handle({ res, urlObj }) {
      const rel = urlObj.pathname === urlPrefix || urlObj.pathname === `${urlPrefix}/`
        ? 'index.html'
        : urlObj.pathname.slice(urlPrefix.length + 1);
      const abs = path.normalize(path.join(rootDir, rel));
      if (!abs.startsWith(path.normalize(rootDir) + path.sep) && abs !== path.normalize(rootDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'FORBIDDEN' }));
        return;
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        // harness 页只连本源 API；不加载任何外部资源。
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
      });
      createReadStream(abs).pipe(res);
    },
  };
}
