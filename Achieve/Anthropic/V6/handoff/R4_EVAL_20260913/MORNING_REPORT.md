# 收口报告｜R4_EVAL_20260913（C 路跨路验收）

一句话：**C 路工具侧收口完成并全绿；跨路闭环 BLOCKED 在 MAIN 输入包（0/3 轨迹、0/1 量测）**——缺件清单与可运行命令已交付（RECEIPTS.md、EXPORT_COMMANDS.md），MAIN 交付后 C 即可逐包回放出 ACCEPTANCE_RECEIPT。

## 交付

| 项 | 文件 | 验证 |
| --- | --- | --- |
| Gate 模式 | tools/replay-cli.mjs `replay --gate` | 退出码全谱实测：pos 0 / neg 4（×2）/ undecided 5 / schema失败 5（GATE BLOCKED）/ 旧模式恒 0 兼容 |
| T7 真变形 | selftest T7a（对照态非 violation）+ T7b（删除 open 待办 → R-HANG violation） | 33/33 |
| inputs-check | `replay-cli.mjs inputs-check [--receipts]` | 当前 exit 6 BLOCKED，输出给 MAIN 的逐条补件命令 |
| 导出器（给 MAIN） | tools/export-trajectory-from-store.mjs | 真实 store 冒烟可运行；并抓到并修复 generation≥0 语义错配 |
| 量测检查器 | tools/mobile-measure-check.mjs | 5 夹具判定全符合（含 Codex 指出的 442×961/DPR0.91 与挂断不可达复现） |
| schema 兼容 | docs/TRAJECTORY_SCHEMA.md（generation 非负语义修正说明） | 与产品 remote-store 实测一致 |
| 矩阵/回执/报告 | RISK_MATRIX / RECEIPTS / REPORT / STATUS / AGENT_LEDGER / MANIFEST | MANIFEST 复跑稳定 |

## 回归

R4 selftest 33/33（含原 32 项）；R2 eval-cli-r2 selftest 109/109；R3 replay-cli selftest 32/32（R3 冻结态原样）。R2/R3 批次零改动。

## BLOCKED 明细（不静默）

1. `handoff/R4_MAIN_20260913/` 整体不存在。
2. integration-inputs 轨迹 0/≥3（product-trajectory@1, product_export）。
3. integration-inputs 量测 0/≥1（mobile-measurement@1，含同运行 screenshotHashes）。

补件方法（MAIN 可直接执行）：见 EXPORT_COMMANDS.md §1/§2；补件后 C 运行 `inputs-check --receipts` 逐包出回执。

## NOT TESTED

真实模型、真机 Safari、真实ASR/视频/相机、MAIN 真实轨迹与量测的回放判定（等输入）。visual_accepted=false（等用户）。
