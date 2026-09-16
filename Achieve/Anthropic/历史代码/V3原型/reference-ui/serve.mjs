import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createDemoProjection } from './demo-state.mjs';

const root = process.cwd();
const port = Number(process.env.PORT || 4178);
const demoEnabled = process.env.P1_FRONTEND_MODE === 'demo';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const sendJson = (response, value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/v2/frontend-config') return sendJson(response, { mode: demoEnabled ? 'demo' : 'product' });
  if (url.pathname === '/api/v2/projection') {
    if (!demoEnabled) return sendJson(response, { error: { code: 'PROJECTION_UNAVAILABLE', message: '产品模式未连接到兼容的状态投影。' } }, 503);
    return sendJson(response, createDemoProjection());
  }
  const raw = decodeURIComponent(url.pathname); const clean = normalize(raw === '/' ? '/index.html' : raw).replace(/^([/\\])+/, ''); const file = join(root, clean);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end('未找到页面'); return; }
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`前端服务已启动：http://127.0.0.1:${port}；模式：${demoEnabled ? '演示' : '产品'}`));
