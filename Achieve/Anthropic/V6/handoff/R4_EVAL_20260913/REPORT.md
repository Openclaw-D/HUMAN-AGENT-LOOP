# REPORT｜R4 任务C（跨路验收收口）

日期：2026-09-13。写面仅 `V6/handoff/R4_EVAL_20260913/`；R2/R3 冻结批次与产品只读。真实模型调用 0、产品代码改动 0、无部署/Git 写/Codex 操作。

## 结论

**工具侧收口完成（33/33 + Gate 退出码全谱验证）；跨路闭环判定 = BLOCKED**：MAIN 输入包（≥3 条 product_export 轨迹 + 同运行手机量测）尚未交付（0/3、0/1）。按 Goal"缺输入写精确缺件清单和可运行方法，不静默结束"——缺件清单与可运行命令见 RECEIPTS.md 与 EXPORT_COMMANDS.md。

## Codex R3 对 C 的两条点名 → 已关闭

| R3 验收发现 | R4 修复 | 实测证据 |
| --- | --- | --- |
| replay 退出码恒 0，自动接受脚本可能把 exit0 当业务 PASS | `replay --gate`：violation>0→4；undecided>0→5；schema/来源失败→5（GATE BLOCKED）；仅 pass/na→0。旧报告模式（无 --gate 恒 0）保留兼容 | evidence-r4/gate-exitcode-verify.txt：pos=0、neg=4（两例）、undecided=5、schema失败=5、旧模式=0 |
| T7 记 N/A 不能算"挂断待办丢失已变形验证" | T7 重做为真变形：先注入 open 待办+挂断事件构造对照态（T7a 非 violation），再删除待办断言 R-HANG 翻转（T7b violation）——N/A 不允许充数 | selftest 33/33（T7a/T7b 两条独立断言） |
| （连带）真实 store 冒烟抓到 schema 与产品 generation 语义错配（产品非负、0 合法，轨迹要求 ≥1） | schema 兼容修正（generation≥0，规则不放松）；neg-late-pause 夹具同步校准为 gen0 旧代次语义；T5 注入改为过期代次 | 修正前 selftest 32/33 暴露 → 修正后 33/33；冒烟证据 evidence-r4/smoke-and-regression.txt |

## 验证结果汇总（evidence-r4/final-verification.txt）

- R4 selftest **33/33**（32 项原有 + T7a/T7b 真变形断言）
- metamorphic **9/9**（T1/T2 幂等不变；T3–T8 精准翻转；T7a/T7b 对照+翻转）
- Gate 退出码全谱：0（pos）/ 4（neg×2）/ 5（undecided、schema失败）/ 0（旧模式兼容）
- 手机检查器：mm-pass exit 0
- R2 回归 **109/109**、R3 回归 **32/32**
- inputs-check：0/3 轨迹、0/1 量测 → exit 6 BLOCKED（含给 MAIN 的逐条可运行补件命令）

## 逐规则结果 / 来源 / 失败定位 / 回执

- 规则集与正反控/变换映射：RISK_MATRIX.md（R4 更新：Gate 列、T7 真变形、generation 语义修正、同运行 hash 防线）。
- 回执：RECEIPTS.md（RECEIPT-000 BLOCKED；MAIN 包到达后逐包出同编号 ACCEPTANCE_RECEIPT）。
- 接口与命令：EXPORT_COMMANDS.md（MAIN 精确导出命令、最小必须字段、输出位置、同运行 screenshotHashes 要求）。

## 边界声明

- 工具通过不证明模型风险能力；真实模型调用 0。
- 手写控制轨迹只证明回放器判定正确；产品结论只认 `integration-inputs/` 的 product_export 轨迹回放（当前 0 条）。
- schema 通过 ≠ 权限通过；零分母 N/A、undecided、blocked 三者分列。
- 真机 Safari/真实ASR/视频/相机 NOT TESTED；visual_accepted=false（等用户）。
