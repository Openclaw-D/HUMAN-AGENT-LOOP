# B0_INTERFACE_CANDIDATE｜A2A 协作后端接口设计（工程 Candidate，非已接受 schema）

状态：`CANDIDATE / FOR REVIEW · Rev1`（2026-09-06 按 [B0_CODEX_REVIEW.md](B0_CODEX_REVIEW.md) 四项问题与文档质量补充完成修订；修订点以各节"审查修订"标注为准，汇总见 B0_REPORT §8）。上位权威：V5/CONTRACT.md、V5/DECISIONS.md 第 11–17 项、ZCODE_BACKEND_TASK.md。
协议核验依据：`evidence/B0/sources-protocol-research-20260906.md`（A2A 官方规范 v1.0.1/v0.3.0、Microsoft Agent Framework 官方文档，读取日 2026-09-06）。
合成事件具体示例：`evidence/B0/synthetic-event-example.md`。

## 0｜设计立场

1. **协议复用，不造协议**：A2A 已原生提供任务身份（Task/TaskId/contextId）、消息往返（Message/MessageParts/artifacts、同 taskId+contextId 追问）、状态机（SUBMITTED/WORKING/INPUT_REQUIRED/AUTH_REQUIRED/COMPLETED/FAILED/CANCELED/REJECTED）、取消（幂等）、SSE 订阅与重订阅、push notification（at-least-once）。这些一律直接采用其对象与语义命名，不自定义第二套。
2. **协议不解决的三件事由 v4life 应用层承担**（标准与框架均未提供）：差异化 packet 组装、纠偏版本化与旧结果隔离、权威写入（Agent 结果恒为 Candidate，authority=none，正式化只经既有 Human Gate 命令）。
3. **实现路线分阶段声明（本轮约束 ≠ 长期路线）**：本轮禁止安装依赖，故 B1 只能以 Node/TypeScript 最小自实现协议子集 + 可控测试替身完成**本地状态测试**——这是本轮约束，不据此推导长期自实现路线。MS Agent Framework 提供 orchestration/HITL/checkpoint 成熟模式且官方支持 A2A host/client，但运行时为 .NET/Python/Go、无 Node，仅作语义参照与对端互操作参考。Node 侧长期路线（社区 TS SDK / adapter 映射既有框架 / 继续自实现）是未决的用户依赖 Gate（选项比较见 §8）。**证据分级**：本地状态测试（测试替身）→ wire 兼容测试（Agent Card/SendMessage 映射）→ 独立对端互通（异构对端实测）；三级分别取证，前两级一律不得表述为"A2A 互通"或"协议兼容认证"。
4. **不建第二权威**：协作状态全部落 v4life 事件账本（CANDIDATE additive 事件类型，沿用 P1 隔离先例），投影由既有 fold/rebuild 重建；summary/聊天记录只是索引，不是事实源。

## 1｜消息身份及关联

| 候选字段 | 来源/映射 | 说明 |
| --- | --- | --- |
| `eventId`（= A2A `contextId` 等价物） | 新增，事件粒度 | 一次业务事件（如"申请包到达"）开启一个协作 context；四域全部任务/消息共享 |
| `taskId` | A2A Task.id（服务端生成） | 每域每职责一个协作任务：`task-<domain>-<seq>`；可重派发但 id 不变、版本递增 |
| `messageId` | A2A Message.messageId（发送方生成） | 去重键：重复投递同 messageId 不重复产生工作（A2A 仅 MAY，应用层 MUST） |
| `sender/recipient` | actor/agent 标识 | Agent 标识 `agent-<domain>`；人走既有 actor 名册；sender 不冒充他人 |
| `replyTo`/`referenceTaskIds` | A2A referenceTaskIds | 追问与回复的关联链；跨任务引用可追溯 |
| `kind` | A2A 判别字段 | message/task/artifact/correction 四类对象统一判别 |

## 2｜输入与上下文（差异化 packet）

Packet 结构见 `evidence/B0/synthetic-event-example.md` §1。要点：

