# UI_INVENTORY — 远程尽调路径与复杂度审查（任务B · CP1）

基线：只读 `jianwei-v3/site`（hash 见 STATUS.md，采集于 01:31）。本文件只记录事实与证据，不写产品。

## 1. 路径表：首页 → 远程尽调 → 返回

| # | 步骤 | 位置（精确） | 机制 | 备注 |
|---|------|-------------|------|------|
| 1 | 首页加载 | `app/v5-preview/page.tsx`（路由 `/v5-preview`） | GET `/api/v5-preview/project` + 4s 轮询 | 上下 50/50：上=`RowsView`（五阶段+四域矩阵+待办），下=`ChatPanel`（沟通） |
| 2 | 入口 | `app/v5-preview/chat-panel.tsx:154` | `<Link href="/v5-preview/remote-session">远程尽调访谈</Link>`（`styles.remoteLink`，位于沟通工具行） | 全站唯一入口链接；首页主体无第二入口 |
| 3 | 远程尽调页加载 | `app/v5-preview/remote-session/page.tsx:230-254` | GET `remote-session/`（列表）→ `detail?sessionId=…`；`model-status` | 页内四态：loading / error / empty / ready |
| 4 | 页内全屏访谈 | 同文件 `:832-886` | **非路由**：`fullscreen` state 渲染覆盖层 `sivFull` | 入口链：底部"语音·未接入"按钮 → voice 区出现 → "进入全屏访谈"按钮（3 步才见画面位） |
| 5 | 返回 | 同文件 `:402/:428/:459` | `<Link href="/v5-preview">`（头部返回箭头，loading/error/empty/ready 四个分支都在） | 返回导航完整；aria-label"返回项目总览" |
| 6 | 全屏内退出 | `:872` "挂断" | `setFullscreen(false)`（只关覆盖层，非结束通话，文案已如实） | 与 CameraPanel"挂断并释放全部"（`:392`）同名不同义 |

结论：**路由层路径干净**（单入口、单返回、无死路由）。复杂度在页内结构与状态层，不在导航。

## 2. 远程尽调页现状结构（ready 态，自上而下）

| 区块 | 文件位置 | 呈现方式 | 问题 |
|------|---------|---------|------|
| 顶部 | `page.tsx:458-465` | 返回 + 状态徽章 + 当前问题标题 | OK |
| 未知请求恢复条 | `:467-477`（ready）/ `:438-444`（empty，**重复实现**） | PendingBar 列表 | 同一段 JSX 在两个分支重复 |
| 当前关键问题 | `:483-507` | 常开 section | OK（首屏主体） |
| 视频/连接状态 | `:510-520` | 一行文字"未接入（不申请…）"+徽章 + 模拟开关 checkbox | **视频不是主体**；模拟开关只影响全屏覆盖层，勾选后首页无任何可见变化 |
| 语音说明 | `:523-548` | 仅点击麦克风后出现；含"添加合成转写事件"按钮 | 转写演示按钮放错位置（转写属画面区，不属语音说明）；全屏唯一入口在此，深 |
| 证据与本地拍照 | `:551-586` | `<details>` 折叠：附着按钮×2 + 证据清单 + `<CameraPanel/>` | 折叠套折叠（CameraPanel 自带 collapsed 态 `camera-panel.tsx:107`）；CameraPanel 465 行含能力检测/生命周期日志/预览确认，是页内最大子系统 |
| 项目沟通与历史问答 | `:589-637` | `<details>` 折叠：历史问题列表 + 每条两个模型按钮（真实/模拟） | 按钮title泄漏配置（见 §4）；与首页 ChatPanel 名字相近但无关 |
| 演示设置 | `:640-676` | `<details>`：sessionId/provider/JIANWEI_MODEL_MODE/预算/核算/review log | 内部配置泄漏集中区（见 §4）；人工待处理唯一可见痕迹（review log）埋在此 |
| 底部操作坞 | `:683-829` | 访谈记录输入 + 2 字段 + 提交/暂停/恢复/转人工；或业务发起问题分支 | hit area ≥44px 已做；反馈行 notice/writeError/paused 三类混排 `:822-828` |
| 全屏覆盖层 | `:832-886` | 画面位（合成头像位）+ 转写 + 翻转/挂断/拍照 | "拍照"点击后退出全屏并提示去证据面板 —— 跨区跳转负担 |

