# F0-R1 REPORT｜四阶段工作预览与七项必修修复

日期：2026-09-08。执行：ZCode / Anthropic / NEW。依据：`V5/frontend/CODEX_REVIEW/F0_REVIEW_AND_R1_TASK.md`（Codex 持有，未改写）与 `V5/DECISIONS.md` 2026-09-07「四域共用四步与完成归属」。
状态：**F0-R1 完成，停止等待用户/Codex 验收；不放行 B1、真实审批、F1 或任何后续阶段。**

## 0｜开工记录

- HEAD `63c41c3`（未变）；开工时 porcelain 81 条 = F0 交付后状态，无漂移。
- 本轮修改文件副本 + SHA256 清单：`snapshot/`（10 个 F0 文件原样副本 + `SHA256SUMS.txt`）；文件快照不冒充 Git baseline。
- 收尾快照 `evidence/08-after-r1-snapshot.txt` 与 F0 收尾快照逐条一致（81 条 porcelain 完全相同）——R1 只改写了本就属于本轮写面的未跟踪文件，**零新增路径、零触碰他人/既有文件**。

## 1｜七项必修逐项修复与行为证据

### 1. 四阶段语义（P1 产品纠偏）
- `preview-state.tsx`：新增 `StageId/STAGE_ORDER/STAGE_LABELS`（material=材料合规 → model=模型校验 → review=人工复核 → formal=正式通过，固定共同 stageId）；`PreviewDomain.blocks` 废弃，改为 `stages: Record<StageId, {state,note}>` 单一阶段对象；`deriveStageBlocks/deriveDomainStatus/deriveDomainBlocker` 统一派生。
- 各域格子、域状态、卡点、详情阶段卡、待办全部由该对象派生（不再各域自造标签）；专业细项（材料切片、闭环表单、问题注记）下沉详情阶段卡。
- 前置为真实状态而非文字：阶段按序推进，`continue-credit` 同时落 material=done → model=done（含问题注记）→ review=ready（模拟）→ formal=locked；正式通过在详情中为禁用按钮 + "待权限及对象约定；不产生 Decision/Receipt"（合成只读情景表达，不伪造回执）。跨域正式依赖保留（商务 formal 注记依赖信审/政策有效人工决定）。
- 行为证据：`test/v5-preview.test.mjs`「接续后四阶段同步」断言 `blocks.map(state)==['done','done','ready','locked']`、formal 不得被自动推进、模型校验注记含问题。

### 2. 跨角色执行信审动作（P1 行为）
- reducer 逐动作角色守卫：`save-credit-draft`/`send-supplement-request`/`continue-credit` 仅 `role==='credit'`；`send-business-response` 仅 `role==='business'`；越权一律原样返回。UI 同步：详情按 `state.role` 禁用本域动作并显示"切换到X视角可操作（预览角色约束）"，跨域可查看不可代办。
- 行为证据：测试「角色守卫」——业务视角发补充要求/存草稿被拒（state 原样）；信审视角不得代业务回应；业务视角不得接续；正确角色逐一放行。浏览器实测：business 视角开信审详情 → 保存禁用 + 两条约束提示（见 §3）。

### 3. 草稿双源丢失（P1 数据丢失）
- 纯函数 `resolveEditingValue(editing, saved)`（editing=null 未初始化回显已存值；''=有意清空；其余=编辑值）；详情 textarea 显示与保存都取该函数结果，保存后 `setDraftEditing(null)` 回到回显模式。
- 浏览器实测（真实键盘）：存"草稿A"→返回总览→重进（回显A）→不编辑直接再存（**仍为A，不再写空**）→Ctrl+A+Delete 清空（显示空、不回弹）→保存空（有意清空语义）→再键入正式草稿保存 ✓。行为测试覆盖 `resolveEditingValue` 三态。

