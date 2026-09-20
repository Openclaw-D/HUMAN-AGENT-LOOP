// 02_MODEL_API 专项 · 可记录请求的本地模型HTTP替身（qa-r2 02包独占，非产品代码）。
// 仅监听 127.0.0.1，端口由系统分配（listen 0）；四种必测响应模式：
//   valid     合法 OpenAI 形状 JSON（引用捕获到的获准证据片段id，另带一条伪造引用供降级校验）
//   malformed 200 + 非 JSON 正文 → transport RESPONSE_CORRUPTED（确定已发送）
//   drop      读毕请求正文后直接断流 → 未知（不自动重发）
//   truncate  200 响应头 + 半截正文后断流 → RESULT_UNKNOWN_TRUNCATED
//   delay     延迟应答（配合客户端 timeoutMs 产生 RESULT_UNKNOWN_TIMEOUT）
//   status500 5xx → failed(sent=true)（5xx=上游已处理家族）
// 只做记录与响应控制，不访问外网、不调用付费模型、不循环凑调用量。
import http from 'node:http';

function extractPackRef(captured) {
  try {
    const prompt = captured.parsedBody?.messages?.[0]?.content ?? '';
    const packText = prompt.split('[服务端获准证据包] ')[1];
    const pack = packText ? JSON.parse(packText) : null;
    return pack?.snippets?.[0]?.id ?? null;
  } catch { return null; }
}

function observeContent(captured) {
  const ref = extractPackRef(captured);
  const observations = ref
    ? [{ text: '获准原文观察：申请额与期间一致', evidenceRefIds: [ref] },
       { text: '伪造引用观察（服务端应降级为待核验）', evidenceRefIds: ['forged-ref-qa'] }]
    : [{ text: '合成观察（无证据包）' }];
  return JSON.stringify({ observations, questions: ref ? ['待核验：流水期间与开票期间是否一致'] : [] });
}

function decisionsContent(captured) {
  const ref = extractPackRef(captured);
  if (!ref) return JSON.stringify({ decisions: [], observations: [], questions: [] });
  const decisions = [
    { id: 'period', label: '先统一收入期间', confidence: 0.65, impact: '核对流水与开票起止日期', evidenceRefIds: [ref] },
    { id: 'duplicate', label: '先核对重复交易', confidence: 0.85, impact: '核对同笔收入是否重复计入', evidenceRefIds: [ref] },
    { id: 'review', label: '交专业人员核对', confidence: null, impact: '确认材料口径', evidenceRefIds: [ref] },
  ];
  return JSON.stringify({ decisions, observations: [], questions: [] });
}

export async function startModelStandin({ label = 'standin' } = {}) {
  const captured = [];
  const control = { mode: 'valid', delayMs: 0, hold: null, onHit: null, contentType: 'observe' };
  let hits = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', async () => {
      hits += 1;
      const record = { at: new Date().toISOString(), path: req.url, headers: { ...req.headers }, rawBody: raw, parsedBody: null };
      try { record.parsedBody = JSON.parse(raw); } catch { /* 原样保留 rawBody */ }
      captured.push(record);
      try { await control.onHit?.(record, hits); } catch { /* 注入回调失败不影响响应模式 */ }
      if (control.hold) await control.hold;
      if (control.delayMs) await new Promise((r) => setTimeout(r, control.delayMs));
      if (control.mode === 'drop') { req.socket.destroy(); return; }
      try {
        if (control.mode === 'truncate') {
          const partial = '{"choices":[{"message":{"content":"partial';
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(partial.length + 4096) });
          res.write(partial);
          const t = setTimeout(() => { try { req.socket.destroy(); } catch { /* 已断 */ } }, 20);
          t.unref?.();
          return;
        }
        if (control.mode === 'malformed') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('THIS-IS-NOT-JSON');
          return;
        }
        if (control.mode === 'status500') {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream_boom', message: 'synthetic 500' }));
          return;
        }
        const content = control.contentType === 'decisions' ? decisionsContent(record) : observeContent(record);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      } catch { /* 客户端已中止（如超时场景）：静默放弃响应 */ }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); };
  return {
    label, control,
    url: `http://127.0.0.1:${server.address().port}`,
    hits: () => hits,
    captured,
    lastBody: () => captured.at(-1)?.parsedBody ?? null,
    close,
  };
}
