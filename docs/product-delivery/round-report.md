# JW 四任务产品交付轮·合流审计与交付说明（round-report）

- 日期：2026-09-19。角色：合流审计与交付说明员（只读审计；本轮只新增本文件与根部 `DELIVERY-BRIEF-draft.md`，未改任何源码/测试/他路文档）。
- 基线：分支 `v02-goal1234-delivery` 在制工作树（HEAD `e4ed7a5` + 四路未提交变更）；`origin/main = b6bea23`（PR#4 已合并 e4ed7a5）。
- 审计对象：`docs/product-delivery/goal-01..04/` 四路交付文档 × `Back/CONTRACT.md` §11（v2.4 增量契约）交叉一致性；上轮 `docs/backend-upgrade/goal-01..04/` 仅作背景对照。
- 本文件 writer：合流审计会话（goal 授权，唯一）。`docs/product-delivery/` 顶层骨架归属 04 路，各路子目录归各路 writer（见任务书《四路唯一修改者》与 goal-04/BASELINE.md BC-1）。

## 结论（TL;DR）

1. **契约面收敛良好**：§11 G1/G2/G3 冻结后，03 路（Edge/Front）已按 §11 实际形状接线并经 13 条真实浏览器路径验证；02 路 A 消费面（材料登记/分析运行/Gate 回执/findings）与 §9/§11 一致。**分歧集中在文档陈旧与两处未接线，无契约语义冲突**。
2. **最大功能缺口（D3）**：§11 G3 处理状态写口在 Connectors 侧零调用——经处理链登记的材料在 A 侧 stage 恒为 `registered`，客户门户的分段进度（my/materials）没有权威推进者。owner 02，映射表也未落契约（D4）。
3. **§11 正文缺一句（D5）**：`material.<kind>` 前缀剥离比对已在代码实现（DEF-G04N-02 对齐），goal-01 DESIGN R7 称"已同步 §11"，但 §11 正文无此语义——按字面实现的消费方会全部 403。owner 01 补契约句。
4. **回归证据有入库风险（R2）**：goal-01 的 `evidence-shard-*.log`/`evidence-regression-full.log` 被 `.gitignore` 的全局 `**/*.log` 吞掉，合流后指针悬空；需 `git add -f` 或加窄化负模式（用户/04 裁决）。
5. **缺陷最新状态**：DEF-G04N-03（XLSX 当 ZIP）已修复且有 04 路复测证据（金丝雀转绿）；DEF-G04N-01 主链已到达 A（38/39 门禁），剩余单任务失败原因已从"requestId 400 永不到达 A"变为 ZIP 穿越条目；DEF-G04N-02 A 侧代码修复在、运行时验证 PENDING（Docker 引擎停机）。**DEFECTS.md 台账三条仍写 OPEN，未随最新证据更新（D7）**。
6. **人现在能在页面上完成的**（goal-03 实测 13 条路径全 PASS）：受控登录、客户目录、受限邀请全生命周期、客户邀请码兑换进门户、授权内上传、授权外拒绝、撤权级联即断、检查会话问答、报告生成导出、决策状态/Gate 展示。**不能完成的**：方案→批准→激活全链（被 BASIS_PACKAGE_REQUIRED 诚实阻断，等 01/02 依据包链收口）、上传后分段进度推进（等 D3 接线）、原件预览（等 IR-03-3 正式读回）。
7. **合流入 main 路径**：把在制工作树按路切成 commit 推上本分支 → 开新 PR（base main，即 PR#5）；PR 描述草案与 8 项风险清单见 §二。全仓尚无"单一固定快照全绿"证据，合流前建议在 PR 分支补跑一轮。

---

## 一、§11 一致性交叉审计（分歧清单，只报告不代修）

判定基准：`Back/CONTRACT.md` §11（CONTRACT.md:194-218）。总体判断：**实现与契约无方向性冲突；分歧 = 文档陈旧（D1/D2/D6/D7）+ 契约缺记（D5）+ 消费方未接线（D3/D4）+ 登记未回填（D8）**。

