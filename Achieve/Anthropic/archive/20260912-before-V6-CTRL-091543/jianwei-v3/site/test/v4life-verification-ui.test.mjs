// V4-LIFE ENG01 核验面板 UI 源码不变量测试（TEST lane / TDD）。
//
// 被测冻结契约（FE 组件）：
//   - app/work/VerificationPanel.tsx 具名导出 VerificationPanel（props { caseId, actorId, projection, onRefresh }）；
//   - 面板含精确字符串「合成演示 / 候选岗位语义，非正式审批」；
//   - POST 端点 /api/v4life/cases/${caseId}/verification；verificationStatus 目标枚举不含 'claimed'
//     （'claimed' 只能是 append 初始值：允许作为展示标签/当前状态回退，不得作为可设目标）；
//   - 理由必填（理由为空时禁用提交/不发起 fetch）；
//   - 重试复用同一 commandId（重试路径不得调用任何命令编号生成器、不得组装新命令字面量）；
//   - 409 分支调用 onRefresh，且该分支不得自动重发 POST（无 fetch、无端点字符串）；
//   - 面板不含「审批/Receipt/批准/否决」字样（上述精确标注自身除外）；
//   - app/work/verification.module.css 存在且只含灰阶（hex/rgb 通道 r≈g≈b 视为灰阶合法，彩色即违规）；
//   - app/work/WorkShell.tsx 导入并渲染 VerificationPanel（desktop 与 mobile 挂点——源码里 JSX 标签出现即可）。
//
// 模式（同 v4-work-surface.test.mjs）：只读源码 + 正则/包含断言；花括号平衡提取等启发式规则
// 均为源码契约检查（非完整 AST 解析），契约依据在各断言处注明。断言不绑定无关空白/顺序/实现命名。
// ENG01 Control 纠偏补回归：另含"可执行行为测试"——切取 VerificationPanel.tsx 的
// ENG01-VERIFICATION-PURE-LOGIC 标记区间（纯 TS），写入 os.tmpdir() 临时目录动态 import 真实执行，
// 对 parseVerificationOutcome / canComposeCommand / 未决命令绑定判定跑行为矩阵（见文件末尾一节）。
//
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-verification-ui.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

async function readRequired(path) {
  try {
    return await readFile(new URL(path, root), 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      assert.fail(`文件不存在：${path}（FE lane 尚未落地，待集成）`);
    }
    throw error;
  }
}

/** 压缩全部空白（源码契约匹配用：消除换行/缩进/空格差异）。 */
function compact(source) {
  return source.replace(/\s+/g, '');
}

/** 从 open 索引的 '{' 起做花括号平衡提取；未闭合返回 null（源码契约启发式，非完整解析）。 */
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

/**
 * 收集"命令编号生成器"函数名：函数声明体或 const/let/var 初始化表达式中调用 randomUUID 的名字。
 * 契约依据：重试路径不得再生成 commandId —— 无论直接调 randomUUID 还是经包装函数（如 newCommandId）。
 */
function commandIdGeneratorNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
    const open = source.indexOf('{', match.index);
    if (open === -1) {
      continue;
    }
    const block = balancedBlock(source, open);
    if (block !== null && block.body.includes('randomUUID')) {
      names.add(match[1]);
    }
  }
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=[^;\n]*;/g)) {
    if (match[0].includes('randomUUID')) {
      names.add(match[1]);
    }
  }
  return names;
}

/**
 * 提取名字匹配 namePattern 的函数体：function/const/let/var 声明后首个 '{'（≤160 字符内）的平衡块；
 * 无块体（表达式箭头单行）则退路取 => 到最近分号/换行。找不到返回 null。
 */
function extractNamedFunctionBody(source, namePattern) {
  const declaration = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g;
  let match;
  while ((match = declaration.exec(source)) !== null) {
    const name = match[1] ?? match[2];
    if (!namePattern.test(name)) {
      continue;
    }
    const open = source.indexOf('{', match.index);
    if (open !== -1 && open - match.index <= 160) {
      const block = balancedBlock(source, open);
      if (block !== null) {
        return block.body;
      }
    }
    const arrow = source.indexOf('=>', match.index);
    if (arrow !== -1 && arrow - match.index <= 160) {
      const semi = source.indexOf(';', arrow);
      const eol = source.indexOf('\n', arrow);
      const ends = [semi, eol].filter((at) => at !== -1);
      return source.slice(arrow, ends.length === 0 ? source.length : Math.min(...ends));
    }
  }
  return null;
}

/**
 * 从出现位置定位其所在的 if 分支块：向前最近 `if`（≤300 字符内）→ 条件后首个 `{`（≤200 字符内）→
 * 平衡块。返回块体与跨度，供调用方校验出现位置确实落在块内（避免把无关代码当分支）。
 */
function enclosingIfBlock(source, fromIndex) {
  const back = source.lastIndexOf('if', fromIndex);
  if (back === -1 || fromIndex - back > 300) {
    return null;
  }
  const open = source.indexOf('{', back);
  if (open === -1 || open - back > 200) {
    return null;
  }
  const block = balancedBlock(source, open);
  if (block === null || fromIndex < back || fromIndex > block.end) {
    return null;
  }
  return block.body;
}

/** 单语句/三元退路：从出现位置取到最近的分号或换行为止。 */
function statementFrom(source, fromIndex) {
  const semi = source.indexOf(';', fromIndex);
  const eol = source.indexOf('\n', fromIndex);
  const ends = [semi, eol].filter((at) => at !== -1);
  return source.slice(fromIndex, ends.length === 0 ? source.length : Math.min(...ends));
}

