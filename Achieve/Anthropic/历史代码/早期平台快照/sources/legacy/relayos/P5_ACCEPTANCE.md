# RelayOS P5 Gate 验收记录

## 结论

P5“十场景模拟数据压力测试与全栈联调”通过：**10/10 scenarios PASS**，共同 `kernelVersion=1`。十场景共用同一 domain、HTTP API、AdvisoryProvider contract、Mock connector、graph projection、renderer 和 UI；静态扫描结果为 0 scenario-specific domain state、0 transition、0 route、0 UI branch，renderer 数量为 1。

本 Gate 只使用 Mock provider 与 Mock connector。没有独立 `RELAYOS_ZAI_GENERAL_API_KEY`，因此 **live Z.AI 未验证且不声称已验证**。没有进入 P6，也没有切换或污染 `127.0.0.1:4177` 的 P4 回滚服务。

## 冻结边界与共同序列

没有修改六条产品哲学、WorkCase 聚合根、权威对象分型、Accepted Handoff、具名 Human Gate、provider `authority=none` 或 BusinessEvent 唯一权威来源。十场景只有 versioned config、词汇/角色标签、adapter 声明和去标识化 fixture 的参数化差异。

每个场景真实执行同一序列：

`Trigger → WorkCase → GoalVersion → Evidence/ContextVersion → Mock advisory → HandoffOffer → clarify/re-offer → accept → HumanGate → ActionIntent → Mock ExecutionReceipt → business/risk/efficiency MetricObservation → complete/close → 删除 projection → BusinessEvent-only replay rebuild`

每个场景还通过同一 runner 覆盖：provider invalid、provider timeout、stale goal handoff、stale context handoff、越权 Gate、connector failed、connector unknown、idempotent retry、version conflict、Exception/Escalation、stale action 在 connector 前失败、未知 extension fail closed、专用 command fail closed、专用 route fail closed。offered handoff 在 accept 前 owner 不变；unknown receipt 不被解释为成功。

## 十场景逐项结果

所有 evidence ID 均与 `SCENARIO_MATRIX.md` 一致，并由 Gate 同时核对 P0 CSV 与 Markdown 报告中的记录类型和证据等级。每个 fixture 都包含至少一个 F、I、H 条目和恰好三类 MetricObservation。表中 metrics 顺序为 `business / risk / efficiency`。

