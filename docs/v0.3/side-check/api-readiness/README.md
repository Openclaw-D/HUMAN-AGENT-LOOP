# 真实API跑批准备 · 只读侧查报告（api-readiness）

日期：2026-09-21 01:43–01:50（+08）｜执行：ZCode（只读侧查）｜HEAD：`cd11c55`（工作区对 `Back/B`、`Back/Edge` 模型链相关文件零未提交改动；`Back/Edge/src/upload-context.mjs` 为他路未跟踪新文件，未触碰）

**纪律**：全程只读。未读取任何密钥值（配置仅核对字段存在性与非敏感字段）、未调用模型、未修改代码；本报告只写 `docs/v0.3/side-check/api-readiness/`。

**证据标注约定**：
- 【源码】= 当前工作区源码证据，附 文件：行号，属可复核静态事实。
- 【实测】= 本报告时间窗内对本机运行栈的只读探测快照（healthz/netstat/docker/文件读取），过后可能已变化。
- 【上轮证据】= 落盘历史证据（run-log/回执/账本），属已发生事实。
- 【未验证】= 本轮未证实、跑批前需现场确认的运行状态。

---

## 0. 必读并发事实

检查进行中确认：**另一个 writer 正在 `docs/v0.3/real-api-qa/` 驱动 R24–R30 跑批**（run-log 行数在检查窗内从 23 → 35 → 39 持续增长，`R28.json` 于 01:45:06 写入，成本账本 reserve 从 55 → 58）。因此：

1. 本报告所有运行时数字是 01:43–01:50 的**滑动快照**，不代表该批次最终结果；该批次的结果报告归其执行 writer。
2. 在该批次确认收尾前，**不得从任何会话再起真实出站**（同栈并发出站 + 证据目录串写，违反串行/单 writer 纪律）。这是下批跑批的第一阻断项（B1）。

---

## 1. 六项检查点核对

### 1.1 现有入口

【源码】唯一已验证的真实模型入口链为 **zloop 隔离栈 Edge 直连链**（A 队列→B worker 生产形态仍为设计预留，`modelTransport` 恒 null；前端页面接线另计）。路由面：

| 入口 | 方法/路径 | 代码位置 |
|---|---|---|
| 会话交换 | `POST /api/jw/v2/session`（`{credential}` 或受控目录 `{principalId}`） | `Back/Edge/src/server.mjs:654` |
| 辅助观察 | `POST /api/jw/v2/actions/customers/:id/assistant/observe` | `server.mjs:662-665`（注册）、`server.mjs:380-476`（处理） |
| 候选决策 | `GET /api/jw/v2/customers/:id/assistant/decisions?assistant=`；`POST /api/jw/v2/actions/customers/:id/assistant/decisions`（含 `action:"select"` 反馈） | `Back/Edge/src/assistant-decisions.mjs:7-10`（正则），GET/POST 前缀约束 `:12-13` |
| profile 切换 | `POST /api/jw/v2/admin/model-profile/activate` | `server.mjs:548`（审计点） |
| 健康探测 | `GET /healthz/ready`（`checks[assistant-model]`，advisory）、`/versionz` | `server.mjs:831-838` |

助手枚举：`business|policy|credit|commerce|asset|jianwei`（`assistant-model.mjs:33`）；taskKind 枚举 `next_action|path_forecast`（`assistant-decisions.mjs:5`）。observe 入口 `requireEvidence:true` + `maxContextChars:12000`（TEC-CTX-1，`server.mjs:812-816`）——无证据包客户直接 422 阻断（实测已复现，见 R15/R04 形态）。

### 1.2 鉴权

【源码】四层，全部失败关闭：
1. **CSRF 写口守卫**：所有 POST 先过 Origin/Sec-Fetch-Site 判定（`server.mjs:648-653`，判定逻辑 `:79-102`）。
2. **会话**：`requireSession`（`x-jw-session`，`server.mjs:239`）；身份目录来自 `--auth-file`，凭据 SHA256 存内存、登录时用 A 只读探针复核凭据仍有效（`server.mjs:852-869`）。
3. **授权**：observe/decisions 均走 `verify({action:'workspace:read'})` + `store.getWorkspace`（A 逐请求裁决，越权/未知客户 403/404 且存在性不泄露，`server.mjs:386-394`）；decisions 另有 staff 角色门（customer 角色一律 403，`assistant-decisions.mjs:31-33`）。
4. **返回前再授权**：模型等待期间撤权/换租户 → 输出不披露、`current=false`（`server.mjs:431-446`）；decisions 侧 `checkCurrent` 同源（`assistant-decisions.mjs:115`）。

