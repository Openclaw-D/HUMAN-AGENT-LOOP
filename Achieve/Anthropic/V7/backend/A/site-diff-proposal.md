# V7 → site 接线 diff proposal（只提案；未经用户基线授权不接线、不部署）

日期：2026-09-15 05:5x。提案人：A 路。基线事实：`jianwei-v3/site` 最近提交 63c41c3（旧归档），工作区大量 V4→V6 历史差异（与 V5/backend B0_BASELINE_MANIFEST 记录同源）；**本提案在用户完成 Git 基线操作（scoped commit 或归档分支）之前不执行**。

## 原则

1. 全部为**新增文件 + 两处窄注册**，零既有文件行为修改；V7 后端作为 site 的附属 API 命名空间（`/api/v7/**`）并存，不影响 `/api/v5-preview/**` 与首页。
2. 身份门：接线默认**不配置** `V7_A_PRINCIPAL_TOKENS` → 正式动作失败关闭（安全默认）；生产身份源接入另行授权。

## 新增文件（全部自 `V7/backend/` 拷入，逐文件 hash 以拷贝日 `manifest-hashes.sha256` 为准）

```
+ site/lib/v7/store.mjs            ← V7/backend/A/src/store.mjs
+ site/lib/v7/service.mjs          ← V7/backend/A/src/service.mjs
+ site/lib/v7/shared-types.d.ts    （如需 JSDoc 外显；可选）
+ site/app/api/v7/health/route.ts            ← 包装 A src/server.mjs 的对应 handler
+ site/app/api/v7/projects/route.ts
+ site/app/api/v7/projects/[projectId]/route.ts
+ site/app/api/v7/projects/[projectId]/evidence/route.ts
+ site/app/api/v7/projects/[projectId]/evidence/[evidenceId]/supersede/route.ts
+ site/app/api/v7/rules/route.ts
+ site/app/api/v7/rules/[version]/route.ts
+ site/app/api/v7/projects/[projectId]/runs/route.ts
+ site/app/api/v7/runs/[runId]/route.ts
+ site/app/api/v7/runs/[runId]/opinions/route.ts
+ site/app/api/v7/runs/[runId]/calculation/route.ts
+ site/app/api/v7/runs/[runId]/state/route.ts
+ site/app/api/v7/runs/[runId]/human-actions/route.ts
+ site/app/api/v7/receipts/[requestId]/route.ts
```

- site 侧实现形态二选一（接线时按当时 site 约定裁决）：
  - **A. 独立进程**（现组合原样）：site 仅加一个反代/展示页，V7 服务照旧 `node src/server.mjs` 跑在 3601——零 site 代码改动，仅加页面。
  - **B. 进程内 route**：上列 17 个 route 文件把 handler 指向 `lib/v7/service.mjs`（数据目录 `site/.v7-data/`，加入 site `.gitignore`）；`next.config` 无需改动（无新依赖）。

## 修改文件（窄注册，2 处）

```
M site/package.json   → 无依赖变更；可选加 "v7": "node lib/v7/server.mjs" 类脚本（方案 A 不需要）
M site/.gitignore     → 追加 ".v7-data/"（方案 B）
```

## 不做

- 不改 `app/v5-preview/**`、首页 `home/**`、CSS、既有 API。
- 不把 V7 路由挂进任何现有页面导航（前端消费另行提案）。
- 不配置生产 principal token（正式动作保持失败关闭直至身份源授权）。

## 验收门（接线时）

1. 基线门：用户完成 Git 归档点并明确批准本提案。
2. 拷贝后 `diff` hash 对账 + site `npm test/typecheck/build` 全绿（V7 无测试冲突面）。
3. 冒烟：`curl /api/v7/health` + 一轮 `demo.mjs`（隔离数据目录）。
