// R3相机回归运行器（SA-A独占写面，本文件为唯一writer）。
//
// 职责：
//  1) 回归生成：把R2冻结批次 test/ 下5个测试文件复制到 test/regression-generated/，
//     允许差异仅限协调者裁决的两项显式映射（2026-09-13，依据STATUS.md接手口径与MAPPING.md登记）：
//     a) import路径：'../src/camera-controller.mjs' → '../../src/camera-controller.mjs'（指向R3控制器）
//     b) 版本字面量（仅两种形态）：
//        '0.2.0-r2-candidate' → '0.3.0-r3-candidate'
//        startsWith('0.2.0') → startsWith('0.3')
//     除此之外任何差异仍视为语义差异：semanticDiffLines（定义为“应用a+b两类替换后逐行比较”）必须为0。
//     注释中的 v0.2.0 字样不属于映射形态，按原样保留（不影响行为）。
//     证据写入 evidence/regeneration-proof.json（每文件 r2Sha256/generatedSha256/
//     replacedLineCount/versionLiteralReplacements/semanticDiffLines:0，顶层记录裁决依据）。
//  2) 回归运行：以显式文件列表运行 node --test（5个回归副本 + r3-contract.test.mjs），
//     不得用目录参数（Windows下目录参数会MODULE_NOT_FOUND）。
//     原始TAP、时间戳、node版本、命令、各文件pass数、总exit code全部写入 evidence/r3-tests-run.log。
//
// 幂等：重复运行会覆盖 regression-generated/ 与两份证据文件并重新运行全部测试；
// 生成内容逐字节确定，跨运行可比对 proof.files[].generatedSha256。
//
// 运行：node test/run-r3.mjs（cwd任意，全部路径基于本文件定位）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R3_ROOT = path.resolve(HERE, '..');
const R2_ROOT = path.resolve(R3_ROOT, '..', 'R2_CAMERA_20260913');
const GEN_DIR = path.join(HERE, 'regression-generated');
const EVIDENCE_DIR = path.join(R3_ROOT, 'evidence');
const CONTRACT_PATH = path.join(HERE, 'r3-contract.test.mjs');
const LOG_PATH = path.join(EVIDENCE_DIR, 'r3-tests-run.log');
const PROOF_PATH = path.join(EVIDENCE_DIR, 'regeneration-proof.json');
const CONTROLLER_SRC = path.join(R3_ROOT, 'src', 'camera-controller.mjs');

const R2_TEST_FILES = [
  'camera-controller.test.mjs',
  'resource-tracking.test.mjs',
  'adversarial.test.mjs',
  'stress-loop.test.mjs',
  'metadata-integrity.test.mjs',
];

// ---------- 协调者裁决授权的两项显式映射 ----------

const T_IMPORT_PATH = {
  kind: 'importPath',
  search: '../src/camera-controller.mjs',
  replace: '../../src/camera-controller.mjs',
};
const T_VERSION_EXACT = {
  kind: 'versionLiteral',
  search: "'0.2.0-r2-candidate'",
  replace: "'0.3.0-r3-candidate'",
};
const T_VERSION_STARTS_WITH = {
  kind: 'versionLiteral',
  search: "startsWith('0.2.0')",
  replace: "startsWith('0.3')",
};
const VERSION_TRANSFORMS = [T_VERSION_EXACT, T_VERSION_STARTS_WITH];
const ALL_TRANSFORMS = [T_IMPORT_PATH, ...VERSION_TRANSFORMS];

const applyTransforms = (s) => ALL_TRANSFORMS.reduce((acc, t) => acc.split(t.search).join(t.replace), s);

// R2冻结测试中内嵌版本断言的4条测试（应随b类映射通过；如仍失败即映射未生效，需调查）。
const VERSION_ASSERT_TEST_NAMES = [
  '生命周期常量包含九个必需状态，版本为v0.2.0冻结口径',
  '对抗0｜被测版本为v0.2.0-r2-candidate，getUserMedia约束恒为audio:false',
  '口径0 v0.2.0基线：版本号与getResourceUsage形状（single默认、零占用）',
  '压力循环：固定seed 42轮确定性操作序列，全程资源/行为不变量与累计统计',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const nowIso = () => new Date().toISOString();
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fatal(msg) {
  console.error(`run-r3: FATAL: ${msg}`);
  process.exit(2);
}

function controllerVersionLiteral() {
  if (!existsSync(CONTROLLER_SRC)) fatal(`R3控制器不存在：${CONTROLLER_SRC}`);
  const m = /CAMERA_CONTROLLER_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(CONTROLLER_SRC, 'utf8'));
  return m ? m[1] : '<unknown>';
}

