# INTERFACES.md — C 路交付对接说明（给 A / B / D / assembly）

版本：2026-09-16 夜间 · 契约基线：`V7/backend-next/CONTRACT.md` **v1.1**（已对齐；注意实测分歧：契约 §2 写 `inputVersion`，服务端 `GET /projects/:id` 投影与证据提交响应实际字段名为 `projectInputVersion`——C 集成脚本双形状防御消费；v1.1 起证据命令 `expectedVersion` 必填，409 时消费 `serverVersion` 重试）
C 路全部产物：**零运行时依赖**（仅 node:http/crypto/fs，Node ≥20），零密钥读取，零真实模型调用，全部 loopback。

## 1. 交付物总览

| 交付物 | 路径 | 消费方 |
|---|---|---|
| loopback 假模型 API（真实 socket，11 场景） | `src/mock-server.mjs` · 文档 `MOCK_API.md` | **B**（transport 联调/故障演练）、D（黑盒故障注入） |
| 商业租赁目标模板（A GoalTemplate 投影就绪） | `templates/commercial-leasing-v1.json` → `src/contract-adapter.mjs#toGoalTemplateSubmission` | **A**（assembly 组合）、D |
| 非租赁抽象反例模板 | `templates/non-leasing-counterexample-v1.json`（同上投影） | A（核心无行业硬编码验证） |
| 规则包 v2（用户约束机器可查 + 15 条升级理由） | `rules/rule-pack-v2.json` | A（ruleScope 投影）、B（执行边界）、D（判据） |
| 确定性计算工具 ×2 | `src/calculation-tool.mjs`（`calc:cash-flow-coverage@1`，自旧 C 原样复用）、`src/ratio-tool.mjs`（`calc:ratio@1`，行业无关） | B（执行器内嵌）、A（`result.provider="calculation"` 投影） |
| 8 个差异化合成案例（≥2 多轮）+ 3 heldout | `scenarios/leasing-cases-v1.json` · `scenarios/heldout-cases-v1.json` | A assembly（实例化端到端）、D（独立复测判据） |
| 每案例 A 项目实例化计划（预生成） | `scenarios/plans/<caseId>.plan.json`（`node src/generate-plans.mjs` 重新生成） | A assembly：createProject → submitEvidence（跨轮去重）→ supersedeEvidence（取代者内容）→ createHumanRequest，顺序即执行序；投影分歧（跨 id 取代）记于 `divergences` 字段 |
| 确定性检查器 + 评测 runner | `src/case-checker.mjs` · `src/run-evaluation.mjs [--heldout]` | D（复跑命令见 §4） |
| 真实 socket E2E | `src/run-e2e.mjs` | D（复跑） |
| C→A 契约投影适配 | `src/contract-adapter.mjs` | A / assembly |

## 2. 给 A / assembly

- 模板落库：`toGoalTemplateSubmission(template, {requestId})` 产出契约 §4 `POST /api/v1/templates` 载荷；本地预检含 **FORBIDDEN_KEY 键扫描（v1.0 §3.1 范围=result.output/模板与目标 params；证据 content 豁免）**、DAG 查环、角色存在。两模板均已投影验证并**实库落库**（2026-09-16 01:55-02:00 实测，见 `evidence/contract-integration-*.json`）。
- 案例→项目：`buildCaseProjectPlan(case_)` 产出顺序化步骤（createProject → submitEvidence(含取代顺序) → createHumanRequest）；短路轮（evidence_conflict/caliber_change 未决）无 provider 调用，assembly 编排时不得对短路轮 claim 模型目标。
- 计算结果：`toCalculationComplete(...)` 产出 `complete` 的 `result`（`provider="calculation"`，evidenceRefs 为 `"id@version"` 字符串）。
- 候选：`toCandidateComplete(...)`（`provider="simulation"`；先过 C candidate schema；authority 措辞拦截在 C 层）。
- 版本/hash：见 `evidence/p2-file-hashes.txt`；改动模板/规则包/案例任一文件必须升版本并重跑评测刷新 evidence。

## 3. 给 B

- **mock 服务即插即用**：transport 的 base URL 指向 `http://127.0.0.1:3730`（`node V7/backend-next/C/scripts/start-mock.mjs`）；完整接口/场景/控制面/脚本指令见 `MOCK_API.md`。语义对齐要点：
  - `disconnect_before_response`/`partial_response` = 发送后 unknown（transport 必须归 unknown，不得当失败盲重试）；
  - `malformed_response` = 已处理但响应损坏（与 unknown 分流）；
  - `mock.simulationOnly`/`realModelCapability=false` + 响应头 `x-mock-simulation` 供 B 的 mock/real 来源强标记消费；
  - `MOCK_RESPOND_JSON` 脚本指令可把候选脚本化后走真实 socket（B 编排测试可直接用）。
- provider 契约（B 内部）：`(req:{prompt,requestId}) => Promise<{ok:true,receiptId?,text}|{ok:false,phase:'not_sent'|'sent_unknown',code?,message}>` —— mock 的 4 类映射：2xx→ok；400/401/429/5xx→not_sent（或按 B 策略 fail）；断连/截断→sent_unknown；malformed_response→已处理-响应损坏（B 需自定 code，如 RESPONSE_UNPARSEABLE）。
- B 不得因 mock 存在而把未配置模型静默 mock 成功（契约 §3.9：未配置 → `MODEL_NOT_CONFIGURED` 如实拒绝）。

## 4. 给 D（黑盒复跑命令，全部零付费）

```bash
cd V7/backend-next/C
node test/run-all.mjs                    # 33 用例（mock 真实socket 16 + 工具 6 + 案例包 5 + 契约适配 6）
node src/run-evaluation.mjs              # 主案例包：8/8 案例、60/60 断言
node src/run-evaluation.mjs --heldout    # heldout：3/3 案例、17/17 断言（一次性纪律见 scenarios 内 discipline 字段）
node src/run-e2e.mjs                     # 真实 socket E2E：8/8（含短路轮零请求核对）
node src/run-contract-integration.mjs [--credential <A发布的合成token>]   # 对 A:48080 实库集成；A 未起→exit 3 BLOCKED
```
超时/断言数/非零退出：runner 退出码 0=全过、1=失败、3=BLOCKED；每步断言计数写 stdout 与 evidence。
判据来源：期望全部来自 `rules/rule-pack-v2.json`（用户约束+升级理由）与算式重算——**不解析 C 的 PASS 文本，也不采信脚本候选自评**；D 可直接复用 `case-checker.mjs` 的机械推导（`detectTurnState`/`candidateViolations`）作为独立判据实现比对。

## 5. 状态与未完成门

- C→A 实库集成：BLOCKED（A 服务未上线；adapter 投影已完成并单测）。A 上线且合成 token 发布后重跑 §4 第 4 条。
- mock 与 real 边界：mock 永不进生产路径；`malformed_response`/`partial_response` 的 B 侧分流处理属 B 职责，C 仅提供演练场与语义文档。
- 本轮全部为合成数据；行业/地区/金额是标注变量，禁止地区标签拒绝（规则包 userConstraints 强制）。
