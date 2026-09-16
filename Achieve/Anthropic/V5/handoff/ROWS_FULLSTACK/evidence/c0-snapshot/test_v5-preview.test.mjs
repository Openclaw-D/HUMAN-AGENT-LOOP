// V5 PREVIEW F0-R1 行为与契约测试（模式同 v4life-verification-ui.test.mjs）：
//  1) 可执行行为测试——切取 app/v5-preview/preview-state.tsx 的 V5-PREVIEW-PURE-LOGIC
//     标记区间（纯 TS，无导入/JSX），写入 os.tmpdir() 动态 import 真实执行。
//     R1 新增回归：角色守卫、四阶段派生同步、深度缓存校验、代际回复门、草稿单一编辑源、
//     URL 域+阶段导航、cache-rejected 提示。
//  2) 源码契约测试——隔离性、四阶段标注、正式审批禁用、候选布局未替代声明等。
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

test('初始合成状态：四域各四阶段；信审材料等待、资产材料待补充（情景）', () => {
  const s = logic.initialPreviewState();
  assert.equal(s.version, 1);
  assert.equal(s.projectNo, '2026PA21001');
  assert.deepEqual(logic.STAGE_ORDER, ['material', 'model', 'review', 'formal']);
  for (const key of ['policy', 'credit', 'commerce', 'asset']) {
    const d = s.domains[key];
    for (const id of logic.STAGE_ORDER) {
      assert.ok(logic.isWorkState(d.stages[id].state), `${key}.${id} 状态必须合法`);
      assert.equal(typeof d.stages[id].note, 'string');
    }
    assert.equal(d.stages.formal.state, 'locked', '正式通过初始必须为禁用');
  }
  assert.equal(s.domains.credit.stages.material.state, 'awaiting');
  assert.match(s.domains.credit.stages.material.note, /等待业务确认定价依据/);
  assert.equal(s.domains.asset.stages.material.state, 'returned', '必须存在材料待补充情景');
  assert.match(s.domains.asset.stages.material.note, /设备采购凭证待补充/);
  assert.match(s.progressNote, /项目主体结束/);
  assert.match(s.progressNote, /100%不等于风险消失/);
});

test('手机顺时针、横屏四列与共用四阶段常量符合决定', () => {
  assert.deepEqual(logic.MOBILE_QUADRANTS, { topLeft: 'asset', topRight: 'policy', bottomRight: 'credit', bottomLeft: 'commerce' });
  assert.deepEqual(logic.LANDSCAPE_COLUMN_ORDER, ['policy', 'credit', 'commerce', 'asset']);
  assert.deepEqual(logic.STAGE_LABELS, { material: '材料合规', model: '模型校验', review: '人工复核', formal: '正式通过' });
});

test('派生同步：格子/域状态/卡点由同一阶段对象派生', () => {
  const s = logic.initialPreviewState();
  for (const key of ['policy', 'credit', 'commerce', 'asset']) {
    const d = s.domains[key];
    const blocks = logic.deriveStageBlocks(d);
    assert.equal(blocks.length, 4);
    for (let i = 0; i < 4; i += 1) {
      assert.equal(blocks[i].stageId, logic.STAGE_ORDER[i]);
      assert.equal(blocks[i].state, d.stages[logic.STAGE_ORDER[i]].state, '格子状态必须与阶段对象一致');
      assert.equal(blocks[i].note, d.stages[logic.STAGE_ORDER[i]].note);
    }
    assert.equal(logic.deriveDomainStatus(d), d.stages[logic.deriveStageBlocks(d).find((b) => b.state !== 'done').stageId].state);
  }
  assert.equal(logic.deriveDomainStatus(s.domains.credit), 'awaiting');
  assert.match(logic.deriveDomainBlocker(s.domains.credit), /等待业务确认定价依据/);
  assert.equal(logic.deriveDomainStatus(s.domains.asset), 'returned');
});

