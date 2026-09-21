# CONTRACT · R2-03 材料scope贯穿模型调用与回执摘要（内部最小契约，冻结）

- 任务书：docs/v0.4/tasks/ZCODE_R2_03.md
- 日期：2026-09-21
- ownership（本任务可写）：`Back/Edge/src/assistant-model.mjs`、`Back/Edge/src/assistant-decisions.mjs`；新测试 `Back/Edge/test/v04-model-scope*`；报告本目录。
- 只读依赖（零改动，开工/收工 hash 见 sha256-*.txt）：`assistant-evidence-scope.mjs`、`assistant-evidence-provider.mjs`、`assistant-evidence.mjs`、`assistant-receipts.mjs`、`Back/B/src/transport/glm.mjs`、`server.mjs`、`decision-feedback-store.mjs`。
- 输入稳定性：02路（scope/provider）与03路（receipts/model/decisions 基线）报告记录的全部输入 hash 与开工时逐字节一致，方可动工；实际核验通过。

## 1. 参数流（决策分析路径，唯一本次接通的模型调用入口）

```
POST /api/jw/v2/[actions/]customers/:id/assistant/decisions
  body.materialScope?: { artifactIds: string[] }        ← 唯一新增请求字段（可选，缺省=旧语义）
  → assistant-decisions 形状门：非对象/数组/缺artifactIds/含非非空字符串元素
      → 400 INVALID_MATERIAL_SCOPE（进入即拒：零 Connectors、零模型出站，不写决策仓库）
  → evidence({ snapshot, tenantId, customerId, revision, scope: {artifactIds} | undefined })
      scope=undefined → provider legacy 全量语义（02路契约，行为与改动前逐字节一致）
  → provider（02路，只读复用）：canonical 去重排序 + 授权/完整性失败关闭
      → pack.selection = { mode:'explicit', artifactIds(升序去重), summary=sha256 }
  → context.evidencePack.selection → baseHash=contextHash(context)（决策仓库幂等基线）
      且 → identity.context / identity.contextHash（回执身份）→ requestId
  → model.observe：发送前独立复核 selection（见 §3），缺省 selection 走原路径
```

## 2. decisions 层规则（assistant-decisions.mjs）

1. `materialScope` 缺省/undefined：全部行为与改动前一致（调用 evidence 不带 scope 键；旧回执身份可复算，不因升级重复出站）。
2. 形状门只做**形状**校验（类型），语义校验（空集/越权/上游缺件）归 provider 精确错误码，不重复发明。
3. `scope` 经闭包进入 `authorized()`，其全部再入（respond、checkCurrent、finish sameBasis）使用同一 scope——同一请求内 basis 一致，不因重读漂移。
4. feedback 路径：形状非法同样 400（失败关闭一致）；形状合法的 scope 参与 basis 重算，与既有决策集基线不符即按既有 `DECISION_STALE` 语义拒绝（不扩权、不忽略）。
5. 证据层错误透出：provider/scope 抛出的 `EVIDENCE_*` 错误以 `422 {ok:false, error:<码>, detail?}` 如实响应，不再并入 `DECISION_UNAVAILABLE`（`EVIDENCE_UNAVAILABLE` 既有 422 语义不变）；其余错误映射不变。全部此类失败发生在模型出站之前。

## 3. model 层规则（assistant-model.mjs，observe 签名不变）

显式包（`context.evidencePack.selection !== undefined`）在既有身份校验之外增加三条发送前校验，任一不满足即确定性 failed（零出站、零 claim/intent 残留）：

| # | 规则 | 失败码 |
|---|---|---|
| M1 | pack hash 复算**排除 selection**（与 prepareEvidence 哈希基一致）；selection 缺省时复算输入与改动前逐字节相同 | `EVIDENCE_IDENTITY_MISMATCH` |
| M2 | selection 三元组必须与 scope 模块同一版本化算法（`normalizeSelection`）对该 artifactIds 的重算结果 deepEqual（mode='explicit'、canonical 升序去重、summary 一致）；形状非法透出 scope 模块精确码 | `EVIDENCE_IDENTITY_MISMATCH` / `EVIDENCE_SCOPE_*` |
| M3 | pack 内全部 snippet.artifactId ∈ selection.artifactIds——未选材料不得借道进入模型上下文 | `EVIDENCE_IDENTITY_MISMATCH` |

