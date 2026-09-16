// V5 ROWS · 前端契约测试（重写：横条总览 + HTTP 联动版）。
// 覆盖：文件清单存在性；隔离契约（无 v4life、无 lib/** 运行时 import，type-only 允许且仅限
// shared-types）；CSS palette（全部 hex = 灰度 r=g=b 或三个信号色）；关键 UI 字符串；
// 请求构造契约（requestId / expectedVersion / actorRole:'business'）；409 保留草稿逻辑
// （rows-logic.ts 纯函数真实执行 + 源码断言"只有成功才清空草稿"）。
//
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const FRONT_DIR = 'app/v5-preview';
const dir = (p) => join(siteRoot, p);
const read = (p) => readFileSync(dir(p), 'utf8');

// ---------- 1) 文件清单 ----------

const FRONTEND_FILES = [
  'app/v5-preview/page.tsx',
  'app/v5-preview/rows-view.tsx',
  'app/v5-preview/domain-row.tsx',
  'app/v5-preview/todo-card.tsx',
  'app/v5-preview/chat-panel.tsx',
  'app/v5-preview/api-client.ts',
  'app/v5-preview/rows-logic.ts',
  'app/v5-preview/preview.module.css',
];

/** 旧方案文件（拼图/四列/详情页/角色切换/localStorage 事实源）必须已移除。 */
const REMOVED_FILES = [
  'preview-state.tsx',
  'overview-mobile.tsx',
  'overview-landscape.tsx',
  'detail-workspace.tsx',
  'progress-ruler.tsx',
  'icons.tsx',
];

test('v5-preview 文件清单：新横条方案齐备、旧方案文件已移除、目录无多余文件', () => {
  for (const f of FRONTEND_FILES) readFileSync(dir(f));
  const present = new Set(readdirSync(dir(FRONT_DIR)));
  for (const name of REMOVED_FILES) {
    assert.equal(present.has(name), false, `旧文件必须删除：${name}`);
  }
  const expected = new Set(FRONTEND_FILES.map((p) => p.replace(`${FRONT_DIR}/`, '')));
  assert.deepEqual(
    [...present].sort(),
    [...expected].sort(),
    '目录必须恰好由新方案文件组成（不得残留旧实现或他人临时文件）',
  );
});

// ---------- 2) 隔离契约 ----------

const sources = new Map(FRONTEND_FILES.map((p) => [p, read(p)]));

/** 去除 JS/TSX 注释（仅用于"不得出现"类检查，避免说明性文字误报；本目录源码无 http:// 字面量）。 */
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('隔离：不引用 v4life / api/v4；不再使用 localStorage/sessionStorage 事实源', () => {
  for (const [p, src] of sources) {
    assert.ok(!src.includes('v4life'), `${p} 不得出现 v4life`);
    assert.ok(!src.includes('/api/v4'), `${p} 不得出现 /api/v4 路由`);
    assert.doesNotMatch(stripJsComments(src), /localStorage|sessionStorage/, `${p} 不得把浏览器存储当业务事实源`);
  }
});

/** 独立的 `import type {...} from '...'` 语句（多行命名导入兼容）。 */
const TYPE_IMPORT_RE = /^import\s+type\s[\s\S]*?from\s*['"]([^'"]+)['"];?[ \t]*$/gm;

function stripTypeOnlyImports(src) {
  return src.replace(TYPE_IMPORT_RE, '');
}