// ---------------------------------------------------------------------------
// VerificationPanel 组件契约
// ---------------------------------------------------------------------------

test('VerificationPanel.tsx 存在且具名导出 VerificationPanel，props 契约含 caseId/actorId/projection/onRefresh', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  assert.match(panel, /export\s+(?:async\s+)?(?:function|const)\s+VerificationPanel/, '必须具名导出 VerificationPanel');
  for (const prop of ['caseId', 'actorId', 'projection', 'onRefresh']) {
    assert.match(panel, new RegExp(`\\b${prop}\\b`), `props 契约必须含 ${prop}`);
  }
  assert.match(panel, /onRefresh\s*\(/, 'onRefresh 必须可被调用（409 后刷新投影）');
});

test('面板含精确标注「合成演示 / 候选岗位语义，非正式审批」；除该标注外不含「审批/Receipt/批准/否决」字样', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  const BANNER = '合成演示 / 候选岗位语义，非正式审批';
  assert.ok(panel.includes(BANNER), '面板必须含精确字符串「合成演示 / 候选岗位语义，非正式审批」');

  // 精确标注自身含「审批」二字：先剥除标注的全部出现，再断言其余源码无禁词（契约：核验面板不是审批面）。
  const stripped = panel.split(BANNER).join('');
  assert.doesNotMatch(stripped, /审批|Receipt|receipt|批准|否决/, '面板不得出现审批/Receipt/批准/否决字样（精确标注除外）');
});

