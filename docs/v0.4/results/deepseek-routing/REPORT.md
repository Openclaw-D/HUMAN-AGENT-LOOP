# DeepSeek Flash / Pro 路由：小批实测与局部修正

2026-09-21。此轮只使用 `docs/materials/kashgar-demo-v1/case-index.json` 的三个合成客户；未把真实客户材料送出，也未改变现有共享服务配置或启动进程。

## 真实 API 结果

- 原始短摘要 Flash 2轮×3客户：均 HTTP 200，平均完整耗时 1.30 秒；至少3条有金额红线错误或矛盾，不能直接作信用结论。原始记录 `.local/deepseek-smoke/2026-09-20T20-52-51.837Z/results.json`。
- Pro low 1轮×3客户：完整耗时 9.09/9.96/8.35 秒；该批未见相同红线错误。原始记录 `.local/deepseek-smoke/2026-09-20T20-54-07.807Z/results.json`。
- 改进输入后 Flash 3轮×3客户：由代码预先计算收入是否超过5000万元，并在第三轮加入不可信的相反客户留言。9/9 JSON形状、红线布尔值和越权词检查通过；均值 1.57 秒，总 usage 3403 tokens。逐条人工核对摘要未见红线比较错误。记录 `.local/deepseek-smoke/verify-2026-09-20T21-01-46.022Z/results.json`。这是独立短摘要测试；现有 JW 工作本暂不提供同等结构化收入字段，所以不能把这9次结果当作整链准确率。
- JW B transport 直接出站 Flash 探针成功：1.12秒，有 usage。配置路由后真实 Flash 探针成功（1.88秒），Pro 首次因共享 `max_tokens=140` 耗尽思考 token 而确定失败 `EMPTY_OUTPUT`（2.31秒）。改为 2000 后使用新请求身份显式复验 Pro 成功（5.89秒、478输出 tokens，其中343思考 tokens）。没有自动重发失败请求。
- Edge `createAssistantModel` 使用无明文密钥 JSON + `apiKeyEnv` + 独立回执/账本目录做真实双路探针：简单问题走 Flash，2.28秒成功（471 tokens）；复杂问题走 Pro low，12.15秒成功（1300 tokens，含746思考 tokens）。目录 `.local/deepseek-smoke/edge-route-2026-09-20T21-07-20.671Z/`。这是直接调用模型模块，不是共享HTTP服务或页面整链。
- 同一 API Key 的官方余额查询先后返回 ¥61.05、¥60.99；与“已计费”一致，但用户所见后台用量页为0的展示差异尚未定位。账单口径以 DeepSeek 控制台后续对账为准。

## 源码变更

- `Back/Edge/src/assistant-route.mjs`：确定性保守分类。显式的简单等值问题与短提取/概括走 Flash；金额比较、信用、审批、预测、决策任务及未知问题走 Pro。模型不自行选路由。
- `Back/Edge/src/assistant-model.mjs`：仅在显式配置 `deepseek-flash-pro-v1` 时绑定路由分类；支持通过 `apiKeyEnv` 读取当前进程环境变量中的密钥，不必把密钥写入 JSON。原有未配置路由的调用保持旧形状。
- `Back/B/src/transport/glm.mjs`：Flash 关闭思考、默认最多500输出 tokens；Pro 开 low 思考、要求至少2000输出 tokens；指定同一官方 DeepSeek endpoint 和两官方模型 ID。无失败自动切换，出站白名单、预算、回执三分状态沿用。
- `Back/Edge/src/assistant-receipts.mjs`：仅当存在 routing 配置时纳入配置哈希；未配置的旧回执身份不改变。请求 routeClass 进入 payloadHash，防止跨模型误复用。

示例配置片段（供受控配置合并；**不是已经启用的配置**）：

```json
{
  "transport": {
    "mode": "real",
    "real": {
      "endpoint": "https://api.deepseek.com/chat/completions",
      "model": "deepseek-v4-pro",
      "apiKeyEnv": "JW_DEEPSEEK_API_KEY",
      "outboundAllow": ["https://api.deepseek.com"],
      "maxOutputTokens": 2000,
      "timeoutMs": 30000,
      "routing": {
        "strategy": "deepseek-flash-pro-v1",
        "flashModel": "deepseek-flash",
        "proModel": "deepseek-v4-pro",
        "flashMaxOutputTokens": 500
      }
    }
  }
}
```

正式启用仍需沿现有 Edge 启动流程提供受控预算、模型回执目录、获准材料 hash 与服务端身份；这些共享运行配置本轮未改变。现有 Key 仍在 Windows 当前用户的 DPAPI 文件里，实际启动时需由受控本地启动程序在子进程环境中注入 `JW_DEEPSEEK_API_KEY`；本轮没有写明文密钥配置。

## 验证与界限

`node --test Back/B/test/deepseek-routing.test.mjs`：7/7；`node --test Back/B/test/v04-transport-three-state.test.mjs`：13/13；`node --test Back/Edge/test/v04-receipts-unknown-fence.test.mjs`：10/10；`node --test Back/Edge/test/assistant-model.test.mjs`：16/16。测试使用本地替身/临时目录，真实 API 探针另计。

未运行端到端页面、完整材料与真实PG整链；不以格式校验代替业务内容验收。红线应由权威结构化字段计算后再送模型，当前客户工作本缺该输入，留作后续串行集成。未切换任何共享服务或前端，浏览器界面仍是原模型配置的实际状态。
