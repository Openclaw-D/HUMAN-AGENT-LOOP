// 冒烟：对独立启动的 mock 服务（scripts/start-mock.mjs）做外部进程级验证。
// 用法：node scripts/smoke-external.mjs [port]
const port = parseInt(process.argv[2] ?? '3730', 10);
const base = `http://127.0.0.1:${port}`;
const results = [];
const assert = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); if (!cond) process.exitCode = 1; };

const health = await (await fetch(`${base}/__mock__/health`)).json();
assert('health.simulationOnly', health.simulationOnly === true);
assert('health.realModelCapability=false', health.realModelCapability === false);

const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-jw-project': 'SMOKE' },
  body: JSON.stringify({ model: 'mock-glm-5.2', messages: [{ role: 'user', content: '冒烟测试' }] }),
});
const j = await res.json();
assert('completion 200', res.status === 200);
assert('x-mock-simulation header', res.headers.get('x-mock-simulation') === 'true');
assert('mock.canary 存在', typeof j.mock?.canary === 'string' && j.mock.canary.startsWith('canary-'));
assert('content 含模拟声明', j.choices[0].message.content.includes('[MOCK-SIMULATION]'));

const rl = await (await fetch(`${base}/__mock__/requests?project=SMOKE`)).json();
assert('控制面按项目过滤', rl.count >= 1 && rl.requests.every((e) => e.projectId === 'SMOKE'));

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`smoke: ${results.filter((r) => r.ok).length}/${results.length} PASS against ${base}`);
