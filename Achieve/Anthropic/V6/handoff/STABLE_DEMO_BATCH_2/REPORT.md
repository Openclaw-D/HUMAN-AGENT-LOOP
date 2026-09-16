# STABLE_DEMO_BATCH_2 REPORT｜业务横条演示完整稳定性收口

日期：2026-09-12。执行：ZCode 主 Agent（单 writer 串行；本批为同页联动点修，未派生 sub-agent，如实记录）。任务契约：`V6/ZCODE_STABLE_DEMO_BATCH_2.md`（未改写）。缺陷输入：`V6/CODEX_REVIEW_BATCH_1/REPORT.md` 五项 + 交付矩阵。
状态：**三个检查点全部完成，矩阵 8 行全过；停止等 Codex 独立验收。**

## 1｜修改文件清单（全部在允许写面内；副本哈希见 evidence/c0-snapshot/）

| 文件 | 本批修改 |
| --- | --- |
| `app/v5-preview/page.tsx` | CP2-1：refresh/写入/重放/seed 全入口经 `shouldApplyOverview` 版本门（旧 GET 晚到不回退；轮询失败保留画面固定中文）；CP2-2：未确认标记 `pendingNoteVisible`（sessionStorage 刷新存活，失败关闭）+ `onResolvePendingNote` 确认动作（刷新+原载荷重放确认）；CP2-5：情景切换确认卡（确认才 POST、取消不发写入、确认后未确认引用作废）；CP2-4：加载/写入/切换失败文案统一映射中文，不透传内部错误码 |
| `app/v5-preview/rows-logic.ts` | CP2-4：`isSafeServerMessage` 白名单（内部 ID/路径/堆栈形态拒绝）+ `userFacingErrorMessage`/`userFacingLoadError` 中文映射；CP2-1 门函数本批行为回归覆盖 |
| `app/v5-preview/api-client.ts` | CP2-4：writeOutcome 输出经统一映射 |
| `app/v5-preview/todo-card.tsx` | CP2-2：恢复条 PendingNoteRow（`hasPendingNote`/`onResolvePendingNote` props；待复核不开放新提交但确认可达；null 待办分支同样可达）；CP2-3：复核提示按 `relatedDomain` 派生 `{reviewerName}`；CP2-4：移除组件内错误码特判（统一层承担） |
| `app/v5-preview/chat-panel.tsx` | CP2-4 注释同步（文案由统一层承担） |
| `app/v5-preview/domain-row.tsx` | CP3：手机端 summary 收纳进"段名"展开区（`domainSummaryExpanded`），桌面常驻不变 |
| `app/v5-preview/rows-view.tsx` | CP3：进展行 aria 并入总体说明（手机端视觉隐藏后的无障碍补偿） |
| `app/v5-preview/preview.module.css` | CP3：手机（<900px）顶栏/抬头/进展/域卡紧凑化、summary 与总体说明收纳、域卡间距压缩；CP2-5 确认卡样式；CP2-2 恢复条样式；44px 触控延续 |
| `lib/v5-preview/service.ts` | CP2-4：NOT_FOUND 话术去除内部 todoId（错误码协议不变） |
| `lib/v5-preview/store.ts` | 本批**零修改**（第一批深递归校验已覆盖矩阵行 6，行为复验通过） |
| `test/v5-preview.test.mjs` | 断言适配（复核按域/恢复条/隔离白名单精确化：存储仅允许恢复条标记）22/22 |
| `test/v5-preview-v6fix.test.mjs` | 新增 5 项 CP2 真实行为回归（服务层真执行）26/26 |

隔离运行副本：`site/.v6-runtime/`（21 文件清单+演进说明见 CHECKPOINTS 检查点一；非 Git、独立 distDir/数据目录/端口 3321；复用 site 依赖，未装依赖未改生产配置）。收尾后将按"恢复方法"删除。

## 2｜逐项验收缺口闭合（对照 CODEX_REVIEW_BATCH_1）

