#!/usr/bin/env node
// Celery spike 的宿主侧收集器:模拟 B 执行器的投递入口(loopback:3799)。
// 行为:
//   /execute → 记录投递 {goalId, deliveryAttempt, taskId, at} 到 evidence JSONL;
//             每个 goalId 的第 1 次投递返回 500(验证 Celery 有界重试),之后 200。
//   /_records → 返回已收集投递(供验证断言)。
// 用法: node scripts/celery-collector.mjs [--port 3799] [--out ../spike/celery/deliveries.jsonl]
import http from 'node:http';
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] ?? 3799);
const out = args[args.indexOf('--out') + 1] ?? '../spike/celery/deliveries.jsonl';

const records = [];
const seenGoal = new Set();

http.createServer((req, res) => {
  if (req.url === '/_records') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ records }));
    return;
  }
  if (req.url !== '/execute') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const p = JSON.parse(body ?? '{}');
    const firstDelivery = !seenGoal.has(p.goalId);
    seenGoal.add(p.goalId);
    const rec = { ...p, at: new Date().toISOString(), firstDelivery };
    records.push(rec);
    await fs.appendFile(out, `${JSON.stringify(rec)}\n`, 'utf8').catch(() => {});
    if (firstDelivery) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, note: 'simulated transient failure (first delivery)' }));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, recorded: records.length }));
    }
  });
}).listen(port, '0.0.0.0', () => console.log(`celery-collector on :${port}, out=${out}`));
