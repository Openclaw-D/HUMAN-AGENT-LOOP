// 版本封存（任务04 S1 / D01）：Git SHA、dirty 状态、非敏感源指纹、dist 指纹、
// contractVersion、migrationVersion、rulesetVersion、运行时与能力快照。
// 输出禁止包含绝对路径/密钥/口令/客户标识；seal() 出口自检一次。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sha256Buf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function run(cmd, args, cwd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// 排除依赖/运行态/证据/数据库目录；不排除 dist（dist 指纹单独采集，也参与源聚合时须显式传入）。
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.run', '.vite', '.tmp', '.data', '.assembly', '.b-final',
  'runtime', 'pgdata', 'checkpoints', 'receipts', 'registry', 'evidence', 'browser-harness-data',
]);

// 目录聚合指纹：按相对路径排序后对 `rel\0sha256\0` 流做 sha256。
export function digestTree(root, relDir) {
  const abs = path.join(root, relDir);
  if (!existsSync(abs)) return null;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (!EXCLUDE_DIRS.has(name)) walk(p);
        continue;
      }
      if (!st.isFile()) continue;
      let buf;
      try { buf = readFileSync(p); } catch { continue; }
      files.push({ rel: path.relative(root, p).split(path.sep).join('/'), sha: sha256Buf(buf) });
    }
  };
  walk(abs);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash('sha256');
  for (const f of files) h.update(`${f.rel}\0${f.sha}\0`);
  return { files: files.length, sha256: h.digest('hex') };
}

function digestFile(filePath) {
  if (!existsSync(filePath)) return null;
  return { sha256: sha256Buf(readFileSync(filePath)), bytes: statSync(filePath).size };
}

async function gitInfo(repoRoot) {
  const head = await run('git', ['rev-parse', 'HEAD'], repoRoot);
  const status = await run('git', ['status', '--porcelain'], repoRoot);
  if (head.err) return { available: false, reason: 'git rev-parse failed' };
  const lines = status.stdout.split(/\r?\n/).filter(Boolean);
  const dirtyPaths = lines.map((l) => l.slice(3).trim()).slice(0, 50);
  return {
    available: true,
    gitSha: head.stdout.trim(),
    dirty: lines.length > 0,
    dirtyCount: lines.length,
    dirtyPaths,
  };
}

function contractInfo(repoRoot) {
  const p = path.join(repoRoot, 'Back', 'CONTRACT.md');
  const d = digestFile(p);
  if (!d) return { contractVersion: null, contractDigest: null };
  const firstLine = readFileSync(p, 'utf8').split(/\r?\n/)[0] || '';
  const m = firstLine.match(/v\d+\.\d+/);
  return { contractVersion: m ? m[0] : null, contractDigest: d.sha256 };
}

function migrationInfo(repoRoot) {
  const dir = path.join(repoRoot, 'Back', 'A', 'migrations');
  if (!existsSync(dir)) return { count: 0, sha256: null };
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const h = createHash('sha256');
  for (const f of files) h.update(`${f}\0${sha256Buf(readFileSync(path.join(dir, f)))}\0`);
  return { count: files.length, sha256: h.digest('hex'), latest: files[files.length - 1] || null };
}

// 任务三 C1：本轮交付版本清单的补充面（消费面契约、规则包、四域工具、依赖锁）。
// 只输出非敏感摘要（版本号/计数/哈希）；出口自检继续拦截路径与凭据样式字段。
function consumedSurfaceInfo(repoRoot) {
  const p = path.join(repoRoot, 'Back', 'Edge', 'contract', 'consumed-surface-v1.json');
  const d = digestFile(p);
  if (!d) return { present: false };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return {
      present: true,
      schemaVersion: parsed.schemaVersion || null,
      publishedAt: parsed.publishedAt || null,
      digest: d.sha256,
      reads: Array.isArray(parsed.upstreamKernel?.consumedReads) ? parsed.upstreamKernel.consumedReads.length : 0,
      writes: Array.isArray(parsed.upstreamKernel?.consumedWrites) ? parsed.upstreamKernel.consumedWrites.length : 0,
    };
  } catch {
    return { present: false, reason: 'consumed-surface 文件不可解析' };
  }
}

function rulePackInfo(repoRoot) {
  const p = path.join(repoRoot, 'Back', 'C', 'rules', 'four-domain-rule-pack-v1.json');
  const d = digestFile(p);
  if (!d) return { present: false };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return {
      present: true,
      rulesetId: parsed.rulesetId || parsed.id || null,
      version: parsed.version || parsed.rulesetVersion || null,
      boundary: parsed.boundary || null,
      rules: Array.isArray(parsed.rules) ? parsed.rules.length : null,
      digest: d.sha256,
    };
  } catch {
    return { present: false, reason: '规则包文件不可解析' };
  }
}

