import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDefault = fileURLToPath(new URL('../../../', import.meta.url));
const local = '仅整合结束后串行执行；Node 22.23.1及已有依赖；使用自有临时资源，不接真实模型。';
const recovery = local + ' 恢复仅为同目录重建实例；须隔离回执/账本和本地HTTP替身，不证明进程崩溃恢复。';
const entry = (module, name, categories, preconditions = local) => ({
  module, file: `${module === 'Front' ? 'Front/preview/test/behavior' : `Back/${module}/test`}/${name}`,
  categories, preconditions, review: '入口与已引用测试设施已静态核对；非执行许可或通过结论',
});
export const entries = [
  entry('Edge', 'v04-test-plan.test.mjs', ['unit']),
  entry('Edge', 'v04-readiness-check.test.mjs', ['unit']),
  entry('Edge', 'v04-evidence-scope.test.mjs', ['unit']),
  entry('Edge', 'v04-message-idempotency.test.mjs', ['unit']),
  entry('Edge', 'v04-evidence-provider.test.mjs', ['HTTP']),
  entry('Edge', 'v04-activity-http.test.mjs', ['HTTP']),
  entry('Edge', 'v04-receipts-unknown-fence.test.mjs', ['HTTP', 'recovery'], recovery),
  entry('Edge', 'v04-receipts-operation-scope.test.mjs', ['HTTP', 'recovery'], recovery),
  entry('A', 'v04-upload-authz.test.mjs', ['HTTP', 'isolated-PG'], '须先将 JW_A_ADMIN_DB_URL 配置为专用隔离PG；会建删测试库并启停自有内核进程，禁止沿用默认共享库；串行执行。'),
  entry('A', 'v04-upload-failclosed.test.mjs', ['unit', 'HTTP', 'isolated-PG'], '整文件含真实PG与HTTP，不是纯单元测试；JW_A_ADMIN_DB_URL 必须指向专用隔离PG；会建删测试库，串行执行。'),
  entry('B', 'v04-transport-three-state.test.mjs', ['HTTP']),
  entry('B', 'v04-transport-budget-ledger.test.mjs', ['HTTP', 'recovery'], recovery),
  entry('Connectors', 'takeoff-chain.test.mjs', ['HTTP', 'isolated-PG'], '既有补充入口，非V0.4新增：专用隔离PG（CONNECTORS_TEST_PG_*），核对固定端口48283空闲与测试目录归属；不抢端口；建删测试库；A桥不在本例覆盖。PG不可达会退出0，必须核对实际测试数，不能算通过。'),
  entry('Front', 'takeoff-board.behavior.test.mjs', ['unit']),
  entry('Front', 'visual-workspace.behavior.test.mjs', ['unit']),
  entry('Front', 'workbench-hook.behavior.test.mjs', ['unit']),
];
export const quotePowerShell = value => `'${value.replaceAll("'", "''")}'`;
export function validateEntries(items) {
  const seen = new Set();
  for (const item of items) {
    const prefix = item.module === 'Front' ? 'Front/preview/test/behavior/' : `Back/${item.module}/test/`;
    if (!['Edge', 'A', 'B', 'Connectors', 'Front'].includes(item.module) ||
        !item.file.startsWith(prefix) || !/^[A-Za-z0-9/_.-]+\.test\.mjs$/.test(item.file) ||
        item.file.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('invalid_test_path');
    const key = item.file.toLowerCase();
    if (seen.has(key)) throw new Error('duplicate_test_entry');
    seen.add(key);
  }
}
export async function buildPlan(root = rootDefault, items = entries) {
  validateEntries(items);
  const base = await realpath(root);
  const tests = [];
  for (const item of items) {
    const target = path.resolve(base, item.file);
    let existence;
    try {
      const physical = await realpath(target);
      const relative = path.relative(base, physical);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) existence = 'out_of_scope';
      else existence = (await stat(physical)).isFile() ? 'exists' : 'wrong_type';
    } catch (e) { existence = e.code === 'ENOENT' ? 'missing' : 'check_failed'; }
    tests.push({ ...item, existence, result: 'NOT_RUN',
      command: existence === 'exists' ? `node --experimental-strip-types --test --test-concurrency=1 ${quotePowerShell(target)}` : null });
  }
  return { mode: 'plan_only', shell: 'PowerShell', execution: 'never_automatic', tests,
    unknown: ['未列出的在制/新增测试未核验，不自动发现或归类。', '真实进程崩溃与部署重启恢复未核验。', '传递依赖后续修改需重审；前端为jsdom行为测试，不替代视觉验收。'],
    exitCode: tests.every(t => t.existence === 'exists') ? 0 : 2 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) { console.error('No arguments supported; plan only.'); process.exitCode = 1; }
  else {
    try { const plan = await buildPlan(); console.log(JSON.stringify(plan, null, 2)); process.exitCode = plan.exitCode; }
    catch { console.error('Plan check failed.'); process.exitCode = 1; }
  }
}
