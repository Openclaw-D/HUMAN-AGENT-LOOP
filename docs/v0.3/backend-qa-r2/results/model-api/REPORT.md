# backend-qa-r2 · 02_MODEL_API 测试报告

任务书：`docs/v0.3/backend-qa-r2/02_MODEL_API.md`
执行：ZCode，2026-09-21（本包独占串行执行，未启动其他包）
结论：**15/15 必测用例通过（exit 0），复用基线 4 个输入测试文件 37/37 通过（exit 0）；无失败、无跳过必测、无产品缺陷需交最小复现。**

---

## 1. 运行命令（独立可复跑）

```bash
# 工作区根目录 C:/Users/22673/Desktop/JW 下执行
# ① 复用基线（四个输入测试，原样不改，未用默认测试入口）
node --test --test-reporter=tap Back/Edge/test/assistant-cache.test.mjs Back/Edge/test/assistant-evidence-http.test.mjs Back/Edge/test/decision-feedback.test.mjs Back/Edge/test/assistant-profiles.test.mjs
# ② 本包专项（15用例）
node --test --test-reporter=tap docs/v0.3/backend-qa-r2/results/model-api/model-api.qa.test.mjs
```

实测退出码：① `EXIT=0`（37 pass）② `EXIT=0`（15 pass），连续两轮复跑一致。

## 2. 测试形态与边界声明

- **真实 Edge HTTP**：每用例经 `startEdgeServer`（产品真实装配面）起真实 HTTP 服务，仅监听 `127.0.0.1`，端口由系统分配（listen 0）；观察/候选/激活路由全部走真实 HTTP 请求-响应。
- **本地模型HTTP替身**（`standin.mjs`）：可记录请求头/正文的 loopback 服务，按必测要求分别提供 **合法JSON / 格式错误（200+非JSON）/ 断流（socket销毁）/ 延迟（超客户端超时）**，另加响应体中断、5xx 两种扩展模式。transport 固定 `mode:'mock'`，**未调用任何付费模型、未发起外网请求、未循环凑调用量**；本报告不构成真实模型质量验收。
- **数据库不适用**：被测路由（observe/decisions/profile 激活）的数据面全部为文件/内存实现（回执文件、决策反馈账本 JSON、fixture store、内存审计 sink），零 SQL 依赖，故本包未创建 PG 容器（Docker 可用但无必要；无镜像下载）。
- **隔离**：每用例独立 OS 临时目录（`qa02-modelapi-*`）、独立端口、独立回执目录；运行结束自清理（运行后残留 0 个）。未停止/触碰任何共享服务。
- 只新增本包目录内文件；产品源码与既有测试零修改；未 commit/push。

## 3. 结果明细（通过）

逐用例的实际 HTTP 状态、出站计数、回执身份、current 已记录在 `qa-ledger.json`（运行时自动生成）。出站计数以替身捕获的请求命中数为准。

| 用例 | 必测项 | HTTP状态 | 出站 | 关键断言 | 结论 |
|---|---|---|---|---|---|
| QA02-01 | 合法请求出站一次 | 200 | 1 | `authority='none'`，`status=simulated`，`sent=true`，`current=true`，正文含`[服务端获准证据包]` | 通过 |
| QA02-02 | 相同输入重放不再出站 | 200 | 1 | 同进程重放 `replayed=true`；**重启 Edge（新模型实例同回执目录）仍持久重放**，observations 一致 | 通过 |
| QA02-03 | 重复点击并发合并一次（单用例） | 200×8 | 1 | 8 并发同输入：requestId 唯一、全部 `replayed=false`、替身命中 1 | 通过 |
| QA02-04 | 需求/候选/版本/模型配置独立身份 | 200 | 6 | request / candidate / inputVersion 变化各自新 requestId 且 `replayed=false`；模型名变化→`configHash` 变→新出站；**仅 apiKey 轮换→configHash 不变→重放零出站** | 通过 |
| QA02-05 | 客户/租户/身份隔离 | 200 | 3 | 不同客户独立回执；同客户跨租户会话不复用他租户回执（新 requestId、contextHash 不同） | 通过 |
| QA02-06 | 响应期间上下文变化失效 | 200 | 2 | 在途变更→`current=false`、observations/questions 空、usage 保留、receiptVersion=2；变更后新身份新出站不假去重 | 通过 |
| QA02-07 | 超时→未知不重发 | 200 | 1 | `RESULT_UNKNOWN_TIMEOUT`、`sent=null`；同进程与重启后重试均 unknown，**零新增出站** | 通过 |
| QA02-08 | 断流/响应体中断→未知不重发 | 200 | 2 | `RESULT_UNKNOWN_INTERRUPTED` / `RESULT_UNKNOWN_TRUNCATED`；各自重试零新增出站 | 通过 |
| QA02-09 | 格式错误 fail-closed＋5xx | 200 | 2 | 200+非JSON→`RESPONSE_CORRUPTED`（failed，`sent=true`，确定已发送不自动重发）；5xx→failed/sent=true/错误码透传响应体 `error` 字段 | 通过 |
| QA02-10 | 损坏/旧回执 fail closed | 200 | 1 | 不可解析（`{broken`/`null`）→`RECEIPT_OR_TRANSPORT_UNCERTAIN`；可解析形状非法→`RECEIPT_CORRUPT`；篡改 identity→`RECEIPT_IDENTITY_MISMATCH`；仅剩 intent→`RECOVERED_INTENT_WITHOUT_RECEIPT`；legacy 残留阻断且文件逐字节原样；**全部零新增出站**（经重启的新 Edge 实例验证） | 通过 |
| QA02-11 | profile 切换在途绑定旧配置 | 403/422/200 | 2 | 非管理员激活 403；带 apiKey 激活体 422；在途请求返回 `profile.id='p0'`；切换后新出站走 p1；切回 p0 重放 p0 回执（配置身份隔离）；激活态跨重启持久 | 通过 |
| QA02-12 | 未知跨 profile 阻断 | 200 | 1 | 发送未知后切 p1→`PROFILE_SEND_UNRESOLVED`，新 profile 零出站，重启仍阻断 | 通过 |
| QA02-13 | 获准证据与上下文限制 | 200 | 1＋0 | 替身捕获正文：含获准证据包原文、**不含浏览器注入事实、不含配置密钥/会话凭据**、长度≤maxContextChars、无 authorization 头；伪造引用降级为待核验（`citationChecks` 一假一真）；超限证据故障注入→`EVIDENCE_CONTEXT_LIMIT`、`sent=false`、零出站 | 通过 |
| QA02-14 | 凭据不出现在响应与日志 | 200 | 2 | 三枚金丝雀（配置 apiKey、会话凭据、B租户凭据）扫描：全部业务响应、Edge 日志、审计条目、回执/决策/成本账本文件、替身请求头与正文，**零泄漏**；会话换响应仅含不透明 sessionId | 通过 |
| QA02-15 | 候选API协议与调用控制 | 200/400 | 1 | 候选按支持把握降序；同 operationId 重放 `replayed=true` 零出站；反馈 select 持久；伪造 candidateId 400、未知 taskKind 400 均**零出站**；材料变化后 `current=false` 且候选清空 | 通过 |

