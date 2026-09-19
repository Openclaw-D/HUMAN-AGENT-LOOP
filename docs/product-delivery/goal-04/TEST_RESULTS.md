# 任务四｜测试结果（TEST_RESULTS.md）

每次运行一节：时间、快照（git describe + dirty）、环境（登记端口/容器）、范围、结果（PASS/FAIL/BLOCKED/NOT_RUN 计数）、证据路径。运行环境快照先抄 BASELINE.md §1/§5，有变化注明。

## R0｜D1 基线盘点（2026-09-18）

- 快照：main@1ec0ee4，工作区仅含未跟踪任务书包 `JW_product_delivery_four_tasks/`。
- 范围：非执行性盘点——任务包 MANIFEST sha256 核对、迁移 001–008 跟踪核对、运行资源清单、自有端口段空闲核对。
- 结果：盘点完成，无测试执行声明（不算 PASS/FAIL）。
- 证据：`evidence/d1/`（manifest-check.json、ports.txt）。

## R1｜D2 首次自有段冒烟（2026-09-18）

- 快照：`v02-goal1234-delivery@e4ed7a5` + 在制修改（01/02/03/04 四路并行中；见 BASELINE.md §0 BC-1）。
- 环境（BASELINE §5 登记段）：`jw-g04b-pg`@15452（本日新建，卷 jw_g04b_pgdata）→ A@48282 → Edge --live@17931；身份目录/矩阵种子来自 Git 排除的 delivery-runtime.json（9 合成身份 + 合成政策 SQL）。
- 步骤与结果（delivery-up.mjs 实跑）：
  1. PG 新容器首启 → 迁移 001–008 全部应用 ✓
  2. 权限矩阵幂等播种 ✓
  3. A 内核 /healthz：ok、db up、principalVerifier configured、contractVersion `v1.3+v2.1-credit+decision-loop(task01+task02)` ✓
  4. Edge --live /healthz/ready：`ok:true`（kernel-a 200 + db tcp ok，逐依赖独立报告，无 all_ok 汇总）✓
  5. /versionz 版本封存：如实报 sourceDirty=true 与 15 个在制路径 ✓
- 本轮为此修复的验收工具（本路所有文件）：delivery-up/down 增 `--db-container`；edge-start/stop 增 `--run-dir` 隔离实例（并行 Edge 不再被前会话实例的默认 pidfile 拒绝双开——任务书 §5"并行环境串用"项）。
- 未验声明：本轮只证"栈可起、探针绿"；用户旅程（J1）与 B/C 处理链未跑，不在本条结论内。
- 遗留观察：delivery-up 前台监督进程退出后其 A 子进程未存活（Windows 下 detach 行为待查）；对人工部署影响待 D4 评估，自动化验收改由 g04-chain 类 harness 直接驱动组件。
- 运行态：监督进程保持后台运行（Edge@17931/A@48282/PG@15452），供下阶段接通第一份原始文件使用。
- 证据：`evidence/d1/ports.txt`（运行时端口快照）、`Back/Edge/.run/delivery/kernel.log`（A 启动日志，Git 排除）。

## R2｜D2 跟随集成：在制树全链复跑 + 首件驱动器（2026-09-18）

