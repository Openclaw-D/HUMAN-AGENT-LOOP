// 版本封存 CLI（任务04 S1 / D01）：采集版本封存 + 可选运行服务探针，写 JSON 证据文件。
// 输出不含绝对路径/口令/客户标识；服务探针只记录端口开闭与白名单健康字段。
//   node scripts/version-seal.mjs [--out <path>] [--probe]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(EDGE_ROOT, '..', '..');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};

async function probeServices() {
  const { tcpProbe, httpProbe, aKernelReadyPass } = await import('../src/probes.mjs');
  // 端口清单可用 CLI 覆盖（任务四 D3：--pg-port/--kernel-port/--edge-port/--front-port）；
  // 默认仍为 START.md 登记的 JW 自有形态与旧工作区遗留（分开探测、分开标注）。
  const ports = [
    { name: 'pg-jw', port: Number(arg('pg-port') ?? 15442) },
    { name: 'pg-legacy-15432', port: 15432, legacy: true },
    { name: 'front-preview', port: Number(arg('front-port') ?? 3618) },
    { name: 'kernel-jw', port: Number(arg('kernel-port') ?? 48180), health: true },
    { name: 'kernel-legacy-48080', port: 48080, health: true, legacy: true },
    { name: 'edge-jw', port: Number(arg('edge-port') ?? 48200) },
  ];
  const results = [];
  for (const p of ports) {
    const tcp = await tcpProbe({ name: p.name, port: p.port, timeoutMs: 1200 })();
    const entry = { name: p.name, port: p.port, open: tcp.ok, detail: tcp.detail };
    if (p.legacy) entry.note = 'legacy：旧工作区遗留端口，其健康状态不计入 JW 运行版本';
    if (tcp.ok && p.health) {
      const health = await httpProbe({ name: `${p.name}-health`, url: `http://127.0.0.1:${p.port}/healthz`, pass: aKernelReadyPass, timeoutMs: 2000 })();
      entry.health = { ok: health.ok, detail: health.detail, note: 'A内核 /healthz 的 ok 字段含 liveness 混淆，业务就绪以 db===up 为准' };
      // 区分 JW Edge 与其他服务：Edge 才有 /versionz。
      const vz = await httpProbe({ name: `${p.name}-versionz`, url: `http://127.0.0.1:${p.port}/versionz`, timeoutMs: 2000 })();
      entry.edgeVersionzResponds = vz.ok;
      if (!vz.ok) entry.notEdge = true;
    }
    if (tcp.ok && p.name === 'edge-jw') {
      const live = await httpProbe({ name: 'edge-live', url: `http://127.0.0.1:${p.port}/healthz/live`, timeoutMs: 2000 })();
      entry.health = { ok: live.ok, detail: live.detail };
    }
    results.push(entry);
  }
  return results;
}

async function main() {
  const { collectVersionSeal } = await import('../src/version.mjs');
  // 能力位按当前交付如实标注（任务四 D3 复核）：credit=01 内核 v2 已交付；policy=03 工作本页面已交付；
  // model=真实媒体/模型提供方未授权（D27-R 单列，不阻二维硬门）；video/recording=未接线。
  const capabilities = {
    model: 'not_configured',        // D27-R：真实模型提供方未授权，0 真实调用
    video: 'not_wired',
    recording: 'not_wired',
    policy: 'wired_frontend',       // goal-03 工作本（Edge 同源托管 + A v2 面）
    credit: 'wired_kernel_v2',      // goal-01 内核 v2（客户授信/检查会话/决策闭环/Gate 回执）
    docker: 'unknown_probe_below',
    note: '能力位逐一独立报告；禁止汇总为 all_ok',
  };
  const seal = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities });
  if (process.argv.includes('--probe')) {
    seal.services = await probeServices();
    seal.capabilities.docker = seal.services.some((s) => s.name.startsWith('pg-') && s.open) ? 'available' : 'unreachable';
  }

  const stamp = seal.sealedAt.replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const out = arg('out') || path.join(REPO_ROOT, 'docs', 'customer-next', 'acceptance', 'evidence', `s1-${stamp}`, 'version-seal.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(seal, null, 2) + '\n');

  console.log(`[version-seal] buildId=${seal.buildId}`);
  console.log(`  gitSha=${seal.git.gitSha} dirty=${seal.git.sourceDirty}(${seal.git.dirtyCount ?? '-'})`);
  console.log(`  contract=${seal.contractVersion} migrations=${seal.migrationVersion.count} dist=${seal.dist.frontend ? seal.dist.frontend.files + ' files' : 'none'}`);
  console.log(`  写入: ${path.relative(REPO_ROOT, out)}`);
}

main().catch((e) => {
  console.error(`[version-seal] 失败: ${e.message}`);
  process.exit(2);
});
