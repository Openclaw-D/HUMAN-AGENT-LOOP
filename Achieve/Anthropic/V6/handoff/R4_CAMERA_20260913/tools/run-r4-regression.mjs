#!/usr/bin/env node
// R4相机回归runtime化Runner（SA-A独占写面：本文件为唯一writer）。
//
// 背景：R3的 test/run-r3.mjs 每次运行会把日志写进R3自己的 evidence/r3-tests-run.log；
// 该批次已冻结（READY_FOR_REVIEW），重复运行会污染冻结证据（hash漂移）。
// R4共同契约：测试可变输出统一runtime；不重写历史冻结记录。
//
// 职责：
//  1) 只读复用R3冻结批次测试：以显式文件列表 spawnSync(process.execPath, ['--test', ...], {cwd: R3根目录})
//     运行 r3-contract.test.mjs + regression-generated/五文件（共6个测试文件，run-r3.mjs除外）。
//     不复制、不修改、不运行R3任何文件；特别是不运行 test/run-r3.mjs（避免其覆盖冻结证据）。
//     口径与R3冻结记录一致：合并运行取总tests/pass/fail与exit code；每文件单独运行取各文件计数。
//  2) 输出全部写本批次 runtime/regression/：
//     - tap-output.log           原始TAP合并输出（含真实时长，允许漂移）
//     - summary.json             每文件pass/fail计数、总pass/fail/exit code；时间戳只放 meta.startedAt 等孤立meta字段
//     - summary.normalized.json  同summary但剥离一切时间戳/时长字段，保证重跑byte-identical（hash不漂移）
//       归一化规则：对TAP文本，把 duration_ms 行整行剔除、# Subtest: 保留；meta.startedAt 不进归一化文件。
//  3) 冻结零污染证明：每次运行前计算 R3 evidence/ 目录全部文件sha256，运行后再算，前后一致才输出
//     "PASS: frozen evidence untouched"；首跑把前/后hash表+结论固化到 evidence/regression-frozen-proof.json
//     （一次性证明文件，写后不再改；后续运行只与该文件核对，不一致即FAIL退出，不重写）。
//  4) 稳定性断言：runner每次运行内部连续执行两轮完整套件，分别计算归一化内容的sha256，
//     断言两轮一致；把两次hash写进 summary.normalized.json 顶层 r4StableHash 字段（两次值相同）。
//
// 与R3冻结TAP的预期差异：node 22默认按完成序并发输出TAP（R3冻结TAP顺序不可复现）；
// 本runner固定 --test-concurrency=1，TAP按命令序输出，计数口径不变（105/105/exit 0）。
//
// 运行：node tools/run-r4-regression.mjs（cwd任意，全部路径基于本文件定位）。
// 无新依赖、无Git、无浏览器、不派生subagent。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R4_ROOT = path.resolve(HERE, '..');
const HANDOFF_ROOT = path.resolve(R4_ROOT, '..');
const R3_ROOT = path.join(HANDOFF_ROOT, 'R3_CAMERA_20260913');
const R3_EVIDENCE_DIR = path.join(R3_ROOT, 'evidence');
const R3_TEST_DIR = path.join(R3_ROOT, 'test');
const R3_GEN_DIR = path.join(R3_TEST_DIR, 'regression-generated');
const R3_CONTROLLER = path.join(R3_ROOT, 'src', 'camera-controller.mjs');
const RUNTIME_DIR = path.join(R4_ROOT, 'runtime', 'regression');
const TAP_LOG_PATH = path.join(RUNTIME_DIR, 'tap-output.log');
const SUMMARY_PATH = path.join(RUNTIME_DIR, 'summary.json');
const NORMALIZED_PATH = path.join(RUNTIME_DIR, 'summary.normalized.json');
const PROOF_PATH = path.join(R4_ROOT, 'evidence', 'regression-frozen-proof.json');

