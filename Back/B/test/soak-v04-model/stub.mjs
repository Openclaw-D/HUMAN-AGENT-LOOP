// V0.4 soak-03 · 模型链路长测本地替身（可计数、确定性、可同端口重启）。
// 仅测试用：只监听 127.0.0.1、系统分配端口；响应形态由 driver 经 x-soak-form 头确定性指定，
// 替身无随机状态，保证可复现。逐次记录 requestId→命中次数（重复出站检测与账本对账的权威口径）。
// 控制面（/__control/*）不计入模型命中。无任何真实外呼；不逐请求输出完整正文。
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FORMS = new Set([
  'ok',                       // 200 + 合法 chat.completions + usage
  'delay50', 'delay200', 'delay1000', // 200 + 模拟延迟（50/200/1000ms < 客户端 2500ms 超时）
  'delay4000',                // 模拟延迟 4000ms > 客户端超时 → 发送后未知(RESULT_UNKNOWN_TIMEOUT)
  'status429',                // 429 + 错误JSON → RATE_LIMITED（未处理家族）
  'status500',                // 500 + 错误JSON → HTTP_500（确定失败）
  'error_json503',            // 503 + 错误JSON → HTTP_503（确定失败）
  'malformed',                // 200 + 意外格式(非JSON) → RESPONSE_CORRUPTED
  'truncated',                // 200 响应头 + 半截正文后断连 → RESULT_UNKNOWN_TRUNCATED
  'destroy',                  // 请求收齐后、响应前直接断连 → RESULT_UNKNOWN_INTERRUPTED
  'no_usage',                 // 200 + 合法响应但缺 usage → simulated 且 usage=null（不记账 actual）
]);

export async function startSoakStub({ stateDir = null, label = 'soak-v04-model', preferredPort = null } = {}) {
  let hits = 0;
  let restarts = 0;
  let port = null;
  const byForm = {};                 // form → 命中数
  const abortedByForm = {};          // form → 客户端提前断开数（超时形态计在此）
  const hitsByRequestId = new Map(); // requestId → 命中次数（重复出站/账本对账权威口径）
  const allHits = [];                // 全量命中流 [{i, at, requestId, form}]（增量对账用，不含正文）
  const recent = [];                 // 最近 2048 条 {at, requestId, form} 环形缓冲（不含正文）
  const control = { mode: 'normal', gapMs: 700, restarting: false,
    /** 形态序列（harness 编程，按命中序号循环；元素为 FORMS 成员）。 */
    pattern: ['ok'] };

  const bump = (obj, key) => { obj[key] = (obj[key] ?? 0) + 1; };

  const snapshot = () => ({
    at: new Date().toISOString(), hits, restarts,
    byForm: { ...byForm }, abortedByForm: { ...abortedByForm },
    distinctRequestIds: hitsByRequestId.size,
    duplicateRequestIds: [...hitsByRequestId.values()].filter((n) => n > 1).length,
    recent: recent.slice(-256),
  });
  const hitStream = (after) => ({ next: allHits.length, total: allHits.length, items: allHits.slice(after, after + 5000) });

  const flush = async () => {
    if (!stateDir) return;
    try { await fs.writeFile(path.join(stateDir, 'stub-counters.json'), JSON.stringify(snapshot(), null, 1)); } catch { /* 采样失败不改变服务 */ }
  };
  const flushTimer = setInterval(() => { void flush(); }, 5000);
  flushTimer.unref?.();

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/__control/')) {
      if (req.url === '/__control/stats') {
        req.resume();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...snapshot(), forms: [...FORMS], restarting: control.restarting }));
        return;
      }
      if (req.url.startsWith('/__control/hits?')) {
        req.resume();
        const after = Number(new URL(req.url, 'http://x').searchParams.get('after') ?? 0) || 0;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(hitStream(after)));
        return;
      }
      res.writeHead(404); res.end(); return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      hits++;
      const pattern = control.pattern.length ? control.pattern : ['ok'];
      const form = pattern[(hits - 1) % pattern.length];
      bump(byForm, FORMS.has(form) ? form : `unknown:${form}`);
      const requestId = String(req.headers['x-b-request-id'] ?? `no-id-${hits}`);
      hitsByRequestId.set(requestId, (hitsByRequestId.get(requestId) ?? 0) + 1);
      allHits.push({ i: allHits.length, at: new Date().toISOString(), requestId, form });
      recent.push({ at: new Date().toISOString(), requestId, form });
      if (recent.length > 2048) recent.splice(0, recent.length - 2048);
      if (!FORMS.has(form)) { res.writeHead(400); res.end(JSON.stringify({ error: 'SOAK_BAD_FORM' })); return; }
      const delay = form === 'delay50' ? 50 : form === 'delay200' ? 200 : form === 'delay1000' ? 1000 : form === 'delay4000' ? 4000 : 0;
      const clientGone = new Promise((resolve) => { res.once('close', () => resolve('gone')); });
      if (delay) await Promise.race([sleep(delay), clientGone.then((v) => { throw Object.assign(new Error('client-abort'), { v }); })]).catch((e) => { throw e; }).catch(() => 'gone');
      if (res.writableEnded || res.destroyed) { bump(abortedByForm, form); return; }
      if (form === 'destroy') { res.destroy(); return; }
      if (form === 'truncated') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"choices":[{"message":{"content":"');
        setTimeout(() => { res.destroy(); }, 20);
        return;
      }
      if (form === 'malformed') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>soak-unexpected-format</html>'); return; }
      if (form === 'status429') { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'RATE_LIMITED_SYNTHETIC', message: 'soak synthetic 429' })); return; }
      if (form === 'status500') { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'UPSTREAM_SYNTHETIC_500', message: 'soak synthetic 500' })); return; }
      if (form === 'error_json503') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'UPSTREAM_SYNTHETIC_503', message: 'soak synthetic 503 error json' })); return; }
      const body = JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          observations: [{ text: `soak 合成观察 ${hits}（模拟，非真实模型）` }],
          questions: [`soak 合成待核验问题 ${hits}?`], evidenceRefs: [] }) } }],
        ...(form === 'no_usage' ? {} : { usage: { prompt_tokens: 21, completion_tokens: 13, total_tokens: 34 } }),
        model: 'soak-v04-stub',
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
  });

  const listen = (p) => new Promise((resolve, reject) => {
    const onErr = (e) => { server.removeListener('error', onErr); reject(e); };
    server.once('error', onErr);
    server.listen(p, '127.0.0.1', () => { server.removeListener('error', onErr); resolve(server.address().port); });
  });
  port = await listen(preferredPort ?? 0);

  /** 同端口重启：先断所有连接（在途请求客户端侧变 unknown），空窗 gapMs 内新请求=ECONNREFUSED(未发送)。 */
  const restart = async ({ gapMs = control.gapMs } = {}) => {
    control.restarting = true;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await sleep(gapMs);
    let p = null;
    for (let i = 0; i < 25; i++) {
      try { p = await listen(port); break; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; await sleep(200); }
    }
    if (p === null) throw new Error('soak stub 重启失败：端口重绑超时');
    restarts++;
    control.restarting = false;
    return { port: p, restarts };
  };

  const close = async () => {
    clearInterval(flushTimer);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await flush();
  };

  return {
    url: `http://127.0.0.1:${port}`, port,
    hits: () => hits, restarts: () => restarts,
    hitCount: (requestId) => hitsByRequestId.get(requestId) ?? 0,
    stats: snapshot, hitStream, control, restart, close, flush,
    stateFile: stateDir ? path.join(stateDir, 'stub-counters.json') : null,
  };
}
