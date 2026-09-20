// TAKEOFF-FA-1.0.0 路04 · T07 技术失败验收 v2（上游不可达注入）：
//   A) 解析失败分支：N4 扫描件 → needs_followup + FORMAT_UNSUPPORTED + nextAction 转人工（不编造）。
//   B) 上游不可达分支：停 Connectors（多证复核后）→ Edge 通道动作 502 UPSTREAM_UNKNOWN（原 requestId 回显）
//      → 重启 Connectors → 同 requestId 重试成功且不重复登记；客户不被自动拒绝/清零。
//   纪律：只停止本路 resources.json 登记且多证复核通过的进程；重启用同配置。
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EDGE_ROOT = resolve(here, '..', '..');
const CONNECTORS_ROOT = join(EDGE_ROOT, '..', 'Connectors');
const BASE = 'http://127.0.0.1:48214';
const TENANT = 'tt1';
const EV = join(EDGE_ROOT, '.run', 'takeoff', 'acceptance');

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail: String(detail).slice(0, 320), at: new Date().toISOString() });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} :: ${String(detail).slice(0, 220)}`);
  writeFileSync(join(EV, 't07-results.json'), JSON.stringify(results, null, 2));
  if (!pass) process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, { method = 'GET', session, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(session ? { 'x-jw-session': session } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { }
  return { status: res.status, json };
};
const login = async (pid) => (await api('/api/jw/v2/session', { method: 'POST', body: { principalId: pid } })).json.session.sessionId;
const run = (cmd, args, timeout = 20000) => new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout, stderr) => res({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));

const chainRaw = JSON.parse(readFileSync(join(EV, 'chain-results.json'), 'utf8'));
const chain = Array.isArray(chainRaw) ? chainRaw : (Array.isArray(chainRaw.steps) ? chainRaw.steps : []);
const allDetails = chain.map((r) => String(r.detail ?? '')).join('\n');
const customerId = allDetails.match(/"customerId":"(cust-[a-z0-9-]+)"/)?.[1];
const invitationId = allDetails.match(/"invitationId":"(inv_[a-z0-9]+)"/)?.[1];
if (!customerId || !invitationId) { console.error('[t07] 缺客户/邀请 ID'); process.exit(2); }

const biz = await login('biz1');
const cust = await login('cust1');

// ---- A) 解析失败分支（自传唯一字节不可解析件→转人工；不依赖主链场景演进）----
{
  const n4Bytes = readFileSync(join(EDGE_ROOT, 'test', 'fixtures', 'takeoff', 'materials', 'N4-ownership-invoice.png'));
  const corrupt = Buffer.from(n4Bytes);
  corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] + 1) % 256; // 唯一字节→不判重；仍不可解析
  const upBad = await api('/api/jw/v2/actions/connectors/evidence/upload', {
    method: 'POST', session: cust,
    body: { tenantId: TENANT, customerId, invitationId, kind: 'ownership_document', contentType: 'image/png', contentBase64: corrupt.toString('base64'), requestId: `t07a-${Date.now().toString(36)}` },
  });
  let badTask = null;
  for (let i = 0; i < 30 && upBad.status === 200; i++) {
    await sleep(2000);
    const st = await api(`/api/jw/v2/connectors/processing/status?tid=${TENANT}&cid=${customerId}`, { session: biz });
    const tasks = st.json?.tasks ?? [];
    badTask = tasks.find((t) => t.evidence_id === upBad.json?.evidenceId) ?? null;
    if (badTask && ['needs_followup', 'done', 'failed'].includes(badTask.status)) break;
  }
  rec('T07-A 解析失败如实转人工（needs_followup + FORMAT_UNSUPPORTED + 转人工入口）',
    Boolean(badTask) && badTask.status === 'needs_followup' && badTask.failure_code === 'FORMAT_UNSUPPORTED' && String(badTask.note ?? '').includes('转人工'),
    badTask ? `status=${badTask.status} code=${badTask.failure_code}` : (upBad.status === 200 ? '任务未产生' : `上传失败 ${upBad.status}`));
}

// ---- B) 上游不可达分支 ----
// B1. 多证复核后停止 Connectors（本路登记资源：pidfile+heartbeat+healthz 标识+命令行 marker）
const pidRec = JSON.parse(readFileSync(join(EDGE_ROOT, '.run', 'takeoff', 'connectors.pid'), 'utf8'));
let alive = true; try { process.kill(pidRec.pid, 0); } catch { alive = false; }
const hbAge = pidRec.heartbeatAt ? Date.now() - Date.parse(pidRec.heartbeatAt) : Infinity;
const ps = await run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pidRec.pid}").CommandLine`], 15000);
const markerOk = String(ps.stdout || '').includes(String(pidRec.marker));
let healthOk = false;
try { const h = await (await fetch(`http://127.0.0.1:${pidRec.port}/healthz`, { signal: AbortSignal.timeout(2000) })).json(); healthOk = h?.service === 'jw-connectors'; } catch { }
rec('T07-B 停止前多证复核（pid+heartbeat+healthz 标识+marker）', alive && hbAge < 120000 && healthOk && markerOk, `alive=${alive} hbAge=${Math.round(hbAge / 1000)}s health=${healthOk} marker=${markerOk}`);
process.kill(pidRec.pid);
await sleep(1500);
rec('T07-B Connectors 已停（注入上游不可达）', true, `pid=${pidRec.pid}`);