【上轮证据】zloop 身份目录 9 个合成主体：`biz1/cust1/cred1/comm1/asset1/app1/svc1/adm1/out2`（`Back/Edge/.run/zloop/edge-auth.json`；无 policy1，policy 案例由 biz1 发起——当前实现 staff 内角色不与 assistant 参数绑定的细节见 `assistant-decisions.mjs:31`）。越权三连在上轮实测为 404/403/401 如实返回（run-log R29，outbound=false）。

### 1.3 模型配置读取路径

【源码】装配链（单密钥源，不复制密钥）：
```
Back/B/config/b-config.json（Git 排除，用户注入 apiKey）
  → zloop-prep.mjs:22,35 生成 .run/zloop/assistant-config.json（transport 段逐字节取自 b-config；
    budget 钉回授权包络）+ model-profiles.json（active=glm52-real@1）
  → zloop-up.mjs:212-214 以 --model-config/--model-profiles/--model-receipts-dir 启动 Edge
  → server.mjs:803-830 createAssistantProfiles({registryPath}) → assistant-model.mjs:49 createAssistantModel
  → createModelTransport（Back/B/src/transport/glm.mjs:65）
```
失败关闭语义：未给 `--model-config` → 入口 503 `MODEL_NOT_CONFIGURED` 确定未发送（`server.mjs:380-384`）；给了但文件不可读/mode 非 real|mock/缺 endpoint|model → **启动即抛错**（`assistant-model.mjs:66-83`）；`transport.mode 只能 real|mock`、`thinkingType ∈ enabled|disabled`、`maxOutputTokens/maxRequestChars` 非正整数均抛错（`glm.mjs:67-76,306-324`）。密钥只进 Authorization 头，不进身份/回执/审计（`glm.mjs:370`、`assistant-receipts.mjs:33-37`）。

【实测 01:44】`assistant-config.json` 生效形状：`mode=real`、endpoint=`https://open.bigmodel.cn/api/paas/v4/chat/completions`、`model=glm-5.2`、`timeoutMs=60000`、`maxRequestChars=24000`、`maxOutputTokens=2000`、`thinkingType=disabled`、`outboundAllow=["https://open.bigmodel.cn"]`、费率 0.008/0.028 元每千 tokens、**apiKey 在位（值未读）**；`evidencePolicy.allowedHashes` 178 条获准合成材料白名单；profile registry active=`glm52-real@1`。

### 1.4 预算门

【源码】`glm.mjs:179-266`：出站顺序为 **outboundAllow 白名单门（:351）→ 预算门（:353）→ 网络动作**。预算门在 `budget.lock` 跨进程互斥（fs-lock 加固协议，:127-139）内"严格读账→判定→预占"：全局 `maxTotalCost`、客户级/会话级子限额、`maxCalls`/`maxCallsPerSession` 五类超限均返回确定未发送（BUDGET_EXCEEDED 族）；账本任何 I/O 错误/坏行 → 失败关闭不吞错（BUDGET_LEDGER_*，:141-167）；reserve 永久入账不冲销、actual 只补记超出估算的差额、账单未知显式 `billKnown=false` 不记 0（:268-282）。重启不绕过（持久 JSONL），跨进程不绕过（文件锁）。

【实测 01:48】zloop 账本 `Back/Edge/.run/zloop/model-cost-ledger.jsonl`：reserve 58 条 = 按预占口径 20.30/196 元；调用计数 58/200（余 142）；账本末条 17:47:14Z（跑批仍在写入）。`unlimitedTotalCost=false`，zloop 的 196 元/200 次包络**当前生效**（与 takeoff 共享配置的 unlimited 语义不同，勿混谈）。

### 1.5 未知不重发

