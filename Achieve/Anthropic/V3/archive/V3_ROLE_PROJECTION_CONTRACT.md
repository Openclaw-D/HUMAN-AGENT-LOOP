# 见微 V3 Role Projection Contract

更新：2026-08-30  
状态：`FROZEN CONTROL CONTRACT / IMPLEMENTATION PENDING`  
上位权威：`V3_DIRECTION_FREEZE.md` Gate 1–19  
相关契约：`V3_DEMO_NARRATIVE_CONTRACT.md`、`V3_GOLDEN_CASE_SCENARIO_CONTRACT.md`、`V3_API_AND_EVENT_CONTRACT.md`、`V3_ACCEPTANCE_MATRIX.md`

## 1. Contract 目标

本契约冻结同一批 `FinancingLeasingCase` 如何从唯一 Backend Authority Kernel 派生为四个 Role Application 的不同只读或可操作视图。它解决的是 identity、scope、action、denial 与 Receipt binding，不冻结五路内部专业内容槽、真实组织树或生产 RBAC。

任何前端本地过滤都只能改善显示，不能承担权限。Backend 必须在返回 Projection 和接受写请求前验证 `caseId + principal + role application + invitation / professional scope`，并对越权请求 fail closed。

## 2. 稳定标识与页面名称

### 2.1 Role Application

当前迭代保留内部稳定 ID，避免为了页面改名迁移所有历史引用：

| `roleApplicationId` | 前端唯一可见两字入口 | 产品职责 |
| --- | --- | --- |
| `leadership` | `协同` | God View、KPI / Portfolio / Case 归因、追问、协调、Management Action |
| `business` | `业务` | 商机采集、事实确认、补件、客户 / 供应商协调、全 Case 运营 |
| `risk` | `风控` | 政策、信审、商务、资产四专业判断与各自 Human Gate |
| `external` | `外联` | 客户 / 供应商被邀请的材料、问题与确认 |

- Active V3 页面不得出现可见一级名称“领导”；内部 `leadership` 只是兼容 ID，不表示页面名称或独立业务 Authority。
- `外联` 是当前两字 working label；若未来只改显示名，不得改变 `external` 的权限语义。
- Mobile 与 Desktop 使用同一 ID、同一 Projection 和同一 Action 语义，只改变布局与信息密度。

### 2.2 Principal

Demo 至少存在以下 canonical principal：

```text
collaboration-manager
business-owner
risk-policy
risk-credit
risk-commercial
risk-asset
external-customer
external-supplier
```

- 现有 `leadership-observer` 只允许作为兼容 alias 输入，并在 Backend identity adapter 中归一化为 `collaboration-manager`；它不能继续把协同权限解释为纯只读。
- `actor` display name、前端下拉值或请求 body 中的任意字符串都不能授予 Authority。
- Demo 可以使用本地合成 session / principal selector，不要求生产登录；但 server 必须验证 selector 与允许的 role、professional scope 或 invitation 对应，错误组合返回 typed denial。
- 模型、Agent、Chat candidate 永远使用 `authority=none`，不能映射成上述 Human principal。

## 3. 两层 Projection

四个 Role Application 均必须有 Case Panel 与单 Case Workbench。两层数据都由 Backend 派生，前端不得维护第二份可写 Case 状态。

### 3.1 `CasePanelProjection`

每个条目最少包含：

```text
caseId
businessItemType = FinancingLeasingCase
caseTier = golden | background
readOnly
title / company / industry / region
leaseMode
phase / lifecycleStatus
signal / blocker / nextMilestone
commencementBand = 0..5
roleScopedSummary
allowedEntryActions[]
```

- Case 集合、摘要、排序信号与入口动作必须按 principal 的组织范围、责任、参与关系或 invitation 派生；四个页面不是 identical dashboard。
- `commencementBand` 是 Case 级起租就绪带，不等于五路完成数量，也不显示精确百分比。
- 任何 `lifecycleStatus=active_lease` 的 Case（包括背景摘要）都必须派生 `commencementBand=5`；起租后风险通过 signal / exception 表达，不回退起租里程碑。
- 背景 Case 每个拥有独立 `caseId` 与稀疏只读摘要；不得返回或复用 Golden Case 的 Context、Evidence、群聊或 Receipt。
- 外联 Case Panel 只列当前 principal 的有效 invitation 所涉及的 Case，并以外部语言显示有限进度和待办。

### 3.2 `RoleCaseProjection`

Golden Case Workbench 最少包含：

