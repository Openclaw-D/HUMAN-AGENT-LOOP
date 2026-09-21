// soak-v04-system 外发替身 sink：模拟真实外发通道（可注入延迟/错误），每笔出站逐条落盘日志，
// 供"服务回执 vs 实际出站"逐条对账。只新增记录，不模仿重复发送——重复发送若发生必来自被测服务。
// 端口由系统分配（listen 0），仅绑定 127.0.0.1。
import http from 'node:http';
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function startSink({ journalFile, chaos = { latencyMaxMs: 0, errorRate: 0 } }) {
  const counts = new Map(); // requestId -> 出站次数（内存实时视图；权威为 journal 文件）
  let seq = 0;
  const state = { latencyMaxMs: chaos.latencyMaxMs ?? 0, errorRate: chaos.errorRate ?? 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/send') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let msg;
        try { msg = JSON.parse(body); } catch { res.writeHead(400).end('{"ok":false}'); return; }
        const n = (counts.get(msg.requestId) ?? 0) + 1;
        counts.set(msg.requestId, n);
        seq += 1;
        const record = {
          seq,
          requestId: String(msg.requestId),
          customerId: String(msg.customerId),
          audience: String(msg.audience),
          textLen: String(msg.text ?? '').length,
          messageId: `sink-${seq}`,
          state: 'sent_local_sink',
          at: new Date().toISOString(),
        };
        try { appendFileSync(journalFile, JSON.stringify(record) + '\n'); } catch (e) { /* 对账时以文件为准 */ }
        const finish = () => {
          if (state.errorRate > 0 && Math.random() < state.errorRate) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'SINK_INJECTED_500', note: '替身注入错误：出站已计数，结果由被测方裁决' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, messageId: record.messageId, state: record.state }));
        };
        if (state.latencyMaxMs > 0) setTimeout(finish, Math.floor(Math.random() * state.latencyMaxMs));
        else finish();
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__ctl/sink') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const cfg = JSON.parse(b || '{}');
        if (typeof cfg.latencyMaxMs === 'number') state.latencyMaxMs = cfg.latencyMaxMs;
        if (typeof cfg.errorRate === 'number') state.errorRate = cfg.errorRate;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, state: { ...state } }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__ctl/count') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, total: seq, byRequest: Object.fromEntries(counts) }));
      return;
    }
    res.writeHead(404).end('{"ok":false}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
        journalSnapshot: () => readFileSync(journalFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      });
    });
  });
}

export function writeJournalHeader(journalFile) {
  writeFileSync(journalFile, '');
  return path.resolve(journalFile);
}
