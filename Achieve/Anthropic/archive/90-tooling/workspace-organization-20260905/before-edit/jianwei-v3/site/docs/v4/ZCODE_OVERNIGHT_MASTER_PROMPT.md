# 给 ZCode 的整夜 Master Goal｜2026-09-04 07:00 验收

把本文件全文作为当前 ZCode 主会话的 Goal。继续当前任务，不要停止、重启、回滚或重复已经运行的 Generate。

## 1. 终局目标

在北京时间 2026-09-04 07:00 前，把见微 V4 的当前小微融资租赁 Candidate 推进到可以由用户真实验收的前后端联调状态：后端状态机、事件账本、Store/replay、API、权限、幂等/版本冲突和失败关闭完成；`/work` 使用真实 V4Life Projection 与 API；业务、政策、信审、商务、资产五个角色在 mobile/desktop 都能使用同一系统；Golden Case happy/return/reject/adversarial 路径可重复；tests/typecheck/lint/build/browser Gate 有真实 Evidence。

完成早于 07:00 时，不扩张产品范围。继续做缺陷扫描、回归、响应式和对抗复验，直到没有未关闭的 Acceptance 项；随后保持稳定，不制造无意义修改。07:00 前形成最终 Candidate 报告。

## 2. 必读与优先级

按顺序读取，证据足够即停止，不宽扫 archive/materials：

1. `C:\Users\22673\Desktop\Anthropic\AGENTS.md`
2. `C:\Users\22673\Desktop\Anthropic\NORTH_STAR.md`
3. `C:\Users\22673\Desktop\Anthropic\DECISIONS.md`
4. `C:\Users\22673\Desktop\Anthropic\CHALLENGE_LOG.md`
5. `C:\Users\22673\Desktop\Anthropic\ROADMAP.md`
6. 当前仓库 `AGENTS.md`
7. `docs/v4/ZCODE_BACKEND_GOAL.md`
8. `docs/v4/ZCODE_OVERNIGHT_WORKSPACE_GOAL.md`
9. `docs/v4/CONTRACT.md`
10. `docs/v4/ACCEPTANCE.md`
11. `docs/v4/BACKEND_PROGRESS.md`
12. `docs/v4/ZCODE_CONTROL_CHANNEL.md`（每轮重新读取最新 revision）
13. 当前 `lib/v4life/**`、`app/api/v4life/**`、`app/work/**` 和 `test/v4life-*`。

当前最新 User Authority 高于旧实现和旧 fixture。若旧文档或代码冲突，按上述顺序处理，不让旧静态页面反向定义产品。

## 3. 产品与界面冻结

- 首期只做小微融资租赁。
- 当前唯一 Golden Case 具象采用直租；通用 domain/API 不得锁死直租或排除回租。
- 用户是业务、政策、信审、商务、资产五个角色，共用一套 responsive system 和一个 canonical Case Projection。
- 五个角色全部具备 mobile/desktop；业务默认 mobile-first，四域默认 desktop-first。设备差异只改变默认布局、密度和入口优先级。
- Desktop shell：顶部 Case Context；左侧角色看板与当前事项工作区；右侧 Case Chat。
- Mobile shell：紧凑 Case Context；“看板 / 事项 / 协同”三入口重排，不把桌面三栏缩成一列长页面。
- 左侧看板是专业事项协同，不是领导 dashboard、管理 KPI、CRM 或业绩漏斗。
- Case Chat 只解释当前状态、总结 Evidence、形成草案/Candidate 和补件建议；不持有第二状态，不执行 Human Gate，不生成 Receipt。未接模型时诚实标注“协同框架 / 未连接模型”，不放假聊天记录。
- Human 是 authority；Agent/model 始终 `authority=none`。

## 4. 持续运行与并发

- 不设置人为 subagent、任务包、活跃数量、累计数量、运行轮数或 Generate 数量上限。
- `ZCODE_OVERNIGHT_WORKSPACE_GOAL.md` 的 `A01–J10` 是首批 backlog，不是上限；之后按 Evidence 创建 `X001+` 修复/复验包。
- 只要有独立且有价值的 ready work，就按平台实际容量持续派发和补位。
- 每个 Agent 必须有唯一目标、输入、ownership、输出、DoD 和停止条件。
- 同一文件同一时间只有一个 writer。共享 contract/schema/API shape、`app/work/page.tsx` 和最终 integration 由主 Agent 串行控制。
- Explore/Review/Verify 默认只返回短 Evidence；需要写文件时先登记唯一 ownership。
- 不为增加数字重复扫描、重复实现或无变化反复跑同一 Gate。
- 普通测试失败、类型错误、CSS、race、API mismatch 不是 Hard Stop，必须定位根因、纠正和复验。

## 5. 两个单向控制文件

### ZCode 写、Codex 读

`docs/v4/ZCODE_RUN_STATUS.md`

主 Agent 在以下时点更新：每个 Phase 完成、每次 integration barrier、出现/关闭重大失败、进入浏览器 Gate、准备 COMPLETE_CANDIDATE。状态包含时间、phase、material change、精确命令结果、失败、ownership、next action 和已读取的 control revision。