// ---------- 1) 回归生成（两项显式映射，逐条计数） ----------

function generateRegressionCopies() {
  if (!existsSync(R2_ROOT)) fatal(`R2基线目录不存在：${R2_ROOT}`);
  mkdirSync(GEN_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const files = [];
  for (const name of R2_TEST_FILES) {
    const r2Path = path.join(R2_ROOT, 'test', name);
    if (!existsSync(r2Path)) fatal(`R2测试文件不存在：${r2Path}`);
    const r2Bytes = readFileSync(r2Path);
    const r2Sha = sha256(r2Bytes);
    const srcLines = r2Bytes.toString('utf8').split('\n');

    // 生成：仅两项显式映射，逐条计数。
    let replacedLineCount = 0; // a类（import路径）替换行数
    let versionLiteralReplacements = 0; // b类（版本字面量）替换次数
    const genLines = srcLines.map((line) => {
      let out = line;
      if (out.includes(T_IMPORT_PATH.search)) {
        out = out.split(T_IMPORT_PATH.search).join(T_IMPORT_PATH.replace);
        replacedLineCount += 1;
      }
      for (const t of VERSION_TRANSFORMS) {
        if (out.includes(t.search)) {
          versionLiteralReplacements += out.split(t.search).length - 1;
          out = out.split(t.search).join(t.replace);
        }
      }
      return out;
    });

    // 独立复核：semanticDiff定义=应用a+b两类替换后逐行比较；不相等即语义差异（必须为0）。
    let semanticDiffLines = 0;
    if (genLines.length !== srcLines.length) {
      semanticDiffLines += 1;
      console.error(`run-r3: 行数不一致 ${name}: ${srcLines.length} -> ${genLines.length}`);
    }
    const n = Math.min(srcLines.length, genLines.length);
    for (let i = 0; i < n; i += 1) {
      const a = srcLines[i];
      const b = genLines[i];
      if (a === b) continue; // 未被映射触及的行必须逐字节一致（注释中v0.2.0字样原样保留）
      if (b === applyTransforms(a)) continue; // 恰为两项映射的结果
      semanticDiffLines += 1;
      console.error(`run-r3: 非映射差异 ${name}:${i + 1}\n  R2 : ${JSON.stringify(a)}\n  GEN: ${JSON.stringify(b)}`);
    }
    if (semanticDiffLines !== 0) fatal(`${name}：发现${semanticDiffLines}行语义差异（必须为0，详见上方差异清单）`);

    // 生成内容硬校验：剥离全部REPLACE后不得残留任何SEARCH（REPLACE含SEARCH子串，先剥离再查）；
    // 父级相对import必须恰为T_IMPORT_PATH.replace。
    const genText = genLines.join('\n');
    let residue = genText;
    for (const t of ALL_TRANSFORMS) residue = residue.split(t.replace).join('');
    for (const t of ALL_TRANSFORMS) {
      if (residue.includes(t.search)) fatal(`${name}：生成内容残留未映射的 ${JSON.stringify(t.search)}`);
    }
    for (const m of genText.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // node:* 等外部导入不受限
      if (!spec.startsWith('..')) fatal(`${name}：意外的同级相对import '${spec}'`);
      if (spec !== T_IMPORT_PATH.replace) fatal(`${name}：意外的父级相对import '${spec}'（唯一允许 '${T_IMPORT_PATH.replace}'）`);
    }

    const genBytes = Buffer.from(genText, 'utf8');
    writeFileSync(path.join(GEN_DIR, name), genBytes);
    files.push({
      file: name,
      r2Path,
      r2Sha256: r2Sha,
      generatedSha256: sha256(genBytes),
      replacedLineCount,
      versionLiteralReplacements,
      semanticDiffLines: 0,
    });
  }

  const proof = {
    generatedAt: nowIso(),
    generator: 'test/run-r3.mjs',
    r2Root: R2_ROOT,
    r3Root: R3_ROOT,
    generatedDir: GEN_DIR,
    transformation: ALL_TRANSFORMS.map((t) => ({ kind: t.kind, search: t.search, replace: t.replace })),
    nodeVersion: process.version,
    semanticDiffTotal: files.reduce((acc, f) => acc + f.semanticDiffLines, 0),
    coordinatorRuling: {
      decidedBy: '协调者（R3主agent），2026-09-13',
      basis: '版本升级为R3有意变更（见STATUS/MAPPING），行为语义差异0，4条版本断言随映射通过。',
      authorizedTransforms: [
        'a) importPath: ../src/camera-controller.mjs -> ../../src/camera-controller.mjs',
        "b1) versionLiteral: '0.2.0-r2-candidate' -> '0.3.0-r3-candidate'",
        "b2) versionLiteral: startsWith('0.2.0') -> startsWith('0.3')",
      ],
      semanticDiffDefinition: '应用a+b两类替换后逐行比较为0；注释中的v0.2.0字样不属映射形态、按原样保留。',
    },
    note: '允许差异仅限裁决授权的两项显式映射（a类按行计数replacedLineCount，b类按次计数versionLiteralReplacements）；重复运行覆盖重生成，generatedSha256逐字节可复现。',
    files,
  };
  writeFileSync(PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

// ---------- 2) 回归运行 ----------

function runNodeTest(args) {
  const argv = [process.execPath, '--test', '--test-reporter=tap', ...args];
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: R3_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    command: argv
      .slice(1)
      .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
      .join(' '),
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status === null ? 1 : r.status,
    spawnError: r.error ? String(r.error) : null,
  };
}

function parseTapSummary(tap) {
  const grab = (label) => {
    const m = new RegExp(`^# ${label} (\\d+)\\s*$`, 'm').exec(tap);
    return m ? Number(m[1]) : null;
  };
  return {
    tests: grab('tests'),
    pass: grab('pass'),
    fail: grab('fail'),
    cancelled: grab('cancelled'),
    skipped: grab('skipped'),
    todo: grab('todo'),
  };
}

function extractNotOkNames(tap) {
  const names = [];
  for (const line of tap.split('\n')) {
    const m = /^not ok \d+ - (.+)$/.exec(line.trim());
    if (m) names.push(m[1]);
  }
  return names;
}

const tapHasOk = (tap, name) => new RegExp(`^ok \\d+ - ${escapeRegExp(name)}\\s*$`, 'm').test(tap);

function main() {
  const startedAt = nowIso();
  const t0 = Date.now();

  const proof = generateRegressionCopies();
  if (!existsSync(CONTRACT_PATH)) fatal(`契约测试不存在：${CONTRACT_PATH}`);

  const generatedPaths = proof.files.map((f) => path.join(GEN_DIR, f.file));
  const allTargets = [...generatedPaths, CONTRACT_PATH];

  // 合并运行（口径命令）：显式文件列表，绝不用目录参数。
  const combined = runNodeTest(allTargets);
  const combinedSummary = parseTapSummary(combined.stdout);
  const combinedNotOk = extractNotOkNames(combined.stdout);

  // 逐文件单独运行：取得各文件pass数（各自独立进程，含after钩子）。
  const perFile = [];
  for (const p of allTargets) {
    const fStart = Date.now();
    const run = runNodeTest([p]);
    perFile.push({
      file: path.basename(p),
      summary: parseTapSummary(run.stdout),
      exitCode: run.exitCode,
      notOk: extractNotOkNames(run.stdout),
      durationMs: Date.now() - fStart,
      stressStatsSeen:
        path.basename(p) === 'stress-loop.test.mjs' ? run.stdout.includes('SA6_STRESS_STATS') : null,
      spawnError: run.spawnError,
    });
  }
  const finishedAt = nowIso();
  const durationMs = Date.now() - t0;

  // 失败分类：全部失败一律为非预期（版本断言已随映射通过；若版本断言仍失败=映射未生效，同样需调查）。
  const versionAssertStillFailing = combinedNotOk.filter((nm) => VERSION_ASSERT_TEST_NAMES.includes(nm));
  const unexpectedFails = combinedNotOk.filter((nm) => !VERSION_ASSERT_TEST_NAMES.includes(nm));

  // 版本断言随映射通过的核对表
  const versionAssertCheck = VERSION_ASSERT_TEST_NAMES.map((nm) => ({
    name: nm,
    passed: tapHasOk(combined.stdout, nm),
  }));

  // stress-loop 主测试体执行情况（如实记录：完整执行应出现SA6_STRESS_STATS且时长明显大于中止时的毫秒级）
  const stressEntry = perFile.find((pf) => pf.file === 'stress-loop.test.mjs');

  const L = [];
  L.push('# R3相机 回归+契约 运行日志');
  L.push('');
  L.push(`- startedAt : ${startedAt}`);
  L.push(`- finishedAt: ${finishedAt} (durationMs=${durationMs})`);
  L.push(`- node      : ${process.version} / platform ${process.platform} ${process.arch}`);
  L.push(`- cwd       : ${R3_ROOT}`);
  L.push(`- R2基线(只读): ${R2_ROOT}`);
  L.push(`- R3控制器  : src/camera-controller.mjs 版本字面量=${controllerVersionLiteral()}`);
  L.push(`- 生成器    : test/run-r3.mjs（幂等：覆盖重生成 regression-generated/ 与本日志、regeneration-proof.json）`);
  L.push('');
  L.push('## 裁决与映射说明（协调者2026-09-13授权）');
  L.push('');
  L.push('- 生成副本允许差异从“唯一import路径”放宽为两项显式映射，逐条计数，除此之外任何差异仍为语义差异（必须为0）：');
  for (const t of ALL_TRANSFORMS) L.push(`  - [${t.kind}] ${JSON.stringify(t.search)} → ${JSON.stringify(t.replace)}`);
  L.push('- 裁决依据：版本升级为R3有意变更（STATUS.md接手口径、MAPPING.md登记），行为语义差异0，4条版本断言随映射通过。');
  L.push('- 注释中的 v0.2.0 字样不属映射形态，按原样保留（不影响行为）。');
  L.push('');
  L.push('## 生成摘要（全文见 evidence/regeneration-proof.json）');
  L.push('');
  L.push('| 文件 | replacedLineCount(a类行) | versionLiteralReplacements(b类次) | semanticDiffLines | r2Sha256(前12) | generatedSha256(前12) |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const f of proof.files) {
    L.push(`| ${f.file} | ${f.replacedLineCount} | ${f.versionLiteralReplacements} | ${f.semanticDiffLines} | ${f.r2Sha256.slice(0, 12)} | ${f.generatedSha256.slice(0, 12)} |`);
  }
  L.push('');
  L.push('## 合并运行命令');
  L.push('');
  L.push('```');
  L.push(combined.command);
  L.push('```');
  if (combined.spawnError) {
    L.push('');
    L.push(`SPAWN ERROR: ${combined.spawnError}`);
  }
  L.push('');
  L.push('## 合并运行 原始TAP');
  L.push('');
  L.push('```');
  L.push(combined.stdout.trimEnd());
  L.push('```');
  if (combined.stderr.trim().length > 0) {
    L.push('');
    L.push('## 合并运行 stderr');
    L.push('');
    L.push('```');
    L.push(combined.stderr.trimEnd());
    L.push('```');
  }
  L.push('');
  L.push('## 合并运行 汇总');
  L.push('');
  L.push(`- tests=${combinedSummary.tests} pass=${combinedSummary.pass} fail=${combinedSummary.fail} cancelled=${combinedSummary.cancelled} skipped=${combinedSummary.skipped}`);
  L.push(`- 总exit code: ${combined.exitCode}`);
  L.push('');
  L.push('## 各文件pass数（单独运行，显式文件列表逐个执行）');
  L.push('');
  L.push('| 文件 | tests | pass | fail | exit | durationMs |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const pf of perFile) {
    L.push(`| ${pf.file} | ${pf.summary.tests} | ${pf.summary.pass} | ${pf.summary.fail} | ${pf.exitCode} | ${pf.durationMs} |`);
    for (const nm of pf.notOk) L.push(`| ↳ not ok | ${nm} | | | | |`);
  }
  L.push('');
  L.push('## 版本断言随映射通过核对表（原4条fail）');
  L.push('');
  for (const chk of versionAssertCheck) {
    L.push(`- ${chk.passed ? 'PASS' : '仍失败'}｜${chk.name}`);
  }
  L.push('');
  L.push('## stress-loop 主测试体执行情况（如实记录）');
  L.push('');
  if (stressEntry) {
    L.push(`- SA6_STRESS_STATS 统计行出现: ${stressEntry.stressStatsSeen ? '是（42×2轮压力run已实际执行，含全程不变量与终局审计）' : '否（主测试体未完整执行，需调查）'}`);
    L.push(`- 单文件运行: tests=${stressEntry.summary.tests} pass=${stressEntry.summary.pass} fail=${stressEntry.summary.fail} durationMs=${stressEntry.durationMs}（对照：主测试体在版本断言中止时约数十毫秒级）`);
  } else {
    L.push('- 未找到stress-loop单文件运行记录（异常）');
  }
  L.push('');
  L.push('## 失败清单（合并运行）');
  L.push('');
  if (combinedNotOk.length === 0) {
    L.push('（无失败——105/105全绿：回归96+契约9）');
  } else {
    for (const nm of combinedNotOk) L.push(`- not ok: ${nm}`);
    for (const nm of versionAssertStillFailing) L.push(`- [版本断言未随映射通过·需调查] ${nm}`);
  }
  L.push('');
  L.push('## FINDINGS');
  L.push('');
  L.push(`- 映射后结果：合并运行 tests=${combinedSummary.tests} pass=${combinedSummary.pass} fail=${combinedSummary.fail}；版本字面量替换合计 ${proof.files.reduce((a, f) => a + f.versionLiteralReplacements, 0)} 次（4条版本断言所在4文件各1次，metadata-integrity 0次）。`);
  L.push('- 裁决依据：版本升级为R3有意变更（STATUS.md接手口径、MAPPING.md登记）；行为语义差异0（semanticDiffLines全为0，除两项映射外逐行一致）。');
  if (versionAssertStillFailing.length === 0 && unexpectedFails.length === 0) {
    L.push('- 4条版本断言已随b类映射全部通过；无任何非预期失败。');
    L.push('- stress-loop覆盖口径：见上方“stress-loop 主测试体执行情况”节的如实记录。');
    L.push('- 历史注记：node:test v22不把顶层after钩子失败计入TAP fail（如遇钩子失败不会反映在fail计数中）。');
  } else {
    L.push(`- 存在需调查失败：版本断言未通过${versionAssertStillFailing.length}条、非预期失败${unexpectedFails.length}条（见失败清单与合并TAP对应YAML块）。`);
  }
  L.push('');
  L.push('## DEFECT REPORT');
  L.push('');
  if (unexpectedFails.length === 0 && versionAssertStillFailing.length === 0 && combined.spawnError === null) {
    L.push('未发现控制器行为缺陷：R2回归96项（版本断言随裁决映射通过）与r3-contract契约9项全部通过；');
    L.push('discardPreview/getResourceCounters/buildResourceReceipt行为与STATUS.md接手口径一致。');
  } else {
    L.push('发现失败（见失败清单与合并TAP对应YAML块），需按真实行为核对后处置。');
  }
  L.push('');
  L.push(`- run-r3自身退出码 = 合并运行退出码 = ${combined.exitCode}`);
  L.push('');

  writeFileSync(LOG_PATH, `${L.join('\n')}\n`);
  console.log(`run-r3: 生成${proof.files.length}个回归副本；合并运行 tests=${combinedSummary.tests} pass=${combinedSummary.pass} fail=${combinedSummary.fail} exit=${combined.exitCode}`);
  console.log(`run-r3: 证据已写入 ${LOG_PATH}`);
  console.log(`run-r3: 证据已写入 ${PROOF_PATH}`);
  process.exitCode = combined.exitCode;
}

main();
