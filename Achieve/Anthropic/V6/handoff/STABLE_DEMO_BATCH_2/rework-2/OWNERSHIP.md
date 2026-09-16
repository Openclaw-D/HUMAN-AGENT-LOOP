# rework-2 Ownership 记录

日期：2026-09-12。执行：ZCode 主 Agent（单 writer 串行）。任务契约：`V6/ZCODE_REQUEST_OWNERSHIP_CLOSEOUT.md`。

## ZCode 本轮写入面（全部实际写入）

| 路径 | 性质 |
| --- | --- |
| `jianwei-v3/site/app/v5-preview/rows-logic.ts` | 产品（DraftRequestAssociation/shouldClearDraftForRequest、SubmitOutcome 携带 requestId、ResolveOutcome/stale、WriteOutcomePending 中间类型） |
| `jianwei-v3/site/app/v5-preview/page.tsx` | 产品（结果携带 requestId、情景门比对当前上下文、副作用先判所有权） |
| `jianwei-v3/site/app/v5-preview/todo-card.tsx` | 产品（draftAssocRef 按 requestId 建立、确认处置、反馈一致性清理） |
| `jianwei-v3/site/app/v5-preview/chat-panel.tsx` | 产品（同构） |
| `jianwei-v3/site/app/v5-preview/api-client.ts` | **4 行类型注解**：writeOutcome 返回类型改为中间结果 `WriteOutcomePending`（page 附加 requestId 后才是 SubmitOutcome）。属任务书"内部组件接口/辅助模块可在 app/v5-preview 内最小调整"许可；无 schema/端点/语义变化 |
| `jianwei-v3/site/test/v5-preview.test.mjs` | 断言适配（10 行：修订判定断言从 shouldClearDraftAfterConfirmation 迁至 shouldClearDraftForRequest） |
| `jianwei-v3/site/test/v5-preview-rework1.test.mjs` | 断言适配（8 行：同上 + 情景门 current.scenario） |
| `jianwei-v3/site/test/v5-preview-rework2.test.mjs` | 测试新增（5 项） |
| `V6/handoff/STABLE_DEMO_BATCH_2/rework-2/**` | 本轮证据/脚本/报告 |
| `V6/handoff/STABLE_DEMO_BATCH_2/REPORT.md` | 仅末尾追加导航 |

## 零修改（SHA256 与开工前一致）

`app/v5-preview/preview.module.css`（本轮无需样式变更）、`app/v5-preview/rows-view.tsx`、`app/v5-preview/domain-row.tsx`、`lib/v5-preview/service.ts`、`lib/v5-preview/store.ts`、`test/v5-preview-v6fix.test.mjs`、`test/v5-preview-http.test.mjs`。

## 复用的隔离条件与实例

- `site/.v6-runtime/`：窄复用（任务书许可），同步本轮 5 个产品文件（SHA256 见 `evidence/post-rework-SHA256SUMS.txt`，源码与副本逐一相同）；`next build` 产物在其中（构建前停止全部实例，未同时构建破坏服务中输出）。
- 3321 dev：rework-2 数据目录 `rework-2/evidence/runtime-data/`（浏览器矩阵 + HTTP 验证；故障注入全部合成）。
- 3399 生产：rework-2 重建后 `next start`（PID 28572），数据目录 `rework-2/evidence/production-data/`，保留运行供验收。
- 3311 现场（PID 28568）：全程只读未动。
- 实例管理纪律：每次停止前端口→PID→命令行归属核验（3311/3321/3399 的历史 PID 均未照抄使用）。

## 边界遵守

- 未操作 Codex；未 commit/push/tag/worktree；未安装依赖/部署/改生产配置。
- 未修改 V6 契约/任务包/CODEX_REVIEW 目录/根部 authority/历史版本。
- 冻结接口零变更（SubmitOutcome/ResolveOutcome 为 app/v5-preview 内部组件接口）；service/store 未动；未用情景门掩盖后端版本行为（版本单调保留）。
- 旧报告/证据未删除或改写；未清理旧证据目录；未回滚测试合成数据伪装未测。