### Codex 写、ZCode 读

`docs/v4/ZCODE_CONTROL_CHANNEL.md`

ZCode 不得修改。每轮结束、每次 integration barrier、每次测试失败后和进入下一 Phase 前重新读取。若出现新 revision：

- `CONTINUE`：保持当前方向；
- `CONTINUE_WITH_CORRECTION`：先吸收纠偏，再推进；
- `HARD_STOP`：保留 Evidence 并停止相关写入，只提出一个聚焦问题。

不得通过忽略控制文件来换取速度。

## 6. 执行顺序

### Phase A｜关闭当前 P4 后端

1. 等待并整合当前所有后端 lane，不重做已完成部分。
2. 对照 frozen CONTRACT 修复类型、引擎、seed、Store/replay、HTTP/API 的真实不一致。
3. 复跑 Lane A/B/C/D focused tests 和 HTTP quality script。
4. 运行 full test/typecheck/lint/build。
5. 更新 CONTRACT、ACCEPTANCE、BACKEND_PROGRESS 与 RUN_STATUS。
6. 未全绿不得进入“后端完成”表述；可以在后端修复与不依赖它的 UI shell 工作之间并行，但不能接假数据冒充联调。

### Phase B｜先建立 responsive shell

1. 移除 `/work` 对旧 `DEMO_WORK_PROJECTION` 的 canonical 依赖。
2. 先完成顶部 Context、左侧角色/看板/事项、右侧 Case Chat 三块的 responsive component boundary。
3. Mobile 采用“看板 / 事项 / 协同”切换；Desktop 保持左主右辅。
4. 五角色共用导航与组件 contract，只通过 selected actor 和 selector 改变内容。
5. 当前只需克制、明确、可操作的框架；不自行发明更多制度条文、评分、真实客户数据、复杂图表或装饰。
6. 五个同事 Candidate 若已落盘，可只读参考 `materials/showcase/v4-five-role-shell-20260904/outputs/`；不得等待或照抄未验收内容。

### Phase C｜真实 Projection/API 联调

1. initial GET、refresh/poll、abort、write→refetch 接通同一 Case。
2. selected actor、action availability、waiting reason 全部由 Projection + authority 派生。
3. Evidence、WorkItem、Human Decision 三类写动作走现有 API。
4. retry 复用 commandId；version conflict 先刷新且不自动重放；pending 禁止重复提交。
5. Chat 暂不接真实模型；它只能读取同一 Context 并展示明确的框架/降级状态，不能使用预写成功回答欺骗验收。

### Phase D｜四域闭环

1. 政策、信审、商务、资产各有真实 WorkItem、等待条件、Candidate/Human Gate/Receipt 表达。
2. 商务 BG-1 与资产 AG-1 若属于最新 contract，必须从后端到 UI 到测试完整接通，不能只画卡片。
3. 证明可提前准备、硬等待、退回重做、否决停止依赖工作且贡献保留。
4. 业务移动入口完成 Evidence 补充和反馈查看，不出现专业审批按钮。

### Phase E｜Golden Case 与失败路径

1. reset 后初态。
2. happy path 到最终资产 Receipt。
3. returned 不产生 Receipt，可补充重做。
4. policy rejected 停止真实依赖，保留既有 Evidence/Candidate/Contribution/Event。
5. role mismatch、stale rev、idempotency conflict、replay、unknown case、blocked submit、reset production disabled。
6. 每条路径通过 API/浏览器真实触发，不直接修改前端状态或 fixture。

### Phase F｜全量稳定与 07:00 交付

1. focused + full tests。
2. `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build`。
3. 五角色 Desktop：1920×1080、1440×900。
4. 五角色 Mobile：390×844、360×800。
5. keyboard/focus/label/aria-live/reduced-motion、console、loading/404/error/stale/replayed。
6. 检查凭据、越界文件、dependency/package/lockfile、未知进程和 task-owned localhost 残留。
7. 更新真实文档与最终 Evidence，状态标记为 `COMPLETE_CANDIDATE`，等待 Codex/用户验收。

## 7. Hard Stop

只有以下情况停止：必须改变制度 authority；必须安装依赖、选择生产数据库/认证/部署平台、读取真实凭据；另一个 writer 正修改同一文件；发生无法恢复的文件损坏；平台完全不可用且没有其他 ready work；或 Root Authority 出现无法裁决的矛盾。

发生 Hard Stop 时，把状态、证据、已保护内容、恢复方法和唯一聚焦问题写入 RUN_STATUS。不要以“任务很大、时间很长、Agent 很多、测试暂时失败或需要视觉判断”为 Hard Stop。

## 8. 完成定义

必须同时满足：后端 Gate 全绿；`/work` 无静态 truth；五角色双端 shell 完成；API 写读闭环；四域状态与 Human Gate 真实；Chat authority 边界真实；Golden Case 三主路径和对抗路径可复跑；全量 quality Gate 有精确结果；无越界与残留；文档真实更新。

不要在 07:00 前等待用户回复。只有真正 Hard Stop 才停止；否则持续规划、执行、验证、纠正，直到最终交接包完成。
