# B0 合成事件示例：差异输入 → 四域往返 → 人纠偏 → 版本接续（工程 Candidate，非已接受 schema）

Rev1（2026-09-06）：按 B0_CODEX_REVIEW 第 2/4 项修订——商务 packet 正式化措辞、派发事件携带 packet 全文（哈希仅完整性辅助）、补受影响/未受影响对照轨迹。

用途：给 B0_INTERFACE_CANDIDATE.md 的第 4 步提供可评审的具体示例。全部合成数据，不实现业务模型，不改四域制度规则；演示案例复用现有 demo seed 的 evidenceId 命名习惯（ev-upstream-context 等）。

## 1｜事件与四个 packet（同一事实引用、不同职责切片）

事件：`evt-2026-0001`「新客回租申请包到达」（合成：某四足机器人企业申请 500 万设备回租）。

共享事实引用（四个 packet 完全一致，版本化）：`facts[]` 指向同一 contextVersion 的事件引用，例如：

```json
{
  "eventId": "evt-2026-0001",
  "caseId": "demo-sme-robot-500w",
  "contextVersion": "1.0",
  "sharedFacts": [
    { "ref": "ev-upstream-context", "kind": "upstream_context", "verificationStatus": "claimed" },
    { "ref": "ev-financial-statement", "kind": "financial_statement", "tags": ["revenue_declining"] },
    { "ref": "ev-contract-draft", "kind": "contract_draft", "amountCny": 5000000 },
    { "ref": "ev-asset-history-feedback", "kind": "asset_history_feedback" }
  ]
}
```

四个 packet 的差异化字段（结构相同、内容按职责裁剪——不是同一提示词换角色名）：

```json
{
  "to": "agent-policy",
  "responsibility": "政策准入：已知事实是否触发硬管控/灰区/复议路径",
  "taskGoal": "产出准入意见 Candidate 与所需补件清单",
  "relevantFacts": ["ev-upstream-context"],
  "focusHints": ["准入硬管控命中检查", "灰区升级为复议候选的条件"],
  "allowedActions": ["reply", "request_input", "submit_candidate"],
  "outputConstraints": { "artifactKind": "policy-opinion-candidate", "maxRounds": 3 },
  "dependencies": [],
  "authority": "none"
}
```

```json
{ "to": "agent-credit", "responsibility": "信审一致性：经营/税票/流水/负债逻辑互证",
  "relevantFacts": ["ev-financial-statement", "ev-contract-draft"],
  "focusHints": ["营收下滑与合同金额张力", "偿债覆盖测算框架"],
  "taskGoal": "产出矛盾图与核验问题清单 Candidate", "dependencies": [], "maxRounds": 3 }
```

```json
{ "to": "agent-commerce", "responsibility": "商务条件：已确认风险落到合同/担保/起租条件",
  "relevantFacts": ["ev-contract-draft"],
  "focusHints": ["与信审矛盾对应的前提条件草案"],
  "taskGoal": "产出商务条件草案 Candidate（仅准备性协作；正式化另行依赖信审/政策的有效 Human Decision/Receipt，不因候选齐备自动推进）",
  "dependencies": [{ "kind": "collab_task", "id": "task-credit-001", "note": "collab 依赖只支持提前准备，不解锁正式步骤" }], "maxRounds": 2 }
```

```json
{ "to": "agent-asset", "responsibility": "资产：租赁物真实性/权属/价值可解释",
  "relevantFacts": ["ev-asset-history-feedback"],
  "focusHints": ["回租设备采购真实性与权属链核对清单"],
  "taskGoal": "产出资产核对问题清单 Candidate", "dependencies": [], "maxRounds": 2 }
```

差异化的可验证断言（B1 测试 1 对应）：`relevantFacts` 集合互不相同且都是 sharedFacts 子集；`responsibility/taskGoal/focusHints` 两两不同；`sharedFacts` 四份逐字节一致。

## 2｜往返交流与关联链（A2A 映射：Task + Message,同 taskId/contextId 续发）

```json
{ "kind": "message", "messageId": "msg-0042", "role": "agent",
  "taskId": "task-credit-001", "contextId": "evt-2026-0001", "sender": "agent-credit",
  "parts": [{ "type": "text", "text": "追问：合同金额 500 万与营收下滑口径矛盾，请业务确认定价依据。" }],
  "referenceTaskIds": ["task-business-000"] }
```

