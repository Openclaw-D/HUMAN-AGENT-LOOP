# 见微 · 人机协同平台

> **当前产品权威**：工作区根部 `../../NORTH_STAR.md`、`../../DECISIONS.md`、`../../CHALLENGE_LOG.md` 与 `../../ROADMAP.md`。本 README 主要记录既有实现和历史能力；冲突时不得覆盖 V4-LIFE。当前项目级实现契约见 `docs/v4/CONTRACT.md`，验收 Gate 见 `docs/v4/ACCEPTANCE.md`。

> 面向融资租赁业务的一条事项连续协同链：让同一份事实、上下文、人工决定与外部回执，在业务、政策、信审、商务、资产之间持续流动。

> **Archive boundary（归档边界）**：本仓库的 `v3.0.0-archive` tag 是 V3 的诚实历史快照。V3 代码、测试和当时的冻结契约被保留用于恢复、比较与复盘；V4 使用独立 contract，不把 V3 的五路并行、固定 Golden Case 或旧信息架构继续视为当前产品权威。详见 [V3_ARCHIVE_MANIFEST.md](./docs/v3-archive/V3_ARCHIVE_MANIFEST.md)。

当前仓库已完成 **V3 Gate 1–19 Direction、D1 Control contract 与 P2 本地集成闭环**。九个正式入口复用一套 shared surface family；商机、见微洞察和五个专业工作台读取同一个本地 SQLite Context/Message/Receipt runtime。消息与 Agent reply 永远是 `authority=none`；具名政策、信审、商务、资产人员可通过 RBAC（基于角色的访问控制）记录正式 Human Gate Authority Event 与 Receipt，业务/JW 角色不能调用。目标日为 **2026-09-21**。它用于验证产品语义、工作台交互和受控后端闭环；它不是集团内网系统、生产信贷系统或已经接入真实数据的商业产品。

## 当前状态

| 维度 | 当前口径 |
| --- | --- |
| 产品范围 | 只讨论融资租赁，不扩展到银行、保险、信托或全牌照 |
| 唯一事项类型 | `FinancingLeasingCase`；`FL-DEMO-001` 为唯一完整 Golden Case，另有 4 个独立只读背景 Case 摘要 |
| 组织主线 | 商机、政策、信审、商务、资产共享同一 Case Context 并行更新；大风控包含政策、信审、商务、资产 |
| 演示重点 | 商机与信审同等重要；当前信审内容成熟度更高，但产品层级不高于商机 |
| 数据 | 只使用合成、去标识和公开材料 |
| 模型 | 未配置产品凭据时使用“本地候选推理”；模型始终 `authority=none` |
| 后端状态 | V3 shared runtime 已使用本地 SQLite 持久化 Context、消息、候选回复、Receipt、Authority Event 与幂等记录；具名专业 Human Gate 有 RBAC、同键重放与同键异载荷冲突。仍无登录、生产身份源、外部系统适配器或生产数据库 |
| 部署 | Vinext/Sites build 已通过；本地 SQLite API 与 Browser 验收使用 `npm run dev:node`。当前 vinext dev route runner 中 `node:sqlite.DatabaseSync` 不可构造，属于 upstream limitation；公开部署不是当前已验收能力 |
| 证据等级 | 单测、lint、build、HTTP 并发/错误路径和 1920×1080 浏览器验收；不外推生产 SLA |

## 为什么做见微

融资租赁不是一次问答，而是同一事项跨越多个专业角色、系统和时间阶段的连续工作。真实损耗通常来自：

- 材料反复上传，事实被复制成多份，后续人员不知道哪一版可信；
- 政策、信审、商务和资产各自使用工具，但上下文、责任和结果在交接处断裂；
- Agent 能生成候选内容，却无法说明“为什么找我、我负责什么、完成后交给谁”；
- 高风险动作没有具名人工权威，模型建议和正式决定混在一起；
- 外部动作只显示“已发起”，没有真实 Receipt（回执）就被误写成成功；
- 后续新证据覆盖旧信息，无法回答某个时间点是谁、基于什么证据、做了什么决定。

见微不试图替换所有现有系统。它提供一个轻量连续性内核，把现有规则、人员、系统和各板块自己的 Agent 接到同一融资租赁事项上。

## 产品定义

见微是融资租赁业务的 **连续协同与受控接续层**：

