// goal-04 E1：完整新业务链功能验收（单轮；性能多轮走 scripts/perf-g04.mjs）。
// 运行：node --test test/e1/e1-g04-fullchain.test.mjs（需 docker + 15438/17923 空闲）。
// 判据清单见 docs/backend-upgrade/goal-04/ACCEPTANCE_MATRIX.md F-01..F-22。
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { bootG04, runFullChain } from './g04-chain.mjs';
import { checkTask3Gate } from './task3-gate.mjs';

const gate = await checkTask3Gate();
const skipReason = gate.ok ? false : `g04 门未过: ${gate.reasons.join('; ')}`;

test('g04 完整新链（无 allow-legacy-basis：进件→四域可信依据→检查会话→包→人工决定→占额→阻断→恢复）', { skip: skipReason }, async (t) => {
  const timers = {};
  const notes = [];
  const sBoot = performance.now();
  const B = await bootG04({ runName: 'g04-fullchain' });
  timers.t_boot = performance.now() - sBoot;
  t.after(async () => { await B.cleanup(); });

  const meta = await runFullChain(B, assert, { timers, notes });
  const result = {
    at: new Date().toISOString(), result: 'PASS', kind: 'g04-fullchain-round',
    noLegacyBasis: true, requiredDomainsPolicy: true,
    ports: { pg: 15438, api: 17923 },
    migrationsApplied: B.applied,
    timersMs: Object.fromEntries(Object.entries(timers).map(([k, v]) => [k, Math.round(v)])),
    ...meta,
  };
  writeFileSync(path.join(B.RUN_DIR, 'g04-result.json'), JSON.stringify(result, null, 2));
});
