# 路04 开工记录 · Edge装配、集中清理与全流程验收

开工：2026-09-20。目标：TAKEOFF-FA-1.0.0 的 Edge 接线、可恢复资源盘点、跨路装配与最终 T01–T14 验收。

## 本路 ownership

- 独占写：`Back/Edge/**`、`Back/D/**`
- 本路记录：`docs/takeoff/first-admission-v1/implementation/04/`
- 最终收口独占（验收阶段写入）：本包 `CURRENT_STATE.md` / `ADAPTATION_MAP.md` / `TEST_RESULTS.md` / `CLEANUP_LOG.md`，以及根 `README/HANDOFF/ROADMAP/CHANGELOG` 的运行指针
- 不写：最高基线01文件、根安全纪律、业务决定历史（DECISIONS）、`Front/**`、`Back/A/**`、`Back/B/**`、`Back/C/**`、`Back/Connectors/**`、`Back/CONTRACT.md`

## 依赖与顺序

1. 【本路可立即做】资源盘点（已开始）、Edge/D 现状代码核对、验收夹具准备、本路所有权内清理
2. 【等01】`Back/CONTRACT.md` 发布 confirm-preassessment 兼容增量 → Edge 接线（新增动作代理路由、读投影、分析代理）
3. 【等02/03】前端二十格与证据链交付 → 最终装配（串行）
4. 【本路】T01–T14 逐项验收 + 负面覆盖 + 零变化断言 → 缺陷交责任路 → 复验闭合
5. 【本路】四份运行记录收口 + 可重复演示交付

## 状态

- 2026-09-20 开工：基线文档（00–06、ADAPTATION_MAP、CURRENT_STATE、CLEANUP_LOG、CONTRACT v2.5）已读；运行资源盘点完成（见 RESOURCE_INVENTORY.md，含晚些复核：48110/48190 已停，48210 成为孤儿但仍不碰）；Edge/D 代码核对完成（见 WIRING_PLAN.md）。
- 2026-09-20 准备完成：验收夹具确定性已验证（重生成字节级一致；ledger-zero-change 对真实库只读自测 PASS）；所有权内清理第一轮完成（释放≈1.44GB 冷 pgdata，见 CLEANUP.md）；装配编排 takeoff-up/takeoff-down.mjs + takeoff-runtime.example.json 就绪（语法/失败路径已验，A/Connectors 启动参数留 cfg.extraArgs 待01/03校准）；演示脚本草稿 v0（DEMO_SCRIPT.md）。
- 2026-09-20 接线完成：01契约 §13（CONTRACT-PREASSESSMENT.md FROZEN）与 03协议 v1.0 冻结后，Edge 接线落地——confirm-preassessment 白名单路由、候选历史读口、workspace.admission 二十格投影（新模块 admission-projection.mjs）、03 收口读面（finalization，参数映射+逐客户校验）；consumed-surface-v1.json 登记。新增测试 6 项，全套件 78/78 绿。
- 2026-09-20 诊断验收轮：三路交付后 takeoff-up 全栈装配跑通（48214 段+jw-takeoff-pg@15446+规则包激活）；**run-chain.mjs API 主链 53/53**（#26 T06 阻断为 D-03 缺陷模式放行）、**T07 技术失败 7/7**、**T11 重启恢复 10/10**（含账本跨重启复核 ZERO_CHANGE）。**D-03 已立案交01路**（见 DEFECTS_REPORT.md：确认门未消费 Gate 回执 HARD_BLOCK）。夹具 PDF DEF-03-01/二轮魔数序修复并经03探针验证。诊断库含运行碎片，最终快照验收前重置。
- 待办：①等01修 D-03 → 重置两库 → run-chain（无 D03 模式）+t11+t07 最终快照轮；②T01/T13/T14 页面级（浏览器两尺寸）；③性能数字；④收口四记录+演示定稿+归集三路清理证据。
