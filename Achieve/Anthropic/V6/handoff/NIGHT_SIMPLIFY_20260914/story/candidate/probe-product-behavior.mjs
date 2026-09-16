// 产品行为探针（诊断脚本，非门禁测试）：用隔离临时数据目录驱动**真实产品代码**
//（jianwei-v3/site/lib/v5-preview/demo-story-*.ts + service.ts + store.ts，源码只读），
// 对每个核心机制记录"机制预期 vs 产品实际行为"，产出 CORE_MAPPING 证据表。
// 适配产品链式推进语义：advance = 自动链（连穿常规步），停在人工动作步（holdForHuman）
// 或人工决定步（decision）并使其成为当前步——与 C 机制版 advanceAuto 同语义。
// 运行：node --experimental-strip-types candidate/probe-product-behavior.mjs
// 输出：product-behavior-findings.md（story 目录）。产品存储指向临时目录，不触碰任何真实数据。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'jw-story-probe-'));
process.env.V5_PREVIEW_DATA_DIR = dataDir;

const SITE = 'C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/lib/v5-preview';
const url = (f) => pathToFileURL(join(SITE, f)).href;

const { DEMO_STORY_STEPS } = await import(url('demo-story-data.ts'));
const { createSeedOverview, submitNote } = await import(url('service.ts'));
const { getStoryState, runStoryCommand, DemoStoryError } = await import(url('demo-story-service.ts'));
const store = await import(url('store.ts'));

const byId = new Map(DEMO_STORY_STEPS.map((s) => [s.stepId, s]));
const findings = [];
let seq = 0;

function record(mechanism, expect, actual, status) {
  findings.push({ mechanism, expect, actual, status });
}

function expectError(fn, code) {
  try {
    fn();
    return { hit: false, got: null };
  } catch (e) {
    return { hit: e instanceof DemoStoryError && e.code === code, got: e instanceof DemoStoryError ? e.code : e.name };
  }
}

function restart() {
  store.writeV5StoreState({ overview: createSeedOverview('approval'), idempotency: new store.V5IdempotencyTable() });
}

const cur = () => getStoryState();
/** 原子驱动一次推进（服务端自己链式连穿常规步）。 */
function advance() {
  const st = cur();
  return runStoryCommand({ action: 'advance', requestId: `probe-a-${seq++}`, expectedVersion: st.version, fromStepId: st.step.stepId });
}
/** 在当前决定点做出决定。 */
function decide(decision, note) {
  const st = cur();
  return runStoryCommand({
    action: 'decide',
    requestId: `probe-d-${seq++}`,
    expectedVersion: st.version,
    fromStepId: st.step.stepId,
    decision,
    ...(note !== undefined ? { note } : {}),
  });
}
/** 重置到指定步：重启后 advance/决定(confirm) 直到到达；决定点=目标时停在其上。 */
function resetTo(stepId) {
  restart();
  let guard = 0;
  for (;;) {
    const st = cur();
    if (st.step.stepId === stepId) return;
    guard += 1;
    if (guard > DEMO_STORY_STEPS.length + 5) throw new Error(`resetTo 无法到达 ${stepId}，停在 ${st.step.stepId}`);
    if (st.step.decision) decide('confirm');
    else advance();
  }
}
/** 重置后连推进到第一个决定点（默认即 s09）。 */
function toFirstDecision() {
  resetTo('s00-opp-01');
  while (!cur().step.decision) advance();
}

// ---------- P1 起点/重启 ----------
{
  restart();
  const st = cur();
  record(
    '重新开始 / 起点（重启=既有 seed approval；s00 签名一致）',
    '重启后 GET 即 story 模式、当前步=s00',
    `mode=${st.mode}, step=${st.step?.stepId}, stepsTotal=${st.step?.stepsTotal}`,
    st.mode === 'story' && st.step?.stepId === 's00-opp-01' ? 'OK' : 'GAP'
  );
}

