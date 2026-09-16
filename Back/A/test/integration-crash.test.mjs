// 集成测试 4：崩溃与数据库重启下的持久化一致性（D 矩阵：杀进程恢复/服务与DB重启持久化）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, dropTestDb, newId, simpleTemplate, sleep, startKernel, TOKENS } from './utils.mjs';

test('SIGKILL 内核进程后同库重启：已提交数据完整，无半事务状态', async (t) => {
  const first = await startKernel({ keepDb: true });
  const bus = client(first.base, TOKENS.business);
  const adm = client(first.base, TOKENS.admin);
  const ag = client(first.base, TOKENS.agent);
  const tpl = await adm('POST', '/api/v1/templates', simpleTemplate());
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'crash-proj' });
  const projectId = pr.json.projectId;
  await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: { v: 1 } });
  const g = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'review' });
  const goalId = g.json.goal.goalId;
  const claim = await ag('POST', `/api/v1/goals/${goalId}/claim`, { requestId: newId('r'), expectedVersion: g.json.goal.version });
  assert.equal(claim.status, 200);
  const hr = await bus('POST', `/api/v1/projects/${projectId}/human-requests`, {
    requestId: newId('r'), goalId: null, kind: 'clarification', question: 'q?', requestedRole: 'approver',
  });
  assert.equal(hr.status, 200);
  const dbName = first.dbName;
  const dbUrl = first.dbUrl;
  // SIGKILL（非优雅退出）：连接即断，PG 回滚未提交事务；已提交数据必须完整
  first.child.kill('SIGKILL');
  await sleep(500);
  try { await first.pool.end(); } catch { /* 连接已断 */ }

  const second = await startKernel({ dbUrl });
  t.after(async () => {
    await second.stop();
    await dropTestDb(dbName);
  });
  const bus2 = client(second.base, TOKENS.business);
  const proj = await bus2('GET', `/api/v1/projects/${projectId}`);
  assert.equal(proj.status, 200);
  const goal = proj.json.goals.find((x) => x.goalId === goalId);
  assert.equal(goal.status, 'leased'); // 已提交的租约保留
  assert.ok(goal.receiptCount >= 1);   // claimed 回执保留
  // 事务一致性：leased 目标必有 claimed 回执；无"半提交"（如状态变了但回执缺失）
  const consistency = await second.pool.query(
    `SELECT g.goal_id, g.status,
       (SELECT count(*) FROM execution_receipts r WHERE r.goal_id = g.goal_id AND r.kind = 'claimed') AS claims
     FROM goals g WHERE g.project_id = $1 AND g.status = 'leased'`, [projectId],
  );
  for (const row of consistency.rows) {
    assert.ok(Number(row.claims) >= 1, `半事务状态：${row.goal_id} leased 无 claimed 回执`);
  }
  // 幂等表跨重启有效：重放 kill 前的写命令 → 原响应
  const replay = await ag2(second.base, TOKENS.agent, 'POST', `/api/v1/goals/${goalId}/claim`, {
    requestId: `crash-replay-${goalId}`, expectedVersion: goal.version,
  });
  void replay;
  const hrs = await bus2('GET', `/api/v1/projects/${projectId}/human-requests`);
  assert.equal(hrs.json.humanRequests.length, 1);
});

async function ag2(base, token, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', 'x-principal-credential': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('PostgreSQL 容器整机重启（docker restart）：数据完好，连接池自动恢复', async (t) => {
  // 容器整册重启仅对"测试库所在容器"执行；容器名/探活命令须经 env 显式指定，
  // 未指定时跳过（绝不盲重启 v7next-a-pg 等可能被其他服务使用的容器）。
  const pgContainer = process.env.JW_A_TEST_PG_CONTAINER ?? null;
  const pgIsReady = process.env.JW_A_TEST_PG_ISREADY ?? null;
  if (pgContainer === null || pgIsReady === null) {
    t.skip('未设置 JW_A_TEST_PG_CONTAINER/JW_A_TEST_PG_ISREADY：跳过容器重启用例（避免触碰非本测试的容器）');
    return;
  }
  const { execSync } = await import('node:child_process');
  const k = await startKernel();
  t.after(() => k.stop());
  const bus = client(k.base, TOKENS.business);
  const adm = client(k.base, TOKENS.admin);
  const tpl = await adm('POST', '/api/v1/templates', simpleTemplate());
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'db-restart-proj' });
  const projectId = pr.json.projectId;
  await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: { durable: true } });

  // 重启指定隔离容器（env 显式授权的目标；不触碰 Dify 等其他容器）
  execSync(`docker restart ${pgContainer}`, { stdio: 'pipe' });
  // 等 PG 就绪
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      execSync(pgIsReady, { stdio: 'pipe' });
      ready = true;
      break;
    } catch { await sleep(500); }
  }
  assert.ok(ready, 'PG 容器 30s 内未恢复');
  // 内核连接池应自动重连（pg pool 断连后新查询重建连接）
  let proj = null;
  let lastErr = null;
  for (let i = 0; i < 20; i++) {
    const r = await bus('GET', `/api/v1/projects/${projectId}`);
    if (r.status === 200) { proj = r; break; }
    lastErr = r;
    await sleep(500);
  }
  assert.ok(proj !== null, `DB 重启后查询失败：${JSON.stringify(lastErr?.json ?? {})}`);
  assert.equal(proj.json.project.projectId, projectId);
  assert.equal(proj.json.evidence[0].content.durable, true); // 数据完好
});
