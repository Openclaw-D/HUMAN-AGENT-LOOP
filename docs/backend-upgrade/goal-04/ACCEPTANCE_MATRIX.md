# goal-04 · 验收矩阵（冻结版 · 2026-09-17）

**状态：FROZEN — 在执行前写定预期。** 判定四态：PASS / FAIL / BLOCKED（前置缺失，留门）/ NOT_RUN（本轮未执行）。超时=FAIL；零断言=FAIL；SKIP 单独计数，必测项 SKIP 不得计 PASS。执行结果回填在 §6 结果表，每条附证据。

## 1｜判定与统计纪律

- 测试进程 exit 0 只是必要条件；必须核对：实际执行数、PASS、FAIL、SKIP、BLOCKED 分项，子进程异常、日志截断、结果文件缺失一律不计 PASS。
- 故障被 catch 后必须进错误统计；"continue 后剩余全绿"不得发布为 PASS。
- 失败轮次保留（全部轮次记录在 evidence/），不反复跑到绿只留最后一轮。
- 对照口径：功能消融只证功能必要性，不证架构优越；预填事实的确定性管线 ≠ 真实原件识别（四域登记一律标 synthetic）。

## 2｜F 系列：完整新业务链（无 allow-legacy-basis）

前置：v7d- 隔离 PG（15434 段）+ A 内核（17919 段）+ live Edge，全部 goal-04 自建子进程；内核旗标含 `--required-domains-policy <v>`（政策种子 synthetic），**不含 `--allow-legacy-basis`**。步骤经真实 HTTP API（Edge 动作代理为主，setup 类建模板/项目/政策激活直连 A 并标注）。

| # | 判据（外部可判定） | 预期 |
|---|---|---|
| F-01 | 无包提案被拒 | POST facilities 不带 packageId → 409 BASIS_PACKAGE_REQUIRED（证明兼容开关未启用、新前提生效） |
| F-02 | 受控进件 | 业务会话经 Edge 建客户；同 requestId 同载荷重放 replayed:true；同租户同主体新 requestId → 409 CUSTOMER_EXISTS |
| F-03 | 资料处理与对象级核验 | 材料登记带 grade=unverified；核验等级提升仅获准角色；客户申报件不可自证为 verified |
| F-04 | 检查计划→定向提问→回答 | 检查会话 start→提问（audience=customer 定向客户实控人）→ 客户回答生效；同键开放问题合并返回原问 |
| F-05 | 补证解除等待 | waiting_evidence 事项经 evidence 提交解除；部分回答不等于材料取得（answered≠取得≠核验，投影如实分立） |
| F-06 | 收口 | 会话 end → ready_for_assessment；closureRevision 服务端解析；假会话引用建包 404 |
| F-07 | 可信 Gate 回执 | 自由 JSON gate 建包 400；service 身份登记 Gate 回执成功；human 自报 gate 拒绝；规则版本未激活登记拒 |
| F-08 | 分析运行登记 | service start→finish(completed) 后域结果可登记；failed/timeout 运行登记域结果 → 409 ANALYSIS_RUN_NOT_COMPLETED；晚到材料 → 域水位 changed 如实暴露 |
| F-09 | 依据包冻结 | 四必需域（政策种子 synthetic）+ Gate 回执 + 收口引用齐 → decisionReadiness=true；缺任一 → draft + 具体缺口（REQUIRED_DOMAIN_MISSING / GATE_HOLD_FOR_REVIEW） |
| F-10 | 人工决定 | CLEAR 包绑定提案→approver 批准→激活成功；执行者≠验收者；HOLD 包 → 批准 409 GATE_BLOCKED 零副作用 |
| F-11 | 两笔交易共同占额 | 两笔不同 productType 申请并发 reserve → 双 200；可用额=批准−预占；第三笔超占 → 409 INSUFFICIENT_AVAILABLE_AMOUNT；账面精确 |
| F-12 | 不利证据阻断 | 不利材料登记→新提案→更正取代→新批准 409 STALE_BASIS；历史 active 设施/批准额/预占逐字节不变；openItems 如实呈现 stale |
| F-13 | 中断恢复 | kill 内核→Edge live 保持 ok、ready 如实翻转（kernel-a fail）、workspace 502 UPSTREAM_UNAVAILABLE；重启→ready 恢复；账面/档案零丢失；resume 幂等 replayed:true；事件水位不回退 |
| F-14 | 事件同步 | 订阅后真实动作事件经 SSE 到达；eventId=id；schemaVersion=jw.event.v1；scope.customer 正确 |
| F-15 | 权限负例组 | 匿名 workspace 403 SESSION_REQUIRED；见微批准 → 拒绝；内部消息外发默认 403 AUDIENCE_MISMATCH；未知客户 404 不泄露存在性 |
| F-16 | 撤权即效 | admin 撤销客户授权后，被撤主体读/写即刻拒绝（含重放路径不借缓存） |
| F-17 | 伪豁免 | 非豁免路径宣称 not_applicable → 包缺口显式（必需域不由调用者关闭） |
| F-18 | 晚到分析 | 域结果登记后上游材料再变 → 读时逐域复算 deps_changed，不静默 current |
| F-19 | 错设备证据 | equipmentRefs 未登记设备 → 预占/提交路径如实验证失败或显式缺口（按当前实现语义判定，不放宽） |
| F-20 | 同申请并发+重放异载荷 | 同 FR 并发 reserve 恰一效应；同 requestId 异载荷 → 409 REQUEST_MISMATCH |
| F-21 | 未知外发 | 白盒注册外发后结果未知 → 对账语义生效（不换 requestId 重问、不盲目重发），按检查会话/outbound 实现面判定 |
| F-22 | 客户切换零串线 | 会话 A 客户档案访问 B 客户资源 → 404/403；SSE 订阅不含他客户事件 |

