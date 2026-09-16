# RESULT — V7 backend-next Lane C（2026-09-16 夜间长程 · 06:40 终审版）

任务书：`V7/NIGHT_BACKEND_20260916.md` §C + /goal · 写面：仅 `V7/backend-next/C/**`
本文件只写真实结果与真实失败；未完成门单列（§4）。恢复方法见 `README.md` 快速开始。

## 1. 交付完成情况（全部经可复跑命令验证）

| DoD 项 | 结果 | 证据 |
|---|---|---|
| 独立可启动 loopback mock 服务（真实 socket，非进程内 fixture） | **完成**：OpenAI 兼容 `/chat/completions`；独立进程启动 3730，外部进程冒烟 7/7 | `evidence/smoke-external-3730.txt`、`evidence/mock-3730-standalone.log` |
| 故障覆盖：成功/缺字段/格式错/延迟/429/5xx/断连 unknown/凭据异常标记/串项目污染探针 | **完成（11 场景）**：success、missing_field、format_error、latency、rate_limited、server_error_500/502/503、disconnect_before_response、partial_response、malformed_response、invalid_credential；+ 凭据掩码/泄漏探针、canary 串线探针、控制面 | `test/mock-server.test.mjs` 16/16（真实 TCP） |
| 接口文档给 B | **完成**：`MOCK_API.md`（场景表/控制面/canary 用法/凭据纪律/已知限制/B 侧语义映射） | MOCK_API.md v1 |
| 8 个差异化商业融资租赁小微制造合成案例 | **完成**：成熟直租/老客回租/新客粗糙报表+流水验证/隐性债务矛盾/权属争议/低流通+处置线索/订单集中+季节口径/高报价+成本未知——8 种互异风险机制 | `scenarios/leasing-cases-v1.json` |
| ≥2 个多轮（补证/矛盾纠正） | **完成**：L3 双轮补证（流水 v1→v2 取代、不确定性收窄）、L4 双轮矛盾纠正（同口径矛盾短路→银行合同取代解决→薄覆盖如实呈现） | 评测 turn1/turn2 断言 |
| 1 个非租赁模板检验可配置性 | **完成**：维保服务采购反例模板——无租赁字段断言、租赁专用工具被门禁（套用即 rule_not_covered）、通用 ratio 工具两侧复用、同一适配器投影成功 | `test/case-pack.test.mjs`、`test/contract-adapter.test.mjs` |
| 确定性计算工具 | **完成**：`calc:cash-flow-coverage@1`（自旧 C **原样复用**，sha256 与旧件记录一致：d9e9fdb1…）+ 新写 `calc:ratio@1`；结构化拒绝族、缺口径不补造、结果不授审批权 | `evidence/p2-file-hashes.txt`、工具测试 6/6 |
| 用户证据纪律（五级/口径/来源/取代）与"高息≠风险覆盖" | **完成且机械强制**：规则包 7 条 userConstraints；unknown 级证据禁止进计算输入；净收益数值+成本未知=违规；高息覆盖论措辞探针；L8/H3 负例脚本**必须被拦截**的断言通过 | `rules/rule-pack-v2.json`、评测断言 |
| 固定 seed | **完成**：`jw-v7c2-night-20260916` 贯穿案例包/heldout/mock；mock 同请求恒同响应有断言 | 案例包 seed 字段、E2E determinism 断言 |
| 独立 heldout，不以自生成答案当真值 | **完成**：heldout 3 案书写后未参与调规则，主包通过后**一次性首跑 3/3、17/17 断言通过**；期望全部来自规则+算式推导（checker 机械可复算），脚本候选仅是被检 fixture | `evidence/eval-report-heldout.json` |
| A 契约未发布先做独立件，发布后对接 | **完成（实库集成全 PASS）**：CONTRACT v0.1 发布后完成投影适配+本地预检；A 服务 01:54 上线后以 A 公开合成 token（tok-admin）实测 **12 步全 PASS**——匿名 403 失败关闭、租赁模板落库（tpl-mu2z26xk v1）、建项目、证据链 3 提交（projectInputVersion 2→4）、supersede 新实体+指向、人工待办、goal 实例化 200+重复 409 GOAL_EXISTS、计算投影；**非租赁模板同链路全 PASS**（真实服务级可配置性证明） | `evidence/contract-integration-leasing.json`、`evidence/contract-integration-non-leasing.json` |
| 检查点 STATUS/RESULT/evidence | **完成**：CP0–CP3 落 STATUS；评测/E2E/集成/冒烟/hash 证据齐 | `STATUS.md`、`evidence/` |

