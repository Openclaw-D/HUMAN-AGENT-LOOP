# INTEGRATION｜MAIN 实际轨迹接入状态（R3_EVAL_20260913）

## 接口（已冻结，等 MAIN 接收）

1. **轨迹导出**：MAIN 对隔离运行后的 `remote-store.json` 执行
   `node V6/handoff/R3_EVAL_20260913/tools/export-trajectory-from-store.mjs --store <store> --session <sessionId> --out <文件>`
   （时间线来源可选 `--timeline-from session|store`；待办投影可选 `--todos`）。导出文件放入
   `V6/handoff/R3_EVAL_20260913/trajectories/main-export/`，回放：
   `node tools/replay-cli.mjs replay --trajectory trajectories/main-export/<文件>`。
2. **手机量测**：MAIN 按 `docs/MOBILE_MEASUREMENT_SCHEMA.md` 产出量测 JSON，交
   `node tools/mobile-measure-check.mjs --measurement <文件>`。只交截图 → BLOCKED。
3. schema 变更请求走新批次文档，不直接改冻结 schema。

## 当前状态（截至本轮收束）

| 项 | 状态 |
| --- | --- |
| MAIN R3 handoff 目录（`handoff/R3_MAIN_20260913/`） | **尚不存在**（MAIN R3 未启动或未落盘） |
| 已接收 MAIN 来源轨迹 | **0 条**（要求 ≥3） |
| 导出→回放链路演练 | ✅ 以 pos-1 合成夹具经 exporter→replay 全链路走通（`trajectories/main-export/demo-synthetic-roundtrip.json`，文件内显著标注"合成演练，非MAIN产出"；evidence-r3/exporter-roundtrip.txt） |
| 集成判定 | **INTEGRATION BLOCKED（等待 MAIN 轨迹与量测）**——按 Goal DoD："至少三条 MAIN 来源可追踪轨迹，否则整体闭环不接受"。本路工具侧已就绪，未把分镜/手写控制当实现或当 MAIN 证据 |

## MAIN 接入后 C 路将执行的回放清单（就绪待命）

1. 总览→访谈→文字提示→草稿纠偏→人工确认→挂断→聊天待办（对应 R-HANG/R-CORRECT/R-OPIN 全链）
2. 暂停迟到响应（R-LATE/R-PRE）
3. 证据更新失效 + 两会话隔离（R-VER/R-SESS）
（与 MAIN DoD 的合成端到端清单一一对应；每条输出 trajectory-verdict@1 逐规则判定与故障定位到事件/版本。）
