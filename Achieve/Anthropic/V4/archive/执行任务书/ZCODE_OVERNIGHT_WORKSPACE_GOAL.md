# ZCode 整夜 Goal｜小微业务移动协同 + 四域桌面作业前后端 E2E

状态：`USER-AUTHORIZED / QUEUED AFTER CURRENT BACKEND GATE / LONG-RUN CANDIDATE / 2026-09-04`

## 0. 执行方式

这是当前 `ZCODE_BACKEND_GOAL.md` 的后续 Goal，不是另起一个重叠任务。ZCode 主 Agent 收到本任务后：

1. 继续完成正在运行的后端 Goal；不要重启、回滚或重复已经完成的 lane；
2. 当前后端 Definition of Done 在本地全部通过后，直接连续进入本任务，不等待用户夜间回复；
3. 只有出现本文定义的 Hard Stop 才停止并留下证据；普通缺陷、测试失败、视觉细节和可撤回实现选择由主 Agent 在本任务范围内自行修正；
4. 不在计划、组件壳、静态页面、第一次 build green 或截图处提前结束；
5. 最终结果仍是 Candidate，次日由 Codex 和用户独立验收，不得自称生产完成或用户已接受。

## 1. 必读顺序与 authority

按以下顺序读取，证据足够即停止，不宽扫 archive/materials：

1. `C:\Users\22673\Desktop\Anthropic\AGENTS.md`
2. `C:\Users\22673\Desktop\Anthropic\NORTH_STAR.md`
3. `C:\Users\22673\Desktop\Anthropic\DECISIONS.md`
4. `C:\Users\22673\Desktop\Anthropic\CHALLENGE_LOG.md`
5. `C:\Users\22673\Desktop\Anthropic\ROADMAP.md`
6. `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\AGENTS.md`
7. `docs/v4/ZCODE_BACKEND_GOAL.md`
8. `docs/v4/ZCODE_CONCURRENCY_TRIAL.md`
9. `docs/v4/CONTRACT.md`
10. `docs/v4/ACCEPTANCE.md`
11. `docs/v4/BACKEND_PROGRESS.md`（存在时）
12. 当前 `app/work/**`、`lib/v4life/**`、`app/api/v4life/**` 与相关测试。

本任务新增的最新 User Authority：今晚允许在后端本地 Gate 通过后继续做前后端完整 Candidate。范围只属于小微融资租赁；当前 Golden Case 具象采用直租，但通用 contract 不得锁死直租或排除回租。产品结构固定为“业务 + 政策、信审、商务、资产”五个角色共用同一 responsive system，全部具备 mobile/desktop；业务默认 mobile-first，四域默认 desktop-first。工作壳固定为顶部 Case Context、左侧角色看板/事项工作区、右侧 Case Chat，移动端重排为“看板 / 事项 / 协同”。管理、领导观察、比赛大屏、观众二维码、部署、真实认证、真实模型、汽融和其他事业部都不在今晚范围。

## 2. 唯一交付结果

交付一个真实可操作的：

```text
GET /work?caseId=demo-sme-robot-500w
```

它是小微业务与政策、信审、商务、资产四域围绕同一个经上游核验 Case 协作的 role-aware responsive workspace。仍然只有一个产品 Route 和一个服务端 `V4LifeProjection`：业务在手机上补件、看四域反馈和跟进；四域人员在桌面完成专业工作和 Human Gate。所有 Evidence、WorkItem、Human Decision 和 Receipt 动作都调用真实 `/api/v4life/**` Route Handler；动作成功后重新读取 canonical Projection，不由前端伪造状态。

用户在这一页应能直接理解并操作：

- 当前 Case、Context、金额、用途、修订号与合成声明；
- 业务当前需要补什么、已经提交什么、四域反馈和下一步是什么；
- 政策、信审、商务、资产四域分别在做什么；
- 哪些工作可并行、哪些正在等待 Evidence/WorkItem/Receipt；
- Agent/规则只产生什么 Candidate，为什么 `authority=none`；
- 当前需要哪个具名 Human Role 决定；
- 批准、退回、否决分别产生什么真实后果；
- 已经形成的 Evidence、Receipt、Contribution 和 Event；
- 服务端冲突、网络失败、过期状态或无权限时发生什么。

## 3. 当前页面的已知漂移

当前 `app/work/**` 是早期静态只读 Candidate，含有以下不再允许的口径：

- 固定“直租”；
- “供应商推荐”入口；
- 只深入信审，政策/商务/资产只作旁白；
- `DEMO_WORK_PROJECTION` 静态数据；
- 假聊天记录、假“3 人在线”；
- 假 Receipt 文案与 disabled 假动作；
- 页面自行描述“信审已完成、商务待承接”，但未读取当前 V4Life runtime。

新实现必须移除这些当前叙事。可以复用证明有效的 CSS、组件结构或 accessibility 细节，但不能让旧 fixture 继续拥有事实 authority。

## 4. 严格范围

### 4.1 必须完成

- 当前后端 Goal 的全部 DoD；
- 为真实工作台补足最小 Projection/fixture/API 能力；
- `/work` 单页四域工作台；
- 同一路由中五个角色的 mobile/desktop responsive 工作面；业务默认 mobile-first，四域默认 desktop-first；
- 顶部 Case Context、左侧角色看板/事项工作区、右侧 Case Chat 的共同工作壳；移动端为“看板 / 事项 / 协同”重排；
- 业务 + 四域五个 demo Actor 的角色切换与服务器端权限反馈；
- Evidence、WorkItem、Decision 三类真实写动作；
- Event、Receipt、Contribution、Candidate 的真实只读呈现；
- demo reset 能力，用于重复演示和 E2E；
- loading、empty/404、error、stale/version conflict、pending、replayed、success、returned、rejected 状态；
- focused tests、HTTP scenario、全量 test/typecheck/lint/build；
- 能使用现有浏览器能力时完成真实 viewport 验收和截图；
- 更新当前实现 CONTRACT、ACCEPTANCE、BACKEND_PROGRESS、STACK、CHANGELOG。

