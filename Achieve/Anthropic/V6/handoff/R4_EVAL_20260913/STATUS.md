# STATUS｜R4_EVAL_20260913（并行C第四轮：跨路验收收口）

- 状态：**READY_FOR_REVIEW（C 路工具与控制组冻结）＋ 跨路闭环 BLOCKED（MAIN 输入包 0/3 轨迹、0/1 量测——见 RECEIPTS.md/EXPORT_COMMANDS.md，不静默）**
- writer：R4 任务C（ZCode）。写面仅 `V6/handoff/R4_EVAL_20260913/`；R2/R3 批次与产品只读；产品由 MAIN 写。
- 真实模型调用 0、产品 API 0、无 Git 写、不操作 Codex、无新依赖；可变输出统一 `evidence-r4/runtime/`。

## Goal 接收（ZCODE_R4_C_20260913.md + ZCODE_R4_GOALS_20260913.md + CODEX_R3_ACCEPTANCE_20260913.md）

针对 Codex R3 验收对 C 的两条点名，本轮直接修复：

1. **"replay 退出码恒 0，exit0 不能当业务 PASS"** → 新增 **Gate 模式**（`replay --gate`）：violation>0 → exit 4；undecided/blocked（缺必要证据）>0 → exit 5；仅全 pass/na → exit 0。旧报告模式（默认 exit 0）保留兼容。
2. **"T7 记 N/A 不能算挂断待办丢失已变形验证"** → T7 重做：不依赖基线恰有 open 待办——变换器先注入 open 待办+挂断事件（构造确有 open 待办的状态），再删除，断言 R-HANG 必然翻转；N/A 与 zero-denominator/undecided 在报告分列。

跨路接入（单一接入合同）：MAIN 拥有 `integration-inputs/` 编号输入包。本路交付：
- **给 MAIN 的精确导出命令**（EXPORT_COMMANDS.md，逐条可复制执行）；
- **核对入口** `replay-cli.mjs inputs-check`：扫描 MAIN 输入包落位情况，输出已收/缺件清单与精确可运行方法；
- 收到 ≥3 条 product_export 轨迹 + 量测后逐包回放出 **ACCEPTANCE_RECEIPT**（含来源 hash、逐规则结果、失败定位）；**收到前保持 BLOCKED，不以手写夹具冒充产品证据**。

## 进度

- [x] Goal 接收（本文件）
- [x] R4 工具升级（Gate/T7真变形/inputs-check/receipts/gen≥0兼容）+ 回归 33/33（R2 109/109、R3 32/32）
- [x] Gate 正反例退出码实测（0/4/5/5/旧模式0）+ T7 真变形断言（T7a对照/T7b翻转）
- [x] EXPORT_COMMANDS + inputs-check 核对入口上线（实测 0/3、0/1 → exit 6 BLOCKED）
- [x] MAIN 输入包复验：**未收到（0条）** → RECEIPT-000 BLOCKED，缺件清单与可运行命令已交付
- [x] RECEIPTS / RISK_MATRIX / MOBILE_ACCEPTANCE / REPORT / MORNING_REPORT / MANIFEST 冻结
