# STABLE_DEMO_BATCH_2 CHECKPOINTS

## 检查点一（完成）：隔离验证环境与行为复现

- C0：写面 15 文件快照+SHA256（`evidence/c0-snapshot/`），HEAD `63c41c3`、3311 PID 28568 只读。
- **隔离实例演进（三次尝试，最终方案）**：V6/handoff 下纯副本→（next 无法解析 node_modules）→ junction→（Turbopack 拒绝出树 symlink）→ **最终：副本位于 site 工程内 `site/.v6-runtime/`**（非 Git 未跟踪目录；turbopack root=site 真根、`distDir: .next-v6-runtime` 独立构建输出、数据目录 `V6/handoff/STABLE_DEMO_BATCH_2/evidence/runtime-data/` 独立、端口 3321 经检查空闲）。复制清单 21 文件（含 root layout/globals/config）：`evidence/c0-snapshot/runtime-copy-manifest.txt`。未复制凭据/真实数据/受保护历史；未改生产配置（site/next.config.ts 未动）；未安装依赖。
- 冒烟：GET 200（approval v7）、页面 200；3311 全程未动。
- 改前复现留证（`verification/repro-baseline.mjs` + `repro-baseline-result.json`）：原载荷重放命中重放（服务端侧 C 已修）；资产域 judgmentText 正确但**前端 todo-card 文案写死信审（UI 缺陷捕获）**；NOT_FOUND message 暴露内部 todoId（捕获）；乱序 GET 防回退与切换确认流为源码级缺陷（捕获）。

## 检查点二（完成）：交互可靠性修复（5 项全部落地 + 行为回归）

1. **CP2-1 全入口防回退**：page.tsx `refresh()`（首载/轮询/焦点/冲突刷新共用）与写入/重放/seed 响应全部经 `shouldApplyOverview` 版本门；旧响应丢弃。回归：v6fix「CP2-1 行为」+ 交付矩阵行 1（服务端保证 + 门判定）。
2. **CP2-2 未确认请求可恢复性**：`pendingNoteVisible` 状态 + sessionStorage 标记（刷新存活，失败关闭）；待复核时恢复条"确认结果"仍可达且不开放新提交（服务端 NOT_FOUND 兜底）。端到端（注入 fetch 丢失）：提交→网络失败→草稿保留→原样重试命中幂等→待复核+恢复条→确认→条消失标志清除。截图 b2-02/04/05。回归：v6fix「CP2-2 服务端行为」。
3. **CP2-3 复核提示按域**：`{reviewerName}` 由 `relatedDomain` 派生（信审/资产各自正确；未知域回退"相关专业域"）。服务端 `continue` 路径本就按 relatedDomain。回归：v6fix「CP2-3 服务端行为」（资产提交后信审不被指认）。
4. **CP2-4 错误统一中文**：`isSafeServerMessage` 白名单 + `userFacingErrorMessage/userFacingLoadError` 映射（内部字段/堆栈/路径/内部 ID 不透传；服务端 NOT_FOUND 话术同步去除内部 todoId）。回归：v6fix「CP2-4 行为」（含映射真值表）。
5. **CP2-5 情景切换确认流**：select 变更→确认卡（说明重置影响）→确认才 POST；取消不发写入（select 回弹）。确认后未确认引用作废（不污染新情景）。端到端截图 b2-03；DOM 验证取消后情景不变。回归：v6fix「CP2-5 服务端行为」。

## 检查点三（完成）：手机体验与交付验证

- **手机 390×844 首屏**：四轮压缩（顶栏/抬头/进展行紧凑、四域卡手机端收纳 summary 与总体说明进"段名"展开与 aria、间距收紧），最终待办标题 + "补充说明"按钮完整进入首屏（submitBottom=818 ≤ 844；改前 841/958/864 逐步）。截图 b2-01。360px 无溢出（iw=360 实测）。
- 桌面 1920×1080：布局不变、summary 常驻、无溢出（b2-07）。
- 段名展开（手机点击）、输入、失败重试、软键盘提交可达（44px 目标延续）：交互过程已在端到端中实际操作。
- **设备说明**：全部验证为桌面浏览器视口模拟（IAB），未用真机。
- **开发工具按钮**：`nextjs-portal`（Open Next.js Dev Tools）在 **dev 模式**存在；生产构建（next start/vinext start）不含。如实记录，未以 CSS 掩盖。
- 演示边界提示：顶栏一处（"合成演示数据，不执行正式审批"），无逐卡重复。

## 交付矩阵（8 行全执行）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| GET vN 延迟，新写入 vN+1 先到 | ✅ 服务端旧版本必 409 + 前端全入口版本门（dom-sequence + v6fix CP2-1） | verification/dom-seq-result.json |
| 说明/消息响应丢失→轮询→原样重试 | ✅ HTTP 矩阵 replayed=true 不重复；DOM 端到端闭环 | matrix-result.json + b2-02/04/05 |
| 同编号异载荷/旧版本 | ✅ 409 REQUEST_MISMATCH / 409 VERSION_CONFLICT，服务端不写入 | matrix-result.json 行 3 |
| 草稿/在途遇情景切换 | ✅ 取消不发写入（DOM 实测）；确认后旧请求 409 不污染 | b2-03 + matrix 行 4 + v6fix CP2-5 |
| 信审补充/资产巡检/已结清 | ✅ 各域提示正确、黄灯、结清 409 NO_OPEN_TODO | matrix 行 5 |
| 非法嵌套存储/非法缓存 | ✅ STORE_CORRUPT、文件逐字节不变、错误不含内部细节 | matrix 行 6 |
| 刷新/第二客户端/隔离服务重启 | ✅ 重启后逐字段恢复 + 幂等表恢复（isolated-restart 2/2）；刷新恢复条存活（DOM） | isolated-restart-result.json |
| 手机/桌面/键盘 | ✅ 390 首屏达标、360 无溢出、1920 可用（视口模拟，未用真机） | b2-01/06/07 |

## Gate 汇总（真实退出码）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元+行为 | `node --experimental-strip-types --test test/v5-preview.test.mjs test/v5-preview-v6fix.test.mjs` | **48/48**（FE 22 + v6fix 26，含本批 5 项行为回归）exit 0 |
| 真实 HTTP 矩阵 | `node V6/.../matrix-verify.mjs` | 5/5 PASS |
| 隔离重启恢复 | `node V6/.../isolated-restart.mjs` | 2/2 PASS |
| typecheck | `npm.cmd run typecheck` | 0 |
| lint | `npm.cmd run lint -- --ignore-pattern ".v6-runtime/"` | 0 error / 1 warning（既有 v4life） |
| build | `npm.cmd run build` | 0 |
| **未运行**：`test/v5-preview-http.test.mjs`、`test/v5-preview-recovery.test.mjs` | 原因：需自起 next dev 实例，现场 3311 持锁且契约禁中断；**其语义已由隔离实例上的 matrix-verify（5 场景）与 isolated-restart（2 场景）等价覆盖**（同源码、隔离端口/数据） | — |