### 4.2 明确排除

- 不修改或重做根 `/` 管理页；
- 不修改 `app/jw-front.tsx`、`app/jw-front.css`、`app/page.tsx`、`app/evolve/**`；
- 不做领导 dashboard、管理 KPI、组织负荷、ROI 看板；
- 不做 canonical 大屏、二维码伴随页、观众网站或多个前端；
- 不做商机、客户、尽调、供应商、直租/回租选择页；
- 不扩展汽融、其他事业部或集团通用版本；
- 不做真人聊天、假在线状态、通知中心、文件上传或知识库；允许 Case Chat 框架，但其输出只能是解释、草案、Candidate 或补件建议，不得直接改变正式状态；
- 不接真实模型、真实客户数据、内网制度、API key、认证、RBAC、数据库或生产部署；
- 不开发通用 CRM/BPM/Agent 平台、拖拉拽画布或模型平台；
- 不新增 npm dependency，不修改 `package.json` 或 lockfile；
- 不修改旧 `lib/v4/**`、`app/api/v4/**` 或其测试；
- 不 commit、push、tag，不结束未知 localhost，不读取任何凭据。

## 5. Golden Case 最小后端扩展

当前 `V4Life` 后端已经有 policy/credit/commerce/asset domain，但正式 Gate 只覆盖政策与信审。为了让四域工作台不是四个栏目，完成当前后端 Goal 后，在同一 contract 下做以下最小向前扩展。

### 5.1 Projection

在 `V4LifeProjection` 中增加只读 `actors: V4LifeActor[]`，让页面不复制 seed 中的角色 ID/姓名。查询仍返回深克隆，不暴露内部引用。

不要为 UI 新造 summary endpoint、domain endpoint 或第二套状态。页面需要的筛选、计数、等待原因和 next-action 文案由纯 selector 从 canonical Projection 派生。

### 5.2 四域 WorkItem 与 Gate

保留当前：

- `WI-P1` 政策准入规则符合性初核 → `PG-1`；
- `WI-C1` 信审材料完整性核验；
- `WI-C2` 客户偿付能力交叉核验；
- `WI-C3` 正式信审意见与签批 → `CG-1`；
- `WI-B1` 商务方案与报价制式核对；
- `WI-A1` 同客户历史资产表现反馈整理。

增加：

- `WI-B2` 商务条款确认与合同承接：依赖 `CG-1` approved Receipt 与 `WI-B1` completed，assignedRole=`commerce`，gate=`BG-1`；
- `BG-1` 商务承接 Gate：requiredRole=`commerce`；
- `WI-A2` 租赁物条件与贷后巡检计划确认：依赖 `BG-1` approved Receipt 与 `WI-A1` completed，assignedRole=`asset`，gate=`AG-1`；
- `AG-1` 资产承接 Gate：requiredRole=`asset`。

这不是把全流程改成严格串行。`WI-P1`、`WI-C1`、`WI-A1` 在上游 Context 到达后并行；合同草案 Evidence 可提前启动 `WI-B1`；财务 Evidence 可启动 `WI-C2`。只有 `WI-C3`、`WI-B2`、`WI-A2` 这三个正式高成本承接动作等待前序 Receipt。

批准/否决产生不可变 Receipt；退回不产生 Receipt。否决只停止真实依赖项；已经形成的 Evidence、Candidate、Contribution、Event 和可独立完成的工作不得消失。

### 5.3 Demo reset

增加最小的合成演示重置能力，例如：

```text
POST /api/v4life/demo/reset
```

要求：

- 只允许固定合成 case `demo-sme-robot-500w`；
- 只重建当前进程内 demo runtime；
- production 环境返回 404 或明确禁用；
- 响应返回新的 canonical Projection；
- UI 明确标注“重置合成演示”，不得称作撤销正式业务决定；
- 有 route test，且不影响普通 Case contract。

### 5.4 不增加真实模型

Candidate 继续来自当前 deterministic mechanism，并必须展示 basis、producedBy、createdAt 与 `authority=none`。不要为了“AI 感”调用外部模型或生成不可验证文本。

## 6. `/work` 页面信息架构

只做一个 Route、一个共享 Case 和一个服务端 Projection，不拆成五套应用。五个角色都必须能在 mobile/desktop 使用同一系统；允许同一页面根据 selected role 与 viewport 呈现不同默认信息密度：业务默认 mobile-first，政策/信审/商务/资产默认 desktop-first。

Desktop 框架固定为：顶部 Case Context Bar；下方左侧为角色看板与当前事项工作区；右侧为围绕当前 Case 的智能协同 Chat。Mobile 框架固定为紧凑 Context 顶栏与“看板 / 事项 / 协同”三个主入口，Chat 不常驻挤压内容。先把该 responsive shell、区域职责和状态边界做稳，再填充细节；不要让五个角色分别发明导航。

### 6.1 顶部 Case Context Bar

首屏顶部稳定显示：

- “合成演示 / 非真实客户”醒目标识；
- Case 名称、caseId、融资金额、用途；
- 上游说明：业务已按现行制度完成受理与必要尽调核验；
- 当前 `rev`、事件数、Evidence 数和最后刷新时间；
- 连接状态：同步中 / 已同步 / 状态已过期 / 读取失败；
- 手动刷新；
- “重置合成演示”次要危险操作，需要二次确认。

