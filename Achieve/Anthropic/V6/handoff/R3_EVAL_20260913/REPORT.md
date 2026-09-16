# REPORT｜R3 任务C（产品轨迹回放验收）

日期：2026-09-13。写面仅 `V6/handoff/R3_EVAL_20260913/`；R2 批次只读（回归仅用其零写入 selftest）；产品由 MAIN 写，本路零产品代码改动。真实模型调用 0。

## 交付（对应 Goal 交付节）

| 交付 | 文件 | 状态 |
| --- | --- | --- |
| SCHEMA | docs/TRAJECTORY_SCHEMA.md（product-trajectory@1，字段对齐产品 remote-types/remote-timeline）、docs/MOBILE_MEASUREMENT_SCHEMA.md | 冻结 |
| 测试与回放CLI | tools/replay-cli.mjs（replay/selftest/metamorphic/manifest；字段允许名单失败关闭；来源标记与目录双校验）、tools/export-trajectory-from-store.mjs（MAIN 零成本导出器）、tools/mobile-measure-check.mjs | 完成 |
| 风险覆盖矩阵 | RISK_MATRIX.md（12 风险 × 正控/负控/变换断言/人工未判） | 完成 |
| MAIN 实际接入证据 | INTEGRATION.md：**INTEGRATION BLOCKED**——MAIN R3 目录尚不存在、收到 0 条轨迹（要求≥3）；导出→回放链路已用合成夹具全链路走通并显著标注"合成演练" | 就绪待 MAIN |
| 手机验收报告 | MOBILE_ACCEPTANCE.md：检查器经 5 夹具验证（1 PASS + 4 FAIL 各定位单一字段）；MAIN 真实量测 **BLOCKED 未收到** | 检查器就绪 |
| 收束 | STATUS / MORNING_REPORT / AGENT_LEDGER / MANIFEST | 冻结 |

## 验证结果（实测）

- **R3 回放 selftest：32/32，exit 0**——3 正例全规则 pass/violation=0；9 负例各自精确触发 expectedRule 且零误伤；8 项 metamorphic 断言全过。
- **metamorphic：8/8**——T1 事件重复幂等不变、T2 重排不变、T3 缺版本/T4 错会话/T5 迟到暂停/T6 分歧去重丢失/T7 挂断待办丢失/T8 无授权规则升级各自精准翻转目标规则。
- **R2 回归：109/109，exit 0**（仅运行 R2 零写入 selftest；未重跑会写 evidence 的命令，R2 冻结件零污染）。
- **手机检查器**：5 夹具判定全符合预期（PASS 1 / FAIL 4，各定位单一字段；含 Codex 指出的 442×961 DPR0.91 缩放冒称复现）。
- **导出→回放链路**：exporter→replay 全链路走通；`product_export` 路径守卫实测拒绝非 MAIN 目录来源（失败关闭）。
- 误报/漏报/未判：控制组层面 0 误报（pos 全过、neg 零连带——首轮 4 处连带/代次标定问题已修）、漏报 0（每负例必被目标规则捕获）、未判项显式路由（R-PRE 阶段未知、R-CORRECT 无确认）。

## 覆盖与边界

- 风险覆盖与人工未判项：RISK_MATRIX.md。判定四态 pass/violation/undecided/na，无综合信用分。
- 结构判定不声称语义完备：意见裁定质量、纠偏语义等由人工终审（UNDECIDED 路由）。
- 手写轨迹单列于 `trajectories/handwritten/`（source=handwritten 双校验），**不代表产品已执行**；产品结论只认 `trajectories/main-export/` 的 product_export 轨迹（当前 0 条 → 闭环不接受，如实报告）。

## Subagent（详见 AGENT_LEDGER.md）

SA-1（手写轨迹控制组，晚到完成并以规格版覆盖主agent接管稿——最终以 SA-1 版为准，selftest 32/32 实测采信）、SA-10（手机量测夹具×5）。并发峰值 2（合规）；无新限流事件。

## NOT TESTED

真实模型质量、真机 Safari（iPhone 17 DPR3）、真实 ASR/视频/相机、MAIN 产品真实运行轨迹回放（等 MAIN）、生产鉴权/部署。所有候选待 Codex 复验与用户视觉接受，visual_accepted=false。
