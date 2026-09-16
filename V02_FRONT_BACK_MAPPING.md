# V0.2 Stage 1 · Front ↔ Back 语义映射契约

2026-09-16。依据：Back/CONTRACT.md（v1.3）、Back/C/templates/commercial-leasing-v1.json、Back/A/assembly/run-c-plans.mjs（ADAPTER_NOTE）、Front/site-mirror/app/v5-preview/role-contract.ts、role-cases.ts。本文档是 Stage 2+ 的实施依据；未列映射不得自行发明。属于 Commit Boundary 1（仅本文档，不改运行行为）。

## 1. Reference case 选择

**选 `seed-metal-direct`（金属加工直租，SL-2026-101）**，依据任务书 §5.A 建议：

- 证据路径最明确：仅 2 个补证步骤（发票→购销合同），4 个初始事实。
- 与 C 路 L1（`C/scenarios/plans/L1-metal-direct-mature.plan.json`）同题材，且 L1 已在 A 内核真实执行通过（模板落库+证据+fact_intake claim→complete→accept 全链，见 `A/assembly/c-plans-result.json`）。
- 后端事实基座 = `goal-template-commercial-leasing-v1`（A 侧经 `adaptTemplate` 投影落库），不新造模板、不新造证据 kind。

**如实记录**：Front 种子案例数字（营收 2600 万/报价 386 万/发票 372 万）与 C L1 计划数字（现金流 84 万/月供 60 万）是同一题材的两套合成数据，互不复制。V0.2 以 Front 案例叙事为 UI 口径、以 C 模板+证据 kind 词汇为 A 数据口径；两套数字不混用、不回写。

## 2. 顶层映射

| Front 概念 | Back 概念 | 说明 |
|---|---|---|
| CaseScenario（案例） | Project（模板实例） | 一案例=一 Project；`caseId/code/title/industry/leaseMode` 由 Project name+模板 params/展示层承担，不新建实体 |
| CaseFact（事实，带 evidenceVersion） | Evidence（按 kind 的当前证据链） | 见 §3；版本=该 kind 证据链取代深度推导，非独立字段 |
| RoleTask（角色待办） | **双源投影**：GoalInstance（responsibleRole=该角色且状态可行动）+ HumanRequest（open） | 显式区分：目标类待办←Goal；问询/补证请求←HumanRequest。不得混淆（任务书 §9.Stage1） |
| CaseDomainRow（四域矩阵） | GoalInstance 状态投影（§5） | 每域 1–2 个目标的状态聚合 |
| CaseMessage（消息流） | 多源投影（§6） | 聊天不是隐藏业务数据库 |
| RoleId（六角色视角） | UI perspective ≠ principal | 见 §7 |
| completedTurns/taskStatus（浏览器态） | **废除**（reference case） | 一律由后端状态推导 |
| FactStatus 五级 confirmed/supported/inferred/unverified/unknown | C 证据五级 confirmed/source_supported/inference/unverified/unknown | 一一对应（`evidenceDiscipline.grades`） |
| Tendency 做/谨慎做/调整条件后做/不做 | jianwei_summary constraints tendencyEnum do/cautious_do/do_with_adjusted_terms/no_do | 候选倾向，非审批 |

## 3. 事实 ↔ 证据 kind 映射（reference case）

C/A 既有 kind 词汇（C 案例与模板实际在用，**不新造**）：`customer_profile / equipment_list / bank_flow_summary / liability_statement`（fact_intake 四类输入）＋ `equipment_ownership_status / monthly_operating_cash_flow / monthly_debt_service / total_revenue / top1_customer_revenue / disposal_channel_status / environmental_upgrade_cost`。

| Front 事实（seed-metal-direct） | A Evidence kind | 初始值（grade/caliber） | 后续 turn |
|---|---|---|---|
| rev 年营业收入（申报） | `customer_profile` | 约2600万 / source_supported / 申报口径 | — |
| flows 对公流水（近12个月） | `bank_flow_summary` | 入账约2900万 / source_supported / 近12月对公 | — |
| equip 拟租设备 | `equipment_list` | CNC走心机×2 报价386万 / unverified / 供应商报价 | — |
| debt 对外负债 | `liability_statement` | 抵押480万月供5.1万 / source_supported / 客户声明+征信 | — |
| （turn 1）**发票** | `equipment_ownership_status` | 372万（含税）/ confirmed / 购入发票+权属登记（与 L1 计划同构） | submit 新证据 |
| （turn 2）**购销合同** | `equipment_ownership_status`（取代） | 合同价372万、交付45天、预付30% / confirmed / 购销合同条款 | **supersede** 上一条 |

- equip 事实的 UI 版本 v1→v2→v3 = 该 kind 证据链（1 份初始 equipment_list + 1 次提交 + 1 次 supersede）投影出的显示版本。
- 发票/合同映射到同一 kind 的提交与取代，是最诚实对应：合同不是新指标，而是设备价格/权属证据的版本演进，天然演练 v1.3 supersede→stale 链路（Stage 7 需要的机制由此贯通）。

