# 任务04 · D01–D28 独立验收矩阵（S1 版，2026-09-16）

来源：`JW_customer_credit_backend_tasks/04_REALTIME_INTEGRATION_AND_ACCEPTANCE.md` §6 关键验收矩阵。
本文件把 28 个场景展开为**外部可判定**用例：前置/输入、动作、预期、资源归属、清理、失败退出码。判定语义沿用 `Back/D/ACCEPTANCE_MATRIX.md`（PASS/FAIL/BLOCKED/NOT_RUN 四态；超时=FAIL；零断言=exit 3 不得 PASS；BLOCKED 必须留门）。

**当前轮结论（S1 阶段）**：E0 已覆盖的种子用例全部 PASS（见 §3）；依赖任务 01/02/03 冻结契约、E1 真实服务、E2 外部授权的场景如实标 BLOCKED，不冒充通过。

## 1. 资源归属与隔离总则（防误伤遗留服务）

| 资源 | 归属 | 约定 |
|---|---|---|
| Edge 服务 | 任务04（`Back/Edge/**`） | 默认端口 48200；端口被占→exit 24 提示，不抢占；PID 复核=pidfile+heartbeat+命令行 marker 三证，不符拒绝杀（exit 5） |
| D 自有 PG 容器 | 任务04 D harness | `v7d-` 前缀、15433 段、数据目录 `Back/D/.run/`；只 `docker rm -f v7d-*`，绝不动 `v7next-a-pg`/Dify 等其他容器 |
| D 自有 SUT 子进程 | 任务04 D harness | A API 用 1791x 段动态端口 + EADDRINUSE 顺延；只杀 `harness/proc.mjs` 跟踪的进程 |
| A 内核标准实例 | 任务01 lane | 48080/15432（本轮被旧 Anthropic 工作区遗留实例占用，见 §3 D01）；本任务不停止、不抢占、不复用其健康状态作为 JW 运行证明 |
| 测试库 | 各自 runner | `v7next_a_test_*`（A）、`v7d_<suite>_sut`（D）用后即删；不触碰业务库 `v7next_a` |

## 2. 矩阵

退出码约定：0=PASS；1=有 FAIL；2=runner 崩溃；3=零断言/不得 PASS；24=Edge 端口被占拒绝启动；23=Edge 双开拒绝；5=停止时标识复核失败拒绝杀；4=停止时无运行记录。

