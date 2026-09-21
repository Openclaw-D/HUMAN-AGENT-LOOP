# Arrow Back API — first real slice

> 2026-09-21 阶段1接续：当前 policyVersion=arrow-business-column-v2，actionIds 必须从计划读取（现在为 report.customer_supplement 与 business.column.evaluate 两项）。旧示例单动作不可继续硬编码。真实分析与统一视图见下方补充；整列仍有明确人工门，不标完成。

2026-09-21。源码已注册，隔离 Edge → A → PostgreSQL HTTP 验证通过；共享实例未迁移或重启。本接口不代表五列已完成。

浏览器沿用现有 Edge 会话与同源 POST。客户路径前缀 `/api/jw/v2/customers/:customerId`。

| 方法 | 路径后缀 | 语义 |
| --- | --- | --- |
| GET | `/advance-plan?domain=business` | 当前列计划、依据版本、可执行性及阻点 |
| GET | `/advance-rounds?domain=business` | 当前身份该列历史，最新在前 |
| GET | `/advance-rounds/active?domain=business` | 未决轮次；本进程正在执行显示 running，重建后 unknown |
| GET | `/advance-rounds/by-request/:requestId` | 丢响应后按原 ID 恢复 |
| GET | `/advance-rounds/:roundId` | 指定持久轮次 |
| POST | `/api/jw/v2/actions/customers/:customerId/advance-rounds`（完整路径） | 明确执行计划中的真实动作 |

A 对应路径为 `/api/v2/customers/:customerId/...`，不含 Edge 的 `actions` 段。

domain 为 business/policy/credit/commerce/asset。GET 任意列均不执行动作；没有历史返回 `found:false,state:not_started,receipt:null,receipts:[]`。左右切换 activeColumn 应只读取；明确执行才 POST。接口不控制页面、滚动或缩放。

POST 请求从最新 plan 原样复制下面字段，并生成 requestId；不要传客户端身份或结果：

```json
{
  "requestId": "client-generated-id",
  "domain": "business",
  "planId": "<plan.planId>",
  "planHash": "<plan.planHash>",
  "expectedVersion": {"customerRevision": 1, "dependencyDigest": "<plan.expectedVersion.dependencyDigest>"},
  "roundNo": 1,
  "actionIds": ["report.customer_supplement", "business.column.evaluate"]
}
```

plan 返回 available/reason、planId/planHash、policyVersion、expectedVersion、roundNo、reused/resultRef、actionIds/allowedActions、materialRefs、downstreamPlan、blockers。仅 SYNTHETIC- 前缀客户、获准 business/admin 人类身份、有材料且无拒绝/未决围栏时可执行 business；其他列返回 COLUMN_EXECUTOR_NOT_CONNECTED。

POST 新接受返回 202，幂等或有效结果复用返回 200，body 为 `{ok,reused,receipt}`。202 不等于完成，请按 receipt.state 展示。GET 返回 `{ok,customerId,domain,found,state,receipt,receipts}`。历史仅返回发起身份自己的轮次，不能跨身份共享读取。

receipt 包含 customerId/processId/domain/roundId/roundNo/version/domainVersion、basisVersion/current、requestId/actor/acceptedAt/updatedAt、materialRefs、actions、columnResults、eventRefs、downstream、next、confidence。materialRefs.domain=null 表示当前通用材料；confidence.value=null/calibration=unknown，不能展示为真实模型置信度。

真实动作包括已有 report.generate(customer_supplement) 和商机候选分析，actions[0].result 指向报告；analysis 成功可 completed，completion 保持 blocked，verification 等待确认，next.canAdvance=false。下游 policy 有持久 jobId，state=waiting_dependency，reason=AUTHORIZED_POLICY_EXECUTOR_REQUIRED；没有可运行的政策 worker。

相同 ID/相同载荷复用；相同 ID 改载荷、旧版本或缺失/新增动作拒绝 409；畸形输入 400；权限错误 403 或隐藏资源 404。报告已提交但确认丢失时保留 unknown，同 ID 只读原结果，新 ID 不可绕过，GET 不重发也不自动消解 unknown。发生拒绝时展示 rejected、下游 stopped；历史投影不回写原业务结果。

## 阶段1新增的当前响应

POST 同次执行已有报告命令及 B column-runner → C assessBusiness 的确定性候选分析（无外部模型）。只消费 A fact_assertions，上传 JSON 自称 verified 不产生核验等级；材料取代/重复不参与当前分析。持久 receipt.businessCandidate 保存完整意见、来源、unknowns/contradictions、analysisRun 与服务端时间，登记范围为 advance_rounds.candidate_only，不冒充受 service 权限保护的 A analysis_runs。

columnResults 当前恰为 materials/analysis/verification/completion 四项；报告引用见 actions[0].result。analysis 执行成功可 completed，但候选存在未知或冲突时轮次 waiting_evidence；没有未知也仍 awaiting_confirmation，不能把分析完成当整列通过。plan.fullColumnReady=false 与 completionBlockers 明示未接通的人工核验/采用门。

所有 POST/GET receipt 自动包含 views.platform/materials/decisions/flow/history，各视图共享 customerId/processId/roundId/domain/version/basisVersion/current/serverUpdatedAt。platform 带四格、后列任务及 next；materials 带实际 artifact/hash；decisions 带真实候选、authority=none、selection=null；flow 带持久 timeline 与 eventRefs；history 带 actor、acceptedAt、actions。前端应一次替换同一 receipt 的各视图，不用本地计数或时间戳拼接。

timeline 的接受和结果事件包含服务端时间、轮次、版本与身份；结果 outbox 同时持久同一 version/at/candidateRunId。刷新 GET 读回同一候选 runId 与版本，不重新分析。当前共享实例仍未装配；此响应只能在加载当前源码并有 015 迁移的实例使用。
