# 任务一 · 联合尽调检查会话（inspection session）设计与实施记录 V1

状态：实施中（A1→A2→A3 提交边界）。任务书：用户本轮《任务一｜把联合尽调变成可自动推进、可暂停续办的完整业务会话》。
本文先固定输入版本与可复用实现，再记录本路新增的契约、迁移与测试入口。

## 0｜输入版本与现状盘点（2026-09-17，实测本地工作区）

| 输入 | 版本/状态 | 结论 |
|---|---|---|
| Back/CONTRACT.md | v1.3（+v2.0 credit kernel, task01） | A 路独占 writer；本任务沿用其幂等/乐观版本/outbox/鉴权机制，不破坏 v1 语义 |
| Back/A | 工作区未提交状态 = 任务01（客户授信）完成后：`kernel.ts`(1181行)+`credit.ts`(1508行)+migrations 001/002；B 63项/C 34项测试历史绿灯为仓库记录，本轮未复跑前不作为本轮证据 | 可复用：Goal/Project/Evidence/HumanRequest/TaskAssignment(fencing)/outbox/audit/idempotency、customers/evidence_artifacts/credit_assessments |
| Back/B | worker+budget+fencing+resume（STATUS 记录 63/63；工作区含四域未提交改动） | 可复用：ReceiptsPort（intent/terminal 三分发送）、fs-lock、file-checkpointer、router |
| Back/C | 四域 rules/gate/questions planner + coordination/next-step | 问题调度思想来源；本轮在 A 内实现会话级持久调度，不复制 C 的事实 |
| 基线文档 JW_spatial_due_diligence_plan_v2.md | **不在本工作区**（JW/、Desktop 2 层内均未找到） | 以任务书文本为唯一本轮要求来源；"上一轮已完成"是用户指定前提，本地无 InspectionSession/Question/Answer/CaptureRequest 实体——按任务书"执行前映射到已有实现"条款，在本轮一次建成，不造第二套事实源 |
| PostgreSQL | 隔离容器 jw-cc-kernel-pg@127.0.0.1:15444（jwcc/jwcc-local-demo）运行中；默认 v7next-a-pg@15432 未运行 | 测试经 `JW_A_ADMIN_DB_URL` 指向 15444（utils.mjs 已支持） |

任务书中的 InspectionSession/Question/Answer/CaptureRequest/checkpoint 此前仅存在于规划文档，本地代码没有。本设计把"检查会话"作为 A 内核的新域一次建成（migration 003 + `src/domain/inspection.ts`），最大化复用既有机制（outbox/audit/幂等/乐观锁/客户工件），不在 B/C 复制业务事实。

## 1｜状态映射（A1 契约）

运行状态（会话推进）与收口状态（业务结论）分开：

```
runStatus:  preparing ──start──▶ in_progress ──pause──▶ suspended ──resume──▶ in_progress
                                in_progress ──end──▶ ended（终态；会后动作仍可进行）
closureStatus: open ──end──▶ pending_evidence | pending_review | ready_for_assessment ──close──▶ closed
```

- start 前置：runStatus=preparing、计划齐备（plan_snapshot.items 非空）、参与者目录可信。计划版本在开始前被修订 → 409 `PLAN_CHANGED`（currentPlanVersion），显式 `acceptedPlanVersion` 才能开始，不悄悄混用。
- 通话结束/客户离场不是命令，不自动改任何核验项状态；只有显式 end 允许存在未决事项（转会后待办 + 收口限制）。
- 核验项（item）状态：`pending → waiting_answer → answered（口述登记）→ waiting_evidence（材料未齐）→ to_verify（材料齐待人工核验）→ verified | conflict`；另有 `deferred（超界转待办）`、`stale_review（恢复/场景变更后需复核）`。口述 ≠ 材料 ≠ 核实，三段分别落状态。
- 外发控制：会话级 `dispatchGeneration` + `outboundPaused`。授权外发（outbound/grant）必须携带当前 generation；pause 事务 = `outbound_paused=true, dispatch_generation+1, checkpoint 落库` 同事务提交——此后新授权被 `OUTBOUND_PAUSED` 拒，旧代际凭旧 generation 申请被 `STALE_DISPATCH_GENERATION` 拒。在途（已授权/已发送/unknown）单独列出，尝试取消按结果如实记录（sent 不可撤回）。

## 2｜实体（migration 003，全部新增对象；兼容既有 ID）