| # | 一句话 | 涉及 | 严重度 | owner |
|---|---|---|---|---|
| D1 | IR-03-1 正文仍是旧提案形状（offset/total），与 §11 G1 键集游标不符 | 03 文档 | 低（顶部状态节已声明以 §11 为准） | 03 |
| D2 | IR-03-2 正文旧形状之外，其要求的 INVITATION_ROLE_NOT_ALLOWED / INVITATION_LIMIT 两码未入契约也未实现 | 03→01 | 低（需裁决是否纳入） | 03 提出、01 裁决 |
| D3 | §11 G3 写口 Connectors 侧零调用：门户分段进度无权威推进 | 02 vs §11 | **高（本轮最大功能缺口）** | 02 |
| D4 | §11 五阶段与 Connectors 七段游标之间无映射表（ROUND-LOG 建议映射未落契约/文档） | 02+01 | 中（D3 接线前置） | 02 主笔、01 登记 |
| D5 | R7 称 `material.` 前缀剥离"已同步 §11"，但 §11 正文无此语义 | 01 契约 | 中（共享冻结面缺句） | 01 |
| D6 | goal-04 验收矩阵 J1-1..J1-7 等仍全 BLOCKED，未随 03 路交付更新 | 04 文档 | 低（台账滞后） | 04 |
| D7 | DEFECTS.md 三条均 OPEN，与最新 journey 证据不同步（03 已转绿；01 失败语义已变） | 04 文档 | 中（影响合流判断） | 04 |
| D8 | goal-02 IR-02-A ①②③ 全 OPEN 无 owner 回填（①语义实际已被 §9/§11 覆盖） | 02→01 | 低 | 01 |

### D1 客户目录：IR 正文与 §11 形状不一致（文档陈旧）

- §11 G1 冻结形状：`GET /api/v2/customers?search=&limit=&cursor=`，响应 `{customers:[customerId,displayName,status,createdBy,createdAt], nextCursor}`，键集游标仅 `customer_id`，无 total（CONTRACT.md:199）。
- IR-03-1 正文仍写 `?offset=`、响应含 `tenantId/legalEntityRef/total/nextOffset`（docs/product-delivery/goal-03/INTERFACE_REQUESTS.md:19-26）。
- 实况：goal-03 文件顶部"状态更新"已声明 IR-03-1 **已满足（以 §11 为准）**，目录页消费真实 `{customers,nextCursor}` 并实测（goal-03/TEST_RESULTS.md 路径2）。ROUND-LOG #1 曾要求把 IR 改写为适配注记，正文未改。
- 建议：03 把 IR-03-1 正文标注"已由 §11 G1 取代，正文仅存历史"，防止后续读者按旧形状实现。

### D2 受限邀请：IR 正文旧形状 + 两个错误码未入契约

- §11 G2：两步码流（create 返回 `code` 明文仅一次 → redeem 返回凭据明文仅一次）、`POST .../revoke`、404/409/410 语义、受邀角色只存 DB、roles 恒 `['customer']`（CONTRACT.md:201-208；DECISIONS.md 任务01 节）。
- IR-03-2 正文仍写：create 即返 `inviteCredential` 一步流、`DELETE` 撤销、过期 403、`roles=[customer,<role>]`、409 `INVITATION_ROLE_NOT_ALLOWED`/`INVITATION_LIMIT`（goal-03/INTERFACE_REQUESTS.md:28-37）。
- 实测：Edge/页面按 §11 实际语义走通（goal-03/TEST_RESULTS.md 路径3-6：code 明文一次、撤销、409 ALREADY_USED、replayed:true 对账）。`Back/A/src/domain/errors.ts:49-69` 确无 ROLE_NOT_ALLOWED/LIMIT 两码；角色白名单由迁移 009 CHECK 约束；"每客户在途邀请上限"策略未见任何登记。
- 建议：正文同 D1 处理；是否需要"在途上限"属业务政策，须用户/01 裁决后另行走契约登记，不得由实现侧私自补。

