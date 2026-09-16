# F0 REPORT｜V5 前端 F0：双端总览与详情预览（合成）

日期：2026-09-07。执行：ZCode / Anthropic / NEW。任务书：`V5/ZCODE_FRONTEND_TASK.md`（Codex 持有，未改写）。
状态：**首次可交互预览完成，停止等待用户/Codex 观察；不续跑 F1、B1 或全域细化。**

## 1｜现状记录与 ownership（开工前）

- 基线快照：`evidence/01-baseline-snapshot.txt`——HEAD `63c41c3db138215d40470098d80c405f2a6fd679`（V3 archive，未变），branch main，porcelain 79 条（与 B0 gate-time/rev1 快照一致，无漂移）。
- `app/v5-preview` 与 `V5/frontend/F0` 开工前均不存在（已核实）；本轮为纯新增，未触碰任何既有文件。收尾快照 `evidence/08-after-f0-snapshot.txt` 与基线 diff 仅多两条 `??` 新路径。
- 本轮写面：`site/app/v5-preview/**`、`site/test/v5-preview.test.mjs`、`V5/frontend/F0/**`。任务书、B0 文件、`V5/CONTEXT_LOG.md`（按任务书由 Codex 收口）、Memory 均未写。未操作 Codex，未 git add/commit/tag，未动 3100/3101。

## 2｜交付物清单（全部新增）

| 文件 | 内容 |
| --- | --- |
| `app/v5-preview/page.tsx` | 路由壳：布局切换（自动/手机/横屏）、视图切换（总览/详情，URL 同步+浏览器返回）、预览控制条（视角切换·非认证、重置演示）、常驻「交互预览 · 合成数据」标注 |
| `app/v5-preview/preview-state.tsx` | 合成状态层 + React 接线；`V5-PREVIEW-PURE-LOGIC` 标记区间为纯逻辑（reducer/派生/持久化解析），供行为测试真实执行 |
| `app/v5-preview/overview-mobile.tsx` | 手机总览：顶部进度四刻度 + 顺时针四域拼图（左上资产/右上政策/右下信审/左下商务，每域四小分区）+ 业务协调入口 + 底部聊天 |
| `app/v5-preview/overview-landscape.tsx` | 横屏总览：顶栏项目号/进度/否决通过（禁用）+ 左 75% 四列四行 + 右 25% 聊天 + 业务协调入口 |
| `app/v5-preview/detail-workspace.tsx` | 共用详情骨架：材料依据（按域相关切片）、信审完整闭环（草稿→补件→业务回应→接续）、业务协调工作台、其他三域轻量结构 |
| `app/v5-preview/chat-panel.tsx` | 聊天：@域选择、人/Agent 标识、模拟回复（明确标记）、模拟人接手按钮、可收起 |
| `app/v5-preview/progress-ruler.tsx` | 进度四刻度（25/50/75/100 里程碑标记 + 演示口径说明） |
| `app/v5-preview/icons.tsx`、`preview.module.css` | 极简线性图标；克制四域色（仅总览），详情低保真 |
| `test/v5-preview.test.mjs` | 17 项：可执行行为测试（切取纯逻辑区间真实跑 reducer 闭环）+ 源码契约（隔离性/合成标注/禁用/布局常量） |

## 3｜运行状态与浏览器验证

- 预览 URL：`http://localhost:3311/v5-preview`（vinext dev，仅本次预览启动；端口 3311 已核实空闲后占用；PID **20452**，日志 `evidence/07-dev-server.log`）。
  - 停止：`taskkill /PID 20452`（或关闭终端）；重启：`cd jianwei-v3/site && npm.cmd run dev -- --port 3311`。
- 真实浏览器观察（ZCode IAB；非截图替代）：
  - **1920×1080**：横屏总览（四列四行、右 25% 聊天、否决/通过禁用+说明）；详情→返回；闭环全程操作。
  - **390×844**：手机总览（顺时针拼图、每域四分区、底部聊天收起/展开）；手机详情（材料/闭环/草稿）。
  - **1024×768（平板横屏）**：横屏总览与详情，断点表现一致。