- `inspection_sessions`：绑定 project_id + customer_id + tenant_id；plan_snapshot（含 intake/assessment 输入快照引用）、inspection_plan_version（会话内 plan_version 单调）、scene_version、roles 名册、dispatch_generation、outbound_paused、owner_role、config（maxFollowUpsPerQuestion/waitTimeoutSeconds/maxQuestionsPerItem）、last_event_seq（业务事件游标）、closure_revision、checkpoint 引用经 `inspection_checkpoints` 表（不内嵌大 JSON 到会话行）。
- `inspection_items`：核验项（item_key 会话内唯一）；responsible_role/target_role/requires_human_verification/expected_evidence_kinds/object_ref（设备锚定，改绑留 history 不覆盖）；detail= {whyNeeded, expectedEvidence, stopCondition}。
- `inspection_questions`：问题/回答；dedup_key = sha256(objectRef|period|purpose|audience|target_role)；部分唯一索引 (session_id, dedup_key) WHERE status IN ('open','sent')——同对象同期间同目的同受众已开放即去重（duplicate:true 返回原问题），对象/期间/目的/权限不同 → 键不同 → 保留差异，不合并。follow_up_count 记追问次数；answer={text, evidenceRefs(artifactId), conflict}。
- `inspection_outbound`：外发授权与结果（authorized/sent/unknown/cancelled/cancel_unsupported），记录授权时 generation 与 requestId；unknown → 必须对账/人工，禁止换 requestId 重问（reask 拒绝）。
- `inspection_followups`：会后待办（owner_role、reason、next_action）；超等待/追问边界时每事项至多一条 open 待办（部分唯一索引保证）。
- `inspection_summaries`：检查小结（closure_revision + audience 唯一）；只从真实事项/问题/待办投影，历史修订不改写。
- `inspection_checkpoints`：暂停/结束/手动时落 {planVersion, sceneVersion, itemStatuses, openQuestions, inFlight, lastEventSeq, followups}；原始媒体只存引用（artifactId），不复制内容。

## 3｜事件（沿用 outbox_events；project_id+customer_id 维度）

`INSPECTION_CREATED / INSPECTION_PLAN_REVISED / INSPECTION_SCENE_REVISED / INSPECTION_STARTED / INSPECTION_PAUSED / INSPECTION_RESUMED / INSPECTION_ENDED / FOLLOWUP_REQUIRED / INSPECTION_READY_FOR_ASSESSMENT / INSPECTION_CLOSED / INSPECTION_ITEM_REOPENED`。至少一次投递，消费方按 eventId 幂等；事件只陈述事实，不携带"自动批准"语义。

## 4｜API（挂在既有 /api/v1 前缀；鉴权、requestId、expectedVersion 与 v1 一致）

```
POST /api/v1/projects/:projectId/inspections                建会话（preparing）
GET  /api/v1/inspections/:sessionId                          快照（runStatus/closureStatus/计划版本/覆盖/待办/外发状态/游标/availableActions）
GET  /api/v1/inspections/:sessionId/next-actions             缺口驱动的 nextActions + blockedReasons（含"当前等待谁"）
POST /api/v1/inspections/:sessionId/plan | /scene           计划/场景修订（PlanRevised；preparing 阶段或会间显式修订）
POST /api/v1/inspections/:sessionId/start | /pause | /resume | /end | /close
POST /api/v1/inspections/:sessionId/presence                参与者在线/离线（只阻塞依赖其输入的事项）
POST /api/v1/inspections/:sessionId/takeover                人工接管（持久化；不改身份）
POST /api/v1/inspections/:sessionId/items                   增补核验项
POST /api/v1/inspections/:sessionId/items/:itemId/verify    人工核验 verdict=confirmed|conflict
POST /api/v1/inspections/:sessionId/items/:itemId/rebind    场景变更后显式重锚定（保留原引用 history）
POST /api/v1/inspections/:sessionId/items/:itemId/reassign  改派（同权限内；记旧负责人/原因/新负责人）
POST /api/v1/inspections/:sessionId/questions               建问题（去重语义见 §2）
POST /api/v1/inspections/:sessionId/questions/:qid/answer   回答（target_role；requires_human 仅人类）
POST /api/v1/inspections/:sessionId/questions/:qid/reask    追问（限额内；unknown 在途时拒绝）
POST /api/v1/inspections/:sessionId/outbound/grant          外发授权（generation 校验；pause 后拒绝）
POST /api/v1/inspections/:sessionId/outbound/:sendId/result 发送结果回执（sent/unknown/cancelled/cancel_unsupported）
POST /api/v1/inspections/:sessionId/sweep                   等待超时/追问越界清扫 → 每事项至多一条待办
POST /api/v1/inspections/:sessionId/evidence                晚到材料 {artifactId} → closure_revision+1，只重开受影响事项
POST /api/v1/inspections/:sessionId/checkpoint              手动 checkpoint（pause/end 事务内自动）
GET  /api/v1/inspections/:sessionId/summary?audience=&revision=  检查小结（internal/customer 分权）
```