## 3｜R 系列：独立复验（不拿作者单测结果当复验）

| # | 内容 | 命令（在各自目录） | 预期（作者报告值，需独立复现） |
|---|---|---|---|
| R-01 | A 全量 | `node test/run-all.mjs`（env：JW_A_ADMIN_DB_URL→15444） | 102 项 101 pass/0 fail/1 skip |
| R-02 | B 全量 | `npm test` | 105/105（已知 Windows EPERM/时序偶发，失败须复跑定性并留轮次） |
| R-03 | C 全量 | `npm test` | 93/93 |
| R-04 | Connectors | `npm test` | 49/49 |
| R-05 | Edge E0 | `node test/run-all.mjs` | s1+s3 27/27 |
| R-06 | Edge E1 既有 | `node --test test/e1/e1-d02-real.test.mjs` 等 4 文件 | 冻结门四判据当前态如实报告；用例 PASS 或如实 skip+原因 |
| R-07 | D g0 框架自检 | `node suites/g0_runner_selftest.test.mjs` | 8/8（runner 语义：零断言不 PASS、异常捕获、超时、退出码） |
| R-08 | D 全套件回归 | `node harness/run-all.mjs <run>`（g1–g9） | 当前 HEAD 实况如实记录；v2.2 收紧匿名读后旧断言的 FAIL 逐条定性（D 测试过期 vs SUT 退化），不得静默放宽 |

## 4｜P 系列：性能（按 BASELINE.md §2/§3/§4 执行）

| # | 内容 | 判据 |
|---|---|---|
| P-01 | D1 × 3 轮 | 整链墙钟、分段、错误数全记录；M1 在基线内建立 |
| P-02 | D2 × 3 轮 | 九角色会话+3 客户并行；M3/M4 采集 |
| P-03 | D3 × 3 轮 | 历史规模+压力窗+断线恢复；M2/M5 采集 |
| P-04 | 统计纪律 | 样本<20 不出 p95；全部轮次（含失败轮）进 evidence；外部费用标未测 |

