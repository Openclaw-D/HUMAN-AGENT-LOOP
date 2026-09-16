# RESULT — V7 Backend Lane C（规则、证据、模型判断及计算）

日期：2026-09-15（四轮：模块交付 → 合同 v0 对齐 → v0.1 适配 → **CONTRACT v0.2 消费**）。执行：ZCode（GLM-5.3-Flash · max thinking）。写面仅 `V7/backend/C/**`。
状态：**58/58 单测 + 8/8 用例 + 20/20 真实 HTTP 集成（对 CONTRACT v0.2 复跑，resolved 意见门精确断言 RUN_RESOLVED）全部通过**；真实模型通道按授权边界明确阻断（§5）。
**当前结论（覆盖历史）**：v0 时代 13/14、v0.1 时代 20/20（宽容错误码）的结果均被本轮取代；C 路无未决观察。

## 0.2. 本轮增量（CONTRACT v0.2 消费，对照 HEARTBEAT_20260915_0725 §C）

A 发布 CONTRACT v0.2：resolved 上写意见改码 `RUN_RESOLVED`（采纳 C v3 观察 #4）、校验顺序（状态门先于引用校验）写入文本（采纳观察 #7）。C 已完成：
- `run-contract-integration.mjs` 断言收紧：`resolved 上写意见` 由宽容（RUN_ESCALATED|RUN_RESOLVED 之一）改为精确 `RUN_RESOLVED`，对 v0.2 新代码实测命中。
- 集成证据新增 `upstream` 字段，运行时自算并记录上游 hash：CONTRACT.md `c0cf5ca0…`、A/src/server.mjs `3e36a518…`、service.mjs `d2035d2c…`、store.mjs `a7a399b3…`。
- 隔离复跑：A v0.2 服务器（新数据目录 + 同一合成 principal token）**20/20 全过**（`evidence/laneC-contract-integration.json`）。
- 观察台账 `observations-for-A.md` v4：#4/#7 标记闭合，**无未决项**；不再声称"等待 A 裁决"。
- 计算全套按心跳指示未重复（本轮零变更；最近全绿记录 `evidence/laneC-test-run-full.log` 58/58）。

## 0.1. 上一轮增量（v0.1 适配，对照 HEARTBEAT_20260915_0425 §C）

A 发布 CONTRACT v0.1（可信 principal 门 D-6、意见状态门 D-4、伪造引用失败关闭 D-5、resolved 终态 D-3 及既有澄清）。C 已完成：
- `contract-adapter.mjs` 新增 `toHumanActionCommand`：凭据只透传不生成不存储；**凭据缺失本地失败关闭不盲发**（+4 测试：正例形状、缺凭据、空凭据、非法 action）。
- `run-contract-integration.mjs` 重写人工动作段为 v0.1：合成可信测试身份（`--principal-tokens` 注入的合成 token，仅 sha256 落盘，非生产认证非真实密钥）正例 → 200 resolved+formalOutcome；**匿名/伪造凭据 → 403 PRINCIPAL_UNTRUSTED**、actorRole=model → 403 ROLE_FORBIDDEN；resolved 终态追加动作 409 RUN_RESOLVED；resolved/human_required 上写意见 409；伪造 basedOnEvidence（pending run 上）→ 400 INVALID_INPUT。
- **实测发现 1 项合同文本与 A 实现的错误码偏差**：resolved 上写意见，合同 §2 文本写 `RUN_RESOLVED`，A 实测返回 `RUN_ESCALATED`（失败关闭语义一致）——已报 `observations-for-A.md`（历史：当轮按宽容断言不猜测；**v0.2 已采纳改码并经本轮复验闭合**）。
- 原 14 步集成结果作废声明：v0 下无凭据人工动作曾 200，v0.1 下必须 403——这正是安全门收紧的预期，不回退。

## 0. 上一轮增量（合同 v0 发布后）

A 于本轮中途发布 `V7/backend/CONTRACT.md` v0 FROZEN。C 已完成：
- `src/contract-adapter.mjs`：规则包→RuleVersion 提交、计算→calculation 命令、判断→opinion/state 命令的形状投影（+5 测试，含 evidenceRefs 字符串化与禁用键扫描）。
- `src/run-contract-integration.mjs`：对运行中的 A 服务（隔离数据目录+端口 3621）13 步真实 HTTP 集成**全部通过**——规则提交、项目/证据/supersede、run、calculation 落库（inputHash 一致）、opinion→candidate_ready、幂等重放不重复追加、state human_required/unknown 落库、人工动作 accept_candidate→resolved+formalOutcome、非 human actorRole 403、禁用键候选 400。证据：`evidence/laneC-contract-integration.json`。
- 规则包升版 v1.1.0（枚举对齐 A：`need_more_evidence` 替代 R1 草案 `none`）；偏差与澄清请求 3 项报 A（`observations-for-A.md`），不阻塞现交付。

