# goal-04 · 缺陷与观察清单（独立验收轮 · 2026-09-17）

基线：`1ec0ee4`。本文件只记录 goal-04 独立复验与实跑发现；每条含复现条件、实际、预期、影响、原负责人。缺陷由对应 lane 修复，goal-04 不代修 A/B/C/Connectors/Edge-src/Front。**状态：执行中（随实跑追加）**。

## 缺陷

### DEF-G04-01（P1 · 交付工具 · owner：任务02/Back-B）B 的 `npm test` 漏挂 3 个测试文件（83≠105 假绿陷阱）
- **复现**：`cd Back/B && npm test` → `# tests 83 / pass 83`（exit 0）。实际测试目录另有 `fs-lock-recovery.test.mjs`、`inspection-dispatcher.test.mjs`、`question-arbiter.test.mjs`（显式逐文件跑 = 22 项，全过）。
- **实际 vs 预期**：`npm test` 只覆盖 12/15 个测试文件；审核修复轮新增的 W13/调度仲裁/检查派工测试不在默认入口。作者报告的"B 105/105"只在显式全文件调用下成立。
- **影响**：交付者与验收者用同一命令得到不同覆盖；CI/接手者按 `npm test` 会漏跑 22 项关键回归（文件锁死锁回收、问题仲裁、检查派工）。
- **证据**：`evidence/`（npm test 输出 83 项；三文件显式跑 22/22）。

### DEF-G04-02（P1 · 交付工具 · owner：任务02/Back-Connectors）Connectors `npm test` 在本机直接失败（0 用例执行）
- **复现**：`cd Back/Connectors && npm test`（= `node --test test/`）→ `Cannot find module '...\test'`（MODULE_NOT_FOUND）→ exit 1，`# tests 1 / pass 0 / fail 1`。
- **实际 vs 预期**：目录参数形式在本机 Node v22.23.1 + Windows 触发已知怪癖（同见 e1 README 记载）；显式文件列表 `node --test test/b1-intake.mjs …` 8 文件 = **50/50 全过**。
- **影响**：包自带的唯一测试命令是坏的；按 README/惯例跑测试的人得到的是"红"且零覆盖。作者报告 49/49 需注明实际调用方式与用例数差异（现测 50）。
- **证据**：`evidence/r04-connectors.log`（失败）、`evidence/r04-connectors-explicit.log`（50/50）。

### DEF-G04-03（P2 → 本轮已修复 · owner：goal-04/扫描器）扫描报告原样复制命中摘录（含密码 URI），存在二次泄漏向量
- **复现**：任意命中（如 `db_uri_with_password`）的 excerpt 以原文进入 `report.json`；该报告位于已跟踪 evidence 目录。若命中为真实密钥，exit 1 阻断提交的同时已把密钥写进仓库。
- **修复（goal-04 职责内，`Back/Edge/scripts/public-submission-scan.mjs`）**：(1) 摘录按类别脱敏——私钥/JWT/API key 不存摘录；凭据赋值只存键名+`***`；DB URI 抹密码段；(2) 扫描报告按 `schemaVersion: jw.d25-scan.v1` 结构化自排除（此前报告重扫会递归自指放大，REVIEW 41→278→334 即此根因）。
- **遗留**：修复前已跟踪的 `docs/customer-next/acceptance/evidence/d25-scan-20260916-*/report.json` 内含合成演示凭据摘录（逐条核对无真实秘密）；按"历史原文不改写"保留，登记于此。
- **证据**：`evidence/s03-scan-final.log`（HARD=0/REVIEW=53）、`evidence/s03-scan-final.json`（摘录全部脱敏）。

### DEF-G04-04（P2 · 测试隔离 · owner：任务01/Back-A）A 全量套件对共享环境并发敏感，独立复验两次因环境噪声 FAIL
- **复现**：(a) 与其他 A 测试运行共享 `jwcc` 容器并发时，A13 报 `relation "permission_matrix" does not exist`（测试库被并发运行干扰/迁移竞态）；(b) 本机 48200 被其他 lane 的 Edge 守护占用时，B08 的内核随机端口落在 48200 → EADDRINUSE → 启动失败。
- **实际 vs 预期**：作者报告 102 项 101pass/1skip 在安静窗口可复现（本轮 r1 由 goal-04 实跑 100 pass/1 fail/1 skip，两败均为环境噪声，非产品逻辑）；但套件随机端口范围（BASE_PORT+0..400）与共享容器假设使其在多 lane 并行开发机上不可靠。
- **建议**：A 测试端口范围参数化并避开 48100–48300（Edge/交付段）与 17900+（E1 段）；或每套件独立容器。owner 决策。
- **证据**：`evidence/r01-A-full.log`（A13）、`evidence/r01-A-full-rerun2.log`（B08 EADDRINUSE）。

