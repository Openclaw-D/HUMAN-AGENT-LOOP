// 任务三 E1 冻结门：判定本轮消费面（consumed-surface-v1） prerequisites 是否齐备。
// 与旧 e1-gate.mjs（等待共享契约升版）并存、互不替代——旧门继续如实记录其 BLOCKED 原因；
// 本门判定的是任务三自己的接线前提：消费面快照可解析 + docker 可达 + 必需迁移与 A 源在位。
// 上游漂移不由本门判定，而由 E1 用例运行时逐断言暴露（如实 FAIL 并指认漂移点）。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');

export const REQUIRED_MIGRATIONS = ['001_init.sql', '002_customer_credit.sql', '003_inspection_sessions.sql'];

function run(cmd, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: REPO_ROOT, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export async function checkTask3Gate() {
  const reasons = [];

  const surfacePath = path.join(EDGE_ROOT, 'contract', 'consumed-surface-v1.json');
  try {
    const parsed = JSON.parse(readFileSync(surfacePath, 'utf8'));
    if (parsed.schemaVersion !== 'jw.edge.consumed-surface.v1') reasons.push('consumed-surface schemaVersion 不符');
  } catch (e) {
    reasons.push(`consumed-surface 不可解析: ${e.message}`);
  }

  for (const m of REQUIRED_MIGRATIONS) {
    if (!existsSync(path.join(BACK_ROOT, 'A', 'migrations', m))) reasons.push(`必需迁移缺失: ${m}`);
  }
  for (const f of ['src/domain/credit.ts', 'src/domain/inspection.ts', 'src/http/server.ts']) {
    if (!existsSync(path.join(BACK_ROOT, 'A', f))) reasons.push(`A 源缺失: ${f}`);
  }

  const docker = await run('docker', ['ps']);
  if (docker.err) reasons.push('docker 不可达（隔离 PG 需要）');

  return { ok: reasons.length === 0, reasons };
}
