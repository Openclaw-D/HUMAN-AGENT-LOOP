# 见微-人机协同平台 V3 Direction 冷启动交接

更新：2026-08-29

## 1. 当前阶段

- V2 已作为阶段版本冻结；V3 Gate 1 至 Gate 19 已完成 Direction 冻结，旧实现只有经过 V3 contract 与验收重新映射后才能继承。
- D1 Control contract 已通过一致性 Gate：Narrative、Golden Scenario、Role Projection、API / Event 与 Acceptance 五份契约已经冻结；当前进入 D2 受控实现。
- 决赛仍限定融资租赁业务，不扩展成银行、保险、信托、全牌照或通用企业管理叙事。
- 当前已确认 Gate 1 至 Gate 19；逐项结论与最新纠偏以 `V3_DIRECTION_FREEZE.md` 为准。
- Direction 与 D1 Contract Gate 已完成；当前按冻结契约进入 D2，不再继续无限讨论宏观方向或在实现中反向改写 Authority。
- 比赛定位是“以小微直接租赁完整闭环实例化的企业 AI-Native 转型 Demo”；完整指一个经营域内端到端可运行，不代表建设通用企业系统或生产平台。

## 2. 不可漂移的后端原则

- 后端是唯一 Backend Authority Kernel；前端、OCR、模型与 Adapter 只能提交材料、观察或候选结果，不能直接改写权威事实。
- 唯一业务权威对象仍为 `FinancingLeasingCase`。一个项目只有一个 `caseId`、一条事件历史和当前 Context Version。
- 权威内核负责 Event、Evidence、Context Version、Human Gate、Action、Receipt、权限和失败关闭。
- 多端只消费后端派生的 Projection；不得为任何前端建立第二份业务真相。
- 模型 authority=none；高风险动作由有权人确认并产生 Receipt。
- 当前仅使用合成、去标识或公开材料；不得伪装集团内网、真实客户数据、生产持久化或已接 live 模型。

## 3. 角色术语

- “风控”固定指政策、信审、商务、资产四板块的总和。
- “信审”只在明确指信审板块时使用。
- 直接租赁外部主体包括租赁公司、供应商、客户。
- V3 前端不是八套系统，而是四个 Role Application；每个系统同时适配 Mobile 和 Desktop。

## 4. 已冻结的四个 Role Application

技术上：一个前端代码库、一套设计系统、一套 API、一个后端内核。

产品上：

1. **协同应用（内部标识仍为 `leadership`）**
   - Gate 17 已冻结：前端可见一级入口不得出现“领导”，统一显示为“协同”；内部权限标识暂不迁移。
   - Gate 13 已纠正早期“纯观察者”边界：领导可以在有权限的 Human Gate 中确认方案并形成带 Context Version、依据与 Receipt 的 Management Action。
   - Gate 15 已冻结：领导只能进行目标、导向、优先级、资源、追问、复核请求和组织协调，不能替政策、信审、商务、资产作正式专业判断，也不能覆盖专业 Gate。
   - Desktop 首页可呈现 God View：组织 KPI、时间下钻、多项目组合、阶段、异常、超期、瓶颈、趋势、Case 归因和 Golden Case。
   - Mobile 呈现同一系统的响应式压缩视图；不是另一套 Leadership App。
   - 支持基于 Leadership / Portfolio Projection 的文字或 Voice 查询；聊天或 Voice 只能生成候选，正式 Action 必须经过有权 Human Gate。
2. **业务系统**
   - 商机、现场采集、拍摄、补件、关键问题回复、协调和确认。
   - Mobile 是高频简化布局；Desktop 是同一系统的完整布局，用于复杂项目和批量材料。
   - 不再把 Field 与 Business Workbench 定义为两套产品。
3. **风控系统**
   - 覆盖政策、信审、商务、资产四板块。
   - Mobile 与 Desktop 使用同一对象、名词、状态和操作；Mobile 压缩，Desktop 展开图谱、矩阵、证据和复杂判断。
4. **外部协同系统**
   - 客户和供应商共用一个响应式 Web，依据身份得到不同 Role Projection。
   - 只开放被请求的材料、问题、确认和有限项目进度。

同一角色在不同设备上的差异只允许是布局、信息密度和展开层级；业务对象、动作含义、状态、权限和 Receipt 必须一致，避免二次学习。

## 5. 协同驾驶舱的组织逻辑

- 领导面对的是组织层级汇总，不是数百人的私聊或个人活动流。
- 后端需要表达版本化组织关系，例如 `actor -> team -> manager -> orgUnit`，并据此派生管理范围；组织图不是第二个业务权威对象。
- 信息按金字塔逐层压缩：基层事实 -> 团队摘要 -> 专业团队/企业规划摘要 -> 领导关键简报。
- AI 的价值是持续比较“原计划/承诺”与“当前事实”，只在超期、偏差、风险上升或关键假设失效时生成异常候选和解释。
- 领导只需看到：是否正常、偏差是什么、影响多大、由谁处理、预计何时恢复，以及支撑这些结论的事件依据。
- God View 以净利润为最终 North Star，同时呈现规模、合规、风险、资产质量和效率等 KPI driver / 约束；支持年、半年、季、月、周、日切换，并沿组织与 Case 下钻。
- Agent 可以形成偏差解释、方案比较与 Shadow 推演；领导确认后形成的 Management Action 仍必须关联受影响 Case 或 Case 集合，不得让聊天文本直接改写业务事实。
- 甘特图、时间轴和重点事项只能是融资租赁项目关键里程碑的只读 Projection，不能在 V3 MVP 中扩张成通用 OA、通用项目管理或企业战略执行系统。