// 预期清单（顺序=R3冻结合并命令顺序：5个回归副本在前、r3-contract收尾）
const GEN_FILES = [
  'camera-controller.test.mjs',
  'resource-tracking.test.mjs',
  'adversarial.test.mjs',
  'stress-loop.test.mjs',
  'metadata-integrity.test.mjs',
];
const CONTRACT_FILE = 'r3-contract.test.mjs';
const EXPECTED_ROSTER = [
  ...GEN_FILES.map((n) => `test/regression-generated/${n}`),
  `test/${CONTRACT_FILE}`,
];
// R3冻结记录 evidence/r3-tests-run.log「各文件pass数」表（单独运行口径）
const FROZEN_PER_FILE_TESTS = {
  'camera-controller.test.mjs': 41,
  'resource-tracking.test.mjs': 21,
  'adversarial.test.mjs': 26,
  'stress-loop.test.mjs': 2,
  'metadata-integrity.test.mjs': 6,
  'r3-contract.test.mjs': 9,
};
// R3冻结记录「合并运行 汇总」：tests=105 pass=105 fail=0，总exit code 0
const EXPECTED = { tests: 105, pass: 105, fail: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, exitCode: 0 };
const ROUNDS = 2;
const TEST_CONCURRENCY = '1'; // 固定串行：TAP顺序确定（node 22默认并发按完成序输出，顺序不可复现）
const SPAWN_TIMEOUT_MS = 300000;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const nowIso = () => new Date().toISOString();
const log = (msg) => console.log(`run-r4-regression: ${msg}`);

function fatal(msg) {
  console.error(`run-r4-regression: FATAL: ${msg}`);
  process.exit(2);
}

// ---------- 只读探查R3被测对象与测试清单 ----------

function controllerVersionLiteral() {
  if (!existsSync(R3_CONTROLLER)) fatal(`R3控制器不存在：${R3_CONTROLLER}`);
  const m = /CAMERA_CONTROLLER_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(R3_CONTROLLER, 'utf8'));
  return m ? m[1] : '<unknown>';
}

function discoverRoster() {
  const listTests = (dir, prefix) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((n) => n.endsWith('.test.mjs'))
          .sort()
          .map((n) => `${prefix}${n}`)
      : [];
  const discovered = new Set([...listTests(R3_GEN_DIR, 'test/regression-generated/'), ...listTests(R3_TEST_DIR, 'test/')]);
  const missing = EXPECTED_ROSTER.filter((f) => !discovered.has(f));
  const extras = [...discovered].filter((f) => !EXPECTED_ROSTER.includes(f)).sort();
  const roster = [...EXPECTED_ROSTER.filter((f) => discovered.has(f)), ...extras];
  return { roster, missing, extras, rosterMatchesExpected: missing.length === 0 && extras.length === 0 };
}

// ---------- 冻结证据hash（只读遍历R3 evidence/） ----------

function hashTree(dir) {
  const out = {};
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else if (e.isFile()) out[rel] = sha256(readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, '');
  return out;
}
const rootHashOf = (map) =>
  sha256(
    Buffer.from(
      Object.keys(map)
        .sort()
        .map((k) => `${k}  ${map[k]}\n`)
        .join(''),
      'utf8',
    ),
  );
const mapsEqual = (a, b) => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

// ---------- node --test 运行（cwd=R3根目录，显式文件列表，不改R3任何文件） ----------