1. 接受一次材料、事实或事件，形成唯一 Canonical Evidence/Event；
2. 生成一个共享 Context Version，同时供政策、信审、商务、资产的候选处理链消费；
3. 解释变化为什么重要、为什么找到当前人；
4. AI 推荐若干人员、Agent、证据或动作，但不取得业务权威；
5. 有权人员通过 Human Gate 做具名确认、否决或提交；
6. 受控 Context Packet 交给下一位人或 Agent；
7. 结果、证据与 Receipt 追加返回，更新投影而不覆盖历史。

### 它不是什么

- 不是单一风控 Agent、聊天机器人或“大模型套壳”；
- 不是新的全牌照金融平台，也不是重建核心业务系统；
- 不是让 Agent 自动审批、付款、起租、催收或诉讼；
- 不是用共享上下文、知识图谱或多 Agent 等通用名词代替业务结果；
- 不是已接集团内网、真实客户数据、制度全文或真实自研 Agent 的产品；
- 不是三个独立的 V1/V2/V3 系统，而是同一内核的三个成熟阶段。

## 唯一权威对象与生命周期

后端唯一一级业务对象是 **Financing Leasing Matter（融资租赁事项）**。商机、尽调、政策输入、信审判断、合同、物流、资金、付款、起租、租金、催收和退出，都是这一事项的阶段、事件、材料或投影，不再建立互相断裂的顶级对象。

高层主脊线固定为：

```text
业务商机/现场尽调
        ↓
政策 → 信审 → 商务 → 资产
        ↖──── 局部补证/复核/重算 ────↙
```

主阶段不倒退。出现新证据、规则变化或履约风险时，系统开启局部回流任务，生成新版本，影响评估完成后再并回主干。旧版本、原始证据、责任人和理由必须保留。

## 关键角色

| 角色 | 主要责任 | 不承担的责任 |
| --- | --- | --- |
| 业务 | 触达供应商、发现商机、服务客户、现场尽调、补充事实并推进事项 | 不替代信审作风险决定，不替代政策发布规则 |
| 政策 | 建立规则、反欺诈、模型参数、量化策略、引擎与数据基础；处理政策例外或冲突 | 不是每个项目的逐笔审批人 |
| 信审 | 使用政策产物核验事实、回链证据、协调补证并作风险判断 | 不把模型评分直接当作正式审批 |
| 商务 | 处理合同、物流、资金匹配、付款条件和执行回执 | 不绕过前序条件直接宣告付款或起租成功 |
| 资产 | 管理起租档案、租金履约、预警、催收、处置、诉讼和退出 | 不覆盖历史风险判断，不把候选处置写成已执行 |
| 具名 Gate Owner | 对高风险动作作人工确认、否决或提交并承担责任 | 不能把决定匿名化，也不能由模型代签 |
| Agent / 模型 | OCR、分类、解析、候选判断、缺口识别、建议动作和解释 | 永远没有业务权威，不写正式 Fact/Approval/Receipt |
| Harness | 注册能力、组装受控上下文、路由任务、执行超时/重试/失败关闭并收集证据 | 不成为第二套业务真相 |
| Adapter | 用最小侵入方式连接现有规则、系统或自研 Agent | 当前仓库只有 fake/stub，不得描述成真实集团接入 |
| 见微之眼 | 观察全流程变化，解释接续关系，帮助人快速定位当前责任 | 只观察与协调，不审批、不替代专业岗位 |

## 四板块、二十个流程

每个板块内部五步严格顺序推进；前一步未完成，后一步只能是 `locked`。四个板块可以基于同一个 Context Version 并行准备候选信息，但“候选准备完成”不等于正式业务通过。

| 板块 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| 政策 | 材料解析 | 规则核验 | 量化评估 | 智能预审 | 智能更新 |
| 信审 | 模型解析 | 事实核验 | 证据回链 | 协调沟通 | 人工复核 |
| 商务 | 合同审批 | 物流查验 | 资金匹配 | 付款核验 | 最终付款 |
| 资产 | 起租建档 | 租金监测 | 风险预警 | 催收处置 | 诉讼退出 |

### 顺序、灰度和权威

- 板块候选准备度只能是 `0/20/40/60/80/100`；
- `0%` 纯白，`20/40/60/80%` 使用四档细灰度，`100%` 才是纯黑；
- 流程状态只有 `completed | active | locked`，且只能保持 `completed* → active? → locked*`；
- 选中态只改变描边，不能冒充完成；
- `prepProgressPercent` 与 `authorityState` 分离。即使准备度 100%，没有 Human Gate Receipt 仍不是正式通过。

