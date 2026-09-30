# 02-back CONTRACT_DELTA（2026-09-30 收尾轮：十案例权威目录与材料闭环）

状态：**ADDITIVE-ONLY**。权威契约仍是 `Back/CONTRACT.md` §14（v2.7）+ `2026-09-25/02-execution/TASK3_INTERFACES.md` + `2026-09-29/02-back/CONTRACT_DELTA.md`（事件追溯 `request`/`eventJobs` 沿用）。本文件登记收尾轮为十案例演示补齐的最小兼容增量；不新建第二业务权威，不改写既有字段语义。

## 1. A 正式案例目录（关闭 DEF-03-01；Edge fallback 可退役）

### 1.1 端点（A 直连 `/api/v2`；Edge 同源 `/api/jw/v2`）

| 端点 | 方法 | 权限 | 语义 |
|---|---|---|---|
| `/arrow-cases` | GET | 内部人类（客户身份 403；grant 不在册→该案例整体不可见；跨租户→空清单） | **权威案例清单**：`arrow_case_registry` ∩ 授权，检查点/下一动作/助手投影读时推导 |
| `/arrow-cases/:caseId` | GET | 同上 + 客户授权 | 单案例详情：检查点+执行轨迹（jobs/events/materials/cycles） |
| `/arrow-case-registry` | POST | **admin 人类** | 登记/更新案例展示条目（requestId 幂等；同 caseId 异载荷 409 `IDEMPOTENCY_REPLAY_CONFLICT`） |

- 兼容：`options.cases` 注入（旧三例栈 `parallel-arrows-cases-v1`）优先于目录；未注入时 `/arrow-cases` **恒可用**（A 正式面，不再 404）。隔离十案例栈以 `casesOverride:'directory'` 显式切换。
- 迁移 `018_arrow_case_registry.sql`（只新增表/索引；登记=种子配置非业务结论，检查点不落库）。

### 1.2 清单响应（01/03 统一消费；字段名一次定死）

```jsonc
{
  "ok": true,
  "manifestVersion": "arrow-case-directory-v1",
  "authority": "A arrow_case_registry（Edge 不再维护第二份清单）",
  "count": 10,
  "cases": [{
    "caseId": "case-04", "customerId": "cust-…", "tenantId": "arrow-isolated-v1",
    "displayOrder": 4,                    // 展示序（差1-3→中4-7→好8-10）
    "category": "中",                     // 案例分类（差/中/好；分类≠结果参数，结论由材料+规则计算）
    "businessName": "伊犁河谷食品加工合作社", // 业务名称
    "summary": "现金流缺件：……",            // 案例要点
    "displayName": "同 businessName", "batch": "checkpoint|fresh",
    "scenarioIsOutcome": false, "sourceMode": "synthetic",
    "checkpoint": {                        // 当前检查点（从真实执行状态读时推导，不落库不硬编码）
      "type": "awaiting_evidence",         // 词表见 §1.3
      "label": "已分析：信审待补件",
      "detail": "现金流输入未达核验等级（1 项 unknown）；补件后仅相关域失效重算",
      "evidence": { "kind": "job", "jobId": "column-…", "unknowns": ["…"] }  // 可追溯证据（job/process/cycle/assessment/fact_grades）
    },
    "nextActions": [                       // 可继续事件（均映射既有授权 API，见 CASE_RECIPES.md）
      { "action": "supplement", "label": "登记核验补件（supersedes 旧申报）", "domain": "credit", "hint": "仅受影响域失效重算" } ],
    "assistant": {                         // 右侧助手投影（确定性；无模型不伪装）
      "source": "案例说明", "modelInvolved": false,
      "note": "确定性说明：由现行事实、材料依据与规则门状态投影生成；不含模型回答，不含校准概率",
      "currentFacts": [ { "factKey": "monthly_operating_cash_flow", "value": 200000, "grade": "unverified", "verification": "申报" } ],
      "basis": { "artifactCount": 18, "materialRefs": [ { "artifactId": "art-…", "sha256": "…", "kind": "financial_statement" } ] },
      "blockers": [ { "checkpoint": "awaiting_evidence", "detail": "…" } ],
      "next": [ /* 同 nextActions */ ] },
    "progress": { "registeredArtifacts": 18, "processState": "in_progress", "cycleState": null },
    "updatedAt": "2026-09-30T…"
  }]
}
```

### 1.3 检查点词表（checkpoint.type；全部由真实状态推导）

| type | 触发状态（读时判定） | 典型案例 |
|---|---|---|
| `blocked_redline` | 年收入申报×单位 >5000万（读取复算） | 01 |
| `blocked_hard` | 域作业 `zoneCandidates.hardBlock===true` 且未终态 | 02 |
| `rejected` | 流程 rejected（信审正式拒绝归档） | —（03 重演后） |
| `awaiting_evidence` | 信审作业 waiting_evidence | 04 |
| `conflict_review` | 任一作业 contradictions 非空且未收口 | 05 |
| `risk_decision` | 信审 awaiting_confirmation 且 findingsSuspicion 非空 | 03 |
| `verification_pending` | 收入/主体/权属申报等级未达 confirmed 且有未收口作业 | 06 |
| `stale_review` | 已采用结果早于其依据的取代事件（supersede 晚于 finished_at） | 07 |
| `preassessment_review` | 五区 completed + 评估 awaiting_human_review | 08 |
| `preassessment_confirmed` | 评估 preassessment_confirmed（scope=preassessment_only） | 08 确认后 |
| `awaiting_external` | 周期 awaiting_external_receipt | 09 |
| `settled_reorderable` / `closed_reorderable` | 周期 settled/closed | 09 结清后 / 10 |
| `case_completed` | 五区全部采用（diamond） | — |
| `awaiting_confirmation` | 全部作业待人工逐区采用 | — |
| `in_progress` / `ready_to_analyze` / `not_started` | 推进中 / 材料就绪待分析 / 未开始 | fresh 批次 |

