# 树形契约只读对照：BACKEND_FRONT_MINIMUM_HANDOFF ↔ Front/Back 当前代码

2026-09-21 · 只读源码对照（grep 全库 + 逐文件阅读），零代码改动、零 API 调用。范围限交接文档六个检查点：实际路径、候选选择、预测、展开收起、效果颜色、金额依据。行号以当日工作区为准。

## 结论速览

- **真实存在**：候选决策链路（校验/选择回执/写后读回/过期失效）双端完整；后端 path_forecast 切片完整（前端未消费）；预评估候选金额字段（含 priceBasis 口径）存在；"未校准、非概率"标签纪律在双端落实。
- **页面自行推断**：横向决策树整棵结构——"四阶段×五域"为前端固定模板，连线实/虚由二十格投影 `completed` 推断，非服务端路径读面。
- **仍缺失**：路径 DTO 全部字段、children/hasMore、effect 全部字段、金额解释字段全部、selectionStrategy、前端预测接线。

## 问题清单（按阻断程度降序）

### B1｜阻断：实际路径读面不存在，现有树为页面自行推断

- 契约字段 `customerId, assessmentId, revision, historyNodes, historyEdges, availableBranches`（含当前分支 `actionId, prerequisites, missing, allowed, actorRole, basisRevision`）在 Back 全库 **0 命中**；Edge 路由表（`Back/Edge/src/server.mjs:554-565`）与 GET 只读透传白名单（`Back/Edge/src/readproxy.mjs:9-115`）均无任何路径/历史端点。
- 前端树（`Front/site-mirror/app/takeoff/role-flow.tsx:47-58`）是硬编码"四阶段×五域"画布；阶段间连线实/虚仅由二十格投影 `completed`（`Front/site-mirror/lib/workbench/takeoff-projection.ts:405-417`，依据 `basis.currency`）推导。即"无法证明先后因果不得连成既成链"目前由前端投影代答，节点/边无事件或回执绑定。

### B2｜偏差（现有页面已发生）：候选显示硬截 3 条

- 后端允许并校验至 5 条：`Back/Edge/src/decision-feedback-store.mjs:76,84`（`length>5` 整体拒绝）、指令"最多5个、优先3至5"（`Back/Edge/src/assistant-model.mjs:38-39`），并按置信度降序排序（`decision-feedback-store.mjs:79,96`）。
- 前端三处 `slice(0,3)`：`role-flow.tsx:49`（连线）、`role-flow.tsx:52`（分支卡片）、`decision-feedback-panel.tsx:135`（面板）。排序第 4、5 名候选被静默丢弃，无 `hasMore` 提示，与"节点只展示实际返回的候选数量，不为'3选1'补造"直接冲突（此处是反向问题：有而不显示）。

### B3｜缺失：children/hasMore 三态不存在，渐进树形无法实现

- `children/hasMore` 在 Front+Back 全库 0 命中。展开/收起是本地布尔（`role-flow.tsx:23,55`），只是显示/隐藏同一固定候选集，无法区分"未加载 / 已知子节点 / 暂无依据"；空态仅有"等待有效候选"占位（`role-flow.tsx:56`）。
- 合规面：该开关只改本地 state，不触发选择、模型调用或业务动作，符合"展开收起只读"；双击选择走选择回执（`role-flow.tsx:56` → 面板 `selectCandidate`），未自动创建后续路径。

### B4｜缺失：预测切片未接页面（前端零消费）

- 后端切片真实存在：POST 接受 `taskKind`（`Back/Edge/src/assistant-decisions.mjs:61-62`，非法值 400）、forecast 指令（`Back/Edge/src/assistant-model.mjs:39`）、`validateForecastCandidates` 强制保留 `targetState/conditions/horizon`（`Back/Edge/src/decision-feedback-store.mjs:82-95`）、latest 返回 taskKind（`assistant-decisions.mjs:51`）与 forecastPromptVersion（`assistant-model.mjs:90`）。
- 前端完全未接：`DecisionCommand` 无 taskKind 字段（`Front/site-mirror/lib/workbench/decision-feedback.ts:21`），`analyze()` 从不发送；`DecisionCandidate` 类型无 forecast（同文件:3-6），UI 不渲染 targetState/conditions/horizon。'路径预测' UI 分支依赖 `requiredQuestion` 入参，但全部调用方均未传入（`assistant-observation.tsx:92`、`role-flow.tsx:66`）；`PATH_FORECAST_QUESTION` 定义后无任何导入（`Front/site-mirror/lib/workbench/path-forecast.ts:2`，死代码）。页面现状永远 next_action——与交接文档"先验收切片再接页面"的顺序一致，但"接页面"为零。

