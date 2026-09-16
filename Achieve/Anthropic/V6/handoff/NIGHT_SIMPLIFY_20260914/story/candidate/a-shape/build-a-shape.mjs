// A 形状补丁器 v3：以**产品当前数据**（jianwei-v3/site/lib/v5-preview/demo-story-data.ts）
// 为基底打最小补丁，产出 candidate/a-shape/demo-story-a-v3.json（23 步）。
// 运行：node candidate/a-shape/build-a-shape.mjs
//
// v3 只含两个补丁（其余与产品逐字节一致，A 采用=整体替换 steps 数组，零 service/type 改动）：
//  [D1] 判断灯回退修复：s07/s08 的四域行改为逐级累积（s06→s07 policy 绿→黄、asset 黄→灰
//       的回退消除；policy 在尽调阶段保持"适用条件已确认"绿，权属补证事项由 summary 承载）。
//  [D2] 纠正判断更新可见：correct 后继改为效果应用步 s13c（人工更正记录消息入留档流 +
//       M1-DOC-01 v2 证据引用 + 判断灯"更正已记录"）；s13 保持确认路径并显式 nextStepId=s14。
//       修复"纠正只加 note 就继续、且 UI 提示『已并入档』超前于实际持久化内容"的缺口。
// 构建期自校验：签名唯一（同产品算法）、s00/终点步与产品原数据完全一致、todo 唯一、
// 后继存在、无裸标签、all-green 仅终点、确认/纠正路径内容可区分。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_DATA = 'C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/lib/v5-preview/demo-story-data.ts';

// ---- 读取产品当前步骤表（源码只读；其 steps 数组为纯 JSON 字面量） ----
const text = readFileSync(PRODUCT_DATA, 'utf8');
const declIdx = text.indexOf('DEMO_STORY_STEPS');
const arrStart = text.indexOf('= [', declIdx) + 2;
const arrEnd = text.lastIndexOf('];');
if (arrStart < 0 || arrEnd < 0) throw new Error('未能定位产品 steps 数组');
const steps = JSON.parse(text.slice(arrStart, arrEnd + 1));
const byId = new Map(steps.map((s) => [s.stepId, s]));

const sig = (s) =>
  JSON.stringify({
    scenario: s.scenario ?? 'approval',
    todoId: s.todo?.id ?? null,
    todoStatus: s.todo?.status ?? null,
    progressLabel: s.progressLabel,
    domainSig: s.domains
      .map((d) => `${d.domainId}:${d.segments.join(',')}|${d.judgmentStatus}|${d.judgmentText}`)
      .join(';'),
  });

const origS00 = JSON.stringify(steps[0]);
const origTerminal = JSON.stringify(steps[steps.length - 1]);

// ---- [D1] s07/s08 累积式四域行（以 s06 为基线逐级叠加，不回退） ----
const clone = (s) => JSON.parse(JSON.stringify(s));
const s06 = byId.get('s06-dd-04');
byId.get('s07-dd-05').domains = s06.domains.map((d) => {
  if (d.domainId === 'policy') return { ...d, judgmentText: '适用条件已确认', summary: '权属链条一致性已列为补证事项（合成提示）' };
  return d; // policy 保持绿；credit/commerce/asset 维持 s06 状态（asset 黄不回退）
});
byId.get('s08-dd-06').domains = byId.get('s07-dd-05').domains.map((d) =>
  d.domainId === 'commerce'
    ? { ...d, segments: ['done', 'current', 'pending', 'pending'], judgmentStatus: 'yellow', judgmentText: '待经济性核算', summary: '成数口径待核算（未配置；不填默认值，合成）' }
    : d
);
// 政策域判断灯在尽调段（s09–s12，含退回分支）保持绿不回退；补证事项由 summary/credit 承载
for (const sid of ['s09-dd-07', 's10-dd-rt-1', 's11-dd-rt-2', 's12-dd-07b']) {
  byId.get(sid).domains = byId.get(sid).domains.map((d) =>
    d.domainId === 'policy'
      ? { ...d, judgmentStatus: 'green', judgmentText: '适用条件已确认', summary: '权属链条补证事项随单流转（合成）' }
      : d
  );
}

// ---- [D2] 纠正效果应用步 + 后继改指 ----
byId.get('s09-dd-07').decision.options.find((o) => o.kind === 'correct').nextStepId = 's13c-dd-08-correct';
byId.get('s12-dd-07b').decision.options.find((o) => o.kind === 'correct').nextStepId = 's13c-dd-08-correct';
byId.get('s13-dd-08').nextStepId = 's14-sg-01'; // 确认路径显式后继（缺省数组下一项会落在新插入步上）

