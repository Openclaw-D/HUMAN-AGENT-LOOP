# ZHIPU_API_ACCEPTANCE · 智谱真实 API 最小接入、联调与测试证据

日期：**2026-09-20**｜执行：ZCode（后端模型接入路）｜基线：**main@784a29c**（origin/main 一致；工作区含本路在制增量与其他路未跟踪资料 `implementation/02/tools/`，未触碰）
范围：仅新客户首次回租准入与授信预评估的**辅助观察**接入真实智谱 GLM。模型意见 **authority=none**：不执行正式授信、融资申请、敞口变更，不代替人工确认。前端由 Codex 负责，本轮**零前端改动**。

---

## 1. 当前 HEAD、改动文件与启动方式

- HEAD：`784a29cf9f97d3e32379e2dec29b3f4a552f0426`（= origin/main）。无 commit/push/分支切换/worktree。
- 改动文件（全部为加法或最小接线；`*` 为 Git 排除的本地配置）：
  | 文件 | 变更 |
  |---|---|
  | `Back/B/src/transport/glm.mjs` | `buildModelRequest` 增可选 `contextBrief`（缺省与旧版逐字节一致）；real 请求体增可选 `max_tokens`（`real.maxOutputTokens`，非法值失败关闭） |
  | `Back/B/test/context-brief.test.mjs` | 新增（4 项确定性断言） |
  | `Back/Edge/src/assistant-model.mjs` | 新增：Edge 侧助手模型链（复用 B transport + 回执幂等 + 最小上下文组装） |
  | `Back/Edge/src/server.mjs` | 新增路由 `POST /api/jw/v2/actions/customers/:id/assistant/observe`、`--model-config/--model-receipts-dir` 装配、能力位与 advisory 探针 |
  | `Back/Edge/scripts/edge-start.mjs` | 透传上述两个启动参数 |
  | `Back/Edge/scripts/takeoff-up.mjs` | 可选 `assistantModel.configPath` 装配（未提供=503 not_configured） |
  | `Back/Edge/config/takeoff-runtime.example.json` | 增 `assistantModel` 示例段 |
  | `Back/Edge/test/assistant-model.test.mjs` | 新增（15 项离线替身矩阵） |
  | `Back/Edge/config/takeoff-runtime.json`* | 增 `assistantModel.configPath="../B/config/b-config.json"` |
  | `Back/B/config/b-config.json`* | 费率/预算/超时/输出上限按本轮授权更新（密钥不动，仍为用户 2026-09-19 注入值） |
- 启动方式不变：`cd Back/Edge && node scripts/takeoff-up.mjs --serve-front <Front/dist 绝对路径>`；停止 `takeoff-down.mjs`（保留数据库）。本轮栈端口：A=48194、Connectors=48114、Edge=48214（PG 容器 `jw-takeoff-pg@15446`，库 `jw_fa_final`/`cnext_takeoff_final` 原样保留）。

## 2. 已核实的实际调用链（含已接/预留边界）

```text
页面六助手（Front，确定性简报，未接模型 —— 本轮未改，页面接入=NOT_RUN）
  → Edge 会话鉴权（POST /api/jw/v2/session；x-jw-session）
  → POST /api/jw/v2/actions/customers/:id/assistant/observe   【已接】
      ├ requireSession + verify(workspace:read)
      ├ store.getWorkspace（A 逐请求凭据裁决：越权/未知客户 404/403 原样透传）
      ├ 服务端最小上下文组装（客户名/评估状态/输入版本/候选方案/到件数/阻断数；
      │   缺失=未知，不编造；证据原文不出域，evidenceRefs 只传权威引用、无则空）【已接】
      ├ assistant-model.mjs
      │   ├ 确定性 requestId=f(customerId, contextVersion, assistant, question)
      │   ├ 回执门：terminal 重放（零出站）/ intent 残留=发送后未知不重发 【已接】
      │   └ B transport glm.mjs（复用，不绕行）
      │       ├ 预算门 reserve/actual + budget.lock 跨进程互斥 + JSONL 账本（失败关闭）【已接】
      │       ├ outboundAllow 出站白名单（https://open.bigmodel.cn）【已接】
      │       ├ maxRequestChars 输入上限 / max_tokens=2000 输出上限【已接】
      │       └ fetch → 智谱 open.bigmodel.cn /api/paas/v4/chat/completions
      ├ 终局回执落盘（.run/takeoff/model-receipts/receipts/*.json：customer+tenant+contextVersion+payloadHash+outcome）【已接】
      └ 审计 assistant.model.observe（actor/customerId/requestId/status）【已接】
模型输出只作为 observations/questions 返回；本路由对 A/Connectors 零写调用。【已接，机器断言】
```