## 4. 目标依赖图（模板实例化后的运行态）

```text
[四类初始证据齐备]
      ↓ (inputEvidenceKinds 满足)
fact_intake (human_led·business)
      ↓ accept(jianwei) 后下游 ready
policy_screening(human·policy)  equipment_verification(human·asset)  credit_crosscheck(human·credit)  pricing_cost_review(human·commerce)
      └──────────────┴──────── credit_crosscheck ┘──────────┘
                                  ↓
                  cash_flow_coverage_calc (agent_tool·credit)   ← B worker claim → C calc:cash-flow-coverage → complete
                                  ↓ 五者
                        jianwei_summary (agent_candidate·jianwei)  ← 候选倾向（显示"模型/系统候选"）
                                  ↓
              evidence_supplement (human·business，可多轮补证=本文档§3 两 turn 的宿主)
              human_review (human_only·business；验收/决定=jianwei)   ← 正式人工终门
```

- 验收/决定权威：`acceptanceRole = decisionRole = 'jianwei'`（adaptTemplate 裁定，见微=全局协调岗）。
- `cash_flow_coverage_calc` 是 V0.2 唯一必选 agent 目标（任务书 §5.F）；B 配置已有路由 `R-CALC-ONLY`（taskKind `cash_flow_coverage` → 工具 calc:cash-flow-coverage，`B/config/b-config.http-sample.json`）。
- Stage 5 验证点：calc 输出键（ratio/unit/formulaVersion/inputHash 等）已核对不含 A 禁用键子串（approv|decision|quota|price|rate|reject）；B complete 时仍需实际验证。

## 5. 域矩阵/待办投影规则（提案，Stage 2 实现前可由用户/Codex 调整）

四域 ← 目标（取"最差状态优先"聚合：invalidated > stale > blocked/未实例化 > ready/leased/waiting_human > candidate_ready > accepted > decided）：

| 域 | 目标来源 | judgmentStatus 规则（提案） |
|---|---|---|
| 政策 | policy_screening | accepted/decided→green；candidate_ready→yellow("候选待验")；ready/leased→gray("进行中")；blocked→gray("待启动")；invalidated→red；stale→yellow("待复核") |
| 信审 | credit_crosscheck ＋ cash_flow_coverage_calc | 同上，取两目标较差者 |
| 商务 | pricing_cost_review | 同上 |
| 资产 | equipment_verification | 同上 |
| （见微行/汇总） | jianwei_summary 候选 + stale 汇总 | 不进四域格子，进消息与汇总面板 |

segments 四段（done/current/pending）映射：段=该域目标生命周期 `[材料齐备, 核验进行, 候选产出, 验收完成]`，按状态投影；各域 segmentLabels 沿用 shared-types 配置，不跨域强行同名。

待办（todo）投影：`GoalInstance.responsibleRole=当前视角 && status∈{ready(待领取), candidate_ready(待验收), waiting_human}` ＋ `HumanRequest(status=open, requestedRole=当前视角)`；已验收→"已完成"。**禁止用 completedTurns.length 推断业务阶段**（任务书 Stage 4）。

## 6. 消息流投影（聊天非数据库）

| Front 消息 origin | 后端来源 |
|---|---|
| human（用户输入回显） | 本次已提交的动作（submitEvidence/supersede/respond/complete…）本地回显，事实以 GET 重投影为准 |
| system（证据版本） | Evidence 提交/取代事件（GET project 的 evidence 链 + outbox EVIDENCE_*） |
| system（目标状态） | outbox 事件 GOAL_READY/CLAIMED/CANDIDATE_READY/ACCEPTED/…（`GET /api/v1/events?after=seq` 增量拉取） |
| model（域角色回复/候选） | GoalInstance.result.output（provider=calculation/simulation），标记「模型/系统候选」；**禁止显示为"审批通过"** |
| model（见微汇总） | jianwei_summary 目标候选输出 |
| preset 静态说明 | 仅限模板 acceptance/expectedChecks 文案（展示层，不建后端实体） |

未命中任何动作路由的自由文本 → `POST human-requests (kind=clarification, requestedRole=business)` 真实落库并进待办；**不得**本地假装理解，也不得静默丢弃。

## 7. 角色与身份（§4 原则落地）

- 六角色 tab = 演示视角，仅决定"看谁的待办/以谁的名义草拟"，**不自动等于 principal**。
- demo identity mechanism（Stage 3 起需要）：网关提供 `GET /api/jw/demo/identities`（只读，127.0.0.1，凭据存服务端配置文件，**不编译进前端 bundle**）；前端内存保存所选身份，逐请求带 `X-Principal-Credential` 经代理转发；不落 localStorage。候选身份=kernel 十个合成 principal 中六角色岗（tok-jianwei/tok-business/tok-policy/tok-credit/tok-commerce/tok-asset）+ tok-agent（B worker 专用，不给人用）+ tok-admin（种子脚本用，不进 UI）。
- executor≠acceptor 由 A 结构保证（complete 最多 candidate_ready；accept 需 jianwei 人类 principal）；UI 上"验收/决定"按钮仅对 jianwei 视角+对应身份可选。