## 二十个页面不是二十个模板

每个流程拥有独立的业务工作页、可视化、矩阵、图谱、指标、证据缺口、下一动作和接续摘要。例如：

- 材料解析展示 OCR、分类、字段映射和原始定位；
- 规则核验展示规则命中、缺口与例外；
- 量化评估展示归一化、权重、贡献度和六维画像；
- 事实核验展示来源冲突、核验人和正式状态；
- 合同审批展示合同义务、信审条件和条款偏差；
- 租金监测展示期次、应付、实付、逾期和核销；
- 诉讼退出展示案由、资产、证据、授权、成本和退出路径。

左侧五个流程只负责导航。中央矩阵必须展示当前流程的真实业务信息，不能再次复制左侧菜单。关系图谱默认贯通四板块，并聚焦当前节点。

## Human–Agent 权威契约

### 模型权威

模型输出始终是 `candidate`，`authority=none`。它可以解释、推荐和补全候选，但不能：

- 确认正式事实；
- 通过或否决项目；
- 代表人提交高风险动作；
- 伪造合同、付款、起租、催收、诉讼或外部系统回执。

### 最小 Human Gate

下列动作必须由具名人员确认：

- 政策规则发布、例外或冲突处置；
- 最终信审判断及关键条件；
- 合同生效、付款、起租；
- 正式催收、重组、诉讼、资产处置与退出。

### Receipt 与失败关闭

系统只在收到真实 Receipt 后把外部动作写为成功。失败、超时和 `unknown` 都保持未完成，不允许“乐观成功”。同一幂等键和同一载荷必须精确重放；同键异载荷必须 `IDEMPOTENCY_CONFLICT`。

## Evidence、Event 与 Context Packet

当前内核遵循以下语义：

- Evidence/Event 只追加，不静默覆盖；
- 每条记录保留来源、Actor、时间、作用域和原因；
- 同一个 `evidenceId` 与相同规范化载荷即使换 `requestId`，也重放首次 Canonical Receipt，不推进 Context Version；
- 同一个 `evidenceId` 若载荷变化，失败关闭并返回冲突；
- 一次接受生成一个新的 Context Version，政策、信审、商务、资产四条 stage run 必须读取同一版本；
- Evidence 接受、事实确认、具名决定和候选问答都会追加具名 Authority Event；同一幂等请求重放不能重复追加；
- Stage Run 以独立记录保留四板块对每个 Context Version 的候选处理身份，Projection 会检查四路版本一致性；
- 演示 Event Stream 可按 sequence 分页查询，用于回看进程期历史；它不是可跨重启恢复的生产审计账本；
- Context Packet 由后端根据 `caseId + stageId + flowId` 组装，前端不能自行拼接权威上下文；
- Projection 是可删除重建的视图，不是第二套业务真相。

## 工作台

桌面验收基线为 `1920×1080`，黑白灰 GPT 风格：

```text
┌──────────┬──────────────────────────────────┬──────────┬──────────────────┐
│ 见微/编号 │ 政策 → 信审 → 商务 → 资产         │ 拖动线   │ 否决 / 提交        │
├──────────┼──────────────────────────────────┼──────────┼──────────────────┤
│ 当前五步 │ 全域关系图谱 / 当前业务矩阵         │ 拖动线   │ 接续摘要 + Chat    │
└──────────┴──────────────────────────────────┴──────────┴──────────────────┘
```

- 左栏固定约 104px；右侧接续台默认约 420px，可在 320–620px 调整；
- 顶部四板块、左侧五流程和右侧进度使用同一后端 Projection；
- 图谱支持指针缩放、空白平移、节点拖动、边实时重算、适应画布和聚焦当前；
- 右侧先回答“现在什么情况、为什么找我、我做什么、下一步交给谁”，Chat 位于摘要之后；
- 信审页面可以展示现场材料，其余板块只显示与本流程相关的业务内容；
- 手机端是后续现场尽调入口，本轮优先完成桌面端。

## 后端架构

```text
Evidence / Chat / Human Decision
                │
                ▼
       Input validation + idempotency
                │
                ▼
      Canonical Event / Context Version
                │
      ┌─────────┼─────────┬─────────┐
      ▼         ▼         ▼         ▼
    政策候选   信审候选   商务候选   资产候选
      └─────────┼─────────┴─────────┘
                ▼
        Projection + Context Packet
                │
                ▼
     Named Human Gate → Action → Receipt
```