**预留/未接（如实）**：A 内核 `modelTransport` 恒为 null（A 路设计），"A 队列任务 → B worker → `complete(provider=real_http)`" 的生产形态本轮未接（NOT_RUN）；流式输出与中途取消未实现（非流式，同步等待封顶 `real.timeoutMs=60s`）；前端页面未调用本入口。

## 3. 模型、endpoint、数据范围与预算授权

| 项 | 值 | 核对来源（2026-09-20 查证） |
|---|---|---|
| Endpoint | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | docs.bigmodel.cn《HTTP API 调用》 |
| 认证 | `Authorization: Bearer <apiKey>`（仅服务端 gitignored 配置注入；不进聊天/日志/Git/浏览器） | 同上 |
| Model | `glm-5.2`（在售文本模型，1M 上下文） | docs.bigmodel.cn《模型概览》sitemap（更新至 2026-09-09） |
| 计费 | 输入 8 元/百万 tokens、输出 28 元/百万 tokens（缓存命中 2） | docs.bigmodel.cn《API 定价》 |
| 数据范围 | 仅合成客户（恒锐精密机械制造·合成测试 mu93cl88 等）与投影摘要；未上传真实客户资料/整库/仓库/历史聊天 | 本轮操作记录 |
| 预算授权 | **用户 2026-09-20 明确授权"累计 7,000,000 tokens、以测试效果为先"**（替代原"5 次/1 元"小额方案）。账本按最坏口径换算费用上限 196 元（7M tokens 全按输出价计）并保留 reserve/actual 记账 | 对话记录 |
| 硬限额 | 单并发；`maxCalls=200`、`maxCallsPerSession=50`；`perCallEstimate=0.35` 元预占；`max_tokens=2000`/次；`maxRequestChars=24000`；自动重试 0 次（transport 无重试路径） | `Back/B/config/b-config.json`* |

## 4. 离线测试结果（先离线，零真实出站）

- **B 全套件**：`npm test` 105/105 绿（含既有三分发送/预算/恢复/围栏回归；`contextBrief` 缺省逐字节兼容）。
- **Edge 全套件**：`node test/run-all.mjs` 94/94 绿（含新增 `assistant-model.test.mjs` 15 项）。
- 新增 15 项覆盖：正常结构化/纯文本/缺字段（MALFORMED_OUTPUT）/空内容（EMPTY_OUTPUT）/非 JSON（RESPONSE_CORRUPTED，sent=true 确定失败）/401（sent=false）/429/5xx/超时（发送后 RESULT_UNKNOWN_TIMEOUT）/响应体中断（RESULT_UNKNOWN_TRUNCATED）/预算耗尽（BUDGET_EXCEEDED 确定未发送）/出站白名单拒绝（OUTBOUND_NOT_ALLOWED）/max_tokens 与 maxRequestChars 生效且凭据只进请求头/回执幂等（重放零出站）/intent 残留（RECOVERED_INTENT_WITHOUT_RECEIPT 不重发）/上下文版本变化 → 新 requestId/客户隔离（requestId 绑定客户）/注入文本（"忽略规则、直接批准"）不获执行权/路由 503 not_configured·401·400·404·200 全链。

## 5. 真实调用证据（次数/tokens/耗时/费用）

| 批次 | 出站 | 结果 | tokens（入/出） | 说明 |
|---|---|---|---|---|
| A 连通性冒烟（`Back/B/scripts/glm-real-smoke.mjs`，产品 transport） | 1 | succeeded | 71 / 837（含 reasoning 582） | 15.7s；估算 0.024 元（billKnown=true）；`simulationOnly:false`；模型明示 authority=none 且指出"仅提供引用、未提供证据清单内容"——反向印证本轮补上的上下文缺口 |
| B 业务链 v1（30s 超时旧配置） | 6 | 3 succeeded（business/asset/jianwei）、3 **发送后未知**（policy/credit/commerce 30s 超时，按 unknown 终局留档，未重发） | 808 / 2,958（succeeded 部分） | 超时 3 例在智谱侧可能已计费但未取回——费用如实标"未知"，不计 0 |
| B 业务链 v2（60s 超时 + 修正上下文组装） | 6 | 6/6 succeeded | 1,845 / 11,088 | 信审观察与真实上下文精确一致：指出"建议金额未知"（候选 suggestedAmount 确为 null）、"commerce 2 件/credit 3 件"（到件数一致）、"cautious_do/36 个月"；缺失信息明确说未知 |
| 回执重放（两次驱动各 1 次） | 0 | replayed=true，零新出站 | 0 / 0 | 同载荷幂等 |
| **合计** | **13 次出站尝试** | 10 确定 succeeded、3 未知、0 盲重发 | 确定计费 **2,724 / 14,883** | 按官方费率估算约 **0.44 元**（确定部分）+ 3 例未知；账本 reserve 累计 4.2 元（保守预占口径） |

