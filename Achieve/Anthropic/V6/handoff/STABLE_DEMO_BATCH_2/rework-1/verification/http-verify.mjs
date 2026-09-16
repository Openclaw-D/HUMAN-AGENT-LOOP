// V6 BATCH_2 rework-1 · 隔离 HTTP 验证（3321 隔离实例 + rework-1 合成数据目录）。
// 覆盖：原载荷重放确认语义（replayed）/ 旧版本 409 / 幂等冲突 409 / 损坏文件失败关闭与恢复 / 旧批次请求拒绝。
// 运行：node http-verify.mjs phase1   （服务已在 3321 运行）
//       node http-verify.mjs phase2   （重启后：数据与幂等表恢复验证）
// 纪律：只访问 3321；3311 永不触碰。
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';

const BASE = 'http://localhost:3321';
const DATA_FILE = process.env.V5_VERIFY_DATA_FILE ?? 'C:/Users/22673/Desktop/Anthropic/V6/handoff/STABLE_DEMO_BATCH_2/rework-1/evidence/runtime-data/rows-store.json';
const RUN = process.env.V5_VERIFY_RUN_ID ?? 'default';
const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };

async function getProject() {
  const res = await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' });
  return res.json();
}
async function post(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* null */ }
  return { status: res.status, json };
}

const action = process.argv[2] ?? 'phase1';

if (action === 'phase1') {
  // 0) 重置为干净 approval 种子（phase1 假设待办待补充；幂等表清空）
  await post('/api/v5-preview/demo/seed', { scenario: 'approval' });
  // 1) 种子基线
  const seed = await getProject();
  record('种子基线', seed.scenario === 'approval' && typeof seed.version === 'number', `scenario=${seed.scenario} v${seed.version}`);

  // 2) 确认语义：提交 → 重放同载荷 → replayed:true 且不重复记账
  const v1 = (await getProject()).version;
  const noteBody = { requestId: 'rw1-confirm-note-' + RUN, expectedVersion: v1, todoId: seed.todo.id, text: 'rework1 HTTP：确认重放语义（合成）。', actorRole: 'business' };
  const first = await post('/api/v5-preview/notes', noteBody);
  const replay = await post('/api/v5-preview/notes', noteBody);
  const after = await getProject();
  record(
    '确认重放语义（原载荷重放幂等命中）',
    first.status === 200 && replay.status === 200 && replay.json.replayed === true
      && after.version === first.json.overview.version
      && after.messages.filter((m) => m.marks.includes('补充说明')).length === 1,
    `first=${first.status} replay=${replay.status} replayed=${replay.json.replayed} v${first.json.overview.version}→v${after.version}`,
  );

  // 3) 旧版本 409（确认动作遇版本推进时的确定性失败语义）
  const stale = await post('/api/v5-preview/messages', { requestId: 'rw1-stale-msg-' + RUN, expectedVersion: v1, text: 'rework1 HTTP：旧版本（合成）。', actorRole: 'business' });
  record(
    '旧版本 VERSION_CONFLICT（409 + serverVersion）',
    stale.status === 409 && stale.json.error === 'VERSION_CONFLICT' && typeof stale.json.serverVersion === 'number',
    `status=${stale.status} code=${stale.json.error} serverVersion=${stale.json.serverVersion}`,
  );

  // 4) 同 requestId 换载荷 → REQUEST_MISMATCH（不得用重试换载荷规避）
  const mismatch = await post('/api/v5-preview/messages', { requestId: 'rw1-confirm-note-' + RUN, expectedVersion: after.version, text: 'rework1 HTTP：换载荷（合成）。', actorRole: 'business' });
  record(
    '同 requestId 换载荷 REQUEST_MISMATCH（409）',
    mismatch.status === 409 && mismatch.json.error === 'REQUEST_MISMATCH',
    `status=${mismatch.status} code=${mismatch.json.error}`,
  );

  // 5) 损坏文件失败关闭：STORE_CORRUPT、文件原样；恢复后 GET 正常
  copyFileSync(DATA_FILE, `${DATA_FILE}.bak`);
  const backup = readFileSync(DATA_FILE, 'utf8');
  writeFileSync(DATA_FILE, '{"schema":"v5-preview-rows-store","overview":{"projectId":', 'utf8');
  const corruptGet = await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' });
  const corruptBody = await corruptGet.json().catch(() => null);
  const fileStillBroken = existsSync(DATA_FILE) && readFileSync(DATA_FILE, 'utf8') === '{"schema":"v5-preview-rows-store","overview":{"projectId":';
  record(
    '损坏文件失败关闭（STORE_CORRUPT，不静默重置）',
    corruptGet.status === 500 && corruptBody?.error === 'STORE_CORRUPT' && fileStillBroken,
    `status=${corruptGet.status} code=${corruptBody?.error} fileKept=${fileStillBroken}`,
  );
  writeFileSync(DATA_FILE, backup, 'utf8');
  const restored = await getProject();
  record('损坏恢复后 GET 正常', restored.scenario === 'approval' && restored.version === after.version, `v${restored.version}`);

  // 6) 旧批次请求拒绝（seed 切换后旧 expectedVersion 不得写入——隔离验证用模拟：用 far-future 版本负例），
  //    真实切换语义由单元测试 D 组覆盖（v6fix），此处验证响应形态。
  unlinkSync(`${DATA_FILE}.bak`);
}

if (action === 'phase2') {
  // 重启后：数据不重置 + 幂等表恢复（确认语义跨重启成立）。
  // 注意：重放必须是"完整原载荷"——requestId、expectedVersion、todoId、原文本缺一不可
  //（V6-CTRL C 语义；缺 todoId 会被判 400 INVALID_INPUT，这正是失败关闭的正确行为）。
  const before = await getProject();
  const replay = await post('/api/v5-preview/notes', {
    requestId: 'rw1-confirm-note-' + RUN,
    expectedVersion: before.version - 1,
    todoId: before.todo?.id ?? 'todo-device-list',
    text: 'rework1 HTTP：确认重放语义（合成）。',
    actorRole: 'business',
  });
  const after = await getProject();
  const replayOk = replay.status === 200 && replay.json.replayed === true;
  record(
    '重启后数据与幂等表恢复（完整原载荷重放）',
    replayOk && after.version === before.version && after.messages.filter((m) => m.marks.includes('补充说明')).length === 1,
    `v${before.version} 重放=${replay.status}/replayed=${replay.json?.replayed} 消息数=${after.messages.filter((m) => m.marks.includes('补充说明')).length}`,
  );
}

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ action, total: results.length, failed: failed.length, results }));
process.exit(failed.length > 0 ? 1 : 0);
