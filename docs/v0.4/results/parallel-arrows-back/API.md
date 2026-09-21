# 并行专业流程接口（隔离运行版）

2026-09-21；替代 arrow-wiring-back 的第一列接口能力说明。仅本包隔离启动脚本注入完整 adapter；共享默认启动行为没有切换。

当前入口见 RUNTIME.json，初次固定对接 URL 为 http://127.0.0.1:62032 。同源托管现有 Front/dist，前端资源由 Front writer 管理。本包不修改页面或新增执行按钮。受控身份目录中选择“隔离演练 · 五专业审核员（测试身份）”，principalId=arrow-reviewer；各单专业测试身份用于权限反例。服务身份不会列入用户选择目录。

## 路由与执行

| HTTP | Edge 路径 | 作用 |
| --- | --- | --- |
| GET | /api/jw/v2/arrow-cases | 当前身份获准的稳定三案例映射，不按名称或数组次序猜客户 |
| GET | /api/jw/v2/customers/:id/advance-plan?domain=business | 最新计划、版本、可执行性及 requiredDecision |
| POST | /api/jw/v2/actions/customers/:id/advance-rounds | 按计划启动所有材料依赖就绪且调用者/配置服务有对应角色的专业分析 |
| GET | /api/jw/v2/customers/:id/advance-rounds | 全部专业当前和历史轮次，按 attempt 降序 |
| GET | /api/jw/v2/customers/:id/advance-rounds?domain=business | 左回看对应专业，仅查询，不执行 |
| GET | /api/jw/v2/customers/:id/advance-rounds/active | 未决任务；运行实例重启后持久未决显示 unknown，不重发 |
| GET | /api/jw/v2/customers/:id/advance-rounds/by-request/:requestId | 原请求恢复 |
| GET | /api/jw/v2/customers/:id/advance-rounds/:roundId | 指定专业轮次和同版本视图 |
| POST | /api/jw/v2/actions/customers/:id/advance-rounds/:roundId/decision | 用户明确选择后调用既有采用/拒绝命令 |

A 对应 /api/v2/customers/:id/...，不含 actions。沿用现有会话、同源 CSRF 和 A 每次权限检查。每次 POST 新 requestId；网络失败恢复原 ID，不自动换 ID。请求字段严格白名单。

推进请求原样复制 plan 的 domain/planId/planHash/expectedVersion/roundNo，actionIds=plan.allowedActions.map(x=>x.actionId)，附 requestId。当前唯一 actionId/commandKind 为 columns.evaluate。available=false 时展示 reason：如 ROUND_UNRESOLVED、HUMAN_SELECTION_REQUIRED、CUSTOMER_REVENUE_REDLINE、CASE_COMPLETED、CREDIT_REJECTED。已有 completed 且依据仍有效的列可复用，无新分析费用或结果写入。

首次 POST 返回 202 并包含 receipt，后端自动执行就绪专业；前端自动 GET 恢复并更新非当前专业。queued 在 receipt 表示 accepted，陈旧表示 needs_reassessment；domain 列表保留底层 queued/stale/stopped。后台登记 running 有实际 A analysis_runs，另有 worker 内真正开始/完成时间与 threadId；实际重叠证据见 PARALLEL_EVIDENCE.json。

## 人类选择的稳定接线

本轮是采用专业意见，不是信用额度批准。没有逐字段新增确认，也没有自动采纳新候选。完成分析且资料充分时 requiredDecision 返回 roundId/resultId/choices；choices 为 adopt、set_aside，信审另有 reject。应由当前列已有候选选择交互触发，不新增技术执行/刷新按钮，不把默认推荐当用户确认。

```json
{
  "requestId": "<new uuid>",
  "decision": "adopt",
  "resultId": "<requiredDecision.resultId>",
  "expectedVersion": 17,
  "rationale": "<用户实际选择说明>"
}
```

expectedVersion 是所选 receipt.version（数字），不同于推进 plan.expectedVersion（对象）。adopt/set_aside 实际调用 kernel.v2.adoptDomainOpinion；business 映射缺漏已按单独授权补齐，其他角色不能伪报 business，service 不能代替人类采用。reject 仅信审角色，实际 createAssessment → submitCandidate → submitForReview → decideAssessment(reject_assessment)，再追加本流程拒绝/归档事件；不产生正式额度批准。

selection={decision,candidateId,eventId,by,actor,at,rationale,result}。candidateId 是被采用的 A package_domain_results.result_id；eventId 是真实 arrow_events/outbox_events 中 COLUMN_HUMAN_DECISION 的 UUID，事件 payload.selection 引用同一组 ID。selected 样式必须依真实关联显示。receipt.actor 是实际执行服务，requestedBy 是发起人，selection.actor/by 是实际人类选择者；查询者不冒充执行者。

## 一份状态与全部视图

GET 和 POST 均返回 {ok,found,state,receipt,receipts,domains,caseOutcome,version,processId}；POST 另有 reused。receipt 保留现有客户端需要的 requestId、roundId、domain、roundNo、state、version、updatedAt、current、columnResults、downstream。未执行列没有 receipt，不伪造全绿记录。

每次 GET 在同一 PostgreSQL repeatable-read 快照内读取流程、任务、材料依据和事件。receipt.views.platform/materials/decisions/flow/history/chat 共用 customerId/processId/roundId/domain/version/basisVersion/current/serverUpdatedAt。

- platform.cells：材料/分析/核验/办结四格；domains 是其他专业的真实状态。
- materials.items：本轮实际材料内容、artifactId、hash、kind；旧轮保留旧材料，不混入更正版。
- decisions.candidate：C 真实专业意见 authority=none；selection 为实际采用记录；confidence 未校准为 null。
- flow.events、history.events：同版本服务端事件/身份/时间；history 有运行起止；chat.records 是同源事件记录，不冒充用户或模型聊天发言，也不写 R2 消息存储。

caseOutcome={processId,status,version,terminalEventId,archiveRef,ending,sourceMode}。五专业最新依赖仍有效且都完成显式采用后才写 CASE_COMPLETED、ending=diamond。明确信审拒绝后写 CASE_REJECTED_ARCHIVED、ending=rejection、archiveRef；迟到专业结果只能停止，不能改变结局。补证以真实 registerArtifact supersedes 更正版触发依据失效和重评。当前 C 各域声明全量材料依赖，补件会保守重评五域，不能宣称只重算信审或固定六次；历史保留。

## 边界

仅受控 synthetic fixture；收入 2200 万元，区域显式新疆喀什，现有 C simulation_rule 包不修改。确定性本地分析，不是付费模型。unknown 不自动消解：重启/超时/确认丢响应保持未决并防重发；需要对账时不能自动代用户采纳。新一轮独立演练目前通过新 seed-suffix 新建客户，不覆盖已有终态。真实浏览器点击与 Front 选择接线仍需主协调验收，本包 HTTP 通过不等于视觉通过。
