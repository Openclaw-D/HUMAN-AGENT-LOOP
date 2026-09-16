# RelayOS P1 架构契约

状态：P1 强制 Gate  
日期：2026-08-26  
产品上位约束：`C:\Users\22673\Desktop\Anthropic\RelayOS\PRODUCT_CONSTITUTION.md`  
场景上位约束：`C:\Users\22673\Desktop\Anthropic\RelayOS\SCENARIO_MATRIX.md`

## 1. 冻结结论

RelayOS P1 冻结为一个单进程、单节点优先、event-sourced（事件为权威来源）的连续性与权威服务：Node.js ESM 后端负责确定性 domain validation、SQLite/WAL 持久化、HTTP API、provider/connector 边界和静态中文前端；十场景共享一套对象、状态机、命令、事件和投影。

当前 P0 **可以作为迁移种子，不能原样升级为十场景内核**。它已真实证明 Accepted Handoff、具名 Human Gate、GoalVersion、scoped context、原子事务、幂等、WAL 重启恢复和同源保护；但其权威真相仍是 `organizations.state_json` 快照，BusinessEvent 不足以独立重建状态，角色选择没有认证，外部动作只是模拟字段，也没有运行时模型 provider。P1 后续实现必须重构这些边界。

## 2. 技术与产品分层

| 层 | 责任 | 禁止事项 |
| --- | --- | --- |
| 中文 Web Client | 关系图、inspector、待接受交接、Human Gate、timeline/replay、演示角色选择；只发送意图和展示投影 | 不在客户端判权限；不把角色选择包装成登录；不缓存为权威状态 |
| HTTP/API Boundary | Origin/CORS、body limit、command envelope、错误映射、trace、健康检查、静态资源 | 不在 route 中写业务规则；不先读 body 再拒绝 Origin |
| Application Service | command/query 编排、幂等、版本检查、加载配置/stream、provider/connector orchestration | 不绕过 domain kernel；provider 返回不得直接 append 权威事件 |
| Deterministic Domain Kernel | 对象不变量、状态机、授权、Gate、handoff、ActionIntent、metric validation、event 决定 | 不依赖网络、时钟全局、UI 或模型；同一 command 输入必须确定地产生同一 domain 结果 |
| Event Store / Projection | append-only BusinessEvent、command receipt、配置版本、投影、重放、hash 校验、迁移 | 不以投影 JSON 作为唯一真相；不允许无事件的权威状态更新 |
| Advisory Provider | Mock 与 Z.AI General provider；提取、总结、冲突/配置/行动建议；结构化输出、timeout/retry/breaker | 不拥有目标/权限/owner/Gate；不使用 Coding Plan runtime；失败不写权威状态 |
| ExternalSystem Adapter | 读取事实、执行已授权 ActionIntent、返回 ExecutionReceipt；mock adapter 默认 | 不把外部系统事实复制成第二真相；不凭 HTTP 200 推断业务成功 |
| Operations | config、日志、trace、健康/就绪、重启恢复、CORS、shutdown、备份/迁移说明 | 不记录 secret/完整敏感 prompt；不把无认证演示公开成生产安全服务 |

### 2.1 冻结技术基线

- 后端：Node.js `>=22.5.0`、ESM、`node:http`、`node:sqlite`、SQLite WAL；沿用 P0 的零依赖基线。
- 前端：默认原生 HTML/CSS/ESM 与 SVG 关系图；P4 如需图形库，必须单独说明用途、体积、维护/安全影响并获得用户批准，行为契约不随库改变。
- 测试：`node:test`；所有外部 provider 与 connector 默认使用 deterministic mock。
- 单节点 SQLite 是 P2–P6 的明确部署边界，不声称高可用、多主、生产多租户隔离或合规认证。

## 3. 权威对象与最小 schema

### 3.1 类型边界

| 类型 | 是否 actor | 能否成为当前 owner | 能否作 Gate 决策 | 说明 |
| --- | --- | --- | --- | --- |
| `HumanPrincipal` | 是 | 是 | 仅具名且授权时可以 | P1 演示身份为 `demo_unverified`，不是认证身份 |
| `RoutableAgent` | 是 | 是，但必须关联 `accountableHumanId` | 永不可以 | 稳定 ID、责任、排除项、升级条件、上下文和能力均显式 |
| `ExternalSystem` | 否 | 否 | 否 | 外部事实/动作的 source of truth；只通过 adapter 交互 |
| `ControlObject` | 否 | 否 | 否 | department、policy、metric definition、adapter config、图例、feature setting 等 |

客户端“选择了某个角色”只产生 `DemoActorSelection` metadata，不能把 `HumanPrincipal` 变成经过认证的人。

### 3.2 聚合根选择

