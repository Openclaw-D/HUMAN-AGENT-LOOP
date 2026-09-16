// 本地 mock Chat Completions 端点（仅 socket 级集成验证用，非真实模型）。
// 行为：解析请求体 messages[1].content（JSON 字符串，含 payload+context），
// 回显 evidenceRefs[0] 构造合法 findings/questions，并返回 context 摘要以便核对正文进入请求。
import { createServer } from 'node:http';

const seen = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const auth = req.headers.authorization ?? '';
      seen.push({ url: req.url, hasAuth: auth.startsWith('Bearer sk-mock-'), authValue: auth });
      const userContent = JSON.parse(body.messages[1].content);
      const ref = Array.isArray(userContent.evidenceRefs) && userContent.evidenceRefs[0] ? userContent.evidenceRefs[0] : { id: 'none', version: '0', hash: 'none' };
      const ctx = userContent.context ?? {};
      const output = {
        findings: [{
          id: 'F-MOCK-1',
          text: `【本地mock验证】疑点：设备取得时点口径不一致（订购协议2021-11 vs 买卖合同2022-05）；依据 evidence ${ref.id} v${ref.version}。context提问=${(ctx.annotationQuestion ?? '').slice(0, 18)}…，人工回复条数=${Array.isArray(ctx.humanReplies) ? ctx.humanReplies.length : 0}。`,
          evidenceRefs: [ref],
        }],
        questions: [{ id: 'Q-MOCK-1', text: '【本地mock验证】请补交订购协议、定金收据与尾款凭证以核对权属链条。', evidenceRefs: [] }],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 210, completion_tokens: 60, total_tokens: 270 },
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'MOCK_HANDLING_ERROR', message: String(err && err.message) } }));
    }
  });
});
server.listen(3501, '127.0.0.1', () => {
  console.log('mock model endpoint ready at http://127.0.0.1:3501/v1/chat/completions');
});
