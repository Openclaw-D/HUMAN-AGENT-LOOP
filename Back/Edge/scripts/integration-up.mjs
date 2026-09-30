// 集成轮 2026-09-25 · 真实联调底座启动入口（docs/integration/2026-09-25/01-foundation）。
// 装配顺序：自有 PG 容器（--init 首建/启动）→ 配置校验 → 端口所有权 → A 迁移+簿记核对 →
// 矩阵/政策播种（显式配置才播，恒标注非公司制度）→ A 内核（dispatch）→ Connectors（常驻驱动+
// 对象存储+A bridge+upload-context 只读口）→ Edge --live（含上传恢复装配）→ 真实就绪 → 版本封存 →
// 资源台账 →（--smoke）端到端验收套件。
// 纪律：readiness 只认真实依赖探测，不得以 mock 满足；任何必要依赖缺失=非零退出；
//       不抢占端口、不杀未知进程、不触碰非 jw-integ- 前缀容器；身份/令牌来自 Git 排除配置。
// 用法：node scripts/integration-up.mjs [--init] [--smoke]
//       [--db-container jw-integ-f-pg] [--db-port 25491] [--kernel-port 48480]
//       [--connectors-port 48400] [--edge-port 48420] [--config config/delivery-runtime.json]
//       [--op status|stop-connectors|start-connectors|stop-kernel|start-kernel|stop-edge|start-edge]
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  EDGE_ROOT, RUN_DIR, DEFAULTS, REPO_ROOT,
  run, ok, info, fail, argOf, portBusy, loadRuntimeConfig, ensureDbContainer,
  runMigrations, verifyMigrationBookkeeping, saveParams, loadParams,
  spawnA, spawnConnectors, startEdgeFull, stopService, stopEdge,
  edgeReadiness, edgeVersion, writeResources, waitHttp,
} from './integration-lib.mjs';

const argv = process.argv.slice(2);
const doInit = argv.includes('--init');
const doSmoke = argv.includes('--smoke');
const op = argOf(argv, '--op', null);

// Recover only this recorded stack. A listener is reused only when the pidfile,
// actual port owner and command marker agree; unknown listeners are never stopped.
if (argv.includes('--recover') && loadParams()) {
  const p = loadParams();
  const cfg = loadRuntimeConfig(p.configPath);
  await ensureDbContainer({ container:p.dbContainer, port:p.dbPort, user:cfg.dbUser, password:cfg.dbPassword, db:cfg.dbName, init:doInit });
  const reuse = async (name, port, file, healthUrl, pass) => {
    if (!await portBusy('127.0.0.1', port)) return false;
    let rec;
    try { rec=JSON.parse(readFileSync(path.join(RUN_DIR,file),'utf8')); } catch { fail(`${name} 端口已占用但缺少本栈记录：不抢占`); }
    if (!Number.isInteger(rec.pid) || !/^[a-z0-9-]+$/i.test(rec.marker ?? '')) fail(`${name} 本栈进程记录无效：不抢占`);
    const check = await run('powershell',['-NoProfile','-Command',
      `$jwProc=Get-CimInstance Win32_Process -Filter "ProcessId=${rec.pid}"; $jwOwners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); [bool]($jwProc -and $jwProc.CommandLine.Contains('${rec.marker}') -and $jwOwners.Count -eq 1 -and $jwOwners[0] -eq ${rec.pid})`]);
    if (check.err || check.stdout.trim()!=='True') fail(`${name} 端口所有者与本栈记录不符：不抢占`);
    if (!await waitHttp(healthUrl,pass,10000)) fail(`${name} 本栈服务存在但不健康：保留进程与数据，请检查日志`);
    ok(`${name} 本栈所有权与健康核对通过，复用`); return true;
  };
  const dsn=`postgres://${cfg.dbUser}:${cfg.dbPassword}@127.0.0.1:${p.dbPort}/${cfg.dbName}`;
  if (!await reuse('A内核',p.kernelPort,'kernel.pid',`http://127.0.0.1:${p.kernelPort}/healthz`,j=>j?.db==='up')) {
    await runMigrations({dsn});
    await spawnA({dsn,port:p.kernelPort,cfg,policyVersion:p.policyVersion,marker:`jw-integ-a-${Date.now().toString(36)}`,logPath:path.join(RUN_DIR,'kernel.log')});
  }
  const tokenFile=path.join(RUN_DIR,'connectors-token.txt');
  if (!await reuse('Connectors',p.connectorsPort,'connectors.pid',`http://127.0.0.1:${p.connectorsPort}/healthz`,j=>j?.ok&&j?.service==='jw-connectors')) {
    await spawnConnectors({cfg,connectorsCfg:cfg.connectors,dbPort:p.dbPort,port:p.connectorsPort,kernelPort:p.kernelPort,marker:`jw-integ-conn-${Date.now().toString(36)}`,logPath:path.join(RUN_DIR,'connectors.log'),tokenFile,paramsTenant:p.tenantId});
  }
  if (!await reuse('Edge',p.edgePort,'edge.pid',`http://127.0.0.1:${p.edgePort}/healthz/ready`,j=>j?.ok===true)) {
    const authFile=path.join(RUN_DIR,'edge-auth.json');
    writeFileSync(authFile,JSON.stringify({entries:cfg.authEntries??[]}));
    const edge=await startEdgeFull({port:p.edgePort,kernelPort:p.kernelPort,dbPort:p.dbPort,authFile,tokenFile,tenant:p.tenantId,runDir:RUN_DIR,messagesFile:path.join(RUN_DIR,'edge-messages.db'),marker:p.edgeMarker,serveFront:cfg.edgeServeFront??null,modelConfig:cfg.edgeModelConfig??null,modelReceiptsDir:cfg.edgeModelReceiptsDir??null});
    if (edge.err) fail('Edge 恢复失败，请检查本栈日志');
  }
  if (!await waitHttp(`http://127.0.0.1:${p.edgePort}/healthz/ready`,j=>j?.ok===true,30000)) fail('本栈恢复后仍未就绪');
  ok('本栈恢复就绪；原数据、会话与业务历史保留');
  process.exit(0);
}

