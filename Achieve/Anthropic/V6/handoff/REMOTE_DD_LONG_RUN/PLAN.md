# PLAN｜REMOTE_DD_LONG_RUN

startedAt：2026-09-12 23:31。收口不早于 07:31、硬上限 09:31（09-13）；提前达 DoD 即结束。循环 20–60 分钟：读契约现场 → 选目标 → 最小实现 → 测试/观察 → 证据 → 修正。

## 阶段顺序（预计，非小时硬摊）

- **P0（23:31–23:59）**：复验 64/64 ✅；快照+SHA256 ✅；BASELINE/INTERFACE/OWNERSHIP/PLAN ✅；STATUS 建立并按 30–60min 更新。
- **P1（00:00–02:00）**：remote-types/remote-store/remote-service → 8 个 remote-* 路由 → 会议页骨架（参与者/出席/视频 not_configured/模拟显式开关）→ 概览入口 → 双端布局 → 截图自查。
- **P2（02:00–04:30）**：fixture 证据附着 → 圈选标疑（归一化坐标、缩放不变）→ 追问回复 → 复核+版本过期 → 核算 not_configured/负收益 fixture 阻断 → 回归测试（幂等/冲突/陈旧/悬空拒绝）。
- **P3（04:30–06:00）**：六角色模拟链路（SIMULATION 标注的确定性 stub 后续追问）→ READY_FOR_INTEGRATION.md（真实模型/视频所需参数与协议草案）→ Dify 适配 vs 薄代码候选比较（仅文档+协议层，不接管 Dify）。
- **P4（06:00–07:30）**：故障矩阵（重复提交/旧回执/跨会话污染/非法圈选/模型格式错误/断网前后）→ 高价值缺陷修复 → 一项受控探索（候选：下一问价值/证据来源关联）。
- **P5（07:30–09:00）**：全量 Gate（tests/typecheck/lint/build/HTTP/浏览器）→ METRICS.md/EXPLORATIONS.md → REPORT.md → 恢复说明与遗留清单。

## 本轮明确不做

真实模型调用（无凭证，modelCalls=0）、真实视频/媒体、自动采集/录音/OCR、三维重建、完整定价引擎、生产鉴权、Dify 写面、Codex 操作、commit/push。

## 风险与纠偏

- Harness 终止/额度不足 → 立即保全 STATUS+证据，如实说明，不称后台仍在跑。
- 用户纠偏 → 停止领取新步骤 → 记录在途 → DIRECTION_CHANGE.md → 小范围授权内继续。
- 全部事项被同一硬阻塞卡住 → 结束为 BLOCKED，不空转。
