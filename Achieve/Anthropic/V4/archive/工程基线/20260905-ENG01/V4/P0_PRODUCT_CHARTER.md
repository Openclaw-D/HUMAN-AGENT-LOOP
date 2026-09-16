# 见微 V4｜P0 产品与能力编排冻结契约

状态：`P0 FROZEN / RUNTIME INTEGRATION GATE OPEN / P1 GOLDEN CASE SCENARIO SELECTED`

归属：V4。本文件是V4的P0产品与能力编排契约；主干见 [全局NORTH_STAR](../NORTH_STAR.md)，版本详细决定见 [DECISIONS.md](DECISIONS.md)，当前任务许可见 [全局决定](../DECISIONS.md)。实现不得用平台细节、代码便利或演示文案反向改写本契约。

## P0-A｜对象拓扑｜FROZEN

首期只服务小微融资租赁，表达一个业务协同入口与政策、信审、商务、资产四个专业域。业务送入一个经现行受理/尽调流程提交的项目 Context，并负责补件和接收反馈；该 Context 的来源、完整度、时效和核验状态必须显式，不能预设已经真实一致。商机、客户、尽调和融资需求不建设为产品模块。产品抽象覆盖直租与回租，但当前 Golden Case 具象采用小微新客回租，不为租赁方式另建导航或分支系统。四域 WorkItem 按 Evidence/Dependency/Receipt 并行，不建立大而全生命周期状态机，也不外推汽融或其他事业部。

## P0-B｜事实所有权｜FROZEN

- 客户、合同、租赁物、金额、付款、起租等交易事实留在既有权威系统；
- V4 只拥有协同治理事实：引用关系、Evidence 来源、Candidate、WorkItem、Dependency、Human Decision/Receipt、Contribution 与 Event；
- V4 不复制完整客户主档或业务台账，不成为第二事实源。

冻结结论：交易事实留在既有系统；V4Life 最薄后端拥有协同治理事实与 canonical Projection；编排平台只保存能力配置、运行过程和非权威 Candidate。

## P0-C｜责任结构｜FROZEN

- 风控负责人承担组织 sponsor、制度边界和最终组织责任；
- 发起执行团队承担产品 owner、建设运行和风控逻辑控制；
- 业务是协同接口；政策、信审、商务、资产是四个核心专业角色，并保持各自制度责任；
- 业务与四个专业域共同使用一套 responsive system，并全部具备 mobile/desktop 两端；业务默认 mobile-first，四域默认 desktop-first，设备差异只改变布局、密度和入口优先级，不改变 authority；
- 客户不建设直接操作面；产品责任不替代任何流程审批责任。

冻结结论：上述责任结构成立；开发和运维在可视化编排 Studio 完成，五个业务角色不直接进入开发控制台。

## P0-D｜唯一第一价值｜ACCEPTED

让融资租赁风险更早、更完整、可追溯地被发现，并进入正确的 Human Gate，使资金更可能进入真实、合规、可偿付、风险收益可解释的资产；同时帮助客户真实融资问题被正确理解和推进。产品不承诺固定收益。

新客回租是当前首要场景，不是单方利益最大化目标。局部提速只有在没有把补件、等待、风险、解释或兜底责任转移给其他角色，并提升客户、五个内部角色与公司整体净价值时，才构成产品收益。

## P0-E｜能力编排冻结契约｜FROZEN SHAPE / RUNTIME PERMISSION GATE OPEN

形态固定为“可替换 AI 编排运行时 + 小微四域领域包 + 稳定 Adapter + V4Life 最薄权威内核与 Projection”。

`REUSE FIRST / NO WHEEL`：成熟编排能力通过 Gate 后直接复用，但不预先限定低代码、可视化或代码优先形态。Dify、LangGraph 及其他成熟运行时均只是候选；按能力上限、集成适配、稳定性、可观测性、安全、运维、总体成本与 ROI 综合选择，并通过稳定 Adapter 降低更换成本。只为四域领域语义、状态权威、系统适配和真实交互缺口写代码，不建设第二套 CRM、BPM、Agent 平台或通用画布。

### E1｜组件所有权

