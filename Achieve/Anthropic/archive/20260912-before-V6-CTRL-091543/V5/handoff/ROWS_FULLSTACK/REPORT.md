# ROWS_FULLSTACK REPORT｜四域横条总览与前后端联动（Rev2 交付）

日期：2026-09-12 凌晨完成。执行：ZCode 主 Agent + 3 路原生实现/验证 sub-agent + 1 路只读 UX sub-agent。
状态：**全部检查点完成，可运行版本已交付；按任务书停止，等用户/Codex 最终验收。**

## 1｜交付摘要

在既有 V5 preview 上完成业务角色"新客回租单项目·四域横条总览"的**真实前后端联动**：

- **前端**（`app/v5-preview/**` 重写）：四条宽横条域卡（名称+红黄绿灰信号灯+四段灰度分段+一句说明）、顶部客户/项目/整体里程碑（文字表达，无数字总进度，灰度条标注"演示示意·非计算"）、最重要待办卡（提交材料→补充说明表单）、底部可展开项目沟通；390/1920 自适应；加载/错误/冲突/空态齐备；黑白灰基底、信号色仅用于判断灯；键盘可达、`prefers-reduced-motion` 全关动画；页面常驻"交互预览 · 合成数据"。
- **后端**（新增隔离层 `lib/v5-preview/**` + `app/api/v5-preview/**`，零改动 v4life 核心）：GET 项目总览 + POST 补充说明/沟通/演示 seed 四路由；requestId 幂等（同载荷重放 `replayed:true` 不重复记账、换载荷 409）、expectedVersion 乐观并发（409+serverVersion）、演示受控身份（服务端只授权 business：缺字段 400、值≠business 403）、输入校验、`V5_PREVIEW_DATA_DIR` 可配的 JSON 文件持久化（原子写；**损坏 → 500 STORE_CORRUPT 拒绝静默重置**）。
- **验收闭环**（浏览器真实输入打通）：黄灯补件 → 业务提交合成说明 → version 7→8、待办与信审一致转"待复核"（保持黄灯，不自动变绿）→ 刷新/第二视口/服务重启读取同一状态。红线未动、无关域未被清零。
- **三种生命周期合成情景**：审批推进中（v7，交互）/ 起租后资产管理（v23，资产黄灯观察中+巡检待办）/ 已结清（演示）（v41，无开放待办，notes 拒绝 409 NO_OPEN_TODO、沟通可留档）。切换经预览控制条"演示控制·非业务操作"，非业务按钮。

## 2｜修改清单与 baseline

- 开工快照：HEAD `63c41c3`（未变）、porcelain 81 条、10 个既有 F0-R1 文件副本+SHA256（`evidence/c0-snapshot/`）。收尾快照 `evidence/09-after-rows-snapshot.txt`。
- **新增**：`lib/v5-preview/{shared-types,store,service}.ts`、`app/api/v5-preview/{project,notes,messages,demo/seed}/route.ts`、`test/v5-preview-{http,recovery}.test.mjs`、`V5/handoff/ROWS_FULLSTACK/**`。
- **重写**（原副本可恢复）：`app/v5-preview/**`（page/rows-view/domain-row/todo-card/chat-panel/api-client/rows-logic/preview.module.css；删除 preview-state、overview-mobile/landscape、detail-workspace、progress-ruler、icons）、`test/v5-preview.test.mjs`（20 用例）。
- 运行时数据（与源码分开、未跟踪）：`<site>/.v5-preview-data/`（演示存储）、`.v5-preview-data-recovery-test/`（验证证据：含故意损坏的 store 原样留档）；均可安全删除。
- 零触碰：v4life 核心、app/api/v4life、vite.config、package.json/lockfile、根部 authority、V4 文档、他人修改。未 git commit/push/tag、未安装依赖、未部署、未操作 Codex。

## 3｜实际 API 与 schema

冻结契约见 `IMPLEMENTATION.md`（§2 路由/错误码表、§3 三情景种子、类型 `lib/v5-preview/shared-types.ts`）。要点：`GET /api/v5-preview/project`（业务可见视图，无专业细节路由可绕过）；`POST …/notes|messages`（requestId+expectedVersion+actorRole）；`POST …/demo/seed`。总览含 projectId/version/里程碑/四域（四段+独立判断灯+业务可见摘要）/当前待办/业务可见消息/updatedAt；阶段按域配置，未把旧"材料合规—模型校验—人工复核—正式通过"套到资产生命周期（宪章 §5 一致）。

## 4｜多 sub-agent 实际分工（详见 OWNERSHIP.md）

| Lane | 实际执行 | 结果 |
| --- | --- | --- |
| FE worker（原生 sub-agent） | 前端重写 + 前端测试 | 20/20；scoped tsc/eslint 绿 |
| BE worker（原生 sub-agent） | 存储/服务/路由 + dev:node 冒烟 | 28 项冒烟两轮全过；DEFECT-3 修复后四项复证 |
| VERIF worker（原生 sub-agent） | 真实 HTTP/恢复测试（自起隔离实例） | 终局 **14/14**（含重启恢复、损坏不静默重置、幂等、冲突、越权、三情景） |
| UX/review worker（原生 sub-agent，只读） | UX_REVIEW.md 16 条（P1×2/P2×5/P3×9） | P1×2 与全部 P2、多数 P3 已修 |
| 浏览器实测 | **主 Agent**（Harness 规定 Browser Use 仅主 Agent 可用，UX worker 不做浏览器操作——如实记录） | 见 §6 |

