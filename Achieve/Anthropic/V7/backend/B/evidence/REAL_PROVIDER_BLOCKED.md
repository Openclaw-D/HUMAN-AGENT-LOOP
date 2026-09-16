# 真实模型 provider 凭据阻断记录（2026-09-15，B 路）

## 结论

**真实付费模型 API 调用 = 0 次（如实）**。环境中未提供任何"用途/成本已获用户授权"的
模型 provider 凭据（endpoint / apiKey / 预算上限均未配置）。C 路 STATUS 亦确认
`ZAI_API_KEY` 存在但未获用途/成本授权，且本包纪律禁止读取/转移密钥——B 同样**不读取、
不检测、不引用**任何密钥值。按 LONG_RUN_GOALS §共同约束："否则明确阻断并完成其余测试"。

## 已交付的真实 HTTP 接入面（非阻断部分）

1. **传输映射复用既有交付**（hash 见 evidence/dependency-file-hashes.txt）：
   - OpenAI Chat Completions 形状：V6 `providers/http-json.mjs`（官方 OpenAPI v2.3.0 映射）
   - Dify Workflow 形状：V6 `providers/dify-workflow.mjs`（兼容候选，本轮未叠加第二流程 owner）
2. **真实 socket 端到端证据**：`test/loopback-http.test.mjs` 用本地 127.0.0.1 随机端口
   mock 服务 + 既有 `createProviderTransport` 走真实 TCP/HTTP，断言：
   - `Authorization: Bearer …` 头真实送达
   - 请求体 model/messages 载荷真实送达
   - 响应经 parse→adapter 校验→候选意见进入编排视图
   运行记录：evidence/test-run-all-20260915.txt（loopback 套件段）。
   ⚠️ 这是**回环传输证据**，证明接线正确；不证明真实 provider 兼容（后者本就 NOT TESTED，见 V6 契约 §9）。
3. **凭据注入面已留好**：`buildChatCompletionsRequest(payload, { getApiKey })`——凭据由
   集成方（A assembly / 用户授权后）以回调注入，B 不接触密钥值，不落日志、不落 checkpoint。

## 凭据到位后的验证方法（一条命令）

用户明确授权用途/成本并提供注入方式后，由 A assembly 以真实 baseUrl/model/getApiKey
构造 transport 注入 B 编排器，随后：

```bash
cd V7/backend/B && npm test          # 既有 43 项回归（mock/scripted，零真实调用）
# 再以真实 transport 跑一次 ratio_query 单事件小流量验证（预算内 1 次调用），证据落 evidence/
```

首次真实调用前必须：小流量 1 次、真实调用记入 usage（50 万 tokens 上限为继承上限而非目标）、
unknown 不盲重试。

## 与 C 路口径一致

C 路（真实模型通道）同样阻断且标注 `provider: 'simulation'`。两路口径一致：
模拟/回环/真实三种来源在数据与证据中严格分离，可被 D 路黑盒复核。