| 编号 | 场景与判据 | 前置/输入 | 动作 | 预期（外部可判定） | 资源归属与清理 | 当前状态 |
|---|---|---|---|---|---|---|
| D01 | 本地 HEAD/dirty/dist/运行版本不同→报告差异，不以 GitHub SHA 充当运行证明 | JW 工作区任意状态 | `node Back/Edge/scripts/version-seal.mjs --probe`；`GET edge/versionz` | seal 含 buildId/gitSha/sourceDirty(含清单)/dist/contract/migration/能力位；输出零绝对路径零凭据字样；48080 占用者被识别为非 JW 服务且不计入运行版本 | 只读采集；证据写 `docs/customer-next/acceptance/evidence/` | **E0 PASS**（本轮 seal+probe 完成，发现旧工作区实例占用 48080） |
| D02 | DB down 但 API 活着：liveness 可正常，业务 readiness 不可正常 | Edge + 探针注入（真实 PG stop 为 E1 变体） | `GET /healthz/live`、`GET /healthz/ready` | live=ok；ready=ok:false 且逐依赖给原因；无 all_ok 字段 | Edge 自有进程；测试后 close | **E0 PASS**（`Back/Edge/test/s1-health.test.mjs`）；E1 真实 PG 停库变体待内核集成 NOT_RUN |
| D03 | 客户快照与事件订阅间有写入→不漏、不双重推进 | fixture store，快照游标 C，之后追加事件 e | 取快照→订阅(cursor=C)→收集 | 恰收到 e 一次；eventId 唯一；aggregateVersion 单调 | 内存 fixture，无清理 | **E0 PASS**（`s1-sse.test.mjs`）；E1 待 A outbox 桥接 NOT_RUN |
| D04 | SSE 乱序/重放/重启→单次业务效果、状态版本不回退 | 同上多事件流 | 同游标重复订阅对比帧序列 | 重放保序、eventId 稳定；续传严格晚于游标零重复 | 内存 fixture | **E0 部分 PASS**（重放/续传语义）；乱序注入与服务重启变体 E1 NOT_RUN |
| D05 | cursor 已失效→明确 resync，不静默缺历史 | fixture 裁剪保留窗口 | 用已淘汰/未知游标订阅 | `event:resync` 后流结束；零业务事件；安全默认=未知游标也 resync | 内存 fixture | **E0 PASS** |
| D06 | A 客户会话切 B 客户面板→零串线 | 需 S3 browser harness + 视频/消息/额度四类绑定数据 | 会话持有下切换客户并操作面板 | 事实/视频/消息/额度四类均不跨客户 | browser-harness 数据目录自建自清 | **E0 部分**：harness 骨架已含"切客户=停订阅+清游标/去重集"防错绑结构（`Back/D/browser-harness`）；真实串线断言 BLOCKED(01/02) |
| D07 | rejected + decided→不显示授信通过或风险绿灯 | 需任务01 formalDecision=rejected 投影 | GET workspace 检查状态维度分离投影 | workflowStatus=decided 且 disposition=rejected 并存；无绿灯派生 | — | **BLOCKED(01)** |
| D08 | 面板开合与四域切换→通话持续，媒体连接次数不增 | 需 RTC 会话组件（02）+ harness | 开合面板/切域时计数媒体连接 | 连接计数恒定；UI 重建不重建媒体 | — | **E0 部分**：harness 媒体占位组件常驻（存活计数/重建次数=0 的结构面证明）；真实媒体 BLOCKED(02) |
| D09 | 内部意见发送到客户→后端受众校验拒绝或显式授权确认 | Edge 消息受众路由（E0 seam；真实通道 02） | 内部内容标 audience=customer 发送；显式 confirmExternalSend 再发 | 默认 403 AUDIENCE_MISMATCH 且留审计；确认后放行且审计记 confirmed；送达未知不标已读 | — | **E0 PASS**（`s3-proxy.test.mjs` + 守护进程实测）；真实通道接入 BLOCKED(02) |
| D10 | 录制失败但视频正常→缺口显式，不伪装完整存档 | 需录制回调注入（02/S3/S4） | 注入回调丢失/重复/乱序 | ingestionCoverage/录制缺口字段显式暴露 | — | **BLOCKED(02)** |
| D11 | 关键域滞后但其他域完成→必需覆盖门阻断正式动作 | 需任务01/03 覆盖门 | 滞后域下提交正式动作 | 阻断+归因到缺失覆盖项，不默许完成 | — | **BLOCKED(01/03)** |
| D12 | 两客户端并发预占客户额度→不超总额，不因新 project 绕过 | 需任务01 额度账本+预占 API | 双客户端并发预占（含跨 project 变体） | 恰一成功/排队；可用额度不为负；跨 project 同样受限 | D 自有 PG 每轮独立库 | **BLOCKED(01)**（并发测试模式可复用 D g2） |
| D13 | 正式动作响应丢失、用户重试→同 requestId 仅一次业务效应 | 内核幂等表（01）+ Edge 代理语义 | 同 requestId 重放/异载荷重放 | 重放返回原响应 replayed:true；异载荷 409 REQUEST_MISMATCH；Edge 缺 requestId 400 不代生成、上游未知 502 回显原 ID 不自动重试 | — | **E0 部分 PASS**（Edge 侧 `s3-proxy.test.mjs`：不代生成/回显原 ID/不自动重试）；上游幂等效应新内核 E1 待01 |
| D14 | 服务端规则版本更新→旧候选/旧批准请求被拦截 | 需 rulesetVersion 门（01/03） | 更新规则版本后重放旧批准请求 | 拦截+要求重评，不 silently 生效 | — | **BLOCKED(01/03)** |
| D15 | Agent/错误人类角色调用批准→403/等价拒绝零副作用 | principal 目录（01） | agent 凭据/无权人类调 decide | 403 ROLE_FORBIDDEN 类错误；状态与审计零变化 | — | 旧内核已有证据（D-02/04/18）；**新内核待01** |
| D16 | 任意客户ID/回执ID/事件游标枚举→scope 校验，敏感元数据不泄漏 | Edge + harness | 无权身份打枚举；合法身份打未知 ID | 无权=403 且零回放；未知=404 不泄漏存在性；错误不回显内部细节 | — | **E0 部分 PASS**（Edge 403/404 语义）；全量枚举扫描待 S3 harness NOT_RUN |
| D17 | 浏览器 CSRF/伪造 Origin/代理任意 URL→拒绝，无内部凭据泄漏 | S3 thin Edge 代理 | 伪造凭据头转发；白名单外路径；路径穿越；跨站 Origin POST；Sec-Fetch-Site 组合 | 未登记路由明确拒绝（404 PROXY_ROUTE_NOT_DECLARED）；伪造凭据头不透传（上游只见服务端映射值）；穿越不落文件；无会话 401 先于路由表披露；全部 POST 面经 CSRF 守卫：跨站 Origin/null origin/Sec-Fetch-Site≠same-origin/有信号无 Origin → 403 CSRF_ORIGIN_REJECTED，同源与非浏览器客户端放行，staging 允许列表可配 | — | **E0 PASS**（`s3-proxy.test.mjs`+`s3-harness.test.mjs`+`s3-csrf.test.mjs`，27 用例含 CSRF 6 项；守护进程实测跨站 403/无头放行）；真实浏览器层 CSRF 全链路（含 Cookie/HTTPS/staging 形态）待部署形态 |
| D18 | Provider 未配置或预算耗尽→如实不可用，不回退假成功 | transport 声明（02/03） | 无 provider 配置下调用分析 | MODEL_NOT_CONFIGURED 等如实错误；能力位如实体现在 /versionz | — | 旧内核已有证据（D-24、health model:not_configured）；**新链路待01/02/03** |
| D19 | in-flight 杀 worker 后恢复→unknown 不盲重发 | worker+transport 注入（03/B） | SIGKILL 后重启，查回执先于重发 | 已回执步不重执行；unknown 留待人类/契约重试 | D 自有子进程/容器 | **BLOCKED(01/03 固定版)**；旧 D-12 结论为历史记录不自动沿用 |
| D20 | PG/对象存储/连接器恢复→已提交事实可还原，孤立对象可识别 | 自有 PG 重启（D g0 已证）+对象存储（02） | 重启后比对账本/对象一致性 | 事实行原样；孤立/缺失对象清单可见 | v7d- 容器，用后销毁 | **部分 PASS**（g0-08 自有 PG 起停重启数据保持）；对象存储部分 BLOCKED(02) |
| D21 | 文件替换 EPERM/坏 checkpoint→不损坏已提交状态 | B writer 修复后固定 hash（D-25e 族） | Windows 文件替换注入 | 已提交状态完好；可诊断可恢复 | — | **BLOCKED(B 修复+版本固定)**；30 轮流程未开始 |
| D22 | 预算并发及服务重启→持久上限不穿透；完整记录 D-25e 结果 | 同上 | 并发扣减+中途重启 | 上限不穿透；完整轮次记录 | — | **BLOCKED(同上)** NOT_RUN |
| D23 | 新规则 HARD_BLOCK 并发于支用确认→提交点重新核验 | 需规则门+支用账本（01/03） | 规则生效瞬间提交支用确认 | 提交点重核验拦截；前端旧 CLEAR 不可绕过 | — | **BLOCKED(01/03)** |
| D24 | 停止脚本遇未知占用端口/容器→不强杀、不删除、不影响他项目 | 48080 被旧工作区实例占用（现实环境） | edge-start --port 48080；edge-stop 对标识不符进程 | exit 24 不抢占；标识复核失败 exit 5 拒杀；不删数据 | 无 | **PASS**（本轮冒烟：24/23/0/4/5 全路径验证，旧实例存活确认） |
| D25 | 公开提交扫描→无客户视频、真实材料、密钥、令牌、数据库和日志 | 待提交文件集（git ls-files + 未忽略未跟踪，共 8153 文件） | `node Back/Edge/scripts/public-submission-scan.mjs` | HARD（私钥/API密钥/JWT/媒体视频/数据库文件/.env）=0；REVIEW 40 项逐条人工分类：34 处占位符（`apiKey:'JIANWEI_MODEL_API_KEY'` 等示意文本）、6 个 Achieve 历史大清单（30–45MB，用户明确决定保留）；INFO 506（Achieve 历史图片 478 + 已知合成演示值） | 只读扫描；报告 `evidence/d25-scan-*/report.json` | **PASS**（exit 0，HARD=0；REVIEW 已人工分类，无真实密钥/客户材料） |
| D26 | 停用/回滚新版→旧稳定入口可用，账本不丢，外部副作用不重复 | 部署形态+备份（S5） | 回滚演练 | 旧入口健康；账本完整；无重复外部请求 | — | **部分**：备份恢复演练 PASS + 回滚边界文档（代码回滚≠数据库回滚、不可逆迁移须向前修复、外部副作用不随回滚消失，见 `BACKUP_RESTORE_DRILL.md`）；完整回滚演练 BLOCKED(部署形态) |
| D27 | 两真实设备+官方视频+获准真实模型→完整记录，不以录像充真实接入 | 用户授权、测试租户、费用（E2） | 真实端到端 | 完整能力与 usage 记录 | — | **BLOCKED(用户授权/账号/费用)** E2 门 |
| D28 | 支用模拟结果未知→不释放占用、不盲发第二笔、不调真实付款 | 支用账本+回执语义（01） | 注入"结果未知"后恢复 | 先查回执；不自动二次出账；零真实付款调用 | — | **BLOCKED(01)** |

