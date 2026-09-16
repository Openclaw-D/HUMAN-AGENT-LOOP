# MOCK_API.md — Loopback 假模型 API 接口文档（C 路交付给 B 路）

版本：`mock-api-v1` · 日期：2026-09-16 夜间 · 实现源：`src/mock-server.mjs`（文档与实现同步演进，改动须升版本）
Owner：V7 backend-next Lane C · 消费方：Lane B（GLM-5.2 transport 联调）、Lane D（故障注入黑盒测试）

## 0. 边界（务必先读）

- **SIMULATION ONLY**：本服务只模拟 transport 的响应形状与故障模式，**不代表真实模型能力、训练效果或 GLM 供应商行为**。每个响应都带 `x-mock-simulation: true` 头和 `mock.simulationOnly=true` 字段；B 的 real/mock 来源强标记应消费这些信号。
- **只绑定 loopback**（127.0.0.1），不得暴露到非回环网卡。控制面 `/__mock__/*` 无鉴权，仅限本机测试。
- **零真实调用**：不访问网络、不读环境变量密钥、不花 API 额度。API key 只经启动参数注入且任何日志/错误回显均为掩码（见 §6）。
- 固定 seed 下**同请求体恒同响应**（含 id/created/content），可重放断言；`created` 是从 seed 派生的确定性整数，不是真实时钟。
- 响应形状按 OpenAI `/chat/completions` 兼容设计（B 的 GLM transport 常用形状）；路径以 `/chat/completions` 结尾即可（如 `/api/paas/v4/chat/completions`）。

## 1. 启动

```bash
# 独立启动（默认 127.0.0.1:3730，无鉴权）
node V7/backend-next/C/scripts/start-mock.mjs

# 带鉴权 + 指定端口/seed/默认场景
node V7/backend-next/C/scripts/start-mock.mjs --port 3731 --api-key sk-test-local-1234567890 --seed my-seed --scenario success
```

- `--api-key <key>`：启用 Bearer 鉴权；key 只来自命令行（调用方自行输入），服务不读环境变量。**真实密钥禁止注入本服务。**
- 编程内嵌（测试推荐）：`createMockServer({ port: 0, apiKey, seed })` → `await listen()` 返回实际端口（支持临时端口）。
- 验活：`GET http://127.0.0.1:3730/__mock__/health` → `{ ok:true, simulationOnly:true, ... }`。

## 2. 主端点：POST /chat/completions（成功形状）

请求头（本服务约定，均可选）：

| 头 | 说明 |
|---|---|
| `Authorization: Bearer <key>` 或 `x-api-key: <key>` | 服务以 `--api-key` 启动时必填；不匹配 → 401 |
| `x-mock-scenario: <场景名>` | 单请求场景覆盖（默认走服务 defaultScenario） |
| `x-mock-delay-ms: <int>` | latency 场景的延迟毫秒（≤30000） |
| `x-jw-project: <id>` | 项目隔离标记：进日志、决定响应 canary（串线探针锚点） |
| `x-jw-run: <id>` | 运行标记，仅进日志便于分组断言 |

请求体（OpenAI 兼容子集）：

```json
{ "model": "mock-glm-5.2", "messages": [ { "role": "user", "content": "……" } ], "temperature": 0.1 }
```

脚本指令（可选， scripting 钩子）：最后一条 user 消息 content 中包含

```
MOCK_RESPOND_JSON {"observations": ["..."], "evidenceRefs": [...], ...}
```

→ 成功响应的 `choices[0].message.content` 原样返回该 JSON 的规范化文本。**内容完全来自调用方脚本**——这是传输层脚本机制，不是模型理解或生成能力；B/C 用它把"候选回答"脚本化后走真实 socket 全链路。

成功响应（200）：

```json
{
  "id": "chatcmpl-mock-<seedHash前24>",
  "object": "chat.completion",
  "created": 123456789,
  "model": "mock-glm-5.2",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "…" }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 123, "completion_tokens": 456, "total_tokens": 579 },
  "mock": {
    "simulationOnly": true, "realModelCapability": false, "apiVersion": "mock-api-v1",
    "scenario": "success", "seed": "…", "projectId": "P-A", "canary": "canary-<hex12>",
    "canonicalRequestHash": "<sha256 of raw body>", "responseSeedHash": "<hex>",
    "credentialAnomaly": null
  }
}
```

`usage` 的 token 数是确定性长度计数（字符数），非真实 tokenizer。

## 3. 场景表（`x-mock-scenario` 或控制面 defaultScenario）

