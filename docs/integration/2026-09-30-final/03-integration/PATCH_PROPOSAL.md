# PATCH_PROPOSAL · 公共根文档更新建议（03 路 → Codex）

03 路不写公共根文档；以下为建议补丁，由 Codex 裁定后落笔。

## PP-1 · README.md「JW 当前工作入口」补一行 V0.5 收尾入口

建议在入口段落加（日期 2026-09-30）：

> 2026-09-30 V0.5 收尾：一键启动 `Start-JW.cmd`（或 `Start-JW.ps1`；默认栈 v05@48431，`-Stack demo03` 为 48430 检查栈）。
> 十案例演示目录与讲解见 `docs/integration/2026-09-30-final/03-integration/DEMO_GUIDE.md`；
> 启停/重演见同目录 `RUNBOOK.md`。README 此前"虚拟演示/48214 preview"口径已由同源 Edge 托管替代。

理由：REVIEW.md 指出"README 仍写虚拟演示；Runbook 使用 Bash 命令"，本轮已有 Windows 一键入口与
十案例口径，README 需收敛（根文档归属 Codex）。

## PP-2 · docs/CHANGELOG.md 增补 V0.5 候选条目（草案）

> 2026-09-30 V0.5-candidate：十案例横向展列与事件闭环（A 权威案例目录 arrow-cases；十案例材料与
> 独立期望；检查点/从头体验双批次种子器）；Windows 一键启动 Start-JW（真实就绪/复用/恢复/多证停止）；
> 助手无模型"案例说明"确定性层；arrow-cases Edge 双来源 fallback 退役；DEF-03-05 人工核验登记页内入口；
> 履约/回执/结清/返单页面面板。遗留：DEF-03-06/07/08/09（见 03-integration/DEFECTS.md）。

## PP-3 · docs/DECISIONS.md 记录两条本轮裁定（草案）

1. 引擎规则包口径=四域包 four-domain-rule-pack-v1@1.0.0（02 收尾冻结；TAKEOFF 扩展规则不在
   推进引擎评估面；03 差例/演示设计已对齐；建议后续 activation 登记包 digest）。
2. 案例目录单一权威=A `arrow_case_registry`（授权相交）；Edge 不保留第二份清单来源
   （fallback404 机制已退役，A 故障 502 如实）。

## PP-4 · 根目录启动器收编

`Start-JW.ps1/.cmd`（03 路 ownership）建议纳入仓库根发布内容并在 README 引用；
`docs/integration/2026-09-29/03-integration/RUNBOOK.md` 的 Bash 命令保留为历史证据，
现行口径以 `2026-09-30-final/03-integration/RUNBOOK.md`（Windows）为准。
