# JW 工作区 Changelog

本文件只记录工作区结构和全局产品文档的实际变化。代码实现变化记录在 `jianwei-v3/site/CHANGELOG.md`。

## 2026-09-05｜稳定主干与 V4-RISK 中观交接

- 在既有 `AGENTS.md`、`NORTH_STAR.md` 和 `DECISIONS.md` 明确：最新讨论输入不自动成为最新决定；纠偏、细化、探索与主干变更分别处理。
- 由既有 P1 候选文件承接探索，修正“唯一产品问题”越过案例边界的表达；新客回租具体风险不再作为换线程前必须接受的新方向。
- `versions/V4/README.md` 记录 V4-RISK 对同一 V4 的承接和中观讨论入口；`CHALLENGE_LOG.md` 增补候选不能覆盖主干的验收约束。
- `ROADMAP.md` 同步 2026-09-04 已有后端验收，继续区分功能通过、产品语义接受和生产就绪；实质对话追加到 `versions/V4/CONTEXT_LOG.md`。
- 本轮未修改实现、未新增并列权威文件，未执行线程归档或创建。

## 2026-09-04｜五角色双端与 Case Chat 框架校正

- 冻结五个角色共同使用同一套 responsive system，全部具备 mobile/desktop；业务默认 mobile-first，四域默认 desktop-first；
- 冻结当前 Golden Case 具象采用直租，但产品 contract 仍抽象覆盖直租与回租；
- 将 `/work` 框架调整为顶部 Case Context、左侧角色看板/事项工作区、右侧 Case Chat；移动端重排为“看板 / 事项 / 协同”；
- Case Chat 只形成解释、草案、Candidate 和补件建议，不直接产生正式 Decision/Receipt，也不成为第二事实源；
- 新增五个互斥的角色框架任务包，供独立同事并行产出 Candidate，不修改正在运行的活动实现。

## 2026-09-04｜撤销整夜并发与任务数量的人为上限

- 按用户最新决定，撤销同时活跃 20、累计 100、Generate/writer 最多 4 等人为数字限制；
- `A01–J10` 保留为首批结构化 backlog，不再作为任务总量或 subagent 调用上限；
- ZCode 主 Agent 应按平台实际容量持续补位，并根据测试、集成和浏览器 Evidence 动态增加后续修复/验证包，直到完整交付或真正 Hard Stop；
- 保留单文件单 writer、共享契约串行冻结、ownership 可验收和禁止重复工作的安全约束。

## 2026-09-04｜ZCode 整夜滚动任务池

- 记录用户对当前 20 路试验的现场观察：运行持续稳定，多数 Explore 已结束，约 2 个较重 Generate 仍在推进；
- 将今晚任务从“一次性并发更多 Agent”改为 100 个依赖化小任务包的 rolling pool，活跃目标 12–20、峰值上限 20、完成即补位；
- Generate/writer 通常维持 2–4 路且最多 4 路，其他槽位用于 Explore/Review/Verify；100 是累计调度上限而非交付指标；
- 在整夜 Goal 中新增分层调度纪律与 `A01–J10` 百包台账，产品范围、authority、ownership 和验收 Gate 不变。

## 2026-09-04｜小微业务移动协同与四域桌面作业整夜 Goal

- 将首期范围进一步冻结为小微融资租赁，不外推汽融、其他事业部或集团通用场景；
- 冻结“1 个业务协同入口 + 政策、信审、商务、资产 4 个专业域”；业务不是第五个风控域；
- 冻结设备分工：业务 mobile-first，四域 desktop-first，四域约 95% 核心作业按桌面设计；
- 授权 ZCode 在当前后端 Goal 本地 Gate 后连续构建 `/work` 前后端 Candidate；
- 新增 `jianwei-v3/site/docs/v4/ZCODE_OVERNIGHT_WORKSPACE_GOAL.md`；管理页、大屏、二维码、部署和真实模型继续排除。

## 2026-09-04｜ZCode 并发从固定四路改为受控实测

- 将“ZCode 固定四并发”修正为按任务独立性和实测容量动态决定；
- 授权当前后端 Goal 做一次目标 20 个同时运行 subagent 的试验；
- 保留最多 4 个互斥 writer，其余 lane 只读，单文件单 writer 与串行整合规则不变；
- 新增 `jianwei-v3/site/docs/v4/ZCODE_CONCURRENCY_TRIAL.md`，记录调度、降档、失败和交付 Evidence；
- 未修改当前后端实现、contract、acceptance、依赖、部署或凭据。

## 2026-09-04｜当前 authority 极简化与旧路径退场