## 1. 交付清单（对照 LONG_RUN_GOALS §C）

| 要求 | 交付 | 证据 |
|---|---|---|
| 小而完整的规则/案例包，确认边界与实验假设分离 | `rules/rule-pack-v1.json`（confirmedBoundaries 5 条 / experimentalAssumptions 3 条 / 升级条件 10 类） | `test/v7-rule-pack.test.mjs` 7/7 |
| 规则界定指标/范围/工具，不硬编码判断；零真实金融阈值 | scope 只含 3 个合成指标 + 1 个工具；`validateRulePack` 显式拒绝 threshold 形态键 | 同上 + loader 失败关闭 |
| 模型输出五字段边界；禁冒充审批；不粗暴词语拒绝 | `candidate-schema.mjs`：执行性措辞（决定动词+对象）命中拒绝；流程性讨论（"额度结论须由人工决定"）不误拒 | `test/v7-candidate-schema.test.mjs` 9/9 |
| 可验证计算工具（单位/期间/币种/公式版本/来源/误差） | `calculation-tool.mjs`：ratio+unit+formulaVersion+inputHash+numericPrecision{replayTolerance:0}；来源 evidenceId+version 必填 | `test/v7-calculation-tool.test.mjs` 12/12 |
| 缺输入/口径不补造 | MISSING_INPUT / MISSING_CALIBER / NONPOSITIVE_DEBT_SERVICE / INVALID_CURRENCY / INVALID_PERIOD 结构化拒绝 | 同上 |
| 五类合成异常 + 边界（共 8 案） | `cases/cases-v1.json`：normal / evidence_conflict / missing_input / caliber_change / superseded_evidence / uncertainty_understatement / call_unknown / rule_not_covered | `test/v7-case-runner.test.mjs` 6/6；8/8 按预期 |
| 场景线索不晋升（3D打印/液冷/印刷） | rule-pack `scenarioLeads`（note 声明不构成规则）；loader 校验 leads 不入 indicators；用例不引用 leads | rule-pack/case-runner 测试断言 |
| 引用与升级理由可复核；不确定用外部信号 | grounding（id+version 精确匹配、取代归因）、calc_mismatch（引用数值 vs 工具输出）、uncertaintyFloor（机械信号→不确定下限，独立于自报置信） | model-judgment 测试 16/16 |
| 交付可调用工具/规则提示词版本/案例与预期/能力评估 | 9 个 .mjs 模块 + rule-pack@1.1.0 + prompt candidate-prompt-v1 + cases@1.1.0 + `src/run-evaluation.mjs` 输出评估报告 | `evidence/laneC-eval-report-*.json` |
| STATUS/RESULT/evidence、真实命令、失败记录 | 本文件 §3；STATUS.md | evidence/ 目录 |

## 2. 真实命令与结果（可复跑）

```
cd C:/Users/22673/Desktop/Anthropic/V7/backend/C
node --test test/v7-calculation-tool.test.mjs test/v7-rule-pack.test.mjs test/v7-candidate-schema.test.mjs test/v7-model-judgment.test.mjs test/v7-case-runner.test.mjs test/v7-contract-adapter.test.mjs
→ 1..58  # pass 58 / fail 0（完整输出：evidence/laneC-test-run-full.log）

node src/run-evaluation.mjs evidence
→ cases: 8/8 passed (failed: 0)
→ rulePack: v7-rule-pack@1.1.0  provider: simulation（真实通道 blocked，见 STATUS）
→ records -> evidence/laneC-case-records-v7-cases-v1.1.0.json
→ report  -> evidence/laneC-eval-report-v7-laneC-eval-e8edf596eaf8.json（exit 0）

# 合同集成 v0.1（A 服务器以隔离数据目录 + 合成 principal token 运行在 3622；合成 token 非真实密钥）
node ../A/src/server.mjs --port 3622 --data-dir ./runtime/integration-data-v01 --principal-tokens v7c-integ-synthetic-token-0426
node src/run-contract-integration.mjs http://127.0.0.1:3622 evidence
→ integration: 20/20 passed -> evidence/laneC-contract-integration.json（含匿名/伪造凭据 403、合成可信身份正例、终态/状态门/伪造引用负例、GET 顶层 stale+formalOutcome 正向断言）
```