// 子操作（供冒烟套件的中断/重启相位调用；全部走同一 lib，多证纪律不变）
if (op) {
  const params = loadParams();
  if (!params) fail('params.json 不存在：先完整运行 integration-up 写入运行参数');
  const tokenFile = path.join(RUN_DIR, 'connectors-token.txt');
  if (op === 'status') {
    const ready = await edgeReadiness(params.edgePort);
    console.log(JSON.stringify({ params, edgeReady: ready }, null, 2));
    process.exit(ready.ok ? 0 : 3);
  }
  if (op === 'stop-connectors') {
    try {
      await stopService({
        name: 'Connectors', pidFile: path.join(RUN_DIR, 'connectors.pid'),
        healthUrl: `http://127.0.0.1:${params.connectorsPort}/healthz`,
        healthPass: (j) => j?.ok === true && j?.service === 'jw-connectors', contentNote: 'service=jw-connectors',
      });
    } catch (e) { fail(e.message); }
    process.exit(0);
  }
  if (op === 'start-connectors') {
    const cfg = loadRuntimeConfig(params.configPath);
    await spawnConnectors({
      cfg, connectorsCfg: cfg.connectors, dbPort: params.dbPort, port: params.connectorsPort,
      kernelPort: params.kernelPort, marker: `jw-integ-conn-${Date.now().toString(36)}`,
      logPath: path.join(RUN_DIR, 'connectors.log'), tokenFile, paramsTenant: params.tenantId,
    });
    process.exit(0);
  }
  if (op === 'stop-kernel') {
    try {
      await stopService({
        name: 'A内核', pidFile: path.join(RUN_DIR, 'kernel.pid'),
        healthUrl: `http://127.0.0.1:${params.kernelPort}/healthz`,
        healthPass: (j) => j?.db === 'up' || j?.ok === true, contentNote: '/healthz 业务内核标识',
      });
    } catch (e) { fail(e.message); }
    process.exit(0);
  }
  if (op === 'start-kernel') {
    const cfg = loadRuntimeConfig(params.configPath);
    const dsn = `postgres://${cfg.dbUser}:${cfg.dbPassword}@127.0.0.1:${params.dbPort}/${cfg.dbName}`;
    await spawnA({
      dsn, port: params.kernelPort, cfg, policyVersion: params.policyVersion ?? null,
      marker: `jw-integ-a-${Date.now().toString(36)}`, logPath: path.join(RUN_DIR, 'kernel.log'),
    });
    process.exit(0);
  }
  if (op === 'stop-edge') {
    const stopped = await stopEdge({ runDir: RUN_DIR });
    process.exit(stopped ? 0 : 1);
  }
  if (op === 'start-edge') {
    const cfg = loadRuntimeConfig(params.configPath);
    const authPath = path.join(RUN_DIR, 'edge-auth.json');
    writeFileSync(authPath, JSON.stringify({ entries: cfg.authEntries ?? [] }, null, 2));
    const r = await startEdgeFull({
      port: params.edgePort, kernelPort: params.kernelPort, dbPort: params.dbPort,
      authFile: authPath, tokenFile, tenant: params.tenantId, runDir: RUN_DIR,
      messagesFile: path.join(RUN_DIR, 'edge-messages.db'), marker: params.edgeMarker,
      serveFront: cfg.edgeServeFront ?? null,
    modelConfig: cfg.edgeModelConfig ?? null,
    modelReceiptsDir: cfg.edgeModelReceiptsDir ?? null,
    });
    if (r.err) fail(`Edge 启动失败: ${(r.stderr || r.err.message).slice(0, 300)}`);
    process.exit(0);
  }
  fail(`未知 --op ${op}（可用：status/stop-connectors/start-connectors/stop-kernel/start-kernel/stop-edge/start-edge）`);
}