test('POST 端点指向 /api/v4life/cases/${caseId}/verification，且 verificationStatus 目标枚举不含 claimed', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  assert.match(
    panel,
    /\/api\/v4life\/cases\/\$\{[^}]+\}\/verification/,
    '必须 POST 到 /api/v4life/cases/${caseId}/verification',
  );
  assert.match(panel, /method:\s*['"]POST['"]/, '必须以 POST 发送核验命令');

  // 目标枚举（数组字面量形态的核验状态集合，成员/索引访问括号不算）不得包含 claimed；
  // 'claimed' 允许作为展示标签/当前状态回退（append 初始值），但不得成为可设目标。
  const enumArrays = [];
  for (const match of panel.matchAll(/\[[^[\]]*\]/g)) {
    const previous = panel[match.index - 1] ?? '';
    if (/[A-Za-z0-9_$)\]]/.test(previous)) {
      continue; // 前随标识符/右括号：成员或索引访问，不是数组字面量
    }
    enumArrays.push(match[0]);
  }
  const statusArrays = enumArrays.filter((literal) =>
    /['"](claimed|unverified|verified|contradicted|stale)['"]/.test(literal),
  );
  assert.ok(statusArrays.length > 0, '必须存在目标状态枚举（含核验状态值的数组字面量）');
  for (const literal of statusArrays) {
    assert.doesNotMatch(literal, /['"]claimed['"]/, 'verificationStatus 目标枚举不得包含 claimed');
  }
  assert.doesNotMatch(
    panel,
    /verificationStatus\s*[:=]\s*['"]claimed['"]/,
    '不得把 claimed 直接作为 verificationStatus 的目标值',
  );
});

test('理由必填：存在理由判空守卫与提交禁用态（理由为空时禁用/不发起 fetch）', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  assert.match(panel, /disabled/, '必须存在禁用态（理由为空时不可提交）');

  // 判空守卫允许经 trim 派生变量或纯函数（如 isSubmittableReason 内 reason.trim().length > 0），
  // 故按 reason 词干族匹配；disabled 禁用态为独立必要条件（上方已断言）。
  const flat = compact(panel);
  const stem = '[A-Za-z0-9_$.]*reason[A-Za-z0-9_$]*';
  const reasonGuard =
    new RegExp(`!${stem}`, 'i').test(flat) ||
    new RegExp(`${stem}\\.length>0`, 'i').test(flat) ||
    new RegExp(`${stem}\\.length===?0`, 'i').test(flat) ||
    new RegExp(`${stem}\\.trim\\(\\)===?["']{2}`, 'i').test(flat) ||
    new RegExp(`${stem}\\.trim\\(\\)\\.length<=?0`, 'i').test(flat) ||
    new RegExp(`${stem}\\.trim\\(\\)\\.length>0`, 'i').test(flat) ||
    new RegExp(`${stem}===?["']{2}`, 'i').test(flat);
  assert.ok(
    reasonGuard,
    '必须存在理由为空的显式判空守卫（如 !reason / reason.trim()===\'\' / trimmedReason.length > 0）',
  );
});

test('重试复用同一 commandId：存在可识别重试路径，不得调用命令编号生成器、不得组装新命令字面量', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  assert.match(panel, /randomUUID\s*\(/, '首次提交需能生成一次性 commandId');

  const retryBody = extractNamedFunctionBody(panel, /retry|resend|重试/i);
  assert.ok(retryBody !== null, '必须存在可识别的重试路径（函数名含 retry/resend/重试）');

  assert.doesNotMatch(retryBody, /randomUUID\s*\(/, '重试路径不得直接调用 randomUUID（必须复用同一 commandId）');
  for (const generator of commandIdGeneratorNames(panel)) {
    assert.doesNotMatch(
      retryBody,
      new RegExp(`\\b${generator}\\s*\\(`),
      `重试路径不得调用命令编号生成器 ${generator}()（必须复用同一 commandId）`,
    );
  }
  assert.doesNotMatch(
    compact(retryBody),
    /commandId\s*:/,
    '重试路径不得组装新命令字面量（必须原样重发已冻结的命令载荷）',
  );
});

test('409 VERSION_CONFLICT 分支：调用 onRefresh，且该分支不得自动重发 POST（无 fetch、无端点字符串）', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  const matches = [...panel.matchAll(/409/g)];
  assert.ok(matches.length > 0, '必须显式处理 409（VERSION_CONFLICT）');

  let sawRefresh = false;
  for (const match of matches) {
    const branch = enclosingIfBlock(panel, match.index) ?? statementFrom(panel, match.index);
    if (/onRefresh\s*\(/.test(branch)) {
      sawRefresh = true;
      assert.doesNotMatch(branch, /fetch\s*\(/, '409 分支不得自动重发 POST（分支内不得发起 fetch）');
      assert.doesNotMatch(branch, /\/verification/, '409 分支不得再次构造核验端点重发请求');
    }
  }
  assert.ok(sawRefresh, '409 分支必须调用 onRefresh()（版本冲突后刷新投影，而非自动重发）');
});

// ---------------------------------------------------------------------------
// verification.module.css：只含灰阶
// ---------------------------------------------------------------------------

test('verification.module.css 存在且所有颜色均为灰阶（hex/rgb 通道 r≈g≈b 容差 8；hsl 饱和度 0；无彩色关键字）', async () => {
  const css = await readRequired('app/work/verification.module.css');

  const violations = [];

  // hex：#rgb / #rgba / #rrggbb / #rrggbbaa（alpha 不参与灰阶判定）
  for (const match of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const hex = match[1];
    if (![3, 4, 6, 8].includes(hex.length)) {
      violations.push(`#${hex}（非法 hex 长度）`);
      continue;
    }
    const channels =
      hex.length <= 4
        ? [...hex.slice(0, 3)].map((c) => parseInt(c + c, 16))
        : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r, g, b] = channels;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 8) {
      violations.push(`#${hex}（rgb ${r},${g},${b} 非灰阶）`);
    }
  }

  // rgb()/rgba()：逗号形态与空格分隔形态都检查
  for (const match of css.matchAll(/(?:rgb|rgba)\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 8) {
      violations.push(`${match[0]}…（rgb 非灰阶）`);
    }
  }

  // hsl()/hsla()：饱和度必须为 0%
  for (const match of css.matchAll(/hsla?\(\s*\d+(?:deg|turn)?\s*[, ]\s*(\d+(?:\.\d+)?)%/g)) {
    if (Number(match[1]) > 0) {
      violations.push(`${match[0]}…（hsl 饱和度非 0）`);
    }
  }

  // 常见彩色 CSS 关键字（灰阶关键字如 white/black/gray 不在列）
  const colorKeywords = /\b(red|blue|green|orange|purple|pink|yellow|cyan|magenta|brown|teal|indigo|violet|gold|coral|crimson|salmon|aqua|fuchsia|lime|maroon|navy|olive|tomato|turquoise|beige)\b/gi;
  for (const match of css.matchAll(colorKeywords)) {
    violations.push(`颜色关键字 ${match[0]}`);
  }

  assert.deepEqual(violations, [], `verification.module.css 只允许灰阶，发现非灰阶颜色：${violations.join('；')}`);
});

// ---------------------------------------------------------------------------
// WorkShell：导入并渲染（desktop 与 mobile 挂点——源码 JSX 标签出现即可）
// ---------------------------------------------------------------------------

test('WorkShell.tsx 导入并渲染 VerificationPanel，JSX 挂点传入 caseId/actorId/projection/onRefresh', async () => {
  const shell = await readRequired('app/work/WorkShell.tsx');
  assert.match(shell, /import\s+[^;]*\bVerificationPanel\b/, 'WorkShell 必须导入 VerificationPanel');
  assert.match(shell, /['"]\.\/VerificationPanel['"]/, '必须从 ./VerificationPanel 导入');
  assert.match(shell, /<VerificationPanel\b/, '必须渲染 <VerificationPanel> JSX（desktop/mobile 挂点）');

  const at = shell.search(/<VerificationPanel\b/);
  const jsxWindow = shell.slice(at, at + 800);
  for (const prop of ['caseId', 'actorId', 'projection', 'onRefresh']) {
    assert.match(jsxWindow, new RegExp(`\\b${prop}=`), `<VerificationPanel> 必须传入 ${prop}`);
  }
});

// ---------------------------------------------------------------------------
// 可执行行为测试（ENG01 Control 纠偏补回归）：真实执行交付源码中的纯决策逻辑区。
// 执行方式：a) 断言 ENG01-VERIFICATION-PURE-LOGIC START/END 标记存在且 START 在 END 之前；
//   b) 切取区间文本，把区间内相对 import 再锚定到 app/work/ 真实源码（import type 会被
//      --experimental-strip-types 整体擦除，不触发模块解析）；
//   c) 写入 os.tmpdir() 下 mkdtempSync 临时目录的 .ts 文件，pathToFileURL 动态 import ——
//      这是对交付源码的真实执行，不是复写副本；import 失败即"纯逻辑区含不可擦除语法"失败；
//   d) finally 清理临时目录。
// 导出名容错：优先取预期名，其次按角色模式匹配；缺失则断言失败并在消息中列出实际导出（供报告指出）。
// ---------------------------------------------------------------------------

const MARKER_START = '// <!-- ENG01-VERIFICATION-PURE-LOGIC-START -->';
const MARKER_END = '// <!-- ENG01-VERIFICATION-PURE-LOGIC-END -->';

/** 行为矩阵共用命令（caseId/actorId/evidenceId 与绑定判定用例配套）。 */
const BEHAVIOR_COMMAND = {
  commandId: 'cmd-behavior-1',
  caseId: 'demo-sme-robot-500w',
  evidenceId: 'ev-x',
  actorId: 'actor-policy-li',
  verificationStatus: 'verified',
  reason: '行为矩阵核验理由。',
  expectedRev: 6,
};

/** 在动态加载的纯逻辑模块中解析预期导出：预期名优先，角色模式次之；缺失即断言失败并列出实际导出。 */
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
  assert.fail(
    `纯逻辑区缺少${role}导出${expectedName === null ? '' : `（预期名 ${expectedName}）`}；实际导出：${exported}（待 FE 纠偏合入）`,
  );
}

/** 切取纯逻辑区 → 相对 import 再锚定 → 临时目录动态 import → 执行 fn → finally 清理临时目录。 */
async function withPureLogicModule(fn) {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  const start = panel.indexOf(MARKER_START);
  const end = panel.indexOf(MARKER_END);
  assert.ok(start !== -1, 'VerificationPanel.tsx 缺少 ENG01-VERIFICATION-PURE-LOGIC-START 标记（待 FE 纠偏合入）');
  assert.ok(end !== -1, 'VerificationPanel.tsx 缺少 ENG01-VERIFICATION-PURE-LOGIC-END 标记（待 FE 纠偏合入）');
  assert.ok(start < end, 'ENG01-VERIFICATION-PURE-LOGIC-START 必须出现在 END 之前');
  const region = panel.slice(start + MARKER_START.length, end);
  assert.ok(region.trim().length > 0, 'ENG01-VERIFICATION-PURE-LOGIC 区间为空');

  // 区间内相对 import 再锚定到 app/work/ 真实源码（同一份被引用文件，非副本逻辑）。
  const workDirUrl = new URL('app/work/', root);
  const reanchor = (whole, keyword, quote, specifier) => {
    const absolute = pathToFileURL(fileURLToPath(new URL(specifier, workDirUrl))).href;
    return `${keyword}${quote}${absolute}${quote}`;
  };
  const reanchored = region
    .replace(/(from\s+)(['"])(\.\.?\/[^'"]*)\2/g, reanchor)
    .replace(/(import\s+)(['"])(\.\.?\/[^'"]*)\2/g, reanchor);

  const dir = mkdtempSync(join(tmpdir(), 'v4life-verification-pure-'));
  try {
    const file = join(dir, 'verification-pure-logic.ts');
    writeFileSync(file, reanchored, 'utf8');
    let loaded;
    try {
      loaded = await import(pathToFileURL(file).href);
    } catch (error) {
      assert.fail(
        `纯逻辑区含不可擦除语法或动态加载失败（须为 --experimental-strip-types 可执行的纯 TS：无 JSX、无 enum/参数属性等需转换语法）：${error?.message ?? error}`,
      );
    }
    return await fn(loaded);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/** 绑定判定 verdict 归一：字符串枚举 / 布尔 / {kind|status|verdict|state|binding|matched} 形状均接受。 */
const MATCH_VERDICT = /^(match|bound|current|ok|valid|retry)/i;
const STALE_VERDICT = /stale|mismatch|expired|unbound|invalid|reset|detached/i;

function verdictOf(result) {
  if (typeof result === 'string') return result;
  if (typeof result === 'boolean') return result ? 'match' : 'stale';
  if (result !== null && typeof result === 'object') {
    const value = result.kind ?? result.status ?? result.verdict ?? result.state ?? result.binding ?? result.matched;
    if (typeof value === 'string') return value;
    if (value === true) return 'match';
    if (value === false) return 'stale';
  }
  return undefined;
}

/** 调用形态容错：依次尝试 (command, context)、(command 含绑定字段, context)、({command, caseId, actorId})、(command 含绑定字段, caseId, actorId)。 */
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

test('纯逻辑区标记存在且 START 在 END 之前，区间非空', async () => {
  await withPureLogicModule(async () => true);
});

test('纯逻辑区可被 --experimental-strip-types 动态加载执行（真实执行交付源码）', async () => {
  await withPureLogicModule(async (mod) => {
    assert.ok(typeof mod === 'object' && mod !== null, '动态 import 应返回模块命名空间');
  });
});

test('parseVerificationOutcome 行为矩阵：绑定校验、非 JSON/缺绑定/坏 rev/5xx 一律 unknown、4xx 精确映射', async () => {
  await withPureLogicModule(async (mod) => {
    const parseFn = resolveExport(mod, 'parseVerificationOutcome', /parse/i, '响应解析');

    const rows = [
      { name: '201+accepted+证据绑定匹配', status: 201, body: '{"status":"accepted","rev":7,"evidence":{"evidenceId":"ev-x","verificationStatus":"verified"}}', kind: 'accepted' },
      { name: '201+accepted+证据绑定不匹配（不得当成功）', status: 201, body: '{"status":"accepted","rev":7,"evidence":{"evidenceId":"ev-y"}}', kind: 'unknown' },
      { name: '200+replayed+证据绑定匹配', status: 200, body: '{"status":"replayed","rev":7,"evidence":{"evidenceId":"ev-x"}}', kind: 'replayed' },
      { name: '200+非 JSON 文本（HTML）', status: 200, body: '<html>bad</html>', kind: 'unknown' },
      { name: '200+空串', status: 200, body: '', kind: 'unknown' },
      { name: '200+accepted 缺 evidence 绑定', status: 200, body: '{"status":"accepted","rev":7}', kind: 'unknown' },
      { name: '200+accepted rev 非整数（字符串 "7"）', status: 200, body: '{"status":"accepted","rev":"7","evidence":{"evidenceId":"ev-x"}}', kind: 'unknown' },
      { name: '500+JSON 错误体（5xx 一律 unknown）', status: 500, body: '{"error":"INTERNAL_ERROR"}', kind: 'unknown' },
      { name: '500+HTML（5xx 一律 unknown）', status: 500, body: '<html>boom</html>', kind: 'unknown' },
      { name: '409+VERSION_CONFLICT', status: 409, body: '{"error":"VERSION_CONFLICT"}', kind: 'version_conflict', errorCode: 'VERSION_CONFLICT' },
      { name: '403+ROLE_MISMATCH', status: 403, body: '{"error":"ROLE_MISMATCH"}', kind: 'rejected', errorCode: 'ROLE_MISMATCH' },
      { name: '404+EVIDENCE_NOT_FOUND', status: 404, body: '{"error":"EVIDENCE_NOT_FOUND"}', kind: 'rejected', errorCode: 'EVIDENCE_NOT_FOUND' },
      { name: '400+INVALID_ENGINE_INPUT', status: 400, body: '{"error":"INVALID_ENGINE_INPUT"}', kind: 'rejected', errorCode: 'INVALID_ENGINE_INPUT' },
    ];

    const failures = [];
    for (const row of rows) {
      let actualKind = '（无可识别结果）';
      let actualErrorCode;
      try {
        const result = parseFn(row.status, row.body, BEHAVIOR_COMMAND);
        if (typeof result === 'string') {
          actualKind = result;
        } else if (result !== null && typeof result === 'object') {
          // FE 实际导出字段名为 outcome（Control 规格写作 kind）——按名称容错对齐，两者都接受。
          actualKind = result.kind ?? result.outcome ?? result.status;
          actualErrorCode = result.errorCode;
        }
      } catch (error) {
        actualKind = `（抛出异常：${error?.message ?? error}）`;
      }
      if (actualKind !== row.kind) {
        failures.push(`${row.name}：kind 实际 ${String(actualKind)}，预期 ${row.kind}`);
      }
      if (row.errorCode !== undefined && actualErrorCode !== row.errorCode) {
        failures.push(`${row.name}：errorCode 实际 ${String(actualErrorCode)}，预期 ${row.errorCode}`);
      }
    }
    assert.deepEqual(failures, [], `parseVerificationOutcome 行为矩阵未全过 → ${failures.join('；')}`);
  });
});

test('canComposeCommand：unknownCommand=null 可组装；非 null（结果未知）禁止组装新命令', async () => {
  await withPureLogicModule(async (mod) => {
    const composeFn = resolveExport(mod, 'canComposeCommand', /compose/i, '未决命令守卫');

    const failures = [];
    if (composeFn({ unknownCommand: null }) !== true) {
      failures.push(`unknownCommand=null 应返回 true（可组装），实际 ${String(composeFn({ unknownCommand: null }))}`);
    }
    for (const pending of [{ unknownCommand: BEHAVIOR_COMMAND }, { unknownCommand: {} }]) {
      if (composeFn(pending) !== false) {
        failures.push(`unknownCommand 非 null 应返回 false（结果未知禁止组装新命令），实际 ${String(composeFn(pending))}`);
      }
    }
    assert.deepEqual(failures, [], `canComposeCommand 行为未全过 → ${failures.join('；')}`);
  });
});

test('未决命令绑定判定：command 与当前 caseId/actorId 一致可重试；caseId 或 actorId 不一致 → stale', async () => {
  await withPureLogicModule(async (mod) => {
    const bindFn = resolveExport(mod, null, /bind|bound|stale|match/i, '未决命令绑定判定');

    const failures = [];

    const consistent = bindVerdicts(bindFn, BEHAVIOR_COMMAND, BEHAVIOR_COMMAND.caseId, BEHAVIOR_COMMAND.actorId);
    if (consistent.length === 0) {
      failures.push('无法以任何已知调用形态取得绑定判定结果（一致输入）');
    } else if (!consistent.some((verdict) => MATCH_VERDICT.test(verdict))) {
      failures.push(`caseId/actorId 一致应可重试（match），实际 verdicts=${consistent.join('/')}`);
    }

    for (const [label, command] of [
      ['caseId 不一致', { ...BEHAVIOR_COMMAND, caseId: 'other-case' }],
      ['actorId 不一致', { ...BEHAVIOR_COMMAND, actorId: 'actor-credit-zhang' }],
    ]) {
      const stale = bindVerdicts(bindFn, command, BEHAVIOR_COMMAND.caseId, BEHAVIOR_COMMAND.actorId);
      if (stale.length === 0) {
        failures.push(`${label}：无法以任何已知调用形态取得绑定判定结果`);
      } else if (!stale.some((verdict) => STALE_VERDICT.test(verdict))) {
        failures.push(`${label}应 stale（禁用重试/新提交，须显式复位），实际 verdicts=${stale.join('/')}`);
      }
    }

    assert.deepEqual(failures, [], `未决命令绑定判定未全过 → ${failures.join('；')}`);
  });
});

// ---------------------------------------------------------------------------
// 双端切换不得绕过未决保护（ENG01 修正版补充复验）：
//   结构断言防"两个独立未决实例"——WorkShell 唯一持有未决 useState，两处挂点受控共享；
//   行为断言（withPureLogicModule 真实执行纯逻辑区）证明共享单一未决 P 时任何一端都无法绕过。
// ---------------------------------------------------------------------------

test('WorkShell 未决命令单一持有：<VerificationPanel> 元素单定义、两处挂载引用、父级唯一未决 state、定义处受控传参', async () => {
  const shell = await readRequired('app/work/WorkShell.tsx');

  const failures = [];

  // 单一未决状态 = 元素单定义 + 多处引用：元素定义恰有 1 处（const <name> = (<VerificationPanel .../>)，
  // 容错无括号形态）。若出现两个独立定义（各持 props），即为两个独立实例的形态，必须失败。
  const definitions = [
    ...shell.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*\(?\s*<VerificationPanel\b/g),
  ];
  if (definitions.length !== 1) {
    failures.push(`<VerificationPanel 元素定义应恰有 1 处（单定义多处引用），实际 ${definitions.length}`);
  }

  // 父级恰有一个未决命令 useState：声明语句含 pending/VerificationCommand/unknown 之一（不绑定具体命名）。
  const statePattern = /const\s*\[\s*([A-Za-z0-9_$]+)\s*,\s*([A-Za-z0-9_$]+)\s*\]\s*=\s*(?:React\.)?useState/g;
  const pendingStates = [];
  let stateMatch;
  while ((stateMatch = statePattern.exec(shell)) !== null) {
    const statement = shell.slice(stateMatch.index, shell.indexOf(';', stateMatch.index) + 1);
    if (/pending|VerificationCommand|unknown/i.test(statement)) {
      pendingStates.push({ name: stateMatch[1], setter: stateMatch[2], index: stateMatch.index });
    }
  }
  if (pendingStates.length !== 1) {
    const names = pendingStates.map((state) => state.name).join('/') || '（无）';
    failures.push(`未决命令 useState 应恰有 1 个（WorkShell 唯一持有，防两个独立实例），实际 ${pendingStates.length}：${names}`);
  }

  const definitionAt = definitions.length === 1 ? definitions[0].index : shell.length;
  for (const state of pendingStates) {
    if (state.index > definitionAt) {
      failures.push(`未决命令 useState（${state.name}）必须声明于元素定义之前（组件体唯一持有）`);
    }
  }

  // 定义处受控传参：pendingCommand 值 = 唯一 state 变量；onPendingCommandChange 接唯一 setter。
  // （元素单定义处接线一次，随后所有挂载引用共享同一未决状态——这就是单一未决状态的正确形态。）
  if (definitions.length === 1 && pendingStates.length === 1) {
    const { name, setter } = pendingStates[0];
    const closing = shell.indexOf('/>', definitions[0].index);
    const definitionWindow = shell.slice(definitions[0].index, closing === -1 ? definitions[0].index + 900 : closing + 2);
    const value = definitionWindow.match(/pendingCommand=\{\s*([A-Za-z0-9_$]+)/);
    if (value === null) {
      failures.push('元素定义处未传入 pendingCommand=');
    } else if (value[1] !== name) {
      failures.push(`元素定义处 pendingCommand 值应为唯一 state 变量 ${name}，实际 ${value[1]}`);
    }
    const handlerAt = definitionWindow.search(/onPendingCommandChange=/);
    if (handlerAt === -1) {
      failures.push('元素定义处未传入 onPendingCommandChange=');
    } else if (!definitionWindow.slice(handlerAt, handlerAt + 160).includes(setter)) {
      failures.push(`元素定义处 onPendingCommandChange 应接到唯一 setter ${setter}`);
    }
  }

  // 多处挂载引用：元素变量以 {name} 形式在 ≥2 个位置挂载（desktop 与 mobile pane 各一处），
  // 引用位置互不相同——单定义共享同一 React 元素与同一未决状态。
  if (definitions.length === 1) {
    const elementName = definitions[0][1];
    const mounts = [...shell.matchAll(new RegExp(`\\{\\s*${elementName}\\s*\\}`, 'g'))];
    if (mounts.length < 2) {
      failures.push(`元素 ${elementName} 应在 ≥2 处被引用挂载（desktop 与 mobile pane 各一处），实际 ${mounts.length}`);
    }
  }

  assert.deepEqual(failures, [], `WorkShell 未决命令单实例结构未全过 → ${failures.join('；')}`);
});

test('VerificationPanel 受控化：pendingCommand/onPendingCommandChange 以 props 进入（别名解构可），无本地未决 state，写入仅经 prop 通道，放弃入口移除', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');
  const css = await readRequired('app/work/verification.module.css');

  const failures = [];

  // props 契约：pendingCommand / onPendingCommandChange 声明 + 组件签名解构（允许别名形态）。
  if (!/\bpendingCommand\s*[:?]/.test(panel)) {
    failures.push('props 契约缺少 pendingCommand');
  }
  if (!/\bonPendingCommandChange\s*[:?]/.test(panel)) {
    failures.push('props 契约缺少 onPendingCommandChange');
  }
  const signatureAt = panel.search(/export\s+function\s+VerificationPanel/);
  if (signatureAt === -1) {
    failures.push('未找到 VerificationPanel 组件签名');
  }
  const signatureWindow = signatureAt === -1 ? '' : panel.slice(signatureAt, signatureAt + 800);
  if (signatureAt !== -1) {
    for (const prop of ['pendingCommand', 'onPendingCommandChange']) {
      if (!new RegExp(`\\b${prop}\\b`).test(signatureWindow)) {
        failures.push(`组件签名解构缺少 ${prop}`);
      }
    }
  }

  // 写入通道识别：onPendingCommandChange 可解构为任意别名（如 onPendingCommandChange: setPendingCommand），
  // 别名调用就是 prop 通道本身，不算本地 setter。合法写入通道 = 本名 + 解构中绑定到
  // onPendingCommandChange 的别名。
  const aliasMatch = signatureWindow.match(/onPendingCommandChange\s*:\s*([A-Za-z0-9_$]+)/);
  const allowedWriters = ['onPendingCommandChange', ...(aliasMatch !== null ? [aliasMatch[1]] : [])];
  if (aliasMatch !== null && /\bpendingCommand\s*:\s*([A-Za-z0-9_$]+)/.test(signatureWindow) === false) {
    failures.push('存在 onPendingCommandChange 别名解构但缺少 pendingCommand 的解构读取（受控受写应成对）');
  }

  // 组件不再自持未决命令 state：useState 解构变量不得是未决命令族命名，
  // useState 声明语句不得涉及 VerificationCommand（传输中 pending 布尔旗标不受限）。
  // 解构别名（如 onPendingCommandChange: setPendingCommand）不是 useState，不受本条影响。
  const statePattern = /const\s*\[\s*([A-Za-z0-9_$]+)\s*,\s*([A-Za-z0-9_$]+)\s*\]\s*=\s*useState/g;
  let stateMatch;
  while ((stateMatch = statePattern.exec(panel)) !== null) {
    const statement = panel.slice(stateMatch.index, panel.indexOf(';', stateMatch.index) + 1);
    if (/pendingCommand|unknownCommand|verificationPending/i.test(stateMatch[1]) || /VerificationCommand/.test(statement)) {
      failures.push(`组件内不得自持未决命令 state：发现 ${stateMatch[1]} = useState...（未决 state 已上提 WorkShell）`);
    }
  }

  // 写入仅经 prop 通道：组件内任何 setXxxCommand( 形态的调用，都必须是 onPendingCommandChange
  // 本名或其已绑定别名；未在解构中绑定的同名调用视为本地 state 直写，必须失败。
  const writerNames = [
    ...new Set([...panel.matchAll(/\b(set[A-Za-z0-9_]*Command)\s*\(/g)].map((match) => match[1])),
  ];
  for (const name of writerNames) {
    if (!allowedWriters.includes(name)) {
      failures.push(`写入未决命令只能经 onPendingCommandChange（或其解构别名）：发现未绑定通道 ${name}()`);
    }
  }
  if (!allowedWriters.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(panel))) {
    failures.push('组件应有未决状态写入通道被实际调用（onPendingCommandChange 本名或别名）');
  }

  // 移除"放弃未决命令"清空入口（函数 / 按钮文案 / 样式类，源码断言）。
  for (const banned of ['handleDiscardPending', '放弃未决命令', 'discardBtn']) {
    if (panel.includes(banned)) {
      failures.push(`VerificationPanel.tsx 仍存在被移除入口：${banned}`);
    }
  }
  if (css.includes('discardBtn')) {
    failures.push('verification.module.css 仍存在 discardBtn 样式');
  }

  assert.deepEqual(failures, [], `VerificationPanel 受控化结构未全过 → ${failures.join('；')}`);
});

test('双端切换不得绕过未决保护：共享未决 P 时两端均禁组装、原端 match 可重试、异端 stale 禁重试、回原绑定恢复、重试载荷逐字段一致', async () => {
  await withPureLogicModule(async (mod) => {
    const composeFn = resolveExport(mod, 'canComposeCommand', /compose/i, '未决命令守卫');
    const bindFn = resolveExport(mod, null, /bind|bound|stale|match/i, '未决命令绑定判定');
    const buildFn = resolveExport(mod, 'buildVerificationRequestBody', /build|request|body/i, '重试载荷构造');

    // 共享单一未决命令 P（绑定 caseId=X、actorId=Y）——desktop/mobile 两挂点切换共享同一 state。
    const P = {
      commandId: 'cmd-pending-1',
      caseId: 'case-x',
      evidenceId: 'ev-x',
      actorId: 'actor-y',
      verificationStatus: 'verified',
      reason: '未决绑定理由。',
      expectedRev: 9,
    };

    const failures = [];

    // 实例1（case/actor = X/Y）：不得组装新命令；可重试同一命令（match）。
    if (composeFn({ unknownCommand: P }) !== false) {
      failures.push('实例1（X/Y）：存在未决 P 时 canComposeCommand 应为 false（不得组装新命令）');
    }
    const instance1 = bindVerdicts(bindFn, P, 'case-x', 'actor-y');
    if (!instance1.some((verdict) => MATCH_VERDICT.test(verdict))) {
      failures.push(`实例1（X/Y）：原绑定应 match（可重试同一命令），实际 ${instance1.join('/') || '（无可识别结果）'}`);
    }

    // 实例2（切到 actor Z / case W）：仍不得组装；重试禁用（stale）。
    for (const [label, caseId, actorId] of [
      ['切换到 actor Z', 'case-x', 'actor-z'],
      ['切换到 case W', 'case-w', 'actor-y'],
    ]) {
      if (composeFn({ unknownCommand: P }) !== false) {
        failures.push(`${label}：存在未决 P 时 canComposeCommand 应为 false（任何一端都不得绕过）`);
      }
      const verdicts = bindVerdicts(bindFn, P, caseId, actorId);
      if (!verdicts.some((verdict) => STALE_VERDICT.test(verdict))) {
        failures.push(`${label}：绑定应 stale（禁用重试），实际 ${verdicts.join('/') || '（无可识别结果）'}`);
      }
    }

    // 结论：回到原绑定才恢复 match。
    const restored = bindVerdicts(bindFn, P, 'case-x', 'actor-y');
    if (!restored.some((verdict) => MATCH_VERDICT.test(verdict))) {
      failures.push(`回到原绑定（X/Y）应恢复 match，实际 ${restored.join('/') || '（无可识别结果）'}`);
    }

    assert.deepEqual(failures, [], `双端切换未决保护行为未全过 → ${failures.join('；')}`);

    // 未决不可覆盖：重试载荷与原冻结载荷逐字段一致（HTTP 命令六字段；重试 = 同一原载荷，无新命令字面量）。
    const expectedBody = {
      commandId: P.commandId,
      expectedRev: P.expectedRev,
      evidenceId: P.evidenceId,
      actorId: P.actorId,
      verificationStatus: P.verificationStatus,
      reason: P.reason,
    };
    const snapshot = { ...P };
    const body = buildFn(P);
    assert.deepEqual(body, expectedBody, 'buildVerificationRequestBody(P) 必须与原冻结载荷逐字段一致（无新增/缺省字段）');
    assert.deepEqual(buildFn(P), body, '重试载荷构造必须确定（两次构造一致）');
    assert.deepEqual(P, snapshot, 'buildVerificationRequestBody 不得改写未决命令对象');
  });
});

test('恢复接线：effect 内禁止自动发送；未决清空只允许发生在明确结果（accepted/replayed/version_conflict/rejected）之后', async () => {
  const panel = await readRequired('app/work/VerificationPanel.tsx');

  const failures = [];

  // 恢复建立未决态但禁止自动发送：任何 useEffect 体内不得触发发送/提交路径。
  const effectPattern = /useEffect\s*\(/g;
  let effectMatch;
  while ((effectMatch = effectPattern.exec(panel)) !== null) {
    const open = panel.indexOf('{', effectMatch.index);
    const block = open === -1 ? null : balancedBlock(panel, open);
    if (block !== null && /sendVerification|handleSubmit|handleRetry|\.save\s*\(|\bfetch\s*\(/.test(block.body)) {
      failures.push('useEffect 内不得触发发送/提交/存盘（恢复建立未决态但禁止自动发送）');
    }
  }

  // 清除仅在明确结果之后：未决清空（本名或别名写 null）有两种合规形态——
  //   a) 直写点向前回溯命中四类明确结果判定词；
  //   b) 位于"受守卫清理 helper"内部：该 helper 函数体同时含 storage clear(commandId 绑定)
  //      与 commandId 同源守卫（ref 比对形态可）；此时改为强校验 helper 的每个调用点
  //      都必须位于明确结果分支（helper 声明行除外）。两种形态都不得绕过"终结才清理"。
  function smallestEnclosingFunction(source, offset) {
    const functionPattern = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?[^;\n]*?=>/g;
    let best = null;
    let match;
    while ((match = functionPattern.exec(source)) !== null) {
      const open = source.indexOf('{', match.index);
      if (open === -1 || open - match.index > 160) {
        continue;
      }
      const block = balancedBlock(source, open);
      if (block === null || offset < block.start || offset > block.end) {
        continue;
      }
      if (best === null || block.end - block.start < best.end - best.start) {
        best = { ...block, name: match[1] ?? match[2] };
      }
    }
    return best;
  }

  const clearPattern = /\b(?:setPendingCommand|onPendingCommandChange|setUnknownCommand|setVerificationPendingCommand)\s*\(\s*null\s*\)/g;
  const guardedHelpers = new Set();
  for (const match of panel.matchAll(clearPattern)) {
    const before = panel.slice(Math.max(0, match.index - 800), match.index);
    const hasVerdict = /\b(?:accepted|replayed|version_conflict|rejected)\b/.test(before);
    const enclosing = smallestEnclosingFunction(panel, match.index);
    const isGuardedHelper =
      enclosing !== null &&
      /\.clear\s*\(\s*[A-Za-z0-9_.$]*commandId/.test(enclosing.body) &&
      /commandId\s*!==?\s*|commandId\s*===?\s*/.test(enclosing.body);
    if (isGuardedHelper) {
      guardedHelpers.add(enclosing.name);
    } else if (!hasVerdict) {
      failures.push(`未决清空必须发生在明确结果之后（offset ${match.index} 处向前未找到 accepted/replayed/version_conflict/rejected 判定，且不在受 commandId 守卫的清理 helper 内）`);
    }
  }
  for (const helperName of guardedHelpers) {
    for (const callMatch of panel.matchAll(new RegExp(`\\b${helperName}\\s*\\(`, 'g'))) {
      const before = panel.slice(Math.max(0, callMatch.index - 40), callMatch.index).trim();
      if (/function$/.test(before)) {
        continue; // helper 声明行本身
      }
      const callBefore = panel.slice(Math.max(0, callMatch.index - 800), callMatch.index);
      if (!/\b(?:accepted|replayed|version_conflict|rejected)\b/.test(callBefore)) {
        failures.push(`清理入口 ${helperName}() 的调用点必须位于明确结果分支（offset ${callMatch.index} 处向前未找到判定词）`);
      }
    }
  }

  assert.deepEqual(failures, [], `恢复接线语义未全过 → ${failures.join('；')}`);
});