## 3. 本轮已执行证据（S1，2026-09-16）

| 项 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| Edge E0 测试（27 用例） | `node Back/Edge/test/run-all.mjs` | 0 | 27 pass / 0 fail（版本封存 3 + 健康拆分 3 + SSE 语义 7 + 动作代理/会话/受众/审计 5 + harness 静态与流程 3 + CSRF 守卫 6） |
| S3 守护进程实测 | edge-start → 换会话 → 消息受众 → 审计 → edge-stop | 0 | 内部内容外发默认 403 AUDIENCE_MISMATCH；显式确认放行；审计含 `message.external_send_refused` 与 `message.sent.customer(confirmed)`；停止 exit 0 |
| D 框架自检 | `node Back/D/suites/g0_runner_selftest.test.mjs` | 0 | 8 pass / 20 断言（含自有 PG 容器起/建库/重启/销毁） |
| D g1 真实 SUT 面 | `D_SUITES=g1 node harness/run-all.mjs s1-g1-jw` | 0 | 4 pass / 132 断言（D 全链路在 JW 布局可用：v7d-PG→迁移→1791x 起 A→黑盒断言）；证据 `Back/D/evidence/s1-g1-jw/` |
| A 类型检查 | `npm run typecheck`（Back/A） | 0 | 通过 |
| Edge 启停冒烟 | edge-start / edge-stop 序列 | 0/23/24/0/4 | 正常启动、双开拒绝、48080 占用拒绝（旧实例存活确认）、标识复核停止、无记录停止；exit 5（标识不符拒杀）路径在初期版本冒烟中触发——该轮暴露"marker 不在守护进程命令行"的设计缺陷，已重构为守护子进程携带 `--marker` 后复测通过（缺陷与修复留在 git 工作区历史，不掩盖） |
| 版本封存 | `node Back/Edge/scripts/version-seal.mjs --probe` | 0 | `evidence/s1-20260916-160301/version-seal.json`：buildId=8718af354c4d7cc0、gitSha=9c724c0e、dirty=true(14)、contract=v1.3、migration=001_init.sql、dist=3 files、ruleset=6 files；JW 自有端口 48180/15442 未监听、旧工作区遗留 48080(db:up)/15432 开放并被标注 legacy 不计入 JW 运行版本；出口泄漏自检通过 |
| D25 提交前全仓扫描 | `node Back/Edge/scripts/public-submission-scan.mjs` | 0 | 8153 文件（文本扫描 6466）：HARD=0；REVIEW=40 全部人工分类为良性（占位符/Achieve 历史大文件）；INFO=506；报告 `evidence/d25-scan-20260916-163230/report.json` |
| S5 备份恢复演练 | `node Back/Edge/scripts/backup-restore-drill.mjs` | 0 | **PASS 12/12 步**：v7d- 隔离容器 → 001 迁移 → 12 表合成数据 → 指纹 → pg_dump -Fc → DROP 模拟损毁 → pg_restore → 逐表指纹 ALL_MATCH → 容器销毁；证据 `evidence/s5-drill-20260916-164003/drill-result.json`；runbook 见 `BACKUP_RESTORE_DRILL.md` |