不显示直租/回租，不显示供应商，不让用户从页面创建客户或商机。

### 6.2 左侧角色看板与事项工作区

左侧是主要作业面，不是领导管理 KPI dashboard。顶部始终可切换业务、政策、信审、商务、资产五个 demo Actor，并显示四域依赖网络；下方随 selected actor 展示其默认看板和当前事项。业务偏补件、反馈与跨域状态；政策、信审、商务、资产偏各自 WorkItem、Evidence、Candidate 与 Human Gate。所有角色仍可查看获授权的跨域上下文。

### 6.3 业务 Mobile-first 协同面

当 selected actor=`business` 时，页面首先解决业务人员在客户现场、通勤或移动沟通中的短任务：

- 看 Case 名称、金额、用途、当前 rev 和合成声明；
- 看政策、信审、商务、资产分别处于什么状态，但不展示管理 KPI；
- 看当前由哪个专业域提出什么材料/说明需求；
- 使用预设模板或短文本提交 financial statement、contract draft、asset history feedback 或 supplement Evidence；
- 看提交是否 accepted/replayed，以及由此启动了哪些 WorkItem；
- 看 Candidate、Human Decision、Receipt 和被退回/否决原因的只读摘要；
- 手动刷新或等待轻量轮询；
- 绝不出现政策/信审/商务/资产批准按钮。

业务移动端不能变成客户 CRM、商机漏斗、尽调采集或聊天工具。它只是同一个小微 Case 的补件、反馈和跟进协同入口。

### 6.4 四域 Dependency Network

顶部下方显示政策、信审、商务、资产四域网络。它不是四个 KPI 卡，也不是强制线性进度条。

每个域显示：

- 域名和具名 Actor；
- WorkItem 状态分布；
- open/pending/decided Gate；
- Candidate 数；
- 明确等待原因，例如“等待 financial_statement”“等待 PG-1 Receipt”；
- 可立即处理的 next WorkItem。

状态至少区分：`blocked / in_progress / awaiting_gate / completed / stopped_dependency`。依赖用 Evidence、WorkItem、Receipt 三种标签表达。点击域切换当前工作区，但全域状态始终可见。

### 6.5 当前 Domain Workbench

主区域显示当前选中域的：

- 具名 demo Actor 与 role；
- WorkItem 列表、依赖、当前状态和已提交 output；
- 关联 Candidate 及 basis；
- 关联 Gate；
- 当前允许动作及为什么允许/禁止；
- Contribution 保留状态。

角色切换只是合成演示身份模拟，必须明确标注“demo role switch，不代表生产认证”。前端可以选择业务及四域 Actor；业务只能提交获允许的 Evidence 和读取反馈，四域后端仍根据 actorId/role 拒绝越权。

### 6.6 Evidence 操作

Evidence 区展示真实 `projection.evidence`。业务 mobile-first 面是默认补件入口；四域桌面也可按现行权限提交 Evidence。提供三个快速演示模板并允许编辑摘要：

- `financial_statement`：启动 `WI-C2`；
- `contract_draft`：启动 `WI-B1`；
- `asset_history_feedback`：形成资产历史反馈 Evidence/Candidate；
- 必要时允许 `supplement`，但不做文件上传。

提交必须调用 Evidence API，生成一次 commandId 并使用当前 expectedRev。显示 accepted/replayed；同键异载荷、版本冲突或非法输入不得显示成功。

### 6.7 WorkItem 操作

只有 selected actor role 与 `assignedRole` 一致且 item=`in_progress` 时允许提交工作。提交 outputSummary 后：

- 无 Gate item 进入 completed；
- 有 Gate item 进入 awaiting_gate，并打开对应 Gate；
- 页面重新 GET canonical Projection 后更新。

被 blocked、awaiting_gate、completed 或 stopped_dependency 的 item 不显示可提交假按钮；显示真实原因。

### 6.8 Human Gate 操作

Gate 面板只对 `open` Gate 和匹配 requiredRole 的 selected actor 启用：

- `approved`：必须填写理由，产生 Receipt；
- `returned`：必须填写补充要求，不产生 Receipt；
- `rejected`：必须填写理由并二次确认，产生 Receipt，显示受影响 work items；
- 不提供“自动通过”或 Agent 决定按钮。

任何 Decision 成功都必须从响应/重新读取的 Projection 中取得 Receipt，不得在客户端临时拼一个成功卡片。

### 6.9 Evidence / Candidate / Receipt / Event Rail

右侧或下方检查面提供四个清晰 tab：

- Evidence：来源、kind、提交人、版本、摘要、tags；
- Candidate：domain、kind、summary、basis、producedBy、authority；
- Receipt：gate、actor、outcome、reason、时间、receiptId；
- Event Ledger：真实 seq、type、actor、时间，可按 `afterSeq/limit` 分页。

不显示静态聊天，不显示假在线人数。协作发生过什么，由 Event、Evidence、Contribution 和 Receipt 表达。

### 6.10 右侧 Case Chat

Chat 始终绑定当前 caseId、selected actor、Projection rev 与当前选中 WorkItem/Gate。首轮先完成可信框架和状态边界，不需要接真实模型：

- 可以解释当前状态、总结 Evidence、生成工作草案/Candidate、提出补件建议和定位下一 Human Gate；
- 每条引用 Case 内容的回答必须显示依据来源或明确“暂无依据”；
- Chat 不持有 canonical state，不直接提交 WorkItem、批准/退回/否决 Gate，也不创建 Receipt；
- 如用户希望把 Chat 草案用于正式动作，必须回到左侧事项工作区显式确认并经过现有 API；
- 未接模型时明确显示“协同框架 / 未连接模型”，不得用预写对话冒充实时能力；
- 不显示真人在线、群聊成员、消息已读或其他未经实现的协作状态；
- Desktop 常驻右侧；Mobile 进入“协同”页签或抽屉，返回后保持同一 Case/actor/selection Context。