test('[R1-2] 角色守卫：业务视角不得代庖信审动作', () => {
  const s0 = logic.initialPreviewState(); // role = business
  assert.equal(s0.role, 'business');
  const s1 = logic.previewReducer(s0, { type: 'save-credit-draft', text: '越权草稿' });
  assert.equal(s1, s0, '业务视角保存信审草稿必须被拒绝');
  const s2 = logic.previewReducer(s0, { type: 'send-supplement-request', text: '越权补件要求' });
  assert.equal(s2, s0, '业务视角发起信审补充要求必须被拒绝');
  // 完整闭环必须逐段换角色后才能推进
  let s = logic.previewReducer(logic.previewReducer(s0, { type: 'set-role', role: 'credit' }), { type: 'send-supplement-request', text: '请提供定价依据' });
  assert.equal(s.loop.stage, 'request-sent');
  const wrongRespondAsCredit = logic.previewReducer(s, { type: 'send-business-response', text: 'x' });
  assert.equal(wrongRespondAsCredit, s, '信审视角不得代业务回应');
  const backToBusiness = logic.previewReducer(s, { type: 'set-role', role: 'business' });
  const responded = logic.previewReducer(backToBusiness, { type: 'send-business-response', text: '按不含税口径复核' });
  assert.equal(responded.loop.stage, 'business-responded', '业务视角回应成功');
  const wrongContinue = logic.previewReducer(responded, { type: 'continue-credit' });
  assert.equal(wrongContinue, responded, '业务视角不得执行信审接续');
  const rightContinue = logic.previewReducer(logic.previewReducer(responded, { type: 'set-role', role: 'credit' }), { type: 'continue-credit' });
  assert.equal(rightContinue.loop.stage, 'credit-continued', '信审视角接续成功');
});

test('[R1-5] 接续后四阶段同步：材料/模型完成、复核就绪、正式禁用，格子与域摘要一致', () => {
  let s = logic.initialPreviewState();
  s = logic.previewReducer(s, { type: 'set-role', role: 'credit' });
  s = logic.previewReducer(s, { type: 'send-supplement-request', text: '请提供定价依据' });
  s = logic.previewReducer(s, { type: 'set-role', role: 'business' });
  s = logic.previewReducer(s, { type: 'send-business-response', text: '按不含税口径复核' });
  s = logic.previewReducer(s, { type: 'set-role', role: 'credit' });
  s = logic.previewReducer(s, { type: 'continue-credit' });
  const credit = s.domains.credit;
  assert.equal(credit.stages.material.state, 'done');
  assert.equal(credit.stages.model.state, 'done');
  assert.match(credit.stages.model.note, /张力|问题/, '模型校验完成可含问题注记');
  assert.equal(credit.stages.review.state, 'ready');
  assert.equal(credit.stages.formal.state, 'locked', '正式通过不得被自动推进');
  // 格子与域摘要由同一阶段对象派生（R1-5 的核心断言）
  const blocks = logic.deriveStageBlocks(credit);
  assert.deepEqual(blocks.map((b) => b.state), ['done', 'done', 'ready', 'locked']);
  assert.equal(logic.deriveDomainStatus(credit), 'ready');
  assert.match(logic.deriveDomainBlocker(credit), /候选就绪|人工复核/);
  assert.equal(s.progressPercent, 60);
  // 业务待办闭合
  assert.equal(logic.deriveBusinessTodos(s).find((t) => t.id === 'loop-credit').state, 'resolved');
});

test('[R1-4] 深度缓存校验：缺字段/非法枚举/坏数值一律拒绝，不重演 probes 缺陷', () => {
  // 审查 probes 中的原始缺陷样本：浅校验曾接受并导致 render_access_error
  const probeCase = { version: 1, domains: {}, loop: {}, messages: [], nextId: 0 };
  assert.equal(logic.parsePreviewState(JSON.stringify(probeCase)), null, '空 domains/loop 必须被拒绝');
  const variants = [
    'not-json',
    '[]',
    '{"version":2}',
    JSON.stringify({ ...probeCase, domains: { policy: {} } }),
    JSON.stringify({ ...logic.initialPreviewState(), domains: { ...logic.initialPreviewState().domains, credit: { key: 'credit', name: '信审', icon: 'shield', stages: { material: { state: 'bogus', note: '' } } } } }),
    JSON.stringify({ ...logic.initialPreviewState(), loop: { stage: 'no-such-stage', creditDraft: '', supplementRequest: null, businessResponse: null } }),
    JSON.stringify({ ...logic.initialPreviewState(), messages: [{ id: 1, fromKind: 'robot', fromName: 'x', to: 'all', text: '', marks: [] }] }),
    JSON.stringify({ ...logic.initialPreviewState(), nextId: -1 }),
    JSON.stringify({ ...logic.initialPreviewState(), nextId: 1.5 }),
    JSON.stringify({ ...logic.initialPreviewState(), progressPercent: 150 }),
    JSON.stringify({ ...logic.initialPreviewState(), role: 'ceo' }),
  ];
  for (const v of variants) {
    assert.equal(logic.parsePreviewState(v), null, `必须拒绝：${v.slice(0, 80)}`);
  }
  const ok = logic.initialPreviewState();
  assert.deepEqual(logic.parsePreviewState(logic.serializePreviewState(ok)), ok, '合法状态往返必须一致');
});

