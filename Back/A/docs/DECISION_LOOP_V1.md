# 任务二 · 决策闭环设计与实施记录 V1（DECISION LOOP）

状态：本轮交付（B1→B2→B3 已实施）。日期：2026-09-17。
任务书：用户本轮《任务二｜把资料、现场、核验与客户授信打成一致且可审查的决策闭环》。
分工：产品实现=ZCode（本路）；契约统筹与独立复核=Codex。任务一（检查收口）与任务三（Edge/前端接线）为并行执行槽，本文件 §6 是给它们的版本化契约登记。

## 0｜输入版本与可复用实现（实测本地工作区）

| 输入 | 版本/状态 | 本轮用法 |
|---|---|---|
| Back/CONTRACT.md | v1.3（v1 新增候选语义 PENDING-USER-RULING 不变） | 幂等/乐观版本/outbox/鉴权机制原样复用；本轮不改 v1 语义 |
| 任务01 客户授信内核（工作区未提交） | `credit.ts`+`002_customer_credit.sql`+A01–A24 测试 | 全量复用：customers/evidence_artifacts/fact_assertions/credit_assessments/credit_facilities/financing_requests/exposure_entries/decision_records/permission_matrix/v2_idempotency |
| 任务03 四域（Back/C，工作区未提交） | `rules/gate.mjs` CLEAR/NEEDS_EVIDENCE/HOLD/HARD_BLOCK；`domains/schema.mjs` AnalysisRun/DomainAssessment | Gate 语义与 AnalysisRun 形状按其定义消费；A 不复制规则引擎 |
| 任务一 检查会话（并行实施中） | `Back/A/docs/INSPECTION_SESSION_V1.md` + `003_inspection_sessions.sql` + errors.ts 检查会话错误码 | 输入缝：包冻结时引用 inspectionRevision.closureStatus；仅 ready_for_assessment/closed 视为已收口 |
| 基线文档 JW_spatial_due_diligence_plan_v2.md | **不在本工作区**（与任务一结论一致） | 以本轮任务书文本为唯一要求来源 |
| PostgreSQL | 隔离容器 jw-cc-kernel-pg@15444（jwcc/jwcc-local-demo） | 测试经 `JW_A_ADMIN_DB_URL` 指向；本机默认 15432 未运行 |

## 1｜命名映射（任务书建议名 → 既有事实源，不建第二套）

| 任务书命名 | 本轮落地 |
|---|---|
| EvidenceLink/Observation | `evidence_artifacts`（+新增 provenance/object_ref/material_meta 列） |
| 原件及 hash / 独立证明 | `sha256` + `duplicate_of`/`supersedes` 并存语义 + provenance 根归并（`independentProofs`） |
| objectId + sceneVersion | `object_ref` jsonb + `object_relinks` 表（显式重关联） |
| Finding/Review | `decision_findings`（review.ts） |
| AssessmentSnapshot | `credit_assessments.evidence_snapshot/snapshot_hash`（复用） |
| DecisionPackage | `decision_packages` + `package_domain_results`（package.ts） |
| Gate | 包内 `gate` jsonb（结构消费 C 语义；A 不重算规则） |
| 用信准备 | `getUseReadiness` 视图 + reserve 提交点同判据（credit.ts） |
| 会后三视图 | `report_views`（reports.ts）：internal_summary / customer_supplement / use_prep_sheet |
| blockedActions/依赖范围 | finding.impactScope.actions + 包 readiness.blockedActions（动作级，不全局放大） |

## 2｜关键语义（本轮新增不变量）

