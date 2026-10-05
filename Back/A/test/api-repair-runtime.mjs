// Disposable PostgreSQL database and HTTP server; no shared customer/service writes.
import pg from 'pg';
import { loadConfig } from '../src/config.ts';
import { tokenDirectoryVerifier } from '../src/domain/principal.ts';
import { Kernel } from '../src/domain/kernel.ts';
import { migrate } from '../src/db/db.ts';
import { startHttpServer } from '../src/http/server.ts';
import { buildParallelAdvanceRounds } from '../src/domain/advance-round.ts';
import { runReadyDomains } from '../../B/src/worker/column-runner.mjs';
import { seedCases, HUMAN, SERVICE, TENANT, DOMAINS } from '../scripts/parallel-arrows-runtime.mjs';
import { createTestDb, dropTestDb } from './utils.mjs';
export { HUMAN, SERVICE, TENANT };

export async function createRepairRuntime({ semantic, seed = true, progression = 'parallel' } = {}) {
  const db = await createTestDb('v7next_a_test_api_repair');
  const pool = new pg.Pool({ connectionString: db.url, max: 24 });
  let server, advance;
  try {
    await migrate(pool);
    const cfg = loadConfig(['--db', db.url, '--required-domains-policy', 'arrow-demo-required-v1', '--principal-tokens', [
      `${HUMAN}=arrow-reviewer:human:${DOMAINS.join('+')}:all:${TENANT}`,
      `${SERVICE}=arrow-local-service:service:${DOMAINS.join('+')}:all:${TENANT}`,
    ].join(',')]);
    const kernel = new Kernel(pool, { config: cfg, verifier: tokenDirectoryVerifier(cfg.principals) });
    for (const d of DOMAINS) await pool.query('INSERT INTO domain_requirement_policies(policy_version,domain,required,min_independent_proofs,created_by) VALUES($1,$2,true,1,$3)', ['arrow-demo-required-v1', d, 'api-repair-fixture']);
    await kernel.analysis.activateRulePack({ credential: HUMAN, tenantId: TENANT, requestId: 'fixture-rule', version: '1.0.0' });
    const cases = seed ? await seedCases(kernel, { suffix: db.name }) : [];
    advance = buildParallelAdvanceRounds(kernel, { serviceCredential: SERVICE, progression, semantic, maxConcurrency: 4,
      runBatch: inputs => runReadyDomains(inputs, { maxConcurrency: 4 }) });
    server = await startHttpServer(kernel, 0, { advance });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v2`;
    const call = async (method, url, body) => {
      const res = await fetch(baseUrl + url, { method, headers: { 'content-type': 'application/json', 'x-principal-credential': HUMAN },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json() };
    };
    return { kernel, pool, advance, cases, call, baseUrl, dbName: db.name, close: async () => {
      await advance.drain(); server.closeAllConnections(); await new Promise(r => server.close(r));
      await pool.end(); await dropTestDb(db.name);
    } };
  } catch (error) { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    await pool.end(); await dropTestDb(db.name); throw error; }
}