// ---------- P2 常规动作链式推进（一键=自动链，停人工边界） ----------
{
  restart();
  const landings = [];
  let guard = 0;
  while (!cur().step.decision) {
    guard += 1;
    if (guard > 10) throw new Error('P2 超限');
    landings.push(cur().step.stepId);
    advance();
  }
  landings.push(cur().step.stepId);
  const holdLanded = landings.includes('s03-dd-01') && landings.includes('s05-dd-03');
  record(
    '常规自动动作链式推进（机制 advanceAuto 同语义）',
    '一击连穿常规步；在人工动作步（发起访谈/现场补充）与决定点停下',
    `落点序列 ${landings.join('→')}；人工动作步停链=${holdLanded}`,
    landings[landings.length - 1] === 's09-dd-07' && holdLanded ? 'OK' : 'GAP'
  );
}

// ---------- P3 决定门 / 步骤门 / 版本门 ----------
{
  resetTo('s09-dd-07');
  const st = cur();
  const gate = expectError(
    () => runStoryCommand({ action: 'advance', requestId: `probe-gate-${seq++}`, expectedVersion: st.version, fromStepId: 's09-dd-07' }),
    'STORY_DECISION_REQUIRED'
  );
  record('人工决定门（决定点 advance 被拒）', '409 STORY_DECISION_REQUIRED', gate.hit ? '按预期拒绝' : `实际 ${gate.got ?? '未拒绝'}`, gate.hit ? 'OK' : 'GAP');

  const stale = expectError(
    () => runStoryCommand({ action: 'advance', requestId: `probe-stale-${seq++}`, expectedVersion: st.version, fromStepId: 's00-opp-01' }),
    'STORY_STEP_CHANGED'
  );
  record('防跳步/串线（fromStepId 与当前步不符）', '409 STORY_STEP_CHANGED', stale.hit ? '按预期拒绝' : `实际 ${stale.got ?? '未拒绝'}`, stale.hit ? 'OK' : 'GAP');

  const ver = expectError(
    () => runStoryCommand({ action: 'advance', requestId: `probe-ver-${seq++}`, expectedVersion: st.version - 1, fromStepId: 's09-dd-07' }),
    'VERSION_CONFLICT'
  );
  record('版本门（expectedVersion 过期）', '409 VERSION_CONFLICT 带 serverVersion', ver.hit ? '按预期拒绝' : `实际 ${ver.got ?? '未拒绝'}`, ver.hit ? 'OK' : 'GAP');

  const badDec = expectError(
    () => runStoryCommand({ action: 'decide', requestId: `probe-bd-${seq++}`, expectedVersion: st.version, fromStepId: 's09-dd-07', decision: 'teleport' }),
    'INVALID_INPUT'
  );
  record('非法决定拒绝', '400 INVALID_INPUT（不在 confirm/correct/return 内）', badDec.hit ? '按预期拒绝' : `实际 ${badDec.got ?? '未拒绝'}`, badDec.hit ? 'OK' : 'GAP');
}

// ---------- P4 幂等重放 / REQUEST_MISMATCH ----------
{
  restart();
  advance(); // s00 → 落 s03（hold）
  const st = cur();
  const body = { action: 'advance', requestId: 'probe-idem-1', expectedVersion: st.version, fromStepId: st.step.stepId };
  const r1 = runStoryCommand(body);
  const r2 = runStoryCommand({ ...body });
  // 同 requestId 改载荷（当前步已前进）：hash 不同 → REQUEST_MISMATCH
  const mismatch = expectError(() => runStoryCommand({ ...body, fromStepId: r1.step.stepId }), 'REQUEST_MISMATCH');
  record(
    '重复动作：同 requestId 同载荷=幂等重放；异载荷=明确拒绝',
    '重放 replayed=true 且状态一致；同 requestId 改载荷 409 REQUEST_MISMATCH',
    `replayed=${r2.replayed === true}；异载荷拒绝=${mismatch.hit}`,
    r2.replayed === true && mismatch.hit ? 'OK' : 'GAP'
  );
}

