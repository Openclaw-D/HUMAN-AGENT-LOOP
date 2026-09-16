// V4-LIFE ENG01-R1（control 0006）：未决核验恢复的可执行故障回归（TEST lane）。
// 被测冻结接口：app/work/verification-pending-store.ts（纯 TS 无 JSX 无 window 顶层访问——直接 import 真执行）。
//   - VERIFICATION_PENDING_STORAGE_KEY = 'jw:v4:verification:pending:v1'
//   - VerificationPendingStorage = { getItem(返回 string|null)/setItem/removeItem }
//   - 记录 envelope：{ version: 1, command: {commandId, caseId, evidenceId, actorId, verificationStatus(四枚举), reason, expectedRev} }
//   - createVerificationPendingStore(storage | null | undefined) → { save, load, clear }，
//     失败统一 { ok:false, reason }：unavailable / empty / read_failure / write_failure / clear_failure /
//     corrupt / unsupported_version / invalid_shape；不覆盖损坏记录。
// 面板接线语义：WorkShell 唯一 owner hydrate 恰一次、恢复建立未决态但禁止自动发送；先存后发；
//   清除仅在 accepted/replayed/version_conflict/rejected 四类明确结果；SSR 零 window 顶层访问。
//
// 做法：注入 fake storage（内存 Map + 可编程抛异常）直接执行 store（行为回归，非正则）；
// 纯逻辑区（绑定判定/组装守卫）沿用 ui 文件的标记切取→临时目录→动态 import 方式真实执行；
// 结构断言（先存后发/无网络语义/无 window 顶层/hydrate 恰一次）读交付源码做意图级检查。
// FE 并行实现中：缺失部分以"待合入"统一失败消息照实列出，不为变绿改 FE 文件。
//
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-verification-recovery.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

async function readRequired(path, what = '文件') {
  try {
    return await readFile(new URL(path, root), 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      assert.fail(`待合入：${what}不存在：${path}（FE lane 尚未落地）`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 共享辅助：纯逻辑区动态执行（同 ui 文件方式） + 绑定判定容错
// ---------------------------------------------------------------------------

const MARKER_START = '// <!-- ENG01-VERIFICATION-PURE-LOGIC-START -->';
const MARKER_END = '// <!-- ENG01-VERIFICATION-PURE-LOGIC-END -->';

function balancedBlock(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start: open, end: i, body: source.slice(open + 1, i) };
      }
    }
  }
  return null;
}

function resolveExport(mod, expectedName, rolePattern, role) {
  if (expectedName !== null && typeof mod[expectedName] === 'function') {
    return mod[expectedName];
  }
  for (const key of Object.keys(mod)) {
    if (typeof mod[key] === 'function' && rolePattern.test(key)) {
      return mod[key];
    }
  }
  const exported = Object.keys(mod).join(', ') || '（无）';
  assert.fail(`纯逻辑区缺少${role}导出${expectedName === null ? '' : `（预期名 ${expectedName}）`}；实际导出：${exported}`);
}