- `WorkCase` 是业务连续性的唯一聚合根和事件 stream。
- `OrganizationConfiguration` 是版本化配置 stream，保存 principal、Agent、system、authority policy、scenario definition 的引用关系。
- `WorkItem` 不进入 RelayOS canonical schema；外部工单/订单/代码变更/设备任务统一作为 `ExternalRecordRef { systemId, recordType, recordId, observedVersion }`。
- 跨 stream command 必须先固定所依赖的 `configurationVersion`，再验证 WorkCase streamVersion；禁止用万能 organization JSON 聚合全部并发事项。

### 3.3 最小对象字段

下表字段是通用最小集。场景字段只可进入经过 schema 验证的 `scenarioExtensions.<namespace>`，不得改变共同状态机。

| 对象 | 必需最小字段 | 关键约束 |
| --- | --- | --- |
| `WorkCase` | `id, organizationId, scenarioKey, title, status, ownerActorRef, accountableHumanId, acceptedGoalVersion, currentContextVersion, nextAction, streamVersion, createdAt` | owner 只能是 HumanPrincipal/RoutableAgent；Agent owner 必须有具名 accountable human |
| `Trigger` | `id, workCaseId, type, sourceRef, observedAt, dedupeKey, payloadRef` | dedupeKey 在组织/trigger type 范围内幂等；payload 大对象只存引用 |
| `GoalVersion` | `id, workCaseId, version, status, statement, constraints, proposedBy, acceptedBy, evidenceIds, createdAt, acceptedAt` | accepted/superseded 历史不可覆盖；同一 WorkCase 只能有一个 accepted goal |
| `Evidence` | `id, workCaseId, sourceRef, recordRef, observedAt, contentHash, classification, summary, attachedBy` | summary 非事实替代物；来源、版本/观测时间和 hash 必须可审计 |
| `ContextVersion` | `id, workCaseId, version, evidenceIds, purpose, allowedDecisionUses, freshnessPolicy, createdBy, createdAt` | handoff、provider request 与 decision 必须引用具体版本；过期后不可静默沿用 |
| `HumanPrincipal` | `id, displayName, role, organizationId, status` | P1 无认证；事件必须另记 `identityAssurance` |
| `RoutableAgent` | `id, displayName, organizationId, accountableHumanId, responsibility, acceptableOutputs, exclusions, escalationConditions, contextPolicy, capabilities, status` | 不能解决 Human Gate；capability 不等于 authority |
| `ExternalSystem` | `id, displayName, kind, sourceOfTruthFields, adapterId, allowedReadOps, allowedWriteOps, status` | system 不是 Agent；凭据不进入对象或事件 |
| `AuthorityGrant` | `id, principalRef, actions, scope, validFrom, validUntil, grantedBy, reason, status` | command 时间点必须命中有效区间；deny policy 优先；人类不自动拥有 system write |
| `HandoffOffer` | `id, workCaseId, fromActorRef, toActorRef, goalVersion, contextVersion, package, offeredAt, expiresAt, supersedesOfferId` | immutable；只能由当前 owner 发出；package 引用证据、承诺、风险、开放问题 |
| `HandoffAcceptance` | `id, offerId, acceptedBy, acceptedAt, reason, nextAction` | 只能由 offer.to 接受；目标/context/owner 仍匹配；同事务改变 owner |
| `HumanGate` | `id, workCaseId, policyId, question, assignedHumanId, protectedActions, evidenceIds, status, openedAt, resolution` | 只有 assigned HumanPrincipal 可解决；开放 Gate 阻断受保护动作 |
| `ActionIntent` | `id, workCaseId, systemId, operation, inputRef, requestedBy, authorityEvidence, requiredGateIds, idempotencyKey, status, createdAt` | provider 只能建议候选；domain 校验通过后才能成为 authorized |
| `ExecutionReceipt` | `id, actionIntentId, adapterId, externalRequestId, status, externalRecordRefs, resultHash, attemptedAt, completedAt, errorClass` | `succeeded/failed/unknown/rejected`；unknown 先查询再重试；不可伪造成功 |
| `ExceptionRecord` | `id, workCaseId, type, severity, sourceRefs, status, openedAt, resolution` | evidence conflict、provider/connector failure、policy violation、stale context 等统一进入异常语义 |
| `Escalation` | `id, exceptionId, assignedHumanId, reason, dueAt, status, acknowledgedAt, resolvedAt` | 具名 recipient；发送通知不等于被接收/解决 |
| `MetricObservation` | `id, workCaseId, metricKey, category, value, unit, sourceRef, observedAt, window, definitionVersion` | category 必须为 `business/risk/efficiency`；每场景三类齐全 |
| `BusinessEvent` | `eventId, globalSequence, streamId, streamVersion, eventType, eventSchemaVersion, payload, metadata, occurredAt, payloadHash, previousEventHash` | append-only；payload 足以重建；hash/streamVersion 校验失败即 fail closed |
| `ReplayProjection` | `workCaseId, projectionVersion, state, lastGlobalSequence, canonicalStateHash, rebuiltAt` | 可删除并从事件重建；不是独立权威来源 |

## 4. 状态机

### 4.1 WorkCase