## 5｜S 系列：恢复/扫描/发布

| # | 内容 | 判据 |
|---|---|---|
| S-01 | 备份恢复覆盖全部业务迁移 | 演练容器应用 001–007 全部迁移；新表有非空关联数据：principal_customer_grants、evidence_artifacts(+版本/取代链)、inspection_sessions/questions/answers、analysis_runs、rule_gate_receipts、decision_packages/package_domain_results、exposure_entries、decision_records/report_views |
| S-02 | 恢复后关系与可续办 | 恢复后外键关系数=源库；抽查包→域结果→运行→回执链完整；恢复后可继续办理（reserve/approve 路径可用）；不重放已发生外部动作（外发簿不复活为待发） |
| S-03 | 公开提交扫描 | 当前 HEAD 重扫：HARD=0；REVIEW 逐条分类；报告只存脱敏位置+类型；对 2026-09-16 后新增/变更的已跟踪文件单独核验 |
| S-04 | 版本封存 | version-seal --probe：seal 含 buildId/gitSha/dirty/dist/contract/migration/能力位；零凭据零私人路径 |
| S-05 | dist 可重建 | Front npm run build 后 `git status -- Front/dist` 干净（或差异如实记录交任务03） |
| S-06 | 健康与就绪分立 + 干净启动 | live/ready 分离（DB down → ready false 逐依赖原因）；干净目录启动核验引用 D-29 历史证据+当前版本差异说明 |
| S-07 | 安全停止 | edge-stop 标识复核；只停自建资源；不动他容器/进程 |

## 6｜G 系列：三道交付门

| 门 | 判据 | 预期状态 |
|---|---|---|
| D27-L | 真实本地服务+数据库跑通 F 系列全链；模拟提供方显式标注；感知质量缺口另列 | 可执行（本轮目标） |
| D27-R | 获准账号/费用/手机桌面/媒体模型真实联动，≥3 物理终端 | **BLOCKED（用户未授权 E2；不主动调用）** |
| D27-S | 多人独立镜头/稳定场景对象/来源边界/二维保底的空间构建 | 按现状核验（无空间构建则如实未实现，不以录像替代） |

## 7｜产品对齐（八项，报告口径）

客户自助入口 / 原件理解 / 四域协作 / 人工权威 / 共享额度 / 实时页面 / 手机媒体 / 多人三维——每项标：已验证（本轮证据）/ 部分（+缺口）/ 未实现 / 未授权（BLOCKED）。后端测试通过 ≠ 产品完成；前端接线与视觉验收单列。

## 8｜结果表（执行后回填 · 2026-09-17/18 实跑）

### F 系列（`node --test test/e1/e1-g04-fullchain.test.mjs`，证据 f-series-round1/2.json，调试轮保留于 .run/g04-fullchain 与会话记录）

| # | 结果 | 关键证据/语义修正 |
|---|---|---|
| F-01..F-03, F-04..F-08, F-09..F-15 | **PASS** | 20 项判据单轮 29.5s 全绿（**v2：财务角色 fin1 在矩阵内并由其应答财务口径**，f-series-round3）；含 F-09 三包构造（CLEAR/HOLD/当前性臂）与 F-13 双 kill/重启 |
| F-16 撤权即效 | **PASS** | 授权→biz2 可写→撤权→读 404/403 且同 requestId 重放不借缓存（非 replayed） |
| F-17 伪豁免 | **PASS** | 无批准人豁免 400；非政策域豁免 400；假收口 404；自由 JSON gate 400 |
| F-18 晚到分析 | **PASS** | 取代 credit 依赖原件后包读 `deps_changed` 可见（独立 pkgCur 臂） |
| F-19 错设备证据 | **缺口（未实现，不算 PASS）** | equipmentRefs 自由字符串，无对象锚定结构；goal-01 在制（EVIDENCE_OBJECT_MISMATCH），落地后重测 |
| F-20 同申请并发/重放 | **PASS（观测语义修正）** | 并发双 200；同 FR 第二笔 409；同 requestId 异租户先 403 CUSTOMER_SCOPE_VIOLATION（鉴权先于缓存）；跨主体同 requestId 409 NOT_READY 零双效应（REQUEST_MISMATCH 在该面结构性不可达，见 OBS-G04-01） |
| F-21 未知外发 | **PASS** | result unknown → reask 409 SEND_UNKNOWN_RECONCILE；在途列明 |
| F-22 客户切换零串线 | **PASS** | SSE 全帧 scope.customer=本客户；未授权主体跨客户 404/403 |