function fourDomainToolsInfo(repoRoot) {
  const p = path.join(repoRoot, 'Back', 'B', 'src', 'domains', 'four-domain-tools.mjs');
  if (!existsSync(p)) return { present: false };
  const m = readFileSync(p, 'utf8').match(/FOUR_DOMAIN_TOOL_VERSION\s*=\s*'([^']+)'/);
  return { present: true, toolVersion: m ? m[1] : null, digest: sha256Buf(readFileSync(p)) };
}

function lockfileInfo(repoRoot) {
  const items = [];
  for (const rel of ['Back/A/package-lock.json', 'Back/B/package-lock.json', 'Front/package-lock.json']) {
    const d = digestFile(path.join(repoRoot, rel));
    if (d) items.push({ path: rel, sha256: d.sha256 });
  }
  return { files: items, zeroDepLanes: ['Back/C', 'Back/Edge', 'Back/D'] };
}

// 组装版本封存。capabilities 由调用方传入（探针结果），此处只做承载与出口自检。
export async function collectVersionSeal({ repoRoot, capabilities = {} }) {
  const git = await gitInfo(repoRoot);
  const contract = contractInfo(repoRoot);
  const migration = migrationInfo(repoRoot);
  const backSrc = digestTree(repoRoot, 'Back');
  // 前端源码位于 Front/preview（React/Vite）；Front/dist 是用户明确要求随仓库交付的构建产物。
  const frontSrc = digestTree(path.join(repoRoot, 'Front'), 'preview');
  const dist = digestTree(path.join(repoRoot, 'Front'), 'dist');
  const ruleset = digestTree(repoRoot, 'Back/C/rules');
  const consumed = consumedSurfaceInfo(repoRoot);
  const rulePack = rulePackInfo(repoRoot);
  const fdTools = fourDomainToolsInfo(repoRoot);
  const lockfiles = lockfileInfo(repoRoot);

  const h = createHash('sha256');
  h.update(`${git.gitSha || 'nogit'}\0`);
  h.update(`${backSrc ? backSrc.sha256 : 'none'}\0`);
  h.update(`${frontSrc ? frontSrc.sha256 : 'none'}\0`);
  h.update(`${dist ? dist.sha256 : 'none'}\0`);
  h.update(`${contract.contractVersion || 'nocontract'}\0`);
  h.update(`${migration.sha256 || 'nomigration'}\0`);
  h.update(`${consumed.digest || 'noconsumed'}\0`);
  h.update(`${rulePack.digest || 'norulepack'}\0`);
  const buildId = h.digest('hex').slice(0, 16);

  const seal = {
    schemaVersion: 'jw.version-seal.v1',
    sealedAt: new Date().toISOString(),
    buildId,
    git: git.available
      ? { gitSha: git.gitSha, sourceDirty: git.dirty, dirtyCount: git.dirtyCount, dirtyPaths: git.dirtyPaths }
      : { gitSha: null, sourceDirty: null, reason: git.reason },
    sourceDigest: {
      back: backSrc,
      frontSrc,
    },
    dist: { frontend: dist },
    contractVersion: contract.contractVersion,
    contractDigest: contract.contractDigest,
    migrationVersion: migration,
    rulesetVersion: ruleset,
    delivery: {
      // 任务三 C1：真正运行的是什么——消费面契约/规则包/四域工具/依赖锁的版本摘要。
      consumedSurface: consumed,
      rulePack,
      fourDomainTools: fdTools,
      lockfiles,
      scene: { threeD: 'absent', note: '本仓 Front 无 Unity/三维场区构建；交付形态为二维页面（任务书前提与实现不符，如实记录）' },
      unityBuild: null,
    },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    capabilities,
  };
  sanitizeSeal(seal, { repoRoot });
  return seal;
}

// 出口自检：绝不携带绝对路径/凭据样式的值。命中即抛错（fail-closed），不允许降级输出。
function sanitizeSeal(seal, { repoRoot }) {
  const bad = [repoRoot, os.homedir()].filter(Boolean).map((s) => String(s));
  const needle = JSON.stringify(seal);
  for (const b of bad) {
    if (b.length > 3 && needle.toLowerCase().includes(b.toLowerCase())) {
      throw new Error('version seal 泄漏本地路径，已阻断输出');
    }
  }
  for (const key of ['password', 'credential', 'secret', 'token=']) {
    if (needle.toLowerCase().includes(key)) {
      throw new Error(`version seal 疑似包含敏感字段 ${key}，已阻断输出`);
    }
  }
  return seal;
}