| 当前状态 | 允许迁移 | 必要条件 |
| --- | --- | --- |
| `active` | `blocked, completed, cancelled` | blocked 必须关联开放 Gate/Exception/Escalation；completed 必须有结果 evidence 和所需 receipts |
| `blocked` | `active, cancelled` | 所有关联阻断项已解决或具名人类明确取消 |
| `completed` | `closed, active` | closed 需要验证证据、指标观测和无开放 Gate；新证据证明未完成可 reopen 为 active 并留事件 |
| `closed` | 无普通迁移 | 终态；修正只能开新 WorkCase 并引用原 case |
| `cancelled` | 无普通迁移 | 终态；必须有具名授权人与原因 |

handoff 状态不直接充当 WorkCase 状态；UI 可显示 `pending_handoff` 派生标记。

### 4.2 HandoffOffer

`offered -> accepted | rejected | clarification_requested | expired | cancelled | superseded`

- `clarification_requested` 后必须创建引用旧 offer 的新 offer；不能原地改 package。
- accepted/rejected/expired/cancelled/superseded 均为终态。
- 接受 command 与 `owner_changed` 事件必须在同一事务中；任何检查失败均零写入。

### 4.3 HumanGate

`open -> approved | rejected | revision_required | exception_approved | expired | cancelled`

- 终态 resolution 必须有 `decidedBy, rationale, evidenceIds, decidedAt, nextAction`。
- `expired/cancelled` 不等于批准受保护动作。

### 4.4 ActionIntent

`proposed -> authorized -> executing -> succeeded | failed | unknown | rejected | cancelled`

- `proposed` 可以来自人类 command、确定性规则或模型建议的人工/后端采纳；模型响应本身不创建 authorized intent。
- 只有 `authorized` 可进入 adapter；adapter 调用前持久化 intent 和 idempotency key。
- `unknown` 禁止直接重试副作用操作，必须先调用 connector 查询或由具名人类批准补偿方案。

### 4.5 Exception/Escalation

`ExceptionRecord: open -> acknowledged -> resolved | waived`；`Escalation: offered -> acknowledged -> resolved | expired`。`waived` 需要具名 HumanPrincipal、rationale 与 AuthorityGrant。

## 5. 不变量

1. **Accepted Handoff 前 owner 不变。** Offer、发送通知、模型建议、recipient 查看、clarification/rejection 均不能转移 owner。
2. **模型失败/歧义/越权零权威写入。** 允许写入独立的非权威 provider telemetry，但不得追加 WorkCase/Goal/Authority/Handoff/Gate/Action 的 domain event。
3. **运行时 API 结果只是建议。** `AdvisoryResult` 必须标 `authority=none`，任何 apply 都重新经过确定性 command validation。
4. **事件可重放重建状态。** 从空投影按 streamVersion 重放后，`canonicalStateHash` 必须与在线投影相同。
5. **一条权威变化至少一个 BusinessEvent。** event append、projection update、command receipt 同事务成功或回滚。
6. **GoalVersion 不覆盖历史。** 只有明确 accepted 的版本成为当前目标；proposal 不改变 accepted goal。
7. **Gate 只能由具名人类解决。** Agent、ExternalSystem、ControlObject、同名角色或未认证客户端选择均不能满足真实身份要求；P1 仅模拟逻辑。
8. **Capability、Authority、Context 独立。** system write 能力不授予目标修改权；authority 不授予数据访问；context 可见不授予执行权；human 也不自动拥有 system write。
9. **外部动作有意图、有授权、有回执。** 无 succeeded receipt 不得把业务状态标成“外部执行成功”。
10. **外部系统保留事实权威。** RelayOS 只存引用、摘要、hash、版本、意图与回执关系。
11. **配置差异不改内核。** 场景 extension 不得新增专用状态或绕过共同 command。
12. **演示角色不是身份。** 任何 demo command/event/页面必须显示 `identityAssurance=demo_unverified`；不可声称生产授权安全。
13. **关闭后不可变。** closed/cancelled case 不接受普通 mutation；新问题创建新 case 并引用旧 case。
14. **无秘密日志。** API key、token、Authorization、完整敏感材料、完整 prompt/response 不进入日志、event、fixture 或截图。

## 6. 事件与 API 边界

### 6.1 Command envelope

所有权威写命令统一进入 `POST /api/work-cases/{workCaseId}/commands`；建立 case 使用 `POST /api/work-cases`。请求最小 envelope：

```json
{
  "commandId": "cmd-supply-accept-001",
  "idempotencyKey": "supply-accept-001",
  "expectedStreamVersion": 7,
  "configurationVersion": 3,
  "commandType": "handoff.accept",
  "demoActorRef": { "kind": "human", "id": "human-supply-planner" },
  "identityAssurance": "demo_unverified",
  "traceId": "trace-supply-001",
  "payload": {
    "offerId": "handoff-supply-001",
    "reason": "证据、承诺与目标版本完整，可以接续",
    "nextAction": "验证备选供应方案并提交合同 Gate"
  }
}
```