### D3 G3 处理状态写口：Connectors 未接线（功能缺口）

- §11 对消费方约束："Connectors 协调器如需推进 A 侧处理状态，经服务身份调 G3 写口（确定性 requestId 纪律同 a_register），不得直写 A 表"（CONTRACT.md:218）；ROUND-LOG 2026-09-18 巡检 #1 已列为 02 路动作项（ROUND-LOG.md:19-22）。
- 实测：`Back/Connectors/src/evidence/a_bridge.mjs` 与 `coordinator.mjs` 全文无该写口调用（grep `}/processing`、`runRef` 仅命中 analysis-runs 的本地变量，零 G3 语义）；goal-02 全套文档（DESIGN §2 消费契约表、HANDOFF、TEST_RESULTS）亦未引用 §11/G3 写口/my-materials。
- 后果链：A 侧 `artifact_processing` 无生产者 → `my/materials` 投影 stage 恒 `registered` → goal-03 客户门户"我的材料"分段进度无权威推进（goal-03/TEST_RESULTS.md §3 已如实标注"处理进度 stage 推进｜依赖 02"）。goal-03 页面侧已按 G3 投影消费，02 一旦接线页面无需改动。
- 替代消费面（页面暂不可用）：Connectors 本地 `GET /api/connectors/processing/status`（IR-02-C，e2e 覆盖）——Edge 未透传该面。
- 建议：02 在 `register_material/parse/analyze/questions/失败` 各段按 D4 映射调 G3 写口；此项应列入合流 PR 的 OPEN 项，不得以"接口存在"宣称闭环。

### D4 阶段映射表缺失

- §11 G3 阶段=`received/parsed/analyzed/needs_review/failed`；Connectors 游标=`register_material→unzip→parse→facts→analyze→questions→register_results`。ROUND-LOG 给出建议映射（register_material→received、parse→parsed、analyze→analyzed、人工→needs_review、失败→failed）但未落 CONTRACT §11 或 goal-02 文档。
- 建议：02 接线（D3）时先把映射表写进 §11 或 `docs/product-delivery/goal-02/`，再实现，避免两侧各说各话。

### D5 §11 正文缺 `material.` 前缀剥离语义（契约缺记）

- goal-01 DESIGN §6 R7：授予面比对按剥离 `material.` 前缀后的原始种类执行，落库保持原样，并称"契约正文已同步 CONTRACT §11"（docs/product-delivery/goal-01/DESIGN.md §6）。
- 实况：代码已实现（`Back/A/src/domain/identity.ts:397-404`）；02 路确实以 `material.<kind>` 命名空间登记（DEF-G04N-02，goal-04/DEFECTS.md）；但 §11 G2 授予面文字只写"kind 必须 ∈ 其 allowed_kinds"（CONTRACT.md:207），无前缀语义。DECISIONS.md 任务01 节有记载，但 §11 是共享冻结面。
- 影响：后续消费方按 §11 字面实现（送原始 kind 或按字面校验）都会与实现不符。
- 建议：01 在 §11 G2 授予面句补"（比对按剥离 `material.` 前缀后的种类执行；落库保持调用方原样）"。一句话，无语义变更。

### D6 goal-04 验收矩阵状态滞后

- ACCEPTANCE_MATRIX.md J1-1..J1-7、N、DC、T 各项仍标 BLOCKED（goal-04/ACCEPTANCE_MATRIX.md:9-53），其 D1 冻结时点早于 03 路交付；而 goal-03 已交付工作本/门户并实测 13 条页面路径 PASS。
- 性质：台账滞后非事实冲突——04 路纪律是"固定快照上逐条对页面实测"，J1 尚未在固定快照重跑，故不能改 PASS。但合流读者只看矩阵会误判进度。
- 建议：04 在矩阵加一列"当前最新证据指针"（指 goal-03/TEST_RESULTS §2 与本报告 §三），状态词不变；合流后在固定快照重跑 J1 再改状态。

