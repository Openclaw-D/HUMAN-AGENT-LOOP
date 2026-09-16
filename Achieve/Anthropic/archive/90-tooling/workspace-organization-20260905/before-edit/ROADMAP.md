# 见微 V4 Roadmap

状态：`P0 FROZEN / V4-RISK MESO DESIGN NEXT / P1 CONTENT CANDIDATE / P4 FUNCTIONAL CANDIDATE ACCEPTED / P5 E2E PARTIAL`

## 当前路径

```text
P0 产品宪章与平台边界 ──┐
                         ├─> P5 前端、联调、部署 ─> P6 比赛包装
P3 实现契约 ─> P4 后端 ─┘
       ↑              
   P1 Golden Case / P2 最小贡献语义
```

ZCode 已按分段授权交付四域后端与 `/work` 工作面 Candidate；后续授权的只读大屏 Candidate 也已存在。当前实现边界与 2026-09-04 独立验收见 `jianwei-v3/site/docs/v4/ACCEPTANCE.md`；历史授权和测试通过均不自动开放新范围。

下一讨论任务为 V4-RISK：在已冻结 P0 内完成中观职能设计，先把政策、信审、商务、资产各自的输入、专业工作、AI 辅助、Human 判断、产出，以及与业务/其他域的接续关系讲清楚。具体风险与案例留在 P1 候选中验证；案例不能重定义产品，也不作为换线程前必须接受的新方向。

## P0｜产品与能力编排边界｜FROZEN

Owner：用户 + Codex。

冻结结果只保留在 `versions/V4/P0_PRODUCT_CHARTER.md`：交易事实与协同治理事实分离；AI 编排运行时可插拔并按综合成本收益动态选型；Case/Context 采用事件驱动大小版本；拓扑为轻量总路由、四域 Workflow 与共享原子能力；Human Gate、能力登记、本地导出和失败关闭均已冻结。Dify、LangGraph 或其他候选运行时的真实接入属于 P3/P5 实现 Gate，不重开 P0。

## P1｜新客回租 Golden Case｜SCENARIO FROZEN / CONTENT NEXT

Owner：用户 + Codex；冻结后交 ZCode 落实。

场景已经由用户冻结为“小微新客回租”：它是当前小微资源最关注、业务价值优先级最高的首要锚点和唯一比赛 Golden Case，但不是产品排他性边界。产品 contract 仍抽象覆盖直租与回租，页面不增加方式选择分支。专家访谈把第一问题进一步收敛为访前资料准确性、主体/关系完整性、数据一致性与风险透明度不足，造成无效访厂、反复补件和关键风险后置暴露。

竞争定位已经校正：新客回租是共同赛场，对手在租赁物确存/确权/排重单点上已有明确优势表达；见微不以重复建设排重为主差异。P1 必须证明同一风险在政策、信审、商务、资产之间的全局协调接续，即 Evidence、Owner、Human Gate、条件落实、起租前变化与资产反馈不断链。

当前候选验证方案为 `P1-01 访前 Context Integrity + 风险接续垂直切片`：从既有“十问 + 材料包”合成输入开始，区分 Claim 与 Verified Evidence，选择 1 个贯穿性风险矛盾，形成政策/信审/商务/资产不同 Candidate；由现有 Human Role 确认访前准备状态，并把该决定继续映射为商务/起租条件和批复后差异复核。该具体方案尚未被接受，不覆盖上面的中观讨论顺序；不得先建设全量数据接入、人员评分、复杂三维现场重建、自动批核或自研排重引擎。

完成条件：接受 `versions/V4/P1_GOLDEN_CASE_CONTRACT.md`，冻结 exact 合成事实、最小 Evidence、Human Gate Owner、跨域接续图、页面证据与可复算 ROI 指标；同时完成多方利益账，证明效率没有通过跨角色转嫁成本或风险形成。主演示必须让观众在同一画面回答“当前风险是什么、谁接手、依据什么、改变了哪个 Gate/条件、下一次何时复核”。随后再交 ZCode 替换当前通用/直租 seed 并实施。

## P2｜贡献与知识语义｜DEFERRED MINIMUM

Owner：用户 + Codex。

首期只证明未起租/被否决项目的专业贡献不会归零；完整评价模型、个人信任分和知识复利机制不阻塞比赛后端。

