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
  // JW 自有形态（A@48180/PG@15442，见 Back/START.md）与旧工作区遗留（48080/15432）分开探测、分开标注。
  const ports = [
    { name: 'pg-jw-15442', port: 15442 },
    { name: 'pg-legacy-15432', port: 15432, legacy: true },
    { name: 'front-3618', port: 3618 },
    { name: 'kernel-jw-48180', port: 48180, health: true },
    { name: 'kernel-legacy-48080', port: 48080, health: true, legacy: true },
    { name: 'edge-48200', port: 48200 },
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
    if (tcp.ok && p.name === 'edge-48200') {
      const live = await httpProbe({ name: 'edge-live', url: 'http://127.0.0.1:48200/healthz/live', timeoutMs: 2000 })();
      entry.health = { ok: live.ok, detail: live.detail };
    }
    results.push(entry);
  }
  return results;
}

async function main() {
  const { collectVersionSeal } = await import('../src/version.mjs');
  const capabilities = {
    model: 'not_configured',        // A 契约：transport 未配置，0 真实调用
    video: 'not_wired',             // 任务02 契约未冻结
    recording: 'not_wired',
    policy: 'not_wired',            // 任务03 契约未冻结
    credit: 'not_wired',            // 任务01 内核未落地
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