### 4. 畸形缓存被接受（P1 恢复）
- `parsePreviewState` 深度校验：version/caseId/projectNo/role 枚举/progress 0-100/domains 四键各含四阶段合法 WorkState/messages 逐项 fromKind+to+marks/nextId 非负整数/loop.stage 枚举与可空字符串/formalNotice+cacheNotice 类型。任何非法 → null → provider 派发 `cache-rejected` → 回退初始状态并显示明确提示（`role="alert"` 横幅"检测到无法识别的本地缓存，已重置为初始演示状态"）。
- 行为证据：测试以审查 probes 同款样本 `{version:1,domains:{},loop:{},messages:[],nextId:0}` 及 10 个变体逐一断言 `null`，合法往返 deepEqual；浏览器实测：注入畸形缓存→刷新→横幅出现且状态回初始、无渲染崩溃（注入为脚本操作，已如实标记）。

### 5. 域状态与格子不同步（P2 一致性）
- 格子/域摘要/详情/待办改为同一阶段对象派生（见第 1 项）；`continue-credit` 不再只改 status/blocker。
- 行为证据：测试「派生同步」与「接续后四阶段同步」；浏览器实测：接续后总览信审列头=候选就绪（模拟）、四格=已完成/已完成/候选就绪/禁用、进度标记 60%。进度 50→60 保留为演示口径（页面注明项目主体结束判定与算法未冻结，不把 +10 晋升为真实算法）。

### 6. reset 未清延迟回复（P2 重置）
- 纯逻辑 `createReplyGate()` 代际门：reset 递增 generation，已排程未触发的模拟回复在触发时被丢弃；provider 的 guardedDispatch 在 reset 时同时清定时器数组。
- 行为证据：测试「代际门」——schedule→reset→调用不生效、未 reset 正常生效。浏览器实测（真实点击）：发送 @政策 消息后 120ms 内点击重置演示，等 1.5s（越过 700ms 窗口）——消息恒为初始 2 条、loop/role/进度全部回初始，无旧回复渗入。

### 7. 格子导航未携带阶段（P2 导航）
- `PreviewView` 增加 `stage`；`viewToQuery/queryToView` 支持并校验 stage（非法丢弃、旧 URL 兼容）；横屏格子点击传 `b.stageId`；详情按 `highlightStage` 高亮对应阶段卡并标"自总览定位"；URL/浏览器返回保持上下文。
- 行为证据：测试「URL 携带域+阶段」六断言。浏览器实测：真实点击信审·材料合规格子 → URL=`?view=detail&domain=credit&stage=material`、材料合规卡高亮"自总览定位"；浏览器后退（popstate）回到详情上下文。

## 2｜手机四列候选（未冻结布局）

- 布局选择器新增「手机四列（候选对比）」：与横屏同一 `OverviewLandscape` 四列矩阵、同一状态对象，compact 模式（聊天移至下方、紧凑单元格）；页面常驻声明"仅供与手机顺时针拼图比较，未替代原手机决定"。原顺时针拼图保持默认。无第二套状态。
- 浏览器实测 390×844：四列候选渲染正常、`horizontalOverflow=false`，候选声明可见。

## 3｜浏览器实测记录（尺寸为实测 innerWidth×innerHeight）

IAB 视口存在 1.1 倍映射，按反比校准后命中目标值；输入通道实测结论：**Playwright locator 点击与 cua 坐标点击在本环境始终无法送达页面（actionability 等待超时；elementFromPoint 诊断无遮挡），实际输入经 dom_cua（节点级真实指针/键盘事件）完成**——共执行真实点击/键入 40+ 次；两处检查经深链接 goto（真实导航）；一处缓存注入为 evaluate 脚本（已标记）。evaluate 仅用于只读取证。

| 尺寸（实测） | 验证内容 |
| --- | --- |
| 1920×1080 | 横屏总览四列四行/图例/审批禁用；完整闭环（信审存草稿→提要求→切业务回应→接续→四阶段同步→总览 60%）；聊天 @政策→模拟回复（含需人工提示）→模拟人接手；reset 竞态；畸形缓存；长文本 323 字符发送无水平溢出；浏览器返回 |
| 390×844（实测 391×844） | 顺时针拼图总览（四格=四阶段）；手机详情+阶段高亮；手机四列候选 |
| 1024×768（精确） | 横屏总览断点表现 |
| 深链接 390/1920 | business 视角信审详情：保存禁用+两条角色约束提示；stage=material 高亮 |

