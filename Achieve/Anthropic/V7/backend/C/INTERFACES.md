# INTERFACES — C 路交付对接说明（给 A / B / D）

日期：2026-09-15（v3 = CONTRACT v0.1 适配轮）。C 路全部为**纯模块 + 数据 + 测试**：零路由、零持久化、零密钥。
所有模块 ESM（.mjs，node:crypto 仅此一依赖），Node ≥20 干净目录可跑。

**CONTRACT v0.1 已对齐并实测**：C 产物 → 合同 wire 形状的投影统一在 `src/contract-adapter.mjs`
（`toRuleVersionSubmission` / `toCalculationCommand` / `toOpinionCommand` / `toStateCommand` / `toHumanActionCommand` / `scanForbiddenKeys`）。
v0.1 要点：正式人工动作必须携带 `principalCredential`（可信 principal 门）；C 集成用 `--principal-tokens` 注入的**合成测试 token**（非生产认证、非真实密钥）；`toHumanActionCommand` 对缺凭据**本地失败关闭不盲发**。
**已实测**：`src/run-contract-integration.mjs` 对运行中的 A 服务 **20 步**真实 HTTP 集成全过——含匿名/伪造凭据 403 PRINCIPAL_UNTRUSTED、越权角色 403 ROLE_FORBIDDEN、合成可信身份正例 resolved+formalOutcome、resolved 终态 409、意见状态门 409、伪造 basedOnEvidence 400（证据 `evidence/laneC-contract-integration.json`）。
已按 A 实现对齐：evidenceRefs 投影为 `id@version` 字符串、recommendedHumanAction 枚举（need_more_evidence 替代 none，规则包 v1.1.0）。v0.2 已采纳 C 观察改码：resolved 意见门=RUN_RESOLVED（C 集成精确断言复验命中）；观察台账 v4 无未决项。
下文 §1 的 R1 形状映射保留作历史参考，当前以合同 + adapter 为准。

## 1. 交付物 → A 路合同映射（R1 冻结 v0 `ExperimentRecord`）

| ExperimentRecord 字段 | C 路产物 | 说明 |
|---|---|---|
| `ruleVersion` | `rules/rule-pack-v1.json` 的 `version`（`1.0.0`）| 规则包版本化；A 记录时应存整个包的 sha256（`ef620fc9…`）|
| `ruleScope` | `rulePack.scope`（indicators/allowedTools）+ `humanEscalation` | A 的 `ruleScope.indicators/allowedTools/humanEscalation` 直接取用 |
| `factVersion` | 调用方传入（C 不管理事实存储）| `facts = { factVersion, evidence[] }`；evidence 需含 `requiredEvidenceFields` 四字段 |
| `calculation` | `calculateCashFlowCoverage(input)` 的 `result` | `{ toolVersion, inputHash, output(含 ratio/unit/assumptions/inputs), formulaVersion }`——`output` 即 `result`，`assumptions` 原样 |
| `model.candidate` | JudgmentRecord.candidate（五字段，已过四类校验）| `authority=none`；越权措辞/伪造引用/数值不一致已在 C 层拦截为 `human_required` |
| `model.uncertainty` | `candidate.uncertainty` + `JudgmentRecord.checks.uncertaintyFloor` | 不确定声明经外部机械信号校验，非模型自报 |
| `model.requestReceipt` | `JudgmentRecord.requestReceipt`（provider 返回时）| unknown/not_sent 时无回执，如实缺失 |
| `state` | `JudgmentRecord.status`（candidate_ready/human_required/unknown）+ `failed` 由 A 层存储故障时判定 | 语义与 R1 v0 一致；`unknown → candidate_ready` 自动跃迁被结构阻止（unknown 时 candidate=null）|

**状态机要点（供 D 出黑盒测试）**：C 层保证 (a) 升级短路时 providerPhase='not_called'；(b) not_sent 不伪造 unknown；(c) sent_unknown 只出现一次调用且 candidate=null；(d) 任何 human_required 都带 `reason`（见 rule-pack humanEscalation 十类）与 `reasons[]` 明细。

## 2. 给 B 路的接口点

- C 不自己接模型通道。`runModelJudgment({ provider })` 注入的 provider 契约：
  `(req:{prompt, requestId}) => Promise<{ ok:true, receiptId?, text } | { ok:false, phase:'not_sent'|'sent_unknown', code?, message? }>`
- B 的 `model-candidate-gateway` 只要实现该契约即可直接插入（C 侧零改动）。**注意**：C 的 `candidate-schema.validateCandidate` 与 B 的“合格 JSON 限制/校验为 Candidate”是同一职责的两层实现——建议 B 复用 C 的校验器（或反之），避免双头维护；由 A 裁决归属。
- provider 抛异常按“未发送”处理（无回执即无发送证据）；B 层不得把异常包装成 sent_unknown，除非确有发送证据。

## 3. 给 D 路的黑盒测试点

可复跑命令：`node src/run-evaluation.mjs evidence`（退出码 0=全过）。测试建议覆盖：
- 状态机：unknown 后再次运行同 requestId 是否产生第二次 provider 调用（C 层每次调用独立、不重试；幂等记账在 A 层——两层职责勿混淆）。
- Candidate 边界：五字段外字段、审批执行性措辞、伪造引用（C 拦截；直接调 API 绕过 C 的情况归 A/D 拦截）。
- 工具健壮性：缺参/缺口径/非正月供/JPY/期间越界 → 结构化拒绝码（见 test/v7-calculation-tool.test.mjs）。
- 规则包完整性：`validateRulePack` 拒绝阈值形态键与场景线索晋升。

## 4. 版本与 hash

| 文件 | sha256 |
|---|---|
| src/calculation-tool.mjs | d9e9fdb1c046c5deeca9b47248fdff90d3e3bc26aebb3194a65babf2e7054f25 |
| src/candidate-schema.mjs | d4b195ef69a445fd00621e6f96376ef1a6e3df390fef66e4fdcca8ecf577bd3c |
| src/rule-pack.mjs | 86c7ae7c1450027a7e386dd9b7b406ce2305046d52291d01b8c3f608cb851717 |
| src/model-judgment.mjs | f1a7ac4bd172a0f5c90899501348af968b731c4ab252c3a0a8e9d1adb87ac3c0 |
| src/case-runner.mjs | 364c49111a5ba45e0353235ba70b1b03af4c1a77486f2dc8e61f3188ab900464 |
| src/eval-report.mjs | 70099b3f31b89ed7bf987dfc7d668a5be8cb9ec06e8b4a81bef2389789d47b3b |
| src/mock-provider.mjs（SIMULATION） | 42cf743db7e579fcc52cd545a5eb1492f64a69af50c477ddb295d0dfb008669e |
| src/contract-adapter.mjs | 4327fb9fe0ce55b177221a5c8fd2b4e4597ae5a418c0fe79a9bc2348a123ffe3 |
| src/run-evaluation.mjs | 247d513c6366d2740e25c903bc29edaba46e0bcc0f6497fb2734480855385ffa |
| rules/rule-pack-v1.json | ef620fc90ead7da9917c8cf2b11215e2a991b580fcaa8993d27a9f972832cbef |
| cases/cases-v1.json | 9d2eb1c87b594c0d0b792acd8f121eaa278311b36a1fba5b446d52ec8cedc688 |
| prompts/candidate-prompt-v1.md | ec29019435ee68038059b055bdb7f0bb63e6f5f5a80551aee73cc8dc4472f94c |

改动规则：以上任一文件变更必须升版本号并重跑 `run-evaluation.mjs` 刷新 evidence；`mock-provider.mjs` 永不进生产路径。