P1/P2 无认证时只接受 `identityAssurance=demo_unverified`，服务端在响应和事件 metadata 中原样保留警示。未来认证层只能替换 principal resolution，不能改变 domain command。

### 6.2 Query 与 advisory API

| API | 语义 |
| --- | --- |
| `GET /health/live` | 进程存活，不访问 provider |
| `GET /health/ready` | SQLite、schema、event/projection 一致性与配置可用；provider/connector 单独报告 degraded，不阻断只读核心 |
| `GET /api/scenarios` | 读取十场景配置摘要和版本 |
| `GET /api/work-cases` | 查询 WorkCase 投影；支持 scenario/status/owner 过滤 |
| `GET /api/work-cases/{id}` | 当前投影、pending handoff、open Gate、metrics 摘要 |
| `GET /api/work-cases/{id}/events?after=` | 按 global sequence 返回业务事件 |
| `GET /api/work-cases/{id}/replay` | 返回从事件构建的 ReplayProjection 与 state hash |
| `POST /api/advisories` | 调用 Mock/Z.AI provider；只返回 `authority=none` 的结构化建议，不调用权威 command |
| `POST /api/work-cases` | 确定性创建 WorkCase，并追加事件/receipt |
| `POST /api/work-cases/{id}/commands` | 唯一共同写入口；按 commandType 校验并 append events |

API 不为十场景增加行业专用 route。大对象用 `ExternalRecordRef`，不经 RelayOS 上传。

### 6.3 共同 commandTypes

`workCase.create`、`workCase.block`、`workCase.complete`、`workCase.close`、`workCase.cancel`、`goal.propose`、`goal.accept`、`evidence.attach`、`context.publish`、`handoff.offer`、`handoff.accept`、`handoff.reject`、`handoff.clarify`、`gate.open`、`gate.resolve`、`action.propose`、`action.authorize`、`action.execute`、`exception.open`、`exception.acknowledge`、`exception.resolve`、`escalation.offer`、`escalation.acknowledge`、`metric.observe`。

### 6.4 共同 eventTypes

command 成功产生过去式事件，例如 `work_case.created`、`goal.accepted`、`evidence.attached`、`context.published`、`handoff.offered`、`handoff.accepted`、`owner.changed`、`human_gate.opened`、`human_gate.resolved`、`action_intent.authorized`、`execution_receipt.recorded`、`exception.opened`、`escalation.acknowledged`、`metric.observed`、`work_case.closed`。事件 payload 必须包含重建所需的最终 typed values，不只保存英文/中文 summary。

### 6.5 错误契约

错误统一为：

```json
{
  "error": {
    "code": "HANDOFF_OFFER_STALE",
    "message": "交接提出后目标或上下文已变化，请重新提出交接。",
    "details": {
      "offerId": "handoff-supply-001",
      "expectedGoalVersion": 1,
      "currentGoalVersion": 2
    },
    "traceId": "trace-supply-001"
  }
}
```

必须稳定覆盖：invalid input、not found、authority denied、Gate blocking、version conflict、idempotency conflict、stale context/offer、provider unavailable/invalid、connector failed/unknown、Origin denied、body too large、event corruption。任何失败响应不得泄露 secret 或原始敏感上下文。

## 7. 场景配置 schema

### 7.1 规则

- `schemaVersion`、`scenarioKey`、`version`、角色/Agent/system refs、trigger policies、Gate policies、metric definitions、extension schema 必须显式。
- core 层 `additionalProperties=false`；extension 必须有 namespace 和独立 schema，禁止自由扩张的 `metadata:any`。
- 配置变更通过独立 configuration stream、preview、具名人类 apply 和版本检查；模型只能提供 candidate patch。
- 场景配置不得声明新 commandType、eventType、state 或 API。

### 7.2 供应链配置示例

```json
{
  "schemaVersion": 1,
  "scenarioKey": "supplyChain",
  "version": 1,
  "displayNameZh": "供应链：采购、物流与异常处置",
  "roles": ["采购", "计划", "仓储", "物流", "财务", "法务", "供应商负责人"],
  "agentProfiles": ["procurementDemand", "supplierRisk", "fulfillmentDiagnosis", "contractEvidence"],
  "externalSystems": ["erp", "srm", "wms", "tms", "contractRepository"],
  "triggerPolicies": [
    { "type": "supplierDelay", "dedupeWindowMinutes": 30, "defaultSeverity": "high" }
  ],
  "gatePolicies": [
    { "policyKey": "contractChange", "assignedRole": "法务", "protectedActions": ["action.authorize", "workCase.close"] },
    { "policyKey": "payment", "assignedRole": "财务", "protectedActions": ["action.authorize"] }
  ],
  "metricDefinitions": [
    { "metricKey": "onTimeInFull", "category": "business", "unit": "ratio", "sourceSystem": "erp" },
    { "metricKey": "unauthorizedPaymentCount", "category": "risk", "unit": "count", "sourceSystem": "erp" },
    { "metricKey": "exceptionResolutionHours", "category": "efficiency", "unit": "hours", "sourceSystem": "relayos" }
  ],
  "extensionNamespace": "scenarioExtensions.supplyChain",
  "extensionFields": ["supplierId", "purchaseOrderId", "shipmentId", "contractVersion", "inventoryNodeId"]
}
```

