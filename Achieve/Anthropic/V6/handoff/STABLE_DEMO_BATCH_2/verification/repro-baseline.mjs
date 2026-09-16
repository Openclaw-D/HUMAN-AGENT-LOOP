// V6 BATCH_2 CP1 · 行为复现（修复前基线，隔离实例 3321，只触自己数据目录）。
// 运行：node V6/handoff/STABLE_DEMO_BATCH_2/verification/repro-baseline.mjs
// 产物：repro-baseline-result.json（同目录），修复后由 repro-verify.mjs 逐项翻转复验。
const BASE = process.env.REPRO_BASE ?? 'http://localhost:3321';
const results = [];
function record(name, observed, expectation) {
  results.push({ name, observed, expectation });
}

async function getProject() {
  const res = await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' });
  return res.json();
}
async function post(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* leave null */ }
  return { status: res.status, json };
}

// ---- 复现 1（P1 #2 / 矩阵行 2）：说明已写入但"响应丢失"，轮询转待复核后 ——
// 旧前端表单入口随状态消失，未确认请求无法从 UI 确认重放（源码路径，留待 DOM 级复验）。
// 服务端侧现状：同 requestId 原载荷重试仍可命中重放（第一批已修），此处记录服务端行为基线。
{
  const before = await getProject();
  const body = { requestId: 'repro-lost-note', expectedVersion: before.version, todoId: before.todo.id, text: 'CP1 复现：响应丢失的补充说明（合成）。', actorRole: 'business' };
  const first = await post('/api/v5-preview/notes', body);
  const afterWrite = await getProject(); // 模拟轮询：页面事实源已更新
  const retry = await post('/api/v5-preview/notes', body); // 完整原载荷重试
  record('复现1 服务端侧：原载荷重试命中重放且不重复记账', {
    firstVersion: first.json?.overview?.version,
    polledVersion: afterWrite.version,
    todoAfterPoll: afterWrite.todo?.status,
    retryStatus: retry.status,
    replayed: retry.json?.replayed === true,
    versionAfterRetry: (await getProject()).version,
  }, 'firstVersion+1, retry replayed=true, 不再递增');
}

// ---- 复现 2（P2 #3）：资产待办提交后复核提示文案 —— 服务端 judgmentText 与 todo.relatedDomain
{
  await post('/api/v5-preview/demo/seed', { scenario: 'post-rental' });
  const ov = await getProject();
  const body = { requestId: 'repro-asset-note', expectedVersion: ov.version, todoId: ov.todo.id, text: 'CP1 复现：巡检安排已确认（合成）。', actorRole: 'business' };
  const res = await post('/api/v5-preview/notes', body);
  const asset = res.json?.overview?.domains.find((d) => d.domainId === 'asset');
  const credit = res.json?.overview?.domains.find((d) => d.domainId === 'credit');
  record('复现2 服务端侧：资产待办提交后相关域判断', {
    assetJudgmentText: asset?.judgmentText,
    creditJudgmentText: credit?.judgmentText,
    relatedDomain: ov.todo?.relatedDomain,
  }, 'asset=待复核（黄），credit 不被错误指认');
  // 前端 todo-card.tsx:90 写死"信审复核中"的 UI 文案问题为源码级缺陷，DOM 复验在 CP2 修复后执行。
}

// ---- 复现 3（P2 #4）：异常响应中文收口 —— 存储错误 message 是否含内部细节 ----
{
  // 通过注入非法待办 ID 触发 NOT_FOUND，观察服务端 message（前端透传路径）
  const ov = await getProject();
  const res = await post('/api/v5-preview/notes', { requestId: 'repro-notfound', expectedVersion: ov.version, todoId: 'todo-device-list', text: '触发内部字段透传（合成）。', actorRole: 'business' });
  record('复现3 服务端侧：NOT_FOUND message 是否暴露内部 todoId', { serverMessage: res.json?.message ?? null }, '不应包含 todo-device-list 等内部字段（前端亦需映射）');
}

// ---- 复现 4（P1 #1）：乱序 GET 防回退 —— 属前端行为（refresh 直赋值），服务端无法复现；
// 以页面源码行为在 CP2 修复后用受控时序 DOM 测试复现+翻转。此处记录当前源码事实供对照。
record('复现4 前端侧：乱序 GET 防回退', {
  pageRefreshGuards: 'page.tsx refresh() 直赋 overviewRef（源码级已知缺陷，CP2-1 修复）',
}, '修复后所有状态入口经 shouldApplyOverview');

// ---- 复现 5（CP2-5）：情景切换无确认流 —— 前端行为，记录现状 ----
record('复现5 前端侧：情景切换无确认/取消流', {
  current: '选择即 POST seed（page.tsx seedScenario），无确认；在途请求/草稿处理未定义',
}, '修复后确认流：取消不发写入；确认才切换');

// 恢复演示初始态（隔离实例内，不影响现场）
await post('/api/v5-preview/demo/seed', { scenario: 'approval' });

const fs = await import('node:fs');
fs.writeFileSync(new URL('./repro-baseline-result.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