- 快照：`v02-goal1234-delivery@e4ed7a5` + 四路在制（与 R1 同，另见下方"在制观察"）。
- **R2.1 F 系列全链复跑**：`node --test test/e1/e1-g04-fullchain.test.mjs` → **1/1 PASS（30.9s，22 组判据：进件幂等→材料→检查会话问答/补证/核验→Gate 回执→四域依据包→包绑定提案→有权批准/激活→并发占额/超占/重放→撤权即断→HOLD 阻断→STALE_BASIS→deps_changed→kill 内核中断恢复→SSE 零串线）**。三条并行路的在制修改未破坏既有集成链。
- **R2.2 首件旅程驱动器**：`Back/D/product-journey/journey-first-file.mjs` 建成——生成器原件真实字节 → Connectors intake 受限邀请/上传 → 持久处理（register_material 经 aBridge 登记 A → unzip → parse → facts）→ A 侧 `content.sha256` 与原件 manifest 对账。运行环境：jw-g04b-pg@15452 内 journey 专用库（jw_g04j/cnext_g04j）、A@17933、Connectors@17935，合成身份/合成签名密钥，用后即清。
- **R2.3 在制观察（非缺陷，实时状态）**：运行中途撞上 02 路正在写入 `Back/C/src/parse/adapters.mjs`（+588 行，出现 PDF 文本提取器与 OCR 方向代码），其间瞬时语法损坏（注释含 `*/` 提前闭合）导致依赖其模块的组件暂时无法加载。按并行纪律只报告不代修，待其收敛后重跑 R2.2。此事件本身证明：02 路正在兑现"可提取文本 PDF"承诺，我的原件包中合同 PDF 的期望（人工路线 vs 文本抽取）需随其交付版本对齐。
- 结论：集成回归绿；首件链路验证 **PENDING**（等 02 路适配器文件收敛，重跑 journey-first-file）。

## R3｜D2 里程碑：接通第一份原始文件（2026-09-18）✅

- 快照：`v02-goal1234-delivery@e4ed7a5` + 四路在制（02 路适配器已收敛至 parse-adapters@2，含银行 CSV v2、键值文本、**PDF 文本抽取 pdf-text@1**、图片/未知格式显式人工路线）。
- 运行：`node Back/D/product-journey/journey-first-file.mjs`（合成身份/合成密钥；jw-g04b-pg@15452 专用库；A@17933；Connectors@17935；用后即清）。
- **链路（全部真实字节，无预填）**：生成器 12 件原件（一致组 7 + 失败样本 4 + 后到不利 1）→ 业务建客（A v2）→ Connectors 受限邀请/接受 → 客户凭据上传 base64 原件字节 → 持久处理任务（register_material 经 aBridge 幂等登记 A → unzip → parse → facts → analyze）→ 只读侧断言。
- **门禁 36/36 全过**，要点：
  - 银行流水（无引号与引号+千分位两变体）合计均=真值 1,664,500/826,900，TOTAL 合计行被显式剔除且留痕（`total_rows_excluded` 质量标记）；事实为 candidate 级。
  - 坏日期行/非数值行剔除且有效行保留（X1: 621,500/198,400；X2: 1,000）。
  - **可提取文本 PDF 自动解析且 8 个事实与隐藏真值逐项一致**（总价 2,180,000.00、设备序列 DEV-2024-08871、信用代码、日期）——02 路新 pdf-text 适配器兑现了任务书承诺。
  - PNG（铭牌/现场）与未知格式明确转人工入口（manualEntry=true），零伪造事实；ZIP 路径穿越被 zipguard 拒绝且无文件落盘逃逸。
  - **可追溯性**：12/12 件字节 sha256 与生成器 manifest 一致（对象存储未改字节）；a_links 幂等登记至 A；A 侧 kind=material.<种类>、客户上传 grade=unverified。
- **缺陷复现项 2 个仍复现**（金丝雀，非门禁）：DEF-G04N-01（register_results 400，解析结果未达 A，P1）、DEF-G04N-03（XLSX 当 ZIP，P2）→ 详见 DEFECTS.md；另立 DEF-G04N-02（kind 命名空间结构风险，01+02）。
- 结论：**D2「尽早接通一份原始文件」达成**——原件→受控上传→解析→A 权威登记全链在真实字节层面打通并可追溯。页面层旅程（J1）仍 BLOCKED 等 03 路交付。
- 证据：`evidence/d2/first-file-*.json`（checks/observations/artifacts 全量）。

（后续运行按模板追加）

## R4｜D2→D3 缺陷复测关闭轮（2026-09-19）✅

