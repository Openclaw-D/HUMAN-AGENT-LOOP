# CASE_RECIPES · 十案例准备与重演配方（03 消费；2026-09-30 收尾02）

种子入口：`Back/A/scripts/ten-case-runtime.mjs`（隔离栈 `createTenCaseRuntime({dbUrl, batch, run})`）。
两个批次都真实执行并留历史（不直写业务表造结果）：
- **checkpoint（检查点展示批次）**：登记材料 → 实际执行到该例检查点停（每步 requestId/审计/事件留痕）。
- **fresh（从头体验批次）**：只建客户 + 登记初始材料（+案例登记），从"材料就绪"开始重演。

材料源：`materials/case-XX/*.csv`（MANIFEST 含 SHA256；登记工件 `content.originFile/fileText` 与文件逐字节一致）。
独立期望：`materials/EXPECTED.json`（手工推导，非引擎输出）；实测对照在 `02-back/results/ten-cases.out`（11/11）。

通用角色凭据（隔离栈注入）：HUMAN=五专业审核员（business/policy/credit/commerce/asset），SERVICE=专业执行服务，ADMIN=admin。"业务事件"=`POST /api/jw/v2/actions/customers/:id/advance-rounds`（body 按 advance-plan）。

---

## case-01 · 差 · 喀什河谷新材料加工厂（收入超红线）
- 材料差异：revenue_annual_declared=56,000,000 CNY（confirmed）；其余良好。
- checkpoint 批次执行：仅登记材料（红线在读取时确定性阻断，无需也不可推进）。
- **预期检查点** `blocked_redline`；advance → 409 `NOT_READY/CUSTOMER_REVENUE_REDLINE`（不可强制通过）。
- 演示动作：查看收入原件（材料抽屉 → financial_summary.csv 行 2，hash 见 MANIFEST）+ 规则说明（>5000万红线）。
- 重演路径（T3 已验）：supersede 更正收入至 48,000,000（confirmed 核验件）→ 检查点变 `ready_to_analyze` → 提交分析可正常推进。

## case-02 · 差 · 天山南麓农机装备公司（权属核验不通过）
- 材料差异：equipment_ownership_verified 申报 grade=source_supported（"自有"）；其余良好。
- checkpoint 批次执行：advance（asset/policy 因权属未核验 waiting）→ **权属核验登记 false（confirmed）** → 受影响区重算（advance domain=asset）→ asset `HARD_BLOCK` → adopt 尝试 409 `HARD_BLOCK_NOT_ADOPTABLE`（留痕）。
- **预期检查点** `blocked_hard`；任何置信度/口头确认不能覆盖；解除唯一路径=事实纠正（重新核验 true）后重算。
- 演示动作：看申报 vs 核验冲突（两工件）+ 409 审计留痕。

## case-03 · 差 · 准噶尔包装制品厂（偿债能力不足）
- 材料差异：cash=55,000 / debt=100,000 → 覆盖率 0.55 < 1.0（演示阈值 SIM-CASH-COVERAGE-01）。
- checkpoint 批次执行：advance → 五区完成；credit awaiting_confirmation + findingsSuspicion 非空。
- **预期检查点** `risk_decision`；演示动作：信审 `decision reject`（credit 角色）→ 流程 rejection 归档、其余区 stopped、后续推进 `CREDIT_REJECTED` 硬挡。

## case-04 · 中 · 伊犁河谷食品加工合作社（现金流缺件）
- 材料差异：monthly_operating_cash_flow grade=unverified。
- checkpoint 批次执行：advance → credit waiting_evidence（unknowns 非空）；缺件区 adopt → 409。
- **预期检查点** `awaiting_evidence`。
- 演示动作（T4 已验）：核验补件（supersedes 旧申报，confirmed 银行对账单）→ `affectedDomains=['credit','policy']` → 对 credit advance → 仅 2 区重算（analysis_runs +2），business/commerce/asset 的 roundId/selection 逐字节不变 → 重算后可收口。

## case-05 · 中 · 阿克苏果业冷链公司（金额口径冲突）
- 材料差异：equipment_deal_amount 两份 confirmed 来源（equipment_list 2,980,000 vs purchase_invoice.csv 3,350,000）。
- checkpoint 批次执行：advance → asset contradictions（保留未合并）+ investigate 候选；冲突未解 adopt → 409。
- **预期检查点** `conflict_review`。
- 演示动作：两份原件对照（CSV 行级）→ 核实后 supersede 更正版 → 受影响区按新版本重算。