当前实现把 append-only Authority Event Ledger、Stage Run 历史、幂等记录、Fact、Decision Receipt 和 Projection 放在 Node 进程内 Map 中，适合本地演示和语义验证。事件可以分页查询，Projection 可以核对事件数、Stage Run 数和四路共享版本；但进程重启后仍全部清空。生产化必须替换为持久化事件账本、事务幂等表、认证授权和可审计的 Adapter。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 语言 | TypeScript 5.9、ESM |
| UI | React 19、Next.js App Router 代码结构 |
| 构建/运行 | Vinext 1.0 beta、Vite 8 |
| Sites/Worker | OpenAI Sites Vite plugin、Cloudflare Vite plugin、Wrangler |
| 图谱 | React + SVG 交互画布 |
| API | App Router Route Handlers、Web `Request/Response` |
| 状态 | 当前为进程内 append-only 演示 runtime |
| 测试 | Node test runner、ESLint、HTTP quality/soak scripts |
| 模型 | 可选 Z.AI General API；默认 deterministic local candidate inference |

Node.js 要求 `>=22.13.0`。完整版本请看 [STACK.md](./STACK.md)。

## API

演示事项固定为 `FL-DEMO-001`。

| Method | Endpoint | 用途 |
| --- | --- | --- |
| `GET` | `/api/cases/FL-DEMO-001/projection` | 获取四板块、二十流程、共享上下文、图谱、矩阵和最新回执 |
| `GET` | `/api/cases/FL-DEMO-001/events?afterSequence=0&limit=100` | 按 sequence 分页读取进程期 Authority Event；只读、服务端派生 |
| `POST` | `/api/cases/FL-DEMO-001/evidence` | 接受一条合成/脱敏 Evidence，生成 Canonical Receipt 与新 Context Version |
| `POST` | `/api/cases/FL-DEMO-001/messages` | 在指定板块/流程中发起候选问答，由后端组装 Context Packet |
| `POST` | `/api/cases/FL-DEMO-001/decisions` | 具名 Human Gate 的 `reject/submit`，返回 Decision Receipt |
| `POST` | `/api/cases/FL-DEMO-001/facts/:factId/confirm` | 具名人工确认候选事实 |

### Evidence 示例

```json
{
  "requestId": "req-evidence-001",
  "evidenceId": "evidence-equipment-001",
  "kind": "field_material",
  "title": "现场设备铭牌",
  "summary": "合成演示材料：设备型号与产线清单待核验",
  "actor": "业务经理·演示"
}
```

### Message 示例

```json
{
  "requestId": "req-message-001",
  "stageId": "credit",
  "flowId": "credit-fact",
  "message": "当前还缺哪些关键证据？"
}
```

### Decision 示例

```json
{
  "requestId": "req-decision-001",
  "stageId": "credit",
  "flowId": "credit-review",
  "action": "submit",
  "actor": "信审经理·演示"
}
```

非法 JSON、超限请求、未知事项、混合 stage/flow、幂等冲突、Adapter 失败和超时都返回结构化错误并失败关闭。

## 本地运行

### 1. 环境

- Node.js `>=22.13.0`
- Windows 建议使用 `npm.cmd`

### 2. 安装与启动

```powershell
npm.cmd install
npm.cmd run local:start
```

打开 `http://localhost:3000/`。该命令按需注册并启动一个无开机触发器、隐藏控制台窗口的 Windows Scheduled Task；服务不会跟随 Codex task 结束，并在返回成功前完成 HTTP 预热。

```powershell
npm.cmd run local:status
npm.cmd run local:stop
```

如果只需要绑定当前终端的临时开发服务，仍可使用 `npm.cmd run dev`。端口 `3000` 被其他进程占用时会失败关闭，不会自动切换到错误端口或结束其他进程。

生产构建预览：

```powershell
npm.cmd run build
npm.cmd run start -- --host 0.0.0.0 --port 3000
```

### 3. 可选产品模型

复制 `.env.example` 为本地 `.env` 文件并填写 **项目独立、可撤销、去标识化** 的产品凭据：

```dotenv
JIANWEI_MODEL_API_KEY=replace-with-a-dedicated-product-key
JIANWEI_MODEL_NAME=glm-5
```

