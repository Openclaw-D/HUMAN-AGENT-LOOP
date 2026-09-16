# B 候选 · 首页与响应式交互（REPAIR_20260914_EVENING / B 路）

日期 2026-09-14。本目录是**首页候选**，交付给 A 路采用集成；`site/` 与 3467 预览全程只读，
B 未写任何产品文件。状态与证据见 `../home/RESULT.md`。

## 1. 目录结构

```
home/
  site-mirror/app/v5-preview/   ← 候选组件（与 site/app/v5-preview 同构，import 路径一致）
    home-overview.tsx             组合根（默认导出）
    home-contract.ts              props/回调契约 + 消息扩展类型（origin/summary）
    home-header.tsx               页头：项目名 + 合成演示标识 + 菜单 + 右上重开图标 + 重开确认
    home-menu（在 home-header 内） 项目详情 + 显示偏好（真实功能，无假菜单项）
    lifecycle-strip.tsx           五阶段（绿对号/蓝扳手/白描边问号 + 语义修正）
    domain-grid.tsx               四域矩阵：近方形格 + 状态圆标 + 可隐藏文字
    story-strip.tsx               固定演示条（重开入口移至页头图标）
    todo-row.tsx                  当前待办（行为语义承接现有 TodoCard，含恢复行）
    home-chat.tsx                 项目沟通：1–2 句压缩 + 来源精确标注 + 原文展开
    home-icons.tsx                新增图标（菜单/重开/扳手/问号/小箭头）
    home-overview.module.css      全部样式（CSS Module，单个文件）
    rows-logic.ts / se-icons.tsx / api-client.ts   【桥文件，禁止拷入 site】
  site-mirror/lib/v5-preview/shared-types.ts      【桥文件，禁止拷入 site】
  preview/                       隔离预览 harness（vite + 演示数据，端口 3607）
  evidence/                      截图证据（01–10）
  RESULT.md                      交付结果
```

## 2. A 采用步骤（预计 ≤30 分钟）

1. 把 `site-mirror/app/v5-preview/` 下这 **10 个文件**拷入 `site/app/v5-preview/`：
   `home-overview.tsx`、`home-contract.ts`、`home-header.tsx`、`lifecycle-strip.tsx`、
   `domain-grid.tsx`、`story-strip.tsx`、`todo-row.tsx`、`home-chat.tsx`、`home-icons.tsx`、
   `home-overview.module.css`。
   **不得拷贝** `rows-logic.ts`、`se-icons.tsx`、`api-client.ts`（桥文件，仅隔离开发用；
   若误拷会覆盖 site 真文件并在构建期报错——fail-loud 设计）。
2. 可选合并：`home-icons.tsx` 里 6 个新图标可并入 site `se-icons.tsx`（只增不删），
   并把候选里的 `from './home-icons'` 改为 `from './se-icons'`；不改也能编译。
3. 新页面挂载（A 决定路由形态）：`page.tsx` 现有状态层（overview 轮询、story 通道、
   恢复通道、seed/重开确认）全部保留，渲染层把 `<RowsView>…<ChatPanel>` 替换为
   `<HomeOverview …props 见下>`。page 层现有 restart 确认弹层可删除（候选内含，
   作用域文案见差异清单 D5）。
4. 页面级横幅（409 冲突/轮询失败/seed 提示）组装为 `banners: HomeBanner[]` 传入。

## 3. Props 契约（home-contract.ts，全为 A 现有通道）

```ts
interface HomeOverviewProps {
  overview: ProjectOverview;            // GET /api/v5-preview/project
  story: StoryStateView | null;         // GET /api/v5-preview/demo/story
  storyBusy; storyError; storyNotice;   // 固定演示写通道状态
  onAdvance(fromStepId); onDecide(fromStepId, kind);
  onRestart();                          // A 的 restartStory（seed approval）；确认弹层在候选内
  restarting: boolean;
  onSubmitNote(todoId, text);           // 说明通道（与现 TodoCard 同语义）
  pendingNote; onResolvePendingNote(); onDismissPendingNote(); resolvingPendingNote;
  onSendMessage(text);                  // 沟通通道
  pendingMessage; onResolvePendingMessage(); onDismissPendingMessage(); resolvingPendingMessage;
  recoveryPersistFailed: boolean;
  banners: HomeBanner[];                // 页面级提示（conflict/pollError/seedNotice…）
  remoteHref?: string;                  // 远程尽调入口；缺省隐藏
  messageExtras?: Record<id, { origin?; summary? }>;  // R-03 消息扩展（推荐并入消息数据本身）
}
```

**B 需要 A 新供给的数据（可选字段，缺省不阻塞集成）**：

- 消息来源 `origin: 'human' | 'model' | 'preset'`。缺省保守推导：business→人工、
  system→预设、**domain→预设**（合成演示里的专业域内容是脚本预设，不得标成真实模型；
  仅当 A 明确 `origin:'model'` 时显示「模型（演示）」）。
