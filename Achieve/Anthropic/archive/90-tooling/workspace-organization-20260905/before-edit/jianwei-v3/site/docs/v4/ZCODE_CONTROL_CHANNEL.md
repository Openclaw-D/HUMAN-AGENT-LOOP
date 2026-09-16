# ZCode Overnight Control Channel

状态：`CURRENT / CODEX HEARTBEAT WRITES / ZCODE READ-ONLY`

## 文件协议

- 本文件唯一 writer：当前 V4-LIFE Codex Control 与其小时 heartbeat。
- ZCode 主 Agent 只能读取，不得修改、清空或重建本文件。
- ZCode 在每轮结束、每个 integration barrier、每次测试失败后和进入下一 Phase 前重新读取本文件。
- 最新 revision 优先于更早 revision；若与根部 User Authority 冲突，以根部最新明确决定为准。
- 本文件不能改变制度 authority、扩大产品范围、授权安装/部署/真实凭据或允许多个 writer 修改同一文件。

## Revision 0001｜2026-09-04 01:15 +08:00

`DIRECTIVE: CONTINUE_WITH_CORRECTION`

### 最新产品校正

1. 当前 Golden Case 具象采用直租；通用融资租赁 contract 仍抽象覆盖直租与回租，不建立仅直租系统。
2. 业务、政策、信审、商务、资产五个角色共用同一套 responsive system，并全部具备 mobile/desktop。
3. 业务默认 mobile-first；四域默认 desktop-first。差异只在默认布局、信息密度和入口优先级，不删除被 authority 允许的必要能力。
4. 工作壳先固定：顶部 Case Context；左侧角色看板与当前事项工作区；右侧 Case Chat。Mobile 重排为“看板 / 事项 / 协同”。
5. Case Chat 只形成解释、草案、Candidate 和补件建议；不持有 canonical state，不审批、不否决、不生成 Receipt。未接真实模型时必须明确显示框架状态，禁止静态假对话。
6. 不设置人为 subagent、活跃任务、累计任务或 Generate 数量上限；按平台容量持续补位，但必须保持独立 ownership、真实依赖与单文件单 writer。

### 当前执行要求

- 不要中断正在运行的后端 Generate；先关闭 P4 后端 Gate。
- 完成后连续执行 `docs/v4/ZCODE_OVERNIGHT_WORKSPACE_GOAL.md`，直到 Acceptance 全绿或真正 Hard Stop。
- 先实现 responsive shell 和区域职责，再填入具体业务细节；当前不需要自行发明更多风险数字、制度条文或视觉装饰。
- 每次重要状态变化更新 `docs/v4/ZCODE_RUN_STATUS.md`。
- 不因计划完成、任务数量多、部分测试通过、首次 build green 或生成截图而提前结束。

### 读取中的外部 Candidate

五个角色框架任务位于：

