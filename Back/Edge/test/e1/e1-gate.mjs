// E1 冻结门（任务04 S2）：判定任务01 契约是否已发布且实现固定。
// 判据（全部满足才放行 E1 用例，否则用例如实 skip 并给出原因）：
//   1) Back/CONTRACT.md 头部版本 ≥ v2（v2 契约已汇入共享契约）；
//   2) docs/customer-next/S1_API_V2_SCHEMA_PROPOSAL.md 状态行不再含"待总控冻结"；
//   3) `git status --porcelain Back/A` 为空（实现固定：server.ts/credit.ts 等停止变更）；
//   4) docker 可达（真实 PG 变体需要自有隔离容器）。
// 门只读、无副作用；每次运行实时探测，不缓存历史结论。
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');

function run(cmd, args, cwd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function portOpen(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { try { s.destroy(); } catch { } resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function checkFreezeGate() {
  const reasons = [];

  // 1) 共享契约含 v2：头部版本 ≥ v2，或已按"增量登记"形式发布（§8 v2 增量契约登记，
  //    实际发布形式：头部保持 v1.3 基线 + §8 登记 v2 增量与指针，2026-09-17 起）
  let contractVersion = null;
  let contractBody = '';
  try {
    const text = readFileSync(path.join(BACK_ROOT, 'CONTRACT.md'), 'utf8');
    contractBody = text;
    const firstLine = text.split(/\r?\n/)[0] || '';
    const m = firstLine.match(/v(\d+)\.(\d+)/);
    if (m) contractVersion = `v${m[1]}.${m[2]}`;
    const hasV2Section = /##\s*8｜v2 增量契约登记/.test(text);
    if (!m || (Number(m[1]) < 2 && !hasV2Section)) {
      reasons.push(`CONTRACT.md 无 v2 契约（头部 ${contractVersion || '未知'}，无 §8 v2 增量登记）`);
    }
  } catch (e) {
    reasons.push(`CONTRACT.md 不可读: ${e.message}`);
  }

  // 2) 提案状态行变更，或 §8 登记存在（登记即发布，提案文档状态行不再是独立阻塞）
  try {
    const head = readFileSync(path.join(REPO_ROOT, 'docs', 'customer-next', 'S1_API_V2_SCHEMA_PROPOSAL.md'), 'utf8').slice(0, 2000);
    const registered = /##\s*8｜v2 增量契约登记/.test(contractBody);
    if (head.includes('待总控冻结') && !registered) {
      reasons.push('S1_API_V2_SCHEMA_PROPOSAL.md 仍自标"待总控冻结"且 CONTRACT 无 v2 登记');
    }
  } catch {
    if (!/##\s*8｜v2 增量契约登记/.test(contractBody)) reasons.push('S1_API_V2_SCHEMA_PROPOSAL.md 不存在');
  }

  // 3) 实现固定（Back/A 无未提交变更）
  const st = await run('git', ['status', '--porcelain', 'Back/A'], REPO_ROOT);
  if (st.err) reasons.push(`git status 失败: ${st.stderr.slice(0, 120)}`);
  else if (st.stdout.trim().length > 0) reasons.push(`Back/A 实现在制品（${st.stdout.trim().split('\n').length} 个未提交文件）`);

  // 4) docker 可达
  const docker = await run('docker', ['ps'], REPO_ROOT, 15000);
  if (docker.err) reasons.push('docker 不可达（真实 PG 变体需要）');

  // 附加：旧遗留实例探测（只在证据中使用，不阻断）
  const legacy = await portOpen('127.0.0.1', 15432);

  return { frozen: reasons.length === 0, reasons, contractVersion, legacyPg15432Open: legacy };
}
