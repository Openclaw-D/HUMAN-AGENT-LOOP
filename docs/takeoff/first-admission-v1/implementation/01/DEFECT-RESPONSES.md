# 缺陷响应记录 · A 权威路（01）

记录 04/03 集成路报来的、责任在本路的缺陷：修复内容、复验证据、复验口径。逐条闭环，不用计划/自报代替通过。

## D-03（04路 DEFECTS_REPORT 2026-09-20）· 已修复待04终验

**缺陷**：正面确认未消费 Gate 回执硬门——03 链收口产生 `gate.result=HARD_BLOCK`（涉诉等），Gate 回执已登记进 A（`rule_gate_receipts`），但 `confirm-preassessment outcome=support` 仍 200。违反 T06（重要冲突阻断受影响的正面确认；不可豁免门不能一键解除）与 03 业务规则 §6（冻结当前方案→禁止相关正面确认）。

**根因**：确认门序第 9 条"结果相关硬门"只实现了 `decision_findings` 差异门 + 快照冲突/stale/版本门，未读取 `rule_gate_receipts`。

**修复（`Back/A/src/domain/credit.ts` confirmPreassessment，正/附条件分支事务内）**：
- 复查本客户**当前最新 Gate 回执**（`rule_gate_receipts` 按 `created_at DESC, receipt_id DESC` 取 1；该表仅 kind=service 身份可登记、登记时 ruleset 必须为当前激活版本——可信链沿用 §9 A2）。
- 判据与决策闭环 `evaluateReadiness` 完全一致：
  - 最新回执 `result ∈ {HARD_BLOCK, NEEDS_EVIDENCE, HOLD_FOR_REVIEW}` → **409 `GATE_BLOCKED`**，附 `{gateReceiptId, gateResult, ruleIds, reasonCodes}`（NEEDS_EVIDENCE 采纳 04 建议从紧阻断：关键证据未齐不给正面结论；三种非 CLEAR 统一码，明细在 extra）。
  - 最新回执 `CLEAR` 但其 `ruleset_version` ≠ 当前激活规则包 → **409 `STALE_BASIS`**（附 `gateReceiptId/rulePackVersion/activeRulePackVersion`）：解冻只随新收口产生，按当前规则重新收口后放行。
  - 无任何回执 = 无机器门信息 → 不阻断（不推断、不伪造）。
- `not_support` 负面结论不受该门约束（契约 §2.2 第 9 条既有口径：硬门只阻断正面）。
- 契约同步：`CONTRACT-PREASSESSMENT.md` §2.2 门序 9 / §2.3 错误码表；`Back/CONTRACT.md` §13.1。

**复验证据（本路，隔离库真实内核）**：
- 新增 `Back/A/test/preassessment-confirm.test.mjs` **PA-16**：CLEAR→放行 200；HARD_BLOCK→409 `GATE_BLOCKED`（`gateResult/ruleIds` 断言，含 SIM-LITIGATION-PENDING-01 同型场景），且评估状态保持 `awaiting_human_review`、候选历史不被改写，`not_support` 同上下文 200；NEEDS_EVIDENCE/HOLD_FOR_REVIEW→409；CLEAR@v1 + 换版 v2→409 `STALE_BASIS`（`activeRulePackVersion` 断言）→ CLEAR@v2→200。
- 套件 16/16 全绿；全量回归 **165 项 = 164 pass / 1 skip（crash 容器守卫）/ 0 fail**。

**遗留给 04 的复验口径**：按 04 报告口径重跑 `run-chain.mjs`——#26 应为 409（GATE_BLOCKED 族，extra 含 gateReceiptId/gateResult）且 AS1 保持 `awaiting_human_review`、候选历史不被改写；账本零变化继续成立（PA-12 口径不变）。运行环境注记：诊断期间 `jw-cc-kernel-pg@15444`（本路测试容器）曾随宿主 Docker 事件整体退出（Exited 255），已重启并复跑全绿；04 路 `jw-takeoff-pg` 属 04 登记资源，本路未触碰。

## OBS-03-01（03路 DEFECTS_REPORT 2026-09-20）· 已修复待03路接通

**缺陷**：A `POST /api/v2/customers/:id/analysis-runs/start` 的 domain 校验只收四域（policy/credit/commerce/asset），TAKEOFF 五列的 `business`（商机）被 400 拒绝；03 路只能按协议诚实跳过（`a_domain_enum_pending` 留痕）。

**修复（01路 ownership）**：
- 词表统一：`decision-support.ts` 的 `DOMAINS` 扩为五域 `business/policy/credit/commerce/asset`；`analysis-runs/start`、豁免登记、依据包 domainDeps 校验统一引用，词表外仍 400。
- 迁移 `013_five_domain_vocab.sql`：`package_domain_results / analysis_runs / domain_requirement_policies / domain_exemptions` 四表 `domain` CHECK 重建为五域（只放宽枚举、零行改写）。
- 契约登记：`Back/CONTRACT.md` §13.4。

**复验证据**：PA-17（business 域运行登记 200、policy 域仍 200、词表外 `marketing` 400 且错误文案列出完整五域）；套件 17/17；全量回归 **166 项 = 165 pass / 1 skip / 0 fail**（含 trust-gates-a2 等四域历史套件全绿，词表扩展为纯加法）。

**遗留给 03**：按其报告口径，配置 `aRegisterDomains` 加 `'business'` 即接通（03路零代码变更）。

## 次要观察转交（非本路 ownership，仅登记）

- 04 报告"次要观察（交03路）"：链上 conflict→findings 的 `impactScope.actions` 建议增加 `'preassessment.confirm'`（03 路 `coordinator.mjs`）——属 03 路 ownership，本路不改其文件；此为双保险项，A 侧硬门已不依赖它。
