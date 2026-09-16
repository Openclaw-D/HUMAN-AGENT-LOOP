# B 路 R1 修正报告（依据 codex-review/HOME_R1.md 2026-09-15 用户七条批注）

状态：**R1_APPLIED（七条全部落实，3607 已更新；停止，等待 Codex 复验与用户视觉检查；最多剩余 R2）**。
加载路径确认：`home/preview/main.tsx` import `../site-mirror/app/v5-preview/home-overview`——
3607 实际加载的就是 site-mirror 候选源码，本轮修改即生效（Vite HMR + 强制刷新双验证）。
仅写 `home/**`；未改 site/后端/Git；未操作 Codex；全部合成数据，无真实 API 调用。

## 七条批注 → 落实与证据

| # | 批注 | 落实 | 证据 |
|---|------|------|------|
| 1 | 删页头合成演示徽章、菜单按钮、重开按钮，不以同类控件替代 | 三控件与菜单面板/重开确认弹层整体删除（组件代码移除，非 CSS 隐藏）；来源标注保留在消息徽章（人工/模型（演示）/预设），不假称真实模型 | R1-01 截图无三控件；DOM 计数 menuBtn/restartBtn/demoChip = 0 |
| 2 | 标题左右两端：左项目名、右编号；375 不省略 | `splitTitle`：项目名内嵌编号时剥后缀，左名右编号；两端 space-between | R1-03（375）：`titleEllipsized:false`；01/02/05 |
| 3 | 16 格删所有可见状态文字，仅绿勾/蓝扳手/圆问号；保留 aria；旧偏好不能重开文字 | cellWord 与 localStorage 偏好代码整体删除（`jw:home:cell-text` 无读取方；preview origin 中旧键值 "1" 仍在但无效，实测 cellWord=0）；aria-label/title 恒完整 | R1-01/02/03/05 全部仅图标；量测 `cellTexts:0` |
| 4 | 域区大图标约一半 + 域名缩小；删除已确认/待补充等重复进度文案；详情保留 | 域图标 24px + 域名 11px 纵向堆叠（图标占域区视觉约一半）；行内 judgmentText 删除（含 aria）；判断状态文字移入行内展开详情（点击行 →"判断状态：X。summary" + 四段全名 + 相关待办） | R1-01/05；展开交互保留可点 |
| 5 | 固定上下各 50%，无拖拽/resize；上半=标题+生命周期+完整四域；下半=沟通/待办底部中文切换；story 推进/决定紧凑入待办区；聊天内部滚动，不裁输入框 | 根 `height:100dvh; overflow:hidden`，topArea/bottomArea 各 `flex:1 1 0`（自动扣除根 padding 16px+间隔 6px，等分）；上半行高/padding/gap 收紧（页头 32/阶段条 36/域行 46/格高 38），完整矩阵+下半入口 375×667 首屏全可见；底部 tabBar 两个中文页签（role=tablist/tab）；StoryStrip+TodoRow 在"当前待办"页签；msgList 内部滚动、输入框恒可见；整页零滚动 | 量测：375=323/323 diff 0；390=453/453 diff 0.01；1920=529/529 diff 0；`pageScrollable:false` 全尺寸 |
| 6 | 宽屏不切左右 50/50 两栏，只切内容无拖动分割 | 删除 ≥1024px 两栏媒体查询，全宽 度单结构；宽屏矩阵居中收拢不拉伸 | R1-04（1920）：上下 529/529，无左右分栏 |
| — | 拖拽/resize 源码核查 | 如实说明：候选从未有拖拽/resize 分隔逻辑，无删除动作。全源码 grep 仅命中：两处"无拖拽"注释、home-chat 的 ResizeObserver（消息两行折叠量测，非布局分隔）、textarea `resize:vertical`（表单常规属性） | grep 记录（本轮 Bash 输出） |

## 交互保留验证（合成数据，本地回调）

