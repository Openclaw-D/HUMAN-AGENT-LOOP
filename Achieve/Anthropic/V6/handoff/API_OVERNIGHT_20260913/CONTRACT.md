# API OVERNIGHT 20260913 · A路主集成最小接口约定（CONTRACT）

- 冻结人：A（V6-API-MAIN，唯一产品代码 writer）。冻结时间：2026-09-13 23:10（北京时间）。
- 本文件 A 独占；B/C/D 只读，提建议请写各自 RESULT 或 `V6/handoff/API_OVERNIGHT_20260913/proposals/`，不得直接修改。
- 原则：基于现有 `CandidateTransport`（`jianwei-v3/site/lib/v5-preview/model-adapter/`），不另造总线；候选 adapter 一律不改（buildPayload 只转发已知字段属既定事实，正文注入在 transport 侧解决）。

## 1. Transport 输入 / 输出 / 取消

B 交付模块目标形状（copy 进 site 后为 `lib/v5-preview/model-adapter/providers/http-fetch.mjs`，最终路径以 A 集成记录为准）：

```js
createHttpJsonTransport({
  config: { baseUrl, model, getApiKey, timeoutMs }, // getApiKey: () => string；模块内不读环境变量
  fetchImpl,                    // 可选注入；缺省用 globalThis.fetch（Node 22 运行时 fetch）
  enrich,                       // 可选：(call) => unknown | null，A 提供（见 §2）
})
// 返回 CandidateTransport：async (call) => transportResult
//   call = { payload, role, signal? }（payload 为候选 buildPayload 输出，已深冻结，不得原地修改）
// transportResult = { ok: true, output, usage? } | { ok: true, simulated: true, output }
//                 | { ok: false, error: { code, message }, usage? }
//                 | { error: { code, message }, notSent?: true }（throw 形态；notSent=true 表示未发生外部调用）
```

- 输出 JSON 映射复用现有 `providers/http-json.mjs` 的 `buildChatCompletionsRequest` / `parseChatCompletionsResponse`，不改其纯映射语义。
- 取消：透传 `call.signal`（AbortSignal）到 fetch；超时由候选 `timeoutMs`（bridge 缺省 20000）竞速，transport 自身不另设双超时。
- 纪律：请求只含演示所需字段；错误与日志脱敏（不输出 Authorization、不回显原始响应体>200 字符）。

## 2. 证据正文及版本（enrich 约定）

- 背景：候选 `buildPayload` 只转发已知字段，仅 hash 的 `evidenceRefs` 到不了模型；真实请求必须携带正文。
- A 在 bridge/服务侧提供 `enrich(call)`：按 `call.payload.sessionId` + `evidenceRefs[].hash` 从权威 store 解析，返回：

```json
{
  "evidence": [{ "id": "evidenceId", "version": 1, "title": "…", "text": "合成正文/图形文字内容" }],
  "humanReplies": [{ "author": "…", "text": "客户陈述/人工纠正原文", "at": "ISO" }],
  "annotationQuestion": "访谈问题原文"
}
```

- 正文只用当前合成项目内已提供内容（标注问题、证据图形文字、该标注下人工回复）；不发送其他项目/其他会话内容。找不到对应内容返回 null，不臆造。
- B 的 transport 把 `enrich(call)` 结果并入发往模型的载荷副本（如 `{ ...payload, context: enrichResult }`），不改冻结原件、不并入 payloadHash 语义。

## 3. 真实回复类型（新增 kind，兼容旧记录）

- `ReplyKind` 扩展：`'model_simulation' | 'model_real' | 'business' | 'domain'`。
- 真实模型回复 `kind='model_real'`，author 携带角色与 authority 声明（如 `模型辅助分析（真实模型 · credit，authority=none，须人工复核）`），正文不冒充人工/模拟。
- 旧记录全部为 `model_simulation`，读取端对未知/旧 kind 兼容展示，不迁移、不重置。
- 结果 metadata（服务端响应与存储）：`source: 'real' | 'simulation'`、`basedOn: { evidenceVersion, remoteVersion, generation }`、`usage`（真实调用时）。模拟与真实在 UI 用文字明确区分；`model_simulation` 含义不变。

## 4. 模型配置名（服务端；无 NEXT_PUBLIC 秘密）

- `JIANWEI_MODEL_API_KEY`：产品密钥（仅服务端读取；存在与否只报布尔，不打印值）。
- `JIANWEI_MODEL_BASE_URL`：OpenAI Chat Completions 兼容端点 base（如 `https://host/v1`）。
- `JIANWEI_MODEL_NAME`：模型名。
- `JIANWEI_MODEL_MODE`：`real` | `simulation`（缺省 `simulation`；非 `real` 一律不发起真实调用）。
- 任一缺失 → 真实入口返回 `MODEL_NOT_CONFIGURED`，按钮/结果明确"未配置"；列出缺项，不伪装接通。

## 5. 拟用真实分析路由

- 新增窄路由：`POST /api/v5-preview/remote-session/annotations/analyze`
  - 请求：`{ requestId, expectedVersion, sessionId, annotationId }`（requestId 幂等 + 乐观并发，与既有写路径同构）。
  - 语义：信审角色（`domainRoles: ['credit']`）单角色真实辅助分析；不走 `simulate` 命名路径；每标注可多次（每次新 requestId、新内容触发新版本），同 requestId 重放返回原响应。
  - 响应：`{ ok, source: 'real'|'simulation', annotation, remoteVersion, basedOn, usage? }` 或错误（§6）。
- 模拟入口 `annotations/simulate` 保留原含义不动。

## 6. 错误形状（与既有 remote 错误同构）

- HTTP 状态沿用 `REMOTE_ERROR_STATUSES`；body：`{ ok: false, error, message, serverVersion? }`。
- 新增错误码：`MODEL_NOT_CONFIGURED`（503）、`MODEL_CALL_FAILED`（502，真实调用失败/超时/非 JSON，含脱敏原因）、`MODEL_RESULT_STALE`（409，返回时状态门改判：暂停/证据版本过期/代次变化，旧结果不落库）。
- 真实失败绝不静默回退模拟冒充成功；UI 提示可改用既有模拟入口。

## 7. 状态门与过期回包（服务端执行）

- 发起前 + 返回后双重判定（复用 bridge 状态门语义）：证据版本过期 > 会话暂停；generation 变化同样拒绝。
- 过期/拒绝结果不写入标注 replies；响应如实返回失败原因。
- 请求进行中重复提交：同 requestId 幂等返回原响应；不同 requestId 的并发同标注请求按各自状态门独立判定，后返回者过不了新版本门。

## 8. 交付与目录

- B → `V6/handoff/API_OVERNIGHT_20260913/transport/**`（模块 + 少量测试 + 接口差异说明；不装 SDK、不启动实例、不调付费模型）。
- C → `cases/**`（主合成案例 + 两变体 + 最简访谈前问题提纲；全部标合成）。
- D → `qa/**`（可复现回归；3467 写测试窗口与合成标识先在 qa 内约定）。
- A → CONTRACT / STATUS / RESULT（本目录根部）+ site 产品写面（唯一 writer）。
- 集成采用文件 hash 记录于 STATUS；B 模块经 A 审查复制进 site，其他目录互不覆写。
