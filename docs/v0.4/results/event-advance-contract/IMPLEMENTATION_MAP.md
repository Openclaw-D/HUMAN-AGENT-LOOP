# AdvanceRound：现有调用与单包建议

最终收敛：[FOUR_PAGE_SYNC.md](FOUR_PAGE_SYNC.md)补充三客户四页字段、真实选择与持久关联门槛；所有后续建议仅为这三例服务，不扩展功能。旧材料scope/hash观察已出现R2源码漂移，需在制交回后复验，不据旧映射判定当前实现失败。

2026-09-21 R2纠偏：以[COLUMN_ADVANCE_R2](../../tasks/COLUMN_ADVANCE_R2.md)为最高粒度要求。下列包目标更新为**一次整列输出＋依赖后列实际调度**，正常约5次、补证约6次；禁止前端计算业务状态或推进时移动页面/视口。旧一般轮次描述以此替代。

根目录：`C:/Users/22673/Desktop/JW`。只读源码核对，不代表运行通过。所有“未来”项仅是建议，不授权本任务实施或派工。

## 现有真实路由

Edge写前缀 `/api/jw/v2/actions`，A写前缀 `/api/v2`；下表路径接在前缀后，另有注明者除外。Edge代理仍由A最终鉴权，不能把白名单存在等同于当前角色获准。

| 真实路由/模块 | 可复用行为与输入 | AdvanceRound限制 |
|---|---|---|
| `/customers/:id/assessments` | `credit.ts:684`；requestId/tenantId/ruleVersion/evidenceSnapshot，request可选；human＋credit；返回assessmentId/snapshotHash并产生ASSESSMENT_CREATED | 仅在计划确需新评估且身份可执行时；不得每点击都创建新评估；重复/被取代材料当前会被跳过，计划需预校验并披露实际范围 |
| `/assessments/:id/candidate` | `credit.ts:780`；candidate真实结果及依据；服务端强制authority=none，写修订历史及ASSESSMENT_CANDIDATE_READY | 不能用占位内容制造“分析成功”；适配R2-03真实结果/作用域完成后才启用 |
| `/assessments/:id/submit-review` | `credit.ts:883`；human＋credit、candidate_ready、非stale；事件ASSESSMENT_SUBMITTED_FOR_REVIEW | 可成为明确展示的送审动作，不等于审批 |
| `/assessments/:id/admission-request` | `credit.ts:734`；request＋assessmentVersion，human business/credit | 只提交已有用户明确填写的需求，不在箭头中编造需求 |
| `/assessments/:id/decide`、`/confirm-preassessment` | `credit.ts:905/:944`；有权human credit；reject_assessment/withdraw_assessment，或独立预评估确认 | 单独人工明确确认，不在一般箭头自动执行清单；推进器读取其正式决定并终止或更新分支 |
| `/customers/:id/artifacts` | 真实材料登记；现有写门、scope、种类约束 | 不合成补件；上传链完成后读新材料版本、决定是否允许下一补证轮次 |
| `/customers/:id/decision-packages`；`/decision-packages/:id/revisions,domain-results,refresh-currency` | A `package.ts`域依赖、版本及真实运行引用；Edge proxy有对应白名单 | 输入需逐命令保持原schema/权限，不能由轮次序号构造域完成态；adoption/gate另保留原人工/授权门 |
| **仅A** `/customers/:id/analysis-runs/start`、`/analysis-runs/:id/finish` | `analysis.ts:106/:154`；获准service，deps={artifactIds,factKeys,rulePackVersion,…}；产生运行登记及审计 | 当前Edge proxy未见该入口；仅登记不是执行分析；无获准委托不能借用service身份 |
| Edge `/customers/:id/assistant/observe`、`/assistant/decisions` | 本地模型/候选编排，已有回执/unknown/pending | 模型输出不是A正式业务事件；R2-03正在写model/decisions，此包不得提前抢写；未授权真实模型费用则相关动作阻断 |
| Edge `GET /api/jw/v2/receipts/:requestId` → A `/api/v2/receipts/:requestId` | 原A动作回执；`v2kit.ts:62`作用域tenant/principal/action，绑定payload及路径资源 | 不是RoundReceipt，也不是模型回执；子动作恢复保持原身份/action/ID；not-found不等于未发送 |
| Edge客户 `/workspace`、`/events`、`/events-page`、`/activity` | 持久业务投影、SSE和分页/多源读面 | 仍缺轮次识别及持久round事件；activity不能补造完整聊天 |
| `Back/B/src/graph/task-run-orchestrator.mjs` | TaskRun checkpoint、步骤依赖、unknown、人类门；A仍为业务事实权威 | 现有任务级图非客户五专业业务轮次；本包优先调用既有合法能力，不重构B图 |

路由依据：`Back/A/src/http/server.ts:161–228`；`Back/Edge/src/proxy.mjs:31–95`。材料scope/hash与activity安全阻点沿用[前轮集成图](../back-integration-map/INTEGRATION.md)，不得因新交互需求跳过。

## 后续一个中型包（待主协调串行安排；不在本任务执行）