【源码】四道闸，逐条核实：
1. **三分发送语义**（`glm.mjs:11-14,388-429`）：连接未建立即失败=sentFlag:false；对端明确 4xx/5xx=确定失败；超时/中止/响应体中断=`status:'unknown', sentFlag:null`，错误文案明示"禁止自动重试"。transport 全文件无重试路径。
2. **回执幂等**（`assistant-model.mjs:198-232`）：intent 先落、terminal 后落；重放逐字段校验身份（receiptVersion/tenant/customer/contextHash/configHash/payloadHash），terminal 直接复用（零出站）；intent 残留=发送后未知 → `RECOVERED_INTENT_WITHOUT_RECEIPT` 如实 unknown，不重发（:202,:219-225）；claim 独占 wx 创建、获取后再复读、绝不覆写（:226-232）；任何存储/传输不确定 → `RECEIPT_OR_TRANSPORT_UNCERTAIN`（:291-294）。
3. **decisions 通道围栏**（`assistant-decisions.mjs:89-96`）：同 operationId 换 kind/换内容 → 409 `IDEMPOTENCY_CONFLICT`；已完成 operationId 重放 → replayed；未完成 pending 在位 → `DECISION_PENDING`（个人 pending 保留，不换 ID 绕过）。
4. **profile 防重发 marker**（`assistant-profiles.mjs:55-70`）：发送状态未知的逻辑请求留下 `unresolved-<logicalId>.json`，后续任何同身份请求（含切 profile）→ `PROFILE_SEND_UNRESOLVED`（unknown/sent=null，零出站），配置切换不能解除。

【上轮证据】35 个 intent 文件全部有 terminal 孪生（崩溃残留=0）；35 个空文件为 `.claim` 独占标记（正常残留，无害）。唯一 terminal unknown 锁：H 客户（cust-mu9zheml-…）·credit·问题"基于当前材料，下一步优先核对什么？"，15:42:23Z 落定；profiles 目录 2 枚 unresolved marker。**R03 教训**（重要）：QA 轮 R03 以新 operationId 走 decisions 通道"复验 unknown 锁"，实际新出站且 succeeded——因为 decisions 身份含 operationId/decisionTask（`assistant-model.mjs:171-175`），换 operationId 即新身份。**unknown 锁复验必须走 observe 同题同上下文，或 decisions 同 operationId 原样重发**。同因：R05-replay/R28-replay 在证据变化后 identity 漂移产生**新出站**（账本 Δ2），仅 R30-replay（observe、上下文未变）达成 replayed=true 零出站（314ms）。

### 1.6 结果留证

【源码】持久层：① 终局回执 `--model-receipts-dir/receipts/*.json`（含 identity 全字段/configHash/promptVersion/usage/graphTrace）；② 成本账本 JSONL；③ 决策集与反馈 `decision-feedback-store`（同目录）；④ profile 审计 `profile-audit.jsonl`（`assistant-profiles.mjs:46`）。
【源码·如实局限】**Edge 审计 sink 为进程内存实现**（`audit.mjs:7-8`，`entries=[]` 仅追加于内存；代码注释自认"真实持久化随任务01内核落地替换此 seam"）——`assistant.model.observe` 审计条目随进程重启丢失，经 `GET /api/jw/v2/audit`（`server.mjs:572`）仅进程内可查。持久留证主链=①+②+③+驱动器证据，审计条目不能作为跨重启证据引用。
【上轮证据】QA 轮留证齐备：`docs/v0.3/real-api-qa/evidence/`（run-log.jsonl、responses/R*.json、state.json、version-binding.txt 含关键源 SHA256）；回执无密钥（设计断言 + 抽查一致）。

---

## 2. 阻止跑批的具体问题（必须先解除）

| # | 阻断项 | 解除条件 |
|---|---|---|
| **B1** | **并发 writer 正在跑批**：real-api-qa R24–R30 于检查窗内持续产生真实出站（run-log 23→39 行、reserve 55→58）。同栈再起批次=并发出站+证据目录串写。 | 该批次 run-log ≥10 分钟无新增、执行 writer 会话已确认收尾；以 `node driver.mjs status` 与账本末条时间复核。 |
| **B2** | **新一轮出站次数未授权**：上轮"≤30 次出站"是该轮驱动器内约束（01:45 快照已用 25+/30），不自动延续。系统预算门余量（142 次/约 175 元）是技术上限，不是授权。 | 用户明示新批次的出站尝试上限与费用口径（本报告第 4 节首批 5 案按 ≤3 次真实出站设计，建议按 ≤5 次授权留复验余量）。 |
| **B3** | **重放通道语义易踩坑**（设计约束，非缺陷）：decisions 重放在 revision 前进后不可用（R01-replay 实测 409 IDEMPOTENCY_CONFLICT）；证据变化后 observe 同题=新身份新出站（R05-replay 实测 Δ2）。若把"重放零出站"写进新批通过标准而不加身份前提，会把二次付费误判为缺陷、或把新出站误判为重放通过。 | 案例设计必须绑定身份前提：重放类断言只允许 observe 同题**且上下文版本未变**（对照组 R30-replay 形态），并在跑前读取账本行数作零出站基线。 |