- 控制台错误：闭环+聊天+竞态全程挂接 `window.__err`（error/console.error/unhandledrejection）捕获为 `[]`；所有页面无 `vite-error-overlay`。最后两个标签因工具通道退化未能在加载前挂接捕获，此为覆盖范围的固有限制（诚实记录）。
- 长文本：323 字符消息经真实键盘输入发送成功、无水平溢出；空输入：发送/保存按钮禁用态实测；等待/退回：信审 awaiting、资产 returned 情景在总览/详情可见。

## 4｜检查结果（真实退出码，日志在 evidence/）

| 检查 | 命令 | 结果 | exit |
| --- | --- | --- | --- |
| 聚焦测试 | `node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview.test.mjs` | **21/21**（新增角色守卫/阶段同步/深度校验/代际门/草稿单源/URL 阶段等回归） | 0 |
| 全量测试 | `npm.cmd test` | **633/633**（612 既有 + 21 本预览，零回归） | 0 |
| typecheck | `npm.cmd run typecheck` | 无错误 | 0 |
| lint | `npm.cmd run lint` | 0 error；1 条既有 warning（`test/v4life-verification-recovery.test.mjs`，非本轮文件未动） | 0 |
| build | `npm.cmd run build` | Build complete，`/v5-preview` 注册 | 0 |

服务：vinext dev `http://localhost:3311/v5-preview`，PID **3792**（端口 3311 使用前已核实空闲；日志 `evidence/07-dev-server.log`）。停止：`taskkill /PID 3792`；重启：`npm.cmd run dev -- --port 3311`。

## 5｜合成/真实边界（继承 F0 并保持）

不接真实接口/模型/A2A；页面常驻"交互预览 · 合成数据"；模拟回复/模拟人接手/模拟转交明确标记；正式通过禁用且 reducer 无任何正式审批动作（测试断言 PREVIEW_ACTION_TYPES 无 approve/veto/receipt/decision）；视角切换非身份认证；进度为演示口径。四阶段为 2026-09-07 决定的预览表达，不删除各域必经制度流程。

## 6｜未验证/诚实记录

1. locator 点击与 cua 坐标点击在本 IAB 环境不可用（工具层问题，非页面缺陷：elementFromPoint 证明目标可达无遮挡）；若 Codex 以自有浏览器复验，locator 路径应可用。
2. 最后两个标签未能加载前挂接 console 捕获（见 §3）；此前全流程捕获为零错误 + 全程无错误覆盖层。
3. 手机四列候选在 390px 下单元格较紧凑，仅作布局比较用，未做可用性调优。
4. 其他三域轻量草稿仍为本页内存态（有意取舍，信审草稿入全局状态）。
5. Mobile.jpg 仍缺失（沿用 F0 记录）；本轮手机顺时针布局未改动。

## 7｜恢复方法

- 预览：`npm.cmd run dev -- --port 3311` → 打开 `http://localhost:3311/v5-preview`；「重置演示」或清 sessionStorage `jw:v5-preview:state:v1` 回初始。
- 回退：R1 仅改写 `site/app/v5-preview/**` 与 `site/test/v5-preview.test.mjs`；恢复原 F0 版本可从 `snapshot/`（含 SHA256SUMS）逐文件复制回去；删除本目录即清除 R1 记录。

## 8｜截图清单（screenshots/，视觉证据不冒充后端接通）

`r1-01-landscape-1920x1080-overview.png`、`r1-02-mobile-390x844-overview.png`、`r1-03-mobile-390x844-fourcol-candidate.png`、`r1-04-mobile-390x844-credit-detail.png`、`r1-05-tablet-1024x768-landscape.png`