不得复用 GLM coding runner 的 `ZAI_API_KEY`。未配置时页面会诚实显示“本地候选推理”；当前仓库没有验证 live GLM 产品链路。

## 验证

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

在已启动的本地 production 服务上：

```powershell
node .\scripts\http-quality-gate.mjs --assert-fixed
node .\scripts\http-mixed-soak.mjs 20
```

验收口径包括：

- 领域/流程/共享上下文/Human Gate/模型适配单测；
- Evidence、Messages、Decisions、Fact Confirm 的正常、重放、冲突、非法输入、超时、注入失败和并发；
- Authority Event 的追加、不重复、顺序分页、错误游标、错误事项和只读方法约束；
- lint、production build；
- 1920×1080 Codex 侧边 Site 的二十页差异、图谱交互、矩阵、拖动接续台、Chat、Receipt 隔离与 console；
- 性能数据只描述本机演示环境，不作为生产 SLA。

## 项目历史

### 1. Unity 原始叙事：共创、协同、全域

最早的 Unity 展示建立了“见微之眼”与共创、协同、全域的舞台表达，适合决赛开场和未来感叙事。它不是业务操作系统，也不拥有第二份业务状态。Unity 如继续使用，只消费 Web/后端的只读 Projection。

### 2. P1：通用人机协同探索（已退役）

P1 曾尝试十个平行场景和可跨业务复用的 `CollaborationCase`，并形成图谱、矩阵、接续台、事件投影、幂等和失败关闭等候选资产。P1 前端、后端和连调没有取得最终产品验收，十场景/通用平台叙事也容易与竞品重叠，因此 **不再是当前产品方向**。

当前只继承被重新验证的工程模式，不恢复旧的信息架构、命名或范围。

### 3. P2 Discovery：重新研究与收敛

P2 重新分析全球 Agent 协作产品、国内人机协同生态和决赛项目。研究结论是：共享上下文、多 Agent、Harness、状态机、跨人接续等概念已经广泛存在，不能单独作为差异化。见微必须落到一个业务事项、具名责任、人工权威、证据链和真实回执。

### 4. 融资租赁冻结

方向最终冻结为融资租赁事项，并锁死业务与大风控协同、政策/信审/商务/资产四板块、一个生命周期、追加式版本、局部回流和低侵入 Adapter。政策产物是必经输入，但政策人员不是逐项目审批人。

### 5. 当前 V2

当前版本实现外网合成黄金事项、二十个差异化页面、全域图谱/业务矩阵、共享 Context Version、四路 Stage Run、可分页的进程期 Authority Event、候选问答、具名 Human Gate、Evidence/Decision Receipt、幂等与失败关闭，并完成本地质量加固。它仍是演示级 runtime，后续不能跳过持久化、认证、适配器和真实用户验证。

更细的长期决策见 [DECISIONS.md](./DECISIONS.md)，版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 竞品与基准带来的约束

研究参考了 Claude/Asana/Atlassian/Microsoft/ServiceNow/Salesforce，以及钉钉悟空、飞书、腾讯 WorkBuddy、华为 CodeArts Agent Team、Coze Enterprise、Qoder Teams 等公开能力。结论不是“市场空白”，而是：

- 轻量 Agent 入口、正式工作对象、企业 Context Graph、Agent 身份治理、Control Tower 和业务动作编排都已有成熟方向；
- 国内也已有企业 Agent、协同、知识、研发和治理产品；
- 决赛项目已经覆盖 State/Gate/Harness、租赁物流程重构、跨座席上下文和人机协同；
- 见微不能宣称“国内没人做”“共享上下文独有”或“通用 AI 控制平面”；
- 当前候选差异是：在融资租赁这一受监管、跨角色、跨阶段场景中，让 **同一事项** 的证据、责任、人工决定与回执连续存在，并用最小侵入方式接入现有系统。

这些仍需用户访谈、替代产品对照和真实 MVP Gate 验证，不能从演示直接推导出商业成功。

## Roadmap

Roadmap 采用 Gate，而不是把未验证能力写成承诺。完整版本见 [ROADMAP.md](./ROADMAP.md)。