// ---- 完整启动 ----
const cfgPath = argOf(argv, '--config', path.join('config', 'delivery-runtime.json'));
const cfg = loadRuntimeConfig(cfgPath);
const params = {
  dbContainer: argOf(argv, '--db-container', DEFAULTS.dbContainer),
  dbPort: Number(argOf(argv, '--db-port', DEFAULTS.dbPort)),
  kernelPort: Number(argOf(argv, '--kernel-port', DEFAULTS.kernelPort)),
  connectorsPort: Number(argOf(argv, '--connectors-port', DEFAULTS.connectorsPort)),
  edgePort: Number(argOf(argv, '--edge-port', DEFAULTS.edgePort)),
  connectorsDb: cfg.connectors.pg?.database ?? DEFAULTS.connectorsDb,
  tenantId: cfg.connectors.tenantId ?? DEFAULTS.tenantId,
  configPath: cfgPath,
  policyVersion: null,
  edgeMarker: `jw-integ-edge-${Date.now().toString(36)}`,
  startedAt: new Date().toISOString(),
};

if (!process.version.startsWith('v22.')) fail(`需要 Node 22.x，当前 ${process.version}`);
ok(`预检：node ${process.version}；配置 ${cfgPath} 校验通过`);

// 1) 自有 PG 容器
await ensureDbContainer({
  container: params.dbContainer, port: params.dbPort,
  user: cfg.dbUser, password: cfg.dbPassword, db: cfg.dbName, init: doInit,
});

// 2) 端口所有权（占用即停，不抢占；报告占用者留给人工处置）
for (const [name, port] of [['A内核', params.kernelPort], ['Connectors', params.connectorsPort], ['Edge', params.edgePort]]) {
  if (await portBusy('127.0.0.1', port)) fail(`端口 ${port} 已被占用（${name}）：不抢占；先核实归属（可能已有实例在跑，node scripts/integration-down.mjs）`);
}
ok(`端口所有权就绪：kernel=${params.kernelPort} connectors=${params.connectorsPort} edge=${params.edgePort}`);