- `sharedFacts[]`：四份逐字节一致、带 `contextVersion` 的共享事实引用（指向既有 Evidence，不复制内容）——上下文一致性可被 diff 断言。
- 按职责差异化的字段：`responsibility`、`taskGoal`、`relevantFacts`（sharedFacts 的真子集，互不相同）、`focusHints`、`allowedActions`、`outputConstraints`（artifact 类型、maxRounds）、`dependencies`。组装器为纯函数（读 Projection + 域职责表），可单测"有意义差异"。
- 上下文接续：`contextVersion`（M.m）随纠偏递增；任务快照记录派发时版本；历史版本可追溯（事件账本全量）。
- 压缩/compact：只允许对**消息正文**做摘要索引；事实引用与决定永不进摘要——恢复一律从事件账本 rebuild，缺记录失败关闭。

## 3｜状态与触发

- **协作任务状态机**（沿用 A2A TaskState 词汇，见下表三层分离）：`dispatched(SUBMITTED) → working ↔ awaiting_input(INPUT_REQUIRED) → candidate_ready → superseded / canceled(CANCELED) / failed(FAILED)`。`candidate_ready` ≠ 正式完成；正式化只经既有 Gate（approved/rejected/returned 产生既有 Receipt/事件）。
- **三层状态分离**（审查修订：协议态、应用结果有效性、正式权威互不混用，`candidate_ready`/`superseded` 等应用层词汇永不作为 A2A TaskState 对 wire 层发送）：

| 层 | 词汇 | 来源 | 语义 |
| --- | --- | --- | --- |
| 协议任务状态（可对 wire 层暴露） | SUBMITTED / WORKING / INPUT_REQUIRED / COMPLETED / FAILED / CANCELED / REJECTED | A2A TaskState 原生 | 传输与生命周期 |
| 应用结果有效性（仅内部投影/事件账本） | candidate_ready / superseded / carried_forward | v4life additive 事件 | 协作产出是否仍属当前有效上下文；与协议态独立判定 |
| 正式权威（Human Gate） | approved / rejected / returned（既有 Receipt/事件） | 既有 v4life 命令边界 | 唯一正式化通道；Agent 恒 authority=none |

  映射规则：一个任务协议层可为 `COMPLETED`（Agent 已交付候选），其结果有效性仍可被纠偏判为 `superseded`；正式状态只能由 Human Gate 改变。三层各自独立可判定、任何一层不替代另一层（B1 测试 5/9 对应断言）。
- **触发边界**：可派发 ≠ 可正式推进。准备性并行仅限"无硬前序 + 低成本可撤回"（任务书风险平衡条款，边界待 Control/用户评审）；正式前序未满足时复用既有依赖三分法拦截（evidence/receipt/workitem 依赖原样生效，collab 依赖为新增第四类候选）。
- **Candidate 不解锁正式前序**（审查修订）：候选完成（candidate_ready 或四域候选齐备）只证明准备性协作就绪，不产生任何 Receipt、不改变任何正式核验事实；collab 依赖只支持"提前准备"，正式推进的有效前置只能是**有效 Human Decision/Receipt**（如商务条件正式化依赖信审/政策的有效批准 Receipt）。候选齐备而无对应 Receipt 时，正式推进请求一律拒绝（经验来源：STARS completed 与业务 REJECTED 并存、JW 越权模型输出不产生有效回复——HISTORICAL_REUSE B0-4 行；B1 测试 5 对应断言）。
- **取消**：映射 CANCELLED 幂等语义；取消后晚到的结果按 §4 隔离；取消后不自动重派（人不授权不重试）。
- **超时/重试上限**：`maxRounds` + 显式超时配置；超限转 `awaiting_input` 等人，不无限自派工（B1 行为测试 8）。

## 4｜纠偏、隔离与恢复

