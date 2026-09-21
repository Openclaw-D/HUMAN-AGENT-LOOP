// V0.4 03-receipts · B transport 专项本地替身（可计数、可注入六种响应形态）。
// 仅测试用：只监听 127.0.0.1、系统分配端口；逐次记录请求头/正文与命中数；
// 断言出站次数以本替身命中数为准（不是 HTTP 返回码）。无任何真实外呼。
import http from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * control.mode:
 *   ok        200 + 合法 chat.completions JSON（默认）
 *   malformed 200 + 非 JSON 正文
 *   status5xx 500 + {error,message}
 *   status4xx 400 + {error,message}
 *   destroy   请求收齐后直接销毁 socket（响应头前断连 → 发送后未知）
 *   partial   响应头+半截正文后销毁 socket（响应体中断 → 发送后未知）
 * control.delayMs 响应前延迟（> 客户端超时 → RESULT_UNKNOWN_TIMEOUT）
 * control.onHit 每次命中回调（在途变更注入点）
 */
export async function startTransportStub({ label = 'v04-transport' } = {}) {
  let hits = 0;
  const requests = []; // {at, headers, body}
  const control = { mode: 'ok', delayMs: 0, onHit: null,
    decisions: false, decisionsKind: 'next_action' }; // decisions=true 时返回可通过 Edge 候选校验的 decisions JSON
  const snippetIdsOf = (bodyText) => [...bodyText.matchAll(/"id":"([0-9a-f]{64})"/g)].map((m) => m[1]);
  const okBody = (n, bodyText) => {
    if (!control.decisions) {
      return JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ observations: [`v04 synthetic observation ${n}`], questions: ['v04 synthetic question?'], evidenceRefs: [] }) } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        model: 'v04-stub',
      });
    }
    const ids = [...new Set(snippetIdsOf(bodyText))];
    const ref = ids.length ? [ids[0]] : [];
    const base = { id: 'option_1', label: '核对销售合同与验收记录', confidence: 0.8, impact: '选择后需要核对原件与付款流水', evidenceRefIds: ref };
    const second = { id: 'option_2', label: '调取银行流水核对回款', confidence: 0.7, impact: '选择后需要核对流水与发票一致', evidenceRefIds: ref };
    const decisions = control.decisionsKind === 'path_forecast'
      ? [base, second].map((c) => ({ ...c, id: c.id.replace('option_', 'branch_'),
          label: '可能进入补证后复核状态',
          forecast: { targetState: '待补证后复核', conditions: ['补齐列明资料并由有权人员核验'], horizon: '下一次办理步骤' } }))
      : [base, second];
    return JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ decisions, observations: [], questions: [] }) } }],
      usage: { prompt_tokens: 21, completion_tokens: 15, total_tokens: 36 },
      model: 'v04-stub',
    });
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      hits++;
      const bodyText = Buffer.concat(chunks).toString('utf8');
      requests.push({ at: new Date().toISOString(), headers: { ...req.headers }, body: bodyText });
      try { await control.onHit?.(); } catch { /* 注入回调异常不改变响应形态 */ }
      if (control.delayMs) await sleep(control.delayMs);
      if (control.mode === 'destroy') { res.destroy(); return; }
      if (control.mode === 'partial') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"choices":[{"message":{"content":"');
        setTimeout(() => res.destroy(), 20);
        return;
      }
      if (control.mode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('not-json-at-all{'); return; }
      if (control.mode === 'status5xx') { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'UPSTREAM_BOOM', message: 'synthetic upstream failure' })); return; }
      if (control.mode === 'status4xx') { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'INVALID_REQUEST_SYNTHETIC', message: 'synthetic rejection' })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody(hits, bodyText));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const close = async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); };
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    hits: () => hits,
    requests,
    control,
    close,
  };
}