// ---------- P5 确认/纠正/退回后继 + 判断更新可见性（本轮核心缺口） ----------
{
  // 确认路径
  toFirstDecision();
  decide('confirm');
  const afterConf = cur();
  const confMsgs = store.readV5StoreState({ seed: () => createSeedOverview('approval') }).overview.messages.map((m) => m.text).join('\n');
  record(
    '确认后继（DD-07 confirm → 尽调汇总）',
    '后继=s13-dd-08；汇总消息含「无正式审批结论」',
    `step=${afterConf.step.stepId}；结论文案存在=${confMsgs.includes('无正式审批结论')}`,
    afterConf.step.stepId === 's13-dd-08' ? 'OK' : 'GAP'
  );

  // 纠正路径：判断更新是否可见（本轮核心核查点）
  toFirstDecision();
  decide('correct', '人工更正：年产值→月产值（记录笔误）');
  const ovCor = store.readV5StoreState({ seed: () => createSeedOverview('approval') }).overview;
  const corTexts = ovCor.messages.map((m) => m.text).join('\n');
  const hasCorrectionRecord = corTexts.includes('人工更正记录');
  const noteKept = ovCor.messages.some((m) => m.text.includes('年产值→月产值'));
  const refs = byId.get(cur().step.stepId)?.evidenceRefs ?? [];
  record(
    '纠正后判断更新可见（预期：更正记录消息 + M1-DOC-01 v2 证据引用可见 + 旧口径分析作废声明）',
    'correct 分支产生可见的更正留档内容；note 只是补充留档，不是唯一载体',
    `更正记录消息=${hasCorrectionRecord ? '存在' : '不存在（correct 与确认的预设内容不可区分）'}；note留档=${noteKept}；落点证据引用=[${refs.join('；') || '无'}]`,
    hasCorrectionRecord ? 'OK' : 'GAP（v3候选已修：correct→效果应用步 s13c）'
  );

  // 退回路径（有限：A 续轮已对齐 C 机制——s12 再判点无 return 选项）
  toFirstDecision();
  decide('return');
  const s10 = cur().step.stepId;
  advance(); // 链：s11 + s12（s12=决定点，落其上）
  const atRe = cur().step.stepId;
  const again = expectError(() => decide('return'), 'INVALID_INPUT');
  decide('confirm'); // 退出循环
  const exited = cur().step.stepId;
  record(
    '退回后继与有限性（补充条件与退出方式）',
    'return→补交材料(hold)→复核→再判点；再判点仅确认/纠正（再退回被明确拒绝）；每圈必经人工补充步',
    `return→${s10}（人工动作停链）→advance 链至 ${atRe}；再退回拒绝=${again.hit}（INVALID_INPUT）；确认退出→${exited}`,
    s10 === 's10-dd-rt-1' && atRe === 's12-dd-07b' && again.hit && exited === 's13-dd-08'
      ? 'OK（已对齐 C 机制有限路径；每圈必经人工补充步=补充条件明确）'
      : 'GAP'
  );

  // 主线判断灯单调（D1 回退探针）：confirm 主线上绿灯集不得缩小
  resetTo('s00-opp-01');
  const greenCount = () => store.readV5StoreState({ seed: () => createSeedOverview('approval') }).overview.domains.filter((d) => d.judgmentStatus === 'green').length;
  let prevG = greenCount();
  let regressAt = null;
  let guardG = 0;
  while (cur().step.stepId !== 's21-pr-03') {
    guardG += 1;
    if (guardG > DEMO_STORY_STEPS.length + 5) throw new Error('P-D1 超限');
    if (cur().step.decision) decide('confirm');
    else advance();
    const c = greenCount();
    if (c < prevG && regressAt === null) regressAt = cur().step.stepId;
    prevG = Math.max(prevG, c);
  }
  record(
    '判断灯不回退（主线绿灯集单调，修复『状态变绿』叙事的回退）',
    '确认主线全程绿灯集不缩小',
    regressAt === null ? '全程单调' : `在 ${regressAt} 出现绿灯集缩小`,
    regressAt === null ? 'OK' : 'GAP（v3候选已修：s07/s08/s09–s12 累积式四域行）'
  );
}

