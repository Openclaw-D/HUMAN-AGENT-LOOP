# STATUS — V7 Backend Lane C（规则、证据、模型判断及计算）

- 更新：2026-09-15（第四轮：CONTRACT v0.2 消费完成，无未决观察）
- Owner 写面：仅 `V7/backend/C/**`。site、V6、home/**、3607/3467 只读；不 commit/push/tag/worktree；不读取真实密钥；不操作前端/Codex。
- 当前结论：**CONTRACT v0.2 消费完成——58/58 单测（无变更未重跑）、8/8 用例、20/20 真实 HTTP 集成（对 v0.2 新代码复跑，含 resolved 意见门精确 RUN_RESOLVED 断言与上游 hash 记录）全部通过**。C 路无未决观察、无真实阻断。

## 本轮变更（对照 HEARTBEAT_20260915_0725 §C）

| 项 | 状态 |
|---|---|
| 读取 CONTRACT v0.2 | ✅ 两处均采纳 C 上轮观察：#4 resolved 意见门改码 `RUN_RESOLVED`、#7 校验顺序（状态门先于引用校验）写入文本 |
| 集成断言更新 | ✅ `resolved 上写意见` 从宽容断言（两码之一）收紧为精确 `RUN_RESOLVED`，实测命中 |
| 隔离复跑 | ✅ A v0.2 服务器（新数据目录 `runtime/integration-data-v02` + 同一合成 principal token）20/20 通过 |
| 上游 hash 记录 | ✅ 集成证据新增 `upstream` 字段：CONTRACT.md `c0cf5ca0…`、A/src/server.mjs `3e36a518…`、service.mjs `d2035d2c…`、store.mjs `a7a399b3…`（集成脚本运行时自算，防陈旧引用） |
| 观察台账 | ✅ `observations-for-A.md` v4：#4/#7 闭合，**无未决项**；不再声称"等待 A 裁决" |
| 计算全套 | 按心跳指示未重复：calculation/rule-pack/schema/model-judgment/case-runner 及其测试本轮零变更（最近一次全绿记录 `evidence/laneC-test-run-full.log`，58/58） |
| 边界保持 | ✅ ZAI_API_KEY 未读取；模型路径全部 `provider: 'simulation'`；principal token 为合成测试值；不回退 A 安全门 |

## 复跑方法

```
cd V7/backend/C
node --test test/v7-calculation-tool.test.mjs test/v7-rule-pack.test.mjs test/v7-candidate-schema.test.mjs test/v7-model-judgment.test.mjs test/v7-case-runner.test.mjs test/v7-contract-adapter.test.mjs
node src/run-evaluation.mjs evidence
# 集成（A v0.2 服务器，隔离目录 + 合成 token）：
node ../A/src/server.mjs --port 3622 --data-dir ./runtime/integration-data-v02 --principal-tokens v7c-integ-synthetic-token-0426
node src/run-contract-integration.mjs http://127.0.0.1:3622 evidence
```

## 下一步

1. B 网关可用后做 simulation/real 对比（凭据授权仍阻断 real，非 C 可解）。
2. 响应 D 对组合（含 C 案例投影）的验收发现（若有）。
3. 无其他待办：C 路当前交付与 CONTRACT v0.2 一致且实测闭合。
