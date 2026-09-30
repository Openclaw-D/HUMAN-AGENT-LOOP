// 入口：node dist/index.js [--port 48080] [--db postgres://...] [--principal-tokens "..."] [--dispatch]
// 集成轮增量：[--parallel-advance] 启用五域并行推进引擎（POLICY parallel-columns-v1），可选
// [--service-credential tok-*]（默认 tok-svc1，须在 --principal-tokens 目录内）、
// [--advance-max-concurrency 4] [--progression column|parallel（默认 parallel）]、
// [--model-config <path>]（GLM 语义辅助；无配置=not_configured 如实状态）、[--semantic-receipts-dir <dir>]。
import { loadConfig, openPool } from './config.ts';
import { migrate } from './db/db.ts';
import { Kernel } from './domain/kernel.ts';
import { tokenDirectoryVerifier } from './domain/principal.ts';
import { buildParallelAdvanceRounds } from './domain/advance-round.ts';
import { buildZoneSemantic } from './domain/zone-semantic.ts';
import { buildArrowCycles } from './domain/cycles.ts';
import { startHttpServer } from './http/server.ts';
import { OutboxDispatcher } from './outbox/dispatcher.ts';

const argOf = (argv: string[], key: string): string | null => {
  const i = argv.indexOf(key);
  const v = i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  return v ?? null;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const config = loadConfig(argv);
  const pool = openPool(config.dbUrl);
  // DB 重启/网络闪断时，空闲连接出错会以 'error' 事件暴露——不处理会压垮进程（真实缺陷，测试抓到）。
  // 记录后继续：pool 在下次查询时自动重建连接。
  pool.on('error', (error) => {
    console.error('[pool] idle client error（DB 可能重启；连接将自动重建）:', error.message);
  });
  const ran = argv.includes('--no-migrate') ? [] : await migrate(pool);
  if (ran.length > 0) console.log(`[migrate] applied: ${ran.join(', ')}`);
  const verifier = config.principals.length > 0 ? tokenDirectoryVerifier(config.principals) : null;
  // 测试钩子（仅测试用）：验证器异常注入——验证 authenticate 的失败关闭路径不外泄凭据（旧 D-10 教训）
  const faulty = argv.includes('--faulty-verifier');
  const effectiveVerifier = verifier === null ? null : faulty
    ? async (credential: string) => { throw new Error(`verifier exploded; credential=${credential}`); }
    : verifier;
  const kernel = new Kernel(pool, { config, verifier: effectiveVerifier });

  // 五域并行推进引擎（02-execution 增量接线；opt-in：未启用时保持单列引擎原行为）
  let advanceEngine: unknown = undefined;
  let parallelAdvance: ReturnType<typeof buildParallelAdvanceRounds> | null = null;
  if (argv.includes('--parallel-advance')) {
    const { runReadyDomains } = await import(new URL('../../B/src/worker/column-runner.mjs', import.meta.url).href);
    const serviceCredential = argOf(argv, '--service-credential') ?? 'tok-svc1';
    const maxConcurrency = Number(argOf(argv, '--advance-max-concurrency') ?? 4);
    const progression = (argOf(argv, '--progression') ?? 'parallel') as 'column' | 'parallel';
    const modelConfigPath = argOf(argv, '--model-config');
    const receiptsDir = argOf(argv, '--semantic-receipts-dir') ?? '.local/acc04-semantic/receipts';
    const semantic = modelConfigPath ? buildZoneSemantic({ configPath: modelConfigPath, receiptsDir }) : null;
    parallelAdvance = buildParallelAdvanceRounds(kernel, {
      serviceCredential,
      runBatch: (inputs) => runReadyDomains(inputs, { maxConcurrency }),
      maxConcurrency,
      progression,
      semantic: semantic ?? undefined,
    });
    advanceEngine = parallelAdvance;
    console.log(`[kernel] advanceEngine=parallel-columns-v1 progression=${progression} maxConcurrency=${maxConcurrency} serviceCredential=${serviceCredential} semantic=${semantic ? semantic.describe().model : 'not_configured'}`);
  }

  const server = await startHttpServer(kernel, config.httpPort, { advance: advanceEngine as never, cycles: argv.includes('--parallel-advance') ? buildArrowCycles(kernel) as never : undefined });
  console.log(`[kernel] listening http://127.0.0.1:${config.httpPort}  db=${config.dbUrl.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`[kernel] principalVerifier=${effectiveVerifier === null ? 'NOT_CONFIGURED(敏感写失败关闭)' : `token-directory(${config.principals.length} principals)${faulty ? '+FAULTY(测试注入)' : ''}`}`);
  console.log(`[kernel] modelTransport=not_configured（GLM-5.2 仅预留，0 真实调用）`);
  let dispatcher: OutboxDispatcher | null = null;
  if (config.withDispatcher) {
    dispatcher = new OutboxDispatcher(pool, config);
    dispatcher.start();
    console.log('[outbox] dispatcher started（至少一次投递）');
  }
  const shutdown = (): void => {
    console.log('[kernel] shutting down...');
    dispatcher?.stop();
    const done = (): void => { server.close(() => process.exit(0)); };
    // 在途推进先收敛再关口，避免受理中的轮次被硬切断（不丢失、不重复生效）。
    const t = setTimeout(() => process.exit(0), 3000);
    t.unref();
    (parallelAdvance ? parallelAdvance.drain().then(done, done) : Promise.resolve(done())).catch(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('[kernel] fatal:', error);
  process.exit(1);
});