### D7 缺陷台账与最新证据不同步

- DEFECTS.md 三条均 OPEN（goal-04/DEFECTS.md:7-9）。最新 journey 复跑证据（晚于 TEST_RESULTS R3 所引 5 份）：
  - `evidence/d2/first-file-1789748039131.json`（2026-09-18T16:13Z）：**38/39 门禁过**；金丝雀 `xlsx:no-zip-container-mishandling`（DEF-G04N-03）**ok=true**——02 的 coordinator 修复（`coordinator.mjs:472-475` XLSX 整体交 parse 段）已被 04 路复测证实，台账未标"已复测关闭"。
  - 同文件金丝雀 `kd:register-results-reaches-a`（DEF-G04N-01）仍 ok=false，但失败语义已从"13/13 任务 400 INVALID_INPUT requestId、解析结果永不到达 A"变为"仅 1 个任务失败于 ZIP 穿越条目 `../escape.txt` 登记"——P1 的主体（结果不到 A）已收敛，剩余语义需 02/04 重定性。
  - 前一次复跑 `first-file-1789747839869.json`（16:10Z）出现 analysis-runs/start 409 STALE_BASIS（激活版本缺失），说明该轮 harness 种子步骤有抖动——判读时以 16:13 轮为准并注意环境前提。
- DEF-G04N-02：A 侧剥前缀修复+V4 扩展用例在（identity.ts:397-404；goal-01/HANDOFF.md 待办节），**运行时验证 PENDING**（2026-09-18 16:44 Docker 引擎未运行，jw-goal01-pg@15446 起不来）。
- 建议：04 按台账自定规则把 G04N-03 标"已复测关闭（引 16:13 证据）"、G04N-01 改写剩余失败语义、G04N-02 标"代码修复在、运行时验证 PENDING（owner 01，Docker 恢复后跑 V4）"。

### D8 goal-02 对 01 的三项登记 OPEN 未回填

- IR-02-A ①回执归属过滤语义确认、②customerId↔aCustomerId 权威映射（§11 G1/G2 已给权威面，`a_customer_links` 静态种子降级为兼容路径未做）、③检查会话问题通道合并裁决（02 未双写）——状态表全 OPEN（goal-02/INTERFACE_REQUESTS.md:50-55）。
- ①实质已被现行契约覆盖（§9 幂等回执按主体归属；goal-02 已按原 principal 对账实现并经 G-A1 真内核 e2e），只差 01 一句确认；③是业务裁决非代码。任务书明确"不得把必要接口长期标 OPEN 后自称任务完成"。
- 建议：01 对①书面确认、②标注降级路径时点、③提请用户裁决。

### A1 归属注记（.gitignore 与目录 ownership）

- `.gitignore` 本轮唯一改动 = goal-03 加的 3 行 g03c 运行态忽略（`g03c-auth.json`/`g03c-runtime.json`/`.run-g03c/`），goal-03 HANDOFF 变更集自报在案（goal-03/HANDOFF.md:58）；被忽略文件均为本地生成的凭据/运行态，不入库正确。
- `docs/product-delivery/` 顶层由 04 路建骨架（goal-04/BASELINE.md BC-1 将其记为本路所有），实际为四路子目录+ROUND-LOG（监控会话）+本报告（审计）；根部交付说明定稿权在 04（任务书《四路唯一修改者》），本审计只出草案。合流 PR 描述应写明此归属，避免后续 writer 争抢。

---

## 二、main 合流说明（草案）

### 2.1 分支与 PR 路径