- `correction` 对象：具名人、内容、`appliesTo`（基线版本 + 受影响任务集合 + 受影响事实引用/依赖范围）、`newContextVersion`；落事件账本。
- **失效判定按任务级输入版本，不按全局版本**（审查修订，替代原"全局版本较旧即隔离"）：每个结果记录派发时的 `inputVersion`（packet 快照版本）与 `effectiveDependencies`；晚到结果仅当满足任一条件才判 `superseded`——(a) 其任务 ∈ `appliesTo` 任务集合；(b) 其 `effectiveDependencies` 含被本次纠偏判失效的对象；(c) 其 `relevantFacts` 引用的证据被纠偏明确改写。**仅全局 `contextVersion` 变旧不构成失效**：未命中上述条件的旧版本结果保持有效，标记 `carried_forward` 入投影（保留原 `inputVersion` 与来源链，注明"产生于 v<old>，经 <correctionId> 核对仍适用"）。经验来源：STARS reconsiderContext 的"新修订关联旧 Context、原否决决定保留"；整 Context 重建方案仅候选不采用——它不能证明四域局部依赖失效（HISTORICAL_REUSE B0-1 行）。
- 受影响任务 → 停旧推进转 awaiting_input，按新版本重派（taskId 不变、版本递增）；未受影响任务保留 working、不被打断。**受影响/未受影响对照轨迹**（B1 测试 4 的验收形态，两条都必须可断言）：同一纠偏下，信审/商务（appliesTo 命中）旧结果晚到 → `superseded` 进隔离投影、保留 artifact 与来源链可追溯，不进入当前上下文、不触发依赖；政策/资产（未命中）结果在 v1.1 下 → `carried_forward` 有效。合成对照见 evidence §3。
- **恢复载荷下限**（审查修订：哈希不能恢复上下文，冷启动必须可重建完整依据）：
  1. `COLLAB_TASK_DISPATCHED` / `COLLAB_TASK_REDISPATCHED` 事件必须携带 **packet 全文**（sharedFacts 引用 + 全部差异化字段：responsibility/taskGoal/relevantFacts/focusHints/allowedActions/outputConstraints/dependencies/authority）；
  2. `COLLAB_MESSAGE_APPENDED` 携带消息正文 parts 与关联链（replyTo/referenceTaskIds）；
  3. `COLLAB_CORRECTION_RECORDED` 携带完整纠偏内容与 appliesTo；
  4. `packetHash`/`newPacketHash` 只作完整性校验与去重辅助，**不是恢复源**。
  恢复 = 从事件账本 fold 重建任务目标、输入全文、纠偏依据、依赖与可见历史（既有 refold/rebuildProjection/journal 恢复已实测）；summary/聊天记录只是索引辅助，不进入恢复依据。缺记录/损坏 → 既有失败关闭（file-event-log 逐行校验已实测），不猜测、不跳过；"空对话冷启动"按上述下限逐项断言（B1 测试 7）。
- 分布式边界：单进程演示态；不承诺跨进程 exactly-once；多实例部署属后续 Gate。

## 5｜写入权与并发冲突

- Agent 只 `submit_candidate`（建议 + artifact）；共享对象（Evidence/WorkItem/Gate/正式状态）的变更只能经既有 v4life 命令边界由具名 Human/确定性规则完成——**业务协调 Agent 不冒充审批人、不产生 Receipt**（B1 测试 5）。
- 并行候选冲突：同对象并发提交按版本检测（expectedRev 沿用），冲突可解释（409 + 双方版本对照），不静默覆盖、不自动合并（B1 测试 6；共享对象最高编辑权仍开放待用户决定）。

## 6｜API 形态（窄增量，全部 additive）

现有 `/api/v4life/cases/[caseId]/*` 不动签名。新增候选（最终路径 B1 冻结）：

```
POST /api/v4life/cases/[caseId]/collab/events            开事件（协调 Agent，具名 actor）
POST /api/v4life/cases/[caseId]/collab/dispatch          派发 packet（≤4 域、sharedFacts 一致性校验）
POST /api/v4life/cases/[caseId]/collab/messages          消息/追问/回复（messageId 去重）
POST /api/v4life/cases/[caseId]/collab/corrections       人纠偏（具名 actor → 新 contextVersion）
POST /api/v4life/cases/[caseId]/collab/candidates        Agent 结果建议提交（authority=none）
POST /api/v4life/cases/[caseId]/collab/cancel            取消任务
GET  /api/v4life/cases/[caseId]/collab                   协作投影（谁在做/等什么/下一行动者/版本/更新时间）
GET  /api/v4life/cases/[caseId]/collab/stream            SSE（复用既有 events/stream 模式）
```

错误码沿用 §12 表 + additive：`COLLAB_EVENT_NOT_FOUND`、`COLLAB_TASK_NOT_FOUND`、`COLLAB_MESSAGE_DUPLICATE`、`COLLAB_VERSION_STALE`、`COLLAB_ROLE_FORBIDDEN` 等（404/409/403 映射同现行）。A2A 线协议兼容层（Agent Card `/.well-known/agent-card.json`、SendMessage 映射）列为 B1 可选层，不阻塞内部 API；是否对外暴露 A2A wire 由 Control/用户决定。**证据分级约束**（§0.3）：内部 API + 测试替身只构成"本地状态测试"；wire 兼容层完成只构成"wire 兼容测试"；两者均不得表述为 A2A 互通或兼容认证，"独立对端互通"须异构对端实测证据。

