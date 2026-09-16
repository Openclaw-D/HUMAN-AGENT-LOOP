# S0 · 本地 ↔ 远端差异清单（客户授信内核任务 01）

核验时间：2026-09-16 深夜。方法：`git ls-remote origin`（实查远端）+ 只读 `git fetch origin`（仅更新远端跟踪引用，未改本地分支/工作区）。

## 1. 分支级差异

| 引用 | 本地 | 远端（实查） | 差异 |
|---|---|---|---|
| `main` | `9c724c0`（工作区所在分支） | `5497576`（= 任务包 R0 引用 SHA） | **本地落后 2**：缺 `2172a0c`（V02_BASELINE + V02_FRONT_BACK_MAPPING）与 `5497576`（PR #2 合并提交）。未分叉，可 fast-forward，但 S0 未执行 |
| `v02-stage01-baseline-mapping` | `2172a0c` | `2172a0c`（已作为 PR #2 合并入远端 main） | 一致；远端 `refs/pull/2/head` = `2172a0c` |
| `test/pr-workflow` | `c7208bb` | `c7208bb`（远端 `refs/pull/1/head`） | 一致；V02_BASELINE 标注待用户裁决清理 |
| `JW_customer_credit_backend_tasks/` | 本地未跟踪目录（5 文件） | 远端 main 树中不存在 | 纯本地任务包，哈希与 MANIFEST 一致 |

## 2. 内容级差异（本地 main 缺什么）

远端 main（`5497576`）相对本地多出的文件即 `2172a0c` 的两个文档：

- `V02_BASELINE.md`（58 行，Stage 0 基线冻结）
- `V02_FRONT_BACK_MAPPING.md`（139 行，Front↔Back 语义映射契约）

本地工作区当前**看不到**这两份文件（在 `main`@9c724c0 上），但可通过 `git show v02-stage01-baseline-mapping:<路径>` 或 `git show origin/main:<路径>` 只读读取；本 S0 的分析已按此方式引用其内容。两份文档同时是任务包 R1/R2 指向的权威版本（R0/R1/R2 的 SHA 与实查远端一致）。

## 3. 任务书涉及的设计修订点（引用 R2 原文位置，S1 处理）

对照远端 main 上的 `V02_FRONT_BACK_MAPPING.md`，任务书（00_READ_FIRST §二、01 §4）点名需修订的设计项，本地核实原文确实如此：

1. **发票/购销合同被写为同一证据 kind 的取代关系**（§3：两次提交都映射 `equipment_ownership_status`，后者 supersede 前者）。与任务 01 §6-S2 "发票与合同原则上并存" 冲突。S1 证据模型按 EvidenceArtifact/FactAssertion 分层处理，映射文档修订由总控统筹。
2. **accepted/decided 直接投影为绿灯**（§5 政策域 judgmentStatus 规则）。任务 01 测试 A21 明确反例：`accepted/decided` 且结论 rejected 时不得映射为风险通过。投影规则需引入结论语义，不能只看目标状态。
3. **验收权统一映射 jianwei**（§4 acceptanceRole = decisionRole = 'jianwei'）。任务 01 §4 明确"不得把 jianwei 默认设为所有额度的超级审批人"；授信场景的正式权限须由服务端授权目录/已批准矩阵决定，缺矩阵即 policy_pending。
4. **A 契约按字段名子串禁止 quota/price/rate**（§5 Stage 5 验证点提及禁键 `approv|decision|quota|price|rate|reject`）。S1 以严格结构化候选 Schema + authority=none 替代子串黑名单，不直接关闭旧校验。

## 4. 处置建议（均需授权，本阶段未执行）

1. 本地 `main` fast-forward 至 `origin/main`（纯前进 2 提交，无冲突风险；属分支变更，待用户/总控确认）。
2. `test/pr-workflow` 本地+远端分支清理（既有待裁决项，与 S1 无依赖）。
3. 任务包目录是否纳入 Git 由用户/总控决定（当前未跟踪，不阻塞 S1）。
4. R2 映射文档的 4 处修订走总控统筹的单一 writer 流程，修订冻结前 S2+ 实现以任务书 + 本清单为准。