- 快照：`v02-goal1234-delivery@e4ed7a5` + 四路在制（02 路修复 a_bridge/coordinator/parse-adapters 落于 R3 金丝雀之后：a_bridge.mjs 05:33、coordinator.mjs 05:59、service.mjs 06:02；01 路 A 侧 kind 前缀收敛 credit.ts 16:46）。
- 环境：`jw-g04b-pg`@15452（容器 start；journey 专用库 jw_g04j/cnext_g04j 用后即清）、A 内核@17933、Connectors 进程内@17935（`journey-first-file.mjs` 自管，与登记段 A@48282/Edge@17931 错峰）。运行前核对：无其他会话在制写入（repo 内 mtime 均早于当日）、17933/17935 空闲。
- 命令：`node Back/D/product-journey/journey-first-file.mjs`（本路文件两处修订，均为驱动器自身缺口非他路代码）：
  1. 补 admin 一次性初始化「激活规则包版本」（USER_JOURNEY J1 前置动作；版本动态读自 C 规则包 1.0.0）。缺此步时 A 对分析运行 fail-closed 报 STALE_BASIS——那是正确行为，此前金丝雀未做该前置。
  2. DEF-G04N-01 探针收窄为「失败于 register_results 阶段的任务数」（原探针把任何 failed 任务都计入，会把 X4 路径穿越样本被 zipguard 按设计拒绝——x4 门禁的通过条件——误计为本缺陷）。
  3. 新增 [4.5] DEF-G04N-02 定向复测段（真实邀请兑换→cit_* 凭据→`material.<kind>` 命名空间正反两例）。
- 结果：**门禁 41/41 全过；缺陷复现项 0/2 复现**：
  - **DEF-G04N-01 关闭**：register_results 全部 `done`；解析事实/Gate 回执/分析运行/包域结果真实到达 A（aBridge v2 面：runs/Gate 回执/findings/包域结果），0 任务失败于 A 结果登记。
  - **DEF-G04N-03 关闭**：XLSX 走专用适配器 `unzip:skipped→parse:done`，派生子件 0，零垃圾声明事实。
  - **DEF-G04N-02 关闭**（跨路黑盒复测）：business 建邀请（allowedKinds=[bank_statement]）→ 匿名兑换得 cit_* → `material.bank_statement` 登记 200；`material.ledger_book` 403 PERMISSION_DENIED。A 侧剥前缀比对（credit.ts 注释显式标注本缺陷）+ 01 路终验日志（goal-01/evidence-invitations-final.log 6/6，含 V4 授予面强制）互证。
  - 其余门禁维持 R3 全绿：CSV 引号/千分位、坏行剔除、PDF 文本抽取逐项真值、图片/未知格式人工路线、ZIP 穿越 zipguard 拒绝、字节 sha256 对账、后到不利材料期间标记。
- 结论：D2 三缺陷全部复测关闭；**02/01 路在制树的首件链路当前为绿**。页面层旅程（J1）推进见 R5。
- 证据：`evidence/d2/first-file-1789748291415.json`（41 checks 全 ok + defectProbes 全 ok）。

## R5｜D3 固定快照：version-seal + 页面层旅程 J1.1–J1.7 + 性能 3 轮（2026-09-19）

- 快照：**version-seal buildId=`521bdc0e2f60246e`**（gitSha e4ed7a5 + 在制 60 路径，dirty 如实在案；契约 v1.3、迁移 9 个至 009、dist 3 文件指纹、规则包指纹）。D3 全部运行钉在此快照上。
- 环境（BASELINE §5 登记段，`delivery-up.mjs` 实跑）：`jw-g04b-pg`@15452（db `jw`）→ A@48282 → Edge@17931 `--live --serve-front Front/dist`（同源托管，goal-03 C3 交付形态；本轮为 delivery-up 补 `--serve-front` 透传）。`/healthz/ready` ok=true（kernel-a 200 + db tcp ok 逐依赖独立报告）；运行前核对与他路错峰（注：00:24 起 01 路恢复在制写入 `Back/A/src/config.ts`——栈已加载不受影响，如实记录）。

### R5.1 页面层旅程 J1.1–J1.7（4 个隔离浏览器会话实测）

