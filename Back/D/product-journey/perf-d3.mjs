// 任务四 D3 性能驱动器（本路所有）：对**当前冻结发布快照的交付栈**（delivery-up 形态：
// PG + A 内核 + Edge --live 同源前端）连测 ≥3 轮，落七项指标（USER_JOURNEY §4）：
//   首屏 / 文件处理（交付页面 originals 路径） / 预审等待（评估→候选→送审，页面动作链） /
//   关键提交（提案→批准→激活→用信预占） / 跨角色同步（SSE 事件到达） / 查询调用数（HTTP 计数 +
//   pg_stat_database 增量 synthetic-approx） / 资源峰值（A/Edge 进程 RSS 采样）。
// 边界：真实文件字节（≤512KB 上限内）；每轮独立客户隔离；不重建栈=同环境；
// 任何步骤失败如实记 FAIL 明细，不汇总成 PASS。全链解析处理（Connectors）不在本栈页面链内，
// 其同快照证据另见 R4 金丝雀（journey 专用库，同容器同源码快照）。
// 用法：node Back/D/product-journey/perf-d3.mjs [--rounds 3] [--edge http://127.0.0.1:17931]
//        [--kernel http://127.0.0.1:48282] [--pg-container jw-g04b-pg] [--pg-db jw]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const OUT_DIR = path.join(REPO, 'docs', 'product-delivery', 'goal-04', 'evidence', 'd3', 'perf');
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ROUNDS = Number(argOf('--rounds', '3'));
const EDGE = argOf('--edge', 'http://127.0.0.1:17931');
const KERNEL = argOf('--kernel', 'http://127.0.0.1:48282');
const PG_CONTAINER = argOf('--pg-container', 'jw-g04b-pg');
const PG_DB = argOf('--pg-db', 'jw');
const EDGE_PORT = Number(new URL(EDGE).port);
const KERNEL_PORT = Number(new URL(KERNEL).port);
const TENANT = 't1';

// 合成演示令牌来自 Git 排除的 delivery-runtime.json（与交付栈实际启动一致；fail-closed）
// 行格式：tok-biz1=biz1:human:business:all:t1 → 角色名 biz1 → 凭据 tok-biz1
const rt = JSON.parse(readFileSync(path.join(REPO, 'Back', 'Edge', 'config', 'delivery-runtime.json'), 'utf8'));
const TOKEN = {};
for (const entry of rt.principalTokens.split(',')) {
  const [cred, spec] = entry.split('=');
  TOKEN[spec.split(':')[0]] = cred;
}

const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summarize = (arr) => {
  if (!arr?.length) return { n: 0 };
  const a = [...arr].sort((x, y) => x - y);
  const s = { n: a.length, min: Math.round(a[0]), median: Math.round(a[Math.floor(a.length / 2)]), max: Math.round(a[a.length - 1]) };
  if (a.length >= 20) { s.p95 = Math.round(a[Math.ceil(0.95 * a.length) - 1]); s.note = 'n>=20'; } else s.note = 'n<20：不出高分位数';
  return s;
};
const sh = (cmd, a) => new Promise((res) => execFile(cmd, a, { windowsHide: true, timeout: 15000 }, (e, so, se) => res({ e, out: String(so || '').trim(), err: String(se || '') })));

