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
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/src/standalone/index.html';
    const filePath = normalize(join(root, pathname));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  const addr = server.address();
  console.log(`[PARALLEL_CAMERA] root=${root}`);
  console.log(`[PARALLEL_CAMERA] http://127.0.0.1:${addr.port}/  (Ctrl+C 停止)`);
});