输入四个测试文件（复用基线，未改动）覆盖并佐证：模型级配置身份矩阵、双 OS 进程原子 claim、durable 五种残留防重发、taskKind 全套（含 path_forecast 契约与未知 pending 跨 kind 不重发）、profile 在途/重启语义、Edge→Connectors→模型真实 HTTP 证据链。

## 4. 失败

无。（首轮 run1 曾 5 例失败，逐一定位为**测试侧问题**：夹具重写配置回退模型名、onHit 未清除、5xx 错误码断言与产品透传契约不符、回执读层错误码语义对齐、响应留痕对象无 json 键；修正后 run2/final 两轮全绿。未修改任何产品实现、未弱化断言——其中两例按产品真实契约修正断言并在表内注明。）

## 5. 未测（缺口与阻点）

无阻点（所有必测均有真实 HTTP 证据）。诚实边界如下：

1. **真实模型质量**：不在本轮范围（替身形态），模型输出正确性/质量未测。
2. **live 内核装配形态**：`--live + --connectors-url` 下的 Edge→Connectors 真实证据提供方链未在本包重跑（既有输入测试 `assistant-evidence-http.test.mjs` 已以真实 Connectors HTTP 覆盖，本包证据函数按 `prepareEvidence` 同参合成，作为复用边界如实声明）。
3. **多 Edge 进程 profile 激活协调**：产品源码明示"激活协调限单 Edge 进程部署边界"（assistant-model.mjs 头注），跨进程激活一致性未测，属**服务端不支持项（缺口）**，与源码声明一致。
4. **real transport 出站白名单/真实凭据头**：real 模式未配置即失败关闭（`PROVIDER_NOT_CONFIGURED`），出站白名单仅在 real 模式生效；本包不触真实端点，未测。

## 6. 不适用

- PG/Docker：被测面零数据库依赖（见 §2），未创建容器。
- 真实客户数据：全程合成材料（`MATERIAL_TEXT`）与合成凭据（金丝雀值），不涉及任何真实数据。
- 产品功能扩展、Front 目录：未读取未修改（任务书禁止项均遵守）。

## 7. 输入源码 SHA256 与前后差异

- 执行前登记：`source-sha256-before.txt`（4 个输入测试文件＋12 个相关产品源文件，含 server/assistant-*/glm.mjs 等）。
- 执行后复核：`source-sha256-after.txt`。
- **差异：零漂移**（diff 为空），无"待复验"项。

## 8. 交付物清单（本目录）

| 文件 | 说明 |
|---|---|
| `REPORT.md` | 本报告 |
| `model-api.qa.test.mjs` | 15 个必测用例（node:test，独立运行命令见 §1） |
| `harness.mjs` | 真实 Edge 装配夹具＋凭据金丝雀＋验收台账 |
| `standin.mjs` | 可记录请求的本地模型 HTTP 替身（六种响应模式） |
| `qa-ledger.json` | 逐用例验收数据（HTTP 状态/出站计数/回执身份/current） |
| `source-sha256-before.txt` / `-after.txt` | 输入源码指纹与漂移核对 |
| `logs/baseline-input-tests.log` | 基线 37/37（exit 0） |
| `logs/model-api-qa-run1.log` | 首轮（10/15，5 例测试侧问题定位记录） |
| `logs/model-api-qa-run2.log` / `logs/model-api-qa-final.log` | 全绿两轮（exit 0） |