## case-06 · 中 · 吐鲁番纺织印染厂（核验未完成；DEF-03-05 页面入口）
- 材料差异：收入/主体/权属三键 grade=source_supported（申报≠核验）。
- checkpoint 批次执行：advance → business/asset/policy waiting_evidence。
- **预期检查点** `verification_pending`；nextActions=`register-verification`（factKeys 三键）。
- 演示动作（T5 已验，**页面完成核验登记，不借 API 脚本代替 UI**）：三类核验（CONTRACT_DELTA §2 表）→ `affectedDomains=['asset','business','policy']`（DEF-03-02 语义确认）→ 对 business advance → 三区重算 → 逐区采用收口。

## case-07 · 中 · 塔城农机维修连锁（新证据使旧结论复核）
- 材料差异：初始全好（设备对价 2,800,000）。
- checkpoint 批次执行：advance → 人工采用 business/policy/credit/commerce 四区 → 补证（对价 3,200,000 supersedes）→ 停（asset 仍待采用）。
- **预期检查点** `stale_review`（已采用结果早于取代事件）；旧候选不可继续采用（旧依据上确认 → 409 `VERSION_CONFLICT`，T9 已验）；受影响 `['asset','policy']`。
- 演示动作：补证前后对照（hash 变化）→ 对受影响区 advance（新 attempt 真实重算）→ 重算后采用收口。

## case-08 · 好 · 昌吉精密模具制造（首次预评估收口）
- 材料差异：全部 confirmed 良好。
- checkpoint 批次执行：advance → 五区全部采用 → 评估链（createAssessment(快照=全部工件) → submitCandidate(do) → submitForReview）→ Gate CLEAR（service，回执证据集=快照集）→ **停在待确认**。
- **预期检查点** `preassessment_review`。
- 演示动作（页面入口）：`confirm-preassessment`（credit 角色；assessmentVersion+candidateRevision+rationale）→ `preassessment_confirmed`；**全程 credit_facilities/financing_requests/exposure_entries 零写入**（T6 机器断言）；不批准正式额度。

## case-09 · 好 · 克拉玛依建材租赁（履约等待外部回执）
- checkpoint 批次执行：advance → 五区采用 → cycle open → fulfill（如实停）。
- **预期检查点** `awaiting_external`；读面 `externalIntegration.connected=false`。
- 演示动作（T7 已验）：未确认回执时 settle → 409 `SETTLE_REQUIRES_EXTERNAL_RECEIPT`；模拟回执 `external-receipt {ref:'SIM-WIRE-c09-0001', source:'manual-attestation'}`（出处明确，界面不标真实实收）→ settle → settled。

## case-10 · 好 · 博乐葡萄酒庄设备回租（已结清可返单）
- checkpoint 批次执行：case-09 全序列 + settle → close（完整留痕）。
- **预期检查点** `closed_reorderable`。
- 演示动作（T8 已验）：返单须先完成新一轮五区（新 requestId advance→逐区 adopt）；提前 reorder → 409 `REORDER_REQUIRES_FRESH_CASE`；合法返单 → cycleNo=2、独立 sourceProcessId、第 1 期仍 closed 可查（历史不覆盖）。

---

## 通用负例配方（跨例）

| 负例 | 操作 | 预期 |
|---|---|---|
| 幂等重放 | 同 requestId 同载荷重复提交 | 200 `reused:true` 零新执行；异载荷 409 `IDEMPOTENCY_REPLAY_CONFLICT` |
| 跨客户 | 他租户/客户身份访问 | 清单空 / 403 / 404（不泄露存在性） |
| 旧版本 | 依据变化后持旧 planHash/旧 resultId 确认 | 409 `VERSION_CONFLICT` |
| 缺件采用 | waiting_evidence 区 adopt | 409 `需先补证重评` |
| 硬阻断 | HARD_BLOCK 区 adopt/高置信度声明 | 409 `HARD_BLOCK_NOT_ADOPTABLE` |
| 无模型语义 | semantic 端点 | 409 `MODEL_NOT_CONFIGURED`（零出站） |

## 03 接线要点

1. demo-init 改调 `createTenCaseRuntime`（或等价：seedTenCases + casesOverride:'directory'），Edge fallback 清单可退役（A `/arrow-cases` 权威可用，DEF-03-01 关闭）。
2. 十案例检查点经 `GET /api/jw/v2/arrow-cases` 一次取回（含 nextActions/assistant），卡片直接渲染；单例详情 `/arrow-cases/:caseId`（**直连 A** 或 03 在 Edge 读代理白名单补 `/arrow-cases/:caseId` —— Edge 归 03 ownership）。
3. 06/08 的人工动作入口（核验登记抽屉、预评估确认按钮）按 CONTRACT_DELTA §2/§3 字段实施；09/10 周期界面纪律见 §4。