test('[R1-4] cache-rejected 给出明确提示而非静默回退', () => {
  const s = logic.previewReducer(logic.initialPreviewState(), { type: 'cache-rejected' });
  assert.match(s.cacheNotice, /无法识别的本地缓存/);
  assert.match(s.cacheNotice, /重置/);
  // 提示态仍是合法可持久化状态
  assert.deepEqual(logic.parsePreviewState(logic.serializePreviewState(s)), s);
});

test('[R1-6] 模拟回复代际门：reset 后未决回复不得进入新演示', () => {
  const gate = logic.createReplyGate();
  let delivered = 0;
  const deliver = gate.schedule(() => { delivered += 1; });
  gate.reset();
  deliver();
  assert.equal(delivered, 0, 'reset 后旧调度必须失效');
  const gate2 = logic.createReplyGate();
  let delivered2 = 0;
  const deliver2 = gate2.schedule(() => { delivered2 += 1; });
  deliver2();
  assert.equal(delivered2, 1, '未重置时正常送达');
});

test('[R1-3] 草稿单一编辑源：未初始化回显、有意清空、保存当前显示内容', () => {
  assert.equal(logic.resolveEditingValue(null, 'A'), 'A', '未编辑时显示已存值');
  assert.equal(logic.resolveEditingValue('', 'A'), '', '清空输入必须显示空，不得回弹旧值');
  assert.equal(logic.resolveEditingValue('B', 'A'), 'B', '编辑时显示编辑值');
});

test('[R1-7] URL 携带域+阶段；非法 stage 回退；旧 URL 兼容', () => {
  const v = logic.queryToView('?view=detail&domain=credit&stage=model');
  assert.deepEqual(v, { screen: 'detail', domain: 'credit', stage: 'model' });
  assert.equal(logic.viewToQuery(v), 'view=detail&domain=credit&stage=model');
  assert.deepEqual(logic.queryToView('?view=detail&domain=credit'), { screen: 'detail', domain: 'credit' });
  assert.deepEqual(logic.viewToQuery({ screen: 'detail', domain: 'credit' }), 'view=detail&domain=credit');
  assert.deepEqual(logic.queryToView('?view=detail&domain=credit&stage=badstage'), { screen: 'detail', domain: 'credit' }, '非法 stage 必须丢弃');
  assert.deepEqual(logic.queryToView('?view=detail&domain=business'), { screen: 'detail', domain: 'business' });
  assert.deepEqual(logic.queryToView(''), { screen: 'overview' });
});

test('业务待办派生：初始即显示信审受阻与资产补件', () => {
  const s = logic.initialPreviewState();
  const todos = logic.deriveBusinessTodos(s);
  const creditTodo = todos.find((t) => t.id === 'loop-credit');
  assert.ok(creditTodo);
  assert.match(creditTodo.title, /信审材料合规受阻/);
  assert.equal(creditTodo.state, 'awaiting');
  const assetTodo = todos.find((t) => t.id === 'demo-asset');
  assert.match(assetTodo.title, /设备采购凭证/);
});

