# REPORT · R2-03 材料scope贯穿模型调用与回执摘要

2026-09-21 · ZCode（单writer，仅本路 ownership 内写入）· 任务书 docs/v0.4/tasks/ZCODE_R2_03.md · 契约同目录 [CONTRACT.md](CONTRACT.md)

**结论：验收完成。显式材料选择（02路 scope 模块）已接通模型调用链——决策分析路径 HTTP 全栈可用（materialScope → provider → pack.selection → 回执/缓存身份绑定），模型层对 selection 做发送前独立复核（摘要重算 + 片段⊆所选），缺参路径与改动前逐字节兼容。新测试 11/11 两轮通过（exit 0），既有回归 98/98 通过（exit 0，含03路回执围栏、02路证据、决策反馈/缓存/全链HTTP）。全程本地可计数替身，零真实 GLM 出站、零凭据读取。任务期内只读输入发生一次并行路漂移（receipts/glm 的 routing 功能），已核实对本路零语义影响，且全部证据在漂移后状态上取得。**

---

## 1. 交付物与源码 SHA256

| 文件 | 状态 | sha256 |
|---|---|---|
| Back/Edge/src/assistant-model.mjs | 修改（selection 独立复核 M1–M3 + 身份绑定；observe 签名不变） | `acf08f33f31517192915ea2356559fa2745254194b3809aa790731d64d95a5a0`（改动前 `41a7029d7177ef7c6e67fff563ca612bfb44c1fd5db98b6a9b3fa622af8b91b3`） |
| Back/Edge/src/assistant-decisions.mjs | 修改（materialScope 形状门 + scope 贯穿 authorized 全部再入 + EVIDENCE_* 错误如实透出） | `6530b1b1d89d10600a701026d33f048062089578fdec68dc07c237ec8185ca2d`（改动前 `31ca78085e0687db0b8ccef3264b0189670cda4b10e358f849b583f5d0cfca59`） |
| Back/Edge/test/v04-model-scope.model.test.mjs | 新增测试（6 例） | `6c3bb376b5ea9cb842712931be0ca6d1cdd5a2f63554dbff6b0a374c77449333` |
| Back/Edge/test/v04-model-scope.decisions.test.mjs | 新增测试（5 例） | `e3b12bdb5b13e5b33648c6d90a30d33d5becca9bc673511cd8439e27ce09f1ed` |
| docs/v0.4/results/r2-03-model-scope/CONTRACT.md | 新增（内部最小契约冻结） | 见本目录 |

开工前输入快照：[sha256-inputs-before.txt](sha256-inputs-before.txt)；收工复核：[sha256-outputs-after.txt](sha256-outputs-after.txt)。

## 2. 输入稳定性与任务期漂移（如实）

- 开工核验：02路（scope `9da6362d…`、provider `f5b7b8bf…`）与03路（receipts `3177fb8d…`、model `41a7029d…`、decisions `31ca7808…`）报告记录 hash 与当时工作区逐字节一致，方才动工。
- **任务期内漂移**：`assistant-receipts.mjs`（05:06）与 `Back/B/src/transport/glm.mjs`（05:05）被并行 writer 修改（DeepSeek routing 功能：`modelConfigHash` 条件纳入 `c.routing`；`buildModelRequest` 新增可选 `routeClass`）。两文件均非本路 ownership，本路零写入。
- **影响分析（为何继续而非停止）**：① 无 `routing` 配置时 `modelConfigHash` 摘要输入逐字节不变（条件展开零新增键），本路全部测试配置均无 routing；② 不传 `routeClass` 时请求体逐字节不变，routing 仅在 `mode:'real'` + `real.routing` 配置下激活，本路全为 mock 替身。故漂移对本路修改语义零影响。
- **证据时序**：全部证据日志（05:14）晚于漂移落盘（05:05/05:06），即 11/11×2 与 98/98 均在漂移后状态上取得，无需重跑。

## 3. 命令与退出码（工作区根执行）

