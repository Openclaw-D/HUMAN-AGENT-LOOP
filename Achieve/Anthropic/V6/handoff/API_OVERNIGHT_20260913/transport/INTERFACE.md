# B路 transport 接口说明（供 A 路直接接入）

- 交付人：B（V6-API-TRANSPORT）。时间：2026-09-13 23:30（北京时间）。
- 对齐契约：`V6/handoff/API_OVERNIGHT_20260913/CONTRACT.md`（A 路 2026-09-13 23:10 冻结）§1/§2/§4。
- 本目录产品源码零改动；产品源只读 import（见下）。

## 1. 文件与集成方式

| 文件 | 说明 |
| --- | --- |
| `server-http-transport.mjs` | 模块本体（零第三方依赖，Node 22） |
| `test/server-http-transport.test.mjs` | 28 条本地模拟测试（node:test，纯内存桩，无真实网络/无付费调用） |
| `test/run-all.mjs` | 运行器：`node test/run-all.mjs` |
| `test/evidence-20260913-2330.tap` | 本轮测试原始 TAP 输出（28/28 通过） |

**A 集成步骤（CONTRACT §8：经 A 审查后复制，hash 记入 STATUS）：**
1. 把 `server-http-transport.mjs` 复制为 `site/lib/v5-preview/model-adapter/providers/http-fetch.mjs`；
2. 把文件顶部唯一一条产品源 import 从 `'../../../../jianwei-v3/site/.../providers/http-json.mjs'` 改为 `'./http-json.mjs'`（仅此一处；其余零改动）；
3. 在 bridge/路由侧按下方 §2 构造并注入 `transport`（`mode!=='real'` 时不注入，保持模拟通道）。

交付文件 SHA256（复制后请以 A 实际采用为准）：
- `server-http-transport.mjs` = `f577bc68007ed8ac6f985d2fbadfb8c9774c17e8399bdc830d1cb2b2561f68c7`
- `test/server-http-transport.test.mjs` = `4e5065edac3aa2beca76676721185579811cf3a3c3e73de6c330b9a824fd428a`
- `test/run-all.mjs` = `d5e2cdf7a5c9fbc809c68072cab4e7c63adee3dba69ee1402be35975843282cb`

## 2. 工厂与 transport 形状（CONTRACT §1）

```js
import { createHttpJsonTransport, resolveServerModelConfig, describeServerModelConfig } from '.../http-fetch.mjs';

const transport = createHttpJsonTransport({
  config: { baseUrl, model, getApiKey, /* timeoutMs 接线给适配器,transport 自身不执行 */ },
  // getApiKey: () => string（契约形状）；也兼容 { apiKey: '...' } 字符串通路
  fetchImpl,   // 可选；缺省 globalThis.fetch（Node 22 运行时 fetch）
  enrich,      // 可选；见 §3
});
// 返回 CandidateTransport：async (call) => transportResult
//   call = { payload, role, signal? }
```

`transportResult` 三种返回 + 一种抛出：

| 形态 | 场景 | 适配器判定（现状核过） |
| --- | --- | --- |
| `{ ok:true, output, usage? }`（附 `modeName:'http_json'`） | 2xx + 合法响应 | `succeeded`（真实通道，与模拟可区分） |
| `{ ok:false, sent:true, error:{ code, message, httpStatus? }, usage? }` | HTTP 非2xx / 响应体或 content 非JSON / provider 错误体 | `failed`/`TRANSPORT_ERROR`；错误体带 usage 时照常结算 |
| `{ ok:'indeterminate' }` | 送出后超时/外部中止/连接后中断 | `unknown`（不谎称未计费，禁止自动重试） |
| **throw** `{ notSent:true, code, message }` | 未配置 / 送出前取消 / 连接未建立（ECONNREFUSED 等）/ enrich 失败 | `cancelled`/`CANCELLED_BEFORE_SEND`，预留释放 |

