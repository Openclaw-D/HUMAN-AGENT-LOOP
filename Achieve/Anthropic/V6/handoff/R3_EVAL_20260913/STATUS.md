# STATUS｜R3_EVAL_20260913（并行C第三轮：产品轨迹回放验收）

- 状态：**READY_FOR_REVIEW（工具与控制组冻结）＋ INTEGRATION BLOCKED（等 MAIN 轨迹/量测，详见 INTEGRATION.md/MORNING_REPORT.md）**
- writer：R3 任务C（ZCode）。写面仅 `V6/handoff/R3_EVAL_20260913/`；R2 批次（R2_EVAL 等）只读；产品由 MAIN 写，本路不改 MAIN/A/B 代码。
- 真实模型调用 0、产品 API 0、无 Git 写、不操作 Codex、无新依赖。

## Goal 接收（ZCODE_R3_C_20260913.md + ZCODE_R3_GOALS_20260913.md 共同约束）

- 核心转向：**用 MAIN 实际运行轨迹验收，不再只给手写答案打分**。优先抓：一屏不成立（手机首屏）、前序越权、意见丢失、挂断后断链。
- 并发默认 2 / 最多 3，限流退避；09:00 报告收束点（08:30 后只收尾在途最小闭环）。
- 可变输出全部进 `evidence-r3/runtime/`（不覆盖 R2 冻结 evidence；R2 的 metamorphic 命令不重跑以防污染，只重跑零写入的 R2 selftest 作回归）。

## 建筑在真实产品模型上（只读依据）

- `jianwei-v3/site/lib/v5-preview/remote-types.ts`：RemoteSessionRecord（status/generation/participants/video）、EvidenceRecord（version/supersededBy/supersedes）、AnnotationRecord（status/replies: model_simulation|business|domain）、ReviewRecord（confirm/correct/request_resupply/request_retake/pause_round/escalate_human/resume_round + opinion/reviewer）、CalculationRecord（status/basedOn{remoteVersion,ruleConfigStatus,generation}）、RuleConfigRecord（version 0 unconfigured）。
- `jianwei-v3/site/lib/v5-preview/remote-timeline.ts`：LifecycleStage（pre_review→due_diligence→signing→post_rental，settled 终点）与 CollaborationStep 类型分离；TimelineEventRecord 只追加（at/actor/kind/level/event/before/after/impact）；predecessorAllows（pre_review 阶段 formal_verification 禁止、model_preprocessing 允许）；routeConflict（冲突→domain_professional、resolved=false、原意见/分歧/新结论并存）。
- 轨迹 schema 直接复用以上字段名（版本化 `product-trajectory@1`），MAIN 导出即可回放；事件 vocabulary 只解释检查所需的 kinds，未知 kind 记录不解释。

## 交付物清单（对应 Goal 交付节）

| 交付 | 文件 |
| --- | --- |
| SCHEMA | docs/TRAJECTORY_SCHEMA.md（product-trajectory@1）+ docs/MOBILE_MEASUREMENT_SCHEMA.md（mobile-measurement@1） |
| 测试与回放CLI | tools/replay-cli.mjs（replay/selftest/metamorphic）、tools/mobile-measure-check.mjs |
| 风险覆盖矩阵 | RISK_MATRIX.md |
| MAIN 实际接入证据 | INTEGRATION.md（≥3 条可回放轨迹或 integration blocked） |
| 手机验收报告 | MOBILE_ACCEPTANCE.md（无原始 DOM 量测文件不 PASS） |
| 收束 | STATUS / REPORT / MANIFEST / MORNING_REPORT / AGENT_LEDGER |

## 进度

- [x] Goal 接收（本文件）
- [x] schema 冻结（product-trajectory@1 + mobile-measurement@1）
- [x] replay CLI + 10条风险规则 + 12份手写控制轨迹（SA-1规格版）+ metamorphic 8变换 → selftest 32/32
- [x] 手机量测检查器 + 5夹具验证（SA-10）
- [x] MAIN 轨迹接收检查：0条收到 → **INTEGRATION BLOCKED 如实报告**（导出器/回放器就绪，链路演练走通）
- [x] RISK_MATRIX / INTEGRATION / MOBILE_ACCEPTANCE / REPORT / MORNING_REPORT / AGENT_LEDGER / MANIFEST → 冻结
- [x] R2 回归 109/109（零写入 selftest；R2 冻结 evidence 零污染）
