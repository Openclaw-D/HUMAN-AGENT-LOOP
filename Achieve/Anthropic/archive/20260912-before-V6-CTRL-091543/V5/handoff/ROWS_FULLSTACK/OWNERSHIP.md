# ROWS_FULLSTACK OWNERSHIP｜实际分工

更新：2026-09-11（主 Agent 维护，随实际派工更新）。

## 编组（用户授权多 sub-agent）

| Lane | 承担者 | 允许写入 | 禁止 |
| --- | --- | --- | --- |
| 主控/集成 | ZCode 主 Agent | `lib/v5-preview/shared-types.ts`、`V5/handoff/ROWS_FULLSTACK/**`（OWNERSHIP/CHECKPOINTS/REPORT/DEMO/evidence）、集成性协调 | worker 文件（集成例外须在 CHECKPOINTS 记录） |
| Frontend worker | 原生 sub-agent FE | `jianwei-v3/site/app/v5-preview/**`、`test/v5-preview.test.mjs` | lib/**、api/**、其他测试、v4life、authority |
| Backend worker | 原生 sub-agent BE | `jianwei-v3/site/lib/v5-preview/store.ts`、`service.ts`、`app/api/v5-preview/**` | shared-types.ts、前端文件、v4life、authority |
| Verification worker | 原生 sub-agent VERIF | `test/v5-preview-http.test.mjs`、`test/v5-preview-recovery.test.mjs`、`V5/handoff/ROWS_FULLSTACK/verification/**` | 前后端实现文件 |
| UX/review worker | 原生 sub-agent UX | `V5/handoff/ROWS_FULLSTACK/ux/**`（只读代码） | 任何实现文件 |

## Harness 限制的如实说明

- 浏览器截图：本 Harness 规定 Browser Use 仅主 Agent 可用，**浏览器实测与截图由主 Agent 执行**（串行，验证窗口预约）；UX worker 做只读代码审查与问题清单，不产截图。故实际浏览器 lane = 主 Agent，非 UX worker。
- 其余三路（FE/BE/VERIF）为真实独立 sub-agent 实现，非主 Agent 代写。

## 协调规则

- 接口/schema 变更：仅主 Agent；变更须更新 IMPLEMENTATION.md 并在 CHECKPOINTS 记录通知。
- 集成期缺陷：主 Agent 以复现证据退回 owner lane 修复；owner 不可用时由主 Agent 修复并在 CHECKPOINTS 记录单文件单 writer 例外。
- 所有 lane 不得 reset/clean/commit/push；不得触碰 v4life 核心、根部 authority、V4 文档、依赖。
