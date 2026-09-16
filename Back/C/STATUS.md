# STATUS — V7 backend-next Lane C（夜间 2026-09-16）

任务书：`V7/NIGHT_BACKEND_20260916.md` §C + /goal。只写 `V7/backend-next/C/**`。
更新纪律：每检查点追加，写已做/真实失败/依赖/下一步/恢复方法，不混旧记录。

## 当前概要（滚动更新，新条目在上）

### CP14 · 2026-09-16 06:40 · 夜间终审：全链复跑 6/6 退出码 0，交付闭环

**已做**：
- 06:36 最终全链复跑（`evidence/reproduction-run.txt`）：单测 34/34（exit 0）· 主包 8/8 案 60 断言（0）· heldout 3/3 案 17 断言（0）· E2E 真 socket 8/8（0）· 租赁模板实库集成（0，outcome=ok）· 非租赁模板实库集成（0，outcome=ok）。A 服务对 v1.3 稳定运行（uptime 9572s）。
- 夜间外部事件全部跟随：CONTRACT v1.0→v1.3 四版（v1.2/v1.3 无 C 改动）；**D 无归 C 缺陷**，且 D 留门记录实证"C 假API断连场景注入成功，控制面可查"（D 消费 mock）；**B 13/13 真实集成经 C mock（3731）执行**，三分发送语义逐条对齐 MOCK_API §3；**A assembly 消费两模板+8/8 plans 全 ok**。
- `evidence/final-file-hashes.txt`：20 项交付文件最终 hash。全目录 50 文件、零依赖、写面仅 C/**。

**最终状态**：/goal C 路 DoD 全部完成并经三方（A 内核/assembly、B transport、D 黑盒探针）真实消费验证；无未解阻断。07:00 汇总见 RESULT.md。

### CP13 · 2026-09-16 ~03:30 · CONTRACT v1.3 跟随（无 C 改动）

**已做**：v1.3 = DEF-01 语义候选（监督 03:05 纠偏；**待用户裁决**）：stale 改为读时计算传递投影 `stale=自身输入被取代 OR 任一传递依赖 stale`，向全部下游（含 accepted/decided）传播——v1.2"级联停止"仅指状态迁移，可见性经读投影继续。纯运行时可见性语义，对 C 的 adapter/模板/案例零改动；与 C 案例 L3/L4"证据纠正后旧候选不可见延续"的语义一致。守望器续跑。

### CP12 · 2026-09-16 ~03:10 · CONTRACT v1.2 跟随（无 C 改动）

**已做**：v1.2 = D 路 D-19 反证后钉死失效级联停止规则（accepted→仅 stale 不级联；decided→留痕停止；非终态才 invalidated+级联）。纯运行时语义，C 的 invalidationMap 声明边与之兼容，adapter/工具/案例零改动。继续守望。

### CP11 · 2026-09-16 ~03:05 · B 全链消费 C mock 确认

**已做（只读观察）**：B 发布 STATUS/README——其 13/13 真实 A 集成中 worker 经 **C mock（3731 真实 socket，B 集成脚本自动拉起 `scripts/start-mock.mjs`）**执行模型调用，`provider=simulation` 落回 A candidate_ready；transport 三分发送语义**逐条对齐 MOCK_API.md §3**（400/401/429=未处理 / 5xx=已发送 / 截断=unknown / 完整但坏 JSON=RESPONSE_CORRUPTED 与 unknown 区分）；unknown 零盲重发有测试断言。B 无对 C 的新请求；其 OBS-1..4 已被 A v1.1 全部采纳。

**结论**：C→B 交付闭环（文档+服务被真实消费）；RESULT §4"B 侧消费确认"门关闭。

### CP10 · 2026-09-16 ~02:55 · CONTRACT v1.1 跟随：expectedVersion 必填适配，两模板集成复通

**已做**：
- CONTRACT v1.1（采纳 B OBS-1..4）。对 C 影响：**证据命令 expectedVersion 必填**（此前省略可行）。适配 `run-contract-integration.mjs`：初始值读 `GET /projects/:id` 投影；409 VERSION_CONFLICT 消费 `serverVersion` 重试（≤3 次，即契约 §3.2 规定的消费方正确姿势）。
- **发现并记录一处 A 实现/契约命名分歧**：契约 §2 Project 字段名 `inputVersion`，实现投影实为 `projectInputVersion`（`GET /projects/:id` 顶层为 `{ok,project,goals,evidence,humanRequests}`）。adapter 已做双形状防御消费；是否改名由 A 裁量（B 的 OBS 通道），D/assembly 消费时以此为准。
- 回归：34/34 单测；两模板实库集成对 v1.1 服务复通全 PASS（`evidence/contract-integration-*.json` outcome=ok）。

### CP9 · 2026-09-16 ~02:40 · B 接口观察清单复核（无 C 影响）

**已做**：读 B `interface-change-request.md`（OBS-1 human-requests 列表蛇形泄漏 / OBS-2 goal 投影缺 projectId / OBS-3 requestedRole 必填 / OBS-4 无续租端点）。四条均针对 A 契约实现，不触及 C 消费面；OBS-3 反向确认 C 的 HumanRequest 草稿形状正确（`toHumanRequestDrafts` 恒带 requestedRole，集成实测 PASS）。C 无需改动。

### CP8 · 2026-09-16 ~02:25 · A assembly 已消费 C 全部产物：8/8 plans + 两模板 ok

**已做（只读观察确认，无 C 侧改动）**：
- A `assembly/c-plans-result.json`：两模板落库（leasing tpl-mu2zody1 9 goals/6 roles；non-leasing tpl-mu2zodye 6 goals/5 roles）；**L1–L8 全部 8 份 plan 顺序执行 status=ok**（真实 projectId 全部落库，含 L3 双轮证据链/supersede、L4 矛盾短路轮），errors=[]，18:12Z 完成。
- A 自有 e2e-compose（S1–S7+，其自有模板）亦 pass——组装链路健康。
- C 侧无需修复：plans 投影语义（含 supersede 步骤/divergences）经 assembly 实际执行验证。

**结论**：C 路产物（模板/规则/工具/案例/plans/mock/文档）已全链被 A assembly 真实消费并成功执行；C 剩余动作仅为巡检与 06:45 终审。

### CP7 · 2026-09-16 ~02:15 · CONTRACT v1.0 FROZEN 跟随复核

**已做**：
- A 发布 CONTRACT v1.0（"v0.1 全部实现期钉死澄清，无接口破坏"）。逐项对照 v1.0 变更 1–6 对 C 侧影响：门序/outbox/失效语义不触及 adapter；**禁键范围钉死为 result.output/模板与目标 params，证据 content 豁免** → 修正 `toEvidenceSubmission`（此前对 content 也扫，语义不符 v1.0，虽现数据无碰撞）；Project.inputVersion 已被集成脚本消费（projectInputVersion → expectedVersion）；模板创建需 admin 角色 → 集成用 tok-admin 恰好正确。
- 基线升级：adapter `CONTRACT_VERSION='A CONTRACT v1.0'`、集成证据 contract 字段、INTERFACES.md 基线行。
- 回归：34/34 单测 + 两模板实库集成再跑全 PASS（对运行中的 v1.0 服务）。

**下一步**：巡检等待 assembly/B；06:45 终审。

### CP6 · 2026-09-16 ~02:00 · A 实库集成全通（12+ 步全 PASS，两模板均落库）

**已做**：
- A 服务 01:54 上线（127.0.0.1:48080，db=up，model=not_configured，principalVerifier=configured）。A 的合成 token 目录公开于其 `scripts/start-kernel.mjs`（`tok-*` 格式，覆盖我模板全部六角色），C 以 `--credential tok-admin` 注入（A 公开测试 token，非真实密钥）。
- **租赁模板实库集成全 PASS**：health（db=up）→ 匿名 403 PRINCIPAL_UNTRUSTED（失败关闭实测）→ 投影（9 goals/6 roles）→ `POST /templates` 落库（tpl-mu2z26xk-dd46c9627829 v1）→ 建项目 → L3 证据链 3 条提交（projectInputVersion 2→3→4，A 侧真实 evidenceId）→ supersede（flow v1→v2 新实体+指向，符合契约"取代=新建实体"）→ 人工待办创建 → 项目回读 → `goal-instantiate:fact_intake` 200 + 重复创建 409 GOAL_EXISTS（plans/*.json 可实例化实测）→ 计算投影自检。
- **非租赁反例模板实库集成全 PASS**（`--template non-leasing`）：同一脚本同一服务直接落库——核心无行业硬编码的真实服务级证明。
- 证据：`evidence/contract-integration-leasing.json`、`evidence/contract-integration-non-leasing.json`（outcome=ok，各步骤状态码+响应摘录）。

**语义确认**：A 的 supersede 语义与投影假设一致（新 evidenceId 返回、旧实体被 superseded 指向）；projectInputVersion 逐次递增与 expectedVersion 门可用。

**边界保持**：C 未做 goal 编排/claim/complete/accept（组合属 A assembly）；仅验证模板可实例化。

**下一步**：06:45 刷新 RESULT；关注 B 消费 mock 与 A assembly 采用 plans；期间继续巡检。

### CP6b · 2026-09-16 ~02:00 · 413 竞态修复（压力测试定位）

**真实失败（已修复）**：复跑中 test 套件偶发 EXIT=1（约 1/10 概率）。压力循环 10 次定位到 `包体超限→413` 用例：服务端早应答 413+排空与 3MB 请求体上传存在竞态，客户端偶发 ECONNRESET 而非读到 413。修复：**先完整排空请求体、在请求 end 时统一应答 413**（`Connection: close`），另加 >64MB 硬限直接断连防护；MOCK_API.md §7 同步。修复后压力 **12/12 全绿**，复跑 6 命令退出码 0/0/0/0/0/0（`evidence/reproduction-run.txt`）。

### CP5 · 2026-09-16 ~01:40 · A 实例化计划预生成 + supersede 投影语义修正 + 集成脚本全链化

**已做**：
- 发现并修正投影语义缺陷：初版计划把"被取代旧证据"跨轮重复提交、把取代者当新证据提交。按契约 §2"取代=新建实体（新 id）、supersedes 单 id 指向"重写 `buildCaseProjectPlan`：证据跨轮去重；取代经 `supersedeEvidence` 步骤（内容=取代者）；C 数据"一个取代者取代多个旧实体"→ 对每个旧实体各发一次 supersede，分歧如实记 `divergences`（不静默吞）。L4 计划现为 12 步含 2 条 supersede + 2 条 divergence。
- `src/generate-plans.mjs` 预生成 8 份计划 → `scenarios/plans/<caseId>.plan.json`（A assembly 可直接顺序执行，无需先跑 C 代码）；新增测试断言（去重/supersede/取代者不重复提交/分歧记录），**全套 34/34**。
- `run-contract-integration.mjs` 全链化：A 上线+凭据后一次跑通 模板→项目→证据提交×3（带 expectedVersion 跟踪）→ supersede（L3 flow v1→v2）→ 人工待办创建 → 项目回读 → 计算投影自检。当前仍 BLOCKED（48080 ECONNREFUSED），后台轮询中。

**真实失败（已修复）**：generate-plans 首版误从 case-checker 导入不存在的 `buildCaseProjectPlan` 导出。

**下一步**：等 A；06:45 刷新 RESULT。

### CP4 · 2026-09-16 ~01:35 · 加固与复跑证据（34/34 + 确定性复核 + 全链退出码）

**已做**：
- mock 补测：包体 >2MB → 413（服务端排空请求体保证客户端可读）+ 控制面未知路径 404；**全套单测 34/34**。
- 全链复跑 `evidence/reproduction-run.txt`（真实 node 退出码）：test 0 / eval 0 / heldout 0 / e2e 0 / integration 3(BLOCKED=预期)。
- **确定性复核**：eval 连跑两次，报告除 runAt 外逐字节一致。
- 文档同步：MOCK_API.md §7 更新 413/404 行为；evidence 增补刷新后文件 hash。
- RESULT.md 首版完成（真实数字+未完成门）；memory 已记录。

**真实失败（已修复）**：413 场景服务端 destroy 请求致客户端 fetch 失败读不到响应 → 改为 drain+Connection:close。

**依赖/下一步**：等 A 服务上线（后台轮询 48080）跑实库集成；06:45 左右最终刷新 RESULT。

### CP3 · 2026-09-16 ~01:30 · A CONTRACT v0.1 对接：投影适配 33/33，实库集成 BLOCKED（A 未起）

**已做**：
- 发现 `V7/backend-next/CONTRACT.md` v0.1 已发布（A 独占 writer），按 §2/§3/§4/§6 完成 C 侧投影适配 `src/contract-adapter.mjs`：C 模板→A `POST /templates` 载荷（roles/goals/executorKind/acceptanceRole/decisionRole/params，非租赁模板同适配器可配置=核心无行业硬编码投影级证据）；案例证据→A evidence 载荷（kind=indicator，content 带五级/口径/数值）；计算结果→`complete` result（`provider="calculation"`）；脚本候选→result（`provider="simulation"`，先过 C schema）；evidenceRefs→`"id@version"` 字符串；HumanRequest 草稿（短路轮问题→missing_evidence）；案例→项目实例化顺序计划。
- 本地预检对齐契约硬约束：FORBIDDEN_KEY 键扫描（**范围=契约 §3.1 仅 result.output/params**；decisionRole 等模板 schema 自身键名不算禁键）、DAG 查环、角色存在性。
- `test/contract-adapter.test.mjs` 6 用例；全套测试 33/33 PASS。
- `src/run-contract-integration.mjs`：对 `127.0.0.1:48080` 分步集成（health → 匿名 403 失败关闭探针 → 带凭据模板/项目正路径；凭据只经 `--credential` 传入，不猜不读环境）。当前 A 服务未起：health ECONNREFUSED → **BLOCKED（exit 3）**，如实记录于 `evidence/contract-integration.json`。

**真实失败（已修复）**：禁键扫描初版误扫整个模板 submission（decisionRole 是 A schema 自身键名）→ 修正为仅 params；测试期望 "pricing" 命中 "price" 正则错误 → 修正。

**依赖**：A 服务上线 + 合成测试 token 目录（A README/STATUS 发布后重跑 `node src/run-contract-integration.mjs --credential <token>`）。
**下一步**：INTERFACES/README/RESULT；轮询 A；07:00 汇总。

### CP2 · 2026-09-16 ~01:25 · P2/P3 完成：8 案例 60/60、heldout 3/3、E2E 8/8

**已做**：
- 计算工具：`src/calculation-tool.mjs`（自旧 C 原样复用 `calc:cash-flow-coverage@1`，旧件只读）+ 新写通用 `src/ratio-tool.mjs`（`calc:ratio@1`，行业无关，供订单集中度/非租赁价格基准）。
- `rules/rule-pack-v2.json`（2.0.0，lineage 注明派生自旧 1.1.0）：7 条用户约束机器可查（高息≠风险覆盖/未知成本不编净收益/资料不完整非自动拒绝/地区非标签/≤3问/五级证据/倾向非审批）+ 15 条升级理由（v1 十条全保留+5 新增：ownership_dispute/unknown_cost_in_income/high_rate_as_risk_coverage/region_label_reject/over_question_limit）。
- 模板：`templates/commercial-leasing-v1.json`（六角色固定 roleId、9 goalType、invalidationMap、human_only 终门）+ `templates/non-leasing-counterexample-v1.json`（维保服务采购反例：无租赁字段、租赁专用工具被门禁、ratio 工具两侧复用）。
- 案例：`scenarios/leasing-cases-v1.json` 8 案（成熟直租/老客回租/新客报表粗糙+流水验证（多轮补证）/隐性债务矛盾（多轮取代纠正）/权属争议/低流通+处置线索/订单集中+季节口径/高报价+成本未知）——L3/L4 双轮，五级证据、口径显式、期望全来自规则+算式；`scenarios/heldout-cases-v1.json` 3 案（调规则期间未运行）。
- `src/case-checker.mjs`：机械推导（矛盾/口径并存未声明/unknown 级/权属争议信号/取代链）+ 17 种检查求值；`src/run-evaluation.mjs`：主包 **8/8 案例、60/60 断言 PASS**（evidence/eval-report-main.json）。
- **heldout 一次性评测：3/3 案例、17/17 断言 PASS**（evidence/eval-report-heldout.json；未见案例首跑通过，规则未因 heldout 调整）。
- `src/run-e2e.mjs`：全部案例轮次经真实 loopback socket（mock 确定性回放脚本候选→checker 机械检查）：**8/8 PASS**，含短路轮零请求跨传输层核对与同请求恒同响应断言（evidence/e2e-report.json）。
- 全套单测 27/27（mock 16 + calc 3 + ratio 3 + pack 5）。

**真实失败（已修复）**：AUTHORITY_WORDING 被 schema_invalid 吞掉 → 拆分；unknown 级探测漏 `value:null` 证据 → 改为按 grade 判定；多轮前后轮索引浅拷贝失配 → 显式传 `__turnIndex`。

**限制（如实）**：heldout 由同一作者（本 lane）按同一规则书写，非第三方独立真值；其纪律价值在于"书写时不运行、首跑一次性"，已执行。脚本候选经 mock 回放只证明 transport 真实，不证明模型能力。

### CP1 · 2026-09-16 ~01:05 · P1 mock 服务完成（16/16 测试 + 7/7 外部冒烟）

**已做**：
- `src/mock-server.mjs`（mock-api-v1）：真实 socket loopback HTTP 服务，OpenAI 兼容 `/chat/completions`（任意以其结尾的路径）+ `/models`；11 场景：success / missing_field / format_error / latency / rate_limited(429+Retry-After) / server_error_500|502|503 / disconnect_before_response / partial_response / malformed_response / invalid_credential；控制面 `/__mock__/{health,config,reset,requests,projects}`；跨项目 canary 探针（canary 仅由 seed+projectId 决定）；凭据全程掩码 + 请求体泄漏 key 异常标记（`x-mock-credential-anomaly`）；`MOCK_RESPOND_JSON` 脚本指令（脚本化 transport，不冒充模型能力）；确定性响应（同 seed+body 恒同 id/content/created）。
- `MOCK_API.md` 接口文档交付 B（场景表/控制面/探针用法/凭据纪律/已知限制）。
- `test/mock-server.test.mjs`：16 用例全过（经真实 TCP fetch/node:http；含断连后控制面 verified processed=true → "unknown≠确定失败"断言；截断体与 malformed_response 区分断言；401 全响应扫描无完整 key；注入话术下 canary-B 不出现）。
- `scripts/start-mock.mjs`（独立启动，`--api-key` 仅命令行注入）+ `scripts/smoke-external.mjs`：独立进程启动于 3730，外部进程冒烟 7/7 PASS，已停进程、端口已释放（evidence/mock-3730-standalone.log、evidence/smoke-external-3730.txt）。
- `evidence/p1-file-hashes.txt`：P1 五文件 sha256 前 16 位。

**真实失败（已修复）**：首跑漏 `createServer` 包装（nodeServer.once not a function）→ 修复；缺 key 401 文案掩码问题 → 拆分"缺失/无效"两种文案。

**依赖**：无外部依赖（node:http/crypto 零安装）。
**下一步**：P2 计算工具 + 8 案例 + 模板/规则包。
**B 接入恢复方法**：`node V7/backend-next/C/scripts/start-mock.mjs [--port 3730]`；文档 `V7/backend-next/C/MOCK_API.md`。

### CP0 · 2026-09-16 ~00:45 · 启动

**已做**：
- 完整读取任务书与 `V7/SIX_ROLE_COMMERCIAL_LEASING_20260915.md` 业务约束。
- 只读盘点旧 `V7/backend/C`（calculation-tool/candidate-schema/rule-pack 1.1.0/cases-v1 可复用；旧 mock-provider 是进程内函数桩，**不是**真实 socket，本轮新写 loopback HTTP 服务）。
- 建立 `V7/backend-next/C/` 骨架（package.json 零依赖；Node v22.23.1 在位）。
- 确认 `V7/backend-next/CONTRACT.md` 尚未存在 → 按 /goal 先做独立数据与接口，A 契约发布后再适配（轮询点：每次检查点刷新时查看）。

**计划顺序**（按任务书“先接口和环境，后窄闭环，再异常深度”）：
1. P1 mock HTTP 服务（真实 socket，11 场景：success / missing_field / format_error / latency / rate_limited / server_error_500|502|503 / disconnect_before_response / partial_response / malformed_response / invalid_credential）+ 跨项目 canary 探针 + 凭据脱敏 + `/__mock__/*` 控制面。
2. P1 `MOCK_API.md` 接口文档交付 B。
3. P1 真实 socket 测试全过 + evidence。
4. P2 计算工具（复用旧 C cash-flow-coverage@1 原样拷贝 + 新增通用 ratio-tool@1）、8 租赁案例（≥2 多轮）、非租赁反例模板、目标模板/规则包 v2。
5. P3 固定 seed 评测 runner + 独立 heldout（3 案，不在调规则时使用）+ E2E（经真实 socket 走通案例）。

**真实失败**：无。
**依赖**：A 的 CONTRACT.md（未发布，不阻塞 P1/P2 独立件）；无外部依赖需安装（零依赖设计）。
**下一步**：写 `src/mock-server.mjs`。
**恢复方法**：本目录自包含；`npm start`（= node scripts/start-mock.mjs）起服务，`npm test` 跑全部测试。