### DEF-G04-05（P1 · 功能缺口 · owner：goal-01，**在制修复中**）错设备证据无对象锚定结构（F-19）
- **复现**：g04 链中创建引用未登记设备 `DEV-GHOST-404` 的融资申请 → 200 成功；equipmentRefs 为自由字符串，无设备登记、无"材料锚定对象 vs 核验项锚定对象"比对。
- **预期**：设备 B 的照片不满足设备 A 的核验；错设备证据应显式失配而非静默通过。
- **现状**：goal-01 正在制实现（`EVIDENCE_OBJECT_MISMATCH` + `test/evidence-object-match.test.mjs`，本轮实测其在制编辑窗口 2026-09-18 00:13–00:21 起有记录）。落地后需以新判据重跑 F-19；本报告先记缺口，不冒充已验。
- **证据**：`evidence/f-series-round1.json`（notes: GAP-DEVICE-REGISTRY）。

### DEF-G04-06（P2 · 设计边界 · owner：goal-03/Edge）Edge 双开门为工作区级单实例，多 lane 并行开发互相锁定
- **复现**：并行 lane 的 Edge 守护运行中（pidfile 记录 pid=7064 port=48200）时，`edge-start --port 48210` → exit 23 拒绝双开；无法以不同端口并启第二实例。
- **影响**：验收/开发无法并行各自 Edge 实例（进程内组装的测试不受影响）；属防误杀设计的副作用，非安全事故。
- **建议**：pidfile 按 port 分键或加入 --force-new 锁键命名空间（owner 决策）。本轮以 exit 23 实证 D24 判据（不强杀、不抢占）。
- **证据**：`evidence/s07-edge-start.log`。

### DEF-G04-07（P2 · 测试卫生 · owner：任务02/Back-C）C 的 AB 实验运行会把输出写进已跟踪文件，弄脏工作区
- **复现**：运行 C 相关评测后，`Back/C/evidence/four-domain-ab-experiment.json` mtime 更新（本轮实测 2026-09-17 23:35 +08:00 被改写，diff 仅 runAt/durationMs 等运行时字段）→ `git status` 永远不干净、并发会话互相踩。
- **建议**：输出改写 Git 排除路径，或断言忽略时变字段。
- **证据**：`git diff` 记录（本轮基线快照注明"在制差异"）。

### DEF-G04-08（P2 · 秘密卫生 · owner：goal-01）perf 证据含带密码 DB URI（synthetic）进入待提交集
- **复现**：`docs/backend-upgrade/goal-01/perf/perf-run.mjs`、`results-before.json` 被 `public-submission-scan` 判 `db_uri_with_password`（REVIEW）。值为 synthetic（jwcc/jwcc-local-demo，仅 loopback），但按 D25 纪律 REVIEW 须人工签核/脱敏后方可提交。
- **证据**：`evidence/s03-scan-final.json`。

### DEF-G04-09（P1 · 交付性退化 · owner：任务01/goal-01）A 的 assembly/manifest.json 落后于源树（缺 8 文件），干净目录启动随之失败
- **复现**：`Back/D` harness 全套件 g9（D-28 程序化核对）在当前 HEAD 工作区实跑：manifest 覆盖核对报 **actual=8 缺失**（预期 0）；D-29 干净目录启动（按 manifest 复制→安装→迁移→启动）随之 exit 1。
- **根因**：goal-01/任务01 在 manifest 发布后新增源文件（trust-gates/authority/limitreq 等 A2/A3 面与在制设备锚定文件）未重新生成 `A/assembly/manifest.json`。D-28 正是为抓此场景而设。
- **影响**：D-29 的"干净目录可启动"交付承诺当前不成立；交付包若按 manifest 装配会缺源。
- **证据**：`evidence/r08-d-suites.log`（g9 exit=1）、`Back/D/evidence/g04-full-regression/g9_deliverability.result.json`。

### DEF-G04-10（P1 · 测试挂起 · owner：任务03/Edge e1）`e1-d03-d05-real` 无界挂起（两窗口复现，含安静窗口）
- **复现**：`node --test test/e1/e1-d03-d05-real.test.mjs` → bootStack 完成（内核/Edge/PG 均在位）后测试体无进展，进程无限期存活；并发高载窗口与安静窗口各复现一次（22 分钟无输出，手工终止）。
- **嫌疑点**：SSE `waitFor` 拒绝后未拆除的流句柄、或 bootStack 清理钩子与 `sseOpen` 的 `closed` promise 互等；未逐行定位（goal-04 记录现象与证据，不代修）。
- **影响**：该文件无法作为 E1 判据引用（既非 PASS 也非快速 FAIL）；挂起进程遗留 17919/15434 占用，殃及同段其他测试（本轮 g4 撞口事故的成因之一）。
- **证据**：`evidence/r06-e1-existing.log`、`evidence/r06-e1-existing-quiet.log`。


### DEF-G04-11（P1 · 验收覆盖缺口 · owner：goal-04，**本轮已修复**）九角色矩阵漏"财务"，财务口径由业务代答
- **复现（修复前）**：g04-chain.mjs 的会话矩阵为 实控人/厂长 + 业务/见微/政策/信审/商务/资产 + 审批人(approver)——任务书"角色必须覆盖实控人、厂长、财务，以及业务、见微、政策、信审、商务、资产"中的**财务缺位**，approver 是额外权限位而非九角色成员；检查会话 `financial_answers` 事项 targetRole=business，财务口径问题由业务代答。
- **修复（本轮）**：加入 `tok-fin1=fin1:human:finance:all:t1` 独立会话；会话名册加 finance 角色；财务事项 targetRole=finance；口径问题由 fin1 应答。F 系列 + D1/D2/D3 全部按新矩阵重跑（v2 基线），v1 轮次保留标记 superseded。
- **教训**：验收矩阵的角色集合以任务书文字逐字核对，不能以"审批权限位"顶替业务角色。
- **证据**：`evidence/f-series-round3.{json,log}`、`evidence/perf-g04-v2-*`。

