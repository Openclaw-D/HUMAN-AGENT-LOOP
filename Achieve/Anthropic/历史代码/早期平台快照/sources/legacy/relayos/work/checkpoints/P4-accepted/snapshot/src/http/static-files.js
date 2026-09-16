import { createReadStream, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import { AppError } from '../domain/errors.js';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

function resolveStaticPath(publicDirectory, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new AppError('STATIC_PATH_INVALID', '静态资源路径编码无效。', 400); }
  if (decoded.includes('\0') || decoded.includes('\\')) throw new AppError('STATIC_PATH_INVALID', '静态资源路径无效。', 400);
  const root = resolve(publicDirectory);
  const requestPath = decoded === '/' ? '/index.html' : decoded;
  const target = resolve(root, `.${requestPath}`);
  const offset = relative(root, target);
  if (offset.startsWith('..') || isAbsolute(offset)) throw new AppError('STATIC_PATH_DENIED', '静态资源路径越界。', 403);
  return target;
}

export function serveStaticFile(request, response, { publicDirectory, headers = {} }) {
  if (!publicDirectory || !['GET', 'HEAD'].includes(request.method)) return false;
  const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health/')) return false;
  const target = resolveStaticPath(publicDirectory, url.pathname);
  let stat;
  try { stat = statSync(target); } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile()) return false;
  response.writeHead(200, {
    'content-type': CONTENT_TYPES.get(extname(target).toLowerCase()) ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(target).pipe(response);
  return true;
}