## 2. 核验动作契约（DEF-03-05 正式接口样例；01 页面入口消费）

核验登记 = 既有 `POST /api/v2/customers/:id/artifacts`（registerArtifact；Edge `/api/jw/v2/actions/customers/:id/artifacts`）。**人工采纳候选 ≠ 确认事实**：只有 grade=confirmed 的核验登记工件才改变事实核验等级。

| 核验 | 域 | 请求体（requestId 幂等） |
|---|---|---|
| 收入核验 | business | `{kind:'financial_statement', factKey:'revenue_annual_declared', grade:'confirmed', content:{value:<核验数>, unit:'CNY', sourceMode:'human_verified_document', factKey:'revenue_annual_declared', note:'核验说明'}, materialMeta:{subjectRef:'cust-…', unit:'CNY', caliber:'人工核验原件后登记'}}` |
| 主体核验 | policy | 同形，`factKey:'entity_identity_verified'`，value:true |
| 权属核验（通过/不通过） | asset | 同形，`factKey:'equipment_ownership_verified'`，value:true/false（**false → SIM-ASSET-OWNERSHIP-01 HARD_BLOCK**） |

- 权限：核验等级提升仅获准核验角色（business/credit/policy/commerce/asset/admin 内部人类）；客户身份申报恒 unverified（K04 既有纪律）。
- 版本门：登记产生新工件（旧行不改写）；受影响域经 `affectedDomains` 投影即时可见；在旧依据上的人工确认 → 409 `VERSION_CONFLICT`（9/29 S16）。
- **DEF-03-02 语义确认**（03 请求）：核验登记后 `affectedDomains` = 消费该 factKey 的域（收入→business；主体/权属→policy+asset；现金流→credit+policy）。十案例 T5 实测 `['asset','business','policy']` 与 03 推导一致。

## 3. 预评估收口正式序列（08 例；协助 01 接 DEF-03-05 同族入口）

```
① POST /api/v2/customers/:id/assessments        {requestId, ruleVersion:'1.0.0', evidenceSnapshot:[{artifactId}×N]}   — credit 角色
② POST /api/v2/assessments/:id/candidate        {requestId, candidate:{tendency:'do', producedBy:'…', rationale, basisRefs:[artifactId]}} — credit
③ POST /api/v2/assessments/:id/submit-review    {requestId}                                                          — credit
④ POST /api/v2/customers/:id/rule-gate-receipts {requestId, result:'CLEAR', rulesetVersion:<激活版>, evidenceRefs:[与快照同一工件集]}   — service 身份
⑤ POST /api/v2/assessments/:id/confirm-preassessment {requestId, outcome:'support', assessmentVersion:<GET 当前版>, candidateRevision:<最新修订>, rationale} — credit
   → {confirmationId, scope:'preassessment_only'}；credit_facilities/financing_requests/exposure_entries 零写入（T6 机器断言）
```

门序（既有 §13，零放宽）：版本门（assessmentVersion/candidateRevision 不符 409 VERSION_CONFLICT）→ 状态门（须 awaiting_human_review）→ 硬门（stale=false、快照工件逐一现行、Gate CLEAR 且回执规则=激活版、Gate 证据集=快照集）。

## 4. 09/10 周期全生命周期操作序列（权限与读面）

```
前置：同客户最新流程 completed 且五区全部采用
① POST /api/jw/v2/actions/customers/:id/cycles                          {requestId}                    → active（内部人类）
② POST …/cycles/:cycleId/fulfill                                        {requestId}                    → awaiting_external_receipt（如实停）
③ GET  /api/jw/v2/customers/:id/cycles                                  （读面：externalIntegration.connected=false 声明）
④ POST …/cycles/:cycleId/external-receipt   {requestId, ref:'SIM-WIRE-…', source:'manual-attestation'}  — 模拟回执必须 SIM- 前缀+manual-attestation 出处
⑤ POST …/cycles/:cycleId/settle                                         {requestId}                    — 未确认回执 → 409 SETTLE_REQUIRES_EXTERNAL_RECEIPT
⑥ POST …/cycles/:cycleId/close                                          {requestId}                    — settled → closed
返单：先完成新一轮五区（新 requestId advance→逐区 adopt）→ POST cycles {requestId, reorderOf:<cycleId>}
   — 未结清/无更新流程 → 409 REORDER_REQUIRES_FRESH_CASE；新周期 cycleNo+1、独立 sourceProcessId、第 1 期历史不改写可查
```

同 requestId 重放单效果（重复 fulfill/receipt 零重复事件，T8/S17）；无真实支付系统，界面不得标"真实实收"。

## 5. 诚实性边界（01/03 展示纪律）

- 检查点/下一动作/助手投影全部 `source='案例说明'`、`modelInvolved:false`；自由问答未配置模型时按既有 409 `MODEL_NOT_CONFIGURED` 语义，不伪装模型回答。
- 候选 `scoreType='rule_rank'`（排序位次），无 confidence/probability；`unknown` 事实不补零；模拟材料/回执/规则均标合成来源（规则包 `four-domain-rule-pack-v1.json@1.0.0` 为**演示规则，非集团制度**）。
- 每例材料 `content.originFile{name,sha256,line}` + `content.fileText` 与 `materials/MANIFEST.json` hash 一致，"看收入原件"可回溯到 CSV 行与 hash。
