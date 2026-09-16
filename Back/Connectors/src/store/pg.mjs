import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(pool) {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function createTestDatabase(baseConfig) {
  const dbName = `cnext_test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = new pg.Pool({ ...baseConfig, database: 'cnext', max: 2 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  return { ...baseConfig, database: dbName, dbName };
}

export async function dropTestDatabase(baseConfig, dbName) {
  const admin = new pg.Pool({ ...baseConfig, database: 'cnext', max: 2 });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.end();
}

export function makeStore(config, { objectRoot } = {}) {
  const pool = new pg.Pool({ ...config, max: 8 });
  let closed = false;
  return {
    pool,
    objectRoot: objectRoot ?? null,
    async query(text, params) {
      return pool.query(text, params);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* already closed */ }
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!closed) { closed = true; await pool.end(); }
    },
  };
}