test('隔离：lib/** 仅允许 type-only import，且仅限 lib/v5-preview/shared-types', () => {
  for (const [p, src] of sources) {
    for (const match of src.matchAll(TYPE_IMPORT_RE)) {
      const specifier = match[1];
      if (specifier.includes('lib/')) {
        assert.match(
          specifier,
          /lib\/v5-preview\/shared-types$/,
          `${p} 对 lib 的类型导入仅允许 shared-types，实际：${specifier}`,
        );
      }
    }
    const runtime = stripTypeOnlyImports(src);
    assert.doesNotMatch(
      runtime,
      /from\s*['"][^'"]*lib\//,
      `${p} 存在对 lib/** 的运行时 import（类型经 import type 擦除后才允许）`,
    );
    assert.doesNotMatch(runtime, /import\s*\(\s*['"][^'"]*lib\//, `${p} 不得动态 import lib/**`);
    assert.doesNotMatch(runtime, /\brequire\s*\(/, `${p} 不得使用 require`);
  }
});

test('隔离：HTTP 只指向 /api/v5-preview/** 四个冻结端点', () => {
  const client = sources.get('app/v5-preview/api-client.ts');
  const endpoints = client.match(/['"`]\/api\/v5-preview[^'"`]*['"`]/g) ?? [];
  const allowed = new Set([
    "'/api/v5-preview'",
    "'/api/v5-preview/project'",
    "'/api/v5-preview/notes'",
    "'/api/v5-preview/messages'",
    "'/api/v5-preview/demo/seed'",
  ]);
  for (const e of endpoints) {
    assert.ok(allowed.has(e), `出现未冻结的端点字符串：${e}`);
  }
  assert.ok(endpoints.length >= 4, 'api-client 必须以字面量引用全部冻结端点');
  for (const [p, src] of sources) {
    if (p === 'app/v5-preview/api-client.ts') continue;
    assert.ok(!src.includes('fetch('), `${p} 只有 api-client 允许 fetch`);
  }
});

// ---------- 3) CSS palette ----------

const SIGNAL_COLORS = new Set(['1a7f37', '9a6700', 'cf222e']);
const HEX_RE = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

function isGrayscale(body) {
  // #abc / #abcd： shorthand 灰度要求前三位相同。
  if (body.length === 3 || body.length === 4) {
    return body[0] === body[1] && body[1] === body[2];
  }
  // #aabbcc / #aabbccdd：三个颜色通道的两两 hex 对必须一致。
  const r = body.slice(0, 2);
  const g = body.slice(2, 4);
  const b = body.slice(4, 6);
  return r === g && g === b;
}

test('CSS palette：app/v5-preview 全部 hex 必须为灰度(r=g=b)或三个信号色', () => {
  const found = new Map();
  for (const [p, src] of sources) {
    for (const match of src.matchAll(HEX_RE)) {
      const body = match[1].toLowerCase();
      found.set(`${p}#${body}`, { p, body });
    }
  }
  assert.ok(found.size >= 8, '样式应存在足够的灰度色值（抽取不能为空）');
  assert.ok([...found.values()].some((c) => SIGNAL_COLORS.has(c.body)), '抽样必须覆盖到信号色（状态灯在用）');
  for (const [key, { p, body }] of found) {
    const ok = isGrayscale(body) || SIGNAL_COLORS.has(body);
    assert.ok(ok, `${key} 既非灰度也非允许的信号色（文件 ${p}）`);
  }
  // 三个信号色必须以 CSS 变量形式定义。
  const css = sources.get('app/v5-preview/preview.module.css');
  assert.match(css, /--sig-green:\s*#1a7f37/);
  assert.match(css, /--sig-yellow:\s*#9a6700/);
  assert.match(css, /--sig-red:\s*#cf222e/);
});

test('颜色纪律：信号色只出现在状态灯类；分段条/表单反馈只允许灰度', () => {
  const css = sources.get('app/v5-preview/preview.module.css');
  const sigLines = css.split('\n').filter((line) => /--sig-(green|yellow|red)\b/.test(line));
  for (const line of sigLines) {
    assert.match(
      line,
      /lamp(Green|Yellow|Red)|--sig-(green|yellow|red):\s*#/,
      `信号色只能用于状态灯（P2-5 收敛后表单反馈不再用红绿），越界行：${line.trim()}`,
    );
  }
  for (const seg of ['segDone', 'segCurrent', 'segPending']) {
    const rule = css.slice(css.indexOf(`.${seg} {`), css.indexOf(`.${seg} {`) + 120);
    assert.doesNotMatch(rule, /--sig-/, `${seg} 分段条不得使用信号色`);
  }
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '必须尊重 prefers-reduced-motion');
  assert.match(css, /:focus-visible/, '焦点必须可见');
});

// ---------- 4) 关键 UI 字符串与结构 ----------

test('关键 UI 字符串：预览标注/演示控制/提交材料/项目沟通/冲突横幅', () => {
  const page = sources.get('app/v5-preview/page.tsx');
  const todo = sources.get('app/v5-preview/todo-card.tsx');
  const chat = sources.get('app/v5-preview/chat-panel.tsx');
  const view = sources.get('app/v5-preview/rows-view.tsx');
  const logic = sources.get('app/v5-preview/rows-logic.ts');
  assert.match(page, /交互预览 · 合成数据/);
  assert.match(page, /演示控制·非业务操作/);
  assert.match(page, /conflict\.text/, '冲突横幅必须渲染 conflict 文案');
  assert.match(todo, /提交材料/);
  assert.match(chat, /项目沟通/);
  assert.match(view, /演示示意·非计算/);
  assert.match(view, /演示项目/);
  assert.match(view, /合成数据/);
  assert.match(logic, /状态已更新/, '409 横幅文案必须在纯逻辑层定义');
});

test('无障碍：输入均有 label；面板可展开均有 aria-expanded；状态灯文字可读', () => {
  const todo = sources.get('app/v5-preview/todo-card.tsx');
  const chat = sources.get('app/v5-preview/chat-panel.tsx');
  const row = sources.get('app/v5-preview/domain-row.tsx');
  assert.match(todo, /htmlFor="v5-rows-note-text"/);
  assert.match(todo, /id="v5-rows-note-text"/);
  assert.match(chat, /htmlFor="v5-rows-chat-input"/);
  assert.match(chat, /id="v5-rows-chat-input"/);
  assert.match(todo, /aria-expanded=\{formOpen\}/);
  assert.match(chat, /aria-expanded=\{open\}/);
  assert.match(row, /role="img"/, '分段条必须有 aria 文本');
  assert.match(row, /aria-hidden="true"/, '状态灯圆点必须对辅助技术隐藏（文字承载语义）');
});

test('页面不提供正式业务按钮（批准/放款/正式批准不出现）', () => {
  for (const [p, src] of sources) {
    assert.doesNotMatch(stripJsComments(src), /放款|审批通过|正式批准/, `${p} 不得出现正式业务动作入口`);
  }
});

// ---------- 5) 请求构造契约 ----------

test('请求构造契约：requestId / expectedVersion / actorRole:business / todoId', () => {
  const logic = sources.get('app/v5-preview/rows-logic.ts');
  const client = sources.get('app/v5-preview/api-client.ts');
  const page = sources.get('app/v5-preview/page.tsx');
  assert.match(logic, /actorRole: 'business'/, '演示受控身份必须固定 business');
  assert.match(logic, /requestId/);
  assert.match(logic, /expectedVersion/);
  assert.match(logic, /crypto\.randomUUID/, 'requestId 优先 crypto.randomUUID');
  assert.match(client, /method: 'POST'/);
  assert.match(client, /JSON\.stringify/);
  assert.match(client, /cache: 'no-store'/);
  assert.match(page, /newRequestId\(\)/, '页面必须生成幂等 requestId');
  assert.match(page, /POLL_MS = 4000/, '必须每 4s 轮询');
  assert.match(page, /visibilitychange/);
  assert.match(page, /addEventListener\('focus'/, 'focus 时必须重新 GET');
});

// ---------- 6) 409 保留草稿逻辑（纯函数真实执行） ----------

const logic = await import(pathToFileURL(dir('app/v5-preview/rows-logic.ts')).href);

test('409 冲突决策（真实执行）：草稿保留、横幅携带 v旧→v新、要求重新 GET', () => {
  const r = logic.resolveWriteConflict(7, 9);
  assert.equal(r.keepDraft, true);
  assert.equal(r.refresh, true);
  assert.equal(r.fromVersion, 7);
  assert.equal(r.toVersion, 9);
  assert.equal(r.banner, '状态已更新（v7→v9），草稿已保留');

  // serverVersion 缺失（异常响应）也必须保留草稿并重新 GET，不得猜测成静默覆盖。
  const fallback = logic.resolveWriteConflict(7, undefined);
  assert.equal(fallback.keepDraft, true);
  assert.equal(fallback.refresh, true);
  assert.equal(fallback.toVersion, 8);

  assert.equal(logic.formatVersionBanner(41, 42), '状态已更新（v41→v42），草稿已保留');
});

test('请求体构造（真实执行）：actorRole 固定 business，字段完整', () => {
  const note = logic.buildNoteBody('todo-device-list', '设备清单已更新', 7, 'rid-1');
  assert.deepEqual(note, {
    requestId: 'rid-1',
    expectedVersion: 7,
    todoId: 'todo-device-list',
    text: '设备清单已更新',
    actorRole: 'business',
  });
  const message = logic.buildMessageBody('收到', 8, 'rid-2');
  assert.deepEqual(message, { requestId: 'rid-2', expectedVersion: 8, text: '收到', actorRole: 'business' });
  assert.notEqual(logic.newRequestId(), logic.newRequestId(), 'requestId 必须唯一');
  assert.ok(logic.newRequestId().length > 0);
});

test('演示示意与展示派生（真实执行）：情景固定宽度、未知失败关闭、fromKind/段状态/时间', () => {
  assert.equal(logic.scenarioProgressWidth('approval'), 34, 'approval≈1/3');
  assert.equal(logic.scenarioProgressWidth('post-rental'), 75, 'post-rental≈3/4');
  assert.equal(logic.scenarioProgressWidth('settled'), 100, 'settled 满');
  assert.equal(logic.scenarioProgressWidth('unknown'), 0, '未知情景失败关闭为 0');
  assert.equal(logic.fromKindLabel('business'), '业务');
  assert.equal(logic.fromKindLabel('domain'), '专业域');
  assert.equal(logic.fromKindLabel('system'), '系统');
  assert.equal(logic.segmentStateLabel('done'), '已完成');
  assert.equal(logic.segmentStateLabel('current'), '进行中');
  assert.equal(logic.segmentStateLabel('pending'), '未开始');
  assert.equal(logic.segmentStateLabel('weird'), '未知');
  assert.match(logic.formatMessageTime('2026-09-11T08:09:00Z'), /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(logic.formatMessageTime('not-a-time'), 'not-a-time');
});

test('抬头项目行去重（真实执行 + 源码接线）：编号不重复拼接', () => {
  // 冻结种子的 projectName 已含编号 → 只显示一次（回归：曾渲染成 "新客回租 · JW-2026-018 · JW-2026-018"）。
  assert.equal(logic.projectLine('新客回租 · JW-2026-018', 'JW-2026-018'), '新客回租 · JW-2026-018');
  // 未来种子若 projectName 不含编号 → 以 " · " 追加一次；编号为空 → 原样。
  assert.equal(logic.projectLine('新客回租', 'JW-2026-018'), '新客回租 · JW-2026-018');
  assert.equal(logic.projectLine('新客回租', ''), '新客回租');
  const view = sources.get('app/v5-preview/rows-view.tsx');
  assert.match(view, /projectLine\(overview\.projectName, overview\.projectCode\)/);
  assert.doesNotMatch(view, /\} · \{overview\.projectCode\}/, '抬头不得再手工拼接 projectCode');
});

test('待办卡按状态收敛提交入口：待复核只显示说明、不再提供注定 404 的表单', () => {
  const todo = sources.get('app/v5-preview/todo-card.tsx');
  assert.match(todo, /todo\.status === '待补充'/, '只有待补充才渲染提交按钮');
  assert.match(todo, /canSubmit \? \(\s*\n\s*<button/, '提交按钮必须位于 canSubmit 条件内');
  assert.match(todo, /canSubmit && formOpen \? \(/, '表单渲染必须同时受 canSubmit 守卫');
  assert.match(todo, /已提交补充说明，信审复核中（合成）/);
  assert.match(todo, /todo\.status === '待复核'/);
  // 回归锚点：待复核说明不得再附带提交按钮文案。
  const reviewLine = todo.split('\n').find((l) => l.includes('已提交补充说明'));
  assert.ok(reviewLine !== undefined);
});

test('409 保留草稿（源码断言）：todo/chat 仅在成功分支清空输入；冲突/错误分支保留', () => {
  const todo = sources.get('app/v5-preview/todo-card.tsx');
  const chat = sources.get('app/v5-preview/chat-panel.tsx');
  const page = sources.get('app/v5-preview/page.tsx');
  // todo-card：清空只发生在 ok 分支（允许分支内先有注释行）；全文件 setDraft('') 仅此一处（初始值由 useState 承担）。
  assert.match(todo, /if \(result\.outcome === 'ok'\) \{\s*(?:\/\/[^\n]*\n\s*)*setDraft\(''\);/);
  assert.match(todo, /outcome === 'conflict'/, '必须显式处理冲突分支');
  assert.match(todo, /草稿保留/);
  assert.equal(todo.split("setDraft('')").length - 1, 1, "setDraft('') 只能出现在 ok 分支");
  // chat-panel：清空输入只在 ok 分支。
  assert.match(chat, /if \(result\.outcome === 'ok'\) \{\s*\n\s*setInput\(''\);/);
  assert.equal(chat.split("setInput('')").length - 1, 1, "setInput('') 只能出现在 ok 分支");
  // page：冲突后自动重新 GET。
  assert.match(page, /result\.outcome === 'conflict'\) void refresh\(\)/);
});

// ---------- 7) UX 审查回归（P1-2 / P2-3 / P2-4 / P2-5 / P3-4 / P3-6 / P3-7 / P3-8） ----------

test('P1-2 requestId 引用生命周期：仅 NETWORK 保留，确定性结果立即清空（真实执行 + 源码接线）', () => {
  assert.equal(logic.keepRequestIdForRetry('NETWORK'), true, '网络失败（结果未知）保留原 requestId 原样重试');
  assert.equal(logic.keepRequestIdForRetry('VERSION_CONFLICT'), false, '409 是确定性结果，必须清空');
  assert.equal(logic.keepRequestIdForRetry('REQUEST_MISMATCH'), false);
  assert.equal(logic.keepRequestIdForRetry('NO_OPEN_TODO'), false);
  assert.equal(logic.keepRequestIdForRetry('NOT_FOUND'), false);
  assert.equal(logic.keepRequestIdForRetry('ROLE_FORBIDDEN'), false);
  const page = sources.get('app/v5-preview/page.tsx');
  assert.match(page, /keepRequestIdForRetry\(error instanceof ApiFailure \? error\.code : 'NETWORK'\)/);
  // 成功分支与失败分支都必须清空引用（note/message 两条写入路径同修）。
  assert.ok(page.split('noteAttemptRef.current = null').length - 1 >= 2, 'note 引用必须有两处清空点（成功+确定性失败）');
  assert.ok(page.split('messageAttemptRef.current = null').length - 1 >= 2, 'message 引用必须有两处清空点（成功+确定性失败）');
});

test('P2-5 死反馈 formOk 已删除；成功反馈由服务端状态（待复核说明）承载', () => {
  const todo = sources.get('app/v5-preview/todo-card.tsx');
  const css = sources.get('app/v5-preview/preview.module.css');
  assert.doesNotMatch(todo, /formOk|setOk/, 'formOk 死代码必须移除');
  assert.doesNotMatch(css, /\.formOk/);
  assert.match(todo, /已提交补充说明，信审复核中（合成）/, '成功后的可见反馈保留');
});

test('P2-3 冲突内联提示 + P3-7 兜底文案退化为不带版本', () => {
  const todo = sources.get('app/v5-preview/todo-card.tsx');
  const chat = sources.get('app/v5-preview/chat-panel.tsx');
  assert.match(todo, /版本已更新至 v\$\{result\.toVersion\}，可直接再次提交/);
  assert.match(chat, /版本已更新至 v\$\{result\.toVersion\}，可直接再次发送/);
  assert.match(todo, /formConflict/);
  assert.match(chat, /formConflict/);
  // serverVersion 缺失：横幅不带可能从未存在的版本号；toVersion 兜底供撤横幅判断。
  const fallback = logic.resolveWriteConflict(7, undefined);
  assert.equal(fallback.banner, '版本已更新，草稿已保留，可直接重试');
  assert.equal(fallback.toVersion, 8);
  assert.equal(fallback.keepDraft, true);
});

test('P2-4 / P3-4 / P3-6 / P3-8 打磨：NOT_FOUND 文案映射、消息列表可聚焦播报、region 语义、页面题消费 scenarioLabel', () => {
  const todo = sources.get('app/v5-preview/todo-card.tsx');
  const chat = sources.get('app/v5-preview/chat-panel.tsx');
  const page = sources.get('app/v5-preview/page.tsx');
  const view = sources.get('app/v5-preview/rows-view.tsx');
  assert.match(todo, /该待办已不在可提交状态，请刷新后查看最新状态/, 'NOT_FOUND 不透传内部 todoId');
  assert.match(chat, /role="log"/, '消息列表以 log 语义获得新消息播报');
  assert.match(chat, /tabIndex=\{0\}/, '滚动区键盘可达');
  assert.match(page, /role="region"/);
  assert.doesNotMatch(page, /role="toolbar"/);
  assert.match(view, /项目总览 · \{overview\.scenarioLabel\}/, '页面题存在并消费 scenarioLabel');
});
