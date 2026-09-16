# B路（V6-API-TRANSPORT）RESULT

- 接手时间：2026-09-13 23:10（北京时间）。交付时间：2026-09-13 23:35 左右。
- 只写了 `V6/handoff/API_OVERNIGHT_20260913/transport/**`；产品源码只读，未改产品、未覆盖其他任务文件、未操作 Codex、未嵌套 spawn。

## 交付物

1. `server-http-transport.mjs` — 服务端 HTTP transport（契约名 `createHttpJsonTransport`），复用产品 `providers/http-json.mjs` 请求/响应纯映射，补齐：配置校验（缺项中文列出）、HTTP 状态判定、响应/错误解析、超时取消（signal 透传 + 可选 deadlineAbort）、网络错误分级（可证明未送达才 `notSent`）、错误脱敏（无 Authorization、无原始响应体、消息截断 200 字符）。
2. `test/` — 28 条本地模拟测试 + 运行器 + TAP 证据。
3. `INTERFACE.md` — A 接入说明（含与 CONTRACT 的差异/假设清单）。

## 验证结果（全部本地模拟，无真实调用）

`node test/run-all.mjs` → **28/28 通过**（原始输出：`test/evidence-20260913-2330.tap`，duration ≈105ms）。

| 任务书要求场景 | 结果 | 关键断言 |
| --- | --- | --- |
| 未配置 | ✅ | throw `notSent:true`/`TRANSPORT_NOT_CONFIGURED` 列全缺项；fetch 零调用；经适配器 `cancelled`+预留释放 |
| 成功 | ✅ | 适配器 `succeeded`（与模拟可区分）；POST `chat/completions`；证据正文进请求（非只 hash）；usage 结算 `committed` |
| 超时 | ✅ | 适配器竞速 `unknown`/`TIMEOUT`、`unknown_hold`；transport 缺省无双计时器（契约）；opt-in `deadlineAbortMs` 真正中止在途 fetch |
| 取消（超时一并要求） | ✅ | 送出前 `cancelled`/预留 none；送出后外部中止 → `indeterminate` |
| HTTP 错误 | ✅ | 401/429/503：`sent:true`+错误码透传；429 带 usage 照常如实计费；非JSON错误体不回显原文 |
| 非JSON | ✅ | 2xx 响应体非JSON → `SERVER_HTTP_NOT_JSON`；content 非JSON → 复用既有 `PROVIDER_CONTENT_NOT_JSON` |
| 引用越界 | ✅ | 经真实适配器守门 `EVIDENCE_DANGLING`/`UNSOURCED_FINDING` 失败关闭，违规 findings 不放行，usage 仍如实结算 |
| 附加 | ✅ | enrich 三态（并入副本/不冻结原件、null 不并、异常失败关闭）；超长错误消息截断；全结果无密钥泄漏断言 |

## 与 A 的接口核对结论

A 路 CONTRACT（23:10 冻结）已逐条对齐：工厂名/签名、`getApiKey`、throw-notSent 未发送语义、signal 透传且 transport 不设双超时、enrich 副本注入、配置环境名 §4、脱敏纪律。差异仅 5 条"超集/可选"项，见 `INTERFACE.md` §5，无语义冲突。

## 配置缺项与真实验证状态

- **真实调用未验证**：本任务按边界不读环境变量/凭据、不调付费模型；端点/模型/密钥的实际存在与否由 A 路环境检查报告（可复用本模块 `resolveServerModelConfig(source)` 判定并列缺项）。
- 状态如实声明：**本地接线与接口逻辑已验证；真实 provider 在线兼容未测试**。

## 剩余下一步（唯一）

A 集成后若进入真实调用，建议首探针同时核对所选 provider 对 `response_format:{type:'json_object'}` 与 `metadata` 字段的兼容性（产品既有映射默认携带，个别严格网关可能拒绝未知字段；如被拒，可在 A 侧对 body 做窄化，不需要改本模块语义）。

## 交付文件 hash（SHA256）

```
f577bc68007ed8ac6f985d2fbadfb8c9774c17e8399bdc830d1cb2b2561f68c7  server-http-transport.mjs
4e5065edac3aa2beca76676721185579811cf3a3c3e73de6c330b9a824fd428a  test/server-http-transport.test.mjs
d5e2cdf7a5c9fbc809c68072cab4e7c63adee3dba69ee1402be35975843282cb  test/run-all.mjs
```

无新缺陷即到此为止，不为整夜空转；若 A 集成中发现接口问题，按 `INTERFACE.md` §5 的差异清单先行核对，仍不一致再回写本目录。