- 将根部 North Star、Decisions、Challenge Log、Roadmap 和入口压缩为当前主干；完整旧全文保存到 `archive/40-v4-life-convergence/20260903-before-minimalization/`；
- `jianwei-v3/` 现在只保留唯一活动仓库 `site/`；旧静态壳与 Unity 候选可恢复地移入 `archive/30-v3-materials/`；
- 将仓库根部旧 V2/V3 README、DECISIONS、ROADMAP、SITE_CONTRACT 与 standalone 页面移到 `site/docs/archive/root-legacy-20260903/`，重建极简活动 README；
- 将旧 `evidence/`、`.glm53-*` 和旧 Z route/review 产物移入明确 archive，不再污染活动根目录；
- 早期 P0 问题稿进入 V4 archive；资产/算力支持稿进入 `materials/research/v4/`；
- 更新 Codex/ZCode 分工：Codex 讨论、任务书和验收，用户复制，ZCode 执行；共享 Markdown，不共享 Context Window，单文件单 writer；
- 未移动 `jianwei-v3/site/`、`.codex-remote-attachments/`，未删除文件，未触碰 ZCode 当前后端 ownership。

## 2026-09-03｜V4-LIFE 权威与工作区归一

- 保留 `C:\Users\22673\Desktop\Anthropic` 作为 Codex 保存项目 `JW` 的唯一桌面入口；未重命名该绑定路径。
- 将桌面历史快照移入 `archive/00-pre-financing-leasing-mvp/`。
- 将桌面 V2Z 隔离实验移入 `archive/10-v2z-experiments/`。
- 将根目录旧 P2、V3、工具夹具分别归入 `archive/20-p2-discovery/`、`archive/30-v3-materials/` 和 `archive/90-tooling/`。
- 将调研、学习、展示与生成输出归入 `materials/`。
- 将 V4-LIFE 的 `NORTH_STAR`、`DECISIONS`、`ROADMAP`、`CHALLENGE_LOG` 提升到工作区根部，作为全局产品文档。
- 将旧 `jianwei-v3/site/docs/v4/` 完整保存在 `jianwei-v3/site/docs/archive/v4-pre-life-20260902/`。
- 新建项目级 `jianwei-v3/site/docs/v4/`，只保存当前实现 `CONTRACT` 与 `ACCEPTANCE`。
- 没有删除材料，没有移动活动 Git 仓库，没有修改 FRONT/BACK。

## 2026-09-03｜Local-first Context 与版本目录

- 新建 `context/README.md`，作为跨版本本地对话索引；
- 新建 `versions/V4/README.md` 与 `CONTEXT_LOG.md`，记录当前版本入口和截至本轮的关键对话；
- 更新工作区 `AGENTS.md`，要求每轮实质对话在本地形成结构化记录；
- 明确未来版本使用独立 `versions/V1/`、`V2/` 等目录，新版本不覆盖旧版本历史。

## 2026-09-03｜P0 大方向审计

- 将当前阶段明确为 P0 产品方向收敛，而不是已进入实现准备；
- 新增 `versions/V4/P0_DIRECTION_QUESTIONS.md`，记录十个 P0 顶层问题和退出 Gate；
- 将 `ROADMAP.md` 阶段命名从 R0–R6 统一为 P0–P6，并修正 Challenge Log 文件名；
- 在 `DECISIONS.md` 冻结“P0 未完成前不进入 P1”；
- 未修改项目代码或项目级实现契约。

## 2026-09-03｜P0 第一轮收敛与问题纠偏

- 将对外第一身份冻结为纯中文“融资租赁业务与风控协同层”，范围限于直租、回租所构成的融资租赁领域；
- 冻结大风控第一控制中心、按依赖并行、确定性规则拦截、概率无 authority、长期贡献一级化及客户/供应商差异化参与；
- 明确 One/IMAX 只是按 ROI 选择的实施底座，不是产品身份或必要依赖；
- 纠正“唯一核心对象”和“单一案例结束 P0”两个错误前提；
- 新建 `versions/V4/P0_PRODUCT_CHARTER.md`，将剩余 P0 决定收敛为七项；
- 未修改项目代码、FRONT/BACK 或项目级实现契约。

## 2026-09-03｜资产闭环与受限算力治理

- 将资产从“生命周期末端孤立域”修正为“独立贷后责任域 + 面向政策/信审的风险反馈域”，未改变四专业域和正式审批顺序；
- 冻结资产巡检、逾期/催收、现场、诉讼/执行、外部律所和客户长期事件记录的顶层边界；
- 冻结多模态原始 Evidence 与三维重建 Candidate 的层级，明确生成结果不能证明现场事实；
- 将内网低代码人工智能编排平台定位为可替换 Capability Plane，不拥有业务 authority、权威状态或 Receipt；
- 冻结有限内网算力的动态 ROI 调度原则，内部拓扑、数量和具体模型清单未被记录；
- 新增 `versions/V4/P0_ASSET_COMPUTE_DIRECTION.md`，只保存脱敏产品约束和公开技术核验；
- 未修改项目代码、FRONT/BACK 或项目级实现契约。

## 2026-09-03｜比赛时间箱与 P0 最终收口准备