## 7. Client state 与命令纪律

### 7.1 Canonical state

- 首次进入调用 `GET /api/v4life/cases/:caseId`；
- 所有写动作完成后重新 GET；
- 可以每 2–3 秒轻量轮询同一 Projection，页面 hidden 时暂停，卸载时 abort；
- 不引入全局状态依赖；使用 React 内建能力和可测试 pure selectors；
- 不把本地 state 当正式 Case truth。

### 7.2 Command ID 与网络不确定性

- 每次用户动作生成一次 `crypto.randomUUID()` commandId；
- 请求 pending 期间禁用重复提交；
- 传输失败且结果未知时，UI 提供“按原命令重试”，必须复用完全相同 commandId 和 payload；
- `VERSION_CONFLICT` 时先刷新 Projection，不自动重放用户意图，要求用户基于新 rev 再确认；
- `IDEMPOTENCY_CONFLICT` 明确显示同键异载荷，不生成新成功状态；
- `ROLE_MISMATCH`、`WORK_ITEM_NOT_ACTIVE`、`GATE_NOT_OPEN` 等错误映射为可理解中文，同时保留 exact error code；
- 未知错误显示 `INTERNAL_ERROR`，不暴露 stack、路径或内部对象。

### 7.3 禁止 optimistic authority

可以显示按钮 pending，但不能提前把 WorkItem 标成 completed、Gate 标成 decided 或显示 Receipt。只有服务端响应并重新读取 Projection 后才能改变这些视图。

## 8. Golden Case 演示路径

至少支持以下可重复路径，并通过 demo reset 回到初态。

### 8.1 初态证明

- `WI-P1`、`WI-C1`、`WI-A1` 同时 `in_progress`；
- `WI-C2` 等待 financial Evidence；
- `WI-B1` 等待 contract Evidence；
- `WI-C3` 等待 `PG-1` Receipt 与 `WI-C1/WI-C2`；
- `WI-B2` 等待 `CG-1` Receipt 与 `WI-B1`；
- `WI-A2` 等待 `BG-1` Receipt 与 `WI-A1`。

### 8.2 Happy path

1. 业务在 mobile-first 协同面补充 contract、financial 与 asset history Evidence；
2. 资产先完成 `WI-A1`，其贡献被记录；
3. 商务提前完成已被 Evidence 启动的 `WI-B1`，信审完成 `WI-C1/WI-C2`；
4. 政策完成 `WI-P1`，由政策 Actor approved `PG-1`；
5. `WI-C3` 自动开始，信审提交并 approved `CG-1`；
6. `WI-B2` 自动开始，商务提交并 approved `BG-1`；
7. `WI-A2` 自动开始，资产提交并 approved `AG-1`；
8. 业务移动端看见补件结果和四域反馈，四域桌面显示 Receipt、完整 Event 序列和保留的 Contribution。

这条路径必须看出准备工作非线性并行、正式 Gate 仍按权威依赖推进。

### 8.3 Return path

- 对一个 open Gate 执行 returned；
- 不产生 Receipt；
- WorkItem 回到可继续状态；
- 补充/重做后可再次提交并重新打开 Gate；
- UI 不把 returned 显示成 rejected 或 approved。

### 8.4 Reject path

- 在 `PG-1` rejected；
- 真实依赖政策 Receipt 的后续正式工作停止或保持不可启动；
- 已完成的 `WI-A1/WI-B1/WI-C1`、Evidence、Candidate、Contribution 和 Event 保留；
- UI 明确区分“本次被否决”和“人的既有工作价值归零”，后者绝不发生。

### 8.5 Adversarial path

- 错 role 决策 → 403；
- 旧 rev 写入 → 409，并刷新；
- 同 commandId 不同 payload → 409；
- 双击/重复同命令 → replay，不双写；
- blocked work submit → 409；
- 未知 case → 404 empty/error state；
- reset 在 production → 禁用。

## 9. 视觉与交互合同

这是专业人员作业面，不是管理 dashboard，也不是营销 landing page。

- 五个角色都验收 `1920×1080`、`1440×900`、`390×844` 与 `360×800`；业务默认体验以 mobile-first 为主，四域默认体验以 desktop-first 为主；
- Desktop 采用顶部 Context、左侧看板/事项、右侧 Chat；Mobile 不压缩桌面三栏，而是把同一能力重排为“看板 / 事项 / 协同”入口；
- 两端按同一 authority 提供必要能力，差别只在默认布局、密度和优先级；不能因为四域 desktop-first 就把其移动端做成只读残缺页，也不能为了 mobile 把桌面专业信息压平；
- 这是一个 responsive product，不是五套应用、两套状态或两套演示脚本；
- 中文为主，technical identifiers 只在证据/审计位置出现；
- 使用克制的暖白/深灰和单一小面积橙色强调，可沿用现有项目视觉基因；
- 信息密度高但层级清楚，不使用巨大 hero、装饰性渐变、发光、玻璃拟态、无意义大卡片和假图表；
- 不用颜色单独表达状态；每个状态有文字/图形；
- 正常、等待、退回、否决、错误的层级明确，危险动作不能与普通提交同色同权重；
- control height、focus-visible、keyboard order、label、aria-live、reduced-motion、contrast 满足基本 accessibility；
- loading 不闪烁假成功；空态和错误态保持 Case/route Context；
- 不需要把所有内容硬塞进一屏，但第一视口必须覆盖核心决策链，细节可以 drawer/tab 展开。