```bash
# ① 本包专项（11例，两轮一致 EXIT=0）
node --test Back/Edge/test/v04-model-scope.model.test.mjs Back/Edge/test/v04-model-scope.decisions.test.mjs
# ② 既有回归（10个输入测试文件，98例 EXIT=0，证明零干扰与legacy兼容）
node --test Back/Edge/test/decision-feedback.test.mjs Back/Edge/test/assistant-cache.test.mjs \
  Back/Edge/test/assistant-evidence-http.test.mjs Back/Edge/test/assistant-model.test.mjs \
  Back/Edge/test/assistant-evidence.test.mjs Back/Edge/test/v04-receipts-unknown-fence.test.mjs \
  Back/Edge/test/v04-receipts-operation-scope.test.mjs Back/Edge/test/v04-evidence-scope.test.mjs \
  Back/Edge/test/v04-evidence-provider.test.mjs Back/Edge/test/g03d-decision-channel-surface.test.mjs
```

日志：`logs/run1.log`、`logs/run2.log`（11 pass / 0 fail，两轮）、`logs/regression.log`（98 pass / 0 fail）。

## 4. 必测矩阵 → 证据（替身真实命中数断言，不以返回码代替）

| 任务书必测项 | 用例 | 出站计数断言（模型替身/Connectors替身） |
|---|---|---|
| 单件 | MS-M-01、MS-D-01 | 上游请求正文仅所选ID；出站提示词含所选文本、**不含未选文本**；回执 `identity.context.evidencePack.selection.summary` 绑定；重放 1→1 命中 |
| 组合 | MS-M-02/03、MS-D-01 | 组合件全进包、第三件不进包不进正文；决策集随选择不同而不同 |
| 顺序去重 | MS-M-02、MS-D-01 | `['b','a','b','a']`→canonical `['a','b']`，与干净输入**同一 requestId**（deepEqual 包+重放零出站）；HTTP 侧上游正文 canonical |
| 材料失效 | MS-D-04 | 事前取代：`EVIDENCE_SCOPE_INCOMPLETE`(detail=[缺件]) 整次拒绝、**0 模型出站**；中途失效（模型已出站）：current=false 如实落库 valid=false、候选不泄露、respond 422 不冒充成功、新任务无死锁 |
| 非法范围 | MS-D-03 | 形状非法 7 种→400 `INVALID_MATERIAL_SCOPE`（0 Connectors、0 模型）；空集 `EVIDENCE_SCOPE_EMPTY`、越权 `EVIDENCE_SCOPE_UNAUTHORIZED`(detail) 均 0 上游调用；上游 500→`EVIDENCE_UPSTREAM_UNAVAILABLE` 0 模型出站 |
| 缓存（身份绑定） | MS-M-01/02/03、MS-D-02 | 同选择同上下文→同 requestId 重放零出站；**同 operationId 换 scope→409 IDEMPOTENCY_CONFLICT 零出站**（不同材料选择永不命中同一旧输出）；新 operationId（同/异 scope）=新身份新出站（D1 现行契约） |
| 未知 | MS-M-05、MS-D-05 | destroy→unknown 1 命中；同进程/重启重试 0 新增；**pending 未决换 operationId（含换 scope）→409 DECISION_PENDING 零出站**；pending 重试换 scope 按冻结 basis 重放（不重定向不绕过）；原选择围栏在换选择出站后仍有效 |
| 重启兼容 | MS-M-05/06、MS-D-05 | 显式 scope 成功/未知回执均跨实例（同 receiptsDir）持久重放零出站；决策层整栈重启（新模型实例+新会话）后围栏与 pending 阻断持续 |
| 证据不完整不冒充成功 | MS-D-03/04 | 全部证据层失败以 `{ok:false, error:EVIDENCE_*}` 422 如实透出，零模型出站 |
| 输出不含未选材料 | MS-M-01/04、MS-D-01 | 出站提示词逐字断言；**哈希自洽的未选片段手工混入→模型层 M3 拦截**（EVIDENCE_IDENTITY_MISMATCH，零出站零残留） |

模型层篡改矩阵（MS-M-04，7 例全零出站、零 claim/intent 残留）：summary 篡改 / artifactIds 乱序 / mode 改 legacy / 多余键 / 未选片段混入 / selection 形状非法（透出 `EVIDENCE_SCOPE_INVALID`）/ 空集（`EVIDENCE_SCOPE_EMPTY`）。

## 5. 出站计数总证据

