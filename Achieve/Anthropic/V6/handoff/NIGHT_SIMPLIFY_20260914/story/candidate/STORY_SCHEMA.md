# STORY_SCHEMA｜机制版数据契约与 A 形状映射（任务C candidate）

- 状态：候选。机制版 schema `jw-demo-story@1`（本目录 `../demo-story.json`）；A 形状映射 `a-shape/demo-story-a.json`（按 A CONTRACT §3/§4，2026-09-14 01:58 冻结版构建）。
- 依据：A 冻结的最小数据形状见 `../../main/CONTRACT.md` §3；本文件记录机制版字段语义与到 A 形状的一次性映射规则。

## 1. 机制版（jw-demo-story@1）为什么多出这些字段

A 形状是"固定顺序步骤表 + 每步 ≤3 确定性后继"，服务端按内容签名定位当前步——执行不依赖图引擎。机制版在其之下多声明三类**可核验结构**，用于 CP4 要求的行为测试（图内编码边界，而非服务端约定）：

| 机制版字段 | A 形状对应 | 作用 |
| --- | --- | --- |
| `steps[].requires` / `requiresAny`（支持 `{step, outcome[]}` 条件） | 隐含在线性顺序 + nextStepId 跳转 | 静态可达/前提门/退回仅解锁补充路径的行为断言（前序未满足不完成） |
| `steps[].decisionOptions[].outcome`（close/return） | 决定 kind 本身 | 退回结果只能解锁补充步（`DD-RT-1.requires=[{DD-07,outcome:[return]}]`），不能解锁 DD-08 |
| `steps[].view` + `milestoneIndex` / `viewPatch`（含决定级 returnPatch） | 每步完整 `domains: DomainRow[]` | 机制版按"最新里程碑视图 + 窗口内补丁"推导显示态；退回后不全绿可被测试断言 |
| `evidence` / `evidenceAdds` / `opinions` + 决定 `effects.evidenceUpdates/invalidateOpinions` | `evidenceRefs: string[]`（仅展示） | 证据升版（v1→v2 superseded）与旧口径意见作废的机制级核验 |
| `actors` / 消息 `actor` 键 | `messages: OverviewMessage[]`（fromKind/fromName 直填） | 消息按角色注册表映射，保证 fromKind 枚举合法 |
| `parallelGroups` | 线性表内 DD-03..06 相邻 | 部分并行语义（共用前提、无内部顺序）的可测声明 |

## 2. 映射规则（A CONTRACT §4）

- `stepId`：A 形状用 `s00-<原id小写>`（URL/日志安全），`origStepId` 保留原 ID 供 review（集成可删）。
- `stage` → `stageIndex 0..4`（商机/预审/尽调/签约/租后）；`stageLabel` 同步。
- 四域行：直接用 `shared-types.ts` 的 `DomainRow`，segmentLabels 照抄种子模板；segments 按叙事对齐，**不存在前提的域不提前完成**（asset 域在签约前保持 pending 起步，PR 步才推进）。
- `view.overallLabel` → `progressLabel`；`scenarioLabel = '固定演示 · ' + stageLabel`；**s00 整体照抄 approval 种子**（scenarioLabel/progressLabel/domains/todo/messages 逐字段），保证内容签名一致。
- 每步 `todo` id 全表唯一（`todo-<stepId>`），满足"每步必须改变 domains/todo/progressLabel 之一"。
- 消息：`actor` → `fromKind`（business/domain/system）+ `fromName`（含"合成"/"模拟"标注）；**marks 只用** `'演示情景' | '合成判断' | '补充说明' | '项目沟通'`；`id = <stepId>-m<n>`；`at` 为确定性占位（`2026-09-14T01:00:00.000Z`，服务端写入可重盖）。
- 决策：恰 3 类 confirm/correct/return；后继映射 `DD-07{confirm,correct}→DD-08`、`DD-07.return→DD-RT-1`、`DD-07B.*→DD-08`（return→DD-RT-1，见差异#1）、`SG-02{correct,return}→SG-RT`、`SG-02{confirm}→SG-03`、`SG-02B{confirm,correct}→SG-03`。

## 3. 已知形状差异（需 A 裁量，非阻塞）

1. **DD-07B 再退回**：机制版在图内编码"退回仅一次"（DD-07B 无 return 选项，decide(return) 返回 INVALID_DECISION）；A 形状要求恰 3 类选项，故 DD-07B.return→DD-RT-1 构成"补证循环"（每圈需显式补充+复核两个动作）。A 如需硬性一次限制，可在 service 层用幂等表/步数判断，或将 DD-07B.return 的 nextStepId 指向提示终步（注意：提示步不得让 advance 顺延回主线，否则带疑点全绿——违反 CP3）。
2. **纠正的证据升版**：机制版决定效果真实执行升版/作废（`assertEvidenceCite` 拒绝旧版本引用）；A 形状中体现为 DD-08 预设文案的双口径表述 + decide `note` 留档。如 A 需要，可给 correct 选项加 `applyStepId` 中间步承载更正消息。
3. **s00 签名**：本候选照抄 `createSeedOverview('approval')` 当前实现（service.ts @2026-09-14 读取）；若 A 修改种子，需同步重跑 `node candidate/a-shape/build-a-shape.mjs`。

## 4. 构建与校验

```bash
node candidate/a-shape/build-a-shape.mjs   # 重建 demo-story-a.json
node test/run-all.mjs                       # 29 项机制/数据测试（零依赖）
```

构建器内置断言：nextStepId 存在、todo 全表唯一、DOM 映射齐全；缺一步即构建失败。