视觉完成是 Candidate；不因用户睡眠而停在“等待审美反馈”。先完成克制、可用、可验证的整页，次日再由 Codex 做审美复核。

## 10. Ownership

### 10.1 当前后端 Goal 完成前

维持 `ZCODE_BACKEND_GOAL.md` 已有 ownership。新 Goal 只能排队和只读分析，不能与仍在运行的 lane 双写。

### 10.2 进入本 Goal 后，ZCode 允许写入

- `app/work/**`
- `lib/v4life/**`
- `app/api/v4life/**`
- `test/v4life-*.test.mjs`
- `scripts/v4life-*.mjs`
- `docs/v4/CONTRACT.md`
- `docs/v4/ACCEPTANCE.md`
- `docs/v4/BACKEND_PROGRESS.md`
- `STACK.md`
- `CHANGELOG.md`
- `docs/v4/evidence/workspace/**`（仅真实验收截图/简短机器结果）

本文件只读。不得写根部 authority 或 §4.2 的排除路径。

### 10.3 单 writer

每个文件同一时间只有一个 writer。共享 type、selector contract、API shape、CSS token、integration entry 由主 Agent 先串行冻结；writer lane 只写自己分配的文件。Lane 返回后由主 Agent 串行整合。

## 11. 整夜自适应滚动任务池

不要中断当前仍在运行的后端 Generate。进入本 Goal 后，使用 `A01–J10` 共 100 个有依赖的小任务包作为首批 backlog，但不把 100、20、4 或任何其他数字设为 subagent、活跃任务、累计任务或 Generate 的人为上限：

- 主 Agent 是唯一 scheduler，持续维护 ready/blocked/done queue；只要存在独立且有价值的 ready work，就按平台实际可用容量尽量并行并在完成后立即补位；
- `A01–J10` 只是首批任务分层。首批耗尽但 Acceptance 尚未全绿时，根据真实 Evidence 创建 `X001+` 后续修复、回归、审计或浏览器复验包并继续；
- 每个活跃 Agent 都必须有独立 ownership、输入、输出、Evidence 与停止条件；不得重复扫描、重复实现、重复跑无变化 Gate或为了显示更多 Agent 制造工作；
- Generate/writer 数量不设固定上限，但同一文件同一时间只能有一个 writer，两个任务会触碰同一实现面时必须保持依赖顺序；
- 共享 contract/schema/props/API shape 改变后必须设置 integration barrier：暂停相关 writer、由主 Agent 串行冻结和整合、跑 focused Gate、重算 ready/blocked queue，再继续；
- Explore、Review、Verify 默认只返回短 Evidence；确需落盘时必须先获得独立文件 ownership，不能抢写共享报告；
- subagent 不承担二级派工，也不能用“再创建自己的 subagent”作为依赖；所有补位由主 Agent完成；
- 平台短期限流、容量不足或任务失败时记录 Evidence、合理退避并继续调度其他 ready work；只有平台实际不可用且无其他可推进事项时才按 Hard Stop 报告；
- 不设置基于调用数、任务包数、运行轮数或主观“已经做很多”的停止条件。只在全部 Acceptance Gate 通过并完成最终报告，或触发本文 Hard Stop 时结束。

当前观测中 Explore 先结束、约 2 个重型 Generate 继续运行是合理形态，但这也不是固定模板。若出现更多互不重叠且依赖已满足的 Generate，应继续扩张；持续完成正确依赖链和最终交付是唯一优化目标。

### 11.1 三类队列

1. `READY-READ`：可立即执行的 Explore/Review/Verify，不写代码；
2. `READY-WRITE`：前置契约已冻结且 ownership 唯一的 Generate；
3. `BLOCKED`：等待某个 packet、共享 Gate 或新 artifact，条件满足后才转 READY。

每个 packet 回传：`ID / TYPE / STATUS / INPUTS / EVIDENCE / DEFECTS / FILES_WRITTEN / UNBLOCKS`。只读包的 `FILES_WRITTEN` 必须为空。主 Agent维护唯一 ledger，不让 subagent 各自改同一进度文档。

### 11.2 Writer topology

主 Agent 先串行创建/冻结共享 props、selector 和 file ownership 表，然后建议：

### Writer W1｜Projection selectors 与 API client

独占纯 selector、错误映射、command transport、poll/abort/retry controller 相关新文件及 focused tests。不得写视觉组件。

### Writer W2｜业务 Mobile-first 协同面

独占 Business actor 的 Case Context、补件请求、Evidence 快速提交和反馈摘要组件及其 mobile-first CSS module。只消费冻结 props/commands，不自行持有 canonical state。

### Writer W3｜四域 Desktop-first Network 与 Workbench

独占四域 Dependency Network、WorkItem、Human Gate 组件及各自 desktop-first CSS module。只通过传入 commands 触发动作，不持有 canonical state。

### Writer W4｜Evidence/Receipt/Event Rail 与状态页面

独占 inspection rail、ledger pagination、loading/empty/error components 及 CSS module。不得改 W1–W3 文件。

### Read-only reviewer lanes

可并行审计：小微范围、业务与四域 authority、contract/API、依赖状态机、idempotency、version conflict、reset safety、错误泄露、React state race、轮询/abort、accessibility、1920 四域桌面布局、390 业务移动布局、四域移动降级、信息架构、旧静态 fixture 残留、测试覆盖、build/SSR compatibility。每路只返回短 Evidence 和缺陷，不改文件。

主 Agent 独占 `app/work/page.tsx`、最终 shell、共享 contract 和跨 lane 修复。不能让 20 个 Agent 同时碰一个 CSS 或 integration file。

