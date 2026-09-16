# 见微 V4 项目级文档

状态：`P4 FUNCTIONAL CANDIDATE ACCEPTED / ALL GATES GREEN / P1-01 CONTENT NEXT`

全局产品 authority 位于工作区根部：

- `../../../../NORTH_STAR.md`
- `../../../../DECISIONS.md`
- `../../../../CHALLENGE_LOG.md`
- `../../../../ROADMAP.md`

本目录只记录 `jianwei-v3/site` 的具体实现契约与验收证据：

- `CONTRACT.md`：schema、state、API、authority、persistence、idempotency 和 failure contract。
- `ACCEPTANCE.md`：测试、构建、HTTP、浏览器、恢复和 E2E Gate。
- `ZCODE_BACKEND_GOAL.md`：当前后端垂直切片执行书。
- `ZCODE_CONCURRENCY_TRIAL.md`：一次 20 路受控并发试验追加书。
- `ZCODE_OVERNIGHT_WORKSPACE_GOAL.md`：后端 Gate 后连续进入 `/work` 四域作业工作台的整夜执行书。
- `BACKEND_PROGRESS.md`：四路交付、优化 Wave（持久化/SSE/防护/门禁/journal）与 correction checkpoint 证据。
- `ZCODE_RUN_STATUS.md`：运行状态唯一快照（ZCode 主 Agent 写，Codex 验收结论回写）。
- `P1_SCHEMA_EXTENSION_PROPOSAL.md`：P1-01 引擎语义扩展设计与 §11 待确认清单（CANDIDATE）。
- `ZCODE_CONTROL_CHANNEL.md`：Codex→ZCode 双文件控制协议。

旧 V4 P0/P1 文档完整保存在 `../archive/v4-pre-life-20260902/`，只作 Candidate 和差异审计材料。