- **合成信审—业务闭环（全部真实操作通过）**：信审详情保存草稿（出现"草稿已保存（本地模拟·时间）"）→ 提出补充要求（聊天出现 `[模拟补充要求]`，待办转业务）→ 切业务视角在工作台回应（聊天出现 `[模拟回应]`）→ 信审接续（待办变"意见候选就绪（模拟）"）→ 总览信审列同步为候选就绪、进度标记 50%→60%。刷新后状态经 sessionStorage 保留（失败关闭：损坏数据回退初始状态）。
- 聊天：@政策发送 → 约 0.7s 后出现带 `[模拟回复]` 标记的域回复；问句触发"需人工确认"提示并出现**模拟人接手**按钮 → 点击后出现具名（张信审）`[模拟人接手]` 人消息。
- 正式审批：横屏否决/通过均 `disabled`，title 与"为何禁用？"展开说明"正式审批待权限及对象约定——预览禁用，不产生 Decision/Receipt"；reducer 无任何正式审批动作（行为测试断言）。
- 控制台错误：交互全程安装 error/console.error 捕获（`window.__v5pErrors`），闭环+聊天全程为 `[]`；各页面无 `vite-error-overlay`。注：页面加载瞬间的日志无法回溯捕获，此为该方式的固有限制（诚实记录）。
- 截图（`screenshots/`，仅视觉证据，不冒充后端接通）：
  `01-landscape-1920-overview-after-loop.png`、`02-mobile-390-overview-top.png`、`03-mobile-390-credit-detail.png`、`04-tablet-1024-landscape-overview.png`、`05-desktop-1920-credit-detail.png`。

## 4｜检查结果（真实退出码，日志在 evidence/）

| 检查 | 命令 | 结果 | exit |
| --- | --- | --- | --- |
| 聚焦测试 | `node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview.test.mjs` | 17/17 | 0 |
| 全量测试 | `npm.cmd test` | **629/629**（既有 612 + 新增 17，零回归） | 0 |
| typecheck | `npm.cmd run typecheck` | 无错误 | 0 |
| lint | `npm.cmd run lint` | 0 错误；1 条**既有** warning（`test/v4life-verification-recovery.test.mjs` 未用变量，非本轮文件，按禁写范围未动） | 0 |
| build | `npm.cmd run build` | Build complete，`/v5-preview` 路由注册 | 0 |

## 5｜合成/真实能力边界

- 全部数据为合成演示（复用 B0 合成案例 `demo-sme-robot-500w` / 项目号 `2026PA21001`）；无 fetch、无 `/api/**` 调用、不导入 lib/** 或现有工作面（测试强制断言）。
- 模拟回复/模拟人接手/模拟转交/本地草稿均为前端内存+sessionStorage 预览状态；不产生 Decision/Receipt/正式事件；视角切换非身份认证。
- 进度四刻度为里程碑标记，演示推进（50%→60%）无真实算法口径；100% 不等于风险消失或生命周期结束（页面常驻说明）。
- 未接真实模型、未接 A2A、未伪造真人在线；政策五色/信审六维未被改动（预览分区不代表该语义）。

## 6｜缺口、偏差与诚实记录

1. **Mobile.jpg 缺失**：任务书指定的 `C:/Users/22673/Desktop/Mobile.jpg` 不存在（桌面与 `.codex-remote-attachments` 均无；今晨 6 张附件照片均为无关人像，未采用）。手机布局按任务书 §已接受的设计输入第 2 条文字规格实现，并通过测试常量固化顺时针映射。请用户提供该草图后可作差异核对。
2. **Desktop.jpg 已实际查看**：横屏顶栏（项目号/进度/否决通过）、四列纵向四行（草图第 5 行按任务书删除）、右 25% 聊天、右下输入框均按图实现。
3. **验证中发现并修复一处真实缺口**：横屏总览初版缺少业务协调入口（仅手机版有），已补顶栏入口并回归。
4. IAB 定位器点击在该 dev 页面出现"等待点击"超时（元素可达、无遮挡，经 elementFromPoint 诊断），部分交互改用页面内 `evaluate` 触发真实 DOM click/React 原生 setter——等价于真实用户事件，非 mock；已如实记录。
5. IAB 视口映射存在缩放差异（请求 1920×1080，实测 `innerWidth` 2112）；断点行为不受影响。整页（fullPage）截图在窄视口有拼接伪影，已改用视口分段截图并删除伪影文件。
6. 其他三域的"意见草稿"为组件内存态（刷新即失），仅信审闭环草稿入全局状态——轻量演示范围的有意取舍。
7. 模拟回复使用 700ms 定时器（前端演示）；无任何网络重试/超时语义。

## 7｜待用户/Codex 决定（不替决）

1. 层级与操作是否清楚（本次 checkpoint 的核心问题）：总览→详情→返回、业务协调入口、聊天可收起。
2. 手机拼图四小块与横屏四行的内容口径（当前为演示标签，不是制度四步）。
3. 否决/通过的位置保留但语义/权限未定——保持禁用，待权限及对象约定。
4. 进度刻度的真实口径、状态词集合（待处理/进行中/等待输入/退回复核/候选就绪）是否可作后续讨论基线。
5. Mobile.jpg 补充后的差异核对。

## 8｜恢复方法

- 预览：启动 dev（见 §3）→ 浏览器打开 `http://localhost:3311/v5-preview`；"重置演示"按钮或清 sessionStorage 键 `jw:v5-preview:state:v1` 可回初始状态。
- 代码：全部为新增文件，删除 `site/app/v5-preview/`、`site/test/v5-preview.test.mjs`、`V5/frontend/F0/` 即完全回退，不影响任何既有文件。