// ---------- P6 签约门与终态 / 全绿不变式 ----------
{
  resetTo('s15-sg-02');
  const gate = expectError(
    () => runStoryCommand({ action: 'advance', requestId: `probe-sg-${seq++}`, expectedVersion: cur().version, fromStepId: 's15-sg-02' }),
    'STORY_DECISION_REQUIRED'
  );
  record('签约前人工复核门（制度必需决定不自动越过）', 'advance 被拒，必须 decide', gate.hit ? '按预期拒绝' : `实际 ${gate.got ?? '未拒绝'}`, gate.hit ? 'OK' : 'GAP');

  resetTo('s18-sg-03');
  let sawAllGreen = false;
  let guard = 0;
  for (;;) {
    const st = cur();
    if (st.step.stepId === 's21-pr-03') break;
    const allGreen = store.readV5StoreState({ seed: () => createSeedOverview('approval') }).overview.domains.every((d) => d.judgmentStatus === 'green');
    if (allGreen) sawAllGreen = true;
    guard += 1;
    if (guard > 10) throw new Error('P6 超限');
    if (st.step.decision) decide('confirm');
    else advance();
  }
  const ov = store.readV5StoreState({ seed: () => createSeedOverview('approval') }).overview;
  const endAllGreen = ov.domains.every((d) => d.judgmentStatus === 'green');
  record(
    '四域全绿仅在终态（不提前全绿）',
    's18..s20 不得全绿；s21（settled 种子签名）全绿',
    `中途全绿=${sawAllGreen ? '出现（违规）' : '未出现'}；终态全绿=${endAllGreen}；scenario=${ov.scenario}`,
    !sawAllGreen && endAllGreen && ov.scenario === 'settled' ? 'OK' : 'GAP'
  );

  const endGate = expectError(
    () => runStoryCommand({ action: 'advance', requestId: `probe-end-${seq++}`, expectedVersion: cur().version, fromStepId: 's21-pr-03' }),
    'STORY_STEP_CHANGED'
  );
  record('结清终态（advance 拒绝，提示重新开始）', '终点无后继，明确拒绝', endGate.hit ? '按预期拒绝' : `实际 ${endGate.got ?? '未拒绝'}`, endGate.hit ? 'OK' : 'GAP');
}

// ---------- P7 刷新恢复（签名推导）与 free 模式 ----------
{
  resetTo('s03-dd-01');
  const before = cur().step.stepId;
  // 项目沟通（chat 消息通道）不触碰待办/四域 → 签名不变，演示定位不丢
  const { postMessage } = await import(url('service.ts'));
  postMessage({ requestId: `probe-msg-${seq++}`, expectedVersion: cur().version, text: '追加项目沟通（探针，合成）', actorRole: 'business' });
  const after = cur();
  record(
    '快照恢复/刷新（overview 内容签名=唯一事实源推导当前步）',
    '项目沟通（消息通道，版本+1、消息+1）后，GET 仍定位同一步（消息不参与签名）',
    `before=${before}, after=${after.step?.stepId}, mode=${after.mode}`,
    before === after.step?.stepId && after.mode === 'story' ? 'OK' : 'GAP'
  );

  // story 待办上提交补充说明：待办状态翻转 → 签名脱离 → free（A 测试已断言接受的既有设计）
  resetTo('s03-dd-01');
  submitNote({ requestId: `probe-note-${seq++}`, expectedVersion: cur().version, todoId: byId.get('s03-dd-01').todo.id, text: '补充说明（探针，合成）', actorRole: 'business' });
  const freed = cur();
  record(
    'story 待办上提交补充说明（设计张力：既有 notes 语义 vs 固定演示签名）',
    '机制期望：演示中的判断留档留在演示状态内；产品现行为：待办状态翻转→签名脱离→free（诚实提示+重新开始兜底；A 测试已接受）',
    `提交后 mode=${freed.mode}（free=按既有设计脱离）`,
    freed.mode === 'free' ? 'MAPPED（合理映射·既有语义优先；若希望演示内判断留档不跌出，需产品决定：story 待办禁用 notes 或状态不翻转）' : 'GAP'
  );

  store.writeV5StoreState({ overview: createSeedOverview('post-rental'), idempotency: new store.V5IdempotencyTable() });
  const free = cur();
  record('free 模式诚实降级（签名脱离固定路线）', 'mode=free + 诚实说明，不改用户状态', `mode=${free.mode}, notice=${free.freeNotice ? '有' : '无'}`, free.mode === 'free' && free.freeNotice ? 'OK' : 'GAP');
}