| 组件 | 唯一职责 | 明确不拥有 |
| --- | --- | --- |
| 既有业务系统 | 客户、合同、租赁物、金额、付款、起租等交易事实 | AI Candidate 与跨域编排状态 |
| V4Life 最薄后端 | Case、Context Version、Input Event、Evidence、Dependency、WorkItem、Human Decision/Receipt、幂等、事件账本与 canonical Projection | 模型推理平台和通用画布 |
| AI 编排运行时 | Workflow/Graph、模型/知识/Tool/MCP 调用、运行日志与结构化 Candidate | 正式业务状态、角色授权、批准/否决与 Receipt |
| V4 工作面/既有入口 | 五角色查看、补件、确认与正式命令入口 | 第二套状态、浏览器端密钥和自行生成 Receipt |

### E2｜最小运行单位与双版本

- 一个 Case 共享同一 Context；最小可执行单位是 WorkItem，不是整案长会话；
- 每个被接受且会改变 Context 的 `InputEvent` 都不可覆盖，并形成一个新的输入版本；
- `caseRev` 随 Case 内全部权威事件递增，用于幂等、乐观并发和事件重放；
- `contextVersion=M.m` 单独表达业务 Context：`M` 是显式封存 checkpoint 的大版本，`m` 是当前开放收集窗口内随 InputEvent 自动递增的小版本；
- 新 Case 从 `1.0` 开始，连续输入形成 `1.1 … 1.n`；封存后 `1.n` 成为不可变快照。后续补件、退回重开或新阶段输入开启 `2.0`，再形成 `2.1 … 2.n`，不得改写 `1.n`；
- Derived Evidence、Workflow Run 和 Candidate 必须引用精确 `contextVersion`，但不能自行改变 Context 版本；Human Decision/Receipt 同时绑定决定时的 `contextVersion` 与 `caseRev`；
- 旧版本 Candidate 可以保留为审计 Evidence，但不得在新版本上静默复用为正式依据。

### E3｜输入收集与推进卡点

每个初始上传或补件批次采用：

```text
OPEN → STABILIZING → SEALED
```

- `OPEN`：接收多个 InputEvent，小版本逐次递增；
- `STABILIZING`：允许去重、病毒/格式检查、字段解析、基础校验和可撤回预分析，为连续上传保留处理空间；
- `SEALED`：形成可被正式 WorkItem 引用的不可变 Context Snapshot，并计算下一批可运行事项；封存只证明版本稳定，不证明其中 Claim 已被核验、材料完整或信息仍然有效；
- 显式“完成本批提交”是主要封存动作；静默等待时长只作为可配置的防抖实现，不写死为业务制度；
- 开放期不得触发不可撤回、高成本或依赖材料完整性的正式动作。低成本预分析可以运行，但只能形成草稿/Candidate。

### E4｜能力拓扑与事件路由

```text
InputEvent / Human Decision / Asset Feedback
                    ↓
              轻量总路由
        ┌───────────┼───────────┐
      政策         信审         商务         资产
        └───────────┼───────────┘
              共享原子能力
     解析 / 检索 / 比对 / 计算 / Tool / MCP
                    ↓
          结构化 Candidate / Error
                    ↓
          V4Life 校验、留痕与 Projection
```

- 总路由读取事件、已封存 Context、Evidence 和 Dependency，只决定哪些 WorkItem 有资格启动、等待、取消或重算；
- 四个领域 Workflow 独立发布、测试、版本化和失败，不互相隐藏写状态；
- 原子能力可被多域复用；能力开发可从任意独立节点开始，但正式运行不得绕过必需依赖；
- Chat 只是可选交互入口，不是主触发器，不拥有 Case 状态。

每次能力运行至少返回：`runId`、`capabilityId/version`、`caseId`、`contextVersion`、`domain`、`workItemId`、`status/error`、`candidate`、`evidenceRefs`、不确定性与 `authority=none`。不满足 schema 的输出进入隔离区，不写正式状态。

### E5｜四域首期抽象职责

| 领域 | 首期唯一抽象职责 | 结构化产出 |
| --- | --- | --- |
| 政策 | 判断制度适用、明确硬规则、灰区和例外候选路径 | 适用口径、命中规则、待确认项与 Evidence 引用 |
| 信审 | 判断事实可信度、偿债逻辑和需要核验的风险矛盾 | 风险 Candidate、核验问题、依据与不确定性 |
| 商务 | 把已确认风险要求映射到合同、付款和起租条件 | 条件 Candidate、缺口清单与待 Human 确认项 |
| 资产 | 核验租赁物可识别性和存续风险，并把贷后表现前向反馈 | 巡检/预警 Candidate、资产 Evidence 与反馈引用 |

