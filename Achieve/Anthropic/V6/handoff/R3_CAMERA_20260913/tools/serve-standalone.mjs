// 本地静态样例服务：仅127.0.0.1、动态端口（或显式指定）、只读本目录文件。
// 用法：node tools/serve-standalone.mjs [端口]；Ctrl+C 停止。
// 不属于产品代码；不写任何文件，不做任何上传或转发。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const port = Number(process.argv[2] || 0);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    // 根路径重定向而非内联替换：保证页面以真实路径解析相对module导入；查询串透传。
    if (pathname === '/') {
      res.writeHead(302, { location: '/src/standalone/index.html' + url.search, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    // R3：headless矩阵的收据/测量回收端点。仅127.0.0.1本服务进程内、只写本批evidence/collected/，
    // name白名单防穿越；POST体=壳导出的{receipt,measure}JSON。
    if (req.method === 'POST' && pathname === '/__collect') {
      const name = (url.searchParams.get('name') || '').toLowerCase();
      if (!/^[a-z0-9._-]{1,80}$/.test(name)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('bad name');
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const outDir = join(root, 'evidence', 'collected');
      mkdirSync(outDir, { recursive: true });
      JSON.parse(body); // 校验为合法JSON
      writeFileSync(join(outDir, `${name}.json`), body);
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    const filePath = normalize(join(root, pathname));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': mime[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  const addr = server.address();
  console.log(`[R2_CAMERA] root=${root}`);
  console.log(`[R2_CAMERA] http://127.0.0.1:${addr.port}/  (Ctrl+C 停止)`);
});
