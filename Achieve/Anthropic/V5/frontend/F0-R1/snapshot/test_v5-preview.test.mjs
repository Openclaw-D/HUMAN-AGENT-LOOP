// V5 PREVIEW F0 行为与契约测试（模式同 v4life-verification-ui.test.mjs）：
//  1) 可执行行为测试——切取 app/v5-preview/preview-state.tsx 的 V5-PREVIEW-PURE-LOGIC
//     标记区间（纯 TS，无导入/JSX），写入 os.tmpdir() 动态 import 真实执行；
//  2) 源码契约测试——隔离性（无 fetch / 无 /api/、不导入 lib/**）、合成标注、
//     正式审批禁用、手机顺时针四域与横屏四列四行等关键界面契约。
//
// 运行：node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const STATE_FILE = 'app/v5-preview/preview-state.tsx';

function readSite(path) {
  return readFileSync(new URL(path, root), 'utf8');
}

// ---------- 可执行行为测试：切取纯逻辑区间 ----------

const source = readSite(STATE_FILE);
const START = '// ---------- V5-PREVIEW-PURE-LOGIC-START ----------';
const END = '// ---------- V5-PREVIEW-PURE-LOGIC-END ----------';

test('纯逻辑标记区间恰好各出现一次，且区间内无导入/无 JSX', () => {
  assert.equal(source.split(START).length - 1, 1, 'START 标记必须恰好一次');
  assert.equal(source.split(END).length - 1, 1, 'END 标记必须恰好一次');
  const region = source.slice(source.indexOf(START) + START.length, source.indexOf(END));
  assert.doesNotMatch(region, /^\s*import\s/m, '纯逻辑区间不得包含 import');
  assert.doesNotMatch(region, /<\//, '纯逻辑区间不得包含 JSX（闭标签）');
  assert.doesNotMatch(
    region,
    /<(div|span|section|button|svg|path|ul|ol|li|form|input|textarea|select|option|em|b|i|code|summary|details|aside|header|footer|h\d)\b/,
    '纯逻辑区间不得包含 JSX 标签',
  );
});

const tmp = mkdtempSync(join(tmpdir(), 'v5-preview-logic-'));
const regionFile = join(tmp, 'preview-pure-logic.ts');
writeFileSync(regionFile, source.slice(source.indexOf(START) + START.length, source.indexOf(END)), 'utf8');
const logic = await import(pathToFileURL(regionFile).href);

test('初始合成状态：信审等待输入、卡点明确、进度口径为演示', () => {
  const s = logic.initialPreviewState();
  assert.equal(s.version, 1);
  assert.equal(s.projectNo, '2026PA21001');
  assert.equal(s.domains.credit.status, 'awaiting');
  assert.match(s.domains.credit.blocker, /等待业务确认定价依据/);
  assert.match(s.progressNote, /进度口径仅为演示/);
  assert.match(s.progressNote, /100%不等于风险消失/);
  // 每域恰四个可见小分区（草图契约）
  for (const key of ['policy', 'credit', 'commerce', 'asset']) {
    assert.equal(s.domains[key].blocks.length, 4, `${key} 应有四个小分区`);
  }
});

test('手机顺时针四域与横屏四列顺序符合任务书', () => {
  assert.deepEqual(logic.MOBILE_QUADRANTS, { topLeft: 'asset', topRight: 'policy', bottomRight: 'credit', bottomLeft: 'commerce' });
  assert.deepEqual(logic.LANDSCAPE_COLUMN_ORDER, ['policy', 'credit', 'commerce', 'asset']);
});

test('闭环 1：信审保存草稿只改草稿，不改状态、不发消息', () => {
  const s0 = logic.initialPreviewState();
  const s1 = logic.previewReducer(s0, { type: 'save-credit-draft', text: '草稿A' });
  assert.equal(s1.loop.creditDraft, '草稿A');
  assert.equal(s1.loop.stage, 'credit-drafting');
  assert.equal(s1.domains.credit.status, 'awaiting');
  assert.equal(s1.messages.length, s0.messages.length, '保存草稿不产生消息');
  assert.equal(s1.nextId, s0.nextId);
});

test('闭环 2：信审提出补充要求 → 业务待办可见，信审仍等待', () => {
  const s0 = logic.initialPreviewState();
  const s1 = logic.previewReducer(s0, { type: 'save-credit-draft', text: '草稿A' });
  const s2 = logic.previewReducer(s1, { type: 'send-supplement-request', text: '请提供定价依据' });
  assert.equal(s2.loop.stage, 'request-sent');
  assert.equal(s2.domains.credit.status, 'awaiting', '提出要求不改变信审域状态');
  const last = s2.messages.at(-1);
  assert.equal(last.to, 'business');
  assert.match(last.text, /模拟补充要求/);
  assert.deepEqual(logic.deriveBusinessTodos(s2).find((t) => t.id === 'loop-credit'), {
    id: 'loop-credit', title: '信审补充要求：定价依据确认', detail: '请提供定价依据', state: 'awaiting', simulated: true,
  });
});

test('闭环 3：业务回应 → 信审待办显示可接续；回应不产生正式结果', () => {
  let s = logic.previewReducer(logic.initialPreviewState(), { type: 'send-supplement-request', text: '请提供定价依据' });
  s = logic.previewReducer(s, { type: 'send-business-response', text: '按不含税口径复核' });
  assert.equal(s.loop.stage, 'business-responded');
  const todo = logic.deriveCreditTodo(s);
  assert.match(todo.title, /业务已回应/);
  assert.match(todo.detail, /按不含税口径复核/);
  // 正式字段必须仍是安全默认：无 Decision/Receipt 概念字段被写入
  assert.equal(s.formalNotice, null);
});

test('闭环 4：信审接续 → 候选就绪（模拟）、总览状态与演示进度同步', () => {
  let s = logic.previewReducer(logic.initialPreviewState(), { type: 'send-supplement-request', text: '请提供定价依据' });
  s = logic.previewReducer(s, { type: 'send-business-response', text: '按不含税口径复核' });
  s = logic.previewReducer(s, { type: 'continue-credit' });
  assert.equal(s.loop.stage, 'credit-continued');
  assert.equal(s.domains.credit.status, 'ready');
  assert.match(s.domains.credit.blocker, /候选就绪（模拟）|候选就绪\(模拟\)/);
  assert.equal(s.progressPercent, 60);
  const businessTodo = logic.deriveBusinessTodos(s).find((t) => t.id === 'loop-credit');
  assert.equal(businessTodo.state, 'resolved');
  assert.match(logic.deriveCreditTodo(s).title, /候选就绪/);
});

test('阶段守卫失败关闭：错误阶段下的动作原样返回', () => {
  const s0 = logic.initialPreviewState();
  const s1 = logic.previewReducer(s0, { type: 'send-business-response', text: '提前回应' });
  assert.equal(s1, s0, 'request-sent 之前业务回应必须被拒绝');
  const s2 = logic.previewReducer(s0, { type: 'continue-credit' });
  assert.equal(s2, s0, 'business-responded 之前信审接续必须被拒绝');
  const s3 = logic.previewReducer(s0, { type: 'no-such-action' });
  assert.equal(s3, s0, '未知动作失败关闭：原样返回');
});

test('聊天：@域发送、模拟回复标记、模拟人接手标记、needsHuman 判定', () => {
  let s = logic.previewReducer(logic.initialPreviewState(), { type: 'set-role', role: 'credit' });
  s = logic.previewReducer(s, { type: 'chat-send', text: '定价依据如何确认？', to: 'policy' });
  let msg = s.messages.at(-1);
  assert.equal(msg.fromKind, 'human');
  assert.equal(msg.fromName, '张信审');
  assert.equal(msg.to, 'policy');
  s = logic.previewReducer(s, { type: 'chat-agent-reply', text: '政策（模拟回复）：……', domain: 'policy' });
  msg = s.messages.at(-1);
  assert.equal(msg.fromKind, 'agent');
  assert.ok(msg.marks.includes('模拟回复'), 'Agent 消息必须带模拟回复标记');
  s = logic.previewReducer(s, { type: 'chat-human-takeover', text: '由人工确认继续' });
  msg = s.messages.at(-1);
  assert.equal(msg.fromKind, 'human');
  assert.ok(msg.marks.includes('模拟人接手'), '人工接手消息必须带模拟人接手标记');

  const ask = logic.deriveAgentReply('请确认口径？', 'credit');
  assert.equal(ask.needsHuman, true);
  assert.match(ask.text, /模拟提示/);
  const plain = logic.deriveAgentReply('收到', 'asset');
  assert.equal(plain.needsHuman, false);
});

test('正式审批守卫：formal-attempt 只设提示，绝不产生正式状态', () => {
  const s0 = logic.initialPreviewState();
  const s1 = logic.previewReducer(s0, { type: 'formal-attempt', kind: 'approve' });
  assert.match(s1.formalNotice, /正式审批待权限及对象约定/);
  assert.match(s1.formalNotice, /不产生 Decision\/Receipt/);
  assert.deepEqual(s1.domains, s0.domains, '域状态不得变化');
  assert.deepEqual(s1.loop, s0.loop, '闭环状态不得变化');
  assert.equal(s1.messages.length, s0.messages.length, '不得产生新消息');
  // 动作类型清单中不存在任何正式审批语义的动作
  const formalish = logic.PREVIEW_ACTION_TYPES.filter((t) => ['approve', 'veto', 'reject', 'receipt', 'decision'].includes(t));
  assert.deepEqual(formalish, [], '动作类型不得包含正式审批语义');
});

test('持久化：serialize/parse 往返一致；损坏输入失败关闭返回 null', () => {
  const s = logic.initialPreviewState();
  const parsed = logic.parsePreviewState(logic.serializePreviewState(s));
  assert.deepEqual(parsed, s);
  assert.equal(logic.parsePreviewState('not-json'), null);
  assert.equal(logic.parsePreviewState('{"version":2}'), null);
  assert.equal(logic.parsePreviewState('[]'), null);
});

// ---------- 源码契约测试 ----------

const V5_PREVIEW_FILES = [
  'app/v5-preview/page.tsx',
  'app/v5-preview/preview-state.tsx',
  'app/v5-preview/overview-mobile.tsx',
  'app/v5-preview/overview-landscape.tsx',
  'app/v5-preview/detail-workspace.tsx',
  'app/v5-preview/chat-panel.tsx',
  'app/v5-preview/progress-ruler.tsx',
  'app/v5-preview/icons.tsx',
  'app/v5-preview/preview.module.css',
];

test('v5-preview 文件齐备且与现有页面隔离', () => {
  for (const f of V5_PREVIEW_FILES) readSite(f); // 不存在会抛 ENOENT 使测试失败
  for (const f of V5_PREVIEW_FILES.filter((p) => p.endsWith('.tsx'))) {
    const src = readSite(f);
    assert.doesNotMatch(src, /fetch\s*\(/, `${f} 不得发起任何 fetch（隔离预览）`);
    assert.doesNotMatch(src, /['"]\/api\//, `${f} 不得引用现有 API 路由`);
    assert.doesNotMatch(src, /from\s+['"][^'"]*(lib|app\/work)\//, `${f} 不得导入共享模块或现有工作面`);
  }
});

test('页面始终标注「交互预览 · 合成数据」，正式审批禁用并说明', () => {
  assert.match(readSite('app/v5-preview/page.tsx'), /交互预览 · 合成数据/);
  const land = readSite('app/v5-preview/overview-landscape.tsx');
  assert.match(land, /否决/);
  assert.match(land, /通过/);
  assert.match(land, /disabled/, '否决/通过按钮必须禁用');
  assert.match(land, /FORMAL_NOTICE/, '禁用说明必须引用正式审批边界常量');
  const state = readSite(STATE_FILE);
  assert.match(state, /正式审批待权限及对象约定——预览禁用，不产生 Decision\/Receipt。/);
});

test('模拟标记契约：模拟回复 / 模拟人接手 / 模拟转交 / 本地模拟保存', () => {
  assert.match(readSite('app/v5-preview/chat-panel.tsx'), /模拟回复/);
  assert.match(readSite('app/v5-preview/chat-panel.tsx'), /模拟人接手/);
  assert.match(readSite('app/v5-preview/detail-workspace.tsx'), /模拟转交/);
  assert.match(readSite('app/v5-preview/detail-workspace.tsx'), /保存草稿（本地模拟）/);
  assert.match(readSite('app/v5-preview/progress-ruler.tsx'), /口径仅为演示/);
});

test('手机顺时针位置提示与每域四小分区在界面契约中成立', () => {
  const mob = readSite('app/v5-preview/overview-mobile.tsx');
  assert.match(mob, /MOBILE_QUADRANTS/, '总览组件必须引用纯逻辑区顺时针常量');
  // 左上/右上/左下/右下四个位置标签齐备（与状态对象共同驱动）
  for (const pos of ['左上', '右上', '左下', '右下']) assert.ok(mob.includes(pos), `手机拼图应标注${pos}位置`);
  const land = readSite('app/v5-preview/overview-landscape.tsx');
  assert.match(land, /LANDSCAPE_COLUMN_ORDER/, '横屏必须引用四列顺序常量');
});

test('详情闭环关键动作齐备：材料→草稿/补件→业务回应→信审接续→总览同步', () => {
  const detail = readSite('app/v5-preview/detail-workspace.tsx');
  for (const key of ['save-credit-draft', 'send-supplement-request', 'send-business-response', 'continue-credit']) {
    assert.ok(detail.includes(`'${key}'`) || new RegExp(`type: '${key}'`).test(detail), `详情界面必须触发 ${key}`);
  }
  assert.match(detail, /业务协调工作台/);
  assert.match(detail, /第五风控域/, '业务协调视图必须声明非第五风控域');
});

test('cleanup', () => {
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
