# 技术栈与运行边界

状态：`PROJECT-LEVEL IMPLEMENTATION INVENTORY / SUBORDINATE TO V4-LIFE`

本文件只记录 `jianwei-v3/site` 的真实技术现状，不决定产品 North Star、组织 authority 或未来路线。旧 V3/P0/P1 内容需在实现前与 `docs/v4/CONTRACT.md` 做差异审计。

## Runtime

- Node.js `>=22.13.0`
- TypeScript `5.9.3`，ESM
- React `19.2.6`
- Next.js `16.2.6` App Router 代码结构
- Vinext `1.0.0-beta.3`
- Vite `8.0.13`
- Cloudflare Vite plugin、Wrangler、OpenAI Sites Vite plugin

Vinext 把 Next App Router 风格页面和 Route Handlers 构建到 Vite/Worker 兼容运行时。`.openai/hosting.json` 是 Sites 项目构建元数据，不包含模型凭据；D1/R2 当前均未绑定。

## 前端

- React client workbench；
- CSS 三列响应式壳，1920×1080 为桌面验收基线；
- SVG 全域关系图谱，支持缩放、平移、拖节点、聚焦和适应画布；
- 后端 Projection 驱动四板块、二十流程、矩阵、接续摘要和 Receipt；
- 无独立状态管理依赖，避免演示期过度架构。

## 后端

- Web `Request/Response` Route Handlers；
- `lib/domain.ts` 组装公开 Projection 和 Context Packet；
- `lib/authority-event-ledger.ts` 维护进程期 append-only Authority Event、Canonical 签名和 sequence 分页；
- `lib/stage-run-runtime.ts` 记录四板块对共享 Context Version 的候选处理身份与顺序；
- `lib/evidence-runtime.ts` 接受 Canonical Evidence、维护幂等和 Context Version；
- `lib/shared-context-projection.ts` 派生四板块共享版本和顺序准备度；
- `lib/decision-runtime.ts` 记录具名 Human Gate Receipt；
- `lib/product-model.ts` 封装可选产品模型、超时和失败映射；
- `lib/bounded-json-body.ts` 限制请求体，防止无界 JSON 读取；
- `lib/policy-workspaces.ts` / `lib/flow-workspaces.ts` 定义二十个差异化工作页。

## 状态与一致性

当前所有状态都在进程内 Map 中：

- requestId / evidenceId 幂等；
- Evidence Receipt、Context Version；
- candidate messages；
- confirmed facts；
- Human Gate Decision Receipts；
- append-only Authority Events；
- 每个 Context Version 对应的四路 Stage Run Records。

`GET /api/cases/:caseId/events` 只读分页返回进程期事件；公开 Projection 的 `runtimeAudit` 回报事件数和 Stage Run 数，供一致性验收使用。

这是本地演示实现，不是生产持久化。生产试点至少需要：事务数据库或事件账本、唯一约束、事件重放、认证/RBAC、租户/事项隔离、审计、备份恢复和保留策略。

不能简单用 LRU 淘汰已经接受的 requestId/evidenceId，否则同一进程期可能复用权威标识并破坏幂等。生产应通过持久化、业务保留期和归档策略解决增长问题。

## 模型

- Endpoint：`https://api.z.ai/api/paas/v4/chat/completions`
- 默认模型：`glm-5`
- 产品凭据：`JIANWEI_MODEL_API_KEY`
- 模型名覆盖：`JIANWEI_MODEL_NAME`
- 默认超时：25 秒

未配置产品凭据时使用 deterministic local candidate inference 并明确标注。live GLM 产品链路当前未验证。Coding worker 的 `ZAI_API_KEY` 不得进入产品代码、环境、日志或文档。

## 质量工具

- Node test runner：领域、流程、Evidence、Authority Event、Stage Run、共享投影、Human Gate、模型稳定性；
- `npm.cmd run typecheck`：TypeScript 静态类型检查；
- ESLint；
- Vinext production build；
- `scripts/http-quality-gate.mjs`：API 正常、错误、重放、冲突和并发；
- `scripts/http-mixed-soak.mjs`：混合负载与预期注入失败；
- Codex in-app Browser：1920×1080 视觉、交互和 console 验收。

性能数据只用于本机前后对比，不外推生产吞吐或 SLA。

当前四板块 `completedStepCount` 是合成演示 fixture；Decision Receipt 也尚未自动驱动完整板块 authority transition。Authority Event 与 Stage Run 虽已在进程期追加和查询，但没有事务数据库、跨重启恢复、RBAC 或保留策略。它们都属于演示内核，不是当前已完成的生产工作流引擎。

## 未引入

- 数据库 / ORM；
- 身份认证、组织目录、RBAC；
- 队列或工作流引擎；
- 真实集团 Adapter；
- 生产可观测性与部署流水线；
- 移动端原生应用；
- 额外状态管理、图数据库或 Agent 框架。

这些能力只有在对应 Roadmap Gate 通过后再引入。

## 2026-09-04 新增（V4-LIFE 切片）

- `lib/v4life/`：事件溯源四域内核（进程内演示态）+ event-log/replay + 命令幂等（commandId）+ 乐观并发（expectedRev/rev=事件数）+ 追加事件账本。
- `app/api/v4life/`：6 个 Route Handler（projection/evidence/work/decisions/events/reset），错误 envelope `{error: CODE}`。
- `app/work/`：role-aware responsive 工作台（workspace-contract/workspace-model/business/domains/inspection/WorkShell/CaseChat），无新依赖，React 内建状态。
- 质量工具：`test/v4life-*.test.mjs`（node --test strip-types）、`scripts/v4life-http-quality.mjs`（进程内 27 步）。
