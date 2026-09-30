// V0.5 十案例初始化（03路）。在 v05 集成栈的数据库上调用 02 路种子器 seedTenCases
// （Back/A/scripts/seed-ten-cases.mjs——检查点全部经 kernel.v2/advance/cycles 授权命令真实执行，
// 不直写业务结果表；模拟人工办理与模拟回执由种子器留痕标识）。
// 批次：checkpoint=执行到各例检查点停（目录进度各异，默认）；fresh=只建客户+登记材料（从头体验）。
// 幂等：同 --run 重复执行按 requestId 重放收敛；换 --run 即新批次（旧批次历史保留，不清库）。
// 凭据全部来自 v05 运行配置（tok-adm1/tok-adv1/tok-svcexec），不注入新身份。
// 用法：JW_INTEG_RUN_SUBDIR=v05 node scripts/ten-case-init.mjs [--batch checkpoint|fresh] [--run v05b1]
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDGE_ROOT, RUN_DIR, loadParams, loadRuntimeConfig, ok, info, fail } from './integration-lib.mjs';

const A_ROOT = path.resolve(EDGE_ROOT, '..', 'A');
const argv = process.argv.slice(2);
const argOf = (name, dflt = null) => { const key = `--${name}`; const i = argv.indexOf(key); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const BATCH = argOf('batch', 'checkpoint');
if (!['checkpoint', 'fresh'].includes(BATCH)) fail('--batch 只支持 checkpoint|fresh');
const RUN = argOf('run', 'v05b1');
const STATE_PATH = path.join(RUN_DIR, 'ten-case-state.json');

const params = loadParams();
if (!params) fail('params.json 不存在：先 Start-JW.ps1 或 integration-up 启动栈');
const cfg = loadRuntimeConfig(params.configPath);
const dsn = `postgres://${cfg.dbUser}:${cfg.dbPassword}@127.0.0.1:${params.dbPort}/${cfg.dbName}`;

// 与主内核同构的进程内引擎（种子执行经同一套授权命令；主内核空闲期执行，busy 集互不影响）。
// Windows 下动态 import 绝对路径必须 file:// URL。
const imp = (p) => import(pathToFileURL(p).href);
const { loadConfig } = await imp(path.join(A_ROOT, 'src', 'config.ts'));
const { tokenDirectoryVerifier } = await imp(path.join(A_ROOT, 'src', 'domain', 'principal.ts'));
const { Kernel } = await imp(path.join(A_ROOT, 'src', 'domain', 'kernel.ts'));
const { buildParallelAdvanceRounds } = await imp(path.join(A_ROOT, 'src', 'domain', 'advance-round.ts'));
const { buildArrowCycles } = await imp(path.join(A_ROOT, 'src', 'domain', 'cycles.ts'));
const { runReadyDomains } = await imp(path.join(A_ROOT, '..', 'B', 'src', 'worker', 'column-runner.mjs'));
const { seedTenCases } = await imp(path.join(A_ROOT, 'scripts', 'seed-ten-cases.mjs'));
const pg = (await imp(path.join(A_ROOT, 'node_modules', 'pg', 'lib', 'index.js'))).default; // Edge 零依赖 lane：pg 归 A

const pool = new pg.Pool({ connectionString: dsn, max: 12 });
const engineCfg = loadConfig(['--db', dsn, '--required-domains-policy', String(params.policyVersion ?? 'v05-required-v1'), '--principal-tokens', cfg.principalTokens]);
const verifier = tokenDirectoryVerifier(engineCfg.principals);
const kernel = new Kernel(pool, { config: engineCfg, verifier });
const advance = buildParallelAdvanceRounds(kernel, {
  serviceCredential: 'tok-svcexec',
  runBatch: (inputs) => runReadyDomains(inputs, { maxConcurrency: 4 }),
  maxConcurrency: 4,
  progression: 'parallel',
});
const cycles = buildArrowCycles(kernel);

console.log(`==== ten-case-init：批次=${BATCH} run=${RUN} → ${dsn.split('@')[1]} ====`);
const STATE0 = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};
STATE0.runs ??= [];
const already = STATE0.runs.find((r) => r.batch === BATCH && r.run === RUN);
if (already && !argv.includes('--force')) {
  console.log(`[ten-case-init] i 批次 ${BATCH}/${RUN} 已于 ${already.at} 初始化：跳过（种子配方非重放收敛；重演请换新 --run，强制重放加 --force）`);
  writeFileSync(STATE_PATH, JSON.stringify(STATE0, null, 2));
  process.exit(0);
}
const t0 = Date.now();
let cases;
try {
  cases = await seedTenCases({
    kernel, advance, cycles,
    adminCredential: 'tok-adm1', humanCredential: 'tok-adv1', serviceCredential: 'tok-svcexec',
    tenantId: 't1', run: RUN, batch: BATCH,
  });
} finally {
  await pool.end().catch(() => {});
}
const out = {
  suite: 'ten-case-init', date: new Date().toISOString(), batch: BATCH, run: RUN,
  edge: params.edgePort, tenant: 't1',
  cases: cases.map((c) => ({ caseId: c.caseId, customerId: c.customerId, displayOrder: c.displayOrder, category: c.category, businessName: c.businessName, cycleId: c.cycleId ?? null, assessmentId: c.assessmentId ?? null })),
  elapsedMs: Date.now() - t0,
};
writeFileSync(path.join(RUN_DIR, `ten-case-init-${BATCH}-${RUN}.json`), JSON.stringify(out, null, 2));
const state = STATE0;
state.lastRun = { batch: BATCH, run: RUN, at: out.date };
if (!state.runs.some((r) => r.batch === BATCH && r.run === RUN)) state.runs.push({ batch: BATCH, run: RUN, at: out.date });
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
console.log('──────────────────────────────────────────────');
for (const c of out.cases) console.log(`  ${String(c.displayOrder).padStart(2)} ${c.category} ${c.caseId} ${c.businessName} → ${c.customerId}${c.cycleId ? ` cycle=${c.cycleId}` : ''}${c.assessmentId ? ` assessment=${c.assessmentId}` : ''}`);
console.log(`[ten-case-init] ✓ ${out.cases.length} 案例（${(out.elapsedMs / 1000).toFixed(1)}s）；同 --run 重跑幂等收敛，换 --run 开新批次（旧历史保留）`);