- 逐条结果（证据 `evidence/d3/page-journey-J1.json`）：
  - **J1.1 PASS**：biz1 页面建客户（零内部 ID）→ 受限邀请（角色×种类白名单×有效期，二次确认弹窗+幂等编号提示）→ 邀请码明文仅显示一次 → 列表服务端权威、撤销可用。
  - **J1.2 BLOCKED（处理推进；上传通道 PASS）**：客户凭码兑换（cit_*）进门户，真实字节上传 2 件（bank_statement 40,960B / purchase_contract 24,576B），服务端强制种类白名单；状态止于「已登记（待处理）」——分段解析进度无常驻服务推进（交付形态未接 Connectors；IR-03-3 v0 直入 A）。owner 02/03。
  - **J1.3 BLOCKED**：页面无解析观测/来源定位/版本追溯面，且交付形态无解析产物可追溯（同快照 API 层追溯=R4 金丝雀）。owner 02/03。
  - **J1.4 BLOCKED（新缺陷 DEF-G04N-05）**：页内消息双向发送均获服务端回执，但两端口均不渲染对端消息；检查会话页面只读展示（无发起入口，页面如实声明）；findings 登记表单在（未驱动=NOT_RUN）。owner 03。
  - **J1.5 BLOCKED（新缺陷 DEF-G04N-04，P1）**：cred1 页面创建评估成功；提交额度提案被服务端 409 `BASIS_PACKAGE_REQUIRED` 拒绝，页面以业务语言如实显示「正式动作必须绑定依据包」不伪造成功；交付运行时无 service 主体可冻结依据包 → approve/activate 页面不可达。owner 03+01。
  - **J1.6 PASS（记录留存）/BLOCKED（后到限制）**：撤销旧邀请新邀请重进后两件材料可见（跨会话留存）；刷新退回入口页（凭据不落浏览器存储为声明行为；客户联系人走撤销+重发的产品恢复路径）；后到不利材料限制不可验证（额度激活被 G04N-04 上游阻断）。
  - **J1.7 PASS**：双客户双会话结构隔离反证——客户 2 门户无客户 1 任何数据（ID/材料/文件名/消息均无泄漏；种类下拉选项文本不构成泄漏，已精确复核）。
- 汇总：**PASS 3（J1.1/J1.7/J1.6 留存半）+ BLOCKED 4 + NOT_RUN 0 冒充**——硬门 D27-L-UI **不判 PASS**，逐项如实上矩阵。

### R5.2 性能 ≥3 轮同环境（快照 buildId 521bdc0e2f60246e）

- 工具：`Back/D/product-journey/perf-d3.mjs`（本轮新写，对**运行中的冻结交付栈**连测，不重建栈=同环境）。
- 结果（证据 `evidence/d3/perf/round-{1,2,3}.json + summary.json`）：3 轮全部 BLOCKED 仅 `keySubmit`（DEF-G04N-04 同根因），其余六项指标实测一致：
  - 首屏（同源 html+主资产+登录态首数据）：total 47/65/64 ms；
  - 文件处理（交付页面上传路径 originals，真实 64KB 级字节 ×3 取中位）：42/34/46 ms；
  - 预审等待（评估→候选→送审页面动作链）：~86 ms（200/200/200）；
  - 跨角色同步（SSE 事件到达）：716/737/721 ms；
  - 查询调用数：HTTP 逐轮计数 + pg_stat_database 增量（synthetic-approx）逐轮留痕；
  - 资源峰值：A/Edge 进程 RSS 2s 采样逐轮留痕。
- 纪律：改善未来自跳过核验（全链每步 200 断言）；FAIL/BLOCKED 不汇总为 PASS。

### R5.3 未验与遗留（不冒充）

- 反例集 N-01–N-12 页面层未跑（API 层等价证据见 R4 金丝雀 12 件反例样本）；真人试用轮 NOT_RUN；D27-R/D27-S 单列未决。
- 运行态：交付栈监督进程保持后台（Edge@17931/A@48282/PG@15452）供复核；停止走 `delivery-down.mjs` 三证复核。
