# RelayOS P3

RelayOS 当前交付的是 **P3 确定性 continuity control plane + advisory-only provider runtime**。它仍以 `WorkCase` / `BusinessEvent` / Accepted Handoff Ledger 为权威内核；模型只做材料抽取、上下文总结、冲突识别、配置建议和行动建议，任何结果都必须是 `authority=none`，不会自动形成 domain command 或 BusinessEvent。

## 当前真实能力

P2 内核保持不变：Node.js ESM、`node:http`、内置 `node:sqlite`、SQLite WAL、per-WorkCase optimistic concurrency、command idempotency、typed append-only BusinessEvent、可丢弃 projection 与 event-only replay、Accepted Handoff、具名 Human Gate、ActionIntent/ExecutionReceipt、精确 Origin allowlist 和统一错误 envelope。

P3 新增：

- 冻结接口 `AdvisoryProvider.suggest(request, { signal })`，只允许 `material.extract`、`context.summarize`、`conflict.identify`、`configuration.suggest`、`action.suggest`。
- `MockProvider` 使用固定 fixtures，可确定注入 timeout、network、429、5xx、4xx、invalid JSON、schema mismatch、ambiguity 和 unsafe suggestion；失败不会伪装成成功。
- `ZaiGeneralProvider` 只用 Node 内置 `fetch` 调用 Z.AI General Chat Completions；无第三方 SDK、无自由文本 fallback。
- provider 返回后，本地重新验证 output schema、Evidence 引用、goal/context version、ContextVersion permission、data classification、`authority=none` 和越权建议字段/语义。
- network、429、可恢复 5xx 最多重试 1 次并加 jitter；timeout、4xx、invalid/schema/ambiguity/policy/authority failure 不重试。clock、sleep、random 与 timeout signal 均可注入，离线测试不依赖真实等待。
- 同 provider 在 60 秒内连续 5 次 transient failure 后熔断 30 秒；half-open 同时只允许 1 个探测。
- 独立 `provider_invocations` SQLite telemetry 只保存 provider/model/version、latency、token/cost（有则保存）、input/output hash 与错误类别；不保存 secret、Authorization、完整 prompt/response 或 recommendation body。telemetry 故障不改变 domain，也不改变有效 advisory 结果。
- `POST /api/advisories` 使用统一错误 envelope。provider 故障返回 `ADVISORY_UNAVAILABLE` / HTTP 503，不会自动 fallback 成 Mock 成功。
- `/health/ready` 独立展示 advisory readiness/degraded；provider 熔断不会把权威 event store 报成损坏，也不阻断确定性核心 readiness。

## 运行

要求 Node.js `>=22.5.0`，当前验收运行时为 Node 22。无需 `npm install`。

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd start
```

默认监听 `127.0.0.1:4178`，默认 domain 数据库为 `./data/relayos.db`。`node:sqlite` 在 Node 22 仍会显示 `ExperimentalWarning`，这是已知运行时边界，没有被隐藏。

P2 运行变量继续有效：`HOST`、`PORT`、`RELAYOS_DB_PATH`、`RELAYOS_SCENARIO_DIR`、`CORS_ALLOWED_ORIGINS`。

P3 provider 变量：

- `ADVISORY_PROVIDER`：必须显式为 `mock` 或 `zai-general`；默认 `mock`。
- `RELAYOS_ZAI_GENERAL_API_KEY`：RelayOS 产品运行时专用 secret；`zai-general` 模式必填。
- `RELAYOS_ZAI_GENERAL_BASE_URL`：默认且只接受 `https://api.z.ai/api/paas/v4/`。
- `RELAYOS_ZAI_GENERAL_MODEL`：P3 只接受官方 identifier `glm-5.3`。
- `RELAYOS_ADVISORY_FAST_DEADLINE_MS`：extract/summarize 默认 `8000`，只接受 `3000–30000`。
- `RELAYOS_ADVISORY_STANDARD_DEADLINE_MS`：conflict/config/action 默认 `15000`，只接受 `3000–30000`。
- `RELAYOS_PROVIDER_TELEMETRY_PATH`：独立 telemetry SQLite 路径；未设置时使用进程内独立 SQLite。
- `RUN_LIVE_ZAI=1`：只用于显式 live test/smoke Gate。

