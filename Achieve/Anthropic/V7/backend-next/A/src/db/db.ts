import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

/** 顺序应用 migrations/*.sql；每文件一个事务，schema_migrations 记账。 */
export async function migrate(pool: Pool, dir?: string): Promise<string[]> {
  const migrationsDir = dir ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name as string));
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        ran.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`迁移 ${file} 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return ran;
  } finally {
    client.release();
  }
}

export type Tx = PoolClient;

/** 命令统一事务包装：业务写 + outbox + audit + 幂等 同一事务，异常整体回滚。 */
export async function inTx(pool: Pool, fn: (tx: Tx) => Promise<unknown>): Promise<unknown> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* 连接已断：回滚失败不掩盖原错误 */ }
    throw error;
  } finally {
    client.release();
  }
}
