#!/usr/bin/env node
// SE_REBUILD_20260913 · QA-C 交付物 1：源码-运行副本一致性校验。
// 用途：MAIN 完成白名单同步（site → se-preview-20260913）后运行本脚本，
//       逐文件比对 SHA256，证明「源码仓里改的就是 3467 实例正在跑的」。
// 白名单：app/v5-preview/** 与 lib/v5-preview/** 下的 .ts/.tsx/.css（任务书口径）。
// 其他扩展（如 lib/v5-preview/** 的 .mjs）仅作为附加信息记录，不计入判定（见 extras）。
// 输出：qa/SOURCE_RUNTIME_MAP.json；任一白名单文件缺失/不一致 → exit 1。
// 用法：node source-runtime-check.mjs [--source <dir>] [--preview <dir>] [--out <file>] [--strict-extras]
//   --source  源码仓 site 目录（默认 jianwei-v3/site）
//   --preview 预览副本目录（默认 jianwei-v3/se-preview-20260913）
//   --out     输出 JSON 路径（默认本脚本目录下 SOURCE_RUNTIME_MAP.json）
//   --strict-extras  附加信息区（非白名单扩展）不一致也计 exit 1（默认只提示）
// 本脚本只读源码/副本，只写 --out 指定的 JSON 文件。

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(SCRIPT_DIR, '..', '..', '..', '..'); // qa/ → SE_REBUILD_20260913 → handoff → V6 → Anthropic

const DEFAULT_SOURCE = join(WORKSPACE_ROOT, 'jianwei-v3', 'site');
const DEFAULT_PREVIEW = join(WORKSPACE_ROOT, 'jianwei-v3', 'se-preview-20260913');
const DEFAULT_OUT = join(SCRIPT_DIR, 'SOURCE_RUNTIME_MAP.json');

// 任务书白名单：两个子树 + 扩展名集合。
const WHITELIST_SUBTREES = ['app/v5-preview', 'lib/v5-preview'];
const WHITELIST_EXTS = new Set(['.ts', '.tsx', '.css']);

function parseArgs(argv) {
  const opts = { source: DEFAULT_SOURCE, preview: DEFAULT_PREVIEW, out: DEFAULT_OUT, strictExtras: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') opts.source = argv[++i];
    else if (a === '--preview') opts.preview = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--strict-extras') opts.strictExtras = true;
    else {
      console.error(`未知参数：${a}（支持 --source/--preview/--out/--strict-extras）`);
      process.exit(2);
    }
  }
  return opts;
}

/** 递归列出目录下全部普通文件的相对路径（posix 风格）。目录不存在返回 null。 */
async function listFilesRecursive(rootDir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true, recursive: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = join(e.parentPath ?? e.path, e.name);
    const rel = relative(rootDir, full).split(sep).join('/');
    out.push(rel);
  }
  out.sort();
  return out;
}

async function sha256File(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

function isWhitelist(relPath) {
  const subtree = WHITELIST_SUBTREES.find((s) => relPath === s || relPath.startsWith(`${s}/`));
  if (subtree === undefined) return false;
  const ext = relPath.slice(relPath.lastIndexOf('.'));
  return WHITELIST_EXTS.has(ext);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const sourceFiles = (await listFilesRecursive(opts.source)) ?? [];
  const previewFiles = (await listFilesRecursive(opts.preview)) ?? [];

  // 只关心两个白名单子树内的文件；同时收集子树内其他扩展作为附加信息。
  const relInSubtrees = new Set();
  for (const list of [sourceFiles, previewFiles]) {
    for (const rel of list) {
      if (WHITELIST_SUBTREES.some((s) => rel === s || rel.startsWith(`${s}/`))) relInSubtrees.add(rel);
    }
  }

  const files = [];
  const extras = [];
  let missingInSource = 0;
  let missingInPreview = 0;
  let hashMismatch = 0;
  let extrasMismatch = 0;

  for (const rel of [...relInSubtrees].sort()) {
    const entry = { path: rel, whitelisted: isWhitelist(rel) };
    const srcPath = join(opts.source, rel);
    const prvPath = join(opts.preview, rel);
    let srcHash = null;
    let prvHash = null;
    try {
      srcHash = await sha256File(srcPath);
    } catch {
      srcHash = null;
    }
    try {
      prvHash = await sha256File(prvPath);
    } catch {
      prvHash = null;
    }
    entry.sourceExists = srcHash !== null;
    entry.previewExists = prvHash !== null;
    entry.sourceSha256 = srcHash;
    entry.previewSha256 = prvHash;
    entry.match = entry.sourceExists && entry.previewExists && srcHash === prvHash;

    if (entry.whitelisted) {
      if (!entry.sourceExists) { entry.status = 'MISSING_IN_SOURCE'; missingInSource += 1; }
      else if (!entry.previewExists) { entry.status = 'MISSING_IN_PREVIEW'; missingInPreview += 1; }
      else if (!entry.match) { entry.status = 'HASH_MISMATCH'; hashMismatch += 1; }
      else entry.status = 'MATCH';
      files.push(entry);
    } else {
      entry.status = entry.match ? 'EXTRA_INFO_MATCH' : 'EXTRA_INFO_MISMATCH';
      if (!entry.match) extrasMismatch += 1;
      extras.push(entry);
    }
  }

  const allMatch = files.length > 0 && missingInSource === 0 && missingInPreview === 0 && hashMismatch === 0;
  const report = {
    script: 'source-runtime-check.mjs',
    generatedAt: startedAt,
    purpose: 'SE_REBUILD_20260913 白名单文件 源码仓(site) vs 运行副本(se-preview-20260913) SHA256 对照',
    sourceRoot: opts.source,
    previewRoot: opts.preview,
    whitelist: { subtrees: WHITELIST_SUBTREES, extensions: [...WHITELIST_EXTS] },
    summary: {
      whitelistedFiles: files.length,
      match: files.filter((f) => f.status === 'MATCH').length,
      hashMismatch,
      missingInPreview,
      missingInSource,
      extraInfoFiles: extras.length,
      extraInfoMismatch: extrasMismatch,
      extraInfoNote:
        'extras 为白名单子树内但不在 .ts/.tsx/.css 扩展白名单内的文件（如 lib/v5-preview/**/*.mjs）；默认不计入判定，仅提示 MAIN 确认同步口径（--strict-extras 可改为计入）。',
      allMatch,
    },
    files,
    extras,
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const bad = files.filter((f) => f.status !== 'MATCH');
  for (const f of bad) {
    console.error(`[FAIL] ${f.status}: ${f.path}`);
  }
  if (extrasMismatch > 0) {
    console.error(`[WARN] 白名单外扩展（子树内）不一致 ${extrasMismatch} 个（详见 extras）：`);
    for (const e of extras.filter((x) => !x.match)) console.error(`  - ${e.path}`);
  }
  console.error(
    `白名单文件 ${files.length} 个：一致 ${report.summary.match}，不一致 ${hashMismatch}，副本缺失 ${missingInPreview}，源缺失 ${missingInSource} → ${allMatch ? 'PASS' : 'FAIL'}（已写入 ${opts.out}）`,
  );
  const fail = !allMatch || (opts.strictExtras && extrasMismatch > 0);
  process.exit(fail ? 1 : 0);
}

await main();