| # | 缺口 | 闭合证据 |
| --- | --- | --- |
| 1 | P1 乱序 GET 回退（refresh 直赋值） | refresh 及全部入口经版本门；行为回归 v6fix「CP2-1 行为」+ 矩阵行 1（服务端 409 保证 + 门判定）；真实时序 DOM 注入受 IAB 能力限制，以服务端强制 409 + 门真值表等价覆盖（如实记录） |
| 2 | P1 待复核后未确认请求不可达 | 恢复条 + sessionStorage 刷新存活；**浏览器端到端实测闭环**：注入 fetch 丢失→真实落账→页面网络失败→草稿保留→原样重试命中幂等→待复核+恢复条→确认→条消失/标志清除/无新提交入口（b2-02/04/05） |
| 3 | P2 复核文案写死信审 | `{reviewerName}` 按 relatedDomain；v6fix 行为回归（资产提交后信审不指认）+ 浏览器待复核卡显示"信审复核中"（ approval 情景）|
| 4 | P2 异常透传内部细节 | 白名单映射 + 服务端话术清理；v6fix「CP2-4 行为」含内部 ID 拒绝真值表；NOT_FOUND 服务端 message 实测不含 todo-device-list |
| 5 | 验收缺真实端到端 | 本批矩阵 8 行全执行：HTTP 层 5 场景（matrix-verify）+ 隔离重启恢复 2 场景（isolated-restart）+ DOM 端到端 3 场景（丢失/切换确认/刷新存活），原始 JSON/截图全留证 |

## 3｜运行目录、端口与生命周期

- 现场 3311（PID 28568）：**全程只读未动**（无 POST/seed/注入/重启；时序与故障全部在隔离实例）。
- 隔离实例 3321：本批自起（site/.v6-runtime，数据 `evidence/runtime-data/`），当前仍运行（PID 18872）供验收复查；停止：`taskkill /PID 18872 /T /F`。
- 进程纪律：isolated-restart.mjs 只杀 3321 端口上本批实例（spawn 前核验端口归属），事件日志含每次 PID。

## 4｜未测项与已知限制（如实）

1. `test/v5-preview-http.test.mjs`/`recovery` 未直接运行（锁约束）；其覆盖语义已由隔离实例上的 matrix-verify（5 场景含幂等/冲突/损坏/恢复前置）与 isolated-restart（2 场景）等价执行——两脚本与套件断言同源，Codex 可在锁空闲时原样复跑套件。
2. 全部浏览器验证为 IAB 视口模拟（390/360/1920 均实测 innerWidth），**未用真机**；软键盘为虚拟键盘行为推断+44px 触控目标延续，未做真机键盘实测。
3. `Open Next.js Dev Tools` 按钮：dev 模式存在（`nextjs-portal`），生产构建（next start）不存在；本批未以 CSS 掩盖，如实记录——对外演示若用 dev server 则可见，建议演示路径用生产启动（部署级决定，超出本批）。
4. 手机端总体说明/域卡 summary 收纳进"段名"展开与 aria：信息不丢失（无障碍树完整），但视觉默认折叠——若验收认为改变了信息架构，属"显著重排"边界，可回退该压缩轮次（CSS 单点）。
5. lint 经 `--ignore-pattern ".v6-runtime/"`（临时副本非产品代码；收尾删除后裸 `npm run lint` 等价）；唯一 warning 为既有 v4life 文件。
6. `.v6-runtime/` 内有第一批遗留 `.next-isolated` 目录名未再使用（该方案已废弃），收尾清理时一并删除。

## 5｜恢复方法

- 产品代码回退：`evidence/c0-snapshot/` 内 15 文件原副本（SHA256SUMS）逐文件复制回去。
- 隔离副本清理：删除 `site/.v6-runtime/`（含独立 distDir）与 `V6/handoff/STABLE_DEMO_BATCH_2/evidence/runtime-data/`（合成数据）。
- 现场 3311：未触碰，无需恢复。

## 6｜停止

三检查点完成、矩阵全过、Gate 全绿（48/48、矩阵 5/5、重启 2/2、tsc 0、lint 0 error、build 0）。无未闭合缺陷、无越界需求。停止，等 Codex 独立验收。

---

## 追加导航（2026-09-12，rework-1）

本报告的交互恢复结论（矩阵行 2 的"刷新恢复条存活"、恢复相关端到端声明）已被 Codex 独立验收部分否决（`V6/CODEX_REVIEW_BATCH_2/REPORT.md`：R1/R2/R3 三项退回），并已由本轮返修替代：**`rework-1/REPORT.md`**（R1–R3 逐条修复 + 10 行浏览器验收矩阵 + 生产模式演示路径）。本报告其余部分（版本防回退、消息幂等、资产复核主体、手机首屏布局、隔离副本方案）经独立验收保留。本报告历史正文未改写。

## 追加导航（2026-09-12，rework-2）

rework-1 经独立验收为"有实质改善，尚未最终通过"（`V6/CODEX_REVIEW_REWORK_1/REPORT.md`：F1/P1 草稿关联被阻断提交覆盖、F2/P2 情景门比较错对象），已由本轮收口替代：**`rework-2/REPORT.md`**（F1/F2 修复 + 10 项真实浏览器矩阵 + 3399 生产重建验证）。本报告历史正文未改写。