RelayOS 不读取、alias 或复用开发期 `ZAI_API_KEY`，也不使用 Coding Plan endpoint、adapter、凭据文件或调用日志。项目不创建 `.env` 或 secret 文件。选择 `zai-general` 但缺少 dedicated runtime secret 时启动 fail closed；运行中 provider 失败也不会 fallback-to-Mock。

## Advisory API

`POST /api/advisories` 请求必须完整包含：

```json
{
  "providerRequestId": "provider-case-001",
  "operation": "conflict.identify",
  "workCaseId": "case-001",
  "goalVersion": 1,
  "contextVersion": 1,
  "inputRefs": ["evidence-contract-v3", "evidence-po-221"],
  "outputSchemaVersion": 1,
  "promptVersion": "prompt-v1",
  "evaluationVersion": "eval-v1",
  "traceId": "trace-provider-001",
  "deadlineMs": 15000,
  "dataClassification": "internal"
}
```

对应 `ContextVersion.allowedDecisionUses` 必须包含请求 operation；`inputRefs` 必须是该 ContextVersion 中已有的 Evidence，且 classification 不得超过请求范围。运行时会按 operation 的已配置 deadline policy 执行，不信任客户端扩大 timeout。

成功结果严格为：

```json
{
  "authority": "none",
  "status": "advisory",
  "providerId": "mock",
  "model": "deterministic-fixture-v1",
  "outputSchemaVersion": 1,
  "recommendations": [
    {
      "kind": "conflict",
      "summary": "两个证据引用之间存在版本差异，需要人工复核。",
      "evidenceIds": ["evidence-contract-v3", "evidence-po-221"],
      "confidence": 0.92,
      "requiresHumanReview": true
    }
  ],
  "traceId": "trace-provider-001"
}
```

它不是 `ActionIntent`、Human Gate 决定、owner 变化、AuthorityGrant 或 command receipt。任何采用必须重新进入 P2 的确定性 command validation。

## 验证

P3/P2 交付命令：

```powershell
npm.cmd test
npm.cmd run test:provider
npm.cmd test -- test/provider-contract.test.js test/provider-failure.test.js test/advisory-zero-write.test.js
npm.cmd run smoke:provider
npm.cmd run test:replay
npm.cmd run test:contract
npm.cmd run build
npm.cmd run smoke
```

当前离线证据（2026-08-26，Node `v22.23.1`）：完整 `npm.cmd test` 为 60 passed、0 failed、1 skipped；skipped 项是显式 opt-in 的 live Z.AI test。provider 聚焦测试、Mock HTTP smoke、local fake General server 的 request/response、timeout、429 retry 和 usage 解析均已通过。每种 provider failure 及成功调用前后，WorkCase streamVersion、BusinessEvent count、projection hash、成功 command receipt count完全一致；只有 telemetry count 可变化。

运行 live Gate 的前提是 dedicated runtime secret 已由用户注入当前进程：

```powershell
$env:ADVISORY_PROVIDER = 'zai-general'
$env:RUN_LIVE_ZAI = '1'
npm.cmd run smoke:provider
```

本轮检查未发现 `RELAYOS_ZAI_GENERAL_API_KEY`，因此 **live Z.AI General API 未验证**。没有复用任何开发期 secret，也没有把 local fake server 写成 live 证据。

## 外部接口依据

- [Z.AI HTTP API Calls](https://docs.z.ai/guides/develop/http/introduction)：General API base endpoint、Bearer header 与 `fetch` 请求示例。
- [Z.AI Chat Completion API Reference](https://docs.z.ai/api-reference/llm/chat-completion)：`glm-5.3` identifier、`/chat/completions`、`response_format`、finish reason 与 `usage` 字段。
- [Z.AI GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3)：GLM-5.3 reasoning 必须 enabled，并支持 `low/high/max`；RelayOS 使用 `low`。
- [Z.AI Structured Output](https://docs.z.ai/guides/capabilities/struct-output)：`response_format={"type":"json_object"}` 与调用方本地 schema validation。
- [Z.AI Errors](https://docs.z.ai/api-reference/api-code)：HTTP/业务错误边界，包括 400、401、429 与 500；RelayOS 仍按冻结 P3 retry policy fail closed。

## 明确边界

P3 没有实现 UI/public（P4）、模型自动 apply、真实企业 connector、SSO/OAuth、生产身份、多租户、HA、公网部署或生产安全认证。单节点 SQLite 与 `demo_unverified` 仍是明确边界；P0 market 和旧 P0 保持只读。
