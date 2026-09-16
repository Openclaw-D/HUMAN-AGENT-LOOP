# P1 前后端连调检查

日期：2026-08-27（Asia/Shanghai）。这是 T3 复验证据与服务状态，不宣布 P1/P2。

## 当前稳定服务

- 4178：PID 16572，`node.exe serve.mjs`，cwd=`prototype\p1-frontend`。
- 4179：PID 26632，`node.exe runtime\p1\src\server.mjs --port 4179 --db C:\Users\22673\Desktop\Anthropic\integration\p1\runtime\p1.sqlite`。
- 两者仅监听 loopback；4178 只代理 `/api/v1/**` 到固定 `127.0.0.1:4179`。4177 未触碰。
- 日志：`runtime/frontend-4178.out.log`、`runtime/frontend-4178.err.log`、`runtime/backend-4179.out.log`、`runtime/backend-4179.err.log`。

## D / E 后端修复复验

检查点 D 已允许合法多 Run 历史重启；检查点 E（`runtime\p1\evidence\BACKEND_CHECKS.md` §12）已修复 Event replay 不应把 system/connector 写成 `currentActor` 的问题，并归一化历史 interaction 的固定次数文案。T3 没有修改后端。

本任务先精确停止旧 4179 PID 22864，再用同一 `integration\p1\runtime\p1.sqlite` 启动修复后代码。经 4178 代理读取：

- risk：`currentActorId=risk-owner`、owner 也是 `risk-owner`、`availableCommands` 含 `append_message`；Receipt 仍为 `unknown`，最后 connector Event 没有夺取 currentActor。
- interaction：`currentActorId=interaction-owner`、owner 相同；历史仍为 v10/cursor10、4 Runs；stage/matrix 不含 `One explicit` 固定次数文案。
- UI 上 risk Composer 可用；普通 Message 成功 v7 → v8，未新增 Agent Run。关系视图的最强黑色边框和阴影落在 `Risk Owner` Human 节点，而非 connector。显式“继续 Agent”仍是独立入口；Handoff/Gate 等权限继续由后端 `availableCommands` 和 Command policy 控制，前端没有绕过入口。

## 既有 T3 回归证据

- interaction 的普通 Message、显式 Run、代理幂等重放、stale 409 零写入、同库重启已在 D 修复后复验：最终 interaction v10/cursor10、10 Events、4 Runs、Gate=`needs_evidence`、Receipt=`null`。
- 前端 `node --check app.js`、`node --check serve.mjs`、`node verify.mjs`：9/9 PASS。
- 后端只读复跑（D 后）：`node --test test/core.test.mjs test/http.test.mjs`：2 pass / 0 fail；`node scripts/verify.mjs`：`ok:true`、`restartReplayEqual:true`、`selectorsShareProjection:true`。
- 三个 active Work 均为完整 `fixture:false` Projection 且 version=cursor；catalog-only 场景只显示“暂无真实协同事项／仅目录”。后端不可用时，4178 显示 `PROJECTION_UNAVAILABLE`，不会 fallback fixture。

## E 后正式物理浏览器证据

旧的四张正式图已作废并被以下 E 后真实 Projection 图覆盖：

- `evidence/real-risk-progress-1920x1080.png`：risk v8，完整顶部、进度画布与右侧接续台。
- `evidence/real-risk-relation-1920x1080.png`：risk v8，`Risk Owner` 是当前 Human owner 的最强高亮。
- `evidence/real-risk-matrix-1920x1080.png`：risk v8，完整矩阵与右侧接续台。
- `evidence/interaction-continuation-density-1920x1080.png`：interaction v10 / 4 Runs；无 `One explicit` 文案，右侧接续台完整。

四张 PNG 均由 `Page.captureScreenshot` 生成，物理像素均为 1920×1080。为得到该物理尺寸，CDP 临时请求 metrics：width=1920、height=1080、deviceScaleFactor=1。受本机 in-app Browser 宿主缩放影响，页面实际报告 CSS viewport=1271×715、`window.devicePixelRatio≈1.51`、`scrollWidth/scrollHeight=1271×715`；这些 CSS 数值不是 PNG 像素。页面没有水平或页面级垂直溢出，四图目视确认顶部、左画布、右接续台完整可见，console error=0。临时 CDP metrics 已清除。

### progress 单项视觉复核（04:11 后）

总控指出旧 progress PNG 只含左画布。使用同一浏览器 tab、同一 CDP metrics 与截图命令，实时 progress 页面测得：`.workspace` x=0..1271.52，`.canvas` x=0..1017.22，`.continuation`（右侧 dock）x=1017.22..1271.52；dock 明确落在 viewport 内。实际 selector 中不存在 `.workspace-shell`，所以记录 `.workspace`、`.canvas`、`.continuation`。

根因是 `.progress` 的 `min-width:720px` 让截图渲染表面仅保留左侧；没有后端或数据问题。最小前端修复为新增 `progress-fix.css`，覆盖 `.progress{min-width:0}`，不改变 80/20 主布局。修复后同一实时 risk+progress 页面：CSS viewport=1271×715、DPR≈1.51、scrollWidth/scrollHeight=1271×715，dock rect=1017.22..1271.52，console error=0。已覆盖 `real-risk-progress-1920x1080.png`，物理 1920×1080、SHA-256=`7B49AC29F53C724F39DCB641D19AA2544798E11A3EAAB0034AB622584A716A24`；原始查看确认顶部、完整进度画布和右侧接续台均在图内。

## 遗留限制

- 仅前三个 sample 场景可执行；其余七个仍是 catalog-only。
- 未做认证、TLS、部署、外部 connector 或 P2 工作。
- 这是 `dataOrigin:sample` 本地证据，非客户、生产或外部成功声明。
- 后端检查点 E 已披露的两个 SQLite sidecar 是非阻塞测试残留，按总控指令保留；本任务未清理或修改它们。
