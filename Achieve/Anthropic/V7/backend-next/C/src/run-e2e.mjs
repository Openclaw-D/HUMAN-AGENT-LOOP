// V7 backend-next Lane C · 端到端：案例轮次经真实 loopback socket 走 mock 模型 API。
// 链路：案例上下文 + MOCK_RESPOND_JSON(脚本候选) → HTTP POST /chat/completions（真实 TCP）
//       → mock 确定性回放 → 解析 content → 与 case-checker 的机械检查比对。
// 纪律：
// - 脚本候选经 HTTP 回放只是"transport 真实"的证据；验收仍以规则/算式断言为准（checker），
//   不以候选自评、也不以"mock 返回了"充当真值。
// - 短路轮（providerNotCalled）断言零请求发出（升级短路跨传输层成立）。
// - 断言通过 HTTP 控制面核对的真相只用于测试（transport 内部不得把控制面当业务数据源）。
// 用法：node src/run-e2e.mjs   （退出码 0=全过）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMockServer, projectCanary } from './mock-server.mjs';
import { candidateViolations, evaluateTurn } from './case-checker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const mainSet = JSON.parse(readFileSync(path.join(root, 'scenarios', 'leasing-cases-v1.json'), 'utf8'));

const mock = createMockServer({ port: 0, seed: mainSet.seed });
const { port } = await mock.listen();
const base = `http://127.0.0.1:${port}`;

const results = [];
let e2ePass = 0;
let e2eFail = 0;

async function postCompletion(projectId, body) {
  const res = await fetch(`${base}/v4/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jw-project': projectId },
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

for (const c of mainSet.cases) {
  const caseResult = { caseId: c.caseId, turns: [] };
  let caseOk = true;
  for (const [turnIdx, t] of c.turns.entries()) {
    const tr = { turn: t.turn, checks: [] };
    const add = (name, pass, detail = '') => { tr.checks.push({ name, pass, detail }); if (!pass) caseOk = false; };

    if (t.providerNotCalled === true) {
      // 短路轮：不发请求；稍后用控制面核对"本项目请求总数"时计入。
      tr.providerNotCalled = true;
    } else {
      const candidates = t.scriptedCandidates ? t.scriptedCandidates.filter((x) => x.expectValid) : (t.scriptedCandidate ? [{ label: 'main', candidate: t.scriptedCandidate }] : []);
      for (const item of candidates) {
        const prompt = [
          `案例 ${c.caseId} turn${t.turn}（${c.title}）。证据与口径见附件数据（合成）。`,
          `MOCK_RESPOND_JSON ${JSON.stringify(item.candidate)}`,
        ].join('\n');
        const body = { model: 'mock-glm-5.2', messages: [{ role: 'user', content: prompt }] };
        const { res, json } = await postCompletion(c.caseId, body);
        add(`http:${item.label}:200`, res.status === 200, `status=${res.status}`);
        add(`http:${item.label}:simulationMark`, json.mock?.simulationOnly === true && json.mock?.realModelCapability === false, 'mock 来源强标记');
        add(`http:${item.label}:projectIsolated`, json.mock?.projectId === c.caseId && json.mock?.canary === projectCanary(mainSet.seed, c.caseId), 'canary 仅含本项目');
        let roundTripped = null;
        try { roundTripped = JSON.parse(json.choices[0].message.content); } catch { /* 解析失败记违规 */ }
        add(`http:${item.label}:contentJson`, JSON.stringify(roundTripped) === JSON.stringify(item.candidate), '脚本候选经 socket 原样往返');

        if (roundTripped) {
          // 候选级机械检查（与 checker 同源）：正例必须零违规
          const withAll = { ...t, __allTurns: c.turns, __turnIndex: turnIdx };
          const violations = candidateViolations(roundTripped, withAll);
          add(`check:${item.label}:noViolations`, violations.size === 0, `违规=${[...violations].join(',') || '∅'}`);
        }
      }
      // 确定性：同请求重发 → 恒同响应 id
      if (candidates.length > 0) {
        const prompt = `确定性复核 MOCK_RESPOND_JSON ${JSON.stringify(candidates[0].candidate)}`;
        const body = { model: 'mock-glm-5.2', messages: [{ role: 'user', content: prompt }] };
        const r1 = await postCompletion(c.caseId, body);
        const r2 = await postCompletion(c.caseId, body);
        add('deterministic:id', r1.json.id === r2.json.id && r1.json.choices[0].message.content === r2.json.choices[0].message.content);
      }
    }
    // 轮级期望检查（规则/算式）
    const withAll = { ...t, __allTurns: c.turns, __turnIndex: turnIdx };
    for (const chk of evaluateTurn(withAll)) {
      tr.checks.push({ name: `rule:${chk.checkId}`, pass: chk.pass, detail: chk.detail });
      if (!chk.pass) caseOk = false;
    }
    caseResult.turns.push(tr);
  }
  // 跨传输层短路核对：控制面请求日志中，短路轮不得贡献请求（本案例请求数 = 非短路轮请求数）
  const logJson = await (await fetch(`${base}/__mock__/requests?project=${encodeURIComponent(c.caseId)}`)).json();
  const expectedHttpRequests = c.turns.filter((t) => t.providerNotCalled !== true).reduce((acc, t) => {
    const n = t.scriptedCandidates ? t.scriptedCandidates.filter((x) => x.expectValid).length : (t.scriptedCandidate ? 1 : 0);
    return acc + n + (n > 0 ? 2 : 0); // 候选请求 + 确定性复核 2 次
  }, 0);
  const shortCircuitOk = logJson.count === expectedHttpRequests;
  caseResult.shortCircuit = { expectedHttpRequests, actual: logJson.count, ok: shortCircuitOk };
  if (!shortCircuitOk) caseOk = false;
  if (caseOk) e2ePass += 1; else e2eFail += 1;
  results.push(caseResult);
  console.log(`${caseOk ? 'PASS' : 'FAIL'} e2e ${c.caseId}（http请求=${logJson.count} 期望=${expectedHttpRequests}）`);
}

await mock.close();

const evidence = {
  runAt: new Date().toISOString(),
  seed: mainSet.seed,
  transport: `loopback http://127.0.0.1:${port}（真实 socket，进程内启动）`,
  totals: { cases: mainSet.cases.length, pass: e2ePass, fail: e2eFail },
  cases: results,
};
mkdirSync(path.join(root, 'evidence'), { recursive: true });
writeFileSync(path.join(root, 'evidence', 'e2e-report.json'), JSON.stringify(evidence, null, 2));
console.log(`[e2e] 案例：${e2ePass}/${mainSet.cases.length} 通过；证据已写 evidence/e2e-report.json`);
process.exit(e2eFail === 0 ? 0 : 1);
