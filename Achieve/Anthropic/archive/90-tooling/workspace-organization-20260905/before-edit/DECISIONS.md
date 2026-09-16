# 见微 V4 当前决策

状态：`CURRENT ONLY`

这里只保留会直接约束当前讨论与实现的决定。2026-09-03 以前的完整编号、SUPERSEDED/CANDIDATE 历史保存在 `archive/40-v4-life-convergence/20260903-before-minimalization/DECISIONS.md`。

## FROZEN

| ID | 决定 |
| --- | --- |
| V4L-D002 | 不改变派驻制、逐级报批、岗位责任、审批顺序、关键角色决定权和正式例外路径。 |
| V4L-D006 | Human 是责任与 authority 主体；Agent/模型始终 `authority=none`。 |
| V4L-D008 | 工作按真实依赖非线性并行；正式否决停止依赖性且无必要的后续工作，但不删除既有产出。 |
| V4L-D009 | 风险发现、制度完整、失败关闭和可追溯优先于单纯提速。 |
| V4L-D010 | 正式动作、材料、判断和结果记录来源、Actor、时间、版本和结果。 |
| V4L-D014 | 高、中风险必须过人；低风险允许快速人工确认，但不能静默自动通过。 |
| V4L-D015 | 非标/突破流程只能由有权领导沿正式路径决定；模型只整理、分析和建议。 |
| V4L-D023 | 模型处理、可撤回准备和低成本核验可提前；正式或高成本工作不得越过必需 Gate。 |
| V4L-D024 | 经授权且版本固定的确定性规则可拦截；不确定事项只能形成 Candidate，不能直接批准或否决。 |
| V4L-D026 | 人的专业判断、稳定贡献、响应、学习和知识投入不得被是否起租或项目数量吞没。 |
| V4L-D030 | 内部算力细节是受限信息；文档和演示只使用抽象约束。 |
| V4L-D033 | 政策、信审、商务、资产四域都必须表达清楚，信息共享不能合并岗位责任和决定权。 |
| V4L-D034 | 资产保持独立贷后责任，并将资产表现以前向 Evidence/Candidate 反馈政策与信审。 |
| V4L-D036 | 多模态原始介质属于 Evidence；差异检测、空间重建等只属于 Derived Evidence/Candidate。 |
| V4L-D039 | 比赛不能是静态原型；Golden Case 必须有真实后端状态、API、失败处理和可观察 Projection。 |
| V4L-D048 | 两周半只做 Golden Case 需要的最小规则、Evidence、Candidate、Human Gate 与 Receipt，不伪装全量制度上线。 |
| V4L-D049 | 现场按一个 canonical 大屏画面设计，默认四屏镜像；画面需独立讲清当前风险、Actor、Gate 与 Receipt。 |
| V4L-D050 | 二维码是同一 Golden Case 的只读伴随面，不得提交命令或污染主演示 session。 |
| V4L-D057 | 对外身份是“融资租赁业务与风控协同层”；首期只做“小微大风控四域轻量协同组件”。 |
| V4L-D058 | 商机与尽调只作上游 Context；业务负责输入、补件和接收反馈；客户不建设直接操作面。上游提交是带来源和核验状态的 Claim/Evidence，不因进入系统或封存快照而自动成为已验证事实。 |
| V4L-D059 | `REUSE FIRST / NO WHEEL`：复用成熟身份、权限、流程、存储、日志、模型网关、画布和通用页面，只补四域真实差异。 |
| V4L-D060 | Capability Graph 可重组；Human Role、权限、必经审批、正式顺序和 Receipt 组成的 Authority Graph 不可拖动。 |
| V4L-D061 | 比赛与产品主段只聚焦政策、信审、商务、资产四域真实闭环，业务输入只作短触发。 |
| V4L-D062 | Codex 与 ZCode 共享本地 Markdown，而不是互相依赖 Context Window；任何文件或共享状态同一时间只有一个 writer。 |
| V4L-D063 | 默认由 Codex 与用户讨论并形成任务书，用户复制给 ZCode 执行，完成后由 Codex 独立验收；不再把 ZCode 路由为旧 runner/worker。 |
| V4L-D064 | 契约清晰的中大型后端是 ZCode 的优先执行场景；并发数按任务独立性与实测容量动态决定，但必须先冻结共享接口并隔离 ownership，不能把更多 Agent 等同于更多 writer。 |
| V4L-D065 | 当前四域后端 Goal 已授权 ZCode 执行；该初始授权本身不等于 P0 整体接受或生产部署。后续仅由 V4L-D067 单独追加 `/work` 前端 Candidate 权限。 |
| V4L-D066 | 首轮 20 路 subagent 试验由用户观察为持续稳定；该数字只作为一次运行 Evidence，不构成后续并发上限、默认值或停止条件。 |
| V4L-D067 | 用户授权 ZCode 在当前后端 Goal 自验收通过后连续完成一晚的前后端 Candidate；唯一前端交付是 `/work` 的“1 个业务协同入口 + 政策、信审、商务、资产 4 个专业域”单事项工作台。根 `/` 管理页、领导大屏、二维码伴随面、部署和真实模型接入全部排除。 |
| V4L-D068 | `/work` 必须由同一 V4Life 服务端 Projection 驱动业务补件/反馈及政策、信审、商务、资产四域状态与动作；不得继续使用供应商来源、静态假对话、假在线人数、假 Receipt 或仅信审单点的旧 fixture 叙事。允许真实的 Case Chat，但其输出只能是解释、草案、Candidate 或补件建议。 |
| V4L-D069 | 当前产品与比赛范围只属于小微融资租赁。用户以小微团队、小微项目、小微风控和小微资源拥有天然业务范围与建设权威；不向汽融、其他事业部或集团通用场景外推。 |
| V4L-D070 | 业务、政策、信审、商务、资产五个角色都使用同一套 responsive system，并同时具备 mobile 与 desktop 入口。业务默认 mobile-first，四域默认 desktop-first；两端功能按同一 authority 提供，差别只在默认布局、信息密度和入口优先级。所有角色与设备读取同一 Case Projection。 |
| V4L-D071 | 整夜建设不设置人为 subagent、任务包、活跃数、累计数或 Generate 数量上限。`A01–J10` 只是首批结构化 backlog；主 Agent 应在平台实际容量内尽量并行，完成即补位，并根据新 Evidence 持续生成后续修复/验证包，直到全部 Acceptance Gate 通过或触发真正 Hard Stop。并发扩张仍受真实依赖、单文件单 writer、共享契约串行冻结和禁止重复工作的约束。 |
| V4L-D072 | 产品抽象仍覆盖融资租赁，不在系统层锁死直租或回租；当前唯一比赛 Golden Case 改为“小微新客回租”，因为它是当前小微资源最关注、业务价值优先级最高的场景。通用 contract、类型和导航仍不得改成“仅回租”，入口也不新增租赁方式选择页。 |
| V4L-D073 | `/work` 当前框架固定为：顶部 Case Context Bar；左侧角色看板与当前事项工作区；右侧围绕同一 Case 的智能协同 Chat。移动端将右侧 Chat 收为“协同”页签或抽屉，并与“看板 / 事项”并列；Chat 不拥有 canonical state 或 Human authority。 |
| V4L-D074 | AI 编排运行时不绑定 Dify、LangGraph 或单一品牌，也不限定低代码或代码优先形态。租赁内网 Dify `1.13.2` 只是当前可用候选与验证环境；最终按能力上限、集成适配、稳定性、可观测性、安全、运维、总体成本和 ROI 动态选型，并通过统一 Adapter 保持可替换。继续禁止自研通用 Agent 平台、Workflow 引擎或拖拉拽画布。 |
| V4L-D075 | 能力开发顺序可以碎片化并从任一独立能力切入，但正式运行仍受 Evidence、Dependency、Human Gate 与 Receipt 约束。MCP 以可达 Server 方式连接；通用 `SKILL.md` 不假设可原样导入，须适配为 Prompt/Knowledge/Workflow、Tool Plugin、Custom API 或 MCP Tool。 |
| V4L-D076 | Case 共享一个 Context；每个被接受且会改变 Context 的 Input Event 都形成不可变输入版本。`caseRev` 随全部权威事件递增；`contextVersion=M.m` 单独表达业务 Context，大版本由显式 checkpoint 切换，小版本在开放收集窗口内随输入自动递增。 |
| V4L-D077 | 初始或补件批次必须经过 `OPEN → STABILIZING → SEALED` 收集窗口。开放期允许去重、解析、校验和可撤回预分析；正式、高成本或依赖完整材料的工作只绑定已封存 Context。封存后新增 Context 输入开启下一大版本，不能改写旧快照。 |
| V4L-D078 | 能力拓扑固定为“轻量总路由 + 政策/信审/商务/资产四个领域 Workflow + 共享原子能力”。总路由只计算资格、依赖和分发，不产生正式批准、否决或 Receipt。 |
| V4L-D079 | 每项能力进入能力池前必须登记 Owner、版本、类型、输入输出 schema、数据等级、权限、依赖、超时/失败、成本与 `authority=none`。所有 Workflow DSL、Prompt、schema、Plugin/MCP manifest 和版本说明必须无凭据导出到本地仓库。 |
| V4L-D080 | 可视化编排 Studio 只服务开发与运维；业务、政策、信审、商务、资产使用统一 V4 工作面或既有系统入口。前端、编排平台和运行日志都不是 canonical state，正式状态只由后端校验并投影。 |
| V4L-D081 | P4/P5 的唯一业务协同 canonical implementation 选定为 `lib/v4life/**` + `app/api/v4life/**`，`/work` 只读取其 Projection。旧 `lib/v4/**` + `app/api/v4/**` 不再作为第二套 Case/Work/Receipt 当前后端扩展；其中 authority/capability 模块只可作为待逐项复用的非 canonical Candidate。完成引用与测试迁移并形成可恢复 baseline 前，不删除旧路径。 |
| V4L-D082 | 授权一个独立、窄范围 legacy quality checkpoint：修复 `app/v4-surface-nav.tsx` 的内部导航 lint、`app/api/v4life/demo/reset/route.ts` 的未使用参数 warning，并把 `test/jw-front.test.mjs`、`test/v4-evolve-surface.test.mjs` 更新为当前导航与 `/evolve` compatibility redirect 的真实行为；不得借此恢复旧 evolve 页面、重做管理页或扩大产品范围。全量 test/lint/typecheck/build 全绿后才可关闭该 Gate。 |
| V4L-D083 | 新客回租是首要业务锚点而非排他性产品边界。方案必须综合客户、业务、政策、信审、商务、资产与公司整体利益；局部效率提升不得靠向其他角色转移重复劳动、等待、风险、解释成本或兜底责任实现。 |
| V4L-D084 | 新客回租是共同赛场，不是见微独占的差异化。对手在租赁物确存、确权、排重等单点能力上已有明确表达，未经对比 Evidence 不声称见微更强；成熟排重能力应作为可复用原子能力接入。见微主差异固定为一个 Case 内政策、信审、商务、资产之间的 Evidence、责任、Decision、条件与后续反馈全局协调接续。 |
| V4L-D085 | 保持相对稳定主干与分离探索。最新讨论输入不自动成为最新决定；补充、访谈、假设和案例保留原有证据/探索身份。主干仅随明确用户决定改变，并记录原项、新项、原因、影响和替代关系；已明确授权不重复确认，模糊且影响主干时才澄清。代码与文档向既有主干回归是纠偏，不需重新选择方向。 |
| V4L-D086 | 后续任务使用既定名称 V4-RISK，承接同一 V4，聚焦小微业务与政策、信审、商务、资产的中观职能及交互设计。P0 主干继续生效；新客回租仍为首要案例。具体“缺失、矛盾、过期”等风险只是 P1 待验证案例候选，不能升级为产品唯一问题，也不构成归档/交接前必须接受的新方向。 |

