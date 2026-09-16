#!/usr/bin/env node
// T4 跨进程子进程:向共享账本发起一次预算受控调用,结果 JSON 打到 stdout 末行。
// 用法: node test/budget-child.mjs <mockBaseUrl> <ledgerPath>
import { createModelTransport } from '../src/transport/glm.mjs';

const [, , baseUrl, ledger] = process.argv;
const t = createModelTransport({
  mode: 'mock', mock: { baseUrl, timeoutMs: 20000 },
  budget: { maxTotalCost: 1, perCallEstimate: 1 },
  costLogPath: ledger,
});
const r = await t.complete({ requestId: `child-${process.pid}`, evidenceRefs: [] });
console.log(JSON.stringify({ status: r.status, code: r.error?.code ?? null }));