### 环境事实（本轮实测）

- 部署形态澄清：`Back/START.md` 登记 **JW 自有形态为 A 内核 48180 + 独立 PG(jw-v01-pg) 15442**；本轮封存时两者均未启动。48080/15432 上运行的是旧 `Anthropic` 工作区遗留实例（Docker v29.7.2 已恢复，其 db 在会话中途由 down 转 up）——**运行版本与依赖健康是时变状态，必须每次实测，不能引用历史结论**（D01 判据的活例）。Edge readiness 默认探测 JW 形态端口，对遗留端口只标注不计入。
- 48080 监听者经命令行核验为旧工作区 A 内核，非 JW 产物；按边界未停止、未抢占。
- 存在并行 writer 正在产出 `Back/Connectors/**`、`Back/C/{amount,domains,questions,coordination,rules}/**`、`docs/customer-next/{LOCAL_*,S1_CREDIT_DOMAIN_ADR}`；本任务未触碰，矩阵中相应场景维持 BLOCKED 直至其契约冻结。

## 4. 已知失败 / 未测依赖 / 遗留门

1. **全部 E1/E2 场景 NOT_RUN**：等待任务 01（客户/额度/支用内核）契约冻结——最近复核（2026-09-17，第 8 次）：`docs/customer-next/S1_API_V2_SCHEMA_PROPOSAL.md` 仍自标"设计提案（待总控冻结）"，`Back/CONTRACT.md` 仍 v1.3；**writer 持续在制品开发**（13 个未提交文件）：新增 `Back/A/docs/CUSTOMER_CREDIT_V2.md`（运行与设计说明，自报 v1 回归 48/48——writer 自报，04 未独立验证）与 `test/ledger-property.test.mjs`（额度账本性质测试：金额守恒/占用≤批准额/无负桶，固定种子）——实现成熟度在上升，但契约未发布、实现未固定，按纪律不抢先集成。02/03 观察见下条。**E1 骨架已预置**：`Back/Edge/test/e1/` 冻结门（四判据）+ E1-D02 真实变体，门未过如实 SKIP（实测 skipped，原因=契约未发布+13 文件在制品），门过一条命令可跑。
2. **02/03 新可测面观察（2026-09-17，只读运行观察，非验收、不代修；在制品结果随时波动，重复复测无意义）**：
   - 02 Connectors：实现成形（src/{http,wecom,rtc,session,store,objectstore,evidence}）；自建测试计划 E0/E1（自有隔离 PG@15443，不可达显式 skip）/E2（全部 blocked_external_access）。E0 首测 5/5 PASS；本轮复测 6/7（writer 正在改 rtc/recording/ingest——在制品波动，属其 lane 正常状态）。跨 lane 契约仍未发布（docs/ 空）→ Edge 集成面继续 BLOCKED。
   - 03 C：四域 E0 面成形（`test/four-domain.test.mjs` 单独直跑持续 **27/27 PASS**）；其统一 runner 中两个 four-domain 文件与其余套件同跑时失败（套件间干扰/在制品）——C lane 事项。无已发布接口变更（INTERFACES.md 未动）→ D11/D14 门继续 BLOCKED。