## 当前开放决定

| ID | 阶段 | 需要决定 |
| --- | --- | --- |
| V4L-O011 | P1/P3 | 当前参考编排底座、既有业务系统和 V4Life 最薄后端之间的 exact schema、身份映射、正式状态写入、失败与审计接口如何落地。 |
| V4L-O001 | P1 | 如何定义“风险发现增强”的最小可验证证据。 |
| V4L-O003 | P1 | 如何把依赖分为可提前、可撤回、必须等待。 |
| V4L-O004 | P1 | 现行制度中负责核验外部输入的确定 Human Role 是谁。 |
| V4L-O005 | P1/P3 | 确定性规则、传统模型和生成式模型各自允许到达什么动作边界。 |
| V4L-O006 | P1/P3 | 非标例外需要哪些领导层级、材料、记录和回退语义。 |
| V4L-O014 | P1 | 四域分别共享什么事实、提供什么 Candidate、保留什么 Human Gate。 |
| V4L-O023 | P1/P6 | Golden Case 是否获准使用真实企业名称；否则使用仿真名称。 |
| V4L-O024 | P1 | 新客回租 Golden Case 中只选择哪 1–2 个贯穿性风险矛盾；候选为关键主体/关系披露不完整、经营数据钩稽异常、租赁物权属与公允性或批复后信息变化，不得全部堆入一个案例。 |
| V4L-O025 | P1 | 既有“十问 + 材料包”进入 V4 后，哪些字段属于 Claim、哪些可由系统核验、哪些必须由 Human 确认，以及最小完整度如何定义。 |
| V4L-O026 | P1 | 访前准备状态由哪个现有 Human Role 确认；系统只能给出 `READY_CANDIDATE / NEED_MORE_EVIDENCE / STOP_CANDIDATE`，不得新造审批权。 |
| V4L-O027 | P1/P3 | 批复至起租之间哪些事件触发 Context 过期与差异复核，复核由谁负责，并如何沿现有流程形成 Receipt。 |
| V4L-O028 | P1/P3 | 首期可合法、稳定接入的内部与外部数据源、授权条件、更新时间、失败语义和不可用降级路径是什么。 |

较晚阶段的数据科学、算力、比赛场地、模型 endpoint 和 Demo Sandbox 问题保留在历史账本及 `ROADMAP.md`，不注入当前冷启动 Context。
