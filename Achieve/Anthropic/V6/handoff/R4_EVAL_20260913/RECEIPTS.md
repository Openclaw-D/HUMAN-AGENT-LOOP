# RECEIPTS｜ACCEPTANCE_RECEIPT（R4_EVAL_20260913）

## RECEIPT-000｜BLOCKED（缺 MAIN 输入包）

- 签发：2026-09-13（R4 任务C）。判定：**BLOCKED——不构成任何接受**。
- 缺件清单（精确）：
  1. `V6/handoff/R4_MAIN_20260913/integration-inputs/<批次号>/trajectory-1..3.json` —— **0/3 收到**（product-trajectory@1，product_export）。可运行方法：`node V6/handoff/R4_EVAL_20260913/tools/export-trajectory-from-store.mjs --store <remote-store.json> --session <sessionId> --out <上路径>`（见 EXPORT_COMMANDS.md §1）。
  2. 同批次 `mobile-measurement.json`（mobile-measurement@1，含 screenshotHashes 同运行绑定）—— **0/1 收到**。产出规范：docs/MOBILE_MEASUREMENT_SCHEMA.md。
  3. 批次目录自身（`handoff/R4_MAIN_20260913/` 整体）—— 尚不存在。
- 收到后动作：`node tools/replay-cli.mjs inputs-check --receipts` → 逐轨迹出同编号 ACCEPTANCE_RECEIPT（pass/violation/undecided/na 逐规则 + 失败定位），量测出 mobile-verdict；整体接受还需：≥3 条轨迹无 violation、量测 PASS、且用户视觉确认（visual_accepted 由用户决定，本路恒不代填）。
- 诚实声明：手写控制轨迹（trajectories/handwritten/，32 项断言）只证明回放器正确；**当前不存在任何"产品轨迹已验证"的事实**。真实 store 冒烟仅证明导出命令可运行（当时会话 0 事件，不构成可判轨迹）。