3. **A 集成测试（17 用例）本轮未跑**：其 crash 套件会重启共享 PG 容器 `v7next-a-pg`，而该容器正被旧工作区遗留 48080 实例使用；避免扰动遗留服务，留待旧实例退役或用户批准后执行。
4. **D-25e / D21 / D22（30 轮稳定性）未开始**：B writer 已在改文件替换相关代码（fs-lock.mjs 等在制品）；等其修复固定 hash 与复现用例；不得以跳过/改预期冒充。
5. **性能基线：Edge 层已测（2026-09-17），全链路待 E1**：基线环境如实声明（12x Ryzen 5 5600X / 15.9GB / win32 / Node 22.23.1 / loopback 同机 / provider not_configured）；规模 100 合成客户、10 万事件。实测 M1 快照 p95=0.53ms（目标 ≤500ms）、M2 会话交换 p95=0.41ms/消息发送 p95=0.41ms（目标 ≤1s）、M3 事件追加→5路SSE 可见 p95=0.66ms（目标 ≤1s，不含内核 DB 提交段）；60s 浸泡烟测 heap 零增长趋势（−8.5MB）。结果远优于提案 SLO 属预期（fixture store+loopback）；**内核 DB 提交段与全链路 SLO 待任务01 集成后补测**，2 小时浸泡 NOT_RUN。证据 `evidence/perf-baseline-*/perf.json`，脚本 `Back/Edge/scripts/perf-baseline.mjs`。
6. S3 剩余：Edge 动作代理的 E0 判据与 browser-harness 骨架已交付；CSRF Origin/Sec-Fetch-Site 守卫已覆盖全部 POST 面（27 用例）。剩余：Cookie 会话/HTTPS/staging 部署形态、真实浏览器层端到端、真实客户绑定 scope（等任务01内核）。