其余九场景使用 `SCENARIO_MATRIX.md` 已冻结的 extension namespace 与字段；P5 测试验证未知字段、专用状态和专用 route 均被拒绝。

## 8. Provider adapter 与 GLM 双链路

### 8.1 运行时 adapter contract

`AdvisoryProvider.suggest(request, { signal })` 的 operation 只能是：

- `material.extract`
- `context.summarize`
- `conflict.identify`
- `configuration.suggest`
- `action.suggest`

request 必须包含 `providerRequestId, operation, workCaseId, goalVersion, contextVersion, inputRefs, outputSchemaVersion, promptVersion, evaluationVersion, traceId, deadlineMs, dataClassification`。返回必须为：

```json
{
  "authority": "none",
  "status": "advisory",
  "providerId": "mock",
  "model": "deterministic-fixture-v1",
  "outputSchemaVersion": 1,
  "recommendations": [
    {
      "kind": "conflict",
      "summary": "合同版本与采购单金额不一致",
      "evidenceIds": ["evidence-contract-v3", "evidence-po-221"],
      "confidence": 0.92,
      "requiresHumanReview": true
    }
  ],
  "traceId": "trace-provider-supply-001"
}
```

结构校验、evidence reference 校验、权限/作用域检查、版本检查和 domain command 必须发生在 provider 返回之后。provider 不接收数据库写能力。

### 8.2 MockProvider

- P2 起默认 provider；固定 fixtures、可注入 timeout/429/5xx/invalid JSON/ambiguity/unsafe suggestion。
- 所有 P3–P7 自动化测试无需网络、API key 或真实模型。
- `MockProvider` 不是降级后的“假成功”；若生产配置的 provider 不可用，系统返回 advisory unavailable 并保持权威状态不变。

### 8.3 Z.AI General provider

- P3 通过可替换 `ZaiGeneralProvider` 接入 Z.AI General API；endpoint、model 和 API key 只从运行时配置读取，实际值必须在 P3 根据当时官方文档核验。
- 结构化输出必须先通过本地 schema validation；解析失败视为 `PROVIDER_OUTPUT_INVALID`。
- 默认 deadline：抽取/总结 8 秒，冲突/配置/行动建议 15 秒；环境变量只能在 3–30 秒范围内覆盖。
- 只对 network、429、可恢复 5xx 重试 1 次并加 jitter；4xx、schema invalid、ambiguity、policy violation 不重试。
- 同一 provider 60 秒内连续 5 次 transient failure 后熔断 30 秒；half-open 只允许一个探测请求。
- trace 记录 provider/model、prompt/eval/schema version、耗时、token/cost（若 API 提供）、input/output hash、错误类别；不记录 key、Authorization、完整敏感 prompt/response。
- provider failure 可以写入独立 `provider_invocations` telemetry 表，但不得 append domain BusinessEvent；用户可见为 degraded/advisory unavailable。

### 8.4 开发期 GLM-5.3 与产品运行时严格分离

| 链路 | 允许 | 禁止 |
| --- | --- | --- |
| 开发期 | 通过已配置的 `glm53-coding-agent` / ZAI Coding Plan，在冻结文件边界和客观测试下编码或只读审查；Codex 独立验收 | 让 GLM 决定架构、视觉、产品哲学、接口或最终 Gate；把 GLM 设为主控制器 |
| 产品运行时 | `ZaiGeneralProvider` 通过 Z.AI General API 提供 advisory；可被 Mock/其他 provider 替换 | 默认使用 Coding Plan 专用 endpoint/key；将开发期凭据复制到项目；让模型直接写权威状态 |

两条链路不得共享 adapter、环境变量名、凭据文件或调用日志。

## 9. Anthropic/Claude 能力的中国企业本地化翻译

这是一组产品能力映射，不是供应商依赖或品牌复制：

| 模型/Agent 能力 | RelayOS 企业对象 | 本地化控制 |
| --- | --- | --- |
| 长上下文与记忆 | `Evidence + ContextVersion` | 来源、用途、权限、分类、时效、版本；不把无限记忆当权威 |
| Structured output | `AdvisoryResult` | 本地 schema validation、证据引用、`authority=none` |
| Tool use | `ActionIntent + ExecutionReceipt` | 确定性授权、Human Gate、幂等、外部系统回执 |
| Multi-agent / subagent | `RoutableAgent + Accepted Handoff` | 稳定 ID、具名 accountable human、责任/排除/升级条件；接受后转移 |
| Human-in-the-loop | `HumanGate` | 具名 HumanPrincipal、temporal authority、rationale、证据和受保护动作 |
| Agent trace | `BusinessEvent + ReplayProjection` | 以业务目标、证据、权威、handoff、动作与指标重放，而非只看模型 token trace |
| Coding/automation skills | provider/connector adapter | 能力可替换；domain kernel 不绑定 provider 或工具生态 |