- 消息摘要 `summary`（1–2 句，A 供给）。缺省时 B 不自造摘要：正文按至多两行折叠、
  完整原文恒可展开（DOM 不删字，不改变风险含义）。

## 4. 差异清单（相对现 site 首页）

| # | 变更 | 依据（用户批注/COMMON） |
|---|------|--------------------------|
| D1 | 删除上下两块 `calc((100dvh-22px)/2)` 硬半屏：顶部内容自适应高度，沟通区 flex 占底+min-height，内容超出整页可滚 | R-01 固定半屏断层 |
| D2 | 删除页头客户信息整行（客户名/编号收进菜单"项目详情"，真实 overview 字段） | R-01 移除原客户行 |
| D3 | 删除页头"合成演示·控制"下拉（情景切换入口整体移除；重开=seed approval，是唯一演示控制入口）；保留 10px「合成演示」静态标识 | R-01 移除合成控制 |
| D4 | 新增右上重开**图标**（循环箭头，非浏览器刷新）+轻量确认弹层（作用域文案：仅固定演示进度与四域状态；远程尽调会话与模型分析记录不受影响）；确认后才回调 `onRestart` | R-01 重开图标回调 A |
| D5 | 新增中文菜单：项目详情（客户/项目/编号/当前情景/当前阶段/总体状态/版本时间）+ 显示偏好（四域格子文字开关，localStorage `jw:home:cell-text` 持久化）；无任何无功能菜单项；菜单限高 58dvh 内部滚动，不遮挡输入框 | R-01 中文菜单/小菜单 |
| D6 | 五阶段语义修正：状态圆标=完成绿圆白对号/进行蓝圆扳手/未开始白底描边圆问号（轮廓可见），aria-current+无障碍名称"X，进行中"；**修正旧映射 bug**——story 第 1 步（商机）旧推导 currentIndex=-1 导致五阶段全"未开始"，候选按 stageIndex 直接推导（前序=完成/当前=进行中/后续=未开始），不改 site rows-logic | R-02 阶段显示不能只换颜色 |
| D7 | 四域格子近方形：58×58（390 视口）～88×88（桌面，上限），6px 列距间隔；格内状态圆标+可隐藏中文短词（完成/进行/未开始）；文字隐藏时 aria-label/title 恒完整 | R-02 近方形格子/文字可隐藏 |
| D8 | 消息压成 1–2 句视觉高度：A 供 summary 显示摘要，否则正文两行折叠；「原文」按钮展开完整原文；来源徽章 人工（蓝）/模型（演示）（紫）/预设（灰），缺省保守推导不把预设标成真实模型 | R-03 |
| D9 | 桌面 ≥1024px 非对称两栏 11fr/9fr（非 50/50），各栏内部滚动；700–1023 单栏 860px 居中；手机单列构图；无任何固定画布 transform 缩放 | R-01/R-08 |
| D10 | 固定演示条重开文字按钮移除（页头图标接管）；free 模式保留"回到固定演示"入口 | R-01 |
| D11 | 装饰性阶段功能图标（气泡/清单/放大镜/笔/循环）移除，阶段含义由阶段名表达 | R-02（状态图标替代装饰图标） |

## 4b. 给 A 的配置建议（B 未改任何 next 配置）

开发 N 入口隐藏建议：在 `next.config.ts` 用环境门（如 `NEXT_PUBLIC_SHOW_DEV_ENTRY`）控制
开发入口渲染，默认关闭；具体实施由 A 在 baseline 硬门满足后执行。

## 5. 已知限制 / 交回 A 的剩余项

1. `origin/summary` 为可选字段：A 未供给前，domain 消息一律标「预设」（保守正确，
   但若后续真实接入模型，需要 A 把来源写进数据，不能由 CSS/前端伪装）。
2. 情景切换（approval/post-rental/settled 下拉）随 D3 整体移除；如用户还要多情景演示，
   需 A 决定新入口（当前授权范围仅固定演示主线）。
3. `messageExtras` 是过渡通道；A 把 origin/summary 并入 `OverviewMessage` 后可删。
4. 真实浏览器缩放（非 CSS zoom）在产品页的 80%/125% 复核由 A 在 3467 集成后执行
   （IAB 预览不支持 Ctrl±缩放，候选用 CSS zoom 代理验证，见 evidence 08/09）。

## 6. 自测与预览

- typecheck：`home/preview` 下 `../node_modules/.bin/tsc -p tsconfig.json` → 0 错误。
- build：`vite build` → ✓（28 modules）。
- 隔离预览：`node_modules/.bin/vite --config vite.config.mjs` → http://127.0.0.1:3607/。
- 证据截图：`evidence/01–10`（375/390/1920、缩放 80%/125% 代理、菜单/重开/偏好/展开）。