| 阶段 | 目标 | 进入下一阶段的 Gate |
| --- | --- | --- |
| R0 决赛演示 | 一个合成事项跑通政策、信审、商务、资产；讲清接续、权威、证据和回执 | 20 页内容一致；端到端闭环与 1920×1080 演示通过；不伪装真实集成 |
| R1 受控试点 | 持久化事件账本、事务幂等、认证/RBAC、审计与 read-only Adapter | 重启可恢复；权限越权测试通过；真实用户完成一次具名接力 |
| R2 集成试点 | 接入少量真实规则/系统/自研 Agent；移动尽调；外部动作 Receipt | 每个 Adapter 可回退；数据授权明确；失败/unknown 不产生成功状态 |
| R3 规模化 | 多事项隔离、可观测性、评估、保留策略、容量与运维 | 真实使用证据证明价值；安全、性能、恢复和治理 Gate 通过 |

内部成熟度可用 V1/V2/V3 表达，但始终是一个内核：V1 轻量接入，V2 关键可视化与受控接续，V3 主动感知、移动现场和完整智能协同。当前外网演示可以呈现 V3 目标体验，不代表内网已完成 V3 集成。

## 当前限制与停止条件

- 无数据库：所有 runtime 状态在进程重启后清空；
- 无登录、组织目录、RBAC、租户隔离或真实审批权限；
- 当前四板块准备度是固定的合成 Projection，不是已经运行的异步 Worker 编排；
- 当前 Decision Receipt 记录页面级具名动作，但尚未实现完整的板块权威状态迁移引擎；
- 已提供进程期只读 Event Stream，但它无数据库事务、跨重启恢复、认证/RBAC、租户隔离、归档或保留策略，不能视为生产审计账本；
- 无真实集团规则、客户数据、内网代码、凭据或商业秘密；
- Adapter 为 fake/stub，未接集团系统；
- live GLM 产品链路未验证；
- 进程期幂等 Map 随成功请求增长，生产必须设计持久化与保留策略，不能用随意 LRU 淘汰破坏权威语义；
- 只有本机并发和 soak 证据，没有生产负载、灾备或 SLA；
- `[error]` / `[timeout]` 是本地演示质量 Gate 的显式故障注入标记，生产 Adapter 必须改为受控测试钩子；
- 没有 LICENSE 时不得推断为任意用途开源授权。

若下一步需要复制未授权数据、让模型取得审批权、跳过 Human Gate、以无回执动作冒充成功，或重建一套重平台，应停止并重新评审范围。

## 仓库结构

```text
app/                  页面、工作台和 API Route Handlers
lib/                  领域投影、二十工作页、Authority Event/Stage Run/Evidence/Decision runtime、模型适配
public/materials/     合成/脱敏演示材料
scripts/              HTTP quality gate 与混合 soak
standalone/           可直接打开的单文件前端演示，不连接真实后端
test/                 Node test runner 测试
.openai/hosting.json  Sites 项目构建元数据，不含凭据
SITE_CONTRACT.md      当前 V2 前后端冻结实现契约
AGENTS.md             项目级执行与 Z 四路并发规则
ROADMAP.md            Gate 化路线图
DECISIONS.md          冻结决策与历史废弃项
STACK.md              技术栈、运行时和边界
CHANGELOG.md          版本演进记录
```

本地验收截图、Z runner JSONL、构建产物、Wrangler 状态、环境文件和依赖均被 `.gitignore` 排除；源码、测试、文档、`package-lock.json`、`.env.example` 与 `.openai/hosting.json` 应保留。

## 安全与隐私

- 不提交 `.env`、API key、token、密码、会话或真实客户信息；
- `.env.example` 只能保留明显占位符；
- 演示材料必须合成或去标识，并标注其证据等级；
- 不读取、复制或推断集团未授权代码、制度全文、客户数据、凭据或商业秘密；
- Coding runner 凭据和产品模型凭据严格隔离；
- 所有正式动作保留具名 Actor、Context Version、理由和 Receipt。

## 维护方式

产品权威顺序为：

1. 当前用户明确决定；
2. [SITE_CONTRACT.md](./SITE_CONTRACT.md)；
3. [DECISIONS.md](./DECISIONS.md)；
4. 本 README 与 [ROADMAP.md](./ROADMAP.md)；
5. 历史 P1/P2 研究材料，仅作证据，不恢复旧方向。

有实质规模且可以拆成四个独立检查点的代码任务，默认使用四路 GLM-5.3 Flash 工作波次；每路文件所有权互斥，由 Codex/GPT 控制器独立复测和最终验收。详细规则见 [AGENTS.md](./AGENTS.md)。