业务协调 Agent（Control，非第五域、authority=none）把追问转为人可读的待办；人（具名 actor）经既有命令边界补充事实后，协调 Agent 以同 `taskId+contextId` 续发输入——对应 A2A INPUT_REQUIRED「interrupted state」语义，续跑由应用层实现。

## 3｜人纠偏 → 新版本 → 旧结果隔离 → 接续

```json
{ "kind": "correction", "correctionId": "corr-001", "by": "actor-credit-zhang", "at": "2026-09-06T10:00:00Z",
  "appliesTo": { "contextVersion": "1.0", "taskIds": ["task-credit-001", "task-commerce-001"] },
  "content": "定价依据应按不含税口径复核；信审 packet 的测算框架改用 2025 版模板。",
  "newContextVersion": "1.1",
  "effect": "受影响任务停止旧版本推进并转 input-required；未受影响的 policy/asset 任务保持 working；旧版本晚到的 task-credit-001 结果标记 superseded 并保留原始证据" }
```

事件轨迹（候选事件类型，全部走 v4life 事件账本，append-only；Rev1：派发/重派事件携带 packet 全文，哈希仅作完整性与去重辅助、不是恢复源）：

```
seq n+0  COLLAB_EVENT_OPENED        {eventId, caseId, contextVersion:1.0}
seq n+1  COLLAB_TASK_DISPATCHED     {taskId:task-policy-001, packet:{全文：sharedFacts+差异化字段}, packetHash(辅助), inputVersion:1.0}   (×4)
seq n+2  COLLAB_MESSAGE_APPENDED    {messageId:msg-0042, 正文parts, taskId, replyTo}                     (往返若干)
seq n+3  COLLAB_TASK_INPUT_REQUIRED {taskId:task-credit-001}
seq n+4  COLLAB_CORRECTION_RECORDED {corr-001, byHuman, appliesTo:{v1.0, [task-credit-001, task-commerce-001]}, 纠偏全文, newContextVersion:1.1}
seq n+5  COLLAB_TASK_SUPERSEDED     {taskId:task-credit-001, inputVersion:1.0, 判定:appliesTo命中, keptArtifact:art-017}
seq n+6  COLLAB_TASK_REDISPATCHED   {taskId:task-credit-001, packet:{全文 v1.1}, packetHash(辅助), inputVersion:1.1}
seq n+7  LATE_RESULT_ISOLATED       {taskId:task-credit-001, inputVersion:1.0, 判定:任务∈appliesTo, quarantined:true, traceableTo:art-019}
seq n+8  (对照) 政策/资产未受影响    {taskId:task-policy-001/task-asset-001, inputVersion:1.0, 判定:∉appliesTo 且 effectiveDependencies/relevantFacts 未被改写 → carried_forward 有效, provenance:"corr-001 核对"}
```

隔离/保留语义候选（Rev1 对齐 INTERFACE §4 任务级失效判定）：晚到结果 `superseded` 须满足任务 ∈ appliesTo、effectiveDependencies 被判失效、或 relevantFacts 被改写之一；**仅全局 contextVersion 变旧不构成失效**——未命中条件的旧版本结果 `carried_forward` 保持有效并入投影。`superseded` 结果不进入当前上下文投影、不触发依赖推进、保留 artifact 与来源链可追溯；`carried_forward` 结果保留原 inputVersion 与来源链并注明核对来源。正式推进仍只经既有 Human Gate 命令：candidate_ready 与四域候选齐备都不产生 Receipt，商务条件正式化依赖信审/政策的有效 Human Decision/Receipt，候选齐备而无 Receipt 时正式推进请求一律拒绝（Agent 结果恒为 Candidate，authority=none 不变）。

## 4｜候选事件类型清单（全部 additive、CANDIDATE、默认关闭）

`COLLAB_EVENT_OPENED / COLLAB_TASK_DISPATCHED / COLLAB_MESSAGE_APPENDED / COLLAB_TASK_STATE_CHANGED / COLLAB_TASK_INPUT_REQUIRED / COLLAB_CORRECTION_RECORDED / COLLAB_TASK_SUPERSEDED / COLLAB_TASK_REDISPATCHED / COLLAB_ARTIFACT_PROPOSED / LATE_RESULT_ISOLATED`

均沿用 P1 扩展先例：新事件类型 + additive 命令族 + `collabSemantics: 'off'|'demo'` 式闸门 + 深克隆投影 + replay 同构（engine applyEvent 与 rebuildProjection 成对）。