async function withPureLogicModule(fn) {
  const panel = await readRequired('app/work/VerificationPanel.tsx', '面板');
  const start = panel.indexOf(MARKER_START);
  const end = panel.indexOf(MARKER_END);
  assert.ok(start !== -1 && end !== -1 && start < end, 'VerificationPanel.tsx 纯逻辑区标记缺失或无序');
  const region = panel.slice(start + MARKER_START.length, end);
  const workDirUrl = new URL('app/work/', root);
  const reanchor = (whole, keyword, quote, specifier) => {
    const absolute = pathToFileURL(fileURLToPath(new URL(specifier, workDirUrl))).href;
    return `${keyword}${quote}${absolute}${quote}`;
  };
  const reanchored = region
    .replace(/(from\s+)(['"])(\.\.?\/[^'"]*)\2/g, reanchor)
    .replace(/(import\s+)(['"])(\.\.?\/[^'"]*)\2/g, reanchor);
  const dir = mkdtempSync(join(tmpdir(), 'v4life-verification-recovery-'));
  try {
    const file = join(dir, 'verification-pure-logic.ts');
    writeFileSync(file, reanchored, 'utf8');
    let loaded;
    try {
      loaded = await import(pathToFileURL(file).href);
    } catch (error) {
      assert.fail(`纯逻辑区含不可擦除语法或动态加载失败：${error?.message ?? error}`);
    }
    return await fn(loaded);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const MATCH_VERDICT = /^(match|bound|current|ok|valid|retry)/i;
const STALE_VERDICT = /stale|mismatch|expired|unbound|invalid|reset|detached/i;

function verdictOf(result) {
  if (typeof result === 'string') return result;
  if (typeof result === 'boolean') return result ? 'match' : 'stale';
  if (result !== null && typeof result === 'object') {
    const value = result.kind ?? result.outcome ?? result.status ?? result.verdict ?? result.state ?? result.binding ?? result.matched;
    if (typeof value === 'string') return value;
    if (value === true) return 'match';
    if (value === false) return 'stale';
  }
  return undefined;
}

function bindVerdicts(bindFn, command, caseId, actorId) {
  const attempts = [
    () => bindFn(command, { caseId, actorId }),
    () => bindFn({ ...command, caseId, actorId }, { caseId, actorId }),
    () => bindFn({ command, caseId, actorId }),
    () => bindFn({ ...command, caseId, actorId }, caseId, actorId),
  ];
  const verdicts = [];
  for (const attempt of attempts) {
    try {
      const verdict = verdictOf(attempt());
      if (verdict !== undefined) {
        verdicts.push(verdict);
      }
    } catch {
      // 尝试下一种调用形态
    }
  }
  return verdicts;
}

// ---------------------------------------------------------------------------
// store 模块加载（待合入容错）与 fake storage
// ---------------------------------------------------------------------------

const STORAGE_KEY_EXPECTED = 'jw:v4:verification:pending:v1';
const STORE_PATH = '../app/work/verification-pending-store.ts';

let storeModuleAttempt = null;

async function loadStoreModule() {
  if (storeModuleAttempt === null) {
    storeModuleAttempt = await import(STORE_PATH).then(
      (mod) => ({ mod }),
      (error) => ({ error }),
    );
  }
  if (storeModuleAttempt.error !== undefined) {
    assert.fail(`待合入：verification-pending-store.ts 缺失或不可加载：${storeModuleAttempt.error?.message ?? storeModuleAttempt.error}`);
  }
  return storeModuleAttempt.mod;
}

function resolveStoreApi(mod) {
  const create = typeof mod.createVerificationPendingStore === 'function'
    ? mod.createVerificationPendingStore
    : Object.values(mod).find(
        (value) => typeof value === 'function' && /create/i.test(value.name ?? '') && /store|pending/i.test(value.name ?? ''),
      );
  assert.ok(
    typeof create === 'function',
    `待合入：store 缺少 createVerificationPendingStore 导出；实际导出：${Object.keys(mod).join(', ') || '（无）'}`,
  );
  let key = typeof mod.VERIFICATION_PENDING_STORAGE_KEY === 'string' ? mod.VERIFICATION_PENDING_STORAGE_KEY : null;
  if (key === null) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'string' && /verification:pending/.test(value)) {
        key = value;
        break;
      }
    }
  }
  assert.ok(
    typeof key === 'string',
    `待合入：store 缺少 VERIFICATION_PENDING_STORAGE_KEY 导出；实际导出：${Object.keys(mod).join(', ') || '（无）'}`,
  );
  return { create, key };
}

function resolveStoreApiMethods(store) {
  for (const method of ['save', 'load', 'clear']) {
    assert.ok(typeof store?.[method] === 'function', `store 缺少 ${method} 方法（冻结接口 { save, load, clear }）`);
  }
  return store;
}

/** 内存 fake storage：可编程按方法抛异常（运行时翻转 overrides 即可）。 */
function createFakeStorage(overrides = {}) {
  const map = new Map();
  return {
    map,
    getItem(key) {
      if (overrides.getItemFail) {
        throw new Error('fake getItem failure');
      }
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (overrides.setItemFail) {
        throw new Error('fake setItem failure');
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      if (overrides.removeItemFail) {
        throw new Error('fake removeItem failure');
      }
      map.delete(key);
    },
  };
}

/** 完整冻结命令（七字段）。 */
const RECOVERY_COMMAND = {
  commandId: 'cmd-recovery-1',
  caseId: 'case-x',
  evidenceId: 'ev-x',
  actorId: 'actor-y',
  verificationStatus: 'verified',
  reason: '恢复回归：未决核验理由。',
  expectedRev: 42,
};

/** 统一 failure 断言：既验 reason 精确值，也捕获"向调用方抛出异常"的违约。 */
async function expectFailure(label, fn, expectedReason, failures) {
  try {
    const outcome = await fn();
    if (outcome === null || typeof outcome !== 'object' || outcome.ok !== false || outcome.reason !== expectedReason) {
      failures.push(`${label}：应 {ok:false, reason:'${expectedReason}'}，实际 ${JSON.stringify(outcome)}`);
    }
  } catch (error) {
    failures.push(`${label}：向调用方抛出异常（契约要求统一 failure）：${error?.message ?? error}`);
  }
}

// ---------------------------------------------------------------------------
// 1. reload / 原载荷一致
// ---------------------------------------------------------------------------

test('pending store：save→新实例 load 原载荷七字段逐字段一致；envelope version 恰为 1；key 恰为冻结值且不写多余键', async () => {
  const mod = await loadStoreModule();
  const { create, key } = resolveStoreApi(mod);
  assert.equal(key, STORAGE_KEY_EXPECTED, '存储键必须恰为 jw:v4:verification:pending:v1');

  const fake = createFakeStorage();
  const store = resolveStoreApiMethods(create(fake));
  const saveOutcome = await store.save(RECOVERY_COMMAND);
  assert.ok(saveOutcome?.ok === true, `save 合法命令应 ok:true，实际 ${JSON.stringify(saveOutcome)}`);

  // envelope：恰写入冻结键（无多余键），version 恰为 1，command 与原载荷逐字段一致。
  assert.equal(fake.map.size, 1, 'save 只应写存储键一处');
  const raw = fake.map.get(STORAGE_KEY_EXPECTED);
  assert.ok(typeof raw === 'string', 'save 应在冻结键下写入字符串记录');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.version, 1, 'envelope version 必须恰为 1');
  assert.deepEqual(envelope.command, RECOVERY_COMMAND, 'envelope.command 必须与原冻结载荷七字段逐字段一致');

  // 新 store 实例（模拟重启后的新读路径）load：原载荷逐字段恢复。
  const secondFake = createFakeStorage();
  secondFake.map.set(key, raw);
  const reloaded = resolveStoreApiMethods(create(secondFake));
  const loadOutcome = await reloaded.load();
  assert.ok(loadOutcome?.ok === true, `load 应 ok:true，实际 ${JSON.stringify(loadOutcome)}`);
  assert.deepEqual(loadOutcome.command, RECOVERY_COMMAND, '恢复出的命令必须与原载荷七字段逐字段一致（含 expectedRev/verificationStatus）');

  // 空存储 load：正常态 empty，不是错误抛出。
  const emptyOutcome = await resolveStoreApiMethods(create(createFakeStorage())).load();
  assert.ok(emptyOutcome?.ok === false && emptyOutcome.reason === 'empty', `空存储 load 应 {ok:false, reason:'empty'}，实际 ${JSON.stringify(emptyOutcome)}`);
});

// ---------------------------------------------------------------------------
// 2. 先存后发
// ---------------------------------------------------------------------------

test('先存后发：面板发送路径 save 先于 fetch 且 save 结果先校验；store 文件零网络语义', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx', '面板');
  const storeSource = await readRequired('app/work/verification-pending-store.ts', 'pending store');

  const failures = [];

  // 面板发送路径（真实数据流）：save 与 fetch 可同函数（形状 A），也可在提交入口先存、
  // 校验通过后再调用发送函数（形状 B，当前实现）。取"包含 .save( 的最小函数体"与
  // "包含 fetch( 的最小函数体"判定，避免把外层组件大闭包误当发送路径。
  const functions = [];
  // 赋值形态只认箭头函数初始化（= ... =>）；普通赋值（如 const isBusinessActor = ...）其后文件的
  // 下一个 "{" 可能属于别的函数，误挂会产生假候选，故不参选。
  const functionPattern = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?[^;\n]*?=>/g;
  let match;
  while ((match = functionPattern.exec(panel)) !== null) {
    const name = match[1] ?? match[2];
    const open = panel.indexOf('{', match.index);
    if (open === -1 || open - match.index > 160) {
      continue;
    }
    const block = balancedBlock(panel, open);
    if (block !== null) {
      functions.push({ name, body: block.body });
    }
  }
  const sendFn = functions
    .filter((entry) => /\bfetch\s*\(/.test(entry.body))
    .sort((a, b) => a.body.length - b.body.length)[0];
  const saveFn = functions
    .filter((entry) => /\.save\s*\(/.test(entry.body))
    .sort((a, b) => a.body.length - b.body.length)[0];

  if (saveFn === undefined) {
    failures.push('待合入：未找到包含 save 调用的函数（先存后发接线尚未落地）');
  } else if (sendFn === undefined) {
    failures.push('待合入：未找到包含 fetch 的发送函数');
  } else {
    const saveAt = saveFn.body.search(/\.save\s*\(/);
    const sameBodyFetchAt = saveFn.body.search(/\bfetch\s*\(/);
    const sendCallAt = saveFn.body.search(new RegExp(`\\b${sendFn.name}\\s*\\(`));
    if (sameBodyFetchAt !== -1) {
      // 形状 A：save 与 fetch 同函数。
      if (saveAt > sameBodyFetchAt) {
        failures.push(`${saveFn.name}：save 必须先于 fetch（先存后发），实际 fetch 在前`);
      } else if (!/\.ok\b/.test(saveFn.body.slice(saveAt, sameBodyFetchAt))) {
        failures.push(`${saveFn.name}：save 与 fetch 之间必须校验 save 结果（save 失败分支不得触达 fetch）`);
      }
    } else if (sendCallAt !== -1) {
      // 形状 B：先存、校验通过后才调用发送函数（save 失败分支不触达发送）。
      if (saveAt > sendCallAt) {
        failures.push(`${saveFn.name}：save 必须先于 ${sendFn.name}() 调用（先存后发）`);
      } else if (!/\.ok\b/.test(saveFn.body.slice(saveAt, sendCallAt))) {
        failures.push(`${saveFn.name}：save 与 ${sendFn.name}() 之间必须校验 save 结果（save 失败分支不得发送）`);
      }
    } else {
      failures.push(`${saveFn.name}：save 之后既无 fetch 也未调用发送函数 ${sendFn.name}（无法确认先存后发）`);
    }
  }

  // store 层零网络语义：save 返回 ok:false 时不存在任何网络路径（适配器本身不发网络请求）。
  const networkPattern = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\s*\./;
  if (networkPattern.test(storeSource)) {
    failures.push('verification-pending-store.ts 必须是纯存储适配（发现网络语义调用）');
  }

  assert.deepEqual(failures, [], `先存后发结构未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// 3. 读写清除异常
// ---------------------------------------------------------------------------

test('读写清除异常：统一 failure reason、绝不向调用方抛出；clear_failure 时记录仍在', async () => {
  const mod = await loadStoreModule();
  const { create } = resolveStoreApi(mod);

  const failures = [];

  const writeFails = createFakeStorage({ setItemFail: true });
  await expectFailure('setItem 抛异常 → save', () => resolveStoreApiMethods(create(writeFails)).save(RECOVERY_COMMAND), 'write_failure', failures);

  const readFails = createFakeStorage({ getItemFail: true });
  await expectFailure('getItem 抛异常 → load', () => resolveStoreApiMethods(create(readFails)).load(), 'read_failure', failures);

  // clear_failure：清除抛异常 → clear 统一失败；记录仍在（异常解除后 load 仍能读回原命令）。
  const overrides = { removeItemFail: true };
  const clearFails = createFakeStorage(overrides);
  const clearStore = resolveStoreApiMethods(create(clearFails));
  const prepared = await clearStore.save(RECOVERY_COMMAND);
  if (prepared?.ok !== true) {
    failures.push(`前置：save 应成功，实际 ${JSON.stringify(prepared)}`);
  }
  await expectFailure('removeItem 抛异常 → clear(自身 commandId)', () => clearStore.clear(RECOVERY_COMMAND.commandId), 'clear_failure', failures);
  overrides.removeItemFail = false;
  const afterClear = await clearStore.load();
  if (afterClear?.ok !== true || afterClear.command === undefined) {
    failures.push(`clear_failure 时记录必须仍在（不得伪称已清理），实际 ${JSON.stringify(afterClear)}`);
  } else {
    assert.deepEqual(afterClear.command, RECOVERY_COMMAND, 'clear_failure 后 load 应回读原命令');
  }

  assert.deepEqual(failures, [], `读写清除异常回归未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// 4. 坏 JSON / 版本 / 形状（含"不覆盖损坏记录"）
// ---------------------------------------------------------------------------

test('坏 JSON/版本/形状：corrupt / unsupported_version / invalid_shape 不产出命令，损坏记录逐字节不被改写', async () => {
  const mod = await loadStoreModule();
  const { create, key } = resolveStoreApi(mod);

  const failures = [];

  async function expectLoadOutcome(rawText, expectedReason, label) {
    const fake = createFakeStorage();
    fake.map.set(key, rawText);
    const rawBefore = fake.map.get(key);
    const outcome = await resolveStoreApiMethods(create(fake)).load();
    if (outcome === null || typeof outcome !== 'object' || outcome.ok !== false || outcome.reason !== expectedReason) {
      failures.push(`${label}：应 {ok:false, reason:'${expectedReason}'}，实际 ${JSON.stringify(outcome)}`);
    }
    if (expectedReason !== 'empty' && outcome !== null && typeof outcome === 'object' && 'command' in outcome && outcome.command !== undefined) {
      failures.push(`${label}：失败判定不得产出命令对象，实际 command=${JSON.stringify(outcome.command)}`);
    }
    if (fake.map.get(key) !== rawBefore) {
      failures.push(`${label}：损坏记录必须逐字节保持原样（store 不得自动改写）`);
    }
  }

  await expectLoadOutcome('{not-json', 'corrupt', '损坏 JSON');
  await expectLoadOutcome('', 'corrupt', '空串记录（非 JSON）');
  await expectLoadOutcome(
    JSON.stringify({ version: 2, command: RECOVERY_COMMAND }),
    'unsupported_version',
    'version=2 未知版本',
  );
  await expectLoadOutcome(
    JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, evidenceId: undefined } }),
    'invalid_shape',
    '命令缺 evidenceId',
  );
  await expectLoadOutcome(
    JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, verificationStatus: 'claimed' } }),
    'invalid_shape',
    'verificationStatus=claimed（不在四枚举）',
  );
  await expectLoadOutcome(
    JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, expectedRev: '42' } }),
    'invalid_shape',
    'expectedRev 非整数（字符串）',
  );
  await expectLoadOutcome(JSON.stringify({ version: 1, command: 'not-an-object' }), 'invalid_shape', 'command 非对象');

  // save 侧前置校验：非法命令不写入（存储保持空）。
  for (const [label, command] of [
    ['save 缺 evidenceId', { ...RECOVERY_COMMAND, evidenceId: '' }],
    ["save verificationStatus=claimed", { ...RECOVERY_COMMAND, verificationStatus: 'claimed' }],
    ['save expectedRev 非整数', { ...RECOVERY_COMMAND, expectedRev: 1.5 }],
  ]) {
    const fake = createFakeStorage();
    const outcome = await resolveStoreApiMethods(create(fake)).save(command);
    if (outcome === null || typeof outcome !== 'object' || outcome.ok !== false || outcome.reason !== 'invalid_shape') {
      failures.push(`${label}：应 {ok:false, reason:'invalid_shape'}，实际 ${JSON.stringify(outcome)}`);
    }
    if (fake.map.get(key) !== undefined) {
      failures.push(`${label}：invalid_shape 不得写入存储，实际已写入 ${JSON.stringify(fake.map.get(key))}`);
    }
  }

  assert.deepEqual(failures, [], `坏数据回归未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// 5. stale 身份：恢复命令 × 纯逻辑区绑定判定 / 组装守卫
// ---------------------------------------------------------------------------

test('stale 身份：store 恢复的命令（绑定 X/Y）对当前 W/Z → stale 且禁组装；切回 X/Y 恢复 match', async () => {
  const mod = await loadStoreModule();
  const { create } = resolveStoreApi(mod);

  // 恢复路径真实走 store：save P → 新实例 load → 恢复出命令。
  const firstFake = createFakeStorage();
  const saved = await resolveStoreApiMethods(create(firstFake)).save({
    ...RECOVERY_COMMAND,
    caseId: 'case-x',
    actorId: 'actor-y',
  });
  assert.ok(saved?.ok === true, `前置：save P 应成功，实际 ${JSON.stringify(saved)}`);
  const secondFake = createFakeStorage();
  secondFake.map.set(resolveStoreApi(mod).key, firstFake.map.get(resolveStoreApi(mod).key));
  const loadOutcome = await resolveStoreApiMethods(create(secondFake)).load();
  assert.ok(loadOutcome?.ok === true && loadOutcome.command !== undefined, `前置：load 应恢复出命令，实际 ${JSON.stringify(loadOutcome)}`);
  const recovered = loadOutcome.command;

  await withPureLogicModule(async (logic) => {
    const composeFn = resolveExport(logic, 'canComposeCommand', /compose/i, '未决命令守卫');
    const bindFn = resolveExport(logic, null, /bind|bound|stale|match/i, '未决命令绑定判定');

    const failures = [];

    // 当前端为 W/Z（切换后的案例/身份）：恢复命令 stale + 禁止组装新命令。
    if (composeFn({ unknownCommand: recovered }) !== false) {
      failures.push('恢复未决命令在位时 canComposeCommand 应为 false（任何端都不得绕过）');
    }
    const stale = bindVerdicts(bindFn, recovered, 'case-w', 'actor-z');
    if (!stale.some((verdict) => STALE_VERDICT.test(verdict))) {
      failures.push(`恢复命令绑定 X/Y 对当前 W/Z 应 stale，实际 ${stale.join('/') || '（无可识别结果）'}`);
    }

    // 切回原绑定 X/Y：恢复 match（可重试同一命令）。
    const restored = bindVerdicts(bindFn, recovered, 'case-x', 'actor-y');
    if (!restored.some((verdict) => MATCH_VERDICT.test(verdict))) {
      failures.push(`切回原绑定（X/Y）应恢复 match，实际 ${restored.join('/') || '（无可识别结果）'}`);
    }

    assert.deepEqual(failures, [], `stale 身份回归未全过 → ${failures.join('；')}`);
  });
});

// ---------------------------------------------------------------------------
// 6. SSR：unavailable + 零 window 顶层访问
// ---------------------------------------------------------------------------

test('SSR：storage 为 null/undefined → 全操作 unavailable 不抛；三文件模块顶层无裸 window 访问', async () => {
  const mod = await loadStoreModule();
  const { create } = resolveStoreApi(mod);

  const failures = [];

  for (const storage of [null, undefined]) {
    const store = resolveStoreApiMethods(create(storage));
    await expectFailure(`storage=${String(storage)} → save`, () => store.save(RECOVERY_COMMAND), 'unavailable', failures);
    await expectFailure(`storage=${String(storage)} → load`, () => store.load(), 'unavailable', failures);
    await expectFailure(`storage=${String(storage)} → clear`, () => store.clear(RECOVERY_COMMAND.commandId), 'unavailable', failures);
  }

  // store 是依赖注入的纯适配器：真实代码不得访问 window（注释中提及——如
  // "WorkShell 注入 window.sessionStorage"——不算访问，先剥离注释再判定）。
  const storeSource = await readRequired('app/work/verification-pending-store.ts', 'pending store');
  const storeCode = storeSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  if (/\bwindow\s*\./.test(storeCode)) {
    failures.push('verification-pending-store.ts 不得直接访问 window（storage 经依赖注入）');
  }

  // 面板 / WorkShell：模块顶层（零缩进语句）不得有裸 window. 访问；hydrate 须在 effect/guard 内。
  for (const path of ['app/work/VerificationPanel.tsx', 'app/work/WorkShell.tsx']) {
    const source = await readRequired(path, path);
    if (/^window\./m.test(source)) {
      failures.push(`${path} 模块顶层存在裸 window. 访问（SSR 不安全）`);
    }
  }
  const panel = await readRequired('app/work/VerificationPanel.tsx', '面板');
  const shell = await readRequired('app/work/WorkShell.tsx', 'WorkShell');
  if (!/typeof\s+window|useEffect\s*\(/.test(panel) && !/typeof\s+window|useEffect\s*\(/.test(shell)) {
    failures.push('面板/WorkShell 均未发现 effect 或 typeof window 守卫（hydrate 必须 SSR 安全）');
  }

  assert.deepEqual(failures, [], `SSR 回归未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// 7. hydrate 恰一次（双端共享不回归）
// ---------------------------------------------------------------------------

test('hydrate 恰一次：load 仅 WorkShell 一处且在 effect/guard 内；面板不自持 hydration；恢复经唯一 owner state 写入', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx', '面板');
  const shell = await readRequired('app/work/WorkShell.tsx', 'WorkShell');

  const failures = [];

  // WorkShell（唯一 owner）：恰一次 load。
  const shellLoads = [...shell.matchAll(/\.\s*load\s*\(/g)];
  if (shellLoads.length !== 1) {
    failures.push(`WorkShell 应恰有一次未决恢复 load 调用（hydrate 恰一次），实际 ${shellLoads.length}`);
  }

  // hydrate 必须在 effect 或 typeof window 守卫内（SSR 安全），不得在模块顶层/渲染路径裸执行。
  if (shellLoads.length === 1) {
    const loadAt = shellLoads[0].index;
    let guarded = /typeof\s+window/.test(shell);
    const effectPattern = /useEffect\s*\(/g;
    let effectMatch;
    while ((effectMatch = effectPattern.exec(shell)) !== null) {
      const open = shell.indexOf('{', effectMatch.index);
      const block = open === -1 ? null : balancedBlock(shell, open);
      if (block !== null && loadAt >= block.start && loadAt <= block.end) {
        guarded = true;
        break;
      }
    }
    if (!guarded) {
      failures.push('hydrate load 必须位于 useEffect 内或 typeof window 守卫之后（SSR 安全）');
    }
  }

  // 面板不自持 hydration：不得调用 load（save 属发送路径，不受限）。
  if (/\.\s*load\s*\(/.test(panel)) {
    failures.push('VerificationPanel.tsx 不得自持 hydration load（未决恢复唯一 owner 是 WorkShell）');
  }

  // 恢复结果经唯一 owner state 写入：WorkShell 存在未决 setter 调用（state 写入而非仅 props 引用）。
  if (!/\bset[A-Za-z0-9_]*Pending[A-Za-z0-9]*Command\s*\(|\bsetVerificationPendingCommand\s*\(/.test(shell)) {
    failures.push('WorkShell 应把恢复出的命令写入唯一 owner state（未决 setter 调用）');
  }

  assert.deepEqual(failures, [], `hydrate 恰一次结构未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// R1 中途审查补充一：store 严格 exact-keys / trim 非空 / reason 长度（save 与 load 同一校验）
// ---------------------------------------------------------------------------

test('store 严格形状：envelope/command 额外键、全空格字符串、reason 2000/2001 边界（save 与 load 同一校验）', async () => {
  const mod = await loadStoreModule();
  const { create, key } = resolveStoreApi(mod);

  const failures = [];

  async function expectLoadShape(rawText, expectedReason, label) {
    const fake = createFakeStorage();
    fake.map.set(key, rawText);
    const rawBefore = fake.map.get(key);
    const outcome = await resolveStoreApiMethods(create(fake)).load();
    if (outcome === null || typeof outcome !== 'object' || outcome.ok !== false || outcome.reason !== expectedReason) {
      failures.push(`${label}：load 应 {ok:false, reason:'${expectedReason}'}，实际 ${JSON.stringify(outcome)}`);
    }
    if (outcome !== null && typeof outcome === 'object' && 'command' in outcome && outcome.command !== undefined) {
      failures.push(`${label}：失败判定不得产出命令对象`);
    }
    if (fake.map.get(key) !== rawBefore) {
      failures.push(`${label}：存储原文必须逐字节保持不变`);
    }
  }

  async function expectSaveShape(command, expectedOk, label) {
    const fake = createFakeStorage();
    const outcome = await resolveStoreApiMethods(create(fake)).save(command);
    if (expectedOk) {
      if (outcome === null || typeof outcome !== 'object' || outcome.ok !== true) {
        failures.push(`${label}：save 应 ok:true，实际 ${JSON.stringify(outcome)}`);
      }
    } else if (outcome === null || typeof outcome !== 'object' || outcome.ok !== false || outcome.reason !== 'invalid_shape') {
      failures.push(`${label}：save 应 {ok:false, reason:'invalid_shape'}，实际 ${JSON.stringify(outcome)}`);
      if (fake.map.get(key) !== undefined) {
        failures.push(`${label}：invalid_shape 不得写入存储`);
      }
    }
  }

  // envelope 层额外键 → invalid_shape 且原文不变。
  await expectLoadShape(
    JSON.stringify({ version: 1, command: RECOVERY_COMMAND, unexpected: true }),
    'invalid_shape',
    'envelope 额外键 unexpected:true',
  );
  // command 层额外键 → invalid_shape。
  await expectLoadShape(
    JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, unexpected: 1 } }),
    'invalid_shape',
    'command 额外键 unexpected:1',
  );
  // 全空格字符串（trim 后非空才合法）。
  await expectLoadShape(JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, reason: '   ' } }), 'invalid_shape', 'load reason 全空格');
  await expectLoadShape(JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, actorId: '   ' } }), 'invalid_shape', 'load actorId 全空格');
  // reason 长度边界：恰 2000 合法（原样恢复），2001 非法。
  const reason2000 = 'a'.repeat(2000);
  {
    const fake = createFakeStorage();
    fake.map.set(key, JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, reason: reason2000 } }));
    const outcome = await resolveStoreApiMethods(create(fake)).load();
    if (outcome === null || typeof outcome !== 'object' || outcome.ok !== true || outcome.command?.reason !== reason2000) {
      failures.push('reason 恰 2000 字符：load 应 ok 且原样恢复 reason，实际 ' + JSON.stringify(outcome));
    }
  }
  await expectLoadShape(JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, reason: 'a'.repeat(2001) } }), 'invalid_shape', 'load reason 2001 字符');
  // 长度口径按原始 value.length（首尾空白计入；trim 仅用于非空判断）：
  // '  ' + x*2000 + '  ' 原始 2004（trim 后 2000）→ invalid_shape，不写入/不产出命令。
  const paddedReason = '  ' + 'x'.repeat(2000) + '  ';
  await expectLoadShape(
    JSON.stringify({ version: 1, command: { ...RECOVERY_COMMAND, reason: paddedReason } }),
    'invalid_shape',
    'load reason 首尾空白致原始长度 2004 超限（trim 后 2000 也必须拒绝）',
  );
  await expectSaveShape({ ...RECOVERY_COMMAND, reason: paddedReason }, false, 'save reason 首尾空白致原始长度 2004 超限（trim 后 2000 也必须拒绝）');

  // save 与 load 同一校验（save 侧逐条镜像）。
  await expectSaveShape({ ...RECOVERY_COMMAND, reason: '   ' }, false, 'save reason 全空格');
  await expectSaveShape({ ...RECOVERY_COMMAND, actorId: '   ' }, false, 'save actorId 全空格');
  await expectSaveShape({ ...RECOVERY_COMMAND, extraKey: 1 }, false, 'save command 额外键');
  await expectSaveShape({ ...RECOVERY_COMMAND, reason: 'a'.repeat(2000) }, true, 'save reason 恰 2000');
  await expectSaveShape({ ...RECOVERY_COMMAND, reason: 'a'.repeat(2001) }, false, 'save reason 2001 字符');

  assert.deepEqual(failures, [], `store 严格形状回归未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// R1 中途审查补充二：clear 带 commandId 绑定（乱序回归核心：慢的旧响应不得清掉新命令恢复记录）
// ---------------------------------------------------------------------------

test('clear 带 commandId 绑定：异 id → id_mismatch 且记录逐字节保留；同 id → ok 且移除；空存储 ok；损坏记录 fail-closed 不变', async () => {
  const mod = await loadStoreModule();
  const { create, key } = resolveStoreApi(mod);

  const failures = [];
  const commandX = { ...RECOVERY_COMMAND, commandId: 'cmd-x' };

  const fake = createFakeStorage();
  const store = resolveStoreApiMethods(create(fake));
  const prepared = await store.save(commandX);
  if (prepared === null || typeof prepared !== 'object' || prepared.ok !== true) {
    failures.push(`前置：save X 应成功，实际 ${JSON.stringify(prepared)}`);
  }
  const rawBefore = fake.map.get(key);

  // 乱序回归核心：慢的旧响应携带旧 id（'cmd-y'）不得清掉新命令 X 的恢复记录。
  const mismatch = await store.clear('cmd-y');
  if (mismatch === null || typeof mismatch !== 'object' || mismatch.ok !== false || mismatch.reason !== 'id_mismatch') {
    failures.push(`clear('cmd-y')（异 id）应 {ok:false, reason:'id_mismatch'}，实际 ${JSON.stringify(mismatch)}`);
  }
  if (fake.map.get(key) !== rawBefore) {
    failures.push("clear 异 id 后 X 记录必须逐字节保留（慢的旧响应不得清掉新命令恢复记录）");
  }

  const same = await store.clear('cmd-x');
  if (same === null || typeof same !== 'object' || same.ok !== true) {
    failures.push(`clear('cmd-x')（同 id）应 ok:true，实际 ${JSON.stringify(same)}`);
  }
  if (fake.map.get(key) !== undefined) {
    failures.push('clear 同 id 后记录应已移除');
  }

  // 空存储 clear → ok（无记录可清即成功）。
  const emptyClear = await resolveStoreApiMethods(create(createFakeStorage())).clear('cmd-x');
  if (emptyClear === null || typeof emptyClear !== 'object' || emptyClear.ok !== true) {
    failures.push(`空存储 clear 应 ok:true，实际 ${JSON.stringify(emptyClear)}`);
  }

  // 损坏记录 clear → 对应 fail-closed 原因（corrupt）且内容逐字节不变。
  const corruptFake = createFakeStorage();
  corruptFake.map.set(key, '{not-json');
  const corruptRaw = corruptFake.map.get(key);
  const corruptOutcome = await resolveStoreApiMethods(create(corruptFake)).clear('cmd-x');
  if (corruptOutcome === null || typeof corruptOutcome !== 'object' || corruptOutcome.ok !== false || corruptOutcome.reason !== 'corrupt') {
    failures.push(`损坏记录 clear 应 fail-closed {ok:false, reason:'corrupt'}，实际 ${JSON.stringify(corruptOutcome)}`);
  }
  if (corruptFake.map.get(key) !== corruptRaw) {
    failures.push('损坏记录 clear 后内容必须逐字节不变');
  }

  assert.deepEqual(failures, [], `clear commandId 绑定回归未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// R1 中途审查补充三：面板终结分支 clear(自身 commandId) + 置空前 commandId 同源校验
// ---------------------------------------------------------------------------

test('面板终结分支：storage clear 以自身 commandId 为参调用；父状态置空前有 commandId 同源校验', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx', '面板');

  const failures = [];

  // 终结分支的存储清除必须绑定自身 commandId（如 clear(command.commandId) / clear(unknownCommand.commandId)）。
  const clearCalls = [...panel.matchAll(/\.clear\s*\(\s*([^)]*)\)/g)];
  if (clearCalls.length === 0) {
    failures.push('待合入：面板未发现存储 clear 调用（clear 绑定接线尚未落地）');
  }
  for (const match of clearCalls) {
    const arg = match[1].trim();
    if (!/commandId\s*$/.test(arg)) {
      failures.push(`storage clear 必须以自身 commandId 为参，实际 clear(${arg || '（无参）'}）`);
    }
  }

  // 父状态置空（写 null）前必须有 commandId 同源校验（ref 比对形态可：xxx.commandId === yyy.commandId）。
  const nullPattern = /\b(?:setPendingCommand|onPendingCommandChange|setUnknownCommand|setVerificationPendingCommand)\s*\(\s*null\s*\)/g;
  for (const match of panel.matchAll(nullPattern)) {
    const before = panel.slice(Math.max(0, match.index - 900), match.index);
    if (!/commandId\s*===?\s*|===?\s*[A-Za-z0-9_.$]*commandId\b/.test(before)) {
      failures.push(`父状态置空前必须有 commandId 同源校验（offset ${match.index} 处向前未找到 commandId 相等比较）`);
    }
  }

  assert.deepEqual(failures, [], `面板 clear 绑定结构未全过 → ${failures.join('；')}`);
});

// ---------------------------------------------------------------------------
// R1 中途审查补充四：共享单一 in-flight 锁 + reset 门控
// ---------------------------------------------------------------------------

test('共享单一 in-flight 锁：恰一个 in-flight useState、元素定义处接线、面板门控含 !inFlight、finally 释放、reset 门控同时引用两 state', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx', '面板');
  const shell = await readRequired('app/work/WorkShell.tsx', 'WorkShell');

  const failures = [];

  // WorkShell 恰一个 in-flight useState（与未决 state 同级的唯一 owner）。
  const statePattern = /const\s*\[\s*([A-Za-z0-9_$]+)\s*,\s*([A-Za-z0-9_$]+)\s*\]\s*=\s*(?:React\.)?useState/g;
  const inFlightStates = [];
  const pendingStateNames = [];
  let stateMatch;
  while ((stateMatch = statePattern.exec(shell)) !== null) {
    const statement = shell.slice(stateMatch.index, shell.indexOf(';', stateMatch.index) + 1);
    if (/inflight/i.test(statement)) {
      inFlightStates.push({ name: stateMatch[1], setter: stateMatch[2], index: stateMatch.index });
    }
    if (/pending|VerificationCommand|unknown/i.test(statement)) {
      pendingStateNames.push(stateMatch[1]);
    }
  }
  if (inFlightStates.length !== 1) {
    const names = inFlightStates.map((state) => state.name).join('/') || '（无）';
    failures.push(`in-flight useState 应恰有 1 个（WorkShell 唯一 owner，两挂载共享同一锁），实际 ${inFlightStates.length}：${names}`);
  }

  // 元素定义处接线：in-flight state 与 setter 都传入同一 <VerificationPanel> 定义。
  const definitions = [...shell.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*\(?\s*<VerificationPanel\b/g)];
  if (definitions.length !== 1) {
    failures.push(`<VerificationPanel 元素定义应恰有 1 处，实际 ${definitions.length}`);
  }
  if (definitions.length === 1 && inFlightStates.length === 1) {
    const { name, setter } = inFlightStates[0];
    const closing = shell.indexOf('/>', definitions[0].index);
    const definitionWindow = shell.slice(definitions[0].index, closing === -1 ? definitions[0].index + 900 : closing + 2);
    if (!new RegExp(`\\b${name}\\b`).test(definitionWindow)) {
      failures.push(`元素定义处未接线 in-flight state ${name}`);
    }
    if (!definitionWindow.includes(setter)) {
      failures.push(`元素定义处未接线 in-flight setter ${setter}`);
    }
  }

  // 面板发送/重试门控含 !inFlight；发送函数 finally 块以 false 释放锁。
  if (!/\binFlight\b/.test(panel)) {
    failures.push('待合入：面板未接线 inFlight（发送/重试门控尚未落地）');
  } else {
    if (!/!\s*[A-Za-z0-9_.$]*inFlight/i.test(panel)) {
      failures.push('面板发送/重试门控必须包含 !inFlight 形态守卫');
    }
    const functions = [];
    const functionPattern = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?[^;\n]*?=>/g;
    let fnMatch;
    while ((fnMatch = functionPattern.exec(panel)) !== null) {
      const name = fnMatch[1] ?? fnMatch[2];
      const open = panel.indexOf('{', fnMatch.index);
      if (open === -1 || open - fnMatch.index > 160) {
        continue;
      }
      const block = balancedBlock(panel, open);
      if (block !== null) {
        functions.push({ name, body: block.body });
      }
    }
    const sendFn = functions
      .filter((entry) => /\bfetch\s*\(/.test(entry.body))
      .sort((a, b) => a.body.length - b.body.length)[0];
    if (sendFn === undefined) {
      failures.push('未找到发送函数（in-flight finally 释放检查无从进行）');
    } else {
      const finallyAt = sendFn.body.search(/\bfinally\s*\{/);
      if (finallyAt === -1) {
        failures.push(`${sendFn.name} 缺少 finally 块（in-flight 锁必须在 finally 释放）`);
      } else {
        const open = sendFn.body.indexOf('{', finallyAt);
        const finallyBlock = open === -1 ? null : balancedBlock(sendFn.body, open);
        if (finallyBlock === null || !/inflight/i.test(finallyBlock.body) || !/\(\s*false\s*\)/.test(finallyBlock.body)) {
          failures.push(`${sendFn.name} 的 finally 块必须以 false 释放 in-flight 锁`);
        }
      }
    }
  }

  // reset 门控（别名一跳解析）：按钮 disabled={别名} → 解析别名的 const 定义；定义必须同时引用
  // 四类条件：未决 state 变量、in-flight state 变量、hydrated 取反形态（!hydrated 族）、
  // storageError 非空形态（!== null 或 truthy 皆可）。缺一即失败；不要求字面出现在 disabled={...} 内。
  if (inFlightStates.length === 1 && pendingStateNames.length >= 1) {
    const inFlightName = inFlightStates[0].name;
    const gateSatisfies = (definition) =>
      pendingStateNames.some((name) => definition.includes(name)) &&
      definition.includes(inFlightName) &&
      /!\s*[A-Za-z0-9_.$]*hydrat/i.test(definition) &&
      /[A-Za-z0-9_.$]*[sS]torage[Ee]rror/.test(definition);

    const disabledMatches = [...shell.matchAll(/disabled=\{\s*([A-Za-z0-9_$]+)\s*\}/g)];
    if (disabledMatches.length === 0) {
      failures.push('待合入：未找到 disabled={标识符} 形态的 reset 门控');
    } else {
      let satisfied = false;
      const attempted = [];
      for (const disabledMatch of disabledMatches) {
        const gateId = disabledMatch[1];
        const definitionMatch = shell.match(new RegExp(`const\\s+${gateId}\\s*=([^;]+);`));
        if (definitionMatch === null) {
          attempted.push(`${gateId}（const 定义未找到）`);
          continue;
        }
        attempted.push(gateId);
        if (gateSatisfies(definitionMatch[1])) {
          satisfied = true;
          break;
        }
      }
      if (!satisfied) {
        failures.push(
          `待合入：reset 门控别名解析后四条件缺一（未决 state / ${inFlightName} / !hydrated / storageError 非空）；已尝试：${attempted.join('；')}`,
        );
      }
    }

    // 早退守卫：handleReset 形态的重置处理函数内存在基于门控条件的 return。
    const resetFnMatch = shell.match(/function\s+([A-Za-z0-9_$]*[Rr]eset[A-Za-z0-9_$]*)\s*\(/);
    if (resetFnMatch === null) {
      failures.push('待合入：未找到 handleReset 形态的重置处理函数');
    } else {
      const fnAt = resetFnMatch.index;
      const open = shell.indexOf('{', fnAt);
      const block = open === -1 ? null : balancedBlock(shell, open);
      if (block === null) {
        failures.push(`${resetFnMatch[1]} 函数体解析失败`);
      } else if (!/\breturn\b/.test(block.body) || !/resetBlocked|[Ii]nFlight|[Hh]ydrated|[Ss]torage[Ee]rror/.test(block.body)) {
        failures.push(`${resetFnMatch[1]} 内缺少基于门控条件的早退 return（重置门控须在函数入口拦下）`);
      }
    }
  }

  // 未决存在时无任何自动"清除存储/清空未决"路径：WorkShell effect 块内不得出现 clear/未决置空。
  const effectPattern = /useEffect\s*\(/g;
  let effectMatch;
  while ((effectMatch = effectPattern.exec(shell)) !== null) {
    const open = shell.indexOf('{', effectMatch.index);
    const block = open === -1 ? null : balancedBlock(shell, open);
    if (block !== null && (/\.\s*clear\s*\(/.test(block.body) || /PendingCommand\s*\(\s*null\s*\)/.test(block.body))) {
      failures.push('WorkShell effect 内不得出现清除存储/清空未决的自动路径（未决在明确结果前不清空）');
    }
  }

  assert.deepEqual(failures, [], `in-flight 锁与 reset 门控结构未全过 → ${failures.join('；')}`);
});
