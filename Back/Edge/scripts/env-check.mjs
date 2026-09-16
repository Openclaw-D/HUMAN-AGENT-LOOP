// 任务三 C1：环境检查入口（只读；绝不杀进程/抢端口/删数据）。
// 用途：C01"干净获准环境启动固定交付包"的静态预检 + 演示前快速体检。
// 判定：PASS=就绪 / FREE=端口空闲可用 / BUSY=被占（需人工核实归属，本脚本不动它）/
//       WARN=缺失但非本轮阻塞（如 docker 不可达只挡 E1 变体）/ FAIL=交付包自身缺失。
// 退出码：0=无 FAIL；2=存在 FAIL（交付包不完整）。--json 输出机器可读结果供证据留档。
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');

function run(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: REPO_ROOT, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function portState(host, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (open, detail) => { try { s.destroy(); } catch { } resolve({ open, detail }); };
    s.setTimeout(timeoutMs, () => done(false, 'timeout'));
    s.once('connect', () => done(true, 'tcp open'));
    s.once('error', (e) => done(false, String(e.code || e.message)));
  });
}

async function main() {
  const json = process.argv.includes('--json');
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  // 1) Node 版本（Front engines >=22.13；Back/START 口径 22.23.1+ 的 22.x）
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('node-version', nodeMajor === 22 ? 'PASS' : 'WARN', { actual: process.version, note: '交付口径：22.x（Front engines >=22.13）' });

  // 2) Git 输入版本（只记录，不作要求）
  const head = await run('git', ['rev-parse', 'HEAD']);
  const st = await run('git', ['status', '--porcelain']);
  const dirtyCount = st.stdout.split(/\r?\n/).filter(Boolean).length;
  add('git-input-version', head.err ? 'WARN' : 'PASS', {
    head: head.err ? null : head.stdout.trim(), dirtyFiles: dirtyCount,
    note: '本轮各任务交付为未提交工作区变更；封存以 dirty 指纹如实记录（提交需用户授权）',
  });

  // 3) Docker（E1 真实变体需要；缺失不挡静态交付，判 WARN）
  //    就绪判据用 docker ps（Edge STATUS 记录：docker info 在引擎半启动时可能误报可用）。
  const docker = await run('docker', ['ps'], 20000);
  add('docker', docker.err ? 'WARN' : 'PASS', docker.err
    ? { note: 'docker 不可达：仅 E1 真实变体测试受阻，静态交付与 E0 不受影响' }
    : { runningContainers: docker.stdout.split(/\r?\n/).slice(1).filter(Boolean).length });

  // 3b) 本项目相关容器（只查存在与状态，绝不 start/stop/rm）
  if (!docker.err) {
    const psa = await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}']);
    const jw = psa.stdout.split(/\r?\n/).filter(Boolean).filter((l) => /jw-|v7next/.test(l));
    add('jw-containers', 'PASS', { found: jw, note: '只读列出；启动/停止走各自脚本的启动标识复核' });
  }

  // 4) 端口（BUSY 只报告；归属判断交给人工或各启动脚本的标识复核）
  const ports = [
    { port: 15442, expect: 'jw-v01-pg (Back/START 形态)' },
    { port: 15444, expect: 'jw-cc-kernel-pg (任务一隔离库)' },
    { port: 15434, expect: 'E1 测试段（期望空闲）' },
    { port: 17919, expect: 'E1 测试段 A 内核（期望空闲）' },
    { port: 48180, expect: 'A 内核（JW 形态默认）' },
    { port: 48200, expect: 'Edge（任务三交付入口）' },
    { port: 48100, expect: 'Connectors（任务02）' },
    { port: 3730, expect: 'C mock' },
    { port: 3617, expect: 'Front dev' },
    { port: 3618, expect: 'Front preview（Start-JW.cmd）' },
  ];
  for (const { port, expect } of ports) {
    const { open } = await portState('127.0.0.1', port);
    add(`port-${port}`, open ? 'BUSY' : 'FREE', { expect, note: open ? '被占用：不强杀；确认归属后再决定复用或换端口' : '空闲' });
  }

  // 5) 交付包自身完整性（FAIL 级）
  const migDir = path.join(REPO_ROOT, 'Back', 'A', 'migrations');
  const migs = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort() : [];
  add('migrations', migs.length >= 2 && migs.includes('002_customer_credit.sql') ? 'PASS' : 'FAIL', { files: migs });

  const consumedPath = path.join(EDGE_ROOT, 'contract', 'consumed-surface-v1.json');
  let consumedOk = false;
  try { JSON.parse(readFileSync(consumedPath, 'utf8')); consumedOk = true; } catch { }
  add('consumed-surface', consumedOk ? 'PASS' : 'FAIL', { path: 'Back/Edge/contract/consumed-surface-v1.json' });

  const distDir = path.join(REPO_ROOT, 'Front', 'dist');
  const distOk = existsSync(path.join(distDir, 'index.html'));
  add('front-dist', distOk ? 'PASS' : 'FAIL', { note: distOk ? 'dist 随仓库交付（改动源码后须 npm run build 更新）' : '缺失' });

  const lockfiles = ['Back/A/package-lock.json', 'Front/package-lock.json'].filter((f) => existsSync(path.join(REPO_ROOT, f)));
  add('lockfiles', lockfiles.length >= 1 ? 'PASS' : 'WARN', { found: lockfiles, note: 'Back/C、Back/Edge、Back/D 为零运行时依赖' });

  const rulePack = path.join(REPO_ROOT, 'Back', 'C', 'rules', 'four-domain-rule-pack-v1.json');
  add('rule-pack', existsSync(rulePack) ? 'PASS' : 'FAIL', { path: 'Back/C/rules/four-domain-rule-pack-v1.json' });

  // 6) 受限能力（BLOCKED 级：如实列出，不冒充可用）
  add('capability-video', 'BLOCKED', { note: '企微/TRTC 真实提供方未获授权（Connectors CAPABILITY_MATRIX）' });
  add('capability-model', 'BLOCKED', { note: '真实模型未授权/未配置；GLM transport 预留 0 调用' });
  add('capability-real-disbursement', 'BLOCKED', { note: '仅受控模拟回执（simulation_only）' });

  const fail = checks.filter((c) => c.status === 'FAIL');
  const summary = {
    checkedAt: new Date().toISOString(),
    counts: {
      pass: checks.filter((c) => c.status === 'PASS').length,
      free: checks.filter((c) => c.status === 'FREE').length,
      busy: checks.filter((c) => c.status === 'BUSY').length,
      warn: checks.filter((c) => c.status === 'WARN').length,
      blocked: checks.filter((c) => c.status === 'BLOCKED').length,
      fail: fail.length,
    },
    checks,
    exitCode: fail.length > 0 ? 2 : 0,
  };
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[env-check] ${summary.checkedAt}`);
    for (const c of checks) console.log(`  ${c.status.padEnd(7)} ${c.name}  ${JSON.stringify(c.detail)}`);
    console.log(`[env-check] 汇总 ${JSON.stringify(summary.counts)} → exit ${summary.exitCode}`);
    if (summary.counts.busy > 0) console.log('[env-check] BUSY 端口不会被本脚本处理；归属核实后由对应启动/停止脚本按启动标识操作。');
  }
  process.exit(summary.exitCode);
}

main().catch((e) => {
  console.error(`[env-check] 执行失败: ${e.message}`);
  process.exit(2);
});
