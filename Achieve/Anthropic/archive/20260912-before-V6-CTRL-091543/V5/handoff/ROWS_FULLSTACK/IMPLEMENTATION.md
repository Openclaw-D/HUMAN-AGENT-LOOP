# ROWS_FULLSTACK IMPLEMENTATION｜接口与实现契约（FROZEN）

冻结：2026-09-11，主 Agent。本文件是前后端共同实现的唯一接口事实源；变更只能由主 Agent 做出并通知全部消费方（见 OWNERSHIP.md）。全部数据为合成演示。

## 1｜复用选择与理由

- **不改动 `lib/v4life/**` 与 `app/api/v4life/**`**：v4life 是事件溯源正式语义内核（case/Gate/Receipt 语义、role 名册），与本任务的"单项目合成演示存储"在权威语义上不同；复用需改内核 = 触发基线 Gate。按任务书选择隔离演示适配层。
- **新增隔离层**：`lib/v5-preview/**`（服务与存储）+ `app/api/v5-preview/**`（HTTP）。前端只经 HTTP 消费；localStorage 不再是业务事实源。
- **运行时裁决（DEFECT-1，主 Agent 2026-09-11）**：`npm run dev`（vinext）经 vite cloudflare 插件把路由代码运行在 workerd，`node:fs` 被拒、`process.env` 不可见——文件持久化在该运行时不可实现（BE 冒烟 + VERIF HTTP 实测双证）。**凡需持久化的运行（演示服务、HTTP 测试）统一使用 `npm.cmd run dev:node -- --port <port>`（真 Node 的 next dev）**；`npm run dev` 仍可用于纯静态预览但不属本任务演示路径。不改 vite.config.ts（避免越写面动共享构建配置）。此为平台事实记录，非缺陷挂起。
- **持久化**：单进程 JSON 文件存储。目录 = `process.env.V5_PREVIEW_DATA_DIR`（测试可隔离），默认 `<site>/.v5-preview-data/rows-store.json`（未跟踪目录，与源码分开）。写入 = 临时文件 + rename。**文件损坏/不可解析 → 所有路由返回 500 `STORE_CORRUPT`，不静默清空、不自动重建**；恢复 = 人工删除或替换数据文件（见 DEMO.md）。持久化等级：单进程、无并发多实例保证、无原子事务承诺——如实报告。
- 路由处理器写法参照既有 `app/api/v4life/**/route.ts`（vinext/Next route handler 约定），由 Backend worker 落实。

## 2｜HTTP 契约（URL 冻结）

- `GET /api/v5-preview/project` → `200 ProjectOverview`（业务可见视图；无任何专业细节字段）。`Cache-Control: no-store`。
- `POST /api/v5-preview/notes` body=`NoteRequest` → `200 WriteResponse`
- `POST /api/v5-preview/messages` body=`MessageRequest` → `200 WriteResponse`
- `POST /api/v5-preview/demo/seed` body=`SeedRequest` → `200 WriteResponse`（演示控制：重置该情景种子状态与幂等表；UI 上标注"演示控制·非业务操作"，不做成批准/放款/结清业务按钮）
- 失败响应：HTTP 状态码 + `ApiError`。

| 错误码 | HTTP | 语义 |
| --- | --- | --- |
| INVALID_INPUT | 400 | 缺字段/text trim 后空或 >2000/requestId 空或 >64/expectedVersion 非整数/scenario 非法 |
| ROLE_FORBIDDEN | 403 | actorRole ≠ 'business'（演示受控身份：服务端只授权业务，自称其他角色不放行） |
| NOT_FOUND | 404 | todoId 不存在（或已非开放状态） |
| VERSION_CONFLICT | 409 | expectedVersion ≠ 服务端 version；返回 serverVersion；客户端须重新 GET，草稿保留 |
| REQUEST_MISMATCH | 409 | 同 requestId 但载荷不同（重试不得换载荷） |
| NO_OPEN_TODO | 409 | 情景无开放待办（如已结清）仍提交 notes |
| BAD_SCENARIO | 400 | seed scenario 非法 |
| STORE_CORRUPT | 500 | 存储文件不可解析（不静默重置） |
| STORE_UNAVAILABLE | 500 | 存储目录不可写等 IO 失败 |

**幂等**：服务端按 requestId 记录最近 500 条（requestId → 载荷哈希 + 响应）。同 requestId 同载荷 → 重放原 200 响应并标 `replayed: true`，不重复追加/记账；同 requestId 异载荷 → 409 REQUEST_MISMATCH。

**版本**：每条被接受的写入 `version+1`；seed 重置为种子版本。写入响应携带最新 overview。

**接受语义（验收闭环）**：初始黄灯补件（todo 待补充）→ notes 提交 → version+1、todo.status=待复核、信审 judgmentText=待复核（保持黄灯，不自动变绿）、消息追加（业务补充说明 + 系统记录，注明不产生正式 Decision/Receipt）→ GET/刷新/第二视口读到同一状态。红线域不受聊天影响；无关域不被清零。

## 3｜种子数据（合成，参照 design/20260911-business-five/06-horizontal-rows.png）

客户 `远山精密制造`，项目 `新客回租 · JW-2026-018`，标注 `演示项目`。三情景：