错误码新增（400/403/409 语义见 errors.ts）：`PLAN_CHANGED`、`OUTBOUND_PAUSED`、`STALE_DISPATCH_GENERATION`、`SEND_UNKNOWN_RECONCILE`、`QUESTION_DUPLICATE`（duplicate 命中时 200 duplicate:true，非错误）、`QUESTION_CLOSED`、`FOLLOWUP_LIMIT_REACHED`、`ANSWER_REQUIRES_HUMAN`、`SCENE_ANCHOR_STALE`、`SESSION_NOT_RUNNING`、`INSPECTION_CLOSED`。

## 5｜提交边界与测试入口

| 边界 | 内容 | 测试文件（可直接 node --test 单跑） |
|---|---|---|
| A1 | 状态映射、会话/收口契约、migration 003、转换与权限测试 | `test/inspection-contract.test.mjs`（A01/A03/A06/A11 权限面） |
| A2 | 持久调度（generation/外发）、暂停/接管、等待与改派、checkpoint/恢复 | `test/inspection-orchestration.test.mjs`（A02/A04/A05/A07/A09/A11/A12） |
| A3 | 会后小结、补证接续、收口事件、完整本路回归 | `test/inspection-closure.test.mjs`（A06/A08/A10 + 事件断言） |

实际命令（PG 就绪前提 = 隔离容器 jw-cc-kernel-pg@15444）：
`cd Back/A && JW_A_ADMIN_DB_URL='postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres' node --test test/<file>`；
全量回归：同前缀 env 下 `npm test`。

B 路（A2 范围）：`Back/B/src/schedule/inspection-dispatcher.mjs` —— 消费 A 的 next-actions 快照，按 generation 请求外发授权；ReceiptsPort 记 intent/terminal；`OUTBOUND_PAUSED`/`STALE_DISPATCH_GENERATION` 即停，不重试不绕过。测试 `Back/B/test/inspection-dispatcher.test.mjs`（stub 契约，无真实模型调用）。

## 6｜实施记录（2026-09-17，ZCode）

- 已交付：`migrations/003_inspection_sessions.sql`（7 张新表，全部新增对象）、`src/domain/inspection.ts`（约 1500 行，24 个命令/查询）、`server.ts` 路由注册（25 条）、`errors.ts` 新增 10 个检查会话错误码、kernel 挂载 `kernel.ix`。
- A 路测试 3 套 18 项全绿：contract 8（A01/A03/A06+权限+去重+闭环）、orchestration 7（A02/A04/A05/A07/A09/A11/A12）、closure 3（A08/A10+事件契约）。
- B 路测试 5 项全绿。顺手修复 `B/src/ports.mjs` MemoryReceipts.put 的既有笔误（`requestId`→`receipt.requestId`；该路径此前仅被单测覆盖，属 B 路所有权内的必要修复）。
- 并发写说明：任务二执行者同期在 A 内新增 `review.ts/v2kit.ts/decision-support.ts/004_decision_loop.sql`；`errors.ts` 出现过一次联合类型分号冲突（任务一/二先后插入所致），已合并为继续联合，两边错误码均保留。本路 typecheck 范围内的文件零错误；`review.ts/v2kit.ts` 存在任务二在途错误，未代改（每文件一个 writer）。
- 已知取舍：checkpoint 为暂停/结束/接管/手动时的快照投影（真相源是各业务表+游标）；恢复时与 checkpoint 对比给出 drift 报告，不基于 checkpoint 回滚。外发授权 = A 内记录授权事实；真实渠道外发与结果回执由渠道执行器调用 outbound/result 登记。
- 回归台账闭合（02:4x 复跑）：任务二对 customer-credit.test.mjs 编辑稳定（mtime 02:02 后无改动）后复跑 `node --test test/customer-credit.test.mjs test/integration-crash.test.mjs` → 退出码 0，26 tests / 25 pass / 1 skip / 0 fail。此前"permission_matrix does not exist"确认系对方编辑中间态，非本路 003 迁移回归；crash 套件第 2 项"PostgreSQL 容器整机重启"为带守卫的 SKIP（未设置 JW_A_TEST_PG_CONTAINER/JW_A_TEST_PG_ISREADY，避免重启非本测试的容器），SIGKILL 内核重启用例真实通过。A22（迁移中断/重复运行）在 003+004 并存下通过，直接断言迁移兼容性。