- 沟通发送：输入+发送可用；草稿跨页签切换保留（切待办再切回，`draft kept:true, sendEnabled:true`）。
- 待办提交：TodoRow 表单/恢复行随页签迁入"当前待办"，逻辑未改。
- 固定演示：推进后 story=2/4"预审意见人工判断"，决定三选项（确认意见/纠正口径/退回补充）在待办页签内可用；生命周期同步"商机已完成/预审进行中"（R1-05）。
- 键盘可达：页签为原生 button（role=tab，focus 验证 activeElement 命中）；全部操作件 focus-visible 样式保留。
- "原文"展开、域展开详情保留。

## 真实修改文件（R1）

| 文件 | 变更 |
|------|------|
| `site-mirror/app/v5-preview/home-contract.ts` | 注释更新：onRestart 仅 free 模式恢复使用；页签归属说明；**同步 A 集成版 `shared: SharedFactsView \| null` prop** |
| `site-mirror/app/v5-preview/home-header.tsx` | 重写：仅左右标题（新增 `splitTitle`）；删徽章/菜单/重开/确认/偏好读取 |
| `site-mirror/app/v5-preview/domain-grid.tsx` | 重写：16 格仅图标（删 cellWord 与 showCellText）；域区大图标小字；行内进度文案删除、判断状态入展开详情 |
| `site-mirror/app/v5-preview/home-chat.tsx` | 删面板内折叠开关（页签替代）；其余（origin 徽章/原文展开/恢复行）不变 |
| `site-mirror/app/v5-preview/home-overview.tsx` | 重写：固定 50/50 + 底部双页签；story/待办迁入下半；删宽屏两栏；**透传 `shared`** |
| `site-mirror/app/v5-preview/story-strip.tsx` | **同步 A 集成版**：SharedFactsLine + shared prop + state.sharedWarning 渲染（逐字取自 site 现版，仅加 R1 注释） |
| `site-mirror/app/v5-preview/home-overview.module.css` | 重写：50/50 布局/页签/紧凑顶部/无两栏；删菜单/确认/格文字样式 |
| `preview/index.html` | harness 补 body margin 重置（量测准确性；仅预览壳，非候选组件） |
| `preview/main.tsx` | 传 `shared={null}`（预览 harness 适配新 prop） |

未改动：`lifecycle-strip.tsx`、`todo-row.tsx`、`home-icons.tsx`、`demo-data.ts`、桥文件。
**与 A 集成版的关系**：A 曾在 site 集成时给 v1 加 `shared` prop 与重开确认文案修改；R1 候选已把
shared 全量同步（重开确认随控件删除而失效，无需同步）。site 旧 v1 组件与候选其余差异 = 本轮七条
批注本身；A 再采用时按 R1_REPORT 文件清单合并即可，无隐藏分叉。

## Gate 与量测记录

- typecheck（tsc strict）：0 错误（exit=0）。
- vite build：✓（265ms）。
- 等高量测（flex 等分，1px 舍入内）：375×667→323/323（diff 0）；390×844→453/453（diff 0.01px）；1920×1080→529/529（diff 0）。
- 全尺寸 `scrollWidth<=innerWidth`（无横向溢出）、`scrollHeight<=innerHeight`（无整页滚动）。
- 首屏：完整四域矩阵 + 底部页签入口在 375×667 即全部可见（R1-03）。

## 证据截图（home/evidence/）

R1-01 390 沟通页签；R1-02 390 待办页签；R1-03 375 待办页签（首屏完整）；R1-04 1920 待办页签（无两栏）；R1-05 390 待办决定态。

## 未完成项 / 交回 A

1. 本轮为 3607 候选修正；A 集成进 site 与 R-01～R-08 复核仍按 COMMON 待 A 执行。
2. 契约注释已更新（onRestart 仅 free 模式使用）；A 采用时按新 README/RESULT 对齐。
3. 已知取舍：上半在 390×844 有约 130px 留白（内容收紧优先保证 375×667 完整与 50/50 固定；留白属合理范围）。
4. R1 前的 11 张旧证据（01–11）反映旧布局，仅作历史对照；R1 现状以 R1-01～R1-05 为准。
