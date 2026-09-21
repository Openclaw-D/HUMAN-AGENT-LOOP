# V0.4 四路后端测试与微调

2026-09-21：用户明确授权这四项中等规模 ZCode 任务并行。该例外仅覆盖本包，不授权 Codex subagent、其他任务并发或共享运行环境变更。由用户手动转交；尚未派发或运行。

四路各完成一个模块闭环：现状核验 → 必要小修/最小增量 → 回归 → 交付。前端由 Codex 保留。任务之间不等待实现、不导入彼此未交付的新代码；新增跨模块能力使用明确接口替身测试，最后串行集成，不能自报已装配。

## 01 上传授权读投影与权限一致性

```text
/goal 在 C:/Users/22673/Desktop/JW 完成上传授权只读投影与现有上传写门的一致性闭环，适度微调，不重写权限系统。
输入：根 AGENTS.md、docs/V0.4_KANBAN.md、Back/CONTRACT.md、docs/v0.3/backend-qa-r2/results/auth-upload/REPORT.md、Back/Edge/src/upload-context.mjs，以及 Back/A/src/domain/credit.ts、v2kit.ts、Back/A/src/http/server.ts。历史报告只作线索，先核验当前实现。
ownership：仅 Back/A/src/domain/upload-authorization.ts（可新建）、Back/A/src/domain/credit.ts、Back/A/src/http/server.ts；新测试统一 Back/A/test/v04-upload-*；报告 docs/v0.4/results/01-upload/。不修改其他源码、共享CONTRACT或迁移文件。
目标：从现有可信身份与客户访问/上传写门派生零写读投影，明确 principalId/customerId/tenantId/canRead/canUpload 及已有种类限制；不以 checkCustomer 或自建角色表替代正式上传授权。契约先写本路 CONTRACT.md，新增只读入口须兼容现有 API；权限来源不足则明确失败关闭，不造租户或放宽授权。GET不新建邀请、不续期、不登记材料。与实际 registerArtifact 写门做同一组正反例对照。
测试：本人授权、非人类身份、无会话、跨客户/租户、撤权、过期、伪造principal、上游异常；读前后数据库/审计零变化；权限拒绝后写入零发生。能用真实隔离PG验证的不得用替身冒充；环境缺失单列未测。
依赖与排除：本路不依赖其他三路，不改 Edge/Connectors，不装配上传恢复整链，不扩大对象存储事务或数据库schema。遇到需要额外writer文件，记录最小补丁建议后停止该部分。
交付：源码、可重复测试、CONTRACT.md、REPORT.md（命令/退出码/通过失败跳过/源码hash/遗留），说明哪些是真实PG、哪些是替身。验收为权限读写一致且读零副作用；不宣称上传恢复已完成。
共同纪律：遵守本文件末尾的并行执行纪律。
```

## 02 指定材料范围与证据完整性

```text
/goal 在 C:/Users/22673/Desktop/JW 完成指定单件/组合材料分析的证据选择模块、测试与有限修复，不扩展模型编排。
输入：根 AGENTS.md、docs/V0.4_KANBAN.md、Back/Edge/src/assistant-evidence-provider.mjs、assistant-evidence.mjs、Back/Connectors/src/processing/assistant-evidence.mjs、现有 assistant-evidence 测试及 docs/v0.3/backend-qa-r2/results/evidence-chain/REPORT.md。
ownership：仅 Back/Edge/src/assistant-evidence-provider.mjs、assistant-evidence.mjs，可新增 Back/Edge/src/assistant-evidence-scope.mjs；新测试 Back/Edge/test/v04-evidence-*；报告 docs/v0.4/results/02-evidence/。Connectors及其他Edge文件只读。
目标：先写本路 CONTRACT.md，提供兼容旧调用的显式材料选择接口。省略scope保留旧语义；显式指定 artifactIds 时必须非空、去重、全部属于当前已授权客户可读材料，任一无效/过期/越权ID则整次拒绝，绝不能默默回退全部材料。仅请求所选材料；响应材料也逐项校验，不仅相信上游。选择范围标准化并返回可用于回执绑定的稳定摘要；不能宣称尚未接线的缓存已隔离。
测试：单件、组合、全量旧调用、乱序/重复ID、空选择、部分非法、跨客户/租户、材料取代、上游多返、解析失败、上下文截断。验证未选材料不会进入请求正文/模型上下文；引用hash/定位/遗漏原因仍可追溯。使用已有合成材料和本地HTTP替身，不发送真实模型。
依赖与排除：独立测试，不改 assistant-model、assistant-receipts、server、B transport、Front。模型请求入口和回执摘要接线列为待串行集成，禁止悄悄扩大写范围。
交付：模块与测试、CONTRACT.md、REPORT.md、集成调用示例；记录源码hash、命令、失败/未测。验收为显式范围不扩大、越权失败关闭、旧调用兼容；不声称用户页面已支持组合分析。
共同纪律：遵守本文件末尾的并行执行纪律。
```

## 03 模型回执、未知围栏与用量对账