- 现状：`origin/main = b6bea23`（PR#4 merge，已含 e4ed7a5）；本分支与 main 同基，**全部本轮成果都在未提交的工作树里**（约 40 个修改文件 + 全部新增文件，git status 实测）。
- 建议路径：按路切片提交（01=A/契约/迁移009；02=B/C/Connectors；03=Front/Edge-src/contract/.gitignore；04=Back/D/e1/scripts；docs=各路文档+本报告+根部草案；Front/dist 成对删除/新增单独一个 commit），推上 `v02-goal1234-delivery`，开 **PR#5（base main）**。未经用户授权不 commit/push——切片方案仅供参考。
- 合流前必须由用户裁决的两件事：R2（证据 .log 入库方式）、R3（任务书包入库与扁平化）。

### 2.2 PR 描述草案（可直接粘贴修改）

> **标题**：goal-01~04 四任务产品交付：v2.4 页面办理服务面 / 原件处理链接通 A / Edge 客户工作本与门户 / 验收驱动器与缺陷台账
>
> **基线**：`v02-goal1234-delivery@e4ed7a5`（=已合并的 PR#4 头）。四路并行、单文件单 writer；审计报告见 `docs/product-delivery/round-report.md`。
>
> **任务01（Back/A/契约）**：CONTRACT §11 v2.4 加法登记（客户目录 G1 键集分页/grants 过滤；受限邀请 G2+customer_identities 动态身份+撤权级联；材料处理状态 G3 服务回执制+my/materials 白名单披露）；迁移 009 只增不改；修复 B13 混合角色越权（every→some）、游标微秒截断、撤权级联缺失；R1–R7 冻结后修订（含 DEF-G04N-02 前缀剥离）。测试：A 120 项（基线 114+新增 V1–V6）最终代码态通过证据，0 fail/1 skip；契约消费方接线说明见 goal-01/HANDOFF。
>
> **任务02（B/C/Connectors）**：A 桥贯通（材料登记→analysis-runs→Gate 回执→findings→回执对账，unknown 不换 ID）；C 解析适配器 v2（引号 CSV 状态机/非法日期/合计行/XLSX/text-PDF）；解析缓存键含声明元数据；人工录入/更正/复核后端；默认测试入口修复（Connectors 0→71 用例、B 补挂 3 文件 83→105）。测试：Connectors 71/71、B 105/105、C 100/100、a-bridge 2/2；perf 双臂 2642→1560ms、域计算 80→26、外发 100→5。
>
> **任务03（Front/Edge）**：客户工作本六页签+客户门户+受控登录（无角色下拉/提权）；Edge 受控身份目录、受限原件上传（信封 v0≤512KB）、匿名兑换透传、GET 只读透传面扩容、proxy 白名单扩展；dist 重建（同源托管）。测试：Edge 41/41（新增7）、Front 19/19、typecheck 0 error；真实浏览器 13 条用户路径 PASS（含撤权级联/授予面负例/重放对账）。
>
> **任务04（Back/D/e1/scripts）**：D1 冻结旅程与判据、D2 首件驱动器 `journey-first-file.mjs`（12 件真实字节→上传→处理→A 登记，门禁 36/36；最新复跑 38/39）；delivery-up/down `--db-container`、edge-start/stop `--run-dir`；缺陷台账 DEF-G04N-01/02/03（状态见 round-report §一 D7，非全绿）。
>
> **审计产物**：`docs/product-delivery/round-report.md`（§11 一致性分歧 D1–D8、合流风险 R1–R8、人可完成动作汇总）；根部 `DELIVERY-BRIEF-draft.md`（草案，04 路定稿）。
>
> **如实 OPEN（不冒充完成）**：G3 写口 Connectors 侧未接线（D3）；§11 缺 material. 前缀句（D5）；DEF-G04N-01 剩余单任务失败、G04N-02 运行时验证 PENDING；IR-03-3 原件读回、IR-03-4/6/7；方案→批准→激活全链被 BASIS_PACKAGE_REQUIRED 诚实阻断；D27-R/S 单列。
>
> **复审要点**：R1–R8（round-report §2.3）——尤其证据 .log 的入库方式与任务书包扁平化需先行裁决。

### 2.3 风险清单