### B5｜缺失：effect 效果字段整体不存在（当前无错误着色，属纯缺失）

- `effect{direction=improved/worsened/unknown, metric, baselineRef, comparisonRule, evidenceRefs}` 在 Front+Back 0 命中；takeoff 前端无"改善/恶化"文案。
- 现状安全：候选分支边恒为灰色虚线（`decision-tree.css` `.tk-tree-lines path` stroke:#a9b4bd；`role-flow.tsx:37` 虚线参数），已选候选仅中性蓝左边框（`.tk-branch-choice.recorded`→#57788d），无绿/红改善声明，符合"默认灰线"。二十格的红/绿另有服务端字段依据（`takeoff-projection.ts:405-421`），与 effect 契约分属两套，未被挪用。

### B6｜缺失：金额解释字段不存在；现有金额是候选点值＋注释

- `amountBefore, amountAfter, delta, currency, amountKind, basisRefs, methodVersion` 在 Front+Back 0 命中。
- 真实存在的金额字段：admission 候选 `suggestedAmount/suggestedTermMonths/referencePriceMinor/priceUnit/priceBasis/currency`（类型 `takeoff-projection.ts:119-130`，顶部消费与注释 `:554-565`，"建议值，等待有权人员确认"/"不编造利率"）；assessments[].candidate.supportableAmountMinor（`:173-183`）；C 评估器 `amountCandidate{candidateRange,evaluable,gaps,tendency}`（`Back/C/src/evaluation/run-four-domain-evaluation.mjs:159-165`，评测 runner 专用，非读面）。
- before/after/delta 比较与 amountKind 区分（模拟额度/预评估建议/正式批准）无字段支撑；页面目前靠 planMarks 文字"预评估候选 ≠ 正式批准"（`takeoff-projection.ts:525`）和预评估 scope 标注维持区分，无金额级依据链。

### B7｜缺失：selectionStrategy 无任何实现

- 该词全库仅出现于交接文档本身。后端无策略概念（仅按 confidence 排序，`decision-feedback-store.mjs:79,96`），前端按序标 A/B/C（`role-flow.tsx:56`）。无"最大概率"等策略宣称，无误导文字；"策略推荐与用户确认分离"无结构可分离。

## 已核对无偏差的点（契约已有部分被正确实现）

- 候选校验：id 唯一/label≤240/impact≤500/confidence∈[0,1]或null/每条必须引用真实证据片段（`decision-feedback-store.mjs:63-79`）；前端运行时校验同口径（`decision-feedback.ts:31-43`）。
- 标签纪律：`confidenceKind:'model_estimate_uncalibrated'` 双端一致（store:71 / decision-feedback.ts:5），UI 明示"未校准模型估计，不是客户反应概率"（`role-flow.tsx:40`）与"置信度为模型估计，尚未校准"（`decision-feedback-panel.tsx` 置信度说明 details）。
- 选择回执：select/none/undo，回执只记选择（含 actor=principalId），选择后强制 GET 读回新 revision 才继续（`decision-feedback-panel.tsx:103-110`）；非 current 候选双端禁选（前端 locked `:108`；后端过期清空 `assistant-decisions.mjs:49-52`）。
- 展开收起只读、选择不自动建路径：见 B3 合规面。
- 模拟输出明示："模拟模型输出 · 非真实推理"标签（`decision-feedback-panel.tsx:123` 附近，`model.status==='simulated'`）。

## 范围备注（六项之外、核对中确认的事实）

- P0 上传上下文：`Back/Edge/src/upload-context.mjs` 已导出 `createUploadContextReader`（返回 available/reason/bindingRef/allowedKinds/allowedObjects/expiresAt，`:23-28`，含读后二次撤权复查），但 `Back/Edge/src` 无任何文件导入它；`Back/Connectors/src/intake/upload-context.mjs` 仅被测试导入。即模块存在、**无挂载路由、前端（`wb-client.ts`）无消费函数**——与交接文档"P0 待实施/由后端单 writer 实施中"的状态描述相符。
- 材料统一读面：`recordKind/businessName/originalRef/savedReceiptRef` 等字段在 Back/Front 0 命中（交接文档自述"材料列表并非已完成统一业务名称读面"，一致）。