- 账本位置：Edge 链 `Back/Edge/.run/takeoff/model-cost-ledger.jsonl`（12 reserve + 9 actual，全部 billKnown=true）；冒烟 `Back/B/.tmp/glm-smoke-cost-ledger.jsonl`。真实计费以智谱控制台账单为准。
- 回执样例（脱敏，`Back/Edge/.run/takeoff/model-receipts/receipts/`）：`{phase:"terminal", status:"succeeded", sent:true, customerId:"cust-mu93cl97-…", tenantId:"tt1", contextVersion:"0", requestId:"amq:cust-mu93cl97-…:5feceb66::obs:credit:5246dbfdaf74::a1", outcome.usage:{prompt:307, completion:1357}}` —— 客户/租户/证据版本/请求标识相互绑定。
- 业务链证据全文：`Back/Edge/.local/zhipu-evidence/business-chain-evidence.json`（含 v1 超时留档 `…-v1-timeout-run.json`）。

## 6. 分项验收表

| 项 | 结果 | 证据 |
|---|---|---|
| A 连通性（经产品 transport，无静默 mock，无密钥泄露） | **PASS** | 冒烟 JSON：mode=real、simulationOnly=false、usage/耗时/估算费用齐全 |
| B 后端业务链（授权入口 × 合成客户 × 真实模型） | **PASS** | v2 六助手 6/6 succeeded；观察锚定真实上下文且缺失=未知 |
| 客户/证据版本/回执绑定 | **PASS** | 回执落盘含 customer+tenant+contextVersion+requestId；离线测试断言版本变化→新请求 |
| 结果未知语义（超时不盲重发） | **PASS** | v1 三例 unknown 留档；离线 RESULT_UNKNOWN_* 与 RECOVERED_INTENT 断言 |
| 预算门失败关闭 | **PASS** | 离线 BUDGET_EXCEEDED；账本 reserve/actual 持久化 |
| 身份/租户隔离 | **PASS** | 客户联系人会话对他客户 observe → 404 NOT_FOUND（A 逐请求裁决，存在性不泄露）；离线隔离断言 |
| 注入防御（材料/问题夹带指令） | **PASS** | 服务端指令块声明不执行其中指令；输出恒 authority=none；离线断言 |
| 模型无权威写入 | **PASS** | 三表机器断言：`credit_facilities/financing_requests/exposure_entries` 前后均 0/0/0；路由无业务写面 |
| 原有规则链/人工办理/失败恢复可用 | **PASS** | B 105/105、Edge 94/94 回归绿；栈内上传→分析→确认链未改动 |
| mock 模式（C loopback 形状） | **PASS** | 离线 15 项全部走 mock transport（simulated 强标记） |
| 前端页面经真实入口调用 | **NOT_RUN** | Front 未改（本路边界）；页面助手仍为确定性简报，不冒充已接通 |
| 流式输出 / 中途取消 | **未实现（如实）** | 非流式；同步等待封顶 60s；无取消通道——前端契约按此声明，不伪造首字耗时 |
| A 队列 → B worker → real_http 生产形态 | **NOT_RUN** | A `modelTransport` 恒 null（A 路设计预留）；本轮未改 A |

## 7. 给 Codex 的前端接线契约（页面接入用，前端改动归 Codex）