错误码（transport 局部，进适配器 `error.details.code`）：
`TRANSPORT_NOT_CONFIGURED`（中文列出缺项）、`CANCELLED_BEFORE_SEND`、`ENRICH_FAILED`、`PAYLOAD_INVALID`、`SERVER_HTTP_CONNECT_FAILED`、`SERVER_HTTP_NOT_JSON`、`HTTP_<status>`、以及产品既有映射的 `PROVIDER_*` 系。
**A 路由层映射建议**：以上失败/未知 → CONTRACT §6 的 `MODEL_CALL_FAILED`（502，附脱敏 message）；transport 抛 `TRANSPORT_NOT_CONFIGURED` ↔ A 的 `MODEL_NOT_CONFIGURED`（503，`details` 可用 `resolveServerModelConfig` 的缺项列表）。

超时/取消（CONTRACT §1 原样实现）：`call.signal` 透传到 fetch；超时由候选适配器 `timeoutMs` 竞速，**transport 默认不设内部计时器**（有测试锁定此行为）。可选 `deadlineAbortMs`（缺省关闭）供 A 显式启用"到点真正 abort 在途 fetch"——缺省行为下适配器超时后 fetch 会挂到自然结束，迟到结果被适配器丢弃（现状语义，无正确性问题，仅占用连接）。

## 3. enrich 注入（CONTRACT §2）

```js
enrich = async (call) => ({
  evidence: [{ id, version, title, text }],   // 按call.payload.sessionId + evidenceRefs[].hash解析
  humanReplies: [{ author, text, at }],
  annotationQuestion: '…',
}) | null
```

- transport 把结果并入**载荷副本** `{ ...payload, context: enrichResult }` 发往模型；冻结原件不动、不影响适配器 payloadHash/去重语义（有测试锁定）。
- 返回 `null` → 不并 context 照常发送（正文缺失会让模型输出过不了引用守门，属诚实失败）；抛异常或返回非法类型 → 送出前失败关闭（`ENRICH_FAILED`，未发生外部调用）。

## 4. 配置（CONTRACT §4）

```js
resolveServerModelConfig(source) // source= A 路由自有的服务端配置对象（本模块绝不自读 process.env）
// → { ok, config:{baseUrl,model,apiKey}, sanitized } 或 { ok:false, missing:[{field,env,label}], invalid, sanitized }
describeServerModelConfig(source) // → sanitized 摘要：mode/baseUrl/endpoint/model/hasApiKey 布尔，无秘密，可进 STATUS/日志
```

- 环境名照契约 §4：`JIANWEI_MODEL_BASE_URL / JIANWEI_MODEL_NAME / JIANWEI_MODEL_API_KEY / JIANWEI_MODEL_MODE`。
- 端点校验：仅 http/https、禁止 `user:pass@` 内嵌凭据；非法进 `invalid`（与"缺失"分开列）。
- `mode` 只报告不裁决：`非 real 一律不发起真实调用` 的判定在 A 的路由/bridge 侧（不注入 transport 即模拟通道）。

## 5. 与 CONTRACT 的差异与假设（全部为"多给能力/额外字段"，语义无冲突）

1. `ok:'indeterminate'` 超出 §1 返回并集：这是产品适配器既有语义（→ `unknown`），是"送出后不可知"唯一诚实的表达；A 若按并集窄化处理，把它与 `{ok:false}` 同归 `MODEL_CALL_FAILED` 亦可（bridge 侧 unknown→failed·mustHumanVerify 已同向）。
2. 成功/失败结果附带额外诊断字段：`modeName`、`sent:true`、`httpStatus`、`usage`——契约并集的超集，适配器只读其中契约字段。
3. 可选 `deadlineAbortMs`（缺省关闭）：契约禁止 transport 另设双超时，缺省遵守；此开关仅当 A 显式传入才生效，用于真正中止在途 fetch。
4. `config.timeoutMs` 本模块不消费（接线给适配器竞速），在 config 中出现无副作用。
5. 假设 Chat Completions 兼容端点（与产品 `http-json.mjs` 映射一致）；真实 provider 未做过在线兼容测试（本任务禁真实调用）。

## 6. 边界声明

- 未调用任何真实模型 API；未读取环境变量或本机任何凭据；未安装 SDK；未启动产品实例。
- 测试全部为本地内存桩（注入 fetchImpl/手动时钟），只证明接口逻辑，不代替真实调用验收。
- 模拟入口未动；产品源码未改；CONTRACT.md 未改（A 独占）。