| # | 风险 | 事实 | 建议 |
|---|---|---|---|
| R1 | `.gitignore` g03c 运行态条目归属 | 本轮 diff 仅 +5 行（goal-03 的 3 条忽略+注释）；被忽略文件是本地凭据/运行态，不入库正确（git diff .gitignore 实证） | 随 03 切片入库即可；PR 描述注明归属 03。低风险 |
| R2 | **回归证据日志不入库** | `**/*.log`（.gitignore:25）吞掉 goal-01 `evidence-shard-1..4.log`/`shard-2.retry`/`evidence-regression-full.log`（共 1157 行 TAP）与 backend-upgrade 各 evidence log；`git check-ignore` 实证，且 backend-upgrade 的 log 本就未跟踪——main 上历来没有这层证据 | 二选一：(a) `git add -f docs/product-delivery/goal-01/*.log`；(b) 加窄化负模式（如 `!docs/product-delivery/**/*.log`，勿放开运行态目录）。若不入库，TEST_RESULTS 须注明"证据仅本地留存"。**需用户/04 裁决** |
| R3 | 任务书包 `JW_product_delivery_four_tasks/` 是否入库 | §11 与四路 HANDOFF 共同引用的需求冻结源；MANIFEST.json 带六文件 sha256（R0 已核对，goal-04/evidence/d1/manifest-check.json）；盘上是**嵌套同名目录**（`JW_product_delivery_four_tasks/`） | **建议入库**（公开仓库资料取向+全部文档引用它），但先扁平化一层，否则 Git 路径与所有文档引用不一致；`FOUR_TASKS_COMPLETE.md`（31KB）与分文件内容重复，按"原件不删"原则一并保留并注明冗余。**需用户裁决** |
| R4 | 根 DECISIONS/CHANGELOG 只有 01/03 登记 | git diff 实证：DECISIONS +22 行（goal-03、任务01 两节）、CHANGELOG +4 行（任务01）；02 明示"集成方摘录本 CHANGELOG"（goal-02/HANDOFF §5），04 无根登记 | 合流 PR 补 02/04 两段摘录（或注明"以各路 CHANGELOG 为准"），否则 main 根部台账缺两路 |
| R5 | 在制缺陷带入 main | DEF-G04N-01 剩余单任务失败（ZIP 穿越条目）、G04N-02 运行时验证 PENDING、IR-03-4/6/7、D27-R/S | PR 的 OPEN 节如实列出（2.2 草案已含）；不得写"全绿" |
| R6 | 未跟踪文件全集必须盘点入 PR | 新增源码/测试：A（009 迁移/identity.ts/invitations 测试）、C（parse-adapters-v2 测试）、Connectors（a_bridge+3 测试）、Edge（readproxy/g03c 测试）、Front（workbench 11+4 文件/wb-logic 测试）、`Back/D/product-journey/`（134KB 含 .originals 原件字节，自带 .gitignore）、`docs/backend-upgrade/goal-02/evidence/perf-*.json`、`docs/product-delivery/` 全目录 | 切片提交时逐一对照 git status；`Back/D/product-journey/.originals/` 建议入库（journey 复现依赖，R3 证据 sha256 对账锚点） |
| R7 | Front/dist 指纹替换 | 旧 2 assets 删除、新 2 assets+index.html 替换（用户明确要求 dist 入库发布） | 成对提交；Edge `--serve-front` 同源托管已实测（goal-03） |
| R8 | 无单一固定快照全绿证据 | 各路套件各自绿，但 04 的 e1 全链（R2.1）跑在四路在制中途；J1 页面验收未在固定快照重跑 | 合流 PR 分支上补跑一轮：`e1-g04-fullchain` + 各路默认入口（A 用 `node --test --test-concurrency=1 test/*.test.mjs` 直跑，`npm test` 吞 TAP——goal-01/TEST_RESULTS 已登记），结果附 PR |

---

## 三、按"人能完成哪些动作"汇总四路交付状态