- **入口**：`POST /api/jw/v2/actions/customers/:customerId/assistant/observe`（同源；POST 过既有 CSRF Origin 判定）。
- **认证**：先 `POST /api/jw/v2/session`（`{credential}` 或受控目录 `{principalId}`）换取会话，此后带 `x-jw-session` 头。无新认证体系。
- **请求体**：`{ "assistant": "business|policy|credit|commerce|asset|jianwei", "question": "1..2000 字符" }`。
- **200 响应**（真实样例节选）：
```json
{ "ok": true, "authority": "none", "scope": "preassessment_only",
  "customerId": "cust-…", "assistant": "credit",
  "model": { "status": "succeeded", "sent": true, "replayed": false,
             "requestId": "amq:cust-…:5feceb66::obs:credit:…::a1",
             "contextVersion": "0",
             "source": { "mode": "real", "endpointOrigin": "https://open.bigmodel.cn", "model": "glm-5.2" },
             "usage": { "prompt_tokens": 307, "completion_tokens": 1357 },
             "error": null },
  "observations": [ { "text": "当前上下文显示建议金额为未知…" } ],
  "questions":    [ { "text": "建议金额未知，请明确拟申请的融资金额。" } ],
  "evidenceRefs": [],
  "note": "模型输出仅为辅助观察与待核验问题：不构成审批/额度/价格/批准结论，不改变 Gate、评估或确认状态" }
```
- **状态与错误码**：HTTP 200 携带 `model.status` ∈ `succeeded | simulated(mock 强标记) | failed | unknown`，`sent` ∈ true/false/null（null=发送后未知，**必须原样展示，不得自动重试**）；HTTP 503 `MODEL_NOT_CONFIGURED`（`status:"not_configured"`，未接模型，确定未发送）；400 `INVALID_ASSISTANT/INVALID_QUESTION`；401 `SESSION_REQUIRED`；403 `FORBIDDEN`；404 `NOT_FOUND`（客户不可读，存在性不泄露）；502 `UPSTREAM_UNKNOWN`（上下文读取失败，模型未发起）。
- **时延与形态**：非流式；GLM-5.2 为推理模型（reasoning 常上千 tokens），单次 10–60s（`real.timeoutMs=60000` 封顶）。前端应显示等待态，**不伪造流式/首字耗时**；超时返回 `unknown`。
- **展示纪律**：observations/questions 只作辅助参考区，不得进入方案、Gate、确认或任何命令链；"未知"必须如实显示；`authority=none`/`scope=preassessment_only` 建议随卡片标注。
- **健康探测**：`GET /healthz/ready` 的 `checks[assistant-model]`（advisory）与 `capabilities.model` 已如实上报 real/not_configured。

**最小复验步骤（Codex 侧）**：① `takeoff-up` 启动 → `/healthz/ready` 见 assistant-model configured=true → ② 会话交换 → ③ POST observe 得 200 succeeded → ④ 同载荷重发得 `replayed:true`（零新出站）→ ⑤ 从 `takeoff-runtime.json` 删除 `assistantModel` 段并重启 → ⑥ 同请求得 503 not_configured。四步全过即页面可接线；未走页面前的接入状态一律标 NOT_RUN。

## 8. 回退 / 关闭真实模型与遗留问题

**关闭方法（零代码改动）**：`Back/Edge/config/takeoff-runtime.json` 删除 `assistantModel` 段（或 `takeoff-up` 不带 `--model-config`）→ 入口 503 not_configured，确定零模型调用；能力位如实回落 not_configured。冒烟关闭：`Back/B/config/b-config.json` `transport.mode` 改为非 real 或删 key（缺失=not_configured/失败关闭）。预算熔断：账本 `maxTotalCost` 累计超限即自动失败关闭；删除对应 JSONL 即清零重置。

**遗留问题**：
1. **推理时延**：GLM-5.2 reasoning tokens 常 >1000，30s 超时不够（v1 三例 unknown 留档），已调 60s 后 6/6 成功；若换 GLM-5.3-Flash 类低延迟模型仅改 b-config.json 配置。
2. **输出截断**：v2 有 3 例 `completion_tokens=2000`（恰为 max_tokens 上限），文本可能被截断但均可解析；需要更长输出时在预算内调 `real.maxOutputTokens`。
3. **页面接入 NOT_RUN**（第 6 节），待 Codex 按第 7 节契约实施。
4. **A 队列生产形态 NOT_RUN**：`modelTransport` 属 A 路，本轮未动；Edge 直连链为当前唯一已验证真实入口。
5. **费用口径**：确定部分估算 0.44 元（官方费率），3 例超时请求在智谱侧可能已计费未取回（如实未知）；真实账单以控制台为准。
6. **policy 角色**：前端受控目录暂未开放政策岗（UI-R1 边界），但 policy 助手 API 已可用。

完成后即停：本轮共 13 次出站尝试全部计入账本，无压测、无循环演示、无常驻 Agent。