### DEF-G04-12（P2 · 基线偏差 · owner：goal-04，**本轮已闭环**）D3 冻结档位的慢请求注入与数据库段指标首版未执行
- **偏差**：BASELINE §2 D3 冻结"慢请求：独立反代探针或内核慢查询替代，逐轮记录采用方式"、§3"数据库（SQL 计数；锁等待采样）"——首版 perf-g04.mjs 均未实现，perf v1 的 D3 轮次缺少该两段且未标 n/a，属"冻结档位与实测不一致"。
- **闭环（本轮）**：perf-g04.mjs 补齐——(a) 独立反代探针进程注入 120ms（冻结首选方式，不改 Edge/src），15s 慢读轮记 p50/p95；(b) 数据库段：pg_stat_database 事务/元组增量（标 synthetic-approx，未装 pg_stat_statements）+ pg_stat_activity 锁等待 3s 周期采样。v2 D3 三轮按新口径执行；v1 偏差在本文件与 PERF 文档双处登记。
- **证据**：`evidence/perf-g04-v2-*/D3-*.json`（dbSegment、slowRequestMethod 字段）。

## 观察（非缺陷，语义边界记录）

### OBS-G04-04　D-25e（预算重启持久 e2e 变体）按已知不稳定家族记录
- 安静窗口 g8 定向重跑：7/8 过（首跑 6/2）；唯一失败 D-25e（重启 worker 后第二目标预期 BUDGET_EXCEEDED，实测 mock 调用=0——重启用例时序敏感家族，V02_BASELINE §3 已有定性）。按任务书 S4"已知不稳定项"纪律记录全部轮次与 hash（g04-full-regression/ 与 g04-quiet-g8_gateway/ 证据目录），不删用例、不以复跑绿冒充关闭。B 单元层预算测试 105 项中全过（B 全量分拆复验），故定性为 e2e 编排层不稳定，owner：任务02/B+goal-04 后续轮 30 轮稳定性计划（D-21/D22 旧 BLOCKED 项延续）。

### OBS-G04-05　跨 scope 写入与证据目录刷新（边界登记）
- goal-03 在 `Back/Edge/scripts/edge-start.mjs` 追加 `--serve-front` 透传（+3 行，工作区在制）——该路径在本轮 goal-04 声明范围内，按单文件单 writer 纪律不回退、不代改，仅登记；goal-03 另新增 `Back/Edge/test/g03-c1/g03-c3` 测试文件。
- D harness 的 g0 自检/套件按设计把运行结果写入**已跟踪**的 `Back/D/evidence/**`（留证即入库的设计取向），导致每次实跑工作区变脏；与 DEF-G04-07 同类张力，owner：goal-04 后续轮决定证据路径策略（入库 or Git 排除+快照归档）。

### OBS-G04-01　reserve 面 REQUEST_MISMATCH 结构性不可达（v2.2 门序保证）
同 requestId 异租户载荷 → 先撞授权门 403 `CUSTOMER_SCOPE_VIOLATION`（"鉴权先于任何缓存回执查询"的结构保证，K02）；跨主体同 requestId → 409 `NOT_READY`（该 FR 已预占，状态门）。requestId 幂等载荷哈希绑主体+载荷，在 reserve 只有 {requestId, tenantId} 两字段的面上，REQUEST_MISMATCH 被门序覆盖而非显式触发。零双效应已实测（账面 180 万不变）。矩阵 F-20 按观测语义回填。

### OBS-G04-02　同客户新冻结依据包=新修订，旧修订立即失去当前性
实测：pkgOk 冻结后再冻结 pkgHold（HOLD 臂），随后绑定 pkgOk 的预占 → 409 STALE_BASIS「依据包已被更新修订取代：正式动作须绑定最新修订」。这是包=冻结修订链语义的必然结果（任务02 设计），但对操作顺序是硬约束：**信用动作必须紧跟最新修订的包**。建议 A 路在 DECISION_LOOP 文档补一行实操提示（owner：任务01/02）。

### OBS-G04-03　并行 writer 在制活动对独立验收的时间窗影响
本轮期间实测 goal-01（errors.ts/inspection.ts/008 迁移/设备锚定测试）与 goal-03（Front 源 6 文件 + dist 重建 00:25）并行在制编辑；F 系列轮 2 曾因 errors.ts 语法半成品（ERR_INVALID_TYPESCRIPT_SYNTAX）无法启动内核。goal-04 结论均标注采集时点的 SUT 状态；**正式 F/性能轮次的 SUT 快照以各轮记录的迁移清单与 errors.ts 可解析状态为准**。