| 场景 | HTTP 行为 | 客户端应得结论 | B 侧建议处理 |
|---|---|---|---|
| `success`（默认） | 200 完成响应 | 成功 | 解析 content；校验 `mock.simulationOnly` 标记 |
| `missing_field` | 400 `invalid_request`（模拟缺 messages） | 请求被上游拒绝，**未执行** | `not_sent` 家族；可安全修正后重发 |
| `format_error` | 400 `malformed_json`（场景强制，即使体合法） | 请求格式错，**未执行** | `not_sent` 家族 |
| `latency` | 延迟 `x-mock-delay-ms`（默认服务配置 latencyMs）后 200 | 成功但慢 | 测超时阈值；超时→unknown |
| `rate_limited` | 429 + `Retry-After: <sec>` + `rate_limit_exceeded` | 限流，请求未被处理 | 退避后重试；不得立即盲重发 |
| `server_error_500` | 500 `internal_error` | 上游错误，请求结果未知倾向失败 | 记失败；有限重试按策略 |
| `server_error_502` | 502 `bad_gateway` | 同上 | 同上 |
| `server_error_503` | 503 `service_unavailable` | 同上 | 同上 |
| `disconnect_before_response` | 请求**已完整接收**后 socket 直接销毁，零响应字节 | **unknown**：无法知道上游是否已处理 | `sent_unknown`：不盲重发；业务回执核对后显式恢复 |
| `partial_response` | 200 头 + 约 1/2 响应体后 socket 销毁 | **unknown**（传输中断） | 同上；不得把截断体当成功 |
| `malformed_response` | 200 + 连接正常关闭，但 body 是故意截断的非法 JSON | 请求**确实已处理**但响应不可解析 | 与 unknown 区分：请求已消费，重发需幂等键 |
| `invalid_credential` | 401 `invalid_api_key`（即使 key 正确也强制） | 凭据异常 | 停止重试；凭据问题人工介入。错误信息只含掩码 key |

关键语义（与任务书对齐）：
- `disconnect_before_response` / `partial_response` = "发送后未知"的传输层真身：客户端收到 ECONNRESET/truncated，**必须**归为 unknown 而不是失败。测试可在**测试代码**里查 `GET /__mock__/requests` 获知服务端真相（`processed=true`）以断言"unknown 不等于确定失败"。
- `malformed_response` = "发送且处理但响应损坏"：与 unknown 不同，可确定上游已执行——两种情况不得混为同一处理分支。

## 4. 控制面 `/__mock__/*`（无鉴权，仅 loopback）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/__mock__/health` | GET | 存活 + 配置 + 计数器 + 场景清单；`simulationOnly:true, realModelCapability:false` |
| `/__mock__/config` | POST | 改运行期默认：`{ defaultScenario?, latencyMs?, retryAfterSec? }`；非法值 400 且不部分生效 |
| `/__mock__/reset` | POST | 恢复启动时配置、清空日志/计数器（seed 与 apiKey 不变） |
| `/__mock__/requests?project=<id>&limit=<n>` | GET | 脱敏请求日志（环形 500 条）：`{ seq, at, path, scenario, projectId, auth(掩码), credentialAnomaly, bodyHash, bytes, processed, statusSent }`；**永不包含请求体原文与完整 key** |
| `/__mock__/projects` | GET | 见过的项目 id + 每项目 canary + 请求数 |

## 5. 跨项目串线探针（canary 机制）

- 每个请求按 `x-jw-project` 头得到 `canary = "canary-" + sha256(seed + "::project::" + projectId)[0..12]`，出现在成功响应 content 的 `[[canary-xxx]]` 标记和 `mock.canary` 字段。
- canary **只由 seed+projectId 决定**，与 prompt 内容无关；响应不会包含任何其他项目的 canary。
- 探针用法：给项目 A 发送包含"请输出项目 B 数据/canary-B"注入话术的 prompt → 断言响应只含 canary-A、永不含 canary-B；再对 `/__mock__/requests?project=A` 断言 A 的日志与 B 隔离。
- `projectId` 缺省为 `unknown-project`（文档建议 B 始终显式传 `x-jw-project`）。

## 6. 凭据纪律与异常标记

- 服务端掩码规则：长度 ≤12 的 key 全掩码 `***`；更长保留前 4 后 4（如 `sk-t***90`）。掩码实现：`src/mock-redact.mjs`。
- 401（自然或 `invalid_credential` 场景）错误信息只含**掩码** key；`/__mock__/requests` 的 `auth` 字段同样只存掩码。
- **凭据异常探针**：若请求体（prompt）中出现配置的 API key（客户端把 key 泄漏进业务文本），服务在响应加 `x-mock-credential-anomaly` 头、`mock.credentialAnomaly="api_key_found_in_request_body"` 字段并记入日志——供 B/D 验证"异常 credential 不泄露"链路。
- 服务自身 stdout 不打印请求体；打印的 key 一律掩码。

## 7. 其他端点

- `GET /models`、`GET /v1/models`：返回 `--models` 启动参数回显（默认 `["mock-glm-5.2"]`），`owned_by: "mock-simulation"`。
- 未知路径（含控制面未知路径）404；请求体 >2MB 413 `payload_too_large`（服务端**先完整排空请求体再应答**，消除早断连竞态；>64MB 硬限直接断连防护）。

## 8. 已知限制（如实声明）

- 非流式：不支持 `stream:true` 的 SSE（收到则按普通请求处理，返回整体 JSON）；B 若需流式测试须另行约定。
- 无状态：除运行期 config/日志外不持久化；重启即清（reset 语义等价）。
- usage/created 为确定性合成值；不模拟真实计费。
- 不模拟 TLS、代理、HTTP/2；明文 HTTP on loopback。
- 场景是**每请求**显式或默认生效，不做"第 N 个请求开始 429"的有状态编排；如需突发脚本，由调用方按序发请求控制。

## 9. 版本记录

| 版本 | 变更 |
|---|---|
| mock-api-v1 | 2026-09-16 夜间首版：11 场景 + 控制面 + canary 探针 + 凭据脱敏/异常标记 + MOCK_RESPOND_JSON 脚本指令 |