## 8. Contract mismatch 清单（Stage 1 发现）

1. **版本语义差**：Front CaseFact.evidenceVersion 是"每事实独立版本"；A 是项目级 inputVersion + 证据链取代（Evidence 实体 version 恒 1，取代=新实体）。→ 投影推导（§3），不新增后端字段。
2. **脚本命中 vs 自由输入**：Front keywords 路由是 UI 交互层；后端无关键词概念。→ keywords 仅作"推荐动作"入口，动作一律真实 API；未命中走 clarification HumanRequest（§6）。
3. **身份缺位**：现 UI 无 principal 概念；A 敏感写 fail-closed。→ demo identity mechanism（§7）；旧 v5 client 的 actorRole 自报模式**不得**照搬（后端当时自校验 business；A 不接受载荷授权）。
4. **候选/验收/决定三层缺 UI**：现 taskStatus 只有 open/updated/done。→ 需新增候选展示与"验收/决定"操作（Stage 5/6 的 UI 项），文案区分 候选/人工验收/正式决定。
5. **状态词汇差**：Front domains segments 与 A 九态状态机不同名。→ §5 投影规则；UI 可转业务语言但不得伪造后端不存在的状态。
6. **静态 domains 数据**：seed 案例四域矩阵是内联静态数组。→ reference case 改为投影；其余三案例保留本地模拟并明确标注「本地模拟」。
7. **expectedChecks 无后端对应**：→ 作为模板 params/展示文案保留，不建实体。
8. **事实核（facts）初始落库**：Front 案例初始事实在浏览器里与生俱来；A 需要种子脚本提交四类 intake 证据才能让 fact_intake ready。→ Stage 2 种子脚本（§10）。
9. **A 旧 48080 遗留实例** db:down（见 V02_BASELINE.md §4）不可用作集成对象；一律用 48180 新实例。
10. **前端 dist**：源码改动后必须 `npm run build` 更新 dist（用户发布件），Stage 2 起每阶段收尾包含构建+一致性核对。

## 9. 预计新增/修改文件（Stage 2 范围；Stage 3+ 另行宣布）

```text
Front/integration/jw-types.ts            // A API 响应类型（只含用到的投影子集）
Front/integration/jw-api-client.ts       // 新客户端：/api/jw/**（GET health/project/goal/events）；ApiFailure 模式参考旧实现但不复活旧端点
Front/integration/jw-project-adapter.ts  // A Project/Goal/Evidence → 视图模型投影（§3/§5/§6 规则）
Front/integration/jw-identity.ts         // demo identity 选择与内存保存（Stage 3 启用，Stage 2 可先落类型）
Front/preview/main.tsx                   // reference case 入口：优先真实后端模式
Front/site-mirror/app/v5-preview/…       // HomeOverview 增加 live 分支/错误横幅；不重写 UI
Front/start-preview.mjs                  // 3618 静态服务扩展 /api/jw/* → 127.0.0.1:48180 反代（thin、不记凭据、不改载荷）
Front/preview/vite.config.mjs            // dev 3617 server.proxy 同规则
Back/A/scripts/seed-demo.mjs             // 新增：对运行中的 48180 落库商业租赁模板+建 reference project+四类 intake 证据+实例化九目标（幂等）
Front/preview/test/jw-*.test.mjs         // adapter/client 纯逻辑测试
V02_BASELINE.md / 本文档                  // 已在 Boundary 0/1
```

## 10. Stage 2 最小实施方案（read-only live mode）

前置（需用户环境操作）：启动 Docker Desktop → `docker start jw-v01-pg` → migrate → `node scripts/start-kernel.mjs --port 48180`（Back/START.md 流程；48080 遗留进程不动）。

1. 网关：`start-preview.mjs` 增加同源反代 `/api/jw/*` → `http://127.0.0.1:48180/api/v1/*`（路径直译，仅加固定前缀映射；仅绑 127.0.0.1；错误透传不吞）。dev 侧 vite proxy 同规则。**网关不含业务规则、不改 payload、不注入身份头**（身份由客户端显式携带，Stage 3 起）。
2. 客户端+适配器：`jw-api-client` GET health/project/goals/events；`jw-project-adapter` 按 §3/§5/§6 投影出现有 HomeOverview 视图模型（facts/domains/todo/messages）。纯函数、可 node 直测。
3. 种子：`seed-demo.mjs`（幂等：GOAL_EXISTS/已存在模板跳过）产出固定 named project「SL-2026-101 金属加工直租（live）」。
4. UI 接入：案例入口新增 live 卡片；选中后全部状态来自 GET 重投影；**A 不可用→顶部明确错误横幅+禁用输入，禁止回退本地模拟**；其余三案例照旧本地模拟并保留「本地模拟」标注。
5. 验收（Boundary 2）：浏览器 network 可见真实 GET；F5 状态不变（服务端重建）；杀 A→UI 显式不可用；Front build/typecheck/test 全过；无任何写路径。
