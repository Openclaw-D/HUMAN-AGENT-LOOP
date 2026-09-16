# SE_REBUILD_20260913 · 浏览器核验单（MAIN 执行）

- 产出者：QA sub-agent C（只产出脚本与清单，不操作浏览器）
- 执行者：MAIN（持有 3467 实例与浏览器）
- 对象：`http://127.0.0.1:3467/v5-preview`（`next dev`，合成 approval 种子）
- 配套脚本：同目录 `rect-measure.js`（浏览器 console/evaluate 直接整段粘贴执行，返回 JSON）

## 0. 前置条件

1. 3467 实例运行中；先 `POST /api/v5-preview/demo/seed {"scenario":"approval"}` 复位（或运行 `qa/behavior-regression.mjs`，其 cleanup 已复位）。
2. 浏览器使用设备仿真（Responsive 模式）精确设置 **CSS 像素视口**（不是窗口物理尺寸），依次四组：
   - 375×667、390×844、430×932、320×568
3. 每个尺寸：新开/刷新 `/v5-preview`（同尺寸下 reload），等页面出现"当前待办"卡（非骨架屏）后再执行脚本。
4. 执行 `rect-measure.js` 期间（约 70–80 秒，含 60 秒静置观测）：
   - 保持标签页**可见且聚焦**（rAF 与计时器在后台会被节流，影响 p95/请求数）；
   - 不要点击/滚动/输入页面；
   - 脚本会自动把主滚动区归位到顶部、确保"项目沟通"面板展开（会写一次 sessionStorage 偏好）、采样结束把展开行恢复为收起。
5. 结果 JSON 存放建议：`qa/capture/rect-<宽>x<高>-<before|after>.json`（例 `rect-390x844-before.json`）。脚本也会把结果挂到 `window.__jwRectReport` 并 console.log，可直接复制保存。
6. 每个尺寸可加一张整页截图作证据（可选，不作为判定输入）。

## 1. 每尺寸判定表（对应 rect-measure.js 返回的 `checks` 字段）

| # | 项目 | 判定字段 | 通过标准 |
|---|------|----------|----------|
| 1 | 无横向溢出 | `checks.noHorizontalOverflow`（明细 `overflow.horizontalOverflowPx`/`worstOffenders`） | `documentElement.scrollWidth <= innerWidth`（≤0；>0 时用 worstOffenders 定位元凶） |
| 2 | 矩阵四行实际可见 | `checks.fourDomainRowsFound` + `checks.everyRowIntersectsScrollAncestor`（明细 `domainRows[]`） | 找到 4 行且每行 `getBoundingClientRect` 与其滚动祖先交集非空（高、宽均 >0；不是只测外框） |
| 3 | 顶部→待办区块高度 | `checks.todoBottomFromViewportTopPx` / `todoBottomInRange350to370`（明细 `todo.topFromViewportTopPx` 等） | 待办区块底边距视口顶 **350–370px**（scrollTop=0 下实测；同时记录 top 值供参考） |
| 4 | 沟通区含输入高度 | `checks.chatHeightPx` / `chatHeightInRange290to310`（明细 `chat.rect`、`chat.input`、`chat.sendButton`） | 面板展开（含输入行）总高 **290–310px** |
| 5 | 展开域行 hit area | `checks.minToggleHitHeightPx` / `visibleTogglesMeet44px`（明细 `hitAreas.perCard[]`） | 可见展开控件 hit 高度 **≥44px**（四行取最小值） |
| 6 | 30 次展开/收起延迟 | `checks.toggleLatencyP95Ms`（明细 `toggleLatency.syncDispatch.p50/p95`、`toNextPaint`、`raw`、`flipFailures`） | 记录 p50/p95，**无硬阈值**；要求 `flipFailures===0`（每次点击 aria-expanded 必须翻转）；用于 before/after 对照 |
| 7 | 60 秒静置请求数 | `checks.idleApiRequests60s`（明细 `idleRequests.entries[]`、`apiUrls`） | 记录 api 与非 api 新请求数；旧代码基线预期约 15 次（4s 轮询 ×15）；重构后不得**增加**，并用于 PERF_PLAN 前后对照 |

## 2. 旧代码基线（before）与新代码验收（after）的差异

- **before（旧代码，现在）**：只采集记录，不按第 1–5 项范围判定（旧代码本就不是目标布局）。已知旧代码行为：
  - `@media (max-width:480px)` 下 `.segToggle{display:none}`（四尺寸全部 ≤480px）→ 第 5、6 项会得到 `toggleVisible:false`、`toggleLatency.skipped:true`，**属预期**，如实记录即可；
  - 页面每 4s 轮询一次 GET project → 第 7 项约 15 次/60s；
  - before 数据同时是 PERF_PLAN 的 M4/M5 输入，请按第 0.5 条命名保存。
- **after（新代码同步后）**：第 1–5 项全部按表判定通过才算布局验收通过；第 6、7 项记录并对照 before。运行前先过 `qa/source-runtime-check.mjs`（确保 3467 跑的确实是新代码）。

## 3. 快速执行序列（每个尺寸重复）

1. 设备仿真设为 `<宽>×<高>`；
2. 打开/刷新 `http://127.0.0.1:3467/v5-preview`，等待"当前待办"卡出现；
3. console 粘贴整段 `rect-measure.js`，等待 Promise 返回（~75s，期间勿动页面）；
4. 保存返回的 JSON 到 `qa/capture/rect-<宽>x<高>-<before|after>.json`；
5. 核对 `checks.*`，对照上表记录通过/失败。

## 4. 已知注意事项

- 320×568 下若出现横向溢出，优先看 `overflow.worstOffenders`（常见为进度条 track、点阵行、消息 header 换行）。
- 若 `warnings` 含"就绪超时"，先确认实例与路由正常（可先跑 `qa/behavior-regression.mjs` 验证 API 面），再重试；不要在骨架屏/错误卡状态下采数。
- `document.visibilityState` 若在 idleRequests 期间出现 `hidden`，该次请求数与 p95 数据作废重测。
- 本清单所有数字均为 **next dev 开发模式实测**，仅用于同机同模式前后对照，不得对外表述为生产性能。
