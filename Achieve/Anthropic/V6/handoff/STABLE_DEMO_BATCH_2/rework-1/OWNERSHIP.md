# rework-1 Ownership 记录

日期：2026-09-12。执行：ZCode 主 Agent（单 writer 串行，无 sub-agent 写入）。任务契约：`V6/ZCODE_BATCH_2_REWORK.md`。

## ZCode 本轮写入面（全部实际写入）

| 路径 | 性质 |
| --- | --- |
| `jianwei-v3/site/app/v5-preview/rows-logic.ts` | 产品（恢复记录纯逻辑 + 文案） |
| `jianwei-v3/site/app/v5-preview/page.tsx` | 产品（双通道恢复/确认重放/所有权/上下文门） |
| `jianwei-v3/site/app/v5-preview/todo-card.tsx` | 产品（恢复行不依赖待办状态 + 草稿修订） |
| `jianwei-v3/site/app/v5-preview/chat-panel.tsx` | 产品（消息恢复行 + 输入修订） |
| `jianwei-v3/site/app/v5-preview/preview.module.css` | 产品（恢复行样式类 +4 行） |
| `jianwei-v3/site/test/v5-preview.test.mjs` | 测试断言适配（新机制等价/更强） |
| `jianwei-v3/site/test/v5-preview-rework1.test.mjs` | 测试新增（12 项，先红后绿） |
| `V6/handoff/STABLE_DEMO_BATCH_2/rework-1/**` | 本轮证据/脚本/报告 |
| `V6/handoff/STABLE_DEMO_BATCH_2/REPORT.md` | 仅末尾追加导航（不改历史正文） |

## 零修改（SHA256 与返修前一致，见 evidence/post-rework-SHA256SUMS.txt 对照 pre-rework-snapshot/SHA256SUMS.txt）

`app/v5-preview/api-client.ts`、`app/v5-preview/domain-row.tsx`、`app/v5-preview/rows-view.tsx`、`lib/v5-preview/service.ts`、`lib/v5-preview/store.ts`、`test/v5-preview-v6fix.test.mjs`、`test/v5-preview-http.test.mjs`。

## 隔离副本与运行实例

- `jianwei-v3/site/.v6-runtime/`：本轮窄许可沿用（任务书授权）；已同步本轮 5 个产品文件（SHA256 一致）；独立 distDir `.next-v6-runtime`；`next build` 产物在其中。
- 3321（dev）：rework-1 数据目录 `rework-1/evidence/runtime-data/`；验收矩阵与 HTTP 验证在其中执行（含故障注入，全部合成数据）。
- 3399（**生产模式** `next start`）：数据目录 `rework-1/evidence/production-data/`；无开发按钮演示路径，保留运行供 Codex 验收。
- 3311 现场服务：**全程只读未动**（无 POST/seed/注入/重启）。

## 边界遵守

- 未操作 Codex（未发任务、未改设置/历史/Memory）；未 commit/push/tag/安装依赖/改生产配置。
- 未修改 V6 契约/任务包/CODEX_REVIEW 目录/根部 authority/历史 V4/V5。
- 冻结协议零变更；恢复记录为纯客户端待确认命令，未提升为服务端业务事实。
- 单文件单 writer；他人文件未触碰；旧验收证据未删除或改写（旧 REPORT 仅末尾追加导航）。
