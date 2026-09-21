# 三案例绑定：明确 ID，不匹配名称

已运行接口：`GET /api/jw/v2/arrow-cases`（同源 x-jw-session）。A 对应 `/api/v2/arrow-cases`。未登录由 Edge 拒绝，内部身份仅返回其获准客户；跨租户为空。

```json
{
  "ok": true,
  "manifestVersion": "parallel-arrows-cases-v1",
  "cases": [{
    "caseId": "parallel-v1-good",
    "fixtureVersion": "parallel-case-v1",
    "sourceMode": "synthetic",
    "customerId": "<本实例已持久客户ID>",
    "displayName": "隔离合成制造业-好例",
    "scenarioKey": "good",
    "scenarioLabel": "好",
    "scenarioIsOutcome": false,
    "industry": "制造业",
    "annualRevenueCny": 22000000,
    "transaction": {"orgType":"commercial_leasing","product":"sale_leaseback","region":"新疆喀什","customerRange":"standard"}
  }]
}
```

稳定三键为 parallel-v1-good / parallel-v1-medium / parallel-v1-bad，scenarioKey 分别 good/medium/bad；用 Map(caseId→entry) 或直接渲染 manifest.cases。customerId 是当前数据库真实登记 ID，应传给 workspace/advance 等接口；不可用 caseId 替代 customerId。新建另一轮演练时 customerId 可以改变，manifest 是绑定权威。案例顺序不是契约。

现有 Front demo-cases.ts 只有 runtimeDisplayName，没有稳定 caseId；其喀什旧名称匹配无法自动复用本包新合成数据。Front 需消费此 manifest，而不是修改后端名称冒充旧材料、模糊匹配或按下标认客户。本包未改 Front。新材料/财务值为独立版本，旧喀什好例超收入红线的原件保留；当前三例不把旧名称或旧金额带入新材料。

scenarioKey/Label 仅测试场景设定，不能驱动绿勾、拒绝或钻石；专业结论来自实际 C 分析，最终状态来自 caseOutcome 与真实人类决定。执行器不读取 manifest 场景键推导结局。