## P3｜项目实现契约｜BASE CONTRACT ALIGNED / P1 INTERFACES OPEN

Owner：ZCode；Codex 交付后复核。

初始执行书：`jianwei-v3/site/docs/v4/ZCODE_BACKEND_GOAL.md`。2026-09-04 P1-BE-01 后，`docs/v4/CONTRACT.md` §15/§16 已对账 D076–D080：Context 版本、InputEvent、收集窗口机制已作为 Candidate 实现，未确认角色与初始化语义默认隔离。核验/窗口命令的 HTTP 接入、能力登记及真实运行时适配仍开放；当前机器人企业/设备采购合成 seed 仍不构成新客回租内容权威，须在 P1 内容接受后替换。

## P4｜四域后端垂直切片｜FUNCTIONAL CANDIDATE ACCEPTED / PRODUCTION NOT READY

Owner：ZCode 已交付本轮 checkpoint；Codex 已独立复验，后续工程按明确任务推进。

完成条件：领域、Store/重放、HTTP/API、对抗验收四路整合；test、typecheck、lint、build 全绿；未实现的生产数据库、认证、真实模型和 Adapter 被诚实标注。

以 2026-09-04 22:00 Codex 独立验收记录为准：P1 focused `31/31`、全量 `574/574`、HTTP quality `27/27`，typecheck/lint/build 全绿，localhost API、`/work`、`/work/screen` 均为 200。durable command journal、默认 Candidate 隔离及故障注入已经完成；文件 event log 与 journal 仍非原子事务，跨重启故障恢复并不保证返回原 accepted response。裁决是后端功能 Candidate 接受，P1 产品语义仍待确认、生产未就绪。这里同步既有验收记录，2026-09-05 文档修订未重复运行代码测试。

并发试验：用户现场观察到首轮 20 路 subagent 持续稳定，多数 Explore 已较快结束、约 2 个 Generate 仍在处理较重实现。20 只保留为一次运行 Evidence；后续不再设置人为活跃数、累计数或 Generate 数量上限，由 ZCode 主 Agent 按平台实际容量、依赖和 ownership 尽量并行。

交付后清理 Gate：唯一 canonical 已裁决为 `lib/v4life/**` + `app/api/v4life/**`。旧 `lib/v4/**` 的 case-state/read/work 路径与 `app/api/v4/**` 只作 legacy compatibility；authority/capability 模块逐项判断是否复用到非 canonical control plane。完成详细差异表、消费者与测试迁移、可恢复 baseline 前不删除旧路径。

## P5｜小微业务移动协同 + 四域桌面作业｜FUNCTIONAL CANDIDATE / E2E PARTIAL

Owner：ZCode 已交付 Candidate；Codex 复核与纠偏。

初始执行书：`jianwei-v3/site/docs/v4/ZCODE_OVERNIGHT_WORKSPACE_GOAL.md`。`/work` 已改为同一 V4Life Projection 驱动的五角色 responsive Candidate，已有 1920 desktop happy path 与 390 mobile Evidence；后续获授权的 `/work/screen` 只读镜像 Candidate 已实现并通过 HTTP 可达检查。return/reject/adversarial 的浏览器完整留证、1440×900、360×800、keyboard/focus/console Gate 尚未闭合，P1 核验/窗口命令也尚无完整操作面。根 `/` 管理页、观众二维码、部署域名、真实认证和真实模型接入不由本轮文档修订授权。

整夜调度采用持续补位的 adaptive rolling pool。`A01–J10` 是首批 100 个依赖化任务包而非上限；完成即补位，发现新缺陷即生成新的修复/验证包，直到 Acceptance 全绿。并发不设人为数字上限，但每个活跃 Agent 必须有独立、可验收的 ownership；同一文件只有一个 writer，共享 contract/schema/API shape 仍由主 Agent 串行冻结和整合，不为增加并发制造重复工作。

## P6｜比赛包装｜PENDING

Owner：用户 + Codex。

从已验证系统生成 PPT、约 10–13 分钟内容和容错脚本；约 5 分钟讲清四域闭环。演示表达不能反向改写产品 truth。

## 停止条件

需要新增依赖、选择生产数据库/平台、接真实凭据、改变 authority、扩展首期范围或产生跨 Agent ownership 冲突时，停止执行并由用户决定。