汇总数字（06:36 终审复跑）：**单测 34/34 · 主案例包 8/8 案 60/60 断言 · heldout 3/3 案 17/17 断言 · E2E（真实 socket）8/8 · 外部冒烟 7/7 · 实库集成两模板 outcome=ok · 全链复跑退出码 0/0/0/0/0/0**（`evidence/reproduction-run.txt`、`evidence/final-file-hashes.txt`）。

## 2.5 夜间闭环事件（C 产物被三方真实消费）

| 消费方 | 事件 | 证据 |
|---|---|---|
| A 内核（实库） | 两模板落库 + C 证据链/取代/人工待办/goal 实例化实测全 PASS（01:55、02:55 两轮，契约 v1.0→v1.1 适配后复通） | `evidence/contract-integration-*.json` |
| A assembly | 两模板落库 + **8/8 案例计划顺序执行全 ok**（真实项目落库，errors=[]） | `../A/assembly/c-plans-result.json` |
| B transport | 13/13 真实集成经 C mock（3731 真实 socket）执行模型调用；三分发送语义逐条对齐 MOCK_API §3；unknown 零盲重发有测试 | `../B/STATUS.md` |
| D 黑盒 | "C 假API断连场景注入成功，控制面可查"（探针就绪验证）；**D 无归 C 缺陷** | `../D/DEFECTS.md` |
| 契约演化 | v1.0→v1.3 四版全部跟随：v1.0 禁键范围修正 adapter；v1.1 expectedVersion 必填→集成脚本按 §3.2 消费 serverVersion 重试适配；v1.2/v1.3（失效级联停止/stale 传递投影候选，v1.3 待用户裁决）零 C 改动 | STATUS CP7/CP10/CP12/CP13 |

## 2. 语义要点（给验收方）

- **unknown ≠ 失败 ≠ 未发送**：`disconnect_before_response`/`partial_response` 在服务端 `processed=true`（控制面可证），客户端只能归 unknown；`malformed_response` 传输完成但响应损坏，必须与 unknown 分流。测试断言了这条边界（`test/mock-server.test.mjs`）。
- **短路跨传输层成立**：矛盾/口径未决轮零模型请求（E2E 用控制面请求数核对，L4 turn1/H2 期望 0）。
- **不算作完成的事**：mock 响应≠模型能力；脚本候选经 socket 往返只证明 transport；计算工具输出≠审批依据（authority=none 全程保持）。

## 3. 真实失败记录（全部已修复）

1. mock 初版漏 `createServer` 包装；缺 key 401 文案掩码问题。
2. checker：AUTHORITY_WORDING 违规码被 schema_invalid 吞并；unknown 级探测漏 `value:null` 证据；多轮前后轮索引浅拷贝失配。
3. 适配器：FORBIDDEN_KEY 误扫模板 schema 自身键名（decisionRole）→ 按契约 §3.1 收窄为 result.output/params；测试 "pricing"≠"price" 期望错误。
4. evidence：复跑脚本首次把管道 tail 的退出码当 node 退出码 → 改 PIPESTATUS 直取并重跑。

## 4. 未完成门与依赖（如实）

| 门 | 状态 | 解锁条件 |
|---|---|---|
| goal 编排全链（claim→complete→accept→decide 走 C 案例数据） | **属 A assembly**（NIGHT §A）；C 已实测模板可实例化+计算/候选投影合法，且 assembly 已执行 8/8 plans 到证据/待办层 | assembly 后续把执行器（B）接上案例项目做完整闭环 |
| 真实模型、生产权限、第二机器 | **未测**（任务书边界：0 真实调用、无部署；A 的 GLM transport 本轮恒 not_configured，B/C 同样 0 真实调用） | 不在本轮范围；待用户授权真实 GLM-5.2 |
| heldout 独立性 | 同一作者按同规则书写，非第三方真值；已执行"书写期不运行、首跑一次性"纪律（3/3 首跑通过） | 更强独立性需用户/他 lane 提供判据 |
| CONTRACT v1.3 stale 传递投影 | **待用户裁决**（A 标注的语义候选）；对 C 无改动需求 | 用户裁决后如定稿，C 无需跟随（读投影消费方） |
| 实测命名分歧待 A 裁量 | 契约 §2 写 Project.`inputVersion`，服务端投影实为 `projectInputVersion`；C adapter 双形状防御已消解 | A 经 OBS 通道决定改名或修契约文本 |

## 5. 结论

C 路 /goal DoD（mock 服务+接口文档、8+2+1 案例与模板、确定性工具、证据纪律、固定 seed+heldout、检查点）在授权写面内**全部完成并经可复跑命令验证**，且核心产物已被 A 内核（实库落库+集成）、A assembly（8/8 plans）、B transport（13/13 经 mock）、D 黑盒（断连探针）**四方真实消费闭环**。真实失败 5 项全部修复留痕（§3）。