1. **同源不重复计证**（3.1/B01）：派生材料必须声明 `provenance.derivedFrom`；核验等级不得高于上游；独立证明按根归并计数（评估快照/依据包/清单三处一致）。
2. **差异必须有结果**（3.2/B02–B04）：resolution ∈ explained_verified | adverse_confirmed | pending_evidence | not_applicable；关闭关键复核必须引用满足 `requiredAction`（kind 匹配 + 等级达标 + 现行）的证据；ack/口述/模型解释仅留痕；硬红线（ruleRef.nonWaivable）不接受 not_applicable，未批准例外政策 → POLICY_PENDING。
3. **依据包冻结与当前性**（3.3/B05/B06）：包按修订冻结（不可变行，新材料进新修订）；域依赖声明 + 摘要在冻结/域结果登记时落定；读时逐域复算——依赖已变的域必须更新，未变域复用；required 域无结果记录 = 缺失；就绪 = 全域 current + Gate ∈ {CLEAR, HOLD_FOR_REVIEW} + 无阻断性未决差异 + 检查收口已知（closureStatus ∈ ready_for_assessment/closed，未知不当作通过）。
4. **提交点复查**（3.4/B07/B08）：approve/activate/reserve 在事务内机械复查——客户级未决差异（动作级匹配）→ 依据包当前性/Gate → 现有额度/冷却校验；全部定案前零写入。批准完成后出现不利证据不改写历史，仅阻断后续用信。
5. **提额冷却**（B11）：`--credit-cooling-seconds` 显式配置才启用（未配置=机制不存在，不编造默认）；对"已有非零批准额之上"的提额批准设置 cooling_until；期内差异复核照常、新动作先被 REVIEW_REQUIRED 阻断（复核不等待冷却），差异关闭后仍受 COOLING_ACTIVE 限制。
6. **报告是投影**（3.5/B12/B13）：生成=纯读+追加一行；幂等键=(kind, subjectId, 业务状态哈希)，同状态重生成返回同一行；客户版服务端白名单组装，内部字段（gate/ruleIds/阈值/authority/金额）不进投影；customer-only principal 打内部报告/事件/证据地址一律 403。
7. **对象重关联**（B14）：历史证据恒绑定原始 objectId+sceneVersion；改名/重建不自动转移；`object-relinks` 是显式人工命令（追加式，双方 id 可追溯）；未映射对象在 inventory 中 relinkRequired=true。
8. **并发**（B09/B10）：finding 处理走乐观版本（expectedVersion，冲突=VERSION_CONFLICT）；approve 幂等+状态门+客户行锁；预占全部经客户锁 + 账本约束（新项目/新交易方式/重试不放大额度）。

## 3｜API（挂在 /api/v2，鉴权/requestId/幂等与既有 v2 一致）

```
POST /api/v2/customers/:id/findings                差异登记（agent 可建；处理仅人类）
GET  /api/v2/customers/:id/findings                reviewQueue（open 按严重度排序）
GET  /api/v2/findings/:findingId
POST /api/v2/findings/:findingId/resolve           处理结果（expectedVersion 乐观锁）
POST /api/v2/customers/:id/object-relinks          B14 显式重关联
GET  /api/v2/customers/:id/object-inventory        对象绑定与 relinkRequired
POST /api/v2/customers/:id/decision-packages       冻结修订 v1（assessmentId/inspectionRevision/gate/domainDeps/candidate）
POST /api/v2/decision-packages/:id/revisions       新修订（旧行转 superseded，依据保留）
POST /api/v2/decision-packages/:id/domain-results  四域结果登记（authority=none 强制；可携 adoption）
POST /api/v2/decision-packages/:id/adoption        采纳/搁置域意见（人类；留人/理由/依据）
POST /api/v2/decision-packages/:id/gate            Gate 结论登记（一次；改 Gate=新修订）
POST /api/v2/decision-packages/:id/refresh-currency 当前性刷新（changed 域 → REVIEW_REQUIRED 事件）
GET  /api/v2/decision-packages/:id                 包投影 + currency + readiness + gaps + domainReuse
GET  /api/v2/customers/:id/decision-status         §6 消费面（candidate/approved/available/队列/报告引用）
POST /api/v2/customers/:id/reports                 生成三视图之一（幂等）
GET  /api/v2/customers/:id/reports                 报告清单（业务角色）
GET  /api/v2/reports/:reportId?format=json|markdown 按受众鉴权导出
GET  /api/v2/financing-requests/:frId/use-readiness 用信准备视图（纯读）
```

既有命令扩展（向后兼容，全部可参数缺省）：`registerArtifact` 增可选 provenance/objectRef/materialMeta；`proposeFacility` 增可选 packageId；`approveFacility/activateFacility/reserveFinancing` 增加提交点复查（差异/包当前性/冷却）；`listArtifacts` 返回 independentProofs；`listCustomerEvents` 对 customer-only principal 关闭。