// ---- 会话（页面同款：凭据只经会话交换一次） ----
const sessions = {};
async function login(who) {
  const r = await fetch(`${EDGE}/api/jw/v2/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: TOKEN[who] }),
  });
  const j = await r.json().catch(() => null);
  if (r.status !== 200 || !j?.session?.sessionId) throw new Error(`session ${who}: ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  sessions[who] = { sessionId: j.session.sessionId, roles: j.session.roles };
}
let httpCalls = 0;
async function edgeCall(who, method, p, body) {
  httpCalls += 1;
  const s = sessions[who];
  const r = await fetch(`${EDGE}${p}`, {
    method, headers: { 'content-type': 'application/json', ...(s ? { 'x-jw-session': s.sessionId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, json: j };
}
async function kernelCall(who, method, p, body) {
  httpCalls += 1;
  const r = await fetch(`${KERNEL}${p}`, {
    method, headers: { 'content-type': 'application/json', 'x-principal-credential': TOKEN[who] },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await j2(r); } catch { }
  return { status: r.status, json: j };
}
const j2 = async (r) => { try { return await r.json(); } catch { return null; } };
const timed = async (arr, fn) => { const t = performance.now(); try { return await fn(); } finally { arr.push(performance.now() - t); } };

// ---- 资源采样（A/Edge 进程 RSS，按监听端口定位 pid） ----
async function pidOfPort(port) {
  const r = await sh('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`]);
  const v = Number(r.out);
  return Number.isFinite(v) && v > 0 ? v : null;
}
async function rssOf(pid) {
  if (!pid) return null;
  const r = await sh('powershell', ['-NoProfile', '-Command', `[long](Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`]);
  const v = Number(r.out);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ---- pg_stat_database 增量（查询负载近似，synthetic-approx） ----
async function pgStat() {
  const r = await sh('docker', ['exec', PG_CONTAINER, 'psql', '-U', 'jw', '-d', PG_DB, '-tAc',
    `SELECT xact_commit, tup_inserted, tup_fetched FROM pg_stat_database WHERE datname=current_database()`]);
  if (r.e || !r.out) return null;
  const [xact, ins, fetched] = r.out.split('|').map((x) => Number(x.trim()));
  return { xactCommit: xact, tupInserted: ins, tupFetched: fetched };
}

// ---- SSE 读帧（到达第一帧即返回，供跨角色同步计时） ----
async function firstEventAfter(pathUrl, headers, deadlineMs) {
  const ctrl = new AbortController();
  const t0 = performance.now();
  try {
    const r = await fetch(`${EDGE}${pathUrl}`, { headers, signal: ctrl.signal });
    if (!r.ok || !r.body) return { ok: false, reason: `status ${r.status}` };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (performance.now() - t0 < deadlineMs) {
      const chunk = await Promise.race([
        reader.read(),
        sleep(deadlineMs - (performance.now() - t0)).then(() => null),
      ]);
      if (!chunk) return { ok: false, reason: 'timeout-no-event' };
      buf += dec.decode(chunk.value, { stream: true });
      // 事件帧以 "event:"/"data:" 行 + 空行分帧；到达任一 id 帧（排除首帧 cursor）即为同步
      const frames = buf.split('\n\n');
      for (const f of frames) {
        const m = f.match(/event: ?(\S+)/);
        if (m && m[1] !== 'cursor' && m[1] !== 'hello') {
          return { ok: true, event: m[1], ms: Math.round(performance.now() - t0) };
        }
      }
      if (frames.length > 1) buf = frames[frames.length - 1];
    }
    return { ok: false, reason: 'timeout' };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 100) };
  } finally { try { ctrl.abort(); } catch { } }
}

// ---- 真实字节原件（合成 PDF 信封，64KB 级） ----
function makeOriginalBytes(seed) {
  const head = Buffer.from(`%PDF-1.4\n% synthetic perf original ${seed}\n`, 'utf8');
  const body = Buffer.alloc(60 * 1024, 0x41);
  return Buffer.concat([head, body]);
}

async function main() {
  const runSummary = { startedAt: new Date().toISOString(), edge: EDGE, kernel: KERNEL, rounds: [] };
  for (const who of ['biz1', 'cred1', 'app1', 'jw1']) await login(who);
  console.log(`[perf-d3] sessions: ${Object.keys(sessions).join(',')} · edge=${EDGE} kernel=${KERNEL}`);

  // admin 一次性初始化：激活页面链使用的演示规则版本（与工作本提案面板 ruleVersion 一致）
  const act = await kernelCall('adm1', 'POST', '/api/v2/rule-pack-versions/activate',
    { requestId: rid('perf-act'), tenantId: TENANT, version: 'rules-delivery-demo' });
  runSummary.rulePackActivation = { status: act.status, json: act.json };

  const kernelPid = await pidOfPort(KERNEL_PORT);
  const edgePid = await pidOfPort(EDGE_PORT);
  console.log(`[perf-d3] pids: kernel=${kernelPid} edge=${edgePid}`);

  for (let round = 1; round <= ROUNDS; round++) {
    const rec = { round, startedAt: new Date().toISOString(), metrics: {}, errors: [] };
    const M = rec.metrics;
    let roundBlocked = false;
    const rss = [];
    let stopRss = setInterval(async () => {
      const k = await rssOf(kernelPid); const e = await rssOf(edgePid);
      if (k) rss.push({ kernel: k }); if (e) rss.push({ edge: e });
    }, 2000);

    try {
      // —— 首屏：同源页面（html+主资产）+ 登录态首屏数据（目录首页） ——
      const tHtml = []; const tAsset = []; const tFirstData = [];
      const html = await timed(tHtml, () => fetch(`${EDGE}/`).then((r) => r.text()));
      const assetM = html.match(/src="(\/assets\/[^"]+\.js)"/);
      if (assetM) await timed(tAsset, () => fetch(`${EDGE}${assetM[1]}`).then((r) => r.arrayBuffer()));
      await timed(tFirstData, () => edgeCall('biz1', 'GET', '/api/jw/v2/customers?limit=20'));
      M.firstScreen = {
        htmlMs: Math.round(tHtml[0]), mainAssetMs: tAsset[0] ? Math.round(tAsset[0]) : null,
        firstDataMs: Math.round(tFirstData[0]), totalMs: Math.round(tHtml[0] + (tAsset[0] ?? 0) + tFirstData[0]),
      };

      // —— 独立客户（每轮隔离） ——
      const c = await edgeCall('biz1', 'POST', '/api/jw/v2/actions/customers', {
        requestId: rid('perf-cust'), tenantId: TENANT,
        legalEntityRef: `USCC-PERF-${round}-${rid('e')}`, displayName: `性能轮${round}客户`,
      });
      if (c.status !== 200) throw new Error(`create customer: ${JSON.stringify(c.json).slice(0, 160)}`);
      const customerId = c.json.customerId;
      rec.customerId = customerId;

      // —— 文件处理（交付页面上传路径 originals，真实字节 ×3） ——
      const fileMs = [];
      let lastFile = null;
      for (let i = 0; i < 3; i++) {
        const bytes = makeOriginalBytes(`${round}-${i}`);
        const up = await timed(fileMs, () => edgeCall('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/originals`, {
          requestId: rid('perf-orig'), tenantId: TENANT, kind: 'purchase_contract',
          file: { name: `perf-${round}-${i}.pdf`, mime: 'application/pdf', dataBase64: bytes.toString('base64') },
        }));
        lastFile = up;
      }
      M.fileProcessing = { samplesMs: summarize(fileMs), lastStatus: lastFile.status, lastOk: lastFile.status === 200, note: 'Edge originals→A 工件登记（IR-03-3 v0 交付路径）；全链解析另见 R4 金丝雀' };
      if (lastFile.status !== 200) rec.errors.push({ step: 'fileProcessing', detail: JSON.stringify(lastFile.json).slice(0, 200) });

      // —— 预审等待（页面动作链：评估→候选→送审） ——
      const tAssess = []; const tCand = []; const tReview = [];
      const ass = await timed(tAssess, () => edgeCall('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, {
        requestId: rid('perf-as'), tenantId: TENANT, ruleVersion: 'rules-delivery-demo',
        evidenceSnapshot: [], note: 'perf round',
      }));
      let assessmentId = ass.json?.assessmentId ?? null;
      M.preReview = { createStatus: ass.status, createMs: Math.round(tAssess[0] ?? 0) };
      if (ass.status === 200) {
        const cd = await timed(tCand, () => edgeCall('cred1', 'POST', `/api/jw/v2/actions/assessments/${assessmentId}/candidate`, {
          requestId: rid('perf-cd'), tenantId: TENANT,
          candidate: { tendency: 'do', supportableAmountMinor: 300_000_000, producedBy: 'perf-d3' },
        }));
        const sr = await timed(tReview, () => edgeCall('cred1', 'POST', `/api/jw/v2/actions/assessments/${assessmentId}/submit-review`, {
          requestId: rid('perf-sr'), tenantId: TENANT,
        }));
        M.preReview.candidateStatus = cd.status; M.preReview.candidateMs = Math.round(tCand[0] ?? 0);
        M.preReview.reviewStatus = sr.status; M.preReview.reviewMs = Math.round(tReview[0] ?? 0);
        M.preReview.totalMs = Math.round((tAssess[0] ?? 0) + (tCand[0] ?? 0) + (tReview[0] ?? 0));
        if (cd.status !== 200) rec.errors.push({ step: 'candidate', detail: JSON.stringify(cd.json).slice(0, 200) });
        if (sr.status !== 200) rec.errors.push({ step: 'submit-review', detail: JSON.stringify(sr.json).slice(0, 200) });
      } else {
        rec.errors.push({ step: 'assessment.create', detail: JSON.stringify(ass.json).slice(0, 200) });
      }

      // —— 跨角色同步：SSE 订阅后他角色写材料，测事件到达 ——
      const sseHeaders = { 'x-jw-session': sessions.biz1.sessionId, accept: 'text/event-stream' };
      const sseWait = firstEventAfter(`/api/jw/v2/customers/${customerId}/events`, sseHeaders, 6000);
      await sleep(400);
      const wr = await edgeCall('jw1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
        requestId: rid('perf-sync'), tenantId: TENANT, kind: 'customer_profile', factKey: 'sync', content: { v: round }, grade: 'unverified',
      });
      const sse = await sseWait;
      M.crossRoleSync = { writeStatus: wr.status, event: sse.ok ? sse.event : null, arrivalMs: sse.ms ?? null, ok: sse.ok === true, missReason: sse.ok ? null : sse.reason ?? sse.reason };

      // —— 关键提交（页面动作链：提案→批准→激活→用信预占） ——
      // 交付形态事实：正式提案服务端强制绑定依据包（409 BASIS_PACKAGE_REQUIRED=正确权威门），
      // 而交付运行时无 service 主体可登记 Gate 回执/依据包、页面亦无包绑定链 → 本段记 BLOCKED（注 owner），不计链路 FAIL。
      const tPropose = []; const tApprove = []; const tActivate = []; const tFr = [];
      const prop = await timed(tPropose, () => edgeCall('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/facilities`, {
        requestId: rid('perf-pf'), tenantId: TENANT, approvedAmountMinor: 300_000_000, currency: 'CNY',
        months: 36, assessmentId: assessmentId ?? undefined,
      }));
      M.keySubmit = { proposeStatus: prop.status, proposeMs: Math.round(tPropose[0] ?? 0) };
      const facilityId = prop.json?.facilityId ?? null;
      if (prop.status === 409 && prop.json?.error === 'BASIS_PACKAGE_REQUIRED') {
        M.keySubmit.blocked = 'BASIS_PACKAGE_REQUIRED：服务端权威门正确 fail-closed；交付运行时无 service 主体登记 Gate 回执/依据包，页面无包绑定链（owner 01/03，见 DEF-G04N-04）';
        roundBlocked = true;
      } else if (prop.status === 200 && facilityId) {
        const ap = await timed(tApprove, () => edgeCall('app1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/approve`, {
          requestId: rid('perf-ap'), tenantId: TENANT, rationale: 'perf-d3 人正式决定',
        }));
        const ac = await timed(tActivate, () => edgeCall('app1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/activate`, {
          requestId: rid('perf-ac'), tenantId: TENANT, rationale: 'perf-d3 激活',
        }));
        M.keySubmit.approveStatus = ap.status; M.keySubmit.approveMs = Math.round(tApprove[0] ?? 0);
        M.keySubmit.activateStatus = ac.status; M.keySubmit.activateMs = Math.round(tActivate[0] ?? 0);
        if (ap.status !== 200) rec.errors.push({ step: 'approve', detail: JSON.stringify(ap.json).slice(0, 200) });
        if (ac.status === 200) {
          const fr = await timed(tFr, () => edgeCall('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
            requestId: rid('perf-fr'), tenantId: TENANT, facilityId, productType: 'direct_lease',
            amountMinor: 60_000_000, currency: 'CNY', equipmentRefs: ['DEV-PERF-1'],
          }));
          M.keySubmit.frStatus = fr.status; M.keySubmit.frMs = Math.round(tFr[0] ?? 0);
          if (fr.status === 200) {
            const rs = await edgeCall('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr.json.frId}/reserve`, { requestId: rid('perf-res'), tenantId: TENANT });
            M.keySubmit.reserveStatus = rs.status;
            if (rs.status !== 200) rec.errors.push({ step: 'reserve', detail: JSON.stringify(rs.json).slice(0, 200) });
          } else rec.errors.push({ step: 'financing-request', detail: JSON.stringify(fr.json).slice(0, 200) });
        } else rec.errors.push({ step: 'activate', detail: JSON.stringify(ac.json).slice(0, 200) });
      } else {
        rec.errors.push({ step: 'facility.propose', detail: JSON.stringify(prop.json).slice(0, 220) });
      }

      // —— 查询调用数：本轮 HTTP 计数 + pg 增量（轮段差值） ——
      const dbBefore = rec._db0 ?? await pgStat();
      M.queryCalls = { httpCallsThisRound: httpCalls, note: 'pg 增量在轮末补记（见 pgDelta）' };
      rec._db0 = dbBefore;

      // workspace 读一次作收尾读（跨角色视图一致性探测点）
      const ws = await edgeCall('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
      M.workspaceRead = { status: ws.status, facilities: (ws.json?.snapshot?.facilities ?? []).length };
      const dbAfter = await pgStat();
      if (dbBefore && dbAfter) {
        M.pgDelta = {
          method: 'pg_stat_database deltas（synthetic-approx，未装 pg_stat_statements）',
          xactCommitDelta: dbAfter.xactCommit - dbBefore.xactCommit,
          tupInsertedDelta: dbAfter.tupInserted - dbBefore.tupInserted,
          tupFetchedDelta: dbAfter.tupFetched - dbBefore.tupFetched,
        };
      }
    } catch (e) {
      rec.errors.push({ step: 'round', detail: String(e && e.stack ? e.stack : e).slice(0, 400) });
    } finally {
      clearInterval(stopRss);
    }

    // —— 资源峰值 ——
    M.resourcePeak = {
      kernelRssPeakBytes: rss.length ? Math.max(...rss.filter((x) => x.kernel != null).map((x) => x.kernel)) : null,
      edgeRssPeakBytes: rss.length ? Math.max(...rss.filter((x) => x.edge != null).map((x) => x.edge)) : null,
      samples: rss.length,
    };

    rec.result = rec.errors.length === 0 ? (roundBlocked ? 'BLOCKED' : 'PASS') : 'FAIL';
    rec.blockedMetrics = roundBlocked ? ['keySubmit'] : [];
    rec.finishedAt = new Date().toISOString();
    delete rec._db0;
    writeFileSync(path.join(OUT_DIR, `round-${round}.json`), JSON.stringify(rec, null, 2) + '\n');
    runSummary.rounds.push({ round, result: rec.result, errors: rec.errors.length, firstScreenTotalMs: rec.metrics.firstScreen?.totalMs ?? null });
    console.log(`[perf-d3] round ${round}: ${rec.result} (errors=${rec.errors.length}) firstScreen=${rec.metrics.firstScreen?.totalMs ?? '?'}ms file=${rec.metrics.fileProcessing?.samplesMs?.median ?? '?'}ms sync=${rec.metrics.crossRoleSync?.arrivalMs ?? 'miss'}ms`);
    await sleep(500);
  }

  runSummary.finishedAt = new Date().toISOString();
  runSummary.note = '七项指标逐轮实测；FAIL 轮如实保留。全链文件解析性能（Connectors 处理链）不在交付页面链内，同快照证据见 R4 金丝雀（journey 专用库，同容器同源码）。';
  writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(runSummary, null, 2) + '\n');
  console.log(`[perf-d3] 完成：${runSummary.rounds.filter((r) => r.result === 'PASS').length}/${ROUNDS} PASS · 证据 ${OUT_DIR}`);
  process.exit(runSummary.rounds.every((r) => r.result === 'PASS') ? 0 : 1);
}

main().catch((e) => { console.error('[perf-d3] 崩溃:', e); process.exit(2); });