本节只冻结职责，不冻结 Golden Case 的唯一主矛盾、具体材料、具体规则或页面文案。

### E6｜Human Gate 与失败关闭

- 人工审批放在真实制度需要的节点；高、中风险必须过人，低风险至少快速人工确认；
- 编排底座的 Human Input 可以暂停、展示、修订和收集动作，但正式 Decision 必须由 V4Life/既有系统重新校验 Actor、Role、Context Version、caseRev 与 Gate 状态后生成 Receipt；
- 平台不可用、模型超时、MCP/Plugin 失败、输出 schema 错误、权限不足或版本过期时，正式状态保持不变；允许重试、排队、转人工或沿现行流程继续；
- 失败不能自动通过、不能覆盖 Evidence、不能伪造 Receipt，也不能阻断现有制度路径。

### E7｜能力登记与准入

每项 Prompt、Knowledge、Workflow、Tool、Plugin、MCP 或模型能力进入能力池前，至少登记：

`capabilityId`、名称、领域、Owner、类型、版本、输入/输出 schema、数据等级、调用权限、依赖、超时/失败语义、成本口径、审计来源、状态和 `authority=none`。

准入状态固定为：

```text
DRAFT → SANDBOXED → APPROVED → ACTIVE → DEPRECATED/REVOKED
```

未经登记和 Sandbox Evidence 的外部能力不得直接读取业务数据或进入正式 Workflow；MCP 是对内网可达服务的连接，不等于复制外部代码进入平台。

### E8｜导出、恢复与替换

- Workflow/Chatflow 必须导出 DSL；Prompt、JSON Schema、测试样例、Plugin/MCP manifest、能力 Registry 与版本说明必须无凭据保存在本地仓库；
- 凭据只进入获授权的服务器端 Secret 配置，禁止写入 DSL、浏览器、Markdown、日志或演示材料；
- 任一编排运行时的内部状态都不是唯一项目记忆；任何正式发布版本必须能够由本地 artifact 识别、复验和恢复；
- 更换底座时迁移 Capability Adapter，不迁移或重定义 Human Authority、正式状态和 Receipt 规则。

### E9｜平台 Gate

平台 Gate 只检查六项：

1. 能否引用可审计权威状态；
2. 能否分开 Human Gate 与 Agent Candidate；
3. 能否绑定 Evidence、Dependency 与 Receipt；
4. 能否让业务接口、四域工作面和镜像大屏读取同一状态；
5. 能否在模型/平台失败时关闭且不污染正式状态；
6. 能否通过 API/配置导出和替换。

当前冻结答案：可替换 AI 编排运行时负责能力，V4Life 最薄后端补齐 canonical state、版本、Evidence/Dependency、Human Gate、Receipt、失败关闭和 Projection。每个候选运行时的权限、API、Tool/MCP/Plugin、人工交互、运行日志与配置导出能力都必须在真实环境逐项验证；源码具备不等于当前环境可用。

## P0-F｜人的贡献与知识｜FROZEN

“贡献被看见”是一级能力：未起租、被退回或被否决的项目，已经形成的专业判断、风险发现、响应和协作不能归零。

“知识复利”只有经过来源、授权、专业审核、版本和适用范围控制后才能复用。首期可只实现贡献保留，不以完整评价模型阻塞交付。

冻结结论：受控知识复利与贡献可见都是一级产品能力；首期实现仍只要求贡献不归零，不以完整评价模型阻塞。

## P0-G｜最小数据原则｜FROZEN

只采集明确工作交互和获授权系统事件；不做环境监听、持续录音、无关行为监控或暗中画像。每类数据必须有用途、来源、可见范围、保留期和删除/归档规则。

冻结结论：上述最小数据原则成立，并约束所有平台、Plugin、MCP、模型和日志。

## P0 Exit Gate｜PRODUCT CONTRACT PASSED

P0 产品与能力编排方向已由用户于 2026-09-04 接受并冻结。以下事项不重开 P0：

1. 当前参考底座的租户权限、真实 API/MCP/Plugin 与导出能力验证，进入 P3/P5 Integration Gate；
2. Golden Case 场景已经选定为小微新客回租；唯一贯穿性主矛盾、exact Evidence、Human Gate Owner 和页面内容继续在 P1 开放；
3. Collection Window 的具体防抖时长、数据库 schema、身份映射和部署参数，进入实现契约；
4. 代码完成仍不等于生产接受、比赛最终接受或用户最终验收。