// 3) Connectors 独立库（同实例；幂等创建）
const dbExists = await run('docker', ['exec', params.dbContainer, 'psql', '-U', cfg.dbUser, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${params.connectorsDb}'`]);
if (dbExists.err) fail(`检查 Connectors 库失败: ${dbExists.stderr.slice(0, 160)}`);
if (dbExists.stdout.trim() !== '1') {
  const created = await run('docker', ['exec', params.dbContainer, 'psql', '-U', cfg.dbUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${params.connectorsDb}`]);
  if (created.err) fail(`创建 Connectors 库失败: ${created.stderr.slice(0, 160)}`);
  ok(`Connectors 独立库 ${params.connectorsDb} 已创建（与 A 业务库隔离）`);
} else {
  ok(`Connectors 独立库 ${params.connectorsDb} 已存在（数据原样保留）`);
}

// 4) 迁移 + 簿记核对（任何缺失=失败关闭）
const dsn = `postgres://${cfg.dbUser}:${cfg.dbPassword}@127.0.0.1:${params.dbPort}/${cfg.dbName}`;
await runMigrations({ dsn });
await verifyMigrationBookkeeping({ container: params.dbContainer, user: cfg.dbUser, db: cfg.dbName });

// 5) 权限矩阵/必需域政策播种（仅显式配置；政策内容必须标注"非公司制度（演示）"或"经公司批准"）
if (typeof cfg.matrixSeedSql === 'string' && cfg.matrixSeedSql.length > 0) {
  const seed = await run('docker', ['exec', params.dbContainer, 'psql', '-U', cfg.dbUser, '-d', cfg.dbName, '-v', 'ON_ERROR_STOP=1', '-c', cfg.matrixSeedSql]);
  if (seed.err) fail(`矩阵播种失败: ${seed.stderr.slice(0, 200)}`);
  ok('权限矩阵播种完成（配置内 SQL，幂等；合成开发矩阵）');
} else {
  info('未配置 matrixSeedSql：正式动作将 POLICY_PENDING fail-closed');
}
const policyCfg = cfg.requiredDomainsPolicy ?? null;
if (policyCfg) {
  if (typeof policyCfg.version !== 'string' || !/^[a-z0-9-]{3,64}$/i.test(policyCfg.version)) fail('requiredDomainsPolicy.version 非法');
  if (typeof policyCfg.annotation !== 'string' || !/非公司制度|经公司批准/.test(policyCfg.annotation)) fail('requiredDomainsPolicy.annotation 必须标注"非公司制度（演示）"或"经公司批准"');
  const seed = await run('docker', ['exec', params.dbContainer, 'psql', '-U', cfg.dbUser, '-d', cfg.dbName, '-v', 'ON_ERROR_STOP=1', '-c', policyCfg.seedSql]);
  if (seed.err) fail(`必需域政策播种失败: ${seed.stderr.slice(0, 200)}`);
  params.policyVersion = policyCfg.version;
  ok(`必需域政策 ${policyCfg.version} 播种完成（${policyCfg.annotation}）`);
} else {
  info('未配置 requiredDomainsPolicy：依据包冻结维持 POLICY_PENDING fail-closed');
}

// 6) 保存运行参数（重启/停止/冒烟共用同一组端口与标识）
mkdirSync(RUN_DIR, { recursive: true });
saveParams(params);

// 7) A 内核
await spawnA({
  dsn, port: params.kernelPort, cfg, policyVersion: params.policyVersion,
  marker: `jw-integ-a-${Date.now().toString(36)}`, logPath: path.join(RUN_DIR, 'kernel.log'),
});

// 7.5) 规则包版本正式激活（配置显式声明才执行；政策内容属公司制度 → annotation 强制标注）。
// 不激活时处理链 analyze/Gate 段按 fail-closed 如实拒绝（409 STALE_BASIS），任务不伪造完成。
if (cfg.rulePackActivation) {
  const rp = cfg.rulePackActivation;
  if (typeof rp.version !== 'string' || !rp.version) fail('rulePackActivation.version 必填');
  if (typeof rp.annotation !== 'string' || !/非公司制度|经公司批准/.test(rp.annotation)) {
    fail('rulePackActivation.annotation 必须标注"非公司制度（演示）"或"经公司批准"——规则版本激活属正式动作');
  }
  const adminEntry = (cfg.authEntries ?? []).find((e) => Array.isArray(e.roles) && e.roles.includes('admin'));
  if (!adminEntry) fail('rulePackActivation 需要 authEntries 提供 admin 凭据（正式激活门=human policy/admin）');
  const act = await fetch(`http://127.0.0.1:${params.kernelPort}/api/v2/rule-pack-versions/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-principal-credential': String(adminEntry.credential) },
    body: JSON.stringify({ requestId: `intg-rulepack-${Date.now()}`, tenantId: params.tenantId, version: rp.version }),
    signal: AbortSignal.timeout(10000),
  });
  const actBody = await act.json().catch(() => ({}));
  if (act.status !== 200 || actBody?.ok !== true) fail(`规则包激活失败: ${act.status} ${JSON.stringify(actBody).slice(0, 200)}`);
  ok(`规则包 ${rp.version} 已正式激活（${rp.annotation}）`);
}

// 8) Connectors（服务令牌写入 run 目录文件，只经服务端传递）
const tokenFile = path.join(RUN_DIR, 'connectors-token.txt');
await spawnConnectors({
  cfg, connectorsCfg: cfg.connectors, dbPort: params.dbPort, port: params.connectorsPort,
  kernelPort: params.kernelPort, marker: `jw-integ-conn-${Date.now().toString(36)}`,
  logPath: path.join(RUN_DIR, 'connectors.log'), tokenFile, paramsTenant: params.tenantId,
});

// 9) Edge --live（身份目录=authEntries；上传恢复装配在 server 内构造）
const authPath = path.join(RUN_DIR, 'edge-auth.json');
if (Array.isArray(cfg.authEntries) && cfg.authEntries.length > 0) {
  writeFileSync(authPath, JSON.stringify({ entries: cfg.authEntries }, null, 2));
  ok(`Edge 身份目录已写入 ${path.relative(REPO_ROOT, authPath)}（${cfg.authEntries.length} 条）`);
} else {
  info('配置未提供 authEntries：Edge 会话交换将失败关闭');
  rmSync(authPath, { force: true });
}
const edgeStart = await startEdgeFull({
  port: params.edgePort, kernelPort: params.kernelPort, dbPort: params.dbPort,
  authFile: authPath, tokenFile, tenant: params.tenantId, runDir: RUN_DIR,
  messagesFile: path.join(RUN_DIR, 'edge-messages.db'), marker: params.edgeMarker,
  serveFront: cfg.edgeServeFront ?? null,
    modelConfig: cfg.edgeModelConfig ?? null,
    modelReceiptsDir: cfg.edgeModelReceiptsDir ?? null,
});
if (edgeStart.err) fail(`Edge 启动失败: ${(edgeStart.stderr || edgeStart.err.message).slice(0, 300)}`);
console.log(edgeStart.stdout.trim());

// 10) 真实就绪（聚合 gating 检查全绿才算；如实报告逐依赖）
const ready = await waitHttp(`http://127.0.0.1:${params.edgePort}/healthz/ready`, (j) => j.ok === true, 30000);
const readyBody = await edgeReadiness(params.edgePort);
const version = await edgeVersion(params.edgePort);
let edgePid = null;
try { edgePid = JSON.parse(readFileSync(path.join(RUN_DIR, 'edge.pid'), 'utf8')).pid; } catch { }
const resources = writeResources({ params, edgePid, fullChainReady: ready === true, version });
ok(`资源台账已写入 ${path.relative(REPO_ROOT, path.join(RUN_DIR, 'resources.json'))}`);

console.log('──────────────────────────────────────────────');
console.log(`[integration] 全链就绪：${ready ? '是' : '否'}`);
for (const c of readyBody?.checks ?? []) console.log(`  - ${c.name}: ${c.ok ? 'ok' : 'NOT-OK'}${c.advisory ? '（advisory）' : ''}`);
console.log(`  Edge       : http://127.0.0.1:${params.edgePort}/  (build ${version.buildId ?? '?'}, contract ${version.contractVersion ?? '?'}, migrations ${JSON.stringify(version.migrationVersion ?? null)})`);
console.log(`  A 内核     : http://127.0.0.1:${params.kernelPort}/healthz`);
console.log(`  Connectors : http://127.0.0.1:${params.connectorsPort}/healthz`);
console.log(`  上传恢复   : GET /api/jw/v2/upload-context?customerId=…（会话必需；A 授权投影×2 + Connectors 恢复口）`);
console.log(`  停止       : node scripts/integration-down.mjs（多证复核；--with-db 停自有容器）`);
console.log('──────────────────────────────────────────────');
if (!ready) { console.error('[integration] readiness 未达成（见逐依赖原因）；exit 3'); process.exit(3); }

// 11) 可选：端到端冒烟（真实 HTTP + 真实 PG + 真实解析器）
if (doSmoke) {
  const { runSmoke } = await import('./integration-smoke.mjs');
  const code = await runSmoke({ params, runDir: RUN_DIR });
  process.exit(code);
}
console.log('[integration] 启动完成（未带 --smoke：验收用 node scripts/integration-smoke.mjs 单独运行）');