### 11.3 百包 backlog

类型：`E`=Explore，`G`=Generate，`R`=Review，`V`=Verify。`G` 只有在对应 ownership 已由主 Agent 登记且前置 ID 完成后才能启动。

#### A｜关闭当前后端 Gate（A01–A10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| A01 | E | 盘点当前后端 lane、实际 diff、未回传 ownership | 当前 Goal |
| A02 | E | 建立 v4life focused/full test 清单与覆盖映射 | A01 |
| A03 | R | 审计 Human authority 与 `authority=none` | A01 |
| A04 | R | 审计四域状态迁移及 return/reject 终态 | A01 |
| A05 | R | 审计 idempotency、version conflict 与 command identity | A01 |
| A06 | R | 审计 event sequence、replay、deep clone 与恢复一致性 | A01 |
| A07 | R | 审计角色权限、错误边界及敏感信息泄露 | A01 |
| A08 | R | 对照 route/runtime/schema 的 exact API contract | A01 |
| A09 | V | 执行后端 focused tests 并归类真实失败 | A02–A08 |
| A10 | G | 在唯一 ownership 下修复 A09 暴露的后端 Gate 缺陷 | A09 |

#### B｜冻结 Workspace Contract（B01–B10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| B01 | E | 列出 Projection 当前字段与 UI 所需最小 delta | A09 |
| B02 | R | 冻结业务 actor 可见信息与禁止动作 | B01 |
| B03 | R | 冻结政策、信审、商务、资产 actor 与 Human Gate | B01 |
| B04 | R | 冻结 Evidence/Candidate/Receipt/Contribution/Event 语义 | B01 |
| B05 | R | 冻结 B2/BG-1 与 A2/AG-1 依赖和失败传播 | B03–B04 |
| B06 | R | 冻结 demo reset 的合成边界与 production fail-closed | B01 |
| B07 | R | 冻结 client retry/poll/abort/version error 语义 | B01 |
| B08 | E | 形成 shared props、selectors、commands 候选表 | B02–B07 |
| B09 | E | 形成逐文件 ownership 与依赖 DAG | B08 |
| B10 | V | 检查 CONTRACT/ACCEPTANCE/Goal 三者无冲突 | B02–B09 |

#### C｜最小后端扩展（C01–C10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| C01 | G | 实现 Projection actor/type 最小扩展及 focused tests | B10 |
| C02 | G | 接通 actor Projection runtime 映射 | C01 |
| C03 | G | 实现商务 B2/BG-1 domain transition 与 tests | B05 |
| C04 | G | 接通商务 route/runtime 与 permission checks | C03 |
| C05 | G | 实现资产 A2/AG-1 domain transition 与 tests | B05 |
| C06 | G | 接通资产 route/runtime 与 permission checks | C05 |
| C07 | G | 实现 demo reset domain/store 语义 | B06 |
| C08 | G | 实现 reset route、环境保护和 tests | C07 |
| C09 | G | 补新增事件的 replay/idempotency/version coverage | C02/C04/C06/C08 |
| C10 | V | 跑扩展后端 focused Gate 并输出 delta | C09 |

#### D｜Selectors 与 API Client（D01–D10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| D01 | E | 盘点旧 fixture/import 与可复用 client 代码 | B10 |
| D02 | G | 实现 typed Projection selectors | B08/C01 |
| D03 | G | 实现 initial GET 与 response validation | D02/C10 |
| D04 | G | 实现 command transport 与 command identity | D03 |
| D05 | G | 实现 poll/manual refresh controller | D03 |
| D06 | G | 实现 unmount/route change abort | D05 |
| D07 | G | 实现 retry 复用 commandId 且 version conflict 不自动重放 | D04 |
| D08 | G | 实现 404/transport/domain/conflict 错误映射 | D03–D07 |
| D09 | G | 补 selectors/client/controller focused tests | D02–D08 |
| D10 | R | 复核 client 无静态成功态、无双 canonical state | D09 |

#### E｜业务 Mobile-first 协同面（E01–E10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| E01 | E | 冻结 390×844 业务信息层级与首屏动作 | B02/B08 |
| E02 | R | 审核业务端最小数据、权限和禁止越权清单 | E01 |
| E03 | G | 实现业务 Case Context 组件 | D02/E01 |
| E04 | G | 实现补件请求/待办组件 | D02/E01 |
| E05 | G | 实现 Evidence 快速提交组件 | D04/E02 |
| E06 | G | 实现四域反馈与下一步摘要组件 | D02/E01 |
| E07 | G | 实现 pending/confirm/error action feedback | D07–D08/E05 |
| E08 | G | 完成业务 mobile-first CSS 与触控尺寸 | E03–E07 |
| E09 | G | 补业务端 keyboard/label/aria focused tests | E03–E08 |
| E10 | R | 复核 390×844 与 360×800 无横向溢出 | E08–E09 |

#### F｜四域 Desktop-first Workbench（F01–F10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| F01 | E | 冻结 1920×1080 四域信息架构与 selected actor 逻辑 | B03/B08 |
| F02 | G | 实现共享 WorkItem/Human Gate primitives | F01/D02 |
| F03 | G | 实现政策域 panel 与 actions | F02/D04 |
| F04 | G | 实现信审域 panel 与 actions | F02/D04 |
| F05 | G | 实现商务域 panel 与 B2/BG-1 | F02/C04/D04 |
| F06 | G | 实现资产域 panel 与 A2/AG-1 | F02/C06/D04 |
| F07 | G | 实现 Candidate/tendency 与 dependency state | F03–F06 |
| F08 | G | 实现 return/reject/blocked/ready 的可辨状态 | F03–F07 |
| F09 | G | 完成 desktop-first CSS 与 1440 降级 | F03–F08 |
| F10 | G | 补四域角色动作与 authority focused tests | F03–F09 |