## 3. 非阻断注意项

- **N1 审计易失**：审计 sink 进程内存（1.6 节），跨重启留证只认回执+账本+驱动证据；报告与验收引用审计条目时须注明窗口。
- **N2 profiles marker 与回执差一**：unresolved marker 2 枚 vs terminal unknown 回执 1 条——其中一枚 marker 对应的逻辑身份在当前 receipts 目录无 unknown 终局回执可对应（零出站阻断不受影响，验收时可顺带核对）。
- **N3 输出截断**：`thinkingType=disabled`+`maxOutputTokens=2000` 下长预测输出可能触顶截断（上轮有触顶可解析记录）；候选数不足 5 属如实，不算失败。
- **N4 网络路径未验证**：历史出现过环境代理致直连超时（REAL_API_CHECKPOINT 2026-09-20）；本侧查未做任何出站探测，智谱侧可达性与代理环境属【未验证】，首批 S1 即是连通性验证。
- **N5 环境依赖**：zloop-up 预检要求 Node 22.x + Docker + Front/dist 构建 + 端口段 48304/48284/48324/15474 空闲（`zloop-up.mjs:55-62`）；重启栈须走 `zloop-up.mjs`（幂等，容器 owner 标签校验），勿手工抢占。
- **N6 密钥单点**：apiKey 只在 `Back/B/config/b-config.json`（Git 排除）；换机/重建栈需用户重新注入，不可从 Git 恢复。

## 4. 运行时快照（2026-09-21 01:43–01:48+08，【实测】）

- 进程：A(48304)、Connectors(48284)、Edge(48324) 三进程 01:05:00+08 启动存活至今（PID/netstat 与 pid 文件一致）；PG 容器 `jw-zloop-pg@15474` Up。
- Edge `/healthz/ready`：`ok=true`；`checks[assistant-model]` advisory `ok=true, configured=true, mode=real, glm-5.2, profile glm52-real@1`，budget `{maxTotalCost:196, maxCalls:200, perCallEstimate:0.35}`；A `/healthz` ok db=up；Connectors ok（realWeCom/realTrtc 均 blocked_external_access，外呼隔离在位）。
- 回执目录：35 terminal（34 succeeded + 1 unknown）+ 35 intent 孪生 + 35 `.claim` 标记（跑批进行中数字仍增）。
- 账本：reserve 58（20.30/196 元）、调用 58/200。
- 上述全部随在跑批次滑动，起批前必须重新快照。

---

## 5. 首批 5 个合成案例及通过标准（下一批建议）

定位：real-api-qa 30 条收尾后的**新批次首批**。原则：全新问题文本（不与 R01–R30 任何身份撞车）、串行并发=1、出站尝试 ≤3（建议授权 ≤5 留复验）、gate 案例零出站、证据写 `docs/v0.3/side-check/api-readiness/evidence/`（与他轮目录隔离）。客户 Z=cust-mu9yu9db-…（中·500万）、H=cust-mu9zheml-…（好·1000万），均为既有合成客户。

