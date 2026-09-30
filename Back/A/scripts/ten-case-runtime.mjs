// 收尾02 · 十案例隔离运行栈：在标准隔离栈（arrow_test 专用库）上叠加十案例种子。
// 用法：node scripts/ten-case-runtime.mjs --db <url> [--batch checkpoint|fresh] [--port 0]
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createIsolatedArrowRuntime, HUMAN, SERVICE, TENANT } from './parallel-arrows-runtime.mjs';
import { seedTenCases } from './seed-ten-cases.mjs';

const ADMIN = 'arrow-admin-admin';
export async function createTenCaseRuntime({ dbUrl, batch = 'checkpoint', run = randomUUID().slice(0, 8), edgePort = 0 }) {
  const r = await createIsolatedArrowRuntime({ dbUrl, seed: false, progression: 'parallel', edgePort, casesOverride: 'directory' });
  try {
    const cases = await seedTenCases({ kernel: r.kernel, advance: r.advance, cycles: r.cycles,
      adminCredential: ADMIN, humanCredential: HUMAN, serviceCredential: SERVICE, tenantId: TENANT, run, batch });
    return { ...r, cases, batch, run };
  } catch (e) { await r.close(); throw e; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
  const rt = await createTenCaseRuntime({ dbUrl: arg('db'), batch: arg('batch', 'checkpoint'), edgePort: Number(arg('port', 0)) });
  console.log(JSON.stringify({ ok: true, url: rt.baseUrl, aUrl: rt.aUrl, batch: rt.batch, run: rt.run,
    cases: rt.cases.map(c => ({ caseId: c.caseId, customerId: c.customerId, cycleId: c.cycleId ?? null, assessmentId: c.assessmentId ?? null })) }));
  let closing = false; const close = async () => { if (closing) return; closing = true; await rt.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
