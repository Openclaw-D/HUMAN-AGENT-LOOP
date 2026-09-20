// 02路自验工具：同源托管 Front/dist 并把 API 透传到既有 Edge（默认 http://127.0.0.1:48210）。
// 背景：Edge 不返回 CORS 头，跨源页面无法读取响应；真实联调需同源（与 Edge --serve-front 同理）。
// 用法：node serve-dist-with-edge-proxy.mjs [port=3634] [distDir] [edge=48210]
// 仅本路自验用：不改 Front 代码、不改 Edge、不持久化任何数据；Origin/Referer 归一为目标 Edge
// 源（等价于同源托管形态），业务逻辑与页面代码零改动。
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const arg = (i, dft) => process.argv[i] ?? dft;
const PORT = Number(arg(2, 3634));
const DIST = arg(3, 'dist');
const EDGE_PORT = Number((String(arg(4, 48210)).match(/(\d+)\s*$/) ?? [])[1] ?? 48210);
const EDGE_ORIGIN = `http://127.0.0.1:${EDGE_PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const isApi = url.pathname.startsWith('/api/') || url.pathname === '/versionz' || url.pathname.startsWith('/healthz');
    if (isApi) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers };
      headers.host = `127.0.0.1:${EDGE_PORT}`;
      if (headers.origin) headers.origin = EDGE_ORIGIN;
      if (headers.referer) headers.referer = `${EDGE_ORIGIN}/`;
      const prox = httpRequest(`${EDGE_ORIGIN}${req.url}`, {
        method: req.method, headers,
        // SSE 需要流式；普通请求缓冲即可
      });
      if (body.length > 0) prox.write(body);
      prox.end();
      prox.on('response', (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      });
      prox.on('error', (e) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'PROXY_DOWN', note: `本路自验代理无法连接 Edge ${EDGE_ORIGIN}: ${String(e)}` }));
      });
      return;
    }
    // 静态：dist 内文件；未命中回退 index.html（单页应用）
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (p === '' || p === '.') p = 'index.html';
    let file = join(DIST, p);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      const data = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(data);
    }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'PROXY_ERROR', note: String(e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`02-route harness: http://127.0.0.1:${PORT}/ (dist=${DIST} -> edge=${EDGE_ORIGIN})`));