```text
caseId
businessItemType
scenarioRef
runtimeEpoch
contextVersion / contextSeq
roleApplicationId / principalId
projectionVersion / generatedAt
caseSummary / goal / blocker / owner
commencementState
scope
allowedActions[]
processProjections[]
collaborationProjection
visibleReceiptRefs[]
denialHints[]
```

- `contextVersion` 必须来自 Authority Kernel，不能由页面、query parameter 或 frontend seed 拼接。
- `projectionVersion` 只是派生视图版本，不产生新的业务真相。
- Background Workbench 若开放，只返回与 Case Panel 一致的稀疏只读 Projection；`processProjections`、群聊、Evidence 与 Receipt 均为空。
- 所有字段都必须经过 server-side scope shaping；业务或风控“看五路”不等于读取全部原始底稿。

### 3.3 `LeadershipPortfolioProjection` 的价值口径

`协同` God View 默认以本期 / 本年 KPI 为主，突出可验证净收入与单位资产产出效率；全周期利润只作为辅助校验、长期影响提示和防止短期透支的约束。至少返回：

```text
metricDefinitionId / formulaVersion
metricClass = net_income | unit_asset_net_income | full_cycle_profit
timeScope = current_period | current_year | full_lifecycle
valueClass = actual | forecast | scenario
target / due / value / variance
asOf / currency
dataCoverage
sourceReceiptRefs[]
```

- 净收入基础公式固定为对应期间总收入减资金成本、渠道成本和附加税；不包含项目人力成本、非人力成本、风险成本或风险拨备。
- 单位资产产出使用 `净收入 / 起租金额`，不得在未扣除全部成本时命名为完整 ROI。
- 全周期利润在财务、费用、人力和风险系统未完成接入与对账时只能是 `forecast` 或 `scenario`；Projection 必须说明缺失数据和收敛状态，且不得覆盖当期 / 年度 KPI 主视觉。
- 费用尚未真实报销或入账时只能作为预计值；实际入账后形成新的受控来源并派生预实偏差。前端不得自行把预计值改写为 actual。

## 4. 五路 Process Projection

内部角色对 Golden Case 的五路固定为：

```text
opportunity | policy | credit | commercial | asset
```

每一路最少包含：

```text
processId
runId
boundContextVersion
runStatus
freshness
readinessBand
riskBand
evidenceCoverageBand
gateState
summary / changes / gaps / nextAction
owner / needsHuman / updatedAt
```

冻结枚举：

- `runStatus = queued | running | partial | needs_input | ready_for_gate | completed | failed | superseded`；
- `freshness = current | stale | superseded`；
- `readinessBand = 0..4`，仅作粗粒度内部状态，不在前端显示精确百分比；
- `riskBand = unknown | low | medium | high`；
- `evidenceCoverageBand = 0..4`；
- `gateState = not_ready | ready | confirmed | rejected | returned_for_evidence`。

readiness、risk、Evidence coverage 与 model confidence 是不同维度。新 Context 可以让某一路 readiness 回退；旧 Context 的迟到结果不得覆盖 current Projection。

本契约不冻结每一路五个内容槽的名称、顺序、阈值或算法。五路 Process Thread 是并行路由，不是五个线性阶段状态机。

## 5. Action capability 必须分型

不得继续用单一 `readOnly` 或 `canSubmitHumanGate` 表示所有权限。每个 Projection 返回的 `allowedActions[]` 至少采用以下 typed capability：

```text
chat
submit_evidence
confirm_fact
professional_gate
management_action
commencement_action
view_replay
```

每项至少包含：

```text
actionType
enabled
requiresConfirmation
boundContextVersion
requiredPrincipalId / requiredProcessId / invitationId
denialCode
```

### 5.1 权限矩阵

| Principal | 看五路 | 允许写入 | 明确禁止 |
| --- | --- | --- | --- |
| `collaboration-manager` | 五路摘要、KPI / Portfolio / Case 归因 | Chat、追问、优先级、复核请求、具名 `management_action` | 任何 `professional_gate`、替业务确认事实、替商务正式起租 |
| `business-owner` | 五路 Role Projection 与完成项目运营所需 Context | 商机材料、外部邀请、补件协调、具名 `confirm_fact`、商机侧确认 | 政策 / 信审 / 商务 / 资产 `professional_gate`，正式起租代签 |
| `risk-policy` | 五路摘要 + 政策必要 Context | 仅政策 `professional_gate` | 其他三专业 Gate、业务事实代签 |
| `risk-credit` | 五路摘要 + 信审必要 Context | 仅信审 `professional_gate` | 其他三专业 Gate、业务事实代签 |
| `risk-commercial` | 五路摘要 + 商务必要 Context | 仅商务 `professional_gate`；条件满足后提交 `commencement_action` | 其他专业 Gate、绕过起租条件 |
| `risk-asset` | 五路摘要 + 资产必要 Context | 仅资产 `professional_gate` | 其他专业 Gate、付款或起租 Authority |
| `external-customer` | invitation 对应问题、待办、有限 Case 起租大进度 | invitation 范围内回答、上传、确认 | 内部五路判断、其他外部材料、任何内部 Gate / Action |
| `external-supplier` | invitation 对应设备 / 交付 / 付款待办与有限进度 | invitation 范围内回答、上传、确认 | 客户材料、内部五路判断、任何内部 Gate / Action |

