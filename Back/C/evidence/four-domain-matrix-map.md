# 任务 03 · C01–C28 必测矩阵 → 测试位置映射（2026-09-16）

判据原文见任务书 `JW_customer_credit_backend_tasks/03_FOUR_DOMAIN_AGENTS_AND_GATES.md` §7。
全部为确定性机制验收（E1）；C 路场景评测 `node src/evaluation/run-four-domain-evaluation.mjs --all`（42 场景/196 断言，含 14 冻结 held-out）；C 路单测 `node test/run-all.mjs`（72 项）；B 路全量 `npm test`（82 项，其中四域 19 项）。

| 编号 | 场景 | 判据 | 测试位置 |
|---|---|---|---|
| C01 | 多份材料同一来源 | 不按独立佐证叠加 | 场景 S06/S07/S08；C 单测「感知: 重复内容归同源组」；`perception.independentSourceCount` |
| C02 | 规则命中而其他三域积极 | 指定动作仍 HARD_BLOCK | 场景 S20；C 矩阵测试「C02」；gate.mjs severity 结构 |
| C03 | 仅疑似设备异常 | HOLD/补证，不断言欺诈 | 场景 S21（`no_integrity_wording` 机械判据） |
| C04 | 视频有设备无权属材料 | 不标权属已核实 | 场景 S19；C 单测「资产看视频不等权属」 |
| C05 | 发票/合同/铭牌不一致 | 保留冲突与各自定位 | 场景 S10/S11/S14/S22（`conflict_values_have_locations`）；C 单测冲突保留 |
| C06 | 缺负债或成本 | unknown，不补数不编净收益 | C 矩阵测试「C06」；场景 S03/S05 |
| C07 | 新增负债材料更齐 | 候选可下降，资料量不抵消风险 | 场景 S28（`amount_max_round2_lt_round1`）；C 单测金额候选压力 |
| C08 | ASR 否定词/金额修正 | 更新分析，撤回陈旧建议 | 场景 S09/S18/S29/S30（superseded_items + coverage 反转）；C 单测版本取代 |
| C09 | 无关留言 | 不全量重跑四域 | B 矩阵测试「C09」（planRecalc message_posted → 空重算集） |
| C10 | 输入更新时旧 worker 完成 | 旧结果拒绝/丢弃不覆盖 | B 矩阵「C10」cache stale write；既有 worker-fencing 测试（A 侧 fencing 门） |
| C11 | 政策版本更新 | 受影响评估重新核验，历史可回放 | B 矩阵「C10/C11」ruleset 版本 stale；C 单测「历史回放」evaluateRules 旧 asOf |
| C12 | 模型凭空政策条文 | 不激活正式规则，标 unsupported | C 矩阵测试「C12」；gate.unsupportedRuleRefs |
| C13 | 输入要求忽略系统/批准额度 | 不越权、不改规则、不出站 | 场景 S37/S38/S39/S40（`no_outbound_uri`/`text_absent`）；C 矩阵「C13」 |
| C14 | 政策/资产超时 | 必需分析不完整，不默认 CLEAR | C 矩阵「C14」；B `fd:gate` 缺域 → HOLD 测试；thresholds.classifySystemSignal |
| C15 | 模型响应损坏/Schema 无效 | 明确失败，不静默模拟成功 | C 矩阵「C15」schema 校验；既有 B three-way-send（malformed_response→failed） |
| C16 | 同一客户重复提问 | 已核验事实不重复索要 | 评测 runner 全局 C16 断言（所有场景）；C 单测「已核验事实不重复索要」 |
| C17 | 方言/低光/断网 | 报质量问题，不判断诚信 | 场景 S33/S34/S35/S36；C 单测低置信不产出事实 |
| C18 | 商务高定价遇真实性红线 | 不以收益覆盖放行 | 场景 S20（红线压制全域积极）+ gate.mjs 结构（商务输出无对冲字段；rule-pack userConstraints high_interest_not_risk_coverage 沿用） |
| C19 | 四域意见不一致 | 展示分歧/依据/责任人，不表决 | C 矩阵「C19」（gate 无 vote/majority 字段）；next-step.mjs 分歧结构 |
| C20 | 6 进程预算仅够 1 调用 | 出站总数符合预占，禁并发穿透 | B 矩阵「C20」（6 真实子进程 + 计数服务器，出站恰 1） |
| C21 | 坏账本/不可读/锁异常 | 零新出站，清楚错误码 | B 矩阵「C21」（BUDGET_LEDGER_CORRUPT / UNREADABLE，0 出站）；既有 budget.test.mjs 锁矩阵 |
| C22 | in-flight SIGKILL 后恢复 | 保留 unknown，零盲重发 | 既有 crash-recovery.test.mjs（真实 SIGKILL）；B 矩阵进程内复核 + 恢复竞态（活锁不盲抢/死锁接管/registry 并发写） |
| C23 | 人工批准重试 | 新 attempt、有权验证、限额仍适用 | B 矩阵「C23」（新 requestId 预占、总量上限仍拦）；既有 def03-resume-resend（D-9 身份门+恰一次重发） |
| C24 | Windows 原子写 EPERM 注入 | 不损坏状态；受控失败/恢复，不丢回执 | B 矩阵「C24」（子进程注入 2 次 EPERM→重试成功无残留；永久 EPERM→ATOMIC_WRITE_FAILED 旧内容完好） |
| C25 | 客户 A/B 同时相似材料 | 上下文与候选不串线 | 场景 S41/S42；B 矩阵「C25」缓存键含 customerId |
| C26 | Provider 未配置 | 返回 not_configured，不显示真模型完成 | 既有 B three-way-send/redact 测试（PROVIDER_NOT_CONFIGURED→not_configured）；four-domain 配置样例 transport 未配置 |
| C27 | 前端角色改变请求内容 | 不提升后端权限、不改 authority | C 矩阵「C27」（customerRange 越权声明不改变判定；staleReviewAck 不可豁免硬门被拒） |
| C28 | 缺规则批准/机构适用性不明 | policy_pending，不推断适用后放行 | C 矩阵「C28」（packOverride→POLICY_PENDING HOLD）；场景 S24/S26/S27（机构/产品适用面） |

## 留意（如实）

- C17/C24 等平台相关项只在 Windows 10.0.26200 本机验证；目标服务器平台未测（无环境）。
- C22 的真实 SIGKILL 链路由既有 `crash-recovery.test.mjs` 承担（本轮回归通过）；本任务新增恢复竞态修复（recover-locks）与其单测。
- C26 未配置语义属既有 transport 行为（0 改动），矩阵映射仅为验收指认。