能力评估报告结论（`laneC-eval-report-*.json` §capabilities）：确定性计算 / 引用校验 / 升级理由（7 类机械触发）/ 外部信号不确定下限 / unknown 不自动重试——全部 verified=true；§unverified 如实列出真实 HTTP 通道、审批 UI、行业报告正文三项。

## 3. 过程失败与修复（如实）

| 失败 | 根因 | 修复 |
|---|---|---|
| calculation 测试 6 例连败 | 测试用例共享同一个 `SRC` 常量对象，`delete source.evidenceId` 跨用例污染 | `SRC` 改为每次调用的工厂函数 |
| run-evaluation 首跑 ReferenceError | `readFileSync` 未 import | 补 import |
| 缺参用例归因错误（rule_not_covered 而非 missing_input） | 前置门只从 `result.toolVersion` 识别工具身份，拒绝对象不带 result | 兼容 `error.toolVersion`（拒绝也是"允许清单内工具的拒绝"）|
| 旧证据引用归因错误（version mismatch 抢先于 superseded） | grounding 按 id `find` 首条匹配 | 改为 id+version 精确匹配，命中且 `supersededBy≠null` 归因 superseded_evidence_cited |
| 集成：证据写入第二笔 409 | 合同要求每笔写命令携带当前 factVersion，首笔写入后已递增 | 第二笔用首笔响应的 `projectFactVersion` |
| 集成：run 创建 404 证据不存在 | A 服务端自行分配 evidenceId，`content.evidenceId` 非实体 id | 全部改用响应返回的真实 id |
| 集成：opinion 400 | A 校验 candidate.evidenceRefs 为字符串数组、recommendedHumanAction 枚举无 none | 适配器投影 `id@version` 字符串；schema/规则包升 v1.1.0 对齐 |
| 集成：rules 提交 409 REQUEST_MISMATCH | 脚本固定 requestId 重跑，规则包升版后载荷变化——**合同幂等语义的正确行为** | 脚本改为每轮唯一 requestId |
| 集成：run2 创建 409 | supersede 语义=新实体（新 id/v1），仍引用旧 id@2 版本不存在 | 改用 supersede 响应中的新证据 id |
| A 服务器一次静默退出（重启用后未复现） | 日志无错误输出，未能定位 | 重启并全量留档 stdout/stderr（runtime/server-3621.log）；如复现交 A |

## 4. 复跑与恢复方法

- 干净目录：拷贝 `V7/backend/C/` 整目录至任意机器（Node ≥20，无 npm install），运行 §2 两条命令即可——零外部依赖。
- 规则/案例/提示词任一修改：必须升版本号（rule-pack `version`、caseSet `version`、prompt 文件名版本段）并重跑评估刷新 evidence。
- 真实通道解除：用户提供已授权凭据的注入方式后，以 B 路网关实现 provider 契约注入（见 INTERFACES.md §2），`mock-provider.mjs` 不改动、不进生产。

## 5. 阻断与边界（如实）

1. **真实 HTTP 模型调用：阻断**。环境中存在 `ZAI_API_KEY` 但未获"用途/成本已授权"确认，且 R1 包禁止读写密钥；C 未读取该键，全部模型路径以注入 SIMULATION 桩验证，`provider: 'simulation'` 标记贯穿证据。
2. 对 A 合同实现的三项偏差/澄清请求已提交（`observations-for-A.md`：GET 缺 formalOutcome 投影、supersede 新实体语义说明、state 命令 body 文字更正）；C 侧均已按现状对齐，不阻塞。
3. 计算为单工具（现金流覆盖）；"报告正文需实读"未发生（无实读授权输入），场景线索仅以 lead 存在。

## 6. 下一步

1. ~~A 对 observations-for-A.md 裁决~~ 已闭合（v0.2 采纳，见 §0.2）。
2. B 网关交付 → 以同一 case 集做 mock/real 对比（授权解除后）。
3. 心跳期间：若 D 发布黑盒用例发现 C 层缺陷，按 LONG_RUN_GOALS 修复循环继续（无固定轮数）。