#### G｜Evidence、Receipt 与失败状态（G01–G10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| G01 | G | 实现 Evidence inspection rail | D02/B04 |
| G02 | G | 实现 Receipt rail 与未生成原因 | D02/B04 |
| G03 | G | 实现 Event ledger pagination/timeline | D02/B04 |
| G04 | G | 实现 Contribution 可见但非绩效排名视图 | D02/B04 |
| G05 | G | 实现 loading/empty/error/retry primitives | D08 |
| G06 | G | 实现 unknown Case/stale/conflict/replayed 状态 | D08/G05 |
| G07 | G | 实现 selected actor 切换与 action availability | B03/D02 |
| G08 | R | 审核状态语言不冒充自动批准或生产能力 | G01–G07 |
| G09 | R | 审核 rail 与失败态 accessibility | G01–G07 |
| G10 | R | 审核 1920/1440 密度、层级和 10 米非目标边界 | G01–G07 |

#### H｜串行集成 `/work`（H01–H10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| H01 | G | 主 Agent 接入唯一 `/work` shell | D10/E10/F10/G09 |
| H02 | V | 验证首次 GET 完整渲染同一 Projection | H01 |
| H03 | V | 验证 poll 与 manual refresh 无竞态 | H01 |
| H04 | V | 验证 write→refetch 且 canonical state 仅服务端 | H01 |
| H05 | R | 审核 action availability 来自 actor+Projection | H01 |
| H06 | G | 清除 `/work` 旧 fixture/假聊天/假在线/假 Receipt 引用 | H02–H05 |
| H07 | G | 修复 SSR/client boundary 与 hydration 问题 | H01/H06 |
| H08 | G | 修复 stale response、double submit 与 abort race | H03–H04 |
| H09 | G | 完成错误恢复与可重复 retry UX | H06–H08 |
| H10 | V | 跑 `/work` focused integration tests | H06–H09 |

#### I｜Golden Case 与对抗路径（I01–I10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| I01 | V | reset 后验证唯一初态与初始并行可见 | C10/H10 |
| I02 | V | 执行政策 happy path 并核对事件 | I01 |
| I03 | V | 执行信审与商务 happy path 并核对 Gate | I02 |
| I04 | V | 执行资产 happy path 至 AG-1 Receipt | I03 |
| I05 | V | 执行 return、重做、再提交且不提前 Receipt | I01 |
| I06 | V | 执行 policy reject 并验证依赖停止、贡献保留 | I01 |
| I07 | V | 执行 role mismatch 与越权失败 | I01 |
| I08 | V | 执行 stale rev/version conflict 且不自动重放 | I01 |
| I09 | V | 执行相同/冲突 idempotency command | I01 |
| I10 | V | 刷新/restart/replay 后核对状态、事件和 Receipt | I02–I09 |

#### J｜全量质量与次日交付（J01–J10）

| ID | 类型 | 任务 | 主要依赖 |
| --- | --- | --- | --- |
| J01 | V | 运行 focused 与 `npm.cmd test` | H10/I10 |
| J02 | V | 运行 `npm.cmd run typecheck` | H10 |
| J03 | V | 运行 `npm.cmd run lint` | H10 |
| J04 | V | 运行 `npm.cmd run build` | J01–J03 |
| J05 | V | 浏览器验收 1920×1080 四域桌面 | J04 |
| J06 | V | 浏览器验收 1440×900 四域桌面 | J04 |
| J07 | V | 浏览器验收 390×844 与 360×800 业务移动 | J04 |
| J08 | R | 验收 keyboard/focus/label/aria-live/reduced-motion/console | J05–J07 |
| J09 | V | 扫描越界文件、凭据、依赖变化和 task-owned 进程残留 | J04 |
| J10 | G | 串行更新交付文档、Evidence 索引与最终报告 | J01–J09 |

允许 scheduler 根据真实已有实现把首批包标成 `SKIPPED_ALREADY_SATISFIED`，也允许把暴露新缺陷的包标记 `REOPENED_ON_EVIDENCE`。首批百包完成后，如果任何 Acceptance Gate 未通过，使用单调递增的 `X001+` ID 创建新的缺陷修复/复验包并继续；不得复制同一任务冒充吞吐。无论实际执行多少包，只有全部 Acceptance Gate 真实通过才可 `COMPLETE`。

## 12. 连续执行 Phase

### Phase 0｜关闭当前后端 Goal

- 等待/完成现有 lane；
- 串行整合；
- 生成 `BACKEND_PROGRESS.md`；
- 跑 focused test 与全量 test/typecheck/lint/build；
- 如果后端 contract 或 tests 未通过，留在 Phase 0 修复，不能带着未知 backend 进入 UI。

### Phase 1｜冻结 Workspace Contract

- 把 §5–§8 转成 exact implementation contract；
- 冻结 Projection actors、B2/A2 与 BG-1/AG-1、reset、client command/retry/error semantics；
- 冻结 shared component props 和逐文件 ownership；
- 新增先失败的 focused tests；
- 更新 `docs/v4/CONTRACT.md`，不得让 UI 反向发明 authority。

### Phase 2｜最小后端扩展

- 实现 actors Projection、四域正式承接链、demo reset；
- 补 domain/route/replay/idempotency/adversarial tests；
- focused backend tests 全绿后进入前端。

### Phase 3｜并发构建四域工作台

