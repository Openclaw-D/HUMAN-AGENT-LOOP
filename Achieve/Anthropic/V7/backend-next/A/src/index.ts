// 入口：node dist/index.js [--port 48080] [--db postgres://...] [--principal-tokens "..."] [--dispatch]
import { loadConfig, openPool } from './config.ts';
import { migrate } from './db/db.ts';
import { Kernel } from './domain/kernel.ts';
import { tokenDirectoryVerifier } from './domain/principal.ts';
import { startHttpServer } from './http/server.ts';
import { OutboxDispatcher } from './outbox/dispatcher.ts';

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2));
  const pool = openPool(config.dbUrl);
  // DB 重启/网络闪断时，空闲连接出错会以 'error' 事件暴露——不处理会压垮进程（真实缺陷，测试抓到）。
  // 记录后继续：pool 在下次查询时自动重建连接。
  pool.on('error', (error) => {
    console.error('[pool] idle client error（DB 可能重启；连接将自动重建）:', error.message);
  });
  const ran = await migrate(pool);
  if (ran.length > 0) console.log(`[migrate] applied: ${ran.join(', ')}`);
  const verifier = config.principals.length > 0 ? tokenDirectoryVerifier(config.principals) : null;
  // 测试钩子（仅测试用）：验证器异常注入——验证 authenticate 的失败关闭路径不外泄凭据（旧 D-10 教训）
  const faulty = process.argv.includes('--faulty-verifier');
  const effectiveVerifier = verifier === null ? null : faulty
    ? async (credential: string) => { throw new Error(`verifier exploded; credential=${credential}`); }
    : verifier;
  const kernel = new Kernel(pool, { config, verifier: effectiveVerifier });
  const server = await startHttpServer(kernel, config.httpPort);
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
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('[kernel] fatal:', error);
  process.exit(1);
});