const s13 = byId.get('s13-dd-08');
const s13c = {
  stepId: 's13c-dd-08-correct',
  stageIndex: s13.stageIndex,
  stageLabel: s13.stageLabel,
  scenarioLabel: s13.scenarioLabel,
  progressLabel: '疑点处理：人工更正已记录',
  title: '人工更正记录（M1-DOC-07）',
  hint: '纠正决定的效果应用步：更正留档与证据升版可见，随后推进进入签约准备',
  domains: s13.domains.map((d) =>
    d.domainId === 'credit'
      ? { ...d, judgmentText: '更正已记录·待台账核实', summary: 'M1-DOC-01 已升版 v2；基于「年产值」口径的分析已作废（合成）' }
      : d
  ),
  todo: {
    id: 'todo-s13c-dd-08-correct',
    title: '人工更正已记录：进入签约准备',
    detail: '纠正决定已留档（M1-DOC-01 v1→v2，旧口径分析作废）；推进后进入签约准备。（合成演示）',
    status: '待补充',
    relatedDomain: 'credit',
  },
  messages: [
    {
      id: 's13c-dd-08-correct-m0',
      fromKind: 'domain',
      fromName: '信审复核人（人工·合成）',
      text: '人工更正记录（M1-DOC-07 v1，合成）：经与客户财务人员核对，纪要「年产值约450万元」系业务记录笔误，更正为「月产值约450万元」；M1-DOC-01 升版为 v2（v1 仅留档追溯、不再作为有效引用），基于「年产值」口径的产能-能耗匹配分析作废。疑点 DD-DOUBT-1 中「满负荷 vs 一半产能」矛盾仍待客观材料澄清。（人工决定·纠正，合成演示）',
      at: '2026-09-14T01:00:00.000Z',
      marks: ['补充说明'],
    },
  ],
  evidenceRefs: ['M1-DOC-01 v2（更正后有效版本）', 'M1-DOC-07 v1（更正记录）'],
  nextStepId: 's14-sg-01',
};
const s13Idx = steps.indexOf(s13);
steps.splice(s13Idx + 1, 0, s13c);

// ---- 构建期自校验 ----
const sigs = steps.map(sig);
if (new Set(sigs).size !== steps.length) throw new Error('签名不唯一');
if (JSON.stringify(steps[0]) !== origS00) throw new Error('s00 被改动（必须与产品一致）');
if (JSON.stringify(steps[steps.length - 1]) !== origTerminal) throw new Error('终点步被改动（必须与产品一致）');
const ids = new Set(steps.map((s) => s.stepId));
for (const s of steps) {
  for (const o of s.decision?.options ?? []) {
    if (!ids.has(o.nextStepId)) throw new Error(`${s.stepId} ${o.kind} 后继不存在：${o.nextStepId}`);
    if (['确认', '纠正', '退回'].includes(o.label)) throw new Error(`${s.stepId} 裸标签`);
  }
  if (s.nextStepId !== undefined && !ids.has(s.nextStepId)) throw new Error(`${s.stepId} nextStepId 不存在`);
}
const todoIds = steps.map((s) => s.todo?.id ?? null);
if (todoIds.some((x, i) => x !== null && todoIds.indexOf(x) !== i)) throw new Error('todo id 重复');
for (const s of steps.slice(0, -1)) {
  if (s.domains.every((d) => d.judgmentStatus === 'green')) throw new Error(`${s.stepId} 终点前四域全绿`);
}
// 确认/纠正路径可区分：correct 落点流必含更正记录，confirm 落点流不含
const walkMsgs = (path) => path.flatMap((sid) => (byId.get(sid)?.messages ?? []).map((m) => m.text));
const corrTexts = ['s13c-dd-08-correct', 's14-sg-01'].join();
if (!/人工更正记录/.test(JSON.stringify(s13c.messages))) throw new Error('s13c 缺更正记录消息');
const confStep = byId.get('s13-dd-08');
if ((confStep.messages ?? []).some((m) => m.text.includes('人工更正记录'))) throw new Error('s13（确认路径）不得含更正记录');
// 主线判断灯单调（默认链：s00→…，decisions 取 confirm；s13 显式后继）
{
  const greenCount = (s) => s.domains.filter((d) => d.judgmentStatus === 'green').length;
  let cur = steps[0];
  let prev = greenCount(cur);
  let guard = 0;
  while (cur.stepId !== steps[steps.length - 1].stepId) {
    if (guard++ > steps.length + 5) throw new Error('主线链死循环');
    if (cur.decision) {
      cur = byId.get(cur.decision.options.find((o) => o.kind === 'confirm').nextStepId);
    } else {
      cur = cur.nextStepId !== undefined ? byId.get(cur.nextStepId) : steps[steps.indexOf(cur) + 1];
    }
    if (!cur) throw new Error('主线链断裂');
    const c = greenCount(cur);
    if (c < prev) throw new Error(`主线绿灯集缩小：${cur.stepId}`);
    prev = c;
  }
}

const out = path.join(here, 'demo-story-a-v3.json');
writeFileSync(out, JSON.stringify({ schema: 'jw-demo-story-a@1', version: 3, base: 'product demo-story-data.ts@2026-09-14T08:10', stepsTotal: steps.length, steps }, null, 2), 'utf8');
console.log(`OK：v3 写出 ${steps.length} 步（= 产品 22 步 + 纠正效果应用步 s13c）；D1 判断灯回退已修；D2 纠正可见已修；自校验通过`);