- 按 W1–W4 非重叠 ownership 实现；
- reviewer 并行只读；
- 主 Agent 保持共享入口不双写；
- 不停在静态 layout，必须接真实 API 和命令。

### Phase 4｜串行集成与清理

- 主 Agent 将组件接入 `/work`；
- 移除旧直租/供应商/假聊天/假在线/静态 Receipt 引用；
- 只有确认无引用且有恢复证据时，才删除或归档旧静态 fixture 文件；
- 解决 SSR/client boundary、CSS、route、race 和 exact type 问题；
- 不改管理页面。

### Phase 5｜E2E 与失败路径

- 增加一个可重复 HTTP scenario script，reset 后依次证明初态、happy、return、reject、adversarial；
- 浏览器实际操作 Evidence、Work、Decision，并验证刷新后状态仍来自服务端；
- 验证未知 Case、网络错误、stale rev、role mismatch 和 replay；
- 检查 console、keyboard、responsive 和无水平溢出。

### Phase 6｜全量验证与交付

- focused tests；
- `npm.cmd test`；
- `npm.cmd run typecheck`；
- `npm.cmd run lint`；
- `npm.cmd run build`；
- task-owned localhost HTTP/Browser Gate；
- 凭据/越界文件/残留进程扫描；
- 更新 CONTRACT、ACCEPTANCE、BACKEND_PROGRESS、STACK、CHANGELOG；
- 输出最终 diff、命令、Evidence、未验证项和次日验收入口。

## 13. Localhost 纪律

需要真实 HTTP/Browser Gate 时可以启动本任务自己的 localhost，但必须：

1. 先检查现有状态和端口；
2. 不结束、不抢占未知进程；
3. Windows 后台进程隐藏窗口并记录 PID/端口；
4. 只停止本任务明确启动的进程；
5. finally/结束报告确认无残留；
6. 无法安全启动时记录 `BROWSER_NOT_VERIFIED`，继续完成非浏览器 Gate，不伪造截图。

## 14. Acceptance Matrix

以下全部通过才可报告本 Goal 完成：

### Product

- `/work` 只表达一个小微业务协同入口及政策、信审、商务、资产；
- 业务不是第五个风控域，不拥有任何 Human Gate 决策权；
- 不出现汽融、其他事业部或集团通用主张；
- 无商机/客户/尽调/供应商/直租回租模块；
- 无管理 KPI、领导 dashboard、聊天或假在线；
- Human authority 与 Agent `authority=none` 可见且真实生效。

### Backend

- current backend Goal DoD 全绿；
- Projection 包含 actors、rev、四域 items/gates/candidates、Evidence/Receipt/Contribution；
- B2/BG-1、A2/AG-1 依赖正确；
- reset 仅合成 demo 且 production 禁用；
- replay、event sequence、deep clone、idempotency、optimistic concurrency 不回退。

### Frontend

- 不再 import `DEMO_WORK_PROJECTION` 作为 truth；
- initial GET、poll/manual refresh、write→refetch 正常；
- 业务移动协同面与四域桌面 workbench 都读取同一 Projection；
- 四域 network、当前 workbench、Evidence/Candidate/Receipt/Event 可操作/可读；
- action availability 来自 Projection + selected actor，不来自硬编码成功状态；
- pending 不重复提交；transport retry 复用命令；version conflict 不自动重放；
- approved/returned/rejected 语义正确；
- 404/loading/error/stale/replayed 完整。

### Golden Case

- 初态并行可见；
- happy path 到 AG-1 Receipt；
- return 不发 Receipt，可重做；
- policy reject 后依赖停止、既有贡献保留；
- role mismatch/version conflict/idempotency conflict 有真实 Evidence。

### Quality

- focused + full test/typecheck/lint/build 全绿；
- 四域桌面 `1920×1080/1440×900` 与业务移动 `390×844/360×800` 无关键遮挡或横向溢出；
- 四域手机模式保留必要查看和轻操作，但不冒充 95% 主场景；
- keyboard/focus/label/aria-live/reduced-motion 基本通过；
- browser console 无应用错误；
- 没有新 dependency、凭据、真实客户信息、生产声明或越界修改；
- 没有残留 task-owned server。

## 15. Hard Stop

只有以下情况停止并留下唯一聚焦问题：

- 必须修改制度 authority、Root North Star 或用户冻结决定；
- 必须安装依赖、选择生产数据库/认证/部署平台或读取真实凭据；
- 必须修改管理页、旧 `lib/v4/**`、package/lockfile 才能继续；
- 当前后端 contract 出现无法在现有 authority 下裁决的自相矛盾；
- 工作区出现另一个 writer 正在修改本 Goal 的同一文件；
- 发生无法恢复的文件损坏或可能丢失用户修改。

一般类型错误、测试失败、CSS 问题、API 适配、组件拆分和可撤回的实现选择不是 Hard Stop，必须继续诊断和修复。

## 16. 最终报告格式

最终只在真实完成或 Hard Stop 时报告：

1. `STATUS: COMPLETE` 或 `STATUS: BLOCKED`；
2. 实际完成的用户路径；
3. 后端 contract delta；
4. 前端文件与信息架构；
5. API/E2E Evidence；
6. test/typecheck/lint/build/browser 的精确命令与结果；
7. 调度 ledger：首批与 `X001+` packets 的 ready/started/completed/skipped/reopened/blocked，subagents cumulative/peak-active、Generate peak、failed/throttled/cancelled；这些数字只作 Evidence，不作完成或停止条件；
8. 未验证项与诚实限制；
9. 越界检查、localhost 残留和凭据扫描；
10. 次日 Codex 应打开的 URL、Case 与建议验收顺序。

不要用“页面已搭好”“大部分完成”“看起来没问题”代替上述证据。