- 冻结比赛约两周半、每组约 15 分钟的当前交付时间箱，以及真实 E2E、后端优先和远距大屏可观察原则；
- 将现场四屏、两块主展示、约十米观看距离和约 3 米 × 6 米主屏记录为待实测的设计基线；
- 新增 `versions/V4/COMPETITION_DELIVERY.md`，区分已确认约束、展示架构 Candidate、公开免登录 Demo Sandbox 和后续 venue/API Gate；
- 将 P4 调整为后端核心与真实模型网关，将 P5 调整为响应式前端、联调与部署，P6 保留领导表达与现场彩排；
- 为原七个 P0 开放项形成最终 Control 推荐答案，但在用户整体接受前仍不宣布 P0 完成；
- 核验现有代码只作为模型 adapter 与进程内状态 Candidate；未修改代码、实现契约、凭据、环境变量或部署。

## 2026-09-03｜全生命周期、六角色、单屏与平台边界校正

- 将生命周期补全为融资需求从商机开始，并在资产域经过起租、存续管理后以结清结束；
- 将首期核心角色收窄为客户、业务、政策、信审、商务、资产六方，交易供应商退出首期 Golden Case，仅保留条件扩展；
- 明确融资需求不限定产能扩张，也不按直租/回租切分首期入口；
- 将现场方案从两块主屏分工改为一个 canonical 大屏在四块屏幕镜像，并将扫码网站改为同一 Golden Case 的只读伴随面；
- 更新最新 `3.5 + 3.5 + 3.5` 分钟候选节奏，弱化模型品牌和算力治理展示；
- 重开 P0-E 的成熟平台/最小自研边界核验，不预设 Dify-only 或全自研；
- 用 `SUPERSEDED` 显式保留旧生命周期、供应商参与、双屏和交互扫码决定，未修改任何代码或部署。

## 2026-09-03｜六步表达、依赖式并行与价值假设收敛

- 将对外核心表达收回为严格六步，不再在商机前展开客户主体/融资需求，也不在资产后展开起租至结清；资产内部生命周期继续保留；
- 明确六步是责任域而非全局串行状态，具体 work item 由 Evidence/Receipt 依赖图穿插并行；
- 将“与传统系统有何不同”提升为正式 Challenge：仅有流程图和 AI 摘要不构成产品价值；
- 将首期后端候选收窄为事项、Event、Evidence、WorkItem、Dependency、Candidate、Decision/Receipt 与 Projection；
- 将 Dify 定位为优先 AI 编排能力，成熟平台能满足的页面直接复用，只开发必要的最薄差异化交互面；
- 旧展开式顶层生命周期与长产品身份已标为 `SUPERSEDED`；未修改代码、部署或凭据。

## 2026-09-03｜四域轻量组件与复用优先

- 将首期范围从六步全生命周期进一步收窄为“小微大风控四域轻量协同组件”，核心只保留政策、信审、商务、资产；
- 将商机、尽调、客户与融资需求入口降为既有系统/业务侧提供的上游 Context，不再建设对应模块、页面、角色应用或 Agent 系统；
- 冻结 `REUSE FIRST / NO WHEEL`：成熟身份、权限、正式流程、存储、日志、模型网关、工作流画布和通用页面通过 Gate 时必须复用；
- 冻结 Capability Graph 可编排、Authority Graph 不可拖动，明确任何可视编排不得改变 Human Role、正式权限、必经审批和 Receipt；
- 将“独立 V4 control kernel”从默认方案降为缺口候选，先做平台能力差距表，只补四域领域包、adapter、必要 ledger 或 Projection；
- 将比赛主段改为业务短触发加四域协同闭环，约 5 分钟讲清四域作为分钟 Candidate；
- 旧六角色、六步主叙事与 `3.5 + 3.5 + 3.5` 脚本候选已标为 `SUPERSEDED`；未修改代码、部署、凭据或项目级实现契约。

## 2026-09-04｜P0 产品与能力编排契约冻结

- 将 `versions/V4/P0_PRODUCT_CHARTER.md` 原地升级为唯一 P0 产品与能力编排冻结契约，没有新增第二套 CURRENT contract；
- 将 Dify `1.13.2` 从不可替换平台名称校正为当前内网参考实现，冻结“低成本、可视化、内网可用、可导出、ROI 为正才可替换”的平台抽象；
- 冻结既有系统、V4Life 最薄后端、编排底座与五角色工作面的职责边界；
- 冻结 Case 共享 Context、WorkItem 最小执行、`caseRev` 与 `contextVersion=M.m` 双版本，以及 `OPEN → STABILIZING → SEALED` 输入收集窗口；
- 冻结“轻量总路由 + 四域 Workflow + 共享原子能力”、事件驱动、Human Gate、能力 Registry、无凭据 DSL/manifest 本地导出和失败关闭；
- 四域抽象职责已冻结；Golden Case 唯一主矛盾明确留到 P1，未写入实现或演示内容；
- 未修改活动代码、项目级实现契约、凭据、依赖、部署或运行服务。