| # | scenarioKey | P0 evidence ID（type/grade） | 三类 metricKey | replay hash | extension |
|---:|---|---|---|---|---|
| 1 | `customerService` | `BYTE-017 job/A`; `JD-009 job/A`; `JD-012 job/A`; `BAIDU-006 job/A`; `BAIDU-002 job/A` | `resolvedConversationCount` / `unauthorizedCompensationCount` / `handoffCycleHours` | `8aab601e615bb711c506b113f8d32769a3cfc354b3e1de86dbb71a44e5764193` | `5/195 = 2.56%` |
| 2 | `aiCoding` | `BYTE-007 job/A`; `BYTE-008 job/A`; `BYTE-009 job/A`; `OPPO-006 job/C`; `BAIDU-001 job/A` | `acceptedChangeCount` / `unauthorizedReleaseCount` / `reviewCycleHours` | `795ad7ec8997f9b5147b09b44cd8403f5d54c10406ffc8eb4dca5b56beff77a4` | `5/195 = 2.56%` |
| 3 | `supplyChain` | `BYTE-012 job/A`; `JD-006 job/A`; `HUAWEI-005 job/A`; `OPPO-007 job/C`; `MEITUAN-S02 strategy_topic/A` | `coordinatedShipmentCount` / `unauthorizedOrderChangeCount` / `exceptionCycleHours` | `b2828ade84bfeb355f44c36a7d543475b01778d567026336922d68cf1db8bc32` | `5/195 = 2.56%` |
| 4 | `videoGeneration` | `BYTE-014 job/A`; `BAIDU-005 job/A`; `OPPO-001 job/C`; `BYTE-004 job/A`; `BYTE-016 job/A` | `reviewedAssetCount` / `rightsRiskActionCount` / `reviewCycleHours` | `d1cec22bcac14c2c9dd62d39496995485bb4501472f03765fa7cb9d83965db60` | `5/195 = 2.56%` |
| 5 | `enterpriseAutomation` | `BAIDU-003 job/A`; `BYTE-010 job/C`; `BYTE-011 job/A`; `BYTE-015 job/A`; `OPPO-007 job/C` | `automatedRequestCount` / `unauthorizedSystemWriteCount` / `approvalCycleHours` | `f66151783790d0214aba7e99319466b07fcf2c68f5f16d55940a2ee6c92b4664` | `5/195 = 2.56%` |
| 6 | `edgeIot` | `OPPO-003 job/C`; `OPPO-004 job/C`; `XIAOMI-S03 strategy_topic/A`; `XIAOMI-S04 strategy_topic/A`; `BOSS-002 job/C` | `completedDeviceTaskCount` / `unsafeDeviceActionCount` / `gateDecisionHours` | `983105ccbef674a19ebee596a0590bebff06bd24897c0649e7cb3f759d5a21bf` | `5/195 = 2.56%` |
| 7 | `finance` | `BOSS-001 job/C`; `BYTE-018 job/A`; `JD-005 job/A`; `BOSS-021 job/C`; `BOSS-022 job/C` | `assessedTransactionCount` / `unauthorizedFundActionCount` / `gateDecisionHours` | `b5a5b3bd4688f2a67273a675c33caa26cef314537999b413f506be2192707c06` | `5/195 = 2.56%` |
| 8 | `localServices` | `MEITUAN-S01 strategy_topic/C`; `MEITUAN-S02 strategy_topic/A`; `MEITUAN-S03 strategy_topic/C`; `BOSS-003 job/C` | `coordinatedOrderCount` / `unauthorizedCompensationCount` / `dispatchCycleHours` | `e04bc842c601015c2dd6fe405ccc50e5796b5179c99fa60239658c43c689114e` | `5/189 = 2.65%` |
| 9 | `contentGovernance` | `BYTE-016 job/A`; `TENCENT-001 job/C`; `TENCENT-002 job/C`; `TENCENT-003 job/C`; `TENCENT-004 job/C` | `reviewedContentCount` / `unauthorizedEnforcementCount` / `appealCycleHours` | `51db0b34fa93aa0403fdcb297da0a25df9fdaf4074cac799913d3496c5dc3f72` | `5/195 = 2.56%` |
| 10 | `ecommerce` | `BYTE-016 job/A`; `JD-008 job/C`; `JD-004 job/A`; `TENCENT-001 job/C`; `TENCENT-006 job/C` | `reviewedSkuCount` / `unauthorizedTrafficActionCount` / `reviewCycleHours` | `df184a3fcc2da4e6634a876262c771b16012f9e1f4caca721361363aced23372` | `5/195 = 2.56%` |

每个 config 的 `metricDefinitions` 都为上述三类指标分别声明 `sourceSystem`、`ownerRole`、合成 `threshold` 与 `failureHandling`；loader 会拒绝缺项、多项或 category 不完整的配置。阈值文本明确标识为合成压力测试条件，不是实际 KPI、风险基线或 SLA。

## F / I / H 与市场证据边界

- `F`（事实）：只确认 P0 证据库中 evidence ID 的公开记录、`recordType` 和 evidence grade；不延伸为当前招聘、预算、内部流程或实际效果。
- `I`（有证据推断）：只表示基于公开线索构造去标识化合成流程的推断；不声称任何企业真实采用该流程。
- `H`（待验证假设）：真实流程、权限、阈值、预算与效果一律待验证。

配置 loader 与 fixture loader 要求三类边界齐全，并核对 config/fixture scenarioKey、metrics、Gate、action、证据引用和 extension namespace。privacy scan 结果为 0 命中；fixture 只有合成 ID、演示角色和公开证据引用，没有真实个人、客户、账号、secret 或受保护材料。

## 共同 kernel / API / UI 证明

