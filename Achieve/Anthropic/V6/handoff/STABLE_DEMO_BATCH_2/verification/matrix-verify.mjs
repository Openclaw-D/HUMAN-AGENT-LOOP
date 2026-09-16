// V6 BATCH_2 · 交付矩阵验证（隔离实例 3321；3311 现场只读未触碰）。
// 覆盖任务书矩阵表 HTTP/状态层 6 项；浏览器交互项由 DOM 级时序脚本与截图另行取证。
// 运行：node V6/handoff/STABLE_DEMO_BATCH_2/verification/matrix-verify.mjs
const BASE = process.env.MATRIX_BASE ?? 'http://localhost:3321';
const results = [];
function row(scene, pass, evidence) {
  results.push({ scene, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${scene}  ${JSON.stringify(evidence)}`);
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
  try { json = await res.json(); } catch { /* null */ }
  return { status: res.status, json };
}
async function seed(scenario) {
  const r = await post('/api/v5-preview/demo/seed', { scenario });
  assertOk(r, 'seed');
  return r.json.overview;
}
function assertOk(r, what) {
  if (r.status !== 200 || r.json?.ok !== true) throw new Error(`${what} 失败：${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
}

// ---- 行 3：同编号异载荷 / 旧版本 → 冲突拒绝，服务端不写入 ----
{
  const ov = await seed('approval');
  const v = ov.version;
  await post('/api/v5-preview/notes', { requestId: 'm3-seed', expectedVersion: v, todoId: ov.todo.id, text: '矩阵3种子（合成）。', actorRole: 'business' });
  const afterSeed = await getProject();
  const mismatch = await post('/api/v5-preview/notes', { requestId: 'm3-seed', expectedVersion: afterSeed.version, todoId: afterSeed.todo.id, text: '同编号异载荷（合成）。', actorRole: 'business' });
  const staleMsg = await post('/api/v5-preview/messages', { requestId: 'm3-stale-msg', expectedVersion: v, text: '旧版本沟通（合成）。', actorRole: 'business' });
  const final = await getProject();
  row('同编号异载荷/旧版本 → 冲突拒绝且不写入',
    mismatch.status === 409 && mismatch.json?.error === 'REQUEST_MISMATCH'
    && staleMsg.status === 409 && staleMsg.json?.error === 'VERSION_CONFLICT'
    && final.version === afterSeed.version,
    { mismatch: mismatch.status, stale: staleMsg.status, versionStable: final.version });
}

// ---- 行 2：消息与说明分别"已写入但响应丢失"，再轮询、原样重试 ----
{
  const ov = await seed('approval');
  const v = ov.version;
  const lostNote = { requestId: 'm2-lost-note', expectedVersion: v, todoId: ov.todo.id, text: '响应丢失的说明（合成）。', actorRole: 'business' };
  const lostMsg = { requestId: 'm2-lost-msg', expectedVersion: v + 1, text: '响应丢失的沟通（合成）。', actorRole: 'business' };
  const n1 = await post('/api/v5-preview/notes', lostNote);
  const m1 = await post('/api/v5-preview/messages', lostMsg); // 期间另一窗口推进版本
  const polled = await getProject(); // 轮询更新
  const n2 = await post('/api/v5-preview/notes', lostNote); // 完整原载荷重试
  const m2 = await post('/api/v5-preview/messages', lostMsg);
  const final = await getProject();
  row('说明/消息响应丢失→轮询→原样重放一次不重复',
    n1.status === 200 && m1.status === 200 && polled.version === v + 2
    && n2.status === 200 && n2.json?.replayed === true
    && m2.status === 200 && m2.json?.replayed === true
    && final.version === v + 2,
    { versions: [v, n1.json?.overview?.version, m1.json?.overview?.version, final.version], replayed: [n2.json?.replayed, m2.json?.replayed] });
}

// ---- 行 4：草稿/在途请求遇情景切换 → 旧请求不污染新情景 ----
{
  const ov = await seed('approval');
  const stale = ov.version;
  await seed('post-rental');
  const staleNote = await post('/api/v5-preview/notes', { requestId: 'm4-stale-note', expectedVersion: stale, todoId: 'todo-device-list', text: '旧批次说明（合成）。', actorRole: 'business' });
  const staleMsg = await post('/api/v5-preview/messages', { requestId: 'm4-stale-msg', expectedVersion: stale, text: '旧批次沟通（合成）。', actorRole: 'business' });
  const now = await getProject();
  row('情景切换后旧在途请求被拒且不污染',
    staleNote.status === 409 && staleMsg.status === 409
    && now.scenario === 'post-rental' && now.version === stale + 1,
    { staleNote: staleNote.status, staleMsg: staleMsg.status, nowVersion: now.version });
}

// ---- 行 5：信审补充/资产巡检/已结清 ----
{
  const ap = await seed('approval');
  const n = await post('/api/v5-preview/notes', { requestId: 'm5-credit', expectedVersion: ap.version, todoId: ap.todo.id, text: '信审补充（合成）。', actorRole: 'business' });
  const credit = n.json.overview.domains.find((d) => d.domainId === 'credit');
  const pr = await seed('post-rental');
  const n2 = await post('/api/v5-preview/notes', { requestId: 'm5-asset', expectedVersion: pr.version, todoId: pr.todo.id, text: '巡检确认（合成）。', actorRole: 'business' });
  const asset = n2.json.overview.domains.find((d) => d.domainId === 'asset');
  const st = await seed('settled');
  const n3 = await post('/api/v5-preview/notes', { requestId: 'm5-settled', expectedVersion: st.version, todoId: 'todo-device-list', text: '结清后补充（应拒）。', actorRole: 'business' });
  row('信审/资产复核提示正确、黄灯；结清无新补充入口',
    credit.judgmentText === '待复核' && credit.judgmentStatus === 'yellow'
    && asset.judgmentText === '待复核' && asset.judgmentStatus === 'yellow'
    && n3.status === 409 && n3.json?.error === 'NO_OPEN_TODO',
    { credit: credit.judgmentText, asset: asset.judgmentText, settledNote: n3.status });
}

// ---- 行 6：非法嵌套存储/非法缓存响应 → 失败关闭，文件逐字节不变 ----
{
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const { V5_STORE_SCHEMA } = await import(pathToFileURL(process.env.STORE_MODULE).href);
  // 隔离实例数据文件（服务进程以 V5_PREVIEW_DATA_DIR 指向此目录）；注入前后逐字节比对。
  const file = 'C:/Users/22673/Desktop/Anthropic/V6/handoff/STABLE_DEMO_BATCH_2/evidence/runtime-data/rows-store.json';
  const broken = JSON.stringify({ schema: V5_STORE_SCHEMA, overview: { projectId: 'JW-2026-018', version: 7, domains: [null, null, null, null] }, idempotency: [] });
  writeFileSync(file, broken, 'utf8');
  const g = await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' });
  const p = await post('/api/v5-preview/messages', { requestId: 'm6-corrupt', expectedVersion: 1, text: '损坏期间写入（合成）。', actorRole: 'business' });
  const fileAfter = readFileSync(file, 'utf8');
  const pass = g.status === 500 && g.json?.error === 'STORE_CORRUPT' && p.status === 500 && fileAfter === broken;
  row('非法嵌套存储 → 失败关闭，文件逐字节不变，错误不含内部细节',
    pass,
    { getStatus: g.status, postStatus: p.status, fileUnchanged: fileAfter === broken, serverMessage: g.json?.message });
  // 清理：损坏注入只为本验证服务；删除损坏文件，后续 GET 由服务端按种子重建，不影响后续场景/脚本。
  const { rmSync } = await import('node:fs');
  rmSync(file, { force: true });
  const heal = await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' });
  if (heal.status !== 200) throw new Error('损坏清理后服务未按种子重建');
}

// ---- 行 7：隔离服务重启恢复（由 verify 脚本 self-kill 自身 spawn 的实例执行，此处记录跳过原因） ----
row('服务重启恢复（由 isolated-restart.mjs 单独执行）', 'SKIPPED-HERE', '见 verification/isolated-restart.log');

const fs = await import('node:fs');
fs.writeFileSync(new URL('./matrix-result.json', import.meta.url), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.pass !== true && r.pass !== 'SKIPPED-HERE');
console.log(`\n== 矩阵小结：${results.filter((r) => r.pass === true).length} PASS / ${failed.length} FAIL / 1 另行 ==`);
process.exit(failed.length === 0 ? 0 : 1);