集成期缺陷全部按"复现证据 → owner 修复 → 复验"闭环：DEFECT-1（运行时持久化不可行→主控裁决 dev:node，IMPLEMENTATION §1 修订）、DEFECT-2（调试探针残留，BE 自修）、DEFECT-3（缺 actorRole 403→400，裁决"缺=400/错值=403"，BE 修复 VERIF 复证）、UX P1-2（requestId 生命周期，FE 修复后浏览器连发两条消息回归通过）。

## 5｜Gate 结果（真实退出码，日志在 evidence/）

| 检查 | 命令 | 结果 | exit |
| --- | --- | --- | --- |
| 全量测试 | `npm.cmd test` | **647/647**（612 既有 + 20 前端 + 12 HTTP + 2 恢复 + 1 清理；零回归） | 0 |
| typecheck | `npm.cmd run typecheck` | 无错误 | 0 |
| lint | `npm.cmd run lint` | **0 error**；1 warning 为**既有**（`test/v4life-verification-recovery.test.mjs` 未用变量，非本轮写面未动） | 0 |
| build | `npm.cmd run build` | Build complete；`/v5-preview` 与 `/api/v5-preview/*` 路由注册 | 0 |
| 真实 HTTP | `node --test test/v5-preview-http.test.mjs`（3399 自起实例） | 12/12（GET/写入/幂等重放/换载荷 409/版本冲突 409+serverVersion/畸形 400/越权 403/NO_OPEN_TODO/三情景/损坏 500） | 0 |
| 恢复 | `node --test test/v5-preview-recovery.test.mjs`（3398） | 2/2（kill→重启逐字段一致；损坏文件逐字节不改写） | 0 |

## 6｜浏览器实测（主 Agent，IAB；视口按 1.1 反比校准后实测 innerWidth×innerHeight）

- **391×844**：四横条总览渲染与参考图一致（远山精密制造/新客回租·JW-2026-018/演示项目）；无横向溢出；验收闭环全操作（提交材料→键入→提交说明→v8 待复核→信审黄灯待复核→卡片转"已提交补充说明，信审复核中（合成）"且无提交入口）；**连续两条消息正常入账（v8→v10，P1-2 回归）**；截图 rows-01/02/06。
- **1920×1080**：同一数据桌面自适应、无溢出；第二视口读到同一 v8 状态（第二客户端一致性）；截图 rows-03。
- 三情景切换：post-rental（v23）/settled（v41）截图 rows-04/05。
- 服务重启恢复：kill 3311 实例→重启→GET/UI 同状态（v8/待复核/4 条）。
- 控制台：交互期 error 捕获为空、全程无 `vite-error-overlay`（截图管道偶发超时为本 Harness 已知问题，DOM 状态读取为证）。

## 7｜运行状态与复验

- 演示服务：**运行中**，`http://localhost:3311/v5-preview`，dev:node，PID **28568**（日志 `evidence/c1-demo-server.log`）。停止 `taskkill /PID 28568 /T /F`；重启 `npm.cmd run dev:node -- --port 3311`。
- 演示步骤/合成数据说明/恢复方法：**DEMO.md**。注意：同仓库同时只能跑一个 dev 实例（`.next/dev/lock`）；跑 HTTP 测试需先停演示实例。

## 8｜限制与未完成项（如实）

1. **持久化等级**：单进程 JSON 文件（原子写），无多实例/事务保证；生产级持久化需后续独立 Gate。
2. **DEFECT-1 平台事实**：`npm run dev`（vinext/workerd）禁 `node:fs`、env 不可见——持久化路由必须在 `dev:node` 下运行；`vinext build` 可通过（构建不执行 fs）。未改 vite.config（避免越写面），已记录裁决链。
3. 演示身份为服务端受控的本地合成角色（张业务（演示）），**非生产鉴权**；无真实模型/API，全部后续判断标注"合成"。
4. 测试基建竞态（合并套件下 next dev 单实例锁 + taskkill 树断裂）经三轮修复：spawn 前端口等待 + already-running 重试 + **按就绪时捕获的监听 PID 直接精确补杀** + 显式清理用例（isolation=none 下文件级 after() 被推迟到 run 末尾，导致实例泄漏给后续文件——终版以文件末尾清理测试解决，647/647）。后两处对 VERIF 测试文件的收尾修正由主 Agent 实施（单 writer 集成例外，已在 CHECKPOINTS 记录）。
5. UX P3 遗留（有意不修）：段名仅 hover 可见（SR 已完整）、桌面单列加宽为任务书明示选择（构图重设计留 UX 复验）；BE 侧 NOT_FOUND 文案仍含内部 todoId（前端已映射为友好文案，彻底清理属 BE 后续）。
6. Mobile.jpg 仍缺失（沿用 F0 记录）；本轮布局以任务书文字规格 + 06-horizontal-rows.png 为准。

## 9｜验收补充项对照（任务书"验收补充"）

- 服务重启恢复：✓（§6 + recovery 测试 2/2）
- 第二客户端读取一致：✓（§6 桌面第二视口 + HTTP 用例）
- 过期版本冲突不丢草稿：✓（409→草稿保留+自动重取，前端测试+实现；HTTP 层 409+serverVersion）
- 未知状态不自动放行：✓（灰灯+文字，无默认绿灯；正式通过无入口无动作；reducer/服务端均无审批动作类型）
- 演示身份隔离 ≠ 生产鉴权、合成状态 ≠ 正式审批：✓ 页面常驻标注 + 测试断言。