## 6. 多项目与 Golden Case

- V2 的单项目演示内核需要在 V3 演进为按 `caseId` 隔离的 Case Repository / Aggregate 集合。
- God View 消费稀疏的 `PortfolioProjection`，不得拉取所有项目的完整 Context Packet。
- Golden Case 只是演示会话的聚焦状态，例如 `focusedCaseId`；不得修改或锁死项目权威状态。
- Gate 14 已将 Golden Case 交易模式锁定为小微直接租赁；存客回租和新客回租只在背景 Case / 扩展接口中保留轻量表达，不制作第二条完整闭环。
- 项目进度、风险等级、模型置信度必须分开表达，不能共用一个百分比。

## 7. 比赛目标受众与得分方向

- Demo 的主要业务边界是小微事业部；集团、租赁公司与总部职能只提供目标、约束、资源、派驻专业责任和组织汇总背景。
- 主要说服对象是融资租赁公司科技管理层；集团科技管理层次之；事业部业务 / 销售管理层也是重要受众。比例只决定讲述重心，不作为统计事实。
- 评分证据同时覆盖：技术性、可落地性、价值性、客户 / 供应商直接触达和场景完整度。
- KPI 目标以管理层确认作为权威；企划负责辅助理解、拆解与跟踪，Leader Agent 无权改写目标或实际值。
- 历史 TQ 的前线 / 中台 / 后台和 12 个角色只作为组织背景与 capability source，不出现在 V3 一级业务主链，也不生成 12 套系统。

## 8. 历史候选资产

- 归档版“登录 -> 项目池 -> 工作台”可借鉴进入节奏、项目卡片和多项目概念：
  `C:\Users\22673\Desktop\Archive\V0.2-display-artifacts-20260820\Compare-Show-static-export\见微-前端展示页.html`
- 旧版硬编码账号、客户端权限、单项目裁剪、旧信审中心叙事和 mock gateway 不得恢复为 V3 权威实现。

## 9. 当前前端控制点

- 可见一级入口为两个汉字：`协同 / 业务 / 风控 / 外联`；`外联` 只是当前可逆 working label，不能据此改变外部权限边界。
- 每个 Role Application 必须同时具有 Case Panel 和所选 Case 的 Role Workbench；点击同一 `caseId` 只切换 Role Projection。
- Golden Case 首屏必须包含当前协同目标、五路并行状态、正式起租共同端点、当前 Owner 与项目群聊。
- 项目群聊必须显示成员、两字席位、人员 / Agent 状态、当前 Thread、最近进展与按权限 `@`；不能退回孤立聊天框。
- 背景 Case 只进入独立只读摘要，禁止复用 Golden Case 的目标、成员、群聊或完整 Evidence 链。

## 10. 已冻结的比赛主路径

- 固定从 `协同` God View 的小微 KPI / 起租偏差进入，下钻唯一 Golden Case `FL-DEMO-001`。
- T1 由业务确认商机与设备融资事实；T2 由外联客户确认会改变判断的风险事实并让信审回退 / 补件；T3 由客户与供应商补强 Evidence，五路基于最新 Context 重跑。
- 专业账号只确认本专业 Gate；协同角色不能代签。商务在 Scenario 所需条件满足后形成正式起租 Action / Receipt。
- 正式起租后返回协同 Projection 展示 Case / Portfolio / KPI 变化，再以 Event / Diff / Gate / Receipt replay 收口。
- 详细宏观契约见 `V3_DEMO_NARRATIVE_CONTRACT.md` 与 `V3_GOLDEN_CASE_SCENARIO_CONTRACT.md`。

## 11. 已冻结的最终验收

- 每项宣传能力同时需要 Browser evidence 与 Backend/Event/Receipt evidence；静态代码、旧截图或局部测试不算完成。
- Golden Case 必须三次连续完成 `reset→T1→T2→T3→Gates→正式起租→replay`。
- Browser 至少覆盖 1920×1080、1366×768 和约 390×844；最终服务必须与记录的 production build、PID、command 和 port 一致。
- 所有 MUST Gate 全部通过后仍需用户完成视觉与业务 fidelity 验收。
- 详细矩阵见 `V3_ACCEPTANCE_MATRIX.md`。

## 12. 新任务工作方式

- 一次只讨论一个会改变整体架构的问题。
- 用户明确确认后才写入冻结稿。
- 不因为前端页面设想而复制后端状态或削弱权限、事件、证据和回执语义。
- 当前授权沿 Gate 1–19 和五份冻结契约开展可逆、contract-scoped 的 Demo 实现；新的重型 Backend、完整专业规则、真实内网接入或生产化能力不在当前授权范围。