## 3. 样式与死代码

| 文件 | 行数 | 引用情况 | 备注 |
|------|------|---------|------|
| `remote-session/se-interview.module.css` | 945 | 在用 | 变量体系完整（--siv-*）；媒体查询仅 `max-width:340px` + `prefers-reduced-motion`；**无桌面侧栏布局** |
| `v5-preview/se-overview.module.css` | 1116 | 在用 | 50/50 = `height:calc((100dvh-22px)/2)`（`:34/:734`）；`@media 359px / 700px / 600px高` |
| `v5-preview/preview.module.css` | 637 | **零引用（死代码）** | grep 全 app 无 import；建议 A 删除（B 不写源码） |
| `remote-session/camera-panel.tsx` | 465 | 在用 | 依赖 `lib/v5-preview/camera/camera-controller.mjs`；本轮演示"模拟场景不开摄像头"，可整体折叠保留 |

## 4. 内部配置泄漏清单（用户可见面）

| 位置 | 泄漏内容 | 用户影响 |
|------|---------|---------|
| `page.tsx:610-616` 历史问答按钮 title | `JIANWEI_MODEL_MODE=…`、缺失配置键名、超时/预算计数 | 业务用户看到环境变量名与内部契约参数 |
| `page.tsx:648-655` 演示设置 | sessionId 切片、provider、`JIANWEI_MODEL_MODE`、"CONTRACT 20260913" 字样 | 内部文档引用出现在界面文案 |
| `page.tsx:619` 按钮/`notice` 文案 | "（REAL · 结果仅疑点线索…）" 等内部模式标签 | 术语泄漏（SIMULATION/REAL 标记按产品要求保留，但可收敛为统一徽章） |
| `camera-panel.tsx:316` | `CAMERA_CONTROLLER_VERSION` 版本串随界面文案展示 | 内部版本号对业务无意义 |

（演示模式声明本身是要求，保留；以上指**超出声明必要性的**内部参数。）

## 5. 状态清单（现状 → CP2 目标映射）

| 状态 | 现状 | 目标（CP2） |
|------|------|------------|
| 加载 | ✅ loading 态 + 骨架文案 | 保留 |
| 错误 | ✅ error 态 + 重试（页级）；写错误 writeError；版本冲突 | 保留，统一反馈行 |
| 空 | ✅ empty 态 + 创建会话 | 保留 |
| 正常 | ✅ ready；徽章 live/paused | 保留 |
| 模拟 | ⚠️ simulationOn 仅全屏生效；SIMULATION 文案散落 | 画面区常驻模拟态徽章，开关直接作用于画面区 |
| 未连接 | ✅ 视频"未配置"徽章（诚实） | 保留为画面区默认态之一 |
| 人工待处理 | ⚠️ escalate 写入后仅"演示设置"review log 可见 | 独立"人工待处理"区（转人工/暂停后可见、有状态） |
| 未知请求 | ✅ 恢复条（ready/empty 重复实现） | 抽单一组件，统一渲染 |
| 四域提示 | ❌ **远程尽调页内没有四域风险提示**（四域只在首页矩阵） | 新增：视频侧栏（桌面）/紧凑折叠（手机） |
| 内部交流 | ⚠️ "项目沟通与历史问答"折叠区 ≠ 与后方团队实时交流；无独立输入 | 与证据/转写合并为"记录"层，或以首页 ChatPanel 语义为准（待 A 契约） |

## 6. 复杂度量化

- 远程尽调页三文件共 **2304 行**（page 894 + camera 465 + css 945）；单文件组件、18 个 useState + 5 个 ref（`page.tsx:186-214`）。
- 首页 `page.tsx` 624 行中约 2/3 为恢复/版本门逻辑（A 域，B 不动）；B 关注点：B 路候选不复制这套机制，改为回调。
- 死代码：`preview.module.css` 637 行零引用。
- 重复：PendingBar JSX 两分支重复；"挂断"语义两处冲突；全屏与页内各有一套"拍照"路径。