## 10. ExternalSystem adapter

统一接口：

- `readEvidence(query, context) -> ExternalEvidencePage`
- `execute(actionIntent, context) -> ExecutionReceipt`
- `getExecutionStatus(externalRequestId, context) -> ExecutionReceipt`
- `health() -> AdapterHealth`

约束：

- 每个 adapter 显式声明 source-of-truth fields、allowed read/write operations、idempotency support、timeout、retry safety 和 data classification。
- P2–P5 默认 `MockExternalSystemAdapter`；真实 connector 不属于 P1，新增时必须单独授权。
- 写操作必须携带 RelayOS `actionIntentId` 与 idempotency key；adapter 将外部 request ID 返回。
- HTTP success 但业务状态未知时 receipt 为 `unknown`；禁止标 succeeded。
- connector secret 只来自 runtime secret env/store，不进入 config/event/log。

## 11. 持久化、事件与 replay

### 11.1 SQLite 表边界

| 表 | 权威性 | 用途 |
| --- | --- | --- |
| `event_streams` | 权威索引 | streamId、type、currentVersion、lastHash |
| `business_events` | 唯一权威业务变化 | 全局 sequence、streamVersion、typed payload、metadata、hash chain |
| `command_receipts` | 权威幂等证据 | command/idempotency hash、response、createdAt；成功重试先于版本冲突返回原结果 |
| `configuration_versions` | 权威配置投影 | 已接受的场景/组织配置版本；来源仍为 configuration events |
| `work_case_projections` | 可丢弃投影 | 当前查询与图数据；可从 events 重建 |
| `projection_checkpoints` | 可丢弃优化 | rebuild 起点、last sequence、state hash |
| `provider_invocations` | 非权威 telemetry | provider trace/hash/latency/error；绝不参与 domain replay |

`ExecutionReceipt` 以 BusinessEvent 持久化并进入 WorkCase 投影；不得只存在 connector log。

### 11.2 事务顺序

`BEGIN IMMEDIATE -> existing idempotency receipt lookup -> streamVersion/configVersion check -> deterministic domain validation -> append typed events -> update stream version/hash -> apply projection -> insert command receipt -> COMMIT`。

任一步失败全部回滚。P0 已验证的“receipt lookup 早于 stale version check”顺序保留。

### 11.3 重放验收

1. 关闭服务并复制数据库备份；
2. 删除可丢弃 projection/checkpoint 数据，不删除 events/receipts/config events；
3. 从 streamVersion 1 顺序校验 hash 与 schema 并重建；
4. 比较每个 WorkCase `canonicalStateHash`、owner、acceptedGoalVersion、pending handoff、open Gate、ActionIntent/Receipt、metrics；
5. 任一未知 event schema、断号、hash 不匹配或非法迁移必须 fail closed，服务 readiness 为 degraded/error，禁止用旧快照继续写。

## 12. 前端信息架构

### 12.1 1920×1080 默认布局

- 顶栏：产品一句话、当前场景、数据状态、`演示角色（未认证）`、健康/degraded 状态。
- 主区默认 76% 为连续性关系图，24% 为 inspector；timeline/replay、待接受交接和 Human Gate 使用可展开 drawer，不永久挤压图。
- 第一次打开显示 3 句 onboarding：图表达“谁/Agent/系统围绕哪个 WorkCase 协作”；实线 owner、虚线 offered handoff；接受后 owner 才改变。

### 12.2 图对象和编码

- 节点：WorkCase、HumanPrincipal、RoutableAgent、ExternalSystem；department 只作分组，不伪装成 Agent。
- 边：current owner、accountable human、authority、context/read、action/write、handoff offered/accepted。
- 黑白灰：状态通过填充灰度、边框粗细、实线/虚线、图标和文字共同表达，不只依赖颜色。
- 必须支持 zoom 25%–200%、drag canvas/node、Fit、reset、聚焦节点、keyboard focus、明确图例、reduced-motion。
- offered handoff 必须显示“待接受，owner 未变”；open Gate 必须显示具名 assignee 和受保护动作；外部 action 必须显示 receipt status。

### 12.3 辅助视图

- Inspector：当前目标版本、owner/accountable human、context/evidence、权限、next action。
- Pending Handoff：package、版本、accept/reject/clarify；按钮权限来自后端投影，不由前端推断。
- Human Gate：问题、证据、具名 assignee、protected actions、resolution。
- Replay：按业务语言显示 Trigger→Goal→Evidence→Handoff→Gate→Action/Receipt→Metric，不只显示技术 trace。
- 状态必须覆盖 loading、empty、error、degraded provider、version conflict、stale view、success、offline/reconnect。