- 全部替身仅监听 127.0.0.1 系统分配端口；**真实 GLM/DeepSeek 出站 0 次**，未读取任何凭据。
- 每例对模型替身命中数为精确断言（如 MS-D-05 全程恒为 1）；Connectors 替身对进入即拒类场景断言为 0（形状门/越权在任何 fetch 之前）。
- 决策层单次成功分析的 Connectors 复验次数（basis/respond/checkCurrent 再入）为既有 authorized() 语义，本路以同一 scope 保持 basis 一致，未新增调用面。

## 6. 既有语义保持（回归证明）

- **缺参兼容**：无 materialScope 时 decisions/model 行为与改动前一致——selection 缺省时模型侧 digest 复算输入逐字节不变（代码结构保证）+ decision-feedback 21 例、assistant-cache、assistant-evidence-http 全链、assistant-model、03路围栏/operation-scope、02路 scope/provider、g03d 决策面共 98 例全绿。
- operation/principal/customer/currentness 语义不变；feedback 带 scope 时按基线一致性校验（同 scope 200 / 异 scope 409 DECISION_STALE，MS-D-02）。
- 证据层错误由 `DECISION_UNAVAILABLE`(503) 改为如实透出 `EVIDENCE_*`(422+detail)：`EVIDENCE_UNAVAILABLE` 既有 422 语义不变，其余非证据错误映射不变（g03d/decision-feedback 回归全绿佐证）。

## 7. 模块通过与 HTTP 业务入口边界（任务书要求的区分）

- **已接通并验证（模块+决策业务入口）**：`POST /api/jw/v2/[actions/]customers/:id/assistant/decisions` 的 `materialScope` 字段——body 解析在 assistant-decisions.mjs（本路 ownership），经 startEdgeServer 真实 HTTP 栈验证（MS-D-01~05）；server.mjs 零改动。
- **未装配（留串行集成，本路未宣称）**：① observe/attachEvidence 路径的 `materialScope` 请求挂载（最小字段映射见 CONTRACT §5，server.mjs 不抢写）；② 用户页面组合分析入口（不存在）；③ 回执持久化的 selection.summary 专用列（当前经 contextHash/identity 间接进入 requestId，MS-M-01 已证绑定生效）；④ GET decisions 投影为 legacy 全量视角——scoped 决策集在 GET 下如实显示 current=false 且候选不展示（MS-D-01 断言），GET scope 参数属串行集成契约。

## 8. 政策歧义与既有限制（只报不发明，交 CTRL）

1. **D1 范围锁在 scope 维度的延伸**：未知终局后该 operationId 永久 pending，阻塞同仓库一切新 operation（含不同 materialScope），MS-D-05 机器复现；与03路 D1 同源，本路验证围栏成立，不发明自动解除。
2. **pending 重试换 scope 被静默忽略**（冻结 pending.context 胜出，0 出站按原 basis 重放）：是否应升级为显式 409 属政策，未改（MS-D-05 断言现行语义）。
3. **显式选择的材料被取代不可逆**：该选择的后续请求永久 422 失败关闭；已完成集按 current=false 失效投影。属显式模式失败关闭设计的自然后果，如实呈报。

## 9. 开发过程中修复的缺陷（全部为测试自身缺陷，产品代码无回退性修改）

1. `restart()` 返回裸模型实例导致测试直呼 `observe(pack)` 误传参（3 例失败根因）——改为返回同形 observe 包装。
2. MS-M-04 "乱序"用例误用单元素数组（反转等于自身）——改用双元素组合。
3. MS-D-02 反馈请求误发分析端点（缺 question → 400）——补 `/feedback` suffix。
产品实现一次成型，未因测试失败改动语义；未弱化任何断言。

## 10. 资源与并行纪律

- 零容器、零共享端口（全部 `port:0` + after 关闭）；临时目录 `os.tmpdir()/v04-ms*`、`v04-msd*` 逐例自清理；无残留测试进程。
- 未 commit/push/切分支；未改共享配置、CONTRACT 共享件、任务板、Front、B transport、server、provider、scope、receipts（receipts/glm 的变化系并行 writer 所为，本路零写入）。
- 未复跑：`serial-remainder/full-chain.e2e.mjs` 等需真实独占栈的套件（旧签名兼容由深比对与全链 HTTP 回归覆盖）；`v04-message-idempotency`（他路在途，非本路面）。