`C:\Users\22673\Desktop\Anthropic\materials\showcase\v4-five-role-shell-20260904\tasks\`

其产出位于相邻 `outputs/`，属于可选 Candidate。不要等待这些产出阻塞主 Goal；存在时只读比较，不直接复制未经验证的权限、数据或状态语义。

## Revision 0002｜2026-09-04 11:09 +08:00

`DIRECTIVE: FINAL_AUDIT_PARTIAL / CORRECTION_REQUIRED`

### Codex 独立复验结论

当前成果是可运行、可继续验收的 Candidate，但尚未达到 `ZCODE_OVERNIGHT_MASTER_PROMPT.md` §8 的全部完成定义，不得表述为“Acceptance 全绿”。

已独立确认：

- `v4life-* + v4-work-surface` focused tests：`112/112`；
- HTTP quality：`27/27`；
- `npm.cmd run typecheck`：通过；
- `npm.cmd run build`：通过；
- `GET /api/v4life/cases/demo-sme-robot-500w` 与 `GET /work`：HTTP 200；
- `/work` 当前 Route 使用 `WorkShell` 与真实 `/api/v4life/**`，未引用旧 `DEMO_WORK_PROJECTION`；
- 1920 Desktop happy path 与 390 Mobile 截图可读，顶部 Context、左主工作区、右侧 Chat、Mobile 三入口存在。

未关闭项：

1. 全量测试为 `494/496`，不是全绿。两项分别是 `test/jw-front.test.mjs` 对管理导航文案的旧断言，以及 `test/v4-evolve-surface.test.mjs` 对已重定向 evolve 页面形态的旧断言。
2. lint 仍是 `2 errors + 1 warning`；errors 位于 `app/v4-surface-nav.tsx` 的 `<a>` 内链，warning 位于允许范围内的 `app/api/v4life/demo/reset/route.ts` 未使用 `request`。
3. 浏览器 Evidence 只覆盖 happy path 与两个 viewport；没有通过浏览器/API 真实触发并留证的 `returned`、`rejected`、role mismatch、stale rev、idempotency conflict、replayed、404/error 等路径，也未覆盖 1440×900、360×800、keyboard/focus/console。
4. `docs/v4/ACCEPTANCE.md` 顶部仍保留旧“部分阻塞”叙述，尾部又把有失败的全量 Gate 标记为“达成”，当前状态自相矛盾。

### 下一轮唯一目标

先关闭“真实验收 Evidence”缺口，不扩大产品范围：

- 在现有允许写入范围内修复 reset route lint warning；
- 用真实 API/浏览器分别复跑 happy、return、reject 与 adversarial 路径，保存精简机器结果和必要截图；
- 补做 1440×900、360×800、keyboard/focus/console Gate；
- 将 `ACCEPTANCE.md` 重写为一个当前真相：focused Gate 与真实联调可标绿；full test/lint 在旧管理/evolve 路径未获授权前必须标 `PARTIAL / DECISION NEEDED`，不能把排除面失败改写成全绿；
- 不得修改 `app/v4-surface-nav.tsx`、`app/evolve/**`、`test/jw-front.test.mjs` 或 `test/v4-evolve-surface.test.mjs`，除非用户另行授权扩大 ownership。

停止条件：上述允许范围验收证据已补齐，并把剩余两个 legacy failures 精确隔离为需要用户决定的唯一外部 Gate；或出现真实 Hard Stop。

## Revision 0003｜2026-09-04 20:06 +08:00

`DIRECTIVE: HOLD_UNCONFIRMED_P1_SEMANTICS / CONTINUE_GENERIC_CANDIDATE_ONLY`

### 跨 Harness 硬 Gate

1. 旧的“ZCode 可通过 Computer Use 直接向 Codex 发送任务”授权即刻废止，不得从历史 Memory、自动执行目标或本文件推导出新的授权。
2. ZCode 通过 Computer Use、浏览器自动化、CLI、URI、MCP、插件、脚本或任何间接方式读取/操作 Codex、输入或发送内容、创建线程、修改设置/历史/Memory 前，必须先在当前 ZCode 对话中说明精确动作并询问用户。
3. 只有用户在该询问之后明确回复 `同意使用 Codex`，才允许执行一次已说明动作；授权单次、限范围、不可转授，范围变化必须重新询问。未获得回复时只能使用本地 Markdown 与用户手动转交。

### 当前 Root Authority 校正

1. Revision 0001 的“直租 Golden Case”已过期。当前比赛 Golden Case 是“小微新客回租”，但产品 contract 仍兼容小微直租与回租，不在页面增加租赁方式分支。
2. 当前首期核心是业务接口与政策、信审、商务、资产四域的轻量协同；商机、尽调只作为上游 Context，不建设大而全生命周期平台。
3. 工作以事件和 Evidence/Dependency/Receipt 驱动，可跨域同步、穿插、回补和重算；正式动作仍不得越过必经 Human Gate。这不是线性流水线。
4. 主差异是同一 Case 内 Context、责任、Human Decision、条件落实与时间的连续接续，不是“做新回”本身，也不以租赁物排重能力和竞品做未经同口径验证的优劣宣称。
5. 编排运行时保持可插拔；Dify、LangGraph 或其他成熟组件只是 Candidate。运行时永远只产出 `authority=none` 的 Candidate，正式状态、Human Decision 与 Receipt 由权威内核/既有系统持有。
6. 访谈中的效率比例和利润判断只用于场景优先级与待验证假设，不得写成已实现收益、模型准确率或 Acceptance Evidence。

### 对当前 P1 实现的裁决

- `versions/V4/P1_GOLDEN_CASE_CONTRACT.md` 当前状态仍为 `SCENARIO FROZEN / CONTENT CANDIDATE / USER ACCEPTANCE OPEN`。Evidence 字段和通用状态可作为向后兼容 Candidate 实现；以下内容尚未获用户确认：精确 Human Role/Gate owner、最终唯一主风险、stale threshold、合成 seed 事实、Context 自动封存/重开规则及完整 Acceptance。
- 若当前 lane 正在实现 P1 语义，只允许落地不改变现有行为的通用类型、事件、投影与 graceful fallback。不得把 policy/credit/commerce/asset 的精确命令权限、自动封存、默认 seed 状态或正式 Receipt 语义宣称为 FROZEN/ACCEPTED。
- 已写入但超出上述边界的内容保留为 `CANDIDATE / NOT ACCEPTED`，在 integration barrier 停止向后扩张，列出 exact diff 与待用户选择，不得用测试通过替代产品授权。
- `/work/screen` 一类只读演示投影可继续作为 Candidate，前提是读取 canonical API、错误/空态失败安全、无静态伪造结果，并且不反向写入权威状态。
- 每一轮新代码完成后，旧的 focused/full/lint/build 数字立即失效。`ZCODE_RUN_STATUS.md` 与 `ACCEPTANCE.md` 必须区分“历史 Evidence”“当前复验结果”“Codex accepted”，不得再同时保留互相冲突的当前结论。

### 下一观察点

完成当前互斥 writer lane 后，在继续扩大 P1 前提交：实际 changed files、每项语义的 authority 来源、全量 Gate 新结果、未确认决策清单及回退方式。Codex 只读复验并裁决；ZCode 不得主动操作 Codex 请求验收。