`professional_gate` 只对应政策、信审、商务、资产四个专业 principal。商机由业务的事实确认与 `ContextCommit` 推进，不制造第五个风控专业账号。

## 6. Collaboration Projection

项目群聊不是孤立 Chat box，也不是第二个 Event Authority。Projection 至少返回：

```text
caseId / contextVersion
collaborationGoal
members[]
memberStatus[]
threadRoutes[]
messages[]
mentionTargets[]
pendingHumanItems[]
```

- Internal member 可以看到五路状态摘要，但接收的 Context Packet 按任务最小化。
- `@` 只路由问题、Evidence 引用与 candidate 工作，不授予被 @ 的 Agent 或人员额外 Authority。
- 普通消息和 Agent 思考不递增 Context；Evidence 接受只形成 staging Receipt，只有具名 `ContextCommit` 进入新的权威版本。
- 外联不进入完整内部群聊，只看到 invitation-scoped conversation；客户与供应商互相隔离。

## 7. Receipt Projection 与不串页

Projection 只返回当前 principal 可见、且同时匹配当前 `caseId + contextVersion + action/process/invitation scope` 的 Receipt reference：

```text
receiptId
receiptType
caseId
contextVersion
principalId
processId / actionType / invitationId
status
evidenceReceiptIds[]
recordedAt
```

- 完整 Receipt 需要独立读取时仍必须重复授权检查。
- 切换 role、principal、case 或 Context 后，前端必须清空旧 Receipt state，再加载新的 server Projection。
- 不允许用“全 Case 最新一条 Receipt”填充所有页面。

## 8. Backend denial contract

以下情况必须在 Backend 拒绝，而不是只隐藏按钮：

```text
UNKNOWN_PRINCIPAL
ROLE_PRINCIPAL_MISMATCH
CASE_SCOPE_DENIED
INVITATION_REQUIRED
INVITATION_EXPIRED
INVITATION_SCOPE_DENIED
PROCESS_SCOPE_DENIED
ACTION_SCOPE_DENIED
CONTEXT_VERSION_CONFLICT
BACKGROUND_CASE_READ_ONLY
AUTHORITY_NONE
```

- Denial 不追加成功 Event / Receipt，不递增 Context，不闪现前端成功状态。
- Business 尝试四专业 Gate、协同尝试专业 Gate、风险账号跨专业 Gate、外联访问内部 Projection、背景 Case 写入均必须有 negative API test。
- 前端可以展示 `denialCode` 对应的可操作说明，但不能自行改写 denial 为成功。

## 9. 当前实现迁移判断

当前 `lib/v3-shell-model.ts` 只是一套 frontend shell policy，不是 V3 Authority。实现阶段必须完成：

1. 把 role / principal / invitation enforcement 下沉到 Backend Projection 与所有 mutating API；
2. 删除 `business-owner` 对五路 Gate 的代签权限，只保留商机事实与协同职责；
3. 将协同从纯 read-only 改为只拥有 typed `management_action`，仍拒绝专业 Gate；
4. 背景 Case 改为有独立 API 的稀疏只读 Projection；
5. 群聊、Receipt 和 Context identity 从 server Projection 读取，不再依赖 frontend constant 或 local state 充当 Authority。

在以上五项完成且 negative tests 通过前，不得把当前四角色页面声明为权限已落地。

## 10. 明确不在本契约冻结

- 生产 SSO、完整 RBAC、数据库表、组织目录同步；
- 五路内部五个内容槽名称与顺序；
- 政策 / 信审阈值、评分、模型、规则部署库；
- 真实客户、供应商、员工身份和真实 invitation 渠道；
- 图表版式、页面具体文案、头像、公司名、金额与设备型号；
- 中大、汽车或集团其他事业部的 Role Projection；
- 起租后资产管理、催收、重组、处置与结清工作台。

这些是未来业务校准或产品化事项，不能阻塞当前比赛 Demo，也不能被静态页面反向写进 Authority schema。
