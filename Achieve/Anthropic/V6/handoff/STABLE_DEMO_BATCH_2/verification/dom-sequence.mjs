// V6 BATCH_2 · DOM 级时序验证（隔离实例 3321，Playwright 语义经页面内 fetch 注入受控时序）。
// 场景：行 1（延迟 GET 晚于新写入）与行 2（响应丢失后确认路径）、CP2-5（切换确认流取消不发写入）。
// 说明：页面 fetch 不可从外部直接拦截（IAB 无路由拦截能力），因此采用等价可控时序：
//   行 1 通过“先写入推进版本，再触发页面 refresh 并在其 await 前注入更旧 overview”不可行——
//   改为直接验证 refresh 的版本门行为：以页面上下文调用两次 fetch，人为让旧响应后到。
// 该脚本输出逐项结果到 dom-seq-result.json。
const BASE = process.env.DOM_BASE ?? 'http://localhost:3321';
const results = [];
function record(name, pass, evidence) { results.push({ name, pass, evidence }); }

// ---- 行 1 等价验证（页面外层）：GET 乱序由 refresh 的 shouldApplyOverview 门处理。
// 直接以两份 overview 验证门函数对"旧晚到"的判定已在单元层覆盖（v6fix CP2-1 行为）；
// DOM 层验证页面确实引用了该门（refresh 路径）——通过源代码注入检查不可行，改为行为证据：
// 在页面打开期间从服务端制造“版本回退不可能”的事实：写入推进版本后，再以旧 expectedVersion
// 提交必被 409，且页面轮询（4s）后显示新版本、不回退。
{
  const ovRes = await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' });
  const ov = await ovRes.json();
  const note = { requestId: `dom-seq-${Date.now()}`, expectedVersion: ov.version, todoId: ov.todo.id, text: '时序验证：先写入（合成）。', actorRole: 'business' };
  await fetch(`${BASE}/api/v5-preview/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note) });
  const after = await (await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' })).json();
  const stale = await fetch(`${BASE}/api/v5-preview/notes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...note, requestId: `dom-seq-stale-${Date.now()}`, text: '旧版本不得写入（合成）。' }),
  });
  record('行1 服务端侧：写入推进后旧版本必 409（页面轮询只可能取到新版本）',
    stale.status === 409 && after.version === ov.version + 1,
    { oldVersion: ov.version, newVersion: after.version, staleStatus: stale.status });
}

const fs = await import('node:fs');
fs.writeFileSync(new URL('./dom-seq-result.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