## 13. 演示角色选择语义

- UI 标签固定为“演示角色（未认证）”，页面常驻说明“仅用于演示权限逻辑，不是登录或安全边界”。
- 选择结果只改变 command 中的 `demoActorRef`；服务端仍执行 domain authority 模拟。
- event metadata 记录 `identityAssurance=demo_unverified`；Replay 不得写“已验证由某真实人员操作”。
- 默认 bind `127.0.0.1` 且同源；若部署到共享网络，必须在 README/页面顶部显示无认证风险，P7 不得给出生产安全通过结论。

## 14. 观测与部署边界

### 14.1 配置

必须支持并文档化：`HOST`、`PORT`、`RELAYOS_DB_PATH`、`RELAYOS_SCENARIO_DIR`、`RELAYOS_DEMO_MODE`、`CORS_ALLOWED_ORIGINS`、`ADVISORY_PROVIDER`、`ZAI_BASE_URL`、`ZAI_MODEL`、`ZAI_API_KEY`、provider deadline/breaker 参数、log level。`.env.example` 只能用明显占位值，真实 secret 不落盘/不提交。

### 14.2 日志与 trace

- JSON structured log：timestamp、level、serviceVersion、traceId、commandId、workCaseId、eventIds、streamVersion、provider/adapter status、latency、errorCode。
- 默认 redact Authorization、cookie、API key、token、完整 prompt/response、Evidence 正文、个人敏感字段。
- provider trace 与 domain event 分表；技术 trace 不能替代业务 replay。

### 14.3 运行行为

- Origin/CORS 在 body read 前校验；默认只允许 same-origin，显式 allowlist 必须精确 scheme+host+port，不使用 `*`。
- `/health/live`、`/health/ready` 分离；provider 故障可降级 advisory，但不破坏权威读取/确定性命令。
- SIGINT/SIGTERM：停止接收新 command，等待 in-flight 事务和 connector deadline，checkpoint WAL，关闭 DB，再退出；超过 10 秒以非零退出并记录未完成 actionIntentId。
- 启动时运行 schema/migration preflight、event tail/hash 检查、projection version 检查；失败时只读或拒绝启动写路径。
- P6 交付为单节点 Node service + SQLite volume + reverse proxy/静态服务说明；备份、恢复和升级回滚必须实测。无认证，因此不得标“生产安全就绪”。

## 15. 当前 RelayOS P0 代码审计

审计根：`C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0`。2026-08-26 本轮实际运行 `npm.cmd test` 为 **48 tests passed、0 failed**；`npm.cmd run build` 为 **Build check passed: 13 JavaScript files, 4 static assets, 5 templates**。这只证明 P0 契约，不证明十场景/P1 架构已实现。

### 15.1 直接复用的设计与窄代码种子

| 证据路径/符号 | 真实代码事实 | P1 处置 |
| --- | --- | --- |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\store.js:13` `RelayStore` | `node:sqlite`、WAL、foreign_keys、busy_timeout、synchronous FULL | 复用连接/PRAGMA/关闭模式；表 schema 重建 |
| 同文件 `RelayStore.mutate`（172–233） | BEGIN IMMEDIATE；幂等 receipt 先于 version check；state/event/receipt 原子回滚 | 保留事务顺序并改为 event append + projection |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:228` `offerHandoff` 与同文件 `:278` `respondHandoff` | offer 时 owner 不变；仅 recipient accept 且 goal/owner 未变才转移 | 复用语义和回归用例；改为 immutable offer/accept events + ContextVersion |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:329` `openHumanGate` 与同文件 `:371` `resolveHumanGate` | Gate 绑定具名 human；只有 assigned human 可解决；protectedActions 阻断 | 复用语义；补 temporal authority、完整 Gate 状态和 demo identity 标记 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:148` `proposeGoal` 与同文件 `:203` `reviseGoal` | proposal 不覆盖 accepted goal；revision 产生新版本 | 复用不变量；事件 payload 必须足以重放 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:416` `attachEvidence` | 校验 source、provenance、freshness、Agent context scope | 复用校验思想；Evidence/ContextVersion 拆分且 immutable |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\service.js:97` `previewConfiguration` 与同文件 `:131` `applyConfiguration` | preview read-only；签名 token；apply 在事务中重新解析并校验 baseVersion/hash | 复用 preview/apply 模式；model output 只能 candidate，apply 必须 deterministic |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\server.js:46` `enforceSameOrigin` 与同文件 `:148` `createRelayServer` | API 先检查 Origin，再 route/read body；1MB body 限制 | 复用顺序；扩展 exact allowlist、live/ready、structured logs |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\index.js:31` `shutdown` | SIGINT/SIGTERM 关闭 server 后关闭 store | 复用基本模式；补 deadline、in-flight、WAL/checkpoint 证据 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\errors.js:1` `AppError`、`:17` `errorPayload` | 稳定 code/status/details 边界 | 复用错误形状并改中文优先 message + traceId |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\test\core.test.js`、`C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\test\http.test.js` | 覆盖 WAL/restart、幂等、原子回滚、handoff、Gate、authority、Origin | 迁移为 P2 合同回归基线，不以原测试通过替代新 Gate |