### approval（审批推进中，种子 version=7）
- overall：progressLabel `审批推进中`；description `政策已确认，信审待补充设备清单；总项目以资产管理流程结束为终点（合成演示，不使用数字总进度）`
- 政策：segments [适用条件/灰区识别/例外路径/准出意见] 全 done；green `已确认`；summary `适用条件已确认（合成）`
- 信审：[材料齐备性/一致性核验/偿付覆盖/信审意见] [done,done,pending,pending]；yellow `待补充`；summary `补充设备清单后继续核验（合成）`
- 商务：[条件框架/价格要素/期限要素/起租条件] [current,pending,pending,pending]；gray `准备中`；summary `合同要素同步准备（合成；无正式前序被绕过）`
- 资产：[标的确认/权属核验/交付与起租/巡检与结清] 全 pending；gray `待启动`；summary `起租后持续管理至结清（合成）`
- todo：`{id:'todo-device-list', title:'补充设备清单', detail:'资料更新后，同步相关专业判断；提交后信审转入待复核（合成演示）。', status:'待补充', relatedDomain:'credit'}`
- messages：system 开场说明 + domain（信审·张信审（合成））请补充设备清单。

### post-rental（起租后资产管理，种子 version=23）
- overall：`起租后资产管理`；description `演示时间线已起租；资产域持续管理至结清（合成演示，起租后总进度不写死）`
- 政策 [done×4] green 已确认；信审 [done×4] green 已通过；商务 [done×4] green 已起租；
- 资产：[标的确认/权属核验/交付与起租/巡检与结清] [done,done,current,pending]；yellow `观察中`；summary `首期巡检待确认（合成）`
- todo：`{id:'todo-inspection', title:'确认首期巡检安排', status:'待补充', relatedDomain:'asset'}`；messages 含起租说明。

### settled（已结清（演示），种子 version=41）
- 全域 [done×4]；绿灯 `已确认/已通过/已结清/已结清`；overall `已结清（演示）`，description `全生命周期演示终点：资产管理流程结束（合成）`
- todo：`null`（notes 提交 → 409 NO_OPEN_TODO；messages 仍可追加留档）

## 4｜文件所有权（单文件单 writer）

| 文件 | writer |
| --- | --- |
| `lib/v5-preview/shared-types.ts` | **主 Agent**（已冻结，worker 只读） |
| `lib/v5-preview/store.ts`（读写/原子写/损坏检测/幂等表） | Backend worker |
| `lib/v5-preview/service.ts`（投影/种子/校验/命令） | Backend worker |
| `app/api/v5-preview/project/route.ts`、`notes/route.ts`、`messages/route.ts`、`demo/seed/route.ts` | Backend worker |
| `app/v5-preview/**`（横条总览 UI、API 客户端、加载/空/错误/冲突态、演示控制条） | Frontend worker |
| `test/v5-preview.test.mjs`（前端源码/客户端逻辑契约） | Frontend worker |
| `test/v5-preview-http.test.mjs`、`test/v5-preview-recovery.test.mjs`（真实 HTTP/恢复） | Verification worker |
| `V5/handoff/ROWS_FULLSTACK/**`（各自子目录） | 各 worker/主 Agent 分目录 |

前端可 `import type` 自 `lib/v5-preview/shared-types.ts`（类型擦除）；不得从 `lib/v5-preview` 导入运行时实现。

## 5｜前端行为要求

- 主屏：顶部客户/项目/演示标注 + 项目进展（灰度条+文字，无数字）；四条宽横条域卡（名称+信号灯+四段+一句说明）；下方最重要待办卡（含"提交材料"展开 textarea 提交补充说明）；底部"项目沟通"轻量可展开（消息列表+输入）。
- 预览控制条保留"交互预览 · 合成数据"标注 + 演示情景切换（标注 `演示控制·非业务操作`）。
- 状态：加载（骨架）、GET 失败（错误卡+重试）、409 冲突（**保留草稿**、提示版本已更新 vX→vY、自动重新 GET 后可重试）、网络错误提示。
- 数据获取：挂载 GET + 写入后用响应 overview + 每 4s 轮询 + `visibilitychange`/focus 重新 GET（第二视口一致性）。
- 无障碍：输入有 label、按钮可达、焦点可见、尊重 `prefers-reduced-motion`。
- 颜色：黑白灰为基底；红黄绿仅用于判断状态灯圆点/文字。
- 移除旧拼图/四列/详情页/角色切换/localStorage 事实源（业务-only 视图；业务无专业详情入口）。

## 6｜测试要求（Verification worker）

真实 HTTP（自起隔离服务实例，见下）；不得以 reducer/mock 替代。必测：GET 初态、notes 验收闭环（黄→提交→待复核）、messages 追加、requestId 重放（replayed=true 且不重复追加）、requestId 换载荷 409、expectedVersion 过期 409+serverVersion、畸形输入 400、actorRole 越权 403、已结清 notes 409 NO_OPEN_TODO、seed 三情景切换、**数据文件损坏 → 500 STORE_CORRUPT 且不静默重置**、服务重启后 GET 恢复同状态（重启由测试脚本自行 kill/重启其自起实例）。服务实例：`npm.cmd run dev -- --port 3399`（另一实例 3398 配独立 `V5_PREVIEW_DATA_DIR`），测试内自检端口空闲、记录 PID、结束清理自己启动的进程。