```text
/goal 在 C:/Users/22673/Desktop/JW 完成模型回执/未知防重发专项回归、历史用量对账及已证实缺陷的局部修复。
输入：根 AGENTS.md、docs/V0.4_KANBAN.md、docs/v0.3/real-api-qa/REPORT.md、JUDGMENTS.md、docs/v0.3/backend-qa-r2/results/model-api/REPORT.md；只读核验 assistant-model.mjs 的operationId与scope语义。
ownership：仅 Back/Edge/src/assistant-receipts.mjs、Back/B/src/transport/glm.mjs；新测试 Back/Edge/test/v04-receipts-* 和 Back/B/test/v04-transport-*；报告 docs/v0.4/results/03-receipts/。不改 assistant-model、证据模块、共享配置、原账本和历史报告。
目标：逐requestId对账已记录的出站/usage/未知/重放，解释“28次出站”“27次usage”等口径；证据不足明确无法确认，不猜费用。用本地可计数HTTP替身验证同请求重放、载荷变化、同operation不同request、未知后重启、新operation及不同principal/customer/scope。先按现行契约区分合法新作用域与绕过未知围栏，不擅自规定所有未知全局封锁或所有新operation都放行。
测试：并发重复、进程重启、发送前失败、发送后断连/超时、回执损坏、账本预占/结算、旧结果当前性；每例断言真实替身出站次数，不只看HTTP返回码。针对允许文件内有明确证据的缺陷做小修并复跑相关回归。其他模块缺陷交最小复现，不跨文件抢写。
依赖与排除：不依赖另三路的新代码；不跑真实GLM、不读取或输出凭据、不覆盖/删除历史运行账本，不重置预算，不自动重发历史未知请求。
交付：对账表（来源与缺失分开）、可重复回归、REPORT.md（修复与未修复、hash、命令、计数、资源清单）。验收为既有语义内未知不重复出站、授权作用域不串结果、账本与真实替身计数可核对；替身不能称真实模型质量测试。
共同纪律：遵守本文件末尾的并行执行纪律。
```

## 04 统一事件读接口与跨页同步基础

```text
/goal 在 C:/Users/22673/Desktop/JW 完成供四页与聊天共用的最小事件读接口及真实HTTP测试，局部补齐身份/服务端时间/状态来源。
输入：根 AGENTS.md、docs/V0.4_KANBAN.md；Back/Edge/src/server.mjs、kernel-store.mjs、messages.mjs、message-store.mjs；现有events-page/messages接口及测试。消息、业务事件、模型回执必须分别识别来源。
ownership：仅 Back/Edge/src/server.mjs 与可新建 Back/Edge/src/customer-activity.mjs；新测试 Back/Edge/test/v04-activity-*；报告 docs/v0.4/results/04-activity/。其他源码只读，server.mjs由本路独占，不替其他任务装配。
目标：先盘点现有持久来源并写本路 CONTRACT.md，尽量复用读取接口。必要时增加兼容只读聚合入口；返回来源eventId/记录ID、customer、服务端原始时间、可信actor、事件类型、请求关联和依据引用。无时间/身份明示null/unknown；不得用当前时间或当前会话人填补历史。请求/处理中/完成/失败/未知分别保留，不能由提问推导成功。无可授权持久来源的模型消息明确未覆盖，不伪造统一流。
分页与权限：按各来源真实服务端游标/版本排序，跨来源没有全局序列就定义稳定复合游标并保留各源顺序，不假称总序；eventId去重要带来源命名空间。保留tenant/customer/受众隔离，客户联系人不得读内部消息；每次读取重验权限，包括后续页和失效会话。
测试：真实本地HTTP下分页/重复投递/相同时间/晚到事件/刷新/游标非法或过期/缺失身份时间/请求与回执分离/跨客户和租户/内部受众/读取中撤权；GET前后零业务写入且模型、上传、审批调用为零。可替身上游，但明确替身边界，不声称真实持久数据库整链通过。
依赖与排除：不等待其他三路，不修改其模块，不改Front、写模型回执或新建数据库；不实施未来路径预测、贝叶斯概率或全局事件总线。共享运行实例不重启；新接口只在隔离测试实例装配。
交付：最小契约、兼容实现、HTTP回归、REPORT.md和前端消费示例。验收为同一事件稳定身份/时间/ID、权限不泄漏、分页可续读、未知不伪装成功；列明未接入事件类别。
共同纪律：遵守本文件末尾的并行执行纪律。
```

## 四路共同并行执行纪律（随每份prompt一并转交）

- 用户仅授权上述四路并行；你不独占仓库，不回退他人修改。严格按ownership，每文件一个writer。共享入口、依赖清单、根文档、Front、Back/CONTRACT.md、配置、迁移均不得越权修改；新增依赖或核心方案变化先报告。
- 直接使用 C:/Users/22673/Desktop/JW；禁止worktree、切分支、commit/push、发布。保留当前指定模型，默认low；不自行提升medium/high。Codex内部subagent始终禁止。
- 每路自有隔离实例、随机空闲端口、自有临时库/目录；运行目录放 .local/v04-01 至 .local/v04-04 对应目录。不得重启共享服务、抢端口、改共享.env、复用正在写的账本。只清理有登记且本路创建的资源。
- 开始与结束记录本路输入源码hash和精确文件清单；其他路并行导致共享依赖变化时只复验受影响测试，记录版本，不做全仓回滚或反复全量测试。
- 使用合成数据、本地替身与隔离PG；真实GLM批测留待后续串行五例核准执行，历史未知不重发。报告不含凭据、客户私密数据或完整敏感日志。
- 必须完成必要修复和对应回归；不能删除失败测试、降低权限断言、把skip当pass。若超出模块边界/需要新政策或重复卡住，交付复现、证据与最小集成建议，停止该部分。
- 各路完成后停止本路后台测试，交回改动/测试/遗留和资源状态。四路都交回后再由Codex独立验收、安排串行跨模块装配；模块通过、集成通过、页面验收分开。