- Domain command 集保持共同 25 类；没有行业 command/event/state/transition。
- 非创建 command 的 scenario config 只从既有 WorkCase projection 读取，不能由请求 payload 的 `scenarioKey` 改变。
- application service 在 connector 调用前执行 version/idempotency preflight；stale/version-conflict 请求不会产生外部副作用，retry 不重复执行 connector。
- 十场景均调用同一个 `/api/work-cases`、`/api/advisories`、events/graph endpoint 和 Mock connector；未知 route fail closed。
- advisory 调用前后重新 GET graph，权威 projection version/hash 必须完全相同。
- UI 场景选择器由 `/api/scenarios` 与 config version 驱动；图、五问、图例、drawer、F/I/H、metrics 和异常历史从当前 WorkCase projection/replay 派生。
- 静态扫描：`scannedFiles=14`、`scenarioLiteralBranches=0`、`scenarioConditionalBranches=0`、`scenarioSpecificDomainStates=0`、`scenarioSpecificTransitions=0`、`scenarioSpecificRoutes=0`、`scenarioSpecificUiBranches=0`、`rendererCount=1`。
- extension 全部位于单一、显式 `scenarioExtensions.<scenarioKey>` namespace，每场景 5 个允许字段；最大占比 2.65%，低于 20%。未知 namespace/字段 fail closed，不接受无边界 JSON。

## 自动化 Gate 真实结果

2026-08-26 在 Node 22、Mock provider、Mock connector、临时 SQLite 与 port 0 上执行：

| 命令 | 结果摘要 |
|---|---|
| `npm.cmd run test:scenarios` | PASS；2/2 tests；逐场景 10/10；`kernelVersion=1`；480 BusinessEvents；20/20 projection replay rebuild；static branches 0 |
| `npm.cmd run smoke:integration` | PASS；逐场景 10/10；480 BusinessEvents；20/20 replay rebuild |
| `npm.cmd run test:provider` | PASS；19 tests：18 pass、1 live Z.AI skip、0 fail |
| `npm.cmd run test:replay` | PASS；25/25 |
| `npm.cmd run test:frontend` | PASS；13/13 |
| `npm.cmd test` | PASS；78 tests：77 pass、1 live Z.AI skip、0 fail |
| `npm.cmd run build` | PASS；39 JS、10 configs、10 deidentified fixtures、5 static assets；0 third-party import |

可选的 GLM-5.3 完成后只读 fixture 审查曾按 `DELIVERY_GATES.md` 8.3 发起，但 transport 在模型开始前失败：`transportCompleted=false`、`exitCode=1`、`eventCount=0`、`stdoutBytes=0`。它没有写入文件，也没有被计入 P5 验收证据；本地 schema、P0 exact-match、privacy 与十场景 runner 审查是本 Gate 的有效证据。

## 浏览器 Gate

三个重点场景完成真实浏览器交互与截图：

- `supplyChain`：十场景选择器、主图、五问与 projection-derived 图例。
- `finance`：F/I/H、三类 metrics、Exception/Escalation、unknown receipt 与 advisory zero-write。
- `enterpriseAutomation`：BusinessEvent replay 时间线。

浏览器还逐一切换十场景，十个主 WorkCase 均为 `v39` 并由共同图形/详情路径渲染；控制台错误 0。完整文件、hash、交互与响应式证据见 `P5_VISUAL_ACCEPTANCE.md`。截图不替代自动化逻辑证明。

## Accepted snapshot 与回滚边界

`npm.cmd run checkpoint:p5` 会实际复制冻结文档、P5 acceptance、README/package、`src/**`、`scenarios/**`、`public/**`、`scripts/**` 和 `test/**` 到 `work/checkpoints/P5-accepted/snapshot/`。最终文件数：`89`；独立比对要求 0 missing、0 extra、0 mismatch、0 runtime DB/WAL/SHM/log/secret。最终 manifest hash 以同目录 `SNAPSHOT_INFO.json` 和 `manifest.sha256` 为准，避免验收文档自引用造成 manifest 循环。

P1–P4 checkpoint 不改动；P4 要求继续满足 62/62，manifest SHA-256 `EF652AADAB68BF23262C8EF4806265D5CC276F79ED9973776678ADADDA85EA0D`。P5 回滚边界只包含十场景 config/fixture 与共同全栈实现，不包含 runtime DB、日志、secret、截图或 P6 工作。

## 未验证与后续边界

- live Z.AI General API：未验证；缺少独立 runtime key。
- 真实 connector：未接入；只有 contract 与 Mock failure/unknown/success 路径。
- 登录、SSO/OAuth、多租户、生产身份/权限、HA、公网部署和生产安全：未完成。
- 真实企业流程、预算、实时招聘状态、实际效果与真实用户 UAT：未验证，所有 P5 流程与阈值都是公开线索驱动的去标识化合成模拟。
- 本 Gate 到 P5 停止；未进入 P6，未切换 4177。