## 7｜Ownership 与 B1 精确写面（未冻结前不开始）

**共享类型唯一 writer**：`lib/v4life/collaboration/types-collab.ts` 新文件为主控串行冻结（事件载荷、Packet、CollabMessage、状态枚举、错误码）；冻结前各 lane 不得实现共享类型。

| 类别 | 路径（site/ 下） | writer |
| --- | --- | --- |
| 新增模块 | `lib/v4life/collaboration/types-collab.ts`、`packets.ts`（纯函数组装器）、`collab-engine.ts`（additive 命令族/事件 apply/replay 分支）、`projection.ts`（协作投影） | 主控冻结类型后：packets/projection 可并行 lane，collab-engine 串行 |
| 既有文件必要修改 | `lib/v4life/types.ts`（additive 事件类型 re-export）、`engine.ts`（EVENT_TYPES 注册 + applyEvent 新分支 + 闸门选项 `collabSemantics:'off'|'demo'` 默认 off）、`replay.ts`（rebuild 同构分支）、`runtime.ts`（demo opt-in 接线）、`http.ts`（additive 解析器/错误映射） | 主控串行（单文件单 writer，逐文件排他窗口） |
| 新增 API | 上表 8 路由（`app/api/v4life/cases/[caseId]/collab/**`） | BE lane 逐文件 |
| Agent adapter | `lib/v4life/collaboration/agent-adapter.ts`（**可控测试替身**：脚本化回复/迟到/重复/取消行为，不接真实模型） | TEST lane 可注入 |
| 测试 | `test/v4life-collab-{packets,engine,http,recovery}.test.mjs`、`scripts/v4life-collab-quality.mjs` | TEST lane |
| 证据 | `V5/backend/evidence/B1/**`、`V5/backend/B1_REPORT.md` | 主控 |
| 明确不改 | `lib/v4/**`、前端全部、seed.ts、依赖/lockfile、V4 文档、现有路由签名 | — |

**API 兼容策略**：仅 additive 路由/事件/命令；既有 612 测试与 27 quality 步骤必须零回归；`collabSemantics` 默认关闭保证未启用时引擎行为逐字节不变（P1-BE-01 先例）；HTTP 错误表 additive 追加不改既有映射。

## 8｜与已核验标准/框架的对照总结

| 任务能力 | A2A 标准 | MS Agent Framework | 本设计落点 |
| --- | --- | --- | --- |
| 任务身份/往返/状态/取消/订阅 | 原生（采用其命名与语义） | 有对应物 | 协议对象直用；内部事件账本持久化 |
| 人输入（INPUT_REQUIRED） | 状态原生，续跑=同 id 续发 | request/response + checkpoint | 续发命令应用层实现 |
| 差异化输入 | 无 | 需自定义 executor（无 Node 运行时） | packets.ts 纯函数组装器 |
| 纠偏/旧结果隔离 | 无 | 无直接对应 | correction 事件 + contextVersion + superseded |
| 权威写入（authority=none） | 无 | 无 | 复用 v4life 命令边界 + Human Gate |
| 持久/恢复 | 恢复语义留实现层 | checkpoint（非 Node） | 事件账本 + journal（已实测） |
| Node 技术栈适配 | 协议可自实现（无 SDK 依赖下最小 JSON/HTTP 子集） | 不可用（无 Node） | B1 先内部 API + 测试替身（本地状态测试）；wire 兼容层属可选，互通为后续 Gate |

**Node 侧路线选项比较**（审查修订：决策留用户依赖 Gate，B0 未替决；与 B0_REPORT §6.4 对应）：

| 选项 | 优势 | 代价/风险 | 备注 |
| --- | --- | --- | --- |
| 最小自实现（本轮唯一可行） | 零新依赖、实现面窄可审 | 不含完整规范面；无互通认证 | B1 默认路线，仅本地状态测试级 |
| 社区 TS SDK / 官方 SDK | 协议兼容由上游维护，wire 级起点高 | 新依赖（lockfile 变更）= 用户依赖 Gate；SDK 版本与规范对齐需当时核验 | 引入前按当时最新官方版本核验（B0 核验读取日 2026-09-06，非持续承诺） |
| adapter 映射既有编排框架 | 复用框架 orchestration/HITL/checkpoint | 主流框架无 Node 运行时（MS AF 为 .NET/Python/Go） | 仅当技术栈变化时重评 |