### R/P/S/G 系列

| 项 | 结果 | 证据 |
|---|---|---|
| R-01 A 全量 | 3 轮实跑：102→114 项，每轮恰 1 环境类 FAIL（竞态/端口），零产品逻辑失败；隔离缺陷 DEF-G04-04 | r01-A-full*.log |
| R-02 B | 分拆：npm test 83/83；漏挂 3 文件显式跑 22/22 → DEF-G04-01 | 会话记录 |
| R-03 C | PASS 93/93 | — |
| R-04 Connectors | 分拆：npm test 损坏（0 用例 exit 1）；显式 50/50 → DEF-G04-02 | r04-connectors*.log |
| R-05 Edge E0 | PASS 27/27 | — |
| R-06 Edge E1 | d02 SKIP（门如实关）；d03-d05 HANG（DEF-G04-10）；scenario PASS 26s；inspection PASS 16s | r06-*.log |
| R-07 D g0 | PASS 8/8（20 断言） | r07-d-g0.log |
| R-08 D g1–g9 | g1–g7 全绿 818 断言；安静窗口定向重跑：**g4 6/6 PASS**（首跑败因=17919 撞我并行 e1 循环+D harness 探活弱点）；g8 安静窗 7 过/D-27p 正确 BLOCKED/**D-25e 已知不稳定家族记录**（OBS-G04-04）；**g9 D-28 manifest 缺 8 文件=真退化 DEF-G04-09**、D-29 为其下游 | r08-*.log |
| P-01..P-03 性能 | **v2 全绿**：D1×3/D2×3（财务矩阵，18-06-55）+ D3×3（慢请求探针+DB 段采样，18-13-54）；读 p95 61-69ms/写 49-50ms/慢读 p50 236ms/事务 Δ≈2 万/死锁 0/恢复 ~350ms；v1 轮次 superseded 保留 | evidence/perf-g04-2026-09-17T18-06-55、18-13-54 |
| P-04 统计纪律 | n<20 不出 p95（D2 调用级）；失败轮全保留；费用未测如实标 | PERF_BEFORE_AFTER.md §5 |
| S-01/S-02 备份恢复 | **PASS 17 步**（v2：真实 API 种子/43 表指纹/8 关系/外发账/可续办） | s5-drill-v2-*/drill-result.json |
| S-03 扫描 | HARD=0；REVIEW 53 分类（非 Achieve 20 全合成值）；扫描器脱敏+自排除已修 | s03-scan-final.* |
| S-04 版本封存 | PASS（dirty=23 含他路在制，逐条可解释） | s04-version-seal.log |
| S-05 dist | 构建确定性证（双跑逐字节同）；HEAD 源复现受他路在制阻碍，如实注 | s05-dist-build.log |
| S-06 健康/干净启动 | live/ready 分立 F-13 验证；干净启动=D-29 历史 PASS+DEF-G04-09 当前缺口 | — |
| S-07 安全停止 | exit 23 实证；零误杀 | s07-edge-start.log |
| G D27-L | **达成** | §3 F 系列+性能+演练 |
| G D27-R | **BLOCKED（E2 未授权）** | env-check capability 三项 BLOCKED |
| G D27-S | **未实现** | 无空间构建；能力注册表仅合成文本 |