function runNodeTest(relFiles) {
  const abs = relFiles.map((f) => path.join(R3_ROOT, f));
  const args = ['--test', `--test-reporter=tap`, `--test-concurrency=${TEST_CONCURRENCY}`, ...abs];
  const r = spawnSync(process.execPath, args, {
    cwd: R3_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: SPAWN_TIMEOUT_MS,
    windowsHide: true,
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status === null ? 1 : r.status,
    spawnError:
      r.error ? `${r.error.name}: ${r.error.message}` : r.signal ? `killed by signal ${r.signal}` : null,
  };
}

// 与 run-r3.mjs 相同口径的TAP汇总解析
function parseTapSummary(tap) {
  const grab = (label) => {
    const m = new RegExp(`^# ${label} (\\d+)\\s*$`, 'm').exec(tap);
    return m ? Number(m[1]) : null;
  };
  const grabFloat = (label) => {
    const m = new RegExp(`^# ${label} ([0-9.]+)\\s*$`, 'm').exec(tap);
    return m ? Number(m[1]) : null;
  };
  return {
    tests: grab('tests'),
    suites: grab('suites'),
    pass: grab('pass'),
    fail: grab('fail'),
    cancelled: grab('cancelled'),
    skipped: grab('skipped'),
    todo: grab('todo'),
    durationMs: grabFloat('duration_ms'),
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

// 归一化规则：剔除一切 duration_ms 行（YAML块 "duration_ms: x" 与汇总 "# duration_ms x"），保留 # Subtest: 等全部其余行
function normalizeTap(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*(?:#\s*)?duration_ms\b/.test(line))
    .join('\n');
}

// ---------- 执行一轮完整套件：合并运行（总口径）+ 每文件单独运行（各文件计数） ----------

function runRound(n, roster) {
  const t0 = Date.now();
  const combined = runNodeTest(roster);
  const combinedSummary = parseTapSummary(combined.stdout);
  const combinedNotOk = extractNotOkNames(combined.stdout);

  const perFile = [];
  for (const rel of roster) {
    const run = runNodeTest([rel]);
    const s = parseTapSummary(run.stdout);
    perFile.push({
      file: rel,
      basename: path.basename(rel),
      tests: s.tests,
      suites: s.suites,
      pass: s.pass,
      fail: s.fail,
      cancelled: s.cancelled,
      skipped: s.skipped,
      todo: s.todo,
      exitCode: run.exitCode,
      notOk: extractNotOkNames(run.stdout),
      spawnError: run.spawnError,
    });
  }
  return {
    combined,
    combinedSummary,
    combinedNotOk,
    perFile,
    runnerMs: Date.now() - t0,
    tapNormalized: normalizeTap(combined.stdout),
  };
}

// ---------- 组装归一化核心（不含任何时间戳/时长；summary与normalized共用） ----------

function buildCore(opts) {
  const { roster, rosterMatchesExpected, version, frozenEvidence, rounds, warnings } = opts;
  const last = rounds[rounds.length - 1];
  const perFileMatches = last.perFile.every((pf) => FROZEN_PER_FILE_TESTS[pf.basename] === pf.tests);
  const matchesFrozen =
    last.combinedSummary.tests === EXPECTED.tests &&
    last.combinedSummary.pass === EXPECTED.pass &&
    last.combinedSummary.fail === EXPECTED.fail &&
    last.combined.exitCode === EXPECTED.exitCode;
  return {
    schema: 'r4-regression-summary/v1',
    generatedBy: 'R4_CAMERA_20260913/tools/run-r4-regression.mjs',
    subject: {
      batch: 'R3_CAMERA_20260913',
      batchStatus: 'READY_FOR_REVIEW（冻结只读）',
      controller: 'src/camera-controller.mjs',
      controllerVersion: version,
    },
    method: {
      command: `node --test --test-reporter=tap --test-concurrency=${TEST_CONCURRENCY} <6个测试文件（显式绝对路径）>`,
      cwd: 'R3_CAMERA_20260913',
      combinedRun: '合并运行6个测试文件，取总tests/pass/fail与总exit code（与R3冻结记录同口径）',
      perFileRun: '每文件单独运行取各文件pass/fail计数（与R3冻结记录同口径）',
      rounds: ROUNDS,
      r3RunnerExecuted: false,
      r3Writes: 'none（runner与node --test均不写R3任何文件）',
      note: 'node22默认并发按完成序输出TAP（R3冻结TAP顺序不可复现）；本runner固定--test-concurrency=1使命令序确定，计数口径不变。',
    },
    roster,
    rosterMatchesExpected,
    expected: { ...EXPECTED, perFileTests: FROZEN_PER_FILE_TESTS, source: 'R3_CAMERA_20260913/evidence/r3-tests-run.log（冻结记录）' },
    matchesFrozenR3Record: matchesFrozen,
    perFileMatchesFrozenRecord: perFileMatches,
    frozenEvidence,
    rounds: rounds.map((r, i) => ({
      exitCode: r.combined.exitCode,
      spawnError: r.combined.spawnError,
      combined: {
        tests: r.combinedSummary.tests,
        suites: r.combinedSummary.suites,
        pass: r.combinedSummary.pass,
        fail: r.combinedSummary.fail,
        cancelled: r.combinedSummary.cancelled,
        skipped: r.combinedSummary.skipped,
        todo: r.combinedSummary.todo,
      },
      combinedNotOk: r.combinedNotOk,
      perFile: r.perFile,
      tapNormalized: r.tapNormalized,
      round: i + 1,
    })),
    warnings,
  };
}
// 注：totals 不含 durationMs（时长只进 summary.json 的 meta 孤立字段）。
function totalsOf(round) {
  const { durationMs, ...counts } = round.combinedSummary;
  return { ...counts, exitCode: round.combined.exitCode };
}

// ---------- main ----------

function main() {
  const startedAt = nowIso();
  const t0 = Date.now();

  if (!existsSync(R3_TEST_DIR)) fatal(`R3测试目录不存在：${R3_TEST_DIR}`);
  if (!existsSync(R3_EVIDENCE_DIR)) fatal(`R3证据目录不存在：${R3_EVIDENCE_DIR}`);
  const version = controllerVersionLiteral();

  const { roster, missing, extras, rosterMatchesExpected } = discoverRoster();
  if (roster.length === 0) fatal(`R3下未发现任何 *.test.mjs（预期6个）`);
  const warnings = [];
  if (missing.length > 0) warnings.push(`missingTestFiles: ${missing.join(', ')}`);
  if (extras.length > 0) warnings.push(`unexpectedExtraTestFiles: ${extras.join(', ')}`);
  log(`被测对象: R3_CAMERA_20260913 src/camera-controller.mjs 版本字面量=${version}（只读）`);
  log(`测试清单(${roster.length}): ${roster.join(' , ')}${rosterMatchesExpected ? '' : ' ⚠ 与预期6文件清单不一致'}`);

  // 1) 运行前：R3 evidence/ 全量sha256
  const before = hashTree(R3_EVIDENCE_DIR);
  const beforeRoot = rootHashOf(before);
  log(`evidence前置hash: ${beforeRoot.slice(0, 16)}…（${Object.keys(before).length}个文件）`);

  // 2) 连续两轮完整套件（合并运行 + 每文件单独运行）
  const rounds = [];
  for (let i = 1; i <= ROUNDS; i += 1) {
    const r = runRound(i, roster);
    rounds.push(r);
    log(
      `round ${i}/${ROUNDS}: 合并运行 tests=${r.combinedSummary.tests} pass=${r.combinedSummary.pass} fail=${r.combinedSummary.fail} exit=${r.combined.exitCode}` +
        `；每文件单独运行 ${r.perFile.map((pf) => `${pf.basename}=${pf.pass}/${pf.tests}`).join(' ')}`,
    );
  }

  // 3) 运行后：R3 evidence/ 全量sha256，前后一致才 PASS
  const after = hashTree(R3_EVIDENCE_DIR);
  const afterRoot = rootHashOf(after);
  const untouched = beforeRoot === afterRoot && mapsEqual(before, after);
  log(`evidence后置hash: ${afterRoot.slice(0, 16)}… → ${untouched ? 'PASS: frozen evidence untouched' : 'FAIL: R3冻结证据在运行期间发生变化'}`);

  // 4) 一次性冻结零污染证明（写后不再改）
  let frozenEvidenceStatus;
  if (!existsSync(PROOF_PATH)) {
    if (untouched) {
      const proof = {
        schema: 'r4-regression-frozen-proof/v1',
        generatedAt: nowIso(),
        prover: 'R4_CAMERA_20260913/tools/run-r4-regression.mjs',
        r3EvidenceDir: R3_EVIDENCE_DIR,
        readOnlyBatch: 'R3_CAMERA_20260913（READY_FOR_REVIEW，冻结批次）',
        algorithm: 'sha256',
        fileCount: Object.keys(before).length,
        beforeRootHash: beforeRoot,
        afterRootHash: afterRoot,
        conclusion: 'PASS: frozen evidence untouched',
        note: 'R4回归runner对R3冻结证据零污染的一次性证明。runner每次运行前后重算全目录sha256并与本文件核对；本文件写后不再修改。',
        before,
        after,
      };
      writeFileSync(PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
      log(`冻结零污染证明已固化（一次性）: ${PROOF_PATH}`);
      frozenEvidenceStatus = 'PASS: frozen evidence untouched';
    } else {
      frozenEvidenceStatus = 'FAIL: R3冻结证据在运行期间发生变化（证明文件未写入，留待干净运行补证）';
    }
  } else {
    const prev = JSON.parse(readFileSync(PROOF_PATH, 'utf8'));
    if (prev.beforeRootHash === beforeRoot && prev.afterRootHash === beforeRoot) {
      frozenEvidenceStatus = 'PASS: frozen evidence untouched';
      log(`与既有证明文件核对一致（${PROOF_PATH}），不重写一次性证明。`);
    } else {
      frozenEvidenceStatus = `FAIL: 当前R3 evidence前置hash ${beforeRoot} 与既有证明文件记录 ${prev.beforeRootHash} 不一致（冻结证据在两次运行之间被外部修改）`;
    }
  }

  // 5) 组装 summary / normalized；两轮归一化hash断言
  const frozenEvidence = {
    status: frozenEvidenceStatus,
    dir: 'R3_CAMERA_20260913/evidence',
    filesHashed: Object.keys(before).length,
    beforeRootHash: beforeRoot,
    afterRootHash: afterRoot,
    untouchedThisRun: untouched,
    proofFile: 'R4_CAMERA_20260913/evidence/regression-frozen-proof.json',
  };
  const coreBase = { roster, rosterMatchesExpected, version, frozenEvidence, rounds, warnings };
  const buildNormalized = (round) => {
    const c = buildCore(coreBase);
    c.totals = totalsOf(round);
    c.perFile = round.perFile;
    return c;
  };
  // h1/h2 分别为“以第1轮/第2轮为权威轮”组装的归一化文件内容（不含r4StableHash字段）的sha256；
  // 套件确定性良好时两轮数据一致 → 两个hash相同 → 重跑byte-identical。
  const canonical = (obj) => JSON.stringify(obj, null, 2);
  const h1 = sha256(Buffer.from(canonical(buildNormalized(rounds[0])), 'utf8'));
  const h2 = sha256(Buffer.from(canonical(buildNormalized(rounds[1])), 'utf8'));
  const stable = h1 === h2;
  log(`归一化hash两轮对比: round1=${h1.slice(0, 16)}… round2=${h2.slice(0, 16)}… → ${stable ? 'PASS: byte-identical' : 'FAIL: 归一化输出在两轮之间漂移'}`);

  const normalized = buildNormalized(rounds[ROUNDS - 1]);
  normalized.r4StableHash = {
    algorithm: 'sha256',
    scope: '本文件内容（不含本r4StableHash字段）的canonical JSON（2空格缩进）sha256',
    round1: h1,
    round2: h2,
    identical: stable,
  };

  // summary.json：同结构 + 时间戳只放孤立meta字段（允许漂移；normalized不含meta时间字段）
  const summary = {
    meta: {
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - t0,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cwd: R3_ROOT,
      combinedCommand: `node --test --test-reporter=tap --test-concurrency=${TEST_CONCURRENCY} ${roster.map((f) => path.join(R3_ROOT, f)).join(' ')}`,
      rounds: rounds.map((r, i) => ({ round: i + 1, runnerMs: r.runnerMs, tapMs: r.combinedSummary.durationMs })),
    },
    ...normalized,
  };
  delete summary.r4StableHash; // r4StableHash 只属于归一化文件（summary.json 允许漂移，不承担稳定hash）

  // 6) 写runtime输出（本批次独占写面）
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const L = [];
  L.push('# R4相机回归 原始TAP（合并运行）');
  L.push(`# subject: R3_CAMERA_20260913 src/camera-controller.mjs v${version}（冻结只读）`);
  L.push(`# 命令: node --test --test-reporter=tap --test-concurrency=${TEST_CONCURRENCY} <6个测试文件绝对路径，cwd=R3根目录>`);
  L.push('# 说明: 本文件含真实时长（duration_ms行原样保留），允许漂移；归一化版本（duration_ms行剔除）见 summary.normalized.json');
  L.push('#       每文件单独运行的原始TAP不落盘，计数见 summary.json（口径与R3冻结记录一致）；仅在出现失败时追加该文件原始TAP便于排查');
  for (let i = 0; i < rounds.length; i += 1) {
    const r = rounds[i];
    L.push('');
    L.push(`==================== round ${i + 1}/${ROUNDS} | 合并运行 | exit=${r.combined.exitCode} ====================`);
    L.push(r.combined.stdout.trimEnd());
    if (r.combined.stderr.trim().length > 0) {
      L.push('');
      L.push(`-------------------- round ${i + 1}/${ROUNDS} | stderr --------------------`);
      L.push(r.combined.stderr.trimEnd());
    }
  }
  for (const pf of rounds[ROUNDS - 1].perFile) {
    if (pf.fail > 0 || pf.exitCode !== 0 || pf.spawnError) {
      const run = runNodeTest([pf.file]);
      L.push('');
      L.push(`-------------------- 失败诊断 | ${pf.file} | exit=${pf.exitCode} --------------------`);
      L.push(run.stdout.trimEnd());
      if (run.stderr.trim().length > 0) L.push(`stderr:\n${run.stderr.trimEnd()}`);
    }
  }
  writeFileSync(TAP_LOG_PATH, `${L.join('\n')}\n`);
  writeFileSync(SUMMARY_PATH, `${canonical(summary)}\n`);
  writeFileSync(NORMALIZED_PATH, `${canonical(normalized)}\n`);
  log(`输出已写入: ${TAP_LOG_PATH}`);
  log(`输出已写入: ${SUMMARY_PATH}（meta.startedAt=${startedAt}，时间只在此孤立字段）`);
  log(`输出已写入: ${NORMALIZED_PATH}（r4StableHash round1=${h1.slice(0, 16)}… round2=${h2.slice(0, 16)}… identical=${stable}）`);

  // 7) 汇总结论与退出码
  const lastRound = rounds[ROUNDS - 1];
  const allGreen =
    lastRound.combined.exitCode === 0 &&
    lastRound.combinedSummary.fail === 0 &&
    lastRound.perFile.every((pf) => pf.exitCode === 0 && pf.fail === 0);
  const failures = [];
  if (!untouched) failures.push('R3冻结证据在运行期间发生变化');
  if (frozenEvidenceStatus.startsWith('FAIL')) failures.push(frozenEvidenceStatus);
  if (!stable) failures.push('归一化输出两轮hash不一致（漂移）');
  if (!allGreen) failures.push(`套件非全绿：combined exit=${lastRound.combined.exitCode} fail=${lastRound.combinedSummary.fail}`);
  if (!normalized.matchesFrozenR3Record)
    failures.push(`与R3冻结记录不符：期望tests=${EXPECTED.tests} pass=${EXPECTED.pass} fail=${EXPECTED.fail} exit=${EXPECTED.exitCode}，实际tests=${lastRound.combinedSummary.tests} pass=${lastRound.combinedSummary.pass} fail=${lastRound.combinedSummary.fail} exit=${lastRound.combined.exitCode}`);

  log(
    `RESULT: tests=${lastRound.combinedSummary.tests}/${EXPECTED.tests} pass=${lastRound.combinedSummary.pass} fail=${lastRound.combinedSummary.fail} exit=${lastRound.combined.exitCode}` +
      `｜frozenEvidence=${untouched ? 'PASS' : 'FAIL'}｜normalizedStable=${stable ? 'PASS' : 'FAIL'}｜matchesFrozenR3Record=${normalized.matchesFrozenR3Record}` +
      `${failures.length === 0 ? '｜PASS: frozen evidence untouched' : ''}`,
  );
  if (failures.length > 0) {
    for (const f of failures) console.error(`run-r4-regression: FAIL: ${f}`);
    process.exitCode = 1;
  }
}

main();
