# 01-front 接口需求（V0.5 收尾轮）

2026-09-30。前端已按容错形状消费并在真实栈验证；02/03 定稿后按下面章节核对，不一致处由原 writer 处理。

## 1. arrow-cases 展示字段（请 02 在 CONTRACT_DELTA 一次定稿）

前端当前按以下候选名容错读取（`Front/site-mirror/lib/workbench/arrow-cases.ts pickText`）：

| 语义 | 当前候选名（按序取第一个非空） |
|---|---|
| 案例要点 | `summary` → `caseSummary` → `point` → `synopsis` → `gist` |
| 初始检查点 | `checkpoint` → `checkpointText` → `checkpointNote` → `checkpointSummary` |
| 下一动作 | `nextAction` → `nextActionText` → `nextStep` → `nextStepLabel` |
| 展示顺序 | `displayOrder`（数字；缺省按 manifest 顺序） |

其余已消费字段沿用 09-29 形状（caseId/customerId/displayName/scenarioLabel/scenarioKey/industry/annualRevenueCny/
sourceMode/scenarioIsOutcome:false）。**若 02 定稿名不同**：只需在 pickText 候选数组里加名（一处），或告知 01 修改。
字段全部缺失时页面显示"进入案例按页面提示办理/由进度推导阶段"，不阻塞。

## 2. 十案例清单（请 02 尽早交样例）

- 十例需 `scenarioLabel` ∈ 差/中/好（分类）＋每例独立 `displayOrder`；前端按 差→中→好→displayOrder 排序。
- 案例要点建议 ≤24 字（卡片一行）；检查点/下一动作 ≤30 字（块内两行内）。
- 客户身份/跨客户过滤语义沿用（客户身份应得空清单）。

## 3. cycles 状态词表（请 02 确认实际状态名）

`cycles-panel.tsx` 当前映射（TASK3_INTERFACES §6 推导）：

- 可履约：`open` / `active`
- 待回执（显示"待外部回执（外部收付款未连接）"）：`awaiting_external_receipt`
- 可结清：`external_receipt_recorded` / `ready_to_settle`
- 可关闭：`settled`；可返单：`settled` / `closed`

若 02 实际状态名不同（如 `fulfilled`、`receipt_confirmed`），请给出词表样例，01 更新 `STATE_LABEL/canFulfill/
canReceipt/canSettle`（一处）。GET /cycles 响应包若非 `{cycles:[…]}`（如裸数组或 `{items}`）也请注明——前端已兼容
裸数组，其他包名需一处调整。

## 4. 人工核验登记（DEF-03-05；已按 03 DEFECTS 文档实现，请 02 背书）

请求体：`POST /api/jw/v2/actions/customers/:id/artifacts`
`{tenantId, requestId, kind:'document', factKey, grade:'confirmed', content:{value, unit?, sourceMode:'human_verified_document', factKey}, materialMeta:{unit?, caliber:'人工核验原件后登记（confirmed）'}}`
- factKey：`revenue_annual_declared`（业务，unit=wan，value=万元数）｜`entity_identity_verified`（政策，value=bool）｜
  `equipment_ownership_verified`（资产，value=bool，差例=false）。
- 请 02 确认：kind='document' 是否正确（03 文档如此写）；重评由前端 advance-plan→advance 触发（affectedDomains 域）
  是否与服务端预期一致；重复登记同 factKey 的 supersession 语义（前端允许再登记=新版本，重评再触发）。

## 5. 明确不需要

- 不需要前端专用聚合接口：目录卡进度由 advance-rounds 推导；案例说明由前端读面投影组装。
- 不需要模型接口变更：MODEL_NOT_CONFIGURED 503 语义保持即可（前端转为案例说明）。