// ---------- P8 数据级扫描（对真实集成数据） ----------
{
  const bareLabels = [];
  const contradictions = [];
  let modelOk = true;
  for (const s of DEMO_STORY_STEPS) {
    for (const o of s.decision?.options ?? []) {
      if (['确认', '纠正', '退回'].includes(o.label)) bareLabels.push(`${s.stepId}:${o.kind}`);
    }
    if (s.decision && /不再提供退回|仅提供确认|仅可确认或纠正/.test(s.decision.prompt) && s.decision.options.some((o) => o.kind === 'return')) {
      contradictions.push(s.stepId);
    }
    for (const m of s.messages ?? []) {
      if (m.fromName.includes('模型') && !(m.fromName.includes('模拟') && m.text.includes('模拟') && m.text.includes('authority=none'))) modelOk = false;
    }
  }
  record('决定效果消息在预设数据中（correct 留档可见性）', 'correct 分支的可见内容含更正记录', `数据含更正记录消息=${DEMO_STORY_STEPS.some((s) => s.messages.some((m) => m.text.includes('人工更正记录')))}`, '见 P5 判定（v3候选已修）');
  record('选项标签/prompt 一致性', '无裸标签；prompt 不与选项自相矛盾', `裸标签=${bareLabels.length ? bareLabels.join(',') : '无'}；prompt矛盾=${contradictions.length ? contradictions.join(',') : '无'}`, bareLabels.length === 0 && contradictions.length === 0 ? 'OK' : 'GAP（v2候选已修）');
  record('预设消息不冒充模型判断', '模型署名必须带（模拟）+正文声明模拟+authority=none', modelOk ? '全部合规' : '存在不合规', modelOk ? 'OK' : 'GAP');
  const holdSteps = DEMO_STORY_STEPS.filter((s) => s.holdForHuman === true).map((s) => s.stepId);
  record('人工动作步停链（holdForHuman）', '发起访谈/现场补充/补交材料/签约补充 四步停链', holdSteps.length ? `hold 步=${holdSteps.join(',')}` : '无 hold 步', holdSteps.length === 4 ? 'OK' : 'GAP');
}

// ---------- 输出 ----------
rmSync(dataDir, { recursive: true, force: true });
const icon = { OK: '✅ 已落地', MAPPED: '🟰 合理映射（含保留差异说明）', GAP: '⚠️ 缺口（v2候选已修，待 A 采用）', HOLD: '⏸ 保留/需产品决定' };
const lines = [
  '# 产品行为探针发现（story 路对真实产品代码逐行为核对）',
  '',
  `- 运行时间：${new Date().toISOString()}`,
  '- 被测对象：`jianwei-v3/site/lib/v5-preview/demo-story-{data,service,types}.ts` + `service.ts` + `store.ts`（源码只读；数据目录=临时隔离目录，已清理；被测数据=A 续轮 2026-09-14 08:10 版 22 步表）',
  '- 判定图例：OK=已落地；MAPPED=合理映射（语义等价或已明确补充条件/退出方式）；GAP=缺口（v2 候选已修，待 A 采用）；HOLD=保留/需产品决定',
  '',
  '| # | 核心机制 | 机制预期 | 产品实际行为（探针） | 判定 |',
  '| --- | --- | --- | --- | --- |',
  ...findings.map((f, i) => `| ${i + 1} | ${f.mechanism} | ${f.expect} | ${f.actual} | ${icon[f.status] ?? f.status} |`),
  '',
  '## 探针局限（如实）',
  '- 「重新开始」以 store 写入 approval 种子模拟（与 POST /api/v5-preview/demo/seed 同语义）；未走 HTTP 路由与浏览器 UI（UI 由 A/D 覆盖）。',
  '- 探针运行时产品数据为 A 已集成的 v1 22 步表；标「v3候选已修」的 GAP 行在采用 `candidate/a-shape/demo-story-a-v3.json`（23 步）后应转 OK——采用后请重跑本探针复核。',
  '- 探针不覆盖 CSS/响应式/键盘可达性（B 路 D 路范围）。',
];
writeFileSync(join(here, '..', 'product-behavior-findings.md'), lines.join('\n'), 'utf8');
const counts = {};
for (const f of findings) counts[f.status] = (counts[f.status] ?? 0) + 1;
console.log(`探针完成：${findings.length} 项 — OK=${counts.OK ?? 0} MAPPED=${counts.MAPPED ?? 0} GAP=${counts.GAP ?? 0} HOLD=${counts.HOLD ?? 0}`);
console.log('输出：story/product-behavior-findings.md');