## 4｜事件（沿用 outbox_events，customer 维度；至少一次，按 eventId 幂等）

| 事件 | 触发 |
|---|---|
| `ASSESSMENT_BASIS_REVISED` | 工件取代 / 不利事实确认 / 包新修订 / 对象重关联 |
| `REVIEW_REQUIRED` | 阻断性差异登记、Gate HARD_BLOCK、refresh-currency 发现 required 域 changed |
| `DECISION_PACKAGE_READY` | 包首次/恢复就绪 |
| `FORMAL_DECISION_RECORDED` | facility.approve/activate/suspend/reduce、fr.confirm-external |
| `USE_READINESS_CHANGED` | fr 生命周期（提交/预占/释放/承诺/出账） |

## 5｜错误码新增（errors.ts；409 除注明外）

`REVIEW_REQUIRED`（复核/依赖未完成，返回具体缺口）、`REVIEW_EVIDENCE_REQUIRED`（无所需证据不能关闭；B04）、`GATE_BLOCKED`（HARD_BLOCK/NEEDS_EVIDENCE，无通用放行）、`COOLING_ACTIVE`（提额冷却未到；B11）。

## 6｜给任务一/任务三的契约（§4 消费面）

- **输入（任务一 → 本路）**：`createPackage.inspectionRevision = {sessionId?, closureRevision?, closureStatus, summaryRef?, checkedAt?}`；closureStatus 取任务一会话的 closureStatus 原文；不传=未知（显式缺口 INSPECTION_REVISION_UNKNOWN，绝不当作通过）。任务一的 pendingItems 可放入 `openItems[]` 随包冻结。
- **输出（本路 → 任务一/三，仅消费不自定状态）**：
  - `GET /customers/:id/decision-status` → `{basis:{basisVersion,status,currency,decisionReadiness,gaps,requiredActions,blockedActions,candidate}, facilityTotalsMinor:{proposed,approvedInactive,active,suspended,available}（available=逐设施 availableForNewDraw 求和，与用信准备同一账本推导）, reviewQueue[], reportRefs[]}`；
  - `GET /financing-requests/:frId/use-readiness` → `{canProceed, blockers[], transactionConditions, basis}`；
  - 事件见 §4；页面/通知只消费事件与读端点，禁止从报告内容反写任何业务状态。
- **前端（任务三）**：差异处理入口=findings 读端点 + resolve；额度栏=decision-status 的 candidate/approved/available 与 basisVersion；按钮禁用原因=blockedActions/blockers；报告入口=reports 端点（内部视图业务角色才可见）。

## 7｜提交边界与迁移

| 边界 | 内容 | 主文件 |
|---|---|---|
| B1 | 证据/差异/评估包契约、依赖与当前性判据、迁移、公共件抽取、契约集成 | `v2kit.ts`、`decision-support.ts`、`package.ts` 骨架、`004_decision_loop.sql`、`errors.ts`、`config.ts` |
| B2 | 差异复核、四域一致快照、正式动作提交点校验、既有额度回归 | `review.ts`、`package.ts` 完整、`credit.ts` 提交点/冷却 |
| B3 | 用信准备与会后授权视图、事件输出、并发与陈旧依据回归 | `reports.ts`、use-readiness、五类事件、`decision-loop.test.mjs` |

迁移 `004_decision_loop.sql`：只新增对象与既有表可空列（evidence_artifacts 三列、credit_facilities 两列）；旧行新列为 NULL=未知，不补造历史；无数据改写。**回退/向前修复**：迁移仅 CREATE/ADD COLUMN，向前修复直接追加新迁移；回退=保留对象停用入口（无破坏性 DDL），不依赖清库。003 号位为任务一 `003_inspection_sessions.sql`（本路避让改用 004）。

## 8｜验收对照（B01–B14 → test/decision-loop.test.mjs，15/15 通过）

全部用例使用显式合成配置（matrix-dev-synthetic-1 / sim-pack-1 / 用例内显式冷却秒数），未注册任何测试常量为正式制度。B-EX 额外覆盖 §4 五类事件断言。运行方式与证据见 `evidence/task02/`。