Owner：01=Back/A/契约 writer；02=B/C/Connectors writer；03=Front/Edge-src writer；04=Back/D/e1/scripts/发布装配 writer。任务书共同完成标准：普通客户与业务人员经一次安装+管理员初始化后，全程页面办理，无开发者陪同。

### 3.1 完成（有页面级证据，goal-03/TEST_RESULTS §2 十三条路径全 PASS）

| 人能做的动作 | 证据 |
|---|---|
| 受控登录（身份目录选择+凭据；无角色下拉/提权；训练/演示显式分开） | goal-03 TEST_RESULTS 路径1；DECISIONS goal-03 节 |
| 业务：客户目录（权威清单/搜索/新建/授权过滤，零内部 ID） | 路径2；§11 G1 |
| 业务：受限邀请创建（角色×材料白名单×有效期）/清单/撤销，code 明文仅一次 | 路径3；§11 G2 |
| 客户：邀请码兑换→进门户（仅获准披露）；授权内上传；授权外上传被拒（PERMISSION_DENIED，零写入） | 路径4/5 |
| 客户/业务：已用 code 重放 409、同 requestId 对账 replayed:true、撤权级联即刻失效（C3） | 路径6/11 |
| 业务上传真实文件（浏览器真实字节→Edge 信封 v0→A 落库，核验等级不提升） | 路径7 |
| 检查会话：材料前提校验（缺材料诚实 NOT_READY）、提问（受众/目标角色） | 路径8 |
| 方案页：决策状态/Gate/评估候选展示；正式动作二次确认+幂等；提案被 BASIS_PACKAGE_REQUIRED 诚实阻断（绿色≠授信通过） | 路径9 |
| 结果留存：报告三视图生成/导出（缺主体时显式提示）、事件窗口、回执对账入口 | 路径10 |
| 刷新/重登后状态来自服务端（Edge 会话 TTL 30 分钟如实告知） | 路径12 |
| 性能抽测：workspace p50=104ms/p95=131ms；读透传 p50≈20–24ms | 路径13 |

### 3.2 完成（服务级，页面未覆盖）

- **一份原始文件全链**：12 件合成原件（CSV/XLSX/text-PDF/PNG/ZIP/后到不利）真实字节→受限邀请→上传→处理（register_material 经 aBridge 幂等登记 A→unzip→parse→facts→analyze）→A 侧 sha256 对账；门禁 36/36（R3），最新复跑 38/39（D7）。owner 04（驱动器）+02（链）。
- Connectors 消费面：分段进度/人工录入/更正/复核/预览签名 URL/暂停（IR-02-C，e2e 覆盖）。owner 02。
- 三路默认测试入口真实可跑（Connectors 71、B 105、C 100；修复"0 用例假绿"）；A 120 项最终态通过。owner 02/01。
- 全链既有集成回归 e1-g04-fullchain 1/1（22 组判据）。owner 04。

### 3.3 在制（有明确 owner 与下一步）

| 项 | owner | 下一步 |
|---|---|---|
| G3 写口接线（门户分段进度权威推进）+阶段映射表 | 02（01 配合登记） | 按 D4 映射调写口；§11/文档补映射 |
| §11 补 `material.` 前缀句 | 01 | 一句话加法修订 |
| DEF-G04N-01 剩余单任务（ZIP 穿越条目登记失败）定性 | 02 定性、04 复测 | journey 金丝雀复跑 |
| DEF-G04N-02 运行时验证 | 01 | Docker 引擎恢复后跑 V4 扩展用例（jw-goal01-pg@15446） |
| DEFECTS/验收矩阵台账更新（D6/D7） | 04 | 按 16:13 证据改标 |
| IR-02-A ①②③ 回填（③提请用户裁决） | 01 | 书面确认/降级时点/裁决 |
| IR-03-3 正式原件读回/预览、IR-03-4 权威清单、IR-03-6 问题明细、IR-03-7 Edge DELETE 代理 | 01/03 | 见 goal-03/INTERFACE_REQUESTS 状态节 |
| 包域结果登记（代码就绪、默认关、无真内核全链用例） | 02+业务侧 | 依据包冻结声明协同后开真链用例 |
| 根 DECISIONS/CHANGELOG 补 02/04 登记、安装说明+备份/恢复 runbook（J1-0 装配） | 集成方/04 | 合流 PR 内完成 |
| 证据 .log 入库方式、任务书包扁平化入库（R2/R3） | 用户裁决 | 裁决后随 PR 执行 |

