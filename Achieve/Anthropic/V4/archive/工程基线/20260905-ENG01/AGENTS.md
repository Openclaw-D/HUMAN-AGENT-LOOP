# JW 工作区执行约束

## 权威与范围

1. 当前用户最新明确决定；
2. `DECISIONS.md` 中当前生效版本与执行边界；
3. `NORTH_STAR.md` 当前产品主干；
4. 当前版本 `DECISIONS.md`、宪章及对应挑战/路线；
5. `jianwei-v3/site/docs/v4/CONTRACT.md` 与 `ACCEPTANCE.md`；
6. 实现、材料和归档。

唯一活动代码仓库是 `jianwei-v3/site/`。`materials/` 只提供 Evidence；`archive/` 只作恢复；`.codex-remote-attachments/` 不移动、不整理。

## 全局与版本归属

- 当前生效版本由根部 `DECISIONS.md` 唯一指定，目前为 V4；“全局”只指 Anthropic 项目，不等于平台 Memory。
- 根部 README、NORTH_STAR、DECISIONS、ROADMAP、CHALLENGE_LOG、AGENTS、CHANGELOG 分别负责导航、当前主干、治理决定、当前顺序、全局风险、执行规则、已发生变更。
- V4 的具体决定、契约、候选、讨论、阶段状态和验收入口进入 `V4/`。`jianwei-v3/site/docs/v4/` 是明确登记的 V4 专属工程映射，不是第二套全局权威；代码原路径不因整理改变。
- 日常只写当前版本范围及当前任务明确涉及的全局文件。历史 V1/V2/V3、Unity、历史代码与 archive 不回写；经用户授权整理时仅可移动归类和新增导航，保留历史产物原文。
- 更新当前主干时记录版本、来源和替代关系。未来用户明确切换版本并接受决定后才更新全局；仅新建文件夹、开始探索或版本号增大不构成权威切换。
- 版本切换前保存旧版文档、相关全局状态和代码/非Git数据的可恢复基线。文件快照不等于 Git commit/tag；未经对应授权不提交或打标签。

## 当前执行方式：手动单任务

- 本轮只执行 `V4/CURRENT_CHECKPOINT.md` 的当前任务，交付后停下等待用户验收，不自动推进下一步；旧检查点的产出保留，不反向改变其范围。
- 旧整夜 Goal、heartbeat、自动补位或并发任务书均是历史许可，不可沿用。本轮不派 ZCode、不改代码、不进入新版本、不新增自动化。
- 框架、候选细节与产品接受分开。访谈/推断先留候选，由用户纠偏；不擅自扩展具体业务功能。
- 前端不提前工程化。未来单独授权框架预览时仅做无颜色装饰的低保真线框；本轮不制作。

## 稳定主干与分离探索

- “最新明确决定”不等于“最新讨论输入”。补充事实、访谈、举例、疑问、设想和局部偏好先按其原意记录，不能自动改写 `NORTH_STAR.md` 或晋升为 `FROZEN`。
- 对照已接受主干：将实现/文档恢复到主干属于纠偏；在既定范围内补充细节属于细化；提出替代方向属于探索；改变用户、范围、第一价值、职责/权限或核心交付边界才属于主干变更。
- 明确的用户变更指令可直接按授权落实，不要求特殊口令或重复确认；记录“原决定 → 新决定、原因、影响范围与被替代项”。若只有探索性表达且影响主干，展示具体差异并只澄清必要的一点，等待期间继续不依赖该变更的工作。
- 探索方案留在对应版本的 Candidate 文档；当前 P1 探索入口是 `V4/P1_GOLDEN_CASE_CONTRACT.md`，开放选择索引是 `V4/DECISIONS.md`，过程解释是 `V4/CONTEXT_LOG.md`。不得另建第二套 North Star，也不得让一次案例、演示文案或竞品比较反向定义产品。
- 用户未反对、重复提及、模型推荐、代码已实现或测试通过，均不自动构成产品决定被接受。新证据可以挑战主干，但须把证据与拟变更项讲清楚，不能悄悄覆盖。
- 留在当前 V4，后续仅经用户授权细化四个风控职能及其与业务的交互；不把某个演示风险提升为产品唯一问题。

## Durable Local Context

- 不把 Context Window、线程摘要或隐藏 Harness 状态当长期项目记忆；
- 每轮实质对话追加 `V4/CONTEXT_LOG.md`，但冻结结论必须进入对应 authority 文件；
- 当前文件只保留当前真相；旧全文进入 `archive/`，不得在活动路径同时保留第二套“CURRENT”；
- 版本按根部 `Vn/` 分目录，旧版本保留而不覆盖；当前只使用 V4，不创建下一版。

## Codex 与 ZCode

- 默认流程：Codex 讨论和写冻结任务书 → 用户复制给 ZCode → ZCode 执行 → 用户交回或 Codex读取本地结果 → Codex独立验收；
- 除非用户当次明确要求，Codex 不代替用户操作 ZCode 窗口，也不把 ZCode 改走旧 GLM runner；
- ZCode 默认不得通过 Computer Use、浏览器自动化、CLI、URI、MCP、插件、脚本或任何间接方式操作 Codex、向 Codex 发消息/任务、创建线程或修改 Codex 的设置、历史与 Memory。每次例外必须先在当前 ZCode 对话中口头询问精确动作，并在用户明确回复 `同意使用 Codex` 后方可执行；授权单次、限范围、不可转授，历史授权与宽泛自动执行授权均无效；
- ZCode 可承接边界清楚、契约稳定的中大型后端、测试、重构和常规前端，并在自身 Harness 内并发；
- 每个任务必须写清 objective、allowed writes、forbidden scope、interfaces、DoD、evidence 和 stop condition；
- Codex、ZCode 及其 lane 之间实行单文件单 writer；共享 schema、contract、migration、lockfile 和 runtime state 串行修改；
- ZCode 工作期间，Codex 不触碰其 ownership。最终以 diff 和可复现验证为准，不以 Agent 自报完成为准。

## V4 不变量

- 首期是“小微大风控四域轻量协同组件”，核心仅为政策、信审、商务、资产；商机与尽调只是上游 Context；
- 不改变派驻制、逐级报批、岗位责任、必经审批、否决/退回和例外报批；
- Human 是责任与 authority 主体；Agent/模型始终 `authority=none`；
- 工作按 Evidence/Dependency/Receipt 依赖并行，不能越过正式前序；
- 风险发现、制度完整、失败关闭和可追溯优先于速度；
- `REUSE FIRST / NO WHEEL`：成熟身份、权限、流程、存储、日志、模型网关和编排能力满足 Gate 就复用；
- 只使用合成、去标识或公开资料；不记录内部算力细节、真实客户数据、制度全文或凭据。

## 完成 Gate

代码变更必须按风险运行测试、typecheck、lint、build、API/浏览器 Gate；文档只能声明真实能力。未经授权不安装、部署、commit、push、改生产配置或调用真实业务 API。