test('聊天派生与正式审批守卫保持不变（防回归）', () => {
  let s = logic.previewReducer(logic.initialPreviewState(), { type: 'set-role', role: 'credit' });
  s = logic.previewReducer(s, { type: 'chat-send', text: '定价依据如何确认？', to: 'policy' });
  assert.equal(s.messages.at(-1).fromName, '张信审');
  const ask = logic.deriveAgentReply('请确认口径？', 'credit');
  assert.equal(ask.needsHuman, true);
  assert.match(ask.text, /模拟提示/);
  const s0 = logic.initialPreviewState();
  const s1 = logic.previewReducer(s0, { type: 'formal-attempt', kind: 'approve' });
  assert.match(s1.formalNotice, /正式审批待权限及对象约定/);
  assert.deepEqual(s1.domains, s0.domains);
  const formalish = logic.PREVIEW_ACTION_TYPES.filter((t) => ['approve', 'veto', 'reject', 'receipt', 'decision'].includes(t));
  assert.deepEqual(formalish, [], '动作类型不得包含正式审批语义');
  const unknown = logic.previewReducer(s0, { type: 'no-such-action' });
  assert.equal(unknown, s0, '未知动作失败关闭');
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
  for (const f of V5_PREVIEW_FILES) readSite(f);
  for (const f of V5_PREVIEW_FILES.filter((p) => p.endsWith('.tsx'))) {
    const src = readSite(f);
    assert.doesNotMatch(src, /fetch\s*\(/, `${f} 不得发起任何 fetch（隔离预览）`);
    assert.doesNotMatch(src, /['"]\/api\//, `${f} 不得引用现有 API 路由`);
    assert.doesNotMatch(src, /from\s+['"][^'"]*(lib|app\/work)\//, `${f} 不得导入共享模块或现有工作面`);
  }
});

test('四阶段语义落在全部界面层（总览/详情/状态层）', () => {
  for (const f of ['app/v5-preview/preview-state.tsx', 'app/v5-preview/overview-mobile.tsx', 'app/v5-preview/overview-landscape.tsx', 'app/v5-preview/detail-workspace.tsx']) {
    const src = readSite(f);
    assert.match(src, /材料合规/, `${f} 必须呈现材料合规阶段`);
    assert.match(src, /模型校验/, `${f} 必须呈现模型校验阶段`);
    assert.match(src, /人工复核/, `${f} 必须呈现人工复核阶段`);
    assert.match(src, /正式通过/, `${f} 必须呈现正式通过阶段`);
  }
  const detail = readSite('app/v5-preview/detail-workspace.tsx');
  assert.match(detail, /stageHighlight/, '详情必须支持自总览的阶段定位高亮');
  assert.match(detail, /不能替代人工复核|不能自动正式通过|正式通过禁用/, '模型校验/复核/正式通过的边界必须可见');
});

test('[R1-2] 角色守卫在界面层可见（跨域可查看不可代办）', () => {
  const detail = readSite('app/v5-preview/detail-workspace.tsx');
  assert.match(detail, /canActCredit/, '信审动作必须按视角限制');
  assert.match(detail, /预览角色约束/, '角色守卫必须向用户说明');
  assert.match(detail, /state\.role === 'business'/, '业务回应必须按视角限制');
});

test('[R1-3] 草稿单一编辑源接线（editing null / 有意清空）', () => {
  const detail = readSite('app/v5-preview/detail-workspace.tsx');
  assert.match(detail, /resolveEditingValue/, 'textarea 显示必须经单一编辑源解析');
  assert.match(detail, /setDraftEditing\(null\)/, '保存后必须回到回显模式（清掉编辑态）');
});

test('页面标注、正式审批禁用、候选布局未替代声明', () => {
  assert.match(readSite('app/v5-preview/page.tsx'), /交互预览 · 合成数据/);
  assert.match(readSite('app/v5-preview/page.tsx'), /cacheNotice/, '缓存拒绝提示必须渲染');
  const land = readSite('app/v5-preview/overview-landscape.tsx');
  assert.match(land, /否决/);
  assert.match(land, /通过/);
  assert.match(land, /disabled/, '否决/通过按钮必须禁用');
  assert.match(land, /FORMAL_NOTICE/, '禁用说明必须引用正式审批边界常量');
  assert.match(readSite(STATE_FILE), /正式审批待权限及对象约定——预览禁用，不产生 Decision\/Receipt。/);
  const page = readSite('app/v5-preview/page.tsx');
  assert.match(page, /手机四列（候选对比）/);
  assert.match(readSite('app/v5-preview/overview-landscape.tsx'), /未替代原手机决定/, '候选布局不得宣称替代顺时针拼图');
});

test('模拟标记契约：模拟回复 / 模拟人接手 / 模拟转交 / 本地模拟保存 / 演示口径', () => {
  assert.match(readSite('app/v5-preview/chat-panel.tsx'), /模拟回复/);
  assert.match(readSite('app/v5-preview/chat-panel.tsx'), /模拟人接手/);
  assert.match(readSite('app/v5-preview/detail-workspace.tsx'), /模拟转交/);
  assert.match(readSite('app/v5-preview/detail-workspace.tsx'), /保存草稿（本地模拟）/);
  assert.match(readSite('app/v5-preview/progress-ruler.tsx'), /口径仅为演示/);
});

test('闭环关键动作齐备：草稿/补件→业务回应→信审接续', () => {
  const detail = readSite('app/v5-preview/detail-workspace.tsx');
  for (const key of ['save-credit-draft', 'send-supplement-request', 'send-business-response', 'continue-credit']) {
    assert.ok(detail.includes(`'${key}'`), `详情界面必须触发 ${key}`);
  }
  assert.match(detail, /业务协调工作台/);
  assert.match(detail, /第五风控域/, '业务协调视图必须声明非第五风控域');
});

test('cleanup', () => {
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
