# STABLE_DEMO_BATCH_2 OWNERSHIP

更新：2026-09-12。本批为 ZCode 单 writer 串行实施（检查点一~三均为同页联动小范围点修，无并行 lane；如实记录，不虚构委派）。

| 范围 | writer | 说明 |
| --- | --- | --- |
| `site/app/v5-preview/**`、`site/lib/v5-preview/{service,store}.ts`（含 api-client.ts/rows-logic.ts，任务书明确列入） | ZCode 主 Agent | 允许提取最小请求状态辅助模块 |
| `site/test/v5-preview*.test.mjs`、本批验证脚本 | ZCode 主 Agent | 共享类型与既有 API 字段不变 |
| `V6/handoff/STABLE_DEMO_BATCH_2/**` | ZCode 主 Agent | OWNERSHIP/CHECKPOINTS/REPORT/运行说明/evidence/runtime/screenshots |
| V6 契约/任务包/HANDOFF/CODEX_REVIEW_BATCH_1/根部治理 | Codex | ZCode 不写；不覆盖旧批证据 |

## 隔离验证环境（检查点一）

- 运行副本：`V6/handoff/STABLE_DEMO_BATCH_2/runtime/site/`（非 Git 临时副本，仅当前演示所需源码；复用 site 已安装依赖，不复制 node_modules）。
- 端口 3321（spawn 前核验空闲）；独立数据目录 runtime/site/.v5-preview-data。
- 3311 现场服务（PID 28568）：**只读**（GET/查看），禁 POST/seed/故障注入/重启/清空。
