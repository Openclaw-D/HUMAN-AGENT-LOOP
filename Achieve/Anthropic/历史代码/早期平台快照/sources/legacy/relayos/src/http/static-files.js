import { createReadStream, realpathSync, statSync } from 'node:fs';
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
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new AppError('STATIC_PATH_DENIED', '静态资源路径越界。', 403);
  const root = resolve(publicDirectory);
  const requestPath = decoded === '/' ? '/index.html' : decoded;
  const target = resolve(root, `.${requestPath}`);
  const offset = relative(root, target);
  if (offset.startsWith('..') || isAbsolute(offset)) throw new AppError('STATIC_PATH_DENIED', '静态资源路径越界。', 403);
  return target;
}

export function serveStaticFile(request, response, { publicDirectory, headers = {} }) {
  if (!publicDirectory || !['GET', 'HEAD'].includes(request.method)) return false;
  const rawPath = (request.url ?? '/').split('?')[0];
  if (rawPath.startsWith('/api/') || rawPath.startsWith('/health/')) return false;
  const target = resolveStaticPath(publicDirectory, rawPath);
  let stat;
  try { stat = statSync(target); } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile()) return false;
  const root = realpathSync(resolve(publicDirectory));
  const realTarget = realpathSync(target);
  const offset = relative(root, realTarget);
  if (offset.startsWith('..') || isAbsolute(offset)) throw new AppError('STATIC_PATH_DENIED', '静态资源实际路径越界。', 403);
  const contentType = CONTENT_TYPES.get(extname(realTarget).toLowerCase());
  if (!contentType) return false;
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': stat.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  if (request.method === 'HEAD') response.end();
  else {
    const stream = createReadStream(realTarget);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
  return true;
}