### 15.2 必须重构

| 证据路径/符号 | P0 限制 | P1 必须变更 |
| --- | --- | --- |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\store.js:26` `organizations.state_json` | 整个组织/全部 WorkCase 是单 JSON 快照和单 version；产生无关事项并发冲突 | WorkCase/config 分 stream；BusinessEvent 为权威，projection 可重建 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\store.js:35` `business_events` + `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:73` `makeEvent` | event 主要是 summary/reason/details；缺少完整 typed transition payload/hash chain | 新 event schema 存重放所需字段、schema version、streamVersion、payload hash |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:682` `projectReplay(state, events)` | replay 读取当前 state 再装 timeline，不能仅从事件重建历史状态 | 重写为纯 event reducer；验证空投影重建 hash |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:729` `validateState` | 只检查 schemaVersion、ID、owner/accepted goal 等少量关系 | 覆盖所有状态机、不变量、refs、temporal grant、extension schema |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:54` `hasAuthority` | AuthorityGrant 无 validFrom/validUntil；admin blanket 权限过宽 | temporal authority；deny precedence；配置化 admin；事件保留决策时授权证据 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:458` `agentWriteCapability` | human 直接返回 true，未检查 system write capability | 人类也必须有明确 action authority/capability/Gate；无默认写权 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\domain.js:468` `advanceWorkCase` | externalAction 是 `mode=simulated` 的附属 payload；没有 ActionIntent/ExecutionReceipt 状态机 | 拆为 action.propose/authorize/execute/receipt；mock connector 也产真实 receipt 对象 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\templates.js:44` `definitions`、`:399` `createTemplateState` | 五模板内嵌完整 organization state；不对应新十场景 | 转为十个 versioned scenario config + fixtures；只保留共享 kernel |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\nlu.js:778` `parseNaturalLanguage` + `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\intent-provider.js:7` `RulesIntentProvider` | 大型 rules-v1 macro/parser 与 domain config op 紧耦合 | 重构为 `RuleBasedAdvisoryProvider` 或仅保留 deterministic demo parser；输出仍 authority=none |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\src\server.js:67` `routeApi` | 单文件 routes；无 structured logs、readiness、provider/connector 边界 | 拆 API/application 责任；保持 node:http 可测试边界 |
| `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\public\app.js`、`C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\public\styles.css`、`C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0\public\index.html` | P0 中文前端验证旧五模板，不满足 70%–80% 连续性关系图与新对象 | P4 按本契约重做信息架构；可复用中文 display mapper 思想，不沿用旧布局结论 |

### 15.3 删除或禁止沿用

- 禁止把 P0 `data/relayos.db` 直接当新产品数据库；如需示例，只能经显式 importer 生成新 typed events，并通过 replay 验证。
- 禁止继续把 `organizations.state_json` 或任何 projection snapshot 当唯一权威真相。
- 禁止把 `projectReplay` 这种“当前 state + event timeline”称为 event replay 重建。
- 禁止把请求中的 `actorId/demoActorRef` 当登录身份或安全授权证明。
- 禁止沿用“人类天然可写任意系统”的 `agentWriteCapability` 逻辑。
- 禁止在运行时使用 ZAI Coding Plan endpoint、开发凭据或 `glm53-coding-agent` adapter。
- 禁止模型输出直接进入 `applyConfigPatch`、domain mutation、owner/Gate/Authority 更新。
- 禁止将五个 P0 template 复制成十个行业 template 文件并形成十套状态。
- 禁止把 simulated externalAction 或 HTTP 200 当作成功 `ExecutionReceipt`。
- 禁止把旧 P0 README 的“已证明”范围扩大到十场景、真实 connector、真实模型、生产部署或认证安全。

## 16. 迁移种子判断

结论：**保留行为契约，重建权威数据骨架。**

- 可迁移：Node/SQLite/WAL 基线、transaction/idempotency 顺序、AppError、Accepted Handoff、GoalVersion、具名 Gate、context/capability/authority 分离、preview/apply、Origin-before-body、graceful shutdown、现有回归测试思想。
- 必须新建：event-sourced schema/reducer、per-stream concurrency、ContextVersion、ActionIntent/ExecutionReceipt、Exception/Escalation、MetricObservation、provider/connector adapter、十场景 config、前端 IA、观测/部署证据。
- 不迁移为权威：旧 DB、五模板状态、旧 replay 投影、客户端 actor 身份假设、模拟 externalAction 成功语义。

进入 P2 前，`DELIVERY_GATES.md` 的 P2 command/test 契约必须逐项落地；任何实现与本文件冲突时先停，不由编码者自行发明新架构。
