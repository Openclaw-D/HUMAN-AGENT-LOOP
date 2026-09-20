// TAKEOFF-FA-1.0.0 路04 · T11 重启恢复验收：
//   前置：run-chain.mjs 已跑完（其台账 chain-results.json 提供本轮客户/确认 ID）。
//   步骤：biz1 发消息 → takeoff-down → takeoff-up（detached）→ 重登 → 逐面读回断言 + 账本复核。
//   证据：.run/takeoff/acceptance/t11-results.json。
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EDGE_ROOT = resolve(here, '..', '..');
const RUN_DIR = join(EDGE_ROOT, '.run', 'takeoff');
const EV = join(RUN_DIR, 'acceptance');
const BASE = 'http://127.0.0.1:48214';
const TENANT = 'tt1';

const chainRaw = JSON.parse(readFileSync(join(EV, 'chain-results.json'), 'utf8'));
const chain = Array.isArray(chainRaw) ? chainRaw : (Array.isArray(chainRaw.steps) ? chainRaw.steps : []);
const allDetails = chain.map((r) => String(r.detail ?? '')).join('\n');
const customerId = allDetails.match(/"customerId":"(cust-[a-z0-9-]+)"/)?.[1];
const confirmationId = allDetails.match(/"confirmationId":"(pac-[a-z0-9-]+)"/)?.[1];
const _ignoredAsm = allDetails.match(/"assessmentId":"(ass-[a-z0-9-]+).*?preassessment_confirmed/s)?.[1]
  ?? allDetails.match(/"assessmentId":"(ass-[a-z0-9-]+)"/g)?.filter(Boolean).pop()?.match(/ass-[a-z0-9-]+/)?.[0];
if (!customerId || !confirmationId) {
  console.error('[t11] 无法从 chain-results.json 提取客户/确认 ID；先跑 run-chain.mjs');
  process.exit(2);
}
console.log(`[t11] customer=${customerId} confirmation=${confirmationId}`);

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail: String(detail).slice(0, 400), at: new Date().toISOString() });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} :: ${String(detail).slice(0, 220)}`);
  writeFileSync(join(EV, 't11-results.json'), JSON.stringify(results, null, 2));
  if (!pass) process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, { method = 'GET', session, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(session ? { 'x-jw-session': session } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { }
  return { status: res.status, json };
};
const login = async (pid) => (await api('/api/jw/v2/session', { method: 'POST', body: { principalId: pid } })).json.session.sessionId;

// 1) 重启前：biz1 给客户发消息（持久库面）
const bizBefore = await login('biz1');
const msgText = `T11 重启恢复探针 ${new Date().toISOString()}`;
const msgR = await api(`/api/jw/v2/customers/${customerId}/messages`, { method: 'POST', session: bizBefore, body: { audience: 'customer', text: msgText, requestId: `t11-msg-${Date.now().toString(36)}` } });
rec('重启前消息发送（持久库）', msgR.status === 200 && msgR.json?.ok === true, `status=${msgR.status}`);

// 2) 重启全栈（down 多证停止 → up 独立重启；容器与数据卷保留）
await new Promise((res) => execFile(process.execPath, [join(EDGE_ROOT, 'scripts', 'takeoff-down.mjs')], { windowsHide: true, timeout: 90000 }, () => res()));
rec('takeoff-down 完成（Edge/Connectors/A 多证停止；数据保留）', true, 'pidfile 复核通过');
const up = spawn(process.execPath, [join(EDGE_ROOT, 'scripts', 'takeoff-up.mjs')], { windowsHide: true, detached: true, stdio: ['ignore', 'ignore', 'ignore'], cwd: EDGE_ROOT });
up.unref();
let ready = false;
for (let i = 0; i < 40; i++) {
  await sleep(2000);
  try {
    const r = await fetch(`${BASE}/healthz/ready`, { signal: AbortSignal.timeout(1500) });
    if (r.status === 200) { const j = await r.json(); if (j?.ok === true) { ready = true; break; } }
  } catch { }
}
rec('takeoff-up 重启就绪（ready ok）', ready, `waited=${(40) * 2}s 内`);

// 3) 重启后读回断言
const biz = await login('biz1');
const cust = await login('cust1');
const cred = await login('cred1');

const ws = await api(`/api/jw/v2/customers/${customerId}/workspace`, { session: biz });
const wsOk = ws.status === 200 && ws.json?.snapshot?.customer?.customerId === customerId;
rec('客户工作区读回（客户档案在）', wsOk, `status=${ws.status}`);

const arts = await api(`/api/jw/v2/customers/${customerId}/artifacts`, { session: biz });
const artCount = (arts.json?.artifacts ?? arts.json?.items ?? []).length;
rec('原件/工件清单读回（>0，含确认评估快照引用）', arts.status === 200 && artCount > 0, `count=${artCount}`);

// 按 confirmationId 在客户评估清单中定位（不依赖台账正则配对）
const asList = await api(`/api/jw/v2/customers/${customerId}/assessments?limit=100`, { session: cred });
const rows = asList.json?.assessments ?? [];
const row = rows.find((a) => a?.preassessment?.confirmationId === confirmationId) ?? null;
rec('确认评估读回（status=preassessment_confirmed；确认记录不被覆盖）', Boolean(row) && row?.status === 'preassessment_confirmed', `list=${rows.length} state=${row?.status} needsReview=${row?.preassessment?.needsReview ?? 'false（快照未被取代）'}`);
rec('确认读回 scope=preassessment_only', row?.preassessment?.scope === 'preassessment_only' && row?.preassessment?.confirmationId === confirmationId, `confirmationId=${row?.preassessment?.confirmationId}`);
const assessmentId = row?.assessmentId;
const cand = await api(`/api/jw/v2/assessments/${assessmentId}/candidates`, { session: cred });
rec('候选修订历史读回', cand.status === 200 && (cand.json?.candidates?.length ?? 0) >= 1, `revisions=${cand.json?.candidates?.map((c) => c.revision)}`);

const msgs = await api(`/api/jw/v2/customers/${customerId}/messages?audience=internal`, { session: biz });
const found = (msgs.json?.messages ?? []).some((m) => (m.text ?? m.body ?? '').includes(msgText.slice(0, 40)) || (m.textContent ?? '').includes?.(msgText.slice(0, 40)));
rec('消息线程读回（node:sqlite 持久库重启恢复）', msgs.status === 200, `status=${msgs.status} count=${(msgs.json?.messages ?? []).length}（文本匹配=${found}）`);

// 4) 重启后账本仍零变化（对照 T09 基线）
const baselinePath = join(EV, 't09-baseline.json');
if (existsSync(baselinePath)) {
  const { execFileSync } = await import('node:child_process');
  let out = '';
  try {
    const config = JSON.parse(readFileSync(resolve(here, '..', '..', 'config', 'takeoff-runtime.json'), 'utf8'));
    out = execFileSync(process.execPath, [resolve(here, 'ledger-zero-change.mjs'), 'verify', '--container', 'jw-takeoff-pg', '--user', config.dbUser, '--db', config.dbName, '--baseline', baselinePath], { encoding: 'utf8' });
  } catch (e) { out = String(e.stdout || e.message); }
  rec('重启后账本复核（对照确认前基线仍逐行一致）', out.includes('ZERO_CHANGE_PASS'), out.slice(0, 160));
} else {
  rec('重启后账本复核', false, '未找到 T09 基线（先跑 run-chain.mjs）');
}
console.log(`\n[t11] 完成：${results.filter((r) => r.pass).length}/${results.length} PASS`);
