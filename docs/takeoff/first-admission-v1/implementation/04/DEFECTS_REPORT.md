# 路04 缺陷报告 · 2026-09-20（装配验收发现，交责任路）

writer：ZCode 04路（集成验收）。证据均来自 TAKEOFF 装配（takeoff-up 全栈，Edge 48214）真实链路；复现脚本 `Back/Edge/scripts/acceptance/run-chain.mjs`。

## D-03（交 01 路 · A 权威域）：正面确认未消费 Gate 回执硬门——冲突/硬阻断下 confirm 仍 200

- **现象**：A1（涉诉通知）触发处理链收口 `gate.result=HARD_BLOCK`（frozen=true，含 SIM-LITIGATION-PENDING-01/HARD_BLOCK_RULE_HIT），该 Gate 回执已由 03 链登记进 A（`rule_gate_receipts` 5 行，最新 result=HARD_BLOCK，ruleset_version=1.0.0）；但 `POST /api/v2/assessments/:id/confirm-preassessment outcome=support` 返回 **200**（confirmationId 已产生），未被阻断。
- **根因**：01确认门序第9条"结果相关硬门"实现只覆盖 `assertNoBlockingFindings`（查 `decision_findings`——本场景为空）+ 快照冲突/stale/version 门；**未消费 `rule_gate_receipts` 的 HARD_BLOCK/HOLD 结果**。03 链侧 conflict→findings 登记只覆盖"同 factKey 双现行断言冲突"（material_conflict），litigation 单一新事实不产生 findings——因此硬门信息只存在于 Gate 回执中，而确认门不读它。
- **违反**：01_TAKEOFF_CORE_AUTHORITY/05 §2 T06（"重要冲突阻断受影响的正面确认""不可豁免门不能一键解除"）；03_BUSINESS_STATE_RULES §6（冻结当前方案→禁止相关正面确认）；03 PROTOCOL OBS-03-02（解冻只随新收口产生）。01契约 §13.1 门序第9条"结果相关硬门"应包含 A 内权威 Gate 回执。
- **修复建议（01路 ownership 内）**：confirm-preassessment 正/附条件分支在事务内复核本客户**当前最新 Gate 回执**：`result='HARD_BLOCK'` → 409 `REVIEW_REQUIRED`（或新码 HARD_BLOCKED，附 receiptId）；`HOLD_*` 同理阻断（是否区分码由01定）。NEEDS_EVIDENCE 是否阻断正面确认属业务语义，请01路与用户裁决后定（倾向：阻断，理由=关键证据未齐）。
- **次要观察（交03路）**：链上 conflict→findings 的 `impactScope.actions` 现为 `['approve_facility','reserve']`（coordinator.mjs L1655），建议增加 `'preassessment.confirm'`，使冲突类 findings 同样覆盖预评估确认（双保险）。
- **复验口径（04路）**：修复后重跑 run-chain.mjs：#26 应为 409（REVIEW_REQUIRED 族）且 AS1 保持 awaiting_human_review、候选历史不被改写；账本零变化继续成立。

## 已修复（本路 ownership 内，验收过程中发现）

| # | 缺陷 | 修复 | 验证 |
|---|---|---|---|
| DEF-04-01 | 夹具 PDF 生成器 latin1 编码损毁中文文本层（03路交叉发现 DEF-03-01；初版修复误置二进制标记于 %PDF 魔数前，二轮修正为 头→标记→UTF-8 内容，偏移=9+6+n 一致） | gen-fixtures.mjs 重写 makePdf 字节组装；重新生成 8 件夹具+SHA256SUMS | 03路解析器实测：P1 订单金额/涉诉事实正确提取；run-chain 全链解析通过 |

## 交接状态

- D-03 已立案待01路修复；04路在修复后执行最终 T01–T14 快照验收（全新库，非本轮诊断跑）。
- 诊断跑遗留：当前 jw-takeoff-pg 库含诊断数据（3 个合成客户）；最终验收前重置（本路登记资源）。