`validate_input` 节点（发送前最终一致性）同步执行 M1/M2。校验位置在既有首段 try（claim/intent 之前），失败不落任何围栏残留。

**身份绑定机制**（不新增字段）：`selection ∈ context.evidencePack ⊂ identity.context ⊂ digest(identity)`，且 selection ∈ baseHash。因此：同选择同上下文 → 同 requestId（重放零出站）；乱序/重复输入经 provider canonical 化后与干净输入**同一** requestId；不同选择（或选择 vs legacy）→ 不同 requestId，绝不命中同一旧输出。

## 4. 兼容性与权限语义（保持，不改约）

- **缺参兼容**：无 materialScope 时 decisions/model 行为与改动前一致；旧回执可复算（M1 保证复算输入逐字节不变）。既有回归套件全绿为验收基准。
- **未知围栏**：同 operationId 未知后重试走回执围栏零出站；pending 未决时换 operationId（含换 scope）→ 409 `DECISION_PENDING` 零出站；pending 重试换 scope 使用**冻结的 pending.context**（原 scope）重放，不重定向新证据——scope 变化不构成绕过。同 operationId 完成后换 scope 重试 → 409 `IDEMPOTENCY_CONFLICT` 零出站（不同材料选择永不命中同一旧输出）。
- **合法独立新任务**：仓库无 pending 时，新 operationId（同或不同 scope）= 新身份 = 允许新出站（D1 现行契约，03路已锁，本路不改不裁）。
- operation/principal/customer/currentness 既有语义不变；checkCurrent 经 authorized() 以同一 scope 重验。

## 5. server 串行集成最小字段映射（本任务**不实施**，不抢写入口）

观察（observe/attachEvidence）路径仍为旧调用。未来接线只需透传、不发明默认值：

```js
// server.mjs attachEvidence 未来形态（伪代码，本任务未写）：
const scope = body.materialScope === undefined ? undefined
  : { artifactIds: body.materialScope.artifactIds };   // 形状非法由 provider 失败关闭
target.evidencePack = await assistantEvidence({ snapshot, tenantId, customerId, revision, scope });
```

决策路径的 body 解析本就在 assistant-decisions.mjs（本任务 ownership）内，故该入口已由本任务接通；`server.mjs` 零改动。

## 6. 错误码一览（本任务新增/透出部分）

| 码 | 层 | 触发 | HTTP |
|---|---|---|---|
| `INVALID_MATERIAL_SCOPE` | decisions | materialScope 形状非法 | 400 |
| `EVIDENCE_SCOPE_INVALID/EMPTY/UNAUTHORIZED/INCOMPLETE` | provider→decisions | 形状语义/空集/越权/上游静默缺件（透出精确码+detail） | 422 |
| `EVIDENCE_IDENTITY_MISMATCH` | model | selection 篡改/不一致/含未选片段（发送前） | decisions 侧经既有 DECISION_SEND_UNKNOWN 之外路径不适用（model 直返 failed） |

## 7. 政策歧义（只报不发明，交 CTRL）

1. **未知 pending 的既有限制**：未知终局后该 operationId 永久 pending，阻塞同 scope（客户×principal×assistant）的一切新 operation（含不同 scope），与 03路 D1 范围锁同源；本路验证围栏成立并如实呈报，不发明自动解除。
2. **pending 重试换 scope 被静默忽略**（冻结上下文胜出）：不冲突、不报错、按原 basis 重放。是否应升级为显式 409 属政策，未改。
3. **材料失效的时序后果**：显式选择中任一材料被取代后，该选择的后续请求 422 失败关闭（永久，取代不可逆）；已完成决策集按既有 current=false 失效投影，不冒充成功。