目标：持久AdvanceRound＋服务端计划白名单＋现有非正式业务命令适配，完成真实动作→回执→事件→刷新恢复的闭环。首批以当前可信角色确有权限、现有依据充足的动作运行；五专业异步需真实依赖和合法执行身份逐项验收，不虚称全部已接通。

| 单一writer | 拟允许文件/职责 |
|---|---|
| 同一个后端包writer，串行 | 新建`Back/A/src/domain/advance-round.ts`、`Back/A/test/advance-round*.mjs`；A PG持久round/action/intent、客户围栏与版本校验；新增migration编号由实施前核对现有序列后唯一登记，不覆盖已有迁移 |
| 同一个writer | `Back/A/src/domain/kernel.ts`、`Back/A/src/http/server.ts`作最小注册；若子命令缺事务内版本门，只在`credit.ts/package.ts`对应命令作契约要求的局部增量，不重写业务模块；超出时先报告 |
| 同一个writer | 新建`Back/Edge/src/advance-round.mjs`；`server.mjs`注册上述Edge路由与可信会话映射，保留CSRF/目标授权；如采用proxy挂载则只在`proxy.mjs/readproxy.mjs`增加精确路由，不能任意URL转发 |
| 同一个writer | 新增`Back/Edge/test/advance-round*.mjs`；报告仅新增本目录下`implementation/`，不得改本契约含义 |

**开工依赖：**R2四路交回并停止相关写入，固定源码hash，协调方确认server/A入口的唯一writer与migration权限；依赖新增持久表不构成本轮执行授权。Front继续由Front writer独占，本包不改Front、dist、模型费用配置、B transport、Connectors、R2在制模块。若需要改变服务委托政策或业务终止规则，停止相关分支，不扩大为万能工作流引擎。

**必要验收（合成材料＋隔离PG/HTTP，真实模型0次）：**

1. 单次点击至少产生一个真实授权业务命令及持久源事件；202不能标completed；四页投影同一客户及服务端版本，刷新不丢轮次。
2. 两连接/两进程同键并发只认领一次；不同ID/身份不能绕过客户active围栏；同键异计划/版本409；旧版本和执行中依赖变化阻断；没有权限的动作零发送。
3. 发送前崩溃、发送后断连、回执落盘前崩溃、重启恢复：实际替身出站计数可核对；unknown不换ID重发；权限撤销/切客户/清前端状态不能解除围栏。
4. 两个独立专业任务异步完成，只更新依赖域；部分失败保留成功动作；正式信审拒绝提前终止，禁止下游并隔离迟到结果；候选拒绝不得触发正式终止。
5. waiting_evidence后真实补件→新材料版本→关联重评轮次；覆盖正常约5次、补证约6次及额外必要重评；无材料不得续轮。正式确认仍要求独立有权人明确操作。
6. 读面跨客户/租户/受众/读取中撤权、SSE断线续拉、同ID终态更新、GET零写；身份/时间/依据/候选/置信度缺失如实未知。模块通过、HTTP集成、Front视觉接受分开记录。

本包尚未派发；不创建、读取或控制其他任务。本次仅契约交付，无后台资源。

## R2必要增量：整列编排与后列联动

本次只读复核：A `analysis.ts` start/finish持久登记运行状态，不能因登记running就认定执行器已开始；`package.ts`保存域依赖/结果，不是客户级列调度入口；B `task-run-orchestrator.mjs:3/:39/:42`是单TaskRun的线性计划/就绪步图。A/Edge server未检索到advance-plan/advance-round入口。故当前仍缺**整列动作集合编译、持久后列job/outbox交接、列级聚合回执、跨轮次按依赖版本复用**，不是只给旧按钮换参数即可完成。

最小中型包仍由一个writer在R2交回后串行执行：A advance-round域模块负责plan/domain版本、列内结果、active围栏和outbox；新增 `Back/B/src/worker/column-runner.mjs`作为按已授权执行身份消费job的薄适配层，复用现有任务运行能力，登记received/queued/running及原回执；只有实际执行器开始才发running。原TaskRun图不重构；若无获准service委托或无法复用执行能力，该专业阻断并交最小缺口，不假造启动事件。此新增文件及其测试须由协调方纳入后续包ownership，本任务没有写入权限。

追加验收：

1. 一次domain请求覆盖列内所有相关材料/分析/核验/办结结果，必需事项未完成不得列绿；部分actionIds请求拒绝，人工决定仍单独确认。
2. 业务列完成后政策及其他真实依赖域出现实际接收/排队/运行事件；依赖不足显示waitFor，无权限显示阻断，不能空白或以CSS动画冒充启动；派发失败可见。
3. 后列提前running/完成后点击该列，复用同job/结果，实际出站与收费次数不增加；变更材料仅使依赖域进入重评，不重跑无关列；unknown跨列/换ID仍不重发。
4. 正常约5次、补证约6次、拒绝提前终止；拒绝后下游stopped/not_applicable并有理由，不涂绿；只有全部必需事项完成才钻石。
5. Front自有验证环境断言推进前后page/route/scroll/transform/zoom/focus不变；此后端包不触碰用户正在看的浏览器。服务端响应不携带自动导航/滚动指令。