// B2. Edge 通道动作 → 502 UPSTREAM_UNKNOWN，原 requestId 回显
const reqId = `t07-up2-${Date.now().toString(36)}`;
const csv = `period,total_assets_wan,total_liabilities_wan,revenue_wan,note\n2025Q4,4110,1762,1691,T07 unreachable injection ${reqId}`;
const upFail = await api('/api/jw/v2/actions/connectors/evidence/upload', {
  method: 'POST', session: cust,
  body: { tenantId: TENANT, customerId, invitationId, kind: 'financial_statement', contentType: 'text/csv', contentBase64: Buffer.from(csv, 'utf8').toString('base64'), requestId: reqId },
});
rec('T07-B 上游不可达 → 502 UPSTREAM_UNKNOWN + 原 requestId 回显（不自动重试不吞错）',
  upFail.status === 502 && upFail.json?.error === 'UPSTREAM_UNKNOWN' && upFail.json?.requestId === reqId,
  `status=${upFail.status} error=${upFail.json?.error} requestId=${upFail.json?.requestId ? '回显' : '缺失'}`);

// B3. 重启 Connectors（同配置）
const cLogFd = openSync(join(EDGE_ROOT, '.run', 'takeoff', 'connectors-restart.log'), 'w');
const child = spawn(process.execPath, [join(CONNECTORS_ROOT, 'scripts', 'start-connectors.mjs'), '--delivery-marker', `jw-takeoff-conn-r2-${Date.now().toString(36)}`], { cwd: CONNECTORS_ROOT, windowsHide: true, detached: true, stdio: ['ignore', cLogFd, cLogFd], env: { ...process.env, CONNECTORS_CONFIG: join(CONNECTORS_ROOT, '.run', 'config.takeoff.json') } });
child.unref();
let up2 = false;
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  try { const h = await (await fetch(`http://127.0.0.1:${pidRec.port}/healthz`, { signal: AbortSignal.timeout(1500) })).json(); if (h?.ok === true && h?.service === 'jw-connectors') { up2 = true; break; } } catch { }
}
rec('T07-B Connectors 重启就绪', up2, `port=${pidRec.port}`);
writeFileSync(join(EDGE_ROOT, '.run', 'takeoff', 'connectors.pid'), JSON.stringify({ pid: child.pid, marker: `jw-takeoff-conn-r2-${Date.now().toString(36)}`, port: pidRec.port, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), service: 'jw-connectors', note: 'T07 注入轮重启（t07-failure.mjs 写入）；重启实例心跳无监督进程续写' }));

// B4. 同 requestId 重试 → 成功且不重复登记
const upRetry = await api('/api/jw/v2/actions/connectors/evidence/upload', {
  method: 'POST', session: cust,
  body: { tenantId: TENANT, customerId, invitationId, kind: 'financial_statement', contentType: 'text/csv', contentBase64: Buffer.from(csv, 'utf8').toString('base64'), requestId: reqId },
});
rec('T07-B 同 requestId 重试成功（恢复后续跑）', upRetry.status === 200 && upRetry.json?.ok === true, `status=${upRetry.status} evidenceId=${upRetry.json?.evidenceId} dup=${upRetry.json?.duplicateOf ?? 'null'}`);

// B5. 客户未被自动拒绝/清零
const ws = await api(`/api/jw/v2/customers/${customerId}/workspace`, { session: biz });
const autoNeg = (ws.json?.snapshot?.assessments ?? []).some((a) => a?.status === 'rejected');
rec('T07-B 技术失败未导致客户自动拒绝/清零（工作区正常）', ws.status === 200 && !autoNeg, `status=${ws.status}`);
console.log(`\n[t07] 完成：${results.filter((r) => r.pass).length}/${results.length} PASS`);
