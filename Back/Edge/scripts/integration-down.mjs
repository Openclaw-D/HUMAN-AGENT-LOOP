// 集成轮 2026-09-25 · 受控停止（与 integration-up 配对）。
// 顺序：Edge → Connectors → A 内核（消费方先下线）；全部多证复核（pidfile + heartbeat 新鲜 +
// 端口内容标识 + 命令行 marker），任一不符拒绝 kill（exit 5），绝不按 PID 盲杀。
// 不删数据：PG 数据卷、对象存储、消息库原样保留；--with-db 才停止自有容器（jw-integ- 前缀）。
// 用法：node scripts/integration-down.mjs [--with-db]
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  RUN_DIR, fail, loadParams, stopService, stopEdge, stopDbContainer,
} from './integration-lib.mjs';

const argv = process.argv.slice(2);
const withDb = argv.includes('--with-db');
const params = loadParams();
if (!params) fail('params.json 不存在：没有本集成轮的运行记录（无需停止）');

let failed = false;
try {
  await stopEdge({ runDir: RUN_DIR });
} catch (e) { console.error(`[integration-down] ✗ Edge 停止异常: ${e.message}`); failed = true; }

try {
  await stopService({
    name: 'Connectors', pidFile: path.join(RUN_DIR, 'connectors.pid'),
    healthUrl: `http://127.0.0.1:${params.connectorsPort}/healthz`,
    healthPass: (j) => j?.ok === true && j?.service === 'jw-connectors', contentNote: 'service=jw-connectors',
  });
} catch (e) { console.error(`[integration-down] ✗ 拒绝停止：${e.message}（请人工核实归属）`); failed = true; }

try {
  await stopService({
    name: 'A内核', pidFile: path.join(RUN_DIR, 'kernel.pid'),
    healthUrl: `http://127.0.0.1:${params.kernelPort}/healthz`,
    healthPass: (j) => j?.db === 'up' || j?.ok === true, contentNote: '/healthz 业务内核标识',
  });
} catch (e) { console.error(`[integration-down] ✗ 拒绝停止：${e.message}（请人工核实归属）`); failed = true; }

if (withDb) {
  if (!params.dbContainer.startsWith('jw-integ-')) fail(`拒绝停止非自有容器 ${params.dbContainer}`);
  await stopDbContainer({ container: params.dbContainer });
}

console.log('[integration-down] 完成：数据卷/对象存储/消息库原样保留（重启后结果可复现）。');
process.exit(failed ? 5 : 0);