| # | 类型 | 案例 | 关键检查点 |
|---|---|---|---|
| **S1** | [out] | Z·credit·decisions·next_action 新题："请综合经营、政策、商务、资产四域现有材料与缺口，给出3-5个当前最优先的核验或补证建议候选，并说明为何优先。" | HTTP 200、`model.status=succeeded`、`sent=true`；候选 3–5、每项带 `confidenceKind=model_estimate_uncalibrated`、evidenceRefCount≥1；回执 `identity.promptVersion==='assistant-observe-v2'`；label 为核验/补证行动，无批准/额度结论；账本 reserve+actual 各 +1 |
| **S2** | [out] | Z·credit·observe 追问："该客户申请金额与融资用途是什么？请引用材料原文片段说明。" | 200 succeeded；observations 携带 `evidenceRefIds` 且全部命中本次证据包可引用宇宙；金额口径 500 万与 D01 一致、单位正确；材料未覆盖处明确"未知"；`authority:'none'`/`scope:'preassessment_only'` 在响应中 |
| **S3** | [out] | H·asset·path_forecast 新题："假设该客户完成设备权属与验收核验，请对资产域预评估结论的可能走向做条件化预测，给出3-5个候选。"（operationId 前缀 `S3-`，expectedRevision 现场取） | 回执 `identity.promptVersion==='assistant-decide-forecast-v1'`（版本绑定断言）；每候选 `forecast{targetState,conditions,horizon}` 完整；label 为未来可能状态，**不得断言批准/签约/补件已发生**；confidence 不冒充概率/违约率 |
| **S4** | [gate] | 越权三连（对 Z）：cust1 会话 GET decisions、out2 会话 POST observe、无会话 POST observe | 404 / 403 / 401 如实（存在性不泄露）；账本行数 Δ=0（零出站）；A 三表（credit_facilities/financing_requests/exposure_entries）前后计数不变 |
| **S5** | [gate] | 防重发双验：**5a** H·credit·observe 以 1.5 节 unknown 锁原题原样发送（"基于当前材料，下一步优先核对什么？"）；**5b** S2 响应返回后 60 秒内同载荷原样重发 | 5a：`PROFILE_SEND_UNRESOLVED`（unknown/sent=null）**或** unknown+`replayed=true`，二者皆可，账本 Δ=0；5b：`replayed=true`、零出站、耗时 <2s（对照组 R30-replay 形态 314ms）；任一返回必须如实展示，不得自动重试 |

### 通过标准（逐案 + 全局）

**逐案**：上表关键检查点全部满足，且无"答非所问 / 编造引用（evidenceRefIds 未命中宇宙）/ 金额单位错 / 越权结论 / 旧结果冒充新结果 / 预测当事实"任一硬伤。任一硬伤=该案失败，如实留档，不削弱断言、不删除失败记录、不因失败改预期。

**全局门（每批一次判定）**：
- G1 串行执行，并发=1；出站尝试（含 unknown/超时）≤ 授权数；同输入缓存重放不计（须满足 B3 身份前提）。
- G2 每次出站留证三件套齐全：terminal 回执 JSON、账本 reserve+actual、本批运行记录（请求/响应原文 + 账本基线行数）；全部证据零密钥、零令牌、零凭据。
- G3 `authority=none`：全部响应无批准/额度/价格结论；A 三表调用前后零变化（机器断言）。
- G4 未知如实：任何 `unknown/sent=null` 原样记录并计入尝试数，不重发、不换 ID 绕过。
- G5 版本绑定：S1/S2/S3 跑前记录 HEAD、关键源 SHA256 与 `/versionz` 封存，回执 promptVersion 断言写入通过标准。

### 起批前置门（全部确认后才可出站）

P1 = B1 解除（在跑批次确认收尾）；P2 = 栈健康重新快照（Edge ready ok + assistant-model ok=true）；P3 = 用户明示本轮出站上限（B2）；P4 = 证据目录独占（本报告同目录 evidence/）。

---

## 6. 本报告引用的可复核路径

- 源码：`Back/Edge/src/{server,assistant-model,assistant-decisions,assistant-receipts,assistant-profiles,audit}.mjs`、`Back/B/src/transport/glm.mjs`、`Back/Edge/scripts/{zloop-up,zloop-prep}.mjs`
- 配置/账本/回执：`Back/Edge/.run/zloop/{assistant-config,model-profiles,zloop-runtime,edge-auth}.json`、`model-cost-ledger.jsonl`、`model-receipts/{receipts,profiles}/`
- 上轮证据：`docs/v0.3/real-api-qa/{CASES,driver.mjs}`、`evidence/{run-log.jsonl,state.json,version-binding.txt,responses/}`
- 历史口径：`docs/takeoff/first-admission-v1/ZHIPU_API_ACCEPTANCE.md`、`docs/v0.3/REAL_API_CHECKPOINT.md`

（侧查完成即停。本报告不含密钥值；未调用模型；未修改任何代码与共享状态。）