### 3.4 BLOCKED / 单列未决（不冒充完成）

| 项 | 状态 | 依据 |
|---|---|---|
| J1-0..J1-7 固定快照浏览器验收（硬门 D27-L-UI） | BLOCKED（等装配+前三路收敛后由 04 在固定快照重跑） | goal-04/ACCEPTANCE_MATRIX §A；USER_JOURNEY §4 |
| 方案→批准→激活全链 | BLOCKED（结构性诚实阻断：等 01/02 Gate 回执+必需域政策+域结果接入；未开兼容核是正确行为） | goal-03/TEST_RESULTS §3 |
| D27-R 真实媒体/模型、OCR/ASR/真实渠道 | BLOCKED（无获准提供方，未授权） | goal-04/ACCEPTANCE_MATRIX §E；goal-02/HANDOFF §4 |
| D27-S 多人空间/三维 | 不建设，不阻二维硬门 | 同上 |
| 真人非开发试用（人证轮） | NOT_RUN（D4 组织） | goal-04/USER_JOURNEY §4 |
| 生产化项（HTTPS/Cookie/限流/客户凭据存续/Edge 会话持久化） | 未开工（S3 既定边界） | goal-03/HANDOFF 已知边界 3/4；goal-01/HANDOFF redeem 无限流注记 |

---

## 四、证据指针附录

- 契约：`Back/CONTRACT.md` §9（v2.2）/§10（v2.3）/§11（v2.4，G1=199 行段、G2=201-208、G3=210-218）。
- goal-01：`docs/product-delivery/goal-01/{HANDOFF,TEST_RESULTS,DESIGN,INTERFACE_REQUESTS}.md`；回归证据 `evidence-regression-full.log`+`evidence-shard-1..4.log`（+shard-2.retry；**当前被 .gitignore 吞，见 R2**）；A 侧前缀修复 `Back/A/src/domain/identity.ts:397-404`。
- goal-02：`docs/product-delivery/goal-02/{DESIGN,HANDOFF,TEST_RESULTS,INTERFACE_REQUESTS,SUPPORTED_FORMATS}.md`；`evidence/test-{b-npm-test,c-run-all,connectors-npm-test,goal02-a-bridge}.txt`+`perf-goal02-1789683060822.json`。
- goal-03：`docs/product-delivery/goal-03/{HANDOFF,TEST_RESULTS,INTERFACE_REQUESTS,PAGE_INVENTORY,BASELINE}.md`；消费面契约 `Back/Edge/contract/consumed-surface-v1.json`（goal03c-2）；种子工具 `tools/seed-g03c.mjs`。
- goal-04：`docs/product-delivery/goal-04/{ACCEPTANCE_MATRIX,USER_JOURNEY,TEST_RESULTS,DEFECTS,BASELINE}.md`；journey 证据 `evidence/d2/first-file-*.json`（最新=1789748039131，2026-09-18T16:13Z）；D1 盘点 `evidence/d1/{manifest-check,ports}.json/txt`。
- 根部登记：DECISIONS.md（goal-03 节、任务01 节）、CHANGELOG.md（任务01 节）——02/04 缺登记见 R4。
- 代码事实核验：G3 写口零调用（grep `Back/Connectors/src` 无 `}/processing`）；XLSX 整体解析修复 `Back/Connectors/src/processing/coordinator.mjs:472-475`；INVITATION 错误码集合 `Back/A/src/domain/errors.ts:49-69`。
- 跨会话协调：`docs/product-delivery/ROUND-LOG.md`（2026-09-18 巡检 #1，D3/D4 的出处）。
